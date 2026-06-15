// ====================================
// 👤 Employee Self-Service Portal Routes
// ====================================
// Employee-facing endpoints for viewing payslips, requesting
// vacation, updating personal data, accessing documents,
// and manager dashboard.

'use strict';

const express = require('express');
const { body, param, query } = require('express-validator');
const db = require('../db');
const { authenticateToken, requireRole, validate, auditLog } = require('../middleware/auth');
const { decryptEmployeeData, getOrCreateCompanyKey } = require('../services/encryption');

const router = express.Router();
router.use(authenticateToken);

async function getCompanyId(userId) {
    const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [userId]);
    return user?.company_id;
}

/** Get the employee linked to this user account */
async function getLinkedEmployee(userId) {
    const user = await db.getOne('SELECT employee_id, company_id, portal_role FROM users WHERE id = ?', [userId]);
    if (!user?.employee_id) return null;
    const employee = await db.getOne('SELECT * FROM employees WHERE id = ?', [user.employee_id]);
    return employee ? { ...employee, portal_role: user.portal_role } : null;
}

/** Middleware: require employee role (self-service) */
function requireEmployeeLink(req, res, next) {
    // Admin/employer can also access self-service for testing
    if (req.linkedEmployee || req.user.role === 'admin' || req.user.role === 'employer') {
        return next();
    }
    return res.status(403).json({ error: 'Přístup odepřen. Účet není propojen se zaměstnancem.' });
}

// Pre-load linked employee for every request
router.use(async (req, res, next) => {
    try {
        req.linkedEmployee = await getLinkedEmployee(req.user.userId);
    } catch { /* not linked */ }
    next();
});

// ====================================
// EMPLOYEE PROFILE
// ====================================

// GET /api/v2/portal/me — Get my profile
router.get('/me', requireEmployeeLink, async (req, res) => {
    try {
        const employee = req.linkedEmployee;
        if (!employee) return res.status(404).json({ error: 'Profil zaměstnance nenalezen' });

        // Decrypt PII
        try {
            const key = await getOrCreateCompanyKey(employee.company_id);
            const decrypted = decryptEmployeeData(employee, key);
            // Redact sensitive fields for employee view
            const safeProfile = {
                uuid: decrypted.uuid,
                name: decrypted.name,
                email: decrypted.email,
                position_title: decrypted.position_title,
                typ_uvazku: decrypted.typ_uvazku,
                nastup: decrypted.nastup,
                adresa: decrypted.adresa,
                bank_account: decrypted.bank_account ? maskBankAccount(decrypted.bank_account) : null,
                zp_code: decrypted.zp_code,
                osobni_cislo: decrypted.osobni_cislo,
                status: decrypted.status,
                department_id: decrypted.department_id,
            };
            return res.json({ profile: safeProfile });
        } catch {
            return res.json({ profile: { uuid: employee.uuid, name: employee.name, email: employee.email } });
        }
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({ error: 'Chyba při načítání profilu' });
    }
});

// ====================================
// PAYSLIPS (výplatní pásky)
// ====================================

// GET /api/v2/portal/payslips — List my payslips
router.get('/payslips', [
    query('year').optional().isInt({ min: 2020 }),
], validate, requireEmployeeLink, async (req, res) => {
    try {
        const employee = req.linkedEmployee;
        if (!employee) return res.status(404).json({ error: 'Profil nenalezen' });

        let sql = `SELECT pi.*, pp.month, pp.year, pp.status as period_status
                   FROM payroll_items pi
                   JOIN payroll_periods pp ON pi.payroll_period_id = pp.id
                   WHERE pi.employee_id = ? AND pi.company_id = ?`;
        const params = [employee.id, employee.company_id];

        if (req.query.year) {
            sql += ` AND pp.year = ?`;
            params.push(parseInt(req.query.year));
        }

        sql += ` ORDER BY pp.year DESC, pp.month DESC`;
        const payslips = await db.getAll(sql, params);

        // Log access
        for (const ps of payslips) {
            await db.run(`
                INSERT INTO payslip_access_log (employee_id, company_id, period_year, period_month, ip_address)
                VALUES (?, ?, ?, ?, ?)
            `, [employee.id, employee.company_id, ps.year, ps.month, req.ip]);
        }

        res.json({ payslips });
    } catch (error) {
        console.error('List payslips error:', error);
        res.status(500).json({ error: 'Chyba při načítání výplatních pásek' });
    }
});

// GET /api/v2/portal/payslips/:year/:month — Get specific payslip detail
router.get('/payslips/:year/:month', [
    param('year').isInt({ min: 2020 }),
    param('month').isInt({ min: 1, max: 12 }),
], validate, requireEmployeeLink, async (req, res) => {
    try {
        const employee = req.linkedEmployee;
        if (!employee) return res.status(404).json({ error: 'Profil nenalezen' });

        const year = parseInt(req.params.year);
        const month = parseInt(req.params.month);

        const payslip = await db.getOne(`
            SELECT pi.*, pp.month, pp.year, pp.status as period_status
            FROM payroll_items pi
            JOIN payroll_periods pp ON pi.payroll_period_id = pp.id
            WHERE pi.employee_id = ? AND pi.company_id = ? AND pp.year = ? AND pp.month = ?
        `, [employee.id, employee.company_id, year, month]);

        if (!payslip) return res.status(404).json({ error: 'Výplatní páska nenalezena' });

        // Log access
        await db.run(`
            INSERT INTO payslip_access_log (employee_id, company_id, period_year, period_month, ip_address)
            VALUES (?, ?, ?, ?, ?)
        `, [employee.id, employee.company_id, year, month, req.ip]);

        res.json({ payslip });
    } catch (error) {
        console.error('Get payslip error:', error);
        res.status(500).json({ error: 'Chyba při načítání výplatní pásky' });
    }
});

// ====================================
// VACATION REQUESTS (žádosti o dovolenou)
// ====================================

// GET /api/v2/portal/vacations — My vacation requests + balance
router.get('/vacations', requireEmployeeLink, async (req, res) => {
    try {
        const employee = req.linkedEmployee;
        if (!employee) return res.status(404).json({ error: 'Profil nenalezen' });

        const requests = await db.getAll(`
            SELECT * FROM vacation_requests
            WHERE employee_id = ? AND company_id = ?
            ORDER BY start_date DESC
        `, [employee.id, employee.company_id]);

        // Calculate remaining balance
        const currentYear = new Date().getFullYear();
        const used = await db.getOne(`
            SELECT COALESCE(SUM(days), 0) as total
            FROM vacation_requests
            WHERE employee_id = ? AND company_id = ? AND status = 'approved'
            AND EXTRACT(YEAR FROM start_date) = ?
        `, [employee.id, employee.company_id, currentYear]);

        const entitlement = 20; // Standard CZ
        const remaining = entitlement - (used?.total || 0);

        res.json({ requests, balance: { year: currentYear, entitlement, used: used?.total || 0, remaining } });
    } catch (error) {
        console.error('List vacations error:', error);
        res.status(500).json({ error: 'Chyba při načítání dovolené' });
    }
});

// POST /api/v2/portal/vacations — Submit vacation request
router.post('/vacations', [
    body('start_date').isDate().withMessage('Datum začátku je povinné'),
    body('end_date').isDate().withMessage('Datum konce je povinné'),
    body('type').optional().isIn(['dovolena', 'sick_leave', 'unpaid_leave', 'personal_day']),
    body('notes').optional().trim(),
], validate, requireEmployeeLink, async (req, res) => {
    try {
        const employee = req.linkedEmployee;
        if (!employee) return res.status(404).json({ error: 'Profil nenalezen' });

        const { start_date, end_date, type = 'dovolena', notes } = req.body;

        // Calculate working days
        const start = new Date(start_date);
        const end = new Date(end_date);
        if (end < start) return res.status(400).json({ error: 'Datum konce musí být po datu začátku' });

        let days = 0;
        const current = new Date(start);
        while (current <= end) {
            const dow = current.getDay();
            if (dow !== 0 && dow !== 6) days++;
            current.setDate(current.getDate() + 1);
        }

        const uuid = require('crypto').randomUUID();
        await db.run(`
            INSERT INTO vacation_requests (uuid, employee_id, company_id, type, start_date, end_date, days, status, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        `, [uuid, employee.id, employee.company_id, type, start_date, end_date, days, notes || null]);

        // Create employee request record
        const requestUuid = require('crypto').randomUUID();
        await db.run(`
            INSERT INTO employee_requests (uuid, employee_id, company_id, type, title, description, data, status)
            VALUES (?, ?, ?, 'vacation', ?, ?, ?, 'pending')
        `, [
            requestUuid, employee.id, employee.company_id,
            `Žádost o dovolenou: ${start_date} — ${end_date}`,
            notes || `${days} pracovních dnů`,
            JSON.stringify({ vacation_uuid: uuid, start_date, end_date, days, type }),
        ]);

        await auditLog('VACATION_REQUESTED', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'vacation',
            resourceId: uuid,
            ip: req.ip,
            metadata: { employee: employee.name, start_date, end_date, days },
        });

        res.status(201).json({ success: true, vacation_uuid: uuid, request_uuid: requestUuid, days });
    } catch (error) {
        console.error('Submit vacation request error:', error);
        res.status(500).json({ error: 'Chyba při podání žádosti o dovolenou' });
    }
});

// ====================================
// PERSONAL DATA CHANGE REQUESTS
// ====================================

// POST /api/v2/portal/personal-data — Request personal data change
router.post('/personal-data', [
    body('field').isIn(['adresa', 'bank_account', 'email', 'zp_code', 'phone']).withMessage('Neplatné pole'),
    body('new_value').trim().notEmpty().withMessage('Nová hodnota je povinná'),
    body('reason').optional().trim(),
], validate, requireEmployeeLink, async (req, res) => {
    try {
        const employee = req.linkedEmployee;
        if (!employee) return res.status(404).json({ error: 'Profil nenalezen' });

        const { field, new_value, reason } = req.body;

        const uuid = require('crypto').randomUUID();
        await db.run(`
            INSERT INTO employee_requests (uuid, employee_id, company_id, type, title, description, data, status)
            VALUES (?, ?, ?, 'personal_data_change', ?, ?, ?, 'pending')
        `, [
            uuid, employee.id, employee.company_id,
            `Změna údaje: ${field}`,
            reason || `Zaměstnanec žádá o změnu pole ${field}`,
            JSON.stringify({ field, new_value }),
        ]);

        res.status(201).json({ success: true, request_uuid: uuid, message: 'Žádost o změnu odeslána ke schválení' });
    } catch (error) {
        console.error('Personal data change error:', error);
        res.status(500).json({ error: 'Chyba při odesílání žádosti' });
    }
});

// ====================================
// MY DOCUMENTS
// ====================================

// GET /api/v2/portal/documents — List my documents
router.get('/documents', requireEmployeeLink, async (req, res) => {
    try {
        const employee = req.linkedEmployee;
        if (!employee) return res.status(404).json({ error: 'Profil nenalezen' });

        const documents = await db.getAll(`
            SELECT uuid, type, name, valid_from, valid_to, status, created_at
            FROM employee_documents
            WHERE employee_id = ? AND company_id = ?
            ORDER BY created_at DESC
        `, [employee.id, employee.company_id]);

        res.json({ documents });
    } catch (error) {
        console.error('List documents error:', error);
        res.status(500).json({ error: 'Chyba při načítání dokumentů' });
    }
});

// GET /api/v2/portal/tax-documents/:year — Get annual tax documents
router.get('/tax-documents/:year', [
    param('year').isInt({ min: 2020 }),
], validate, requireEmployeeLink, async (req, res) => {
    try {
        const employee = req.linkedEmployee;
        if (!employee) return res.status(404).json({ error: 'Profil nenalezen' });

        const year = parseInt(req.params.year);
        const docs = await db.getAll(`
            SELECT uuid, type, name, valid_from, valid_to, status, created_at
            FROM employee_documents
            WHERE employee_id = ? AND company_id = ?
            AND type IN ('annual_tax_settlement', 'tax_declaration')
            AND EXTRACT(YEAR FROM COALESCE(valid_from, created_at)) = ?
        `, [employee.id, employee.company_id, year]);

        res.json({ year, documents: docs });
    } catch (error) {
        console.error('Get tax documents error:', error);
        res.status(500).json({ error: 'Chyba při načítání daňových dokumentů' });
    }
});

// ====================================
// MY BENEFITS
// ====================================

// GET /api/v2/portal/benefits — List my active benefits
router.get('/benefits', requireEmployeeLink, async (req, res) => {
    try {
        const employee = req.linkedEmployee;
        if (!employee) return res.status(404).json({ error: 'Profil nenalezen' });

        const benefits = await db.getAll(`
            SELECT eb.uuid, eb.enrollment_date, eb.status,
                   bp.type, bp.name, bp.description,
                   bp.voucher_value_czk, bp.employer_contribution_pct,
                   bp.monthly_contribution_czk
            FROM employee_benefits eb
            JOIN benefit_plans bp ON eb.benefit_plan_id = bp.id
            WHERE eb.employee_id = ? AND eb.company_id = ?
            ORDER BY bp.type
        `, [employee.id, employee.company_id]);

        res.json({ benefits });
    } catch (error) {
        console.error('List my benefits error:', error);
        res.status(500).json({ error: 'Chyba při načítání benefitů' });
    }
});

// ====================================
// EMPLOYEE REQUESTS (inbox)
// ====================================

// GET /api/v2/portal/requests — My submitted requests
router.get('/requests', requireEmployeeLink, async (req, res) => {
    try {
        const employee = req.linkedEmployee;
        if (!employee) return res.status(404).json({ error: 'Profil nenalezen' });

        const requests = await db.getAll(`
            SELECT uuid, type, title, status, review_notes, created_at, reviewed_at
            FROM employee_requests
            WHERE employee_id = ? AND company_id = ?
            ORDER BY created_at DESC
        `, [employee.id, employee.company_id]);

        res.json({ requests });
    } catch (error) {
        console.error('List requests error:', error);
        res.status(500).json({ error: 'Chyba při načítání žádostí' });
    }
});

// ====================================
// MANAGER DASHBOARD
// ====================================

// GET /api/v2/portal/manager/team — Team overview (subordinates)
router.get('/manager/team', requireEmployeeLink, async (req, res) => {
    try {
        const employee = req.linkedEmployee;
        if (!employee) return res.status(404).json({ error: 'Profil nenalezen' });

        // Check if this employee is a manager (supervisor) of anyone
        const team = await db.getAll(`
            SELECT e.uuid, e.name, e.position_title, e.email, e.typ_uvazku,
                   d.name as department_name
            FROM employees e
            LEFT JOIN departments d ON e.department_id = d.id
            WHERE e.supervisor_id = ? AND e.company_id = ? AND e.status = 'active'
            ORDER BY e.name
        `, [employee.id, employee.company_id]);

        if (team.length === 0) {
            return res.json({ team: [], message: 'Nemáte žádné podřízené' });
        }

        res.json({ team });
    } catch (error) {
        console.error('Manager team error:', error);
        res.status(500).json({ error: 'Chyba při načítání týmu' });
    }
});

// GET /api/v2/portal/manager/pending — Pending approvals for manager
router.get('/manager/pending', requireEmployeeLink, async (req, res) => {
    try {
        const employee = req.linkedEmployee;
        if (!employee) return res.status(404).json({ error: 'Profil nenalezen' });

        // Get pending vacation requests from subordinates
        const pendingVacations = await db.getAll(`
            SELECT vr.*, e.name as employee_name, e.uuid as employee_uuid
            FROM vacation_requests vr
            JOIN employees e ON vr.employee_id = e.id
            WHERE e.supervisor_id = ? AND e.company_id = ? AND vr.status = 'pending'
            ORDER BY vr.start_date
        `, [employee.id, employee.company_id]);

        // Get pending timesheets from subordinates
        const pendingTimesheets = await db.getAll(`
            SELECT t.*, e.name as employee_name, e.uuid as employee_uuid
            FROM timesheets t
            JOIN employees e ON t.employee_id = e.id
            WHERE e.supervisor_id = ? AND e.company_id = ? AND t.status = 'submitted'
            ORDER BY t.date
        `, [employee.id, employee.company_id]);

        // Get pending employee requests
        const pendingRequests = await db.getAll(`
            SELECT er.*, e.name as employee_name, e.uuid as employee_uuid
            FROM employee_requests er
            JOIN employees e ON er.employee_id = e.id
            WHERE e.supervisor_id = ? AND e.company_id = ? AND er.status = 'pending'
            ORDER BY er.created_at
        `, [employee.id, employee.company_id]);

        res.json({
            pendingVacations,
            pendingTimesheets,
            pendingRequests,
            totalPending: pendingVacations.length + pendingTimesheets.length + pendingRequests.length,
        });
    } catch (error) {
        console.error('Manager pending error:', error);
        res.status(500).json({ error: 'Chyba při načítání čekajících schválení' });
    }
});

// POST /api/v2/portal/manager/approve-request/:uuid — Approve employee request
router.post('/manager/approve-request/:uuid', [
    param('uuid').trim().notEmpty(),
    body('approved').isBoolean(),
    body('notes').optional().trim(),
], validate, requireEmployeeLink, async (req, res) => {
    try {
        const employee = req.linkedEmployee;
        if (!employee) return res.status(404).json({ error: 'Profil nenalezen' });

        const request = await db.getOne(`
            SELECT er.*, e.supervisor_id
            FROM employee_requests er
            JOIN employees e ON er.employee_id = e.id
            WHERE er.uuid = ? AND er.company_id = ?
        `, [req.params.uuid, employee.company_id]);

        if (!request) return res.status(404).json({ error: 'Žádost nenalezena' });

        // Verify this user is the supervisor (or admin)
        const user = await db.getOne('SELECT * FROM users WHERE id = ?', [req.user.userId]);
        if (request.supervisor_id !== employee.id && user.role !== 'admin' && user.role !== 'employer') {
            return res.status(403).json({ error: 'Nemáte oprávnění schvalovat tuto žádost' });
        }

        const newStatus = req.body.approved ? 'approved' : 'rejected';
        await db.run(`
            UPDATE employee_requests SET status = ?, reviewed_by = ?, reviewed_at = NOW(),
            review_notes = ?, updated_at = NOW()
            WHERE uuid = ? AND company_id = ?
        `, [newStatus, req.user.userId, req.body.notes || null, req.params.uuid, employee.company_id]);

        // If it's a vacation request and approved, update the vacation_requests table too
        if (req.body.approved && request.type === 'vacation') {
            try {
                const data = JSON.parse(request.data || '{}');
                if (data.vacation_uuid) {
                    await db.run(
                        `UPDATE vacation_requests SET status = 'approved' WHERE uuid = ? AND company_id = ?`,
                        [data.vacation_uuid, employee.company_id]
                    );
                }
            } catch { /* ignore parse errors */ }
        }

        await auditLog('REQUEST_REVIEWED', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'employee_request',
            resourceId: req.params.uuid,
            ip: req.ip,
            metadata: { status: newStatus },
        });

        res.json({ success: true, status: newStatus });
    } catch (error) {
        console.error('Approve request error:', error);
        res.status(500).json({ error: 'Chyba při schvalování žádosti' });
    }
});

// GET /api/v2/portal/manager/costs — Team cost overview
router.get('/manager/costs', [
    query('year').optional().isInt({ min: 2020 }),
    query('month').optional().isInt({ min: 1, max: 12 }),
], validate, requireEmployeeLink, async (req, res) => {
    try {
        const employee = req.linkedEmployee;
        if (!employee) return res.status(404).json({ error: 'Profil nenalezen' });

        const year = parseInt(req.query.year) || new Date().getFullYear();
        const month = parseInt(req.query.month) || new Date().getMonth() + 1;

        const teamCosts = await db.getAll(`
            SELECT e.uuid, e.name, e.hruba_mzda_czk, e.typ_uvazku,
                   pi.gross_salary, pi.net_salary, pi.sp_employee, pi.zp_employee,
                   pi.sp_employer, pi.zp_employer, pi.tax
            FROM employees e
            LEFT JOIN payroll_items pi ON pi.employee_id = e.id
            LEFT JOIN payroll_periods pp ON pi.payroll_period_id = pp.id AND pp.year = ? AND pp.month = ?
            WHERE e.supervisor_id = ? AND e.company_id = ? AND e.status = 'active'
            ORDER BY e.name
        `, [year, month, employee.id, employee.company_id]);

        const totalGross = teamCosts.reduce((s, c) => s + (c.gross_salary || c.hruba_mzda_czk || 0), 0);
        const totalEmployerCost = teamCosts.reduce((s, c) => {
            const gross = c.gross_salary || c.hruba_mzda_czk || 0;
            return s + gross + (c.sp_employer || 0) + (c.zp_employer || 0);
        }, 0);

        res.json({
            year, month,
            teamSize: teamCosts.length,
            totalGrossCzk: totalGross,
            totalEmployerCostCzk: totalEmployerCost,
            employees: teamCosts,
        });
    } catch (error) {
        console.error('Manager costs error:', error);
        res.status(500).json({ error: 'Chyba při načítání nákladů týmu' });
    }
});

// ====================================
// ADMIN: Link user to employee
// ====================================

// POST /api/v2/portal/link — Link user account to employee (admin only)
router.post('/link', [
    body('user_id').isInt().withMessage('ID uživatele je povinné'),
    body('employee_uuid').trim().notEmpty().withMessage('UUID zaměstnance je povinné'),
    body('portal_role').optional().isIn(['admin', 'employer', 'manager', 'employee']),
], validate, async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        // Only admin/employer can link
        const currentUser = await db.getOne('SELECT role FROM users WHERE id = ?', [req.user.userId]);
        if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'employer')) {
            return res.status(403).json({ error: 'Nemáte oprávnění' });
        }

        const employee = await db.getOne(
            'SELECT id FROM employees WHERE uuid = ? AND company_id = ?',
            [req.body.employee_uuid, companyId]
        );
        if (!employee) return res.status(404).json({ error: 'Zaměstnanec nenalezen' });

        // 🔐 FIXED: Verify user_id belongs to same company to prevent cross-tenant hijacking
        const targetUser = await db.getOne(
            'SELECT id, company_id FROM users WHERE id = ? AND company_id = ?',
            [req.body.user_id, companyId]
        );
        if (!targetUser) return res.status(404).json({ error: 'Uživatel nenalezen ve vaší firmě' });

        await db.run(
            'UPDATE users SET employee_id = ?, portal_role = ? WHERE id = ? AND company_id = ?',
            [employee.id, req.body.portal_role || 'employee', req.body.user_id, companyId]
        );

        await auditLog('USER_EMPLOYEE_LINKED', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'user',
            resourceId: String(req.body.user_id),
            ip: req.ip,
            metadata: { employee_uuid: req.body.employee_uuid },
        });

        res.json({ success: true, message: 'Uživatel propojen se zaměstnancem' });
    } catch (error) {
        console.error('Link user error:', error);
        res.status(500).json({ error: 'Chyba při propojování účtu' });
    }
});

// ====================================
// ADMIN: Manage employee requests
// ====================================

// GET /api/v2/portal/admin/requests — All pending requests (admin view)
// 🔐 FIXED: Added requireRole — only admin/employer can view all requests
router.get('/admin/requests', requireRole(['admin', 'employer']), [
    query('status').optional().isIn(['pending', 'approved', 'rejected', 'cancelled', 'completed']),
    query('type').optional(),
], validate, async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        let sql = `SELECT er.*, e.name as employee_name, e.uuid as employee_uuid
                   FROM employee_requests er
                   JOIN employees e ON er.employee_id = e.id
                   WHERE er.company_id = ?`;
        const params = [companyId];

        if (req.query.status) {
            sql += ` AND er.status = ?`;
            params.push(req.query.status);
        }
        if (req.query.type) {
            sql += ` AND er.type = ?`;
            params.push(req.query.type);
        }

        sql += ` ORDER BY er.created_at DESC`;
        const requests = await db.getAll(sql, params);

        for (const r of requests) {
            try { r.data = JSON.parse(r.data || '{}'); } catch { r.data = {}; }
        }

        res.json({ requests });
    } catch (error) {
        console.error('Admin list requests error:', error);
        res.status(500).json({ error: 'Chyba při načítání žádostí' });
    }
});

// ====================================
// EMPLOYEE CRYPTO SETTINGS (self-service)
// ====================================

// GET /api/v2/portal/crypto-settings — Get own crypto preferences
router.get('/crypto-settings', requireEmployeeLink, async (req, res) => {
    try {
        const emp = req.linkedEmployee;
        if (!emp) return res.status(404).json({ error: 'Účet není propojen se zaměstnancem' });

        res.json({
            stablecoin_pct: emp.stablecoin_pct || 0,
            preferred_token: emp.preferred_token || 'NONE',
            wallet_address: emp.wallet_address || null,
            crypto_opt_in: !!emp.crypto_opt_in,
            crypto_settings_updated_at: emp.crypto_settings_updated_at,
        });
    } catch (error) {
        console.error('Get portal crypto settings error:', error);
        res.status(500).json({ error: 'Chyba při načítání krypto nastavení' });
    }
});

// PUT /api/v2/portal/crypto-settings — Employee sets own crypto preferences
router.put('/crypto-settings', requireEmployeeLink, [
    body('stablecoin_pct').isInt({ min: 0, max: 100 }).withMessage('Procento musí být 0-100'),
    body('preferred_token').isIn(['NONE', 'ALEO', 'USDCx']).withMessage('Neplatný token'),
    body('wallet_address').optional({ nullable: true }).trim(),
    body('crypto_opt_in').isBoolean().withMessage('crypto_opt_in musí být boolean'),
], validate, async (req, res) => {
    try {
        const emp = req.linkedEmployee;
        if (!emp) return res.status(404).json({ error: 'Účet není propojen se zaměstnancem' });

        const { stablecoin_pct, preferred_token, wallet_address, crypto_opt_in } = req.body;

        // Validate wallet address when opting in
        if (crypto_opt_in && preferred_token !== 'NONE' && stablecoin_pct > 0) {
            if (!wallet_address || wallet_address.trim().length === 0) {
                return res.status(400).json({ error: 'Wallet adresa je povinná pro krypto výplaty' });
            }
            if (!/^aleo1[a-z0-9]{58}$/.test(wallet_address.trim())) {
                return res.status(400).json({ error: 'Neplatný formát Aleo adresy' });
            }
        }

        await db.run(`
            UPDATE employees SET
                stablecoin_pct = ?,
                preferred_token = ?,
                wallet_address = ?,
                crypto_opt_in = ?,
                crypto_settings_updated_at = NOW(),
                updated_at = NOW()
            WHERE id = ?
        `, [stablecoin_pct, preferred_token, wallet_address?.trim() || null, crypto_opt_in ? 1 : 0, emp.id]);

        await auditLog('EMPLOYEE_CRYPTO_SELF_SERVICE_UPDATE', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'employee',
            resourceId: emp.uuid,
            ip: req.ip,
            metadata: { stablecoin_pct, preferred_token, crypto_opt_in },
        });

        res.json({ success: true, message: 'Krypto nastavení uloženo' });
    } catch (error) {
        console.error('Update portal crypto settings error:', error);
        res.status(500).json({ error: 'Chyba při aktualizaci krypto nastavení' });
    }
});

// ====================================
// HELPERS
// ====================================

function maskBankAccount(account) {
    if (!account || account.length < 6) return '***';
    return account.substring(0, 3) + '***' + account.substring(account.length - 4);
}

module.exports = router;
