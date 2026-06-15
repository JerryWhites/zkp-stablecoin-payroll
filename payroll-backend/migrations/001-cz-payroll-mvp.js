// ====================================
// 📦 Database Schema Migration: CZ Payroll MVP
// ====================================
// Extends the existing schema with tables for:
// - Extended companies (IČO, sídlo, bank accounts)
// - Extended employees (RČ, daňové parametry, typ úvazku)
// - Payroll periods (monthly runs)
// - Payroll items (per-employee calculations)
// - Tax parameters (yearly rates)
// - Company encryption keys
//
// Run: node migrations/001-cz-payroll-mvp.js

'use strict';

const db = require('../db');
require('dotenv').config();

async function migrate() {
    console.log('🚀 Starting CZ Payroll MVP migration...\n');

    // ====================================
    // 1. Extend companies table
    // ====================================
    console.log('1️⃣  Extending companies table...');
    await db.exec(`
        ALTER TABLE companies ADD COLUMN IF NOT EXISTS ico TEXT;
        ALTER TABLE companies ADD COLUMN IF NOT EXISTS dic TEXT;
        ALTER TABLE companies ADD COLUMN IF NOT EXISTS sidlo_ulice TEXT;
        ALTER TABLE companies ADD COLUMN IF NOT EXISTS sidlo_mesto TEXT;
        ALTER TABLE companies ADD COLUMN IF NOT EXISTS sidlo_psc TEXT;
        ALTER TABLE companies ADD COLUMN IF NOT EXISTS bank_account_salary TEXT;
        ALTER TABLE companies ADD COLUMN IF NOT EXISTS bank_account_tax TEXT;
        ALTER TABLE companies ADD COLUMN IF NOT EXISTS bank_account_social TEXT;
        ALTER TABLE companies ADD COLUMN IF NOT EXISTS bank_account_health TEXT;
        ALTER TABLE companies ADD COLUMN IF NOT EXISTS fu_code TEXT;
        ALTER TABLE companies ADD COLUMN IF NOT EXISTS ossz_code TEXT;
        ALTER TABLE companies ADD COLUMN IF NOT EXISTS default_zp_code TEXT DEFAULT '111';
        ALTER TABLE companies ADD COLUMN IF NOT EXISTS setup_completed INTEGER DEFAULT 0;
    `);
    console.log('   ✅ Companies extended.\n');

    // ====================================
    // 2. Extend employees table
    // ====================================
    console.log('2️⃣  Extending employees table...');
    await db.exec(`
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS rodne_cislo TEXT;
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS datum_narozeni DATE;
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS adresa TEXT;
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS bank_account TEXT;
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS nastup DATE;
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS ukonceni DATE;
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS typ_uvazku TEXT DEFAULT 'HPP' CHECK(typ_uvazku IN ('HPP', 'DPP', 'DPC'));
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS hruba_mzda_czk INTEGER DEFAULT 0;
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS uvazek_hodiny INTEGER DEFAULT 40;
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS podepsane_prohlaseni INTEGER DEFAULT 1;
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS pocet_deti INTEGER DEFAULT 0;
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS deti_ztp INTEGER DEFAULT 0;
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS invalidita TEXT DEFAULT 'none' CHECK(invalidita IN ('none', '1-2', '3', 'ztp-p'));
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS sleva_student INTEGER DEFAULT 0;
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS zp_code TEXT DEFAULT '111';
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS osobni_cislo TEXT;
    `);
    console.log('   ✅ Employees extended.\n');

    // ====================================
    // 3. Create payroll_periods table
    // ====================================
    console.log('3️⃣  Creating payroll_periods table...');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS payroll_periods (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            company_id TEXT NOT NULL,
            year INTEGER NOT NULL,
            month INTEGER NOT NULL CHECK(month >= 1 AND month <= 12),
            status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'calculated', 'locked')),
            czk_aleo_rate DOUBLE PRECISION,
            locked_at TIMESTAMP,
            locked_by INTEGER,
            proof_hash TEXT,
            proof_status TEXT DEFAULT 'none' CHECK(proof_status IN ('none', 'pending', 'valid', 'invalid')),
            proof_file TEXT,
            notes TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(company_id, year, month)
        );
        CREATE INDEX IF NOT EXISTS idx_payroll_periods_company ON payroll_periods(company_id);
        CREATE INDEX IF NOT EXISTS idx_payroll_periods_status ON payroll_periods(status);
    `);
    console.log('   ✅ payroll_periods created.\n');

    // ====================================
    // 4. Create payroll_items table
    // ====================================
    console.log('4️⃣  Creating payroll_items table...');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS payroll_items (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            payroll_period_id INTEGER NOT NULL REFERENCES payroll_periods(id),
            employee_id INTEGER NOT NULL REFERENCES employees(id),
            
            -- Input
            odpracovane_hodiny DOUBLE PRECISION,
            fond_hodin DOUBLE PRECISION,
            absence_hodiny DOUBLE PRECISION DEFAULT 0,
            bonus_czk INTEGER DEFAULT 0,
            srazka_czk INTEGER DEFAULT 0,
            
            -- Calculated: employee
            zakladni_mzda_czk INTEGER DEFAULT 0,
            celkova_hruba_czk INTEGER DEFAULT 0,
            sp_zamestnanec INTEGER DEFAULT 0,
            zp_zamestnanec INTEGER DEFAULT 0,
            zaklad_dane INTEGER DEFAULT 0,
            zaloha_dan INTEGER DEFAULT 0,
            srazkova_dan INTEGER DEFAULT 0,
            slevy_celkem INTEGER DEFAULT 0,
            dan_po_slevach INTEGER DEFAULT 0,
            danova_zvyhodneni INTEGER DEFAULT 0,
            vysledek_dan INTEGER DEFAULT 0,
            danovy_bonus INTEGER DEFAULT 0,
            cista_mzda_czk INTEGER DEFAULT 0,
            
            -- Calculated: employer
            sp_zamestnavatel INTEGER DEFAULT 0,
            zp_zamestnavatel INTEGER DEFAULT 0,
            celkove_naklady INTEGER DEFAULT 0,
            
            -- ALEO payment
            cista_mzda_aleo BIGINT,
            aleo_tx_id TEXT,
            aleo_payment_status TEXT DEFAULT 'pending' CHECK(aleo_payment_status IN ('pending', 'sent', 'confirmed', 'failed')),
            
            -- Status
            status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'calculated', 'locked')),
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_payroll_items_period ON payroll_items(payroll_period_id);
        CREATE INDEX IF NOT EXISTS idx_payroll_items_employee ON payroll_items(employee_id);
    `);
    console.log('   ✅ payroll_items created.\n');

    // ====================================
    // 5. Create tax_parameters table
    // ====================================
    console.log('5️⃣  Creating tax_parameters table...');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS tax_parameters (
            id SERIAL PRIMARY KEY,
            year INTEGER UNIQUE NOT NULL,
            
            -- Social insurance
            sp_employee_rate DOUBLE PRECISION NOT NULL,
            sp_employer_rate DOUBLE PRECISION NOT NULL,
            
            -- Health insurance
            zp_employee_rate DOUBLE PRECISION NOT NULL,
            zp_employer_rate DOUBLE PRECISION NOT NULL,
            zp_min_assessment_base INTEGER NOT NULL,
            
            -- Income tax
            tax_rate_1 DOUBLE PRECISION NOT NULL,
            tax_rate_2 DOUBLE PRECISION NOT NULL,
            tax_threshold_monthly INTEGER NOT NULL,
            
            -- Tax credits (monthly)
            sleva_poplatnik INTEGER NOT NULL,
            sleva_student INTEGER NOT NULL,
            sleva_dite_1 INTEGER NOT NULL,
            sleva_dite_2 INTEGER NOT NULL,
            sleva_dite_3 INTEGER NOT NULL,
            sleva_ztp_dite_multiplier INTEGER DEFAULT 2,
            sleva_invalidita_1_2 INTEGER NOT NULL,
            sleva_invalidita_3 INTEGER NOT NULL,
            sleva_ztp_p INTEGER NOT NULL,
            
            -- Minimum wage
            min_wage_monthly INTEGER NOT NULL,
            min_wage_hourly DOUBLE PRECISION NOT NULL,
            
            -- DPP/DPC thresholds
            dpp_sp_zp_limit INTEGER NOT NULL,
            dpc_sp_threshold INTEGER NOT NULL,
            srazkova_dan_rate DOUBLE PRECISION NOT NULL,
            
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
    `);
    console.log('   ✅ tax_parameters created.\n');

    // ====================================
    // 6. Create company_encryption_keys table
    // ====================================
    console.log('6️⃣  Creating company_encryption_keys table...');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS company_encryption_keys (
            id SERIAL PRIMARY KEY,
            company_id TEXT UNIQUE NOT NULL,
            key_enc TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT NOW(),
            rotated_at TIMESTAMP
        );
    `);
    console.log('   ✅ company_encryption_keys created.\n');

    // ====================================
    // 7. Seed tax parameters for 2026 and 2027
    // ====================================
    console.log('7️⃣  Seeding tax parameters...');
    
    const taxParams2026 = [
        2026,
        0.071, 0.248,           // SP
        0.045, 0.09, 20800,     // ZP
        0.15, 0.23, 131901,     // daň
        2570, 335,              // slevy
        1267, 1860, 2320, 2,    // děti
        210, 420, 1345,         // invalidita
        20800, 124.40,          // min mzda
        10000, 4000, 0.15       // DPP/DPC
    ];

    const taxParams2027 = [
        2027,
        0.071, 0.248,
        0.045, 0.09, 21800,     // odhad min mzda 2027
        0.15, 0.23, 136000,     // odhad threshold 2027
        2570, 335,
        1267, 1860, 2320, 2,
        210, 420, 1345,
        21800, 130.00,          // odhad
        10000, 4000, 0.15
    ];

    const insertTaxSQL = `
        INSERT INTO tax_parameters (
            year,
            sp_employee_rate, sp_employer_rate,
            zp_employee_rate, zp_employer_rate, zp_min_assessment_base,
            tax_rate_1, tax_rate_2, tax_threshold_monthly,
            sleva_poplatnik, sleva_student,
            sleva_dite_1, sleva_dite_2, sleva_dite_3, sleva_ztp_dite_multiplier,
            sleva_invalidita_1_2, sleva_invalidita_3, sleva_ztp_p,
            min_wage_monthly, min_wage_hourly,
            dpp_sp_zp_limit, dpc_sp_threshold, srazkova_dan_rate
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (year) DO UPDATE SET
            sp_employee_rate = EXCLUDED.sp_employee_rate,
            sp_employer_rate = EXCLUDED.sp_employer_rate,
            zp_employee_rate = EXCLUDED.zp_employee_rate,
            zp_employer_rate = EXCLUDED.zp_employer_rate,
            zp_min_assessment_base = EXCLUDED.zp_min_assessment_base,
            tax_rate_1 = EXCLUDED.tax_rate_1,
            tax_rate_2 = EXCLUDED.tax_rate_2,
            tax_threshold_monthly = EXCLUDED.tax_threshold_monthly,
            sleva_poplatnik = EXCLUDED.sleva_poplatnik,
            sleva_student = EXCLUDED.sleva_student,
            sleva_dite_1 = EXCLUDED.sleva_dite_1,
            sleva_dite_2 = EXCLUDED.sleva_dite_2,
            sleva_dite_3 = EXCLUDED.sleva_dite_3,
            sleva_ztp_dite_multiplier = EXCLUDED.sleva_ztp_dite_multiplier,
            sleva_invalidita_1_2 = EXCLUDED.sleva_invalidita_1_2,
            sleva_invalidita_3 = EXCLUDED.sleva_invalidita_3,
            sleva_ztp_p = EXCLUDED.sleva_ztp_p,
            min_wage_monthly = EXCLUDED.min_wage_monthly,
            min_wage_hourly = EXCLUDED.min_wage_hourly,
            dpp_sp_zp_limit = EXCLUDED.dpp_sp_zp_limit,
            dpc_sp_threshold = EXCLUDED.dpc_sp_threshold,
            srazkova_dan_rate = EXCLUDED.srazkova_dan_rate,
            updated_at = NOW()
    `;

    await db.run(insertTaxSQL, taxParams2026);
    console.log('   ✅ 2026 tax parameters seeded.');
    await db.run(insertTaxSQL, taxParams2027);
    console.log('   ✅ 2027 tax parameters seeded.\n');

    // ====================================
    // 8. Seed demo company + employees (optional)
    // ====================================
    console.log('8️⃣  Seeding demo data...');

    const crypto = require('crypto');
    const demoCompanyUuid = 'demo-company-001';

    // Check if demo company exists
    const existing = await db.getOne('SELECT uuid FROM companies WHERE uuid = ?', [demoCompanyUuid]);
    if (!existing) {
        await db.run(`
            INSERT INTO companies (uuid, name, ico, sidlo_ulice, sidlo_mesto, sidlo_psc, tier, max_employees, setup_completed)
            VALUES (?, 'Demo s.r.o.', '27074358', 'Hlavní 123', 'Praha', '11000', 'growth', 30, 1)
        `, [demoCompanyUuid]);
        console.log('   ✅ Demo company created.');

        // Create credit balance for demo company
        await db.run(`
            INSERT INTO credit_balance (company_id, balance_czk)
            VALUES (?, 10000.00)
            ON CONFLICT (company_id) DO NOTHING
        `, [demoCompanyUuid]);

        // Seed demo employees
        const demoEmployees = [
            { name: 'Jan Novák', email: 'jan.novak@demo.cz', typ: 'HPP', mzda: 35000, prohlaseni: 1, deti: 1, osobni: 'E001' },
            { name: 'Marie Dvořáková', email: 'marie.dvorakova@demo.cz', typ: 'HPP', mzda: 45000, prohlaseni: 1, deti: 2, osobni: 'E002' },
            { name: 'Petr Svoboda', email: 'petr.svoboda@demo.cz', typ: 'HPP', mzda: 55000, prohlaseni: 1, deti: 0, osobni: 'E003' },
            { name: 'Eva Černá', email: 'eva.cerna@demo.cz', typ: 'DPP', mzda: 8000, prohlaseni: 0, deti: 0, osobni: 'E004' },
            { name: 'Tomáš Horáček', email: 'tomas.horacek@demo.cz', typ: 'DPC', mzda: 12000, prohlaseni: 1, deti: 1, osobni: 'E005' },
        ];

        for (const emp of demoEmployees) {
            const uuid = crypto.randomUUID();
            await db.run(`
                INSERT INTO employees (uuid, company_id, name, email, salary, aleo_address, typ_uvazku, hruba_mzda_czk, podepsane_prohlaseni, pocet_deti, osobni_cislo, nastup, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-01-01', 'active')
            `, [uuid, demoCompanyUuid, emp.name, emp.email, emp.mzda, 'aleo1placeholder' + uuid.replace(/-/g, '').substring(0, 47), emp.typ, emp.mzda, emp.prohlaseni, emp.deti, emp.osobni]);
        }
        console.log('   ✅ 5 demo employees created.');
    } else {
        console.log('   ⏭️  Demo company already exists, skipping seed.');
    }

    console.log('\n✅ Migration complete!\n');
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
