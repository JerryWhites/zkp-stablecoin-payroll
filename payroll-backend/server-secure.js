// ====================================
// 🔒 UNHACKABLE PAYROLL BACKEND v2.0
// ====================================
// Security-hardened Express server with:
// - JWT Authentication (httpOnly cookies)
// - Bcrypt password hashing (cost 12) + Pepper
// - Rate limiting (global, auth, payroll, 2FA)
// - Input validation (express-validator)
// - Security headers (Helmet)
// - Audit logging with data masking
// - CORS whitelist
// - 2FA support with rate limiting
// - CSRF protection
// - Token blacklisting
// - Constant-time comparisons
// - Request ID tracing

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { body, param, query, validationResult } = require('express-validator');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const csv = require('csv-parser');
const db = require('./db');
const winston = require('winston');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const hpp = require('hpp');
require('dotenv').config();

// Import security hardening module
const {
    initSecurityTables,
    secureCompare,
    blacklistToken,
    isTokenBlacklisted,
    csrfProtection,
    setCSRFCookie,
    CSRF_COOKIE_NAME,
    check2FALockout,
    record2FAAttempt,
    revokeRefreshToken,
    isRefreshTokenReused,
    requestIdMiddleware,
    sanitizeError,
    maskSensitiveData,
    normalizeIP,
    PASSWORD_PEPPER
} = require('./security-hardening');

// Import session manager
const sessionManager = require('./session-manager');
const { initSessionsTable } = sessionManager;

// ====================================
// CONFIGURATION
// ====================================
const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';
// 🔒 CRITICAL: Require secrets — no random fallbacks (they break across restarts)
if (!process.env.JWT_SECRET) {
    console.error('FATAL: JWT_SECRET environment variable is required. Generate one with: npm run generate:jwt-secret');
    process.exit(1);
}
if (!process.env.JWT_REFRESH_SECRET) {
    console.error('FATAL: JWT_REFRESH_SECRET environment variable is required. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
    process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const JWT_ACCESS_EXPIRY = process.env.JWT_ACCESS_EXPIRY || '15m';
const JWT_REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY || '7d';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:8080').split(',');
const MAX_FILE_SIZE = (parseInt(process.env.MAX_FILE_SIZE_MB) || 5) * 1024 * 1024;
const BCRYPT_ROUNDS = 12;

// ====================================
// PRICING & TIER CONFIGURATION (Varianta C – CZK hybrid subscription + overage)
// ====================================
const PRICING = {
    CURRENCY: 'CZK',
    DEFAULT_OVERAGE_CZK: 199, // fallback overage rate for Start tier
    // Legacy tier name mapping (old code tier → DB tier)
    LEGACY_TIER_MAP: { 'start': 'starter', 'growth': 'pro' },
    TIERS: {
        starter: {
            name: 'Start',
            monthlyPriceCZK: 590,
            annualMonthlyPriceCZK: 490,
            includedEmployees: 10,
            overagePerEmployeeCZK: 199,
            maxPayrollRuns: 2,
            costPerRunCZK: 590,      // price per additional payroll run
            runLimitType: 'hard',    // hard = block, soft = warn
            maxSeats: 1,
            maxEmployees: Infinity,  // no hard cap on employees, only overage
            features: {
                zkTransfers: false, csvImport: true, auditLog: true,
                api: false, webhooks: false, autoPayroll: false,
                customReports: false, integrations: false, rbac: false,
                multiSig: false, whiteLabel: false,
                prioritySupport: false, dedicatedSupport: false,
                onPremise: false
            },
            sla: 'best-effort',
            gdprSupport: 'docs'
        },
        pro: {
            name: 'Growth',
            monthlyPriceCZK: 1290,
            annualMonthlyPriceCZK: 990,
            includedEmployees: 25,
            overagePerEmployeeCZK: 149,
            maxPayrollRuns: 12,
            costPerRunCZK: 1290,     // price per additional payroll run
            runLimitType: 'soft',    // soft = warn but allow
            maxSeats: 3,
            maxEmployees: Infinity,
            features: {
                zkTransfers: false, csvImport: true, auditLog: true,
                api: true, webhooks: false, autoPayroll: true,
                customReports: false, integrations: false, rbac: false,
                multiSig: false, whiteLabel: false,
                prioritySupport: false, dedicatedSupport: false,
                onPremise: false
            },
            sla: '99.5%',
            gdprSupport: 'docs'
        },
        business: {
            name: 'Business',
            monthlyPriceCZK: 4490,
            annualMonthlyPriceCZK: 3490,
            includedEmployees: 75,
            overagePerEmployeeCZK: 119,
            maxPayrollRuns: Infinity,
            costPerRunCZK: 4490,     // price per additional payroll run
            runLimitType: 'none',
            maxSeats: 10,
            maxEmployees: Infinity,
            features: {
                zkTransfers: false, csvImport: true, auditLog: true,
                api: true, webhooks: true, autoPayroll: true,
                customReports: true, integrations: true, rbac: true,
                multiSig: false, whiteLabel: false,
                prioritySupport: true, dedicatedSupport: false,
                onPremise: false
            },
            sla: '99.9%',
            gdprSupport: 'docs + audit assist'
        },
        enterprise: {
            name: 'Enterprise',
            monthlyPriceCZK: 29900,
            annualMonthlyPriceCZK: 24900,
            includedEmployees: 150,
            overagePerEmployeeCZK: 89,
            maxPayrollRuns: Infinity,
            costPerRunCZK: 29900,
            runLimitType: 'none',
            maxSeats: Infinity,
            maxEmployees: Infinity,
            features: {
                zkTransfers: true, csvImport: true, auditLog: true,
                api: true, webhooks: true, autoPayroll: true,
                customReports: true, integrations: true, rbac: true,
                multiSig: true, whiteLabel: false,
                prioritySupport: true, dedicatedSupport: true,
                onPremise: false
            },
            sla: '99.95% + penále',
            gdprSupport: 'plná podpora'
        },
        enterprise_plus: {
            name: 'Enterprise+',
            monthlyPriceCZK: 115000,
            annualMonthlyPriceCZK: null,  // individuální
            includedEmployees: 500,
            overagePerEmployeeCZK: null,  // individuální
            maxPayrollRuns: Infinity,
            costPerRunCZK: null,  // individuální
            runLimitType: 'none',
            maxSeats: Infinity,
            maxEmployees: Infinity,
            features: {
                zkTransfers: true, csvImport: true, auditLog: true,
                api: true, webhooks: true, autoPayroll: true,
                customReports: true, integrations: true, rbac: true,
                multiSig: true, whiteLabel: true,
                prioritySupport: true, dedicatedSupport: true,
                onPremise: true,
                customSLA: true, zeroKnowledgeAudit: true
            },
            sla: 'custom SLA + penále',
            gdprSupport: 'plná podpora + DPO asistence'
        }
    }
};

// Secrets already validated above — crash on startup if missing in ANY environment

// ====================================
// LOGGING SETUP (Winston)
// ====================================
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'payroll-backend' },
    transports: [
        new winston.transports.File({ filename: 'logs/error.log', level: 'error', maxsize: 100 * 1024 * 1024, maxFiles: 30 }),
        new winston.transports.File({ filename: 'logs/combined.log', maxsize: 100 * 1024 * 1024, maxFiles: 30 }),
        new winston.transports.File({ filename: 'logs/audit.log', level: 'info', maxsize: 100 * 1024 * 1024, maxFiles: 90 })
    ],
});

// Add console logging in development
if (NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }));
}

// Create logs directory
if (!fs.existsSync('logs')) {
    fs.mkdirSync('logs', { recursive: true });
}

// ====================================
// DATABASE SETUP (PostgreSQL)
// ====================================

async function initDatabase() {
    await db.exec(`
        -- Users table with bcrypt password hashes
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT DEFAULT 'employer' CHECK(role IN ('admin', 'employer', 'employee')),
            company_id TEXT,
            is_active INTEGER DEFAULT 1,
            is_2fa_enabled INTEGER DEFAULT 0,
            totp_secret TEXT,
            failed_login_attempts INTEGER DEFAULT 0,
            locked_until TIMESTAMP,
            password_changed_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );

        -- Employees table
        CREATE TABLE IF NOT EXISTS employees (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            company_id TEXT NOT NULL,
            name TEXT NOT NULL,
            email TEXT,
            salary INTEGER NOT NULL CHECK(salary > 0),
            aleo_address TEXT NOT NULL,
            status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'terminated')),
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );

        -- Payroll runs history
        CREATE TABLE IF NOT EXISTS payroll_runs (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            user_id INTEGER,
            company_id TEXT,
            total_amount INTEGER,
            employee_count INTEGER,
            status TEXT CHECK(status IN ('pending', 'awaiting_confirmation', 'completed', 'failed', 'cancelled')),
            tx_id TEXT,
            date TIMESTAMP DEFAULT NOW(),
            created_at TIMESTAMP DEFAULT NOW(),
            completed_at TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        -- Audit log (append-only)
        CREATE TABLE IF NOT EXISTS audit_log (
            id SERIAL PRIMARY KEY,
            timestamp TIMESTAMP DEFAULT NOW(),
            user_id INTEGER,
            user_email TEXT,
            action TEXT NOT NULL,
            resource_type TEXT,
            resource_id TEXT,
            metadata TEXT,
            ip_address TEXT,
            user_agent TEXT
        );

        -- Refresh tokens (for JWT refresh)
        CREATE TABLE IF NOT EXISTS refresh_tokens (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            token_hash TEXT UNIQUE NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP DEFAULT NOW(),
            revoked_at TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        -- Rate limit tracking for persistent limits
        CREATE TABLE IF NOT EXISTS rate_limits (
            id SERIAL PRIMARY KEY,
            identifier TEXT NOT NULL,
            endpoint TEXT NOT NULL,
            count INTEGER DEFAULT 1,
            window_start TIMESTAMP DEFAULT NOW(),
            UNIQUE(identifier, endpoint)
        );

        -- ====================================
        -- SUBSCRIPTION & CREDIT SYSTEM
        -- ====================================
        
        -- Company/Organization table
        CREATE TABLE IF NOT EXISTS companies (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            billing_email TEXT,
            tier TEXT DEFAULT 'starter' CHECK(tier IN ('starter', 'pro', 'business', 'enterprise', 'enterprise_plus')),
            max_employees INTEGER DEFAULT 10,
            billing_period TEXT DEFAULT 'monthly' CHECK(billing_period IN ('monthly', 'annual')),
            monthly_payroll_runs INTEGER DEFAULT 0,
            current_period_start TIMESTAMP DEFAULT NOW(),
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );

        -- Credit balance per company (CZK)
        CREATE TABLE IF NOT EXISTS credit_balance (
            id SERIAL PRIMARY KEY,
            company_id TEXT NOT NULL UNIQUE,
            balance_czk DOUBLE PRECISION DEFAULT 0.00,
            total_spent_czk DOUBLE PRECISION DEFAULT 0.00,
            last_topped_up TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );

        -- Credit transactions (top-ups, charges) in CZK
        CREATE TABLE IF NOT EXISTS credit_transactions (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            company_id TEXT NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('topup', 'charge', 'refund', 'bonus')),
            amount_czk DOUBLE PRECISION NOT NULL,
            balance_after_czk DOUBLE PRECISION NOT NULL,
            description TEXT,
            reference_id TEXT,
            payment_method TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        );

        -- Payroll charges (links payroll to credit deduction) in CZK
        CREATE TABLE IF NOT EXISTS payroll_charges (
            id SERIAL PRIMARY KEY,
            payroll_uuid TEXT NOT NULL,
            company_id TEXT NOT NULL,
            employee_count INTEGER NOT NULL,
            included_employees_used INTEGER DEFAULT 0,
            overage_employees INTEGER DEFAULT 0,
            amount_czk DOUBLE PRECISION NOT NULL,
            overage_rate_czk DOUBLE PRECISION NOT NULL,
            transaction_uuid TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        );

        -- Create indexes for performance
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
        CREATE INDEX IF NOT EXISTS idx_employees_company ON employees(company_id);
        CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
        CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
        CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
        CREATE INDEX IF NOT EXISTS idx_credit_transactions_company ON credit_transactions(company_id);
        CREATE INDEX IF NOT EXISTS idx_payroll_charges_company ON payroll_charges(company_id);

        -- Password reset tokens
        CREATE TABLE IF NOT EXISTS password_resets (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            token_hash TEXT NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            used_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW()
        );

        -- Quote requests from landing page
        CREATE TABLE IF NOT EXISTS quote_requests (
            id SERIAL PRIMARY KEY,
            company_name TEXT NOT NULL,
            email TEXT NOT NULL,
            employee_count INTEGER,
            message TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        );
    `);
}

// ====================================
// HELPER FUNCTIONS
// ====================================

// Anonymize IP for GDPR compliance
function anonymizeIP(ip) {
    if (!ip) return 'unknown';
    const parts = ip.split('.');
    if (parts.length === 4) {
        return `${parts[0]}.${parts[1]}.${parts[2]}.XXX`;
    }
    return ip.substring(0, ip.lastIndexOf(':')) + ':XXXX';
}

// ====================================
// CREDIT SYSTEM FUNCTIONS
// ====================================

/**
 * Get or create company for a user
 */
async function getOrCreateCompany(userId, companyId) {
    let company = await db.getOne('SELECT * FROM companies WHERE uuid = ?', [companyId]);
    
    if (!company) {
        const companyUuid = companyId || crypto.randomUUID();
        await db.run(`
            INSERT INTO companies (uuid, name, tier, max_employees, billing_period, monthly_payroll_runs, current_period_start)
            VALUES (?, ?, 'starter', 10, 'monthly', 0, datetime('now'))
        `, [companyUuid, `Company ${companyUuid.substring(0, 8)}`]);
        
        // Also create credit balance (CZK)
        await db.run(`
            INSERT INTO credit_balance (company_id, balance_czk)
            VALUES (?, 0.00)
        `, [companyUuid]);
        
        company = await db.getOne('SELECT * FROM companies WHERE uuid = ?', [companyUuid]);
    }
    
    // Migrate legacy tier names if found
    if (company && PRICING.LEGACY_TIER_MAP[company.tier]) {
        const newTier = PRICING.LEGACY_TIER_MAP[company.tier];
        await db.run('UPDATE companies SET tier = ? WHERE uuid = ?', [newTier, company.uuid]);
        company.tier = newTier;
    }
    
    return company;
}

/**
 * Get credit balance for a company (CZK)
 */
async function getCreditBalance(companyId) {
    let balance = await db.getOne('SELECT * FROM credit_balance WHERE company_id = ?', [companyId]);
    
    if (!balance) {
        await db.run(`
            INSERT INTO credit_balance (company_id, balance_czk)
            VALUES (?, 0.00)
        `, [companyId]);
        balance = { company_id: companyId, balance_czk: 0.00, total_spent_czk: 0.00 };
    }
    
    // Migration: if old USD columns exist, map them
    if (balance.balance_usd !== undefined && balance.balance_czk === undefined) {
        balance.balance_czk = balance.balance_usd;
        balance.total_spent_czk = balance.total_spent_usd || 0;
    }
    
    return balance;
}

/**
 * Get company tier info
 */
async function getCompanyTier(companyId) {
    const company = await db.getOne('SELECT tier FROM companies WHERE uuid = ?', [companyId]);
    let tier = company?.tier || 'starter';
    // Migrate legacy tier names
    if (PRICING.LEGACY_TIER_MAP[tier]) tier = PRICING.LEGACY_TIER_MAP[tier];
    const tierConfig = PRICING.TIERS[tier] || PRICING.TIERS.starter;
    return {
        tier,
        config: tierConfig,
        overagePerEmployeeCZK: tierConfig.overagePerEmployeeCZK ?? PRICING.DEFAULT_OVERAGE_CZK,
        includedEmployees: tierConfig.includedEmployees ?? 10
    };
}

/**
 * Get count of unique employees paid this billing period
 */
async function getEmployeesPaidThisPeriod(companyId) {
    const company = await db.getOne('SELECT current_period_start FROM companies WHERE uuid = ?', [companyId]);
    const periodStart = company?.current_period_start || new Date().toISOString();
    const result = await db.getOne(`
        SELECT COALESCE(SUM(employee_count), 0) as total_employees_paid,
               COUNT(*) as total_runs
        FROM payroll_charges 
        WHERE company_id = ? AND created_at >= ?
    `, [companyId, periodStart]);
    return {
        employeesPaid: result?.total_employees_paid || 0,
        runsThisPeriod: result?.total_runs || 0
    };
}

/**
 * Calculate payroll cost (CZK overage model)
 * Only employees ABOVE the included limit incur overage charges
 */
async function calculatePayrollCost(companyId, employeeCount) {
    const { overagePerEmployeeCZK, includedEmployees } = await getCompanyTier(companyId);
    const { employeesPaid } = await getEmployeesPaidThisPeriod(companyId);
    
    // How many included slots are already used this period?
    const includedUsed = Math.min(employeesPaid, includedEmployees);
    const includedRemaining = Math.max(0, includedEmployees - includedUsed);
    
    // From this run, how many fit in remaining included slots?
    const coveredByIncluded = Math.min(employeeCount, includedRemaining);
    const overageEmployees = Math.max(0, employeeCount - coveredByIncluded);
    
    return {
        totalCostCZK: overageEmployees * overagePerEmployeeCZK,
        includedUsed: coveredByIncluded,
        overageEmployees,
        overageRateCZK: overagePerEmployeeCZK,
        includedRemaining: includedRemaining - coveredByIncluded
    };
}

/**
 * Check if company has enough credits for payroll
 */
async function hasEnoughCredits(companyId, employeeCount) {
    const balance = await getCreditBalance(companyId);
    const costInfo = await calculatePayrollCost(companyId, employeeCount);
    const balanceCZK = balance.balance_czk || 0;
    return {
        hasEnough: balanceCZK >= costInfo.totalCostCZK,
        balance: balanceCZK,
        cost: costInfo.totalCostCZK,
        costInfo,
        shortfall: Math.max(0, costInfo.totalCostCZK - balanceCZK)
    };
}

/**
 * Charge credits for payroll
 * 🔒 FIXED: Uses atomic SQL UPDATE with balance check to prevent TOCTOU race condition
 */
async function chargeCredits(companyId, employeeCount, payrollUuid) {
    const costInfo = await calculatePayrollCost(companyId, employeeCount);
    const cost = costInfo.totalCostCZK;
    
    if (cost <= 0) {
        return { charged: 0, newBalance: 0, transactionUuid: null, costInfo };
    }
    
    const transactionUuid = crypto.randomUUID();
    
    // 🔒 ATOMIC: Deduct balance only if sufficient funds exist (prevents race condition)
    const updateResult = await db.run(`
        UPDATE credit_balance 
        SET balance_czk = balance_czk - ?, total_spent_czk = total_spent_czk + ?, updated_at = datetime('now')
        WHERE company_id = ? AND balance_czk >= ?
    `, [cost, cost, companyId, cost]);
    
    if (updateResult.rowCount === 0) {
        throw new Error('Nedostatek kreditů');
    }
    
    // Read new balance after atomic deduction
    const balance = await getCreditBalance(companyId);
    const newBalance = balance.balance_czk || 0;
    
    // Record transaction (CZK)
    await db.run(`
        INSERT INTO credit_transactions (uuid, company_id, type, amount_czk, balance_after_czk, description, reference_id)
        VALUES (?, ?, 'charge', ?, ?, ?, ?)
    `, [transactionUuid, companyId, -cost, newBalance, 
        `Výplata pro ${employeeCount} zaměstnanců (${costInfo.includedUsed} v ceně, ${costInfo.overageEmployees} navíc × ${costInfo.overageRateCZK} Kč)`, 
        payrollUuid]);
    
    // Record payroll charge with included/overage breakdown
    await db.run(`
        INSERT INTO payroll_charges (payroll_uuid, company_id, employee_count, included_employees_used, overage_employees, amount_czk, overage_rate_czk, transaction_uuid)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [payrollUuid, companyId, employeeCount, costInfo.includedUsed, costInfo.overageEmployees, cost, costInfo.overageRateCZK, transactionUuid]);
    
    // Increment monthly payroll run counter
    await db.run('UPDATE companies SET monthly_payroll_runs = monthly_payroll_runs + 1, updated_at = datetime(\'now\') WHERE uuid = ?', [companyId]);
    
    return { charged: cost, newBalance, transactionUuid, costInfo };
}

/**
 * Refund credits for cancelled payroll
 * 🔐 FIXED: Atomic balance update + idempotency check to prevent double-refund race condition
 */
async function refundCredits(payrollUuid) {
    // Idempotency: check if refund already exists for this payroll
    const existingRefund = await db.getOne(`
        SELECT uuid FROM credit_transactions 
        WHERE reference_id = ? AND type = 'refund'
    `, [payrollUuid]);
    
    if (existingRefund) {
        logger.warn('Duplicate refund attempt blocked', { payrollUuid, existingRefund: existingRefund.uuid });
        return null; // Already refunded
    }

    // Find the original charge for this payroll
    const charge = await db.getOne(`
        SELECT pc.*, c.uuid as company_uuid 
        FROM payroll_charges pc
        JOIN companies c ON pc.company_id = c.uuid
        WHERE pc.payroll_uuid = ?
    `, [payrollUuid]);
    
    if (!charge) {
        logger.warn('No charge found for payroll refund', { payrollUuid });
        return null; // No charge to refund
    }
    
    const refundAmount = charge.amount_czk || charge.amount_usd || 0;
    const transactionUuid = crypto.randomUUID();
    
    // 🔐 ATOMIC: Update balance using SQL arithmetic (no read-then-write race)
    await db.run(`
        UPDATE credit_balance 
        SET balance_czk = balance_czk + ?, total_spent_czk = GREATEST(0, total_spent_czk - ?), updated_at = datetime('now')
        WHERE company_id = ?
    `, [refundAmount, refundAmount, charge.company_id]);
    
    // Get updated balance for transaction log
    const updatedBalance = await getCreditBalance(charge.company_id);
    const newBalance = updatedBalance.balance_czk || 0;
    
    // Record refund transaction (CZK)
    await db.run(`
        INSERT INTO credit_transactions (uuid, company_id, type, amount_czk, balance_after_czk, description, reference_id)
        VALUES (?, ?, 'refund', ?, ?, ?, ?)
    `, [transactionUuid, charge.company_id, refundAmount, newBalance, `Refundace zrušeného payrollu`, payrollUuid]);
    
    // Decrement monthly payroll run counter
    await db.run('UPDATE companies SET monthly_payroll_runs = GREATEST(0, monthly_payroll_runs - 1), updated_at = datetime(\'now\') WHERE uuid = ?', [charge.company_id]);
    
    logger.info('Credits refunded for cancelled payroll', { 
        payrollUuid, 
        refundAmount, 
        newBalance 
    });
    
    return { refunded: refundAmount, newBalance, transactionUuid };
}

/**
 * Add credits (top-up) in CZK
 */
async function addCredits(companyId, amountCZK, paymentMethod, reference) {
    const transactionUuid = crypto.randomUUID();
    
    // 🔐 FIXED: Atomic balance update (prevents race condition on concurrent top-ups)
    await db.run(`
        UPDATE credit_balance 
        SET balance_czk = balance_czk + ?, last_topped_up = datetime('now'), updated_at = datetime('now')
        WHERE company_id = ?
    `, [amountCZK, companyId]);
    
    // Read new balance after atomic update
    const balance = await getCreditBalance(companyId);
    const newBalance = balance.balance_czk || 0;
    
    // Record transaction (CZK)
    await db.run(`
        INSERT INTO credit_transactions (uuid, company_id, type, amount_czk, balance_after_czk, description, payment_method, reference_id)
        VALUES (?, ?, 'topup', ?, ?, ?, ?, ?)
    `, [transactionUuid, companyId, amountCZK, newBalance, `Dob\u00edjen\u00ed p\u0159es ${paymentMethod}`, paymentMethod, reference]);
    
    return { added: amountCZK, newBalance, transactionUuid };
}

/**
 * Check tier limits (payroll run limit + seat limit)
 */
async function checkTierLimits(companyId, employeeCount) {
    const { tier, config } = await getCompanyTier(companyId);
    const { runsThisPeriod } = await getEmployeesPaidThisPeriod(companyId);
    
    // Check payroll run limit
    if (config.runLimitType === 'hard' && runsThisPeriod >= config.maxPayrollRuns) {
        return {
            allowed: false,
            reason: `${config.name} pl\u00e1n je omezen na ${config.maxPayrollRuns} v\u00fdplatn\u00ed term\u00edny m\u011bs\u00ed\u010dn\u011b. Upgradujte na Growth pro v\u00edce.`,
            currentTier: tier,
            limitType: 'payroll_runs',
            maxPayrollRuns: config.maxPayrollRuns,
            currentRuns: runsThisPeriod
        };
    }
    
    // Soft limit warning (Growth tier)
    const runWarning = (config.runLimitType === 'soft' && runsThisPeriod >= config.maxPayrollRuns)
        ? `Upozorn\u011bn\u00ed: P\u0159ekro\u010dili jste doporu\u010den\u00fd po\u010det v\u00fdplatn\u00edch term\u00edn\u016f (${config.maxPayrollRuns}). Zva\u017ete upgrade na Business.`
        : null;
    
    // Check seat limit
    const seatCount = await db.getOne(
        'SELECT COUNT(*) as count FROM users WHERE company_id = ?', [companyId]
    );
    const maxSeats = config.maxSeats === Infinity ? 999999 : config.maxSeats;
    if (seatCount && seatCount.count > maxSeats) {
        return {
            allowed: false,
            reason: `${config.name} pl\u00e1n je omezen na ${config.maxSeats} u\u017eivatele. Upgradujte pro v\u00edce.`,
            currentTier: tier,
            limitType: 'seats',
            maxSeats: config.maxSeats,
            currentSeats: seatCount.count
        };
    }
    
    return { allowed: true, currentTier: tier, warning: runWarning };
}

// ====================================
// CREDIT MIDDLEWARE
// ====================================

/**
 * Middleware to check credits before payroll operations
 */
const requireCredits = async (req, res, next) => {
    try {
        const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
        const company = await getOrCreateCompany(req.user.userId, user.company_id);
        
        // Count employees that will be paid
        const employees = await db.getOne('SELECT COUNT(*) as count FROM employees WHERE company_id = ? AND status = ?',
            [company.uuid, 'active']);
        
        const employeeCount = employees.count;
        
        // Check tier limits
        const tierCheck = await checkTierLimits(company.uuid, employeeCount);
        if (!tierCheck.allowed) {
            return res.status(403).json({
                error: 'Tier limit exceeded',
                details: tierCheck,
                upgrade_url: '/api/subscription/upgrade'
            });
        }
        
        // Check credits (CZK)
        const creditCheck = await hasEnoughCredits(company.uuid, employeeCount);
        if (!creditCheck.hasEnough) {
            return res.status(402).json({
                error: 'Nedostatek kredit\u016f',
                currency: 'CZK',
                balance_czk: creditCheck.balance,
                required_czk: creditCheck.cost,
                shortfall_czk: creditCheck.shortfall,
                cost_breakdown: creditCheck.costInfo,
                topup_url: '/api/credits/topup'
            });
        }
        
        // Attach credit info to request for later use
        req.creditInfo = {
            company,
            employeeCount,
            cost: creditCheck.cost,
            costInfo: creditCheck.costInfo,
            balance: creditCheck.balance,
            warning: tierCheck.warning
        };
        
        next();
    } catch (error) {
        logger.error('Credit check error', { error: error.message, userId: req.user?.userId });
        res.status(500).json({ error: 'Failed to verify credits' });
    }
};

/**
 * Middleware to check tier features
 */
const requireFeature = (featureName) => {
    return async (req, res, next) => {
        try {
            const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
            const { tier, config } = await getCompanyTier(user.company_id);
            
            if (!config.features[featureName]) {
                return res.status(403).json({
                    error: `Funkce '${featureName}' vy\u017eaduje vy\u0161\u0161\u00ed pl\u00e1n (Growth nebo v\u00fd\u0161e)`,
                    current_tier: tier,
                    required_feature: featureName,
                    upgrade_url: '/api/subscription/upgrade'
                });
            }
            
            next();
        } catch (error) {
            logger.error('Feature check error', { error: error.message, userId: req.user?.userId });
            res.status(500).json({ error: 'Failed to check feature access' });
        }
    };
};

// Audit logging helper - with sensitive data masking
async function auditLog(action, data) {
    // Mask sensitive data before logging
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
        data.userAgent?.substring(0, 200) || null // Limit user agent length
    ]);
    logger.info(`AUDIT: ${action}`, { 
        ...maskedData, 
        ip: anonymizeIP(data.ip),
        requestId: data.requestId 
    });
}

// Generate secure tokens
function generateToken(userId, email, role, type = 'access') {
    const payload = { userId, email, role, type };
    const secret = type === 'refresh' ? JWT_REFRESH_SECRET : JWT_SECRET;
    const expiresIn = type === 'refresh' ? JWT_REFRESH_EXPIRY : JWT_ACCESS_EXPIRY;
    return jwt.sign(payload, secret, { expiresIn });
}

// Verify password strength
function isStrongPassword(password) {
    const minLength = 12;
    const hasUppercase = /[A-Z]/.test(password);
    const hasLowercase = /[a-z]/.test(password);
    const hasNumber = /\d/.test(password);
    // Accept any non-alphanumeric, non-whitespace character as "special"
    const hasSpecial = /[^A-Za-z0-9\s]/.test(password);
    return password.length >= minLength && hasUppercase && hasLowercase && hasNumber && hasSpecial;
}

// Validate Aleo address format
function isValidAleoAddress(address) {
    return /^aleo1[a-z0-9]{58}$/.test(address);
}

// Sanitize CSV cell (prevent CSV injection and null bytes)
function sanitizeCSVCell(value) {
    if (typeof value !== 'string') return value;
    // Strip null bytes and control characters first
    value = value.replace(/[\x00-\x1F\x7F]/g, '');
    const dangerousChars = ['=', '+', '-', '@', '\t', '\r', '\n'];
    if (dangerousChars.some(char => value.startsWith(char))) {
        return "'" + value; // Prefix with quote to neutralize
    }
    return value;
}

// ====================================
// EXPRESS APP SETUP
// ====================================
const app = express();

// Trust proxy (for rate limiting behind reverse proxy)
app.set('trust proxy', 1);

// HTTPS enforcement in production
if (NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      return res.redirect(301, `https://${req.hostname}${req.url}`);
    }
    next();
  });
}

// ====================================
// SECURITY MIDDLEWARE (ORDER MATTERS!)
// ====================================

// 0. Request ID for tracing (FIRST middleware)
app.use(requestIdMiddleware);

// 1. Helmet - Security headers
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "https://api.explorer.aleo.org", "https://api.explorer.provable.com", "https://*.supabase.co"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            frameAncestors: ["'none'"],
        },
    },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    noSniff: true,
    xssFilter: true,
    hidePoweredBy: true,
}));

// 2. CORS - Whitelist only allowed origins
app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (mobile apps, curl) in dev only
        if (!origin && NODE_ENV === 'development') {
            return callback(null, true);
        }
        // In production, require a matching origin
        if (!origin && NODE_ENV === 'production') {
            return callback(null, false);
        }
        if (ALLOWED_ORIGINS.includes(origin)) {
            callback(null, true);
        } else {
            logger.warn(`CORS blocked origin: ${origin}`);
            callback(null, false);
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    maxAge: 86400
}));

// 3. Cookie parser
app.use(cookieParser());

// 4. Body parsers with limits
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// 5. Custom input sanitization middleware (compatible with Express 5)
// Prevents NoSQL injection by removing $ and . from keys
app.use((req, res, next) => {
    const sanitize = (obj) => {
        if (obj && typeof obj === 'object') {
            for (const key of Object.keys(obj)) {
                if (key.startsWith('$') || key.includes('.')) {
                    delete obj[key];
                } else if (typeof obj[key] === 'object') {
                    sanitize(obj[key]);
                }
            }
        }
    };
    if (req.body) sanitize(req.body);
    next();
});

// 6. Prevent HTTP Parameter Pollution
app.use(hpp());

// ====================================
// RATE LIMITERS
// ====================================

// Global rate limiter — generous for authenticated data reads
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 500,                  // ~33 req/min — normal browsing uses 5-8 per page
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, next, options) => {
        logger.warn('Global rate limit exceeded', { ip: anonymizeIP(req.ip), path: req.path });
        res.status(429).json(options.message);
    }
});

// Auth rate limiter (strict)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'Too many authentication attempts, please try again in 15 minutes.' },
    skipSuccessfulRequests: true,
    handler: (req, res, next, options) => {
        logger.warn('Auth rate limit exceeded', { ip: anonymizeIP(req.ip), email: req.body?.email });
        auditLog('AUTH_RATE_LIMIT_EXCEEDED', {
            ip: req.ip,
            userEmail: req.body?.email,
            metadata: { endpoint: req.path }
        }).catch(err => logger.error('Audit log error', { error: err.message }));
        res.status(429).json(options.message);
    }
});

// Payroll rate limiter
const payrollLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10,
    message: { error: 'Payroll operation limit reached. Maximum 10 per hour.' },
    handler: (req, res, next, options) => {
        logger.warn('Payroll rate limit exceeded', { ip: anonymizeIP(req.ip), userId: req.user?.userId });
        res.status(429).json(options.message);
    }
});

// Upload rate limiter
const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 3,
    message: { error: 'Upload limit reached. Maximum 3 uploads per hour.' }
});

// Apply global limiter
app.use('/api/', globalLimiter);

// ====================================
// CSRF PROTECTION
// ====================================
// Set CSRF cookie on every response (readable by frontend JS)
app.use(setCSRFCookie);

// CSRF token endpoint — frontend fetches this before mutations
app.get('/api/csrf-token', (req, res) => {
    res.json({ csrfToken: res.locals.csrfToken });
});

// Apply CSRF protection to ALL state-changing routes
// (GET/HEAD/OPTIONS are automatically skipped inside csrfProtection)
app.use(csrfProtection);

// ====================================
// CZ PAYROLL V2 ROUTE MODULES
// ====================================
const companyRoutes = require('./routes/companies');
const employeeRoutes = require('./routes/employees');
const payrollRoutes = require('./routes/payroll');
const exportRoutes = require('./routes/exports');
const vacationRoutes = require('./routes/vacations');
const deductionRoutes = require('./routes/deductions');
const osvcRoutes = require('./routes/osvc');
const annualRoutes = require('./routes/annual');

// Advanced feature route modules
const apiKeyRoutes = require('./routes/api-keys');
const schedulerRoutes = require('./routes/scheduler');
const reportRoutes = require('./routes/reports');
const webhookRoutes = require('./routes/webhooks');
const approvalRoutes = require('./routes/approvals');
const whitelabelRoutes = require('./routes/whitelabel');
const managerRoutes = require('./routes/manager');
const slaRoutes = require('./routes/sla');
const { authenticateApiKey } = require('./routes/api-keys');

// Industry-standard feature route modules
const timesheetRoutes = require('./routes/timesheets');
const benefitRoutes = require('./routes/benefits');
const organizationRoutes = require('./routes/organization');
const commissionRoutes = require('./routes/commissions');
const onboardingRoutes = require('./routes/onboarding');
const portalRoutes = require('./routes/portal');
const accountingRoutes = require('./routes/accounting');

app.use('/api/companies', companyRoutes);
app.use('/api/v2/employees', employeeRoutes);
app.use('/api/v2/payroll', payrollRoutes);
app.use('/api/v2/exports', exportRoutes);
app.use('/api/v2/vacations', vacationRoutes);
app.use('/api/v2/deductions', deductionRoutes);
app.use('/api/v2/osvc', osvcRoutes);
app.use('/api/v2/annual', annualRoutes);

// Advanced feature routes
app.use('/api/api-keys', apiKeyRoutes);
app.use('/api/v2/scheduler', schedulerRoutes);
app.use('/api/v2/reports', reportRoutes);
app.use('/api/v2/webhooks', webhookRoutes);
app.use('/api/v2/approvals', approvalRoutes);
app.use('/api/v2/whitelabel', whitelabelRoutes);
app.use('/api/v2/manager', managerRoutes);
app.use('/api/v2/sla', slaRoutes);

// Industry-standard feature routes
app.use('/api/v2/timesheets', timesheetRoutes);
app.use('/api/v2/benefits', benefitRoutes);
app.use('/api/v2/organization', organizationRoutes);
app.use('/api/v2/commissions', commissionRoutes);
app.use('/api/v2/onboarding', onboardingRoutes);
app.use('/api/v2/portal', portalRoutes);
app.use('/api/v2/accounting', accountingRoutes);

// API key authentication middleware (before JWT, falls through if no x-api-key header)
app.use(authenticateApiKey);

// ====================================
// AUTHENTICATION MIDDLEWARE
// ====================================
const authenticateToken = async (req, res, next) => {
    // Try to get token from httpOnly cookie first, then Authorization header
    const tokenFromCookie = req.cookies?.accessToken;
    const tokenFromHeader = req.headers.authorization?.split(' ')[1];
    const token = tokenFromCookie || tokenFromHeader;

    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        // 🔒 Check if token is blacklisted (for logout before expiry)
        if (await isTokenBlacklisted(token)) {
            return res.status(401).json({ error: 'Token has been revoked', code: 'TOKEN_REVOKED' });
        }
        
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.type !== 'access') {
            throw new Error('Invalid token type');
        }
        req.user = decoded;
        req.token = token; // Store for potential blacklisting
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
        }
        return res.status(403).json({ error: 'Invalid token' });
    }
};

// Role-based access control
const requireRole = (allowedRoles) => {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            auditLog('AUTHORIZATION_FAILED', {
                userId: req.user?.userId,
                userEmail: req.user?.email,
                ip: req.ip,
                metadata: { requiredRoles: allowedRoles, userRole: req.user?.role, endpoint: req.path }
            }).catch(err => logger.error('Audit log error', { error: err.message }));
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        next();
    };
};

// 🔒 Admin IP Whitelist middleware
const ADMIN_IP_WHITELIST = (process.env.ADMIN_IP_WHITELIST || '').split(',').filter(Boolean);

const requireAdminIP = (req, res, next) => {
    // Skip if no whitelist configured (for development)
    if (ADMIN_IP_WHITELIST.length === 0) {
        return next();
    }
    
    const clientIP = normalizeIP(req.ip);
    
    // Check if IP is whitelisted
    const isAllowed = ADMIN_IP_WHITELIST.some(allowedIP => {
        const normalized = allowedIP.trim();
        // Support wildcards like 192.168.1.*
        if (normalized.includes('*')) {
            const pattern = normalized.replace(/\./g, '\\.').replace(/\*/g, '.*');
            return new RegExp(`^${pattern}$`).test(clientIP);
        }
        return normalized === clientIP;
    });
    
    if (!isAllowed) {
        logger.warn('Admin access blocked - IP not whitelisted', {
            ip: clientIP,
            whitelist: ADMIN_IP_WHITELIST,
            endpoint: req.path,
            requestId: req.requestId
        });
        
        auditLog('ADMIN_IP_BLOCKED', {
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            metadata: { endpoint: req.path, clientIP },
            requestId: req.requestId
        }).catch(err => logger.error('Audit log error', { error: err.message }));
        
        return res.status(403).json({ 
            error: 'Access denied from this location',
            code: 'IP_NOT_WHITELISTED'
        });
    }
    
    next();
};

// ====================================
// VALIDATION MIDDLEWARE
// ====================================
const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        logger.warn('Validation failed', { errors: errors.array(), path: req.path });
        return res.status(400).json({ 
            error: 'Validation failed',
            details: errors.array().map(e => ({ field: e.path, message: e.msg }))
        });
    }
    next();
};

// ====================================
// FILE UPLOAD SETUP (Secure)
// ====================================
const uploadsDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        // Randomized filename to prevent path traversal
        const randomName = crypto.randomBytes(16).toString('hex') + '.csv';
        cb(null, randomName);
    }
});

const fileFilter = (req, file, cb) => {
    // Only accept CSV files
    const allowedMimes = ['text/csv', 'application/vnd.ms-excel', 'text/plain'];
    if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        logger.warn('Invalid file type uploaded', { mimetype: file.mimetype, ip: anonymizeIP(req.ip) });
        cb(new Error('Only CSV files are allowed'), false);
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: MAX_FILE_SIZE,
        files: 1
    }
});

// ====================================
// ROUTES: AUTHENTICATION
// ====================================

// 🔒 Honeypot middleware for bot detection
const honeypotCheck = (req, res, next) => {
    // Check for honeypot fields that bots fill in
    // These fields should be empty for real users (hidden via CSS)
    const honeypotFields = ['website', 'url', 'phone_confirm', 'fax'];
    
    for (const field of honeypotFields) {
        if (req.body[field] && req.body[field].trim() !== '') {
            logger.warn('🤖 Bot detected via honeypot', {
                field,
                value: req.body[field].substring(0, 50),
                ip: req.ip,
                requestId: req.requestId
            });
            
            auditLog('BOT_DETECTED', {
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                metadata: { honeypotField: field },
                requestId: req.requestId
            }).catch(err => logger.error('Audit log error', { error: err.message }));
            
            // Return success to not tip off the bot
            return res.status(200).json({ success: true, message: 'Registration successful.' });
        }
    }
    
    // Also check submission timing (too fast = bot)
    const formLoadTime = req.body._formLoadTime;
    if (formLoadTime) {
        const submissionTime = Date.now() - parseInt(formLoadTime);
        if (submissionTime < 3000) { // Less than 3 seconds
            logger.warn('🤖 Bot detected via timing', {
                submissionTime,
                ip: req.ip,
                requestId: req.requestId
            });
            return res.status(200).json({ success: true, message: 'Registration successful.' });
        }
    }
    
    next();
};

// ====================================
// SUPABASE SYNC - DISABLED (Security: unauthenticated account creation vector)
// ====================================
// 🔒 This endpoint was disabled because it allowed anyone to create accounts
// and obtain JWT tokens without verifying the Supabase identity server-side.
// To re-enable, implement proper Supabase JWT verification via:
//   const { data, error } = await supabaseAdmin.auth.getUser(supabaseAccessToken);
app.post('/api/auth/supabase-sync',
    authLimiter,
    async (req, res) => {
        logger.warn('Disabled supabase-sync endpoint called', { ip: req.ip });
        res.status(410).json({ error: 'This endpoint is disabled. Use /api/auth/register or /api/auth/login.' });
    }
);

// Register new user
app.post('/api/auth/register',
    authLimiter,
    honeypotCheck,
    [
        body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
        body('password').custom(value => {
            if (!isStrongPassword(value)) {
                throw new Error('Password must be at least 12 characters with uppercase, lowercase, number, and special character');
            }
            return true;
        }),
        body('company_id').optional().trim().escape().isLength({ min: 1, max: 100 }),
        // Honeypot fields - these should always be empty
        body('website').optional(),
        body('url').optional(),
        body('phone_confirm').optional(),
        body('fax').optional()
    ],
    validate,
    async (req, res) => {
        try {
            const { email, password, company_id } = req.body;

            // Check if user exists
            const existingUser = await db.getOne('SELECT id FROM users WHERE email = ?', [email]);
            if (existingUser) {
                return res.status(409).json({ error: 'Email already registered' });
            }

            // Hash password with pepper + bcrypt (cost factor 12)
            const pepperedPassword = password + PASSWORD_PEPPER;
            const passwordHash = await bcrypt.hash(pepperedPassword, BCRYPT_ROUNDS);
            const uuid = crypto.randomUUID();

            // Insert user
            const result = await db.run(`
                INSERT INTO users (uuid, email, password_hash, company_id, password_changed_at)
                VALUES (?, ?, ?, ?, datetime('now'))
                RETURNING id
            `, [uuid, email, passwordHash, company_id || 'default']);

            await auditLog('USER_REGISTERED', {
                userId: result.rows[0].id,
                userEmail: email,
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                resourceType: 'user',
                resourceId: uuid,
                requestId: req.requestId
            });

            logger.info(`New user registered: ${email}`);
            res.status(201).json({ 
                success: true, 
                message: 'Registration successful. Please login.' 
            });

        } catch (error) {
            logger.error('Registration error', { error: error.message, requestId: req.requestId });
            res.status(500).json({ error: 'Registration failed. Please try again.' });
        }
    }
);

// Login
app.post('/api/auth/login',
    authLimiter,
    [
        body('email').isEmail().normalizeEmail(),
        body('password').notEmpty(),
        body('totp_code').optional().isLength({ min: 6, max: 6 })
    ],
    validate,
    async (req, res) => {
        try {
            const { email, password, totp_code } = req.body;

            // 🔒 ANTI-ENUMERATION: Use consistent timing and messages
            // Even if user doesn't exist, we still do a dummy comparison
            const GENERIC_AUTH_ERROR = 'Invalid credentials';
            
            // Find user
            const user = await db.getOne('SELECT * FROM users WHERE email = ?', [email]);

            // 🔒 If user doesn't exist, do a dummy bcrypt compare to prevent timing attacks
            if (!user) {
                // Dummy password comparison (prevents timing-based user enumeration)
                await bcrypt.compare(password, '$2b$12$dummy.hash.for.timing.attack.prevention.only');
                
                await auditLog('LOGIN_FAILED', {
                    userEmail: email,
                    ip: req.ip,
                    userAgent: req.get('User-Agent'),
                    metadata: { reason: 'user_not_found' }
                });
                return res.status(401).json({ error: GENERIC_AUTH_ERROR });
            }

            // Check if account is locked
            // 🔒 ANTI-ENUMERATION: Same error message as invalid credentials
            if (user.locked_until && new Date(user.locked_until) > new Date()) {
                await auditLog('LOGIN_BLOCKED_LOCKED', {
                    userId: user.id,
                    userEmail: email,
                    ip: req.ip,
                    metadata: { locked_until: user.locked_until }
                });
                // Return same status and message to prevent enumeration
                return res.status(401).json({ error: GENERIC_AUTH_ERROR });
            }

            // Check if account is active
            // 🔒 ANTI-ENUMERATION: Same error message
            if (!user.is_active) {
                return res.status(401).json({ error: GENERIC_AUTH_ERROR });
            }

            // Verify password (with pepper)
            const pepperedPassword = password + PASSWORD_PEPPER;
            const validPassword = await bcrypt.compare(pepperedPassword, user.password_hash);
            if (!validPassword) {
                // Increment failed attempts
                const newAttempts = user.failed_login_attempts + 1;
                let lockUntil = null;

                // Lock account after 5 failed attempts
                if (newAttempts >= 5) {
                    lockUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 minutes
                    logger.warn(`Account locked due to failed attempts: ${email}`);
                }

                await db.run('UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?',
                    [newAttempts, lockUntil, user.id]);

                await auditLog('LOGIN_FAILED', {
                    userId: user.id,
                    userEmail: email,
                    ip: req.ip,
                    userAgent: req.get('User-Agent'),
                    metadata: { reason: 'invalid_password', attempts: newAttempts }
                });

                return res.status(401).json({ error: GENERIC_AUTH_ERROR });
            }

            // Check 2FA if enabled
            if (user.is_2fa_enabled) {
                if (!totp_code) {
                    return res.status(200).json({ 
                        requires_2fa: true,
                        message: 'Please provide 2FA code'
                    });
                }

                const verified = speakeasy.totp.verify({
                    secret: user.totp_secret,
                    encoding: 'base32',
                    token: totp_code,
                    window: 1
                });

                if (!verified) {
                    await auditLog('2FA_FAILED', {
                        userId: user.id,
                        userEmail: email,
                        ip: req.ip,
                        metadata: { reason: 'invalid_totp' }
                    });
                    return res.status(401).json({ error: 'Invalid 2FA code' });
                }
            }

            // Reset failed attempts on successful login
            await db.run('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?',
                [user.id]);

            // Generate tokens
            const accessToken = generateToken(user.id, user.email, user.role, 'access');
            const refreshToken = generateToken(user.id, user.email, user.role, 'refresh');

            // Store refresh token hash
            const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
            const refreshExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
            await db.run('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
                [user.id, refreshTokenHash, refreshExpiry]);

            await auditLog('LOGIN_SUCCESS', {
                userId: user.id,
                userEmail: email,
                ip: req.ip,
                userAgent: req.get('User-Agent')
            });

            // Set httpOnly cookies
            const cookieOptions = {
                httpOnly: true,
                secure: NODE_ENV === 'production',
                sameSite: 'strict',
                maxAge: 15 * 60 * 1000 // 15 minutes
            };

            res.cookie('accessToken', accessToken, cookieOptions);
            res.cookie('refreshToken', refreshToken, {
                ...cookieOptions,
                maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
            });

            res.json({
                success: true,
                user: {
                    id: user.uuid,
                    email: user.email,
                    role: user.role,
                    company_id: user.company_id,
                    is_2fa_enabled: !!user.is_2fa_enabled
                },
                // Also send tokens in response for non-cookie clients
                accessToken,
                expiresIn: 900 // 15 minutes in seconds
            });

        } catch (error) {
            logger.error('Login error', { error: error.message });
            res.status(500).json({ error: 'Login failed. Please try again.' });
        }
    }
);

// Refresh token with ROTATION (security best practice)
// 🔐 HARDENED: Dedicated rate limiter — max 10 refresh attempts per minute per IP
const refreshRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { error: 'Příliš mnoho pokusů o refresh. Zkuste to později.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip,
});
app.post('/api/auth/refresh', refreshRateLimiter, async (req, res) => {
    try {
        const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

        if (!refreshToken) {
            return res.status(401).json({ error: 'Refresh token required' });
        }

        // Verify token
        const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
        if (decoded.type !== 'refresh') {
            throw new Error('Invalid token type');
        }

        // Check if token is in database and not revoked
        const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
        const storedToken = await db.getOne(`
            SELECT * FROM refresh_tokens 
            WHERE token_hash = ? AND user_id = ? AND expires_at > datetime('now')
        `, [tokenHash, decoded.userId]);

        if (!storedToken) {
            return res.status(401).json({ error: 'Invalid or expired refresh token' });
        }

        // 🔒 SECURITY: Check if token was already used (potential theft!)
        if (storedToken.revoked_at) {
            // Token reuse detected! This could be an attack.
            // Revoke ALL tokens for this user as a precaution
            logger.warn('🚨 REFRESH TOKEN REUSE DETECTED - Potential token theft!', {
                userId: decoded.userId,
                tokenHash: tokenHash.substring(0, 16) + '...',
                requestId: req.requestId
            });
            
            await db.run("UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE user_id = ?",
                [decoded.userId]);
            
            await auditLog('TOKEN_REUSE_DETECTED', {
                userId: decoded.userId,
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                metadata: { tokenHash: tokenHash.substring(0, 16) },
                requestId: req.requestId
            });
            
            return res.status(401).json({ 
                error: 'Security alert: Please login again',
                code: 'TOKEN_REUSE_DETECTED'
            });
        }

        // Get user
        const user = await db.getOne('SELECT * FROM users WHERE id = ? AND is_active = 1', [decoded.userId]);
        if (!user) {
            return res.status(401).json({ error: 'User not found or inactive' });
        }

        // 🔒 ROTATION: Revoke old refresh token
        await db.run("UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE token_hash = ?",
            [tokenHash]);

        // Generate NEW tokens (both access and refresh)
        const newAccessToken = generateToken(user.id, user.email, user.role, 'access');
        const newRefreshToken = generateToken(user.id, user.email, user.role, 'refresh');
        
        // Store new refresh token
        const newTokenHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');
        const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
        
        await db.run(`
            INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
            VALUES (?, ?, ?)
        `, [user.id, newTokenHash, newExpiresAt.toISOString()]);

        const accessCookieOptions = {
            httpOnly: true,
            secure: NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 15 * 60 * 1000 // 15 minutes
        };
        
        const refreshCookieOptions = {
            httpOnly: true,
            secure: NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
            path: '/api/auth' // Only sent to auth endpoints
        };

        res.cookie('accessToken', newAccessToken, accessCookieOptions);
        res.cookie('refreshToken', newRefreshToken, refreshCookieOptions);
        
        await auditLog('TOKEN_REFRESHED', {
            userId: user.id,
            ip: req.ip,
            requestId: req.requestId
        });
        
        res.json({
            success: true,
            // 🔐 FIXED: Tokens sent only via httpOnly cookies, not in response body
            expiresIn: 900
        });

    } catch (error) {
        logger.error('Token refresh error', { error: error.message, requestId: req.requestId });
        return res.status(401).json({ error: 'Invalid refresh token' });
    }
});

// Get current user info
app.get('/api/auth/me', authenticateToken, async (req, res) => {
    try {
        const user = await db.getOne('SELECT id, uuid, email, role, company_id, is_2fa_enabled, created_at FROM users WHERE id = ?',
            [req.user.userId]);
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json({
            user: {
                id: user.uuid,
                email: user.email,
                role: user.role,
                company_id: user.company_id || undefined,
                is_2fa_enabled: !!user.is_2fa_enabled,
                is2FAEnabled: !!user.is_2fa_enabled,
                createdAt: user.created_at
            }
        });
    } catch (error) {
        logger.error('Get user info error', { error: error.message });
        res.status(500).json({ error: 'Failed to get user info' });
    }
});

// Logout
app.post('/api/auth/logout', authenticateToken, async (req, res) => {
    try {
        // 🔒 Blacklist the current access token
        if (req.token) {
            const decoded = jwt.decode(req.token);
            const expiresAt = new Date(decoded.exp * 1000);
            await blacklistToken(req.token, req.user.userId, expiresAt, 'logout');
        }
        
        // Revoke all refresh tokens for user
        await db.run("UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE user_id = ?",
            [req.user.userId]);

        await auditLog('LOGOUT', {
            userId: req.user.userId,
            userEmail: req.user.email,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            requestId: req.requestId
        });

        // Clear cookies
        res.clearCookie('accessToken');
        res.clearCookie('refreshToken');
        res.clearCookie(CSRF_COOKIE_NAME);
        res.json({ success: true, message: 'Logged out successfully' });

    } catch (error) {
        logger.error('Logout error', { error: error.message, requestId: req.requestId });
        res.status(500).json({ error: 'Logout failed' });
    }
});

// ====================================
// ROUTES: 2FA
// ====================================

// Setup 2FA
app.post('/api/auth/2fa/setup', authenticateToken, async (req, res) => {
    try {
        const user = await db.getOne('SELECT * FROM users WHERE id = ?', [req.user.userId]);
        
        if (user.is_2fa_enabled) {
            return res.status(400).json({ error: '2FA is already enabled' });
        }

        // Generate secret
        const secret = speakeasy.generateSecret({
            name: `UnhackablePayroll (${user.email})`,
            issuer: process.env.TOTP_ISSUER || 'Unhackable-Payroll'
        });

        // Store secret temporarily (not enabled yet)
        await db.run('UPDATE users SET totp_secret = ? WHERE id = ?',
            [secret.base32, req.user.userId]);

        // Generate QR code
        const qrCode = await QRCode.toDataURL(secret.otpauth_url);

        res.json({
            success: true,
            secret: secret.base32,
            qrCode,
            message: 'Scan the QR code with your authenticator app, then verify with /api/auth/2fa/verify'
        });

    } catch (error) {
        logger.error('2FA setup error', { error: error.message, requestId: req.requestId });
        res.status(500).json({ error: '2FA setup failed' });
    }
});

// Verify and enable 2FA (with rate limiting)
app.post('/api/auth/2fa/verify',
    authenticateToken,
    [body('totp_code').isLength({ min: 6, max: 6 }).isNumeric()],
    validate,
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT * FROM users WHERE id = ?', [req.user.userId]);

            if (!user.totp_secret) {
                return res.status(400).json({ error: 'Please setup 2FA first' });
            }

            // 🔒 Check for 2FA brute force lockout
            const lockoutStatus = await check2FALockout(req.user.userId);
            if (lockoutStatus.locked) {
                await auditLog('2FA_LOCKOUT', {
                    userId: req.user.userId,
                    userEmail: req.user.email,
                    ip: req.ip,
                    metadata: { remainingMinutes: lockoutStatus.remainingMinutes }
                });
                return res.status(429).json({ 
                    error: `Too many 2FA attempts. Try again in ${lockoutStatus.remainingMinutes} minutes.`,
                    code: '2FA_LOCKED'
                });
            }

            const verified = speakeasy.totp.verify({
                secret: user.totp_secret,
                encoding: 'base32',
                token: req.body.totp_code,
                window: 1
            });

            // Record the attempt
            await record2FAAttempt(req.user.userId, verified, normalizeIP(req.ip));

            if (!verified) {
                await auditLog('2FA_VERIFY_FAILED', {
                    userId: req.user.userId,
                    userEmail: req.user.email,
                    ip: req.ip
                });
                return res.status(400).json({ error: 'Invalid verification code' });
            }

            // Enable 2FA
            await db.run('UPDATE users SET is_2fa_enabled = 1 WHERE id = ?',
                [req.user.userId]);

            await auditLog('2FA_ENABLED', {
                userId: req.user.userId,
                userEmail: req.user.email,
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                requestId: req.requestId
            });

            res.json({ success: true, message: '2FA enabled successfully' });

        } catch (error) {
            logger.error('2FA verify error', { error: error.message, requestId: req.requestId });
            res.status(500).json({ error: '2FA verification failed' });
        }
    }
);

// Disable 2FA
app.post('/api/auth/2fa/disable',
    authenticateToken,
    [body('password').notEmpty()],
    validate,
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT * FROM users WHERE id = ?', [req.user.userId]);

            // 🔐 FIXED: Must pepper password before comparing (matches register/login flow)
            const pepperedPassword = req.body.password + PASSWORD_PEPPER;
            const validPassword = await bcrypt.compare(pepperedPassword, user.password_hash);
            if (!validPassword) {
                return res.status(401).json({ error: 'Invalid password' });
            }

            await db.run('UPDATE users SET is_2fa_enabled = 0, totp_secret = NULL WHERE id = ?',
                [req.user.userId]);

            await auditLog('2FA_DISABLED', {
                userId: req.user.userId,
                userEmail: req.user.email,
                ip: req.ip,
                userAgent: req.get('User-Agent')
            });

            res.json({ success: true, message: '2FA disabled' });

        } catch (error) {
            logger.error('2FA disable error', { error: error.message });
            res.status(500).json({ error: '2FA disable failed' });
        }
    }
);

// ====================================
// ROUTES: SESSION MANAGEMENT (TIER 3)
// ====================================

// Get user's active sessions
app.get('/api/auth/sessions', authenticateToken, async (req, res) => {
    try {
        const sessions = await sessionManager.getUserSessions(req.user.userId);
        
        // Mask sensitive data
        const maskedSessions = sessions.map(s => ({
            id: s.id,
            device: s.user_agent?.substring(0, 100),
            ip: s.ip_address,
            lastActive: s.last_active,
            createdAt: s.created_at,
            isCurrent: false // Would need to track current session
        }));
        
        res.json({ sessions: maskedSessions });
    } catch (error) {
        logger.error('Get sessions error', { error: error.message });
        res.status(500).json({ error: 'Failed to get sessions' });
    }
});

// Revoke a specific session
app.delete('/api/auth/sessions/:sessionId', authenticateToken, async (req, res) => {
    try {
        const sessionId = req.params.sessionId;
        
        // 🔒 IDOR PROTECTION: Verify session belongs to requesting user
        const session = await sessionManager.getSession(sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }
        
        if (session.user_id !== req.user.userId) {
            // Log potential IDOR attempt
            await auditLog('IDOR_ATTEMPT', {
                userId: req.user.userId,
                userEmail: req.user.email,
                ip: req.ip,
                metadata: { 
                    targetSessionId: sessionId,
                    targetUserId: session.user_id,
                    endpoint: '/api/auth/sessions/:sessionId'
                },
                requestId: req.requestId
            });
            logger.warn('🚨 IDOR attempt detected on session revocation', {
                attackerId: req.user.userId,
                targetUserId: session.user_id,
                sessionId: sessionId
            });
            return res.status(403).json({ error: 'You can only revoke your own sessions' });
        }
        
        await sessionManager.revokeSession(sessionId, 'User requested revocation');
        
        await auditLog('SESSION_REVOKED', {
            userId: req.user.userId,
            userEmail: req.user.email,
            ip: req.ip,
            metadata: { sessionId: sessionId }
        });
        
        res.json({ success: true, message: 'Session revoked' });
    } catch (error) {
        logger.error('Revoke session error', { error: error.message });
        res.status(500).json({ error: 'Failed to revoke session' });
    }
});

// Logout from all devices
app.post('/api/auth/logout-all', authenticateToken, async (req, res) => {
    try {
        await sessionManager.revokeAllUserSessions(req.user.userId, 'User requested logout from all devices');
        
        // Also revoke refresh tokens
        await db.run("UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE user_id = ?",
            [req.user.userId]);
        
        await auditLog('LOGOUT_ALL', {
            userId: req.user.userId,
            userEmail: req.user.email,
            ip: req.ip,
            userAgent: req.get('User-Agent')
        });
        
        res.clearCookie('accessToken');
        res.clearCookie('refreshToken');
        res.json({ success: true, message: 'Logged out from all devices' });
    } catch (error) {
        logger.error('Logout all error', { error: error.message });
        res.status(500).json({ error: 'Failed to logout from all devices' });
    }
});

// ====================================
// ROUTES: FORGOT PASSWORD
// ====================================
app.post('/api/auth/forgot-password',
    authLimiter,
    async (req, res) => {
        try {
            const { email } = req.body;
            if (!email) return res.status(400).json({ error: 'Email is required' });

            // Always respond success to prevent email enumeration
            const user = await db.getOne('SELECT id, email FROM users WHERE email = ?', [email.toLowerCase().trim()]);
            if (user) {
                // In production, send an email with a reset link/token
                const resetToken = crypto.randomBytes(32).toString('hex');
                const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');
                await db.run(
                    "INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL '1 hour')",
                    [user.id, hashedToken]
                );
                logger.info('Password reset requested', { email: user.email });
                // TODO: integrate email service to send resetToken/link
            }

            res.json({ success: true, message: 'If an account with that email exists, a reset link has been sent.' });
        } catch (error) {
            logger.error('Forgot password error', { error: error.message });
            res.status(500).json({ error: 'Internal server error' });
        }
    }
);

// ====================================
// ROUTES: RESET PASSWORD (token consumption)
// ====================================
app.post('/api/auth/reset-password',
    authLimiter,
    [
        body('token').trim().notEmpty().withMessage('Token is required'),
        body('new_password').isLength({ min: 12, max: 72 }).withMessage('Password must be 12-72 characters')
            .matches(/[a-z]/).withMessage('Password must contain a lowercase letter')
            .matches(/[A-Z]/).withMessage('Password must contain an uppercase letter')
            .matches(/[0-9]/).withMessage('Password must contain a digit')
            .matches(/[^A-Za-z0-9\s]/).withMessage('Password must contain a special character'),
    ],
    async (req, res) => {
        try {
            // Validate inputs
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ error: errors.array()[0].msg });
            }

            const { token, new_password } = req.body;

            // Hash the incoming token so we can compare with stored hash
            const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

            // Find valid (unused, non-expired) reset record
            const resetRecord = await db.getOne(
                `SELECT pr.id, pr.user_id, pr.expires_at, pr.used_at
                 FROM password_resets pr
                 WHERE pr.token_hash = ? AND pr.used_at IS NULL AND pr.expires_at > NOW()
                 ORDER BY pr.created_at DESC LIMIT 1`,
                [tokenHash]
            );

            if (!resetRecord) {
                return res.status(400).json({ error: 'Neplatný nebo expirovaný odkaz pro obnovení hesla. Požádejte o nový.' });
            }

            // Hash new password with pepper + bcrypt
            const pepperedPassword = new_password + PASSWORD_PEPPER;
            const passwordHash = await bcrypt.hash(pepperedPassword, BCRYPT_ROUNDS);

            // Update password
            await db.run('UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?',
                [passwordHash, resetRecord.user_id]);

            // Mark token as used (single-use)
            await db.run('UPDATE password_resets SET used_at = NOW() WHERE id = ?',
                [resetRecord.id]);

            // Invalidate all existing refresh tokens for this user (force re-login)
            await db.run("UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL",
                [resetRecord.user_id]);

            // Audit log
            await auditLog('PASSWORD_RESET', {
                userId: resetRecord.user_id,
                ip: req.ip,
                requestId: req.requestId,
            });

            logger.info('Password reset completed', { userId: resetRecord.user_id });

            res.json({ success: true, message: 'Heslo bylo úspěšně změněno. Nyní se můžete přihlásit.' });
        } catch (error) {
            logger.error('Reset password error', { error: error.message, requestId: req.requestId });
            res.status(500).json({ error: 'Chyba při obnovení hesla' });
        }
    }
);

// ====================================
// ROUTES: QUOTE SUBMISSION
// ====================================
app.post('/api/quotes/submit',
    globalLimiter,
    [
        body('company_name').trim().escape().isLength({ min: 1, max: 200 }).withMessage('Název firmy je povinný'),
        body('email').isEmail().normalizeEmail().withMessage('Platný email je povinný'),
        body('employees').optional().isInt({ min: 1, max: 100000 }).withMessage('Počet zaměstnanců musí být číslo'),
        body('message').optional().trim().isLength({ max: 2000 }).withMessage('Zpráva max 2000 znaků'),
    ],
    validate,
    async (req, res) => {
        try {
            const { company_name, email, employees, message } = req.body;

            await db.run(
                'INSERT INTO quote_requests (company_name, email, employee_count, message, created_at) VALUES (?, ?, ?, ?, NOW())',
                [company_name, email.toLowerCase().trim(), employees || null, message || null]
            );

            await auditLog('QUOTE_SUBMITTED', {
                email: email.toLowerCase().trim(),
                company_name,
                ip: req.ip
            });

            res.json({ success: true, message: 'Quote request submitted successfully' });
        } catch (error) {
            logger.error('Quote submission error', { error: error.message });
            res.status(500).json({ error: 'Failed to submit quote request' });
        }
    }
);

// ====================================
// ROUTES: CREDITS & BILLING
// ====================================

// Get credit balance
app.get('/api/credits/balance',
    authenticateToken,
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
            const company = await getOrCreateCompany(req.user.userId, user.company_id);
            const balance = await getCreditBalance(company.uuid);
            const { tier, config, overagePerEmployeeCZK, includedEmployees } = await getCompanyTier(company.uuid);
            
            // Get employee count for cost estimate
            const employees = await db.getOne('SELECT COUNT(*) as count FROM employees WHERE company_id = ? AND status = ?',
                [company.uuid, 'active']);
            
            const costInfo = await calculatePayrollCost(company.uuid, employees.count);
            const { runsThisPeriod } = await getEmployeesPaidThisPeriod(company.uuid);
            const balanceCZK = balance.balance_czk || 0;
            const payrollsRemaining = (balanceCZK > 0 && costInfo.totalCostCZK > 0)
                ? Math.floor(balanceCZK / costInfo.totalCostCZK) 
                : (costInfo.totalCostCZK === 0 ? 999 : 0);
            
            res.json({
                currency: 'CZK',
                balance_czk: balanceCZK,
                total_spent_czk: balance.total_spent_czk || 0,
                last_topped_up: balance.last_topped_up,
                // Legacy compatibility
                balance_usd: balanceCZK,
                total_spent_usd: balance.total_spent_czk || 0,
                tier: {
                    name: tier,
                    display_name: config.name,
                    monthly_price_czk: config.monthlyPriceCZK,
                    annual_monthly_price_czk: config.annualMonthlyPriceCZK,
                    included_employees: includedEmployees,
                    overage_per_employee_czk: overagePerEmployeeCZK,
                    max_payroll_runs: config.maxPayrollRuns === Infinity ? null : config.maxPayrollRuns,
                    run_limit_type: config.runLimitType,
                    max_seats: config.maxSeats === Infinity ? null : config.maxSeats,
                    max_employees: config.maxEmployees === Infinity ? null : config.maxEmployees,
                    features: config.features,
                    sla: config.sla,
                    gdpr_support: config.gdprSupport,
                    cost_per_run_czk: config.costPerRunCZK || 0,
                    // Legacy compatibility
                    rate_per_employee: overagePerEmployeeCZK,
                    monthly_price: config.monthlyPriceCZK
                },
                billing_period: company.billing_period || 'monthly',
                runs_this_period: runsThisPeriod,
                estimates: {
                    active_employees: employees.count,
                    next_payroll_cost_czk: costInfo.totalCostCZK,
                    next_payroll_cost: costInfo.totalCostCZK,
                    included_remaining: costInfo.includedRemaining,
                    overage_employees: costInfo.overageEmployees,
                    payrolls_remaining: payrollsRemaining
                }
            });
        } catch (error) {
            logger.error('Get credit balance error', { error: error.message, userId: req.user?.userId });
            res.status(500).json({ error: 'Failed to retrieve credit balance' });
        }
    }
);

// Get transaction history
app.get('/api/credits/history',
    authenticateToken,
    [
        query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
        query('offset').optional().isInt({ min: 0 }).toInt(),
        query('type').optional().isIn(['topup', 'charge', 'refund', 'adjustment'])
    ],
    validate,
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
            const company = await getOrCreateCompany(req.user.userId, user.company_id);
            
            const limit = req.query.limit || 20;
            const offset = req.query.offset || 0;
            const typeFilter = req.query.type;
            
            let query_sql = `
                SELECT uuid, type, 
                       amount_czk, 
                       balance_after_czk, 
                       description, payment_method, created_at
                FROM credit_transactions 
                WHERE company_id = ?
            `;
            const params = [company.uuid];
            
            if (typeFilter) {
                query_sql += ' AND type = ?';
                params.push(typeFilter);
            }
            
            query_sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
            params.push(limit, offset);
            
            const transactions = await db.getAll(query_sql, params);
            
            const total = await db.getOne(`
                SELECT COUNT(*) as count FROM credit_transactions 
                WHERE company_id = ? ${typeFilter ? 'AND type = ?' : ''}
            `, typeFilter ? [company.uuid, typeFilter] : [company.uuid]);
            
            res.json({
                transactions,
                pagination: {
                    total: total.count,
                    limit,
                    offset,
                    has_more: offset + transactions.length < total.count
                }
            });
        } catch (error) {
            logger.error('Get credit history error', { error: error.message, userId: req.user?.userId });
            res.status(500).json({ error: 'Failed to retrieve transaction history' });
        }
    }
);

// Request top-up (generates payment instructions)
app.post('/api/credits/topup/request',
    authenticateToken,
    requireRole(['admin', 'employer']),
    [
        body('amount_czk').isFloat({ min: 500, max: 500000 }).withMessage('\u010c\u00e1stka mus\u00ed b\u00fdt mezi 500 a 500 000 K\u010d')
    ],
    validate,
    async (req, res) => {
        try {
            const { amount_czk } = req.body;
            const user = await db.getOne('SELECT company_id, email FROM users WHERE id = ?', [req.user.userId]);
            const company = await getOrCreateCompany(req.user.userId, user.company_id);
            
            // Generate unique payment reference
            const paymentReference = `PAY-${company.uuid.substring(0, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
            
            // Calculate overage employees this would cover
            const { overagePerEmployeeCZK } = await getCompanyTier(company.uuid);
            const employeesCovered = overagePerEmployeeCZK > 0 ? Math.floor(amount_czk / overagePerEmployeeCZK) : 0;
            
            await auditLog('TOPUP_REQUESTED', {
                userId: req.user.userId,
                userEmail: req.user.email,
                ip: req.ip,
                resourceType: 'credit_topup',
                resourceId: paymentReference,
                metadata: { amount_czk },
                requestId: req.requestId
            });
            
            res.json({
                success: true,
                currency: 'CZK',
                payment_reference: paymentReference,
                amount_czk: amount_czk,
                overage_employees_covered: employeesCovered,
                overage_rate_czk: overagePerEmployeeCZK,
                payment_methods: {
                    bank_transfer: {
                        bank_name: process.env.BANK_NAME || 'Configurable Bank',
                        account_number: process.env.BANK_ACCOUNT || 'XXXX-XXXX-XXXX',
                        iban: process.env.BANK_IBAN || 'CZ00 0000 0000 0000 0000 0000',
                        reference: paymentReference,
                        instructions: `Uve\u010fte referenci "${paymentReference}" do zpr\u00e1vy pro p\u0159\u00edjemce`
                    },
                    crypto: {
                        usdc_address: process.env.USDC_ADDRESS || '0x...configure',
                        network: 'Ethereum Mainnet or Polygon',
                        reference: paymentReference,
                        instructions: `Po\u0161lete USDC v ekvivalentu ${amount_czk} K\u010d. Pokud mo\u017eno, uve\u010fte referenci v memo.`
                    }
                },
                expires_in_hours: 72,
                support_email: process.env.SUPPORT_EMAIL || 'billing@czkpayroll.com',
                message: `Po\u0161lete ${amount_czk} K\u010d jedn\u00edm z uveden\u00fdch zp\u016fsob\u016f. Kredity budou p\u0159ips\u00e1ny do 24 hodin od potvrzen\u00ed platby.`
            });
        } catch (error) {
            logger.error('Top-up request error', { error: error.message, userId: req.user?.userId });
            res.status(500).json({ error: 'Failed to create top-up request' });
        }
    }
);

// Purchase additional payroll runs (self-service — instant credit in demo mode)
app.post('/api/credits/purchase-runs',
    authenticateToken,
    requireRole(['admin', 'employer']),
    [
        body('runs').isInt({ min: 1, max: 100 }).withMessage('Počet runů musí být 1–100')
    ],
    validate,
    async (req, res) => {
        try {
            const { runs } = req.body;
            const user = await db.getOne('SELECT company_id, email FROM users WHERE id = ?', [req.user.userId]);
            const company = await getOrCreateCompany(req.user.userId, user.company_id);
            const { tier, config } = await getCompanyTier(company.uuid);
            
            const costPerRun = config.costPerRunCZK || 0;
            const totalCost = runs * costPerRun;
            
            // Get current employee count to estimate what each run covers
            const empResult = await db.getOne('SELECT COUNT(*) as count FROM employees WHERE company_id = ? AND status = ?',
                [company.uuid, 'active']);
            const activeEmployees = empResult?.count || 0;
            
            // Calculate overage cost per employee for this run
            const costInfo = await calculatePayrollCost(company.uuid, activeEmployees);
            const overageCostPerRun = costInfo.totalCostCZK;
            
            // Total credit to add = runs × cost_per_run (covers the run itself)
            // In overage model: the run credit covers overage employees too
            const creditAmount = totalCost > 0 ? totalCost : 0;
            
            // Generate payment reference
            const paymentReference = `RUN-${company.uuid.substring(0, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
            
            // 🔒 SECURITY: Require actual payment verification — no auto-crediting
            // Credits are only added by admin after manual payment confirmation
            // via POST /api/admin/credits/add
            if (NODE_ENV === 'production') {
                // In production, generate payment instructions only
                const paymentInstructions = {
                    amount_czk: creditAmount,
                    bank_account: process.env.BANK_ACCOUNT || 'Kontaktujte billing@czkpayroll.com',
                    iban: process.env.BANK_IBAN || '',
                    variable_symbol: paymentReference,
                    message: `Nákup ${runs}× payroll run`,
                    crypto_address: process.env.USDC_ADDRESS || ''
                };
                
                await auditLog('RUNS_PURCHASE_REQUESTED', {
                    userId: req.user.userId,
                    userEmail: req.user.email,
                    ip: req.ip,
                    resourceType: 'credit_purchase',
                    resourceId: paymentReference,
                    metadata: { runs, costPerRun, totalCost, tier, activeEmployees, status: 'awaiting_payment' },
                    requestId: req.requestId
                });
                
                return res.json({
                    success: true,
                    status: 'awaiting_payment',
                    runs_requested: runs,
                    cost_per_run_czk: costPerRun,
                    total_cost_czk: totalCost,
                    payment_reference: paymentReference,
                    payment_instructions: paymentInstructions,
                    message: `Platba ${totalCost} Kč za ${runs}× payroll run – po připsání bude kredit automaticky aktivován.`
                });
            }
            
            // DEMO/DEV MODE ONLY: auto-credit the runs immediately
            if (creditAmount > 0) {
                await addCredits(company.uuid, creditAmount, 'run_purchase', `[DEMO] Nákup ${runs}× payroll run (${costPerRun} Kč/run)`);
            }
            
            await auditLog('RUNS_PURCHASED', {
                userId: req.user.userId,
                userEmail: req.user.email,
                ip: req.ip,
                resourceType: 'credit_purchase',
                resourceId: paymentReference,
                metadata: { runs, costPerRun, totalCost, tier, activeEmployees },
                requestId: req.requestId
            });
            
            // Get updated balance
            const balance = await getCreditBalance(company.uuid);
            const updatedCostInfo = await calculatePayrollCost(company.uuid, activeEmployees);
            const balanceCZK = balance.balance_czk || 0;
            const payrollsRemaining = (balanceCZK > 0 && updatedCostInfo.totalCostCZK > 0)
                ? Math.floor(balanceCZK / updatedCostInfo.totalCostCZK)
                : (updatedCostInfo.totalCostCZK === 0 ? 999 : 0);
            
            res.json({
                success: true,
                runs_purchased: runs,
                cost_per_run_czk: costPerRun,
                total_cost_czk: totalCost,
                payment_reference: paymentReference,
                new_balance_czk: balanceCZK,
                payrolls_remaining: payrollsRemaining,
                message: `Úspěšně zakoupeno ${runs}× payroll run za ${totalCost} Kč`
            });
        } catch (error) {
            logger.error('Purchase runs error', { error: error.message, userId: req.user?.userId });
            res.status(500).json({ error: 'Nákup runů selhal' });
        }
    }
);

// Admin: Manually add credits (after payment verification)
app.post('/api/admin/credits/add',
    authenticateToken,
    requireRole(['admin']),
    [
        body('company_id').isString().isLength({ min: 1, max: 50 }),
        body('amount_czk').isFloat({ min: 1, max: 10000000 }),
        body('payment_method').isIn(['bank_transfer', 'crypto', 'manual', 'promotional']),
        body('reference').optional().isString().isLength({ max: 100 })
    ],
    validate,
    async (req, res) => {
        try {
            const { company_id, amount_czk, payment_method, reference } = req.body;
            
            // Verify company exists
            const company = await db.getOne('SELECT * FROM companies WHERE uuid = ?', [company_id]);
            if (!company) {
                return res.status(404).json({ error: 'Firma nenalezena' });
            }
            
            const result = await addCredits(company_id, amount_czk, payment_method, reference || `Admin p\u0159idal: ${req.user.email}`);
            
            await auditLog('ADMIN_CREDITS_ADDED', {
                userId: req.user.userId,
                userEmail: req.user.email,
                ip: req.ip,
                resourceType: 'credit_topup',
                resourceId: result.transactionUuid,
                metadata: { company_id, amount_czk, payment_method, reference },
                requestId: req.requestId
            });
            
            logger.info('Admin added credits (CZK)', { 
                adminId: req.user.userId,
                companyId: company_id,
                amount_czk: amount_czk,
                newBalance: result.newBalance
            });
            
            res.json({
                success: true,
                currency: 'CZK',
                transaction_id: result.transactionUuid,
                amount_added_czk: result.added,
                new_balance_czk: result.newBalance,
                company: {
                    id: company.uuid,
                    name: company.name,
                    tier: company.tier
                }
            });
        } catch (error) {
            logger.error('Admin add credits error', { error: error.message, adminId: req.user?.userId });
            res.status(500).json({ error: 'Failed to add credits' });
        }
    }
);

// Admin: List all companies with balances
// 🔐 FIXED: Correct column names from USD to CZK
app.get('/api/admin/companies',
    authenticateToken,
    requireRole(['admin']),
    async (req, res) => {
        try {
            const companies = await db.getAll(`
                SELECT 
                    c.uuid, c.name, c.tier, c.max_employees, c.created_at,
                    cb.balance_czk, cb.total_spent_czk, cb.last_topped_up,
                    (SELECT COUNT(*) FROM users WHERE company_id = c.uuid) as user_count,
                    (SELECT COUNT(*) FROM employees WHERE company_id = c.uuid AND status = 'active') as employee_count
                FROM companies c
                LEFT JOIN credit_balance cb ON c.uuid = cb.company_id
                ORDER BY cb.total_spent_czk DESC
            `);
            
            res.json({ companies });
        } catch (error) {
            logger.error('Admin list companies error', { error: error.message });
            res.status(500).json({ error: 'Failed to list companies' });
        }
    }
);

// Get available subscription tiers
// 🔐 FIXED: Correct field names to match PRICING.TIERS properties
app.get('/api/subscription/tiers',
    async (req, res) => {
        try {
            const tiers = Object.entries(PRICING.TIERS).map(([key, config]) => ({
                id: key,
                name: config.name,
                monthlyPriceCZK: config.monthlyPriceCZK,
                annualMonthlyPriceCZK: config.annualMonthlyPriceCZK,
                includedEmployees: config.includedEmployees,
                overagePerEmployeeCZK: config.overagePerEmployeeCZK,
                maxEmployees: config.maxEmployees === Infinity ? null : config.maxEmployees,
                maxSeats: config.maxSeats === Infinity ? null : config.maxSeats,
                sla: config.sla,
                features: config.features
            }));
            res.json({ tiers });
        } catch (error) {
            logger.error('Get tiers error', { error: error.message });
            res.status(500).json({ error: 'Failed to retrieve tiers' });
        }
    }
);

// Change subscription tier
app.post('/api/subscription/upgrade',
    authenticateToken,
    requireRole(['admin', 'employer']),
    [
        body('tier').isIn(['starter', 'pro', 'business', 'enterprise', 'enterprise_plus'])
    ],
    validate,
    async (req, res) => {
        try {
            let { tier } = req.body;
            // Accept legacy tier names
            if (PRICING.LEGACY_TIER_MAP[tier]) tier = PRICING.LEGACY_TIER_MAP[tier];
            
            const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
            const company = await getOrCreateCompany(req.user.userId, user.company_id);
            let currentTier = company.tier;
            if (PRICING.LEGACY_TIER_MAP[currentTier]) currentTier = PRICING.LEGACY_TIER_MAP[currentTier];
            
            if (tier === currentTier) {
                return res.status(400).json({ error: 'Již jste na tomto plánu' });
            }
            
            if (tier === 'enterprise' || tier === 'enterprise_plus') {
                return res.status(400).json({ error: 'Pro Enterprise plán kontaktujte sales@czkpayroll.com' });
            }
            
            const newConfig = PRICING.TIERS[tier];
            if (!newConfig) {
                return res.status(400).json({ error: 'Neznámý plán' });
            }
            
            // Check seat limit on downgrade
            const seatCount = await db.getOne('SELECT COUNT(*) as count FROM users WHERE company_id = ?', [company.uuid]);
            const newMaxSeats = newConfig.maxSeats === Infinity ? 999999 : newConfig.maxSeats;
            if (seatCount && seatCount.count > newMaxSeats) {
                return res.status(400).json({ 
                    error: `Nelze přejít na ${newConfig.name} – máte ${seatCount.count} uživatelů, ale plán povoluje max ${newConfig.maxSeats}.`,
                    current_seats: seatCount.count,
                    max_seats: newConfig.maxSeats
                });
            }
            
            // Reset monthly payroll runs counter on tier change
            await db.run(`
                UPDATE companies 
                SET tier = ?, max_employees = ?, monthly_payroll_runs = 0, current_period_start = datetime('now'), updated_at = datetime('now')
                WHERE uuid = ?
            `, [tier, newConfig.maxEmployees === Infinity ? 2147483647 : newConfig.maxEmployees, company.uuid]);
            
            await auditLog('TIER_UPGRADED', {
                userId: req.user.userId,
                userEmail: req.user.email,
                ip: req.ip,
                resourceType: 'subscription',
                resourceId: company.uuid,
                metadata: { from_tier: currentTier, to_tier: tier },
                requestId: req.requestId
            });
            
            res.json({
                success: true,
                currency: 'CZK',
                previous_tier: currentTier,
                new_tier: tier,
                tier_config: {
                    name: newConfig.name,
                    monthly_price_czk: newConfig.monthlyPriceCZK,
                    annual_monthly_price_czk: newConfig.annualMonthlyPriceCZK,
                    included_employees: newConfig.includedEmployees,
                    overage_per_employee_czk: newConfig.overagePerEmployeeCZK,
                    features: newConfig.features
                },
                message: `Přepnuto na ${newConfig.name}! Nové limity jsou aktivní.`
            });
        } catch (error) {
            logger.error('Tier upgrade error', { error: error.message, userId: req.user?.userId });
            res.status(500).json({ error: 'Nepodařilo se změnit plán' });
        }
    }
);

// ====================================
// ROUTES: EMPLOYEES
// ====================================

// Import file scanner
const { scanFile, quarantineFile } = require('./file-scanner');

// Upload CSV
app.post('/api/employees/upload',
    authenticateToken,
    requireRole(['admin', 'employer']),
    uploadLimiter,
    upload.single('file'),
    async (req, res) => {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        // 🛡️ TIER 2: Security scan uploaded file
        const scanResult = scanFile(req.file.path, { 
            validatePayrollHeaders: true,
            maxRows: 10000 
        });
        
        if (!scanResult.safe) {
            logger.warn('Malicious file detected', {
                userId: req.user.userId,
                file: req.file.originalname,
                errors: scanResult.errors
            });
            
            // Quarantine the file
            try {
                quarantineFile(req.file.path);
            } catch (e) {
                fs.unlinkSync(req.file.path);
            }
            
            await auditLog('MALICIOUS_FILE_BLOCKED', {
                userId: req.user.userId,
                userEmail: req.user.email,
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                resourceType: 'file',
                metadata: { 
                    filename: req.file.originalname,
                    issues: scanResult.errors
                }
            });
            
            return res.status(400).json({ 
                error: 'File failed security scan',
                issues: scanResult.errors
            });
        }
        
        logger.info('File security scan passed', {
            filename: req.file.originalname,
            sha256: scanResult.metadata.sha256
        });

        const results = [];
        const errors = [];
        let rowNumber = 0;

        fs.createReadStream(req.file.path)
            .pipe(csv())
            .on('data', (data) => {
                rowNumber++;
                
                // Sanitize all values (CSV injection prevention)
                const sanitized = {};
                for (const [key, value] of Object.entries(data)) {
                    let sanitizedValue = sanitizeCSVCell(value);
                    // Trim whitespace from all values
                    if (typeof sanitizedValue === 'string') {
                        sanitizedValue = sanitizedValue.trim();
                    }
                    sanitized[key] = sanitizedValue;
                }

                // Validate required fields
                if (!sanitized.Name || !sanitized.Salary || !sanitized.AleoAddress) {
                    errors.push({ row: rowNumber, error: 'Missing required fields (Name, Salary, AleoAddress)' });
                    return;
                }

                // Validate Aleo address (after trimming)
                if (!isValidAleoAddress(sanitized.AleoAddress)) {
                    errors.push({ row: rowNumber, error: `Invalid Aleo address: ${sanitized.AleoAddress} (length: ${sanitized.AleoAddress.length}, expected 63)` });
                    return;
                }

                // Validate salary
                const salary = parseInt(sanitized.Salary);
                if (isNaN(salary) || salary <= 0 || salary > 100000000000) { // Max 100k USDCx in base units
                    errors.push({ row: rowNumber, error: `Invalid salary amount: ${sanitized.Salary}` });
                    return;
                }

                results.push({
                    name: sanitized.Name.substring(0, 255),
                    email: sanitized.Email?.substring(0, 255) || null,
                    salary: salary,
                    aleo_address: sanitized.AleoAddress
                });
            })
            .on('end', async () => {
                // Delete uploaded file
                fs.unlink(req.file.path, (err) => {
                    if (err) logger.warn('Failed to delete upload', { file: req.file.path });
                });

                if (results.length === 0) {
                    return res.status(400).json({ 
                        error: 'No valid employees in file',
                        validationErrors: errors
                    });
                }

                try {
                    const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
                    const companyId = user?.company_id || 'default';

                    // Use transaction for atomic import
                    await db.transaction(async (client) => {
                        // 🔐 FIXED: Use upsert instead of deleting all employees
                        // Match on company_id + name (or email if present) to update existing
                        for (const emp of results) {
                            const existing = await client.getOne(
                                'SELECT id FROM employees WHERE company_id = ? AND (email = ? OR (email IS NULL AND name = ?))',
                                [companyId, emp.email, emp.name]
                            );
                            if (existing) {
                                await client.run(
                                    'UPDATE employees SET name = ?, email = ?, salary = ?, aleo_address = ?, updated_at = NOW() WHERE id = ?',
                                    [emp.name, emp.email, emp.salary, emp.aleo_address, existing.id]
                                );
                            } else {
                                await client.run(
                                    'INSERT INTO employees (uuid, company_id, name, email, salary, aleo_address) VALUES (?, ?, ?, ?, ?, ?)',
                                    [crypto.randomUUID(), companyId, emp.name, emp.email, emp.salary, emp.aleo_address]
                                );
                            }
                        }
                    });
                    
                    await auditLog('EMPLOYEES_UPLOADED', {
                        userId: req.user.userId,
                        userEmail: req.user.email,
                        ip: req.ip,
                        userAgent: req.get('User-Agent'),
                        resourceType: 'employees',
                        metadata: { count: results.length, errors: errors.length }
                    });

                    res.json({
                        success: true,
                        imported: results.length,
                        errors: errors.length > 0 ? errors : undefined,
                        message: `Successfully imported ${results.length} employees`
                    });

                } catch (err) {
                    logger.error('Database error during import', { error: err.message });
                    res.status(500).json({ error: 'Failed to import employees' });
                }
            })
            .on('error', (err) => {
                logger.error('CSV parsing error', { error: err.message });
                fs.unlink(req.file.path, () => {});
                res.status(400).json({ error: 'Failed to parse CSV file' });
            });
    }
);

// List employees
app.get('/api/employees',
    authenticateToken,
    requireRole(['admin', 'employer']),
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT company_id, role FROM users WHERE id = ?', [req.user.userId]);
            
            let employees;
            if (user.role === 'admin') {
                // 🔐 FIXED: Admin still scoped to their own company to prevent cross-tenant data leak
                employees = await db.getAll('SELECT uuid, name, email, salary, aleo_address, status FROM employees WHERE company_id = ? AND status = ?', [user.company_id, 'active']);
            } else {
                employees = await db.getAll('SELECT uuid, name, email, salary, aleo_address, status FROM employees WHERE company_id = ? AND status = ?', [user.company_id, 'active']);
            }

            res.json(employees);

        } catch (error) {
            logger.error('Error fetching employees', { error: error.message });
            res.status(500).json({ error: 'Failed to fetch employees' });
        }
    }
);

// Add single employee
app.post('/api/employees',
    authenticateToken,
    requireRole(['admin', 'employer']),
    [
        body('name')
            .trim()
            .escape()
            .customSanitizer(value => value.replace(/[\x00-\x1F\x7F]/g, '')) // Strip null bytes and control chars
            .isLength({ min: 1, max: 255 })
            .withMessage('Name required (max 255 chars)'),
        body('email').optional().isEmail().normalizeEmail(),
        body('salary').isInt({ min: 10000000, max: 100000000000 }).withMessage('Salary must be between 10 and 100,000 USDCx'),
        body('aleo_address').custom(value => {
            if (!isValidAleoAddress(value)) {
                throw new Error('Invalid Aleo address format');
            }
            return true;
        })
    ],
    validate,
    async (req, res) => {
        try {
            const { name, email, salary, aleo_address } = req.body;
            const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
            const companyId = user?.company_id || 'default';
            const uuid = crypto.randomUUID();

            await db.run(`
                INSERT INTO employees (uuid, company_id, name, email, salary, aleo_address)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [uuid, companyId, name, email || null, salary, aleo_address]);

            await auditLog('EMPLOYEE_ADDED', {
                userId: req.user.userId,
                userEmail: req.user.email,
                ip: req.ip,
                resourceType: 'employee',
                resourceId: uuid,
                metadata: { name, salary: salary }
            });

            res.status(201).json({
                success: true,
                employee: { uuid, name, email, salary, aleo_address, status: 'active' }
            });

        } catch (error) {
            logger.error('Error adding employee', { error: error.message });
            res.status(500).json({ error: 'Failed to add employee' });
        }
    }
);

// Delete employee (soft delete) — 🔒 FIXED: Added company_id check to prevent cross-company IDOR
app.delete('/api/employees/:uuid',
    authenticateToken,
    requireRole(['admin', 'employer']),
    [param('uuid').isUUID()],
    validate,
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
            const result = await db.run("UPDATE employees SET status = 'terminated', updated_at = datetime('now') WHERE uuid = ? AND company_id = ?",
                [req.params.uuid, user.company_id]);

            if (result.rowCount === 0) {
                return res.status(404).json({ error: 'Employee not found' });
            }

            await auditLog('EMPLOYEE_DELETED', {
                userId: req.user.userId,
                userEmail: req.user.email,
                ip: req.ip,
                resourceType: 'employee',
                resourceId: req.params.uuid
            });

            res.json({ success: true, message: 'Employee removed' });

        } catch (error) {
            logger.error('Error deleting employee', { error: error.message });
            res.status(500).json({ error: 'Failed to remove employee' });
        }
    }
);

// ====================================
// ROUTES: PAYROLL
// ====================================

// Payment limits (USDCx with 6 decimals)
const PAYMENT_LIMITS = {
    MIN_PAYMENT: 1,                      // 1 microcredit
    MAX_PAYMENT: 100000000000,           // 100,000 USDCx per employee
    DAILY_EMPLOYER_LIMIT: 1000000000000, // 1,000,000 USDCx
    MONTHLY_EMPLOYEE_LIMIT: 50000000000, // 50,000 USDCx
    HIGH_VALUE_THRESHOLD: 50000000000    // 50,000 USDCx - requires double confirmation
};

// High-value payment confirmation tokens (in-memory, short-lived)
const highValueConfirmations = new Map();
const HIGH_VALUE_CONFIRMATION_EXPIRY = 5 * 60 * 1000; // 5 minutes

// 🔒 Race condition protection - track active payroll preparations
const activePayrollLocks = new Map();
const PAYROLL_LOCK_TIMEOUT = 30000; // 30 seconds

// Clean up expired confirmations and locks periodically
setInterval(() => {
    const now = Date.now();
    for (const [key, data] of highValueConfirmations.entries()) {
        if (now > data.expiresAt) {
            highValueConfirmations.delete(key);
        }
    }
    // Clean up stale locks
    for (const [key, timestamp] of activePayrollLocks.entries()) {
        if (now - timestamp > PAYROLL_LOCK_TIMEOUT) {
            activePayrollLocks.delete(key);
        }
    }
}, 60000); // Every minute

// Prepare payroll
app.post('/api/payroll/prepare',
    authenticateToken,
    requireRole(['admin', 'employer']),
    payrollLimiter,
    requireCredits, // 💳 Check credits before allowing payroll
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT company_id, role FROM users WHERE id = ?', [req.user.userId]);
            const lockKey = `${user.company_id}_${req.user.userId}`;
            
            // 🔒 RACE CONDITION PROTECTION: Check for existing pending payrolls
            const existingPending = await db.getOne(`
                SELECT uuid, date, status FROM payroll_runs 
                WHERE company_id = ? AND user_id = ? AND status IN ('pending', 'awaiting_confirmation')
                AND date > datetime('now', '-1 hour')
                ORDER BY date DESC LIMIT 1
            `, [user.company_id, req.user.userId]);
            
            if (existingPending) {
                await auditLog('PAYROLL_DUPLICATE_BLOCKED', {
                    userId: req.user.userId,
                    userEmail: req.user.email,
                    ip: req.ip,
                    metadata: { 
                        existingPayrollId: existingPending.uuid,
                        existingStatus: existingPending.status
                    },
                    requestId: req.requestId
                });
                return res.status(409).json({ 
                    error: 'You already have a pending payroll. Complete or cancel it before creating a new one.',
                    existing_payroll_id: existingPending.uuid,
                    existing_status: existingPending.status
                });
            }
            
            // 🔒 RACE CONDITION PROTECTION: Acquire lock
            if (activePayrollLocks.has(lockKey)) {
                return res.status(429).json({ 
                    error: 'Payroll preparation in progress. Please wait.',
                    retry_after: 5
                });
            }
            activePayrollLocks.set(lockKey, Date.now());
            
            // Release lock on response
            res.on('finish', () => {
                activePayrollLocks.delete(lockKey);
            });
            
            let employees = [];
            
            // Priority 1: Use employees provided in request body (stateless mode from CSV)
            if (req.body.employees && Array.isArray(req.body.employees) && req.body.employees.length > 0) {
                employees = req.body.employees.map(e => ({
                     uuid: crypto.randomUUID(), // Temporary UUID for this payroll run
                     company_id: user.company_id,
                     name: e.name ? String(e.name).substring(0, 255) : 'Unknown',
                     email: e.email ? String(e.email).substring(0, 255) : null,
                     salary: parseInt(e.salary) || 0,
                     aleo_address: e.aleo_address,
                     status: 'active'
                }));
            } 
            // Priority 2: Use employees from DB
            else {
                // 🔐 FIXED: Always scope to user's company — admin role doesn't bypass tenant isolation
                employees = await db.getAll('SELECT * FROM employees WHERE company_id = ? AND status = ?', [user.company_id, 'active']);
            }

            if (employees.length === 0) {
                return res.status(400).json({ error: 'No active employees found provided or in database' });
            }

            // Validate all payments against limits
            const validatedInputs = [];
            const errors = [];
            const warnings = [];
            let totalAmount = 0;
            let highValuePayments = 0;

            for (const emp of employees) {
                // Check min/max limits
                if (emp.salary < PAYMENT_LIMITS.MIN_PAYMENT) {
                    errors.push({ employee: emp.name, error: `Salary below minimum (${PAYMENT_LIMITS.MIN_PAYMENT / 1000000} USDCx)` });
                    continue;
                }
                if (emp.salary > PAYMENT_LIMITS.MAX_PAYMENT) {
                    errors.push({ employee: emp.name, error: `Salary exceeds maximum (${PAYMENT_LIMITS.MAX_PAYMENT / 1000000} USDCx)` });
                    continue;
                }

                // Track high-value individual payments
                if (emp.salary > PAYMENT_LIMITS.HIGH_VALUE_THRESHOLD) {
                    highValuePayments++;
                    warnings.push({
                        employee: emp.name,
                        warning: `High-value payment: ${emp.salary / 1000000} USDCx requires double confirmation`
                    });
                }

                totalAmount += emp.salary;
                validatedInputs.push({
                    employee_uuid: emp.uuid,
                    employee_name: emp.name,
                    employee_address: emp.aleo_address,
                    salary: emp.salary,
                    salary_usdcx: emp.salary / 1000000,
                    fee: 1000000, // 1 Credit network fee
                    is_high_value: emp.salary > PAYMENT_LIMITS.HIGH_VALUE_THRESHOLD
                });
            }

            // Check daily limit
            if (totalAmount > PAYMENT_LIMITS.DAILY_EMPLOYER_LIMIT) {
                await auditLog('PAYROLL_LIMIT_EXCEEDED', {
                    userId: req.user.userId,
                    userEmail: req.user.email,
                    ip: req.ip,
                    metadata: { attempted: totalAmount, limit: PAYMENT_LIMITS.DAILY_EMPLOYER_LIMIT },
                    requestId: req.requestId
                });
                return res.status(400).json({ 
                    error: `Total payroll exceeds daily limit of ${PAYMENT_LIMITS.DAILY_EMPLOYER_LIMIT / 1000000} USDCx`,
                    attempted: totalAmount / 1000000,
                    limit: PAYMENT_LIMITS.DAILY_EMPLOYER_LIMIT / 1000000
                });
            }

            // Determine if double confirmation is required
            const requiresDoubleConfirmation = highValuePayments > 0 || totalAmount > PAYMENT_LIMITS.HIGH_VALUE_THRESHOLD;

            // Create payroll run record
            const payrollUuid = crypto.randomUUID();
            await db.run(`
                INSERT INTO payroll_runs (uuid, user_id, company_id, total_amount, employee_count, status, date)
                VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
            `, [
                payrollUuid, 
                req.user.userId, 
                user.company_id, 
                totalAmount, 
                validatedInputs.length,
                requiresDoubleConfirmation ? 'awaiting_confirmation' : 'pending'
            ]);

            // 💳 CHARGE CREDITS FOR PAYROLL
            let creditCharge = null;
            try {
                creditCharge = await chargeCredits(req.creditInfo.company.uuid, validatedInputs.length, payrollUuid);
                logger.info('Credits charged for payroll', { 
                    payrollId: payrollUuid, 
                    charged: creditCharge.charged,
                    newBalance: creditCharge.newBalance,
                    requestId: req.requestId
                });
            } catch (creditError) {
                // Rollback payroll if credit charge fails
                await db.run('DELETE FROM payroll_runs WHERE uuid = ?', [payrollUuid]);
                logger.error('Failed to charge credits', { error: creditError.message, payrollId: payrollUuid });
                return res.status(402).json({ 
                    error: 'Failed to charge credits for payroll',
                    details: creditError.message
                });
            }

            // If high-value, generate confirmation token
            let confirmationToken = null;
            if (requiresDoubleConfirmation) {
                confirmationToken = crypto.randomBytes(32).toString('hex');
                highValueConfirmations.set(confirmationToken, {
                    payrollId: payrollUuid,
                    userId: req.user.userId,
                    totalAmount: totalAmount,
                    employeeCount: validatedInputs.length,
                    expiresAt: Date.now() + HIGH_VALUE_CONFIRMATION_EXPIRY,
                    confirmed: false
                });
            }

            await auditLog('PAYROLL_PREPARED', {
                userId: req.user.userId,
                userEmail: req.user.email,
                ip: req.ip,
                resourceType: 'payroll',
                resourceId: payrollUuid,
                metadata: { 
                    employeeCount: validatedInputs.length,
                    totalAmount: totalAmount,
                    totalUSDCx: totalAmount / 1000000,
                    highValuePayments,
                    requiresDoubleConfirmation,
                    creditsCharged: creditCharge?.charged,
                    creditBalance: creditCharge?.newBalance
                },
                requestId: req.requestId
            });

            res.json({
                success: true,
                payroll_id: payrollUuid,
                requires_double_confirmation: requiresDoubleConfirmation,
                confirmation_token: confirmationToken,
                confirmation_expires_in: requiresDoubleConfirmation ? HIGH_VALUE_CONFIRMATION_EXPIRY / 1000 : null,
                data: {
                    programId: "payroll_v1.aleo",
                    functionName: "pay_employee",
                    inputs: validatedInputs,
                    summary: {
                        employee_count: validatedInputs.length,
                        total_amount: totalAmount,
                        total_usdcx: totalAmount / 1000000,
                        estimated_fees: validatedInputs.length * 1000000,
                        high_value_payments: highValuePayments
                    }
                },
                // 💳 Credit billing info (CZK)
                billing: {
                    currency: 'CZK',
                    overage_charged_czk: creditCharge?.charged,
                    included_used: creditCharge?.costInfo?.includedUsed,
                    overage_employees: creditCharge?.costInfo?.overageEmployees,
                    overage_rate_czk: creditCharge?.costInfo?.overageRateCZK,
                    remaining_balance_czk: creditCharge?.newBalance,
                    transaction_id: creditCharge?.transactionUuid,
                    // Legacy compatibility
                    credits_charged: creditCharge?.charged,
                    remaining_balance: creditCharge?.newBalance
                },
                warnings: warnings.length > 0 ? warnings : undefined,
                errors: errors.length > 0 ? errors : undefined,
                message: requiresDoubleConfirmation 
                    ? `⚠️ VYSOKÁ HODNOTA: ${totalAmount / 1000000} ALEO vyžaduje dvojité potvrzení`
                    : `Payroll připraven pro ${validatedInputs.length} zaměstnanců. Celkem: ${totalAmount / 1000000} ALEO. Poplatek: ${creditCharge?.charged} Kč`
            });

        } catch (error) {
            logger.error('Error preparing payroll', { error: error.message, requestId: req.requestId });
            res.status(500).json({ error: 'Failed to prepare payroll' });
        }
    }
);

// Double confirmation endpoint for high-value payrolls
app.post('/api/payroll/confirm-high-value',
    authenticateToken,
    requireRole(['admin', 'employer']),
    [
        body('payroll_id').isUUID(),
        body('confirmation_token').isLength({ min: 64, max: 64 }),
        body('acknowledge_amount').isBoolean()
    ],
    validate,
    async (req, res) => {
        try {
            const { payroll_id, confirmation_token, acknowledge_amount } = req.body;

            // Verify confirmation token exists and is valid
            const confirmation = highValueConfirmations.get(confirmation_token);
            if (!confirmation) {
                await auditLog('HIGH_VALUE_INVALID_TOKEN', {
                    userId: req.user.userId,
                    userEmail: req.user.email,
                    ip: req.ip,
                    metadata: { payroll_id },
                    requestId: req.requestId
                });
                return res.status(400).json({ error: 'Invalid or expired confirmation token' });
            }

            // Verify token matches payroll
            if (confirmation.payrollId !== payroll_id) {
                await auditLog('HIGH_VALUE_PAYROLL_MISMATCH', {
                    userId: req.user.userId,
                    userEmail: req.user.email,
                    ip: req.ip,
                    metadata: { expected: confirmation.payrollId, provided: payroll_id },
                    requestId: req.requestId
                });
                return res.status(400).json({ error: 'Confirmation token does not match payroll' });
            }

            // Verify same user
            if (confirmation.userId !== req.user.userId) {
                await auditLog('HIGH_VALUE_USER_MISMATCH', {
                    userId: req.user.userId,
                    userEmail: req.user.email,
                    ip: req.ip,
                    metadata: { originalUser: confirmation.userId },
                    requestId: req.requestId
                });
                return res.status(403).json({ error: 'Confirmation must be done by the same user who prepared the payroll' });
            }

            // Verify token not expired
            if (Date.now() > confirmation.expiresAt) {
                highValueConfirmations.delete(confirmation_token);
                await auditLog('HIGH_VALUE_TOKEN_EXPIRED', {
                    userId: req.user.userId,
                    userEmail: req.user.email,
                    ip: req.ip,
                    metadata: { payroll_id },
                    requestId: req.requestId
                });
                return res.status(400).json({ error: 'Confirmation token has expired. Please prepare payroll again.' });
            }

            // Verify user acknowledged the amount
            if (!acknowledge_amount) {
                return res.status(400).json({ 
                    error: 'You must acknowledge the payment amount',
                    amount_to_acknowledge: confirmation.totalAmount / 1000000,
                    currency: 'USDCx'
                });
            }

            // Mark as confirmed
            confirmation.confirmed = true;
            
            // Update payroll status
            await db.run('UPDATE payroll_runs SET status = ? WHERE uuid = ?',
                ['pending', payroll_id]);

            await auditLog('HIGH_VALUE_CONFIRMED', {
                userId: req.user.userId,
                userEmail: req.user.email,
                ip: req.ip,
                resourceType: 'payroll',
                resourceId: payroll_id,
                metadata: { 
                    totalAmount: confirmation.totalAmount,
                    totalUSDCx: confirmation.totalAmount / 1000000,
                    employeeCount: confirmation.employeeCount
                },
                requestId: req.requestId
            });

            res.json({
                success: true,
                payroll_id: payroll_id,
                message: `High-value payroll confirmed. You may now proceed with execution.`,
                confirmed_amount: confirmation.totalAmount / 1000000,
                currency: 'USDCx'
            });

        } catch (error) {
            logger.error('Error confirming high-value payroll', { error: error.message, requestId: req.requestId });
            res.status(500).json({ error: 'Failed to confirm payroll' });
        }
    }
);

// Confirm payroll completion
app.post('/api/payroll/confirm',
    authenticateToken,
    requireRole(['admin', 'employer']),
    [
        body('payroll_id').isUUID(),
        body('tx_id').isLength({ min: 10, max: 255 }).trim()
    ],
    validate,
    async (req, res) => {
        try {
            const { payroll_id, tx_id } = req.body;

            // First check if payroll exists and its status
            const payroll = await db.getOne('SELECT status, total_amount, user_id FROM payroll_runs WHERE uuid = ?', [payroll_id]);
            
            if (!payroll) {
                return res.status(404).json({ error: 'Payroll not found' });
            }

            // Check if this is a high-value payroll that hasn't been confirmed
            if (payroll.status === 'awaiting_confirmation') {
                await auditLog('PAYROLL_CONFIRM_BLOCKED', {
                    userId: req.user.userId,
                    userEmail: req.user.email,
                    ip: req.ip,
                    resourceType: 'payroll',
                    resourceId: payroll_id,
                    metadata: { 
                        reason: 'High-value payroll requires double confirmation',
                        totalAmount: payroll.total_amount
                    },
                    requestId: req.requestId
                });
                return res.status(400).json({ 
                    error: 'This high-value payroll requires double confirmation before execution',
                    action_required: 'Call POST /api/payroll/confirm-high-value first',
                    total_amount: payroll.total_amount / 1000000,
                    currency: 'USDCx'
                });
            }

            if (payroll.status !== 'pending') {
                return res.status(400).json({ 
                    error: `Payroll cannot be confirmed - current status: ${payroll.status}` 
                });
            }

            // Verify same user (or admin)
            const currentUser = await db.getOne('SELECT role FROM users WHERE id = ?', [req.user.userId]);
            if (payroll.user_id !== req.user.userId && currentUser.role !== 'admin') {
                await auditLog('PAYROLL_CONFIRM_UNAUTHORIZED', {
                    userId: req.user.userId,
                    userEmail: req.user.email,
                    ip: req.ip,
                    resourceType: 'payroll',
                    resourceId: payroll_id,
                    metadata: { originalUser: payroll.user_id },
                    requestId: req.requestId
                });
                return res.status(403).json({ error: 'Only the user who prepared this payroll can confirm it' });
            }

            const result = await db.run(`
                UPDATE payroll_runs 
                SET status = 'completed', tx_id = ?, completed_at = datetime('now')
                WHERE uuid = ? AND status = 'pending'
            `, [tx_id, payroll_id]);

            if (result.rowCount === 0) {
                return res.status(404).json({ error: 'Payroll not found or already processed' });
            }

            await auditLog('PAYROLL_COMPLETED', {
                userId: req.user.userId,
                userEmail: req.user.email,
                ip: req.ip,
                resourceType: 'payroll',
                resourceId: payroll_id,
                metadata: { tx_id, totalAmount: payroll.total_amount },
                requestId: req.requestId
            });

            logger.info(`✅ Payroll confirmed! TX: ${tx_id}`);
            res.json({ 
                success: true, 
                tx_id,
                total_amount: payroll.total_amount / 1000000,
                currency: 'USDCx'
            });

        } catch (error) {
            logger.error('Error confirming payroll', { error: error.message, requestId: req.requestId });
            res.status(500).json({ error: 'Failed to confirm payroll' });
        }
    }
);

// Cancel pending payroll
app.post('/api/payroll/cancel',
    authenticateToken,
    requireRole(['admin', 'employer']),
    [
        body('payroll_id').isUUID()
    ],
    validate,
    async (req, res) => {
        try {
            const { payroll_id } = req.body;
            
            // Check payroll exists and belongs to user
            const payroll = await db.getOne(`
                SELECT * FROM payroll_runs WHERE uuid = ?
            `, [payroll_id]);
            
            if (!payroll) {
                return res.status(404).json({ error: 'Payroll not found' });
            }
            
            // Only owner or admin can cancel
            const currentUser = await db.getOne('SELECT role FROM users WHERE id = ?', [req.user.userId]);
            if (payroll.user_id !== req.user.userId && currentUser.role !== 'admin') {
                return res.status(403).json({ error: 'Only the creator can cancel this payroll' });
            }
            
            // Only pending/awaiting_confirmation can be cancelled
            if (!['pending', 'awaiting_confirmation'].includes(payroll.status)) {
                return res.status(400).json({ 
                    error: `Cannot cancel payroll with status: ${payroll.status}` 
                });
            }
            
            // 💳 REFUND CREDITS before cancelling
            let refundResult = null;
            try {
                refundResult = await refundCredits(payroll_id);
                if (refundResult) {
                    logger.info('Credits refunded for cancelled payroll', { 
                        payrollId: payroll_id, 
                        refunded: refundResult.refunded,
                        newBalance: refundResult.newBalance
                    });
                }
            } catch (refundError) {
                logger.error('Failed to refund credits', { error: refundError.message, payrollId: payroll_id });
                // Continue with cancellation even if refund fails
            }
            
            // Cancel it
            await db.run('UPDATE payroll_runs SET status = ? WHERE uuid = ?',
                ['cancelled', payroll_id]);
            
            await auditLog('PAYROLL_CANCELLED', {
                userId: req.user.userId,
                userEmail: req.user.email,
                ip: req.ip,
                resourceType: 'payroll',
                resourceId: payroll_id,
                metadata: { 
                    previousStatus: payroll.status,
                    creditsRefunded: refundResult?.refunded
                },
                requestId: req.requestId
            });
            
            res.json({ 
                success: true, 
                message: 'Payroll cancelled successfully',
                payroll_id,
                credits_refunded: refundResult?.refunded || 0,
                new_balance: refundResult?.newBalance
            });
            
        } catch (error) {
            logger.error('Error cancelling payroll', { error: error.message, requestId: req.requestId });
            res.status(500).json({ error: 'Failed to cancel payroll' });
        }
    }
);

// Get payroll history
app.get('/api/payroll/history',
    authenticateToken,
    requireRole(['admin', 'employer']),
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT company_id, role FROM users WHERE id = ?', [req.user.userId]);
            
            let history;
            // 🔐 FIXED: Always scope to user's company — admin role doesn't bypass tenant isolation
            history = await db.getAll(`
                SELECT uuid, total_amount, employee_count, status, tx_id, created_at, completed_at
                FROM payroll_runs WHERE company_id = ? ORDER BY created_at DESC LIMIT 100
            `, [user.company_id]);

            res.json(history);

        } catch (error) {
            logger.error('Error fetching payroll history', { error: error.message });
            res.status(500).json({ error: 'Failed to fetch history' });
        }
    }
);

// ====================================
// ROUTES: GDPR COMPLIANCE
// ====================================

// Export user data (GDPR: Right to data portability)
app.get('/api/user/export',
    authenticateToken,
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT uuid, email, role, company_id, created_at FROM users WHERE id = ?', [req.user.userId]);
            const auditLogs = await db.getAll('SELECT action, resource_type, timestamp FROM audit_log WHERE user_id = ? ORDER BY timestamp DESC LIMIT 1000', [req.user.userId]);
            const payrollRuns = await db.getAll('SELECT * FROM payroll_runs WHERE user_id = ?', [req.user.userId]);

            await auditLog('DATA_EXPORTED', {
                userId: req.user.userId,
                userEmail: req.user.email,
                ip: req.ip
            });

            res.json({
                user,
                audit_logs: auditLogs,
                payroll_runs: payrollRuns,
                exported_at: new Date().toISOString()
            });

        } catch (error) {
            logger.error('Error exporting user data', { error: error.message });
            res.status(500).json({ error: 'Failed to export data' });
        }
    }
);

// Delete user data (GDPR: Right to deletion)
app.delete('/api/user/gdpr-delete',
    authenticateToken,
    [body('password').notEmpty(), body('confirm').equals('DELETE_MY_DATA')],
    validate,
    async (req, res) => {
        try {
            const user = await db.getOne('SELECT * FROM users WHERE id = ?', [req.user.userId]);

            // Verify password (🔐 FIXED: must use pepper, same as login)
            const pepperedPassword = req.body.password + PASSWORD_PEPPER;
            const validPassword = await bcrypt.compare(pepperedPassword, user.password_hash);
            if (!validPassword) {
                return res.status(401).json({ error: 'Invalid password' });
            }

            // Anonymize user data (keep audit trail but remove PII)
            await db.run(`
                UPDATE users SET 
                    email = 'deleted_' || uuid,
                    password_hash = 'DELETED',
                    totp_secret = NULL,
                    is_active = 0
                WHERE id = ?
            `, [req.user.userId]);

            // 🔐 FIXED: Also anonymize employee data linked to this user
            await db.run(`
                UPDATE employees SET 
                    name = 'ANONYMIZED',
                    email = NULL,
                    personal_id = NULL,
                    bank_account = NULL,
                    phone = NULL,
                    address = NULL,
                    status = 'terminated'
                WHERE company_id IN (SELECT company_id FROM users WHERE id = ?)
                AND id IN (SELECT employee_id FROM users WHERE id = ? AND employee_id IS NOT NULL)
            `, [req.user.userId, req.user.userId]);

            // Anonymize audit logs
            await db.run("UPDATE audit_log SET user_email = 'ANONYMIZED', ip_address = 'ANONYMIZED' WHERE user_id = ?",
                [req.user.userId]);

            // Revoke all tokens
            await db.run("UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE user_id = ?",
                [req.user.userId]);

            await auditLog('GDPR_DELETE_COMPLETED', {
                userId: req.user.userId,
                ip: req.ip,
                metadata: { anonymized: true }
            });

            res.clearCookie('accessToken');
            res.clearCookie('refreshToken');
            res.json({ success: true, message: 'Your data has been deleted' });

        } catch (error) {
            logger.error('Error deleting user data', { error: error.message });
            res.status(500).json({ error: 'Failed to delete data' });
        }
    }
);

// ====================================
// ROUTES: HEALTH & MONITORING
// ====================================

// Security.txt for responsible disclosure (RFC 9116)
app.get('/.well-known/security.txt', (req, res) => {
    res.type('text/plain').send(`# Security Policy for Unhackable Payroll
Contact: security@payroll.local
Expires: 2027-12-31T23:59:00.000Z
Encryption: https://payroll.local/.well-known/pgp-key.txt
Preferred-Languages: en, cs
Canonical: https://payroll.local/.well-known/security.txt
Policy: https://payroll.local/security-policy

# We take security seriously. Please report any vulnerabilities responsibly.
`);
});

// ====================================
// AUDIT LOG ENDPOINT
// ====================================
app.get('/api/audit-log',
    authenticateToken,
    requireRole(['admin', 'employer']),
    async (req, res) => {
        try {
            const page = Math.max(1, parseInt(req.query.page) || 1);
            const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
            const offset = (page - 1) * limit;
            const search = req.query.search?.trim() || '';
            const action = req.query.action?.trim() || '';

            let where = 'WHERE 1=1';
            const params = [];
            let paramIdx = 1;

            // Non-admin users can only see their own company's logs
            if (req.user.role !== 'admin') {
                where += ` AND user_id = ?`;
                params.push(req.user.userId);
            }

            if (search) {
                // 🔐 FIXED: Escape LIKE wildcards to prevent wildcard injection
                const escapedSearch = search.replace(/%/g, '\\%').replace(/_/g, '\\_');
                where += ` AND (user_email ILIKE ? OR action ILIKE ? OR resource_type ILIKE ? OR ip_address ILIKE ?)`;
                const like = `%${escapedSearch}%`;
                params.push(like, like, like, like);
            }

            if (action) {
                where += ` AND action = ?`;
                params.push(action);
            }

            const countResult = await db.getOne(
                `SELECT COUNT(*) as total FROM audit_log ${where}`,
                params
            );

            const entries = await db.getAll(
                `SELECT id, user_email, action, resource_type, resource_id, ip_address, timestamp as created_at, metadata
                 FROM audit_log ${where}
                 ORDER BY timestamp DESC
                 LIMIT ? OFFSET ?`,
                [...params, limit, offset]
            );

            // Parse metadata JSON safely
            const parsed = entries.map(e => ({
                ...e,
                metadata: (() => { try { return JSON.parse(e.metadata || '{}'); } catch { return {}; } })()
            }));

            res.json({
                entries: parsed,
                total: parseInt(countResult?.total || '0'),
                page,
                limit
            });
        } catch (error) {
            logger.error('Audit log fetch error', { error: error.message });
            res.status(500).json({ error: 'Failed to fetch audit log' });
        }
    }
);

// Health check (public)
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '2.0.0',
        requestId: req.requestId
    });
});

// Security status — removed internal details, admin-only minimal info
app.get('/api/security-status', authenticateToken, requireRole(['admin']), (req, res) => {
    res.json({
        status: 'operational',
        timestamp: new Date().toISOString()
    });
});

// Protected stats (admin only)
app.get('/api/stats',
    authenticateToken,
    requireRole(['admin']),
    async (req, res) => {
        try {
            const userCount = await db.getOne('SELECT COUNT(*) as count FROM users WHERE is_active = 1');
            const employeeCount = await db.getOne("SELECT COUNT(*) as count FROM employees WHERE status = 'active'");
            const payrollCount = await db.getOne('SELECT COUNT(*) as count FROM payroll_runs');
            const recentFailedLogins = await db.getOne(`
                SELECT COUNT(*) as count FROM audit_log 
                WHERE action = 'LOGIN_FAILED' AND timestamp > datetime('now', '-24 hours')
            `);

            res.json({
                users: userCount.count,
                employees: employeeCount.count,
                payroll_runs: payrollCount.count,
                failed_logins_24h: recentFailedLogins.count
            });

        } catch (error) {
            logger.error('Error fetching stats', { error: error.message });
            res.status(500).json({ error: 'Failed to fetch stats' });
        }
    }
);

// ====================================
// ROOT & INFO ENDPOINTS
// ====================================

// Root endpoint — Minimal info (no endpoint enumeration)
// 🔐 FIXED: Removed full endpoint listing that aids attackers
app.get('/', (req, res) => {
    res.json({
        name: '🔒 Unhackable Payroll API',
        version: '2.0.0',
        status: 'running',
        documentation: 'See API docs for endpoint reference'
    });
});

// ====================================
// ERROR HANDLING
// ====================================

// 404 handler
app.use((req, res) => {
    logger.warn('404 Not Found', { path: req.path, method: req.method, ip: anonymizeIP(req.ip) });
    res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler (NEVER leak stack traces!)
app.use((err, req, res, next) => {
    // Log full error internally (for debugging)
    logger.error('Unhandled error', { 
        error: err.message, 
        stack: err.stack,
        path: req.path,
        method: req.method,
        requestId: req.requestId
    });

    // 🔒 NEVER expose stack traces or internal details to clients
    // Even in development - this prevents accidental leaks
    const statusCode = err.status || err.statusCode || 500;
    
    // Generic error messages only
    const safeMessages = {
        400: 'Bad request',
        401: 'Authentication required',
        403: 'Access denied',
        404: 'Not found',
        413: 'Request too large',
        429: 'Too many requests',
        500: 'Internal server error'
    };
    
    res.status(statusCode).json({ 
        error: safeMessages[statusCode] || 'An error occurred',
        requestId: req.requestId
    });
});

// ====================================
// START SERVER
// ====================================
async function startServer() {
    try {
        // Initialize all database tables
        await initDatabase();
        await initSecurityTables();
        await initSessionsTable();

        // Initialize advanced features
        const { initScheduler } = require('./routes/scheduler');
        const { initSlaMonitoring } = require('./routes/sla');
        await initScheduler();
        initSlaMonitoring();
        
        // Migrate: add 'business' to the tier CHECK constraint on companies table
        try {
            await db.exec(`
                ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_tier_check;
                ALTER TABLE companies ADD CONSTRAINT companies_tier_check CHECK(tier IN ('starter', 'pro', 'business', 'enterprise', 'enterprise_plus'));
            `);
            logger.info('Tier constraint migrated to include business tier');
        } catch (migErr) {
            // Constraint may already have the right shape, or table may be fresh
            logger.debug('Tier migration note (non-fatal):', migErr.message);
        }
        
        logger.info('Database tables initialized successfully');
        
        app.listen(PORT, () => {
            logger.info(`🔒 Unhackable Payroll Server started on port ${PORT}`);
            logger.info(`📂 Environment: ${NODE_ENV}`);
            logger.info(`🌐 Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
            console.log(`
╔════════════════════════════════════════════════════════════╗
║  🔒 UNHACKABLE PAYROLL BACKEND v2.0.0                      ║
║  ─────────────────────────────────────────────────────────  ║
║  Port: ${PORT}                                              ║
║  Environment: ${NODE_ENV}                                   ║
║  Database: PostgreSQL                                      ║
║  Security: HARDENED                                        ║
║  ─────────────────────────────────────────────────────────  ║
║  NEW Security Features:                                    ║
║  ✓ Token blacklisting (logout invalidation)               ║
║  ✓ 2FA rate limiting (brute force protection)             ║
║  ✓ Request ID tracing                                      ║
║  ✓ Sensitive data masking                                  ║
║  ✓ Error sanitization                                      ║
║  ─────────────────────────────────────────────────────────  ║
║  Endpoints:                                                ║
║  POST /api/auth/register     - Register new user           ║
║  POST /api/auth/login        - Login                       ║
║  POST /api/auth/refresh      - Refresh access token        ║
║  POST /api/auth/logout       - Logout                      ║
║  POST /api/auth/2fa/setup    - Setup 2FA                   ║
║  POST /api/auth/2fa/verify   - Enable 2FA                  ║
║  GET  /api/employees         - List employees              ║
║  POST /api/employees         - Add employee                ║
║  POST /api/employees/upload  - Upload CSV                  ║
║  POST /api/payroll/prepare   - Prepare payroll             ║
║  POST /api/payroll/confirm-high-value - Double confirm     ║
║  POST /api/payroll/confirm   - Confirm payroll             ║
║  GET  /api/payroll/history   - Payroll history             ║
║  GET  /api/health            - Health check                ║
╚════════════════════════════════════════════════════════════╝
            `);
        });
    } catch (error) {
        logger.error('Failed to start server', { error: error.message, stack: error.stack });
        console.error('Failed to start server:', error.message);
        process.exit(1);
    }
}

startServer();

// Graceful shutdown
process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down gracefully');
    await db.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    logger.info('SIGINT received, shutting down gracefully');
    await db.close();
    process.exit(0);
});
