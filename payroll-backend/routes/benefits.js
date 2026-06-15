// ====================================
// 🎁 Benefits Administration Routes
// ====================================
// Meal vouchers, stravenkový paušál, company car, pension,
// life insurance, cafeteria system, benefit enrollment.

'use strict';

const express = require('express');
const { body, param, query } = require('express-validator');
const crypto = require('crypto');
const db = require('../db');
const { authenticateToken, requireRole, validate, auditLog } = require('../middleware/auth');
const { calculateMealBenefit, calculateCompanyCarBenefit } = require('../services/payroll-engine');

const router = express.Router();
router.use(authenticateToken);

async function getCompanyId(userId) {
    const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [userId]);
    return user?.company_id;
}

// ====================================
// BENEFIT PLANS (company-level)
// ====================================

// GET /api/v2/benefits/plans — List all benefit plans
router.get('/plans', async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const plans = await db.getAll(
            'SELECT * FROM benefit_plans WHERE company_id = ? ORDER BY type, name',
            [companyId]
        );

        // Count enrolled employees per plan
        for (const plan of plans) {
            const count = await db.getOne(
                `SELECT COUNT(*) as cnt FROM employee_benefits WHERE benefit_plan_id = ? AND status = 'active'`,
                [plan.id]
            );
            plan.enrolled_count = count?.cnt || 0;
        }

        res.json({ plans });
    } catch (error) {
        console.error('List benefit plans error:', error);
        res.status(500).json({ error: 'Chyba při načítání benefitních plánů' });
    }
});

// POST /api/v2/benefits/plans — Create benefit plan
router.post('/plans', [
    body('type').isIn([
        'meal_voucher', 'meal_allowance', 'pension_contribution',
        'life_insurance', 'company_car', 'cafeteria', 'transport',
        'education', 'sport', 'housing', 'other'
    ]).withMessage('Neplatný typ benefitu'),
    body('name').trim().notEmpty().withMessage('Název je povinný'),
    body('voucher_value_czk').optional().isInt({ min: 0 }),
    body('employer_contribution_pct').optional().isFloat({ min: 0, max: 100 }),
    body('employer_contribution_czk').optional().isInt({ min: 0 }),
    body('car_price_czk').optional().isInt({ min: 0 }),
    body('car_benefit_pct').optional().isFloat({ min: 0.5, max: 1.0 }),
    body('car_is_ev').optional().isBoolean(),
    body('monthly_contribution_czk').optional().isInt({ min: 0 }),
    body('annual_budget_czk').optional().isInt({ min: 0 }),
    body('is_taxable').optional().isBoolean(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const uuid = crypto.randomUUID();
        const {
            type, name, description,
            voucher_value_czk, employer_contribution_pct = 55, employer_contribution_czk,
            tax_free_limit_czk = 116,
            car_price_czk, car_benefit_pct = 1.0, car_is_ev = false, car_ev_benefit_pct = 0.5,
            monthly_contribution_czk, annual_tax_free_limit_czk = 50000,
            annual_budget_czk,
            is_taxable = false, effective_from, effective_to,
        } = req.body;

        await db.run(`
            INSERT INTO benefit_plans (
                uuid, company_id, type, name, description,
                voucher_value_czk, employer_contribution_pct, employer_contribution_czk,
                tax_free_limit_czk,
                car_price_czk, car_benefit_pct, car_is_ev, car_ev_benefit_pct,
                monthly_contribution_czk, annual_tax_free_limit_czk,
                annual_budget_czk, remaining_budget_czk,
                is_taxable, effective_from, effective_to
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            uuid, companyId, type, name, description || null,
            voucher_value_czk || null, employer_contribution_pct, employer_contribution_czk || null,
            tax_free_limit_czk,
            car_price_czk || null, car_benefit_pct, car_is_ev ? 1 : 0, car_ev_benefit_pct,
            monthly_contribution_czk || null, annual_tax_free_limit_czk,
            annual_budget_czk || null, annual_budget_czk || null,
            is_taxable ? 1 : 0, effective_from || null, effective_to || null,
        ]);

        await auditLog('BENEFIT_PLAN_CREATED', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'benefit_plan',
            resourceId: uuid,
            ip: req.ip,
            metadata: { type, name },
        });

        const plan = await db.getOne('SELECT * FROM benefit_plans WHERE uuid = ?', [uuid]);
        res.status(201).json({ success: true, plan });
    } catch (error) {
        console.error('Create benefit plan error:', error);
        res.status(500).json({ error: 'Chyba při vytváření benefitního plánu' });
    }
});

// PUT /api/v2/benefits/plans/:uuid — Update benefit plan
router.put('/plans/:uuid', [
    param('uuid').trim().notEmpty(),
    body('name').optional().trim().notEmpty(),
    body('voucher_value_czk').optional().isInt({ min: 0 }),
    body('employer_contribution_pct').optional().isFloat({ min: 0, max: 100 }),
    body('monthly_contribution_czk').optional().isInt({ min: 0 }),
    body('annual_budget_czk').optional().isInt({ min: 0 }),
    body('is_active').optional().isBoolean(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const existing = await db.getOne(
            'SELECT * FROM benefit_plans WHERE uuid = ? AND company_id = ?',
            [req.params.uuid, companyId]
        );
        if (!existing) return res.status(404).json({ error: 'Benefitní plán nenalezen' });

        const updates = {};
        const fields = ['name', 'description', 'voucher_value_czk', 'employer_contribution_pct',
            'employer_contribution_czk', 'monthly_contribution_czk', 'annual_budget_czk',
            'car_price_czk', 'is_taxable', 'is_active', 'effective_from', 'effective_to'];

        for (const f of fields) {
            if (req.body[f] !== undefined) updates[f] = req.body[f];
        }
        if (updates.is_taxable !== undefined) updates.is_taxable = updates.is_taxable ? 1 : 0;
        if (updates.is_active !== undefined) updates.is_active = updates.is_active ? 1 : 0;

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'Žádné údaje k aktualizaci' });
        }

        const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 1}`);
        setClauses.push('updated_at = NOW()');
        const values = Object.values(updates);
        values.push(req.params.uuid, companyId);

        await db.run(
            `UPDATE benefit_plans SET ${setClauses.join(', ')} WHERE uuid = $${values.length - 1} AND company_id = $${values.length}`,
            values
        );

        const updated = await db.getOne('SELECT * FROM benefit_plans WHERE uuid = ?', [req.params.uuid]);
        res.json({ success: true, plan: updated });
    } catch (error) {
        console.error('Update benefit plan error:', error);
        res.status(500).json({ error: 'Chyba při aktualizaci benefitního plánu' });
    }
});

// ====================================
// EMPLOYEE BENEFITS (enrollment)
// ====================================

// GET /api/v2/benefits/employees/:employee_uuid — List employee's active benefits
router.get('/employees/:employee_uuid', [
    param('employee_uuid').trim().notEmpty(),
], validate, async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const employee = await db.getOne(
            'SELECT id FROM employees WHERE uuid = ? AND company_id = ?',
            [req.params.employee_uuid, companyId]
        );
        if (!employee) return res.status(404).json({ error: 'Zaměstnanec nenalezen' });

        const benefits = await db.getAll(`
            SELECT eb.*, bp.type as plan_type, bp.name as plan_name,
                   bp.voucher_value_czk, bp.employer_contribution_pct,
                   bp.monthly_contribution_czk, bp.annual_budget_czk
            FROM employee_benefits eb
            JOIN benefit_plans bp ON eb.benefit_plan_id = bp.id
            WHERE eb.employee_id = ? AND eb.company_id = ?
            ORDER BY bp.type
        `, [employee.id, companyId]);

        res.json({ benefits });
    } catch (error) {
        console.error('List employee benefits error:', error);
        res.status(500).json({ error: 'Chyba při načítání benefitů zaměstnance' });
    }
});

// POST /api/v2/benefits/enroll — Enroll employee in benefit plan
router.post('/enroll', [
    body('employee_uuid').trim().notEmpty().withMessage('UUID zaměstnance je povinné'),
    body('plan_uuid').trim().notEmpty().withMessage('UUID plánu je povinné'),
    body('custom_value_czk').optional().isInt({ min: 0 }),
    body('car_registration').optional().trim(),
    body('car_model').optional().trim(),
    body('car_price_czk').optional().isInt({ min: 0 }),
    body('car_is_ev').optional().isBoolean(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const employee = await db.getOne(
            'SELECT id, name FROM employees WHERE uuid = ? AND company_id = ?',
            [req.body.employee_uuid, companyId]
        );
        if (!employee) return res.status(404).json({ error: 'Zaměstnanec nenalezen' });

        const plan = await db.getOne(
            'SELECT * FROM benefit_plans WHERE uuid = ? AND company_id = ? AND is_active = 1',
            [req.body.plan_uuid, companyId]
        );
        if (!plan) return res.status(404).json({ error: 'Benefitní plán nenalezen nebo neaktivní' });

        // Check if already enrolled
        const existing = await db.getOne(
            `SELECT id FROM employee_benefits WHERE employee_id = ? AND benefit_plan_id = ? AND status = 'active'`,
            [employee.id, plan.id]
        );
        if (existing) return res.status(409).json({ error: 'Zaměstnanec je již přihlášen k tomuto benefitu' });

        const uuid = crypto.randomUUID();
        const { custom_value_czk, car_registration, car_model, car_price_czk, car_is_ev } = req.body;

        await db.run(`
            INSERT INTO employee_benefits (
                uuid, employee_id, benefit_plan_id, company_id,
                custom_value_czk, car_registration, car_model, car_price_czk, car_is_ev
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            uuid, employee.id, plan.id, companyId,
            custom_value_czk || null,
            car_registration || null, car_model || null,
            car_price_czk || plan.car_price_czk || null,
            car_is_ev !== undefined ? (car_is_ev ? 1 : 0) : (plan.car_is_ev || 0),
        ]);

        await auditLog('BENEFIT_ENROLLMENT', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'employee_benefit',
            resourceId: uuid,
            ip: req.ip,
            metadata: { employee: employee.name, plan: plan.name, type: plan.type },
        });

        const enrollment = await db.getOne('SELECT * FROM employee_benefits WHERE uuid = ?', [uuid]);
        res.status(201).json({ success: true, enrollment });
    } catch (error) {
        console.error('Enroll benefit error:', error);
        res.status(500).json({ error: 'Chyba při přihlášení k benefitu' });
    }
});

// DELETE /api/v2/benefits/enrollment/:uuid — End benefit enrollment
router.delete('/enrollment/:uuid', [
    param('uuid').trim().notEmpty(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        await db.run(
            `UPDATE employee_benefits SET status = 'ended', end_date = CURRENT_DATE, updated_at = NOW()
             WHERE uuid = ? AND company_id = ?`,
            [req.params.uuid, companyId]
        );

        res.json({ success: true, message: 'Benefit ukončen' });
    } catch (error) {
        console.error('End benefit error:', error);
        res.status(500).json({ error: 'Chyba při ukončení benefitu' });
    }
});

// ====================================
// BENEFIT CALCULATIONS (preview)
// ====================================

// POST /api/v2/benefits/calculate/meal — Calculate meal benefit for a period
router.post('/calculate/meal', [
    body('type').isIn(['voucher', 'allowance']),
    body('voucher_value_czk').optional().isInt({ min: 0 }),
    body('employer_contribution_pct').optional().isFloat({ min: 0, max: 100 }),
    body('worked_days').isInt({ min: 0, max: 31 }),
    body('daily_allowance_czk').optional().isFloat({ min: 0 }),
], validate, async (req, res) => {
    try {
        const result = calculateMealBenefit({
            type: req.body.type,
            voucherValueCzk: req.body.voucher_value_czk || 0,
            employerContributionPct: req.body.employer_contribution_pct || 55,
            workedDays: req.body.worked_days,
            dailyAllowanceCzk: req.body.daily_allowance_czk || 0,
        });

        res.json({ calculation: result });
    } catch (error) {
        console.error('Calculate meal benefit error:', error);
        res.status(500).json({ error: 'Chyba při výpočtu stravenkového benefitu' });
    }
});

// POST /api/v2/benefits/calculate/car — Calculate company car benefit
router.post('/calculate/car', [
    body('car_price_czk').isInt({ min: 0 }).withMessage('Cena vozidla je povinná'),
    body('is_electric').optional().isBoolean(),
], validate, async (req, res) => {
    try {
        const result = calculateCompanyCarBenefit({
            carPriceCzk: req.body.car_price_czk,
            isElectric: req.body.is_electric || false,
        });

        res.json({ calculation: result });
    } catch (error) {
        console.error('Calculate car benefit error:', error);
        res.status(500).json({ error: 'Chyba při výpočtu benefitu služebního auta' });
    }
});

// GET /api/v2/benefits/summary/:year/:month — Company-wide benefit summary for period
router.get('/summary/:year/:month', [
    param('year').isInt({ min: 2020 }),
    param('month').isInt({ min: 1, max: 12 }),
], validate, async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const year = parseInt(req.params.year);
        const month = parseInt(req.params.month);

        // Get all active enrollments with plan details
        const enrollments = await db.getAll(`
            SELECT eb.*, bp.type as plan_type, bp.name as plan_name,
                   bp.voucher_value_czk, bp.employer_contribution_pct,
                   bp.monthly_contribution_czk, bp.car_price_czk,
                   bp.car_is_ev, bp.car_benefit_pct,
                   e.name as employee_name, e.uuid as employee_uuid
            FROM employee_benefits eb
            JOIN benefit_plans bp ON eb.benefit_plan_id = bp.id
            JOIN employees e ON eb.employee_id = e.id
            WHERE eb.company_id = ? AND eb.status = 'active'
        `, [companyId]);

        const summary = {
            totalCostCzk: 0,
            byType: {},
            employees: [],
        };

        for (const eb of enrollments) {
            let costCzk = 0;

            switch (eb.plan_type) {
                case 'meal_voucher':
                case 'meal_allowance':
                    // Estimate based on standard working days
                    costCzk = (eb.voucher_value_czk || 0) * (eb.employer_contribution_pct / 100) * 21;
                    break;
                case 'company_car': {
                    const carResult = calculateCompanyCarBenefit({
                        carPriceCzk: eb.car_price_czk || eb.custom_value_czk || 0,
                        isElectric: eb.car_is_ev === 1,
                    });
                    costCzk = carResult.monthlyBenefitCzk;
                    break;
                }
                case 'pension_contribution':
                case 'life_insurance':
                    costCzk = eb.monthly_contribution_czk || eb.custom_value_czk || 0;
                    break;
                default:
                    costCzk = eb.custom_value_czk || eb.monthly_contribution_czk || 0;
            }

            summary.totalCostCzk += costCzk;
            if (!summary.byType[eb.plan_type]) {
                summary.byType[eb.plan_type] = { count: 0, totalCzk: 0 };
            }
            summary.byType[eb.plan_type].count++;
            summary.byType[eb.plan_type].totalCzk += costCzk;

            summary.employees.push({
                employee: eb.employee_name,
                employeeUuid: eb.employee_uuid,
                benefit: eb.plan_name,
                type: eb.plan_type,
                monthlyCostCzk: costCzk,
            });
        }

        res.json({ year, month, summary });
    } catch (error) {
        console.error('Benefit summary error:', error);
        res.status(500).json({ error: 'Chyba při generování souhrnu benefitů' });
    }
});

module.exports = router;
