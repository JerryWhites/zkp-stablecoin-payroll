// ====================================
// 📋 Onboarding & Offboarding Routes
// ====================================
// Onboarding checklists, document management,
// offboarding calculations (zápočtový list, výpočet poslední mzdy).

'use strict';

const express = require('express');
const { body, param, query } = require('express-validator');
const crypto = require('crypto');
const db = require('../db');
const { authenticateToken, requireRole, validate, auditLog } = require('../middleware/auth');
const { calculateFinalPayment } = require('../services/payroll-engine');

const router = express.Router();
router.use(authenticateToken);

async function getCompanyId(userId) {
    const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [userId]);
    return user?.company_id;
}

// ====================================
// ONBOARDING TEMPLATES
// ====================================

// GET /api/v2/onboarding/templates — List onboarding templates
router.get('/templates', async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const templates = await db.getAll(
            'SELECT * FROM onboarding_templates WHERE company_id = ? AND is_active = 1 ORDER BY name',
            [companyId]
        );

        for (const t of templates) {
            try { t.checklist_items = JSON.parse(t.checklist_items || '[]'); } catch { t.checklist_items = []; }
        }

        res.json({ templates });
    } catch (error) {
        console.error('List onboarding templates error:', error);
        res.status(500).json({ error: 'Chyba při načítání šablon' });
    }
});

// POST /api/v2/onboarding/templates — Create onboarding template
router.post('/templates', [
    body('name').trim().notEmpty().withMessage('Název šablony je povinný'),
    body('description').optional().trim(),
    body('contract_type').optional().isIn(['HPP', 'DPP', 'DPC', 'all']),
    body('checklist_items').isArray({ min: 1 }).withMessage('Alespoň jedna položka checklistu'),
    body('checklist_items.*.title').trim().notEmpty(),
    body('checklist_items.*.required').optional().isBoolean(),
    body('checklist_items.*.category').optional().isIn(['document', 'access', 'equipment', 'training', 'admin', 'other']),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const uuid = crypto.randomUUID();
        const { name, description, contract_type = 'all', checklist_items } = req.body;

        // Add IDs to checklist items
        const items = checklist_items.map((item, idx) => ({
            id: idx + 1,
            title: item.title,
            required: item.required !== false,
            category: item.category || 'other',
            description: item.description || '',
        }));

        await db.run(`
            INSERT INTO onboarding_templates (uuid, company_id, name, description, contract_type, checklist_items)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [uuid, companyId, name, description || null, contract_type, JSON.stringify(items)]);

        const template = await db.getOne('SELECT * FROM onboarding_templates WHERE uuid = ?', [uuid]);
        try { template.checklist_items = JSON.parse(template.checklist_items); } catch { /* */ }
        res.status(201).json({ success: true, template });
    } catch (error) {
        console.error('Create onboarding template error:', error);
        res.status(500).json({ error: 'Chyba při vytváření šablony' });
    }
});

// ====================================
// EMPLOYEE ONBOARDING/OFFBOARDING PROCESSES
// ====================================

// POST /api/v2/onboarding/start — Start onboarding for employee
router.post('/start', [
    body('employee_uuid').trim().notEmpty(),
    body('template_uuid').optional().trim(),
    body('type').isIn(['onboarding', 'offboarding']).withMessage('Typ musí být onboarding nebo offboarding'),
    body('assigned_to_user_id').optional().isInt(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const employee = await db.getOne(
            'SELECT id, name FROM employees WHERE uuid = ? AND company_id = ?',
            [req.body.employee_uuid, companyId]
        );
        if (!employee) return res.status(404).json({ error: 'Zaměstnanec nenalezen' });

        let templateId = null;
        let checklistProgress = [];

        if (req.body.template_uuid) {
            const template = await db.getOne(
                'SELECT * FROM onboarding_templates WHERE uuid = ? AND company_id = ?',
                [req.body.template_uuid, companyId]
            );
            if (!template) return res.status(404).json({ error: 'Šablona nenalezena' });
            templateId = template.id;

            // Initialize checklist progress from template
            let items = [];
            try { items = JSON.parse(template.checklist_items || '[]'); } catch { items = []; }
            checklistProgress = items.map(item => ({
                ...item,
                completed: false,
                completed_at: null,
                completed_by: null,
                notes: '',
            }));
        } else if (req.body.type === 'onboarding') {
            // Default onboarding checklist for CZ payroll
            checklistProgress = getDefaultOnboardingChecklist();
        } else {
            checklistProgress = getDefaultOffboardingChecklist();
        }

        const uuid = crypto.randomUUID();
        await db.run(`
            INSERT INTO employee_onboarding (
                uuid, employee_id, company_id, template_id, type,
                checklist_progress, assigned_to
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            uuid, employee.id, companyId, templateId,
            req.body.type, JSON.stringify(checklistProgress),
            req.body.assigned_to_user_id || null,
        ]);

        await auditLog(`${req.body.type.toUpperCase()}_STARTED`, {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'onboarding',
            resourceId: uuid,
            ip: req.ip,
            metadata: { employee: employee.name, type: req.body.type },
        });

        const process = await db.getOne('SELECT * FROM employee_onboarding WHERE uuid = ?', [uuid]);
        try { process.checklist_progress = JSON.parse(process.checklist_progress); } catch { /* */ }
        res.status(201).json({ success: true, process });
    } catch (error) {
        console.error('Start onboarding error:', error);
        res.status(500).json({ error: 'Chyba při zahájení procesu' });
    }
});

// GET /api/v2/onboarding — List active onboarding/offboarding processes
router.get('/', [
    query('type').optional().isIn(['onboarding', 'offboarding']),
    query('status').optional().isIn(['not_started', 'in_progress', 'completed', 'cancelled']),
], validate, async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        let sql = `SELECT eo.*, e.name as employee_name, e.uuid as employee_uuid,
                          u.email as assigned_to_email
                   FROM employee_onboarding eo
                   JOIN employees e ON eo.employee_id = e.id
                   LEFT JOIN users u ON eo.assigned_to = u.id
                   WHERE eo.company_id = ?`;
        const params = [companyId];

        if (req.query.type) {
            sql += ` AND eo.type = ?`;
            params.push(req.query.type);
        }
        if (req.query.status) {
            sql += ` AND eo.status = ?`;
            params.push(req.query.status);
        }

        sql += ` ORDER BY eo.created_at DESC`;
        const processes = await db.getAll(sql, params);

        for (const p of processes) {
            try {
                p.checklist_progress = JSON.parse(p.checklist_progress || '[]');
                const total = p.checklist_progress.length;
                const completed = p.checklist_progress.filter(i => i.completed).length;
                p.progress_pct = total > 0 ? Math.round((completed / total) * 100) : 0;
            } catch {
                p.checklist_progress = [];
                p.progress_pct = 0;
            }
        }

        res.json({ processes });
    } catch (error) {
        console.error('List onboarding processes error:', error);
        res.status(500).json({ error: 'Chyba při načítání procesů' });
    }
});

// PUT /api/v2/onboarding/:uuid/checklist/:itemId — Update checklist item
router.put('/:uuid/checklist/:itemId', [
    param('uuid').trim().notEmpty(),
    param('itemId').isInt(),
    body('completed').isBoolean(),
    body('notes').optional().trim(),
], validate, async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const process = await db.getOne(
            'SELECT * FROM employee_onboarding WHERE uuid = ? AND company_id = ?',
            [req.params.uuid, companyId]
        );
        if (!process) return res.status(404).json({ error: 'Proces nenalezen' });
        if (process.status === 'completed' || process.status === 'cancelled') {
            return res.status(400).json({ error: 'Proces je již uzavřen' });
        }

        let checklist = [];
        try { checklist = JSON.parse(process.checklist_progress || '[]'); } catch { checklist = []; }

        const itemId = parseInt(req.params.itemId);
        const item = checklist.find(i => i.id === itemId);
        if (!item) return res.status(404).json({ error: 'Položka checklistu nenalezena' });

        item.completed = req.body.completed;
        item.completed_at = req.body.completed ? new Date().toISOString() : null;
        item.completed_by = req.body.completed ? req.user.email : null;
        if (req.body.notes) item.notes = req.body.notes;

        // Check if all required items are completed
        const allCompleted = checklist.filter(i => i.required).every(i => i.completed);
        const newStatus = allCompleted ? 'completed' : 'in_progress';

        await db.run(`
            UPDATE employee_onboarding SET checklist_progress = ?, status = ?,
            completed_at = ?, updated_at = NOW()
            WHERE uuid = ? AND company_id = ?
        `, [
            JSON.stringify(checklist),
            newStatus,
            allCompleted ? new Date().toISOString() : null,
            req.params.uuid, companyId,
        ]);

        const updated = await db.getOne('SELECT * FROM employee_onboarding WHERE uuid = ?', [req.params.uuid]);
        try { updated.checklist_progress = JSON.parse(updated.checklist_progress); } catch { /* */ }
        res.json({ success: true, process: updated, allCompleted });
    } catch (error) {
        console.error('Update checklist error:', error);
        res.status(500).json({ error: 'Chyba při aktualizaci checklistu' });
    }
});

// ====================================
// EMPLOYEE DOCUMENTS
// ====================================

// GET /api/v2/onboarding/documents/:employee_uuid — List employee documents
router.get('/documents/:employee_uuid', [
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

        const documents = await db.getAll(`
            SELECT ed.*, u.email as created_by_email
            FROM employee_documents ed
            LEFT JOIN users u ON ed.created_by = u.id
            WHERE ed.employee_id = ? AND ed.company_id = ?
            ORDER BY ed.created_at DESC
        `, [employee.id, companyId]);

        res.json({ documents });
    } catch (error) {
        console.error('List documents error:', error);
        res.status(500).json({ error: 'Chyba při načítání dokumentů' });
    }
});

// POST /api/v2/onboarding/documents — Create/generate document record
router.post('/documents', [
    body('employee_uuid').trim().notEmpty(),
    body('type').isIn([
        'contract', 'contract_amendment', 'dpp_agreement', 'dpc_agreement',
        'termination_notice', 'termination_agreement', 'zapoctovy_list',
        'employment_confirmation', 'tax_declaration', 'annual_tax_settlement',
        'medical_certificate', 'nda', 'other'
    ]).withMessage('Neplatný typ dokumentu'),
    body('name').trim().notEmpty().withMessage('Název dokumentu je povinný'),
    body('valid_from').optional().isDate(),
    body('valid_to').optional().isDate(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const employee = await db.getOne(
            'SELECT id, name, typ_uvazku, hruba_mzda_czk, nastup FROM employees WHERE uuid = ? AND company_id = ?',
            [req.body.employee_uuid, companyId]
        );
        if (!employee) return res.status(404).json({ error: 'Zaměstnanec nenalezen' });

        const uuid = crypto.randomUUID();
        const { type, name, valid_from, valid_to } = req.body;

        // Generate document data for specific types
        let generatedData = null;
        if (type === 'zapoctovy_list') {
            generatedData = JSON.stringify(await generateZapoctovyList(employee, companyId));
        } else if (type === 'employment_confirmation') {
            generatedData = JSON.stringify(await generateEmploymentConfirmation(employee, companyId));
        }

        await db.run(`
            INSERT INTO employee_documents (
                uuid, employee_id, company_id, type, name,
                valid_from, valid_to, generated_data, created_by, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
        `, [
            uuid, employee.id, companyId, type, name,
            valid_from || null, valid_to || null, generatedData,
            req.user.userId,
        ]);

        await auditLog('DOCUMENT_CREATED', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'employee_document',
            resourceId: uuid,
            ip: req.ip,
            metadata: { employee: employee.name, type },
        });

        const doc = await db.getOne('SELECT * FROM employee_documents WHERE uuid = ?', [uuid]);
        if (doc.generated_data) {
            try { doc.generated_data = JSON.parse(doc.generated_data); } catch { /* */ }
        }
        res.status(201).json({ success: true, document: doc });
    } catch (error) {
        console.error('Create document error:', error);
        res.status(500).json({ error: 'Chyba při vytváření dokumentu' });
    }
});

// ====================================
// OFFBOARDING CALCULATION
// ====================================

// POST /api/v2/onboarding/offboarding/calculate — Calculate final payment
router.post('/offboarding/calculate', [
    body('employee_uuid').trim().notEmpty(),
    body('termination_date').isDate().withMessage('Datum ukončení je povinné'),
    body('termination_type').isIn([
        'resignation', 'employer_notice', 'mutual_agreement',
        'immediate', 'probation', 'fixed_term_end', 'retirement'
    ]).withMessage('Neplatný typ ukončení'),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const employee = await db.getOne(
            'SELECT * FROM employees WHERE uuid = ? AND company_id = ?',
            [req.body.employee_uuid, companyId]
        );
        if (!employee) return res.status(404).json({ error: 'Zaměstnanec nenalezen' });

        const { termination_date, termination_type } = req.body;

        // Calculate years of service
        const startDate = new Date(employee.nastup || employee.created_at);
        const endDate = new Date(termination_date);
        const yearsOfService = Math.max(0, (endDate - startDate) / (365.25 * 24 * 3600 * 1000));

        // Get unused vacation days
        const vacResult = await db.getOne(`
            SELECT COALESCE(SUM(CASE WHEN type = 'dovolena' THEN days ELSE 0 END), 0) as used_days
            FROM vacation_requests
            WHERE employee_id = ? AND company_id = ? AND status = 'approved'
            AND EXTRACT(YEAR FROM start_date) = EXTRACT(YEAR FROM CURRENT_DATE)
        `, [employee.id, companyId]);

        const annualEntitlement = 20; // Standard CZ vacation
        const usedDays = vacResult?.used_days || 0;
        const unusedDays = Math.max(0, annualEntitlement - usedDays);

        // Average monthly salary (last 3 months or current)
        const avgSalary = employee.hruba_mzda_czk || 0;
        const dailySalary = avgSalary / 21; // Average working days per month

        const calculation = calculateFinalPayment({
            terminationType: termination_type,
            yearsOfService: Math.round(yearsOfService * 10) / 10,
            averageMonthlySalary: avgSalary,
            unusedVacationDays: unusedDays,
            dailySalary: Math.round(dailySalary),
            proratedBonus: 0,
            remainingDeductions: 0,
        });

        // Save calculation
        const uuid = crypto.randomUUID();
        await db.run(`
            INSERT INTO offboarding_calculations (
                uuid, employee_id, company_id, termination_date, termination_type,
                severance_months, severance_amount_czk,
                unused_vacation_days, vacation_payout_czk,
                final_salary_czk, total_final_payment_czk, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'calculated')
        `, [
            uuid, employee.id, companyId, termination_date, termination_type,
            calculation.severanceMonths, calculation.severanceAmountCzk,
            calculation.unusedVacationDays, calculation.vacationPayoutCzk,
            avgSalary, calculation.totalFinalPaymentCzk,
        ]);

        const saved = await db.getOne('SELECT * FROM offboarding_calculations WHERE uuid = ?', [uuid]);

        res.json({
            success: true,
            calculation,
            offboarding: saved,
            employee: { name: employee.name, yearsOfService: Math.round(yearsOfService * 10) / 10 },
        });
    } catch (error) {
        console.error('Offboarding calculation error:', error);
        res.status(500).json({ error: 'Chyba při výpočtu poslední mzdy' });
    }
});

// POST /api/v2/onboarding/offboarding/:uuid/approve — Approve offboarding
router.post('/offboarding/:uuid/approve', [
    param('uuid').trim().notEmpty(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const calc = await db.getOne(
            'SELECT * FROM offboarding_calculations WHERE uuid = ? AND company_id = ?',
            [req.params.uuid, companyId]
        );
        if (!calc) return res.status(404).json({ error: 'Výpočet nenalezen' });

        await db.run(`
            UPDATE offboarding_calculations SET status = 'approved', approved_by = ?, approved_at = NOW(), updated_at = NOW()
            WHERE uuid = ? AND company_id = ?
        `, [req.user.userId, req.params.uuid, companyId]);

        // Auto-generate zápočtový list
        const employee = await db.getOne('SELECT * FROM employees WHERE id = ?', [calc.employee_id]);
        const docUuid = crypto.randomUUID();
        const zapData = await generateZapoctovyList(employee, companyId);

        await db.run(`
            INSERT INTO employee_documents (uuid, employee_id, company_id, type, name, generated_data, created_by, status)
            VALUES (?, ?, ?, 'zapoctovy_list', 'Zápočtový list', ?, ?, 'draft')
        `, [docUuid, calc.employee_id, companyId, JSON.stringify(zapData), req.user.userId]);

        await auditLog('OFFBOARDING_APPROVED', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'offboarding',
            resourceId: req.params.uuid,
            ip: req.ip,
        });

        res.json({ success: true, message: 'Offboarding schválen, zápočtový list vygenerován', document_uuid: docUuid });
    } catch (error) {
        console.error('Approve offboarding error:', error);
        res.status(500).json({ error: 'Chyba při schvalování offboardingu' });
    }
});

// ====================================
// HELPERS — Document generators
// ====================================

async function generateZapoctovyList(employee, companyId) {
    const company = await db.getOne('SELECT * FROM companies WHERE company_id = ?', [companyId]);

    return {
        type: 'zapoctovy_list',
        generatedAt: new Date().toISOString(),
        company: {
            name: company?.name || '',
            ico: company?.ico || '',
            address: company?.address || '',
        },
        employee: {
            name: employee.name,
            osobniCislo: employee.osobni_cislo || '',
            datumNastupu: employee.nastup || '',
            datumUkonceni: employee.ukonceni || new Date().toISOString().split('T')[0],
            typUvazku: employee.typ_uvazku || 'HPP',
        },
        employment: {
            position: employee.position_title || '',
            grossSalaryCzk: employee.hruba_mzda_czk || 0,
        },
        note: 'Tento zápočtový list byl vygenerován automaticky systémem CZKP Payroll.',
    };
}

async function generateEmploymentConfirmation(employee, companyId) {
    const company = await db.getOne('SELECT * FROM companies WHERE company_id = ?', [companyId]);

    return {
        type: 'employment_confirmation',
        generatedAt: new Date().toISOString(),
        company: {
            name: company?.name || '',
            ico: company?.ico || '',
        },
        employee: {
            name: employee.name,
            typUvazku: employee.typ_uvazku || 'HPP',
            datumNastupu: employee.nastup || '',
            isActive: employee.status === 'active',
        },
        note: 'Potvrzení o zaměstnání vygenerováno systémem CZKP Payroll.',
    };
}

function getDefaultOnboardingChecklist() {
    return [
        { id: 1, title: 'Pracovní smlouva podepsána', required: true, category: 'document', completed: false },
        { id: 2, title: 'Prohlášení poplatníka (růžové)', required: false, category: 'document', completed: false },
        { id: 3, title: 'Kopie občanského průkazu', required: true, category: 'document', completed: false },
        { id: 4, title: 'Vstupní lékařská prohlídka', required: true, category: 'document', completed: false },
        { id: 5, title: 'Číslo bankovního účtu', required: true, category: 'admin', completed: false },
        { id: 6, title: 'Registrace u zdravotní pojišťovny', required: true, category: 'admin', completed: false },
        { id: 7, title: 'Přihlášení na OSSZ', required: true, category: 'admin', completed: false },
        { id: 8, title: 'Přístupy do systémů (email, VPN)', required: false, category: 'access', completed: false },
        { id: 9, title: 'Vybavení pracoviště (notebook, telefon)', required: false, category: 'equipment', completed: false },
        { id: 10, title: 'BOZP školení', required: true, category: 'training', completed: false },
        { id: 11, title: 'Seznámení s interními předpisy', required: true, category: 'training', completed: false },
        { id: 12, title: 'NDA / smlouva o mlčenlivosti', required: false, category: 'document', completed: false },
    ];
}

function getDefaultOffboardingChecklist() {
    return [
        { id: 1, title: 'Výpovědní lhůta uplynula', required: true, category: 'admin', completed: false },
        { id: 2, title: 'Předání práce nástupci', required: false, category: 'admin', completed: false },
        { id: 3, title: 'Vrácení vybavení (notebook, telefon, klíče)', required: true, category: 'equipment', completed: false },
        { id: 4, title: 'Odebrání přístupů (email, VPN, systémy)', required: true, category: 'access', completed: false },
        { id: 5, title: 'Výstupní lékařská prohlídka', required: false, category: 'document', completed: false },
        { id: 6, title: 'Zápočtový list vygenerován', required: true, category: 'document', completed: false },
        { id: 7, title: 'Potvrzení o zaměstnání', required: true, category: 'document', completed: false },
        { id: 8, title: 'Potvrzení o zdanitelných příjmech', required: true, category: 'document', completed: false },
        { id: 9, title: 'Proplacení nevyčerpané dovolené', required: true, category: 'admin', completed: false },
        { id: 10, title: 'Odhlášení z OSSZ a ZP', required: true, category: 'admin', completed: false },
        { id: 11, title: 'Archivace osobního spisu', required: true, category: 'admin', completed: false },
    ];
}

module.exports = router;
