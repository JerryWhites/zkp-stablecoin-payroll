// ====================================
// 📦 Migration 006: Crypto/Stablecoin Support (USDCx on Aleo)
// ====================================
// Adds per-employee crypto preferences, split logic columns,
// and USDCx-specific fields to payroll tables.
//
// - Employees: stablecoin_pct, preferred_token, wallet_address
// - Payroll items: fiat/crypto split, USDCx amounts, CZK/USD rate
// - Payroll periods: CZK/USD rate for USDCx conversion
//
// Run: node migrations/006-crypto-stablecoin.js

'use strict';

const db = require('../db');
require('dotenv').config();

async function migrate() {
    console.log('🚀 Starting Crypto/Stablecoin Support migration...\n');

    // ====================================
    // 1. Employee crypto preferences
    // ====================================
    console.log('1️⃣  Adding crypto preferences to employees...');
    await db.exec(`
        -- Percentage of net salary to be paid in stablecoin (0-100, default 0 = all fiat)
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS stablecoin_pct INTEGER DEFAULT 0 CHECK(stablecoin_pct >= 0 AND stablecoin_pct <= 100);
        
        -- Preferred token for crypto payout (NONE = fiat only, ALEO = native credits, USDCx = stablecoin)
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS preferred_token TEXT DEFAULT 'NONE' CHECK(preferred_token IN ('NONE', 'ALEO', 'USDCx'));
        
        -- Wallet address for crypto payouts (encrypted at rest via encryption.js)
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS wallet_address TEXT;
        
        -- Whether the employee has explicitly opted in to crypto payouts
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS crypto_opt_in INTEGER DEFAULT 0;
        
        -- Date when crypto preferences were last changed (for audit)
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS crypto_settings_updated_at TIMESTAMP;
    `);
    console.log('   ✅ Employee crypto preferences added.\n');

    // ====================================
    // 2. Payroll items — fiat/crypto split
    // ====================================
    console.log('2️⃣  Adding fiat/crypto split columns to payroll_items...');
    await db.exec(`
        -- Fiat portion of k_vyplate_czk (goes to bank account)
        ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS fiat_payout_czk INTEGER DEFAULT 0;
        
        -- Crypto portion in CZK (the CZK value being converted to crypto)
        ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS crypto_payout_czk INTEGER DEFAULT 0;
        
        -- The actual crypto amount in token base units (microcredits for ALEO, 6-decimal for USDCx)
        ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS crypto_payout_amount BIGINT;
        
        -- Which token was used for this payout
        ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS crypto_payout_token TEXT CHECK(crypto_payout_token IN ('ALEO', 'USDCx'));
        
        -- CZK/USD exchange rate at the time of conversion (for USDCx)
        ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS czk_usd_rate DOUBLE PRECISION;
        
        -- CZK/ALEO exchange rate at the time of conversion (for ALEO credits)
        ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS czk_aleo_rate DOUBLE PRECISION;
        
        -- The employee's stablecoin_pct at the time of calculation (snapshot for audit)
        ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS stablecoin_pct_snapshot INTEGER DEFAULT 0;
    `);
    console.log('   ✅ Payroll items crypto split columns added.\n');

    // ====================================
    // 3. Payroll periods — USDCx rate
    // ====================================
    console.log('3️⃣  Adding USDCx rate to payroll_periods...');
    await db.exec(`
        -- CZK/USD exchange rate for USDCx conversion in this period
        ALTER TABLE payroll_periods ADD COLUMN IF NOT EXISTS czk_usd_rate DOUBLE PRECISION;
    `);
    console.log('   ✅ Payroll periods USDCx rate added.\n');

    // ====================================
    // 4. Crypto payment audit log table
    // ====================================
    console.log('4️⃣  Creating crypto_payments audit table...');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS crypto_payments (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            payroll_item_id INTEGER REFERENCES payroll_items(id),
            payroll_period_id INTEGER REFERENCES payroll_periods(id),
            company_id TEXT NOT NULL,
            employee_id INTEGER REFERENCES employees(id),
            
            -- Payment details
            token TEXT NOT NULL CHECK(token IN ('ALEO', 'USDCx')),
            amount_base_units BIGINT NOT NULL,
            amount_czk INTEGER NOT NULL,
            exchange_rate DOUBLE PRECISION NOT NULL,
            fee_czk INTEGER DEFAULT 0,
            
            -- On-chain
            tx_hash TEXT,
            tx_status TEXT DEFAULT 'pending' CHECK(tx_status IN ('pending', 'sent', 'confirmed', 'failed')),
            block_height INTEGER,
            
            -- Recipient
            recipient_address TEXT NOT NULL,
            
            -- Timestamps
            initiated_at TIMESTAMP DEFAULT NOW(),
            confirmed_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_crypto_payments_period ON crypto_payments(payroll_period_id);
        CREATE INDEX IF NOT EXISTS idx_crypto_payments_company ON crypto_payments(company_id);
        CREATE INDEX IF NOT EXISTS idx_crypto_payments_employee ON crypto_payments(employee_id);
        CREATE INDEX IF NOT EXISTS idx_crypto_payments_status ON crypto_payments(tx_status);
    `);
    console.log('   ✅ crypto_payments table created.\n');

    console.log('✅ Migration 006 complete — Crypto/Stablecoin support ready.\n');
    console.log('   New employee columns: stablecoin_pct, preferred_token, wallet_address, crypto_opt_in');
    console.log('   New payroll_items columns: fiat_payout_czk, crypto_payout_czk, crypto_payout_amount, crypto_payout_token, czk_usd_rate');
    console.log('   New payroll_periods column: czk_usd_rate');
    console.log('   New table: crypto_payments (full audit trail for on-chain payouts)');
}

// Run directly
migrate()
    .then(() => {
        console.log('\n🎉 Migration 006 finished successfully');
        process.exit(0);
    })
    .catch(err => {
        console.error('❌ Migration 006 failed:', err);
        process.exit(1);
    });

module.exports = { migrate };
