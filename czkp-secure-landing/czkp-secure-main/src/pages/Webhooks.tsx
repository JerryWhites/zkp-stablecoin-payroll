// ====================================
// 🔗 Webhooks & Integrations Page
// ====================================

import { useState, useEffect, useCallback } from "react";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Webhook, Plus, Trash2, Send, CheckCircle, XCircle, Clock, Eye, EyeOff, ToggleLeft, ToggleRight } from "lucide-react";

const EVENT_TYPES = [
  { value: "payroll.created", label: "Výplata vytvořena" },
  { value: "payroll.approved", label: "Výplata schválena" },
  { value: "payroll.completed", label: "Výplata dokončena" },
  { value: "payroll.rejected", label: "Výplata zamítnuta" },
  { value: "employee.created", label: "Zaměstnanec přidán" },
  { value: "employee.updated", label: "Zaměstnanec upraven" },
  { value: "employee.terminated", label: "Zaměstnanec ukončen" },
  { value: "approval.requested", label: "Schválení vyžádáno" },
  { value: "approval.completed", label: "Schválení dokončeno" },
  { value: "export.completed", label: "Export dokončen" },
  { value: "credits.low", label: "Málo kreditů" },
  { value: "credits.depleted", label: "Kredity vyčerpány" },
  { value: "schedule.executed", label: "Plán spuštěn" },
  { value: "schedule.failed", label: "Plán selhal" },
];

interface WebhookItem {
  uuid: string;
  url: string;
  events: string;
  secret: string;
  is_active: boolean;
  description: string | null;
  last_triggered_at: string | null;
  created_at: string;
}

interface Delivery {
  uuid: string;
  event_type: string;
  status_code: number | null;
  success: boolean;
  attempts: number;
  created_at: string;
}

export default function Webhooks() {
  const { toast } = useToast();
  const [webhooks, setWebhooks] = useState<WebhookItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [deliveries, setDeliveries] = useState<Record<string, Delivery[]>>({});
  const [showDeliveries, setShowDeliveries] = useState<string | null>(null);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  const [form, setForm] = useState({ url: "", events: [] as string[], description: "" });

  const fetchWebhooks = useCallback(async () => {
    try {
      const res = await apiClient.authenticatedFetch("/v2/webhooks");
      if (res.ok) {
        const d = await res.json();
        setWebhooks(d.webhooks || []);
      }
    } catch {
      toast({ title: "Chyba načítání", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchWebhooks(); }, [fetchWebhooks]);

  const createWebhook = async () => {
    if (!form.url || form.events.length === 0) {
      toast({ title: "Zadejte URL a vyberte eventy", variant: "destructive" });
      return;
    }
    try {
      const res = await apiClient.authenticatedFetch("/v2/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        toast({ title: "Webhook vytvořen" });
        fetchWebhooks();
        setShowCreate(false);
        setForm({ url: "", events: [], description: "" });
      } else {
        const d = await res.json();
        toast({ title: "Chyba", description: d.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba", variant: "destructive" });
    }
  };

  const toggleWebhook = async (uuid: string, active: boolean) => {
    await apiClient.authenticatedFetch(`/v2/webhooks/${uuid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !active }),
    });
    fetchWebhooks();
  };

  const testWebhook = async (uuid: string) => {
    try {
      const res = await apiClient.authenticatedFetch(`/v2/webhooks/${uuid}/test`, { method: "POST" });
      if (res.ok) {
        const d = await res.json();
        toast({ title: d.delivery.success ? "Test úspěšný" : "Test selhal", description: `Status: ${d.delivery.status_code || "timeout"}` });
      }
    } catch {
      toast({ title: "Chyba testu", variant: "destructive" });
    }
  };

  const deleteWebhook = async (uuid: string) => {
    if (!confirm("Smazat webhook?")) return;
    await apiClient.authenticatedFetch(`/v2/webhooks/${uuid}`, { method: "DELETE" });
    fetchWebhooks();
  };

  const loadDeliveries = async (uuid: string) => {
    if (showDeliveries === uuid) { setShowDeliveries(null); return; }
    try {
      const res = await apiClient.authenticatedFetch(`/v2/webhooks/${uuid}/deliveries`);
      if (res.ok) {
        const d = await res.json();
        setDeliveries(prev => ({ ...prev, [uuid]: d.deliveries || [] }));
        setShowDeliveries(uuid);
      }
    } catch {}
  };

  const toggleEvent = (event: string) => {
    setForm(prev => ({
      ...prev,
      events: prev.events.includes(event) ? prev.events.filter(e => e !== event) : [...prev.events, event],
    }));
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Webhook className="h-6 w-6" /> Webhooks</h1>
          <p className="text-muted-foreground mt-1">Real-time notifikace do vašich systémů</p>
        </div>
        <Button onClick={() => setShowCreate(!showCreate)}><Plus className="h-4 w-4 mr-2" /> Nový webhook</Button>
      </div>

      {showCreate && (
        <div className="border rounded-lg p-4 space-y-4">
          <h3 className="font-medium">Nový webhook</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">URL endpointu</label>
              <Input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="https://api.example.com/webhook" />
            </div>
            <div>
              <label className="text-sm font-medium">Popis (volitelný)</label>
              <Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Integrace s účetním SW" />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Události</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {EVENT_TYPES.map(e => (
                <button key={e.value} onClick={() => toggleEvent(e.value)} className={`px-3 py-1 rounded-full text-xs font-medium border transition ${form.events.includes(e.value) ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground"}`}>
                  {e.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={createWebhook} disabled={!form.url || form.events.length === 0}>Vytvořit</Button>
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Zrušit</Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-8 text-muted-foreground">Načítání...</div>
      ) : webhooks.length === 0 ? (
        <div className="text-center py-12 border rounded-lg">
          <Webhook className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="font-medium mb-1">Žádné webhooky</h3>
          <p className="text-sm text-muted-foreground">Vytvořte webhook pro real-time integraci</p>
        </div>
      ) : (
        <div className="space-y-4">
          {webhooks.map(w => {
            const events = JSON.parse(w.events || "[]") as string[];
            return (
              <div key={w.uuid} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`inline-block w-2 h-2 rounded-full ${w.is_active ? "bg-green-500" : "bg-gray-400"}`} />
                      <code className="text-sm font-medium">{w.url}</code>
                    </div>
                    {w.description && <p className="text-sm text-muted-foreground mt-1">{w.description}</p>}
                    <div className="flex flex-wrap gap-1 mt-2">
                      {events.map(e => <span key={e} className="text-xs bg-muted px-2 py-0.5 rounded">{e}</span>)}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => toggleWebhook(w.uuid, w.is_active)} title={w.is_active ? "Deaktivovat" : "Aktivovat"}>
                      {w.is_active ? <ToggleRight className="h-4 w-4 text-green-500" /> : <ToggleLeft className="h-4 w-4" />}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => testWebhook(w.uuid)} title="Test"><Send className="h-3 w-3" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowSecrets(p => ({ ...p, [w.uuid]: !p[w.uuid] }))} title="Secret">
                      {showSecrets[w.uuid] ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => loadDeliveries(w.uuid)} title="Deliveries"><Clock className="h-3 w-3" /></Button>
                    <Button size="sm" variant="ghost" className="text-red-500" onClick={() => deleteWebhook(w.uuid)}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                </div>

                {showSecrets[w.uuid] && (
                  <div className="bg-muted/50 rounded px-3 py-2">
                    <span className="text-xs text-muted-foreground">Secret: </span>
                    <code className="text-xs">{w.secret}</code>
                  </div>
                )}

                {showDeliveries === w.uuid && (deliveries[w.uuid] || []).length > 0 && (
                  <div className="border-t pt-3">
                    <h4 className="text-sm font-medium mb-2">Poslední doručení</h4>
                    <div className="space-y-1">
                      {deliveries[w.uuid].map(d => (
                        <div key={d.uuid} className="flex items-center justify-between text-xs py-1 border-b last:border-0">
                          <div className="flex items-center gap-2">
                            {d.success ? <CheckCircle className="h-3 w-3 text-green-500" /> : <XCircle className="h-3 w-3 text-red-500" />}
                            <span>{d.event_type}</span>
                          </div>
                          <div className="flex items-center gap-3 text-muted-foreground">
                            <span>HTTP {d.status_code || "—"}</span>
                            <span>{d.attempts}x</span>
                            <span>{new Date(d.created_at).toLocaleString("cs-CZ")}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="text-xs text-muted-foreground">
                  Vytvořeno {new Date(w.created_at).toLocaleDateString("cs-CZ")}
                  {w.last_triggered_at && ` · Naposledy ${new Date(w.last_triggered_at).toLocaleString("cs-CZ")}`}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
