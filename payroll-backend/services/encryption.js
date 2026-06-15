// ====================================
// 🔐 Per-Company Encryption Service
// ====================================
// Two-level encryption:
// 1. Server master key (from ENV) encrypts per-company keys
// 2. Per-company keys encrypt PII (RČ, addresses, salary data)
//
// Algorithm: AES-256-GCM (authenticated encryption)
// Key derivation: crypto.randomBytes(32) for company keys

'use strict';

const crypto = require('crypto');
const db = require('../db');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;       // GCM standard
const TAG_LENGTH = 16;      // Auth tag
const KEY_LENGTH = 32;      // 256 bits
const ENCODING = 'base64';  // Storage encoding

/**
 * Get the server master key from environment
 * @returns {Buffer} 32-byte master key
 */
function getMasterKey() {
    // 🔒 FIXED: Check all possible env var names for the master encryption key
    const key = process.env.MASTER_ENCRYPTION_KEY || process.env.ENCRYPTION_MASTER_KEY || process.env.DATABASE_ENCRYPTION_KEY;
    if (!key) {
        throw new Error('MASTER_ENCRYPTION_KEY not set in environment. Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    }
    const buf = Buffer.from(key, 'hex');
    if (buf.length !== KEY_LENGTH) {
        throw new Error(`ENCRYPTION_MASTER_KEY must be ${KEY_LENGTH * 2} hex characters (${KEY_LENGTH} bytes)`);
    }
    return buf;
}

// ====================================
// LOW-LEVEL ENCRYPT/DECRYPT
// ====================================

/**
 * Encrypt a plaintext string with AES-256-GCM
 * @param {string} plaintext - Text to encrypt
 * @param {Buffer} key - 32-byte encryption key
 * @returns {string} Encrypted string (base64): iv:ciphertext:tag
 */
function encrypt(plaintext, key) {
    if (plaintext === null || plaintext === undefined) return null;
    const text = String(plaintext);
    if (text === '') return '';

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8', ENCODING);
    encrypted += cipher.final(ENCODING);
    const tag = cipher.getAuthTag();

    // Format: iv:ciphertext:tag (all base64)
    return `${iv.toString(ENCODING)}:${encrypted}:${tag.toString(ENCODING)}`;
}

/**
 * Decrypt an encrypted string with AES-256-GCM
 * @param {string} encryptedText - Encrypted string (iv:ciphertext:tag)
 * @param {Buffer} key - 32-byte encryption key
 * @returns {string} Decrypted plaintext
 */
function decrypt(encryptedText, key) {
    if (encryptedText === null || encryptedText === undefined) return null;
    if (encryptedText === '') return '';

    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
        throw new Error('Invalid encrypted text format (expected iv:ciphertext:tag)');
    }

    const iv = Buffer.from(parts[0], ENCODING);
    const ciphertext = parts[1];
    const tag = Buffer.from(parts[2], ENCODING);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(ciphertext, ENCODING, 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}

// ====================================
// COMPANY KEY MANAGEMENT
// ====================================

/**
 * Initialize the encryption keys table
 */
async function initEncryptionTable() {
    await db.exec(`
        CREATE TABLE IF NOT EXISTS company_encryption_keys (
            id SERIAL PRIMARY KEY,
            company_id TEXT UNIQUE NOT NULL,
            key_enc TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT NOW(),
            rotated_at TIMESTAMP
        );
    `);
}

/**
 * Generate and store a new encryption key for a company
 * @param {string} companyId - Company UUID
 * @returns {Buffer} The new company key (32 bytes)
 */
async function createCompanyKey(companyId) {
    const masterKey = getMasterKey();
    const companyKey = crypto.randomBytes(KEY_LENGTH);

    // Encrypt company key with master key
    const encryptedKey = encrypt(companyKey.toString('hex'), masterKey);

    await db.run(
        `INSERT INTO company_encryption_keys (company_id, key_enc, created_at)
         VALUES (?, ?, NOW())
         ON CONFLICT (company_id) DO UPDATE SET key_enc = EXCLUDED.key_enc, rotated_at = NOW()`,
        [companyId, encryptedKey]
    );

    return companyKey;
}

/**
 * Retrieve the encryption key for a company
 * @param {string} companyId - Company UUID
 * @returns {Buffer|null} The company key (32 bytes) or null
 */
async function getCompanyKey(companyId) {
    const row = await db.getOne(
        'SELECT key_enc FROM company_encryption_keys WHERE company_id = ?',
        [companyId]
    );

    if (!row) return null;

    const masterKey = getMasterKey();
    const keyHex = decrypt(row.key_enc, masterKey);
    return Buffer.from(keyHex, 'hex');
}

/**
 * Get or create company encryption key
 * @param {string} companyId
 * @returns {Buffer} 32-byte company key
 */
async function getOrCreateCompanyKey(companyId) {
    let key = await getCompanyKey(companyId);
    if (!key) {
        key = await createCompanyKey(companyId);
    }
    return key;
}

/**
 * Rotate a company's encryption key
 * Returns both old and new keys so caller can re-encrypt data
 * @param {string} companyId
 * @returns {{oldKey: Buffer, newKey: Buffer}}
 */
async function rotateCompanyKey(companyId) {
    const oldKey = await getCompanyKey(companyId);
    if (!oldKey) {
        throw new Error(`No existing key for company ${companyId}`);
    }

    const newKey = await createCompanyKey(companyId);
    return { oldKey, newKey };
}

// ====================================
// FIELD-LEVEL ENCRYPTION HELPERS
// ====================================

/**
 * Encrypt multiple fields of an object using company key
 * @param {Object} data - Object with plaintext fields
 * @param {string[]} fields - Field names to encrypt
 * @param {Buffer} key - Company encryption key
 * @returns {Object} New object with specified fields encrypted
 */
function encryptFields(data, fields, key) {
    const result = { ...data };
    for (const field of fields) {
        if (result[field] !== undefined && result[field] !== null) {
            result[field] = encrypt(String(result[field]), key);
        }
    }
    return result;
}

/**
 * Decrypt multiple fields of an object using company key
 * @param {Object} data - Object with encrypted fields
 * @param {string[]} fields - Field names to decrypt
 * @param {Buffer} key - Company encryption key
 * @returns {Object} New object with specified fields decrypted
 */
function decryptFields(data, fields, key) {
    if (!data) return data;
    const result = { ...data };
    for (const field of fields) {
        if (result[field] !== undefined && result[field] !== null && result[field] !== '') {
            try {
                result[field] = decrypt(result[field], key);
            } catch (err) {
                // If decryption fails, field might not be encrypted (migration scenario)
                // Leave as-is and log
                console.warn(`Failed to decrypt field '${field}' for company data: ${err.message}`);
            }
        }
    }
    return result;
}

// Employee PII fields that should be encrypted
const EMPLOYEE_ENCRYPTED_FIELDS = [
    'rodne_cislo',
    'adresa',
    'bank_account',
];

// Company sensitive fields
const COMPANY_ENCRYPTED_FIELDS = [
    'bank_account_salary',
    'bank_account_tax',
    'bank_account_social',
    'bank_account_health',
];

// Payroll item fields (salary data)
const PAYROLL_ENCRYPTED_FIELDS = [
    'hruba_mzda_czk',
    'cista_mzda_czk',
    'sp_zamestnanec',
    'zp_zamestnanec',
    'dan',
];

/**
 * Encrypt employee data before storing
 */
function encryptEmployeeData(employee, key) {
    return encryptFields(employee, EMPLOYEE_ENCRYPTED_FIELDS, key);
}

/**
 * Decrypt employee data after reading
 */
function decryptEmployeeData(employee, key) {
    return decryptFields(employee, EMPLOYEE_ENCRYPTED_FIELDS, key);
}

/**
 * Encrypt company data before storing
 */
function encryptCompanyData(company, key) {
    return encryptFields(company, COMPANY_ENCRYPTED_FIELDS, key);
}

/**
 * Decrypt company data after reading
 */
function decryptCompanyData(company, key) {
    return decryptFields(company, COMPANY_ENCRYPTED_FIELDS, key);
}

// ====================================
// EXPORTS
// ====================================

module.exports = {
    // Low-level
    encrypt,
    decrypt,
    getMasterKey,

    // Company key management
    initEncryptionTable,
    createCompanyKey,
    getCompanyKey,
    getOrCreateCompanyKey,
    rotateCompanyKey,

    // Field-level helpers
    encryptFields,
    decryptFields,
    encryptEmployeeData,
    decryptEmployeeData,
    encryptCompanyData,
    decryptCompanyData,

    // Constants
    EMPLOYEE_ENCRYPTED_FIELDS,
    COMPANY_ENCRYPTED_FIELDS,
    PAYROLL_ENCRYPTED_FIELDS,
};
