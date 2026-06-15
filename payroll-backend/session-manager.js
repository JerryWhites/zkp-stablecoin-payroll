// ====================================
// 🔐 SESSION MANAGEMENT (PostgreSQL)
// ====================================
// Features:
// - Session tracking and validation
// - Device fingerprinting
// - Concurrent session limits
// - Session revocation
// - Automatic session cleanup

const db = require('./db');
const crypto = require('crypto');
require('dotenv').config();

// Configuration
const SESSION_CONFIG = {
    MAX_CONCURRENT_SESSIONS: 3,
    SESSION_TIMEOUT_HOURS: 24,
    REFRESH_TOKEN_DAYS: 7,
    REQUIRE_DEVICE_MATCH: true
};

// Initialize sessions table
async function initSessionsTable() {
    await db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            refresh_token_hash TEXT NOT NULL,
            device_fingerprint TEXT,
            ip_address TEXT,
            user_agent TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            last_active TIMESTAMP DEFAULT NOW(),
            expires_at TIMESTAMP NOT NULL,
            revoked INTEGER DEFAULT 0,
            revoke_reason TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(refresh_token_hash);
    `);
}

/**
 * Generate device fingerprint from request
 */
function generateDeviceFingerprint(req) {
    const components = [
        req.get('User-Agent') || '',
        req.get('Accept-Language') || '',
        req.get('Accept-Encoding') || '',
    ];
    
    return crypto.createHash('sha256')
        .update(components.join('|'))
        .digest('hex')
        .substring(0, 32);
}

/**
 * Create a new session
 */
async function createSession(userId, refreshToken, req) {
    await initSessionsTable();
    
    const sessionId = crypto.randomUUID();
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const fingerprint = generateDeviceFingerprint(req);
    const expiresAt = new Date(Date.now() + SESSION_CONFIG.REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000).toISOString();
    
    // Check concurrent session limit
    const activeSessions = await db.getOne(
        `SELECT COUNT(*) as count FROM sessions 
         WHERE user_id = $1 AND revoked = 0 AND expires_at > NOW()`,
        [userId]
    );
    
    if (parseInt(activeSessions.count) >= SESSION_CONFIG.MAX_CONCURRENT_SESSIONS) {
        // Revoke oldest session
        const oldest = await db.getOne(
            `SELECT id FROM sessions 
             WHERE user_id = $1 AND revoked = 0 
             ORDER BY created_at ASC LIMIT 1`,
            [userId]
        );
        if (oldest) {
            await db.run(
                `UPDATE sessions SET revoked = 1, revoke_reason = 'Max concurrent sessions exceeded' WHERE id = $1`,
                [oldest.id]
            );
        }
    }
    
    await db.run(
        `INSERT INTO sessions (id, user_id, refresh_token_hash, device_fingerprint, ip_address, user_agent, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [sessionId, userId, tokenHash, fingerprint, req.ip, req.get('User-Agent'), expiresAt]
    );
    
    return {
        sessionId,
        fingerprint,
        expiresAt
    };
}

/**
 * Validate session
 */
async function validateSession(refreshToken, req) {
    await initSessionsTable();
    
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const fingerprint = generateDeviceFingerprint(req);
    
    const session = await db.getOne(
        `SELECT * FROM sessions 
         WHERE refresh_token_hash = $1 AND revoked = 0 AND expires_at > NOW()`,
        [tokenHash]
    );
    
    if (!session) {
        return { valid: false, reason: 'Session not found or expired' };
    }
    
    // Check device fingerprint
    if (SESSION_CONFIG.REQUIRE_DEVICE_MATCH && session.device_fingerprint !== fingerprint) {
        await db.run(
            `UPDATE sessions SET revoked = 1, revoke_reason = 'Device fingerprint mismatch' WHERE id = $1`,
            [session.id]
        );
        
        return { 
            valid: false, 
            reason: 'Session device mismatch - possible token theft',
            suspicious: true
        };
    }
    
    // Update last active
    await db.run(
        `UPDATE sessions SET last_active = NOW(), ip_address = $1 WHERE id = $2`,
        [req.ip, session.id]
    );
    
    return { valid: true, session };
}

/**
 * Revoke a session
 */
async function revokeSession(sessionId, reason = 'Manual revocation') {
    await initSessionsTable();
    return db.run(
        `UPDATE sessions SET revoked = 1, revoke_reason = $1 WHERE id = $2`,
        [reason, sessionId]
    );
}

/**
 * Revoke all sessions for a user
 */
async function revokeAllUserSessions(userId, reason = 'User requested logout from all devices') {
    await initSessionsTable();
    return db.run(
        `UPDATE sessions SET revoked = 1, revoke_reason = $1 WHERE user_id = $2 AND revoked = 0`,
        [reason, userId]
    );
}

/**
 * Revoke session by refresh token
 */
async function revokeSessionByToken(refreshToken, reason = 'Token refresh') {
    await initSessionsTable();
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    return db.run(
        `UPDATE sessions SET revoked = 1, revoke_reason = $1 WHERE refresh_token_hash = $2`,
        [reason, tokenHash]
    );
}

/**
 * Get active sessions for a user
 */
async function getUserSessions(userId) {
    await initSessionsTable();
    return db.getAll(
        `SELECT id, device_fingerprint, ip_address, user_agent, created_at, last_active, expires_at
         FROM sessions 
         WHERE user_id = $1 AND revoked = 0 AND expires_at > NOW()
         ORDER BY last_active DESC`,
        [userId]
    );
}

/**
 * Cleanup expired and revoked sessions
 */
async function cleanupSessions() {
    await initSessionsTable();
    const result = await db.run(
        `DELETE FROM sessions WHERE revoked = 1 OR expires_at < NOW() - INTERVAL '7 days'`
    );
    return result.rowCount;
}

/**
 * Get session statistics
 */
async function getSessionStats() {
    await initSessionsTable();
    
    const stats = await db.getOne(`
        SELECT 
            COUNT(*) as total_sessions,
            SUM(CASE WHEN revoked = 0 AND expires_at > NOW() THEN 1 ELSE 0 END) as active_sessions,
            SUM(CASE WHEN revoked = 1 THEN 1 ELSE 0 END) as revoked_sessions,
            COUNT(DISTINCT user_id) as unique_users
        FROM sessions
    `);
    
    const suspiciousRevokedCount = await db.getOne(
        `SELECT COUNT(*) as count FROM sessions 
         WHERE revoke_reason LIKE '%mismatch%' OR revoke_reason LIKE '%theft%'`
    );
    
    return {
        ...stats,
        suspicious_revocations: parseInt(suspiciousRevokedCount.count)
    };
}

/**
 * Get a specific session by ID
 */
async function getSession(sessionId) {
    await initSessionsTable();
    return db.getOne(
        `SELECT id, user_id, device_fingerprint, ip_address, user_agent, 
                created_at, last_active, expires_at, revoked
         FROM sessions WHERE id = $1`,
        [sessionId]
    );
}

// CLI interface
if (require.main === module) {
    const args = process.argv.slice(2);
    const command = args[0];
    
    (async () => {
        switch (command) {
            case 'stats':
                console.log(JSON.stringify(await getSessionStats(), null, 2));
                break;
            case 'list':
                if (!args[1]) { console.log('Usage: node session-manager.js list <user-id>'); process.exit(1); }
                console.log(JSON.stringify(await getUserSessions(parseInt(args[1])), null, 2));
                break;
            case 'revoke':
                if (!args[1]) { console.log('Usage: node session-manager.js revoke <session-id>'); process.exit(1); }
                await revokeSession(args[1], 'CLI manual revocation');
                console.log('Session revoked');
                break;
            case 'revoke-all':
                if (!args[1]) { console.log('Usage: node session-manager.js revoke-all <user-id>'); process.exit(1); }
                await revokeAllUserSessions(parseInt(args[1]), 'CLI forced logout');
                console.log('All sessions revoked');
                break;
            case 'cleanup':
                const deleted = await cleanupSessions();
                console.log(`Cleaned up ${deleted} sessions`);
                break;
            default:
                console.log('🔐 Session Management Tool\n');
                console.log('Usage: node session-manager.js <command>\n');
                console.log('Commands:');
                console.log('  stats              - Show session statistics');
                console.log('  list <user-id>     - List user sessions');
                console.log('  revoke <session-id> - Revoke a session');
                console.log('  revoke-all <user-id> - Revoke all user sessions');
                console.log('  cleanup            - Clean up old sessions');
        }
        await db.close();
    })();
}

module.exports = {
    initSessionsTable,
    createSession,
    validateSession,
    revokeSession,
    revokeAllUserSessions,
    revokeSessionByToken,
    getUserSessions,
    cleanupSessions,
    getSessionStats,
    generateDeviceFingerprint,
    getSession,
    SESSION_CONFIG
};
