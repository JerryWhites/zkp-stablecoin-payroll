// ====================================
// 📊 OSVČ Routes — Self-employed management
// ====================================

'use strict';

const express = require('express');
const { body, param, query } = require('express-validator');
const db = require('../db');
const { authenticateToken, requireRole, validate, auditLog } = require('../middleware/auth');
const {
    calculateOSVCSocialAdvance,
    calculateOSVCHealthAdvance,
    calculateOSVCTaxAdvance,
    calculatePausalDan,
    calculateOSVCAnnualTax,
    OSVC_PARAMS_2026,
} = require('../services/payroll-engine');

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// ====================================
// GET /api/v2/osvc/advances — List advance payments (zálohy)
// ====================================
router.get('/advances', [
    query('year').optional().isInt({ min: 2020, max: 2035 }),
], validate, async (req, res) => {
    try {
        const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
        if (!user?.company_id) return res.status(404).json({ error: 'Firma nenalezena' });

        const company = await db.getOne('SELECT entity_type FROM companies WHERE uuid = ?', [user.company_id]);
        if (company?.entity_type !== 'osvc') {
            return res.status(400).json({ error: 'Tato funkce je pouze pro OSVČ' });
        }

        const year = parseInt(req.query.year) || new Date().getFullYear();

        const advances = await db.getAll(
            'SELECT * FROM osvc_advances WHERE company_id = ? AND year = ? ORDER BY month, type',
            [user.company_id, year]
        );

        // Calculate summary
        const summary = {
            sp: { total: 0, paid: 0, pending: 0 },
            zp: { total: 0, paid: 0, pending: 0 },
            dan: { total: 0, paid: 0, pending: 0 },
        };

        for (const a of advances) {
            if (summary[a.type]) {
                summary[a.type].total += a.amount_czk;
                if (a.status === 'paid') summary[a.type].paid += a.amount_czk;
                else summary[a.type].pending += a.amount_czk;
            }
        }

        res.json({ advances, summary, year });
    } catch (error) {
        console.error('OSVČ advances error:', error);
        res.status(500).json({ error: 'Chyba při načítání záloh' });
    }
});

// ====================================
// POST /api/v2/osvc/advances/generate — Generate advance payment schedule
// ====================================
router.post('/advances/generate', [
    body('year').isInt({ min: 2020, max: 2035 }),
    body('predchoziRocniZisk').optional().isInt({ min: 0 }),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
        if (!user?.company_id) return res.status(404).json({ error: 'Firma nenalezena' });

        const company = await db.getOne('SELECT * FROM companies WHERE uuid = ?', [user.company_id]);
        if (company?.entity_type !== 'osvc') {
            return res.status(400).json({ error: 'Tato funkce je pouze pro OSVČ' });
        }

        const { year, predchoziRocniZisk = 0 } = req.body;
        const hlavniCinnost = !!company.hlavni_cinnost;

        // Calculate advances
        const spCalc = calculateOSVCSocialAdvance({ predchoziRocniZisk, hlavniCinnost });
        const zpCalc = calculateOSVCHealthAdvance({ predchoziRocniZisk, hlavniCinnost });

        const generated = [];

        for (let month = 1; month <= 12; month++) {
            // SP advance
            if (!spCalc.isExempt) {
                const dueYear = month === 12 ? year + 1 : year;
                const dueDateFinal = `${dueYear}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-20`;

                await db.run(`
                    INSERT INTO osvc_advances (company_id, year, month, type, amount_czk, due_date, status)
                    VALUES (?, ?, ?, 'sp', ?, ?, 'pending')
                    ON CONFLICT (company_id, year, month, type) DO UPDATE SET
                        amount_czk = EXCLUDED.amount_czk,
                        due_date = EXCLUDED.due_date,
                        updated_at = NOW()
                `, [user.company_id, year, month, spCalc.zaloha, dueDateFinal]);

                generated.push({ month, type: 'sp', amount: spCalc.zaloha });
            }

            // ZP advance
            const zpDueYear = month === 12 ? year + 1 : year;
            const zpDueDate = `${zpDueYear}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-08`;

            await db.run(`
                INSERT INTO osvc_advances (company_id, year, month, type, amount_czk, due_date, status)
                VALUES (?, ?, ?, 'zp', ?, ?, 'pending')
                ON CONFLICT (company_id, year, month, type) DO UPDATE SET
                    amount_czk = EXCLUDED.amount_czk,
                    due_date = EXCLUDED.due_date,
                    updated_at = NOW()
            `, [user.company_id, year, month, zpCalc.zaloha, zpDueDate]);

            generated.push({ month, type: 'zp', amount: zpCalc.zaloha });
        }

        await auditLog('OSVC_ADVANCES_GENERATED', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'osvc_advances',
            resourceId: user.company_id,
            ip: req.ip,
            metadata: { year, count: generated.length },
        });

        res.json({
            success: true,
            year,
            spCalc,
            zpCalc,
            generated,
        });
    } catch (error) {
        console.error('Generate advances error:', error);
        res.status(500).json({ error: 'Chyba při generování záloh' });
    }
});

// ====================================
// PATCH /api/v2/osvc/advances/:id/pay — Mark advance as paid
// ====================================
router.patch('/advances/:id/pay', [
    param('id').isInt(),
    body('paid_at').optional().isISO8601(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
        if (!user?.company_id) return res.status(404).json({ error: 'Firma nenalezena' });

        const advance = await db.getOne(
            'SELECT * FROM osvc_advances WHERE id = ? AND company_id = ?',
            [req.params.id, user.company_id]
        );

        if (!advance) return res.status(404).json({ error: 'Záloha nenalezena' });
        if (advance.status === 'paid') return res.status(400).json({ error: 'Záloha je již uhrazena' });

        const paidAt = req.body.paid_at || new Date().toISOString();

        await db.run(
            'UPDATE osvc_advances SET status = ?, paid_at = ?, updated_at = NOW() WHERE id = ?',
            ['paid', paidAt, advance.id]
        );

        res.json({ success: true, advance: { ...advance, status: 'paid', paid_at: paidAt } });
    } catch (error) {
        console.error('Pay advance error:', error);
        res.status(500).json({ error: 'Chyba při označení platby' });
    }
});

// ====================================
// GET /api/v2/osvc/income — Get monthly income records
// ====================================
router.get('/income', [
    query('year').optional().isInt({ min: 2020, max: 2035 }),
], validate, async (req, res) => {
    try {
        const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
        if (!user?.company_id) return res.status(404).json({ error: 'Firma nenalezena' });

        const company = await db.getOne('SELECT entity_type FROM companies WHERE uuid = ?', [user.company_id]);
        if (company?.entity_type !== 'osvc') {
            return res.status(400).json({ error: 'Tato funkce je pouze pro OSVČ' });
        }

        const year = parseInt(req.query.year) || new Date().getFullYear();

        const income = await db.getAll(
            'SELECT * FROM osvc_income WHERE company_id = ? AND year = ? ORDER BY month',
            [user.company_id, year]
        );

        const totals = income.reduce((acc, i) => ({
            revenue: acc.revenue + i.revenue_czk,
            expenses: acc.expenses + i.expenses_czk,
        }), { revenue: 0, expenses: 0 });

        res.json({ income, totals, year });
    } catch (error) {
        console.error('OSVČ income error:', error);
        res.status(500).json({ error: 'Chyba při načítání příjmů' });
    }
});

// ====================================
// POST /api/v2/osvc/income — Save monthly income
// ====================================
router.post('/income', [
    body('year').isInt({ min: 2020, max: 2035 }),
    body('month').isInt({ min: 1, max: 12 }),
    body('revenue_czk').isInt({ min: 0 }),
    body('expenses_czk').isInt({ min: 0 }),
    body('use_pausal').optional().isInt({ min: 0, max: 1 }),
    body('note').optional().trim(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
        if (!user?.company_id) return res.status(404).json({ error: 'Firma nenalezena' });

        const { year, month, revenue_czk, expenses_czk, use_pausal = 1, note } = req.body;

        await db.run(`
            INSERT INTO osvc_income (company_id, year, month, revenue_czk, expenses_czk, use_pausal, note)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (company_id, year, month) DO UPDATE SET
                revenue_czk = EXCLUDED.revenue_czk,
                expenses_czk = EXCLUDED.expenses_czk,
                use_pausal = EXCLUDED.use_pausal,
                note = EXCLUDED.note,
                updated_at = NOW()
        `, [user.company_id, year, month, revenue_czk, expenses_czk, use_pausal, note || null]);

        res.json({ success: true });
    } catch (error) {
        console.error('Save income error:', error);
        res.status(500).json({ error: 'Chyba při ukládání příjmů' });
    }
});

// ====================================
// POST /api/v2/osvc/calculate — Calculate OSVČ summary
// ====================================
router.post('/calculate', [
    body('year').isInt({ min: 2020, max: 2035 }),
], validate, async (req, res) => {
    try {
        const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
        if (!user?.company_id) return res.status(404).json({ error: 'Firma nenalezena' });

        const company = await db.getOne('SELECT * FROM companies WHERE uuid = ?', [user.company_id]);
        if (company?.entity_type !== 'osvc') {
            return res.status(400).json({ error: 'Tato funkce je pouze pro OSVČ' });
        }

        const { year } = req.body;

        // Get income records
        const income = await db.getAll(
            'SELECT * FROM osvc_income WHERE company_id = ? AND year = ? ORDER BY month',
            [user.company_id, year]
        );

        const rocniPrijmy = income.reduce((s, i) => s + i.revenue_czk, 0);
        const rocniVydaje = income.reduce((s, i) => s + i.expenses_czk, 0);

        // Determine expense method: if company uses paušální daň, skip paušální výdaje
        // Otherwise use what the income records say (default: paušální výdaje)
        const usePausal = company.pausal_dan ? false : !!(income[0]?.use_pausal ?? true);

        // Calculate annual tax
        const annualTax = calculateOSVCAnnualTax({
            rocniPrijmy,
            rocniVydaje,
            usePausal,
            oborCinnosti: company.obor_cinnosti || 'volna',
        });

        // Paušální daň eligibility
        const pausalDan = calculatePausalDan({
            rocniPrijmy,
            isPlatceDPH: false, // TODO: add VAT tracking
        });

        // Get paid advances
        const paidAdvances = await db.getAll(
            `SELECT type, SUM(amount_czk) as total FROM osvc_advances
             WHERE company_id = ? AND year = ? AND status = 'paid'
             GROUP BY type`,
            [user.company_id, year]
        );

        const paidSP = paidAdvances.find(a => a.type === 'sp')?.total || 0;
        const paidZP = paidAdvances.find(a => a.type === 'zp')?.total || 0;

        res.json({
            year,
            income: { rocniPrijmy, rocniVydaje, months: income.length },
            annualTax,
            pausalDan,
            advances: { sp: paidSP, zp: paidZP },
            spDoplatek: annualTax.spRocni - paidSP,
            zpDoplatek: annualTax.zpRocni - paidZP,
        });
    } catch (error) {
        console.error('OSVČ calculate error:', error);
        res.status(500).json({ error: 'Chyba při výpočtu OSVČ' });
    }
});

// ====================================
// GET /api/v2/osvc/dashboard — OSVČ dashboard stats
// ====================================
router.get('/dashboard', [
    query('year').optional().isInt({ min: 2020, max: 2035 }),
], validate, async (req, res) => {
    try {
        const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
        if (!user?.company_id) return res.status(404).json({ error: 'Firma nenalezena' });

        const company = await db.getOne('SELECT * FROM companies WHERE uuid = ?', [user.company_id]);
        if (company?.entity_type !== 'osvc') {
            return res.status(400).json({ error: 'Tato funkce je pouze pro OSVČ' });
        }

        const year = parseInt(req.query.year) || new Date().getFullYear();
        const month = new Date().getMonth() + 1;

        // Current month income
        const currentIncome = await db.getOne(
            'SELECT * FROM osvc_income WHERE company_id = ? AND year = ? AND month = ?',
            [user.company_id, year, month]
        );

        // YTD income
        const ytdIncome = await db.getOne(
            `SELECT COALESCE(SUM(revenue_czk), 0) as revenue, COALESCE(SUM(expenses_czk), 0) as expenses
             FROM osvc_income WHERE company_id = ? AND year = ?`,
            [user.company_id, year]
        );

        // Pending advances
        const pendingAdvances = await db.getAll(
            `SELECT * FROM osvc_advances WHERE company_id = ? AND year = ? AND month = ? AND status = 'pending'`,
            [user.company_id, year, month]
        );

        // Overdue advances
        const overdueAdvances = await db.getAll(
            `SELECT * FROM osvc_advances WHERE company_id = ? AND status = 'pending' AND due_date < CURRENT_DATE`,
            [user.company_id]
        );

        // Annual summary
        const annualAdvances = await db.getOne(
            `SELECT
                COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_czk ELSE 0 END), 0) as paid,
                COALESCE(SUM(CASE WHEN status != 'paid' THEN amount_czk ELSE 0 END), 0) as pending,
                COALESCE(SUM(amount_czk), 0) as total
             FROM osvc_advances WHERE company_id = ? AND year = ?`,
            [user.company_id, year]
        );

        res.json({
            year,
            month,
            company: {
                name: company.name,
                ico: company.ico,
                entity_type: company.entity_type,
                hlavni_cinnost: company.hlavni_cinnost,
                pausal_dan: company.pausal_dan,
            },
            currentIncome: currentIncome || { revenue_czk: 0, expenses_czk: 0 },
            ytdIncome: ytdIncome || { revenue: 0, expenses: 0 },
            pendingAdvances,
            overdueCount: overdueAdvances.length,
            overdueAdvances,
            annualAdvances: annualAdvances || { paid: 0, pending: 0, total: 0 },
        });
    } catch (error) {
        console.error('OSVČ dashboard error:', error);
        res.status(500).json({ error: 'Chyba při načítání přehledu OSVČ' });
    }
});

module.exports = router;
