// ====================================
// ⏰ Scheduler (Auto Payroll) Page
// ====================================

import { useState, useEffect, useCallback } from "react";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Clock, Play, Pause, Trash2, Plus, History, RotateCw } from "lucide-react";

interface Schedule {
  uuid: string;
  name: string;
  day_of_month: number;
  hour: number;
  minute: number;
  cron_expression: string;
  is_active: number;
  auto_calculate: number;
  auto_lock: number;
  next_run_at: string | null;
  last_run_at: string | null;
  last_run_status: string | null;
  run_count: number;
  total_runs: number;
  successful_runs: number;
  created_by_email: string;
}

interface ScheduleRun {
  uuid: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  employees_processed: number;
  error_message: string | null;
}

export default function Scheduler() {
  const { toast } = useToast();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedHistory, setSelectedHistory] = useState<string | null>(null);
  const [runs, setRuns] = useState<ScheduleRun[]>([]);
  const [form, setForm] = useState({ name: "Měsíční výplaty", day_of_month: 25, hour: 8, minute: 0, auto_calculate: true, auto_lock: false });

  const fetchSchedules = useCallback(async () => {
    try {
      const res = await apiClient.authenticatedFetch("/v2/scheduler");
      if (res.ok) {
        const data = await res.json();
        setSchedules(data.schedules || []);
      }
    } catch {
      toast({ title: "Chyba", description: "Nepodařilo se načíst rozvrhy", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSchedules(); }, [fetchSchedules]);

  const createSchedule = async () => {
    try {
      const res = await apiClient.authenticatedFetch("/v2/scheduler", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Rozvrh vytvořen" });
        fetchSchedules();
        setShowCreate(false);
      } else {
        toast({ title: "Chyba", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba", variant: "destructive" });
    }
  };

  const toggleSchedule = async (uuid: string, active: boolean) => {
    try {
      await apiClient.authenticatedFetch(`/v2/scheduler/${uuid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !active }),
      });
      fetchSchedules();
      toast({ title: active ? "Rozvrh pozastaven" : "Rozvrh aktivován" });
    } catch {
      toast({ title: "Chyba", variant: "destructive" });
    }
  };

  const runNow = async (uuid: string) => {
    try {
      const res = await apiClient.authenticatedFetch(`/v2/scheduler/${uuid}/run-now`, { method: "POST" });
      if (res.ok) toast({ title: "Spuštěno" });
    } catch {
      toast({ title: "Chyba", variant: "destructive" });
    }
  };

  const deleteSchedule = async (uuid: string) => {
    if (!confirm("Smazat rozvrh?")) return;
    try {
      await apiClient.authenticatedFetch(`/v2/scheduler/${uuid}`, { method: "DELETE" });
      toast({ title: "Rozvrh smazán" });
      fetchSchedules();
    } catch {
      toast({ title: "Chyba", variant: "destructive" });
    }
  };

  const loadHistory = async (uuid: string) => {
    setSelectedHistory(uuid);
    try {
      const res = await apiClient.authenticatedFetch(`/v2/scheduler/${uuid}/history`);
      if (res.ok) {
        const data = await res.json();
        setRuns(data.runs || []);
      }
    } catch {
      toast({ title: "Chyba", variant: "destructive" });
    }
  };

  const statusBadge = (status: string | null) => {
    const colors: Record<string, string> = { success: "bg-green-100 text-green-700", failed: "bg-red-100 text-red-700", partial: "bg-yellow-100 text-yellow-700", skipped: "bg-gray-100 text-gray-600", running: "bg-blue-100 text-blue-700", pending: "bg-gray-100 text-gray-600" };
    return <span className={`text-xs px-2 py-0.5 rounded-full ${colors[status || ""] || "bg-gray-100 text-gray-600"}`}>{status || "—"}</span>;
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Clock className="h-6 w-6" /> Automatický Payroll</h1>
          <p className="text-muted-foreground mt-1">Naplánujte automatické zpracování mezd</p>
        </div>
        <Button onClick={() => setShowCreate(!showCreate)}><Plus className="h-4 w-4 mr-2" /> Nový rozvrh</Button>
      </div>

      {showCreate && (
        <div className="border rounded-lg p-4 space-y-4">
          <h3 className="font-medium">Nový rozvrh</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="text-sm font-medium">Název</label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="text-sm font-medium">Den v měsíci</label>
              <Input type="number" min={1} max={28} value={form.day_of_month} onChange={e => setForm({ ...form, day_of_month: parseInt(e.target.value) || 25 })} />
            </div>
            <div>
              <label className="text-sm font-medium">Hodina</label>
              <Input type="number" min={0} max={23} value={form.hour} onChange={e => setForm({ ...form, hour: parseInt(e.target.value) || 8 })} />
            </div>
            <div>
              <label className="text-sm font-medium">Minuta</label>
              <Input type="number" min={0} max={59} value={form.minute} onChange={e => setForm({ ...form, minute: parseInt(e.target.value) || 0 })} />
            </div>
          </div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.auto_calculate} onChange={e => setForm({ ...form, auto_calculate: e.target.checked })} />
              Automaticky spočítat mzdy
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.auto_lock} onChange={e => setForm({ ...form, auto_lock: e.target.checked })} />
              Automaticky uzamknout období
            </label>
          </div>
          <div className="flex gap-2">
            <Button onClick={createSchedule}>Vytvořit</Button>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Zrušit</Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-8 text-muted-foreground">Načítání...</div>
      ) : schedules.length === 0 ? (
        <div className="text-center py-12 border rounded-lg">
          <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-muted-foreground">Žádné rozvrhy — payroll je zatím pouze manuální</p>
        </div>
      ) : (
        <div className="space-y-4">
          {schedules.map(s => (
            <div key={s.uuid} className="border rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <span className={`h-3 w-3 rounded-full ${s.is_active ? "bg-green-500" : "bg-gray-400"}`} />
                  <h3 className="font-medium">{s.name}</h3>
                  {statusBadge(s.last_run_status)}
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => runNow(s.uuid)} title="Spustit teď"><Play className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => toggleSchedule(s.uuid, !!s.is_active)} title={s.is_active ? "Pozastavit" : "Aktivovat"}>
                    {s.is_active ? <Pause className="h-4 w-4" /> : <RotateCw className="h-4 w-4" />}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => loadHistory(s.uuid)} title="Historie"><History className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" className="text-red-500" onClick={() => deleteSchedule(s.uuid)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-muted-foreground">
                <div>📅 {s.day_of_month}. den, {String(s.hour).padStart(2, "0")}:{String(s.minute).padStart(2, "0")}</div>
                <div>🔄 Spuštěno: {s.run_count}× ({s.successful_runs} úspěšně)</div>
                <div>⏭️ Příští: {s.next_run_at ? new Date(s.next_run_at).toLocaleString("cs-CZ") : "—"}</div>
                <div>⏮️ Poslední: {s.last_run_at ? new Date(s.last_run_at).toLocaleString("cs-CZ") : "—"}</div>
              </div>

              {/* Run history */}
              {selectedHistory === s.uuid && runs.length > 0 && (
                <div className="mt-4 border-t pt-3 space-y-2">
                  <h4 className="text-sm font-medium">Historie spuštění</h4>
                  {runs.map(r => (
                    <div key={r.uuid} className="flex items-center justify-between text-sm bg-muted/30 rounded px-3 py-2">
                      <span>{new Date(r.started_at).toLocaleString("cs-CZ")}</span>
                      {statusBadge(r.status)}
                      <span>{r.employees_processed} zaměstnanců</span>
                      {r.error_message && <span className="text-red-500 text-xs">{r.error_message}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
