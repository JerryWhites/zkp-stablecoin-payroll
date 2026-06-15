// ====================================
// 💰 Commission Routes
// ====================================
// Commission schemes, employee commission assignments,
// revenue/unit tracking, commission calculation.

'use strict';

const express = require('express');
const { body, param, query } = require('express-validator');
const crypto = require('crypto');
const db = require('../db');
const { authenticateToken, requireRole, validate, auditLog } = require('../middleware/auth');
const { calculateCommission } = require('../services/payroll-engine');

const router = express.Router();
router.use(authenticateToken);

async function getCompanyId(userId) {
    const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [userId]);
    return user?.company_id;
}

// ====================================
// COMMISSION SCHEMES
// ====================================

// GET /api/v2/commissions/schemes — List commission schemes
router.get('/schemes', async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const schemes = await db.getAll(
            'SELECT * FROM commission_schemes WHERE company_id = ? ORDER BY name',
            [companyId]
        );

        // Parse tiers JSON
        for (const s of schemes) {
            try { s.tiers = JSON.parse(s.tiers || '[]'); } catch { s.tiers = []; }
        }

        res.json({ schemes });
    } catch (error) {
        console.error('List commission schemes error:', error);
        res.status(500).json({ error: 'Chyba při načítání provizních schémat' });
    }
});

// POST /api/v2/commissions/schemes — Create commission scheme
router.post('/schemes', [
    body('name').trim().notEmpty().withMessage('Název je povinný'),
    body('type').isIn(['flat_rate', 'tiered', 'threshold', 'flat_per_unit', 'mixed']),
    body('base_rate_pct').optional().isFloat({ min: 0, max: 100 }),
    body('base_amount_czk').optional().isInt({ min: 0 }),
    body('tiers').optional().isArray(),
    body('cap_monthly_czk').optional().isInt({ min: 0 }),
    body('cap_annual_czk').optional().isInt({ min: 0 }),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const uuid = crypto.randomUUID();
        const {
            name, description, type,
            base_rate_pct, base_amount_czk,
            tiers = [], cap_monthly_czk, cap_annual_czk,
            effective_from, effective_to,
        } = req.body;

        await db.run(`
            INSERT INTO commission_schemes (
                uuid, company_id, name, description, type,
                base_rate_pct, base_amount_czk, tiers,
                cap_monthly_czk, cap_annual_czk,
                effective_from, effective_to
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            uuid, companyId, name, description || null, type,
            base_rate_pct || null, base_amount_czk || null,
            JSON.stringify(tiers),
            cap_monthly_czk || null, cap_annual_czk || null,
            effective_from || null, effective_to || null,
        ]);

        await auditLog('COMMISSION_SCHEME_CREATED', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'commission_scheme',
            resourceId: uuid,
            ip: req.ip,
            metadata: { name, type },
        });

        const scheme = await db.getOne('SELECT * FROM commission_schemes WHERE uuid = ?', [uuid]);
        try { scheme.tiers = JSON.parse(scheme.tiers || '[]'); } catch { scheme.tiers = []; }
        res.status(201).json({ success: true, scheme });
    } catch (error) {
        console.error('Create commission scheme error:', error);
        res.status(500).json({ error: 'Chyba při vytváření provizního schématu' });
    }
});

// ====================================
// EMPLOYEE COMMISSIONS
// ====================================

// GET /api/v2/commissions — List commissions (filterable by period, employee, status)
router.get('/', [
    query('year').optional().isInt({ min: 2020 }),
    query('month').optional().isInt({ min: 1, max: 12 }),
    query('employee_uuid').optional().trim(),
    query('status').optional().isIn(['draft', 'calculated', 'approved', 'paid']),
], validate, async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        let sql = `SELECT ec.*, cs.name as scheme_name, cs.type as scheme_type,
                          e.name as employee_name, e.uuid as employee_uuid
                   FROM employee_commissions ec
                   JOIN commission_schemes cs ON ec.commission_scheme_id = cs.id
                   JOIN employees e ON ec.employee_id = e.id
                   WHERE ec.company_id = ?`;
        const params = [companyId];

        if (req.query.year) {
            sql += ` AND ec.period_year = ?`;
            params.push(parseInt(req.query.year));
        }
        if (req.query.month) {
            sql += ` AND ec.period_month = ?`;
            params.push(parseInt(req.query.month));
        }
        if (req.query.employee_uuid) {
            sql += ` AND e.uuid = ?`;
            params.push(req.query.employee_uuid);
        }
        if (req.query.status) {
            sql += ` AND ec.status = ?`;
            params.push(req.query.status);
        }

        sql += ` ORDER BY ec.period_year DESC, ec.period_month DESC, e.name`;
        const commissions = await db.getAll(sql, params);
        res.json({ commissions });
    } catch (error) {
        console.error('List commissions error:', error);
        res.status(500).json({ error: 'Chyba při načítání provizí' });
    }
});

// POST /api/v2/commissions — Create/calculate commission for employee
router.post('/', [
    body('employee_uuid').trim().notEmpty(),
    body('scheme_uuid').trim().notEmpty(),
    body('period_year').isInt({ min: 2020 }),
    body('period_month').isInt({ min: 1, max: 12 }),
    body('revenue_czk').optional().isInt({ min: 0 }),
    body('units_sold').optional().isInt({ min: 0 }),
    body('adjustment_czk').optional().isInt(),
    body('notes').optional().trim(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const employee = await db.getOne(
            'SELECT id, name FROM employees WHERE uuid = ? AND company_id = ?',
            [req.body.employee_uuid, companyId]
        );
        if (!employee) return res.status(404).json({ error: 'Zaměstnanec nenalezen' });

        const scheme = await db.getOne(
            'SELECT * FROM commission_schemes WHERE uuid = ? AND company_id = ? AND is_active = 1',
            [req.body.scheme_uuid, companyId]
        );
        if (!scheme) return res.status(404).json({ error: 'Provizní schéma nenalezeno' });

        let tiers = [];
        try { tiers = JSON.parse(scheme.tiers || '[]'); } catch { tiers = []; }

        const { period_year, period_month, revenue_czk = 0, units_sold = 0, adjustment_czk = 0 } = req.body;

        // YTD commission for cap check
        const ytdResult = await db.getOne(`
            SELECT COALESCE(SUM(final_commission_czk), 0) as ytd
            FROM employee_commissions
            WHERE employee_id = ? AND company_id = ? AND period_year = ?
            AND period_month < ? AND status != 'draft'
        `, [employee.id, companyId, period_year, period_month]);

        // Calculate commission
        const calcResult = calculateCommission({
            type: scheme.type,
            revenue: revenue_czk,
            units: units_sold,
            baseRate: scheme.base_rate_pct || 0,
            baseAmount: scheme.base_amount_czk || 0,
            tiers,
            capMonthly: scheme.cap_monthly_czk || 0,
            capAnnual: scheme.cap_annual_czk || 0,
            ytdCommission: ytdResult?.ytd || 0,
        });

        const finalCommission = calcResult.calculatedCommissionCzk + adjustment_czk;

        const uuid = crypto.randomUUID();
        await db.run(`
            INSERT INTO employee_commissions (
                uuid, employee_id, commission_scheme_id, company_id,
                period_year, period_month, revenue_czk, units_sold,
                calculated_commission_czk, adjustment_czk, final_commission_czk,
                status, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'calculated', ?)
        `, [
            uuid, employee.id, scheme.id, companyId,
            period_year, period_month, revenue_czk, units_sold,
            calcResult.calculatedCommissionCzk, adjustment_czk,
            Math.max(0, finalCommission),
            req.body.notes || null,
        ]);

        const created = await db.getOne('SELECT * FROM employee_commissions WHERE uuid = ?', [uuid]);
        res.status(201).json({ success: true, commission: created, calculation: calcResult });
    } catch (error) {
        console.error('Create commission error:', error);
        res.status(500).json({ error: 'Chyba při výpočtu provize' });
    }
});

// POST /api/v2/commissions/:uuid/approve — Approve commission
router.post('/:uuid/approve', [
    param('uuid').trim().notEmpty(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const existing = await db.getOne(
            'SELECT * FROM employee_commissions WHERE uuid = ? AND company_id = ?',
            [req.params.uuid, companyId]
        );
        if (!existing) return res.status(404).json({ error: 'Provize nenalezena' });
        if (existing.status === 'paid') {
            return res.status(400).json({ error: 'Provize je již vyplacena' });
        }

        await db.run(
            `UPDATE employee_commissions SET status = 'approved', approved_by = ?, approved_at = NOW(), updated_at = NOW()
             WHERE uuid = ? AND company_id = ?`,
            [req.user.userId, req.params.uuid, companyId]
        );

        await auditLog('COMMISSION_APPROVED', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'commission',
            resourceId: req.params.uuid,
            ip: req.ip,
            metadata: { amount: existing.final_commission_czk },
        });

        res.json({ success: true, message: 'Provize schválena' });
    } catch (error) {
        console.error('Approve commission error:', error);
        res.status(500).json({ error: 'Chyba při schvalování provize' });
    }
});

module.exports = router;
