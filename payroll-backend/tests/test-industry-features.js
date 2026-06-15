// ====================================
// 🧪 Industry Gap Features — Unit Tests
// ====================================
// Run with: node tests/test-industry-features.js
//
// Tests: calculateMealBenefit, calculateCompanyCarBenefit,
//        calculateSurcharges, calculateCommission,
//        calculateFinalPayment, generatePohodaXML,
//        generateMoneyS3XML, generateJournalEntries

'use strict';

const {
    calculateMealBenefit,
    calculateCompanyCarBenefit,
    calculateSurcharges,
    calculateCommission,
    calculateFinalPayment,
    generatePohodaXML,
    generateMoneyS3XML,
    generateJournalEntries,
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
// TEST GROUP: Meal Benefit (Stravenkový paušál)
// ====================================
console.log('\n🍽️  Meal Benefit (Stravenkový paušál)');

{
    const r1 = calculateMealBenefit({ type: 'allowance', workedDays: 20, dailyAllowanceCzk: 116.20 });
    assertClose(r1.totalPaidCzk, 2324, 'Paušál 20 days × 116.20 = 2324 CZK');
    assertClose(r1.totalTaxFreeCzk, 2324, 'Paušál is fully tax-free within limit');
    assertClose(r1.totalTaxableCzk, 0, 'Paušál no taxable amount within limit');
    assert(r1.type === 'meal_allowance', 'Type is meal_allowance');
}

{
    const r2 = calculateMealBenefit({ type: 'allowance', workedDays: 20, dailyAllowanceCzk: 150 });
    assertClose(r2.totalPaidCzk, 3000, 'Paušál 20 × 150 = 3000 CZK total');
    assertClose(r2.totalTaxFreeCzk, 2324, 'Paušál tax-free capped at 20 × 116.20');
    assertClose(r2.totalTaxableCzk, 676, 'Paušál taxable excess 676');
}

{
    const r3 = calculateMealBenefit({ type: 'voucher', workedDays: 20, voucherValueCzk: 150, employerContributionPct: 55 });
    // roundCZK(150 * 0.55) = 83/day → 83 × 20 = 1660 employer, 67 × 20 = 1340 employee
    assertClose(r3.totalEmployerCzk, 1660, 'Stravenky employer 55% of 150 × 20 (rounded)');
    assertClose(r3.totalEmployeeCzk, 1340, 'Stravenky employee pays 45% (rounded)');
    assert(r3.type === 'meal_voucher', 'Type is meal_voucher');
}

{
    const r4 = calculateMealBenefit({ type: 'allowance', workedDays: 0 });
    assertClose(r4.totalPaidCzk, 0, 'Zero days = zero benefit');
}

// ====================================
// TEST GROUP: Company Car Benefit
// ====================================
console.log('\n🚗 Company Car Benefit (§6 odst. 6 ZDP)');

{
    const c1 = calculateCompanyCarBenefit({ carPriceCzk: 1000000, isElectric: false, usageMonths: 12 });
    assertClose(c1.monthlyBenefitCzk, 10000, '1% of 1M = 10 000 CZK');
    assertClose(c1.annualBenefitCzk, 120000, 'Yearly (12 months) = 120 000 CZK');
    assert(c1.rate === 0.01, 'Standard rate is 1%');
}

{
    const c2 = calculateCompanyCarBenefit({ carPriceCzk: 1000000, isElectric: true });
    assertClose(c2.monthlyBenefitCzk, 5000, '0.5% of 1M for electric = 5 000 CZK');
    assert(c2.rate === 0.005, 'Electric rate is 0.5%');
}

{
    const c3 = calculateCompanyCarBenefit({ carPriceCzk: 200000, isElectric: false });
    assertClose(c3.monthlyBenefitCzk, 2000, '1% of 200k = 2 000 CZK');
}

{
    const c4 = calculateCompanyCarBenefit({ carPriceCzk: 50000, isElectric: false });
    assertClose(c4.monthlyBenefitCzk, 1000, 'Min benefit 1000 CZK (below threshold)');
}

// ====================================
// TEST GROUP: Surcharges (Příplatky)
// ====================================
console.log('\n💰 Surcharges (Příplatky za přesčas, noc, víkend, svátek)');

{
    const s1 = calculateSurcharges({ averageHourlyRate: 200, overtimeHours: 10 });
    assertClose(s1.overtimeSurchargeCzk, 500, 'Overtime: 10h × 200 × 25% = 500 CZK');
    assertClose(s1.totalSurchargesCzk, 500, 'Only overtime = 500 total');
}

{
    const s2 = calculateSurcharges({ averageHourlyRate: 200, nightHours: 8 });
    assertClose(s2.nightSurchargeCzk, 160, 'Night: 8h × 200 × 10% = 160 CZK');
}

{
    const s3 = calculateSurcharges({ averageHourlyRate: 200, weekendHours: 16 });
    assertClose(s3.weekendSurchargeCzk, 320, 'Weekend: 16h × 200 × 10% = 320 CZK');
}

{
    const s4 = calculateSurcharges({ averageHourlyRate: 200, holidayHours: 8 });
    assertClose(s4.holidaySurchargeCzk, 1600, 'Holiday: 8h × 200 × 100% = 1600 CZK');
}

{
    const s5 = calculateSurcharges({
        averageHourlyRate: 250,
        overtimeHours: 10,
        nightHours: 8,
        weekendHours: 16,
        holidayHours: 8,
    });
    const expectedOT = 10 * 250 * 0.25;   // 625
    const expectedNight = 8 * 250 * 0.10;  // 200
    const expectedWE = 16 * 250 * 0.10;    // 400
    const expectedHol = 8 * 250 * 1.00;    // 2000
    const expectedTotal = expectedOT + expectedNight + expectedWE + expectedHol; // 3225
    assertClose(s5.totalSurchargesCzk, expectedTotal, `Combined surcharges: ${expectedTotal} CZK`);
    assertClose(s5.overtimeSurchargeCzk, expectedOT, 'OT part correct');
    assertClose(s5.nightSurchargeCzk, expectedNight, 'Night part correct');
    assertClose(s5.weekendSurchargeCzk, expectedWE, 'Weekend part correct');
    assertClose(s5.holidaySurchargeCzk, expectedHol, 'Holiday part correct');
}

{
    const s6 = calculateSurcharges({ averageHourlyRate: 200 });
    assertClose(s6.totalSurchargesCzk, 0, 'No hours = no surcharges');
}

// ====================================
// TEST GROUP: Commission Calculation
// ====================================
console.log('\n📈 Commission Schemes');

{
    const cm1 = calculateCommission({
        type: 'flat_rate',
        revenue: 100000,
        baseRate: 5,
    });
    assertClose(cm1.calculatedCommissionCzk, 5000, 'Flat rate: 5% of 100k = 5000');
}

{
    const cm2 = calculateCommission({
        type: 'flat_rate',
        revenue: 200000,
        baseRate: 10,
        capMonthly: 15000,
    });
    assertClose(cm2.calculatedCommissionCzk, 15000, 'Flat rate with cap: min(20000, 15000) = 15000');
    assert(cm2.capApplied === true, 'Cap applied');
}

{
    const cm3 = calculateCommission({
        type: 'tiered',
        revenue: 500000,
        tiers: [
            { from: 0, to: 100000, rate: 3 },
            { from: 100000, to: 300000, rate: 5 },
            { from: 300000, to: null, rate: 8 },
        ],
    });
    // 0-100k: 100k × 3% = 3000
    // 100k-300k: 200k × 5% = 10000
    // 300k-500k: 200k × 8% = 16000
    // Total: 29000
    assertClose(cm3.calculatedCommissionCzk, 29000, 'Tiered: 3000 + 10000 + 16000 = 29000');
}

{
    const cm4 = calculateCommission({
        type: 'threshold',
        revenue: 120000,
        tiers: [{ from: 100000 }],
        baseRate: 10,
    });
    // threshold: revenue >= 100k → 10% of full 120k = 12000
    assertClose(cm4.calculatedCommissionCzk, 12000, 'Threshold met: 10% of 120k = 12000');
}

{
    const cm5 = calculateCommission({
        type: 'threshold',
        revenue: 80000,
        tiers: [{ from: 100000 }],
        baseRate: 10,
    });
    assertClose(cm5.calculatedCommissionCzk, 0, 'Threshold not met: 0');
}

{
    const cm6 = calculateCommission({
        type: 'flat_per_unit',
        units: 50,
        baseAmount: 200,
    });
    assertClose(cm6.calculatedCommissionCzk, 10000, 'Flat per unit: 50 × 200 = 10000');
}

{
    const cm7 = calculateCommission({
        type: 'flat_per_unit',
        units: 100,
        baseAmount: 200,
        capMonthly: 15000,
    });
    assertClose(cm7.calculatedCommissionCzk, 15000, 'Flat per unit with cap: min(20000, 15000) = 15000');
}

// ====================================
// TEST GROUP: Final Payment (Offboarding)
// ====================================
console.log('\n🚪 Final Payment Calculation (Offboarding)');

{
    const fp1 = calculateFinalPayment({
        terminationType: 'employer_notice',
        yearsOfService: 0.5,
        averageMonthlySalary: 40000,
        unusedVacationDays: 5,
        dailySalary: 1818,
    });
    assertClose(fp1.severanceAmountCzk, 40000, 'Employer notice <1y: 1× average = 40000');
    assertClose(fp1.vacationPayoutCzk, 9090, 'Vacation: 5 × 1818 = 9090', 2);
    assert(fp1.severanceMonths === 1, 'Severance months = 1');
}

{
    const fp2 = calculateFinalPayment({
        terminationType: 'employer_notice',
        yearsOfService: 2,
        averageMonthlySalary: 40000,
    });
    assertClose(fp2.severanceAmountCzk, 120000, 'Employer notice 2y+: 3× average = 120000');
    assert(fp2.severanceMonths === 3, 'Severance months = 3');
}

{
    const fp3 = calculateFinalPayment({
        terminationType: 'employer_notice',
        yearsOfService: 1.5,
        averageMonthlySalary: 40000,
    });
    assertClose(fp3.severanceAmountCzk, 80000, 'Employer notice 1-2y: 2× average = 80000');
    assert(fp3.severanceMonths === 2, 'Severance months = 2');
}

{
    const fp4 = calculateFinalPayment({
        terminationType: 'immediate',
        yearsOfService: 0.5,
        averageMonthlySalary: 50000,
    });
    assertClose(fp4.severanceAmountCzk, 600000, 'Health/Immediate: 12× average = 600000');
    assert(fp4.severanceMonths === 12, 'Severance months = 12 for health');
}

{
    const fp5 = calculateFinalPayment({
        terminationType: 'resignation',
        yearsOfService: 5,
        averageMonthlySalary: 40000,
    });
    assertClose(fp5.severanceAmountCzk, 0, 'Employee resignation: no severance');
    assert(fp5.severanceMonths === 0, 'No severance months for resignation');
}

{
    // Mutual agreement also gets severance in CZ law (same as employer_notice)
    const fp6 = calculateFinalPayment({
        terminationType: 'mutual_agreement',
        yearsOfService: 3,
        averageMonthlySalary: 40000,
    });
    assertClose(fp6.severanceAmountCzk, 120000, 'Mutual agreement 2y+: 3× average = 120000 (CZ law)');
    assert(fp6.severanceMonths === 3, 'Mutual agreement gets severance per §67 ZP');
}

// ====================================
// TEST GROUP: Journal Entry Generation
// ====================================
console.log('\n📒 Journal Entry Generation');

{
    const payrollResult = {
        celkovaHruba: 100000,
        spZamestnanec: 7100,
        zpZamestnanec: 4500,
        vysledkDan: 10000,
        cistaMzda: 78400,
        spZamestnavatel: 24800,
        zpZamestnavatel: 9000,
    };

    const entries = generateJournalEntries(payrollResult, {});

    assert(Array.isArray(entries), 'Journal entries is an array');
    assert(entries.length > 0, 'Has at least one entry');

    // Check for standard CZ journal entries
    const grossEntry = entries.find(e => e.debitAccount === '521' && e.creditAccount === '331');
    assert(grossEntry !== undefined, 'Has gross salary entry (521/331)');
    assertClose(grossEntry?.amount || 0, 100000, 'Gross salary amount = 100000');

    const spEmpEntry = entries.find(e => e.debitAccount === '331' && e.creditAccount === '336' && e.component === 'sp_employee');
    assert(spEmpEntry !== undefined, 'Has SP employee entry (331/336)');
    assertClose(spEmpEntry?.amount || 0, 7100, 'SP employee amount = 7100');

    const zpEmpEntry = entries.find(e => e.debitAccount === '331' && e.creditAccount === '336' && e.component === 'zp_employee');
    assert(zpEmpEntry !== undefined, 'Has ZP employee entry (331/336)');
    assertClose(zpEmpEntry?.amount || 0, 4500, 'ZP employee amount = 4500');

    const taxEntry = entries.find(e => e.debitAccount === '331' && e.creditAccount === '342');
    assert(taxEntry !== undefined, 'Has tax entry (331/342)');
    assertClose(taxEntry?.amount || 0, 10000, 'Tax amount = 10000');

    const netEntry = entries.find(e => e.debitAccount === '331' && e.creditAccount === '221');
    assert(netEntry !== undefined, 'Has net salary entry (331/221)');
    assertClose(netEntry?.amount || 0, 78400, 'Net salary amount = 78400');

    const spErEntry = entries.find(e => e.debitAccount === '524' && e.creditAccount === '336' && e.component === 'sp_employer');
    assert(spErEntry !== undefined, 'Has SP employer entry (524/336)');
    assertClose(spErEntry?.amount || 0, 24800, 'SP employer amount = 24800');

    const zpErEntry = entries.find(e => e.debitAccount === '524' && e.creditAccount === '336' && e.component === 'zp_employer');
    assert(zpErEntry !== undefined, 'Has ZP employer entry (524/336)');
    assertClose(zpErEntry?.amount || 0, 9000, 'ZP employer amount = 9000');
}

{
    // Zero payroll
    const zeroEntries = generateJournalEntries({
        celkovaHruba: 0, spZamestnanec: 0, zpZamestnanec: 0,
        vysledkDan: 0, cistaMzda: 0, spZamestnavatel: 0, zpZamestnavatel: 0,
    }, {});
    // Should still generate entries (even if zero), or empty
    assert(Array.isArray(zeroEntries), 'Zero payroll returns array');
}

// ====================================
// TEST GROUP: Pohoda XML Export
// ====================================
console.log('\n📄 Pohoda XML Export');

{
    const entries = [
        { debitAccount: '521', creditAccount: '331', amount: 50000, description: 'Hrubá mzda' },
        { debitAccount: '331', creditAccount: '221', amount: 35000, description: 'Čistá mzda' },
    ];
    const xml = generatePohodaXML({
        companyICO: '12345678',
        companyName: 'Test s.r.o.',
        periodYear: 2026,
        periodMonth: 1,
        entries,
    });

    assert(typeof xml === 'string', 'Pohoda XML is a string');
    assert(xml.includes('<?xml'), 'Has XML declaration');
    assert(xml.includes('dataPack'), 'Has dataPack root element');
    assert(xml.includes('12345678'), 'Contains company ICO');
    assert(xml.includes('521'), 'Contains debit account 521');
    assert(xml.includes('331'), 'Contains account 331');
    assert(xml.includes('50000'), 'Contains amount 50000');
    assert(xml.includes('stormware.cz'), 'Has Stormware namespace URI');
}

// ====================================
// TEST GROUP: Money S3 XML Export
// ====================================
console.log('\n💳 Money S3 XML Export');

{
    const entries = [
        { debitAccount: '521', creditAccount: '331', amount: 50000, description: 'Hrubá mzda' },
    ];
    const xml = generateMoneyS3XML({
        companyICO: '87654321',
        companyName: 'Firma a.s.',
        periodYear: 2026,
        periodMonth: 3,
        entries,
    });

    assert(typeof xml === 'string', 'Money S3 XML is a string');
    assert(xml.includes('<?xml'), 'Has XML declaration');
    assert(xml.includes('MoneyData'), 'Has MoneyData root element');
    assert(xml.includes('UcetMD'), 'Contains UcetMD element');
    assert(xml.includes('521'), 'Contains debit account');
    assert(xml.includes('50000'), 'Contains amount');
}

// ====================================
// TEST GROUP: Edge Cases
// ====================================
console.log('\n🔧 Edge Cases');

{
    // Meal benefit with zero days
    const neg = calculateMealBenefit({ type: 'allowance', workedDays: 0, dailyAllowanceCzk: 116.20 });
    assertClose(neg.totalPaidCzk, 0, 'Zero days => 0 benefit');
}

{
    // Commission with zero revenue
    const zeroComm = calculateCommission({ type: 'flat_rate', revenue: 0, baseRate: 10 });
    assertClose(zeroComm.calculatedCommissionCzk, 0, 'Zero revenue => 0 commission');
}

{
    // Car benefit with zero price
    const zeroCar = calculateCompanyCarBenefit({ carPriceCzk: 0, isElectric: false });
    assertClose(zeroCar.monthlyBenefitCzk, 0, 'Zero car price => 0 benefit');
}

{
    // Surcharges with zero hourly rate
    const zeroRate = calculateSurcharges({ averageHourlyRate: 0, overtimeHours: 10 });
    assertClose(zeroRate.totalSurchargesCzk, 0, 'Zero hourly rate => 0 surcharges');
}

{
    // Final payment with zero service years
    const fp = calculateFinalPayment({
        terminationType: 'employer_notice',
        yearsOfService: 0,
        averageMonthlySalary: 40000,
    });
    assertClose(fp.severanceAmountCzk, 40000, 'Employer notice <1y: 1× average');
}

// ====================================
// TEST SUMMARY
// ====================================
console.log('\n' + '='.repeat(50));
console.log(`📊 INDUSTRY FEATURES TEST RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
    console.log('\n❌ Failed tests:');
    failures.forEach(f => console.log(`   - ${f.testName}: ${f.details}`));
}
console.log('='.repeat(50));

process.exit(failed > 0 ? 1 : 0);
