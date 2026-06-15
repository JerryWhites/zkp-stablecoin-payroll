// ====================================
// 📊 Accounting & CZ System Export Routes
// ====================================
// Journal entries, chart of accounts, account mappings,
// Pohoda XML export, Money S3 export, ISDOC.

'use strict';

const express = require('express');
const { body, param, query } = require('express-validator');
const crypto = require('crypto');
const db = require('../db');
const { authenticateToken, requireRole, validate, auditLog } = require('../middleware/auth');
const {
    generateJournalEntries,
    generatePohodaXML,
    generateMoneyS3XML,
} = require('../services/payroll-engine');

const router = express.Router();
router.use(authenticateToken);

async function getCompanyId(userId) {
    const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [userId]);
    return user?.company_id;
}

// ====================================
// CHART OF ACCOUNTS (účtový rozvrh)
// ====================================

// GET /api/v2/accounting/chart — List chart of accounts
router.get('/chart', async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        // Get company-specific + default accounts
        const accounts = await db.getAll(`
            SELECT * FROM chart_of_accounts
            WHERE company_id IN (?, '__default__')
            ORDER BY account_number
        `, [companyId]);

        res.json({ accounts });
    } catch (error) {
        console.error('List chart of accounts error:', error);
        res.status(500).json({ error: 'Chyba při načítání účtového rozvrhu' });
    }
});

// POST /api/v2/accounting/chart — Add account to chart
router.post('/chart', [
    body('account_number').trim().notEmpty().withMessage('Číslo účtu je povinné'),
    body('name').trim().notEmpty().withMessage('Název účtu je povinný'),
    body('type').isIn(['asset', 'liability', 'equity', 'revenue', 'expense']),
    body('parent_account').optional().trim(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const uuid = crypto.randomUUID();
        await db.run(`
            INSERT INTO chart_of_accounts (uuid, company_id, account_number, name, type, parent_account)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [uuid, companyId, req.body.account_number, req.body.name, req.body.type, req.body.parent_account || null]);

        const account = await db.getOne('SELECT * FROM chart_of_accounts WHERE uuid = ?', [uuid]);
        res.status(201).json({ success: true, account });
    } catch (error) {
        console.error('Create account error:', error);
        if (error.message?.includes('unique') || error.message?.includes('duplicate')) {
            return res.status(409).json({ error: 'Účet s tímto číslem již existuje' });
        }
        res.status(500).json({ error: 'Chyba při vytváření účtu' });
    }
});

// ====================================
// ACCOUNT MAPPINGS (předkontace)
// ====================================

// GET /api/v2/accounting/mappings — List payroll account mappings
router.get('/mappings', async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const mappings = await db.getAll(
            'SELECT * FROM account_mappings WHERE company_id = ? AND is_active = 1 ORDER BY payroll_component',
            [companyId]
        );
        res.json({ mappings });
    } catch (error) {
        console.error('List mappings error:', error);
        res.status(500).json({ error: 'Chyba při načítání předkontací' });
    }
});

// POST /api/v2/accounting/mappings — Create account mapping
router.post('/mappings', [
    body('payroll_component').isIn([
        'gross_salary', 'sp_employee', 'zp_employee', 'tax',
        'sp_employer', 'zp_employer', 'net_salary',
        'meal_voucher_employer', 'meal_voucher_employee',
        'pension_contribution', 'life_insurance',
        'company_car_benefit', 'commission', 'bonus',
        'deduction', 'vacation_payout', 'severance',
        'sick_leave', 'other'
    ]).withMessage('Neplatná mzdová složka'),
    body('debit_account').trim().notEmpty(),
    body('credit_account').trim().notEmpty(),
    body('cost_center_code').optional().trim(),
    body('description').optional().trim(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const uuid = crypto.randomUUID();
        const { payroll_component, debit_account, credit_account, cost_center_code, description } = req.body;

        await db.run(`
            INSERT INTO account_mappings (uuid, company_id, payroll_component, debit_account, credit_account, cost_center_code, description)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [uuid, companyId, payroll_component, debit_account, credit_account, cost_center_code || null, description || null]);

        const mapping = await db.getOne('SELECT * FROM account_mappings WHERE uuid = ?', [uuid]);
        res.status(201).json({ success: true, mapping });
    } catch (error) {
        console.error('Create mapping error:', error);
        if (error.message?.includes('unique') || error.message?.includes('duplicate')) {
            return res.status(409).json({ error: 'Předkontace pro tuto složku již existuje' });
        }
        res.status(500).json({ error: 'Chyba při vytváření předkontace' });
    }
});

// POST /api/v2/accounting/mappings/seed-defaults — Seed default CZ payroll mappings
router.post('/mappings/seed-defaults', requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const defaults = [
            ['gross_salary', '521', '331', 'Hrubá mzda'],
            ['sp_employee', '331', '336', 'SP zaměstnanec'],
            ['zp_employee', '331', '336', 'ZP zaměstnanec'],
            ['tax', '331', '342', 'Záloha na daň z příjmů'],
            ['sp_employer', '524', '336', 'SP zaměstnavatel'],
            ['zp_employer', '524', '336', 'ZP zaměstnavatel'],
            ['net_salary', '331', '221', 'Výplata čisté mzdy'],
            ['meal_voucher_employer', '527', '213', 'Stravenky — zaměstnavatel'],
            ['pension_contribution', '527', '333', 'Příspěvek na penzijní připojištění'],
            ['life_insurance', '527', '333', 'Příspěvek na životní pojištění'],
            ['commission', '521', '331', 'Provize'],
            ['bonus', '521', '331', 'Bonus/prémie'],
            ['vacation_payout', '521', '331', 'Proplacení dovolené'],
            ['severance', '521', '331', 'Odstupné'],
            ['sick_leave', '521', '331', 'Nemocenská (náhrada mzdy)'],
        ];

        let created = 0;
        for (const [component, debit, credit, desc] of defaults) {
            try {
                const uuid = crypto.randomUUID();
                await db.run(`
                    INSERT INTO account_mappings (uuid, company_id, payroll_component, debit_account, credit_account, description)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT (company_id, payroll_component, cost_center_code) DO NOTHING
                `, [uuid, companyId, component, debit, credit, desc]);
                created++;
            } catch { /* already exists */ }
        }

        res.json({ success: true, created, message: `${created} výchozích předkontací vytvořeno` });
    } catch (error) {
        console.error('Seed mappings error:', error);
        res.status(500).json({ error: 'Chyba při vytváření výchozích předkontací' });
    }
});

// ====================================
// JOURNAL ENTRIES (účetní zápisy)
// ====================================

// GET /api/v2/accounting/journal — List journal entries
router.get('/journal', [
    query('year').optional().isInt({ min: 2020 }),
    query('month').optional().isInt({ min: 1, max: 12 }),
    query('status').optional().isIn(['draft', 'posted', 'exported', 'voided']),
], validate, async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        let sql = `SELECT * FROM journal_entries WHERE company_id = ?`;
        const params = [companyId];

        if (req.query.year) {
            sql += ` AND EXTRACT(YEAR FROM entry_date) = ?`;
            params.push(parseInt(req.query.year));
        }
        if (req.query.month) {
            sql += ` AND EXTRACT(MONTH FROM entry_date) = ?`;
            params.push(parseInt(req.query.month));
        }
        if (req.query.status) {
            sql += ` AND status = ?`;
            params.push(req.query.status);
        }

        sql += ` ORDER BY entry_date DESC`;
        const entries = await db.getAll(sql, params);

        res.json({ journal_entries: entries });
    } catch (error) {
        console.error('List journal entries error:', error);
        res.status(500).json({ error: 'Chyba při načítání účetních zápisů' });
    }
});

// GET /api/v2/accounting/journal/:uuid — Get journal entry with lines
router.get('/journal/:uuid', [
    param('uuid').trim().notEmpty(),
], validate, async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const entry = await db.getOne(
            'SELECT * FROM journal_entries WHERE uuid = ? AND company_id = ?',
            [req.params.uuid, companyId]
        );
        if (!entry) return res.status(404).json({ error: 'Účetní zápis nenalezen' });

        const lines = await db.getAll(
            'SELECT * FROM journal_entry_lines WHERE journal_entry_id = ? ORDER BY line_number',
            [entry.id]
        );

        res.json({ entry, lines });
    } catch (error) {
        console.error('Get journal entry error:', error);
        res.status(500).json({ error: 'Chyba při načítání účetního zápisu' });
    }
});

// POST /api/v2/accounting/journal/generate/:year/:month — Generate journal from payroll
router.post('/journal/generate/:year/:month', [
    param('year').isInt({ min: 2020 }),
    param('month').isInt({ min: 1, max: 12 }),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const year = parseInt(req.params.year);
        const month = parseInt(req.params.month);

        // Get payroll period
        const period = await db.getOne(
            'SELECT * FROM payroll_periods WHERE company_id = ? AND year = ? AND month = ?',
            [companyId, year, month]
        );
        if (!period) return res.status(404).json({ error: 'Mzdové období nenalezeno' });

        // Get all payroll items for this period
        const items = await db.getAll(
            'SELECT * FROM payroll_items WHERE payroll_period_id = ? AND company_id = ?',
            [period.id, companyId]
        );

        if (items.length === 0) {
            return res.status(400).json({ error: 'Žádné mzdové položky pro toto období' });
        }

        // Aggregate all items
        const totals = {
            celkovaHruba: 0, spZamestnanec: 0, zpZamestnanec: 0,
            vysledkDan: 0, cistaMzda: 0, spZamestnavatel: 0, zpZamestnavatel: 0,
        };

        for (const item of items) {
            totals.celkovaHruba += item.gross_salary || 0;
            totals.spZamestnanec += item.sp_employee || 0;
            totals.zpZamestnanec += item.zp_employee || 0;
            totals.vysledkDan += item.tax || 0;
            totals.cistaMzda += item.net_salary || 0;
            totals.spZamestnavatel += item.sp_employer || 0;
            totals.zpZamestnavatel += item.zp_employer || 0;
        }

        // Generate journal entries using engine
        const journalLines = generateJournalEntries(totals, {});

        // Save journal entry
        const entryUuid = crypto.randomUUID();
        const totalDebit = journalLines.reduce((s, l) => s + (l.amount || 0), 0);

        await db.run(`
            INSERT INTO journal_entries (
                uuid, company_id, payroll_period_id, entry_date,
                description, total_debit_czk, total_credit_czk, status, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?)
        `, [
            entryUuid, companyId, period.id,
            `${year}-${String(month).padStart(2, '0')}-01`,
            `Mzdové zápisy ${month}/${year}`,
            totalDebit, totalDebit, req.user.userId,
        ]);

        const savedEntry = await db.getOne('SELECT * FROM journal_entries WHERE uuid = ?', [entryUuid]);

        // Save lines
        for (let i = 0; i < journalLines.length; i++) {
            const line = journalLines[i];
            await db.run(`
                INSERT INTO journal_entry_lines (
                    journal_entry_id, line_number, account_number,
                    debit_czk, credit_czk, description, payroll_component
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
                savedEntry.id, i + 1,
                line.debitAccount, // For debit side
                line.amount, 0,
                line.description, line.component,
            ]);
            // Credit side
            await db.run(`
                INSERT INTO journal_entry_lines (
                    journal_entry_id, line_number, account_number,
                    debit_czk, credit_czk, description, payroll_component
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
                savedEntry.id, i + 1,
                line.creditAccount,
                0, line.amount,
                line.description, line.component,
            ]);
        }

        await auditLog('JOURNAL_GENERATED', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'journal_entry',
            resourceId: entryUuid,
            ip: req.ip,
            metadata: { year, month, lines: journalLines.length },
        });

        const lines = await db.getAll(
            'SELECT * FROM journal_entry_lines WHERE journal_entry_id = ? ORDER BY line_number',
            [savedEntry.id]
        );

        res.status(201).json({ success: true, entry: savedEntry, lines });
    } catch (error) {
        console.error('Generate journal error:', error);
        res.status(500).json({ error: 'Chyba při generování účetních zápisů' });
    }
});

// ====================================
// EXPORTS (Pohoda, Money S3)
// ====================================

// POST /api/v2/accounting/export/pohoda/:year/:month — Export to Pohoda XML
router.post('/export/pohoda/:year/:month', [
    param('year').isInt({ min: 2020 }),
    param('month').isInt({ min: 1, max: 12 }),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const year = parseInt(req.params.year);
        const month = parseInt(req.params.month);

        const company = await db.getOne('SELECT * FROM companies WHERE company_id = ?', [companyId]);
        if (!company) return res.status(404).json({ error: 'Firma nenalezena' });

        // Get journal entry for this period
        const journalEntry = await db.getOne(
            'SELECT * FROM journal_entries WHERE company_id = ? AND payroll_period_id IN (SELECT id FROM payroll_periods WHERE year = ? AND month = ? AND company_id = ?)',
            [companyId, year, month, companyId]
        );

        let entries = [];
        if (journalEntry) {
            const lines = await db.getAll(
                'SELECT * FROM journal_entry_lines WHERE journal_entry_id = ? AND debit_czk > 0 ORDER BY line_number',
                [journalEntry.id]
            );
            entries = lines.map(l => ({
                debitAccount: l.account_number,
                creditAccount: l.account_number, // Will be paired
                amount: l.debit_czk,
                description: l.description,
                costCenter: l.cost_center_code,
            }));
        } else {
            // Generate from payroll items directly
            const items = await db.getAll(`
                SELECT pi.* FROM payroll_items pi
                JOIN payroll_periods pp ON pi.payroll_period_id = pp.id
                WHERE pp.year = ? AND pp.month = ? AND pi.company_id = ?
            `, [year, month, companyId]);

            const totals = {
                celkovaHruba: items.reduce((s, i) => s + (i.gross_salary || 0), 0),
                spZamestnanec: items.reduce((s, i) => s + (i.sp_employee || 0), 0),
                zpZamestnanec: items.reduce((s, i) => s + (i.zp_employee || 0), 0),
                vysledkDan: items.reduce((s, i) => s + (i.tax || 0), 0),
                cistaMzda: items.reduce((s, i) => s + (i.net_salary || 0), 0),
                spZamestnavatel: items.reduce((s, i) => s + (i.sp_employer || 0), 0),
                zpZamestnavatel: items.reduce((s, i) => s + (i.zp_employer || 0), 0),
            };

            entries = generateJournalEntries(totals, {});
        }

        const xml = generatePohodaXML({
            companyICO: company.ico || '',
            companyName: company.name || '',
            periodYear: year,
            periodMonth: month,
            entries,
        });

        // Update journal entry status
        if (journalEntry) {
            await db.run(`
                UPDATE journal_entries SET status = 'exported', exported_to = 'pohoda',
                exported_at = NOW(), export_format = 'pohoda_xml' WHERE id = ?
            `, [journalEntry.id]);
        }

        await auditLog('ACCOUNTING_EXPORTED', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'accounting_export',
            ip: req.ip,
            metadata: { format: 'pohoda_xml', year, month },
        });

        res.set('Content-Type', 'application/xml');
        res.set('Content-Disposition', `attachment; filename="pohoda-mzdy-${year}-${String(month).padStart(2, '0')}.xml"`);
        res.send(xml);
    } catch (error) {
        console.error('Pohoda export error:', error);
        res.status(500).json({ error: 'Chyba při exportu do Pohoda' });
    }
});

// POST /api/v2/accounting/export/moneys3/:year/:month — Export to Money S3
router.post('/export/moneys3/:year/:month', [
    param('year').isInt({ min: 2020 }),
    param('month').isInt({ min: 1, max: 12 }),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const year = parseInt(req.params.year);
        const month = parseInt(req.params.month);

        const company = await db.getOne('SELECT * FROM companies WHERE company_id = ?', [companyId]);

        // Get payroll data
        const items = await db.getAll(`
            SELECT pi.* FROM payroll_items pi
            JOIN payroll_periods pp ON pi.payroll_period_id = pp.id
            WHERE pp.year = ? AND pp.month = ? AND pi.company_id = ?
        `, [year, month, companyId]);

        const totals = {
            celkovaHruba: items.reduce((s, i) => s + (i.gross_salary || 0), 0),
            spZamestnanec: items.reduce((s, i) => s + (i.sp_employee || 0), 0),
            zpZamestnanec: items.reduce((s, i) => s + (i.zp_employee || 0), 0),
            vysledkDan: items.reduce((s, i) => s + (i.tax || 0), 0),
            cistaMzda: items.reduce((s, i) => s + (i.net_salary || 0), 0),
            spZamestnavatel: items.reduce((s, i) => s + (i.sp_employer || 0), 0),
            zpZamestnavatel: items.reduce((s, i) => s + (i.zp_employer || 0), 0),
        };

        const entries = generateJournalEntries(totals, {});

        const xml = generateMoneyS3XML({
            companyICO: company?.ico || '',
            companyName: company?.name || '',
            periodYear: year,
            periodMonth: month,
            entries,
        });

        await auditLog('ACCOUNTING_EXPORTED', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'accounting_export',
            ip: req.ip,
            metadata: { format: 'money_s3', year, month },
        });

        res.set('Content-Type', 'application/xml');
        res.set('Content-Disposition', `attachment; filename="moneys3-mzdy-${year}-${String(month).padStart(2, '0')}.xml"`);
        res.send(xml);
    } catch (error) {
        console.error('Money S3 export error:', error);
        res.status(500).json({ error: 'Chyba při exportu do Money S3' });
    }
});

// POST /api/v2/accounting/export/csv/:year/:month — Export journal as CSV
router.post('/export/csv/:year/:month', [
    param('year').isInt({ min: 2020 }),
    param('month').isInt({ min: 1, max: 12 }),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const year = parseInt(req.params.year);
        const month = parseInt(req.params.month);

        const items = await db.getAll(`
            SELECT pi.* FROM payroll_items pi
            JOIN payroll_periods pp ON pi.payroll_period_id = pp.id
            WHERE pp.year = ? AND pp.month = ? AND pi.company_id = ?
        `, [year, month, companyId]);

        const totals = {
            celkovaHruba: items.reduce((s, i) => s + (i.gross_salary || 0), 0),
            spZamestnanec: items.reduce((s, i) => s + (i.sp_employee || 0), 0),
            zpZamestnanec: items.reduce((s, i) => s + (i.zp_employee || 0), 0),
            vysledkDan: items.reduce((s, i) => s + (i.tax || 0), 0),
            cistaMzda: items.reduce((s, i) => s + (i.net_salary || 0), 0),
            spZamestnavatel: items.reduce((s, i) => s + (i.sp_employer || 0), 0),
            zpZamestnavatel: items.reduce((s, i) => s + (i.zp_employer || 0), 0),
        };

        const entries = generateJournalEntries(totals, {});

        // CSV header
        let csv = 'Datum;Doklad;MD;DAL;Castka;Popis;Stredisko\n';
        const dateStr = `01.${String(month).padStart(2, '0')}.${year}`;
        const docNum = `MZ${year}${String(month).padStart(2, '0')}`;

        for (const e of entries) {
            csv += `${dateStr};${docNum};${e.debitAccount};${e.creditAccount};${e.amount};${e.description};${e.costCenter || ''}\n`;
        }

        res.set('Content-Type', 'text/csv; charset=utf-8');
        res.set('Content-Disposition', `attachment; filename="uctovani-mzdy-${year}-${String(month).padStart(2, '0')}.csv"`);
        res.send('\uFEFF' + csv); // BOM for Excel CZ
    } catch (error) {
        console.error('CSV export error:', error);
        res.status(500).json({ error: 'Chyba při CSV exportu' });
    }
});

module.exports = router;
