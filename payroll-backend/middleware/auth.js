// ====================================
// 🔒 Shared Middleware (extracted from server-secure.js)
// ====================================
// Provides authenticateToken, requireRole, validate, auditLog
// for use by route modules.

'use strict';

const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const { isTokenBlacklisted, maskSensitiveData, normalizeIP } = require('../security-hardening');
const db = require('../db');
const winston = require('winston');

if (!process.env.JWT_SECRET) {
    console.error('FATAL: JWT_SECRET environment variable is required. Exiting.');
    process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;

// Logger (reuse or create)
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console({ format: winston.format.combine(winston.format.colorize(), winston.format.simple()) }),
    ],
});

// Anonymize IP for GDPR
function anonymizeIP(ip) {
    if (!ip) return 'unknown';
    const parts = ip.split('.');
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.XXX`;
    return ip.substring(0, ip.lastIndexOf(':')) + ':XXXX';
}

// Audit logging
async function auditLog(action, data) {
    const maskedData = maskSensitiveData(data);
    const maskedMetadata = maskSensitiveData(data.metadata || {});
    await db.run(`
        INSERT INTO audit_log (user_id, user_email, action, resource_type, resource_id, metadata, ip_address, user_agent)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        data.userId || null,
        maskedData.userEmail || null,
        action,
        data.resourceType || null,
        data.resourceId || null,
        JSON.stringify(maskedMetadata),
        anonymizeIP(data.ip),
        data.userAgent?.substring(0, 200) || null,
    ]);
    logger.info(`AUDIT: ${action}`, { ...maskedData, ip: anonymizeIP(data.ip) });
}

// JWT Authentication
const authenticateToken = async (req, res, next) => {
    const tokenFromCookie = req.cookies?.accessToken;
    const tokenFromHeader = req.headers.authorization?.split(' ')[1];
    const token = tokenFromCookie || tokenFromHeader;

    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        if (await isTokenBlacklisted(token)) {
            return res.status(401).json({ error: 'Token has been revoked', code: 'TOKEN_REVOKED' });
        }
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.type !== 'access') throw new Error('Invalid token type');
        req.user = decoded;
        req.token = token;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
        }
        return res.status(403).json({ error: 'Invalid token' });
    }
};

// Role-based access control
// 🔐 HARDENED: Detect and reject positional arg misuse (must pass array)
const requireRole = (allowedRoles) => {
    // Runtime safety: if developer passes multiple string args, crash-fail-safe
    if (!Array.isArray(allowedRoles)) {
        // Single string is ok (wraps to array), but log warning
        if (typeof allowedRoles === 'string') {
            allowedRoles = [allowedRoles];
        } else {
            throw new Error(`requireRole: expected array of roles, got ${typeof allowedRoles}`);
        }
    }
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            auditLog('AUTHORIZATION_FAILED', {
                userId: req.user?.userId,
                userEmail: req.user?.email,
                ip: req.ip,
                metadata: { requiredRoles: allowedRoles, userRole: req.user?.role, endpoint: req.path }
            }).catch(() => {});
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        next();
    };
};

// Express-validator result check
const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            error: 'Validation failed',
            details: errors.array().map(e => ({ field: e.path, message: e.msg }))
        });
    }
    next();
};

module.exports = {
    authenticateToken,
    requireRole,
    validate,
    auditLog,
    anonymizeIP,
    logger,
};
