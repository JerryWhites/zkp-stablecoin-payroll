// ====================================
// 🎨 White-label Configuration Route Module
// ====================================
// Custom branding, colors, domain, emails
// Tier requirement: whiteLabel feature (Enterprise)

'use strict';

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { authenticateToken, requireRole, validate, auditLog, logger } = require('../middleware/auth');
const db = require('../db');

// ====================================
// PUBLIC — Get branding for a company (used by frontend on load)
// ====================================

// GET /api/v2/whitelabel/config — Get current company branding
router.get('/config', authenticateToken, async (req, res) => {
    try {
        const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
        let config = await db.getOne('SELECT * FROM whitelabel_config WHERE company_id = ?', [user.company_id]);

        if (!config) {
            // Return defaults
            config = {
                brand_name: 'CZ Payroll',
                logo_url: null,
                favicon_url: null,
                primary_color: '#dc2626',
                secondary_color: '#1e293b',
                accent_color: '#f59e0b',
                font_family: 'Inter',
                custom_domain: null,
                footer_text: null,
                support_email: null,
                support_url: null,
                hide_powered_by: 0,
                custom_login_bg: null,
            };
        }

        res.json({ config });
    } catch (error) {
        logger.error('Get whitelabel config error', { error: error.message });
        res.status(500).json({ error: 'Nepodařilo se načíst konfiguraci' });
    }
});

// GET /api/v2/whitelabel/by-domain/:domain — Public endpoint for branding by domain
router.get('/by-domain/:domain', async (req, res) => {
    try {
        const config = await db.getOne(
            'SELECT brand_name, logo_url, favicon_url, primary_color, secondary_color, accent_color, font_family, footer_text, custom_login_bg FROM whitelabel_config WHERE custom_domain = ?',
            [req.params.domain]
        );
        if (!config) return res.status(404).json({ error: 'Konfigurace nenalezena' });
        res.json({ config });
    } catch (error) {
        logger.error('Get whitelabel by domain error', { error: error.message });
        res.status(500).json({ error: 'Chyba' });
    }
});

// ====================================
// ADMIN — Update branding
// ====================================

// PUT /api/v2/whitelabel/config — Update branding
router.put('/config',
    authenticateToken,
    requireRole(['admin']),
    body('brand_name').optional().trim().isLength({ max: 100 }),
    body('logo_url').optional({ nullable: true }).isURL({ require_tld: false }),
    body('favicon_url').optional({ nullable: true }).isURL({ require_tld: false }),
    body('primary_color').optional().matches(/^#[0-9a-fA-F]{6}$/),
    body('secondary_color').optional().matches(/^#[0-9a-fA-F]{6}$/),
    body('accent_color').optional().matches(/^#[0-9a-fA-F]{6}$/),
    body('font_family').optional().trim().isLength({ max: 50 }),
    body('custom_domain').optional({ nullable: true }).trim().isLength({ max: 200 }),
    body('custom_css').optional({ nullable: true }).isLength({ max: 10000 })
        .customSanitizer((value) => {
            if (!value) return value;
            // 🔐 FIXED: Strict CSS allowlist sanitizer — immune to CSS escape sequence bypasses
            // Only allows safe property:value pairs, blocks everything else
            const ALLOWED_PROPERTIES = new Set([
                'color', 'background-color', 'background', 'font-family', 'font-size',
                'font-weight', 'font-style', 'text-align', 'text-decoration', 'text-transform',
                'line-height', 'letter-spacing', 'border', 'border-color', 'border-width',
                'border-style', 'border-radius', 'margin', 'margin-top', 'margin-bottom',
                'margin-left', 'margin-right', 'padding', 'padding-top', 'padding-bottom',
                'padding-left', 'padding-right', 'width', 'max-width', 'min-width',
                'height', 'max-height', 'min-height', 'display', 'opacity',
                'box-shadow', 'text-shadow', 'overflow', 'cursor', 'transition',
                'transform', 'visibility', 'white-space', 'word-wrap', 'word-break'
            ]);
            // Only allow safe CSS values: hex colors, names, numbers, units, quotes for font names
            const SAFE_VALUE = /^[a-zA-Z0-9\s,#%.()\-_"']+$/;
            
            // Strip all CSS escape sequences first (backslash-hex, backslash-char)
            const stripped = value.replace(/\\[0-9a-fA-F]{1,6}\s?/g, '').replace(/\\./g, '');
            
            // Parse rule-by-rule (selector { declarations })
            const output = [];
            // Match CSS rules: selector { ... }
            const ruleRegex = /([^{}]+)\{([^{}]*)\}/g;
            let match;
            while ((match = ruleRegex.exec(stripped)) !== null) {
                const selector = match[1].trim();
                const declarations = match[2].trim();
                
                // Only allow simple selectors (class, id, element, pseudo)
                if (!/^[a-zA-Z0-9\s.#:,\->_\[\]=~|^$*"']+$/.test(selector)) continue;
                // Block @-rules entirely
                if (selector.startsWith('@')) continue;
                
                const safeParts = [];
                const props = declarations.split(';').filter(Boolean);
                for (const prop of props) {
                    const colonIdx = prop.indexOf(':');
                    if (colonIdx === -1) continue;
                    const name = prop.substring(0, colonIdx).trim().toLowerCase();
                    const val = prop.substring(colonIdx + 1).trim();
                    
                    if (!ALLOWED_PROPERTIES.has(name)) continue;
                    if (!SAFE_VALUE.test(val)) continue;
                    // Extra: block url/expression/javascript even if somehow present
                    if (/url|import|expression|javascript|binding|behavior/i.test(val)) continue;
                    
                    safeParts.push(`${name}: ${val}`);
                }
                
                if (safeParts.length > 0) {
                    output.push(`${selector} { ${safeParts.join('; ')}; }`);
                }
            }
            return output.join('\n');
        }),
    body('email_from_name').optional({ nullable: true }).trim().isLength({ max: 100 }),
    body('email_from_address').optional({ nullable: true }).isEmail(),
    body('footer_text').optional({ nullable: true }).isLength({ max: 500 }),
    body('support_email').optional({ nullable: true }).isEmail(),
    body('support_url').optional({ nullable: true }).isURL({ require_tld: false }),
    body('hide_powered_by').optional().isBoolean(),
    body('custom_login_bg').optional({ nullable: true }).isURL({ require_tld: false }),
    validate,
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
            const existing = await db.getOne('SELECT id FROM whitelabel_config WHERE company_id = ?', [user.company_id]);

            const fields = [
                'brand_name', 'logo_url', 'favicon_url',
                'primary_color', 'secondary_color', 'accent_color', 'font_family',
                'custom_domain', 'custom_css',
                'email_from_name', 'email_from_address',
                'footer_text', 'support_email', 'support_url',
                'hide_powered_by', 'custom_login_bg'
            ];

            if (existing) {
                const updates = [];
                const params = [];
                for (const f of fields) {
                    if (req.body[f] !== undefined) {
                        updates.push(`${f} = ?`);
                        params.push(f === 'hide_powered_by' ? (req.body[f] ? 1 : 0) : req.body[f]);
                    }
                }
                if (updates.length === 0) return res.status(400).json({ error: 'Žádné změny' });

                params.push(user.company_id);
                await db.run(`UPDATE whitelabel_config SET ${updates.join(', ')}, updated_at = NOW() WHERE company_id = ?`, params);
            } else {
                // Insert new config
                const insertFields = ['company_id'];
                const insertPlaceholders = ['?'];
                const insertParams = [user.company_id];
                for (const f of fields) {
                    if (req.body[f] !== undefined) {
                        insertFields.push(f);
                        insertPlaceholders.push('?');
                        insertParams.push(f === 'hide_powered_by' ? (req.body[f] ? 1 : 0) : req.body[f]);
                    }
                }
                await db.run(
                    `INSERT INTO whitelabel_config (${insertFields.join(', ')}) VALUES (${insertPlaceholders.join(', ')})`,
                    insertParams
                );
            }

            await auditLog('WHITELABEL_UPDATED', {
                userId: req.user.userId,
                userEmail: req.user.email,
                resourceType: 'whitelabel',
                resourceId: user.company_id,
                ip: req.ip,
                metadata: Object.keys(req.body)
            });

            const config = await db.getOne('SELECT * FROM whitelabel_config WHERE company_id = ?', [user.company_id]);
            res.json({ message: 'Branding aktualizován', config });
        } catch (error) {
            logger.error('Update whitelabel error', { error: error.message });
            res.status(500).json({ error: 'Nepodařilo se uložit branding' });
        }
    }
);

// DELETE /api/v2/whitelabel/config — Reset to defaults
router.delete('/config',
    authenticateToken,
    requireRole(['admin']),
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
            await db.run('DELETE FROM whitelabel_config WHERE company_id = ?', [user.company_id]);
            res.json({ message: 'Branding resetován na výchozí hodnoty' });
        } catch (error) {
            logger.error('Reset whitelabel error', { error: error.message });
            res.status(500).json({ error: 'Nepodařilo se resetovat branding' });
        }
    }
);

module.exports = router;
