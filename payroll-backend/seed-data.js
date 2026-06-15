// ====================================
// Seed script: Create company + employees for whitesjerrysa@gmail.com
// ====================================
'use strict';
require('dotenv').config();
const crypto = require('crypto');
const db = require('./db');
const { getOrCreateCompanyKey, encryptFields, EMPLOYEE_ENCRYPTED_FIELDS, COMPANY_ENCRYPTED_FIELDS } = require('./services/encryption');

async function seed() {
    console.log('🌱 Seeding CZ Payroll data for whitesjerrysa@gmail.com...\n');

    // 1. Get the user
    const user = await db.getOne("SELECT id, company_id FROM users WHERE email = $1", ['whitesjerrysa@gmail.com']);
    if (!user) {
        console.error('❌ User not found!');
        process.exit(1);
    }
    console.log(`✅ User found: id=${user.id}, current company_id=${user.company_id}`);

    // 2. Create company (or reuse existing one linked to the user)
    let companyId, companyUuid;
    const existingCompany = user.company_id && user.company_id !== 'default'
        ? await db.getOne('SELECT id, uuid FROM companies WHERE id = $1', [parseInt(user.company_id)])
        : null;

    if (existingCompany) {
        companyId = existingCompany.id;
        companyUuid = existingCompany.uuid;
        console.log(`\n📦 Reusing existing company id=${companyId}`);
    } else {
        companyUuid = crypto.randomUUID();
        console.log('\n📦 Creating company...');
        await db.run(`
            INSERT INTO companies (uuid, name, tier, max_employees, billing_period)
            VALUES ($1, $2, $3, $4, $5)
        `, [companyUuid, 'TechDemo s.r.o.', 'pro', 30, 'monthly']);
        const company = await db.getOne('SELECT id FROM companies WHERE uuid = $1', [companyUuid]);
        companyId = company.id;
    }
    const companyIdStr = String(companyId);
    console.log(`✅ Company created: id=${companyId}, uuid=${companyUuid}`);

    // 3. Update user's company_id to UUID (routes look up by UUID)
    await db.run('UPDATE users SET company_id = $1 WHERE id = $2', [companyUuid, user.id]);
    console.log(`✅ User linked to company ${companyId} (uuid: ${companyUuid})`);

    // 4. Get/create encryption key for company (keyed by UUID)
    const companyKey = await getOrCreateCompanyKey(companyUuid);
    console.log('✅ Company encryption key ready');

    // 5. Add CZ company details (encrypted bank accounts)
    const companyData = {
        bank_account_salary: '2100267895/0800',
        bank_account_tax: '7691022/0710',
        bank_account_social: '7691022/0710',
        bank_account_health: '2100267895/0800',
    };
    const encCompany = encryptFields({ ...companyData }, COMPANY_ENCRYPTED_FIELDS, companyKey);
    
    await db.run(`
        UPDATE companies SET
            ico = $1, dic = $2,
            sidlo_ulice = $3, sidlo_mesto = $4, sidlo_psc = $5,
            bank_account_salary = $6, bank_account_tax = $7,
            bank_account_social = $8, bank_account_health = $9,
            fu_code = $10, ossz_code = $11, default_zp_code = $12,
            setup_completed = 1
        WHERE id = $13
    `, [
        '27074358', 'CZ27074358',
        'Technická 12', 'Praha 6', '16000',
        encCompany.bank_account_salary, encCompany.bank_account_tax,
        encCompany.bank_account_social, encCompany.bank_account_health,
        '451', 'PAHA', '111',
        companyIdStr
    ]);
    console.log('✅ Company CZ details updated (IČO, sídlo, bank accounts)');

    // 6. Create employees
    console.log('\n👥 Creating employees...\n');

    const employees = [
        {
            name: 'Jan Novák',
            email: 'jan.novak@techdemo.cz',
            osobni_cislo: 'E001',
            rodne_cislo: '900101/0007',
            datum_narozeni: '1990-01-01',
            adresa: 'Vinohradská 25, Praha 2, 12000',
            bank_account: '1234567890/0100',
            aleo_address: '',
            nastup: '2024-01-15',
            typ_uvazku: 'HPP',
            hruba_mzda_czk: 45000,
            uvazek_hodiny: 40,
            podepsane_prohlaseni: true,
            pocet_deti: 2,
            deti_ztp: 0,
            invalidita: 'none',
            sleva_student: false,
            zp_code: '111',
        },
        {
            name: 'Petra Svobodová',
            email: 'petra.svobodova@techdemo.cz',
            osobni_cislo: 'E002',
            rodne_cislo: '855615/0006',
            datum_narozeni: '1985-06-15',
            adresa: 'Na Příkopě 8, Praha 1, 11000',
            bank_account: '9876543210/0300',
            aleo_address: '',
            nastup: '2023-09-01',
            typ_uvazku: 'HPP',
            hruba_mzda_czk: 55000,
            uvazek_hodiny: 40,
            podepsane_prohlaseni: true,
            pocet_deti: 1,
            deti_ztp: 1,
            invalidita: 'none',
            sleva_student: false,
            zp_code: '207',
        },
        {
            name: 'Martin Dvořák',
            email: 'martin.dvorak@techdemo.cz',
            osobni_cislo: 'E003',
            rodne_cislo: '950320/0003',
            datum_narozeni: '1995-03-20',
            adresa: 'Lidická 42, Brno, 60200',
            bank_account: '5566778899/0600',
            aleo_address: '',
            nastup: '2025-02-01',
            typ_uvazku: 'HPP',
            hruba_mzda_czk: 38000,
            uvazek_hodiny: 30,
            podepsane_prohlaseni: true,
            pocet_deti: 0,
            deti_ztp: 0,
            invalidita: 'none',
            sleva_student: false,
            zp_code: '111',
        },
        {
            name: 'Eva Černá',
            email: 'eva.cerna@techdemo.cz',
            osobni_cislo: 'E004',
            rodne_cislo: '005208/0002',
            datum_narozeni: '2000-02-08',
            adresa: 'Masarykova 15, Ostrava, 70200',
            bank_account: '1122334455/0100',
            aleo_address: '',
            nastup: '2025-06-01',
            typ_uvazku: 'DPP',
            hruba_mzda_czk: 8000,
            uvazek_hodiny: 10,
            podepsane_prohlaseni: true,
            pocet_deti: 0,
            deti_ztp: 0,
            invalidita: 'none',
            sleva_student: true,
            zp_code: '211',
        },
        {
            name: 'Tomáš Procházka',
            email: 'tomas.prochazka@techdemo.cz',
            osobni_cislo: 'E005',
            rodne_cislo: '880712/0005',
            datum_narozeni: '1988-07-12',
            adresa: 'Husova 7, Plzeň, 30100',
            bank_account: '6677889900/0800',
            aleo_address: '',
            nastup: '2024-11-01',
            typ_uvazku: 'DPC',
            hruba_mzda_czk: 12000,
            uvazek_hodiny: 20,
            podepsane_prohlaseni: true,
            pocet_deti: 1,
            deti_ztp: 0,
            invalidita: 'none',
            sleva_student: false,
            zp_code: '205',
        },
    ];

    for (const emp of employees) {
        const uuid = crypto.randomUUID();
        const encData = encryptFields(
            { rodne_cislo: emp.rodne_cislo, adresa: emp.adresa, bank_account: emp.bank_account },
            EMPLOYEE_ENCRYPTED_FIELDS, companyKey
        );

        await db.run(`
            INSERT INTO employees (
                uuid, company_id, name, email, salary, aleo_address, status,
                osobni_cislo, rodne_cislo, datum_narozeni, adresa, bank_account,
                nastup, typ_uvazku, hruba_mzda_czk, uvazek_hodiny,
                podepsane_prohlaseni, pocet_deti, deti_ztp, invalidita, sleva_student, zp_code
            ) VALUES (
                $1, $2, $3, $4, $5, $6, 'active',
                $7, $8, $9, $10, $11,
                $12, $13, $14, $15,
                $16, $17, $18, $19, $20, $21
            )
            ON CONFLICT (uuid) DO NOTHING
        `, [
            uuid, companyUuid, emp.name, emp.email, emp.hruba_mzda_czk, emp.aleo_address || '',
            emp.osobni_cislo, encData.rodne_cislo, emp.datum_narozeni, encData.adresa, encData.bank_account,
            emp.nastup, emp.typ_uvazku, emp.hruba_mzda_czk, emp.uvazek_hodiny,
            emp.podepsane_prohlaseni ? 1 : 0, emp.pocet_deti, emp.deti_ztp, emp.invalidita,
            emp.sleva_student ? 1 : 0, emp.zp_code
        ]);
        console.log(`  ✅ ${emp.osobni_cislo} ${emp.name} (${emp.typ_uvazku}, ${emp.hruba_mzda_czk} CZK)`);
    }

    console.log(`\n🎉 Done! Created company "TechDemo s.r.o." with ${employees.length} employees.`);
    console.log('   Company ID:', companyId);
    console.log('   IČO: 27074358');
    console.log('   Employees: 3×HPP, 1×DPP, 1×DPČ');
    process.exit(0);
}

seed().catch(err => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
});
