// ====================================
// 📦 Migration 003: Entity Types & OSVČ Support
// ====================================
// Adds support for:
// - Company entity types (OSVČ, s.r.o., a.s., k.s., v.o.s.)
// - OSVČ advance payments tracking (zálohy SP/ZP/daň)
// - OSVČ income tracking (příjmy/výdaje)
// - Annual processing (roční zúčtování, ELDP, přehledy)
// - OSVČ-specific tax parameters
//
// Run: node migrations/003-entity-types-osvc.js

'use strict';

const db = require('../db');
require('dotenv').config();

async function migrate() {
    console.log('🚀 Starting Entity Types & OSVČ migration...\n');

    // ====================================
    // 1. Add entity_type and OSVČ fields to companies
    // ====================================
    console.log('1️⃣  Adding entity type columns to companies...');
    await db.exec(`
        ALTER TABLE companies ADD COLUMN IF NOT EXISTS entity_type TEXT DEFAULT 'sro'
            CHECK(entity_type IN ('osvc', 'sro', 'as', 'komanditni', 'vos'));

        -- OSVČ-specific fields
        ALTER TABLE companies ADD COLUMN IF NOT EXISTS hlavni_cinnost INTEGER DEFAULT 1;
        ALTER TABLE companies ADD COLUMN IF NOT EXISTS pausal_dan INTEGER DEFAULT 0;
        ALTER TABLE companies ADD COLUMN IF NOT EXISTS vydajovy_pausal_pct INTEGER DEFAULT 60;
        ALTER TABLE companies ADD COLUMN IF NOT EXISTS obor_cinnosti TEXT;
        ALTER TABLE companies ADD COLUMN IF NOT EXISTS zivnostensky_list TEXT;

        -- Legal entity specific
        ALTER TABLE companies ADD COLUMN IF NOT EXISTS pravni_forma_detail TEXT;
        ALTER TABLE companies ADD COLUMN IF NOT EXISTS zakladni_kapital_czk INTEGER DEFAULT 0;
        ALTER TABLE companies ADD COLUMN IF NOT EXISTS statutarni_organ TEXT;
        ALTER TABLE companies ADD COLUMN IF NOT EXISTS datum_zalozeni DATE;
    `);
    console.log('   ✅ Entity type columns added.\n');

    // ====================================
    // 2. OSVČ advance payments table (zálohy SP/ZP/daň)
    // ====================================
    console.log('2️⃣  Creating osvc_advances table...');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS osvc_advances (
            id SERIAL PRIMARY KEY,
            company_id TEXT NOT NULL,
            year INTEGER NOT NULL,
            month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
            
            -- Type of advance payment
            type TEXT NOT NULL CHECK(type IN (
                'sp',       -- sociální pojištění záloha
                'zp',       -- zdravotní pojištění záloha
                'dan'       -- záloha na daň z příjmů
            )),
            
            -- Amount
            amount_czk INTEGER NOT NULL,
            
            -- Payment tracking
            paid_at TIMESTAMP,
            due_date DATE NOT NULL,
            status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'overdue', 'exempt')),
            
            -- Reference
            variable_symbol TEXT,
            note TEXT,
            
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(company_id, year, month, type)
        );
        CREATE INDEX IF NOT EXISTS idx_osvc_advances_company ON osvc_advances(company_id);
        CREATE INDEX IF NOT EXISTS idx_osvc_advances_year_month ON osvc_advances(year, month);
        CREATE INDEX IF NOT EXISTS idx_osvc_advances_status ON osvc_advances(status);
    `);
    console.log('   ✅ osvc_advances created.\n');

    // ====================================
    // 3. OSVČ income tracking table
    // ====================================
    console.log('3️⃣  Creating osvc_income table...');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS osvc_income (
            id SERIAL PRIMARY KEY,
            company_id TEXT NOT NULL,
            year INTEGER NOT NULL,
            month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
            
            -- Income & expenses
            revenue_czk INTEGER NOT NULL DEFAULT 0,
            expenses_czk INTEGER NOT NULL DEFAULT 0,
            
            -- Breakdown (optional detail)
            revenue_services_czk INTEGER DEFAULT 0,
            revenue_goods_czk INTEGER DEFAULT 0,
            expenses_material_czk INTEGER DEFAULT 0,
            expenses_services_czk INTEGER DEFAULT 0,
            expenses_other_czk INTEGER DEFAULT 0,
            
            -- Use pausal or actual expenses?
            use_pausal INTEGER DEFAULT 1,
            
            note TEXT,
            
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(company_id, year, month)
        );
        CREATE INDEX IF NOT EXISTS idx_osvc_income_company ON osvc_income(company_id);
        CREATE INDEX IF NOT EXISTS idx_osvc_income_year ON osvc_income(year);
    `);
    console.log('   ✅ osvc_income created.\n');

    // ====================================
    // 4. Annual processing table
    // ====================================
    console.log('4️⃣  Creating annual_processing table...');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS annual_processing (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            company_id TEXT NOT NULL,
            year INTEGER NOT NULL,
            
            -- What type of annual processing
            type TEXT NOT NULL CHECK(type IN (
                'rocni_zuctovani',    -- roční zúčtování daně zaměstnanců
                'eldp',               -- evidenční list důchodového pojištění
                'prehled_ossz',       -- přehled pro OSSZ (OSVČ)
                'prehled_zp',         -- přehled pro zdravotní pojišťovnu (OSVČ)
                'danove_priznani',    -- daňové přiznání FO (OSVČ)
                'vyuctovani_dane'     -- vyúčtování daně ze závislé činnosti (zaměstnavatel)
            )),
            
            -- Processing status
            status TEXT DEFAULT 'draft' CHECK(status IN (
                'draft',        -- rozpracováno
                'calculated',   -- vypočítáno
                'submitted',    -- podáno (na úřad)
                'accepted',     -- přijato úřadem
                'rejected'      -- zamítnuto / k opravě
            )),
            
            -- Structured data (full calculation result)
            data_json JSONB,
            
            -- Submission tracking
            submitted_at TIMESTAMP,
            submission_ref TEXT,        -- podací číslo / ID datové schránky
            
            -- Target employee (for per-employee docs like ELDP, roční zúčtování)
            employee_id INTEGER REFERENCES employees(id),
            
            note TEXT,
            
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_annual_company ON annual_processing(company_id);
        CREATE INDEX IF NOT EXISTS idx_annual_year ON annual_processing(year);
        CREATE INDEX IF NOT EXISTS idx_annual_type ON annual_processing(type);
        CREATE INDEX IF NOT EXISTS idx_annual_employee ON annual_processing(employee_id);
        CREATE INDEX IF NOT EXISTS idx_annual_status ON annual_processing(status);
    `);
    console.log('   ✅ annual_processing created.\n');

    // ====================================
    // 5. Add OSVČ-specific tax parameters
    // ====================================
    console.log('5️⃣  Adding OSVČ tax parameter columns...');
    await db.exec(`
        ALTER TABLE tax_parameters ADD COLUMN IF NOT EXISTS osvc_sp_rate DOUBLE PRECISION DEFAULT 0.292;
        ALTER TABLE tax_parameters ADD COLUMN IF NOT EXISTS osvc_zp_rate DOUBLE PRECISION DEFAULT 0.135;
        ALTER TABLE tax_parameters ADD COLUMN IF NOT EXISTS osvc_sp_min_monthly INTEGER DEFAULT 3852;
        ALTER TABLE tax_parameters ADD COLUMN IF NOT EXISTS osvc_zp_min_monthly INTEGER DEFAULT 2968;
        ALTER TABLE tax_parameters ADD COLUMN IF NOT EXISTS osvc_sp_vedlejsi_limit INTEGER DEFAULT 105520;
        ALTER TABLE tax_parameters ADD COLUMN IF NOT EXISTS osvc_vedlejsi_sp_min INTEGER DEFAULT 1413;
        ALTER TABLE tax_parameters ADD COLUMN IF NOT EXISTS pausal_dan_monthly INTEGER DEFAULT 7498;
        ALTER TABLE tax_parameters ADD COLUMN IF NOT EXISTS pausal_dan_limit INTEGER DEFAULT 2000000;
        ALTER TABLE tax_parameters ADD COLUMN IF NOT EXISTS vydajovy_pausal_40 INTEGER DEFAULT 40;
        ALTER TABLE tax_parameters ADD COLUMN IF NOT EXISTS vydajovy_pausal_60 INTEGER DEFAULT 60;
        ALTER TABLE tax_parameters ADD COLUMN IF NOT EXISTS vydajovy_pausal_80 INTEGER DEFAULT 80;
        ALTER TABLE tax_parameters ADD COLUMN IF NOT EXISTS vydajovy_pausal_max_40 INTEGER DEFAULT 800000;
        ALTER TABLE tax_parameters ADD COLUMN IF NOT EXISTS vydajovy_pausal_max_60 INTEGER DEFAULT 1200000;
        ALTER TABLE tax_parameters ADD COLUMN IF NOT EXISTS vydajovy_pausal_max_80 INTEGER DEFAULT 1600000;
    `);
    console.log('   ✅ OSVČ tax parameters added.\n');

    // ====================================
    // 6. Update existing tax_parameters rows with OSVČ values
    // ====================================
    console.log('6️⃣  Updating existing tax_parameters with OSVČ values...');
    await db.run(`
        UPDATE tax_parameters SET
            osvc_sp_rate = 0.292,
            osvc_zp_rate = 0.135,
            osvc_sp_min_monthly = 3852,
            osvc_zp_min_monthly = 2968,
            osvc_sp_vedlejsi_limit = 105520,
            osvc_vedlejsi_sp_min = 1413,
            pausal_dan_monthly = 7498,
            pausal_dan_limit = 2000000
        WHERE osvc_sp_rate IS NULL OR osvc_sp_rate = 0
    `);
    console.log('   ✅ OSVČ values updated.\n');

    console.log('✅ Entity Types & OSVČ migration complete!\n');
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
