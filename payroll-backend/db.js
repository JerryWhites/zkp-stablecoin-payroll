// ====================================
// 🔒 PostgreSQL Database Adapter
// ====================================
// Drop-in async replacement for better-sqlite3.
// Provides .query(), .getOne(), .getAll(), .run(), .exec()
// Auto-converts ? placeholders to $1, $2, etc.

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || (() => {
        // 🔒 SECURITY: Fail hard if no database credentials configured
        if (!process.env.DB_PASSWORD) {
            console.error('FATAL: DATABASE_URL or DB_PASSWORD must be set. No hardcoded fallback credentials.');
            process.exit(1);
        }
        return `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'payroll_db'}`;
    })(),
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    // 🔒 SECURITY: Enable TLS for database connections in production
    ...(process.env.NODE_ENV === 'production' ? {
        ssl: {
            rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false'
        }
    } : {}),
});

// Test connection on startup
pool.on('error', (err) => {
    console.error('Unexpected PostgreSQL pool error:', err.message);
});

/**
 * Convert SQLite-style SQL to PostgreSQL-style SQL.
 * - ? → $1, $2, ...
 * - datetime('now') → NOW()
 * - datetime('now', '-N unit') → NOW() - INTERVAL 'N unit'
 * - INTEGER PRIMARY KEY AUTOINCREMENT → SERIAL PRIMARY KEY
 * - INSERT OR IGNORE → INSERT ... ON CONFLICT DO NOTHING
 */
function convertSql(sql) {
    let paramIndex = 0;
    let converted = sql;

    // Replace ? with $N (only outside of single-quoted strings)
    // Simple approach: replace ? that aren't inside quotes
    const parts = [];
    let inString = false;
    let current = '';
    for (let i = 0; i < converted.length; i++) {
        const ch = converted[i];
        if (ch === "'" && (i === 0 || converted[i - 1] !== '\\')) {
            inString = !inString;
            current += ch;
        } else if (ch === '?' && !inString) {
            current += `$${++paramIndex}`;
        } else {
            current += ch;
        }
    }
    converted = current;

    // datetime('now') → NOW()
    converted = converted.replace(/datetime\s*\(\s*'now'\s*\)/gi, 'NOW()');

    // datetime('now', '-N hours/minutes/days')
    converted = converted.replace(
        /datetime\s*\(\s*'now'\s*,\s*'-(\d+)\s+(hour|hours|minute|minutes|day|days|second|seconds)'\s*\)/gi,
        (_, num, unit) => `NOW() - INTERVAL '${num} ${unit}'`
    );

    // INTEGER PRIMARY KEY AUTOINCREMENT → SERIAL PRIMARY KEY
    converted = converted.replace(
        /INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi,
        'SERIAL PRIMARY KEY'
    );

    // INSERT OR IGNORE → INSERT ... ON CONFLICT DO NOTHING
    converted = converted.replace(
        /INSERT\s+OR\s+IGNORE/gi,
        'INSERT'
    );
    // Add ON CONFLICT DO NOTHING if it was INSERT OR IGNORE
    if (sql.match(/INSERT\s+OR\s+IGNORE/i) && !converted.includes('ON CONFLICT')) {
        // Insert before the end (before any RETURNING clause or at end)
        converted = converted.replace(/(\)\s*)(;?\s*)$/, '$1 ON CONFLICT DO NOTHING$2');
        // Handle cases where there's no trailing )
        if (!converted.includes('ON CONFLICT')) {
            converted = converted.trimEnd();
            if (converted.endsWith(';')) {
                converted = converted.slice(0, -1) + ' ON CONFLICT DO NOTHING;';
            } else {
                converted += ' ON CONFLICT DO NOTHING';
            }
        }
    }

    // REAL → DOUBLE PRECISION (for column definitions only)
    // Be careful not to replace in data values
    converted = converted.replace(/\bREAL\b(?=\s+DEFAULT|\s*,|\s*\))/gi, 'DOUBLE PRECISION');

    return { sql: converted, paramCount: paramIndex };
}

/**
 * Execute a raw query with auto-conversion of SQLite syntax
 * @param {string} sql - SQL query (can use ? placeholders)
 * @param {Array} params - Query parameters
 * @returns {Promise<{rows: Array, rowCount: number}>}
 */
async function query(sql, params = []) {
    const { sql: pgSql } = convertSql(sql);
    const result = await pool.query(pgSql, params);
    return result;
}

/**
 * Get a single row
 * @param {string} sql - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Object|null>}
 */
async function getOne(sql, params = []) {
    const { sql: pgSql } = convertSql(sql);
    const result = await pool.query(pgSql, params);
    return result.rows[0] || null;
}

/**
 * Get all matching rows
 * @param {string} sql - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Array>}
 */
async function getAll(sql, params = []) {
    const { sql: pgSql } = convertSql(sql);
    const result = await pool.query(pgSql, params);
    return result.rows;
}

/**
 * Execute a statement (INSERT, UPDATE, DELETE)
 * @param {string} sql - SQL statement
 * @param {Array} params - Statement parameters
 * @returns {Promise<{rowCount: number, rows: Array}>}
 */
async function run(sql, params = []) {
    const { sql: pgSql } = convertSql(sql);
    const result = await pool.query(pgSql, params);
    return { rowCount: result.rowCount, rows: result.rows };
}

/**
 * Execute raw SQL (for schema creation, etc.)
 * Splits on semicolons and runs each statement.
 * @param {string} sql - Raw SQL to execute
 */
async function exec(sql) {
    // For multi-statement SQL, run as a single query
    // pg can handle multiple statements in one query call
    const { sql: pgSql } = convertSql(sql);
    await pool.query(pgSql);
}

/**
 * Execute a transaction
 * @param {Function} fn - async function that receives a client
 * @returns {Promise<*>} result of fn
 */
async function transaction(fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn({
            query: async (sql, params = []) => {
                const { sql: pgSql } = convertSql(sql);
                return client.query(pgSql, params);
            },
            getOne: async (sql, params = []) => {
                const { sql: pgSql } = convertSql(sql);
                const r = await client.query(pgSql, params);
                return r.rows[0] || null;
            },
            getAll: async (sql, params = []) => {
                const { sql: pgSql } = convertSql(sql);
                const r = await client.query(pgSql, params);
                return r.rows;
            },
            run: async (sql, params = []) => {
                const { sql: pgSql } = convertSql(sql);
                const r = await client.query(pgSql, params);
                return { rowCount: r.rowCount, rows: r.rows };
            }
        });
        await client.query('COMMIT');
        return result;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

/**
 * Close the pool
 */
async function close() {
    await pool.end();
}

/**
 * Get the raw pool (for advanced usage)
 */
function getPool() {
    return pool;
}

module.exports = {
    query,
    getOne,
    getAll,
    run,
    exec,
    transaction,
    close,
    getPool,
    convertSql, // exported for testing
};
