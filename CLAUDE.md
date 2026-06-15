# CLAUDE.md — UAE Payroll Project Context

> Pivoting from CZ-only → UAE/Dubai-first. See context_files/Claude-legacy.md for full CZ-era docs.

## Project Overview
ZK-private payroll SaaS on Aleo (USDCx). Backend (Express/Node.js) + Frontend (React/Vite/TS) + Aleo smart contract.

## Architecture
- **Backend:** `payroll-backend/` — Express 4, Node 20, PostgreSQL 16, JWT cookie auth
- **Frontend:** `czkp-secure-landing/czkp-secure-main/` — React 18, TypeScript, Vite, shadcn/ui, Tailwind
- **Smart Contract:** `czkp_payroll_v3/` — Leo language, credits.aleo transfer_private
- **Infra:** Docker Compose (Traefik + nginx + PG)

## Key Files
- `server-secure.js` — Main server (~3900 lines): auth, billing, admin, DB init
- `services/payroll-engine.js` — Pure calculation logic (no side-effects)
- `services/encryption.js` — AES-256-GCM, two-level key hierarchy
- `middleware/auth.js` — JWT auth, RBAC, audit logging
- `db.js` — PostgreSQL adapter (? → $1 conversion)
- `routes/` — 22 route modules (payroll, employees, exports, etc.)
- `migrations/` — DB migrations 001-006

## Security Invariants (NEVER BREAK)
1. `requireRole()` takes an ARRAY: `requireRole(['admin', 'employer'])` — never positional args
2. ALL SQL must be parameterized — no string interpolation
3. EVERY endpoint must check `company_id` (multi-tenant isolation)
4. Credit ops must be atomic: `SET balance = balance + ?` (never read-then-write)
5. PASSWORD_PEPPER in ALL bcrypt.compare calls (login, change-pw, reset, 2FA disable, GDPR delete)
6. JWT in httpOnly cookies only — never localStorage
7. CSS sanitization via strict allowlist (no regex blacklist)

## Code Conventions
- Backend: CommonJS, `'use strict'`
- Frontend: ES modules, TypeScript
- Error messages: Czech (migrating to English)
- IDs: `crypto.randomUUID()`
- Logging: Winston, structured JSON

## Current Migration: CZ → UAE
Replacing Czech payroll logic with UAE/Dubai equivalents:
- CZK → AED (minor units: fils)
- Rodné číslo → Emirates ID, nationality, WPS person ID, GPSSA flag
- FÚ/OSSZ/ZP exports → WPS SIF + GPSSA reports
- Czech tax calculations → UAE (no income tax, but GPSSA pension for nationals)
- 5-tier CZK pricing → AED pricing with ZKP gate at Business tier

## Tech Stack Summary
Backend: express, pg, bcrypt, jsonwebtoken, helmet, express-rate-limit, express-validator, winston, pdfkit, multer
Frontend: react, typescript, vite, tailwind, shadcn/ui, tanstack-query, zod, recharts, aleo-wallet-adapter
