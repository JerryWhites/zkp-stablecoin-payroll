// ====================================
// 🏖️ Vacations & Absence Management Page
// ====================================
// Vacation entitlements, absence recording & approval
// Backend: routes/vacations.js — full CRUD, CZ Labour Code §211-223

import { useState, useEffect, useCallback, useMemo } from "react";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Palmtree, Plus, CheckCircle, XCircle, Clock, Ban, Calendar,
  ChevronDown, ChevronUp, Filter, RefreshCw, AlertTriangle,
} from "lucide-react";

// ====================================
// TYPES
// ====================================

const ABSENCE_TYPES = [
  { value: "dovolena", label: "Dovolená", color: "bg-blue-100 text-blue-800" },
  { value: "nemoc", label: "Nemocenská", color: "bg-red-100 text-red-800" },
  { value: "ocr", label: "OČR", color: "bg-orange-100 text-orange-800" },
  { value: "materska", label: "Mateřská", color: "bg-pink-100 text-pink-800" },
  { value: "rodicovska", label: "Rodičovská", color: "bg-pink-100 text-pink-800" },
  { value: "neplacene_volno", label: "Neplacené volno", color: "bg-gray-100 text-gray-800" },
  { value: "svatek", label: "Svátek", color: "bg-purple-100 text-purple-800" },
  { value: "sluzebni_cesta", label: "Služební cesta", color: "bg-indigo-100 text-indigo-800" },
  { value: "lekar", label: "Lékař", color: "bg-teal-100 text-teal-800" },
  { value: "nahradni_volno", label: "Náhradní volno", color: "bg-green-100 text-green-800" },
  { value: "jine", label: "Jiné", color: "bg-gray-100 text-gray-800" },
];

interface Entitlement {
  id: number;
  employee_uuid: string;
  name: string;
  osobni_cislo: string;
  typ_uvazku: string;
  year: number;
  total_days: number;
  carried_over_days: number;
  used_days: number;
  planned_days: number;
  remaining_days: number;
}

interface Absence {
  uuid: string;
  employee_uuid: string;
  name: string;
  osobni_cislo: string;
  type: string;
  date_from: string;
  date_to: string;
  work_days: number;
  hours: number | null;
  note: string | null;
  status: string;
  approved_by: number | null;
  created_at: string;
}

// ====================================
// COMPONENT
// ====================================

export default function Vacations() {
  const { toast } = useToast();
  const [tab, setTab] = useState<"absences" | "entitlements">("absences");
  const [loading, setLoading] = useState(true);

  // Data
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [formData, setFormData] = useState({
    employee_uuid: "",
    type: "dovolena",
    date_from: "",
    date_to: "",
    work_days: "",
    hours: "",
    note: "",
  });

  // Employees for select
  const [employees, setEmployees] = useState<{ uuid: string; name: string; osobni_cislo: string }[]>([]);

  // ====================================
  // DATA FETCHING
  // ====================================

  const fetchEntitlements = useCallback(async () => {
    try {
      const res = await apiClient.authenticatedFetch(`/v2/vacations/entitlements?year=${year}`);
      if (res.ok) {
        const data = await res.json();
        setEntitlements(data.entitlements || []);
      }
    } catch {
      // silent
    }
  }, [year]);

  const fetchAbsences = useCallback(async () => {
    try {
      const params = new URLSearchParams({ year: String(year) });
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (typeFilter !== "all") params.set("type", typeFilter);

      const res = await apiClient.authenticatedFetch(`/v2/vacations/absences?${params}`);
      if (res.ok) {
        const data = await res.json();
        setAbsences(data.absences || []);
      }
    } catch {
      // silent
    }
  }, [year, statusFilter, typeFilter]);

  const fetchEmployees = useCallback(async () => {
    try {
      const res = await apiClient.authenticatedFetch("/v2/employees");
      if (res.ok) {
        const data = await res.json();
        setEmployees((data.employees || []).map((e: any) => ({
          uuid: e.uuid,
          name: e.name,
          osobni_cislo: e.osobni_cislo,
        })));
      }
    } catch {
      // silent
    }
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchEntitlements(), fetchAbsences(), fetchEmployees()]);
    setLoading(false);
  }, [fetchEntitlements, fetchAbsences, fetchEmployees]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ====================================
  // ACTIONS
  // ====================================

  const initEntitlements = async () => {
    try {
      const res = await apiClient.authenticatedFetch("/v2/vacations/entitlements/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: `Nároky inicializovány — ${data.initialized} nových, ${data.skipped} přeskočeno` });
        fetchEntitlements();
      } else {
        toast({ title: "Chyba", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba", variant: "destructive" });
    }
  };

  const createAbsence = async () => {
    if (!formData.employee_uuid || !formData.date_from || !formData.date_to || !formData.work_days) {
      toast({ title: "Vyplňte povinná pole", variant: "destructive" });
      return;
    }
    try {
      const res = await apiClient.authenticatedFetch("/v2/vacations/absences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_uuid: formData.employee_uuid,
          type: formData.type,
          date_from: formData.date_from,
          date_to: formData.date_to,
          work_days: Number(formData.work_days),
          hours: formData.hours ? Number(formData.hours) : undefined,
          note: formData.note || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok || res.status === 201) {
        toast({
          title: "Absence vytvořena",
          description: data.warning || undefined,
          variant: data.warning ? "default" : undefined,
        });
        setShowCreate(false);
        setFormData({ employee_uuid: "", type: "dovolena", date_from: "", date_to: "", work_days: "", hours: "", note: "" });
        fetchAbsences();
        fetchEntitlements();
      } else {
        toast({ title: "Chyba", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba při vytváření", variant: "destructive" });
    }
  };

  const approveAbsence = async (uuid: string) => {
    try {
      const res = await apiClient.authenticatedFetch(`/v2/vacations/absences/${uuid}/approve`, { method: "PUT" });
      if (res.ok) {
        toast({ title: "Absence schválena" });
        fetchAbsences();
        fetchEntitlements();
      } else {
        const d = await res.json();
        toast({ title: "Chyba", description: d.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba", variant: "destructive" });
    }
  };

  const rejectAbsence = async (uuid: string) => {
    try {
      const res = await apiClient.authenticatedFetch(`/v2/vacations/absences/${uuid}/reject`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Zamítnuto nadřízeným" }),
      });
      if (res.ok) {
        toast({ title: "Absence zamítnuta" });
        fetchAbsences();
        fetchEntitlements();
      } else {
        const d = await res.json();
        toast({ title: "Chyba", description: d.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba", variant: "destructive" });
    }
  };

  const cancelAbsence = async (uuid: string) => {
    if (!confirm("Zrušit absenci?")) return;
    try {
      const res = await apiClient.authenticatedFetch(`/v2/vacations/absences/${uuid}`, { method: "DELETE" });
      if (res.ok) {
        toast({ title: "Absence zrušena" });
        fetchAbsences();
        fetchEntitlements();
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

  const absenceTypeMeta = (type: string) => ABSENCE_TYPES.find(t => t.value === type) || ABSENCE_TYPES[ABSENCE_TYPES.length - 1];

  const statusIcon = (status: string) => {
    switch (status) {
      case "pending": return <Clock className="h-4 w-4 text-yellow-500" />;
      case "approved": return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "rejected": return <XCircle className="h-4 w-4 text-red-500" />;
      case "cancelled": return <Ban className="h-4 w-4 text-gray-400" />;
      default: return null;
    }
  };
  const statusLabel = (s: string) => ({ pending: "Čeká", approved: "Schváleno", rejected: "Zamítnuto", cancelled: "Zrušeno" }[s] || s);

  const filteredAbsences = useMemo(() => {
    if (!searchTerm) return absences;
    const q = searchTerm.toLowerCase();
    return absences.filter(a => a.name?.toLowerCase().includes(q) || a.osobni_cislo?.includes(q));
  }, [absences, searchTerm]);

  const pendingCount = absences.filter(a => a.status === "pending").length;

  // ====================================
  // RENDER
  // ====================================

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Palmtree className="h-6 w-6" /> Dovolená & nepřítomnost
          </h1>
          <p className="text-muted-foreground mt-1">Správa nároků na dovolenou a evidence absencí</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Year selector */}
          <select
            className="border rounded-md px-3 py-2 text-sm"
            value={year}
            onChange={e => setYear(Number(e.target.value))}
          >
            {[2024, 2025, 2026, 2027, 2028].map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          {pendingCount > 0 && (
            <span className="text-sm bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full">
              {pendingCount} čeká na schválení
            </span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b pb-2">
        <button
          onClick={() => setTab("absences")}
          className={`px-4 py-2 text-sm font-medium rounded-t ${tab === "absences" ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}
        >
          Nepřítomnosti {pendingCount > 0 && `(${pendingCount} čeká)`}
        </button>
        <button
          onClick={() => setTab("entitlements")}
          className={`px-4 py-2 text-sm font-medium rounded-t ${tab === "entitlements" ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}
        >
          Nároky na dovolenou ({entitlements.length})
        </button>
      </div>

      {loading && <div className="text-center py-8 text-muted-foreground">Načítání...</div>}

      {/* ====================================
          ABSENCES TAB
         ==================================== */}
      {!loading && tab === "absences" && (
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="flex flex-wrap gap-2 items-center">
            <Button onClick={() => setShowCreate(!showCreate)}>
              <Plus className="h-4 w-4 mr-2" /> Nová nepřítomnost
            </Button>
            <Input
              placeholder="Hledat zaměstnance..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="max-w-[200px] text-sm"
            />
            <select
              className="border rounded-md px-3 py-2 text-sm"
              value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); }}
            >
              <option value="all">Všechny stavy</option>
              <option value="pending">Čeká</option>
              <option value="approved">Schváleno</option>
              <option value="rejected">Zamítnuto</option>
              <option value="cancelled">Zrušeno</option>
            </select>
            <select
              className="border rounded-md px-3 py-2 text-sm"
              value={typeFilter}
              onChange={e => { setTypeFilter(e.target.value); }}
            >
              <option value="all">Všechny typy</option>
              {ABSENCE_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <Button variant="ghost" size="sm" onClick={() => { fetchAbsences(); fetchEntitlements(); }}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>

          {/* Create form */}
          {showCreate && (
            <div className="border rounded-lg p-4 space-y-4 bg-muted/30">
              <h3 className="font-medium">Nová nepřítomnost</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                <div>
                  <label className="text-sm font-medium">Typ *</label>
                  <select
                    className="w-full border rounded-md px-3 py-2 text-sm"
                    value={formData.type}
                    onChange={e => setFormData({ ...formData, type: e.target.value })}
                  >
                    {ABSENCE_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium">Pracovní dny *</label>
                  <Input
                    type="number"
                    min={0}
                    step={0.5}
                    value={formData.work_days}
                    onChange={e => setFormData({ ...formData, work_days: e.target.value })}
                    placeholder="5"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Od *</label>
                  <Input
                    type="date"
                    value={formData.date_from}
                    onChange={e => setFormData({ ...formData, date_from: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Do *</label>
                  <Input
                    type="date"
                    value={formData.date_to}
                    onChange={e => setFormData({ ...formData, date_to: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Hodiny (volitelné)</label>
                  <Input
                    type="number"
                    min={0}
                    value={formData.hours}
                    onChange={e => setFormData({ ...formData, hours: e.target.value })}
                    placeholder="40"
                  />
                </div>
                <div className="md:col-span-3">
                  <label className="text-sm font-medium">Poznámka</label>
                  <Input
                    value={formData.note}
                    onChange={e => setFormData({ ...formData, note: e.target.value })}
                    placeholder="Volitelná poznámka..."
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={createAbsence}>Vytvořit</Button>
                <Button variant="ghost" onClick={() => setShowCreate(false)}>Zrušit</Button>
              </div>
            </div>
          )}

          {/* Absences list */}
          {filteredAbsences.length === 0 ? (
            <div className="text-center py-12 border rounded-lg">
              <Calendar className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="font-medium">Žádné nepřítomnosti</h3>
              <p className="text-sm text-muted-foreground mt-1">Vytvořte první záznam o nepřítomnosti</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredAbsences.map(a => {
                const meta = absenceTypeMeta(a.type);
                return (
                  <div key={a.uuid} className="border rounded-lg p-4">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {statusIcon(a.status)}
                          <span className="font-medium">{a.name}</span>
                          <span className="text-xs text-muted-foreground">({a.osobni_cislo})</span>
                          <span className={`text-xs px-2 py-0.5 rounded ${meta.color}`}>{meta.label}</span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {new Date(a.date_from).toLocaleDateString("cs-CZ")} — {new Date(a.date_to).toLocaleDateString("cs-CZ")}
                          {" · "}{a.work_days} prac. dn{a.work_days === 1 ? "ů" : a.work_days < 5 ? "y" : "ů"}
                          {a.hours ? ` (${a.hours} h)` : ""}
                        </p>
                        {a.note && <p className="text-xs text-muted-foreground italic">{a.note}</p>}
                      </div>
                      <div className="flex items-center gap-1">
                        <span className={`text-xs px-2 py-1 rounded ${
                          a.status === "approved" ? "bg-green-100 text-green-800" :
                          a.status === "rejected" ? "bg-red-100 text-red-800" :
                          a.status === "pending" ? "bg-yellow-100 text-yellow-800" : "bg-gray-100 text-gray-600"
                        }`}>
                          {statusLabel(a.status)}
                        </span>
                      </div>
                    </div>

                    {/* Actions for pending */}
                    {a.status === "pending" && (
                      <div className="flex gap-2 mt-3 border-t pt-3">
                        <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => approveAbsence(a.uuid)}>
                          <CheckCircle className="h-3 w-3 mr-1" /> Schválit
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => rejectAbsence(a.uuid)}>
                          <XCircle className="h-3 w-3 mr-1" /> Zamítnout
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => cancelAbsence(a.uuid)}>
                          Zrušit
                        </Button>
                      </div>
                    )}
                    {a.status === "approved" && (
                      <div className="flex gap-2 mt-3 border-t pt-3">
                        <Button size="sm" variant="ghost" className="text-red-500" onClick={() => cancelAbsence(a.uuid)}>
                          <Ban className="h-3 w-3 mr-1" /> Stornovat
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ====================================
          ENTITLEMENTS TAB
         ==================================== */}
      {!loading && tab === "entitlements" && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button onClick={initEntitlements}>
              <RefreshCw className="h-4 w-4 mr-2" /> Inicializovat nároky pro {year}
            </Button>
          </div>

          {entitlements.length === 0 ? (
            <div className="text-center py-12 border rounded-lg">
              <Palmtree className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="font-medium">Žádné nároky na dovolenou</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Klikněte na "Inicializovat nároky" pro vytvoření nároků pro rok {year}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2 px-3 font-medium">Os. č.</th>
                    <th className="py-2 px-3 font-medium">Jméno</th>
                    <th className="py-2 px-3 font-medium">Úvazek</th>
                    <th className="py-2 px-3 font-medium text-center">Nárok</th>
                    <th className="py-2 px-3 font-medium text-center">Převod</th>
                    <th className="py-2 px-3 font-medium text-center">Čerpáno</th>
                    <th className="py-2 px-3 font-medium text-center">Plánováno</th>
                    <th className="py-2 px-3 font-medium text-center">Zbývá</th>
                  </tr>
                </thead>
                <tbody>
                  {entitlements.map(ent => {
                    const remaining = ent.total_days + ent.carried_over_days - ent.used_days - ent.planned_days;
                    const isLow = remaining <= 2 && remaining > 0;
                    const isNegative = remaining < 0;
                    return (
                      <tr key={`${ent.employee_uuid}-${ent.year}`} className="border-b hover:bg-muted/50">
                        <td className="py-2 px-3 font-mono text-xs">{ent.osobni_cislo}</td>
                        <td className="py-2 px-3">{ent.name}</td>
                        <td className="py-2 px-3">{ent.typ_uvazku}</td>
                        <td className="py-2 px-3 text-center">{ent.total_days}</td>
                        <td className="py-2 px-3 text-center">{ent.carried_over_days > 0 ? `+${ent.carried_over_days}` : "—"}</td>
                        <td className="py-2 px-3 text-center">{ent.used_days}</td>
                        <td className="py-2 px-3 text-center">{ent.planned_days > 0 ? ent.planned_days : "—"}</td>
                        <td className={`py-2 px-3 text-center font-medium ${isNegative ? "text-red-600" : isLow ? "text-yellow-600" : "text-green-600"}`}>
                          {isNegative && <AlertTriangle className="h-3 w-3 inline mr-1" />}
                          {remaining}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
