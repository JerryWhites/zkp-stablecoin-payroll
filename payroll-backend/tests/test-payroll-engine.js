// ====================================
// 🧪 Czech Payroll Engine — Unit Tests
// ====================================
// Run with: node tests/test-payroll-engine.js

'use strict';

const {
    calculateHPP,
    calculateDPP,
    calculateDPC,
    calculateBatchPayroll,
    validateICO,
    validateRodneCislo,
    validateBankAccount,
    validateEmployee,
    ceilCZK,
    ceilTo100,
    floorCZK,
    getWorkingHours,
    czkToAleo,
    aleoToCzk,
    calculateSickLeaveCompensation,
    applyDeductions,
    calculateLiabilityInsurance,
    DEFAULT_TAX_PARAMS_2026,
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
// TEST GROUP: Rounding Functions
// ====================================
console.log('\n📐 Rounding Functions');

assert(ceilCZK(1234.1) === 1235, 'ceilCZK rounds up fractional');
assert(ceilCZK(1234.0) === 1234, 'ceilCZK keeps whole numbers');
assert(ceilCZK(0) === 0, 'ceilCZK handles zero');
assert(ceilTo100(1234) === 1300, 'ceilTo100 rounds up to next hundred');
assert(ceilTo100(1200) === 1200, 'ceilTo100 keeps exact hundreds');
assert(ceilTo100(1201) === 1300, 'ceilTo100 rounds up 1201');
assert(floorCZK(1234.9) === 1234, 'floorCZK rounds down');
assert(floorCZK(1234.0) === 1234, 'floorCZK keeps whole numbers');

// ====================================
// TEST GROUP: Working Hours
// ====================================
console.log('\n⏰ Working Hours');

assert(getWorkingHours(2026, 1) === 168, 'Jan 2026: 21 days × 8h = 168h');
assert(getWorkingHours(2026, 2) === 160, 'Feb 2026: 20 days × 8h = 160h');
assert(getWorkingHours(2026, 12) === 176, 'Dec 2026: 22 days × 8h = 176h');
assert(getWorkingHours(2026, 1, 20) === 84, 'Jan 2026 half-time: 21 days × 4h = 84h');

// ====================================
// TEST GROUP: HPP — Basic Case
// ====================================
console.log('\n💼 HPP — Basic case (35,000 Kč, prohlášení, 0 dětí)');

const hppBasic = calculateHPP({
    hrubaMzda: 35000,
    odpracovaneHodiny: 168,
    fondHodin: 168,
    podepsaneProhlaseni: true,
    pocetDeti: 0,
});

assert(hppBasic.celkovaHruba === 35000, 'Hrubá = 35,000');
assertClose(hppBasic.spZamestnanec, ceilCZK(35000 * 0.071), 'SP zaměstnanec = ceil(35000 × 7.1%)');
assertClose(hppBasic.zpZamestnanec, ceilCZK(35000 * 0.045), 'ZP zaměstnanec = ceil(35000 × 4.5%)');
assertClose(hppBasic.spZamestnavatel, ceilCZK(35000 * 0.248), 'SP zaměstnavatel = ceil(35000 × 24.8%)');
assertClose(hppBasic.zpZamestnavatel, ceilCZK(35000 * 0.09), 'ZP zaměstnavatel = ceil(35000 × 9%)');
assert(hppBasic.zakladDane === 35000, 'Základ daně = hrubá (od 2021)');
assertClose(hppBasic.zalohaDan, ceilCZK(35000 * 0.15), 'Záloha 15%');
assert(hppBasic.slevy >= 2570, 'Sleva poplatníka ≥ 2,570');
assert(hppBasic.cistaMzda > 0, 'Čistá mzda > 0');
assert(hppBasic.cistaMzda < hppBasic.celkovaHruba, 'Čistá < Hrubá');

// Verify: hrubá = čistá + SP_zam + ZP_zam + daň - bonus
const checksum1 = hppBasic.cistaMzda + hppBasic.spZamestnanec + hppBasic.zpZamestnanec + hppBasic.vysledkDan - hppBasic.danovyBonus;
assertClose(checksum1, hppBasic.celkovaHruba, 'Checksum: čistá + odvody zam. + daň = hrubá');

// ====================================
// TEST GROUP: HPP — With Children
// ====================================
console.log('\n👨‍👧‍👦 HPP — 2 děti, prohlášení');

const hppDeti = calculateHPP({
    hrubaMzda: 35000,
    odpracovaneHodiny: 168,
    fondHodin: 168,
    podepsaneProhlaseni: true,
    pocetDeti: 2,
    detiZTP: 0,
});

const expectedZvyhodneni = DEFAULT_TAX_PARAMS_2026.sleva_dite_1 + DEFAULT_TAX_PARAMS_2026.sleva_dite_2;
assertClose(hppDeti.danovaZvyhodneni, expectedZvyhodneni, `Zvýhodnění na 2 děti = ${expectedZvyhodneni}`);
assert(hppDeti.cistaMzda > hppBasic.cistaMzda, 'Čistá s dětmi > čistá bez dětí');

// ====================================
// TEST GROUP: HPP — 3 děti, 1 ZTP/P
// ====================================
console.log('\n👨‍👧‍👦 HPP — 3 děti (1 ZTP/P)');

const hppZTP = calculateHPP({
    hrubaMzda: 30000,
    odpracovaneHodiny: 168,
    fondHodin: 168,
    podepsaneProhlaseni: true,
    pocetDeti: 3,
    detiZTP: 1,
});

// 2 normální děti (1. + 2.) + 1 ZTP (3. pozice = sleva_dite_3 × 2)
const expectedZTP = DEFAULT_TAX_PARAMS_2026.sleva_dite_1
    + DEFAULT_TAX_PARAMS_2026.sleva_dite_2
    + DEFAULT_TAX_PARAMS_2026.sleva_dite_3 * 2;
assertClose(hppZTP.danovaZvyhodneni, expectedZTP, `Zvýhodnění 3 děti (1 ZTP) = ${expectedZTP}`);
assert(hppZTP.danovyBonus > 0 || hppZTP.vysledkDan >= 0, 'Daňový bonus nebo nulová daň');

// ====================================
// TEST GROUP: HPP — Invalidita
// ====================================
console.log('\n♿ HPP — Invalidita 3. stupně');

const hppInv = calculateHPP({
    hrubaMzda: 25000,
    odpracovaneHodiny: 168,
    fondHodin: 168,
    podepsaneProhlaseni: true,
    pocetDeti: 0,
    invalidita: '3',
});

assert(hppInv.slevy >= 2570 + 420, 'Slevy zahrnují poplatníka + invaliditu 3.');
assert(hppInv.cistaMzda > 0, 'Čistá mzda > 0');

// ====================================
// TEST GROUP: HPP — High income (23% bracket)
// ====================================
console.log('\n💰 HPP — Vysoký příjem (23% pásmo)');

const hppHigh = calculateHPP({
    hrubaMzda: 200000,
    odpracovaneHodiny: 168,
    fondHodin: 168,
    podepsaneProhlaseni: true,
    pocetDeti: 0,
});

assert(hppHigh.celkovaHruba === 200000, 'Hrubá = 200,000');
const threshold = DEFAULT_TAX_PARAMS_2026.tax_threshold_monthly;
const expectedTax = ceilCZK(threshold * 0.15 + (200000 - threshold) * 0.23);
assertClose(hppHigh.zalohaDan, expectedTax, `Záloha: 15% do ${threshold} + 23% nad`);
assert(hppHigh.zalohaDan > ceilCZK(200000 * 0.15), 'Záloha > prosté 15% (progresivní sazba)');

// ====================================
// TEST GROUP: HPP — Part-time
// ====================================
console.log('\n⏱️ HPP — Částečný úvazek (80/160 hodin)');

const hppPart = calculateHPP({
    hrubaMzda: 40000,
    odpracovaneHodiny: 80,
    fondHodin: 160,
    podepsaneProhlaseni: true,
    pocetDeti: 0,
});

assertClose(hppPart.pomernaHruba, 20000, 'Poměrná hrubá = 40,000 × 80/160 = 20,000');
assert(hppPart.celkovaHruba === 20000, 'Celková hrubá = 20,000');

// ====================================
// TEST GROUP: HPP — Bonus + Srážka
// ====================================
console.log('\n🎁 HPP — Bonus 5,000 + Srážka 1,000');

const hppBonus = calculateHPP({
    hrubaMzda: 30000,
    odpracovaneHodiny: 168,
    fondHodin: 168,
    bonus: 5000,
    srazka: 1000,
    podepsaneProhlaseni: true,
    pocetDeti: 0,
});

assert(hppBonus.celkovaHruba === 34000, 'Hrubá = 30,000 + 5,000 - 1,000 = 34,000');
assert(hppBonus.bonus === 5000, 'Bonus uložen');
assert(hppBonus.srazka === 1000, 'Srážka uložena');

// ====================================
// TEST GROUP: HPP — Zero hours (unpaid leave)
// ====================================
console.log('\n🏠 HPP — Nulové hodiny (neplacené volno)');

const hppZero = calculateHPP({
    hrubaMzda: 35000,
    odpracovaneHodiny: 0,
    fondHodin: 168,
    podepsaneProhlaseni: true,
    pocetDeti: 0,
});

assert(hppZero.pomernaHruba === 0, 'Poměrná hrubá = 0');
assert(hppZero.celkovaHruba === 0, 'Celková hrubá = 0');
assert(hppZero.cistaMzda === 0, 'Čistá mzda = 0');
assert(hppZero.spZamestnanec === 0, 'SP zam = 0');
assert(hppZero.zpZamestnanec === 0, 'ZP zam = 0');

// ====================================
// TEST GROUP: HPP — Without declaration
// ====================================
console.log('\n📝 HPP — Bez podepsaného prohlášení');

const hppNoPr = calculateHPP({
    hrubaMzda: 35000,
    odpracovaneHodiny: 168,
    fondHodin: 168,
    podepsaneProhlaseni: false,
    pocetDeti: 2,
});

assert(hppNoPr.slevy === 0, 'Bez prohlášení: žádné slevy');
assert(hppNoPr.danovaZvyhodneni === 0, 'Bez prohlášení: žádné zvýhodnění na děti');
assert(hppNoPr.cistaMzda < hppDeti.cistaMzda, 'Bez prohlášení: nižší čistá než s prohlášením');

// ====================================
// TEST GROUP: DPP — Under 10,000 (no SP/ZP)
// ====================================
console.log('\n📋 DPP — Pod 10,000 Kč (bez SP/ZP)');

const dppLow = calculateDPP({
    odmena: 8000,
    podepsaneProhlaseni: false,
});

assert(dppLow.celkovaOdmena === 8000, 'Odměna = 8,000');
assert(!dppLow.spZpApplies, 'SP/ZP se neplatí');
assert(dppLow.spZamestnanec === 0, 'SP zaměstnanec = 0');
assert(dppLow.zpZamestnanec === 0, 'ZP zaměstnanec = 0');
assert(dppLow.spZamestnavatel === 0, 'SP zaměstnavatel = 0');
assert(dppLow.zpZamestnavatel === 0, 'ZP zaměstnavatel = 0');
assert(dppLow.useSrazkovaDan, 'Srážková daň (bez prohlášení, pod limit)');
assertClose(dppLow.srazkovaDan, ceilCZK(8000 * 0.15), 'Srážková daň = ceil(8,000 × 15%)');
assertClose(dppLow.cistaMzda, 8000 - ceilCZK(8000 * 0.15), 'Čistá = 8,000 - srážková daň');

// ====================================
// TEST GROUP: DPP — Over 10,000 (full SP/ZP)
// ====================================
console.log('\n📋 DPP — Nad 10,000 Kč (plné SP/ZP)');

const dppHigh = calculateDPP({
    odmena: 15000,
    podepsaneProhlaseni: true,
    pocetDeti: 0,
});

assert(dppHigh.spZpApplies, 'SP/ZP se platí');
assertClose(dppHigh.spZamestnanec, ceilCZK(15000 * 0.071), 'SP zaměstnanec = ceil(15,000 × 7.1%)');
assertClose(dppHigh.zpZamestnanec, ceilCZK(15000 * 0.045), 'ZP zaměstnanec = ceil(15,000 × 4.5%)');
assert(!dppHigh.useSrazkovaDan, 'Záloha na daň (s prohlášením)');
assert(dppHigh.zalohaDan > 0, 'Záloha > 0');

// Checksum
const checkDpp = dppHigh.cistaMzda + dppHigh.spZamestnanec + dppHigh.zpZamestnanec + dppHigh.vysledkDan - dppHigh.danovyBonus;
assertClose(checkDpp, dppHigh.celkovaOdmena, 'Checksum DPP: čistá + odvody = odměna');

// ====================================
// TEST GROUP: DPP — Exactly 10,000
// ====================================
console.log('\n📋 DPP — Přesně 10,000 Kč');

const dppExact = calculateDPP({
    odmena: 10000,
    podepsaneProhlaseni: false,
});

assert(!dppExact.spZpApplies, 'SP/ZP se neplatí (přesně na limitu = neplatí)');
assert(dppExact.useSrazkovaDan, 'Srážková daň');

// ====================================
// TEST GROUP: DPČ — Under 4,000 (no SP)
// ====================================
console.log('\n📝 DPČ — Pod 4,000 Kč (bez SP)');

const dpcLow = calculateDPC({
    odmena: 3500,
    podepsaneProhlaseni: false,
});

assert(!dpcLow.spApplies, 'SP se neplatí (pod 4,000)');
assert(dpcLow.spZamestnanec === 0, 'SP zaměstnanec = 0');
assert(dpcLow.zpApplies, 'ZP se platí (DPČ — vždy)');
assert(dpcLow.zpZamestnanec > 0, 'ZP zaměstnanec > 0');
assert(dpcLow.useSrazkovaDan, 'Srážková daň (bez prohlášení)');

// ====================================
// TEST GROUP: DPČ — Over 4,000 (full SP)
// ====================================
console.log('\n📝 DPČ — Nad 4,000 Kč (plné SP)');

const dpcHigh = calculateDPC({
    odmena: 12000,
    podepsaneProhlaseni: true,
    pocetDeti: 1,
});

assert(dpcHigh.spApplies, 'SP se platí (nad 4,000)');
assert(dpcHigh.spZamestnanec > 0, 'SP zaměstnanec > 0');
assert(dpcHigh.zpZamestnanec > 0, 'ZP zaměstnanec > 0');
assert(!dpcHigh.useSrazkovaDan, 'Záloha na daň (s prohlášením)');

// Checksum
const checkDpc = dpcHigh.cistaMzda + dpcHigh.spZamestnanec + dpcHigh.zpZamestnanec + dpcHigh.vysledkDan - dpcHigh.danovyBonus;
assertClose(checkDpc, dpcHigh.celkovaOdmena, 'Checksum DPČ: čistá + odvody = odměna');

// ====================================
// TEST GROUP: Batch Calculation
// ====================================
console.log('\n📊 Batch Calculation');

const employees = [
    { id: 1, uuid: 'e1', name: 'Jan Novák', typ_uvazku: 'HPP', hruba_mzda_czk: 35000, podepsane_prohlaseni: true, pocet_deti: 1, deti_ztp: 0, invalidita: 'none', sleva_student: false },
    { id: 2, uuid: 'e2', name: 'Marie Dvořáková', typ_uvazku: 'HPP', hruba_mzda_czk: 45000, podepsane_prohlaseni: true, pocet_deti: 2, deti_ztp: 0, invalidita: 'none', sleva_student: false },
    { id: 3, uuid: 'e3', name: 'Petr Svoboda', typ_uvazku: 'DPP', hruba_mzda_czk: 8000, podepsane_prohlaseni: false, pocet_deti: 0, deti_ztp: 0, invalidita: 'none', sleva_student: false },
    { id: 4, uuid: 'e4', name: 'Eva Černá', typ_uvazku: 'DPC', hruba_mzda_czk: 6000, podepsane_prohlaseni: true, pocet_deti: 0, deti_ztp: 0, invalidita: 'none', sleva_student: false },
];

const inputs = [
    { employee_id: 1, odpracovane_hodiny: 168, bonus: 3000, srazka: 0 },
    { employee_id: 2, odpracovane_hodiny: 168, bonus: 0, srazka: 500 },
    { employee_id: 3, bonus: 0, srazka: 0 },
    { employee_id: 4, bonus: 1000, srazka: 0 },
];

const batch = calculateBatchPayroll(employees, inputs, DEFAULT_TAX_PARAMS_2026, 2026, 1);

assert(batch.items.length === 4, 'Batch: 4 zaměstnanci spočítáni');
assert(batch.errors.length === 0, 'Batch: žádné chyby');
assert(batch.summary.employeeCount === 4, 'Summary: 4 zaměstnanců');
assert(batch.summary.celkemHruba > 0, 'Summary: celkem hrubá > 0');
assert(batch.summary.celkemCista > 0, 'Summary: celkem čistá > 0');
assert(batch.summary.platbaFU >= 0, 'Summary: platba FÚ ≥ 0');
assert(batch.summary.platbaOSSZ > 0, 'Summary: platba OSSZ > 0');
assert(batch.summary.platbaZP > 0, 'Summary: platba ZP > 0');
assert(batch.summary.platbaMzdy > 0, 'Summary: platba mzdy > 0');

// Verify totals consistency
const totalHruba = batch.items.reduce((s, i) => s + i.celkovaHruba, 0);
assertClose(batch.summary.celkemHruba, totalHruba, 'Summary totals match item sums');

// Check each employee type
assert(batch.items[0].typ === 'HPP', 'Employee 1 is HPP');
assert(batch.items[2].typ === 'DPP', 'Employee 3 is DPP');
assert(batch.items[3].typ === 'DPC', 'Employee 4 is DPČ');

// ====================================
// TEST GROUP: Validation
// ====================================
console.log('\n🔍 Validation — IČO');

assert(validateICO('27074358') === true, 'Valid IČO: 27074358 (Seznam.cz)');
assert(validateICO('25596641') === true, 'Valid IČO: 25596641');
assert(validateICO('00000000') === false, 'Invalid IČO: 00000000');
assert(validateICO('1234567') === false, 'Invalid IČO: too short');
assert(validateICO('12345678') === false, 'Invalid IČO: bad checksum');
assert(validateICO('') === false, 'Invalid IČO: empty');

console.log('\n🔍 Validation — Rodné číslo');

assert(validateRodneCislo('900101/0007') === true, 'Valid RČ: 900101/0007');
assert(validateRodneCislo('9001010007') === true, 'Valid RČ: no slash');
assert(validateRodneCislo('905101/0001') === true, 'Valid RČ: female (+50 month)');
assert(validateRodneCislo('12345') === false, 'Invalid RČ: too short');
assert(validateRodneCislo('') === false, 'Invalid RČ: empty');

console.log('\n🔍 Validation — Bank Account');

assert(validateBankAccount('2800000008/2010') === true, 'Valid account: Fio');
assert(validateBankAccount('19-2000145399/0800') === true, 'Valid account: with prefix');
assert(validateBankAccount('invalid') === false, 'Invalid account format');
assert(validateBankAccount('') === false, 'Invalid account: empty');

console.log('\n🔍 Validation — Employee');

const validEmp = {
    typ_uvazku: 'HPP',
    hruba_mzda_czk: 30000,
    pocet_deti: 1,
    deti_ztp: 0,
    invalidita: 'none',
};
const validErrs = validateEmployee(validEmp);
assert(validErrs.length === 0, 'Valid employee: no errors');

const invalidEmp = {
    typ_uvazku: 'INVALID',
    hruba_mzda_czk: -1000,
    pocet_deti: -1,
    deti_ztp: 5,
    invalidita: 'fake',
};
const invalidErrs = validateEmployee(invalidEmp);
assert(invalidErrs.length >= 3, `Invalid employee: ${invalidErrs.length} errors detected`);

// ====================================
// TEST GROUP: CZK ↔ ALEO Conversion
// ====================================
console.log('\n💱 CZK ↔ ALEO Conversion');

const microcredits = czkToAleo(30000, 150); // 1 ALEO = 150 CZK
assert(microcredits === 200_000_000, 'CZK to ALEO: 30,000 CZK @ 150 = 200 ALEO (200M μcredits)');

const czk = aleoToCzk(1_000_000, 150); // 1 ALEO
assert(czk === 150, 'ALEO to CZK: 1 ALEO @ 150 = 150 CZK');

// ====================================
// TEST GROUP: Edge Cases
// ====================================
console.log('\n⚠️ Edge Cases');

// HPP exactly at min wage
const hppMin = calculateHPP({
    hrubaMzda: DEFAULT_TAX_PARAMS_2026.min_wage_monthly,
    odpracovaneHodiny: 168,
    fondHodin: 168,
    podepsaneProhlaseni: true,
    pocetDeti: 0,
});
assert(hppMin.cistaMzda > 0, 'Min wage HPP: čistá > 0');
assert(hppMin.celkovaHruba === DEFAULT_TAX_PARAMS_2026.min_wage_monthly, 'Min wage equals param');

// DPP exactly at 10,001 (just over limit)
const dppJustOver = calculateDPP({
    odmena: 10001,
    podepsaneProhlaseni: true,
});
assert(dppJustOver.spZpApplies, 'DPP 10,001: SP/ZP applies');

// Student sleva
const hppStudent = calculateHPP({
    hrubaMzda: 25000,
    odpracovaneHodiny: 168,
    fondHodin: 168,
    podepsaneProhlaseni: true,
    pocetDeti: 0,
    student: true,
});
assert(hppStudent.slevy > hppBasic.slevy || hppStudent.slevy > DEFAULT_TAX_PARAMS_2026.sleva_poplatnik,
    'Student gets extra sleva');

// Very high salary (boundary test)
const hppVeryHigh = calculateHPP({
    hrubaMzda: 500000,
    odpracovaneHodiny: 168,
    fondHodin: 168,
    podepsaneProhlaseni: true,
    pocetDeti: 0,
});
assert(hppVeryHigh.cistaMzda > 0, 'Very high salary: still positive');
assert(hppVeryHigh.zalohaDan > ceilCZK(500000 * 0.15), '500k: progressive tax higher than flat 15%');

// ====================================
// 7. SICK LEAVE COMPENSATION
// ====================================
console.log('\n--- 7. Sick Leave Compensation ---');
{
    // Standard case: 5 sick work days, starting calendar day 1
    const sick = calculateSickLeaveCompensation(40000, 168, 5, 1);
    assert(sick.nahradaNemoc > 0, 'Sick leave compensation > 0');
    assert(sick.employerDays === 5, 'All 5 days within employer 14-day window');
    // dailyBase = 40000/168 * 8 = ~1904.76, comp = 1904.76 * 0.6 * 5 = ~5714
    const expectedComp = Math.round((40000 / 168) * 8 * 0.6 * 5);
    assertClose(sick.nahradaNemoc, expectedComp, 'Sick leave: 60% of daily base * employer days', 5);

    // Zero sick days
    const sickZero = calculateSickLeaveCompensation(40000, 168, 0, 0);
    assert(sickZero.nahradaNemoc === 0, 'No sick days = 0 compensation');

    // Edge: very short period
    const sickShort = calculateSickLeaveCompensation(30000, 160, 1, 3);
    assert(sickShort.nahradaNemoc > 0, 'Short sick leave still pays');
}

// ====================================
// 8. DEDUCTIONS (SRÁŽKY)
// ====================================
console.log('\n--- 8. Deductions ---');
{
    // Simple deduction — uses correct field names: fixed_amount_czk, total_obligation_czk, total_deducted_czk
    const result = applyDeductions(30000, [
        { type: 'exekuce_prednostni', fixed_amount_czk: 5000, total_obligation_czk: 50000, total_deducted_czk: 0 },
    ]);
    assert(result.totalDeducted > 0, 'At least some deduction applied');
    assert(result.kVyplate < 30000, 'Net after deductions < original');
    assert(result.kVyplate > 0, 'Net after deductions > 0 (nezabavitelná částka)');

    // Deduction with small remaining obligation
    const result2 = applyDeductions(30000, [
        { type: 'alimenty', fixed_amount_czk: 5000, total_obligation_czk: 2000, total_deducted_czk: 0 },
    ]);
    assert(result2.totalDeducted <= 2000, 'Capped at remaining obligation');

    // No deductions
    const result3 = applyDeductions(30000, []);
    assert(result3.totalDeducted === 0, 'No deductions = 0 deducted');
    assert(result3.kVyplate === 30000, 'No deductions = same net');

    // Multiple deductions in priority order
    const result4 = applyDeductions(50000, [
        { type: 'alimenty', fixed_amount_czk: 3000, total_obligation_czk: 100000, total_deducted_czk: 0 },
        { type: 'exekuce_prednostni', fixed_amount_czk: 5000, total_obligation_czk: 100000, total_deducted_czk: 0 },
        { type: 'exekuce_neprednostni', fixed_amount_czk: 2000, total_obligation_czk: 100000, total_deducted_czk: 0 },
    ]);
    assert(result4.appliedDeductions.length === 3, 'Three deductions attempted');
    assert(result4.kVyplate > 0, 'Still positive after multiple deductions');
}

// ====================================
// 9. LIABILITY INSURANCE
// ====================================
console.log('\n--- 9. Liability Insurance ---');
{
    const ins = calculateLiabilityInsurance(1000000);
    assert(ins === Math.round(1000000 * 0.0028), 'Liability ins: 0.28% of total gross');

    const insCustom = calculateLiabilityInsurance(500000, 0.005);
    assert(insCustom === Math.round(500000 * 0.005), 'Custom rate works');

    const insZero = calculateLiabilityInsurance(0);
    assert(insZero === 0, 'Zero gross = zero insurance');
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
