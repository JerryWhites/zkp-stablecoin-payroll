// Quick script to check constraints and fix demo data seeding
'use strict';
require('dotenv').config();
const db = require('./db');

async function main() {
    try {
        // Check the companies_tier_check constraint
        const constraints = await db.getAll(
            `SELECT conname, pg_get_constraintdef(oid) as def 
             FROM pg_constraint 
             WHERE conrelid = 'companies'::regclass AND contype = 'c'`
        );
        console.log('Companies constraints:');
        for (const c of constraints) {
            console.log(`  ${c.conname}: ${c.def}`);
        }

        // Check existing companies
        const companies = await db.getAll('SELECT id, uuid, name, tier FROM companies LIMIT 5');
        console.log('\nExisting companies:', JSON.stringify(companies, null, 2));

        // Check the user
        const user = await db.getOne("SELECT id, email, company_id, role FROM users WHERE email = 'whitesjerrysa@gmail.com'");
        console.log('\nUser:', JSON.stringify(user, null, 2));

        // Check existing employees
        const employees = await db.getAll('SELECT id, uuid, name, company_id, typ_uvazku, hruba_mzda_czk FROM employees LIMIT 10');
        console.log('\nExisting employees:', JSON.stringify(employees, null, 2));

    } catch (err) {
        console.error('Error:', err.message);
    }
    process.exit(0);
}

main();
