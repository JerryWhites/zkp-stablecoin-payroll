// ====================================
// 📈 SLA Monitoring Route Module
// ====================================
// Health checks, uptime tracking, incident management
// Provides real measured SLA data instead of static strings

'use strict';

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { body, param, query } = require('express-validator');
const { authenticateToken, requireRole, validate, auditLog, logger } = require('../middleware/auth');
const db = require('../db');

// ====================================
// SLA CHECK ENGINE
// ====================================

let slaCheckInterval = null;

/**
 * Run a full health check and record it
 */
async function runSlaCheck() {
    const startTime = Date.now();
    let status = 'up';
    let errorMessage = null;
    const metadata = {};

    try {
        // 1. Database check
        const dbStart = Date.now();
        await db.getOne('SELECT 1 as ok');
        metadata.db_ms = Date.now() - dbStart;

        // 2. Check critical tables exist
        const tableCheck = await db.getOne("SELECT COUNT(*) as cnt FROM users");
        metadata.users_count = tableCheck?.cnt || 0;

        // 3. Check disk (logs directory)
        const fs = require('fs');
        try {
            fs.accessSync('logs', fs.constants.W_OK);
            metadata.disk_writable = true;
        } catch {
            metadata.disk_writable = false;
            status = 'degraded';
        }

        // 4. Memory usage
        const mem = process.memoryUsage();
        metadata.memory_rss_mb = Math.round(mem.rss / 1024 / 1024);
        metadata.memory_heap_mb = Math.round(mem.heapUsed / 1024 / 1024);

        if (metadata.memory_rss_mb > 512) {
            status = 'degraded';
        }

    } catch (error) {
        status = 'down';
        errorMessage = error.message;
    }

    const responseTimeMs = Date.now() - startTime;

    try {
        await db.run(`
            INSERT INTO sla_checks (check_type, status, response_time_ms, error_message, metadata)
            VALUES ('full', ?, ?, ?, ?)
        `, [status, responseTimeMs, errorMessage, JSON.stringify(metadata)]);
    } catch (dbErr) {
        logger.error('Failed to record SLA check', { error: dbErr.message });
    }

    return { status, response_time_ms: responseTimeMs, metadata, error: errorMessage };
}

/**
 * Calculate uptime for a time range
 */
async function calculateUptime(hours = 720) { // default 30 days
    // 🔐 FIXED: Parameterized interval instead of string interpolation
    const safeHours = Math.max(1, Math.min(parseInt(hours) || 720, 8760));
    const checks = await db.getAll(`
        SELECT status, checked_at FROM sla_checks 
        WHERE checked_at > NOW() - CAST($1 || ' hours' AS INTERVAL)
        ORDER BY checked_at ASC
    `, [safeHours]);

    if (checks.length === 0) return { percentage: 100, total_checks: 0 };

    const total = checks.length;
    const upChecks = checks.filter(c => c.status === 'up').length;
    const degradedChecks = checks.filter(c => c.status === 'degraded').length;
    const downChecks = checks.filter(c => c.status === 'down').length;

    // Degraded counts as 50% up
    const effectiveUp = upChecks + (degradedChecks * 0.5);
    const percentage = (effectiveUp / total) * 100;

    // Response time percentiles
    const responseTimes = await db.getAll(`
        SELECT response_time_ms FROM sla_checks 
        WHERE checked_at > NOW() - CAST($1 || ' hours' AS INTERVAL)
        ORDER BY response_time_ms ASC
    `, [safeHours]);
    const times = responseTimes.map(r => r.response_time_ms).filter(t => t != null);
    const avgMs = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
    const p95Ms = times.length ? times[Math.floor(times.length * 0.95)] : 0;
    const p99Ms = times.length ? times[Math.floor(times.length * 0.99)] : 0;

    return {
        percentage: Math.round(percentage * 1000) / 1000,
        total_checks: total,
        up_checks: upChecks,
        degraded_checks: degradedChecks,
        down_checks: downChecks,
        avg_response_ms: avgMs,
        p95_response_ms: p95Ms,
        p99_response_ms: p99Ms
    };
}

/**
 * Initialize periodic SLA checks (every 5 minutes)
 */
function initSlaMonitoring() {
    // Run immediately
    runSlaCheck().catch(err => logger.error('Initial SLA check failed', { error: err.message }));

    // Then every 5 minutes
    slaCheckInterval = setInterval(() => {
        runSlaCheck().catch(err => logger.error('SLA check failed', { error: err.message }));
    }, 5 * 60 * 1000);

    // Monthly report generation (check daily)
    setInterval(async () => {
        try {
            const now = new Date();
            // Generate report for previous month on the 1st
            if (now.getDate() === 1 && now.getHours() === 0) {
                const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
                const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
                await generateMonthlyReport(prevYear, prevMonth);
            }
        } catch (err) {
            logger.error('Monthly report generation failed', { error: err.message });
        }
    }, 60 * 60 * 1000); // Check hourly

    logger.info('SLA monitoring initialized (5 min interval)');
}

async function generateMonthlyReport(year, month) {
    const existing = await db.getOne('SELECT id FROM sla_monthly_reports WHERE year = ? AND month = ?', [year, month]);
    if (existing) return;

    // Calculate from checks for that month
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    const checks = await db.getAll(`
        SELECT * FROM sla_checks WHERE checked_at >= ? AND checked_at <= ?
    `, [startDate.toISOString(), endDate.toISOString()]);

    if (checks.length === 0) return;

    const total = checks.length;
    const successful = checks.filter(c => c.status === 'up').length;
    const uptime = (successful / total) * 100;
    const times = checks.map(c => c.response_time_ms).filter(Boolean).sort((a, b) => a - b);
    const avgMs = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
    const p95 = times.length ? times[Math.floor(times.length * 0.95)] : 0;
    const p99 = times.length ? times[Math.floor(times.length * 0.99)] : 0;

    const incidents = await db.getOne(`
        SELECT COUNT(*) as cnt, COALESCE(SUM(duration_minutes), 0) as total_downtime
        FROM sla_incidents WHERE started_at >= ? AND started_at <= ?
    `, [startDate.toISOString(), endDate.toISOString()]);

    await db.run(`
        INSERT INTO sla_monthly_reports (year, month, total_checks, successful_checks, uptime_percentage, avg_response_time_ms, p95_response_time_ms, p99_response_time_ms, incidents_count, total_downtime_minutes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [year, month, total, successful, uptime, avgMs, p95, p99, incidents?.cnt || 0, incidents?.total_downtime || 0]);

    logger.info(`SLA monthly report generated: ${year}-${String(month).padStart(2, '0')} — ${uptime.toFixed(3)}%`);
}

// ====================================
// ROUTES
// ====================================

// GET /api/v2/sla/status — Current system status (public)
// 🔐 FIXED: Limit publicly exposed information — no internal response times or P95/P99 metrics
router.get('/status', async (req, res) => {
    try {
        const lastCheck = await db.getOne('SELECT status, checked_at FROM sla_checks ORDER BY checked_at DESC LIMIT 1');
        const uptime30d = await calculateUptime(720);
        const uptime7d = await calculateUptime(168);
        const uptime24h = await calculateUptime(24);

        // Active incidents — only expose public-safe fields
        const activeIncidents = await db.getAll(
            "SELECT uuid, title, severity, status, started_at FROM sla_incidents WHERE status != 'resolved' ORDER BY started_at DESC"
        );

        res.json({
            current_status: lastCheck?.status || 'unknown',
            last_check: lastCheck?.checked_at || null,
            uptime: {
                '24h': uptime24h.percentage,
                '7d': uptime7d.percentage,
                '30d': uptime30d.percentage
            },
            active_incidents: activeIncidents.map(i => ({
                title: i.title,
                severity: i.severity,
                status: i.status,
                started_at: i.started_at
            })),
            total_checks_30d: uptime30d.total_checks
        });
    } catch (error) {
        logger.error('SLA status error', { error: error.message });
        res.status(500).json({ error: 'Nepodařilo se načíst stav', current_status: 'unknown' });
    }
});

// GET /api/v2/sla/history — Check history (authenticated)
router.get('/history', authenticateToken, requireRole(['admin']), async (req, res) => {
    try {
        const hours = Math.max(1, Math.min(parseInt(req.query.hours) || 24, 720));
        // 🔐 FIXED: Parameterized interval
        const checks = await db.getAll(`
            SELECT * FROM sla_checks 
            WHERE checked_at > NOW() - CAST($1 || ' hours' AS INTERVAL)
            ORDER BY checked_at DESC
            LIMIT 500
        `, [hours]);

        res.json({ checks, hours });
    } catch (error) {
        logger.error('SLA history error', { error: error.message });
        res.status(500).json({ error: 'Nepodařilo se načíst historii' });
    }
});

// GET /api/v2/sla/reports — Monthly reports
router.get('/reports', authenticateToken, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const reports = await db.getAll('SELECT * FROM sla_monthly_reports ORDER BY year DESC, month DESC LIMIT 12');
        res.json({ reports });
    } catch (error) {
        logger.error('SLA reports error', { error: error.message });
        res.status(500).json({ error: 'Nepodařilo se načíst reporty' });
    }
});

// POST /api/v2/sla/check — Run an ad-hoc check
router.post('/check', authenticateToken, requireRole(['admin']), async (req, res) => {
    try {
        const result = await runSlaCheck();
        res.json({ check: result });
    } catch (error) {
        logger.error('Manual SLA check error', { error: error.message });
        res.status(500).json({ error: 'Check selhal' });
    }
});

// ====================================
// INCIDENT MANAGEMENT
// ====================================

// GET /api/v2/sla/incidents
router.get('/incidents', authenticateToken, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const incidents = await db.getAll('SELECT * FROM sla_incidents ORDER BY started_at DESC LIMIT 50');
        incidents.forEach(i => { i.affected_services = JSON.parse(i.affected_services || '[]'); });
        res.json({ incidents });
    } catch (error) {
        logger.error('List incidents error', { error: error.message });
        res.status(500).json({ error: 'Nepodařilo se načíst incidenty' });
    }
});

// POST /api/v2/sla/incidents — Create incident
router.post('/incidents',
    authenticateToken,
    requireRole(['admin']),
    body('title').trim().isLength({ min: 1, max: 300 }),
    body('description').optional().isString(),
    body('severity').isIn(['minor', 'major', 'critical']),
    body('affected_services').optional().isArray(),
    validate,
    async (req, res) => {
        try {
            const uuid = crypto.randomUUID();
            const { title, description, severity, affected_services = [] } = req.body;

            await db.run(`
                INSERT INTO sla_incidents (uuid, title, description, severity, affected_services)
                VALUES (?, ?, ?, ?, ?)
            `, [uuid, title, description, severity, JSON.stringify(affected_services)]);

            await auditLog('INCIDENT_CREATED', {
                userId: req.user.userId,
                userEmail: req.user.email,
                resourceType: 'sla_incident',
                resourceId: uuid,
                ip: req.ip,
                metadata: { title, severity }
            });

            res.status(201).json({ uuid, message: 'Incident vytvořen' });
        } catch (error) {
            logger.error('Create incident error', { error: error.message });
            res.status(500).json({ error: 'Nepodařilo se vytvořit incident' });
        }
    }
);

// PATCH /api/v2/sla/incidents/:uuid — Update incident status
router.patch('/incidents/:uuid',
    authenticateToken,
    requireRole(['admin']),
    param('uuid').isUUID(),
    body('status').optional().isIn(['investigating', 'identified', 'monitoring', 'resolved']),
    body('description').optional().isString(),
    validate,
    async (req, res) => {
        try {
            const incident = await db.getOne('SELECT * FROM sla_incidents WHERE uuid = ?', [req.params.uuid]);
            if (!incident) return res.status(404).json({ error: 'Incident nenalezen' });

            const updates = [];
            const params = [];

            if (req.body.status) {
                updates.push('status = ?');
                params.push(req.body.status);
                if (req.body.status === 'resolved') {
                    updates.push('resolved_at = NOW()');
                    const durationMin = Math.round((Date.now() - new Date(incident.started_at).getTime()) / 60000);
                    updates.push('duration_minutes = ?');
                    params.push(durationMin);
                }
            }
            if (req.body.description) { updates.push('description = ?'); params.push(req.body.description); }

            if (updates.length === 0) return res.status(400).json({ error: 'Žádné změny' });

            params.push(req.params.uuid);
            await db.run(`UPDATE sla_incidents SET ${updates.join(', ')}, updated_at = NOW() WHERE uuid = ?`, params);

            res.json({ message: 'Incident aktualizován' });
        } catch (error) {
            logger.error('Update incident error', { error: error.message });
            res.status(500).json({ error: 'Nepodařilo se aktualizovat incident' });
        }
    }
);

module.exports = router;
module.exports.initSlaMonitoring = initSlaMonitoring;
module.exports.runSlaCheck = runSlaCheck;
