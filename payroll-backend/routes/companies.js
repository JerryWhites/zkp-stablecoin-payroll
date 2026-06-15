// ====================================
// 🏢 Company Routes — CRUD + Setup
// ====================================

'use strict';

const express = require('express');
const { body } = require('express-validator');
const crypto = require('crypto');
const db = require('../db');
const { authenticateToken, requireRole, validate, auditLog } = require('../middleware/auth');
const { validateICO, validateBankAccount } = require('../services/payroll-engine');
const { getOrCreateCompanyKey, encryptCompanyData, decryptCompanyData } = require('../services/encryption');

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// ====================================
// GET /api/companies/current — Get current user's company
// ====================================
router.get('/current', async (req, res) => {
    try {
        const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
        if (!user?.company_id) {
            return res.status(404).json({ error: 'Žádná firma nebyla nalezena. Nejprve nastavte firmu.' });
        }

        const company = await db.getOne('SELECT * FROM companies WHERE uuid = ?', [user.company_id]);
        if (!company) {
            return res.status(404).json({ error: 'Firma nenalezena' });
        }

        // Decrypt sensitive fields
        try {
            const key = await getOrCreateCompanyKey(company.uuid);
            const decrypted = decryptCompanyData(company, key);
            // Mask account numbers for display (show last 4 chars)
            const masked = { ...decrypted };
            for (const field of ['bank_account_salary', 'bank_account_tax', 'bank_account_social', 'bank_account_health']) {
                if (masked[field] && masked[field].length > 4) {
                    // Don't mask — user needs to see their own data
                }
            }
            return res.json({ company: decrypted });
        } catch {
            // Encryption not set up yet — return plain data
            return res.json({ company });
        }
    } catch (error) {
        console.error('Get company error:', error);
        res.status(500).json({ error: 'Chyba při načítání firmy' });
    }
});

// ====================================
// POST /api/companies/setup — Create/update company profile
// ====================================
router.post('/setup', [
    body('name').trim().notEmpty().withMessage('Název firmy je povinný'),
    body('ico').trim().notEmpty().withMessage('IČO je povinné')
        .isLength({ min: 8, max: 8 }).withMessage('IČO musí mít 8 číslic')
        .matches(/^\d{8}$/).withMessage('IČO musí obsahovat pouze číslice'),
    body('sidlo_ulice').trim().optional({ values: 'falsy' }),
    body('sidlo_mesto').trim().optional({ values: 'falsy' }),
    body('sidlo_psc').trim().optional({ values: 'falsy' }).matches(/^\d{3}\s?\d{2}$/).withMessage('Neplatný formát PSČ'),
    body('bank_account_salary').trim().optional({ values: 'falsy' }),
    body('bank_account_tax').trim().optional({ values: 'falsy' }),
    body('bank_account_social').trim().optional({ values: 'falsy' }),
    body('bank_account_health').trim().optional({ values: 'falsy' }),
    body('fu_code').trim().optional({ values: 'falsy' }),
    body('ossz_code').trim().optional({ values: 'falsy' }),
    body('default_zp_code').trim().optional({ values: 'falsy' }),
    body('dic').trim().optional({ values: 'falsy' }),
    // Entity type fields
    body('entity_type').optional({ values: 'falsy' }).isIn(['osvc', 'sro', 'as', 'komanditni', 'vos']),
    body('hlavni_cinnost').optional({ values: 'null' }).isInt({ min: 0, max: 1 }),
    body('pausal_dan').optional({ values: 'null' }).isInt({ min: 0, max: 1 }),
    body('vydajovy_pausal_pct').optional({ values: 'null' }).isInt({ min: 0, max: 100 }),
    body('obor_cinnosti').optional({ values: 'falsy' }).trim(),
    body('zivnostensky_list').optional({ values: 'falsy' }).trim(),
    body('pravni_forma_detail').optional({ values: 'falsy' }).trim(),
    body('zakladni_kapital_czk').optional({ values: 'null' }).isInt({ min: 0 }),
    body('statutarni_organ').optional({ values: 'falsy' }).trim(),
    body('datum_zalozeni').optional({ values: 'falsy' }).isISO8601(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const {
            name, ico, dic, sidlo_ulice, sidlo_mesto, sidlo_psc,
            bank_account_salary, bank_account_tax, bank_account_social, bank_account_health,
            fu_code, ossz_code, default_zp_code,
            entity_type, hlavni_cinnost, pausal_dan, vydajovy_pausal_pct,
            obor_cinnosti, zivnostensky_list, pravni_forma_detail,
            zakladni_kapital_czk, statutarni_organ, datum_zalozeni,
        } = req.body;

        // Validate IČO checksum
        if (!validateICO(ico)) {
            return res.status(400).json({ error: 'Neplatné IČO (kontrolní součet nesedí)' });
        }

        const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [req.user.userId]);
        const hasExistingCompany = !!user?.company_id;
        let companyUuid = user?.company_id || crypto.randomUUID();

        const normalizedBankAccountSalary = bank_account_salary ? bank_account_salary.replace(/\s+/g, '') : null;
        const normalizedBankAccountTax = bank_account_tax ? bank_account_tax.replace(/\s+/g, '') : null;
        const normalizedBankAccountSocial = bank_account_social ? bank_account_social.replace(/\s+/g, '') : null;
        const normalizedBankAccountHealth = bank_account_health ? bank_account_health.replace(/\s+/g, '') : null;

        const companyAccounts = [
            normalizedBankAccountSalary,
            normalizedBankAccountTax,
            normalizedBankAccountSocial,
            normalizedBankAccountHealth,
        ];

        const hasInvalidAccount = companyAccounts.some((account) => account && !validateBankAccount(account));
        if (hasInvalidAccount) {
            return res.status(400).json({ error: 'Neplatný formát bankovního účtu (předčíslí-číslo/kód banky)' });
        }

        // Encrypt sensitive fields
        const key = await getOrCreateCompanyKey(companyUuid);

        const encData = encryptCompanyData({
            bank_account_salary: normalizedBankAccountSalary,
            bank_account_tax: normalizedBankAccountTax,
            bank_account_social: normalizedBankAccountSocial,
            bank_account_health: normalizedBankAccountHealth,
        }, key);

        if (hasExistingCompany) {
            // Update existing company
            await db.run(`
                UPDATE companies SET 
                    name = ?, ico = ?, dic = ?,
                    sidlo_ulice = ?, sidlo_mesto = ?, sidlo_psc = ?,
                    bank_account_salary = ?, bank_account_tax = ?,
                    bank_account_social = ?, bank_account_health = ?,
                    fu_code = ?, ossz_code = ?, default_zp_code = ?,
                    entity_type = COALESCE(?, entity_type),
                    hlavni_cinnost = COALESCE(?, hlavni_cinnost),
                    pausal_dan = COALESCE(?, pausal_dan),
                    vydajovy_pausal_pct = COALESCE(?, vydajovy_pausal_pct),
                    obor_cinnosti = COALESCE(?, obor_cinnosti),
                    zivnostensky_list = COALESCE(?, zivnostensky_list),
                    pravni_forma_detail = COALESCE(?, pravni_forma_detail),
                    zakladni_kapital_czk = COALESCE(?, zakladni_kapital_czk),
                    statutarni_organ = COALESCE(?, statutarni_organ),
                    datum_zalozeni = COALESCE(?, datum_zalozeni),
                    setup_completed = 1, updated_at = NOW()
                WHERE uuid = ?
            `, [
                name, ico, dic || null,
                sidlo_ulice || null, sidlo_mesto || null, sidlo_psc || null,
                encData.bank_account_salary, encData.bank_account_tax,
                encData.bank_account_social, encData.bank_account_health,
                fu_code || null, ossz_code || null, default_zp_code || '111',
                entity_type || null,
                hlavni_cinnost !== undefined ? hlavni_cinnost : null,
                pausal_dan !== undefined ? pausal_dan : null,
                vydajovy_pausal_pct !== undefined ? vydajovy_pausal_pct : null,
                obor_cinnosti || null,
                zivnostensky_list || null,
                pravni_forma_detail || null,
                zakladni_kapital_czk !== undefined ? zakladni_kapital_czk : null,
                statutarni_organ || null,
                datum_zalozeni || null,
                companyUuid,
            ]);
        } else {
            // Create new company
            await db.run(`
                INSERT INTO companies (uuid, name, ico, dic, sidlo_ulice, sidlo_mesto, sidlo_psc,
                    bank_account_salary, bank_account_tax, bank_account_social, bank_account_health,
                    fu_code, ossz_code, default_zp_code, tier, max_employees, setup_completed,
                    entity_type, hlavni_cinnost, pausal_dan, vydajovy_pausal_pct,
                    obor_cinnosti, zivnostensky_list, pravni_forma_detail,
                    zakladni_kapital_czk, statutarni_organ, datum_zalozeni)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'start', 10, 1,
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                companyUuid, name, ico, dic || null,
                sidlo_ulice || null, sidlo_mesto || null, sidlo_psc || null,
                encData.bank_account_salary, encData.bank_account_tax,
                encData.bank_account_social, encData.bank_account_health,
                fu_code || null, ossz_code || null, default_zp_code || '111',
                entity_type || 'sro',
                hlavni_cinnost !== undefined ? hlavni_cinnost : 1,
                pausal_dan || 0,
                vydajovy_pausal_pct || 60,
                obor_cinnosti || null,
                zivnostensky_list || null,
                pravni_forma_detail || null,
                zakladni_kapital_czk || 0,
                statutarni_organ || null,
                datum_zalozeni || null,
            ]);

            // Link user to company
            await db.run('UPDATE users SET company_id = ? WHERE id = ?', [companyUuid, req.user.userId]);

            // Initialize credit balance
            await db.run(`
                INSERT INTO credit_balance (company_id, balance_czk)
                VALUES (?, 0.00)
                ON CONFLICT (company_id) DO NOTHING
            `, [companyUuid]);
        }

        await auditLog('COMPANY_SETUP', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'company',
            resourceId: companyUuid,
            ip: req.ip,
            metadata: { ico, name },
        });

        // Return updated company
        const company = await db.getOne('SELECT * FROM companies WHERE uuid = ?', [companyUuid]);
        const decrypted = decryptCompanyData(company, key);
        res.json({ success: true, company: decrypted });

    } catch (error) {
        console.error('Company setup error:', error);
        res.status(500).json({ error: 'Chyba při nastavení firmy' });
    }
});

module.exports = router;
