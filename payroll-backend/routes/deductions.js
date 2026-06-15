// ====================================
// ⚖️ Deductions Routes — Exekuce, Insolvence, Srážky
// ====================================
// Garnishment management per Czech law (Občanský soudní řád §276-302)
// Priority order: alimenty > přednostní exekuce > nepřednostní > insolvence > dobrovolné

'use strict';

const express = require('express');
const { body, param, query } = require('express-validator');
const crypto = require('crypto');
const db = require('../db');
const { authenticateToken, requireRole, validate, auditLog } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

// Helper: get user's company_id
async function getCompanyId(userId) {
    const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [userId]);
    return user?.company_id;
}

// ====================================
// GET /api/v2/deductions — List deductions for company or employee
// ====================================
router.get('/', [
    query('employee_uuid').optional().trim(),
    query('active_only').optional().isIn(['true', 'false']),
    query('type').optional().trim(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        let where = 'd.company_id = $1';
        const params = [companyId];
        let paramIdx = 2;

        if (req.query.employee_uuid) {
            where += ` AND e.uuid = $${paramIdx++}`;
            params.push(req.query.employee_uuid);
        }
        if (req.query.active_only === 'true') {
            where += ' AND d.is_active = 1';
        }
        if (req.query.type) {
            where += ` AND d.type = $${paramIdx++}`;
            params.push(req.query.type);
        }

        const deductions = await db.getAll(`
            SELECT d.*, e.name, e.osobni_cislo, e.uuid as employee_uuid
            FROM deductions d
            JOIN employees e ON d.employee_id = e.id
            WHERE ${where}
            ORDER BY d.priority ASC, d.effective_from ASC
        `, params);

        res.json({ deductions });
    } catch (error) {
        console.error('List deductions error:', error);
        res.status(500).json({ error: 'Chyba při načítání srážek' });
    }
});

// ====================================
// POST /api/v2/deductions — Create deduction
// ====================================
router.post('/', [
    body('employee_uuid').trim().notEmpty().withMessage('UUID zaměstnance je povinné'),
    body('type').isIn([
        'exekuce_prednostni', 'exekuce_neprednostni', 'insolvence',
        'alimenty', 'srazka_zamestnanec', 'odbory', 'sporeni'
    ]).withMessage('Neplatný typ srážky'),
    body('description').trim().notEmpty().withMessage('Popis je povinný'),
    body('creditor_name').optional().trim(),
    body('creditor_account').optional().trim(),
    body('variable_symbol').optional().trim(),
    body('fixed_amount_czk').optional().isInt({ min: 0 }),
    body('percentage').optional().isFloat({ min: 0, max: 100 }),
    body('total_obligation_czk').optional().isInt({ min: 0 }),
    body('case_number').optional().trim(),
    body('effective_from').isISO8601().withMessage('Neplatné datum platnosti od'),
    body('effective_to').optional().isISO8601(),
    body('priority').optional().isInt({ min: 1, max: 999 }),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const employee = await db.getOne(
            'SELECT id FROM employees WHERE uuid = ? AND company_id = ?',
            [req.body.employee_uuid, companyId]
        );
        if (!employee) return res.status(404).json({ error: 'Zaměstnanec nenalezen' });

        const {
            type, description, creditor_name, creditor_account, variable_symbol,
            fixed_amount_czk, percentage, total_obligation_czk, case_number,
            effective_from, effective_to,
        } = req.body;

        // Auto-assign priority based on type (Czech law priority ordering)
        let priority = req.body.priority;
        if (!priority) {
            switch (type) {
                case 'alimenty':               priority = 10; break;
                case 'exekuce_prednostni':     priority = 20; break;
                case 'exekuce_neprednostni':   priority = 30; break;
                case 'insolvence':             priority = 40; break;
                case 'odbory':                 priority = 80; break;
                case 'sporeni':                priority = 85; break;
                case 'srazka_zamestnanec':      priority = 90; break;
                default:                        priority = 100;
            }
        }

        // Validate: must have either fixed_amount or percentage
        if (!fixed_amount_czk && !percentage) {
            return res.status(400).json({ error: 'Musíte zadat buď pevnou částku nebo procento' });
        }

        const uuid = crypto.randomUUID();
        await db.run(`
            INSERT INTO deductions (
                uuid, employee_id, company_id, type, description,
                creditor_name, creditor_account, variable_symbol,
                fixed_amount_czk, percentage, total_obligation_czk,
                case_number, effective_from, effective_to, priority
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            uuid, employee.id, companyId, type, description,
            creditor_name || null, creditor_account || null, variable_symbol || null,
            fixed_amount_czk || null, percentage || null, total_obligation_czk || null,
            case_number || null, effective_from, effective_to || null, priority,
        ]);

        await auditLog('DEDUCTION_CREATED', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'deduction',
            resourceId: uuid,
            ip: req.ip,
            metadata: { type, description, employee_uuid: req.body.employee_uuid },
        });

        res.status(201).json({ success: true, uuid });
    } catch (error) {
        console.error('Create deduction error:', error);
        res.status(500).json({ error: 'Chyba při vytváření srážky' });
    }
});

// ====================================
// PUT /api/v2/deductions/:uuid — Update deduction
// ====================================
router.put('/:uuid', [
    param('uuid').trim().notEmpty(),
    body('description').optional().trim(),
    body('creditor_name').optional().trim(),
    body('creditor_account').optional().trim(),
    body('variable_symbol').optional().trim(),
    body('fixed_amount_czk').optional().isInt({ min: 0 }),
    body('percentage').optional().isFloat({ min: 0, max: 100 }),
    body('total_obligation_czk').optional().isInt({ min: 0 }),
    body('effective_to').optional().isISO8601(),
    body('is_active').optional().isIn([0, 1]),
    body('priority').optional().isInt({ min: 1, max: 999 }),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const deduction = await db.getOne(
            'SELECT * FROM deductions WHERE uuid = ? AND company_id = ?',
            [req.params.uuid, companyId]
        );
        if (!deduction) return res.status(404).json({ error: 'Srážka nenalezena' });

        const updateFields = [
            'description', 'creditor_name', 'creditor_account', 'variable_symbol',
            'fixed_amount_czk', 'percentage', 'total_obligation_czk',
            'effective_to', 'is_active', 'priority'
        ];

        const sets = [];
        const vals = [];
        let paramIdx = 1;

        for (const field of updateFields) {
            if (req.body[field] !== undefined) {
                sets.push(`${field} = $${paramIdx++}`);
                vals.push(req.body[field]);
            }
        }

        if (sets.length > 0) {
            sets.push('updated_at = NOW()');
            vals.push(req.params.uuid);
            await db.run(
                `UPDATE deductions SET ${sets.join(', ')} WHERE uuid = $${paramIdx}`,
                vals
            );
        }

        await auditLog('DEDUCTION_UPDATED', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'deduction',
            resourceId: req.params.uuid,
            ip: req.ip,
            metadata: { fields: Object.keys(req.body) },
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Update deduction error:', error);
        res.status(500).json({ error: 'Chyba při aktualizaci srážky' });
    }
});

// ====================================
// DELETE /api/v2/deductions/:uuid — Deactivate deduction (soft delete)
// ====================================
router.delete('/:uuid', [
    param('uuid').trim().notEmpty(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const deduction = await db.getOne(
            'SELECT * FROM deductions WHERE uuid = ? AND company_id = ?',
            [req.params.uuid, companyId]
        );
        if (!deduction) return res.status(404).json({ error: 'Srážka nenalezena' });

        await db.run(
            `UPDATE deductions SET is_active = 0, effective_to = CURRENT_DATE, updated_at = NOW() WHERE uuid = ?`,
            [req.params.uuid]
        );

        await auditLog('DEDUCTION_DEACTIVATED', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'deduction',
            resourceId: req.params.uuid,
            ip: req.ip,
            metadata: { type: deduction.type },
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Deactivate deduction error:', error);
        res.status(500).json({ error: 'Chyba při deaktivaci srážky' });
    }
});

// ====================================
// GET /api/v2/deductions/history/:deductionUuid — Deduction history
// ====================================
router.get('/history/:deductionUuid', [
    param('deductionUuid').trim().notEmpty(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const deduction = await db.getOne(
            'SELECT * FROM deductions WHERE uuid = ? AND company_id = ?',
            [req.params.deductionUuid, companyId]
        );
        if (!deduction) return res.status(404).json({ error: 'Srážka nenalezena' });

        const history = await db.getAll(`
            SELECT dh.*, pp.year, pp.month
            FROM deduction_history dh
            JOIN payroll_periods pp ON dh.payroll_period_id = pp.id
            WHERE dh.deduction_id = ?
            ORDER BY pp.year DESC, pp.month DESC
        `, [deduction.id]);

        res.json({
            deduction: {
                uuid: deduction.uuid,
                type: deduction.type,
                description: deduction.description,
                total_obligation_czk: deduction.total_obligation_czk,
                total_deducted_czk: deduction.total_deducted_czk,
            },
            history,
        });
    } catch (error) {
        console.error('Deduction history error:', error);
        res.status(500).json({ error: 'Chyba při načítání historie srážek' });
    }
});

// ====================================
// GET /api/v2/deductions/employee-summary/:employeeUuid — Summary for employee
// ====================================
router.get('/employee-summary/:employeeUuid', [
    param('employeeUuid').trim().notEmpty(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const employee = await db.getOne(
            'SELECT id, name, uuid FROM employees WHERE uuid = ? AND company_id = ?',
            [req.params.employeeUuid, companyId]
        );
        if (!employee) return res.status(404).json({ error: 'Zaměstnanec nenalezen' });

        const active = await db.getAll(`
            SELECT type, description, fixed_amount_czk, percentage,
                   total_obligation_czk, total_deducted_czk, priority, effective_from
            FROM deductions
            WHERE employee_id = ? AND is_active = 1
            ORDER BY priority ASC
        `, [employee.id]);

        const totalMonthly = active.reduce((sum, d) => sum + (d.fixed_amount_czk || 0), 0);
        const totalRemaining = active.reduce((sum, d) => {
            if (d.total_obligation_czk) {
                return sum + Math.max(0, d.total_obligation_czk - (d.total_deducted_czk || 0));
            }
            return sum;
        }, 0);

        res.json({
            employee: { uuid: employee.uuid, name: employee.name },
            activeDeductions: active,
            totalMonthlyFixed: totalMonthly,
            totalRemainingObligation: totalRemaining,
        });
    } catch (error) {
        console.error('Employee deduction summary error:', error);
        res.status(500).json({ error: 'Chyba při načítání souhrnu srážek zaměstnance' });
    }
});

module.exports = router;
