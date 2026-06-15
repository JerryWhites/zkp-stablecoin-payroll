// ====================================
// ⏱️ Timesheets & Attendance Management Page
// ====================================
// Clock-in/out, shift scheduling, overtime tracking, approval workflow
// Backend: routes/timesheets.js

import { useState, useEffect, useCallback } from "react";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Clock, Plus, CheckCircle, XCircle, Send, RefreshCw,
  Calendar, Sun, Moon, AlertTriangle, Timer, ChevronDown,
} from "lucide-react";

// ====================================
// TYPES
// ====================================

interface TimesheetEntry {
  uuid: string;
  employee_uuid: string;
  employee_name?: string;
  osobni_cislo?: string;
  date: string;
  clock_in: string | null;
  clock_out: string | null;
  break_minutes: number;
  total_hours: number;
  overtime_hours: number;
  night_hours: number;
  weekend_hours: number;
  holiday_hours: number;
  status: string;
  note: string | null;
  created_at: string;
}

interface ShiftSchedule {
  uuid: string;
  name: string;
  shift_start: string;
  shift_end: string;
  break_minutes: number;
  is_night_shift: number;
  is_active: number;
}

// ====================================
// COMPONENT
// ====================================

export default function Timesheets() {
  const { toast } = useToast();
  const [tab, setTab] = useState<"entries" | "shifts" | "overtime">("entries");
  const [loading, setLoading] = useState(true);

  // Data
  const [entries, setEntries] = useState<TimesheetEntry[]>([]);
  const [shifts, setShifts] = useState<ShiftSchedule[]>([]);
  const [employees, setEmployees] = useState<{ uuid: string; name: string; osobni_cislo: string }[]>([]);

  // Filters
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [statusFilter, setStatusFilter] = useState("all");

  // Forms
  const [showCreate, setShowCreate] = useState(false);
  const [showShiftForm, setShowShiftForm] = useState(false);
  const [form, setForm] = useState({
    employee_uuid: "",
    date: new Date().toISOString().split("T")[0],
    clock_in: "08:00",
    clock_out: "16:30",
    break_minutes: "30",
    overtime_hours: "0",
    night_hours: "0",
    weekend_hours: "0",
    holiday_hours: "0",
    note: "",
  });
  const [shiftForm, setShiftForm] = useState({
    name: "",
    shift_start: "08:00",
    shift_end: "16:30",
    break_minutes: "30",
    is_night_shift: false,
  });

  // ====================================
  // DATA FETCHING
  // ====================================

  const fetchEntries = useCallback(async () => {
    try {
      const res = await apiClient.authenticatedFetch(`/v2/timesheets?year=${year}&month=${month}${statusFilter !== "all" ? `&status=${statusFilter}` : ""}`);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.timesheets || []);
      }
    } catch {
      toast({ title: "Chyba", description: "Nepodařilo se načíst docházku", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [year, month, statusFilter]);

  const fetchShifts = useCallback(async () => {
    try {
      const res = await apiClient.authenticatedFetch("/v2/timesheets/shifts");
      if (res.ok) {
        const data = await res.json();
        setShifts(data.shifts || []);
      }
    } catch {}
  }, []);

  const fetchEmployees = useCallback(async () => {
    try {
      const res = await apiClient.authenticatedFetch("/v2/employees");
      if (res.ok) {
        const data = await res.json();
        setEmployees((data.employees || []).map((e: any) => ({
          uuid: e.uuid,
          name: `${e.first_name || ""} ${e.last_name || ""}`.trim() || e.osobni_cislo,
          osobni_cislo: e.osobni_cislo,
        })));
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchEntries();
    fetchShifts();
    fetchEmployees();
  }, [fetchEntries, fetchShifts, fetchEmployees]);

  // ====================================
  // ACTIONS
  // ====================================

  const createEntry = async () => {
    if (!form.employee_uuid) {
      toast({ title: "Chyba", description: "Vyberte zaměstnance", variant: "destructive" });
      return;
    }
    try {
      const res = await apiClient.authenticatedFetch("/v2/timesheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_uuid: form.employee_uuid,
          date: form.date,
          clock_in: form.clock_in,
          clock_out: form.clock_out,
          break_minutes: parseInt(form.break_minutes) || 0,
          overtime_hours: parseFloat(form.overtime_hours) || 0,
          night_hours: parseFloat(form.night_hours) || 0,
          weekend_hours: parseFloat(form.weekend_hours) || 0,
          holiday_hours: parseFloat(form.holiday_hours) || 0,
          note: form.note || undefined,
        }),
      });
      if (res.ok) {
        toast({ title: "Záznam vytvořen", description: "Docházka uložena" });
        setShowCreate(false);
        fetchEntries();
      } else {
        const err = await res.json();
        toast({ title: "Chyba", description: err.error || "Nepodařilo se uložit", variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba", description: "Nepodařilo se uložit docházku", variant: "destructive" });
    }
  };

  const submitEntry = async (uuid: string) => {
    try {
      const res = await apiClient.authenticatedFetch(`/v2/timesheets/${uuid}/submit`, { method: "POST" });
      if (res.ok) {
        toast({ title: "Odesláno", description: "Záznam odeslán ke schválení" });
        fetchEntries();
      }
    } catch {
      toast({ title: "Chyba", description: "Nepodařilo se odeslat", variant: "destructive" });
    }
  };

  const approveEntry = async (uuid: string) => {
    try {
      const res = await apiClient.authenticatedFetch(`/v2/timesheets/${uuid}/approve`, { method: "POST" });
      if (res.ok) {
        toast({ title: "Schváleno", description: "Docházka schválena" });
        fetchEntries();
      }
    } catch {
      toast({ title: "Chyba", description: "Nepodařilo se schválit", variant: "destructive" });
    }
  };

  const rejectEntry = async (uuid: string) => {
    try {
      const res = await apiClient.authenticatedFetch(`/v2/timesheets/${uuid}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Zamítnuto administrátorem" }),
      });
      if (res.ok) {
        toast({ title: "Zamítnuto", description: "Docházka zamítnuta" });
        fetchEntries();
      }
    } catch {
      toast({ title: "Chyba", description: "Nepodařilo se zamítnout", variant: "destructive" });
    }
  };

  const createShift = async () => {
    try {
      const res = await apiClient.authenticatedFetch("/v2/timesheets/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: shiftForm.name,
          shift_start: shiftForm.shift_start,
          shift_end: shiftForm.shift_end,
          break_minutes: parseInt(shiftForm.break_minutes) || 30,
          is_night_shift: shiftForm.is_night_shift,
        }),
      });
      if (res.ok) {
        toast({ title: "Směna vytvořena" });
        setShowShiftForm(false);
        fetchShifts();
      } else {
        const err = await res.json();
        toast({ title: "Chyba", description: err.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba", description: "Nepodařilo se vytvořit směnu", variant: "destructive" });
    }
  };

  // ====================================
  // STATUS HELPERS
  // ====================================

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
      draft: { label: "Koncept", cls: "bg-gray-100 text-gray-700", icon: <Clock className="w-3 h-3" /> },
      submitted: { label: "Odesláno", cls: "bg-blue-100 text-blue-700", icon: <Send className="w-3 h-3" /> },
      approved: { label: "Schváleno", cls: "bg-green-100 text-green-700", icon: <CheckCircle className="w-3 h-3" /> },
      rejected: { label: "Zamítnuto", cls: "bg-red-100 text-red-700", icon: <XCircle className="w-3 h-3" /> },
    };
    const s = map[status] || map.draft;
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${s.cls}`}>
        {s.icon} {s.label}
      </span>
    );
  };

  // ====================================
  // RENDER
  // ====================================

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Clock className="w-6 h-6 text-accent" />
            Docházka & Timesheets
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Evidence pracovní doby, směny, přesčasy, příplatky
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => fetchEntries()}>
            <RefreshCw className="w-4 h-4 mr-1" /> Obnovit
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4 mr-1" /> Nový záznam
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/30 p-1 rounded-lg w-fit">
        {[
          { key: "entries" as const, label: "Záznamy", icon: <Timer className="w-4 h-4" /> },
          { key: "shifts" as const, label: "Směny", icon: <Sun className="w-4 h-4" /> },
          { key: "overtime" as const, label: "Přesčasy", icon: <Moon className="w-4 h-4" /> },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded text-sm font-medium transition-colors ${
              tab === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Period selector */}
      {tab === "entries" && (
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={year}
            onChange={e => setYear(parseInt(e.target.value))}
            className="bg-background border border-border rounded px-3 py-1.5 text-sm"
          >
            {[2024, 2025, 2026, 2027].map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <select
            value={month}
            onChange={e => setMonth(parseInt(e.target.value))}
            className="bg-background border border-border rounded px-3 py-1.5 text-sm"
          >
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {new Date(2026, i).toLocaleString("cs-CZ", { month: "long" })}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="bg-background border border-border rounded px-3 py-1.5 text-sm"
          >
            <option value="all">Všechny stavy</option>
            <option value="draft">Koncept</option>
            <option value="submitted">Odesláno</option>
            <option value="approved">Schváleno</option>
            <option value="rejected">Zamítnuto</option>
          </select>
        </div>
      )}

      {/* ====== ENTRIES TAB ====== */}
      {tab === "entries" && (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Zaměstnanec</th>
                <th className="text-left px-4 py-3 font-medium">Datum</th>
                <th className="text-left px-4 py-3 font-medium">Příchod</th>
                <th className="text-left px-4 py-3 font-medium">Odchod</th>
                <th className="text-right px-4 py-3 font-medium">Celkem h</th>
                <th className="text-right px-4 py-3 font-medium">Přesčas</th>
                <th className="text-center px-4 py-3 font-medium">Stav</th>
                <th className="text-right px-4 py-3 font-medium">Akce</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Načítání...</td></tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center">
                    <Calendar className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
                    <p className="text-muted-foreground">Žádné záznamy docházky pro {month}/{year}</p>
                    <Button size="sm" className="mt-3" onClick={() => setShowCreate(true)}>
                      <Plus className="w-4 h-4 mr-1" /> Přidat záznam
                    </Button>
                  </td>
                </tr>
              ) : entries.map(entry => (
                <tr key={entry.uuid} className="hover:bg-muted/20">
                  <td className="px-4 py-3 font-medium">{entry.employee_name || entry.employee_uuid?.slice(0, 8)}</td>
                  <td className="px-4 py-3">{entry.date}</td>
                  <td className="px-4 py-3">{entry.clock_in || "—"}</td>
                  <td className="px-4 py-3">{entry.clock_out || "—"}</td>
                  <td className="px-4 py-3 text-right">{entry.total_hours?.toFixed(1) || "0.0"}</td>
                  <td className="px-4 py-3 text-right">
                    {entry.overtime_hours > 0 && (
                      <span className="text-orange-600 font-medium">{entry.overtime_hours.toFixed(1)}</span>
                    )}
                    {!entry.overtime_hours && "—"}
                  </td>
                  <td className="px-4 py-3 text-center">{statusBadge(entry.status)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      {entry.status === "draft" && (
                        <Button variant="outline" size="sm" onClick={() => submitEntry(entry.uuid)} title="Odeslat ke schválení">
                          <Send className="w-3 h-3" />
                        </Button>
                      )}
                      {entry.status === "submitted" && (
                        <>
                          <Button variant="outline" size="sm" onClick={() => approveEntry(entry.uuid)} className="text-green-600" title="Schválit">
                            <CheckCircle className="w-3 h-3" />
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => rejectEntry(entry.uuid)} className="text-red-600" title="Zamítnout">
                            <XCircle className="w-3 h-3" />
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ====== SHIFTS TAB ====== */}
      {tab === "shifts" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Směny</h2>
            <Button size="sm" onClick={() => setShowShiftForm(true)}>
              <Plus className="w-4 h-4 mr-1" /> Nová směna
            </Button>
          </div>
          {shifts.length === 0 ? (
            <div className="border border-border rounded-lg p-8 text-center text-muted-foreground">
              <Sun className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>Žádné definované směny</p>
              <Button size="sm" className="mt-3" onClick={() => setShowShiftForm(true)}>
                <Plus className="w-4 h-4 mr-1" /> Definovat směnu
              </Button>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {shifts.map(s => (
                <div key={s.uuid} className="border border-border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-medium">{s.name}</h3>
                    {s.is_night_shift ? (
                      <Moon className="w-4 h-4 text-indigo-500" />
                    ) : (
                      <Sun className="w-4 h-4 text-amber-500" />
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {s.shift_start} — {s.shift_end} ({s.break_minutes} min pauza)
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ====== OVERTIME TAB ====== */}
      {tab === "overtime" && (
        <div className="space-y-4">
          <div className="border border-border rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-orange-500" />
              Přehled přesčasů — {month}/{year}
            </h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="bg-muted/30 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-orange-500">
                  {entries.reduce((s, e) => s + (e.overtime_hours || 0), 0).toFixed(1)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Přesčas celkem (h)</p>
              </div>
              <div className="bg-muted/30 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-indigo-500">
                  {entries.reduce((s, e) => s + (e.night_hours || 0), 0).toFixed(1)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Noční hodiny</p>
              </div>
              <div className="bg-muted/30 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-purple-500">
                  {entries.reduce((s, e) => s + (e.holiday_hours || 0), 0).toFixed(1)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Svátky / víkendy</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              Zákoník práce § 114–118: Přesčas min. 25 %, noc min. 10 %, víkend min. 10 %, svátek 100 %
            </p>
          </div>
        </div>
      )}

      {/* ====== CREATE ENTRY MODAL ====== */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-background border border-border rounded-lg shadow-lg w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">Nový záznam docházky</h2>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium mb-1 block">Zaměstnanec *</label>
                <select
                  value={form.employee_uuid}
                  onChange={e => setForm({ ...form, employee_uuid: e.target.value })}
                  className="w-full bg-background border border-border rounded px-3 py-2 text-sm"
                >
                  <option value="">Vyberte zaměstnance</option>
                  {employees.map(e => (
                    <option key={e.uuid} value={e.uuid}>{e.name} ({e.osobni_cislo})</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-sm font-medium mb-1 block">Datum</label>
                  <Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Příchod</label>
                  <Input type="time" value={form.clock_in} onChange={e => setForm({ ...form, clock_in: e.target.value })} />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Odchod</label>
                  <Input type="time" value={form.clock_out} onChange={e => setForm({ ...form, clock_out: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium mb-1 block">Pauza (min)</label>
                  <Input type="number" value={form.break_minutes} onChange={e => setForm({ ...form, break_minutes: e.target.value })} />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Přesčas (h)</label>
                  <Input type="number" step="0.5" value={form.overtime_hours} onChange={e => setForm({ ...form, overtime_hours: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-sm font-medium mb-1 block">Noční (h)</label>
                  <Input type="number" step="0.5" value={form.night_hours} onChange={e => setForm({ ...form, night_hours: e.target.value })} />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Víkend (h)</label>
                  <Input type="number" step="0.5" value={form.weekend_hours} onChange={e => setForm({ ...form, weekend_hours: e.target.value })} />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Svátek (h)</label>
                  <Input type="number" step="0.5" value={form.holiday_hours} onChange={e => setForm({ ...form, holiday_hours: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Poznámka</label>
                <Input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="Volitelné" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowCreate(false)}>Zrušit</Button>
              <Button onClick={createEntry}>Uložit</Button>
            </div>
          </div>
        </div>
      )}

      {/* ====== CREATE SHIFT MODAL ====== */}
      {showShiftForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setShowShiftForm(false)}>
          <div className="bg-background border border-border rounded-lg shadow-lg w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">Nová směna</h2>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium mb-1 block">Název směny *</label>
                <Input value={shiftForm.name} onChange={e => setShiftForm({ ...shiftForm, name: e.target.value })} placeholder="např. Ranní směna" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium mb-1 block">Začátek</label>
                  <Input type="time" value={shiftForm.shift_start} onChange={e => setShiftForm({ ...shiftForm, shift_start: e.target.value })} />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Konec</label>
                  <Input type="time" value={shiftForm.shift_end} onChange={e => setShiftForm({ ...shiftForm, shift_end: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium mb-1 block">Pauza (min)</label>
                  <Input type="number" value={shiftForm.break_minutes} onChange={e => setShiftForm({ ...shiftForm, break_minutes: e.target.value })} />
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={shiftForm.is_night_shift}
                      onChange={e => setShiftForm({ ...shiftForm, is_night_shift: e.target.checked })}
                      className="rounded"
                    />
                    <Moon className="w-4 h-4" /> Noční směna
                  </label>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowShiftForm(false)}>Zrušit</Button>
              <Button onClick={createShift}>Vytvořit</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
