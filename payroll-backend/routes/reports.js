// ====================================
// 📊 Custom Report Builder Route Module
// ====================================
// Configurable report templates + generation
// Tier requirement: customReports feature (Business+)

'use strict';

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { body, param, query } = require('express-validator');
const { authenticateToken, requireRole, validate, auditLog, logger } = require('../middleware/auth');
const db = require('../db');

// ====================================
// COLUMN DEFINITIONS PER DATA SOURCE
// ====================================
const DATA_SOURCE_COLUMNS = {
    payroll_items: {
        label: 'Mzdové položky',
        columns: {
            'employee_name': { label: 'Jméno zaměstnance', type: 'text', join: 'employees.name' },
            'osobni_cislo': { label: 'Osobní číslo', type: 'text', join: 'employees.osobni_cislo' },
            'typ_uvazku': { label: 'Typ úvazku', type: 'text', join: 'employees.typ_uvazku' },
            'year': { label: 'Rok', type: 'number', join: 'payroll_periods.year' },
            'month': { label: 'Měsíc', type: 'number', join: 'payroll_periods.month' },
            'odpracovane_hodiny': { label: 'Odpracované hodiny', type: 'number' },
            'celkova_hruba_czk': { label: 'Hrubá mzda', type: 'currency' },
            'sp_zamestnanec': { label: 'SP zaměstnanec', type: 'currency' },
            'zp_zamestnanec': { label: 'ZP zaměstnanec', type: 'currency' },
            'sp_zamestnavatel': { label: 'SP zaměstnavatel', type: 'currency' },
            'zp_zamestnavatel': { label: 'ZP zaměstnavatel', type: 'currency' },
            'zaloha_dan': { label: 'Záloha na daň', type: 'currency' },
            'slevy_celkem': { label: 'Slevy celkem', type: 'currency' },
            'dan_po_slevach': { label: 'Daň po slevách', type: 'currency' },
            'cista_mzda_czk': { label: 'Čistá mzda', type: 'currency' },
            'celkove_naklady': { label: 'Celkové náklady', type: 'currency' },
            'bonus_czk': { label: 'Bonus', type: 'currency' },
            'srazka_czk': { label: 'Srážka', type: 'currency' },
            'status': { label: 'Stav', type: 'text' },
        }
    },
    employees: {
        label: 'Zaměstnanci',
        columns: {
            'name': { label: 'Jméno', type: 'text' },
            'email': { label: 'Email', type: 'text' },
            'osobni_cislo': { label: 'Osobní číslo', type: 'text' },
            'typ_uvazku': { label: 'Typ úvazku', type: 'text' },
            'hruba_mzda_czk': { label: 'Hrubá mzda', type: 'currency' },
            'nastup': { label: 'Datum nástupu', type: 'date' },
            'ukonceni': { label: 'Datum ukončení', type: 'date' },
            'status': { label: 'Stav', type: 'text' },
            'zp_code': { label: 'Zdravotní pojišťovna', type: 'text' },
            'uvazek_hodiny': { label: 'Úvazek (hod/týden)', type: 'number' },
        }
    },
    payroll_periods: {
        label: 'Mzdová období',
        columns: {
            'year': { label: 'Rok', type: 'number' },
            'month': { label: 'Měsíc', type: 'number' },
            'status': { label: 'Stav', type: 'text' },
            'locked_at': { label: 'Uzamčeno', type: 'date' },
            'employee_count': { label: 'Počet zaměstnanců', type: 'number', computed: true },
            'total_hruba': { label: 'Celkem hrubá', type: 'currency', computed: true },
            'total_cista': { label: 'Celkem čistá', type: 'currency', computed: true },
            'total_naklady': { label: 'Celkové náklady', type: 'currency', computed: true },
        }
    },
    deductions: {
        label: 'Srážky',
        columns: {
            'employee_name': { label: 'Zaměstnanec', type: 'text', join: 'employees.name' },
            'type': { label: 'Typ srážky', type: 'text' },
            'amount_czk': { label: 'Částka', type: 'currency' },
            'priority': { label: 'Priorita', type: 'number' },
            'status': { label: 'Stav', type: 'text' },
            'creditor_name': { label: 'Věřitel', type: 'text' },
        }
    },
    vacations: {
        label: 'Dovolené',
        columns: {
            'employee_name': { label: 'Zaměstnanec', type: 'text', join: 'employees.name' },
            'year': { label: 'Rok', type: 'number' },
            'entitlement_days': { label: 'Nárok (dní)', type: 'number' },
            'used_days': { label: 'Vyčerpáno', type: 'number' },
            'remaining_days': { label: 'Zbývá', type: 'number' },
        }
    },
    audit_log: {
        label: 'Audit log',
        columns: {
            'timestamp': { label: 'Čas', type: 'date' },
            'user_email': { label: 'Uživatel', type: 'text' },
            'action': { label: 'Akce', type: 'text' },
            'resource_type': { label: 'Typ zdroje', type: 'text' },
            'ip_address': { label: 'IP', type: 'text' },
        }
    }
};

// ====================================
// QUERY BUILDER (safe, parameterized)
// ====================================

function buildReportQuery(template, companyId) {
    const source = template.data_source;
    const columns = JSON.parse(template.columns || '[]');
    const filters = JSON.parse(template.filters || '[]');
    const params = [];

    // Validate columns against whitelist
    const validCols = DATA_SOURCE_COLUMNS[source]?.columns || {};
    const selectedCols = columns.length > 0 ? columns.filter(c => validCols[c]) : Object.keys(validCols);

    let selectParts = [];
    let joins = [];
    let baseTable;

    switch (source) {
        case 'payroll_items':
            baseTable = 'payroll_items pi';
            joins.push('JOIN payroll_periods pp ON pi.payroll_period_id = pp.id');
            joins.push('JOIN employees e ON pi.employee_id = e.id');
            
            for (const col of selectedCols) {
                const def = validCols[col];
                if (col === 'employee_name') selectParts.push('e.name AS employee_name');
                else if (col === 'osobni_cislo') selectParts.push('e.osobni_cislo');
                else if (col === 'typ_uvazku') selectParts.push('e.typ_uvazku');
                else if (col === 'year') selectParts.push('pp.year');
                else if (col === 'month') selectParts.push('pp.month');
                else selectParts.push(`pi.${col}`);
            }
            params.push(companyId);
            break;

        case 'employees':
            baseTable = 'employees e';
            for (const col of selectedCols) selectParts.push(`e.${col}`);
            params.push(companyId);
            break;

        case 'payroll_periods':
            baseTable = 'payroll_periods pp';
            selectParts = ['pp.year', 'pp.month', 'pp.status', 'pp.locked_at'];
            if (selectedCols.includes('employee_count')) {
                selectParts.push('(SELECT COUNT(*) FROM payroll_items WHERE payroll_period_id = pp.id) AS employee_count');
            }
            if (selectedCols.includes('total_hruba')) {
                selectParts.push('(SELECT COALESCE(SUM(celkova_hruba_czk), 0) FROM payroll_items WHERE payroll_period_id = pp.id) AS total_hruba');
            }
            if (selectedCols.includes('total_cista')) {
                selectParts.push('(SELECT COALESCE(SUM(cista_mzda_czk), 0) FROM payroll_items WHERE payroll_period_id = pp.id) AS total_cista');
            }
            if (selectedCols.includes('total_naklady')) {
                selectParts.push('(SELECT COALESCE(SUM(celkove_naklady), 0) FROM payroll_items WHERE payroll_period_id = pp.id) AS total_naklady');
            }
            params.push(companyId);
            break;

        case 'deductions':
            baseTable = 'deductions d';
            joins.push('JOIN employees e ON d.employee_id = e.id');
            for (const col of selectedCols) {
                if (col === 'employee_name') selectParts.push('e.name AS employee_name');
                else selectParts.push(`d.${col}`);
            }
            params.push(companyId);
            break;

        case 'vacations':
            baseTable = 'vacation_entitlements ve';
            joins.push('JOIN employees e ON ve.employee_id = e.id');
            for (const col of selectedCols) {
                if (col === 'employee_name') selectParts.push('e.name AS employee_name');
                else selectParts.push(`ve.${col}`);
            }
            params.push(companyId);
            break;

        case 'audit_log':
            baseTable = 'audit_log al';
            for (const col of selectedCols) selectParts.push(`al.${col}`);
            // Filter by user's company via user_id
            params.push(companyId);
            break;

        default:
            throw new Error('Neplatný zdroj dat');
    }

    if (selectParts.length === 0) selectParts.push('*');

    let sql = `SELECT ${selectParts.join(', ')} FROM ${baseTable}`;
    if (joins.length) sql += ' ' + joins.join(' ');

    // Company filter
    const companyColumn = source === 'payroll_items' ? 'pp.company_id'
        : source === 'payroll_periods' ? 'pp.company_id'
        : source === 'deductions' ? 'e.company_id'
        : source === 'vacations' ? 'e.company_id'
        : source === 'audit_log' ? 'al.user_id IN (SELECT id FROM users WHERE company_id = ?'
        : 'e.company_id';

    if (source === 'audit_log') {
        sql += ` WHERE al.user_id IN (SELECT id FROM users WHERE company_id = ?)`;
    } else {
        sql += ` WHERE ${companyColumn} = ?`;
    }

    // Apply filters
    for (const filter of filters) {
        if (!validCols[filter.column]) continue;
        const colRef = source === 'payroll_items' && ['year', 'month'].includes(filter.column) ? `pp.${filter.column}` :
            filter.column === 'employee_name' ? 'e.name' : filter.column;

        switch (filter.operator) {
            case 'eq': sql += ` AND ${colRef} = ?`; params.push(filter.value); break;
            case 'neq': sql += ` AND ${colRef} != ?`; params.push(filter.value); break;
            case 'gt': sql += ` AND ${colRef} > ?`; params.push(filter.value); break;
            case 'gte': sql += ` AND ${colRef} >= ?`; params.push(filter.value); break;
            case 'lt': sql += ` AND ${colRef} < ?`; params.push(filter.value); break;
            case 'lte': sql += ` AND ${colRef} <= ?`; params.push(filter.value); break;
            case 'contains': sql += ` AND ${colRef} ILIKE ?`; params.push(`%${filter.value}%`); break;
        }
    }

    // Group by
    if (template.group_by && validCols[template.group_by]) {
        sql += ` GROUP BY ${template.group_by}`;
    }

    // Sort
    if (template.sort_by && validCols[template.sort_by]) {
        const order = template.sort_order === 'desc' ? 'DESC' : 'ASC';
        sql += ` ORDER BY ${template.sort_by} ${order}`;
    }

    // Limit
    sql += ' LIMIT 10000';

    return { sql, params };
}

// ====================================
// ROUTES
// ====================================

// GET /api/v2/reports/sources — Available data sources and columns
router.get('/sources', authenticateToken, (req, res) => {
    const sources = {};
    for (const [key, val] of Object.entries(DATA_SOURCE_COLUMNS)) {
        sources[key] = {
            label: val.label,
            columns: Object.entries(val.columns).map(([k, v]) => ({
                key: k, label: v.label, type: v.type
            }))
        };
    }
    res.json({ sources });
});

// GET /api/v2/reports/templates — List saved templates
router.get('/templates', authenticateToken, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
        const templates = await db.getAll(`
            SELECT rt.*, u.email as created_by_email
            FROM report_templates rt
            JOIN users u ON rt.created_by = u.id
            WHERE rt.company_id = ? OR rt.is_public = 1
            ORDER BY rt.created_at DESC
        `, [user.company_id]);

        res.json({ templates });
    } catch (error) {
        logger.error('List templates error', { error: error.message });
        res.status(500).json({ error: 'Nepodařilo se načíst šablony' });
    }
});

// POST /api/v2/reports/templates — Create template
router.post('/templates',
    authenticateToken,
    requireRole(['admin', 'employer']),
    body('name').trim().isLength({ min: 1, max: 200 }).withMessage('Název je povinný'),
    body('data_source').isIn(Object.keys(DATA_SOURCE_COLUMNS)).withMessage('Neplatný zdroj dat'),
    body('columns').isArray({ min: 1 }).withMessage('Vyberte alespoň 1 sloupec'),
    body('type').optional().isIn(['table', 'summary', 'chart', 'pdf']),
    body('filters').optional().isArray(),
    body('sort_by').optional().isString(),
    body('sort_order').optional().isIn(['asc', 'desc']),
    body('group_by').optional().isString(),
    body('chart_type').optional().isIn(['bar', 'line', 'pie', 'doughnut']),
    body('description').optional().isString(),
    validate,
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
            const uuid = crypto.randomUUID();
            const { name, data_source, columns, type = 'table', filters = [], sort_by, sort_order = 'asc', group_by, chart_type, description } = req.body;

            // Validate columns against source
            const validCols = DATA_SOURCE_COLUMNS[data_source]?.columns || {};
            const invalidCols = columns.filter(c => !validCols[c]);
            if (invalidCols.length > 0) {
                return res.status(400).json({ error: `Neplatné sloupce: ${invalidCols.join(', ')}` });
            }

            await db.run(`
                INSERT INTO report_templates (uuid, company_id, created_by, name, description, type, data_source, columns, filters, group_by, sort_by, sort_order, chart_type)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [uuid, user.company_id, req.user.userId, name, description, type, data_source,
                JSON.stringify(columns), JSON.stringify(filters), group_by, sort_by, sort_order, chart_type]);

            const template = await db.getOne('SELECT * FROM report_templates WHERE uuid = ?', [uuid]);

            await auditLog('REPORT_TEMPLATE_CREATED', {
                userId: req.user.userId,
                userEmail: req.user.email,
                resourceType: 'report_template',
                resourceId: uuid,
                ip: req.ip,
                metadata: { name, data_source }
            });

            res.status(201).json({ template });
        } catch (error) {
            logger.error('Create template error', { error: error.message });
            res.status(500).json({ error: 'Nepodařilo se vytvořit šablonu' });
        }
    }
);

// PUT /api/v2/reports/templates/:uuid — Update template
router.put('/templates/:uuid',
    authenticateToken,
    requireRole(['admin', 'employer']),
    param('uuid').isUUID(),
    body('name').optional().trim().isLength({ min: 1, max: 200 }),
    body('columns').optional().isArray({ min: 1 }),
    body('filters').optional().isArray(),
    body('sort_by').optional().isString(),
    body('sort_order').optional().isIn(['asc', 'desc']),
    body('group_by').optional(),
    body('chart_type').optional(),
    body('description').optional(),
    validate,
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
            const template = await db.getOne('SELECT * FROM report_templates WHERE uuid = ? AND company_id = ?', [req.params.uuid, user.company_id]);
            if (!template) return res.status(404).json({ error: 'Šablona nenalezena' });

            const updates = [];
            const params = [];
            const allowedFields = ['name', 'description', 'type', 'columns', 'filters', 'sort_by', 'sort_order', 'group_by', 'chart_type'];
            for (const f of allowedFields) {
                if (req.body[f] !== undefined) {
                    updates.push(`${f} = ?`);
                    params.push(Array.isArray(req.body[f]) ? JSON.stringify(req.body[f]) : req.body[f]);
                }
            }
            if (updates.length === 0) return res.status(400).json({ error: 'Žádné změny' });

            params.push(req.params.uuid, user.company_id);
            await db.run(`UPDATE report_templates SET ${updates.join(', ')}, updated_at = NOW() WHERE uuid = ? AND company_id = ?`, params);

            res.json({ message: 'Šablona aktualizována' });
        } catch (error) {
            logger.error('Update template error', { error: error.message });
            res.status(500).json({ error: 'Nepodařilo se aktualizovat šablonu' });
        }
    }
);

// DELETE /api/v2/reports/templates/:uuid
router.delete('/templates/:uuid',
    authenticateToken,
    requireRole(['admin', 'employer']),
    param('uuid').isUUID(),
    validate,
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
            const result = await db.run('DELETE FROM report_templates WHERE uuid = ? AND company_id = ?', [req.params.uuid, user.company_id]);
            if (result.rowCount === 0) return res.status(404).json({ error: 'Šablona nenalezena' });

            res.json({ message: 'Šablona smazána' });
        } catch (error) {
            logger.error('Delete template error', { error: error.message });
            res.status(500).json({ error: 'Nepodařilo se smazat šablonu' });
        }
    }
);

// POST /api/v2/reports/generate — Generate report from template or ad-hoc
router.post('/generate',
    authenticateToken,
    requireRole(['admin', 'employer']),
    body('template_uuid').optional().isUUID(),
    body('data_source').optional().isIn(Object.keys(DATA_SOURCE_COLUMNS)),
    body('columns').optional().isArray(),
    body('filters').optional().isArray(),
    body('format').optional().isIn(['json', 'csv']),
    validate,
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
            let template;

            if (req.body.template_uuid) {
                template = await db.getOne('SELECT * FROM report_templates WHERE uuid = ? AND (company_id = ? OR is_public = 1)', [req.body.template_uuid, user.company_id]);
                if (!template) return res.status(404).json({ error: 'Šablona nenalezena' });
            } else if (req.body.data_source) {
                // Ad-hoc report
                template = {
                    data_source: req.body.data_source,
                    columns: JSON.stringify(req.body.columns || []),
                    filters: JSON.stringify(req.body.filters || []),
                    sort_by: req.body.sort_by,
                    sort_order: req.body.sort_order || 'asc',
                    group_by: req.body.group_by
                };
            } else {
                return res.status(400).json({ error: 'Zadejte template_uuid nebo data_source' });
            }

            const { sql, params: queryParams } = buildReportQuery(template, user.company_id);
            const rows = await db.getAll(sql, queryParams);

            // Column metadata
            const source = template.data_source;
            const validCols = DATA_SOURCE_COLUMNS[source]?.columns || {};
            const cols = JSON.parse(template.columns || '[]');
            const selectedCols = cols.length > 0 ? cols : Object.keys(validCols);
            const columnMeta = selectedCols.map(c => ({ key: c, ...(validCols[c] || {}) }));

            const format = req.body.format || 'json';

            if (format === 'csv') {
                const header = columnMeta.map(c => c.label).join(';');
                const csvRows = rows.map(r => selectedCols.map(c => r[c] ?? '').join(';'));
                const csvContent = [header, ...csvRows].join('\n');

                res.setHeader('Content-Type', 'text/csv; charset=utf-8');
                res.setHeader('Content-Disposition', `attachment; filename="report-${Date.now()}.csv"`);
                return res.send('\uFEFF' + csvContent);
            }

            // Save generated report record
            const reportUuid = crypto.randomUUID();
            await db.run(`
                INSERT INTO generated_reports (uuid, template_id, company_id, generated_by, name, format, row_count, parameters, expires_at)
                VALUES (?, ?, ?, ?, ?, 'json', ?, ?, NOW() + INTERVAL '30 days')
            `, [reportUuid, template.id || null, user.company_id, req.user.userId,
                template.name || 'Ad-hoc report', rows.length, JSON.stringify(req.body)]);

            // Update last generated
            if (template.id) {
                await db.run('UPDATE report_templates SET last_generated_at = NOW() WHERE id = ?', [template.id]);
            }

            res.json({
                report: {
                    uuid: reportUuid,
                    row_count: rows.length,
                    columns: columnMeta,
                    data: rows
                }
            });
        } catch (error) {
            logger.error('Generate report error', { error: error.message, stack: error.stack });
            res.status(500).json({ error: 'Nepodařilo se vygenerovat report' });
        }
    }
);

// GET /api/v2/reports/history — Generated reports history
router.get('/history', authenticateToken, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
        const reports = await db.getAll(`
            SELECT gr.uuid, gr.name, gr.format, gr.row_count, gr.created_at,
                   u.email as generated_by_email,
                   rt.name as template_name
            FROM generated_reports gr
            LEFT JOIN report_templates rt ON gr.template_id = rt.id
            JOIN users u ON gr.generated_by = u.id
            WHERE gr.company_id = ?
            ORDER BY gr.created_at DESC
            LIMIT 100
        `, [user.company_id]);

        res.json({ reports });
    } catch (error) {
        logger.error('Report history error', { error: error.message });
        res.status(500).json({ error: 'Nepodařilo se načíst historii reportů' });
    }
});

module.exports = router;
