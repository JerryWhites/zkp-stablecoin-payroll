// ====================================
// 🇨🇿 CZ Payroll TypeScript Types
// ====================================

// --- Employee (CZ) ---
export type TypUvazku = 'HPP' | 'DPP' | 'DPC';
export type InvaliditaType = 'none' | '1-2' | '3' | 'ztp-p';
export type EmployeeStatus = 'active' | 'inactive';
export type EntityType = 'osvc' | 'sro' | 'as' | 'komanditni' | 'vos';

export interface CZEmployee {
  id?: number;
  uuid: string;
  company_id?: number;
  name: string;
  email: string;
  osobni_cislo?: string;
  rodne_cislo?: string;            // encrypted in DB
  datum_narozeni?: string;
  adresa?: string;                 // encrypted in DB
  bank_account?: string;           // encrypted in DB
  aleo_address?: string;
  nastup?: string;                 // ISO date
  ukonceni?: string | null;
  typ_uvazku: TypUvazku;
  hruba_mzda_czk: number;
  uvazek_hodiny: number;           // weekly hours (40 = full)
  podepsane_prohlaseni: boolean;
  pocet_deti: number;
  deti_ztp: number;
  invalidita: InvaliditaType;
  sleva_student: boolean;
  zp_code?: string;                // zdravotní pojišťovna
  status: EmployeeStatus;
}

export interface CZEmployeeFormData {
  name: string;
  email: string;
  osobni_cislo?: string;
  rodne_cislo?: string;
  datum_narozeni?: string;
  adresa?: string;
  bank_account?: string;
  aleo_address?: string;
  nastup?: string;
  typ_uvazku: TypUvazku;
  hruba_mzda_czk: number;
  uvazek_hodiny: number;
  podepsane_prohlaseni: boolean;
  pocet_deti: number;
  deti_ztp: number;
  invalidita: InvaliditaType;
  sleva_student: boolean;
  zp_code?: string;
}

// --- Company ---
export interface CZCompany {
  id?: number;
  uuid?: string;
  name: string;
  ico: string;
  dic?: string;
  sidlo_ulice?: string;
  sidlo_mesto?: string;
  sidlo_psc?: string;
  bank_account_salary?: string;
  bank_account_tax?: string;
  bank_account_social?: string;
  bank_account_health?: string;
  fu_code?: string;
  ossz_code?: string;
  default_zp_code?: string;
  setup_completed?: boolean;
  // Entity type
  entity_type?: EntityType;
  hlavni_cinnost?: number;
  pausal_dan?: number;
  vydajovy_pausal_pct?: number;
  obor_cinnosti?: string;
  zivnostensky_list?: string;
  // Legal entity
  pravni_forma_detail?: string;
  zakladni_kapital_czk?: number;
  statutarni_organ?: string;
  datum_zalozeni?: string;
}

// --- Payroll Period ---
export type PeriodStatus = 'draft' | 'calculated' | 'locked';

export interface PayrollPeriod {
  id?: number;
  uuid: string;
  company_id?: number;
  year: number;
  month: number;
  status: PeriodStatus;
  czk_aleo_rate?: number | null;
  czk_usd_rate?: number | null;
  locked_at?: string | null;
  locked_by?: number | null;
  proof_hash?: string | null;
  proof_status?: string;
  item_count?: number;
  total_hruba?: number;
  total_cista?: number;
  created_at?: string;
}

// --- Payroll Item (per-employee calculation result) ---
export type PaymentStatus = 'pending' | 'sent' | 'confirmed' | 'failed';

export interface PayrollItem {
  id?: number;
  uuid: string;
  payroll_period_id?: number;
  employee_id?: number;
  employee_uuid?: string;

  // Employee info (joined)
  name?: string;
  email?: string;
  typ_uvazku?: TypUvazku;
  emp_hruba_mzda?: number;
  uvazek_hodiny?: number;
  aleo_address?: string;
  osobni_cislo?: string;
  podepsane_prohlaseni?: boolean;
  pocet_deti?: number;
  deti_ztp?: number;
  invalidita?: InvaliditaType;
  sleva_student?: boolean;
  zp_code?: string;

  // Inputs (editable in step 2)
  odpracovane_hodiny: number;
  fond_hodin: number;
  absence_hodiny: number;
  bonus_czk: number;
  srazka_czk: number;

  // Outputs (calculated in step 3)
  zakladni_mzda_czk?: number;
  celkova_hruba_czk?: number;
  sp_zamestnanec?: number;
  zp_zamestnanec?: number;
  zaklad_dane?: number;
  zaloha_dan?: number;
  srazkova_dan?: number;
  slevy_celkem?: number;
  dan_po_slevach?: number;
  danova_zvyhodneni?: number;
  vysledek_dan?: number;
  danovy_bonus?: number;
  cista_mzda_czk?: number;
  sp_zamestnavatel?: number;
  zp_zamestnavatel?: number;
  celkove_naklady?: number;
  cista_mzda_aleo?: number | null;

  // Crypto/fiat split
  fiat_payout_czk?: number | null;
  crypto_payout_czk?: number | null;
  crypto_payout_amount?: number | null;  // base units (microcredits or USDCx 6-dec)
  crypto_payout_token?: 'NONE' | 'ALEO' | 'USDCx' | null;
  czk_usd_rate?: number | null;
  czk_aleo_rate?: number | null;
  stablecoin_pct_snapshot?: number | null;
  wallet_address?: string | null;

  // Payment
  aleo_tx_id?: string | null;
  aleo_payment_status?: PaymentStatus;
  status?: string;
}

// --- Calculation Summary ---
export interface PayrollSummary {
  celkemHruba: number;
  celkemCista: number;
  celkemSpZamestnanec: number;
  celkemZpZamestnanec: number;
  celkemDan: number;
  celkemDanovyBonus: number;
  celkemSpZamestnavatel: number;
  celkemZpZamestnavatel: number;
  platbaFU: number;
  platbaOSSZ: number;
  platbaZP: number;
  platbaMzdy: number;
  celkoveNaklady: number;
  employeeCount: number;
  // Crypto split totals
  celkemFiatPayout?: number;
  celkemCryptoPayout?: number;
  cryptoEmployees?: number;
  totalUsdcx?: number;
  totalAleo?: number;
}

// --- Payroll Period Detail (GET response) ---
export interface PayrollPeriodDetail {
  period: PayrollPeriod;
  items: PayrollItem[];
  summary: PayrollSummary | null;
}

// --- Calculation Response ---
export interface CalculateResponse {
  success: boolean;
  summary: PayrollSummary;
  errors: Array<{ employee_id: number; error: string }>;
  items: Array<{
    employee_id: number;
    employee_uuid: string;
    employee_name: string;
    typ_uvazku: TypUvazku;
    celkovaHruba: number;
    cistaMzda: number;
    spZamestnanec: number;
    zpZamestnanec: number;
    vysledkDan: number;
    danovyBonus: number;
    spZamestnavatel: number;
    zpZamestnavatel: number;
    celkoveNaklady: number;
  }>;
}

// --- Export Summary ---
export interface ExportSummary {
  company: string;
  ico: string;
  period: string;
  status: string;
  employees: Array<{
    osobni_cislo: string;
    name: string;
    typ_uvazku: TypUvazku;
    hruba: number;
    sp_zam: number;
    zp_zam: number;
    dan: number;
    danovy_bonus: number;
    cista: number;
    sp_firma: number;
    zp_firma: number;
    naklady: number;
  }>;
  totals: {
    hruba: number;
    sp_zam: number;
    zp_zam: number;
    dan: number;
    danovy_bonus: number;
    cista: number;
    sp_firma: number;
    zp_firma: number;
    naklady: number;
  };
  payments: {
    fu: number;
    ossz: number;
    zp: number;
    mzdy: number;
  };
}

// --- Months CZ ---
export const MONTHS_CZ = [
  '', 'Leden', 'Únor', 'Březen', 'Duben', 'Květen', 'Červen',
  'Červenec', 'Srpen', 'Září', 'Říjen', 'Listopad', 'Prosinec'
] as const;

// --- ZP codes ---
export const ZP_CODES: Record<string, string> = {
  '111': 'VZP',
  '201': 'VoZP',
  '205': 'ČPZP',
  '207': 'OZP',
  '209': 'ZPŠ',
  '211': 'ZPMV',
  '213': 'RBP',
};

// --- Helpers ---
export function formatCZK(amount: number | undefined | null): string {
  if (amount === undefined || amount === null) return '0 Kč';
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function periodLabel(year: number, month: number): string {
  return `${MONTHS_CZ[month]} ${year}`;
}

// --- OSVČ Types ---
export interface OSVCAdvance {
  id: number;
  company_id: string;
  year: number;
  month: number;
  type: 'sp' | 'zp' | 'dan';
  amount_czk: number;
  due_date: string;
  status: 'pending' | 'paid' | 'overdue' | 'exempt';
  paid_at?: string;
  variable_symbol?: string;
}

export interface OSVCIncome {
  id?: number;
  company_id?: string;
  year: number;
  month: number;
  revenue_czk: number;
  expenses_czk: number;
  use_pausal: number;
  note?: string;
}

export interface OSVCDashboardData {
  year: number;
  month: number;
  company: {
    name: string;
    ico: string;
    entity_type: EntityType;
    hlavni_cinnost: number;
    pausal_dan: number;
  };
  currentIncome: { revenue_czk: number; expenses_czk: number };
  ytdIncome: { revenue: number; expenses: number };
  pendingAdvances: OSVCAdvance[];
  overdueCount: number;
  overdueAdvances: OSVCAdvance[];
  annualAdvances: { paid: number; pending: number; total: number };
}

// --- Annual Processing Types ---
export type AnnualProcessingType =
  | 'rocni_zuctovani'
  | 'eldp'
  | 'prehled_ossz'
  | 'prehled_zp'
  | 'danove_priznani'
  | 'vyuctovani_dane';

export type AnnualProcessingStatus = 'draft' | 'calculated' | 'submitted' | 'accepted' | 'rejected';

export interface AnnualProcessingRecord {
  id: number;
  uuid: string;
  company_id: string;
  year: number;
  type: AnnualProcessingType;
  status: AnnualProcessingStatus;
  data_json: unknown;
  employee_id?: number;
  submitted_at?: string;
  submission_ref?: string;
  note?: string;
  created_at: string;
  updated_at: string;
}

export interface RocniZuctovaniResult {
  rocniHruba: number;
  rocniZakladDane: number;
  odpocty: number;
  sniZenyZaklad: number;
  rocniDan: number;
  rocniSlevy: number;
  rocniDanPoSlevach: number;
  rocniZvyhodneni: number;
  vysledkDan: number;
  rocniBonus: number;
  zaplacenaDan: number;
  soucetZaloh: number;
  soucetBonusu: number;
  rozdil: number;
  vysledek: 'nedoplatek' | 'preplatek' | 'vyrovnano';
  castka: number;
  warning?: string;
}

export interface ELDPResult {
  rok: number;
  zamestnavatel: { ico: string; nazev: string };
  pojistenec: { jmeno: string; prijmeni: string; rodneCislo: string };
  dobaPojisteni: { od: string; do: string; mesiceUcasti: number };
  vymerovaciZaklad: number;
  vyloucentDny: number;
}

// --- Entity type labels ---
export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  osvc: 'OSVČ (fyzická osoba)',
  sro: 's.r.o.',
  as: 'a.s.',
  komanditni: 'k.s.',
  vos: 'v.o.s.',
};

export const OBOR_CINNOSTI_OPTIONS = [
  { value: 'remeslna', label: 'Řemeslné živnosti (80%)' },
  { value: 'zemedelska', label: 'Zemědělská výroba (80%)' },
  { value: 'volna', label: 'Volná / vázaná živnost (60%)' },
  { value: 'najem', label: 'Nájem (30%)' },
  { value: 'ostatni', label: 'Ostatní příjmy §7 (40%)' },
] as const;
