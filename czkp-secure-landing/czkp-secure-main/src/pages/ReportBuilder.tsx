// ====================================
// 📊 Custom Report Builder Page
// ====================================

import { useState, useEffect, useCallback } from "react";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { BarChart3, Plus, Trash2, Download, Play, FileText, Table } from "lucide-react";

interface DataSource {
  label: string;
  columns: { key: string; label: string; type: string }[];
}

interface Template {
  uuid: string;
  name: string;
  description: string | null;
  data_source: string;
  columns: string;
  filters: string;
  type: string;
  sort_by: string | null;
  sort_order: string;
  last_generated_at: string | null;
  created_at: string;
  created_by_email: string;
}

interface ReportResult {
  uuid: string;
  row_count: number;
  columns: { key: string; label: string; type: string }[];
  data: Record<string, unknown>[];
}

export default function ReportBuilder() {
  const { toast } = useToast();
  const [sources, setSources] = useState<Record<string, DataSource>>({});
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [reportResult, setReportResult] = useState<ReportResult | null>(null);
  const [generating, setGenerating] = useState(false);

  const [form, setForm] = useState({
    name: "",
    data_source: "payroll_items",
    columns: [] as string[],
    type: "table",
    sort_by: "",
    sort_order: "asc",
    filters: [] as { column: string; operator: string; value: string }[],
  });

  const fetchData = useCallback(async () => {
    try {
      const [srcRes, tplRes] = await Promise.all([
        apiClient.authenticatedFetch("/v2/reports/sources"),
        apiClient.authenticatedFetch("/v2/reports/templates"),
      ]);
      if (srcRes.ok) {
        const d = await srcRes.json();
        setSources(d.sources || {});
      }
      if (tplRes.ok) {
        const d = await tplRes.json();
        setTemplates(d.templates || []);
      }
    } catch {
      toast({ title: "Chyba", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const saveTemplate = async () => {
    if (!form.name || form.columns.length === 0) {
      toast({ title: "Vyplňte název a vyberte sloupce", variant: "destructive" });
      return;
    }
    try {
      const res = await apiClient.authenticatedFetch("/v2/reports/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        toast({ title: "Šablona uložena" });
        fetchData();
        setShowCreate(false);
      } else {
        const d = await res.json();
        toast({ title: "Chyba", description: d.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba", variant: "destructive" });
    }
  };

  const generateReport = async (templateUuid?: string) => {
    setGenerating(true);
    try {
      const body = templateUuid
        ? { template_uuid: templateUuid }
        : { data_source: form.data_source, columns: form.columns, filters: form.filters };

      const res = await apiClient.authenticatedFetch("/v2/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const d = await res.json();
        setReportResult(d.report);
        toast({ title: `Report vygenerován: ${d.report.row_count} řádků` });
      } else {
        const d = await res.json();
        toast({ title: "Chyba", description: d.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba", variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const exportCsv = async (templateUuid: string) => {
    try {
      const res = await apiClient.authenticatedFetch("/v2/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_uuid: templateUuid, format: "csv" }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `report-${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      toast({ title: "Chyba exportu", variant: "destructive" });
    }
  };

  const deleteTemplate = async (uuid: string) => {
    if (!confirm("Smazat šablonu?")) return;
    try {
      await apiClient.authenticatedFetch(`/v2/reports/templates/${uuid}`, { method: "DELETE" });
      fetchData();
    } catch {}
  };

  const currentSourceCols = sources[form.data_source]?.columns || [];
  
  const formatValue = (val: unknown, type: string) => {
    if (val == null) return "—";
    if (type === "currency") return `${Number(val).toLocaleString("cs-CZ")} Kč`;
    if (type === "date") return new Date(String(val)).toLocaleDateString("cs-CZ");
    return String(val);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><BarChart3 className="h-6 w-6" /> Report Builder</h1>
          <p className="text-muted-foreground mt-1">Konfigurovatelné reporty z vašich dat</p>
        </div>
        <Button onClick={() => setShowCreate(!showCreate)}><Plus className="h-4 w-4 mr-2" /> Nová šablona</Button>
      </div>

      {/* Create / edit form */}
      {showCreate && (
        <div className="border rounded-lg p-4 space-y-4">
          <h3 className="font-medium">Nový report</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium">Název</label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Přehled mezd Q1" />
            </div>
            <div>
              <label className="text-sm font-medium">Zdroj dat</label>
              <select className="w-full border rounded-md px-3 py-2 text-sm" value={form.data_source} onChange={e => setForm({ ...form, data_source: e.target.value, columns: [] })}>
                {Object.entries(sources).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Řazení</label>
              <div className="flex gap-2">
                <select className="flex-1 border rounded-md px-3 py-2 text-sm" value={form.sort_by} onChange={e => setForm({ ...form, sort_by: e.target.value })}>
                  <option value="">Žádné</option>
                  {currentSourceCols.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
                <select className="w-20 border rounded-md px-3 py-2 text-sm" value={form.sort_order} onChange={e => setForm({ ...form, sort_order: e.target.value })}>
                  <option value="asc">↑</option>
                  <option value="desc">↓</option>
                </select>
              </div>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Sloupce</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {currentSourceCols.map(c => (
                <button key={c.key} onClick={() => {
                  const cols = form.columns.includes(c.key) ? form.columns.filter(x => x !== c.key) : [...form.columns, c.key];
                  setForm({ ...form, columns: cols });
                }} className={`px-3 py-1 rounded-full text-xs font-medium border transition ${form.columns.includes(c.key) ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground"}`}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Filters */}
          <div>
            <label className="text-sm font-medium">Filtry</label>
            {form.filters.map((f, i) => (
              <div key={i} className="flex gap-2 mt-1">
                <select className="border rounded-md px-2 py-1 text-sm" value={f.column} onChange={e => {
                  const filters = [...form.filters]; filters[i].column = e.target.value; setForm({ ...form, filters });
                }}>
                  {currentSourceCols.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
                <select className="border rounded-md px-2 py-1 text-sm w-20" value={f.operator} onChange={e => {
                  const filters = [...form.filters]; filters[i].operator = e.target.value; setForm({ ...form, filters });
                }}>
                  <option value="eq">=</option><option value="neq">≠</option><option value="gt">&gt;</option>
                  <option value="gte">≥</option><option value="lt">&lt;</option><option value="lte">≤</option>
                  <option value="contains">obsahuje</option>
                </select>
                <Input className="flex-1" value={f.value} onChange={e => {
                  const filters = [...form.filters]; filters[i].value = e.target.value; setForm({ ...form, filters });
                }} />
                <Button size="sm" variant="ghost" onClick={() => setForm({ ...form, filters: form.filters.filter((_, j) => j !== i) })}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
            <Button size="sm" variant="outline" className="mt-2" onClick={() => setForm({ ...form, filters: [...form.filters, { column: currentSourceCols[0]?.key || "", operator: "eq", value: "" }] })}>
              + Filtr
            </Button>
          </div>

          <div className="flex gap-2">
            <Button onClick={saveTemplate} disabled={!form.name || form.columns.length === 0}><FileText className="h-4 w-4 mr-2" /> Uložit šablonu</Button>
            <Button variant="outline" onClick={() => generateReport()} disabled={generating || form.columns.length === 0}>
              <Play className="h-4 w-4 mr-2" /> {generating ? "Generuji..." : "Náhled"}
            </Button>
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Zrušit</Button>
          </div>
        </div>
      )}

      {/* Saved templates */}
      {!loading && templates.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Uložené šablony</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map(t => (
              <div key={t.uuid} className="border rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">{t.name}</h3>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => generateReport(t.uuid)} title="Generovat"><Play className="h-3 w-3" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => exportCsv(t.uuid)} title="CSV export"><Download className="h-3 w-3" /></Button>
                    <Button size="sm" variant="ghost" className="text-red-500" onClick={() => deleteTemplate(t.uuid)}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {sources[t.data_source]?.label || t.data_source} · {JSON.parse(t.columns || "[]").length} sloupců
                </p>
                {t.last_generated_at && <p className="text-xs text-muted-foreground">Poslední: {new Date(t.last_generated_at).toLocaleString("cs-CZ")}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Report result table */}
      {reportResult && (
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-muted/50 px-4 py-2 flex items-center justify-between">
            <span className="text-sm font-medium"><Table className="h-4 w-4 inline mr-2" />{reportResult.row_count} řádků</span>
            <Button size="sm" variant="ghost" onClick={() => setReportResult(null)}>Zavřít</Button>
          </div>
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 sticky top-0">
                <tr>
                  {reportResult.columns.map(c => <th key={c.key} className="text-left px-3 py-2 font-medium">{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {reportResult.data.map((row, i) => (
                  <tr key={i} className="border-t hover:bg-muted/20">
                    {reportResult.columns.map(c => (
                      <td key={c.key} className="px-3 py-2">{formatValue(row[c.key], c.type)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loading && <div className="text-center py-8 text-muted-foreground">Načítání...</div>}
    </div>
  );
}
