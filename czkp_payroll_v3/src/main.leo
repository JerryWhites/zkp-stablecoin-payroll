// CZKP Payroll v3 — Private salary payments using native ALEO credits.
//
// This program wraps credits.aleo/transfer_private so that every payroll
// payment is a fully private ZK transaction (sender, receiver, and amount
// are all hidden on-chain).
//
// Unlike v2 which incorrectly defined its own `credits` record (creating
// worthless play-money tokens), v3 imports the REAL credits.aleo program
// and forwards the call, so employees receive actual ALEO.

import credits.aleo;

program czkp_payroll_v3.aleo {

    // Lock the program — no upgrades allowed.
    @noupgrade
    async constructor() {}

    // ── pay_employee ──────────────────────────────────────────────
    // Transfer real ALEO credits privately from employer → employee.
    //
    // Inputs:
    //   source   — an unspent credits.aleo/credits record owned by
    //              the caller (the employer's wallet).
    //   employee — the aleo1… address of the employee.
    //   amount   — salary in microcredits (1 ALEO = 1 000 000).
    //
    // Outputs:
    //   [0] — a NEW private record for the employee (the salary).
    //   [1] — a NEW private change record returned to the employer.
    // ──────────────────────────────────────────────────────────────
    transition pay_employee(
        source: credits.aleo/credits,
        employee: address,
        amount: u64,
    ) -> (credits.aleo/credits, credits.aleo/credits) {

        // Delegate to the native private transfer.
        let (salary, change): (credits.aleo/credits, credits.aleo/credits) =
            credits.aleo/transfer_private(source, employee, amount);

        return (salary, change);
    }
}
