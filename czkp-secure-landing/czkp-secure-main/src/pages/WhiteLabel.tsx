// ====================================
// 🎨 White-label Configuration Page
// ====================================

import { useState, useEffect, useCallback } from "react";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Palette, Save, RotateCcw, Upload, Eye } from "lucide-react";

interface WhitelabelConfig {
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  logo_url: string;
  favicon_url: string;
  company_name: string;
  custom_domain: string;
  email_from_name: string;
  email_from_address: string;
  custom_css: string;
  login_background_url: string;
  support_email: string;
  support_phone: string;
}

const DEFAULT_CONFIG: WhitelabelConfig = {
  primary_color: "#1e40af",
  secondary_color: "#3b82f6",
  accent_color: "#f59e0b",
  logo_url: "",
  favicon_url: "",
  company_name: "",
  custom_domain: "",
  email_from_name: "",
  email_from_address: "",
  custom_css: "",
  login_background_url: "",
  support_email: "",
  support_phone: "",
};

export default function WhiteLabel() {
  const { toast } = useToast();
  const [config, setConfig] = useState<WhitelabelConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasExisting, setHasExisting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await apiClient.authenticatedFetch("/v2/whitelabel/config");
      if (res.ok) {
        const d = await res.json();
        if (d.config) {
          const c = d.config;
          setConfig({
            ...DEFAULT_CONFIG,
            ...Object.fromEntries(Object.entries(c).filter(([_, v]) => v != null)),
          });
          setHasExisting(true);
        }
      }
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const saveConfig = async () => {
    setSaving(true);
    try {
      const res = await apiClient.authenticatedFetch("/v2/whitelabel/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (res.ok) {
        toast({ title: "Konfigurace uložena" });
        setHasExisting(true);
      } else {
        const d = await res.json();
        toast({ title: "Chyba", description: d.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const resetConfig = async () => {
    if (!confirm("Smazat veškerou white-label konfiguraci?")) return;
    try {
      await apiClient.authenticatedFetch("/v2/whitelabel/config", { method: "DELETE" });
      setConfig(DEFAULT_CONFIG);
      setHasExisting(false);
      toast({ title: "Konfigurace resetována" });
    } catch {}
  };

  const updateField = (field: keyof WhitelabelConfig, value: string) => {
    setConfig(prev => ({ ...prev, [field]: value }));
  };

  if (loading) return <div className="p-6 text-center text-muted-foreground">Načítání...</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Palette className="h-6 w-6" /> White-label</h1>
          <p className="text-muted-foreground mt-1">Vlastní branding a vzhled aplikace</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowPreview(!showPreview)}>
            <Eye className="h-4 w-4 mr-2" /> Náhled
          </Button>
          {hasExisting && (
            <Button variant="outline" onClick={resetConfig} className="text-red-500">
              <RotateCcw className="h-4 w-4 mr-2" /> Reset
            </Button>
          )}
          <Button onClick={saveConfig} disabled={saving}>
            <Save className="h-4 w-4 mr-2" /> {saving ? "Ukládám..." : "Uložit"}
          </Button>
        </div>
      </div>

      {/* Live Preview */}
      {showPreview && (
        <div className="border-2 border-dashed rounded-lg p-6 space-y-4" style={{ borderColor: config.primary_color }}>
          <div className="flex items-center gap-3 p-4 rounded-lg" style={{ backgroundColor: config.primary_color }}>
            {config.logo_url ? (
              <img src={config.logo_url} alt="Logo" className="h-8" />
            ) : (
              <div className="h-8 w-8 bg-white/30 rounded" />
            )}
            <span className="text-white font-bold text-lg">{config.company_name || "Vaše firma"}</span>
          </div>
          <div className="flex gap-3">
            <button className="px-4 py-2 rounded text-white font-medium" style={{ backgroundColor: config.primary_color }}>Primary</button>
            <button className="px-4 py-2 rounded text-white font-medium" style={{ backgroundColor: config.secondary_color }}>Secondary</button>
            <button className="px-4 py-2 rounded text-white font-medium" style={{ backgroundColor: config.accent_color }}>Accent</button>
          </div>
          <p className="text-sm text-muted-foreground">Náhled vašeho brandingu</p>
        </div>
      )}

      {/* Colors Section */}
      <div className="border rounded-lg p-4 space-y-4">
        <h2 className="font-semibold">Barvy</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { key: "primary_color" as const, label: "Primární barva" },
            { key: "secondary_color" as const, label: "Sekundární barva" },
            { key: "accent_color" as const, label: "Akcentová barva" },
          ].map(({ key, label }) => (
            <div key={key}>
              <label className="text-sm font-medium">{label}</label>
              <div className="flex gap-2 mt-1">
                <input type="color" value={config[key]} onChange={e => updateField(key, e.target.value)} className="w-10 h-10 rounded cursor-pointer border" />
                <Input value={config[key]} onChange={e => updateField(key, e.target.value)} placeholder="#1e40af" className="flex-1" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Identity Section */}
      <div className="border rounded-lg p-4 space-y-4">
        <h2 className="font-semibold">Identita</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">Název firmy</label>
            <Input value={config.company_name} onChange={e => updateField("company_name", e.target.value)} placeholder="Vaše Firma s.r.o." />
          </div>
          <div>
            <label className="text-sm font-medium">Vlastní doména</label>
            <Input value={config.custom_domain} onChange={e => updateField("custom_domain", e.target.value)} placeholder="payroll.vasefirma.cz" />
          </div>
          <div>
            <label className="text-sm font-medium">URL loga</label>
            <div className="flex gap-2">
              <Input value={config.logo_url} onChange={e => updateField("logo_url", e.target.value)} placeholder="https://..." className="flex-1" />
              <Button variant="outline" size="sm"><Upload className="h-4 w-4" /></Button>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">URL favicony</label>
            <Input value={config.favicon_url} onChange={e => updateField("favicon_url", e.target.value)} placeholder="https://..." />
          </div>
          <div>
            <label className="text-sm font-medium">URL pozadí přihlášení</label>
            <Input value={config.login_background_url} onChange={e => updateField("login_background_url", e.target.value)} placeholder="https://..." />
          </div>
        </div>
      </div>

      {/* Email Section */}
      <div className="border rounded-lg p-4 space-y-4">
        <h2 className="font-semibold">E-maily</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">Jméno odesílatele</label>
            <Input value={config.email_from_name} onChange={e => updateField("email_from_name", e.target.value)} placeholder="CZ Payroll" />
          </div>
          <div>
            <label className="text-sm font-medium">E-mail odesílatele</label>
            <Input value={config.email_from_address} onChange={e => updateField("email_from_address", e.target.value)} placeholder="noreply@vasefirma.cz" />
          </div>
        </div>
      </div>

      {/* Support Section */}
      <div className="border rounded-lg p-4 space-y-4">
        <h2 className="font-semibold">Podpora</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">E-mail podpory</label>
            <Input value={config.support_email} onChange={e => updateField("support_email", e.target.value)} placeholder="podpora@vasefirma.cz" />
          </div>
          <div>
            <label className="text-sm font-medium">Telefon podpory</label>
            <Input value={config.support_phone} onChange={e => updateField("support_phone", e.target.value)} placeholder="+420 123 456 789" />
          </div>
        </div>
      </div>

      {/* Custom CSS */}
      <div className="border rounded-lg p-4 space-y-4">
        <h2 className="font-semibold">Vlastní CSS</h2>
        <textarea
          className="w-full h-32 border rounded-md px-3 py-2 text-sm font-mono"
          value={config.custom_css}
          onChange={e => updateField("custom_css", e.target.value)}
          placeholder={`:root {\n  --primary: ${config.primary_color};\n  --secondary: ${config.secondary_color};\n}`}
        />
      </div>
    </div>
  );
}
