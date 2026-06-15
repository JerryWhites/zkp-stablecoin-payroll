// ====================================
// 🔑 API Keys Management Page
// ====================================

import { useState, useEffect, useCallback } from "react";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Key, Plus, Trash2, Copy, Eye, EyeOff, RefreshCw } from "lucide-react";

interface ApiKey {
  uuid: string;
  name: string;
  key_prefix: string;
  permissions: string[];
  rate_limit_per_hour: number;
  is_active: number;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export default function ApiKeys() {
  const { toast } = useToast();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyVisible, setNewKeyVisible] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", expires_in_days: 90, permissions: ["read"] });

  const fetchKeys = useCallback(async () => {
    try {
      const res = await apiClient.authenticatedFetch("/api-keys");
      if (res.ok) {
        const data = await res.json();
        setKeys(data.keys || []);
      }
    } catch (e) {
      toast({ title: "Chyba", description: "Nepodařilo se načíst API klíče", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchKeys(); }, [fetchKeys]);

  const createKey = async () => {
    try {
      const res = await apiClient.authenticatedFetch("/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok) {
        setNewKeyVisible(data.key.api_key);
        toast({ title: "API klíč vytvořen", description: "Uložte si ho — nebude znovu zobrazen." });
        fetchKeys();
        setShowCreate(false);
      } else {
        toast({ title: "Chyba", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba", description: "Nepodařilo se vytvořit klíč", variant: "destructive" });
    }
  };

  const revokeKey = async (uuid: string) => {
    if (!confirm("Opravdu zrušit tento API klíč?")) return;
    try {
      const res = await apiClient.authenticatedFetch(`/api-keys/${uuid}`, { method: "DELETE" });
      if (res.ok) {
        toast({ title: "Klíč zrušen" });
        fetchKeys();
      }
    } catch {
      toast({ title: "Chyba", variant: "destructive" });
    }
  };

  const copyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    toast({ title: "Zkopírováno" });
  };

  const PERMISSIONS = ["read", "write", "payroll", "employees", "reports", "exports"];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Key className="h-6 w-6" /> API Klíče</h1>
          <p className="text-muted-foreground mt-1">Správa API klíčů pro přístup třetích stran</p>
        </div>
        <Button onClick={() => setShowCreate(!showCreate)}>
          <Plus className="h-4 w-4 mr-2" /> Nový klíč
        </Button>
      </div>

      {/* New key display */}
      {newKeyVisible && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-300 dark:border-green-700 rounded-lg p-4">
          <p className="font-medium text-green-800 dark:text-green-300 mb-2">⚠️ Uložte si tento klíč — nebude znovu zobrazen:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white dark:bg-gray-800 p-2 rounded text-sm font-mono break-all">{newKeyVisible}</code>
            <Button size="sm" variant="outline" onClick={() => copyKey(newKeyVisible)}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setNewKeyVisible(null)}>Zavřít</Button>
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="border rounded-lg p-4 space-y-4">
          <h3 className="font-medium">Nový API klíč</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Název</label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Např. ERP integrace" />
            </div>
            <div>
              <label className="text-sm font-medium">Platnost (dní)</label>
              <Input type="number" value={form.expires_in_days} onChange={e => setForm({ ...form, expires_in_days: parseInt(e.target.value) || 90 })} min={1} max={365} />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Oprávnění</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {PERMISSIONS.map(p => (
                <button key={p} onClick={() => {
                  const perms = form.permissions.includes(p) ? form.permissions.filter(x => x !== p) : [...form.permissions, p];
                  setForm({ ...form, permissions: perms });
                }} className={`px-3 py-1 rounded-full text-xs font-medium border transition ${form.permissions.includes(p) ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground"}`}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={createKey} disabled={!form.name}>Vytvořit</Button>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Zrušit</Button>
          </div>
        </div>
      )}

      {/* Key list */}
      {loading ? (
        <div className="text-center text-muted-foreground py-8">Načítání...</div>
      ) : keys.length === 0 ? (
        <div className="text-center text-muted-foreground py-12 border rounded-lg">
          <Key className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>Žádné API klíče</p>
        </div>
      ) : (
        <div className="space-y-3">
          {keys.map(key => (
            <div key={key.uuid} className="border rounded-lg p-4 flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{key.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${key.is_active ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-700"}`}>
                    {key.is_active ? "Aktivní" : "Zrušen"}
                  </span>
                </div>
                <div className="text-sm text-muted-foreground mt-1 space-x-3">
                  <span>Prefix: <code className="bg-muted px-1 rounded">{key.key_prefix}</code></span>
                  <span>Oprávnění: {(key.permissions || []).join(", ")}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1 space-x-3">
                  <span>Vytvořen: {new Date(key.created_at).toLocaleDateString("cs-CZ")}</span>
                  {key.last_used_at && <span>Použit: {new Date(key.last_used_at).toLocaleDateString("cs-CZ")}</span>}
                  {key.expires_at && <span>Vyprší: {new Date(key.expires_at).toLocaleDateString("cs-CZ")}</span>}
                </div>
              </div>
              {key.is_active ? (
                <Button size="sm" variant="destructive" onClick={() => revokeKey(key.uuid)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
