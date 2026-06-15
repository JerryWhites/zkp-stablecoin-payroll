// ====================================
// 🔔 Webhooks Route Module
// ====================================
// CRUD for webhook endpoints + delivery engine
// Tier requirement: webhooks feature (Business+)

'use strict';

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { body, param } = require('express-validator');
const { authenticateToken, requireRole, validate, auditLog, logger } = require('../middleware/auth');
const db = require('../db');

// ====================================
// WEBHOOK EVENT TYPES
// ====================================
const WEBHOOK_EVENTS = [
    'payroll.calculated',
    'payroll.locked',
    'payroll.paid',
    'employee.created',
    'employee.updated',
    'employee.terminated',
    'approval.requested',
    'approval.approved',
    'approval.rejected',
    'export.generated',
    'credits.low',
    'credits.topup',
    'schedule.executed',
    'schedule.failed',
];

// ====================================
// DELIVERY ENGINE
// ====================================

/**
 * Sign a webhook payload with HMAC-SHA256
 */
function signPayload(payload, secret) {
    return crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
}

/**
 * Deliver a webhook event to all matching subscribers
 */
async function deliverWebhookEvent(companyId, eventType, data) {
    try {
        const webhooks = await db.getAll(
            'SELECT * FROM webhooks WHERE company_id = ? AND is_active = 1',
            [companyId]
        );

        for (const webhook of webhooks) {
            const events = JSON.parse(webhook.events || '[]');
            if (!events.includes(eventType) && !events.includes('*')) continue;

            const payload = {
                event: eventType,
                timestamp: new Date().toISOString(),
                data,
                webhook_id: webhook.uuid
            };

            const deliveryUuid = crypto.randomUUID();
            await db.run(`
                INSERT INTO webhook_deliveries (uuid, webhook_id, event_type, payload, status)
                VALUES (?, ?, ?, ?, 'pending')
            `, [deliveryUuid, webhook.id, eventType, JSON.stringify(payload)]);

            // Deliver asynchronously
            deliverSingle(webhook, payload, deliveryUuid).catch(err => {
                logger.error('Webhook delivery error', { webhookId: webhook.id, error: err.message });
            });
        }
    } catch (error) {
        logger.error('Webhook event dispatch error', { companyId, eventType, error: error.message });
    }
}

async function deliverSingle(webhook, payload, deliveryUuid, attempt = 1) {
    const signature = signPayload(payload, webhook.secret);
    const startTime = Date.now();

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), webhook.timeout_ms || 10000);

        const response = await fetch(webhook.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Webhook-Signature': `sha256=${signature}`,
                'X-Webhook-ID': webhook.uuid,
                'X-Webhook-Event': payload.event,
                'X-Webhook-Delivery': deliveryUuid,
                'User-Agent': 'CZPayroll-Webhook/1.0'
            },
            body: JSON.stringify(payload),
            signal: controller.signal
        });

        clearTimeout(timeout);
        const durationMs = Date.now() - startTime;
        const responseBody = await response.text().catch(() => '');

        await db.run(`
            UPDATE webhook_deliveries 
            SET status = ?, response_status = ?, response_body = ?, duration_ms = ?, attempt = ?, delivered_at = NOW()
            WHERE uuid = ?
        `, [
            response.ok ? 'delivered' : 'failed',
            response.status,
            responseBody.substring(0, 1000),
            durationMs,
            attempt,
            deliveryUuid
        ]);

        // Update webhook stats
        await db.run(`
            UPDATE webhooks SET last_triggered_at = NOW(), last_status_code = ?,
                   failure_count = CASE WHEN ? THEN 0 ELSE failure_count + 1 END
            WHERE id = ?
        `, [response.status, response.ok, webhook.id]);

        // Retry on failure
        if (!response.ok && attempt < (webhook.retry_count || 3)) {
            const retryDelay = Math.pow(2, attempt) * 1000; // Exponential backoff
            const retrySeconds = Math.floor(retryDelay / 1000);
            // 🔐 FIXED: Parameterized interval instead of string interpolation
            await db.run(`
                UPDATE webhook_deliveries SET status = 'retrying', next_retry_at = NOW() + CAST($1 || ' seconds' AS INTERVAL)
                WHERE uuid = ?
            `, [retrySeconds, deliveryUuid]);

            setTimeout(() => {
                deliverSingle(webhook, payload, deliveryUuid, attempt + 1);
            }, retryDelay);
        }

    } catch (error) {
        const durationMs = Date.now() - startTime;
        await db.run(`
            UPDATE webhook_deliveries 
            SET status = 'failed', error_message = ?, duration_ms = ?, attempt = ?
            WHERE uuid = ?
        `, [error.message, durationMs, attempt, deliveryUuid]);

        // Retry
        if (attempt < (webhook.retry_count || 3)) {
            const retryDelay = Math.pow(2, attempt) * 1000;
            setTimeout(() => {
                deliverSingle(webhook, payload, deliveryUuid, attempt + 1);
            }, retryDelay);
        }

        await db.run('UPDATE webhooks SET failure_count = failure_count + 1 WHERE id = ?', [webhook.id]);
    }
}

// ====================================
// ROUTES
// ====================================

// GET /api/v2/webhooks — List webhooks
router.get('/', authenticateToken, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
        const webhooks = await db.getAll(`
            SELECT id, uuid, name, url, events, is_active, retry_count, timeout_ms,
                   last_triggered_at, last_status_code, failure_count, created_at
            FROM webhooks WHERE company_id = ?
            ORDER BY created_at DESC
        `, [user.company_id]);

        webhooks.forEach(w => { w.events = JSON.parse(w.events || '[]'); });

        res.json({ webhooks, available_events: WEBHOOK_EVENTS });
    } catch (error) {
        logger.error('List webhooks error', { error: error.message });
        res.status(500).json({ error: 'Nepodařilo se načíst webhooky' });
    }
});

// POST /api/v2/webhooks — Create webhook
router.post('/',
    authenticateToken,
    requireRole(['admin', 'employer']),
    body('name').trim().isLength({ min: 1, max: 100 }),
    body('url').isURL({ require_tld: false }).withMessage('Neplatná URL')
        .custom((value) => {
            // 🔐 SSRF protection: block internal/private network URLs
            const url = new URL(value);
            const hostname = url.hostname.toLowerCase();
            const blockedPatterns = [
                /^localhost$/i, /^127\./, /^0\.0\.0\.0$/, /^\[::1\]$/,
                /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
                /^169\.254\./, // AWS/cloud metadata
                /^fc00:/i, /^fe80:/i, /^fd/i, // IPv6 private
                /metadata\.google/i, /metadata\.azure/i,
            ];
            if (blockedPatterns.some(p => p.test(hostname))) {
                throw new Error('URL nesmí cílit na interní/privátní adresy');
            }
            if (['file:', 'ftp:', 'gopher:'].includes(url.protocol)) {
                throw new Error('Povoleny jsou pouze HTTP/HTTPS protokoly');
            }
            return true;
        }),
    body('events').isArray({ min: 1 }).withMessage('Vyberte alespoň 1 událost'),
    body('retry_count').optional().isInt({ min: 0, max: 5 }),
    body('timeout_ms').optional().isInt({ min: 1000, max: 30000 }),
    validate,
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
            const { name, url, events, retry_count = 3, timeout_ms = 10000 } = req.body;

            // Validate events
            const invalidEvents = events.filter(e => e !== '*' && !WEBHOOK_EVENTS.includes(e));
            if (invalidEvents.length) {
                return res.status(400).json({ error: `Neplatné události: ${invalidEvents.join(', ')}` });
            }

            // Limit per company
            const count = await db.getOne('SELECT COUNT(*) as cnt FROM webhooks WHERE company_id = ?', [user.company_id]);
            if (count.cnt >= 20) {
                return res.status(400).json({ error: 'Maximálně 20 webhooků' });
            }

            const uuid = crypto.randomUUID();
            const secret = crypto.randomBytes(32).toString('hex');

            await db.run(`
                INSERT INTO webhooks (uuid, company_id, created_by, name, url, secret, events, retry_count, timeout_ms)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [uuid, user.company_id, req.user.userId, name, url, secret, JSON.stringify(events), retry_count, timeout_ms]);

            await auditLog('WEBHOOK_CREATED', {
                userId: req.user.userId,
                userEmail: req.user.email,
                resourceType: 'webhook',
                resourceId: uuid,
                ip: req.ip,
                metadata: { name, url, events }
            });

            res.status(201).json({
                message: 'Webhook vytvořen',
                webhook: { uuid, name, url, events, secret, retry_count, timeout_ms }
            });
        } catch (error) {
            logger.error('Create webhook error', { error: error.message });
            res.status(500).json({ error: 'Nepodařilo se vytvořit webhook' });
        }
    }
);

// PATCH /api/v2/webhooks/:uuid — Update webhook
router.patch('/:uuid',
    authenticateToken,
    requireRole(['admin', 'employer']),
    param('uuid').isUUID(),
    body('name').optional().trim().isLength({ min: 1, max: 100 }),
    body('url').optional().isURL({ require_tld: false }),
    body('events').optional().isArray({ min: 1 }),
    body('is_active').optional().isBoolean(),
    body('retry_count').optional().isInt({ min: 0, max: 5 }),
    body('timeout_ms').optional().isInt({ min: 1000, max: 30000 }),
    validate,
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
            const webhook = await db.getOne('SELECT * FROM webhooks WHERE uuid = ? AND company_id = ?', [req.params.uuid, user.company_id]);
            if (!webhook) return res.status(404).json({ error: 'Webhook nenalezen' });

            const updates = [];
            const params = [];
            const fields = ['name', 'url', 'retry_count', 'timeout_ms'];
            for (const f of fields) {
                if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
            }
            if (req.body.events) { updates.push('events = ?'); params.push(JSON.stringify(req.body.events)); }
            if (req.body.is_active !== undefined) { updates.push('is_active = ?'); params.push(req.body.is_active ? 1 : 0); }

            if (updates.length === 0) return res.status(400).json({ error: 'Žádné změny' });

            params.push(req.params.uuid, user.company_id);
            await db.run(`UPDATE webhooks SET ${updates.join(', ')}, updated_at = NOW() WHERE uuid = ? AND company_id = ?`, params);

            res.json({ message: 'Webhook aktualizován' });
        } catch (error) {
            logger.error('Update webhook error', { error: error.message });
            res.status(500).json({ error: 'Nepodařilo se aktualizovat webhook' });
        }
    }
);

// DELETE /api/v2/webhooks/:uuid
router.delete('/:uuid',
    authenticateToken,
    requireRole(['admin', 'employer']),
    param('uuid').isUUID(),
    validate,
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
            // Delete deliveries first
            const webhook = await db.getOne('SELECT id FROM webhooks WHERE uuid = ? AND company_id = ?', [req.params.uuid, user.company_id]);
            if (!webhook) return res.status(404).json({ error: 'Webhook nenalezen' });

            await db.run('DELETE FROM webhook_deliveries WHERE webhook_id = ?', [webhook.id]);
            await db.run('DELETE FROM webhooks WHERE id = ?', [webhook.id]);

            await auditLog('WEBHOOK_DELETED', {
                userId: req.user.userId,
                userEmail: req.user.email,
                resourceType: 'webhook',
                resourceId: req.params.uuid,
                ip: req.ip
            });

            res.json({ message: 'Webhook smazán' });
        } catch (error) {
            logger.error('Delete webhook error', { error: error.message });
            res.status(500).json({ error: 'Nepodařilo se smazat webhook' });
        }
    }
);

// POST /api/v2/webhooks/:uuid/test — Send test event
router.post('/:uuid/test',
    authenticateToken,
    requireRole(['admin', 'employer']),
    param('uuid').isUUID(),
    validate,
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
            const webhook = await db.getOne('SELECT * FROM webhooks WHERE uuid = ? AND company_id = ?', [req.params.uuid, user.company_id]);
            if (!webhook) return res.status(404).json({ error: 'Webhook nenalezen' });

            const payload = {
                event: 'test.ping',
                timestamp: new Date().toISOString(),
                data: { message: 'Testovací webhook z CZ Payroll', company_id: user.company_id },
                webhook_id: webhook.uuid
            };

            const deliveryUuid = crypto.randomUUID();
            await db.run(`
                INSERT INTO webhook_deliveries (uuid, webhook_id, event_type, payload, status)
                VALUES (?, ?, 'test.ping', ?, 'pending')
            `, [deliveryUuid, webhook.id, JSON.stringify(payload)]);

            deliverSingle(webhook, payload, deliveryUuid).catch(err => {
                logger.error('Test webhook delivery error', { error: err.message });
            });

            res.json({ message: 'Test odeslán', delivery_id: deliveryUuid });
        } catch (error) {
            logger.error('Test webhook error', { error: error.message });
            res.status(500).json({ error: 'Nepodařilo se odeslat test' });
        }
    }
);

// GET /api/v2/webhooks/:uuid/deliveries — Delivery log
router.get('/:uuid/deliveries',
    authenticateToken,
    requireRole(['admin', 'employer']),
    param('uuid').isUUID(),
    validate,
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
            const webhook = await db.getOne('SELECT id FROM webhooks WHERE uuid = ? AND company_id = ?', [req.params.uuid, user.company_id]);
            if (!webhook) return res.status(404).json({ error: 'Webhook nenalezen' });

            const deliveries = await db.getAll(`
                SELECT uuid, event_type, response_status, attempt, status, duration_ms, error_message, delivered_at, created_at
                FROM webhook_deliveries
                WHERE webhook_id = ?
                ORDER BY created_at DESC
                LIMIT 100
            `, [webhook.id]);

            res.json({ deliveries });
        } catch (error) {
            logger.error('Webhook deliveries error', { error: error.message });
            res.status(500).json({ error: 'Nepodařilo se načíst doručení' });
        }
    }
);

module.exports = router;
module.exports.deliverWebhookEvent = deliverWebhookEvent;
