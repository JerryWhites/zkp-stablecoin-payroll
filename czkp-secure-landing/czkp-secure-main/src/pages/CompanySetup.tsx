// ====================================
// 🏢 Company Setup Page
// ====================================

import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiClient } from "@/lib/api-client";
import { Building2, Save, Loader2, User, Briefcase, CheckCircle2 } from "lucide-react";
import type { CZCompany, EntityType } from "@/lib/cz-payroll-types";
import { ENTITY_TYPE_LABELS, OBOR_CINNOSTI_OPTIONS } from "@/lib/cz-payroll-types";

export default function CompanySetup() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Read entity_type from URL params (set during signup), default to 'sro'
  const initialEntityType = (searchParams.get("entity_type") as EntityType) || "sro";

  const [form, setForm] = useState<CZCompany>({
    name: "",
    ico: "",
    dic: "",
    sidlo_ulice: "",
    sidlo_mesto: "",
    sidlo_psc: "",
    bank_account_salary: "",
    bank_account_tax: "",
    bank_account_social: "",
    bank_account_health: "",
    fu_code: "",
    ossz_code: "",
    default_zp_code: "111",
    entity_type: initialEntityType,
    hlavni_cinnost: 1,
    pausal_dan: 0,
    vydajovy_pausal_pct: 60,
    obor_cinnosti: "volna",
  });

  const isOSVC = form.entity_type === "osvc";

  useEffect(() => {
    loadCompany();
  }, []);

  async function loadCompany() {
    try {
      const res = await apiClient.authenticatedFetch("/companies/current");
      if (res.ok) {
        const data = await res.json();
        if (data.company) {
          setForm(prev => ({ ...prev, ...data.company }));
        }
      }
    } catch {
      // No company yet, that's fine
    } finally {
      setLoading(false);
    }
  }

  function updateField(field: keyof CZCompany, value: string | number) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    // Build clean payload — only send fields the backend expects,
    // strip empty strings so express-validator .optional() works correctly
    const allowedFields: (keyof CZCompany)[] = [
      'name', 'ico', 'dic', 'sidlo_ulice', 'sidlo_mesto', 'sidlo_psc',
      'bank_account_salary', 'bank_account_tax', 'bank_account_social', 'bank_account_health',
      'fu_code', 'ossz_code', 'default_zp_code', 'entity_type',
      'hlavni_cinnost', 'pausal_dan', 'vydajovy_pausal_pct',
      'obor_cinnosti', 'zivnostensky_list', 'pravni_forma_detail',
      'zakladni_kapital_czk', 'statutarni_organ', 'datum_zalozeni',
    ];
    const payload: Record<string, unknown> = {};
    for (const field of allowedFields) {
      const value = form[field];
      // Keep numeric 0, but omit empty strings, null, undefined
      if (value !== undefined && value !== null && value !== '') {
        payload[field] = value;
      }
    }

    try {
      const res = await apiClient.authenticatedFetch("/companies/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        toast({
          title: "Chyba",
          description: data.error || "Nepodařilo se uložit firmu",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Uloženo",
        description: "Nastavení firmy bylo uloženo",
      });

      if (!form.setup_completed) {
        if (isOSVC) {
          navigate("/cz/osvc");
        } else {
          navigate("/cz/employees");
        }
      }
    } catch {
      toast({
        title: "Chyba",
        description: "Nepodařilo se připojit k serveru",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Entity type is locked: either from signup URL param, or from existing company data.
  // Users cannot change entity type after selecting it at signup.
  const entityTypeLocked = !!searchParams.get("entity_type") || !!form.setup_completed;

  return (
    <div className="max-w-3xl mx-auto space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Building2 className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Nastavení firmy</h1>
          <p className="text-muted-foreground">Základní údaje o vaší společnosti</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Welcome banner for first-time setup */}
        {!form.setup_completed && (
          <Card className="border-accent/30 bg-accent/5">
            <CardContent className="flex items-start gap-4 py-5">
              <CheckCircle2 className="h-6 w-6 text-accent mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium text-foreground">Účet úspěšně vytvořen!</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Vyplňte základní údaje o {isOSVC ? "vašem podnikání" : "vaší společnosti"} a můžete začít.
                  Povinná pole jsou označena hvězdičkou.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Entity Type — locked display, chosen at signup */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Briefcase className="h-5 w-5" />
              Typ subjektu
            </CardTitle>
            <CardDescription>
              {entityTypeLocked
                ? "Právní forma byla zvolena při registraci"
                : "Vyberte právní formu podnikání"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {(Object.keys(ENTITY_TYPE_LABELS) as EntityType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  disabled={entityTypeLocked}
                  onClick={() => !entityTypeLocked && updateField("entity_type", type)}
                  className={`p-3 rounded-lg border-2 text-center transition-all ${
                    form.entity_type === type
                      ? "border-primary bg-primary/10 text-primary font-semibold"
                      : entityTypeLocked
                        ? "border-border opacity-40 cursor-not-allowed"
                        : "border-border hover:border-primary/50"
                  }`}
                >
                  {type === "osvc" ? <User className="h-5 w-5 mx-auto mb-1" /> : <Building2 className="h-5 w-5 mx-auto mb-1" />}
                  <div className="text-sm">{ENTITY_TYPE_LABELS[type]}</div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Basic Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Základní údaje</CardTitle>
            <CardDescription>
              {isOSVC ? "Vaše jméno a IČO" : "Obchodní název a identifikační čísla"}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Label htmlFor="name">{isOSVC ? "Jméno a příjmení *" : "Název společnosti *"}</Label>
              <Input
                id="name"
                value={form.name}
                onChange={e => updateField("name", e.target.value)}
                required
                placeholder={isOSVC ? "Jan Novák" : "Moje firma s.r.o."}
              />
            </div>
            <div>
              <Label htmlFor="ico">IČO *</Label>
              <Input id="ico" value={form.ico} onChange={e => updateField("ico", e.target.value)} required placeholder="12345678" maxLength={8} />
              <p className="text-xs text-muted-foreground mt-1">8 číslic bez mezer</p>
            </div>
            <div>
              <Label htmlFor="dic">DIČ</Label>
              <Input id="dic" value={form.dic || ""} onChange={e => updateField("dic", e.target.value)} placeholder="CZ12345678" />
              <p className="text-xs text-muted-foreground mt-1">CZ + 8–10 číslic</p>
            </div>
          </CardContent>
        </Card>

        {/* OSVČ-specific fields */}
        {isOSVC && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <User className="h-5 w-5" />
                Nastavení OSVČ
              </CardTitle>
              <CardDescription>Specifická nastavení pro osobu samostatně výdělečně činnou</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Hlavní činnost</Label>
                  <p className="text-sm text-muted-foreground">Je OSVČ vaší hlavní výdělečnou činností?</p>
                </div>
                <Switch
                  checked={form.hlavni_cinnost === 1}
                  onCheckedChange={(checked) => updateField("hlavni_cinnost", checked ? 1 : 0)}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Paušální daň</Label>
                  <p className="text-sm text-muted-foreground">Využíváte režim paušální daně?</p>
                </div>
                <Switch
                  checked={form.pausal_dan === 1}
                  onCheckedChange={(checked) => updateField("pausal_dan", checked ? 1 : 0)}
                />
              </div>

              {!form.pausal_dan && (
                <>
                  <div>
                    <Label htmlFor="obor_cinnosti">Obor činnosti (pro výdajový paušál)</Label>
                    <Select
                      value={form.obor_cinnosti || "volna"}
                      onValueChange={(v) => updateField("obor_cinnosti", v)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {OBOR_CINNOSTI_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}

              <div>
                <Label htmlFor="zivnostensky_list">Číslo živnostenského listu</Label>
                <Input
                  id="zivnostensky_list"
                  value={form.zivnostensky_list || ""}
                  onChange={e => updateField("zivnostensky_list", e.target.value)}
                  placeholder="ŽL-12345678"
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Legal entity specific fields */}
        {!isOSVC && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Údaje právnické osoby</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="statutarni_organ">Statutární orgán</Label>
                <Input
                  id="statutarni_organ"
                  value={form.statutarni_organ || ""}
                  onChange={e => updateField("statutarni_organ", e.target.value)}
                  placeholder="Jednatel / Představenstvo"
                />
              </div>
              <div>
                <Label htmlFor="zakladni_kapital_czk">Základní kapitál (Kč)</Label>
                <Input
                  id="zakladni_kapital_czk"
                  type="number"
                  value={form.zakladni_kapital_czk || ""}
                  onChange={e => updateField("zakladni_kapital_czk", parseInt(e.target.value) || 0)}
                  placeholder="200000"
                />
              </div>
              <div>
                <Label htmlFor="datum_zalozeni">Datum založení</Label>
                <Input
                  id="datum_zalozeni"
                  type="date"
                  value={form.datum_zalozeni || ""}
                  onChange={e => updateField("datum_zalozeni", e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="pravni_forma_detail">Detailní právní forma</Label>
                <Input
                  id="pravni_forma_detail"
                  value={form.pravni_forma_detail || ""}
                  onChange={e => updateField("pravni_forma_detail", e.target.value)}
                  placeholder="Společnost s ručením omezeným"
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Address */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{isOSVC ? "Místo podnikání" : "Sídlo"}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-3">
              <Label htmlFor="sidlo_ulice">Ulice a číslo</Label>
              <Input id="sidlo_ulice" value={form.sidlo_ulice || ""} onChange={e => updateField("sidlo_ulice", e.target.value)} placeholder="Příkladná 123" />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="sidlo_mesto">Město</Label>
              <Input id="sidlo_mesto" value={form.sidlo_mesto || ""} onChange={e => updateField("sidlo_mesto", e.target.value)} placeholder="Praha" />
            </div>
            <div>
              <Label htmlFor="sidlo_psc">PSČ</Label>
              <Input id="sidlo_psc" value={form.sidlo_psc || ""} onChange={e => updateField("sidlo_psc", e.target.value)} placeholder="110 00" maxLength={6} />
              <p className="text-xs text-muted-foreground mt-1">5 číslic, např. 110 00</p>
            </div>
          </CardContent>
        </Card>

        {/* Bank Accounts */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Bankovní účty</CardTitle>
            <CardDescription>Účty pro výplaty a odvody (šifrovány v databázi)</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="bank_salary">{isOSVC ? "Hlavní účet *" : "Účet pro mzdy *"}</Label>
              <Input id="bank_salary" value={form.bank_account_salary || ""} onChange={e => updateField("bank_account_salary", e.target.value)} placeholder="19-1234567890/0800" />
            </div>
            <div>
              <Label htmlFor="bank_tax">Účet pro daně (FÚ)</Label>
              <Input id="bank_tax" value={form.bank_account_tax || ""} onChange={e => updateField("bank_account_tax", e.target.value)} placeholder="19-1234567890/0800" />
            </div>
            <div>
              <Label htmlFor="bank_social">Účet pro SP (OSSZ)</Label>
              <Input id="bank_social" value={form.bank_account_social || ""} onChange={e => updateField("bank_account_social", e.target.value)} placeholder="19-1234567890/0800" />
            </div>
            <div>
              <Label htmlFor="bank_health">Účet pro ZP</Label>
              <Input id="bank_health" value={form.bank_account_health || ""} onChange={e => updateField("bank_account_health", e.target.value)} placeholder="19-1234567890/0800" />
            </div>
            <p className="text-xs text-muted-foreground md:col-span-2">
              Formát: předčíslí-číslo/kód banky (předčíslí volitelné), např. 19-1234567890/0800
            </p>
          </CardContent>
        </Card>

        {/* Institutional codes */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Kódy institucí</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="fu_code">Kód FÚ</Label>
              <Input id="fu_code" value={form.fu_code || ""} onChange={e => updateField("fu_code", e.target.value)} placeholder="451" />
            </div>
            <div>
              <Label htmlFor="ossz_code">Kód OSSZ</Label>
              <Input id="ossz_code" value={form.ossz_code || ""} onChange={e => updateField("ossz_code", e.target.value)} placeholder="PAHA" />
            </div>
            <div>
              <Label htmlFor="default_zp_code">{isOSVC ? "Zdravotní pojišťovna" : "Výchozí ZP"}</Label>
              <Input id="default_zp_code" value={form.default_zp_code || "111"} onChange={e => updateField("default_zp_code", e.target.value)} placeholder="111" />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button type="submit" disabled={saving} className="min-w-[160px]">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            {form.setup_completed ? "Uložit změny" : "Uložit a pokračovat"}
          </Button>
        </div>
      </form>
    </div>
  );
}
