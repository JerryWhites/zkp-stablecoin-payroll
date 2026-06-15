// ====================================
// 📅 Annual Processing Routes — Roční zúčtování, ELDP, Přehledy
// ====================================

'use strict';

const express = require('express');
const { body, param, query } = require('express-validator');
const crypto = require('crypto');
const db = require('../db');
const { authenticateToken, requireRole, validate, auditLog } = require('../middleware/auth');
const {
    calculateRocniZuctovani,
    generateELDP,
    generatePrehledOSSZ,
    generatePrehledZP,
    calculateOSVCAnnualTax,
} = require('../services/payroll-engine');

const router = express.Router();

router.use(authenticateToken);

// ====================================
// GET /api/v2/annual — List annual processing records
// ====================================
router.get('/', [
    query('year').optional().isInt({ min: 2020, max: 2035 }),
    query('type').optional().isIn([
        'rocni_zuctovani', 'eldp', 'prehled_ossz', 'prehled_zp', 'danove_priznani', 'vyuctovani_dane',
    ]),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
        if (!user?.company_id) return res.status(404).json({ error: 'Firma nenalezena' });

        const year = parseInt(req.query.year) || new Date().getFullYear() - 1;
        let sql = 'SELECT * FROM annual_processing WHERE company_id = ? AND year = ?';
        const params = [user.company_id, year];

        if (req.query.type) {
            sql += ' AND type = ?';
            params.push(req.query.type);
        }

        sql += ' ORDER BY type, employee_id';

        const records = await db.getAll(sql, params);
        res.json({ records, year });
    } catch (error) {
        console.error('Annual processing list error:', error);
        res.status(500).json({ error: 'Chyba při načítání ročního zpracování' });
    }
});

// ====================================
// GET /api/v2/annual/:id — Get single annual processing record
// ====================================
router.get('/:id', [
    param('id').isInt(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
        if (!user?.company_id) return res.status(404).json({ error: 'Firma nenalezena' });

        const record = await db.getOne(
            'SELECT * FROM annual_processing WHERE id = ? AND company_id = ?',
            [req.params.id, user.company_id]
        );

        if (!record) return res.status(404).json({ error: 'Záznam nenalezen' });

        res.json({ record });
    } catch (error) {
        console.error('Annual processing get error:', error);
        res.status(500).json({ error: 'Chyba při načítání záznamu' });
    }
});

// ====================================
// POST /api/v2/annual/rocni-zuctovani — Calculate roční zúčtování for employee
// ====================================
router.post('/rocni-zuctovani', [
    body('year').isInt({ min: 2020, max: 2035 }),
    body('employee_id').isInt(),
    body('rocniUroky').optional().isInt({ min: 0 }),
    body('rocniDary').optional().isInt({ min: 0 }),
    body('rocniPenzijko').optional().isInt({ min: 0 }),
    body('rocniZivotko').optional().isInt({ min: 0 }),
    body('rocniOdbory').optional().isInt({ min: 0 }),
    body('rocniVzdelavani').optional().isInt({ min: 0 }),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
        if (!user?.company_id) return res.status(404).json({ error: 'Firma nenalezena' });

        const { year, employee_id, rocniUroky, rocniDary, rocniPenzijko, rocniZivotko, rocniOdbory, rocniVzdelavani } = req.body;

        // Verify employee belongs to company
        const employee = await db.getOne(
            'SELECT * FROM employees WHERE id = ? AND company_id = ?',
            [employee_id, user.company_id]
        );
        if (!employee) return res.status(404).json({ error: 'Zaměstnanec nenalezen' });

        // Get all payroll items for this employee in the year
        const payrollItems = await db.getAll(`
            SELECT pi.*, pp.month, pp.year
            FROM payroll_items pi
            JOIN payroll_periods pp ON pi.payroll_period_id = pp.id
            WHERE pi.employee_id = ? AND pp.company_id = ? AND pp.year = ?
            ORDER BY pp.month
        `, [employee_id, user.company_id, year]);

        if (payrollItems.length === 0) {
            return res.status(400).json({ error: `Žádné mzdové výpočty za rok ${year}` });
        }

        // Map payroll items to expected format
        const monthlyPayrolls = payrollItems.map(pi => ({
            month: pi.month,
            celkovaHruba: pi.celkova_hruba_czk || 0,
            vysledkDan: pi.zaloha_dan || 0,
            danovyBonus: pi.danovy_bonus || 0,
            podepsaneProhlaseni: !!employee.podepsane_prohlaseni,
            pocetDeti: employee.pocet_deti || 0,
            detiZTP: employee.deti_ztp || 0,
            invalidita: employee.invalidita || 'none',
            student: !!employee.sleva_student,
        }));

        const result = calculateRocniZuctovani({
            monthlyPayrolls,
            rocniUroky: rocniUroky || 0,
            rocniDary: rocniDary || 0,
            rocniPenzijko: rocniPenzijko || 0,
            rocniZivotko: rocniZivotko || 0,
            rocniOdbory: rocniOdbory || 0,
            rocniVzdelavani: rocniVzdelavani || 0,
        });

        // Add warning if year is incomplete
        if (monthlyPayrolls.length < 12) {
            result.warning = `Pouze ${monthlyPayrolls.length} z 12 měsíců má mzdová data`;
        }

        // Upsert to annual_processing
        const existing = await db.getOne(
            `SELECT id FROM annual_processing WHERE company_id = ? AND year = ? AND type = 'rocni_zuctovani' AND employee_id = ?`,
            [user.company_id, year, employee_id]
        );

        const uuid = crypto.randomUUID();
        if (existing) {
            await db.run(
                `UPDATE annual_processing SET data_json = ?, status = 'calculated', updated_at = NOW() WHERE id = ?`,
                [JSON.stringify(result), existing.id]
            );
        } else {
            await db.run(`
                INSERT INTO annual_processing (uuid, company_id, year, type, status, data_json, employee_id)
                VALUES (?, ?, ?, 'rocni_zuctovani', 'calculated', ?, ?)
            `, [uuid, user.company_id, year, JSON.stringify(result), employee_id]);
        }

        await auditLog('ROCNI_ZUCTOVANI', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'annual_processing',
            resourceId: uuid,
            ip: req.ip,
            metadata: { year, employee_id, vysledek: result.vysledek, castka: result.castka },
        });

        // Split employee.name into first/last name
        const nameParts = (employee.name || '').trim().split(/\s+/);
        const jmeno = nameParts[0] || '';
        const prijmeni = nameParts.slice(1).join(' ') || '';

        res.json({ success: true, result, employee: { id: employee.id, jmeno, prijmeni } });
    } catch (error) {
        console.error('Roční zúčtování error:', error);
        res.status(500).json({ error: 'Chyba při výpočtu ročního zúčtování' });
    }
});

// ====================================
// POST /api/v2/annual/eldp — Generate ELDP for employee
// ====================================
router.post('/eldp', [
    body('year').isInt({ min: 2020, max: 2035 }),
    body('employee_id').isInt(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
        if (!user?.company_id) return res.status(404).json({ error: 'Firma nenalezena' });

        const { year, employee_id } = req.body;

        const employee = await db.getOne(
            'SELECT * FROM employees WHERE id = ? AND company_id = ?',
            [employee_id, user.company_id]
        );
        if (!employee) return res.status(404).json({ error: 'Zaměstnanec nenalezen' });

        const company = await db.getOne('SELECT * FROM companies WHERE uuid = ?', [user.company_id]);

        const payrollItems = await db.getAll(`
            SELECT pi.*, pp.month, pp.year
            FROM payroll_items pi
            JOIN payroll_periods pp ON pi.payroll_period_id = pp.id
            WHERE pi.employee_id = ? AND pp.company_id = ? AND pp.year = ?
            ORDER BY pp.month
        `, [employee_id, user.company_id, year]);

        const monthlyPayrolls = payrollItems.map(pi => ({
            month: pi.month,
            celkovaHruba: pi.celkova_hruba_czk || 0,
            vyloucentDny: 0,
            odpracovaneDny: pi.odpracovane_hodiny ? Math.round(pi.odpracovane_hodiny / 8) : 0,
        }));

        const result = generateELDP({ employee, monthlyPayrolls, company, year });

        // Save/update
        const existing = await db.getOne(
            `SELECT id FROM annual_processing WHERE company_id = ? AND year = ? AND type = 'eldp' AND employee_id = ?`,
            [user.company_id, year, employee_id]
        );

        const uuid = crypto.randomUUID();
        if (existing) {
            await db.run(
                `UPDATE annual_processing SET data_json = ?, status = 'calculated', updated_at = NOW() WHERE id = ?`,
                [JSON.stringify(result), existing.id]
            );
        } else {
            await db.run(`
                INSERT INTO annual_processing (uuid, company_id, year, type, status, data_json, employee_id)
                VALUES (?, ?, ?, 'eldp', 'calculated', ?, ?)
            `, [uuid, user.company_id, year, JSON.stringify(result), employee_id]);
        }

        await auditLog('ELDP_GENERATED', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'annual_processing',
            resourceId: uuid,
            ip: req.ip,
            metadata: { year, employee_id },
        });

        res.json({ success: true, result });
    } catch (error) {
        console.error('ELDP generate error:', error);
        res.status(500).json({ error: 'Chyba při generování ELDP' });
    }
});

// ====================================
// POST /api/v2/annual/prehled-ossz — Generate přehled OSSZ (OSVČ)
// ====================================
router.post('/prehled-ossz', [
    body('year').isInt({ min: 2020, max: 2035 }),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
        if (!user?.company_id) return res.status(404).json({ error: 'Firma nenalezena' });

        const company = await db.getOne('SELECT * FROM companies WHERE uuid = ?', [user.company_id]);
        if (company?.entity_type !== 'osvc') {
            return res.status(400).json({ error: 'Přehled OSSZ je pouze pro OSVČ' });
        }

        const { year } = req.body;

        // Get income
        const income = await db.getAll(
            'SELECT * FROM osvc_income WHERE company_id = ? AND year = ?',
            [user.company_id, year]
        );
        const rocniPrijmy = income.reduce((s, i) => s + i.revenue_czk, 0);
        const rocniVydaje = income.reduce((s, i) => s + i.expenses_czk, 0);

        const annualTax = calculateOSVCAnnualTax({
            rocniPrijmy,
            rocniVydaje,
            usePausal: income[0]?.use_pausal ?? true,
            oborCinnosti: company.obor_cinnosti || 'volna',
        });

        // Get paid SP advances
        const paidAdvances = await db.getAll(
            `SELECT month, amount_czk FROM osvc_advances
             WHERE company_id = ? AND year = ? AND type = 'sp' AND status = 'paid'`,
            [user.company_id, year]
        );

        const result = generatePrehledOSSZ({ annualTax, paidAdvances, company, year });

        // Save
        const existing = await db.getOne(
            `SELECT id FROM annual_processing WHERE company_id = ? AND year = ? AND type = 'prehled_ossz' AND employee_id IS NULL`,
            [user.company_id, year]
        );
        const uuid = crypto.randomUUID();
        if (existing) {
            await db.run(
                `UPDATE annual_processing SET data_json = ?, status = 'calculated', updated_at = NOW() WHERE id = ?`,
                [JSON.stringify(result), existing.id]
            );
        } else {
            await db.run(`
                INSERT INTO annual_processing (uuid, company_id, year, type, status, data_json)
                VALUES (?, ?, ?, 'prehled_ossz', 'calculated', ?)
            `, [uuid, user.company_id, year, JSON.stringify(result)]);
        }

        res.json({ success: true, result });
    } catch (error) {
        console.error('Přehled OSSZ error:', error);
        res.status(500).json({ error: 'Chyba při generování přehledu OSSZ' });
    }
});

// ====================================
// POST /api/v2/annual/prehled-zp — Generate přehled ZP (OSVČ)
// ====================================
router.post('/prehled-zp', [
    body('year').isInt({ min: 2020, max: 2035 }),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
        if (!user?.company_id) return res.status(404).json({ error: 'Firma nenalezena' });

        const company = await db.getOne('SELECT * FROM companies WHERE uuid = ?', [user.company_id]);
        if (company?.entity_type !== 'osvc') {
            return res.status(400).json({ error: 'Přehled ZP je pouze pro OSVČ' });
        }

        const { year } = req.body;

        const income = await db.getAll(
            'SELECT * FROM osvc_income WHERE company_id = ? AND year = ?',
            [user.company_id, year]
        );
        const rocniPrijmy = income.reduce((s, i) => s + i.revenue_czk, 0);
        const rocniVydaje = income.reduce((s, i) => s + i.expenses_czk, 0);

        const annualTax = calculateOSVCAnnualTax({
            rocniPrijmy,
            rocniVydaje,
            usePausal: income[0]?.use_pausal ?? true,
            oborCinnosti: company.obor_cinnosti || 'volna',
        });

        const paidAdvances = await db.getAll(
            `SELECT month, amount_czk FROM osvc_advances
             WHERE company_id = ? AND year = ? AND type = 'zp' AND status = 'paid'`,
            [user.company_id, year]
        );

        const result = generatePrehledZP({ annualTax, paidAdvances, company, year });

        const existing = await db.getOne(
            `SELECT id FROM annual_processing WHERE company_id = ? AND year = ? AND type = 'prehled_zp' AND employee_id IS NULL`,
            [user.company_id, year]
        );
        const uuid = crypto.randomUUID();
        if (existing) {
            await db.run(
                `UPDATE annual_processing SET data_json = ?, status = 'calculated', updated_at = NOW() WHERE id = ?`,
                [JSON.stringify(result), existing.id]
            );
        } else {
            await db.run(`
                INSERT INTO annual_processing (uuid, company_id, year, type, status, data_json)
                VALUES (?, ?, ?, 'prehled_zp', 'calculated', ?)
            `, [uuid, user.company_id, year, JSON.stringify(result)]);
        }

        res.json({ success: true, result });
    } catch (error) {
        console.error('Přehled ZP error:', error);
        res.status(500).json({ error: 'Chyba při generování přehledu ZP' });
    }
});

// ====================================
// PATCH /api/v2/annual/:id/submit — Mark as submitted
// ====================================
router.patch('/:id/submit', [
    param('id').isInt(),
    body('submission_ref').optional().trim(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
        if (!user?.company_id) return res.status(404).json({ error: 'Firma nenalezena' });

        const record = await db.getOne(
            'SELECT * FROM annual_processing WHERE id = ? AND company_id = ?',
            [req.params.id, user.company_id]
        );
        if (!record) return res.status(404).json({ error: 'Záznam nenalezen' });

        if (record.status !== 'calculated') {
            return res.status(400).json({ error: 'Dokument musí být nejdřív vypočítán' });
        }

        await db.run(
            `UPDATE annual_processing SET status = 'submitted', submitted_at = NOW(), submission_ref = ?, updated_at = NOW() WHERE id = ?`,
            [req.body.submission_ref || null, record.id]
        );

        await auditLog('ANNUAL_SUBMITTED', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'annual_processing',
            resourceId: record.uuid,
            ip: req.ip,
            metadata: { type: record.type, year: record.year },
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Annual submit error:', error);
        res.status(500).json({ error: 'Chyba při označení podání' });
    }
});

module.exports = router;
