# CLAUDE.md — Frontend (UAE Payroll)

React 18 + TypeScript + Vite + Tailwind + shadcn/ui

## Structure
- `src/pages/` — 30+ page components
- `src/components/` — UI components (payroll/, ui/, layout/)
- `src/hooks/` — useAuth, useCredits, custom hooks
- `src/lib/` — Utilities
- `src/integrations/` — API client

## Current Migration: CZ → UAE
- CZK formatters → AED formatters
- ~124 CZ strings → English
- Delete OSVCDashboard (no OSVČ in UAE)
- EmployeeManagement: add Emirates ID, IBAN, nationality fields
- CompanySetup, PayrollWizard, Subscription: UAE pricing + fields

## Conventions
- ES modules, TypeScript strict
- shadcn/ui components via Radix primitives
- TanStack Query for data fetching
- Zod for runtime validation
- React Router v6
