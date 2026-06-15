// ====================================
// 📦 Migration 005: Industry Gap Features
// ====================================
// Fills all gaps identified in the feature gap analysis:
// - Organizational structure (departments, cost centers)
// - Salary history & pay grades
// - Timesheets & attendance
// - Benefits administration (meal vouchers, company car, cafeteria)
// - Commission schemes
// - Onboarding/offboarding workflows
// - Employee self-service
// - Accounting journal entries & CZ accounting exports
// - Multi-entity holdingová konsolidace
//
// Run: node migrations/005-industry-gaps.js

'use strict';

const db = require('../db');
require('dotenv').config();

async function migrate() {
    console.log('🚀 Starting Industry Gap Features migration...\n');

    // ====================================
    // 1. Organizational Structure (departments, positions, cost centers)
    // ====================================
    console.log('1️⃣  Creating organizational structure tables...');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS departments (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            company_id TEXT NOT NULL,
            name TEXT NOT NULL,
            code TEXT,
            parent_department_id INTEGER REFERENCES departments(id),
            manager_employee_id INTEGER REFERENCES employees(id),
            cost_center_code TEXT,
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_departments_company ON departments(company_id);
        CREATE INDEX IF NOT EXISTS idx_departments_parent ON departments(parent_department_id);

        CREATE TABLE IF NOT EXISTS cost_centers (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            company_id TEXT NOT NULL,
            code TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(company_id, code)
        );
        CREATE INDEX IF NOT EXISTS idx_cost_centers_company ON cost_centers(company_id);
    `);
    console.log('   ✅ organizational structure created.\n');

    // ====================================
    // 2. Employee extensions (department, supervisor, cost center, multiple bank accounts)
    // ====================================
    console.log('2️⃣  Extending employees table...');
    await db.exec(`
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES departments(id);
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS supervisor_id INTEGER REFERENCES employees(id);
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS cost_center_id INTEGER REFERENCES cost_centers(id);
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS position_title TEXT;
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS position_code TEXT;

        CREATE TABLE IF NOT EXISTS employee_bank_accounts (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            employee_id INTEGER NOT NULL REFERENCES employees(id),
            company_id TEXT NOT NULL,
            account_number TEXT NOT NULL,
            bank_code TEXT NOT NULL,
            iban TEXT,
            label TEXT DEFAULT 'Hlavní účet',
            split_percentage DOUBLE PRECISION DEFAULT 100.0,
            split_fixed_czk INTEGER,
            is_primary INTEGER DEFAULT 1,
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_employee_bank_accounts_employee ON employee_bank_accounts(employee_id);
        CREATE INDEX IF NOT EXISTS idx_employee_bank_accounts_company ON employee_bank_accounts(company_id);
    `);
    console.log('   ✅ employee extensions created.\n');

    // ====================================
    // 3. Salary History & Pay Grades
    // ====================================
    console.log('3️⃣  Creating salary history & pay grades tables...');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS salary_history (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            employee_id INTEGER NOT NULL REFERENCES employees(id),
            company_id TEXT NOT NULL,
            effective_date DATE NOT NULL,
            end_date DATE,
            previous_salary INTEGER,
            new_salary INTEGER NOT NULL,
            change_reason TEXT CHECK(change_reason IN (
                'hire', 'promotion', 'annual_review', 'merit',
                'adjustment', 'demotion', 'transfer', 'legislation', 'other'
            )),
            previous_position TEXT,
            new_position TEXT,
            previous_department_id INTEGER REFERENCES departments(id),
            new_department_id INTEGER REFERENCES departments(id),
            pay_grade_id INTEGER,
            notes TEXT,
            approved_by INTEGER REFERENCES users(id),
            created_by INTEGER NOT NULL REFERENCES users(id),
            created_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_salary_history_employee ON salary_history(employee_id);
        CREATE INDEX IF NOT EXISTS idx_salary_history_company ON salary_history(company_id);
        CREATE INDEX IF NOT EXISTS idx_salary_history_date ON salary_history(effective_date);

        CREATE TABLE IF NOT EXISTS pay_grades (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            company_id TEXT NOT NULL,
            code TEXT NOT NULL,
            name TEXT NOT NULL,
            min_salary INTEGER NOT NULL,
            mid_salary INTEGER,
            max_salary INTEGER NOT NULL,
            currency TEXT DEFAULT 'CZK',
            description TEXT,
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(company_id, code)
        );
        CREATE INDEX IF NOT EXISTS idx_pay_grades_company ON pay_grades(company_id);

        ALTER TABLE employees ADD COLUMN IF NOT EXISTS pay_grade_id INTEGER REFERENCES pay_grades(id);
    `);
    console.log('   ✅ salary history & pay grades created.\n');

    // ====================================
    // 4. Timesheets & Attendance
    // ====================================
    console.log('4️⃣  Creating timesheets & attendance tables...');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS timesheets (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            employee_id INTEGER NOT NULL REFERENCES employees(id),
            company_id TEXT NOT NULL,
            date DATE NOT NULL,
            clock_in TIMESTAMP,
            clock_out TIMESTAMP,
            break_minutes INTEGER DEFAULT 30,
            worked_hours DOUBLE PRECISION DEFAULT 0,
            overtime_hours DOUBLE PRECISION DEFAULT 0,
            shift_type TEXT DEFAULT 'day' CHECK(shift_type IN ('day', 'night', 'weekend', 'holiday')),
            is_holiday INTEGER DEFAULT 0,
            is_weekend INTEGER DEFAULT 0,
            status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'submitted', 'approved', 'rejected')),
            approved_by INTEGER REFERENCES users(id),
            approved_at TIMESTAMP,
            rejection_reason TEXT,
            notes TEXT,
            location TEXT,
            project_code TEXT,
            cost_center_id INTEGER REFERENCES cost_centers(id),
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(employee_id, date)
        );
        CREATE INDEX IF NOT EXISTS idx_timesheets_employee ON timesheets(employee_id);
        CREATE INDEX IF NOT EXISTS idx_timesheets_company ON timesheets(company_id);
        CREATE INDEX IF NOT EXISTS idx_timesheets_date ON timesheets(date);
        CREATE INDEX IF NOT EXISTS idx_timesheets_status ON timesheets(status);

        CREATE TABLE IF NOT EXISTS shift_schedules (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            company_id TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            start_time TEXT NOT NULL DEFAULT '08:00',
            end_time TEXT NOT NULL DEFAULT '16:30',
            break_minutes INTEGER DEFAULT 30,
            working_hours DOUBLE PRECISION DEFAULT 8.0,
            is_night_shift INTEGER DEFAULT 0,
            color TEXT DEFAULT '#3b82f6',
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_shift_schedules_company ON shift_schedules(company_id);

        CREATE TABLE IF NOT EXISTS shift_assignments (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            employee_id INTEGER NOT NULL REFERENCES employees(id),
            company_id TEXT NOT NULL,
            shift_schedule_id INTEGER NOT NULL REFERENCES shift_schedules(id),
            date DATE NOT NULL,
            actual_start TIMESTAMP,
            actual_end TIMESTAMP,
            status TEXT DEFAULT 'scheduled' CHECK(status IN ('scheduled', 'started', 'completed', 'absent', 'swapped')),
            swap_with_employee_id INTEGER REFERENCES employees(id),
            notes TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(employee_id, date)
        );
        CREATE INDEX IF NOT EXISTS idx_shift_assignments_employee ON shift_assignments(employee_id);
        CREATE INDEX IF NOT EXISTS idx_shift_assignments_company ON shift_assignments(company_id);
        CREATE INDEX IF NOT EXISTS idx_shift_assignments_date ON shift_assignments(date);

        CREATE TABLE IF NOT EXISTS overtime_rules (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            company_id TEXT NOT NULL,
            name TEXT NOT NULL,
            overtime_threshold_daily DOUBLE PRECISION DEFAULT 8.0,
            overtime_threshold_weekly DOUBLE PRECISION DEFAULT 40.0,
            overtime_rate DOUBLE PRECISION DEFAULT 1.25,
            night_rate DOUBLE PRECISION DEFAULT 1.10,
            weekend_rate DOUBLE PRECISION DEFAULT 1.10,
            holiday_rate DOUBLE PRECISION DEFAULT 2.0,
            night_start TEXT DEFAULT '22:00',
            night_end TEXT DEFAULT '06:00',
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_overtime_rules_company ON overtime_rules(company_id);
    `);
    console.log('   ✅ timesheets & attendance created.\n');

    // ====================================
    // 5. Benefits Administration (stravenky, cafeteria, company car)
    // ====================================
    console.log('5️⃣  Creating benefits administration tables...');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS benefit_plans (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            company_id TEXT NOT NULL,
            type TEXT NOT NULL CHECK(type IN (
                'meal_voucher',           -- stravenky
                'meal_allowance',         -- stravenkový paušál
                'pension_contribution',   -- příspěvek na penzijko
                'life_insurance',         -- příspěvek na životko
                'company_car',            -- služební auto
                'cafeteria',              -- cafeteria systém
                'transport',              -- příspěvek na dopravu
                'education',              -- příspěvek na vzdělávání
                'sport',                  -- Multisport/sport
                'housing',                -- příspěvek na bydlení
                'other'                   -- jiný benefit
            )),
            name TEXT NOT NULL,
            description TEXT,

            -- Meal voucher specifics
            voucher_value_czk INTEGER,
            employer_contribution_pct DOUBLE PRECISION DEFAULT 55.0,
            employer_contribution_czk INTEGER,
            tax_free_limit_czk INTEGER DEFAULT 116,

            -- Company car specifics
            car_price_czk INTEGER,
            car_benefit_pct DOUBLE PRECISION DEFAULT 1.0,
            car_is_ev INTEGER DEFAULT 0,
            car_ev_benefit_pct DOUBLE PRECISION DEFAULT 0.5,

            -- Pension/life insurance specifics
            monthly_contribution_czk INTEGER,
            annual_tax_free_limit_czk INTEGER DEFAULT 50000,

            -- Cafeteria specifics
            annual_budget_czk INTEGER,
            remaining_budget_czk INTEGER,

            -- General
            is_taxable INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            effective_from DATE,
            effective_to DATE,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_benefit_plans_company ON benefit_plans(company_id);
        CREATE INDEX IF NOT EXISTS idx_benefit_plans_type ON benefit_plans(type);

        CREATE TABLE IF NOT EXISTS employee_benefits (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            employee_id INTEGER NOT NULL REFERENCES employees(id),
            benefit_plan_id INTEGER NOT NULL REFERENCES benefit_plans(id),
            company_id TEXT NOT NULL,
            enrollment_date DATE NOT NULL DEFAULT CURRENT_DATE,
            end_date DATE,
            custom_value_czk INTEGER,
            status TEXT DEFAULT 'active' CHECK(status IN ('active', 'pending', 'suspended', 'ended')),

            -- Company car details
            car_registration TEXT,
            car_model TEXT,
            car_price_czk INTEGER,
            car_is_ev INTEGER DEFAULT 0,

            -- Cafeteria tracking
            cafeteria_used_czk INTEGER DEFAULT 0,

            notes TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_employee_benefits_employee ON employee_benefits(employee_id);
        CREATE INDEX IF NOT EXISTS idx_employee_benefits_plan ON employee_benefits(benefit_plan_id);
        CREATE INDEX IF NOT EXISTS idx_employee_benefits_company ON employee_benefits(company_id);

        CREATE TABLE IF NOT EXISTS benefit_transactions (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            employee_benefit_id INTEGER NOT NULL REFERENCES employee_benefits(id),
            company_id TEXT NOT NULL,
            period_year INTEGER NOT NULL,
            period_month INTEGER NOT NULL,
            amount_czk INTEGER NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('employer_contribution', 'employee_deduction', 'tax_benefit', 'cafeteria_use')),
            description TEXT,
            payroll_item_id INTEGER,
            created_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_benefit_transactions_benefit ON benefit_transactions(employee_benefit_id);
        CREATE INDEX IF NOT EXISTS idx_benefit_transactions_period ON benefit_transactions(period_year, period_month);
    `);
    console.log('   ✅ benefits administration created.\n');

    // ====================================
    // 6. Commission Schemes
    // ====================================
    console.log('6️⃣  Creating commission schemes tables...');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS commission_schemes (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            company_id TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            type TEXT NOT NULL CHECK(type IN (
                'flat_rate',         -- fixní % z tržby
                'tiered',            -- stupňovité (čím více, tím vyšší %)
                'threshold',         -- % po dosažení hranice
                'flat_per_unit',     -- fixní CZK za kus/smlouvu
                'mixed'              -- kombinace
            )),
            base_rate_pct DOUBLE PRECISION,
            base_amount_czk INTEGER,
            tiers TEXT DEFAULT '[]',
            cap_monthly_czk INTEGER,
            cap_annual_czk INTEGER,
            is_active INTEGER DEFAULT 1,
            effective_from DATE,
            effective_to DATE,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_commission_schemes_company ON commission_schemes(company_id);

        CREATE TABLE IF NOT EXISTS employee_commissions (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            employee_id INTEGER NOT NULL REFERENCES employees(id),
            commission_scheme_id INTEGER NOT NULL REFERENCES commission_schemes(id),
            company_id TEXT NOT NULL,
            period_year INTEGER NOT NULL,
            period_month INTEGER NOT NULL,
            revenue_czk INTEGER DEFAULT 0,
            units_sold INTEGER DEFAULT 0,
            calculated_commission_czk INTEGER NOT NULL DEFAULT 0,
            adjustment_czk INTEGER DEFAULT 0,
            final_commission_czk INTEGER NOT NULL DEFAULT 0,
            status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'calculated', 'approved', 'paid')),
            approved_by INTEGER REFERENCES users(id),
            approved_at TIMESTAMP,
            payroll_item_id INTEGER,
            notes TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_employee_commissions_employee ON employee_commissions(employee_id);
        CREATE INDEX IF NOT EXISTS idx_employee_commissions_company ON employee_commissions(company_id);
        CREATE INDEX IF NOT EXISTS idx_employee_commissions_period ON employee_commissions(period_year, period_month);
    `);
    console.log('   ✅ commission schemes created.\n');

    // ====================================
    // 7. Onboarding & Offboarding
    // ====================================
    console.log('7️⃣  Creating onboarding/offboarding tables...');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS onboarding_templates (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            company_id TEXT NOT NULL,
            name TEXT NOT NULL DEFAULT 'Standardní nástup',
            description TEXT,
            checklist_items TEXT NOT NULL DEFAULT '[]',
            contract_type TEXT CHECK(contract_type IN ('HPP', 'DPP', 'DPC', 'all')),
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_onboarding_templates_company ON onboarding_templates(company_id);

        CREATE TABLE IF NOT EXISTS employee_onboarding (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            employee_id INTEGER NOT NULL REFERENCES employees(id),
            company_id TEXT NOT NULL,
            template_id INTEGER REFERENCES onboarding_templates(id),
            type TEXT NOT NULL CHECK(type IN ('onboarding', 'offboarding')),
            status TEXT DEFAULT 'in_progress' CHECK(status IN ('not_started', 'in_progress', 'completed', 'cancelled')),
            checklist_progress TEXT NOT NULL DEFAULT '[]',
            started_at TIMESTAMP DEFAULT NOW(),
            completed_at TIMESTAMP,
            assigned_to INTEGER REFERENCES users(id),
            notes TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_employee_onboarding_employee ON employee_onboarding(employee_id);
        CREATE INDEX IF NOT EXISTS idx_employee_onboarding_company ON employee_onboarding(company_id);
        CREATE INDEX IF NOT EXISTS idx_employee_onboarding_status ON employee_onboarding(status);

        CREATE TABLE IF NOT EXISTS employee_documents (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            employee_id INTEGER NOT NULL REFERENCES employees(id),
            company_id TEXT NOT NULL,
            type TEXT NOT NULL CHECK(type IN (
                'contract',               -- pracovní smlouva
                'contract_amendment',      -- dodatek ke smlouvě
                'dpp_agreement',           -- dohoda o provedení práce
                'dpc_agreement',           -- dohoda o pracovní činnosti
                'termination_notice',      -- výpověď
                'termination_agreement',   -- dohoda o rozvázání PP
                'zapoctovy_list',          -- zápočtový list
                'employment_confirmation', -- potvrzení o zaměstnání
                'tax_declaration',         -- prohlášení poplatníka
                'annual_tax_settlement',   -- roční zúčtování daně
                'medical_certificate',     -- lékařská prohlídka
                'nda',                     -- NDA
                'other'                    -- jiný dokument
            )),
            name TEXT NOT NULL,
            file_path TEXT,
            file_size INTEGER,
            mime_type TEXT,
            version INTEGER DEFAULT 1,
            valid_from DATE,
            valid_to DATE,
            signed_at TIMESTAMP,
            signed_by TEXT,
            status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'pending_signature', 'signed', 'expired', 'revoked')),
            generated_data TEXT,
            created_by INTEGER REFERENCES users(id),
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_employee_documents_employee ON employee_documents(employee_id);
        CREATE INDEX IF NOT EXISTS idx_employee_documents_company ON employee_documents(company_id);
        CREATE INDEX IF NOT EXISTS idx_employee_documents_type ON employee_documents(type);

        CREATE TABLE IF NOT EXISTS offboarding_calculations (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            employee_id INTEGER NOT NULL REFERENCES employees(id),
            company_id TEXT NOT NULL,
            termination_date DATE NOT NULL,
            termination_type TEXT NOT NULL CHECK(termination_type IN (
                'resignation',          -- výpověď zaměstnancem
                'employer_notice',      -- výpověď zaměstnavatelem
                'mutual_agreement',     -- dohoda
                'immediate',            -- okamžité zrušení
                'probation',            -- ve zkušební době
                'fixed_term_end',       -- uplynutí doby určité
                'retirement'            -- odchod do důchodu
            )),
            notice_period_months INTEGER DEFAULT 2,
            severance_months INTEGER DEFAULT 0,
            severance_amount_czk INTEGER DEFAULT 0,
            unused_vacation_days DOUBLE PRECISION DEFAULT 0,
            vacation_payout_czk INTEGER DEFAULT 0,
            final_salary_czk INTEGER DEFAULT 0,
            prorated_bonus_czk INTEGER DEFAULT 0,
            total_final_payment_czk INTEGER DEFAULT 0,
            documents_generated TEXT DEFAULT '[]',
            status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'calculated', 'approved', 'processed')),
            approved_by INTEGER REFERENCES users(id),
            approved_at TIMESTAMP,
            notes TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_offboarding_employee ON offboarding_calculations(employee_id);
        CREATE INDEX IF NOT EXISTS idx_offboarding_company ON offboarding_calculations(company_id);
    `);
    console.log('   ✅ onboarding/offboarding created.\n');

    // ====================================
    // 8. Employee Self-Service Portal
    // ====================================
    console.log('8️⃣  Creating self-service portal tables...');
    await db.exec(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_id INTEGER REFERENCES employees(id);
        ALTER TABLE users ADD COLUMN IF NOT EXISTS portal_role TEXT DEFAULT 'admin' CHECK(portal_role IN ('admin', 'employer', 'manager', 'employee'));

        CREATE TABLE IF NOT EXISTS employee_requests (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            employee_id INTEGER NOT NULL REFERENCES employees(id),
            company_id TEXT NOT NULL,
            type TEXT NOT NULL CHECK(type IN (
                'vacation',               -- žádost o dovolenou
                'personal_data_change',   -- změna osobních údajů
                'document_request',       -- žádost o dokument
                'benefit_enrollment',     -- přihlášení k benefitu
                'benefit_change',         -- změna benefitu
                'overtime_request',       -- žádost o přesčas
                'remote_work',            -- žádost o home office
                'other'                   -- jiné
            )),
            title TEXT NOT NULL,
            description TEXT,
            data TEXT DEFAULT '{}',
            status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'cancelled', 'completed')),
            reviewed_by INTEGER REFERENCES users(id),
            reviewed_at TIMESTAMP,
            review_notes TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_employee_requests_employee ON employee_requests(employee_id);
        CREATE INDEX IF NOT EXISTS idx_employee_requests_company ON employee_requests(company_id);
        CREATE INDEX IF NOT EXISTS idx_employee_requests_status ON employee_requests(status);

        CREATE TABLE IF NOT EXISTS payslip_access_log (
            id SERIAL PRIMARY KEY,
            employee_id INTEGER NOT NULL REFERENCES employees(id),
            company_id TEXT NOT NULL,
            period_year INTEGER NOT NULL,
            period_month INTEGER NOT NULL,
            accessed_at TIMESTAMP DEFAULT NOW(),
            ip_address TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_payslip_access_employee ON payslip_access_log(employee_id);
    `);
    console.log('   ✅ self-service portal created.\n');

    // ====================================
    // 9. Accounting Journal & CZ System Exports
    // ====================================
    console.log('9️⃣  Creating accounting journal tables...');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS chart_of_accounts (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            company_id TEXT NOT NULL,
            account_number TEXT NOT NULL,
            name TEXT NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
            parent_account TEXT,
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(company_id, account_number)
        );
        CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_company ON chart_of_accounts(company_id);

        CREATE TABLE IF NOT EXISTS account_mappings (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            company_id TEXT NOT NULL,
            payroll_component TEXT NOT NULL CHECK(payroll_component IN (
                'gross_salary', 'sp_employee', 'zp_employee', 'tax',
                'sp_employer', 'zp_employer', 'net_salary',
                'meal_voucher_employer', 'meal_voucher_employee',
                'pension_contribution', 'life_insurance',
                'company_car_benefit', 'commission', 'bonus',
                'deduction', 'vacation_payout', 'severance',
                'sick_leave', 'other'
            )),
            debit_account TEXT NOT NULL,
            credit_account TEXT NOT NULL,
            cost_center_code TEXT,
            description TEXT,
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(company_id, payroll_component, cost_center_code)
        );
        CREATE INDEX IF NOT EXISTS idx_account_mappings_company ON account_mappings(company_id);

        CREATE TABLE IF NOT EXISTS journal_entries (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            company_id TEXT NOT NULL,
            payroll_period_id INTEGER,
            entry_date DATE NOT NULL,
            description TEXT NOT NULL,
            total_debit_czk DOUBLE PRECISION NOT NULL DEFAULT 0,
            total_credit_czk DOUBLE PRECISION NOT NULL DEFAULT 0,
            status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'posted', 'exported', 'voided')),
            exported_to TEXT,
            exported_at TIMESTAMP,
            export_format TEXT CHECK(export_format IN ('pohoda_xml', 'money_s3', 'abra', 'helios', 'csv', 'isdoc')),
            created_by INTEGER REFERENCES users(id),
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_journal_entries_company ON journal_entries(company_id);
        CREATE INDEX IF NOT EXISTS idx_journal_entries_period ON journal_entries(payroll_period_id);
        CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(entry_date);

        CREATE TABLE IF NOT EXISTS journal_entry_lines (
            id SERIAL PRIMARY KEY,
            journal_entry_id INTEGER NOT NULL REFERENCES journal_entries(id),
            line_number INTEGER NOT NULL,
            account_number TEXT NOT NULL,
            debit_czk DOUBLE PRECISION DEFAULT 0,
            credit_czk DOUBLE PRECISION DEFAULT 0,
            description TEXT,
            cost_center_code TEXT,
            employee_id INTEGER REFERENCES employees(id),
            payroll_component TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON journal_entry_lines(journal_entry_id);
    `);
    console.log('   ✅ accounting journal created.\n');

    // ====================================
    // 10. Multi-entity Holding Consolidation
    // ====================================
    console.log('🔟 Creating holding consolidation tables...');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS holding_groups (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            parent_company_id TEXT NOT NULL,
            description TEXT,
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS holding_members (
            id SERIAL PRIMARY KEY,
            holding_group_id INTEGER NOT NULL REFERENCES holding_groups(id),
            company_id TEXT NOT NULL,
            joined_at TIMESTAMP DEFAULT NOW(),
            role TEXT DEFAULT 'member' CHECK(role IN ('parent', 'member', 'subsidiary')),
            UNIQUE(holding_group_id, company_id)
        );
        CREATE INDEX IF NOT EXISTS idx_holding_members_group ON holding_members(holding_group_id);
        CREATE INDEX IF NOT EXISTS idx_holding_members_company ON holding_members(company_id);

        CREATE TABLE IF NOT EXISTS inter_company_transfers (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            holding_group_id INTEGER NOT NULL REFERENCES holding_groups(id),
            employee_id INTEGER NOT NULL REFERENCES employees(id),
            from_company_id TEXT NOT NULL,
            to_company_id TEXT NOT NULL,
            transfer_date DATE NOT NULL,
            transfer_type TEXT DEFAULT 'permanent' CHECK(transfer_type IN ('permanent', 'temporary', 'secondment')),
            end_date DATE,
            salary_change_czk INTEGER,
            status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'completed', 'cancelled')),
            approved_by INTEGER REFERENCES users(id),
            notes TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_transfers_holding ON inter_company_transfers(holding_group_id);
        CREATE INDEX IF NOT EXISTS idx_transfers_employee ON inter_company_transfers(employee_id);
    `);
    console.log('   ✅ holding consolidation created.\n');

    // ====================================
    // 11. Default CZ chart of accounts (payroll-related)
    // ====================================
    console.log('1️⃣ 1️⃣  Seeding default CZ chart of accounts...');
    const defaultAccounts = [
        // Mzdové náklady
        ['521', 'Mzdové náklady', 'expense'],
        ['522', 'Příjmy společníků ze závislé činnosti', 'expense'],
        ['523', 'Odměny členům orgánů', 'expense'],
        ['524', 'Zákonné sociální pojištění', 'expense'],
        ['525', 'Ostatní sociální pojištění', 'expense'],
        ['527', 'Zákonné sociální náklady', 'expense'],
        ['528', 'Ostatní sociální náklady', 'expense'],
        // Závazky
        ['331', 'Zaměstnanci - mzdy', 'liability'],
        ['333', 'Ostatní závazky vůči zaměstnancům', 'liability'],
        ['336', 'Zúčtování s institucemi SP a ZP', 'liability'],
        ['342', 'Ostatní přímé daně', 'liability'],
        // Bankovní účet
        ['221', 'Bankovní účty', 'asset'],
        // Stravenky
        ['213', 'Ceniny (stravenky)', 'asset'],
    ];

    for (const [num, name, type] of defaultAccounts) {
        await db.run(`
            INSERT INTO chart_of_accounts (uuid, company_id, account_number, name, type)
            VALUES (?, '__default__', ?, ?, ?)
            ON CONFLICT (company_id, account_number) DO NOTHING
        `, [require('crypto').randomUUID(), num, name, type]);
    }
    console.log('   ✅ default chart of accounts seeded.\n');

    console.log('✅ All industry gap feature tables created successfully!');
}

migrate()
    .then(() => {
        console.log('\n🎉 Migration 005 complete!');
        process.exit(0);
    })
    .catch(err => {
        console.error('❌ Migration failed:', err);
        process.exit(1);
    });
