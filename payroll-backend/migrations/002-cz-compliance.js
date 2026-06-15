// ====================================
// 📦 Migration 002: CZ Compliance Features
// ====================================
// Adds tables for:
// - Vacation entitlements & records
// - Absence records (sick leave, OČR, etc.)
// - Deductions (garnishments / exekuce)
// - Employer liability insurance tracking
//
// Run: node migrations/002-cz-compliance.js

'use strict';

const db = require('../db');
require('dotenv').config();

async function migrate() {
    console.log('🚀 Starting CZ Compliance migration...\n');

    // ====================================
    // 1. Vacation entitlements table
    // ====================================
    console.log('1️⃣  Creating vacation_entitlements table...');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS vacation_entitlements (
            id SERIAL PRIMARY KEY,
            employee_id INTEGER NOT NULL REFERENCES employees(id),
            year INTEGER NOT NULL,
            
            -- Statutory: 4 weeks = 20 days for HPP, common 5 weeks = 25 days
            total_days DOUBLE PRECISION NOT NULL DEFAULT 20,
            
            -- Tracking
            used_days DOUBLE PRECISION NOT NULL DEFAULT 0,
            planned_days DOUBLE PRECISION NOT NULL DEFAULT 0,
            carried_over_days DOUBLE PRECISION NOT NULL DEFAULT 0,
            
            -- Calculated
            remaining_days DOUBLE PRECISION GENERATED ALWAYS AS (total_days + carried_over_days - used_days) STORED,
            
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(employee_id, year)
        );
        CREATE INDEX IF NOT EXISTS idx_vacation_ent_employee ON vacation_entitlements(employee_id);
        CREATE INDEX IF NOT EXISTS idx_vacation_ent_year ON vacation_entitlements(year);
    `);
    console.log('   ✅ vacation_entitlements created.\n');

    // ====================================
    // 2. Absence records table
    // ====================================
    console.log('2️⃣  Creating absence_records table...');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS absence_records (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            employee_id INTEGER NOT NULL REFERENCES employees(id),
            company_id TEXT NOT NULL,
            payroll_period_id INTEGER REFERENCES payroll_periods(id),
            
            -- Absence type
            type TEXT NOT NULL CHECK(type IN (
                'dovolena',          -- vacation
                'nemoc',             -- sick leave (first 14 days employer pays)
                'ocr',               -- caring for family member
                'materska',          -- maternity leave
                'rodicovska',        -- parental leave
                'neplacene_volno',   -- unpaid leave
                'svatek',            -- public holiday (usually auto-calculated)
                'sluzebni_cesta',    -- business trip
                'lekar',             -- doctor visit (half day)
                'nahradni_volno',    -- compensatory time off
                'jine'               -- other
            )),
            
            -- Duration
            date_from DATE NOT NULL,
            date_to DATE NOT NULL,
            work_days DOUBLE PRECISION NOT NULL,     -- actual working days absent
            hours DOUBLE PRECISION,                   -- hours absent (for partial days)
            
            -- Sick leave specifics (nemoc)
            sick_leave_day_number INTEGER,            -- day number in sickness period
            sick_leave_reduction_rate DOUBLE PRECISION, -- 60% of reduced daily base
            
            -- Approval
            status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'cancelled')),
            approved_by INTEGER REFERENCES users(id),
            approved_at TIMESTAMP,
            
            -- Notes
            note TEXT,
            document_ref TEXT,                        -- reference to uploaded document (e.g. sick note)
            
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_absence_employee ON absence_records(employee_id);
        CREATE INDEX IF NOT EXISTS idx_absence_company ON absence_records(company_id);
        CREATE INDEX IF NOT EXISTS idx_absence_period ON absence_records(payroll_period_id);
        CREATE INDEX IF NOT EXISTS idx_absence_dates ON absence_records(date_from, date_to);
        CREATE INDEX IF NOT EXISTS idx_absence_type ON absence_records(type);
    `);
    console.log('   ✅ absence_records created.\n');

    // ====================================
    // 3. Deductions table (garnishments / exekuce)
    // ====================================
    console.log('3️⃣  Creating deductions table...');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS deductions (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            employee_id INTEGER NOT NULL REFERENCES employees(id),
            company_id TEXT NOT NULL,
            
            -- Deduction type
            type TEXT NOT NULL CHECK(type IN (
                'exekuce_prednostni',     -- priority garnishment (alimenty, taxes)
                'exekuce_neprednostni',   -- non-priority garnishment
                'insolvence',             -- insolvency deduction
                'alimenty',               -- child support (specific form of prednostní)
                'srazka_zamestnanec',      -- voluntary employee deduction (e.g. meal plan, loan)
                'odbory',                 -- union fees
                'sporeni'                 -- pension/savings scheme
            )),
            
            -- Deduction details
            description TEXT NOT NULL,
            creditor_name TEXT,
            creditor_account TEXT,                -- bank account to send deduction to
            variable_symbol TEXT,
            
            -- Amount
            fixed_amount_czk INTEGER,            -- fixed monthly amount (for alimenty, voluntary)
            percentage DOUBLE PRECISION,          -- percentage of base (for insolvence)
            total_obligation_czk INTEGER,         -- total amount to be deducted over time
            total_deducted_czk INTEGER DEFAULT 0, -- running total already deducted
            
            -- Legal reference
            case_number TEXT,                     -- exekuční příkaz číslo jednací
            effective_from DATE NOT NULL,
            effective_to DATE,                    -- NULL = indefinite
            
            -- Priority ordering (lower = higher priority)
            priority INTEGER DEFAULT 100,
            
            -- Status
            is_active INTEGER DEFAULT 1,
            
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_deductions_employee ON deductions(employee_id);
        CREATE INDEX IF NOT EXISTS idx_deductions_company ON deductions(company_id);
        CREATE INDEX IF NOT EXISTS idx_deductions_active ON deductions(is_active) WHERE is_active = 1;
    `);
    console.log('   ✅ deductions created.\n');

    // ====================================
    // 4. Deduction history (per payroll period)
    // ====================================
    console.log('4️⃣  Creating deduction_history table...');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS deduction_history (
            id SERIAL PRIMARY KEY,
            deduction_id INTEGER NOT NULL REFERENCES deductions(id),
            payroll_item_id INTEGER NOT NULL REFERENCES payroll_items(id),
            payroll_period_id INTEGER NOT NULL REFERENCES payroll_periods(id),
            
            amount_czk INTEGER NOT NULL,
            running_total_czk INTEGER NOT NULL,    -- cumulative after this deduction
            
            created_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_deduction_hist_deduction ON deduction_history(deduction_id);
        CREATE INDEX IF NOT EXISTS idx_deduction_hist_period ON deduction_history(payroll_period_id);
    `);
    console.log('   ✅ deduction_history created.\n');

    // ====================================
    // 5. Add employer liability insurance rate to tax_parameters
    // ====================================
    console.log('5️⃣  Adding employer liability insurance column...');
    await db.exec(`
        ALTER TABLE tax_parameters ADD COLUMN IF NOT EXISTS zakonne_pojisteni_rate DOUBLE PRECISION DEFAULT 0.0028;
    `);
    
    // Update existing rows
    await db.run(`UPDATE tax_parameters SET zakonne_pojisteni_rate = 0.0028 WHERE zakonne_pojisteni_rate IS NULL`);
    console.log('   ✅ zakonne_pojisteni_rate added (0.28% — Kooperativa default).\n');

    // ====================================
    // 6. Add vacation_days column to employees
    // ====================================
    console.log('6️⃣  Adding vacation config to employees...');
    await db.exec(`
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS vacation_days_per_year INTEGER DEFAULT 20;
    `);
    console.log('   ✅ vacation_days_per_year added.\n');

    // ====================================
    // 7. Add deduction/absence summary columns to payroll_items
    // ====================================
    console.log('7️⃣  Adding compliance columns to payroll_items...');
    await db.exec(`
        ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS srazky_exekuce_czk INTEGER DEFAULT 0;
        ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS srazky_ostatni_czk INTEGER DEFAULT 0;
        ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS nahrada_nemoc_czk INTEGER DEFAULT 0;
        ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS dovolena_hodiny DOUBLE PRECISION DEFAULT 0;
        ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS zakonne_pojisteni_czk INTEGER DEFAULT 0;
        ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS k_vyplate_czk INTEGER DEFAULT 0;
    `);
    console.log('   ✅ payroll_items compliance columns added.\n');

    console.log('✅ CZ Compliance migration complete!\n');
}

// Run if called directly
if (require.main === module) {
    migrate()
        .then(() => process.exit(0))
        .catch(err => {
            console.error('❌ Migration failed:', err);
            process.exit(1);
        });
}

module.exports = { migrate };
