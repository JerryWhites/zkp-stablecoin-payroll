// ====================================
// 📈 SLA Dashboard Page
// ====================================

import { useState, useEffect, useCallback } from "react";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Activity, CheckCircle, XCircle, AlertTriangle, Clock, Server, Database, HardDrive, Cpu } from "lucide-react";

interface SlaStatus {
  status: string;
  uptime_percent: string;
  checks_24h: number;
  failed_24h: number;
  avg_response_ms: number;
  last_check: {
    timestamp: string;
    healthy: boolean;
    response_time_ms: number;
    details: Record<string, { healthy: boolean; message: string }>;
  } | null;
  open_incidents: number;
}

interface SlaCheck {
  id: number;
  is_healthy: boolean;
  response_time_ms: number;
  db_healthy: boolean;
  disk_healthy: boolean;
  memory_healthy: boolean;
  created_at: string;
}

interface SlaIncident {
  uuid: string;
  title: string;
  severity: string;
  status: string;
  started_at: string;
  resolved_at: string | null;
  description: string | null;
}

interface SlaReport {
  uuid: string;
  month: string;
  year: number;
  uptime_percent: string;
  total_checks: number;
  failed_checks: number;
  avg_response_ms: number;
  incidents_count: number;
  created_at: string;
}

export default function SLADashboard() {
  const { toast } = useToast();
  const [status, setStatus] = useState<SlaStatus | null>(null);
  const [history, setHistory] = useState<SlaCheck[]>([]);
  const [incidents, setIncidents] = useState<SlaIncident[]>([]);
  const [reports, setReports] = useState<SlaReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"overview" | "history" | "incidents" | "reports">("overview");

  const fetchData = useCallback(async () => {
    try {
      const [statusRes, histRes, incRes, repRes] = await Promise.all([
        apiClient.authenticatedFetch("/v2/sla/status"),
        apiClient.authenticatedFetch("/v2/sla/history"),
        apiClient.authenticatedFetch("/v2/sla/incidents"),
        apiClient.authenticatedFetch("/v2/sla/reports"),
      ]);
      if (statusRes.ok) { const d = await statusRes.json(); setStatus(d); }
      if (histRes.ok) { const d = await histRes.json(); setHistory(d.checks || []); }
      if (incRes.ok) { const d = await incRes.json(); setIncidents(d.incidents || []); }
      if (repRes.ok) { const d = await repRes.json(); setReports(d.reports || []); }
    } catch {
      toast({ title: "Chyba načítání", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const runManualCheck = async () => {
    try {
      const res = await apiClient.authenticatedFetch("/v2/sla/check", { method: "POST" });
      if (res.ok) {
        toast({ title: "Check proveden" });
        fetchData();
      }
    } catch {
      toast({ title: "Chyba", variant: "destructive" });
    }
  };

  const uptimeColor = (pct: number) => {
    if (pct >= 99.9) return "text-green-600";
    if (pct >= 99) return "text-yellow-600";
    return "text-red-600";
  };

  const severityBadge = (sev: string) => {
    const map: Record<string, string> = {
      critical: "bg-red-100 text-red-800",
      major: "bg-orange-100 text-orange-800",
      minor: "bg-yellow-100 text-yellow-800",
      maintenance: "bg-blue-100 text-blue-800",
    };
    return map[sev] || "bg-gray-100";
  };

  if (loading) return <div className="p-6 text-center text-muted-foreground">Načítání SLA dat...</div>;

  const uptimePct = status ? parseFloat(status.uptime_percent) : 0;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Activity className="h-6 w-6" /> SLA Dashboard</h1>
          <p className="text-muted-foreground mt-1">Monitoring dostupnosti a výkonu</p>
        </div>
        <Button variant="outline" onClick={runManualCheck}><Activity className="h-4 w-4 mr-2" /> Provést check</Button>
      </div>

      {/* Status Overview Cards */}
      {status && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="border rounded-lg p-4 text-center">
            <div className="flex justify-center mb-2">
              {status.status === "operational" ? <CheckCircle className="h-8 w-8 text-green-500" /> : <AlertTriangle className="h-8 w-8 text-red-500" />}
            </div>
            <p className="text-sm text-muted-foreground">Status</p>
            <p className="font-bold text-lg">{status.status === "operational" ? "Operační" : status.status === "degraded" ? "Degradován" : "Výpadek"}</p>
          </div>
          <div className="border rounded-lg p-4 text-center">
            <p className={`text-3xl font-bold ${uptimeColor(uptimePct)}`}>{status.uptime_percent}%</p>
            <p className="text-sm text-muted-foreground">Uptime (24h)</p>
          </div>
          <div className="border rounded-lg p-4 text-center">
            <p className="text-3xl font-bold">{status.avg_response_ms}<span className="text-sm font-normal ml-1">ms</span></p>
            <p className="text-sm text-muted-foreground">Průměrná odezva</p>
          </div>
          <div className="border rounded-lg p-4 text-center">
            <p className="text-3xl font-bold">{status.open_incidents}</p>
            <p className="text-sm text-muted-foreground">Otevřené incidenty</p>
          </div>
        </div>
      )}

      {/* Component status */}
      {status?.last_check?.details && (
        <div className="border rounded-lg p-4">
          <h3 className="font-medium mb-3">Komponenty systému</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {Object.entries(status.last_check.details).map(([key, val]) => (
              <div key={key} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
                {key === "database" ? <Database className="h-5 w-5" /> : key === "disk" ? <HardDrive className="h-5 w-5" /> : <Cpu className="h-5 w-5" />}
                <div className="flex-1">
                  <p className="text-sm font-medium capitalize">{key}</p>
                  <p className="text-xs text-muted-foreground">{val.message}</p>
                </div>
                {val.healthy ? <CheckCircle className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-red-500" />}
              </div>
            ))}
          </div>
          {status.last_check && (
            <p className="text-xs text-muted-foreground mt-3">
              Poslední check: {new Date(status.last_check.timestamp).toLocaleString("cs-CZ")} · {status.last_check.response_time_ms}ms
            </p>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b pb-2">
        {(["overview", "history", "incidents", "reports"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-medium rounded-t ${tab === t ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}>
            {t === "overview" ? "Přehled" : t === "history" ? "Historie checků" : t === "incidents" ? `Incidenty (${incidents.length})` : "Měsíční reporty"}
          </button>
        ))}
      </div>

      {/* Response time chart (simple ASCII-style bars) */}
      {tab === "overview" && history.length > 0 && (
        <div className="border rounded-lg p-4">
          <h3 className="font-medium mb-3">Odezva za posledních {history.length} checků</h3>
          <div className="flex items-end gap-1 h-24">
            {history.slice(0, 48).map((c, i) => {
              const maxMs = Math.max(...history.slice(0, 48).map(h => h.response_time_ms), 1);
              const heightPct = (c.response_time_ms / maxMs) * 100;
              return (
                <div key={i} className="flex-1 flex flex-col items-center" title={`${c.response_time_ms}ms · ${new Date(c.created_at).toLocaleTimeString("cs-CZ")}`}>
                  <div className={`w-full rounded-t ${c.is_healthy ? "bg-green-400" : "bg-red-400"}`} style={{ height: `${heightPct}%`, minHeight: 2 }} />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>{history.length > 0 ? new Date(history[Math.min(47, history.length - 1)].created_at).toLocaleTimeString("cs-CZ") : ""}</span>
            <span>{history.length > 0 ? new Date(history[0].created_at).toLocaleTimeString("cs-CZ") : ""}</span>
          </div>
        </div>
      )}

      {/* History tab */}
      {tab === "history" && (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left px-3 py-2">Čas</th>
                <th className="text-left px-3 py-2">Stav</th>
                <th className="text-left px-3 py-2">Odezva</th>
                <th className="text-left px-3 py-2">DB</th>
                <th className="text-left px-3 py-2">Disk</th>
                <th className="text-left px-3 py-2">Paměť</th>
              </tr>
            </thead>
            <tbody>
              {history.map(c => (
                <tr key={c.id} className="border-t hover:bg-muted/20">
                  <td className="px-3 py-2">{new Date(c.created_at).toLocaleString("cs-CZ")}</td>
                  <td className="px-3 py-2">
                    {c.is_healthy ? <CheckCircle className="h-4 w-4 text-green-500 inline" /> : <XCircle className="h-4 w-4 text-red-500 inline" />}
                  </td>
                  <td className="px-3 py-2">{c.response_time_ms}ms</td>
                  <td className="px-3 py-2">{c.db_healthy ? "✓" : "✗"}</td>
                  <td className="px-3 py-2">{c.disk_healthy ? "✓" : "✗"}</td>
                  <td className="px-3 py-2">{c.memory_healthy ? "✓" : "✗"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Incidents tab */}
      {tab === "incidents" && (
        <div className="space-y-3">
          {incidents.length === 0 ? (
            <div className="text-center py-12 border rounded-lg">
              <CheckCircle className="h-12 w-12 mx-auto mb-4 text-green-500" />
              <h3 className="font-medium">Žádné incidenty</h3>
              <p className="text-sm text-muted-foreground">Vše běží hladce</p>
            </div>
          ) : (
            incidents.map(inc => (
              <div key={inc.uuid} className="border rounded-lg p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      {inc.status === "resolved" ? <CheckCircle className="h-4 w-4 text-green-500" /> : <AlertTriangle className="h-4 w-4 text-red-500" />}
                      <span className="font-medium">{inc.title}</span>
                      <span className={`text-xs px-2 py-0.5 rounded ${severityBadge(inc.severity)}`}>{inc.severity}</span>
                    </div>
                    {inc.description && <p className="text-sm text-muted-foreground mt-1">{inc.description}</p>}
                    <p className="text-xs text-muted-foreground mt-1">
                      Začátek: {new Date(inc.started_at).toLocaleString("cs-CZ")}
                      {inc.resolved_at && ` · Vyřešeno: ${new Date(inc.resolved_at).toLocaleString("cs-CZ")}`}
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded ${inc.status === "resolved" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                    {inc.status === "resolved" ? "Vyřešeno" : inc.status === "investigating" ? "Vyšetřování" : inc.status}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Reports tab */}
      {tab === "reports" && (
        <div className="space-y-3">
          {reports.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">Žádné měsíční reporty</div>
          ) : (
            reports.map(r => (
              <div key={r.uuid} className="border rounded-lg p-4 flex items-center justify-between">
                <div>
                  <h4 className="font-medium">{r.month}/{r.year}</h4>
                  <p className="text-sm text-muted-foreground">
                    {r.total_checks} checků · {r.failed_checks} selhání · {r.incidents_count} incidentů · Ø {r.avg_response_ms}ms
                  </p>
                </div>
                <div className="text-right">
                  <p className={`text-xl font-bold ${uptimeColor(parseFloat(r.uptime_percent))}`}>{r.uptime_percent}%</p>
                  <p className="text-xs text-muted-foreground">uptime</p>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
