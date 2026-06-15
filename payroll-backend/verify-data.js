'use strict';
require('dotenv').config();
const db = require('./db');

(async () => {
    const uuid = '5c0b8d6a-ddcc-4488-aa1e-52ef6df0b10c';

    // Fix user company_id to UUID
    await db.run('UPDATE users SET company_id = $1 WHERE id = 1', [uuid]);
    console.log('User company_id updated to UUID');

    // Fix employees company_id from '113' to UUID
    const updated = await db.run('UPDATE employees SET company_id = $1 WHERE company_id = $2', [uuid, '113']);
    console.log('Employees updated:', updated);

    // Copy/create encryption key for UUID (from PK '113')
    const oldKey = await db.getOne("SELECT key_enc FROM company_encryption_keys WHERE company_id = '113'");
    if (oldKey) {
        await db.run(
            "INSERT INTO company_encryption_keys (company_id, key_enc) VALUES ($1, $2) ON CONFLICT (company_id) DO UPDATE SET key_enc = EXCLUDED.key_enc",
            [uuid, oldKey.key_enc]
        );
        console.log('Encryption key copied to UUID key');
    }

    // Verify  
    const u = await db.getOne('SELECT company_id FROM users WHERE id = 1');
    console.log('User company_id:', u.company_id);

    const company = await db.getOne('SELECT id, uuid, name, ico, setup_completed FROM companies WHERE uuid = $1', [uuid]);
    console.log('Company:', company);

    const emps = await db.getAll('SELECT osobni_cislo, name, typ_uvazku, hruba_mzda_czk, company_id FROM employees WHERE company_id = $1', [uuid]);
    console.log('Employees:', emps.length);
    for (const e of emps) {
        console.log(`  ${e.osobni_cislo} ${e.name} (${e.typ_uvazku}, ${e.hruba_mzda_czk} CZK) [company_id: ${e.company_id}]`);
    }

    const keys = await db.getAll('SELECT company_id FROM company_encryption_keys');
    console.log('Encryption keys:', keys.map(k => k.company_id));

    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
