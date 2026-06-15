// ====================================
// 🔑 API Keys Route Module
// ====================================
// CRUD for API keys + API key authentication middleware
// Tier requirement: api feature (Growth+)

'use strict';

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { body, param, query } = require('express-validator');
const { authenticateToken, requireRole, validate, auditLog, logger } = require('../middleware/auth');
const db = require('../db');

// ====================================
// HELPERS
// ====================================

/**
 * Generate a new API key: prefix (8 chars) + secret (48 chars)
 * Only prefix is stored, full key is returned once at creation
 */
function generateApiKey() {
    const prefix = 'czpk_' + crypto.randomBytes(4).toString('hex');
    const secret = crypto.randomBytes(32).toString('base64url');
    const fullKey = `${prefix}_${secret}`;
    const keyHash = crypto.createHash('sha256').update(fullKey).digest('hex');
    return { fullKey, prefix, keyHash };
}

/**
 * Authenticate a request via API key (x-api-key header)
 */
async function authenticateApiKey(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) return next(); // Fall through to JWT auth

    try {
        const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
        const key = await db.getOne(`
            SELECT ak.*, u.email, u.role, u.company_id 
            FROM api_keys ak 
            JOIN users u ON ak.user_id = u.id
            WHERE ak.key_hash = ? AND ak.is_active = 1
        `, [keyHash]);

        if (!key) {
            return res.status(401).json({ error: 'Neplatný API klíč' });
        }

        // Check expiration
        if (key.expires_at && new Date(key.expires_at) < new Date()) {
            return res.status(401).json({ error: 'API klíč vypršel' });
        }

        // 🔐 FIXED: Per-key rate limiting enforcement
        const rateLimit = key.rate_limit_per_hour || 1000;
        const windowKey = `apikey:${key.id}:${Math.floor(Date.now() / 3600000)}`;
        if (!apiKeyRateLimits.has(windowKey)) {
            apiKeyRateLimits.set(windowKey);
            apiKeyRateCounters.set(windowKey, 0);
            // Clean up old windows
            for (const [k] of apiKeyRateCounters) {
                if (k !== windowKey && k.startsWith(`apikey:${key.id}:`)) {
                    apiKeyRateCounters.delete(k);
                    apiKeyRateLimits.delete(k);
                }
            }
        }
        const currentCount = (apiKeyRateCounters.get(windowKey) || 0) + 1;
        apiKeyRateCounters.set(windowKey, currentCount);
        if (currentCount > rateLimit) {
            return res.status(429).json({ error: 'API klíč překročil rate limit', limit: rateLimit, window: '1h' });
        }

        // Update last used
        await db.run('UPDATE api_keys SET last_used_at = NOW() WHERE id = ?', [key.id]);

        // Set user context (same shape as JWT decoded)
        req.user = {
            userId: key.user_id,
            email: key.email,
            role: key.role,
            companyId: key.company_id,
            isApiKey: true,
            apiKeyId: key.id,
            permissions: JSON.parse(key.permissions || '[]')
        };

        next();
    } catch (error) {
        logger.error('API key auth error', { error: error.message });
        return res.status(500).json({ error: 'Chyba autentizace' });
    }
}

/**
 * 🔐 NEW: Middleware to enforce API key permissions
 * Usage: requireApiPermission('read') or requireApiPermission('write')
 * For JWT-authenticated users, this is a no-op (permissions are role-based)
 * For API key users, checks that the key has the required permission
 */
function requireApiPermission(permission) {
    return (req, res, next) => {
        // Only enforce for API key authenticated requests
        if (!req.user || !req.user.isApiKey) return next();
        
        const perms = req.user.permissions || [];
        // 'admin' permission grants everything
        if (perms.includes('admin') || perms.includes('*')) return next();
        // Check specific permission
        if (perms.includes(permission)) return next();
        
        logger.warn('API key permission denied', {
            apiKeyId: req.user.apiKeyId,
            required: permission,
            granted: perms
        });
        return res.status(403).json({ 
            error: 'API klíč nemá požadované oprávnění',
            required: permission,
            granted: perms
        });
    };
}

// In-memory rate limit tracking for API keys
const apiKeyRateLimits = new Set();
const apiKeyRateCounters = new Map();

// ====================================
// ROUTES
// ====================================

// GET /api/api-keys — List API keys for current company
router.get('/', authenticateToken, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
        const keys = await db.getAll(`
            SELECT id, uuid, name, key_prefix, permissions, rate_limit_per_hour,
                   is_active, last_used_at, expires_at, created_at, revoked_at
            FROM api_keys 
            WHERE company_id = ? 
            ORDER BY created_at DESC
        `, [user.company_id]);

        res.json({ keys });
    } catch (error) {
        logger.error('List API keys error', { error: error.message });
        res.status(500).json({ error: 'Nepodařilo se načíst API klíče' });
    }
});

// POST /api/api-keys — Create new API key
router.post('/',
    authenticateToken,
    requireRole(['admin', 'employer']),
    body('name').trim().isLength({ min: 1, max: 100 }).withMessage('Název je povinný'),
    body('permissions').optional().isArray().withMessage('Oprávnění musí být pole')
        .custom((arr) => {
            const VALID_PERMS = ['read', 'write', 'payroll', 'employees', 'reports', 'admin', '*'];
            if (arr && arr.some(p => !VALID_PERMS.includes(p))) {
                throw new Error('Neplatné oprávnění. Povolené: ' + VALID_PERMS.join(', '));
            }
            return true;
        }),
    body('expires_in_days').optional().isInt({ min: 1, max: 365 }).withMessage('Platnost 1-365 dní'),
    body('rate_limit_per_hour').optional().isInt({ min: 10, max: 10000 }),
    validate,
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
            const { name, permissions = ['read'], expires_in_days, rate_limit_per_hour = 1000 } = req.body;

            // Limit API keys per company
            const existing = await db.getOne('SELECT COUNT(*) as cnt FROM api_keys WHERE company_id = ? AND is_active = 1', [user.company_id]);
            if (existing.cnt >= 10) {
                return res.status(400).json({ error: 'Maximálně 10 aktivních API klíčů' });
            }

            const { fullKey, prefix, keyHash } = generateApiKey();
            const uuid = crypto.randomUUID();
            const expiresAt = expires_in_days
                ? new Date(Date.now() + expires_in_days * 86400000).toISOString()
                : null;

            await db.run(`
                INSERT INTO api_keys (uuid, company_id, user_id, name, key_hash, key_prefix, permissions, rate_limit_per_hour, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [uuid, user.company_id, req.user.userId, name, keyHash, prefix, JSON.stringify(permissions), rate_limit_per_hour, expiresAt]);

            await auditLog('API_KEY_CREATED', {
                userId: req.user.userId,
                userEmail: req.user.email,
                resourceType: 'api_key',
                resourceId: uuid,
                ip: req.ip,
                metadata: { name, prefix, permissions }
            });

            // Return the full key ONCE — it won't be shown again
            res.status(201).json({
                message: 'API klíč vytvořen. Uložte si ho — nebude znovu zobrazen.',
                key: {
                    uuid,
                    name,
                    api_key: fullKey,
                    prefix,
                    permissions,
                    rate_limit_per_hour,
                    expires_at: expiresAt
                }
            });
        } catch (error) {
            logger.error('Create API key error', { error: error.message });
            res.status(500).json({ error: 'Nepodařilo se vytvořit API klíč' });
        }
    }
);

// DELETE /api/api-keys/:uuid — Revoke API key
router.delete('/:uuid',
    authenticateToken,
    requireRole(['admin', 'employer']),
    param('uuid').isUUID(),
    validate,
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
            const result = await db.run(`
                UPDATE api_keys SET is_active = 0, revoked_at = NOW()
                WHERE uuid = ? AND company_id = ?
            `, [req.params.uuid, user.company_id]);

            if (result.rowCount === 0) {
                return res.status(404).json({ error: 'API klíč nenalezen' });
            }

            await auditLog('API_KEY_REVOKED', {
                userId: req.user.userId,
                userEmail: req.user.email,
                resourceType: 'api_key',
                resourceId: req.params.uuid,
                ip: req.ip
            });

            res.json({ message: 'API klíč zrušen' });
        } catch (error) {
            logger.error('Revoke API key error', { error: error.message });
            res.status(500).json({ error: 'Nepodařilo se zrušit API klíč' });
        }
    }
);

// PATCH /api/api-keys/:uuid — Update API key settings
router.patch('/:uuid',
    authenticateToken,
    requireRole(['admin', 'employer']),
    param('uuid').isUUID(),
    body('name').optional().trim().isLength({ min: 1, max: 100 }),
    body('permissions').optional().isArray(),
    body('rate_limit_per_hour').optional().isInt({ min: 10, max: 10000 }),
    body('is_active').optional().isBoolean(),
    validate,
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
            const key = await db.getOne('SELECT * FROM api_keys WHERE uuid = ? AND company_id = ?', [req.params.uuid, user.company_id]);
            if (!key) return res.status(404).json({ error: 'API klíč nenalezen' });

            const updates = [];
            const params = [];
            if (req.body.name !== undefined) { updates.push('name = ?'); params.push(req.body.name); }
            if (req.body.permissions !== undefined) { updates.push('permissions = ?'); params.push(JSON.stringify(req.body.permissions)); }
            if (req.body.rate_limit_per_hour !== undefined) { updates.push('rate_limit_per_hour = ?'); params.push(req.body.rate_limit_per_hour); }
            if (req.body.is_active !== undefined) { updates.push('is_active = ?'); params.push(req.body.is_active ? 1 : 0); }

            if (updates.length === 0) return res.status(400).json({ error: 'Žádné změny' });

            params.push(req.params.uuid, user.company_id);
            await db.run(`UPDATE api_keys SET ${updates.join(', ')}, updated_at = NOW() WHERE uuid = ? AND company_id = ?`, params);

            await auditLog('API_KEY_UPDATED', {
                userId: req.user.userId,
                userEmail: req.user.email,
                resourceType: 'api_key',
                resourceId: req.params.uuid,
                ip: req.ip,
                metadata: req.body
            });

            res.json({ message: 'API klíč aktualizován' });
        } catch (error) {
            logger.error('Update API key error', { error: error.message });
            res.status(500).json({ error: 'Nepodařilo se aktualizovat API klíč' });
        }
    }
);

module.exports = router;
module.exports.authenticateApiKey = authenticateApiKey;
module.exports.requireApiPermission = requireApiPermission;
