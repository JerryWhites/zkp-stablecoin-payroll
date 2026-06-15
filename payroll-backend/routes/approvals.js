// ====================================
// ✅ Multi-sig Approval Workflow Route Module
// ====================================
// Approval policies, requests, and votes
// Tier requirement: multiSig feature (Enterprise)

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
 * Check if a payroll/action needs approval based on company policies
 */
async function requiresApproval(companyId, resourceType, amountCzk = 0) {
    const policy = await db.getOne(
        'SELECT * FROM approval_policies WHERE company_id = ? AND resource_type = ? AND is_active = 1',
        [companyId, resourceType]
    );
    if (!policy) return { required: false };
    
    // Auto-approve below threshold
    if (policy.auto_approve_below_czk && amountCzk < policy.auto_approve_below_czk) {
        return { required: false, reason: 'Pod limitem pro automatické schválení' };
    }
    
    return { required: true, policy };
}

/**
 * Create an approval request
 */
async function createApprovalRequest(policyId, companyId, requestedBy, resourceType, resourceId, title, description, amountCzk) {
    const uuid = crypto.randomUUID();
    const policy = await db.getOne('SELECT * FROM approval_policies WHERE id = ?', [policyId]);
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString(); // 7 days

    await db.run(`
        INSERT INTO approval_requests (uuid, policy_id, company_id, requested_by, resource_type, resource_id, title, description, amount_czk, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [uuid, policyId, companyId, requestedBy, resourceType, resourceId, title, description, amountCzk, expiresAt]);

    return { uuid, required_approvals: policy.required_approvals, expires_at: expiresAt };
}

// ====================================
// POLICY ROUTES
// ====================================

// GET /api/v2/approvals/policies — List policies
router.get('/policies', authenticateToken, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
        const policies = await db.getAll(
            'SELECT * FROM approval_policies WHERE company_id = ? ORDER BY created_at DESC',
            [user.company_id]
        );
        policies.forEach(p => { p.approver_user_ids = JSON.parse(p.approver_user_ids || '[]'); });
        res.json({ policies });
    } catch (error) {
        logger.error('List policies error', { error: error.message });
        res.status(500).json({ error: 'Nepodařilo se načíst pravidla' });
    }
});

// POST /api/v2/approvals/policies — Create policy
router.post('/policies',
    authenticateToken,
    requireRole(['admin']),
    body('name').trim().isLength({ min: 1, max: 200 }),
    body('resource_type').isIn(['payroll', 'employee_add', 'employee_edit', 'expense', 'settings']),
    body('required_approvals').isInt({ min: 1, max: 10 }),
    body('approver_user_ids').isArray({ min: 1 }).withMessage('Zadejte alespoň 1 schvalovatele'),
    body('auto_approve_below_czk').optional().isInt({ min: 0 }),
    validate,
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
            const { name, resource_type, required_approvals, approver_user_ids, auto_approve_below_czk } = req.body;

            // Verify approvers belong to same company
            for (const approverId of approver_user_ids) {
                const approver = await db.getOne('SELECT company_id FROM users WHERE id = ?', [approverId]);
                if (!approver || approver.company_id !== user.company_id) {
                    return res.status(400).json({ error: `Schvalovatel ${approverId} nepatří do vaší firmy` });
                }
            }

            if (required_approvals > approver_user_ids.length) {
                return res.status(400).json({ error: 'Počet požadovaných schválení nemůže přesáhnout počet schvalovatelů' });
            }

            const uuid = crypto.randomUUID();
            await db.run(`
                INSERT INTO approval_policies (uuid, company_id, name, resource_type, required_approvals, approver_user_ids, auto_approve_below_czk)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [uuid, user.company_id, name, resource_type, required_approvals, JSON.stringify(approver_user_ids), auto_approve_below_czk || null]);

            await auditLog('APPROVAL_POLICY_CREATED', {
                userId: req.user.userId,
                userEmail: req.user.email,
                resourceType: 'approval_policy',
                resourceId: uuid,
                ip: req.ip,
                metadata: { name, resource_type, required_approvals }
            });

            const policy = await db.getOne('SELECT * FROM approval_policies WHERE uuid = ?', [uuid]);
            policy.approver_user_ids = JSON.parse(policy.approver_user_ids);
            res.status(201).json({ policy });
        } catch (error) {
            logger.error('Create policy error', { error: error.message });
            res.status(500).json({ error: 'Nepodařilo se vytvořit pravidlo' });
        }
    }
);

// PATCH /api/v2/approvals/policies/:uuid
router.patch('/policies/:uuid',
    authenticateToken,
    requireRole(['admin']),
    param('uuid').isUUID(),
    body('name').optional().trim().isLength({ min: 1, max: 200 }),
    body('required_approvals').optional().isInt({ min: 1, max: 10 }),
    body('approver_user_ids').optional().isArray({ min: 1 }),
    body('auto_approve_below_czk').optional().isInt({ min: 0 }),
    body('is_active').optional().isBoolean(),
    validate,
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
            const policy = await db.getOne('SELECT * FROM approval_policies WHERE uuid = ? AND company_id = ?', [req.params.uuid, user.company_id]);
            if (!policy) return res.status(404).json({ error: 'Pravidlo nenalezeno' });

            const updates = [];
            const params = [];
            if (req.body.name !== undefined) { updates.push('name = ?'); params.push(req.body.name); }
            if (req.body.required_approvals !== undefined) { updates.push('required_approvals = ?'); params.push(req.body.required_approvals); }
            if (req.body.approver_user_ids !== undefined) { updates.push('approver_user_ids = ?'); params.push(JSON.stringify(req.body.approver_user_ids)); }
            if (req.body.auto_approve_below_czk !== undefined) { updates.push('auto_approve_below_czk = ?'); params.push(req.body.auto_approve_below_czk); }
            if (req.body.is_active !== undefined) { updates.push('is_active = ?'); params.push(req.body.is_active ? 1 : 0); }

            if (updates.length === 0) return res.status(400).json({ error: 'Žádné změny' });

            params.push(req.params.uuid, user.company_id);
            await db.run(`UPDATE approval_policies SET ${updates.join(', ')}, updated_at = NOW() WHERE uuid = ? AND company_id = ?`, params);

            res.json({ message: 'Pravidlo aktualizováno' });
        } catch (error) {
            logger.error('Update policy error', { error: error.message });
            res.status(500).json({ error: 'Nepodařilo se aktualizovat pravidlo' });
        }
    }
);

// DELETE /api/v2/approvals/policies/:uuid
router.delete('/policies/:uuid',
    authenticateToken,
    requireRole(['admin']),
    param('uuid').isUUID(),
    validate,
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
            const result = await db.run('DELETE FROM approval_policies WHERE uuid = ? AND company_id = ?', [req.params.uuid, user.company_id]);
            if (result.rowCount === 0) return res.status(404).json({ error: 'Pravidlo nenalezeno' });
            res.json({ message: 'Pravidlo smazáno' });
        } catch (error) {
            logger.error('Delete policy error', { error: error.message });
            res.status(500).json({ error: 'Nepodařilo se smazat pravidlo' });
        }
    }
);

// ====================================
// APPROVAL REQUEST ROUTES
// ====================================

// GET /api/v2/approvals/requests — Pending requests for current user
router.get('/requests', authenticateToken, async (req, res) => {
    try {
        const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
        const statusFilter = req.query.status || 'pending';

        const requests = await db.getAll(`
            SELECT ar.*, u.email as requested_by_email,
                   ap.name as policy_name, ap.required_approvals,
                   (SELECT COUNT(*) FROM approval_votes WHERE request_id = ar.id AND vote = 'approve') as approve_count,
                   (SELECT COUNT(*) FROM approval_votes WHERE request_id = ar.id AND vote = 'reject') as reject_count
            FROM approval_requests ar
            JOIN approval_policies ap ON ar.policy_id = ap.id
            JOIN users u ON ar.requested_by = u.id
            WHERE ar.company_id = ? AND ar.status = ?
            ORDER BY ar.created_at DESC
        `, [user.company_id, statusFilter]);

        // Check which ones the current user can vote on
        for (const req_item of requests) {
            const myVote = await db.getOne('SELECT vote FROM approval_votes WHERE request_id = ? AND user_id = ?', [req_item.id, req.user.userId]);
            req_item.my_vote = myVote?.vote || null;
            
            const policy = await db.getOne('SELECT approver_user_ids FROM approval_policies WHERE id = ?', [req_item.policy_id]);
            const approverIds = JSON.parse(policy?.approver_user_ids || '[]');
            req_item.can_vote = approverIds.includes(req.user.userId) && !myVote;
        }

        res.json({ requests });
    } catch (error) {
        logger.error('List requests error', { error: error.message });
        res.status(500).json({ error: 'Nepodařilo se načíst žádosti' });
    }
});

// POST /api/v2/approvals/requests — Create approval request
router.post('/requests',
    authenticateToken,
    requireRole(['admin', 'employer']),
    body('resource_type').isIn(['payroll', 'employee_add', 'employee_edit', 'expense', 'settings']),
    body('resource_id').isString(),
    body('title').trim().isLength({ min: 1, max: 300 }),
    body('description').optional().isString(),
    body('amount_czk').optional().isFloat({ min: 0 }),
    validate,
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
            const { resource_type, resource_id, title, description, amount_czk } = req.body;

            // Find matching policy
            const policy = await db.getOne(
                'SELECT * FROM approval_policies WHERE company_id = ? AND resource_type = ? AND is_active = 1',
                [user.company_id, resource_type]
            );
            if (!policy) {
                return res.status(400).json({ error: 'Žádné pravidlo pro tento typ zdroje' });
            }

            // Check auto-approve 
            if (policy.auto_approve_below_czk && amount_czk && amount_czk < policy.auto_approve_below_czk) {
                return res.json({ auto_approved: true, message: 'Automaticky schváleno (pod limitem)' });
            }

            const result = await createApprovalRequest(
                policy.id, user.company_id, req.user.userId, resource_type, resource_id, title, description, amount_czk
            );

            await auditLog('APPROVAL_REQUESTED', {
                userId: req.user.userId,
                userEmail: req.user.email,
                resourceType: 'approval_request',
                resourceId: result.uuid,
                ip: req.ip,
                metadata: { resource_type, resource_id, title, amount_czk }
            });

            res.status(201).json({ request: result });
        } catch (error) {
            logger.error('Create request error', { error: error.message });
            res.status(500).json({ error: 'Nepodařilo se vytvořit žádost' });
        }
    }
);

// POST /api/v2/approvals/requests/:uuid/vote — Vote on a request
router.post('/requests/:uuid/vote',
    authenticateToken,
    param('uuid').isUUID(),
    body('vote').isIn(['approve', 'reject']),
    body('comment').optional().isString().isLength({ max: 500 }),
    validate,
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
            const request = await db.getOne('SELECT * FROM approval_requests WHERE uuid = ? AND company_id = ?', [req.params.uuid, user.company_id]);
            if (!request) return res.status(404).json({ error: 'Žádost nenalezena' });

            if (request.status !== 'pending') {
                return res.status(400).json({ error: `Žádost je již ${request.status}` });
            }

            // Check if user is an approver
            const policy = await db.getOne('SELECT * FROM approval_policies WHERE id = ?', [request.policy_id]);
            const approverIds = JSON.parse(policy.approver_user_ids || '[]');
            if (!approverIds.includes(req.user.userId)) {
                return res.status(403).json({ error: 'Nemáte oprávnění schvalovat' });
            }

            // Check duplicate vote
            const existingVote = await db.getOne('SELECT id FROM approval_votes WHERE request_id = ? AND user_id = ?', [request.id, req.user.userId]);
            if (existingVote) {
                return res.status(400).json({ error: 'Již jste hlasoval/a' });
            }

            const { vote, comment } = req.body;

            await db.run(`
                INSERT INTO approval_votes (request_id, user_id, vote, comment)
                VALUES (?, ?, ?, ?)
            `, [request.id, req.user.userId, vote, comment]);

            // Update counts
            const voteField = vote === 'approve' ? 'approved_count' : 'rejected_count';
            await db.run(`UPDATE approval_requests SET ${voteField} = ${voteField} + 1 WHERE id = ?`, [request.id]);

            // Check if threshold reached
            const updatedRequest = await db.getOne('SELECT * FROM approval_requests WHERE id = ?', [request.id]);

            let newStatus = 'pending';
            if (updatedRequest.approved_count >= policy.required_approvals) {
                newStatus = 'approved';
            } else if (updatedRequest.rejected_count > (approverIds.length - policy.required_approvals)) {
                // More rejections than can still reach approval
                newStatus = 'rejected';
            }

            if (newStatus !== 'pending') {
                await db.run("UPDATE approval_requests SET status = ?, resolved_at = NOW() WHERE id = ?", [newStatus, request.id]);
            }

            await auditLog(`APPROVAL_${vote.toUpperCase()}D`, {
                userId: req.user.userId,
                userEmail: req.user.email,
                resourceType: 'approval_request',
                resourceId: req.params.uuid,
                ip: req.ip,
                metadata: { vote, comment, new_status: newStatus }
            });

            res.json({
                message: vote === 'approve' ? 'Schváleno' : 'Zamítnuto',
                status: newStatus,
                approved_count: updatedRequest.approved_count,
                rejected_count: updatedRequest.rejected_count,
                required: policy.required_approvals
            });
        } catch (error) {
            logger.error('Vote error', { error: error.message });
            res.status(500).json({ error: 'Nepodařilo se hlasovat' });
        }
    }
);

// POST /api/v2/approvals/requests/:uuid/cancel — Cancel a request
router.post('/requests/:uuid/cancel',
    authenticateToken,
    param('uuid').isUUID(),
    validate,
    async (req, res) => {
        try {
            // 🔐 FIXED: Added company_id check to prevent cross-tenant data access
            const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
            const request = await db.getOne('SELECT * FROM approval_requests WHERE uuid = ? AND company_id = ?', [req.params.uuid, user.company_id]);
            if (!request) return res.status(404).json({ error: 'Žádost nenalezena' });
            if (request.requested_by !== req.user.userId) return res.status(403).json({ error: 'Pouze žadatel může zrušit' });
            if (request.status !== 'pending') return res.status(400).json({ error: 'Nelze zrušit — není ve stavu čeká' });

            await db.run("UPDATE approval_requests SET status = 'cancelled', resolved_at = NOW() WHERE id = ?", [request.id]);
            res.json({ message: 'Žádost zrušena' });
        } catch (error) {
            logger.error('Cancel request error', { error: error.message });
            res.status(500).json({ error: 'Nepodařilo se zrušit žádost' });
        }
    }
);

module.exports = router;
module.exports.requiresApproval = requiresApproval;
module.exports.createApprovalRequest = createApprovalRequest;
