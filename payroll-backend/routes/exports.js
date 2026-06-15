// ====================================
// 📄 Export Routes — PDF výplatnice, CSV bank export, ZIP
// ====================================

'use strict';

const express = require('express');
const { param, query } = require('express-validator');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { authenticateToken, requireRole, validate, auditLog } = require('../middleware/auth');
const { getOrCreateCompanyKey, decryptFields, EMPLOYEE_ENCRYPTED_FIELDS, COMPANY_ENCRYPTED_FIELDS } = require('../services/encryption');

const router = express.Router();
router.use(authenticateToken);

// Ensure exports directory exists
const EXPORTS_DIR = path.join(__dirname, '..', 'exports');
if (!fs.existsSync(EXPORTS_DIR)) {
    fs.mkdirSync(EXPORTS_DIR, { recursive: true });
}

// Helper: get user's company_id
async function getCompanyId(userId) {
    const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [userId]);
    return user?.company_id;
}

// Helper: load period with auth check
async function loadPeriod(uuid, companyId) {
    return db.getOne(
        'SELECT * FROM payroll_periods WHERE uuid = ? AND company_id = ?',
        [uuid, companyId]
    );
}

// Helper: months in Czech
const MONTHS_CZ = ['', 'Leden', 'Únor', 'Březen', 'Duben', 'Květen', 'Červen',
    'Červenec', 'Srpen', 'Září', 'Říjen', 'Listopad', 'Prosinec'];

// Helper: format CZK
function formatCZK(amount) {
    return new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK', minimumFractionDigits: 0 }).format(amount || 0);
}

// ====================================
// GET /api/v2/exports/vyplatnice/:period_uuid — Generate PDF payslips
// ====================================
router.get('/vyplatnice/:period_uuid', [
    param('period_uuid').trim().notEmpty(),
    query('employee_uuid').optional().trim(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const period = await loadPeriod(req.params.period_uuid, companyId);
        if (!period) return res.status(404).json({ error: 'Období nenalezeno' });
        if (period.status !== 'calculated' && period.status !== 'locked') {
            return res.status(400).json({ error: 'Nejprve musíte spočítat mzdy' });
        }

        // Load company data
        const company = await db.getOne('SELECT * FROM companies WHERE uuid = ?', [companyId]);
        const companyKey = await getOrCreateCompanyKey(companyId);
        const decryptedCompany = decryptFields({ ...company }, COMPANY_ENCRYPTED_FIELDS, companyKey);

        // Load items
        let itemQuery = `
            SELECT pi.*, e.name, e.email, e.uuid as employee_uuid, e.typ_uvazku,
                   e.rodne_cislo, e.adresa, e.bank_account, e.osobni_cislo, e.zp_code
            FROM payroll_items pi
            JOIN employees e ON pi.employee_id = e.id
            WHERE pi.payroll_period_id = ?
        `;
        const params = [period.id];
        if (req.query.employee_uuid) {
            itemQuery += ' AND e.uuid = ?';
            params.push(req.query.employee_uuid);
        }
        itemQuery += ' ORDER BY e.osobni_cislo, e.name';

        const items = await db.getAll(itemQuery, params);

        // Decrypt employee PII for PDF
        for (const item of items) {
            const decrypted = decryptFields(
                { rodne_cislo: item.rodne_cislo, adresa: item.adresa, bank_account: item.bank_account },
                EMPLOYEE_ENCRYPTED_FIELDS, companyKey
            );
            item.rodne_cislo_plain = decrypted.rodne_cislo;
            item.adresa_plain = decrypted.adresa;
            item.bank_account_plain = decrypted.bank_account;
        }

        // Try to use pdfkit if available, otherwise return JSON data
        let PDFDocument;
        try {
            PDFDocument = require('pdfkit');
        } catch (e) {
            // pdfkit not installed — return structured data for frontend rendering
            const payslips = items.map(item => ({
                employee_name: item.name,
                employee_uuid: item.employee_uuid,
                osobni_cislo: item.osobni_cislo,
                typ_uvazku: item.typ_uvazku,
                period: `${MONTHS_CZ[period.month]} ${period.year}`,
                company_name: company.name,
                company_ico: company.ico,
                hruba_mzda: item.celkova_hruba_czk,
                sp_zamestnanec: item.sp_zamestnanec,
                zp_zamestnanec: item.zp_zamestnanec,
                zaklad_dane: item.zaklad_dane,
                zaloha_dan: item.zaloha_dan,
                srazkova_dan: item.srazkova_dan,
                slevy_celkem: item.slevy_celkem,
                dan_po_slevach: item.dan_po_slevach,
                danova_zvyhodneni: item.danova_zvyhodneni,
                vysledek_dan: item.vysledek_dan,
                danovy_bonus: item.danovy_bonus,
                cista_mzda: item.cista_mzda_czk,
                odpracovane_hodiny: item.odpracovane_hodiny,
                fond_hodin: item.fond_hodin,
                bonus: item.bonus_czk,
                srazka: item.srazka_czk,
                sp_zamestnavatel: item.sp_zamestnavatel,
                zp_zamestnavatel: item.zp_zamestnavatel,
                celkove_naklady: item.celkove_naklady,
                bank_account: item.bank_account_plain,
                // Compliance fields
                srazky_exekuce: item.srazky_exekuce_czk || 0,
                srazky_ostatni: item.srazky_ostatni_czk || 0,
                nahrada_nemoc: item.nahrada_nemoc_czk || 0,
                dovolena_hodiny: item.dovolena_hodiny || 0,
                zakonne_pojisteni: item.zakonne_pojisteni_czk || 0,
                k_vyplate: item.k_vyplate_czk || item.cista_mzda_czk,
                // Crypto/fiat split
                fiat_payout_czk: item.fiat_payout_czk || item.k_vyplate_czk || item.cista_mzda_czk,
                crypto_payout_czk: item.crypto_payout_czk || 0,
                crypto_payout_amount: item.crypto_payout_amount || 0,
                crypto_payout_token: item.crypto_payout_token || 'NONE',
                stablecoin_pct: item.stablecoin_pct_snapshot || 0,
            }));

            return res.json({
                format: 'json',
                message: 'pdfkit není nainstalován — data pro výplatnice',
                period: { year: period.year, month: period.month, monthName: MONTHS_CZ[period.month] },
                company: { name: company.name, ico: company.ico },
                payslips,
            });
        }

        // ---- Generate actual PDF ----
        const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));

        const pdfReady = new Promise(resolve => doc.on('end', () => resolve(Buffer.concat(chunks))));

        // Register Czech-compatible fonts (DejaVu Sans supports full CZ diacritics)
        const fontPath = path.join(__dirname, '..', 'fonts', 'DejaVuSans.ttf');
        const fontBoldPath = path.join(__dirname, '..', 'fonts', 'DejaVuSans-Bold.ttf');
        if (fs.existsSync(fontPath)) {
            doc.registerFont('Czech', fontPath);
            if (fs.existsSync(fontBoldPath)) {
                doc.registerFont('CzechBold', fontBoldPath);
            }
            doc.font('Czech');
        }

        const useBold = fs.existsSync(fontBoldPath);

        for (let idx = 0; idx < items.length; idx++) {
            if (idx > 0) doc.addPage();
            const item = items[idx];

            // Header
            if (useBold) doc.font('CzechBold');
            doc.fontSize(16).text('VÝPLATNÍ LÍSTEK', { align: 'center' });
            doc.fontSize(12).text(`${MONTHS_CZ[period.month]} ${period.year}`, { align: 'center' });
            if (useBold) doc.font('Czech');
            doc.moveDown();

            // Company
            doc.fontSize(10);
            doc.text(`Zaměstnavatel: ${company.name}`);
            doc.text(`IČO: ${company.ico}`);
            doc.moveDown();

            // Employee
            doc.text(`Zaměstnanec: ${item.name}`);
            doc.text(`Osobní číslo: ${item.osobni_cislo || '-'}`);
            doc.text(`Typ úvazku: ${item.typ_uvazku}`);
            doc.text(`Bankovní účet: ${item.bank_account_plain || '-'}`);
            doc.moveDown();

            // Work
            doc.text(`Fond měsíce: ${item.fond_hodin} h`);
            doc.text(`Odpracováno: ${item.odpracovane_hodiny} h`);
            doc.text(`Absence: ${item.absence_hodiny || 0} h`);
            doc.moveDown();

            // Calculation table
            doc.text('--- VÝPOČET ---');
            doc.text(`Hrubá mzda: ${formatCZK(item.celkova_hruba_czk)}`);
            doc.text(`  SP zaměstnanec (7,1%): ${formatCZK(item.sp_zamestnanec)}`);
            doc.text(`  ZP zaměstnanec (4,5%): ${formatCZK(item.zp_zamestnanec)}`);
            doc.text(`Základ daně: ${formatCZK(item.zaklad_dane)}`);
            if (item.zaloha_dan) doc.text(`  Záloha na daň: ${formatCZK(item.zaloha_dan)}`);
            if (item.srazkova_dan) doc.text(`  Srážková daň: ${formatCZK(item.srazkova_dan)}`);
            doc.text(`  Slevy na dani: ${formatCZK(item.slevy_celkem)}`);
            doc.text(`  Daň po slevách: ${formatCZK(item.dan_po_slevach)}`);
            if (item.danova_zvyhodneni) doc.text(`  Daňové zvýhodnění: ${formatCZK(item.danova_zvyhodneni)}`);
            doc.text(`  Výsledná daň: ${formatCZK(item.vysledek_dan)}`);
            if (item.danovy_bonus) doc.text(`  Daňový bonus: ${formatCZK(item.danovy_bonus)}`);
            if (item.bonus_czk) doc.text(`Bonus: ${formatCZK(item.bonus_czk)}`);
            if (item.srazka_czk) doc.text(`Srážka: ${formatCZK(item.srazka_czk)}`);
            doc.moveDown();

            // Compliance: deductions and sick leave
            if ((item.srazky_exekuce_czk || 0) > 0 || (item.srazky_ostatni_czk || 0) > 0 ||
                (item.nahrada_nemoc_czk || 0) > 0 || (item.dovolena_hodiny || 0) > 0) {
                doc.text('--- SRÁŽKY A NEPŘÍTOMNOST ---');
                if (item.dovolena_hodiny > 0) doc.text(`  Dovolená: ${item.dovolena_hodiny} h`);
                if (item.nahrada_nemoc_czk > 0) doc.text(`  Náhrada mzdy (nemoc): ${formatCZK(item.nahrada_nemoc_czk)}`);
                if (item.srazky_exekuce_czk > 0) doc.text(`  Exekuční srážky: ${formatCZK(item.srazky_exekuce_czk)}`);
                if (item.srazky_ostatni_czk > 0) doc.text(`  Ostatní srážky: ${formatCZK(item.srazky_ostatni_czk)}`);
                doc.moveDown();
            }

            if (useBold) doc.font('CzechBold');
            doc.fontSize(14).text(`ČISTÁ MZDA: ${formatCZK(item.cista_mzda_czk)}`, { underline: true });

            // K výplatě (after deductions + sick leave comp)
            const kVyplate = item.k_vyplate_czk || item.cista_mzda_czk;
            if (kVyplate !== item.cista_mzda_czk) {
                doc.fontSize(14).text(`K VÝPLATĚ: ${formatCZK(kVyplate)}`, { underline: true });
            }

            // Crypto/fiat split info
            if (item.crypto_payout_token && item.crypto_payout_token !== 'NONE' && item.crypto_payout_czk > 0) {
                doc.fontSize(10);
                doc.moveDown(0.5);
                doc.text('--- ROZDĚLENÍ VÝPLATY ---');
                const fiatPayout = item.fiat_payout_czk || kVyplate;
                doc.text(`  Bankovní převod (CZK): ${formatCZK(fiatPayout)}`);
                const decimals = item.crypto_payout_token === 'USDCx' ? 1_000_000 : 1_000_000;
                const tokenAmount = item.crypto_payout_amount ? (item.crypto_payout_amount / decimals).toFixed(item.crypto_payout_token === 'USDCx' ? 2 : 6) : '0';
                doc.text(`  Krypto (${item.crypto_payout_token}): ${tokenAmount} (${formatCZK(item.crypto_payout_czk)})`);
                doc.text(`  Podíl krypto: ${item.stablecoin_pct_snapshot || 0}%`);
                if (item.aleo_tx_id) {
                    doc.text(`  TX: ${item.aleo_tx_id}`);
                }
            }

            if (useBold) doc.font('Czech');
            doc.fontSize(10);
            doc.moveDown();

            // Employer costs
            doc.text('--- NÁKLADY ZAMĚSTNAVATELE ---');
            doc.text(`  SP zaměstnavatel (24,8%): ${formatCZK(item.sp_zamestnavatel)}`);
            doc.text(`  ZP zaměstnavatel (9%): ${formatCZK(item.zp_zamestnavatel)}`);
            if (item.zakonne_pojisteni_czk > 0) doc.text(`  Zákonné pojištění (0,28%): ${formatCZK(item.zakonne_pojisteni_czk)}`);
            doc.text(`Celkové náklady: ${formatCZK(item.celkove_naklady)}`);
        }

        doc.end();
        const pdfBuffer = await pdfReady;

        const filename = req.query.employee_uuid
            ? `vyplatnice_${period.year}_${period.month}_${items[0]?.osobni_cislo || 'emp'}.pdf`
            : `vyplatnice_${period.year}_${period.month}_all.pdf`;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(pdfBuffer);

        await auditLog('EXPORT_PAYSLIPS', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'payroll_period',
            resourceId: period.uuid,
            ip: req.ip,
            metadata: { year: period.year, month: period.month, count: items.length },
        });

    } catch (error) {
        console.error('Export payslips error:', error);
        res.status(500).json({ error: 'Chyba při generování výplatnice' });
    }
});

// ====================================
// GET /api/v2/exports/summary/:period_uuid — Summary report (souhrnný přehled)
// ====================================
router.get('/summary/:period_uuid', [
    param('period_uuid').trim().notEmpty(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const period = await loadPeriod(req.params.period_uuid, companyId);
        if (!period) return res.status(404).json({ error: 'Období nenalezeno' });

        const company = await db.getOne('SELECT * FROM companies WHERE uuid = ?', [companyId]);

        const items = await db.getAll(`
            SELECT pi.*, e.name, e.osobni_cislo, e.typ_uvazku
            FROM payroll_items pi
            JOIN employees e ON pi.employee_id = e.id
            WHERE pi.payroll_period_id = ?
            ORDER BY e.osobni_cislo, e.name
        `, [period.id]);

        // Summary totals
        const summary = {
            company: company.name,
            ico: company.ico,
            period: `${MONTHS_CZ[period.month]} ${period.year}`,
            status: period.status,
            employees: items.map(i => ({
                osobni_cislo: i.osobni_cislo,
                name: i.name,
                typ_uvazku: i.typ_uvazku,
                hruba: i.celkova_hruba_czk,
                sp_zam: i.sp_zamestnanec,
                zp_zam: i.zp_zamestnanec,
                dan: i.vysledek_dan,
                danovy_bonus: i.danovy_bonus,
                cista: i.cista_mzda_czk,
                sp_firma: i.sp_zamestnavatel,
                zp_firma: i.zp_zamestnavatel,
                naklady: i.celkove_naklady,
            })),
            totals: {
                hruba: items.reduce((s, i) => s + (i.celkova_hruba_czk || 0), 0),
                sp_zam: items.reduce((s, i) => s + (i.sp_zamestnanec || 0), 0),
                zp_zam: items.reduce((s, i) => s + (i.zp_zamestnanec || 0), 0),
                dan: items.reduce((s, i) => s + (i.vysledek_dan || 0), 0),
                danovy_bonus: items.reduce((s, i) => s + (i.danovy_bonus || 0), 0),
                cista: items.reduce((s, i) => s + (i.cista_mzda_czk || 0), 0),
                sp_firma: items.reduce((s, i) => s + (i.sp_zamestnavatel || 0), 0),
                zp_firma: items.reduce((s, i) => s + (i.zp_zamestnavatel || 0), 0),
                naklady: items.reduce((s, i) => s + (i.celkove_naklady || 0), 0),
            },
            payments: {
                fu: items.reduce((s, i) => s + (i.vysledek_dan || 0), 0) -
                    items.reduce((s, i) => s + (i.danovy_bonus || 0), 0),
                ossz: items.reduce((s, i) => s + (i.sp_zamestnanec || 0) + (i.sp_zamestnavatel || 0), 0),
                zp: items.reduce((s, i) => s + (i.zp_zamestnanec || 0) + (i.zp_zamestnavatel || 0), 0),
                mzdy: items.reduce((s, i) => s + (i.cista_mzda_czk || 0), 0),
            },
        };

        res.json(summary);

    } catch (error) {
        console.error('Export summary error:', error);
        res.status(500).json({ error: 'Chyba při generování přehledu' });
    }
});

// ====================================
// GET /api/v2/exports/bank-csv/:period_uuid — Bank payment CSV (ABO format)
// ====================================
router.get('/bank-csv/:period_uuid', [
    param('period_uuid').trim().notEmpty(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const period = await loadPeriod(req.params.period_uuid, companyId);
        if (!period) return res.status(404).json({ error: 'Období nenalezeno' });
        if (period.status !== 'calculated' && period.status !== 'locked') {
            return res.status(400).json({ error: 'Období musí být spočítané nebo zamčené' });
        }

        const company = await db.getOne('SELECT * FROM companies WHERE uuid = ?', [companyId]);
        const companyKey = await getOrCreateCompanyKey(companyId);
        const decryptedCompany = decryptFields({ ...company }, COMPANY_ENCRYPTED_FIELDS, companyKey);

        const items = await db.getAll(`
            SELECT pi.cista_mzda_czk, pi.k_vyplate_czk, pi.fiat_payout_czk,
                   pi.crypto_payout_czk, pi.crypto_payout_token,
                   e.name, e.osobni_cislo, e.bank_account
            FROM payroll_items pi
            JOIN employees e ON pi.employee_id = e.id
            WHERE pi.payroll_period_id = ? AND pi.cista_mzda_czk > 0
            ORDER BY e.osobni_cislo
        `, [period.id]);

        // Build CSV lines — simple bank transfer format
        // Uses fiat_payout_czk (after crypto split) when available
        const lines = [];
        lines.push('ucet_protistrany;castka;variabilni_symbol;konstantni_symbol;specificka_symbol;zprava_pro_prijemce;jmeno_prijemce');

        for (const item of items) {
            const decryptedAccount = decryptFields(
                { bank_account: item.bank_account },
                ['bank_account'], companyKey
            );
            const account = decryptedAccount.bank_account || '';
            const vs = `${period.year}${String(period.month).padStart(2, '0')}`; // VS = YYYYMM
            const ks = '0308'; // KS pro mzdy
            // Pay only the fiat portion (after crypto split)
            const fiatAmount = item.fiat_payout_czk || item.k_vyplate_czk || item.cista_mzda_czk;
            if (fiatAmount <= 0) continue;
            lines.push([
                account,
                fiatAmount,
                vs,
                ks,
                item.osobni_cislo || '',
                `Mzda ${MONTHS_CZ[period.month]} ${period.year}`,
                item.name,
            ].join(';'));
        }

        const csv = lines.join('\r\n');
        const filename = `platby_mzdy_${period.year}_${String(period.month).padStart(2, '0')}.csv`;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        // BOM for Excel Czech encoding
        res.send('\ufeff' + csv);

        await auditLog('EXPORT_BANK_CSV', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'payroll_period',
            resourceId: period.uuid,
            ip: req.ip,
            metadata: { year: period.year, month: period.month, count: items.length },
        });

    } catch (error) {
        console.error('Export bank CSV error:', error);
        res.status(500).json({ error: 'Chyba při generování bankovního CSV' });
    }
});

// ====================================
// GET /api/v2/exports/institution-csv/:period_uuid/:type — CSV for FÚ/OSSZ/ZP
// ====================================
router.get('/institution-csv/:period_uuid/:type', [
    param('period_uuid').trim().notEmpty(),
    param('type').isIn(['fu', 'ossz', 'zp']),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const period = await loadPeriod(req.params.period_uuid, companyId);
        if (!period) return res.status(404).json({ error: 'Období nenalezeno' });

        const company = await db.getOne('SELECT * FROM companies WHERE uuid = ?', [companyId]);

        const items = await db.getAll(`
            SELECT pi.*, e.name, e.osobni_cislo, e.typ_uvazku, e.rodne_cislo, e.zp_code
            FROM payroll_items pi
            JOIN employees e ON pi.employee_id = e.id
            WHERE pi.payroll_period_id = ?
            ORDER BY e.osobni_cislo
        `, [period.id]);

        const companyKey = await getOrCreateCompanyKey(companyId);
        const { type } = req.params;
        let csv = '';
        let filename = '';

        if (type === 'fu') {
            // Přehled pro Finanční úřad
            csv = 'osobni_cislo;jmeno;hruba_mzda;zaklad_dane;zaloha_dan;slevy;dan_po_slevach;dan_zvyhodneni;vysledek\r\n';
            for (const item of items) {
                csv += [item.osobni_cislo, item.name, item.celkova_hruba_czk,
                    item.zaklad_dane, item.zaloha_dan || 0, item.slevy_celkem,
                    item.dan_po_slevach, item.danova_zvyhodneni || 0, item.vysledek_dan
                ].join(';') + '\r\n';
            }
            const totalDan = items.reduce((s, i) => s + (i.vysledek_dan || 0), 0) -
                             items.reduce((s, i) => s + (i.danovy_bonus || 0), 0);
            csv += `;;;;;;;;;;CELKEM platba FÚ;${totalDan}\r\n`;
            filename = `prehled_fu_${period.year}_${String(period.month).padStart(2, '0')}.csv`;

        } else if (type === 'ossz') {
            // Přehled pro OSSZ
            csv = 'osobni_cislo;jmeno;vymer_hodiny;hruba_mzda;sp_zamestnanec;sp_zamestnavatel;sp_celkem\r\n';
            for (const item of items) {
                const spCelkem = (item.sp_zamestnanec || 0) + (item.sp_zamestnavatel || 0);
                csv += [item.osobni_cislo, item.name, item.odpracovane_hodiny,
                    item.celkova_hruba_czk, item.sp_zamestnanec, item.sp_zamestnavatel, spCelkem
                ].join(';') + '\r\n';
            }
            const totalSP = items.reduce((s, i) => s + (i.sp_zamestnanec || 0) + (i.sp_zamestnavatel || 0), 0);
            csv += `;;;;;;CELKEM platba OSSZ;${totalSP}\r\n`;
            filename = `prehled_ossz_${period.year}_${String(period.month).padStart(2, '0')}.csv`;

        } else if (type === 'zp') {
            // Přehled pro ZP — grouped by health insurance company
            csv = 'zp_kod;osobni_cislo;jmeno;hruba_mzda;zp_zamestnanec;zp_zamestnavatel;zp_celkem\r\n';
            for (const item of items) {
                const decryptedRC = decryptFields({ rodne_cislo: item.rodne_cislo }, ['rodne_cislo'], companyKey);
                const zpCelkem = (item.zp_zamestnanec || 0) + (item.zp_zamestnavatel || 0);
                csv += [item.zp_code || '111', item.osobni_cislo, item.name,
                    item.celkova_hruba_czk, item.zp_zamestnanec, item.zp_zamestnavatel, zpCelkem
                ].join(';') + '\r\n';
            }
            const totalZP = items.reduce((s, i) => s + (i.zp_zamestnanec || 0) + (i.zp_zamestnavatel || 0), 0);
            csv += `;;;;;;CELKEM platba ZP;${totalZP}\r\n`;
            filename = `prehled_zp_${period.year}_${String(period.month).padStart(2, '0')}.csv`;
        }

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send('\ufeff' + csv);

    } catch (error) {
        console.error('Export institution CSV error:', error);
        res.status(500).json({ error: 'Chyba při generování přehledu' });
    }
});

// ====================================
// GET /api/v2/exports/zip/:period_uuid — ZIP all exports
// ====================================
router.get('/zip/:period_uuid', [
    param('period_uuid').trim().notEmpty(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const period = await loadPeriod(req.params.period_uuid, companyId);
        if (!period) return res.status(404).json({ error: 'Období nenalezeno' });
        if (period.status !== 'calculated' && period.status !== 'locked') {
            return res.status(400).json({ error: 'Období musí být spočítané nebo zamčené' });
        }

        let archiver;
        try {
            archiver = require('archiver');
        } catch (e) {
            return res.status(501).json({
                error: 'archiver package není nainstalován. Spusťte: npm install archiver'
            });
        }

        const filename = `mzdy_${period.year}_${String(period.month).padStart(2, '0')}.zip`;
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.pipe(res);

        // === Souhrnný přehled ===
        const company = await db.getOne('SELECT * FROM companies WHERE uuid = ?', [companyId]);
        const items = await db.getAll(`
            SELECT pi.*, e.name, e.osobni_cislo, e.typ_uvazku, e.bank_account, e.zp_code
            FROM payroll_items pi
            JOIN employees e ON pi.employee_id = e.id
            WHERE pi.payroll_period_id = ?
            ORDER BY e.osobni_cislo
        `, [period.id]);

        const companyKey = await getOrCreateCompanyKey(companyId);

        // Summary CSV
        let summaryCSV = 'Osobní číslo;Jméno;Typ;Hrubá;SP zam;ZP zam;Daň;Čistá;SP firma;ZP firma;Náklady\r\n';
        for (const item of items) {
            summaryCSV += [
                item.osobni_cislo, item.name, item.typ_uvazku,
                item.celkova_hruba_czk, item.sp_zamestnanec, item.zp_zamestnanec,
                item.vysledek_dan, item.cista_mzda_czk,
                item.sp_zamestnavatel, item.zp_zamestnavatel, item.celkove_naklady
            ].join(';') + '\r\n';
        }
        archive.append('\ufeff' + summaryCSV, { name: `prehled_${period.year}_${period.month}.csv` });

        // Bank payment CSV
        let bankCSV = 'ucet;castka;vs;ks;ss;zprava;jmeno\r\n';
        for (const item of items) {
            if (!item.cista_mzda_czk) continue;
            const dec = decryptFields({ bank_account: item.bank_account }, ['bank_account'], companyKey);
            bankCSV += [
                dec.bank_account || '', item.cista_mzda_czk,
                `${period.year}${String(period.month).padStart(2, '0')}`,
                '0308', item.osobni_cislo || '',
                `Mzda ${MONTHS_CZ[period.month]} ${period.year}`, item.name,
            ].join(';') + '\r\n';
        }
        archive.append('\ufeff' + bankCSV, { name: `platby_mzdy_${period.year}_${period.month}.csv` });

        // Payment summary text
        const totalFU = items.reduce((s, i) => s + (i.vysledek_dan || 0), 0) -
                        items.reduce((s, i) => s + (i.danovy_bonus || 0), 0);
        const totalOSSZ = items.reduce((s, i) => s + (i.sp_zamestnanec || 0) + (i.sp_zamestnavatel || 0), 0);
        const totalZP = items.reduce((s, i) => s + (i.zp_zamestnanec || 0) + (i.zp_zamestnavatel || 0), 0);
        const totalMzdy = items.reduce((s, i) => s + (i.cista_mzda_czk || 0), 0);

        const paymentSummary = [
            `PŘEHLED PLATEB — ${MONTHS_CZ[period.month]} ${period.year}`,
            `Firma: ${company.name} (IČO: ${company.ico})`,
            ``,
            `Finanční úřad (záloha na daň): ${formatCZK(totalFU)}`,
            `OSSZ (sociální pojištění): ${formatCZK(totalOSSZ)}`,
            `ZP (zdravotní pojištění): ${formatCZK(totalZP)}`,
            `Čisté mzdy zaměstnancům: ${formatCZK(totalMzdy)}`,
            ``,
            `CELKOVÉ VÝDAJE: ${formatCZK(totalFU + totalOSSZ + totalZP + totalMzdy)}`,
        ].join('\r\n');
        archive.append(paymentSummary, { name: `platby_souhrn_${period.year}_${period.month}.txt` });

        await archive.finalize();

        await auditLog('EXPORT_ZIP', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'payroll_period',
            resourceId: period.uuid,
            ip: req.ip,
            metadata: { year: period.year, month: period.month },
        });

    } catch (error) {
        console.error('Export ZIP error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Chyba při generování ZIP' });
        }
    }
});

// ====================================
// GET /api/v2/exports/crypto-csv/:period_uuid — Crypto payment CSV export
// ====================================
router.get('/crypto-csv/:period_uuid', [
    param('period_uuid').trim().notEmpty(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const period = await loadPeriod(req.params.period_uuid, companyId);
        if (!period) return res.status(404).json({ error: 'Období nenalezeno' });
        if (period.status !== 'calculated' && period.status !== 'locked') {
            return res.status(400).json({ error: 'Období musí být spočítané nebo zamčené' });
        }

        const items = await db.getAll(`
            SELECT pi.crypto_payout_czk, pi.crypto_payout_amount, pi.crypto_payout_token,
                   pi.fiat_payout_czk, pi.k_vyplate_czk, pi.czk_usd_rate, pi.czk_aleo_rate,
                   pi.stablecoin_pct_snapshot, pi.aleo_tx_id, pi.aleo_payment_status,
                   e.name, e.osobni_cislo, e.wallet_address, e.aleo_address
            FROM payroll_items pi
            JOIN employees e ON pi.employee_id = e.id
            WHERE pi.payroll_period_id = ?
              AND pi.crypto_payout_token IS NOT NULL
              AND pi.crypto_payout_token != 'NONE'
              AND pi.crypto_payout_amount > 0
            ORDER BY e.osobni_cislo, e.name
        `, [period.id]);

        // Build CSV
        const lines = [];
        lines.push('osobni_cislo;jmeno;token;castka_czk;castka_token;wallet_adresa;tx_hash;tx_status;kurz;procento_krypto');

        for (const item of items) {
            const decimals = item.crypto_payout_token === 'USDCx' ? 1_000_000 : 1_000_000;
            const tokenAmount = item.crypto_payout_amount ? (item.crypto_payout_amount / decimals).toFixed(item.crypto_payout_token === 'USDCx' ? 2 : 6) : '0';
            const addr = item.wallet_address || item.aleo_address || '';
            lines.push([
                item.osobni_cislo || '',
                item.name,
                item.crypto_payout_token,
                item.crypto_payout_czk || 0,
                tokenAmount,
                addr,
                item.aleo_tx_id || '',
                item.aleo_payment_status || 'pending',
                item.crypto_payout_token === 'USDCx' ? (item.czk_usd_rate || '') : (item.czk_aleo_rate || ''),
                item.stablecoin_pct_snapshot || 0,
            ].join(';'));
        }

        const csv = lines.join('\r\n');
        const filename = `krypto_platby_${period.year}_${String(period.month).padStart(2, '0')}.csv`;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send('\ufeff' + csv);

        await auditLog('EXPORT_CRYPTO_CSV', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'payroll_period',
            resourceId: period.uuid,
            ip: req.ip,
            metadata: { year: period.year, month: period.month, count: items.length },
        });

    } catch (error) {
        console.error('Export crypto CSV error:', error);
        res.status(500).json({ error: 'Chyba při generování krypto CSV' });
    }
});

module.exports = router;
