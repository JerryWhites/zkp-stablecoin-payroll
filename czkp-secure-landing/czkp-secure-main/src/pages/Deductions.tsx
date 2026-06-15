// ====================================
// ⚖️ Deductions Management Page — Exekuce, Insolvence, Srážky
// ====================================
// Garnishment management per Czech law (Občanský soudní řád §276-302)
// Backend: routes/deductions.js — full CRUD, 7 types, priority ordering

import { useState, useEffect, useCallback, useMemo } from "react";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Scale, Plus, Trash2, Edit, ChevronDown, ChevronUp,
  RefreshCw, AlertTriangle, Ban, CheckCircle, XCircle,
  DollarSign, Percent, FileText, History,
} from "lucide-react";

// ====================================
// TYPES & CONSTANTS
// ====================================

const DEDUCTION_TYPES = [
  { value: "alimenty", label: "Alimenty", priority: 10, color: "bg-red-100 text-red-800" },
  { value: "exekuce_prednostni", label: "Přednostní exekuce", priority: 20, color: "bg-orange-100 text-orange-800" },
  { value: "exekuce_neprednostni", label: "Nepřednostní exekuce", priority: 30, color: "bg-yellow-100 text-yellow-800" },
  { value: "insolvence", label: "Insolvence", priority: 40, color: "bg-purple-100 text-purple-800" },
  { value: "odbory", label: "Odbory", priority: 80, color: "bg-blue-100 text-blue-800" },
  { value: "sporeni", label: "Spoření", priority: 85, color: "bg-green-100 text-green-800" },
  { value: "srazka_zamestnanec", label: "Srážka zaměstnanec", priority: 90, color: "bg-gray-100 text-gray-800" },
];

interface Deduction {
  uuid: string;
  employee_uuid: string;
  name: string;
  osobni_cislo: string;
  type: string;
  description: string;
  creditor_name: string | null;
  creditor_account: string | null;
  variable_symbol: string | null;
  fixed_amount_czk: number | null;
  percentage: number | null;
  total_obligation_czk: number | null;
  total_deducted_czk: number | null;
  case_number: string | null;
  effective_from: string;
  effective_to: string | null;
  is_active: number;
  priority: number;
  created_at: string;
}

interface HistoryRecord {
  payroll_period_id: number;
  year: number;
  month: number;
  amount_czk: number;
  remaining_czk: number;
}

// ====================================
// COMPONENT
// ====================================

export default function Deductions() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [deductions, setDeductions] = useState<Deduction[]>([]);
  const [employees, setEmployees] = useState<{ uuid: string; name: string; osobni_cislo: string }[]>([]);

  // Filters
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [activeOnly, setActiveOnly] = useState(true);
  const [employeeFilter, setEmployeeFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");

  // Create/Edit
  const [showForm, setShowForm] = useState(false);
  const [editingUuid, setEditingUuid] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    employee_uuid: "",
    type: "exekuce_prednostni",
    description: "",
    creditor_name: "",
    creditor_account: "",
    variable_symbol: "",
    fixed_amount_czk: "",
    percentage: "",
    total_obligation_czk: "",
    case_number: "",
    effective_from: new Date().toISOString().slice(0, 10),
    effective_to: "",
  });

  // History modal
  const [historyUuid, setHistoryUuid] = useState<string | null>(null);
  const [history, setHistory] = useState<{ deduction: any; history: HistoryRecord[] } | null>(null);

  // ====================================
  // DATA FETCHING
  // ====================================

  const fetchDeductions = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (activeOnly) params.set("active_only", "true");
      if (typeFilter !== "all") params.set("type", typeFilter);
      if (employeeFilter !== "all") params.set("employee_uuid", employeeFilter);

      const res = await apiClient.authenticatedFetch(`/v2/deductions?${params}`);
      if (res.ok) {
        const data = await res.json();
        setDeductions(data.deductions || []);
      }
    } catch {
      // silent
    }
  }, [activeOnly, typeFilter, employeeFilter]);

  const fetchEmployees = useCallback(async () => {
    try {
      const res = await apiClient.authenticatedFetch("/v2/employees");
      if (res.ok) {
        const data = await res.json();
        setEmployees((data.employees || []).map((e: any) => ({
          uuid: e.uuid, name: e.name, osobni_cislo: e.osobni_cislo,
        })));
      }
    } catch { /* silent */ }
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchDeductions(), fetchEmployees()]);
    setLoading(false);
  }, [fetchDeductions, fetchEmployees]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const fetchHistory = async (uuid: string) => {
    setHistoryUuid(uuid);
    try {
      const res = await apiClient.authenticatedFetch(`/v2/deductions/history/${uuid}`);
      if (res.ok) {
        const data = await res.json();
        setHistory(data);
      }
    } catch {
      toast({ title: "Chyba při načítání historie", variant: "destructive" });
    }
  };

  // ====================================
  // ACTIONS
  // ====================================

  const resetForm = () => {
    setFormData({
      employee_uuid: "", type: "exekuce_prednostni", description: "",
      creditor_name: "", creditor_account: "", variable_symbol: "",
      fixed_amount_czk: "", percentage: "", total_obligation_czk: "",
      case_number: "", effective_from: new Date().toISOString().slice(0, 10), effective_to: "",
    });
    setEditingUuid(null);
  };

  const openCreate = () => {
    resetForm();
    setShowForm(true);
  };

  const openEdit = (d: Deduction) => {
    setFormData({
      employee_uuid: d.employee_uuid,
      type: d.type,
      description: d.description,
      creditor_name: d.creditor_name || "",
      creditor_account: d.creditor_account || "",
      variable_symbol: d.variable_symbol || "",
      fixed_amount_czk: d.fixed_amount_czk != null ? String(d.fixed_amount_czk) : "",
      percentage: d.percentage != null ? String(d.percentage) : "",
      total_obligation_czk: d.total_obligation_czk != null ? String(d.total_obligation_czk) : "",
      case_number: d.case_number || "",
      effective_from: d.effective_from ? d.effective_from.slice(0, 10) : "",
      effective_to: d.effective_to ? d.effective_to.slice(0, 10) : "",
    });
    setEditingUuid(d.uuid);
    setShowForm(true);
  };

  const submitForm = async () => {
    if (!formData.description) {
      toast({ title: "Zadejte popis srážky", variant: "destructive" });
      return;
    }
    if (!formData.fixed_amount_czk && !formData.percentage) {
      toast({ title: "Zadejte pevnou částku nebo procento", variant: "destructive" });
      return;
    }

    const payload: any = {
      type: formData.type,
      description: formData.description,
      effective_from: formData.effective_from,
    };
    if (formData.creditor_name) payload.creditor_name = formData.creditor_name;
    if (formData.creditor_account) payload.creditor_account = formData.creditor_account;
    if (formData.variable_symbol) payload.variable_symbol = formData.variable_symbol;
    if (formData.fixed_amount_czk) payload.fixed_amount_czk = Number(formData.fixed_amount_czk);
    if (formData.percentage) payload.percentage = Number(formData.percentage);
    if (formData.total_obligation_czk) payload.total_obligation_czk = Number(formData.total_obligation_czk);
    if (formData.case_number) payload.case_number = formData.case_number;
    if (formData.effective_to) payload.effective_to = formData.effective_to;

    try {
      let res: Response;
      if (editingUuid) {
        res = await apiClient.authenticatedFetch(`/v2/deductions/${editingUuid}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        if (!formData.employee_uuid) {
          toast({ title: "Vyberte zaměstnance", variant: "destructive" });
          return;
        }
        payload.employee_uuid = formData.employee_uuid;
        res = await apiClient.authenticatedFetch("/v2/deductions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      if (res.ok || res.status === 201) {
        toast({ title: editingUuid ? "Srážka aktualizována" : "Srážka vytvořena" });
        setShowForm(false);
        resetForm();
        fetchDeductions();
      } else {
        const d = await res.json();
        toast({ title: "Chyba", description: d.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba", variant: "destructive" });
    }
  };

  const deactivateDeduction = async (uuid: string) => {
    if (!confirm("Deaktivovat srážku? Bude ukončena k dnešnímu datu.")) return;
    try {
      const res = await apiClient.authenticatedFetch(`/v2/deductions/${uuid}`, { method: "DELETE" });
      if (res.ok) {
        toast({ title: "Srážka deaktivována" });
        fetchDeductions();
      } else {
        const d = await res.json();
        toast({ title: "Chyba", description: d.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba", variant: "destructive" });
    }
  };

  // ====================================
  // HELPERS
  // ====================================

  const typeMeta = (type: string) => DEDUCTION_TYPES.find(t => t.value === type) || DEDUCTION_TYPES[DEDUCTION_TYPES.length - 1];

  const filteredDeductions = useMemo(() => {
    if (!searchTerm) return deductions;
    const q = searchTerm.toLowerCase();
    return deductions.filter(d =>
      d.name?.toLowerCase().includes(q) ||
      d.osobni_cislo?.includes(q) ||
      d.description?.toLowerCase().includes(q) ||
      d.creditor_name?.toLowerCase().includes(q) ||
      d.case_number?.includes(q)
    );
  }, [deductions, searchTerm]);

  const totalMonthly = deductions.filter(d => d.is_active).reduce((s, d) => s + (d.fixed_amount_czk || 0), 0);

  // ====================================
  // RENDER
  // ====================================

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Scale className="h-6 w-6" /> Srážky ze mzdy
          </h1>
          <p className="text-muted-foreground mt-1">
            Exekuce, insolvence, alimenty a ostatní srážky — dle §276-302 OSŘ
          </p>
        </div>
        {totalMonthly > 0 && (
          <div className="text-sm bg-muted px-4 py-2 rounded-lg">
            Celkové aktivní srážky: <strong>{totalMonthly.toLocaleString("cs-CZ")} Kč/měs</strong>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center">
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" /> Nová srážka
        </Button>
        <Input
          placeholder="Hledat..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="max-w-[200px] text-sm"
        />
        <select
          className="border rounded-md px-3 py-2 text-sm"
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
        >
          <option value="all">Všechny typy</option>
          {DEDUCTION_TYPES.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <select
          className="border rounded-md px-3 py-2 text-sm"
          value={employeeFilter}
          onChange={e => setEmployeeFilter(e.target.value)}
        >
          <option value="all">Všichni zaměstnanci</option>
          {employees.map(e => (
            <option key={e.uuid} value={e.uuid}>{e.osobni_cislo} — {e.name}</option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={e => setActiveOnly(e.target.checked)}
            className="rounded"
          />
          Pouze aktivní
        </label>
        <Button variant="ghost" size="sm" onClick={fetchDeductions}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {loading && <div className="text-center py-8 text-muted-foreground">Načítání...</div>}

      {/* Create / Edit form */}
      {showForm && (
        <div className="border rounded-lg p-4 space-y-4 bg-muted/30">
          <h3 className="font-medium">{editingUuid ? "Upravit srážku" : "Nová srážka"}</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {!editingUuid && (
              <div>
                <label className="text-sm font-medium">Zaměstnanec *</label>
                <select
                  className="w-full border rounded-md px-3 py-2 text-sm"
                  value={formData.employee_uuid}
                  onChange={e => setFormData({ ...formData, employee_uuid: e.target.value })}
                >
                  <option value="">— Vyberte —</option>
                  {employees.map(e => (
                    <option key={e.uuid} value={e.uuid}>{e.osobni_cislo} — {e.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="text-sm font-medium">Typ srážky *</label>
              <select
                className="w-full border rounded-md px-3 py-2 text-sm"
                value={formData.type}
                onChange={e => setFormData({ ...formData, type: e.target.value })}
                disabled={!!editingUuid}
              >
                {DEDUCTION_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label} (prio {t.priority})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Popis *</label>
              <Input
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                placeholder="Exekuce - OS Praha 2"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Číslo jednací</label>
              <Input
                value={formData.case_number}
                onChange={e => setFormData({ ...formData, case_number: e.target.value })}
                placeholder="1 EXE 123/2025"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Věřitel</label>
              <Input
                value={formData.creditor_name}
                onChange={e => setFormData({ ...formData, creditor_name: e.target.value })}
                placeholder="Název věřitele"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Účet věřitele</label>
              <Input
                value={formData.creditor_account}
                onChange={e => setFormData({ ...formData, creditor_account: e.target.value })}
                placeholder="123456789/0100"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Variabilní symbol</label>
              <Input
                value={formData.variable_symbol}
                onChange={e => setFormData({ ...formData, variable_symbol: e.target.value })}
                placeholder="1234567890"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Pevná částka (Kč/měs)</label>
              <Input
                type="number"
                min={0}
                value={formData.fixed_amount_czk}
                onChange={e => setFormData({ ...formData, fixed_amount_czk: e.target.value })}
                placeholder="5000"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Procento (%)</label>
              <Input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={formData.percentage}
                onChange={e => setFormData({ ...formData, percentage: e.target.value })}
                placeholder="33"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Celkový dluh (Kč)</label>
              <Input
                type="number"
                min={0}
                value={formData.total_obligation_czk}
                onChange={e => setFormData({ ...formData, total_obligation_czk: e.target.value })}
                placeholder="500000"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Platnost od *</label>
              <Input
                type="date"
                value={formData.effective_from}
                onChange={e => setFormData({ ...formData, effective_from: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Platnost do (volitelné)</label>
              <Input
                type="date"
                value={formData.effective_to}
                onChange={e => setFormData({ ...formData, effective_to: e.target.value })}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            * Musíte zadat buď pevnou částku nebo procento (nebo oboje). Priorita se přiřadí automaticky dle typu.
          </p>
          <div className="flex gap-2">
            <Button onClick={submitForm}>{editingUuid ? "Uložit" : "Vytvořit"}</Button>
            <Button variant="ghost" onClick={() => { setShowForm(false); resetForm(); }}>Zrušit</Button>
          </div>
        </div>
      )}

      {/* History modal */}
      {historyUuid && history && (
        <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
          <div className="flex items-center justify-between">
            <h3 className="font-medium flex items-center gap-2">
              <History className="h-4 w-4" /> Historie srážky: {history.deduction.description}
            </h3>
            <Button size="sm" variant="ghost" onClick={() => { setHistoryUuid(null); setHistory(null); }}>Zavřít</Button>
          </div>
          <div className="text-sm text-muted-foreground">
            Typ: {typeMeta(history.deduction.type).label} ·
            Celkový dluh: {history.deduction.total_obligation_czk?.toLocaleString("cs-CZ") || "—"} Kč ·
            Celkem sraženo: {history.deduction.total_deducted_czk?.toLocaleString("cs-CZ") || "0"} Kč
          </div>
          {history.history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Zatím žádné srážky</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-1 px-2">Období</th>
                  <th className="py-1 px-2 text-right">Sraženo (Kč)</th>
                  <th className="py-1 px-2 text-right">Zbývá (Kč)</th>
                </tr>
              </thead>
              <tbody>
                {history.history.map((h, i) => (
                  <tr key={i} className="border-b">
                    <td className="py-1 px-2">{h.month}/{h.year}</td>
                    <td className="py-1 px-2 text-right">{h.amount_czk?.toLocaleString("cs-CZ")}</td>
                    <td className="py-1 px-2 text-right">{h.remaining_czk?.toLocaleString("cs-CZ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Deductions list */}
      {!loading && filteredDeductions.length === 0 && (
        <div className="text-center py-12 border rounded-lg">
          <Scale className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="font-medium">Žádné srážky</h3>
          <p className="text-sm text-muted-foreground mt-1">Zatím nebyly zaznamenány žádné srážky ze mzdy</p>
        </div>
      )}

      {!loading && filteredDeductions.length > 0 && (
        <div className="space-y-3">
          {filteredDeductions.map(d => {
            const meta = typeMeta(d.type);
            const remaining = d.total_obligation_czk
              ? Math.max(0, d.total_obligation_czk - (d.total_deducted_czk || 0))
              : null;
            const progress = d.total_obligation_czk && d.total_deducted_czk
              ? Math.min(100, Math.round((d.total_deducted_czk / d.total_obligation_czk) * 100))
              : null;

            return (
              <div key={d.uuid} className={`border rounded-lg p-4 ${d.is_active ? "" : "opacity-60"}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${meta.color}`}>
                        {meta.label}
                      </span>
                      <span className="text-xs text-muted-foreground">Prio {d.priority}</span>
                      {!d.is_active && (
                        <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded">Neaktivní</span>
                      )}
                    </div>
                    <p className="font-medium">{d.description}</p>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                      <span>{d.name} ({d.osobni_cislo})</span>
                      {d.creditor_name && <span>Věřitel: {d.creditor_name}</span>}
                      {d.case_number && <span>Č.j.: {d.case_number}</span>}
                    </div>
                    <div className="flex items-center gap-4 text-sm flex-wrap">
                      {d.fixed_amount_czk != null && (
                        <span className="flex items-center gap-1">
                          <DollarSign className="h-3 w-3" /> {d.fixed_amount_czk.toLocaleString("cs-CZ")} Kč/měs
                        </span>
                      )}
                      {d.percentage != null && (
                        <span className="flex items-center gap-1">
                          <Percent className="h-3 w-3" /> {d.percentage}%
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        Od: {new Date(d.effective_from).toLocaleDateString("cs-CZ")}
                        {d.effective_to && ` do: ${new Date(d.effective_to).toLocaleDateString("cs-CZ")}`}
                      </span>
                    </div>

                    {/* Progress bar for obligation */}
                    {d.total_obligation_czk != null && (
                      <div className="mt-2">
                        <div className="flex justify-between text-xs text-muted-foreground mb-1">
                          <span>Splaceno: {(d.total_deducted_czk || 0).toLocaleString("cs-CZ")} / {d.total_obligation_czk.toLocaleString("cs-CZ")} Kč</span>
                          <span>{progress}%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-primary rounded-full h-2 transition-all"
                            style={{ width: `${progress || 0}%` }}
                          />
                        </div>
                        {remaining != null && remaining > 0 && (
                          <p className="text-xs text-muted-foreground mt-1">Zbývá: {remaining.toLocaleString("cs-CZ")} Kč</p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => fetchHistory(d.uuid)} title="Historie">
                      <History className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(d)} title="Upravit">
                      <Edit className="h-4 w-4" />
                    </Button>
                    {d.is_active ? (
                      <Button size="sm" variant="ghost" className="text-red-500" onClick={() => deactivateDeduction(d.uuid)} title="Deaktivovat">
                        <Ban className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
