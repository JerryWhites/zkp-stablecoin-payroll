// ====================================
// ⏰ Scheduled Payroll (Auto Payroll) Route Module
// ====================================
// Cron-based automatic payroll processing
// Tier requirement: autoPayroll feature (Growth+)

'use strict';

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { body, param } = require('express-validator');
const { authenticateToken, requireRole, validate, auditLog, logger } = require('../middleware/auth');
const db = require('../db');

// In-memory scheduler state
const activeTimers = new Map();

// ====================================
// SCHEDULER ENGINE
// ====================================

/**
 * Calculate next run date from day_of_month, hour, minute
 */
function calculateNextRun(dayOfMonth, hour, minute) {
    const now = new Date();
    let next = new Date(now.getFullYear(), now.getMonth(), dayOfMonth, hour, minute, 0);
    
    // If this month's date has passed, schedule next month
    if (next <= now) {
        next.setMonth(next.getMonth() + 1);
    }
    
    // Handle months with fewer days (e.g., day 31 in February → last day)
    const targetMonth = next.getMonth();
    if (next.getDate() !== dayOfMonth) {
        next = new Date(next.getFullYear(), targetMonth + 1, 0, hour, minute, 0);
    }
    
    return next;
}

/**
 * Execute a scheduled payroll run
 */
async function executeScheduledPayroll(schedule) {
    const runUuid = crypto.randomUUID();
    logger.info(`Executing scheduled payroll: ${schedule.name}`, { scheduleId: schedule.id, runUuid });

    try {
        // Record the run start
        await db.run(`
            INSERT INTO scheduled_payroll_runs (uuid, schedule_id, status, started_at)
            VALUES (?, ?, 'running', NOW())
        `, [runUuid, schedule.id]);

        // Find current year/month
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;

        // Check if period already exists
        let period = await db.getOne(
            'SELECT * FROM payroll_periods WHERE company_id = ? AND year = ? AND month = ?',
            [schedule.company_id, year, month]
        );

        // Create period if it doesn't exist
        if (!period) {
            const periodUuid = crypto.randomUUID();
            await db.run(`
                INSERT INTO payroll_periods (uuid, company_id, year, month, status)
                VALUES (?, ?, ?, ?, 'draft')
            `, [periodUuid, schedule.company_id, year, month]);
            period = await db.getOne('SELECT * FROM payroll_periods WHERE uuid = ?', [periodUuid]);
        }

        // Skip if already locked
        if (period.status === 'locked') {
            await db.run(`
                UPDATE scheduled_payroll_runs SET status = 'skipped', completed_at = NOW(),
                       error_message = 'Období je již uzamčeno'
                WHERE uuid = ?
            `, [runUuid]);

            await updateScheduleAfterRun(schedule, 'skipped');
            return;
        }

        // Get all active employees
        const employees = await db.getAll(
            'SELECT * FROM employees WHERE company_id = ? AND status = ?',
            [schedule.company_id, 'active']
        );

        if (employees.length === 0) {
            await db.run(`
                UPDATE scheduled_payroll_runs SET status = 'skipped', completed_at = NOW(),
                       error_message = 'Žádní aktivní zaměstnanci'
                WHERE uuid = ?
            `, [runUuid]);
            await updateScheduleAfterRun(schedule, 'skipped');
            return;
        }

        // Create payroll items for each employee (if auto_calculate)
        if (schedule.auto_calculate) {
            for (const emp of employees) {
                // Check if item already exists
                const existing = await db.getOne(
                    'SELECT id FROM payroll_items WHERE payroll_period_id = ? AND employee_id = ?',
                    [period.id, emp.id]
                );
                if (!existing) {
                    await db.run(`
                        INSERT INTO payroll_items (uuid, payroll_period_id, employee_id, odpracovane_hodiny, fond_hodin, status)
                        VALUES (?, ?, ?, ?, ?, 'draft')
                    `, [crypto.randomUUID(), period.id, emp.id, emp.uvazek_hodiny || 40, emp.uvazek_hodiny || 40]);
                }
            }

            // Mark period as ready for calculation
            if (period.status === 'draft') {
                await db.run("UPDATE payroll_periods SET status = 'calculated', updated_at = NOW() WHERE id = ?", [period.id]);
            }
        }

        // Auto-lock if configured (for fully automated workflows)
        if (schedule.auto_lock && period.status === 'calculated') {
            await db.run(`
                UPDATE payroll_periods SET status = 'locked', locked_at = NOW(), locked_by = ?, updated_at = NOW()
                WHERE id = ?
            `, [schedule.created_by, period.id]);
        }

        // Update run record
        await db.run(`
            UPDATE scheduled_payroll_runs 
            SET status = 'success', completed_at = NOW(), employees_processed = ?,
                payroll_period_id = ?
            WHERE uuid = ?
        `, [employees.length, period.id, runUuid]);

        await updateScheduleAfterRun(schedule, 'success');

        // Audit
        await auditLog('SCHEDULED_PAYROLL_EXECUTED', {
            userId: schedule.created_by,
            resourceType: 'scheduled_payroll',
            resourceId: schedule.uuid,
            ip: '127.0.0.1',
            metadata: { year, month, employeeCount: employees.length, periodId: period.id }
        });

        logger.info(`Scheduled payroll completed: ${employees.length} employees`, { scheduleId: schedule.id });

    } catch (error) {
        logger.error('Scheduled payroll failed', { scheduleId: schedule.id, error: error.message });
        await db.run(`
            UPDATE scheduled_payroll_runs SET status = 'failed', completed_at = NOW(), error_message = ?
            WHERE uuid = ?
        `, [error.message, runUuid]);
        await updateScheduleAfterRun(schedule, 'failed', error.message);
    }
}

async function updateScheduleAfterRun(schedule, status, errorMsg = null) {
    const nextRun = calculateNextRun(schedule.day_of_month, schedule.hour, schedule.minute);
    await db.run(`
        UPDATE scheduled_payrolls 
        SET last_run_at = NOW(), last_run_status = ?, last_run_error = ?,
            next_run_at = ?, run_count = run_count + 1, updated_at = NOW()
        WHERE id = ?
    `, [status, errorMsg, nextRun.toISOString(), schedule.id]);

    // Reschedule timer
    scheduleTimer(schedule.id, nextRun);
}

/**
 * Set a (Node.js) setTimeout for the next run
 */
function scheduleTimer(scheduleId, nextRunDate) {
    // Clear existing
    if (activeTimers.has(scheduleId)) {
        clearTimeout(activeTimers.get(scheduleId));
    }

    const delay = nextRunDate.getTime() - Date.now();
    if (delay <= 0) return;
    // Cap at 24 hours — Node.js setTimeout max is ~24.8 days (2^31-1 ms), but we re-check daily
    const cappedDelay = Math.min(delay, 24 * 60 * 60 * 1000);

    const timer = setTimeout(async () => {
        try {
            const schedule = await db.getOne('SELECT * FROM scheduled_payrolls WHERE id = ? AND is_active = 1', [scheduleId]);
            if (!schedule) return;

            const now = new Date();
            const nextRun = new Date(schedule.next_run_at);

            if (now >= nextRun) {
                await executeScheduledPayroll(schedule);
            } else {
                // Not yet time — reschedule (handles the 24h cap)
                scheduleTimer(scheduleId, nextRun);
            }
        } catch (err) {
            logger.error('Timer execution error', { scheduleId, error: err.message });
        }
    }, cappedDelay);

    activeTimers.set(scheduleId, timer);
}

/**
 * Initialize all active schedules on server start
 */
async function initScheduler() {
    try {
        const schedules = await db.getAll('SELECT * FROM scheduled_payrolls WHERE is_active = 1');
        for (const s of schedules) {
            const nextRun = s.next_run_at ? new Date(s.next_run_at) : calculateNextRun(s.day_of_month, s.hour, s.minute);
            scheduleTimer(s.id, nextRun);
        }
        logger.info(`Scheduler initialized: ${schedules.length} active schedule(s)`);
    } catch (err) {
        logger.error('Scheduler init error', { error: err.message });
    }
}

// ====================================
// ROUTES
// ====================================

// GET /api/v2/scheduler — List schedules for company
router.get('/', authenticateToken, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
        const schedules = await db.getAll(`
            SELECT sp.*, u.email as created_by_email,
                   (SELECT COUNT(*) FROM scheduled_payroll_runs WHERE schedule_id = sp.id) as total_runs,
                   (SELECT COUNT(*) FROM scheduled_payroll_runs WHERE schedule_id = sp.id AND status = 'success') as successful_runs
            FROM scheduled_payrolls sp
            JOIN users u ON sp.created_by = u.id
            WHERE sp.company_id = ?
            ORDER BY sp.created_at DESC
        `, [user.company_id]);

        res.json({ schedules });
    } catch (error) {
        logger.error('List schedules error', { error: error.message });
        res.status(500).json({ error: 'Nepodařilo se načíst rozvrhy' });
    }
});

// POST /api/v2/scheduler — Create schedule
router.post('/',
    authenticateToken,
    requireRole(['admin', 'employer']),
    body('name').optional().trim().isLength({ max: 100 }),
    body('day_of_month').isInt({ min: 1, max: 28 }).withMessage('Den musí být 1-28'),
    body('hour').isInt({ min: 0, max: 23 }).withMessage('Hodina 0-23'),
    body('minute').optional().isInt({ min: 0, max: 59 }),
    body('auto_calculate').optional().isBoolean(),
    body('auto_lock').optional().isBoolean(),
    body('notify_before_hours').optional().isInt({ min: 1, max: 72 }),
    validate,
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
            const { name = 'Měsíční výplaty', day_of_month, hour, minute = 0, auto_calculate = true, auto_lock = false, notify_before_hours = 24 } = req.body;

            // Only one active schedule per company
            const existing = await db.getOne('SELECT id FROM scheduled_payrolls WHERE company_id = ? AND is_active = 1', [user.company_id]);
            if (existing) {
                return res.status(400).json({ error: 'Již máte aktivní rozvrh. Nejdříve ho deaktivujte.' });
            }

            const uuid = crypto.randomUUID();
            const cronExpression = `${minute} ${hour} ${day_of_month} * *`;
            const nextRun = calculateNextRun(day_of_month, hour, minute);

            await db.run(`
                INSERT INTO scheduled_payrolls (uuid, company_id, created_by, name, cron_expression, day_of_month, hour, minute, auto_calculate, auto_lock, notify_before_hours, next_run_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [uuid, user.company_id, req.user.userId, name, cronExpression, day_of_month, hour, minute,
                auto_calculate ? 1 : 0, auto_lock ? 1 : 0, notify_before_hours, nextRun.toISOString()]);

            const schedule = await db.getOne('SELECT * FROM scheduled_payrolls WHERE uuid = ?', [uuid]);
            scheduleTimer(schedule.id, nextRun);

            await auditLog('SCHEDULE_CREATED', {
                userId: req.user.userId,
                userEmail: req.user.email,
                resourceType: 'scheduled_payroll',
                resourceId: uuid,
                ip: req.ip,
                metadata: { name, day_of_month, hour, minute }
            });

            res.status(201).json({
                message: 'Rozvrh vytvořen',
                schedule: { ...schedule, next_run_at: nextRun.toISOString() }
            });
        } catch (error) {
            logger.error('Create schedule error', { error: error.message });
            res.status(500).json({ error: 'Nepodařilo se vytvořit rozvrh' });
        }
    }
);

// PATCH /api/v2/scheduler/:uuid — Update schedule
router.patch('/:uuid',
    authenticateToken,
    requireRole(['admin', 'employer']),
    param('uuid').isUUID(),
    body('day_of_month').optional().isInt({ min: 1, max: 28 }),
    body('hour').optional().isInt({ min: 0, max: 23 }),
    body('minute').optional().isInt({ min: 0, max: 59 }),
    body('is_active').optional().isBoolean(),
    body('auto_calculate').optional().isBoolean(),
    body('auto_lock').optional().isBoolean(),
    body('name').optional().trim().isLength({ max: 100 }),
    validate,
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
            const schedule = await db.getOne('SELECT * FROM scheduled_payrolls WHERE uuid = ? AND company_id = ?', [req.params.uuid, user.company_id]);
            if (!schedule) return res.status(404).json({ error: 'Rozvrh nenalezen' });

            const updates = [];
            const params = [];
            const fields = ['name', 'day_of_month', 'hour', 'minute', 'auto_calculate', 'auto_lock', 'is_active', 'notify_before_hours'];
            for (const f of fields) {
                if (req.body[f] !== undefined) {
                    updates.push(`${f} = ?`);
                    params.push(typeof req.body[f] === 'boolean' ? (req.body[f] ? 1 : 0) : req.body[f]);
                }
            }

            if (updates.length === 0) return res.status(400).json({ error: 'Žádné změny' });

            // Recalculate next run if schedule params changed
            const day = req.body.day_of_month ?? schedule.day_of_month;
            const hr = req.body.hour ?? schedule.hour;
            const min = req.body.minute ?? schedule.minute;
            const nextRun = calculateNextRun(day, hr, min);
            updates.push('next_run_at = ?', 'cron_expression = ?');
            params.push(nextRun.toISOString(), `${min} ${hr} ${day} * *`);

            params.push(req.params.uuid, user.company_id);
            await db.run(`UPDATE scheduled_payrolls SET ${updates.join(', ')}, updated_at = NOW() WHERE uuid = ? AND company_id = ?`, params);

            // Reschedule or cancel timer
            const isActive = req.body.is_active !== undefined ? req.body.is_active : schedule.is_active;
            if (isActive) {
                scheduleTimer(schedule.id, nextRun);
            } else if (activeTimers.has(schedule.id)) {
                clearTimeout(activeTimers.get(schedule.id));
                activeTimers.delete(schedule.id);
            }

            await auditLog('SCHEDULE_UPDATED', {
                userId: req.user.userId,
                userEmail: req.user.email,
                resourceType: 'scheduled_payroll',
                resourceId: req.params.uuid,
                ip: req.ip,
                metadata: req.body
            });

            res.json({ message: 'Rozvrh aktualizován', next_run_at: nextRun.toISOString() });
        } catch (error) {
            logger.error('Update schedule error', { error: error.message });
            res.status(500).json({ error: 'Nepodařilo se aktualizovat rozvrh' });
        }
    }
);

// DELETE /api/v2/scheduler/:uuid — Delete schedule
router.delete('/:uuid',
    authenticateToken,
    requireRole(['admin', 'employer']),
    param('uuid').isUUID(),
    validate,
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
            const schedule = await db.getOne('SELECT * FROM scheduled_payrolls WHERE uuid = ? AND company_id = ?', [req.params.uuid, user.company_id]);
            if (!schedule) return res.status(404).json({ error: 'Rozvrh nenalezen' });

            // Cancel timer
            if (activeTimers.has(schedule.id)) {
                clearTimeout(activeTimers.get(schedule.id));
                activeTimers.delete(schedule.id);
            }

            await db.run('DELETE FROM scheduled_payroll_runs WHERE schedule_id = ?', [schedule.id]);
            await db.run('DELETE FROM scheduled_payrolls WHERE id = ?', [schedule.id]);

            await auditLog('SCHEDULE_DELETED', {
                userId: req.user.userId,
                userEmail: req.user.email,
                resourceType: 'scheduled_payroll',
                resourceId: req.params.uuid,
                ip: req.ip
            });

            res.json({ message: 'Rozvrh smazán' });
        } catch (error) {
            logger.error('Delete schedule error', { error: error.message });
            res.status(500).json({ error: 'Nepodařilo se smazat rozvrh' });
        }
    }
);

// POST /api/v2/scheduler/:uuid/run-now — Manually trigger a scheduled run
router.post('/:uuid/run-now',
    authenticateToken,
    requireRole(['admin', 'employer']),
    param('uuid').isUUID(),
    validate,
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
            const schedule = await db.getOne('SELECT * FROM scheduled_payrolls WHERE uuid = ? AND company_id = ?', [req.params.uuid, user.company_id]);
            if (!schedule) return res.status(404).json({ error: 'Rozvrh nenalezen' });

            // Execute asynchronously
            executeScheduledPayroll(schedule).catch(err => {
                logger.error('Manual scheduled run failed', { error: err.message });
            });

            res.json({ message: 'Ruční spuštění zahájeno' });
        } catch (error) {
            logger.error('Manual run error', { error: error.message });
            res.status(500).json({ error: 'Nepodařilo se spustit' });
        }
    }
);

// GET /api/v2/scheduler/:uuid/history — Run history
router.get('/:uuid/history',
    authenticateToken,
    requireRole(['admin', 'employer']),
    param('uuid').isUUID(),
    validate,
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
            const schedule = await db.getOne('SELECT * FROM scheduled_payrolls WHERE uuid = ? AND company_id = ?', [req.params.uuid, user.company_id]);
            if (!schedule) return res.status(404).json({ error: 'Rozvrh nenalezen' });

            const runs = await db.getAll(`
                SELECT * FROM scheduled_payroll_runs 
                WHERE schedule_id = ?
                ORDER BY created_at DESC
                LIMIT 50
            `, [schedule.id]);

            res.json({ runs });
        } catch (error) {
            logger.error('Schedule history error', { error: error.message });
            res.status(500).json({ error: 'Nepodařilo se načíst historii' });
        }
    }
);

module.exports = router;
module.exports.initScheduler = initScheduler;
