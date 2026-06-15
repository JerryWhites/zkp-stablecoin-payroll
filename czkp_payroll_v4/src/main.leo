// CZKP Payroll v4 — Private salary payments using ALEO credits + USDCx stablecoin.
//
// This program supports TWO payment modes:
//   1. pay_employee_aleo  — native ALEO credits (same as v3)
//   2. pay_employee_usdcx — USDCx stablecoin via token_registry.aleo
//
// Both modes are fully private ZK transactions: sender, receiver, and amount
// are all hidden on-chain.
//
// USDCx is a Circle xReserve-backed USD stablecoin on Aleo with 6 decimals.
// The token_id for USDCx is a field constant defined below.
//
// token_registry.aleo Token record:
//   { owner, amount: u128, token_id: field, external_authorization_required, authorized_until }

import credits.aleo;
import token_registry.aleo;

program czkp_payroll_v4.aleo {

    // Lock the program — no upgrades allowed.
    @noupgrade
    async constructor() {}

    // ── USDCx Token ID ────────────────────────────────────────────
    // The field value identifying USDCx in token_registry.aleo.
    // This is the registered token_id on Aleo mainnet for USDCx.
    // Verify at: https://explorer.provable.com/program/token_registry.aleo
    const USDCX_TOKEN_ID: field = 3443843282313283355522573239085696902919850365217539366784739393210722344986field;

    // ── pay_employee_aleo ─────────────────────────────────────────
    // Transfer real ALEO credits privately from employer → employee.
    //
    // Inputs:
    //   source   — an unspent credits.aleo/credits record owned by caller
    //   employee — the aleo1… address of the employee
    //   amount   — salary in microcredits (1 ALEO = 1_000_000)
    //
    // Outputs:
    //   [0] — a NEW private record for the employee (the salary)
    //   [1] — a NEW private change record returned to the employer
    // ──────────────────────────────────────────────────────────────
    transition pay_employee_aleo(
        source: credits.aleo/credits,
        employee: address,
        amount: u64,
    ) -> (credits.aleo/credits, credits.aleo/credits) {

        let (salary, change): (credits.aleo/credits, credits.aleo/credits) =
            credits.aleo/transfer_private(source, employee, amount);

        return (salary, change);
    }

    // ── pay_employee_usdcx ────────────────────────────────────────
    // Transfer USDCx privately from employer → employee via
    // token_registry.aleo/transfer_private.
    //
    // Inputs:
    //   source   — an unspent token_registry.aleo/Token record
    //              owned by caller. Must have token_id == USDCX_TOKEN_ID.
    //   employee — the aleo1… address of the employee
    //   amount   — salary in USDCx base units (6 decimals,
    //              1 USDCx = 1_000_000 base units)
    //
    // Outputs:
    //   [0] — a NEW private Token record for the employee (salary)
    //   [1] — a NEW private Token change record for the employer
    //
    // The transition enforces that only USDCx tokens can be transferred
    // through this payroll function (not arbitrary token_registry tokens).
    // ──────────────────────────────────────────────────────────────
    transition pay_employee_usdcx(
        source: token_registry.aleo/Token,
        employee: address,
        amount: u128,
    ) -> (token_registry.aleo/Token, token_registry.aleo/Token) {

        // Assert that source token is USDCx
        assert_eq(source.token_id, USDCX_TOKEN_ID);

        // Delegate to token_registry private transfer
        let (salary, change): (token_registry.aleo/Token, token_registry.aleo/Token) =
            token_registry.aleo/transfer_private(source, employee, amount);

        return (salary, change);
    }

    // ── pay_employee_usdcx_batch ──────────────────────────────────
    // Pay two employees in one transaction (saves fees for small teams).
    // Both payments come from the same source record.
    //
    // Inputs:
    //   source    — USDCx Token record with enough balance for both
    //   emp1      — first employee address
    //   amount1   — first employee salary (base units)
    //   emp2      — second employee address
    //   amount2   — second employee salary (base units)
    //
    // Outputs:
    //   [0] — salary Token for employee 1
    //   [1] — salary Token for employee 2
    //   [2] — change Token returned to employer
    // ──────────────────────────────────────────────────────────────
    transition pay_employee_usdcx_batch2(
        source: token_registry.aleo/Token,
        emp1: address,
        amount1: u128,
        emp2: address,
        amount2: u128,
    ) -> (token_registry.aleo/Token, token_registry.aleo/Token, token_registry.aleo/Token) {

        assert_eq(source.token_id, USDCX_TOKEN_ID);

        // First payment: employer pays emp1, gets change
        let (salary1, remainder): (token_registry.aleo/Token, token_registry.aleo/Token) =
            token_registry.aleo/transfer_private(source, emp1, amount1);

        // Second payment: use remainder to pay emp2
        let (salary2, change): (token_registry.aleo/Token, token_registry.aleo/Token) =
            token_registry.aleo/transfer_private(remainder, emp2, amount2);

        return (salary1, salary2, change);
    }
}
