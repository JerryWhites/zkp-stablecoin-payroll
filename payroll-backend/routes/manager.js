// ====================================
// 👤 Dedicated Manager Route Module
// ====================================
// Manager assignment + messaging system
// Tier requirement: dedicatedSupport feature (Enterprise)

'use strict';

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { body, param, query } = require('express-validator');
const { authenticateToken, requireRole, validate, auditLog, logger } = require('../middleware/auth');
const db = require('../db');

// ====================================
// ROUTES
// ====================================

// GET /api/v2/manager — Get assigned manager for company
router.get('/', authenticateToken, async (req, res) => {
    try {
        const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
        const manager = await db.getOne(
            'SELECT * FROM dedicated_managers WHERE company_id = ? AND is_active = 1',
            [user.company_id]
        );

        if (!manager) {
            return res.json({ manager: null, message: 'Žádný přiřazený správce' });
        }

        manager.specializations = JSON.parse(manager.specializations || '[]');

        // Unread messages count
        const unread = await db.getOne(
            "SELECT COUNT(*) as cnt FROM manager_messages WHERE company_id = ? AND direction = 'outbound' AND is_read = 0",
            [user.company_id]
        );
        manager.unread_messages = unread?.cnt || 0;

        res.json({ manager });
    } catch (error) {
        logger.error('Get manager error', { error: error.message });
        res.status(500).json({ error: 'Nepodařilo se načíst správce' });
    }
});

// POST /api/v2/manager/assign — Assign manager (admin only / system)
router.post('/assign',
    authenticateToken,
    requireRole(['admin']),
    body('manager_name').trim().isLength({ min: 1, max: 200 }),
    body('manager_email').isEmail(),
    body('manager_phone').optional().trim().isLength({ max: 20 }),
    body('manager_photo_url').optional().isURL({ require_tld: false }),
    body('availability').optional().isIn(['business_hours', 'extended', '24_7']),
    body('specializations').optional().isArray(),
    // 🔐 REMOVED: body('company_id') — cross-company assignment vulnerability
    validate,
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
            // 🔐 FIXED: Always use authenticated user's company — never accept company_id from request body
            const targetCompany = user.company_id;
            const { manager_name, manager_email, manager_phone, manager_photo_url, availability = 'business_hours', specializations = [] } = req.body;

            // Deactivate current manager
            await db.run('UPDATE dedicated_managers SET is_active = 0 WHERE company_id = ? AND is_active = 1', [targetCompany]);

            const uuid = crypto.randomUUID();
            await db.run(`
                INSERT INTO dedicated_managers (uuid, company_id, manager_name, manager_email, manager_phone, manager_photo_url, availability, specializations)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [uuid, targetCompany, manager_name, manager_email, manager_phone, manager_photo_url, availability, JSON.stringify(specializations)]);

            await auditLog('MANAGER_ASSIGNED', {
                userId: req.user.userId,
                userEmail: req.user.email,
                resourceType: 'dedicated_manager',
                resourceId: uuid,
                ip: req.ip,
                metadata: { manager_name, manager_email, targetCompany }
            });

            const manager = await db.getOne('SELECT * FROM dedicated_managers WHERE uuid = ?', [uuid]);
            manager.specializations = JSON.parse(manager.specializations);
            res.status(201).json({ message: 'Správce přiřazen', manager });
        } catch (error) {
            logger.error('Assign manager error', { error: error.message });
            res.status(500).json({ error: 'Nepodařilo se přiřadit správce' });
        }
    }
);

// ====================================
// MESSAGING
// ====================================

// GET /api/v2/manager/messages — Get messages
router.get('/messages', authenticateToken, async (req, res) => {
    try {
        const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        const offset = (page - 1) * limit;

        const messages = await db.getAll(`
            SELECT mm.*, u.email as user_email,
                   dm.manager_name
            FROM manager_messages mm
            JOIN dedicated_managers dm ON mm.manager_id = dm.id
            LEFT JOIN users u ON mm.user_id = u.id
            WHERE mm.company_id = ?
            ORDER BY mm.created_at DESC
            LIMIT $2 OFFSET $3
        `, [user.company_id, limit, offset]);

        const total = await db.getOne('SELECT COUNT(*) as cnt FROM manager_messages WHERE company_id = ?', [user.company_id]);

        // Mark outbound as read
        await db.run("UPDATE manager_messages SET is_read = 1, read_at = NOW() WHERE company_id = ? AND direction = 'outbound' AND is_read = 0", [user.company_id]);

        res.json({
            messages,
            pagination: { page, limit, total: total?.cnt || 0, pages: Math.ceil((total?.cnt || 0) / limit) }
        });
    } catch (error) {
        logger.error('Get messages error', { error: error.message });
        res.status(500).json({ error: 'Nepodařilo se načíst zprávy' });
    }
});

// POST /api/v2/manager/messages — Send message to manager
router.post('/messages',
    authenticateToken,
    body('subject').optional().trim().isLength({ max: 200 }),
    body('message').trim().isLength({ min: 1, max: 5000 }).withMessage('Zpráva je povinná'),
    validate,
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
            const manager = await db.getOne('SELECT * FROM dedicated_managers WHERE company_id = ? AND is_active = 1', [user.company_id]);
            if (!manager) return res.status(404).json({ error: 'Nemáte přiřazeného správce' });

            const uuid = crypto.randomUUID();
            await db.run(`
                INSERT INTO manager_messages (uuid, manager_id, company_id, user_id, direction, subject, message)
                VALUES (?, ?, ?, ?, 'inbound', ?, ?)
            `, [uuid, manager.id, user.company_id, req.user.userId, req.body.subject, req.body.message]);

            await auditLog('MANAGER_MESSAGE_SENT', {
                userId: req.user.userId,
                userEmail: req.user.email,
                resourceType: 'manager_message',
                resourceId: uuid,
                ip: req.ip,
                metadata: { subject: req.body.subject }
            });

            res.status(201).json({ message: 'Zpráva odeslána', uuid });
        } catch (error) {
            logger.error('Send message error', { error: error.message });
            res.status(500).json({ error: 'Nepodařilo se odeslat zprávu' });
        }
    }
);

// POST /api/v2/manager/messages/reply — Manager replies (admin impersonation)
// 🔐 FIXED: Scoped to admin's own company, no longer accepts arbitrary company_id
router.post('/messages/reply',
    authenticateToken,
    requireRole(['admin']),
    body('subject').optional().trim().isLength({ max: 200 }),
    body('message').trim().isLength({ min: 1, max: 5000 }),
    validate,
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
            const { subject, message } = req.body;
            const manager = await db.getOne('SELECT * FROM dedicated_managers WHERE company_id = ? AND is_active = 1', [user.company_id]);
            if (!manager) return res.status(404).json({ error: 'Správce nenalezen pro firmu' });

            const uuid = crypto.randomUUID();
            await db.run(`
                INSERT INTO manager_messages (uuid, manager_id, company_id, user_id, direction, subject, message)
                VALUES (?, ?, ?, ?, 'outbound', ?, ?)
            `, [uuid, manager.id, user.company_id, null, subject, message]);

            res.status(201).json({ message: 'Odpověď odeslána', uuid });
        } catch (error) {
            logger.error('Reply error', { error: error.message });
            res.status(500).json({ error: 'Nepodařilo se odpovědět' });
        }
    }
);

module.exports = router;
