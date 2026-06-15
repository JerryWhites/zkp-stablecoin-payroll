// ====================================
// 📦 Migration 004: Advanced Features
// ====================================
// Tables for: API Keys, Scheduled Payroll, Custom Reports,
// Webhooks, Multi-sig Approval, White-label, Dedicated Manager,
// SLA Monitoring
//
// Run: node migrations/004-advanced-features.js

'use strict';

const db = require('../db');
require('dotenv').config();

async function migrate() {
    console.log('🚀 Starting Advanced Features migration...\n');

    // ====================================
    // 1. API Keys for third-party access
    // ====================================
    console.log('1️⃣  Creating api_keys table...');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS api_keys (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            company_id TEXT NOT NULL,
            user_id INTEGER NOT NULL REFERENCES users(id),
            name TEXT NOT NULL,
            key_hash TEXT NOT NULL,
            key_prefix TEXT NOT NULL,
            permissions TEXT DEFAULT '[]',
            rate_limit_per_hour INTEGER DEFAULT 1000,
            is_active INTEGER DEFAULT 1,
            last_used_at TIMESTAMP,
            expires_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW(),
            revoked_at TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_api_keys_company ON api_keys(company_id);
        CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);
        CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
    `);
    console.log('   ✅ api_keys created.\n');

    // ====================================
    // 2. Scheduled Payroll (auto payroll)
    // ====================================
    console.log('2️⃣  Creating scheduled_payrolls table...');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS scheduled_payrolls (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            company_id TEXT NOT NULL,
            created_by INTEGER NOT NULL REFERENCES users(id),
            name TEXT NOT NULL DEFAULT 'Měsíční výplaty',
            cron_expression TEXT NOT NULL DEFAULT '0 8 25 * *',
            day_of_month INTEGER DEFAULT 25,
            hour INTEGER DEFAULT 8,
            minute INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            auto_calculate INTEGER DEFAULT 1,
            auto_lock INTEGER DEFAULT 0,
            notify_before_hours INTEGER DEFAULT 24,
            last_run_at TIMESTAMP,
            next_run_at TIMESTAMP,
            last_run_status TEXT CHECK(last_run_status IN ('success', 'failed', 'partial', 'skipped')),
            last_run_error TEXT,
            run_count INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_scheduled_payrolls_company ON scheduled_payrolls(company_id);
        CREATE INDEX IF NOT EXISTS idx_scheduled_payrolls_next_run ON scheduled_payrolls(next_run_at);

        CREATE TABLE IF NOT EXISTS scheduled_payroll_runs (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            schedule_id INTEGER NOT NULL REFERENCES scheduled_payrolls(id),
            payroll_period_id INTEGER REFERENCES payroll_periods(id),
            status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'success', 'failed', 'skipped')),
            started_at TIMESTAMP DEFAULT NOW(),
            completed_at TIMESTAMP,
            employees_processed INTEGER DEFAULT 0,
            error_message TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        );
    `);
    console.log('   ✅ scheduled_payrolls created.\n');

    // ====================================
    // 3. Custom Report Templates
    // ====================================
    console.log('3️⃣  Creating report_templates table...');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS report_templates (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            company_id TEXT NOT NULL,
            created_by INTEGER NOT NULL REFERENCES users(id),
            name TEXT NOT NULL,
            description TEXT,
            type TEXT DEFAULT 'table' CHECK(type IN ('table', 'summary', 'chart', 'pdf')),
            data_source TEXT NOT NULL CHECK(data_source IN ('payroll_items', 'employees', 'payroll_periods', 'deductions', 'vacations', 'osvc', 'audit_log')),
            columns TEXT NOT NULL DEFAULT '[]',
            filters TEXT NOT NULL DEFAULT '[]',
            group_by TEXT,
            sort_by TEXT,
            sort_order TEXT DEFAULT 'asc' CHECK(sort_order IN ('asc', 'desc')),
            chart_type TEXT CHECK(chart_type IN ('bar', 'line', 'pie', 'doughnut')),
            is_public INTEGER DEFAULT 0,
            is_default INTEGER DEFAULT 0,
            schedule_cron TEXT,
            schedule_email TEXT,
            last_generated_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_report_templates_company ON report_templates(company_id);

        CREATE TABLE IF NOT EXISTS generated_reports (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            template_id INTEGER REFERENCES report_templates(id),
            company_id TEXT NOT NULL,
            generated_by INTEGER REFERENCES users(id),
            name TEXT NOT NULL,
            format TEXT DEFAULT 'json' CHECK(format IN ('json', 'csv', 'pdf', 'xlsx')),
            row_count INTEGER DEFAULT 0,
            file_path TEXT,
            file_size INTEGER,
            parameters TEXT DEFAULT '{}',
            created_at TIMESTAMP DEFAULT NOW(),
            expires_at TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_generated_reports_company ON generated_reports(company_id);
        CREATE INDEX IF NOT EXISTS idx_generated_reports_template ON generated_reports(template_id);
    `);
    console.log('   ✅ report_templates created.\n');

    // ====================================
    // 4. Webhooks
    // ====================================
    console.log('4️⃣  Creating webhooks tables...');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS webhooks (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            company_id TEXT NOT NULL,
            created_by INTEGER NOT NULL REFERENCES users(id),
            name TEXT NOT NULL,
            url TEXT NOT NULL,
            secret TEXT NOT NULL,
            events TEXT NOT NULL DEFAULT '[]',
            is_active INTEGER DEFAULT 1,
            retry_count INTEGER DEFAULT 3,
            timeout_ms INTEGER DEFAULT 10000,
            last_triggered_at TIMESTAMP,
            last_status_code INTEGER,
            failure_count INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_webhooks_company ON webhooks(company_id);

        CREATE TABLE IF NOT EXISTS webhook_deliveries (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            webhook_id INTEGER NOT NULL REFERENCES webhooks(id),
            event_type TEXT NOT NULL,
            payload TEXT NOT NULL,
            response_status INTEGER,
            response_body TEXT,
            attempt INTEGER DEFAULT 1,
            delivered_at TIMESTAMP,
            next_retry_at TIMESTAMP,
            status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'delivered', 'failed', 'retrying')),
            error_message TEXT,
            duration_ms INTEGER,
            created_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id);
        CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(status);
    `);
    console.log('   ✅ webhooks created.\n');

    // ====================================
    // 5. Multi-sig Approval Workflow
    // ====================================
    console.log('5️⃣  Creating multi-sig approval tables...');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS approval_policies (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            company_id TEXT NOT NULL,
            name TEXT NOT NULL DEFAULT 'Schvalování výplat',
            resource_type TEXT NOT NULL DEFAULT 'payroll' CHECK(resource_type IN ('payroll', 'employee_add', 'employee_edit', 'expense', 'settings')),
            required_approvals INTEGER NOT NULL DEFAULT 2,
            auto_approve_below_czk INTEGER,
            approver_user_ids TEXT NOT NULL DEFAULT '[]',
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_approval_policies_company ON approval_policies(company_id);

        CREATE TABLE IF NOT EXISTS approval_requests (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            policy_id INTEGER NOT NULL REFERENCES approval_policies(id),
            company_id TEXT NOT NULL,
            requested_by INTEGER NOT NULL REFERENCES users(id),
            resource_type TEXT NOT NULL,
            resource_id TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            amount_czk DOUBLE PRECISION,
            status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'expired', 'cancelled')),
            approved_count INTEGER DEFAULT 0,
            rejected_count INTEGER DEFAULT 0,
            expires_at TIMESTAMP,
            resolved_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_approval_requests_company ON approval_requests(company_id);
        CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status);

        CREATE TABLE IF NOT EXISTS approval_votes (
            id SERIAL PRIMARY KEY,
            request_id INTEGER NOT NULL REFERENCES approval_requests(id),
            user_id INTEGER NOT NULL REFERENCES users(id),
            vote TEXT NOT NULL CHECK(vote IN ('approve', 'reject')),
            comment TEXT,
            voted_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(request_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_approval_votes_request ON approval_votes(request_id);
    `);
    console.log('   ✅ multi-sig approval created.\n');

    // ====================================
    // 6. White-label Configuration
    // ====================================
    console.log('6️⃣  Creating white-label tables...');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS whitelabel_config (
            id SERIAL PRIMARY KEY,
            company_id TEXT UNIQUE NOT NULL,
            brand_name TEXT,
            logo_url TEXT,
            favicon_url TEXT,
            primary_color TEXT DEFAULT '#dc2626',
            secondary_color TEXT DEFAULT '#1e293b',
            accent_color TEXT DEFAULT '#f59e0b',
            font_family TEXT DEFAULT 'Inter',
            custom_domain TEXT,
            custom_css TEXT,
            email_from_name TEXT,
            email_from_address TEXT,
            footer_text TEXT,
            support_email TEXT,
            support_url TEXT,
            hide_powered_by INTEGER DEFAULT 0,
            custom_login_bg TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
    `);
    console.log('   ✅ whitelabel_config created.\n');

    // ====================================
    // 7. Dedicated Manager Assignment
    // ====================================
    console.log('7️⃣  Creating dedicated_managers table...');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS dedicated_managers (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            company_id TEXT NOT NULL,
            manager_name TEXT NOT NULL,
            manager_email TEXT NOT NULL,
            manager_phone TEXT,
            manager_photo_url TEXT,
            availability TEXT DEFAULT 'business_hours' CHECK(availability IN ('business_hours', 'extended', '24_7')),
            specializations TEXT DEFAULT '[]',
            notes TEXT,
            assigned_at TIMESTAMP DEFAULT NOW(),
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_dedicated_managers_company ON dedicated_managers(company_id);

        CREATE TABLE IF NOT EXISTS manager_messages (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            manager_id INTEGER NOT NULL REFERENCES dedicated_managers(id),
            company_id TEXT NOT NULL,
            user_id INTEGER REFERENCES users(id),
            direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
            subject TEXT,
            message TEXT NOT NULL,
            is_read INTEGER DEFAULT 0,
            read_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_manager_messages_company ON manager_messages(company_id);
        CREATE INDEX IF NOT EXISTS idx_manager_messages_manager ON manager_messages(manager_id);
    `);
    console.log('   ✅ dedicated_managers created.\n');

    // ====================================
    // 8. SLA Monitoring
    // ====================================
    console.log('8️⃣  Creating SLA monitoring tables...');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS sla_checks (
            id SERIAL PRIMARY KEY,
            check_type TEXT NOT NULL CHECK(check_type IN ('http', 'db', 'api', 'full')),
            status TEXT NOT NULL CHECK(status IN ('up', 'down', 'degraded')),
            response_time_ms INTEGER,
            error_message TEXT,
            metadata TEXT DEFAULT '{}',
            checked_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_sla_checks_type ON sla_checks(check_type);
        CREATE INDEX IF NOT EXISTS idx_sla_checks_time ON sla_checks(checked_at);

        CREATE TABLE IF NOT EXISTS sla_incidents (
            id SERIAL PRIMARY KEY,
            uuid TEXT UNIQUE NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            severity TEXT DEFAULT 'minor' CHECK(severity IN ('minor', 'major', 'critical')),
            status TEXT DEFAULT 'investigating' CHECK(status IN ('investigating', 'identified', 'monitoring', 'resolved')),
            started_at TIMESTAMP DEFAULT NOW(),
            resolved_at TIMESTAMP,
            duration_minutes INTEGER,
            affected_services TEXT DEFAULT '[]',
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS sla_monthly_reports (
            id SERIAL PRIMARY KEY,
            year INTEGER NOT NULL,
            month INTEGER NOT NULL,
            total_checks INTEGER DEFAULT 0,
            successful_checks INTEGER DEFAULT 0,
            uptime_percentage DOUBLE PRECISION DEFAULT 100.0,
            avg_response_time_ms INTEGER DEFAULT 0,
            p95_response_time_ms INTEGER DEFAULT 0,
            p99_response_time_ms INTEGER DEFAULT 0,
            incidents_count INTEGER DEFAULT 0,
            total_downtime_minutes INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(year, month)
        );
    `);
    console.log('   ✅ SLA monitoring created.\n');

    console.log('✅ All advanced feature tables created successfully!');
}

migrate()
    .then(() => {
        console.log('\n🎉 Migration 004 complete!');
        process.exit(0);
    })
    .catch(err => {
        console.error('❌ Migration failed:', err);
        process.exit(1);
    });
