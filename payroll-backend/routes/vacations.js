// ====================================
// 🏖️ Vacation & Absence Routes — CZ Labour Code Compliance
// ====================================
// Vacation entitlements, absence records (nemoc, dovolená, OČR, etc.)
// Reference: Zákoník práce §211-223 (dovolená), §191-194 (překážky v práci)

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
// VACATION ENTITLEMENTS
// ====================================

// GET /api/v2/vacations/entitlements?year=2026
router.get('/entitlements', [
    query('year').optional().isInt({ min: 2024, max: 2030 }),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const year = parseInt(req.query.year) || new Date().getFullYear();

        const entitlements = await db.getAll(`
            SELECT ve.*, e.name, e.osobni_cislo, e.typ_uvazku, e.uuid as employee_uuid
            FROM vacation_entitlements ve
            JOIN employees e ON ve.employee_id = e.id
            WHERE e.company_id = ? AND ve.year = ? AND e.status != 'terminated'
            ORDER BY e.osobni_cislo, e.name
        `, [companyId, year]);

        res.json({ entitlements, year });
    } catch (error) {
        console.error('List vacation entitlements error:', error);
        res.status(500).json({ error: 'Chyba při načítání nároků na dovolenou' });
    }
});

// POST /api/v2/vacations/entitlements/init — Initialize entitlements for year
router.post('/entitlements/init', [
    body('year').isInt({ min: 2024, max: 2030 }).withMessage('Neplatný rok'),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const { year } = req.body;

        // Get all active employees
        const employees = await db.getAll(
            `SELECT id, vacation_days_per_year FROM employees WHERE company_id = ? AND status = 'active'`,
            [companyId]
        );

        // Check for carryover from previous year
        let initialized = 0;
        for (const emp of employees) {
            // Check if entitlement already exists
            const existing = await db.getOne(
                'SELECT id FROM vacation_entitlements WHERE employee_id = ? AND year = ?',
                [emp.id, year]
            );
            if (existing) continue;

            // Get remaining days from previous year (carryover)
            const prev = await db.getOne(
                'SELECT remaining_days FROM vacation_entitlements WHERE employee_id = ? AND year = ?',
                [emp.id, year - 1]
            );
            const carryOver = prev ? Math.max(0, prev.remaining_days) : 0;

            await db.run(`
                INSERT INTO vacation_entitlements (employee_id, year, total_days, carried_over_days)
                VALUES (?, ?, ?, ?)
            `, [emp.id, year, emp.vacation_days_per_year || 20, carryOver]);
            initialized++;
        }

        await auditLog('VACATION_ENTITLEMENTS_INIT', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'vacation_entitlement',
            ip: req.ip,
            metadata: { year, initialized, total: employees.length },
        });

        res.json({ success: true, initialized, skipped: employees.length - initialized });
    } catch (error) {
        console.error('Init vacation entitlements error:', error);
        res.status(500).json({ error: 'Chyba při inicializaci nároků na dovolenou' });
    }
});

// PUT /api/v2/vacations/entitlements/:employeeUuid — Update entitlement
router.put('/entitlements/:employeeUuid', [
    param('employeeUuid').trim().notEmpty(),
    body('year').isInt({ min: 2024, max: 2030 }),
    body('total_days').optional().isFloat({ min: 0, max: 60 }),
    body('carried_over_days').optional().isFloat({ min: 0, max: 60 }),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const employee = await db.getOne(
            'SELECT id FROM employees WHERE uuid = ? AND company_id = ?',
            [req.params.employeeUuid, companyId]
        );
        if (!employee) return res.status(404).json({ error: 'Zaměstnanec nenalezen' });

        const { year, total_days, carried_over_days } = req.body;
        const sets = [];
        const vals = [];
        let paramIdx = 1;

        if (total_days !== undefined) {
            sets.push(`total_days = $${paramIdx++}`);
            vals.push(total_days);
        }
        if (carried_over_days !== undefined) {
            sets.push(`carried_over_days = $${paramIdx++}`);
            vals.push(carried_over_days);
        }

        if (sets.length > 0) {
            sets.push('updated_at = NOW()');
            vals.push(employee.id, year);
            await db.run(
                `UPDATE vacation_entitlements SET ${sets.join(', ')} WHERE employee_id = $${paramIdx++} AND year = $${paramIdx}`,
                vals
            );
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Update vacation entitlement error:', error);
        res.status(500).json({ error: 'Chyba při aktualizaci nároku na dovolenou' });
    }
});

// ====================================
// ABSENCE RECORDS
// ====================================

// GET /api/v2/vacations/absences?year=2026&month=1&employee_uuid=...
router.get('/absences', [
    query('year').optional().isInt({ min: 2024, max: 2030 }),
    query('month').optional().isInt({ min: 1, max: 12 }),
    query('employee_uuid').optional().trim(),
    query('type').optional().trim(),
    query('status').optional().isIn(['pending', 'approved', 'rejected', 'cancelled']),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        let where = 'ar.company_id = $1';
        const params = [companyId];
        let paramIdx = 2;

        if (req.query.year) {
            where += ` AND EXTRACT(YEAR FROM ar.date_from) = $${paramIdx++}`;
            params.push(parseInt(req.query.year));
        }
        if (req.query.month) {
            where += ` AND EXTRACT(MONTH FROM ar.date_from) = $${paramIdx++}`;
            params.push(parseInt(req.query.month));
        }
        if (req.query.employee_uuid) {
            where += ` AND e.uuid = $${paramIdx++}`;
            params.push(req.query.employee_uuid);
        }
        if (req.query.type) {
            where += ` AND ar.type = $${paramIdx++}`;
            params.push(req.query.type);
        }
        if (req.query.status) {
            where += ` AND ar.status = $${paramIdx++}`;
            params.push(req.query.status);
        }

        const absences = await db.getAll(`
            SELECT ar.*, e.name, e.osobni_cislo, e.uuid as employee_uuid
            FROM absence_records ar
            JOIN employees e ON ar.employee_id = e.id
            WHERE ${where}
            ORDER BY ar.date_from DESC
        `, params);

        res.json({ absences });
    } catch (error) {
        console.error('List absences error:', error);
        res.status(500).json({ error: 'Chyba při načítání absencí' });
    }
});

// POST /api/v2/vacations/absences — Create absence record
router.post('/absences', [
    body('employee_uuid').trim().notEmpty().withMessage('UUID zaměstnance je povinné'),
    body('type').isIn([
        'dovolena', 'nemoc', 'ocr', 'materska', 'rodicovska',
        'neplacene_volno', 'svatek', 'sluzebni_cesta', 'lekar', 'nahradni_volno', 'jine'
    ]).withMessage('Neplatný typ absence'),
    body('date_from').isISO8601().withMessage('Neplatné datum od'),
    body('date_to').isISO8601().withMessage('Neplatné datum do'),
    body('work_days').isFloat({ min: 0 }).withMessage('Počet pracovních dnů musí být kladný'),
    body('hours').optional().isFloat({ min: 0 }),
    body('note').optional().trim(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const employee = await db.getOne(
            'SELECT id FROM employees WHERE uuid = ? AND company_id = ?',
            [req.body.employee_uuid, companyId]
        );
        if (!employee) return res.status(404).json({ error: 'Zaměstnanec nenalezen' });

        const { type, date_from, date_to, work_days, hours, note } = req.body;

        // Validate date range
        if (new Date(date_from) > new Date(date_to)) {
            return res.status(400).json({ error: 'Datum od musí být před datum do' });
        }

        // Check for overlapping absences
        const overlap = await db.getOne(`
            SELECT id FROM absence_records
            WHERE employee_id = ? AND status != 'cancelled'
                AND date_from <= ? AND date_to >= ?
        `, [employee.id, date_to, date_from]);
        if (overlap) {
            return res.status(409).json({ error: 'Zaměstnanec již má absenci v tomto období' });
        }

        const uuid = crypto.randomUUID();
        await db.run(`
            INSERT INTO absence_records (uuid, employee_id, company_id, type, date_from, date_to, work_days, hours, note, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
        `, [uuid, employee.id, companyId, type, date_from, date_to, work_days, hours || null, note || null]);

        // If vacation → check remaining entitlement
        if (type === 'dovolena') {
            const year = new Date(date_from).getFullYear();
            const entitlement = await db.getOne(
                'SELECT * FROM vacation_entitlements WHERE employee_id = ? AND year = ?',
                [employee.id, year]
            );
            if (entitlement) {
                const newPlanned = entitlement.planned_days + work_days;
                if (newPlanned > entitlement.total_days + entitlement.carried_over_days - entitlement.used_days) {
                    // Warning, not blocking — user decides
                    return res.status(201).json({
                        success: true,
                        uuid,
                        warning: `Zaměstnanec překročí nárok na dovolenou (zbývá ${entitlement.remaining_days} dnů, plánováno ${newPlanned} dnů)`,
                    });
                }
                // Update planned days
                await db.run(
                    'UPDATE vacation_entitlements SET planned_days = planned_days + ?, updated_at = NOW() WHERE id = ?',
                    [work_days, entitlement.id]
                );
            }
        }

        await auditLog('ABSENCE_CREATED', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'absence',
            resourceId: uuid,
            ip: req.ip,
            metadata: { type, date_from, date_to, work_days },
        });

        res.status(201).json({ success: true, uuid });
    } catch (error) {
        console.error('Create absence error:', error);
        res.status(500).json({ error: 'Chyba při vytváření absence' });
    }
});

// PUT /api/v2/vacations/absences/:uuid/approve — Approve absence
router.put('/absences/:uuid/approve', [
    param('uuid').trim().notEmpty(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const absence = await db.getOne(
            'SELECT * FROM absence_records WHERE uuid = ? AND company_id = ?',
            [req.params.uuid, companyId]
        );
        if (!absence) return res.status(404).json({ error: 'Absence nenalezena' });
        if (absence.status !== 'pending') {
            return res.status(409).json({ error: `Absence je ve stavu '${absence.status}', nelze schválit` });
        }

        await db.run(`
            UPDATE absence_records SET status = 'approved', approved_by = ?, approved_at = NOW(), updated_at = NOW()
            WHERE uuid = ?
        `, [req.user.userId, req.params.uuid]);

        // If vacation → update used_days in entitlement
        if (absence.type === 'dovolena') {
            const year = new Date(absence.date_from).getFullYear();
            await db.run(`
                UPDATE vacation_entitlements SET
                    used_days = used_days + ?,
                    planned_days = GREATEST(0, planned_days - ?),
                    updated_at = NOW()
                WHERE employee_id = ? AND year = ?
            `, [absence.work_days, absence.work_days, absence.employee_id, year]);
        }

        await auditLog('ABSENCE_APPROVED', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'absence',
            resourceId: req.params.uuid,
            ip: req.ip,
            metadata: { type: absence.type, work_days: absence.work_days },
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Approve absence error:', error);
        res.status(500).json({ error: 'Chyba při schvalování absence' });
    }
});

// PUT /api/v2/vacations/absences/:uuid/reject — Reject absence
router.put('/absences/:uuid/reject', [
    param('uuid').trim().notEmpty(),
    body('reason').optional().trim(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const absence = await db.getOne(
            'SELECT * FROM absence_records WHERE uuid = ? AND company_id = ?',
            [req.params.uuid, companyId]
        );
        if (!absence) return res.status(404).json({ error: 'Absence nenalezena' });
        if (absence.status !== 'pending') {
            return res.status(409).json({ error: `Absence je ve stavu '${absence.status}', nelze zamítnout` });
        }

        await db.run(`
            UPDATE absence_records SET status = 'rejected', note = COALESCE(?, note), updated_at = NOW()
            WHERE uuid = ?
        `, [req.body.reason || null, req.params.uuid]);

        // If vacation → reduce planned_days
        if (absence.type === 'dovolena') {
            const year = new Date(absence.date_from).getFullYear();
            await db.run(`
                UPDATE vacation_entitlements SET
                    planned_days = GREATEST(0, planned_days - ?),
                    updated_at = NOW()
                WHERE employee_id = ? AND year = ?
            `, [absence.work_days, absence.employee_id, year]);
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Reject absence error:', error);
        res.status(500).json({ error: 'Chyba při zamítání absence' });
    }
});

// DELETE /api/v2/vacations/absences/:uuid — Cancel absence
router.delete('/absences/:uuid', [
    param('uuid').trim().notEmpty(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const absence = await db.getOne(
            'SELECT * FROM absence_records WHERE uuid = ? AND company_id = ?',
            [req.params.uuid, companyId]
        );
        if (!absence) return res.status(404).json({ error: 'Absence nenalezena' });

        // Can only cancel pending or approved
        if (!['pending', 'approved'].includes(absence.status)) {
            return res.status(409).json({ error: 'Absenci v tomto stavu nelze zrušit' });
        }

        await db.run(
            `UPDATE absence_records SET status = 'cancelled', updated_at = NOW() WHERE uuid = ?`,
            [req.params.uuid]
        );

        // If vacation was approved → revert used_days
        if (absence.type === 'dovolena') {
            const year = new Date(absence.date_from).getFullYear();
            if (absence.status === 'approved') {
                await db.run(`
                    UPDATE vacation_entitlements SET
                        used_days = GREATEST(0, used_days - ?),
                        updated_at = NOW()
                    WHERE employee_id = ? AND year = ?
                `, [absence.work_days, absence.employee_id, year]);
            } else {
                // Was pending — revert planned
                await db.run(`
                    UPDATE vacation_entitlements SET
                        planned_days = GREATEST(0, planned_days - ?),
                        updated_at = NOW()
                    WHERE employee_id = ? AND year = ?
                `, [absence.work_days, absence.employee_id, year]);
            }
        }

        await auditLog('ABSENCE_CANCELLED', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'absence',
            resourceId: req.params.uuid,
            ip: req.ip,
            metadata: { type: absence.type, previous_status: absence.status },
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Cancel absence error:', error);
        res.status(500).json({ error: 'Chyba při rušení absence' });
    }
});

// ====================================
// ABSENCE SUMMARY for payroll period
// ====================================

// GET /api/v2/vacations/period-summary?year=2026&month=1
// Returns aggregated absence hours per employee for a specific month
router.get('/period-summary', [
    query('year').isInt({ min: 2024, max: 2030 }).withMessage('Neplatný rok'),
    query('month').isInt({ min: 1, max: 12 }).withMessage('Neplatný měsíc'),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const year = parseInt(req.query.year);
        const month = parseInt(req.query.month);

        // Get first and last day of month
        const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
        const monthEnd = new Date(year, month, 0).toISOString().split('T')[0]; // last day

        const summary = await db.getAll(`
            SELECT 
                ar.employee_id,
                e.uuid as employee_uuid,
                e.name,
                ar.type,
                SUM(ar.work_days) as total_days,
                SUM(COALESCE(ar.hours, ar.work_days * 8)) as total_hours
            FROM absence_records ar
            JOIN employees e ON ar.employee_id = e.id
            WHERE ar.company_id = $1
                AND ar.status = 'approved'
                AND ar.date_from <= $2
                AND ar.date_to >= $3
            GROUP BY ar.employee_id, e.uuid, e.name, ar.type
            ORDER BY e.name, ar.type
        `, [companyId, monthEnd, monthStart]);

        res.json({ summary, year, month });
    } catch (error) {
        console.error('Period absence summary error:', error);
        res.status(500).json({ error: 'Chyba při načítání souhrnu absencí' });
    }
});

module.exports = router;
