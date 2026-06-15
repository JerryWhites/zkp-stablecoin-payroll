// ====================================
// 🔒 SECURITY MONITORING & ALERTING (PostgreSQL)
// ====================================
// Features:
// - Real-time security event monitoring
// - Anomaly detection
// - Alert notifications (console, webhook)
// - Security metrics dashboard data

const db = require('./db');
require('dotenv').config();

// Alert thresholds
const THRESHOLDS = {
    FAILED_LOGINS_PER_HOUR: 10,
    FAILED_LOGINS_PER_IP: 5,
    RATE_LIMIT_VIOLATIONS_PER_HOUR: 20,
    UNUSUAL_PAYROLL_AMOUNT: 500000000000, // 500k USDCx
    MAX_PAYROLL_PER_DAY: 5
};

/**
 * Get security metrics for the last N hours
 */
async function getSecurityMetrics(hours = 24) {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    
    const metrics = {
        timestamp: new Date().toISOString(),
        period: `${hours} hours`,
        
        // Login attempts
        loginAttempts: {
            total: 0,
            successful: 0,
            failed: 0,
            lockedAccounts: 0
        },
        
        // Rate limiting
        rateLimiting: {
            violations: 0,
            uniqueIPs: 0
        },
        
        // Payroll activity
        payroll: {
            prepared: 0,
            completed: 0,
            totalAmount: 0
        },
        
        // Suspicious activity
        suspicious: {
            multipleFailedIPs: [],
            unusualActivity: []
        }
    };
    
    try {
        // Login metrics
        const loginSuccess = await db.getOne(
            `SELECT COUNT(*) as count FROM audit_log 
             WHERE action = 'LOGIN_SUCCESS' AND timestamp > $1`,
            [cutoff]
        );
        
        const loginFailed = await db.getOne(
            `SELECT COUNT(*) as count FROM audit_log 
             WHERE action = 'LOGIN_FAILED' AND timestamp > $1`,
            [cutoff]
        );
        
        const lockedAccounts = await db.getOne(
            `SELECT COUNT(*) as count FROM users 
             WHERE locked_until IS NOT NULL AND locked_until > NOW()`
        );
        
        metrics.loginAttempts.successful = parseInt(loginSuccess?.count) || 0;
        metrics.loginAttempts.failed = parseInt(loginFailed?.count) || 0;
        metrics.loginAttempts.total = metrics.loginAttempts.successful + metrics.loginAttempts.failed;
        metrics.loginAttempts.lockedAccounts = parseInt(lockedAccounts?.count) || 0;
        
        // Rate limit violations
        const rateLimitViolations = await db.getOne(
            `SELECT COUNT(*) as count FROM audit_log 
             WHERE action = 'AUTH_RATE_LIMIT_EXCEEDED' AND timestamp > $1`,
            [cutoff]
        );
        
        const uniqueRateLimitIPs = await db.getOne(
            `SELECT COUNT(DISTINCT ip_address) as count FROM audit_log 
             WHERE action = 'AUTH_RATE_LIMIT_EXCEEDED' AND timestamp > $1`,
            [cutoff]
        );
        
        metrics.rateLimiting.violations = parseInt(rateLimitViolations?.count) || 0;
        metrics.rateLimiting.uniqueIPs = parseInt(uniqueRateLimitIPs?.count) || 0;
        
        // Payroll metrics
        const payrollPrepared = await db.getOne(
            `SELECT COUNT(*) as count FROM audit_log 
             WHERE action = 'PAYROLL_PREPARED' AND timestamp > $1`,
            [cutoff]
        );

        try {
            const payrollCompleted = await db.getOne(
                `SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as total FROM payroll_runs 
                 WHERE status = 'completed'`
            );
            metrics.payroll.completed = parseInt(payrollCompleted?.count) || 0;
            metrics.payroll.totalAmount = parseFloat(payrollCompleted?.total) || 0;
        } catch (e) {
            // Table might not exist yet
        }
        
        metrics.payroll.prepared = parseInt(payrollPrepared?.count) || 0;
        
        // Suspicious activity detection
        const failedByIP = await db.getAll(
            `SELECT ip_address, COUNT(*) as count FROM audit_log 
             WHERE action = 'LOGIN_FAILED' AND timestamp > $1
             GROUP BY ip_address 
             HAVING COUNT(*) >= $2`,
            [cutoff, THRESHOLDS.FAILED_LOGINS_PER_IP]
        );
        
        metrics.suspicious.multipleFailedIPs = (failedByIP || []).map(r => ({
            ip: r.ip_address,
            attempts: parseInt(r.count)
        }));
        
    } catch (error) {
        console.error('Error collecting metrics:', error.message);
    }
    
    return metrics;
}

/**
 * Check for security alerts
 */
async function checkAlerts() {
    const alerts = [];
    const metrics = await getSecurityMetrics(1); // Last hour
    
    // Check failed login threshold
    if (metrics.loginAttempts.failed >= THRESHOLDS.FAILED_LOGINS_PER_HOUR) {
        alerts.push({
            level: 'HIGH',
            type: 'BRUTE_FORCE_ATTEMPT',
            message: `${metrics.loginAttempts.failed} failed login attempts in the last hour`,
            timestamp: new Date().toISOString()
        });
    }
    
    // Check rate limit violations
    if (metrics.rateLimiting.violations >= THRESHOLDS.RATE_LIMIT_VIOLATIONS_PER_HOUR) {
        alerts.push({
            level: 'MEDIUM',
            type: 'RATE_LIMIT_ABUSE',
            message: `${metrics.rateLimiting.violations} rate limit violations in the last hour`,
            timestamp: new Date().toISOString()
        });
    }
    
    // Check locked accounts
    if (metrics.loginAttempts.lockedAccounts > 0) {
        alerts.push({
            level: 'INFO',
            type: 'ACCOUNTS_LOCKED',
            message: `${metrics.loginAttempts.lockedAccounts} account(s) currently locked`,
            timestamp: new Date().toISOString()
        });
    }
    
    // Check suspicious IPs
    if (metrics.suspicious.multipleFailedIPs.length > 0) {
        alerts.push({
            level: 'HIGH',
            type: 'SUSPICIOUS_IPS',
            message: `${metrics.suspicious.multipleFailedIPs.length} IP(s) with multiple failed attempts`,
            details: metrics.suspicious.multipleFailedIPs,
            timestamp: new Date().toISOString()
        });
    }
    
    // Check unusual payroll amount
    if (metrics.payroll.totalAmount > THRESHOLDS.UNUSUAL_PAYROLL_AMOUNT) {
        alerts.push({
            level: 'MEDIUM',
            type: 'HIGH_PAYROLL_VOLUME',
            message: `Unusual payroll volume: ${metrics.payroll.totalAmount / 1000000} USDCx`,
            timestamp: new Date().toISOString()
        });
    }
    
    return alerts;
}

/**
 * Get recent audit log entries
 */
async function getRecentAuditLog(limit = 100, action = null) {
    if (action) {
        return await db.getAll(
            'SELECT * FROM audit_log WHERE action = $1 ORDER BY timestamp DESC LIMIT $2',
            [action, limit]
        );
    }
    return await db.getAll(
        'SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT $1',
        [limit]
    );
}

/**
 * Get failed login attempts grouped by various dimensions
 */
async function getFailedLoginAnalysis(hours = 24) {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    
    const byHour = await db.getAll(
        `SELECT 
            to_char(timestamp, 'YYYY-MM-DD HH24:00') as hour,
            COUNT(*) as count
        FROM audit_log 
        WHERE action = 'LOGIN_FAILED' AND timestamp > $1
        GROUP BY hour
        ORDER BY hour`,
        [cutoff]
    );
    
    const byEmail = await db.getAll(
        `SELECT 
            user_email,
            COUNT(*) as count
        FROM audit_log 
        WHERE action = 'LOGIN_FAILED' AND timestamp > $1
        GROUP BY user_email
        ORDER BY count DESC
        LIMIT 10`,
        [cutoff]
    );
    
    const byIP = await db.getAll(
        `SELECT 
            ip_address,
            COUNT(*) as count
        FROM audit_log 
        WHERE action = 'LOGIN_FAILED' AND timestamp > $1
        GROUP BY ip_address
        ORDER BY count DESC
        LIMIT 10`,
        [cutoff]
    );
    
    return { byHour: byHour || [], byEmail: byEmail || [], byIP: byIP || [] };
}

/**
 * Generate security report
 */
async function generateSecurityReport() {
    const metrics24h = await getSecurityMetrics(24);
    const metrics7d = await getSecurityMetrics(168);
    const alerts = await checkAlerts();
    const failedAnalysis = await getFailedLoginAnalysis(24);
    
    const report = {
        generated: new Date().toISOString(),
        summary: {
            status: alerts.filter(a => a.level === 'HIGH').length > 0 ? 'ALERT' : 
                    alerts.filter(a => a.level === 'MEDIUM').length > 0 ? 'WARNING' : 'OK',
            alertCount: alerts.length,
            highPriorityAlerts: alerts.filter(a => a.level === 'HIGH').length
        },
        last24Hours: metrics24h,
        last7Days: metrics7d,
        activeAlerts: alerts,
        failedLoginAnalysis: failedAnalysis
    };
    
    return report;
}

/**
 * Print security dashboard to console
 */
async function printDashboard() {
    const report = await generateSecurityReport();
    
    console.log('\n' + '='.repeat(60));
    console.log('🔒 UNHACKABLE PAYROLL - SECURITY DASHBOARD');
    console.log('='.repeat(60));
    console.log(`Generated: ${report.generated}`);
    console.log(`Status: ${report.summary.status}`);
    console.log('');
    
    console.log('📊 LAST 24 HOURS:');
    console.log(`   Login attempts: ${report.last24Hours.loginAttempts.total} (${report.last24Hours.loginAttempts.failed} failed)`);
    console.log(`   Locked accounts: ${report.last24Hours.loginAttempts.lockedAccounts}`);
    console.log(`   Rate limit violations: ${report.last24Hours.rateLimiting.violations}`);
    console.log(`   Payroll runs: ${report.last24Hours.payroll.completed}`);
    console.log('');
    
    if (report.activeAlerts.length > 0) {
        console.log('⚠️  ACTIVE ALERTS:');
        report.activeAlerts.forEach(alert => {
            const icon = alert.level === 'HIGH' ? '🔴' : alert.level === 'MEDIUM' ? '🟡' : '🔵';
            console.log(`   ${icon} [${alert.level}] ${alert.type}: ${alert.message}`);
        });
        console.log('');
    }
    
    if (report.failedLoginAnalysis.byIP.length > 0) {
        console.log('🔍 TOP FAILED LOGIN IPs:');
        report.failedLoginAnalysis.byIP.slice(0, 5).forEach(ip => {
            console.log(`   ${ip.ip_address}: ${ip.count} attempts`);
        });
    }
    
    console.log('\n' + '='.repeat(60));
}

// CLI interface
if (require.main === module) {
    const args = process.argv.slice(2);
    const command = args[0];
    
    (async () => {
        try {
            switch (command) {
                case 'dashboard':
                    await printDashboard();
                    break;
                    
                case 'alerts': {
                    const alerts = await checkAlerts();
                    console.log(JSON.stringify(alerts, null, 2));
                    break;
                }
                    
                case 'metrics': {
                    const hours = parseInt(args[1]) || 24;
                    const metrics = await getSecurityMetrics(hours);
                    console.log(JSON.stringify(metrics, null, 2));
                    break;
                }
                    
                case 'report': {
                    const report = await generateSecurityReport();
                    console.log(JSON.stringify(report, null, 2));
                    break;
                }
                    
                case 'audit': {
                    const limit = parseInt(args[1]) || 50;
                    const action = args[2] || null;
                    const logs = await getRecentAuditLog(limit, action);
                    console.log(JSON.stringify(logs, null, 2));
                    break;
                }
                    
                default:
                    console.log('🔒 Security Monitoring Tool\n');
                    console.log('Usage: node security-monitor.js <command>\n');
                    console.log('Commands:');
                    console.log('  dashboard         - Show security dashboard');
                    console.log('  alerts            - Check current alerts');
                    console.log('  metrics [hours]   - Get security metrics');
                    console.log('  report            - Generate full security report');
                    console.log('  audit [limit] [action] - View audit log');
            }
        } catch (err) {
            console.error('Error:', err.message);
        } finally {
            await db.close();
        }
    })();
}

module.exports = {
    getSecurityMetrics,
    checkAlerts,
    getRecentAuditLog,
    generateSecurityReport
};
