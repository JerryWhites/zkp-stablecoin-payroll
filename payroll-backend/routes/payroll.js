// ====================================
// 💰 Payroll Workflow Routes
// ====================================
// 4-step monthly payroll: create period → edit items → calculate → lock

'use strict';

const express = require('express');
const { body, param, query } = require('express-validator');
const crypto = require('crypto');
const db = require('../db');
const { authenticateToken, requireRole, validate, auditLog } = require('../middleware/auth');
const {
    calculateBatchPayroll,
    getWorkingHours,
    czkToAleo,
    czkToUsdcx,
    splitCryptoFiat,
    calculateSickLeaveCompensation,
    applyDeductions,
    calculateLiabilityInsurance,
    DEFAULT_TAX_PARAMS_2026,
} = require('../services/payroll-engine');
const { getOrCreateCompanyKey, decryptEmployeeData } = require('../services/encryption');

const router = express.Router();
router.use(authenticateToken);

// Helper: get user's company_id
async function getCompanyId(userId) {
    const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [userId]);
    return user?.company_id;
}

// Helper: load tax params from DB for a given year
async function loadTaxParams(year) {
    const params = await db.getOne('SELECT * FROM tax_parameters WHERE year = ?', [year]);
    if (!params) {
        console.warn(`Tax parameters not found for year ${year}, using defaults`);
        return DEFAULT_TAX_PARAMS_2026;
    }
    return params;
}

// ====================================
// GET /api/v2/payroll/stats — Dashboard summary statistics
// 🔐 FIXED: Added role check — only admin/employer can see company salary stats
// ====================================
router.get('/stats', requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(200).json({ has_company: false });

        // Aggregate stats from payroll periods and items
        const periodStats = await db.getOne(
            `SELECT COUNT(*) as total_periods,
                    COUNT(CASE WHEN status = 'locked' THEN 1 END) as locked_periods,
                    COUNT(CASE WHEN status = 'calculated' THEN 1 END) as calculated_periods,
                    MAX(CASE WHEN status = 'locked' THEN year || '-' || LPAD(month::text, 2, '0') END) as last_locked_period
             FROM payroll_periods WHERE company_id = ?`,
            [companyId]
        );

        const paymentStats = await db.getOne(
            `SELECT COUNT(*) as total_employees_paid,
                    COALESCE(SUM(celkova_hruba_czk), 0) as total_hruba,
                    COALESCE(SUM(cista_mzda_czk), 0) as total_cista,
                    COALESCE(SUM(k_vyplate_czk), 0) as total_k_vyplate,
                    COALESCE(SUM(srazky_exekuce_czk), 0) as total_srazky,
                    COALESCE(SUM(nahrada_nemoc_czk), 0) as total_nemoc
             FROM payroll_items pi
             JOIN payroll_periods pp ON pi.payroll_period_id = pp.id
             WHERE pp.company_id = ? AND pp.status = 'locked'`,
            [companyId]
        );

        const activeEmployees = await db.getOne(
            `SELECT COUNT(*) as count FROM employees WHERE company_id = ? AND is_active = true`,
            [companyId]
        );

        const recentPeriods = await db.getAll(
            `SELECT pp.year, pp.month, pp.status, pp.uuid,
                    COUNT(pi.id) as employee_count,
                    COALESCE(SUM(pi.cista_mzda_czk), 0) as total_cista,
                    COALESCE(SUM(pi.celkova_hruba_czk), 0) as total_hruba
             FROM payroll_periods pp
             LEFT JOIN payroll_items pi ON pi.payroll_period_id = pp.id
             WHERE pp.company_id = ?
             GROUP BY pp.id, pp.year, pp.month, pp.status, pp.uuid
             ORDER BY pp.year DESC, pp.month DESC
             LIMIT 6`,
            [companyId]
        );

        res.json({
            has_company: true,
            active_employees: parseInt(activeEmployees?.count || '0'),
            periods: {
                total: parseInt(periodStats?.total_periods || '0'),
                locked: parseInt(periodStats?.locked_periods || '0'),
                calculated: parseInt(periodStats?.calculated_periods || '0'),
                last_locked: periodStats?.last_locked_period || null,
            },
            totals: {
                employees_paid: parseInt(paymentStats?.total_employees_paid || '0'),
                hruba_czk: parseFloat(paymentStats?.total_hruba || '0'),
                cista_czk: parseFloat(paymentStats?.total_cista || '0'),
                k_vyplate_czk: parseFloat(paymentStats?.total_k_vyplate || '0'),
                srazky_czk: parseFloat(paymentStats?.total_srazky || '0'),
                nemoc_czk: parseFloat(paymentStats?.total_nemoc || '0'),
            },
            recent_periods: recentPeriods.map(p => ({
                year: p.year,
                month: p.month,
                status: p.status,
                uuid: p.uuid,
                employee_count: parseInt(p.employee_count || '0'),
                total_cista: parseFloat(p.total_cista || '0'),
                total_hruba: parseFloat(p.total_hruba || '0'),
            })),
        });
    } catch (error) {
        console.error('Dashboard stats error:', error);
        res.status(500).json({ error: 'Chyba při načítání statistik' });
    }
});

// ====================================
// GET /api/v2/payroll/periods — List payroll periods for company
// ====================================
router.get('/periods', async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const periods = await db.getAll(
            `SELECT pp.*, 
                    (SELECT COUNT(*) FROM payroll_items pi WHERE pi.payroll_period_id = pp.id) as item_count,
                    (SELECT COALESCE(SUM(pi.celkova_hruba_czk), 0) FROM payroll_items pi WHERE pi.payroll_period_id = pp.id) as total_hruba,
                    (SELECT COALESCE(SUM(pi.cista_mzda_czk), 0) FROM payroll_items pi WHERE pi.payroll_period_id = pp.id) as total_cista
             FROM payroll_periods pp
             WHERE pp.company_id = ?
             ORDER BY pp.year DESC, pp.month DESC`,
            [companyId]
        );

        res.json({ periods });
    } catch (error) {
        console.error('List periods error:', error);
        res.status(500).json({ error: 'Chyba při načítání období' });
    }
});

// ====================================
// POST /api/v2/payroll/periods — Create new payroll period
// ====================================
router.post('/periods', [
    body('year').isInt({ min: 2024, max: 2030 }).withMessage('Neplatný rok'),
    body('month').isInt({ min: 1, max: 12 }).withMessage('Neplatný měsíc'),
    body('czk_aleo_rate').optional().isFloat({ min: 0.01 }).withMessage('Neplatný kurz CZK/ALEO'),
    body('czk_usd_rate').optional().isFloat({ min: 0.01 }).withMessage('Neplatný kurz CZK/USD'),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const { year, month, czk_aleo_rate, czk_usd_rate } = req.body;

        // Check for existing period
        const existing = await db.getOne(
            'SELECT id, status FROM payroll_periods WHERE company_id = ? AND year = ? AND month = ?',
            [companyId, year, month]
        );
        if (existing) {
            return res.status(409).json({
                error: `Období ${month}/${year} již existuje`,
                existing_status: existing.status,
            });
        }

        const uuid = crypto.randomUUID();
        await db.run(`
            INSERT INTO payroll_periods (uuid, company_id, year, month, czk_aleo_rate, czk_usd_rate, status)
            VALUES (?, ?, ?, ?, ?, ?, 'draft')
        `, [uuid, companyId, year, month, czk_aleo_rate || null, czk_usd_rate || null]);

        // Auto-populate payroll items for all active employees
        const employees = await db.getAll(
            `SELECT id, uuid, typ_uvazku, hruba_mzda_czk, uvazek_hodiny FROM employees 
             WHERE company_id = ? AND status = 'active'`,
            [companyId]
        );

        const period = await db.getOne('SELECT id FROM payroll_periods WHERE uuid = ?', [uuid]);
        const fondHodin = getWorkingHours(year, month);

        for (const emp of employees) {
            const itemUuid = crypto.randomUUID();
            const empFond = fondHodin * (emp.uvazek_hodiny || 40) / 40;
            await db.run(`
                INSERT INTO payroll_items (
                    uuid, payroll_period_id, employee_id,
                    odpracovane_hodiny, fond_hodin, absence_hodiny,
                    bonus_czk, srazka_czk, status
                ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 'draft')
            `, [itemUuid, period.id, emp.id, empFond, empFond]);
        }

        await auditLog('PAYROLL_PERIOD_CREATED', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'payroll_period',
            resourceId: uuid,
            ip: req.ip,
            metadata: { year, month, employeeCount: employees.length },
        });

        res.status(201).json({
            success: true,
            period: { uuid, year, month, status: 'draft', item_count: employees.length },
        });

    } catch (error) {
        console.error('Create period error:', error);
        res.status(500).json({ error: 'Chyba při vytváření období' });
    }
});

// ====================================
// GET /api/v2/payroll/periods/:uuid — Get period detail with items
// ====================================
router.get('/periods/:uuid', [
    param('uuid').trim().notEmpty(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const period = await db.getOne(
            'SELECT * FROM payroll_periods WHERE uuid = ? AND company_id = ?',
            [req.params.uuid, companyId]
        );
        if (!period) return res.status(404).json({ error: 'Období nenalezeno' });

        // Get items with employee details
        const items = await db.getAll(`
            SELECT pi.*, e.name, e.email, e.typ_uvazku, e.hruba_mzda_czk as emp_hruba_mzda,
                   e.uvazek_hodiny, e.aleo_address, e.uuid as employee_uuid,
                   e.podepsane_prohlaseni, e.pocet_deti, e.deti_ztp, e.invalidita, e.sleva_student,
                   e.osobni_cislo, e.zp_code
            FROM payroll_items pi
            JOIN employees e ON pi.employee_id = e.id
            WHERE pi.payroll_period_id = ?
            ORDER BY e.osobni_cislo, e.name
        `, [period.id]);

        // Calculate summary if items have been calculated
        let summary = null;
        if (period.status === 'calculated' || period.status === 'locked') {
            summary = {
                celkemHruba: items.reduce((s, i) => s + (i.celkova_hruba_czk || 0), 0),
                celkemCista: items.reduce((s, i) => s + (i.cista_mzda_czk || 0), 0),
                celkemSpZamestnanec: items.reduce((s, i) => s + (i.sp_zamestnanec || 0), 0),
                celkemZpZamestnanec: items.reduce((s, i) => s + (i.zp_zamestnanec || 0), 0),
                celkemDan: items.reduce((s, i) => s + (i.vysledek_dan || 0), 0),
                celkemDanovyBonus: items.reduce((s, i) => s + (i.danovy_bonus || 0), 0),
                celkemSpZamestnavatel: items.reduce((s, i) => s + (i.sp_zamestnavatel || 0), 0),
                celkemZpZamestnavatel: items.reduce((s, i) => s + (i.zp_zamestnavatel || 0), 0),
                platbaFU: items.reduce((s, i) => s + (i.vysledek_dan || 0), 0) -
                          items.reduce((s, i) => s + (i.danovy_bonus || 0), 0),
                platbaOSSZ: items.reduce((s, i) => s + (i.sp_zamestnanec || 0) + (i.sp_zamestnavatel || 0), 0),
                platbaZP: items.reduce((s, i) => s + (i.zp_zamestnanec || 0) + (i.zp_zamestnavatel || 0), 0),
                platbaMzdy: items.reduce((s, i) => s + (i.cista_mzda_czk || 0), 0),
                celkoveNaklady: items.reduce((s, i) => s + (i.celkove_naklady || 0), 0),
                employeeCount: items.length,
                // Compliance totals
                celkemSrazkyExekuce: items.reduce((s, i) => s + (i.srazky_exekuce_czk || 0), 0),
                celkemSrazkyOstatni: items.reduce((s, i) => s + (i.srazky_ostatni_czk || 0), 0),
                celkemNahradaNemoc: items.reduce((s, i) => s + (i.nahrada_nemoc_czk || 0), 0),
                celkemZakonnePojisteni: items.reduce((s, i) => s + (i.zakonne_pojisteni_czk || 0), 0),
                celkemKVyplate: items.reduce((s, i) => s + (i.k_vyplate_czk || 0), 0),
                // Crypto split totals
                celkemFiatPayout: items.reduce((s, i) => s + (i.fiat_payout_czk || 0), 0),
                celkemCryptoPayout: items.reduce((s, i) => s + (i.crypto_payout_czk || 0), 0),
                cryptoEmployees: items.filter(i => i.crypto_payout_token && i.crypto_payout_token !== 'NONE').length,
                totalUsdcx: items.filter(i => i.crypto_payout_token === 'USDCx').reduce((s, i) => s + (i.crypto_payout_amount || 0), 0),
                totalAleo: items.filter(i => i.crypto_payout_token === 'ALEO').reduce((s, i) => s + (i.crypto_payout_amount || 0), 0),
            };
        }

        res.json({ period, items, summary });

    } catch (error) {
        console.error('Get period detail error:', error);
        res.status(500).json({ error: 'Chyba při načítání období' });
    }
});

// ====================================
// PUT /api/v2/payroll/items — Batch update payroll items (hours, bonus, srazka)
// ====================================
router.put('/items', [
    body('period_uuid').trim().notEmpty().withMessage('UUID období je povinné'),
    body('items').isArray({ min: 1 }).withMessage('Položky jsou povinné'),
    body('items.*.uuid').trim().notEmpty(),
    body('items.*.odpracovane_hodiny').optional().isFloat({ min: 0 }),
    body('items.*.absence_hodiny').optional().isFloat({ min: 0 }),
    body('items.*.bonus_czk').optional().isInt({ min: 0 }),
    body('items.*.srazka_czk').optional().isInt({ min: 0 }),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const period = await db.getOne(
            'SELECT * FROM payroll_periods WHERE uuid = ? AND company_id = ?',
            [req.body.period_uuid, companyId]
        );
        if (!period) return res.status(404).json({ error: 'Období nenalezeno' });
        if (period.status === 'locked') {
            return res.status(409).json({ error: 'Období je zamčené, nelze editovat' });
        }

        const { items } = req.body;
        let updated = 0;

        for (const item of items) {
            const sets = [];
            const vals = [];
            let paramIdx = 1;

            if (item.odpracovane_hodiny !== undefined) {
                sets.push(`odpracovane_hodiny = $${paramIdx++}`);
                vals.push(item.odpracovane_hodiny);
            }
            if (item.absence_hodiny !== undefined) {
                sets.push(`absence_hodiny = $${paramIdx++}`);
                vals.push(item.absence_hodiny);
            }
            if (item.bonus_czk !== undefined) {
                sets.push(`bonus_czk = $${paramIdx++}`);
                vals.push(item.bonus_czk);
            }
            if (item.srazka_czk !== undefined) {
                sets.push(`srazka_czk = $${paramIdx++}`);
                vals.push(item.srazka_czk);
            }

            if (sets.length > 0) {
                sets.push('updated_at = NOW()');
                sets.push(`status = 'draft'`); // Reset to draft when edited
                vals.push(item.uuid, period.id);
                await db.run(
                    `UPDATE payroll_items SET ${sets.join(', ')} WHERE uuid = $${paramIdx++} AND payroll_period_id = $${paramIdx}`,
                    vals
                );
                updated++;
            }
        }

        // Reset period status to draft if it was calculated
        if (period.status === 'calculated') {
            await db.run(
                `UPDATE payroll_periods SET status = 'draft', updated_at = NOW() WHERE id = ?`,
                [period.id]
            );
        }

        res.json({ success: true, updated });

    } catch (error) {
        console.error('Update items error:', error);
        res.status(500).json({ error: 'Chyba při aktualizaci položek' });
    }
});

// ====================================
// POST /api/v2/payroll/calculate — Run payroll calculation
// ====================================
router.post('/calculate', [
    body('period_uuid').trim().notEmpty().withMessage('UUID období je povinné'),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const period = await db.getOne(
            'SELECT * FROM payroll_periods WHERE uuid = ? AND company_id = ?',
            [req.body.period_uuid, companyId]
        );
        if (!period) return res.status(404).json({ error: 'Období nenalezeno' });
        if (period.status === 'locked') {
            return res.status(409).json({ error: 'Období je zamčené, nelze přepočítat' });
        }

        // Load tax params
        const taxParams = await loadTaxParams(period.year);

        // Load all items with employee data (including crypto preferences)
        const items = await db.getAll(`
            SELECT pi.*, e.id as emp_id, e.uuid as emp_uuid, e.name, e.typ_uvazku,
                   e.hruba_mzda_czk, e.uvazek_hodiny, e.aleo_address, e.bank_account,
                   e.podepsane_prohlaseni, e.pocet_deti, e.deti_ztp, e.invalidita, e.sleva_student,
                   COALESCE(e.stablecoin_pct, 0) as stablecoin_pct,
                   COALESCE(e.preferred_token, 'NONE') as preferred_token,
                   e.wallet_address, e.crypto_opt_in
            FROM payroll_items pi
            JOIN employees e ON pi.employee_id = e.id
            WHERE pi.payroll_period_id = ?
        `, [period.id]);

        // Prepare inputs for batch calculation
        const employees = items.map(item => ({
            id: item.emp_id,
            uuid: item.emp_uuid,
            name: item.name,
            typ_uvazku: item.typ_uvazku,
            hruba_mzda_czk: item.hruba_mzda_czk,
            uvazek_hodiny: item.uvazek_hodiny,
            aleo_address: item.aleo_address,
            bank_account: item.bank_account,
            podepsane_prohlaseni: !!item.podepsane_prohlaseni,
            pocet_deti: item.pocet_deti || 0,
            deti_ztp: item.deti_ztp || 0,
            invalidita: item.invalidita || 'none',
            sleva_student: !!item.sleva_student,
        }));

        const periodInputs = items.map(item => ({
            employee_id: item.emp_id,
            odpracovane_hodiny: item.odpracovane_hodiny,
            fond_hodin: item.fond_hodin,
            bonus: item.bonus_czk || 0,
            srazka: item.srazka_czk || 0,
        }));

        // Run calculation
        const result = calculateBatchPayroll(employees, periodInputs, taxParams, period.year, period.month);

        // ====================================
        // COMPLIANCE: Load absences & deductions for this period
        // ====================================
        const monthStart = `${period.year}-${String(period.month).padStart(2, '0')}-01`;
        const monthEnd = new Date(period.year, period.month, 0).toISOString().split('T')[0];

        // Load approved absences for this month (all employees)
        const absences = await db.getAll(`
            SELECT employee_id, type, work_days,
                   COALESCE(hours, work_days * 8) as hours,
                   sick_leave_day_number
            FROM absence_records
            WHERE company_id = ? AND status = 'approved'
                AND date_from <= ? AND date_to >= ?
        `, [companyId, monthEnd, monthStart]);

        // Index absences by employee_id
        const absenceMap = {};
        for (const a of absences) {
            if (!absenceMap[a.employee_id]) absenceMap[a.employee_id] = [];
            absenceMap[a.employee_id].push(a);
        }

        // Load active deductions for all employees in this company
        const activeDeductions = await db.getAll(`
            SELECT d.* FROM deductions d
            JOIN employees e ON d.employee_id = e.id
            WHERE d.company_id = ? AND d.is_active = 1
                AND d.effective_from <= ?
                AND (d.effective_to IS NULL OR d.effective_to >= ?)
            ORDER BY d.priority ASC
        `, [companyId, monthEnd, monthStart]);

        // Index deductions by employee_id
        const deductionMap = {};
        for (const d of activeDeductions) {
            if (!deductionMap[d.employee_id]) deductionMap[d.employee_id] = [];
            deductionMap[d.employee_id].push(d);
        }

        // Store results back into payroll_items (with compliance data)
        for (const calcItem of result.items) {
            const piRow = items.find(i => i.emp_id === calcItem.employee_id);
            if (!piRow) continue;

            // --- Absence processing ---
            const empAbsences = absenceMap[calcItem.employee_id] || [];
            let nahradaNemocCzk = 0;
            let dovolenadHodiny = 0;
            let totalAbsenceHours = 0;

            for (const abs of empAbsences) {
                totalAbsenceHours += abs.hours;
                if (abs.type === 'dovolena') {
                    dovolenadHodiny += abs.hours;
                }
                if (abs.type === 'nemoc') {
                    const sickResult = calculateSickLeaveCompensation(
                        piRow.hruba_mzda_czk,
                        piRow.fond_hodin,
                        abs.work_days,
                        abs.sick_leave_day_number || 1
                    );
                    nahradaNemocCzk += sickResult.nahradaNemoc;
                }
            }

            // --- Deduction processing ---
            const empDeductions = deductionMap[calcItem.employee_id] || [];
            const deductionResult = applyDeductions(calcItem.cistaMzda, empDeductions);
            const srazkyExekuce = deductionResult.appliedDeductions
                .filter(d => ['exekuce_prednostni', 'exekuce_neprednostni', 'insolvence', 'alimenty'].includes(d.type))
                .reduce((s, d) => s + d.amount, 0);
            const srazkyOstatni = deductionResult.appliedDeductions
                .filter(d => !['exekuce_prednostni', 'exekuce_neprednostni', 'insolvence', 'alimenty'].includes(d.type))
                .reduce((s, d) => s + d.amount, 0);

            // k výplatě = čistá mzda - srážky + náhrada nemoc
            const kVyplate = deductionResult.kVyplate + nahradaNemocCzk;

            // Employer liability insurance (per employee share)
            const zakonPojisteni = Math.round(calcItem.celkovaHruba * (taxParams.zakonne_pojisteni_rate || 0.0028));

            // Convert CZK to ALEO if rate is set (legacy, for backward compat)
            let cistaMzdaAleo = null;
            if (period.czk_aleo_rate && period.czk_aleo_rate > 0) {
                cistaMzdaAleo = czkToAleo(kVyplate, period.czk_aleo_rate);
            }

            // ====================================
            // CRYPTO/FIAT SPLIT (USDCx / ALEO)
            // ====================================
            const cryptoSplit = splitCryptoFiat({
                kVyplateCzk: kVyplate,
                stablecoinPct: piRow.crypto_opt_in ? (piRow.stablecoin_pct || 0) : 0,
                preferredToken: piRow.crypto_opt_in ? (piRow.preferred_token || 'NONE') : 'NONE',
                czkPerAleo: period.czk_aleo_rate || null,
                czkPerUsd: period.czk_usd_rate || null,
            });

            await db.run(`
                UPDATE payroll_items SET
                    zakladni_mzda_czk = ?,
                    celkova_hruba_czk = ?,
                    sp_zamestnanec = ?,
                    zp_zamestnanec = ?,
                    zaklad_dane = ?,
                    zaloha_dan = ?,
                    srazkova_dan = ?,
                    slevy_celkem = ?,
                    dan_po_slevach = ?,
                    danova_zvyhodneni = ?,
                    vysledek_dan = ?,
                    danovy_bonus = ?,
                    cista_mzda_czk = ?,
                    sp_zamestnavatel = ?,
                    zp_zamestnavatel = ?,
                    celkove_naklady = ?,
                    cista_mzda_aleo = ?,
                    srazky_exekuce_czk = ?,
                    srazky_ostatni_czk = ?,
                    nahrada_nemoc_czk = ?,
                    dovolena_hodiny = ?,
                    zakonne_pojisteni_czk = ?,
                    k_vyplate_czk = ?,
                    fiat_payout_czk = ?,
                    crypto_payout_czk = ?,
                    crypto_payout_amount = ?,
                    crypto_payout_token = ?,
                    czk_usd_rate = ?,
                    czk_aleo_rate = ?,
                    stablecoin_pct_snapshot = ?,
                    status = 'calculated',
                    updated_at = NOW()
                WHERE id = ?
            `, [
                calcItem.pomernaHruba || calcItem.celkovaOdmena || calcItem.celkovaHruba,
                calcItem.celkovaHruba,
                calcItem.spZamestnanec,
                calcItem.zpZamestnanec,
                calcItem.zakladDane,
                calcItem.zalohaDan || 0,
                calcItem.srazkovaDan || 0,
                calcItem.slevy,
                calcItem.danPoSlevach,
                calcItem.danovaZvyhodneni,
                calcItem.vysledkDan,
                calcItem.danovyBonus,
                calcItem.cistaMzda,
                calcItem.spZamestnavatel,
                calcItem.zpZamestnavatel,
                calcItem.celkoveNakladyZamestnavatel + zakonPojisteni,
                cistaMzdaAleo,
                srazkyExekuce,
                srazkyOstatni,
                nahradaNemocCzk,
                dovolenadHodiny,
                zakonPojisteni,
                kVyplate,
                cryptoSplit.fiatPayoutCzk,
                cryptoSplit.cryptoPayoutCzk,
                cryptoSplit.cryptoPayoutAmount,
                cryptoSplit.cryptoPayoutToken,
                period.czk_usd_rate || null,
                period.czk_aleo_rate || null,
                piRow.crypto_opt_in ? (piRow.stablecoin_pct || 0) : 0,
                piRow.id,
            ]);

            // Record deduction history
            for (const applied of deductionResult.appliedDeductions) {
                if (applied.amount > 0 && applied.id) {
                    const newTotal = (applied.total_deducted_czk || 0) + applied.amount;
                    await db.run(`
                        INSERT INTO deduction_history (deduction_id, payroll_item_id, payroll_period_id, amount_czk, running_total_czk)
                        VALUES (?, ?, ?, ?, ?)
                    `, [applied.id, piRow.id, period.id, applied.amount, newTotal]);

                    // Update running total on deduction
                    await db.run(
                        'UPDATE deductions SET total_deducted_czk = ?, updated_at = NOW() WHERE id = ?',
                        [newTotal, applied.id]
                    );
                }
            }
        }

        // Calculate employer liability insurance for summary
        const totalLiabilityInsurance = calculateLiabilityInsurance(
            result.summary.celkemHruba,
            taxParams.zakonne_pojisteni_rate || 0.0028
        );

        // Update period status
        await db.run(
            `UPDATE payroll_periods SET status = 'calculated', updated_at = NOW() WHERE id = ?`,
            [period.id]
        );

        await auditLog('PAYROLL_CALCULATED', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'payroll_period',
            resourceId: period.uuid,
            ip: req.ip,
            metadata: {
                year: period.year, month: period.month,
                employees: result.summary.employeeCount,
                totalHruba: result.summary.celkemHruba,
                totalCista: result.summary.celkemCista,
            },
        });

        res.json({
            success: true,
            summary: {
                ...result.summary,
                zakonePojisteni: totalLiabilityInsurance,
                celkoveNakladyVcPojisteni: result.summary.celkoveNakladyZamestnavatel + totalLiabilityInsurance,
            },
            errors: result.errors,
            items: result.items.map(i => ({
                employee_id: i.employee_id,
                employee_uuid: i.employee_uuid,
                employee_name: i.employee_name,
                typ_uvazku: i.typ_uvazku,
                celkovaHruba: i.celkovaHruba,
                cistaMzda: i.cistaMzda,
                spZamestnanec: i.spZamestnanec,
                zpZamestnanec: i.zpZamestnanec,
                vysledkDan: i.vysledkDan,
                danovyBonus: i.danovyBonus,
                spZamestnavatel: i.spZamestnavatel,
                zpZamestnavatel: i.zpZamestnavatel,
                celkoveNaklady: i.celkoveNakladyZamestnavatel,
            })),
        });

    } catch (error) {
        console.error('Calculate error:', error);
        res.status(500).json({ error: 'Chyba při výpočtu mezd' });
    }
});

// ====================================
// POST /api/v2/payroll/lock — Lock payroll period
// ====================================
router.post('/lock', [
    body('period_uuid').trim().notEmpty().withMessage('UUID období je povinné'),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const period = await db.getOne(
            'SELECT * FROM payroll_periods WHERE uuid = ? AND company_id = ?',
            [req.body.period_uuid, companyId]
        );
        if (!period) return res.status(404).json({ error: 'Období nenalezeno' });
        if (period.status === 'locked') {
            return res.status(409).json({ error: 'Období je již zamčené' });
        }
        if (period.status !== 'calculated') {
            return res.status(400).json({ error: 'Nejprve musíte spočítat mzdy' });
        }

        await db.run(
            `UPDATE payroll_periods SET status = 'locked', locked_at = NOW(), locked_by = ?, updated_at = NOW() WHERE id = ?`,
            [req.user.userId, period.id]
        );

        // Lock all items too
        await db.run(
            `UPDATE payroll_items SET status = 'locked', updated_at = NOW() WHERE payroll_period_id = ?`,
            [period.id]
        );

        await auditLog('PAYROLL_LOCKED', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'payroll_period',
            resourceId: period.uuid,
            ip: req.ip,
            metadata: { year: period.year, month: period.month },
        });

        res.json({ success: true, message: `Období ${period.month}/${period.year} zamčeno` });

    } catch (error) {
        console.error('Lock error:', error);
        res.status(500).json({ error: 'Chyba při zamykání období' });
    }
});

// ====================================
// POST /api/v2/payroll/aleo-payment — Record ALEO payment TX for an item
// 🔐 FIXED: Added role check + company_id verification to prevent cross-tenant writes
// ====================================
router.post('/aleo-payment', requireRole(['admin', 'employer']), [
    body('item_uuid').trim().notEmpty(),
    body('aleo_tx_id').trim().notEmpty(),
    body('status').isIn(['sent', 'confirmed', 'failed']),
    body('payment_token').optional().isIn(['ALEO', 'USDCx']).withMessage('Neplatný token'),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });
        const { item_uuid, aleo_tx_id, status, payment_token } = req.body;

        // 🔐 Only update items belonging to this company's payroll periods
        const result = await db.run(`
            UPDATE payroll_items SET aleo_tx_id = ?, aleo_payment_status = ?, updated_at = NOW()
            WHERE uuid = ? AND payroll_period_id IN (
                SELECT id FROM payroll_periods WHERE company_id = ?
            )
        `, [aleo_tx_id, status, item_uuid, companyId]);

        if (result.rowCount === 0) return res.status(404).json({ error: 'Položka nenalezena' });

        // Insert into crypto_payments audit table
        const item = await db.getOne(`
            SELECT pi.id, pi.employee_id, pi.crypto_payout_amount, pi.crypto_payout_token,
                   pi.crypto_payout_czk, pi.czk_usd_rate, pi.czk_aleo_rate,
                   e.wallet_address, e.aleo_address
            FROM payroll_items pi
            JOIN employees e ON pi.employee_id = e.id
            WHERE pi.uuid = ?
        `, [item_uuid]);

        if (item) {
            const token = payment_token || item.crypto_payout_token || 'ALEO';
            const recipientAddr = item.wallet_address || item.aleo_address;
            await db.run(`
                INSERT INTO crypto_payments (
                    uuid, payroll_item_id, employee_id, payment_token,
                    amount_base_units, amount_czk, exchange_rate,
                    tx_hash, tx_status, recipient_address
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                crypto.randomUUID(),
                item.id,
                item.employee_id,
                token,
                item.crypto_payout_amount || 0,
                item.crypto_payout_czk || 0,
                token === 'USDCx' ? (item.czk_usd_rate || 0) : (item.czk_aleo_rate || 0),
                aleo_tx_id,
                status,
                recipientAddr,
            ]);
        }

        res.json({ success: true });

    } catch (error) {
        console.error('ALEO payment update error:', error);
        res.status(500).json({ error: 'Chyba při zaznamenávání ALEO platby' });
    }
});

// ====================================
// GET /api/v2/payroll/tax-params/:year — Get tax parameters
// ====================================
router.get('/tax-params/:year', [
    param('year').isInt({ min: 2024, max: 2030 }),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const params = await loadTaxParams(parseInt(req.params.year));
        res.json({ params });
    } catch (error) {
        console.error('Get tax params error:', error);
        res.status(500).json({ error: 'Chyba při načítání daňových parametrů' });
    }
});

module.exports = router;
