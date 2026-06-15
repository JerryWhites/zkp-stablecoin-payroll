// ====================================
// UAE Payroll Engine v1.0
// ====================================
// Pure calculation functions for UAE payroll (Federal Decree-Law 33/2021).
// No side effects, no DB access — fully testable.
//
// Legislation references:
// - Federal Decree-Law 33/2021 (UAE Labour Law), effective 2022-02-02
// - Cabinet Resolution 1/2022 (Executive Regulations)
// - Federal Law 7/1999 (GPSSA pension for UAE/GCC nationals)
// - Ministerial Resolution 788/2009 (Wage Protection System)
//
// Money unit: whole AED (1 AED = 100 fils). Calculations keep integers where
// possible; the only fractional step is the per-day basic-wage divisor (/30).

'use strict';

// ====================================
// ROUNDING
// ====================================

function roundAED(amount) {
    return Math.round(amount);
}

function ceilAED(amount) {
    return Math.ceil(amount);
}

function floorAED(amount) {
    return Math.floor(amount);
}

// ====================================
// DEFAULT UAE PARAMS (2026)
// ====================================

const DEFAULT_UAE_PARAMS_2026 = {
    year: 2026,

    // Working time (Art. 17, 65)
    standard_hours_per_week: 48,
    standard_hours_per_day: 8,
    ramadan_hours_per_day: 6,                 // 2h reduction for fasting Muslims
    max_overtime_hours_per_day: 2,            // Art. 65 cap
    overtime_rate_day: 1.25,                  // 125% regular
    overtime_rate_night_or_friday: 1.50,      // 150% (10pm–4am or Friday)

    // Leave (Art. 29, 31)
    annual_leave_days_full: 30,               // after 1 year
    annual_leave_days_per_month: 2,           // between 6-12 months service
    annual_leave_probation_threshold_months: 6,
    sick_leave_full_days: 15,
    sick_leave_half_days: 30,
    sick_leave_probation_days: 90,            // Art. 31: sick leave starts after probation

    // Gratuity / End of Service (Art. 51)
    gratuity_min_service_years: 1,
    gratuity_first5_days_per_year: 21,
    gratuity_after5_days_per_year: 30,
    gratuity_cap_years: 2,                    // max 2 years' total wage
    gratuity_divisor: 30,                     // monthly / 30 = daily basic

    // GPSSA — Private sector UAE nationals (Federal Law 7/1999, as amended)
    // Only applies to UAE nationals and select GCC nationals.
    gpssa_employee_rate: 0.05,                // 5%
    gpssa_employer_rate: 0.125,               // 12.5%
    gpssa_government_rate: 0.025,             // 2.5% (not withheld — informational)
    gpssa_contribution_floor_aed: 1_000,
    gpssa_contribution_cap_aed: 50_000,

    // Probation (Art. 9)
    max_probation_months: 6,

    // UAE has no personal income tax — no tax fields.
};

// ====================================
// WORKING-DAY CALENDAR
// ====================================
// Private sector weekend is Saturday–Sunday (MoHRE, since Jan 2022).
// This helper returns working days in a month for leave proration.

function getWorkingDays(year, month) {
    const daysInMonth = new Date(year, month, 0).getDate();
    let workingDays = 0;
    for (let d = 1; d <= daysInMonth; d++) {
        const dow = new Date(year, month - 1, d).getDay(); // 0=Sun..6=Sat
        if (dow !== 0 && dow !== 6) workingDays++;
    }
    return workingDays;
}

function getCalendarDays(year, month) {
    return new Date(year, month, 0).getDate();
}

// ====================================
// OVERTIME (Art. 65)
// ====================================
// Regular hourly rate = monthly basic / (working days × 8)
// Daytime OT: 125%, Night (10pm–4am) or Friday OT: 150%.

function calculateOvertime(params, uaeParams = DEFAULT_UAE_PARAMS_2026) {
    const {
        basicMonthly,
        workingDaysInMonth,
        overtimeHoursDay = 0,
        overtimeHoursNightOrFriday = 0,
    } = params;

    const hoursPerDay = uaeParams.standard_hours_per_day;
    const regularHourly = basicMonthly / (workingDaysInMonth * hoursPerDay);

    const dayPay = overtimeHoursDay * regularHourly * uaeParams.overtime_rate_day;
    const nightPay = overtimeHoursNightOrFriday * regularHourly * uaeParams.overtime_rate_night_or_friday;

    return {
        regularHourly: roundAED(regularHourly * 100) / 100,
        overtimeHoursDay,
        overtimeHoursNightOrFriday,
        overtimeDayPay: roundAED(dayPay),
        overtimeNightPay: roundAED(nightPay),
        overtimeTotal: roundAED(dayPay + nightPay),
    };
}

// ====================================
// SICK LEAVE (Art. 31)
// ====================================
// 15 days full pay, next 30 days half pay, remainder unpaid.
// Not payable during probation (first 90 days).

function classifySickDays(sickDaysThisYear, daysToAllocate, uaeParams = DEFAULT_UAE_PARAMS_2026) {
    let fullPaid = 0;
    let halfPaid = 0;
    let unpaid = 0;
    let already = sickDaysThisYear;
    let remaining = daysToAllocate;

    const fullCap = uaeParams.sick_leave_full_days;
    const halfCap = fullCap + uaeParams.sick_leave_half_days;

    while (remaining > 0) {
        if (already < fullCap) {
            const take = Math.min(remaining, fullCap - already);
            fullPaid += take;
            already += take;
            remaining -= take;
        } else if (already < halfCap) {
            const take = Math.min(remaining, halfCap - already);
            halfPaid += take;
            already += take;
            remaining -= take;
        } else {
            unpaid += remaining;
            remaining = 0;
        }
    }
    return { fullPaid, halfPaid, unpaid };
}

function calculateSickLeavePay(params, uaeParams = DEFAULT_UAE_PARAMS_2026) {
    const {
        basicMonthly,
        sickDaysTaken,
        sickDaysAlreadyUsedThisYear = 0,
        daysOfServiceAtStart,
    } = params;

    if (daysOfServiceAtStart < uaeParams.sick_leave_probation_days) {
        return {
            fullPaidDays: 0,
            halfPaidDays: 0,
            unpaidDays: sickDaysTaken,
            amount: 0,
            note: 'probation',
        };
    }

    const dailyBasic = basicMonthly / uaeParams.gratuity_divisor;
    const { fullPaid, halfPaid, unpaid } = classifySickDays(
        sickDaysAlreadyUsedThisYear,
        sickDaysTaken,
        uaeParams,
    );
    const amount = fullPaid * dailyBasic + halfPaid * dailyBasic * 0.5;

    return {
        fullPaidDays: fullPaid,
        halfPaidDays: halfPaid,
        unpaidDays: unpaid,
        amount: roundAED(amount),
    };
}

// ====================================
// ANNUAL LEAVE (Art. 29)
// ====================================
// 30 calendar days after 1 year, 2 days/month between 6-12 months, 0 before 6 months.

function annualLeaveEntitlement(daysOfService, uaeParams = DEFAULT_UAE_PARAMS_2026) {
    const months = Math.floor(daysOfService / 30);
    if (months >= 12) return uaeParams.annual_leave_days_full;
    if (months >= uaeParams.annual_leave_probation_threshold_months) {
        return months * uaeParams.annual_leave_days_per_month;
    }
    return 0;
}

// ====================================
// GRATUITY / END OF SERVICE (Art. 51)
// ====================================
// Payable after 1 full year.
// First 5 years: 21 days basic / year.
// After 5 years: 30 days basic / year (for the portion above 5).
// Capped at 2 years' total wage.
// Partial years pro-rated.

function completedYears(startDate, endDate) {
    const s = new Date(startDate);
    const e = new Date(endDate);
    let years = e.getUTCFullYear() - s.getUTCFullYear();
    const mmDiff = e.getUTCMonth() - s.getUTCMonth();
    const ddDiff = e.getUTCDate() - s.getUTCDate();
    if (mmDiff < 0 || (mmDiff === 0 && ddDiff < 0)) years--;
    return Math.max(0, years);
}

function fractionalYearAfterCompleted(startDate, endDate, completed) {
    const s = new Date(startDate);
    const anchor = new Date(Date.UTC(
        s.getUTCFullYear() + completed,
        s.getUTCMonth(),
        s.getUTCDate(),
    ));
    const e = new Date(endDate);
    const msPerDay = 24 * 60 * 60 * 1000;
    const days = Math.max(0, Math.round((e - anchor) / msPerDay));
    return days / 365;
}

function calculateGratuity(params, uaeParams = DEFAULT_UAE_PARAMS_2026) {
    const { basicMonthly, startDate, endDate, terminationReason = 'resignation' } = params;
    const dailyBasic = basicMonthly / uaeParams.gratuity_divisor;

    const completed = completedYears(startDate, endDate);
    if (completed < uaeParams.gratuity_min_service_years) {
        return {
            eligible: false,
            completedYears: completed,
            amount: 0,
            note: 'under 1 year of service',
        };
    }

    const frac = fractionalYearAfterCompleted(startDate, endDate, completed);
    const totalYears = completed + frac;

    const first5Years = Math.min(totalYears, 5);
    const after5Years = Math.max(0, totalYears - 5);

    let days = first5Years * uaeParams.gratuity_first5_days_per_year
             + after5Years * uaeParams.gratuity_after5_days_per_year;

    let amount = days * dailyBasic;

    // Cap at 2 years' total wage
    const cap = basicMonthly * 12 * uaeParams.gratuity_cap_years;
    if (amount > cap) amount = cap;

    return {
        eligible: true,
        completedYears: completed,
        totalYearsOfService: Number(totalYears.toFixed(4)),
        daysAccrued: Number(days.toFixed(2)),
        amount: roundAED(amount),
        cappedAt2Years: amount === cap,
        terminationReason,
    };
}

// ====================================
// GPSSA PENSION (UAE/GCC nationals only)
// ====================================
// Federal Law 7/1999. Applies only to UAE and GCC-national employees.
// Contribution wage floor AED 1,000, cap AED 50,000.

function calculateGPSSA(params, uaeParams = DEFAULT_UAE_PARAMS_2026) {
    const {
        isUaeOrGccNational,
        basicMonthly,
        housingAllowance = 0,
        otherPensionableAllowances = 0,
    } = params;

    if (!isUaeOrGccNational) {
        return {
            applicable: false,
            contributionWage: 0,
            employeeShare: 0,
            employerShare: 0,
            governmentShare: 0,
            totalContribution: 0,
        };
    }

    let contribWage = basicMonthly + housingAllowance + otherPensionableAllowances;
    if (contribWage < uaeParams.gpssa_contribution_floor_aed) {
        contribWage = uaeParams.gpssa_contribution_floor_aed;
    }
    if (contribWage > uaeParams.gpssa_contribution_cap_aed) {
        contribWage = uaeParams.gpssa_contribution_cap_aed;
    }

    const employeeShare = contribWage * uaeParams.gpssa_employee_rate;
    const employerShare = contribWage * uaeParams.gpssa_employer_rate;
    const governmentShare = contribWage * uaeParams.gpssa_government_rate;

    return {
        applicable: true,
        contributionWage: roundAED(contribWage),
        employeeShare: roundAED(employeeShare),
        employerShare: roundAED(employerShare),
        governmentShare: roundAED(governmentShare),
        totalContribution: roundAED(employeeShare + employerShare + governmentShare),
    };
}

// ====================================
// DEDUCTIONS
// ====================================
// UAE allows employer-ordered deductions (loans, training costs, court orders,
// absence without leave) but total deductions may not exceed 50% of wage
// (Art. 25). Applied in priority order with partial-apply rollover.

const MAX_DEDUCTION_RATIO = 0.5; // Art. 25

function applyDeductions(netBeforeDeductions, deductions = [], options = {}) {
    const maxDeductible = Math.floor(netBeforeDeductions * (options.maxRatio ?? MAX_DEDUCTION_RATIO));
    const sorted = [...deductions].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));

    let budget = maxDeductible;
    const applied = [];
    let totalApplied = 0;

    for (const d of sorted) {
        if (budget <= 0) {
            applied.push({ ...d, applied: 0, deferred: d.amount });
            continue;
        }
        const take = Math.min(budget, d.amount);
        applied.push({ ...d, applied: take, deferred: d.amount - take });
        budget -= take;
        totalApplied += take;
    }

    return {
        applied,
        totalApplied,
        netAfterDeductions: netBeforeDeductions - totalApplied,
        maxDeductible,
    };
}

// ====================================
// CONTRACT-TYPE DISPATCH
// ====================================
// UAE contract types (Federal Decree-Law 33/2021, Art. 8):
//  - full_time    (Unified Contract, default)
//  - part_time    (pro-rated wages and leave)
//  - temporary    (fixed term)
//  - flexible     (hours agreed per engagement)
//  - freelance    (Freelance permit — no sponsor, no GPSSA)

const CONTRACT_TYPES = ['full_time', 'part_time', 'temporary', 'flexible', 'freelance'];

function validateContractType(type) {
    return CONTRACT_TYPES.includes(type);
}

// ====================================
// CORE PAYROLL CALCULATION (single employee, one period)
// ====================================

function calculatePayroll(employee, period, uaeParams = DEFAULT_UAE_PARAMS_2026) {
    const {
        basicMonthly,
        housingAllowance = 0,
        transportAllowance = 0,
        otherAllowances = 0,
        isUaeOrGccNational = false,
        contractType = 'full_time',
        startDate,
        cryptoSplitPercent = 0,
    } = employee;

    const {
        year,
        month,
        overtimeHoursDay = 0,
        overtimeHoursNightOrFriday = 0,
        sickDaysTaken = 0,
        sickDaysAlreadyUsedThisYear = 0,
        unpaidLeaveDays = 0,
        daysWorked = null, // if null, assume full month
        deductions = [],
    } = period;

    if (!validateContractType(contractType)) {
        throw new Error(`Invalid contract type: ${contractType}`);
    }

    const workingDays = getWorkingDays(year, month);
    const calendarDays = getCalendarDays(year, month);

    // Full-month basic + allowances. For part-month, pro-rate by workingDays.
    const daysInFullMonth = workingDays;
    const effectiveDaysWorked = daysWorked ?? daysInFullMonth;
    const proration = effectiveDaysWorked / daysInFullMonth;

    const proratedBasic = roundAED(basicMonthly * proration);
    const proratedHousing = roundAED(housingAllowance * proration);
    const proratedTransport = roundAED(transportAllowance * proration);
    const proratedOther = roundAED(otherAllowances * proration);

    // Overtime
    const ot = calculateOvertime(
        { basicMonthly, workingDaysInMonth: workingDays, overtimeHoursDay, overtimeHoursNightOrFriday },
        uaeParams,
    );

    // Sick leave
    const daysOfServiceAtStart = startDate
        ? Math.floor((new Date(year, month - 1, 1) - new Date(startDate)) / (24 * 60 * 60 * 1000))
        : 0;
    const sick = calculateSickLeavePay(
        { basicMonthly, sickDaysTaken, sickDaysAlreadyUsedThisYear, daysOfServiceAtStart },
        uaeParams,
    );

    // Unpaid leave deduction
    const dailyBasic = basicMonthly / uaeParams.gratuity_divisor;
    const unpaidLeaveDeduction = roundAED(unpaidLeaveDays * dailyBasic);

    // Gross
    const grossAED = proratedBasic
        + proratedHousing
        + proratedTransport
        + proratedOther
        + ot.overtimeTotal
        + sick.amount
        - unpaidLeaveDeduction;

    // GPSSA (only for UAE/GCC nationals)
    const gpssa = calculateGPSSA(
        { isUaeOrGccNational, basicMonthly, housingAllowance, otherPensionableAllowances: 0 },
        uaeParams,
    );

    // Freelancers are outside GPSSA regardless of nationality
    const gpssaEmployee = contractType === 'freelance' ? 0 : gpssa.employeeShare;
    const gpssaEmployer = contractType === 'freelance' ? 0 : gpssa.employerShare;

    // Deductions (employer-ordered, court orders, etc.)
    const netBeforeDeductions = grossAED - gpssaEmployee;
    const d = applyDeductions(netBeforeDeductions, deductions);

    // Crypto split (USDCx portion of final net)
    if (cryptoSplitPercent < 0 || cryptoSplitPercent > 100) {
        throw new Error('cryptoSplitPercent must be 0..100');
    }
    const netAED = d.netAfterDeductions;
    const netUsdcxPortion = Math.floor(netAED * (cryptoSplitPercent / 100));
    const netAedPortion = netAED - netUsdcxPortion;

    return {
        period: { year, month, workingDays, calendarDays },
        gross: {
            basic: proratedBasic,
            housing: proratedHousing,
            transport: proratedTransport,
            other: proratedOther,
            overtime: ot.overtimeTotal,
            sickLeavePay: sick.amount,
            unpaidLeaveDeduction,
            total: grossAED,
        },
        overtime: ot,
        sickLeave: sick,
        gpssa: { ...gpssa, employeeShare: gpssaEmployee, employerShare: gpssaEmployer },
        deductions: d,
        net: {
            total: netAED,
            aedPortion: netAedPortion,
            usdcxPortionAed: netUsdcxPortion,
            cryptoSplitPercent,
        },
        employerCost: grossAED + gpssaEmployer,
    };
}

function calculateBatchPayroll(employees, periodByEmployee, uaeParams = DEFAULT_UAE_PARAMS_2026) {
    const results = [];
    let totalGross = 0;
    let totalNet = 0;
    let totalEmployerCost = 0;
    let totalAedNet = 0;
    let totalUsdcxAedNet = 0;

    for (const emp of employees) {
        const period = periodByEmployee[emp.id] ?? {};
        const r = calculatePayroll(emp, period, uaeParams);
        results.push({ employeeId: emp.id, ...r });
        totalGross += r.gross.total;
        totalNet += r.net.total;
        totalEmployerCost += r.employerCost;
        totalAedNet += r.net.aedPortion;
        totalUsdcxAedNet += r.net.usdcxPortionAed;
    }

    return {
        results,
        totals: {
            gross: totalGross,
            net: totalNet,
            employerCost: totalEmployerCost,
            aedNet: totalAedNet,
            usdcxNetInAed: totalUsdcxAedNet,
            headcount: employees.length,
        },
    };
}

// ====================================
// CRYPTO / STABLECOIN CONVERSION
// ====================================
// USDCx is the only supported stablecoin. USDC has 6 decimals on Aleo
// (1 USDC = 1,000,000 base units). AED amount is converted at the
// employer-locked FX rate (aedPerUsdc) captured at run-approval time.

const USDCX_DECIMALS = 6;
const USDCX_MICRO_PER_UNIT = 10 ** USDCX_DECIMALS;

function aedToUsdcx(aedAmount, aedPerUsdc) {
    if (aedPerUsdc <= 0) throw new Error('aedPerUsdc must be > 0');
    const usdcMajor = aedAmount / aedPerUsdc;
    return Math.round(usdcMajor * USDCX_MICRO_PER_UNIT);
}

function usdcxToAed(microUnits, aedPerUsdc) {
    const usdcMajor = microUnits / USDCX_MICRO_PER_UNIT;
    return roundAED(usdcMajor * aedPerUsdc);
}

function splitAedUsdcx(params) {
    const { totalAed, cryptoSplitPercent, aedPerUsdc } = params;
    if (cryptoSplitPercent < 0 || cryptoSplitPercent > 100) {
        throw new Error('cryptoSplitPercent must be 0..100');
    }
    const usdcxPortionAed = Math.floor(totalAed * (cryptoSplitPercent / 100));
    const aedPortion = totalAed - usdcxPortionAed;
    const usdcxMicroUnits = aedToUsdcx(usdcxPortionAed, aedPerUsdc);
    return {
        aedPortion,
        usdcxPortionAed,
        usdcxMicroUnits,
        aedPerUsdcLocked: aedPerUsdc,
    };
}

// ====================================
// VALIDATION
// ====================================

// Emirates ID: 784-YYYY-NNNNNNN-C (784 = UAE country code)
function validateEmiratesId(id) {
    if (typeof id !== 'string') return false;
    return /^784-?\d{4}-?\d{7}-?\d$/.test(id.replace(/\s/g, ''));
}

// UAE IBAN: AE + 2 check digits + 3 bank + 16 account = 23 chars
function validateUaeIban(iban) {
    if (typeof iban !== 'string') return false;
    const cleaned = iban.replace(/\s/g, '').toUpperCase();
    return /^AE\d{21}$/.test(cleaned);
}

// WPS Personal ID: for GCC nationals, Emirates ID used; for expats,
// MoHRE-issued labour card number (14 digits).
function validateWpsPersonId(id) {
    if (typeof id !== 'string') return false;
    const cleaned = id.replace(/[-\s]/g, '');
    return /^\d{12,15}$/.test(cleaned);
}

// MoHRE establishment ID: 13 digits typically.
function validateMohreEstablishmentId(id) {
    if (typeof id !== 'string') return false;
    return /^\d{10,15}$/.test(id.replace(/[-\s]/g, ''));
}

function validateEmployee(employee) {
    const errors = [];
    if (!employee || typeof employee !== 'object') {
        return { valid: false, errors: ['employee payload missing'] };
    }
    if (!employee.firstName) errors.push('firstName required');
    if (!employee.lastName) errors.push('lastName required');
    if (!employee.basicMonthly || employee.basicMonthly < 0) errors.push('basicMonthly must be >= 0');
    if (employee.emiratesId && !validateEmiratesId(employee.emiratesId)) {
        errors.push('Emirates ID must match 784-YYYY-NNNNNNN-C');
    }
    if (employee.iban && !validateUaeIban(employee.iban)) {
        errors.push('IBAN must be a valid UAE IBAN (AE + 21 digits)');
    }
    if (employee.contractType && !validateContractType(employee.contractType)) {
        errors.push(`contractType must be one of: ${CONTRACT_TYPES.join(', ')}`);
    }
    if (employee.cryptoSplitPercent !== undefined) {
        if (employee.cryptoSplitPercent < 0 || employee.cryptoSplitPercent > 100) {
            errors.push('cryptoSplitPercent must be 0..100');
        }
    }
    return { valid: errors.length === 0, errors };
}

// ====================================
// ACCOUNTING JOURNAL (generic)
// ====================================
// Simple double-entry journal. Debit: Salary Expense; Credit: Bank (AED) +
// USDCx wallet + GPSSA payable. Suitable for Zoho Books CSV import.

function generateJournalEntries(batchResult, meta = {}) {
    const {
        period = {},
        accounts = {},
        currency = 'AED',
    } = meta;
    const acc = {
        salaryExpense: '6000',
        gpssaExpense: '6100',
        bankAed: '1100',
        usdcxWallet: '1200',
        gpssaPayable: '2200',
        deductionsPayable: '2300',
        ...accounts,
    };
    const entries = [];
    const ref = `PAY-${period.year ?? 'YYYY'}-${String(period.month ?? 'MM').padStart(2, '0')}`;
    const date = `${period.year}-${String(period.month).padStart(2, '0')}-${String(period.day ?? 28).padStart(2, '0')}`;

    const totals = batchResult.totals;

    // Dr. Salary expense (total gross)
    entries.push({ ref, date, account: acc.salaryExpense, debit: totals.gross, credit: 0, description: 'Gross salaries', currency });
    // Dr. GPSSA employer (expense)
    const gpssaEmployerTotal = batchResult.results.reduce((s, r) => s + r.gpssa.employerShare, 0);
    if (gpssaEmployerTotal > 0) {
        entries.push({ ref, date, account: acc.gpssaExpense, debit: gpssaEmployerTotal, credit: 0, description: 'GPSSA employer share', currency });
    }
    // Cr. Bank (AED portion)
    entries.push({ ref, date, account: acc.bankAed, debit: 0, credit: totals.aedNet, description: 'Salaries — AED via WPS', currency });
    // Cr. USDCx wallet
    if (totals.usdcxNetInAed > 0) {
        entries.push({ ref, date, account: acc.usdcxWallet, debit: 0, credit: totals.usdcxNetInAed, description: 'Salaries — USDCx (Aleo)', currency });
    }
    // Cr. GPSSA payable (employee + employer)
    const gpssaEmployeeTotal = batchResult.results.reduce((s, r) => s + r.gpssa.employeeShare, 0);
    const gpssaPayable = gpssaEmployeeTotal + gpssaEmployerTotal;
    if (gpssaPayable > 0) {
        entries.push({ ref, date, account: acc.gpssaPayable, debit: 0, credit: gpssaPayable, description: 'GPSSA payable', currency });
    }
    // Cr. Deductions payable
    const deductTotal = batchResult.results.reduce((s, r) => s + r.deductions.totalApplied, 0);
    if (deductTotal > 0) {
        entries.push({ ref, date, account: acc.deductionsPayable, debit: 0, credit: deductTotal, description: 'Employee deductions payable', currency });
    }
    return entries;
}

function entriesToCsv(entries) {
    const header = 'ref,date,account,debit,credit,description,currency';
    const rows = entries.map(e =>
        [e.ref, e.date, e.account, e.debit, e.credit, `"${String(e.description).replace(/"/g, '""')}"`, e.currency].join(',')
    );
    return [header, ...rows].join('\n');
}

// Zoho Books journal CSV (matches Zoho Books "Manual Journals" import schema).
function generateZohoBooksJournalCsv(batchResult, meta = {}) {
    const entries = generateJournalEntries(batchResult, meta);
    const header = 'Journal Date,Journal Number,Reference Number,Notes,Account,Debit,Credit,Description,Currency';
    const rows = entries.map(e =>
        [e.date, e.ref, e.ref, 'UAE payroll', e.account, e.debit || '', e.credit || '', `"${String(e.description).replace(/"/g, '""')}"`, e.currency].join(',')
    );
    return [header, ...rows].join('\n');
}

// ====================================
// WPS SIF (Wage Protection System)
// ====================================
// Pipe-delimited SIF format required by MoHRE / UAE Central Bank.
// Header record (EDR) + one SCR per employee + trailer.
// AED portion of salaries only — USDCx paid separately from employer wallet.

function pad(s, len, char = ' ', align = 'left') {
    s = String(s);
    if (s.length >= len) return s.slice(0, len);
    const padding = char.repeat(len - s.length);
    return align === 'left' ? s + padding : padding + s;
}

function generateWpsSif(params) {
    const {
        employerEstablishmentId,   // MoHRE 13-digit
        employerBankCode,          // 3-digit bank routing
        employerIban,              // AE...
        payerId,                   // employer identifier at bank
        payrollMonth,              // 'YYYY-MM'
        paymentDate,               // 'YYYY-MM-DD'
        items,                     // [{ employee, amountAed, days }]
    } = params;

    if (!validateMohreEstablishmentId(employerEstablishmentId)) {
        throw new Error('Invalid MoHRE establishment id');
    }
    if (!validateUaeIban(employerIban)) {
        throw new Error('Invalid employer IBAN');
    }

    const [year, month] = payrollMonth.split('-');
    const paymentDateCompact = paymentDate.replace(/-/g, ''); // YYYYMMDD
    const periodCompact = `${year}${month}`;                   // YYYYMM

    const totalAmount = items.reduce((s, it) => s + it.amountAed, 0);
    const recordCount = items.length;

    // Employer Detail Record (EDR)
    const edr = [
        'EDR',
        employerEstablishmentId,
        employerBankCode,
        employerIban.replace(/\s/g, ''),
        payerId,
        paymentDateCompact,
        periodCompact,
        totalAmount.toFixed(2),
        String(recordCount),
        'AED',
    ].join('|');

    // Salary Credit Records (SCR)
    const scrs = items.map((it, idx) => {
        const emp = it.employee;
        if (!validateWpsPersonId(emp.wpsPersonId)) {
            throw new Error(`Invalid WPS person id for employee ${emp.id ?? idx}`);
        }
        if (!validateUaeIban(emp.iban)) {
            throw new Error(`Invalid IBAN for employee ${emp.id ?? idx}`);
        }
        return [
            'SCR',
            emp.wpsPersonId,
            emp.iban.replace(/\s/g, ''),
            emp.bankCode ?? '',
            it.amountAed.toFixed(2),
            paymentDateCompact,
            periodCompact,
            String(it.days ?? 30),
            emp.fixedComponentAed != null ? Number(emp.fixedComponentAed).toFixed(2) : it.amountAed.toFixed(2),
            emp.variableComponentAed != null ? Number(emp.variableComponentAed).toFixed(2) : '0.00',
            'AED',
        ].join('|');
    });

    return [edr, ...scrs].join('\n') + '\n';
}

// ====================================
// GPSSA MONTHLY REPORT (CSV)
// ====================================
// Report submitted to GPSSA for UAE-national employees.
// Schema approximates the GPSSA e-form export fields.

function generateGpssaReportCsv(batchResult, meta = {}) {
    const {
        employerRegistrationNumber,
        payrollMonth, // 'YYYY-MM'
    } = meta;
    const header = [
        'employerRegistrationNumber',
        'payrollMonth',
        'emiratesId',
        'nationality',
        'contributionWage',
        'employeeShare',
        'employerShare',
        'governmentShare',
        'totalContribution',
    ].join(',');
    const rows = batchResult.results
        .filter(r => r.gpssa.applicable)
        .map(r => [
            employerRegistrationNumber,
            payrollMonth,
            r.emiratesId ?? '',
            r.nationality ?? '',
            r.gpssa.contributionWage,
            r.gpssa.employeeShare,
            r.gpssa.employerShare,
            r.gpssa.governmentShare,
            r.gpssa.totalContribution,
        ].join(','));
    return [header, ...rows].join('\n');
}

// ====================================
// XML / text helpers
// ====================================

function escapeXml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

// ====================================
// EXPORTS
// ====================================

module.exports = {
    // Core
    calculatePayroll,
    calculateBatchPayroll,

    // UAE-specific calculations
    calculateOvertime,
    calculateSickLeavePay,
    classifySickDays,
    annualLeaveEntitlement,
    calculateGratuity,
    calculateGPSSA,
    applyDeductions,

    // Crypto / stablecoin
    aedToUsdcx,
    usdcxToAed,
    splitAedUsdcx,

    // Compliance / exports
    generateWpsSif,
    generateGpssaReportCsv,
    generateJournalEntries,
    generateZohoBooksJournalCsv,
    entriesToCsv,

    // Validation
    validateEmployee,
    validateEmiratesId,
    validateUaeIban,
    validateWpsPersonId,
    validateMohreEstablishmentId,
    validateContractType,

    // Date/calendar helpers
    getWorkingDays,
    getCalendarDays,
    completedYears,

    // Rounding
    roundAED,
    ceilAED,
    floorAED,

    // Text
    escapeXml,

    // Constants
    DEFAULT_UAE_PARAMS_2026,
    CONTRACT_TYPES,
    USDCX_DECIMALS,
    USDCX_MICRO_PER_UNIT,
};
