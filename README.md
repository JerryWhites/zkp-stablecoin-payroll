# ZKP Stablecoin Payroll

> Zero-knowledge, non-custodial payroll for stablecoin & native-token salaries on [Aleo](https://aleo.org).

Run payroll the normal way — employees, periods, net-pay calculation, payslips, exports — then settle salaries **on-chain as fully private zero-knowledge transfers**. Sender, recipient, and amount are hidden on the public ledger, while the employer keeps a complete, encrypted off-chain audit trail.

Payments are **non-custodial**: the platform never holds funds or private keys. The employer signs each transfer from their own Aleo wallet; the backend only records the resulting transaction IDs.

---

## ✨ Highlights

- 🔐 **Private by construction** — salaries settle via `transfer_private`, so amounts and parties never appear in clear text on-chain.
- 🪙 **Dual-token payouts** — native **ALEO** credits and **USDCx** (a USD stablecoin on Aleo, 6 decimals via `token_registry.aleo`).
- ➗ **Fiat / crypto split** — each employee can take any percentage (`0–100%`) of net pay in crypto and the rest to a bank account.
- 🧮 **Real payroll engine** — pure, side-effect-free net-pay calculation with a full audit snapshot of rates and splits.
- 🔑 **Non-custodial wallet flow** — Leo, Puzzle, and Shield wallet support through `aleo-wallet-adapter`.
- 🛡️ **Security-first backend** — AES-256-GCM PII encryption, JWT httpOnly cookie auth, RBAC, multi-tenant isolation, parameterized SQL, structured audit logging.

---

## 🏗️ Architecture

```
┌──────────────────────┐        ┌───────────────────────┐        ┌────────────────────────┐
│  Frontend (React/TS) │        │  Backend (Express/PG) │        │  Aleo Smart Contracts  │
│                      │        │                       │        │                        │
│  Payroll wizard      │ HTTPS  │  Auth / RBAC / billing│        │  czkp_payroll_v3       │
│  Employee portal     │◄──────►│  Payroll engine       │        │   └ pay_employee (ALEO)│
│  ZK payment step     │  JWT   │  Encryption (AES-GCM) │        │  czkp_payroll_v4       │
│  Aleo wallet adapter │ cookie │  crypto_payments audit│        │   ├ pay_employee_aleo  │
│                      │        │                       │        │   ├ pay_employee_usdcx │
└──────────┬───────────┘        └───────────────────────┘        │   └ ..._usdcx_batch2   │
           │                                                      └───────────┬────────────┘
           │  employer signs in-wallet (non-custodial)                        │
           └──────────────── private ZK transfer ────────────────────────────►│
                              (records tx_id on backend)              credits.aleo /
                                                                     token_registry.aleo
```

| Layer | Stack |
|-------|-------|
| **Frontend** | React 18, TypeScript, Vite, Tailwind, shadcn/ui, TanStack Query, Zod, `@demox-labs/aleo-wallet-adapter` |
| **Backend** | Node 20, Express 4, PostgreSQL 16, JWT, bcrypt, helmet, express-validator, Winston, pdfkit |
| **Contracts** | Leo 3.4 → Aleo (`credits.aleo`, `token_registry.aleo`) |
| **Infra** | Docker Compose (Traefik + auto-TLS, nginx SPA, PostgreSQL) |

---

## 📦 Repository layout

```
.
├── payroll-backend/         # Express API: auth, payroll, employees, exports, crypto audit
│   ├── routes/              # 22 route modules
│   ├── services/            # payroll-engine (pure calc) + encryption (AES-256-GCM)
│   ├── middleware/          # JWT auth, RBAC, audit logging
│   └── migrations/          # 001–006 (006 = crypto/stablecoin support)
├── czkp-secure-landing/
│   └── czkp-secure-main/    # React + TypeScript frontend (payroll wizard, portal, ZK step)
├── czkp_payroll_v3/         # Aleo contract — private ALEO-credit payroll (built)
├── czkp_payroll_v4/         # Aleo contract — ALEO + USDCx stablecoin payroll
├── docker-compose.yml       # Production stack (Traefik + backend + frontend + Postgres)
└── README.md
```

---

## 🔐 The ZK contracts

### `czkp_payroll_v3.aleo` — private ALEO salaries

A thin, audited wrapper over the **real** `credits.aleo/transfer_private`, so each payment is a private transfer of genuine ALEO credits — sender, receiver, and amount all hidden.

```leo
transition pay_employee(
    source: credits.aleo/credits,
    employee: address,
    amount: u64,
) -> (credits.aleo/credits, credits.aleo/credits) {
    return credits.aleo/transfer_private(source, employee, amount);
}
```

### `czkp_payroll_v4.aleo` — adds USDCx stablecoin

Extends v3 with private **USDCx** transfers through `token_registry.aleo`, enforcing the USDCx token ID so only the intended stablecoin can flow through the payroll path. Also includes a 2-employee batch transition to amortize fees for small teams.

```leo
transition pay_employee_usdcx(
    source: token_registry.aleo/Token,
    employee: address,
    amount: u128,
) -> (token_registry.aleo/Token, token_registry.aleo/Token) {
    assert_eq(source.token_id, USDCX_TOKEN_ID);
    return token_registry.aleo/transfer_private(source, employee, amount);
}
```

---

## 🚦 Project status

This is an **MVP under active development**, currently targeting **Aleo TestnetBeta**.

| Component | Status |
|-----------|--------|
| Payroll engine, employee/period management, exports | ✅ Working |
| Backend security (auth, RBAC, encryption, audit) | ✅ Working |
| Private **ALEO** payouts (`czkp_payroll_v3`) | ✅ Built, testnet |
| Private **USDCx** payouts (`czkp_payroll_v4`) | 🚧 Source complete; pending compile, deploy & token/network verification |
| CZ → UAE/Dubai localization (AED, WPS, GPSSA) | 🚧 In progress |

> **Note:** `czkp_payroll_v4` is not yet compiled or deployed, and the USDCx token ID must be verified against the target network before stablecoin payouts can execute end-to-end. Treat the stablecoin path as experimental.

---

## 🚀 Getting started

### Prerequisites
- Node.js 20+
- PostgreSQL 16
- [Leo](https://docs.leo-lang.org/) 3.4+ (only to build/deploy the contracts)
- An Aleo wallet (Leo / Puzzle / Shield)

### Backend

```bash
cd payroll-backend
cp .env.example .env        # then fill in JWT secrets, DB URL, encryption keys
npm install
node migrations/001-cz-payroll-mvp.js   # run migrations 001 → 006 in order
npm start
```

The server **refuses to start** without required secrets (`JWT_SECRET`, `PASSWORD_PEPPER`, `MASTER_ENCRYPTION_KEY`, `DATABASE_URL`). Generate them with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Frontend

```bash
cd czkp-secure-landing/czkp-secure-main
cp .env.example .env        # set VITE_API_BASE etc.
npm install
npm run dev
```

### Contracts

```bash
cd czkp_payroll_v4
leo build                   # compile against credits.aleo + token_registry.aleo
# deploy with the Aleo CLI / your wallet to the target network
```

### Full stack with Docker

```bash
cp .env.docker.example .env # fill in DB_PASSWORD, JWT secrets, ACME_EMAIL, DOMAIN…
docker compose up -d
```

---

## 🛡️ Security model

- **Non-custodial** — the platform never holds funds or signing keys; all transfers are signed in the employer's wallet.
- **PII encrypted at rest** — national IDs, bank accounts, and addresses are AES-256-GCM encrypted via a two-level key hierarchy.
- **Defense in depth** — parameterized SQL everywhere, per-request `company_id` multi-tenant isolation, atomic credit operations, JWT in httpOnly cookies, rate limiting, and helmet security headers.
- **Auditable on-chain payments** — every payout is logged in `crypto_payments` with token, amount, exchange rate, recipient, tx hash, and status.

Found a vulnerability? Please open a private security advisory rather than a public issue.

---

## ⚠️ Disclaimer

This software is provided for research and development purposes. It is **not** financial, tax, or legal advice. Paying wages in crypto assets and the regulatory treatment of stablecoins vary by jurisdiction — verify compliance with local labor, payroll, and virtual-asset regulations before any production use.

## 📄 License

MIT — see individual `program.json` / `package.json` files.
