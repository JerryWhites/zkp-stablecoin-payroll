// ====================================
// 👥 Employee Routes — Extended CRUD for CZ Payroll
// ====================================

'use strict';

const express = require('express');
const { body, param } = require('express-validator');
const crypto = require('crypto');
const db = require('../db');
const { authenticateToken, requireRole, validate, auditLog } = require('../middleware/auth');
const { validateRodneCislo, validateBankAccount, validateEmployee } = require('../services/payroll-engine');
const { getOrCreateCompanyKey, encryptEmployeeData, decryptEmployeeData } = require('../services/encryption');

const router = express.Router();
router.use(authenticateToken);

// Helper: get user's company_id
async function getCompanyId(userId) {
    const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [userId]);
    return user?.company_id;
}

// ====================================
// GET /api/v2/employees — List all employees for current company
// ====================================
router.get('/', async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const employees = await db.getAll(
            `SELECT * FROM employees WHERE company_id = ? AND status != 'terminated' ORDER BY osobni_cislo, name`,
            [companyId]
        );

        // Decrypt PII
        let decrypted = employees;
        try {
            const key = await getOrCreateCompanyKey(companyId);
            decrypted = employees.map(e => decryptEmployeeData(e, key));
        } catch { /* encryption not set up — return plain */ }

        res.json({ employees: decrypted });
    } catch (error) {
        console.error('List employees error:', error);
        res.status(500).json({ error: 'Chyba při načítání zaměstnanců' });
    }
});

// ====================================
// GET /api/v2/employees/:uuid — Get single employee
// ====================================
router.get('/:uuid', [
    param('uuid').trim().notEmpty(),
], validate, async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const employee = await db.getOne(
            'SELECT * FROM employees WHERE uuid = ? AND company_id = ?',
            [req.params.uuid, companyId]
        );

        if (!employee) return res.status(404).json({ error: 'Zaměstnanec nenalezen' });

        try {
            const key = await getOrCreateCompanyKey(companyId);
            const decrypted = decryptEmployeeData(employee, key);
            return res.json({ employee: decrypted });
        } catch {
            return res.json({ employee });
        }
    } catch (error) {
        console.error('Get employee error:', error);
        res.status(500).json({ error: 'Chyba při načítání zaměstnance' });
    }
});

// ====================================
// POST /api/v2/employees — Create new employee
// ====================================
router.post('/', [
    body('name').trim().notEmpty().withMessage('Jméno je povinné'),
    body('typ_uvazku').isIn(['HPP', 'DPP', 'DPC']).withMessage('Neplatný typ úvazku'),
    body('hruba_mzda_czk').isInt({ min: 0 }).withMessage('Hrubá mzda musí být kladné číslo'),
    body('email').optional({ values: 'falsy' }).isEmail().withMessage('Neplatný email'),
    body('rodne_cislo').optional({ values: 'falsy' }).trim(),
    body('datum_narozeni').optional({ values: 'falsy' }).isDate().withMessage('Neplatné datum'),
    body('adresa').optional({ values: 'falsy' }).trim(),
    body('bank_account').optional({ values: 'falsy' }).trim(),
    body('aleo_address').optional({ values: 'falsy' }).trim(),
    body('nastup').optional({ values: 'falsy' }).isDate().withMessage('Neplatné datum nástupu'),
    body('uvazek_hodiny').optional().isInt({ min: 1, max: 40 }).withMessage('Úvazek 1-40 hodin'),
    body('podepsane_prohlaseni').optional().isBoolean(),
    body('pocet_deti').optional().isInt({ min: 0 }).withMessage('Počet dětí ≥ 0'),
    body('deti_ztp').optional().isInt({ min: 0 }),
    body('invalidita').optional().isIn(['none', '1-2', '3', 'ztp-p']),
    body('sleva_student').optional().isBoolean(),
    body('zp_code').optional().trim(),
    body('osobni_cislo').optional({ values: 'falsy' }).trim(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const {
            name, typ_uvazku, hruba_mzda_czk, email,
            rodne_cislo, datum_narozeni, adresa, bank_account, aleo_address,
            nastup, uvazek_hodiny, podepsane_prohlaseni,
            pocet_deti, deti_ztp, invalidita, sleva_student,
            zp_code, osobni_cislo,
        } = req.body;

        // Validate RČ if provided
        if (rodne_cislo && !validateRodneCislo(rodne_cislo)) {
            return res.status(400).json({ error: 'Neplatné rodné číslo' });
        }

        // Validate bank account if provided
        if (bank_account && !validateBankAccount(bank_account)) {
            return res.status(400).json({ error: 'Neplatný formát bankovního účtu (předčíslí-číslo/kód banky)' });
        }

        // Validate employee data for payroll
        const empValidation = validateEmployee({
            typ_uvazku,
            hruba_mzda_czk: parseInt(hruba_mzda_czk),
            pocet_deti: pocet_deti || 0,
            deti_ztp: deti_ztp || 0,
            invalidita: invalidita || 'none',
        });
        if (empValidation.length > 0) {
            return res.status(400).json({ error: 'Validace selhala', details: empValidation });
        }

        const uuid = crypto.randomUUID();

        // Encrypt PII
        const key = await getOrCreateCompanyKey(companyId);
        const encData = encryptEmployeeData({
            rodne_cislo: rodne_cislo || null,
            adresa: adresa || null,
            bank_account: bank_account || null,
        }, key);

        await db.run(`
            INSERT INTO employees (
                uuid, company_id, name, email, salary, aleo_address,
                rodne_cislo, datum_narozeni, adresa, bank_account,
                nastup, typ_uvazku, hruba_mzda_czk, uvazek_hodiny,
                podepsane_prohlaseni, pocet_deti, deti_ztp, invalidita,
                sleva_student, zp_code, osobni_cislo, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
        `, [
            uuid, companyId, name, email || null, parseInt(hruba_mzda_czk), aleo_address || '',
            encData.rodne_cislo, datum_narozeni || null, encData.adresa, encData.bank_account,
            nastup || null, typ_uvazku, parseInt(hruba_mzda_czk), uvazek_hodiny || 40,
            podepsane_prohlaseni ? 1 : 0, pocet_deti || 0, deti_ztp || 0, invalidita || 'none',
            sleva_student ? 1 : 0, zp_code || '111', osobni_cislo || null,
        ]);

        await auditLog('EMPLOYEE_CREATED', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'employee',
            resourceId: uuid,
            ip: req.ip,
            metadata: { name, typ_uvazku },
        });

        const employee = await db.getOne('SELECT * FROM employees WHERE uuid = ?', [uuid]);
        const decrypted = decryptEmployeeData(employee, key);
        res.status(201).json({ success: true, employee: decrypted });

    } catch (error) {
        console.error('Create employee error:', error);
        res.status(500).json({ error: 'Chyba při vytváření zaměstnance' });
    }
});

// ====================================
// PUT /api/v2/employees/:uuid — Update employee
// ====================================
router.put('/:uuid', [
    param('uuid').trim().notEmpty(),
    body('name').optional().trim().notEmpty(),
    body('typ_uvazku').optional().isIn(['HPP', 'DPP', 'DPC']),
    body('hruba_mzda_czk').optional().isInt({ min: 0 }),
    body('email').optional({ values: 'falsy' }).isEmail(),
    body('podepsane_prohlaseni').optional().isBoolean(),
    body('pocet_deti').optional().isInt({ min: 0 }),
    body('deti_ztp').optional().isInt({ min: 0 }),
    body('invalidita').optional().isIn(['none', '1-2', '3', 'ztp-p']),
    body('status').optional().isIn(['active', 'inactive', 'terminated']),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const existing = await db.getOne(
            'SELECT * FROM employees WHERE uuid = ? AND company_id = ?',
            [req.params.uuid, companyId]
        );
        if (!existing) return res.status(404).json({ error: 'Zaměstnanec nenalezen' });

        const key = await getOrCreateCompanyKey(companyId);
        const updates = {};
        const allowedFields = [
            'name', 'email', 'typ_uvazku', 'hruba_mzda_czk', 'uvazek_hodiny',
            'podepsane_prohlaseni', 'pocet_deti', 'deti_ztp', 'invalidita',
            'sleva_student', 'zp_code', 'osobni_cislo', 'datum_narozeni',
            'nastup', 'ukonceni', 'aleo_address', 'status',
        ];
        const encFields = ['rodne_cislo', 'adresa', 'bank_account'];

        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                updates[field] = req.body[field];
            }
        }

        // Handle encrypted fields
        for (const field of encFields) {
            if (req.body[field] !== undefined) {
                const encData = encryptEmployeeData({ [field]: req.body[field] }, key);
                updates[field] = encData[field];
            }
        }

        // Also update salary when hruba_mzda_czk changes (legacy compatibility)
        if (updates.hruba_mzda_czk !== undefined) {
            updates.salary = parseInt(updates.hruba_mzda_czk);
        }

        // Boolean fields: convert to integer
        if (updates.podepsane_prohlaseni !== undefined) {
            updates.podepsane_prohlaseni = updates.podepsane_prohlaseni ? 1 : 0;
        }
        if (updates.sleva_student !== undefined) {
            updates.sleva_student = updates.sleva_student ? 1 : 0;
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'Žádné údaje k aktualizaci' });
        }

        // Build dynamic UPDATE query
        const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 1}`);
        setClauses.push('updated_at = NOW()');
        const values = Object.values(updates);
        values.push(req.params.uuid, companyId);

        await db.run(
            `UPDATE employees SET ${setClauses.join(', ')} WHERE uuid = $${values.length - 1} AND company_id = $${values.length}`,
            values
        );

        await auditLog('EMPLOYEE_UPDATED', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'employee',
            resourceId: req.params.uuid,
            ip: req.ip,
            metadata: { fields: Object.keys(updates) },
        });

        const updated = await db.getOne('SELECT * FROM employees WHERE uuid = ?', [req.params.uuid]);
        const decrypted = decryptEmployeeData(updated, key);
        res.json({ success: true, employee: decrypted });

    } catch (error) {
        console.error('Update employee error:', error);
        res.status(500).json({ error: 'Chyba při aktualizaci zaměstnance' });
    }
});

// ====================================
// DELETE /api/v2/employees/:uuid — Soft delete (terminate)
// ====================================
router.delete('/:uuid', [
    param('uuid').trim().notEmpty(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const existing = await db.getOne(
            'SELECT id FROM employees WHERE uuid = ? AND company_id = ?',
            [req.params.uuid, companyId]
        );
        if (!existing) return res.status(404).json({ error: 'Zaměstnanec nenalezen' });

        await db.run(
            `UPDATE employees SET status = 'terminated', ukonceni = CURRENT_DATE, updated_at = NOW() WHERE uuid = ? AND company_id = ?`,
            [req.params.uuid, companyId]
        );

        await auditLog('EMPLOYEE_TERMINATED', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'employee',
            resourceId: req.params.uuid,
            ip: req.ip,
        });

        res.json({ success: true, message: 'Zaměstnanec ukončen' });
    } catch (error) {
        console.error('Delete employee error:', error);
        res.status(500).json({ error: 'Chyba při ukončování zaměstnance' });
    }
});

// ====================================
// POST /api/v2/employees/import — Bulk CSV import
// 🔐 FIXED: Added requireRole — only admin/employer can bulk import
// ====================================
router.post('/import', requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const { employees } = req.body;
        if (!Array.isArray(employees) || employees.length === 0) {
            return res.status(400).json({ error: 'Prázdný seznam zaměstnanců' });
        }

        if (employees.length > 100) {
            return res.status(400).json({ error: 'Maximální počet zaměstnanců pro import je 100' });
        }

        const key = await getOrCreateCompanyKey(companyId);
        const results = { created: 0, errors: [] };

        for (let i = 0; i < employees.length; i++) {
            const emp = employees[i];
            try {
                if (!emp.name) throw new Error('Jméno je povinné');
                if (!emp.typ_uvazku || !['HPP', 'DPP', 'DPC'].includes(emp.typ_uvazku)) {
                    emp.typ_uvazku = 'HPP'; // default
                }
                if (!emp.hruba_mzda_czk || emp.hruba_mzda_czk <= 0) throw new Error('Neplatná hrubá mzda');

                const uuid = crypto.randomUUID();
                const encData = encryptEmployeeData({
                    rodne_cislo: emp.rodne_cislo || null,
                    adresa: emp.adresa || null,
                    bank_account: emp.bank_account || null,
                }, key);

                await db.run(`
                    INSERT INTO employees (
                        uuid, company_id, name, email, salary, aleo_address,
                        rodne_cislo, adresa, bank_account,
                        nastup, typ_uvazku, hruba_mzda_czk, uvazek_hodiny,
                        podepsane_prohlaseni, pocet_deti, deti_ztp, invalidita,
                        sleva_student, zp_code, osobni_cislo, status
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
                `, [
                    uuid, companyId, emp.name, emp.email || null,
                    parseInt(emp.hruba_mzda_czk), emp.aleo_address || '',
                    encData.rodne_cislo, encData.adresa, encData.bank_account,
                    emp.nastup || null, emp.typ_uvazku, parseInt(emp.hruba_mzda_czk),
                    emp.uvazek_hodiny || 40, emp.podepsane_prohlaseni ? 1 : 0,
                    emp.pocet_deti || 0, emp.deti_ztp || 0, emp.invalidita || 'none',
                    emp.sleva_student ? 1 : 0, emp.zp_code || '111', emp.osobni_cislo || null,
                ]);
                results.created++;
            } catch (err) {
                results.errors.push({ row: i + 1, name: emp.name, error: err.message });
            }
        }

        await auditLog('EMPLOYEES_IMPORTED', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'employee',
            ip: req.ip,
            metadata: { total: employees.length, created: results.created, errors: results.errors.length },
        });

        res.json({ success: true, ...results });
    } catch (error) {
        console.error('Import employees error:', error);
        res.status(500).json({ error: 'Chyba při importu zaměstnanců' });
    }
});

// ====================================
// GET /api/v2/employees/:uuid/crypto-settings — Get employee crypto preferences
// ====================================
router.get('/:uuid/crypto-settings', [
    param('uuid').trim().notEmpty(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const emp = await db.getOne(
            `SELECT uuid, name, stablecoin_pct, preferred_token, wallet_address, crypto_opt_in, crypto_settings_updated_at
             FROM employees WHERE uuid = ? AND company_id = ?`,
            [req.params.uuid, companyId]
        );
        if (!emp) return res.status(404).json({ error: 'Zaměstnanec nenalezen' });

        res.json({
            uuid: emp.uuid,
            name: emp.name,
            stablecoin_pct: emp.stablecoin_pct || 0,
            preferred_token: emp.preferred_token || 'NONE',
            wallet_address: emp.wallet_address || null,
            crypto_opt_in: !!emp.crypto_opt_in,
            crypto_settings_updated_at: emp.crypto_settings_updated_at,
        });
    } catch (error) {
        console.error('Get crypto settings error:', error);
        res.status(500).json({ error: 'Chyba při načítání krypto nastavení' });
    }
});

// ====================================
// PUT /api/v2/employees/:uuid/crypto-settings — Update employee crypto preferences (HR/admin)
// ====================================
router.put('/:uuid/crypto-settings', [
    param('uuid').trim().notEmpty(),
    body('stablecoin_pct').isInt({ min: 0, max: 100 }).withMessage('Procento musí být 0-100'),
    body('preferred_token').isIn(['NONE', 'ALEO', 'USDCx']).withMessage('Neplatný token'),
    body('wallet_address').optional({ nullable: true }).trim(),
    body('crypto_opt_in').isBoolean().withMessage('crypto_opt_in musí být boolean'),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const emp = await db.getOne(
            'SELECT id, uuid FROM employees WHERE uuid = ? AND company_id = ?',
            [req.params.uuid, companyId]
        );
        if (!emp) return res.status(404).json({ error: 'Zaměstnanec nenalezen' });

        const { stablecoin_pct, preferred_token, wallet_address, crypto_opt_in } = req.body;

        // Validate: if opting in with a token, wallet address is required
        if (crypto_opt_in && preferred_token !== 'NONE' && stablecoin_pct > 0) {
            if (!wallet_address || wallet_address.trim().length === 0) {
                return res.status(400).json({ error: 'Wallet adresa je povinná pro krypto výplaty' });
            }
            // Basic Aleo address format check (aleo1... 63 chars)
            if (!/^aleo1[a-z0-9]{58}$/.test(wallet_address.trim())) {
                return res.status(400).json({ error: 'Neplatný formát Aleo adresy' });
            }
        }

        await db.run(`
            UPDATE employees SET
                stablecoin_pct = ?,
                preferred_token = ?,
                wallet_address = ?,
                crypto_opt_in = ?,
                crypto_settings_updated_at = NOW(),
                updated_at = NOW()
            WHERE id = ?
        `, [stablecoin_pct, preferred_token, wallet_address?.trim() || null, crypto_opt_in ? 1 : 0, emp.id]);

        await auditLog('EMPLOYEE_CRYPTO_SETTINGS_UPDATED', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'employee',
            resourceId: emp.uuid,
            ip: req.ip,
            metadata: { stablecoin_pct, preferred_token, crypto_opt_in },
        });

        res.json({ success: true, message: 'Krypto nastavení aktualizováno' });
    } catch (error) {
        console.error('Update crypto settings error:', error);
        res.status(500).json({ error: 'Chyba při aktualizaci krypto nastavení' });
    }
});

module.exports = router;
