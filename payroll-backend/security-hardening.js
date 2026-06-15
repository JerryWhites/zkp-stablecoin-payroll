// ====================================
// 🔒 SECURITY HARDENING MODULE (PostgreSQL)
// ====================================
// Critical security functions for Unhackable Payroll
// Fixes: Timing attacks, Token blacklist, CSRF, 2FA limits

const crypto = require('crypto');
const db = require('./db');
require('dotenv').config();

// ====================================
// INITIALIZATION (call once on startup)
// ====================================
async function initSecurityTables() {
    await db.exec(`
        CREATE TABLE IF NOT EXISTS token_blacklist (
            id SERIAL PRIMARY KEY,
            token_hash TEXT UNIQUE NOT NULL,
            user_id INTEGER,
            expires_at TIMESTAMP NOT NULL,
            blacklisted_at TIMESTAMP DEFAULT NOW(),
            reason TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_token_blacklist_hash ON token_blacklist(token_hash);
        CREATE INDEX IF NOT EXISTS idx_token_blacklist_expires ON token_blacklist(expires_at);

        CREATE TABLE IF NOT EXISTS twofa_attempts (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            attempt_time TIMESTAMP DEFAULT NOW(),
            success INTEGER DEFAULT 0,
            ip_address TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_twofa_user ON twofa_attempts(user_id);
    `);
}

// ====================================
// 1. CONSTANT-TIME COMPARISON
// ====================================

function secureCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') {
        return false;
    }
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) {
        crypto.timingSafeEqual(bufA, bufA);
        return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
}

// ====================================
// 2. TOKEN BLACKLIST
// ====================================

async function blacklistToken(token, userId, expiresAt, reason = 'logout') {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    try {
        await db.run(
            `INSERT INTO token_blacklist (token_hash, user_id, expires_at, reason)
             VALUES ($1, $2, $3, $4) ON CONFLICT (token_hash) DO NOTHING`,
            [tokenHash, userId, expiresAt.toISOString(), reason]
        );
    } catch (error) {
        console.error('Failed to blacklist token:', error.message);
    }
}

async function isTokenBlacklisted(token) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const result = await db.getOne(
        `SELECT 1 FROM token_blacklist WHERE token_hash = $1 AND expires_at > NOW() LIMIT 1`,
        [tokenHash]
    );
    return !!result;
}

async function cleanupBlacklist() {
    const result = await db.run(`DELETE FROM token_blacklist WHERE expires_at < NOW()`);
    return result.rowCount;
}

// ====================================
// 3. CSRF PROTECTION
// ====================================

const CSRF_TOKEN_LENGTH = 32;
const CSRF_COOKIE_NAME = '__csrf';
const CSRF_HEADER_NAME = 'x-csrf-token';

function generateCSRFToken() {
    return crypto.randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
}

function csrfProtection(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }
    // Auth endpoints are pre-session — not vulnerable to CSRF
    if (req.path.startsWith('/api/auth/')) {
        return next();
    }
    const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
    const headerToken = req.headers[CSRF_HEADER_NAME];
    if (!cookieToken || !headerToken || !secureCompare(cookieToken, headerToken)) {
        return res.status(403).json({ 
            error: 'CSRF token validation failed',
            code: 'CSRF_INVALID'
        });
    }
    next();
}

function setCSRFCookie(req, res, next) {
    const token = generateCSRFToken();
    res.cookie(CSRF_COOKIE_NAME, token, {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000
    });
    res.locals.csrfToken = token;
    next();
}

// ====================================
// 4. 2FA RATE LIMITING
// ====================================

const TWOFA_MAX_ATTEMPTS = 3;
const TWOFA_LOCKOUT_MINUTES = 15;

async function check2FALockout(userId) {
    // 🔐 FIXED: Use parameterized interval instead of string interpolation
    const attempts = await db.getOne(
        `SELECT COUNT(*) as count FROM twofa_attempts 
         WHERE user_id = $1 
         AND attempt_time > NOW() - ($2 || ' minutes')::interval 
         AND success = 0`,
        [userId, TWOFA_LOCKOUT_MINUTES]
    );
    
    if (parseInt(attempts.count) >= TWOFA_MAX_ATTEMPTS) {
        const latestAttempt = await db.getOne(
            `SELECT attempt_time FROM twofa_attempts 
             WHERE user_id = $1 
             AND attempt_time > NOW() - ($2 || ' minutes')::interval 
             AND success = 0
             ORDER BY attempt_time DESC LIMIT 1`,
            [userId, TWOFA_LOCKOUT_MINUTES]
        );
        
        if (latestAttempt) {
            const attemptTime = new Date(latestAttempt.attempt_time).getTime();
            const unlockTime = attemptTime + TWOFA_LOCKOUT_MINUTES * 60 * 1000;
            const remainingMs = unlockTime - Date.now();
            
            if (remainingMs > 0) {
                return {
                    locked: true,
                    remainingMinutes: Math.ceil(remainingMs / 60000),
                    attemptsRemaining: 0
                };
            }
        }
    }
    
    return { 
        locked: false, 
        remainingMinutes: 0,
        attemptsRemaining: TWOFA_MAX_ATTEMPTS - parseInt(attempts.count)
    };
}

async function record2FAAttempt(userId, success, ip) {
    await db.run(
        `INSERT INTO twofa_attempts (user_id, success, ip_address) VALUES ($1, $2, $3)`,
        [userId, success ? 1 : 0, ip]
    );
    if (success) {
        await db.run(
            `DELETE FROM twofa_attempts WHERE user_id = $1 AND success = 0`,
            [userId]
        );
    }
}

// ====================================
// 5. PASSWORD PEPPER
// ====================================

// 🔒 CRITICAL: PASSWORD_PEPPER must be set in environment — random fallback would break existing password hashes
if (!process.env.PASSWORD_PEPPER) {
    console.error('FATAL: PASSWORD_PEPPER environment variable is required. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
}
const PASSWORD_PEPPER = process.env.PASSWORD_PEPPER;

function pepperPassword(password) {
    return crypto.createHmac('sha256', PASSWORD_PEPPER)
        .update(password)
        .digest('hex');
}

// ====================================
// 6. REFRESH TOKEN ROTATION
// ====================================

async function revokeRefreshToken(oldToken, reason = 'rotation') {
    const tokenHash = crypto.createHash('sha256').update(oldToken).digest('hex');
    const result = await db.run(
        `UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL`,
        [tokenHash]
    );
    return { revoked: result.rowCount > 0 };
}

async function isRefreshTokenReused(tokenHash) {
    const result = await db.getOne(
        `SELECT revoked_at FROM refresh_tokens WHERE token_hash = $1`,
        [tokenHash]
    );
    return result?.revoked_at !== null;
}

// ====================================
// 7. REQUEST ID GENERATION
// ====================================

function generateRequestId() {
    return crypto.randomUUID();
}

function requestIdMiddleware(req, res, next) {
    // 🔐 FIXED: Always generate server-side request ID — never trust client X-Request-ID
    const requestId = generateRequestId();
    req.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);
    next();
}

// ====================================
// 8. ERROR SANITIZATION
// ====================================

function sanitizeError(error, isDevelopment = false) {
    const safeMessages = {
        'ECONNREFUSED': 'Service temporarily unavailable',
        'ETIMEDOUT': 'Request timed out',
        'ENOTFOUND': 'Service unavailable',
        'ER_DUP_ENTRY': 'Resource already exists',
        '23505': 'Resource already exists'
    };
    
    for (const [code, message] of Object.entries(safeMessages)) {
        if (error.message?.includes(code) || error.code === code) {
            return { error: message };
        }
    }
    
    if (isDevelopment && process.env.NODE_ENV === 'development') {
        return { error: error.message };
    }
    
    return { error: 'An unexpected error occurred' };
}

// ====================================
// 9. SENSITIVE DATA MASKING
// ====================================

function maskSensitiveData(data) {
    if (!data || typeof data !== 'object') return data;
    
    const sensitiveFields = [
        'password', 'password_hash', 'token', 'accessToken', 'refreshToken',
        'secret', 'totp_secret', 'api_key', 'apiKey', 'authorization',
        'credit_card', 'ssn', 'social_security'
    ];
    
    const masked = { ...data };
    
    for (const field of sensitiveFields) {
        if (masked[field]) {
            masked[field] = '[REDACTED]';
        }
    }
    
    if (masked.email && typeof masked.email === 'string') {
        const [local, domain] = masked.email.split('@');
        if (local && domain) {
            masked.email = `${local.substring(0, 2)}***@${domain}`;
        }
    }
    
    if (masked.salary && typeof masked.salary === 'number') {
        const range = Math.floor(masked.salary / 10000000) * 10000000;
        masked.salary = `${range}-${range + 10000000}`;
    }
    
    return masked;
}

// ====================================
// 10. IP VALIDATION
// ====================================

function normalizeIP(ip) {
    if (!ip) return 'unknown';
    if (ip.startsWith('::ffff:')) {
        return ip.substring(7);
    }
    return ip;
}

function isIPWhitelisted(ip, whitelist) {
    if (!whitelist || whitelist.length === 0) return true;
    const normalizedIP = normalizeIP(ip);
    return whitelist.some(allowed => {
        return allowed === normalizedIP || allowed === '*';
    });
}

// ====================================
// EXPORTS
// ====================================

module.exports = {
    initSecurityTables,
    secureCompare,
    blacklistToken,
    isTokenBlacklisted,
    cleanupBlacklist,
    generateCSRFToken,
    csrfProtection,
    setCSRFCookie,
    CSRF_COOKIE_NAME,
    CSRF_HEADER_NAME,
    check2FALockout,
    record2FAAttempt,
    TWOFA_MAX_ATTEMPTS,
    TWOFA_LOCKOUT_MINUTES,
    pepperPassword,
    // 🔐 PASSWORD_PEPPER re-exported for backward compatibility with existing pepper+bcrypt hashes
    PASSWORD_PEPPER,
    revokeRefreshToken,
    isRefreshTokenReused,
    generateRequestId,
    requestIdMiddleware,
    sanitizeError,
    maskSensitiveData,
    normalizeIP,
    isIPWhitelisted
};
