// ====================================
// 🧪 OSVČ & Annual Processing — Unit Tests
// ====================================
// Run with: node tests/test-osvc-annual.js

'use strict';

const {
    calculateOSVCSocialAdvance,
    calculateOSVCHealthAdvance,
    calculateOSVCTaxAdvance,
    calculatePausalDan,
    calculateOSVCAnnualTax,
    calculateRocniZuctovani,
    generateELDP,
    generatePrehledOSSZ,
    generatePrehledZP,
    OSVC_PARAMS_2026,
    DEFAULT_TAX_PARAMS_2026,
    ceilCZK,
} = require('../services/payroll-engine');

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, testName, details = '') {
    if (condition) {
        passed++;
        console.log(`  ✅ ${testName}`);
    } else {
        failed++;
        failures.push({ testName, details });
        console.log(`  ❌ ${testName}${details ? ` — ${details}` : ''}`);
    }
}

function assertClose(actual, expected, testName, tolerance = 1) {
    const diff = Math.abs(actual - expected);
    if (diff <= tolerance) {
        passed++;
        console.log(`  ✅ ${testName} (got ${actual}, expected ${expected})`);
    } else {
        failed++;
        failures.push({ testName, details: `got ${actual}, expected ${expected}, diff ${diff}` });
        console.log(`  ❌ ${testName} — got ${actual}, expected ${expected}, diff ${diff}`);
    }
}

// ====================================
// TEST GROUP: OSVČ Parameters Constants
// ====================================
console.log('\n📋 OSVČ Parameters Constants');
{
    assert(OSVC_PARAMS_2026.osvc_sp_rate === 0.292, 'SP rate is 29.2%');
    assert(OSVC_PARAMS_2026.osvc_zp_rate === 0.135, 'ZP rate is 13.5%');
    assert(OSVC_PARAMS_2026.osvc_sp_assessment_base_pct === 0.50, 'SP assessment base is 50%');
    assert(OSVC_PARAMS_2026.osvc_zp_assessment_base_pct === 0.50, 'ZP assessment base is 50%');
    assert(OSVC_PARAMS_2026.pausal_dan_monthly === 7498, 'Paušální daň 1. pásmo = 7,498');
    assert(OSVC_PARAMS_2026.pausal_dan_limit_revenue === 2_000_000, 'Paušální daň limit = 2M');
    assert(typeof OSVC_PARAMS_2026.vydajovy_pausal === 'object', 'Výdajové paušály defined');
    assert(OSVC_PARAMS_2026.vydajovy_pausal.remeslna.rate === 80, 'Řemeslná živnost paušál 80%');
    assert(OSVC_PARAMS_2026.vydajovy_pausal.volna.rate === 60, 'Volná živnost paušál 60%');
    assert(OSVC_PARAMS_2026.vydajovy_pausal.najem.rate === 30, 'Nájem paušál 30%');
    assert(OSVC_PARAMS_2026.vydajovy_pausal.ostatni.rate === 40, 'Ostatní paušál 40%');
}

// ====================================
// TEST GROUP: OSVČ Social Insurance Advance
// ====================================
console.log('\n🏥 OSVČ Social Insurance Advance (SP)');
{
    // Hlavní činnost — minimal advance
    const r1 = calculateOSVCSocialAdvance({ predchoziRocniZisk: 0, hlavniCinnost: true });
    assert(r1.zaloha === OSVC_PARAMS_2026.osvc_sp_min_monthly_hlavni, 'Zero profit → min hlavní SP záloha');
    assert(r1.isMinimal === true, 'Flagged as minimal');
    assert(r1.isExempt === false, 'Hlavní is not exempt');

    // Hlavní činnost — calculated advance above minimum
    const r2 = calculateOSVCSocialAdvance({ predchoziRocniZisk: 1_200_000, hlavniCinnost: true });
    const expectedVymZaklad2 = Math.round(1_200_000 * 0.50 / 12);
    const expectedZaloha2 = ceilCZK(expectedVymZaklad2 * 0.292);
    assert(r2.vymerovaciZaklad === expectedVymZaklad2, `VZ = ${expectedVymZaklad2}`);
    assert(r2.zaloha === expectedZaloha2, `Záloha = ${expectedZaloha2} (calculated)`);
    assert(r2.isMinimal === false, 'Not minimal for high profit');

    // Vedlejší činnost — under SP limit → exempt
    const r3 = calculateOSVCSocialAdvance({
        predchoziRocniZisk: 50_000,
        hlavniCinnost: false,
    });
    assert(r3.zaloha === 0, 'Vedlejší under limit → zero záloha');
    assert(r3.isExempt === true, 'Vedlejší under limit → exempt');

    // Vedlejší činnost — over SP limit
    const r4 = calculateOSVCSocialAdvance({
        predchoziRocniZisk: 500_000,
        hlavniCinnost: false,
    });
    assert(r4.zaloha > 0, 'Vedlejší over limit → pays SP');
    assert(r4.isExempt === false, 'Not exempt');

    // Custom amount override
    const r5 = calculateOSVCSocialAdvance({
        predchoziRocniZisk: 0,
        hlavniCinnost: true,
        customAmount: 10_000,
    });
    assert(r5.zaloha === 10_000, 'Custom amount overrides minimum when higher');
}

// ====================================
// TEST GROUP: OSVČ Health Insurance Advance
// ====================================
console.log('\n💊 OSVČ Health Insurance Advance (ZP)');
{
    // Hlavní — minimum
    const r1 = calculateOSVCHealthAdvance({ predchoziRocniZisk: 0, hlavniCinnost: true });
    assert(r1.zaloha === OSVC_PARAMS_2026.osvc_zp_min_monthly, 'Zero profit → min hlavní ZP záloha');
    assert(r1.isMinimal === true, 'Flagged as minimal');

    // Hlavní — calculated
    const r2 = calculateOSVCHealthAdvance({ predchoziRocniZisk: 1_200_000, hlavniCinnost: true });
    const expectedVZ = Math.round(1_200_000 * 0.50 / 12);
    const expectedZP = ceilCZK(expectedVZ * 0.135);
    assert(r2.zaloha === expectedZP, `ZP záloha = ${expectedZP}`);
    assert(r2.isMinimal === false, 'Not minimal');

    // Vedlejší — no minimum enforced
    const r3 = calculateOSVCHealthAdvance({ predchoziRocniZisk: 100_000, hlavniCinnost: false });
    assert(r3.isMinimal === false, 'Vedlejší has no minimum ZP');
    assert(r3.zaloha >= 0, 'Záloha is non-negative');

    // Custom override
    const r4 = calculateOSVCHealthAdvance({
        predchoziRocniZisk: 0,
        hlavniCinnost: true,
        customAmount: 8_000,
    });
    assert(r4.zaloha === 8_000, 'Custom ZP override works');
}

// ====================================
// TEST GROUP: OSVČ Tax Advance
// ====================================
console.log('\n💰 OSVČ Tax Advance');
{
    // Under 30k — no advances
    const r1 = calculateOSVCTaxAdvance({ posledniDanovaPovinnost: 25_000 });
    assert(r1.zalohaCastka === 0, 'Under 30k → no advances');
    assert(r1.pocetZaloh === 0, 'Zero advance count');
    assert(r1.frekvence === 'bez_zaloh', 'Frekvence = bez_zaloh');

    // 30-150k — semi-annual (2x)
    const r2 = calculateOSVCTaxAdvance({ posledniDanovaPovinnost: 100_000 });
    assert(r2.pocetZaloh === 2, '100k → 2 advances');
    assert(r2.frekvence === 'pololetne', 'Semi-annual');
    assertClose(r2.zalohaCastka, 40_000, '40% of 100k = 40,000');

    // Over 150k — quarterly (4x)
    const r3 = calculateOSVCTaxAdvance({ posledniDanovaPovinnost: 200_000 });
    assert(r3.pocetZaloh === 4, '200k → 4 advances');
    assert(r3.frekvence === 'ctvrtletne', 'Quarterly');
    assertClose(r3.zalohaCastka, 50_000, '25% of 200k = 50,000');

    // Boundary: exactly 30k → no advances
    const r4 = calculateOSVCTaxAdvance({ posledniDanovaPovinnost: 30_000 });
    assert(r4.zalohaCastka === 0, 'Exactly 30k → no advances');

    // Zero
    const r5 = calculateOSVCTaxAdvance({ posledniDanovaPovinnost: 0 });
    assert(r5.zalohaCastka === 0, 'Zero → no advances');
}

// ====================================
// TEST GROUP: Paušální daň
// ====================================
console.log('\n📊 Paušální daň');
{
    // Eligible — 1. pásmo (under 1M)
    const r1 = calculatePausalDan({ rocniPrijmy: 800_000, isPlatceDPH: false });
    assert(r1.isEligible === true, '800k non-VAT → eligible');
    assert(r1.pasmo === 1, '1. pásmo');
    assert(r1.monthlyPayment === 7_498, 'Monthly = 7,498');
    assert(r1.annualPayment === 7_498 * 12, 'Annual = 12 × monthly');
    assert(typeof r1.breakdown === 'object', 'Breakdown provided');
    assert(r1.breakdown.dan + r1.breakdown.sp + r1.breakdown.zp === r1.monthlyPayment,
        'Breakdown sums to monthly payment');

    // Eligible — 2. pásmo (1M-1.5M)
    const r2 = calculatePausalDan({ rocniPrijmy: 1_200_000, isPlatceDPH: false });
    assert(r2.isEligible === true, '1.2M → eligible');
    assert(r2.pasmo === 2, '2. pásmo');
    assert(r2.monthlyPayment === 16_000, '2. pásmo = 16,000/mo');

    // Eligible — 3. pásmo (1.5M-2M)
    const r3 = calculatePausalDan({ rocniPrijmy: 1_800_000, isPlatceDPH: false });
    assert(r3.isEligible === true, '1.8M → eligible');
    assert(r3.pasmo === 3, '3. pásmo');
    assert(r3.monthlyPayment === 26_000, '3. pásmo = 26,000/mo');

    // Not eligible — over 2M
    const r4 = calculatePausalDan({ rocniPrijmy: 2_500_000, isPlatceDPH: false });
    assert(r4.isEligible === false, '2.5M → not eligible');
    assert(r4.monthlyPayment === 0, 'Zero payment when not eligible');

    // Not eligible — VAT payer
    const r5 = calculatePausalDan({ rocniPrijmy: 500_000, isPlatceDPH: true });
    assert(r5.isEligible === false, 'VAT payer → not eligible');
}

// ====================================
// TEST GROUP: OSVČ Annual Tax
// ====================================
console.log('\n📑 OSVČ Annual Tax (Daňové přiznání)');
{
    // Basic case — volná živnost, paušální výdaje
    const r1 = calculateOSVCAnnualTax({
        rocniPrijmy: 1_000_000,
        usePausal: true,
        oborCinnosti: 'volna',
        podepsaneProhlaseni: true,
        pocetDeti: 0,
    });
    assert(r1.rocniPrijmy === 1_000_000, 'Revenue = 1M');
    const expectedVydaje1 = Math.min(1_000_000 * 0.60, 1_200_000);
    assert(r1.rocniVydaje === expectedVydaje1, `Paušální výdaje volná = ${expectedVydaje1}`);
    assert(r1.zakladDane === 1_000_000 - expectedVydaje1, 'Základ daně correct');
    assert(r1.usePausal === true, 'Using paušál');
    assert(r1.vydajePausalInfo !== null, 'Paušál info provided');
    assert(r1.vydajePausalInfo.obor === 'volna', 'Obor = volna');

    // Sleva na poplatníka applied
    assert(r1.slevy >= OSVC_PARAMS_2026.sleva_poplatnik_rocni, 'Sleva na poplatníka included');

    // Řemeslná živnost — 80% paušál
    const r2 = calculateOSVCAnnualTax({
        rocniPrijmy: 800_000,
        usePausal: true,
        oborCinnosti: 'remeslna',
        podepsaneProhlaseni: true,
    });
    const expectedVydaje2 = Math.min(800_000 * 0.80, 1_600_000);
    assert(r2.rocniVydaje === expectedVydaje2, `Řemeslná paušál = ${expectedVydaje2}`);
    assert(r2.zakladDane === 800_000 - expectedVydaje2, 'Základ for řemeslná');

    // Skutečné výdaje (no paušál)
    const r3 = calculateOSVCAnnualTax({
        rocniPrijmy: 1_000_000,
        rocniVydaje: 300_000,
        usePausal: false,
        podepsaneProhlaseni: true,
    });
    assert(r3.zakladDane === 700_000, 'Skutečné výdaje: základ = 700k');
    assert(r3.usePausal === false, 'Not using paušál');

    // Děti — daňové zvýhodnění
    const r4 = calculateOSVCAnnualTax({
        rocniPrijmy: 1_500_000,
        usePausal: true,
        oborCinnosti: 'volna',
        podepsaneProhlaseni: true,
        pocetDeti: 2,
        detiZTP: 0,
    });
    assert(r4.danovaZvyhodneni > 0, 'Daňové zvýhodnění on children');
    const expectedZvyh = OSVC_PARAMS_2026.sleva_dite_1_rocni + OSVC_PARAMS_2026.sleva_dite_2_rocni;
    assert(r4.danovaZvyhodneni === expectedZvyh, `2 děti zvýhodnění = ${expectedZvyh}`);

    // ZTP/P dítě — double
    const r5 = calculateOSVCAnnualTax({
        rocniPrijmy: 1_500_000,
        usePausal: true,
        oborCinnosti: 'volna',
        podepsaneProhlaseni: true,
        pocetDeti: 1,
        detiZTP: 1,
    });
    assert(r5.danovaZvyhodneni === OSVC_PARAMS_2026.sleva_dite_1_rocni * 2, 'ZTP/P dítě = double');

    // Invalidita
    const r6 = calculateOSVCAnnualTax({
        rocniPrijmy: 1_000_000,
        usePausal: true,
        oborCinnosti: 'volna',
        podepsaneProhlaseni: true,
        invalidita: '3',
    });
    assert(r6.slevy >= OSVC_PARAMS_2026.sleva_poplatnik_rocni + OSVC_PARAMS_2026.sleva_invalidita_3_rocni,
        'Invalidita 3. stupně sleva included');

    // Zálohy → doplatek/přeplatek
    const r7 = calculateOSVCAnnualTax({
        rocniPrijmy: 1_000_000,
        usePausal: true,
        oborCinnosti: 'volna',
        podepsaneProhlaseni: true,
        zaplaceneZalohy: 100_000,
    });
    assert(typeof r7.doplatekDan === 'number', 'doplatekDan is number');
    assert(['doplatek', 'preplatek', 'vyrovnano'].includes(r7.doplatekNedoplatek), 'Has doplatek status');

    // SP and ZP annual amounts present
    assert(r7.spRocni > 0 || r7.zakladDane === 0, 'SP roční calculated');
    assert(r7.zpRocni > 0 || r7.zakladDane === 0, 'ZP roční calculated');

    // Zero income
    const r8 = calculateOSVCAnnualTax({ rocniPrijmy: 0, usePausal: true });
    assert(r8.zakladDane === 0, 'Zero income → zero základ');
    assert(r8.vysledkDan === 0, 'Zero income → zero tax');
}

// ====================================
// TEST GROUP: Roční zúčtování (employee)
// ====================================
console.log('\n📅 Roční zúčtování (employee annual reconciliation)');
{
    // Create mock monthly payrolls (12 months)
    const mockPayrolls = Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        mesic: i + 1,
        celkovaHruba: 50_000,
        vysledkDan: 3_500,
        danovyBonus: 0,
        podepsaneProhlaseni: true,
        pocetDeti: 1,
        detiZTP: 0,
        student: false,
        invalidita: 'none',
    }));

    // Basic — no deductions
    const r1 = calculateRocniZuctovani({ monthlyPayrolls: mockPayrolls });
    assert(r1.rocniHruba === 600_000, 'Annual gross = 600k');
    assert(r1.zaplacenaDan === 42_000, 'Zaplacená daň = 12 × 3,500');
    assert(typeof r1.rozdil === 'number', 'Rozdíl computed');
    assert(['nedoplatek', 'preplatek', 'vyrovnano'].includes(r1.vysledek), 'Výsledek type valid');
    assert(r1.castka >= 0, 'Castka non-negative');

    // With mortgage interest deduction
    const r2 = calculateRocniZuctovani({
        monthlyPayrolls: mockPayrolls,
        rocniUroky: 120_000,
    });
    assert(r2.odpocty >= 120_000, 'Mortgage interest in odpočty');
    assert(r2.sniZenyZaklad < r2.rocniZakladDane, 'Snížený základ lower');

    // Mortgage capped at 150k
    const r3 = calculateRocniZuctovani({
        monthlyPayrolls: mockPayrolls,
        rocniUroky: 200_000,
    });
    assert(r3.odpocty >= 150_000, 'Mortgage capped at 150,000');
    // Not 200k
    const urokOdpocet = Math.min(200_000, 150_000);
    assert(r3.odpocty <= urokOdpocet + 1, 'Only mortgage → odpočty = 150,000 max');

    // Penzijko — over 1000 threshold, max 24k
    const r4 = calculateRocniZuctovani({
        monthlyPayrolls: mockPayrolls,
        rocniPenzijko: 30_000,
    });
    // Should deduct 30k - 1k = 29k, capped at 24k → 24k
    assert(r4.odpocty >= 24_000, 'Penzijko deduction applied (capped at 24k)');

    // Penzijko under 1000 → no deduction
    const r5 = calculateRocniZuctovani({
        monthlyPayrolls: mockPayrolls,
        rocniPenzijko: 800,
    });
    assert(r5.odpocty === 0 || r5.odpocty < 1000, 'Penzijko under 1000 → no deduction');

    // Životní pojištění
    const r6 = calculateRocniZuctovani({
        monthlyPayrolls: mockPayrolls,
        rocniZivotko: 30_000,
    });
    // Capped at 24k
    assert(r6.odpocty >= 24_000, 'Životko capped at 24k');

    // No payrolls → error
    const r7 = calculateRocniZuctovani({ monthlyPayrolls: [] });
    assert(r7.error !== undefined, 'Empty payrolls → error');

    // Combined deductions
    const r8 = calculateRocniZuctovani({
        monthlyPayrolls: mockPayrolls,
        rocniUroky: 100_000,
        rocniPenzijko: 20_000,
        rocniZivotko: 15_000,
        rocniVzdelavani: 5_000,
    });
    // 100k + (20k-1k=19k) + 15k + 5k = 139k
    assertClose(r8.odpocty, 139_000, 'Combined deductions total', 2);
}

// ====================================
// TEST GROUP: ELDP Generation
// ====================================
console.log('\n📄 ELDP (Evidenční list důchodového pojištění)');
{
    const mockEmployee = {
        jmeno: 'Jan',
        prijmeni: 'Novák',
        rodne_cislo: '8501011234',
        datum_narozeni: '1985-01-01',
    };
    const mockCompany = { ico: '12345678', name: 'Test s.r.o.' };
    const mockPayrolls = Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        celkovaHruba: 45_000,
        vyloucentDny: i === 5 ? 5 : 0,
        odpracovaneDny: i === 5 ? 17 : 22,
    }));

    const r1 = generateELDP({
        employee: mockEmployee,
        monthlyPayrolls: mockPayrolls,
        company: mockCompany,
        year: 2026,
    });

    assert(r1.rok === 2026, 'Year = 2026');
    assert(r1.zamestnavatel.ico === '12345678', 'Employer IČO');
    assert(r1.pojistenec.jmeno === 'Jan', 'Employee first name');
    assert(r1.pojistenec.prijmeni === 'Novák', 'Employee last name');
    assert(r1.pojistenec.rodneCislo === '8501011234', 'Rodné číslo');
    assert(r1.vymerovaciZaklad === 45_000 * 12, 'Annual VZ = 540k');
    assert(r1.vyloucentDny === 5, 'Vyloučené dny = 5');
    assert(r1.dobaPojisteni.mesiceUcasti === 12, '12 months of participation');
    assert(typeof r1.mesicniPrehled === 'object', 'Monthly overview present');

    // Missing data → error
    const r2 = generateELDP({ employee: null, company: mockCompany, year: 2026 });
    assert(r2.error !== undefined, 'Missing employee → error');

    const r3 = generateELDP({ employee: mockEmployee, company: null, year: 2026 });
    assert(r3.error !== undefined, 'Missing company → error');
}

// ====================================
// TEST GROUP: Přehled OSSZ
// ====================================
console.log('\n🏛️ Přehled pro OSSZ');
{
    const annualTax = calculateOSVCAnnualTax({
        rocniPrijmy: 1_000_000,
        usePausal: true,
        oborCinnosti: 'volna',
        podepsaneProhlaseni: true,
    });
    const paidAdvances = Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        amount_czk: OSVC_PARAMS_2026.osvc_sp_min_monthly_hlavni,
    }));
    const mockCompany = { ico: '12345678', name: 'Jan OSVČ', hlavni_cinnost: true };

    const r1 = generatePrehledOSSZ({
        annualTax,
        paidAdvances,
        company: mockCompany,
        year: 2026,
    });

    assert(r1.rok === 2026, 'Year');
    assert(r1.prijmy === 1_000_000, 'Příjmy');
    assert(r1.zakladDane === annualTax.zakladDane, 'Základ daně matches');
    assert(r1.pojistne > 0, 'Pojistné > 0');
    assert(typeof r1.rozdil === 'number', 'Rozdíl computed');
    assert(['doplatek', 'preplatek', 'vyrovnano'].includes(r1.vysledek), 'Výsledek valid');
    assert(r1.castka >= 0, 'Částka non-negative');
    assert(r1.novaZaloha > 0, 'Nová záloha computed');

    // Missing data → error
    const r2 = generatePrehledOSSZ({ annualTax: null, company: mockCompany, year: 2026 });
    assert(r2.error !== undefined, 'Missing annualTax → error');
}

// ====================================
// TEST GROUP: Přehled ZP
// ====================================
console.log('\n🏥 Přehled pro ZP');
{
    const annualTax = calculateOSVCAnnualTax({
        rocniPrijmy: 1_000_000,
        usePausal: true,
        oborCinnosti: 'volna',
        podepsaneProhlaseni: true,
    });
    const paidAdvances = Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        amount_czk: OSVC_PARAMS_2026.osvc_zp_min_monthly,
    }));
    const mockCompany = { ico: '12345678', name: 'Jan OSVČ', hlavni_cinnost: true };

    const r1 = generatePrehledZP({
        annualTax,
        paidAdvances,
        company: mockCompany,
        year: 2026,
    });

    assert(r1.rok === 2026, 'Year');
    assert(r1.prijmy === 1_000_000, 'Příjmy');
    assert(r1.pojistne > 0, 'Pojistné > 0');
    assert(typeof r1.rozdil === 'number', 'Rozdíl computed');
    assert(['doplatek', 'preplatek', 'vyrovnano'].includes(r1.vysledek), 'Výsledek valid');
    assert(r1.novaZaloha > 0, 'Nová záloha computed');

    // Missing data → error
    const r2 = generatePrehledZP({ annualTax: null, company: mockCompany, year: 2026 });
    assert(r2.error !== undefined, 'Missing annualTax → error');
}

// ====================================
// TEST GROUP: Edge Cases & Integration
// ====================================
console.log('\n🔗 Edge Cases & Integration');
{
    // Very high income OSVČ — progressive tax (23% bracket)
    const r1 = calculateOSVCAnnualTax({
        rocniPrijmy: 5_000_000,
        rocniVydaje: 1_000_000,
        usePausal: false,
        podepsaneProhlaseni: true,
    });
    assert(r1.zakladDane === 4_000_000, 'High income základ = 4M');
    // Should hit 23% bracket (over 1,582,812)
    const threshold = OSVC_PARAMS_2026.tax_threshold_annual;
    const expectedDan = ceilCZK(threshold * 0.15 + (4_000_000 - threshold) * 0.23);
    assert(r1.dan === expectedDan, 'Progressive tax calculation correct');

    // Bez prohlášení — no slevy applied
    const r2 = calculateOSVCAnnualTax({
        rocniPrijmy: 1_000_000,
        usePausal: true,
        oborCinnosti: 'volna',
        podepsaneProhlaseni: false,
        pocetDeti: 2,
    });
    assert(r2.slevy === 0, 'No prohlášení → no slevy');
    assert(r2.danovaZvyhodneni === 0, 'No prohlášení → no zvýhodnění');

    // Student sleva
    const r3 = calculateOSVCAnnualTax({
        rocniPrijmy: 500_000,
        usePausal: true,
        oborCinnosti: 'volna',
        podepsaneProhlaseni: true,
        student: true,
    });
    assert(r3.slevy >= OSVC_PARAMS_2026.sleva_poplatnik_rocni + OSVC_PARAMS_2026.sleva_student_rocni,
        'Student sleva included');

    // Vedlejší OSVČ — SP exempt under limit
    const spResult = calculateOSVCSocialAdvance({
        predchoziRocniZisk: 10_000,
        hlavniCinnost: false,
    });
    const zpResult = calculateOSVCHealthAdvance({
        predchoziRocniZisk: 10_000,
        hlavniCinnost: false,
    });
    assert(spResult.isExempt === true, 'Vedlejší low income → SP exempt');
    assert(zpResult.zaloha >= 0, 'Vedlejší ZP is always ≥ 0');

    // Výdajový paušál max cap
    const r4 = calculateOSVCAnnualTax({
        rocniPrijmy: 10_000_000,
        usePausal: true,
        oborCinnosti: 'remeslna',
        podepsaneProhlaseni: true,
    });
    // Max cap for řemeslná is 1,600,000
    assert(r4.rocniVydaje === 1_600_000, 'Řemeslná paušál capped at 1.6M');

    // Daňový bonus (negative tax → bonus)
    const r5 = calculateOSVCAnnualTax({
        rocniPrijmy: 200_000,
        usePausal: true,
        oborCinnosti: 'remeslna', // 80% → základ 40k
        podepsaneProhlaseni: true,
        pocetDeti: 3,
        detiZTP: 0,
    });
    // With 80% paušál: základ = 40k, daň = ~6k, slevy = ~30k → dan po slevách 0
    // + 3 děti zvýhodnění → big bonus
    assert(r5.danovyBonus >= 0, 'Daňový bonus possible with low income and children');
}

// ====================================
// SUMMARY
// ====================================
console.log('\n' + '='.repeat(50));
console.log(`📊 Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
if (failures.length > 0) {
    console.log('\n❌ Failed tests:');
    failures.forEach(f => console.log(`   - ${f.testName}: ${f.details}`));
}
console.log('='.repeat(50));

process.exit(failed > 0 ? 1 : 0);
