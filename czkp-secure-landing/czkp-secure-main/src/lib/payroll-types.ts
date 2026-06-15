import { WalletAdapterNetwork } from "@demox-labs/aleo-wallet-adapter-base";

// --- CONFIG FOR PAYROLL ---
export const NETWORK_MODE = WalletAdapterNetwork.TestnetBeta;
export const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5000/api";

// Aleo Credits configuration
export const TOKEN_CONFIG = {
  programId: "credits.aleo",
  recordProgram: "credits.aleo",
  symbol: "ALEO",
  name: "Aleo Credits",
  decimals: 1_000_000,
  microcreditsField: "microcredits",
};

// USDCx Stablecoin configuration (via token_registry.aleo)
export const USDCX_TOKEN_CONFIG = {
  programId: "token_registry.aleo",
  wrapperProgramId: "czkp_payroll_v4.aleo",
  symbol: "USDCx",
  name: "USDCx (Circle xReserve)",
  decimals: 1_000_000,  // 6 decimal places
  tokenId: "3443843282313283355522573239085696902919850365217539366784739393210722344986field",
};

// Payroll wrapper program ID (v4 supports both ALEO + USDCx)
export const PAYROLL_PROGRAM_ID = "czkp_payroll_v4.aleo";
export const PAYROLL_FUNCTION_ALEO = "pay_employee_aleo";
export const PAYROLL_FUNCTION_USDCX = "pay_employee_usdcx";

export const PAYROLL_FUNCTION = "transfer_private";
export const FEE_NETWORK = 250_000; // 0.25 Credit network gas
export const ALEO_EXPLORER_URL = "https://explorer.provable.com/transaction";
export const DEFAULT_OVERAGE_CZK = 199; // fallback overage rate for Start tier
export const PRICING_CURRENCY = 'CZK';

// Subscription tier definitions (mirrors backend PRICING.TIERS – Varianta C)
export interface SubscriptionTier {
  id: string;
  name: string;
  monthly_price_czk: number;
  annual_monthly_price_czk: number | null;
  included_employees: number;
  overage_per_employee_czk: number;
  max_payroll_runs: number | null;      // null = unlimited
  run_limit_type: 'hard' | 'soft' | 'none';
  max_seats: number | null;             // null = unlimited
  features: Record<string, boolean>;
  sla: string;
  gdpr_support: string;
  // Legacy compat
  monthly_price?: number | null;
  rate_per_employee?: number | null;
  max_employees?: number | null;
}

export const SUBSCRIPTION_TIERS: SubscriptionTier[] = [
  {
    id: 'start',
    name: 'Start',
    monthly_price_czk: 590,
    annual_monthly_price_czk: 490,
    included_employees: 10,
    overage_per_employee_czk: 199,
    max_payroll_runs: 2,
    run_limit_type: 'hard',
    max_seats: 1,
    features: {
      zkTransfers: false, csvImport: true, auditLog: true,
      api: false, webhooks: false, autoPayroll: false,
      customReports: false, integrations: false, rbac: false,
      multiSig: false, whiteLabel: false,
      prioritySupport: false, dedicatedSupport: false, onPremise: false,
    },
    sla: 'best-effort',
    gdpr_support: 'docs',
    monthly_price: 590,
    rate_per_employee: 199,
    max_employees: null,
  },
  {
    id: 'growth',
    name: 'Growth',
    monthly_price_czk: 1290,
    annual_monthly_price_czk: 990,
    included_employees: 25,
    overage_per_employee_czk: 149,
    max_payroll_runs: 12,
    run_limit_type: 'soft',
    max_seats: 3,
    features: {
      zkTransfers: false, csvImport: true, auditLog: true,
      api: true, webhooks: false, autoPayroll: true,
      customReports: false, integrations: false, rbac: false,
      multiSig: false, whiteLabel: false,
      prioritySupport: false, dedicatedSupport: false, onPremise: false,
    },
    sla: '99.5%',
    gdpr_support: 'docs',
    monthly_price: 1290,
    rate_per_employee: 149,
    max_employees: null,
  },
  {
    id: 'business',
    name: 'Business',
    monthly_price_czk: 4490,
    annual_monthly_price_czk: 3490,
    included_employees: 75,
    overage_per_employee_czk: 119,
    max_payroll_runs: null,
    run_limit_type: 'none',
    max_seats: 10,
    features: {
      zkTransfers: false, csvImport: true, auditLog: true,
      api: true, webhooks: true, autoPayroll: true,
      customReports: true, integrations: true, rbac: true,
      multiSig: false, whiteLabel: false,
      prioritySupport: true, dedicatedSupport: false, onPremise: false,
    },
    sla: '99.9%',
    gdpr_support: 'docs + audit assist',
    monthly_price: 4490,
    rate_per_employee: 119,
    max_employees: null,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    monthly_price_czk: 29900,
    annual_monthly_price_czk: 24900,
    included_employees: 150,
    overage_per_employee_czk: 89,
    max_payroll_runs: null,
    run_limit_type: 'none',
    max_seats: null,
    features: {
      zkTransfers: true, csvImport: true, auditLog: true,
      api: true, webhooks: true, autoPayroll: true,
      customReports: true, integrations: true, rbac: true,
      multiSig: true, whiteLabel: false,
      prioritySupport: true, dedicatedSupport: true, onPremise: false,
    },
    sla: '99.95% + penále',
    gdpr_support: 'plná podpora',
    monthly_price: 29900,
    rate_per_employee: 89,
    max_employees: null,
  },
  {
    id: 'enterprise_plus',
    name: 'Enterprise+',
    monthly_price_czk: 115000,
    annual_monthly_price_czk: null,
    included_employees: 500,
    overage_per_employee_czk: 0, // custom pricing
    max_payroll_runs: null,
    run_limit_type: 'none',
    max_seats: null,
    features: {
      zkTransfers: true, csvImport: true, auditLog: true,
      api: true, webhooks: true, autoPayroll: true,
      customReports: true, integrations: true, rbac: true,
      multiSig: true, whiteLabel: true,
      prioritySupport: true, dedicatedSupport: true, onPremise: true,
      customSLA: true, zeroKnowledgeAudit: true,
    },
    sla: 'custom SLA + penále',
    gdpr_support: 'plná podpora + DPO asistence',
    monthly_price: null,
    rate_per_employee: null,
    max_employees: null,
  },
];

// --- TYPES ---
export interface Employee {
  id?: number;
  name: string;
  email: string;
  salary: number;
  aleo_address: string;
  selected?: boolean;
}

export interface HistoryRecord {
  id: number;
  date: string;
  count: number;
  total: number;
  txs: string[];
  employees: { name: string; amount: number; txId: string; status: string }[];
}

export interface WalletRecord {
  plaintext: string;
  spent: boolean;
  microcredits: number;
  ciphertext?: string;
  rawRecord?: any;
}

export interface CreditInfo {
  currency: string;
  balance_czk: number;
  balance_usd: number; // legacy compat  
  tier: {
    name: string;
    display_name: string;
    monthly_price_czk: number;
    annual_monthly_price_czk: number | null;
    included_employees: number;
    overage_per_employee_czk: number;
    max_payroll_runs: number | null;
    run_limit_type: string;
    max_seats: number | null;
    max_employees: number | null;
    features: Record<string, boolean>;
    sla: string;
    gdpr_support: string;
    cost_per_run_czk: number;
    // Legacy compat
    rate_per_employee: number;
    monthly_price: number;
  };
  billing_period: string;
  runs_this_period: number;
  estimates: {
    active_employees: number;
    next_payroll_cost_czk: number;
    next_payroll_cost: number;
    included_remaining: number;
    overage_employees: number;
    payrolls_remaining: number;
  };
}

// Aleo address validation regex
export const ALEO_ADDRESS_REGEX = /^aleo1[a-z0-9]{58}$/;
