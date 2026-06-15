// ====================================
// ⏱️ Timesheets & Attendance Routes
// ====================================
// Clock-in/clock-out, shift scheduling, overtime tracking,
// timesheet approval workflow, automatic surcharge calculation.

'use strict';

const express = require('express');
const { body, param, query } = require('express-validator');
const crypto = require('crypto');
const db = require('../db');
const { authenticateToken, requireRole, validate, auditLog } = require('../middleware/auth');
const { calculateSurcharges, getWorkingHours } = require('../services/payroll-engine');

const router = express.Router();
router.use(authenticateToken);

async function getCompanyId(userId) {
    const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [userId]);
    return user?.company_id;
}

// ====================================
// TIMESHEETS
// ====================================

// GET /api/v2/timesheets — List timesheets (filterable by employee, date range, status)
router.get('/', [
    query('employee_uuid').optional().trim(),
    query('date_from').optional().isDate(),
    query('date_to').optional().isDate(),
    query('status').optional().isIn(['draft', 'submitted', 'approved', 'rejected']),
    query('month').optional().isInt({ min: 1, max: 12 }),
    query('year').optional().isInt({ min: 2020, max: 2035 }),
], validate, async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        let sql = `SELECT t.*, e.name as employee_name, e.uuid as employee_uuid
                    FROM timesheets t
                    JOIN employees e ON t.employee_id = e.id
                    WHERE t.company_id = ?`;
        const params = [companyId];

        if (req.query.employee_uuid) {
            sql += ` AND e.uuid = ?`;
            params.push(req.query.employee_uuid);
        }
        if (req.query.date_from) {
            sql += ` AND t.date >= ?`;
            params.push(req.query.date_from);
        }
        if (req.query.date_to) {
            sql += ` AND t.date <= ?`;
            params.push(req.query.date_to);
        }
        if (req.query.status) {
            sql += ` AND t.status = ?`;
            params.push(req.query.status);
        }
        if (req.query.year && req.query.month) {
            sql += ` AND EXTRACT(YEAR FROM t.date) = ? AND EXTRACT(MONTH FROM t.date) = ?`;
            params.push(parseInt(req.query.year), parseInt(req.query.month));
        }

        sql += ` ORDER BY t.date DESC, e.name`;
        const timesheets = await db.getAll(sql, params);
        res.json({ timesheets });
    } catch (error) {
        console.error('List timesheets error:', error);
        res.status(500).json({ error: 'Chyba při načítání docházky' });
    }
});

// POST /api/v2/timesheets — Create timesheet entry (clock-in)
router.post('/', [
    body('employee_uuid').trim().notEmpty().withMessage('UUID zaměstnance je povinné'),
    body('date').isDate().withMessage('Datum je povinné'),
    body('clock_in').optional().trim(),
    body('clock_out').optional().trim(),
    body('break_minutes').optional().isInt({ min: 0, max: 120 }),
    body('worked_hours').optional().isFloat({ min: 0, max: 24 }),
    body('overtime_hours').optional().isFloat({ min: 0, max: 16 }),
    body('shift_type').optional().isIn(['day', 'night', 'weekend', 'holiday']),
    body('notes').optional().trim(),
    body('project_code').optional().trim(),
], validate, async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const employee = await db.getOne(
            'SELECT id, name FROM employees WHERE uuid = ? AND company_id = ?',
            [req.body.employee_uuid, companyId]
        );
        if (!employee) return res.status(404).json({ error: 'Zaměstnanec nenalezen' });

        // 🔐 IDOR: Employees can only create timesheets for themselves
        if (req.user.role === 'employee') {
            const selfEmployee = await db.getOne('SELECT uuid FROM employees WHERE user_id = ?', [req.user.userId]);
            if (!selfEmployee || selfEmployee.uuid !== req.body.employee_uuid) {
                return res.status(403).json({ error: 'Můžete vytvářet docházku pouze pro sebe' });
            }
        }

        const {
            date, clock_in, clock_out, break_minutes = 30,
            worked_hours, overtime_hours = 0, shift_type = 'day',
            notes, project_code,
        } = req.body;

        // Calculate worked hours from clock times if not provided
        let calcWorkedHours = worked_hours;
        if (!calcWorkedHours && clock_in && clock_out) {
            const start = new Date(`${date}T${clock_in}`);
            const end = new Date(`${date}T${clock_out}`);
            const diffMs = end - start;
            calcWorkedHours = Math.max(0, (diffMs / 3600000) - (break_minutes / 60));
        }
        calcWorkedHours = calcWorkedHours || 0;

        // Detect weekend/holiday
        const dateObj = new Date(date);
        const dayOfWeek = dateObj.getDay();
        const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6) ? 1 : 0;

        // CZ public holidays
        const isHoliday = isCzechHoliday(dateObj) ? 1 : 0;

        const uuid = crypto.randomUUID();
        await db.run(`
            INSERT INTO timesheets (
                uuid, employee_id, company_id, date, clock_in, clock_out,
                break_minutes, worked_hours, overtime_hours, shift_type,
                is_holiday, is_weekend, status, notes, project_code
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
        `, [
            uuid, employee.id, companyId, date,
            clock_in ? `${date}T${clock_in}` : null,
            clock_out ? `${date}T${clock_out}` : null,
            break_minutes, Math.round(calcWorkedHours * 100) / 100,
            overtime_hours, shift_type, isHoliday, isWeekend,
            notes || null, project_code || null,
        ]);

        const created = await db.getOne('SELECT * FROM timesheets WHERE uuid = ?', [uuid]);

        await auditLog('TIMESHEET_CREATED', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'timesheet',
            resourceId: uuid,
            ip: req.ip,
            metadata: { employee: employee.name, date },
        });

        res.status(201).json({ success: true, timesheet: created });
    } catch (error) {
        console.error('Create timesheet error:', error);
        if (error.message?.includes('unique') || error.message?.includes('duplicate')) {
            return res.status(409).json({ error: 'Docházka pro tento den již existuje' });
        }
        res.status(500).json({ error: 'Chyba při vytváření docházky' });
    }
});

// PUT /api/v2/timesheets/:uuid — Update timesheet
router.put('/:uuid', [
    param('uuid').trim().notEmpty(),
    body('clock_in').optional().trim(),
    body('clock_out').optional().trim(),
    body('break_minutes').optional().isInt({ min: 0 }),
    body('worked_hours').optional().isFloat({ min: 0 }),
    body('overtime_hours').optional().isFloat({ min: 0 }),
    body('shift_type').optional().isIn(['day', 'night', 'weekend', 'holiday']),
    body('notes').optional().trim(),
], validate, async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const existing = await db.getOne(
            'SELECT * FROM timesheets WHERE uuid = ? AND company_id = ?',
            [req.params.uuid, companyId]
        );
        if (!existing) return res.status(404).json({ error: 'Záznam nenalezen' });

        // 🔐 IDOR: Employees can only update their own timesheets
        if (req.user.role === 'employee') {
            const selfEmployee = await db.getOne('SELECT id FROM employees WHERE user_id = ?', [req.user.userId]);
            if (!selfEmployee || existing.employee_id !== selfEmployee.id) {
                return res.status(403).json({ error: 'Můžete upravovat pouze vlastní docházku' });
            }
        }

        if (existing.status === 'approved') {
            return res.status(400).json({ error: 'Schválenou docházku nelze upravovat' });
        }

        const updates = {};
        const fields = ['clock_in', 'clock_out', 'break_minutes', 'worked_hours', 'overtime_hours', 'shift_type', 'notes', 'project_code'];
        for (const f of fields) {
            if (req.body[f] !== undefined) updates[f] = req.body[f];
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'Žádné údaje k aktualizaci' });
        }

        const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 1}`);
        setClauses.push('updated_at = NOW()');
        const values = Object.values(updates);
        values.push(req.params.uuid, companyId);

        await db.run(
            `UPDATE timesheets SET ${setClauses.join(', ')} WHERE uuid = $${values.length - 1} AND company_id = $${values.length}`,
            values
        );

        const updated = await db.getOne('SELECT * FROM timesheets WHERE uuid = ?', [req.params.uuid]);
        res.json({ success: true, timesheet: updated });
    } catch (error) {
        console.error('Update timesheet error:', error);
        res.status(500).json({ error: 'Chyba při aktualizaci docházky' });
    }
});

// POST /api/v2/timesheets/:uuid/submit — Submit for approval
router.post('/:uuid/submit', [
    param('uuid').trim().notEmpty(),
], validate, async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const ts = await db.getOne(
            'SELECT * FROM timesheets WHERE uuid = ? AND company_id = ?',
            [req.params.uuid, companyId]
        );
        if (!ts) return res.status(404).json({ error: 'Záznam nenalezen' });
        if (ts.status !== 'draft') {
            return res.status(400).json({ error: 'Pouze koncepty lze odeslat ke schválení' });
        }

        await db.run(
            `UPDATE timesheets SET status = 'submitted', updated_at = NOW() WHERE uuid = ? AND company_id = ?`,
            [req.params.uuid, companyId]
        );
        res.json({ success: true, message: 'Docházka odeslána ke schválení' });
    } catch (error) {
        console.error('Submit timesheet error:', error);
        res.status(500).json({ error: 'Chyba při odesílání docházky' });
    }
});

// POST /api/v2/timesheets/bulk-submit — Submit multiple timesheets
router.post('/bulk-submit', [
    body('employee_uuid').trim().notEmpty(),
    body('month').isInt({ min: 1, max: 12 }),
    body('year').isInt({ min: 2020 }),
], validate, async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const employee = await db.getOne(
            'SELECT id FROM employees WHERE uuid = ? AND company_id = ?',
            [req.body.employee_uuid, companyId]
        );
        if (!employee) return res.status(404).json({ error: 'Zaměstnanec nenalezen' });

        const result = await db.run(`
            UPDATE timesheets SET status = 'submitted', updated_at = NOW()
            WHERE employee_id = ? AND company_id = ? AND status = 'draft'
            AND EXTRACT(YEAR FROM date) = ? AND EXTRACT(MONTH FROM date) = ?
        `, [employee.id, companyId, req.body.year, req.body.month]);

        res.json({ success: true, submitted: result.rowCount || 0 });
    } catch (error) {
        console.error('Bulk submit timesheets error:', error);
        res.status(500).json({ error: 'Chyba při hromadném odesílání' });
    }
});

// POST /api/v2/timesheets/:uuid/approve — Approve timesheet
router.post('/:uuid/approve', [
    param('uuid').trim().notEmpty(),
], validate, requireRole(['admin', 'employer', 'manager']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const ts = await db.getOne(
            'SELECT * FROM timesheets WHERE uuid = ? AND company_id = ?',
            [req.params.uuid, companyId]
        );
        if (!ts) return res.status(404).json({ error: 'Záznam nenalezen' });
        if (ts.status !== 'submitted') {
            return res.status(400).json({ error: 'Lze schválit pouze odeslanou docházku' });
        }

        await db.run(
            `UPDATE timesheets SET status = 'approved', approved_by = ?, approved_at = NOW(), updated_at = NOW()
             WHERE uuid = ? AND company_id = ?`,
            [req.user.userId, req.params.uuid, companyId]
        );

        await auditLog('TIMESHEET_APPROVED', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'timesheet',
            resourceId: req.params.uuid,
            ip: req.ip,
        });

        res.json({ success: true, message: 'Docházka schválena' });
    } catch (error) {
        console.error('Approve timesheet error:', error);
        res.status(500).json({ error: 'Chyba při schvalování docházky' });
    }
});

// POST /api/v2/timesheets/:uuid/reject — Reject timesheet
router.post('/:uuid/reject', [
    param('uuid').trim().notEmpty(),
    body('reason').trim().notEmpty().withMessage('Důvod zamítnutí je povinný'),
], validate, requireRole(['admin', 'employer', 'manager']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        await db.run(
            `UPDATE timesheets SET status = 'rejected', rejection_reason = ?, approved_by = ?, updated_at = NOW()
             WHERE uuid = ? AND company_id = ?`,
            [req.body.reason, req.user.userId, req.params.uuid, companyId]
        );

        res.json({ success: true, message: 'Docházka zamítnuta' });
    } catch (error) {
        console.error('Reject timesheet error:', error);
        res.status(500).json({ error: 'Chyba při zamítání docházky' });
    }
});

// GET /api/v2/timesheets/summary/:employee_uuid/:year/:month — Monthly summary with surcharges
router.get('/summary/:employee_uuid/:year/:month', [
    param('employee_uuid').trim().notEmpty(),
    param('year').isInt({ min: 2020 }),
    param('month').isInt({ min: 1, max: 12 }),
], validate, async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const employee = await db.getOne(
            'SELECT id, hruba_mzda_czk, uvazek_hodiny FROM employees WHERE uuid = ? AND company_id = ?',
            [req.params.employee_uuid, companyId]
        );
        if (!employee) return res.status(404).json({ error: 'Zaměstnanec nenalezen' });

        const year = parseInt(req.params.year);
        const month = parseInt(req.params.month);

        const timesheets = await db.getAll(`
            SELECT * FROM timesheets
            WHERE employee_id = ? AND company_id = ?
            AND EXTRACT(YEAR FROM date) = ? AND EXTRACT(MONTH FROM date) = ?
            ORDER BY date
        `, [employee.id, companyId, year, month]);

        const fondHodin = getWorkingHours(year, month, employee.uvazek_hodiny || 40);
        const totalWorked = timesheets.reduce((sum, t) => sum + (t.worked_hours || 0), 0);
        const totalOvertime = timesheets.reduce((sum, t) => sum + (t.overtime_hours || 0), 0);
        const nightHours = timesheets.filter(t => t.shift_type === 'night').reduce((sum, t) => sum + (t.worked_hours || 0), 0);
        const weekendHours = timesheets.filter(t => t.is_weekend).reduce((sum, t) => sum + (t.worked_hours || 0), 0);
        const holidayHours = timesheets.filter(t => t.is_holiday).reduce((sum, t) => sum + (t.worked_hours || 0), 0);
        const workedDays = timesheets.filter(t => (t.worked_hours || 0) >= 3).length;

        // Average hourly rate
        const avgHourlyRate = fondHodin > 0 ? employee.hruba_mzda_czk / fondHodin : 0;

        // Calculate surcharges
        const surcharges = calculateSurcharges({
            averageHourlyRate: avgHourlyRate,
            overtimeHours: totalOvertime,
            nightHours,
            weekendHours,
            holidayHours,
        });

        const approvedCount = timesheets.filter(t => t.status === 'approved').length;
        const pendingCount = timesheets.filter(t => t.status === 'submitted').length;
        const draftCount = timesheets.filter(t => t.status === 'draft').length;

        res.json({
            summary: {
                year,
                month,
                fondHodin,
                totalWorkedHours: Math.round(totalWorked * 100) / 100,
                totalOvertimeHours: Math.round(totalOvertime * 100) / 100,
                nightHours: Math.round(nightHours * 100) / 100,
                weekendHours: Math.round(weekendHours * 100) / 100,
                holidayHours: Math.round(holidayHours * 100) / 100,
                workedDays,
                avgHourlyRate: Math.round(avgHourlyRate * 100) / 100,
                surcharges,
                statusBreakdown: {
                    approved: approvedCount,
                    submitted: pendingCount,
                    draft: draftCount,
                    total: timesheets.length,
                },
                allApproved: approvedCount === timesheets.length && timesheets.length > 0,
            },
            timesheets,
        });
    } catch (error) {
        console.error('Timesheet summary error:', error);
        res.status(500).json({ error: 'Chyba při generování souhrnu docházky' });
    }
});

// ====================================
// SHIFT SCHEDULES
// ====================================

// GET /api/v2/timesheets/shifts — List shift schedules
router.get('/shifts', async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const shifts = await db.getAll(
            'SELECT * FROM shift_schedules WHERE company_id = ? ORDER BY start_time',
            [companyId]
        );
        res.json({ shifts });
    } catch (error) {
        console.error('List shifts error:', error);
        res.status(500).json({ error: 'Chyba při načítání směn' });
    }
});

// POST /api/v2/timesheets/shifts — Create shift schedule
router.post('/shifts', [
    body('name').trim().notEmpty().withMessage('Název směny je povinný'),
    body('start_time').matches(/^\d{2}:\d{2}$/).withMessage('Čas začátku ve formátu HH:MM'),
    body('end_time').matches(/^\d{2}:\d{2}$/).withMessage('Čas konce ve formátu HH:MM'),
    body('break_minutes').optional().isInt({ min: 0 }),
    body('working_hours').optional().isFloat({ min: 0 }),
    body('is_night_shift').optional().isBoolean(),
    body('color').optional().trim(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const uuid = crypto.randomUUID();
        const { name, start_time, end_time, break_minutes = 30, working_hours = 8, is_night_shift = false, color } = req.body;

        await db.run(`
            INSERT INTO shift_schedules (uuid, company_id, name, start_time, end_time, break_minutes, working_hours, is_night_shift, color)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [uuid, companyId, name, start_time, end_time, break_minutes, working_hours, is_night_shift ? 1 : 0, color || '#3b82f6']);

        const shift = await db.getOne('SELECT * FROM shift_schedules WHERE uuid = ?', [uuid]);
        res.status(201).json({ success: true, shift });
    } catch (error) {
        console.error('Create shift error:', error);
        res.status(500).json({ error: 'Chyba při vytváření směny' });
    }
});

// POST /api/v2/timesheets/shifts/assign — Assign employee to shift
router.post('/shifts/assign', [
    body('employee_uuid').trim().notEmpty(),
    body('shift_uuid').trim().notEmpty(),
    body('date').isDate(),
], validate, requireRole(['admin', 'employer', 'manager']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const employee = await db.getOne(
            'SELECT id FROM employees WHERE uuid = ? AND company_id = ?',
            [req.body.employee_uuid, companyId]
        );
        if (!employee) return res.status(404).json({ error: 'Zaměstnanec nenalezen' });

        const shift = await db.getOne(
            'SELECT id FROM shift_schedules WHERE uuid = ? AND company_id = ?',
            [req.body.shift_uuid, companyId]
        );
        if (!shift) return res.status(404).json({ error: 'Směna nenalezena' });

        const uuid = crypto.randomUUID();
        await db.run(`
            INSERT INTO shift_assignments (uuid, employee_id, company_id, shift_schedule_id, date)
            VALUES (?, ?, ?, ?, ?)
        `, [uuid, employee.id, companyId, shift.id, req.body.date]);

        res.status(201).json({ success: true, assignment_uuid: uuid });
    } catch (error) {
        console.error('Assign shift error:', error);
        if (error.message?.includes('unique') || error.message?.includes('duplicate')) {
            return res.status(409).json({ error: 'Zaměstnanec již má přiřazenou směnu na tento den' });
        }
        res.status(500).json({ error: 'Chyba při přiřazení směny' });
    }
});

// ====================================
// OVERTIME RULES
// ====================================

// GET /api/v2/timesheets/overtime-rules — List overtime rules
router.get('/overtime-rules', async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const rules = await db.getAll(
            'SELECT * FROM overtime_rules WHERE company_id = ? ORDER BY name',
            [companyId]
        );
        res.json({ rules });
    } catch (error) {
        console.error('List overtime rules error:', error);
        res.status(500).json({ error: 'Chyba při načítání pravidel přesčasů' });
    }
});

// POST /api/v2/timesheets/overtime-rules — Create overtime rule
router.post('/overtime-rules', [
    body('name').trim().notEmpty(),
    body('overtime_threshold_daily').optional().isFloat({ min: 0 }),
    body('overtime_threshold_weekly').optional().isFloat({ min: 0 }),
    body('overtime_rate').optional().isFloat({ min: 1.0 }),
    body('night_rate').optional().isFloat({ min: 1.0 }),
    body('weekend_rate').optional().isFloat({ min: 1.0 }),
    body('holiday_rate').optional().isFloat({ min: 1.0 }),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const uuid = crypto.randomUUID();
        const {
            name, overtime_threshold_daily = 8, overtime_threshold_weekly = 40,
            overtime_rate = 1.25, night_rate = 1.10, weekend_rate = 1.10, holiday_rate = 2.0,
            night_start = '22:00', night_end = '06:00',
        } = req.body;

        await db.run(`
            INSERT INTO overtime_rules (uuid, company_id, name, overtime_threshold_daily, overtime_threshold_weekly,
                overtime_rate, night_rate, weekend_rate, holiday_rate, night_start, night_end)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [uuid, companyId, name, overtime_threshold_daily, overtime_threshold_weekly,
            overtime_rate, night_rate, weekend_rate, holiday_rate, night_start, night_end]);

        const rule = await db.getOne('SELECT * FROM overtime_rules WHERE uuid = ?', [uuid]);
        res.status(201).json({ success: true, rule });
    } catch (error) {
        console.error('Create overtime rule error:', error);
        res.status(500).json({ error: 'Chyba při vytváření pravidla přesčasů' });
    }
});

// ====================================
// HELPERS
// ====================================

/** Check if a date is a Czech public holiday */
function isCzechHoliday(date) {
    const month = date.getMonth() + 1;
    const day = date.getDate();

    // Fixed holidays
    const fixedHolidays = [
        [1, 1],   // Nový rok / Den obnovy samostatného českého státu
        [5, 1],   // Svátek práce
        [5, 8],   // Den vítězství
        [7, 5],   // Den slovanských věrozvěstů Cyrila a Metoděje
        [7, 6],   // Den upálení mistra Jana Husa
        [9, 28],  // Den české státnosti
        [10, 28], // Den vzniku samostatného československého státu
        [11, 17], // Den boje za svobodu a demokracii
        [12, 24], // Štědrý den
        [12, 25], // 1. svátek vánoční
        [12, 26], // 2. svátek vánoční
    ];

    if (fixedHolidays.some(([m, d]) => m === month && d === day)) return true;

    // Easter Monday (moveable) — simplified approximation
    // For production, use a proper Easter calculation
    const year = date.getFullYear();
    const easter = calculateEasterMonday(year);
    if (easter && month === (easter.getMonth() + 1) && day === easter.getDate()) return true;

    // Good Friday (Velký pátek) — Easter Sunday - 2
    const goodFriday = new Date(easter);
    goodFriday.setDate(goodFriday.getDate() - 3); // Easter Monday - 3 = Good Friday
    if (month === (goodFriday.getMonth() + 1) && day === goodFriday.getDate()) return true;

    return false;
}

/** Calculate Easter Monday using anonymous Gregorian algorithm */
function calculateEasterMonday(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;

    const easterSunday = new Date(year, month - 1, day);
    const easterMonday = new Date(easterSunday);
    easterMonday.setDate(easterMonday.getDate() + 1);
    return easterMonday;
}

module.exports = router;
