// ====================================
// 💰 Commission Management Page
// ====================================

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/lib/api-client";
import {
  Coins, Plus, TrendingUp, CheckCircle, RefreshCw,
  Calculator, Clock,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const SCHEME_TYPES = [
  { value: "flat_rate", label: "Fixní sazba (%)" },
  { value: "tiered", label: "Stupňovitá" },
  { value: "threshold", label: "Prahová" },
  { value: "flat_per_unit", label: "Fixní za kus" },
  { value: "mixed", label: "Kombinovaná" },
];

interface CommissionScheme {
  id: number;
  uuid: string;
  name: string;
  description: string | null;
  type: string;
  base_rate_pct: number | null;
  base_amount_czk: number | null;
  tiers: any[];
  cap_monthly_czk: number | null;
  cap_annual_czk: number | null;
  is_active: boolean;
}

interface Commission {
  id: number;
  uuid: string;
  employee_name: string;
  employee_uuid: string;
  scheme_name: string;
  scheme_type: string;
  period_year: number;
  period_month: number;
  revenue_czk: number;
  units_sold: number;
  calculated_commission_czk: number;
  adjustment_czk: number;
  final_commission_czk: number;
  status: string;
}

export default function Commissions() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"schemes" | "commissions">("schemes");
  const [schemes, setSchemes] = useState<CommissionScheme[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [loading, setLoading] = useState(true);
  const [schemeDialogOpen, setSchemeDialogOpen] = useState(false);
  const [commDialogOpen, setCommDialogOpen] = useState(false);

  const now = new Date();
  const [filterYear, setFilterYear] = useState(now.getFullYear());
  const [filterMonth, setFilterMonth] = useState(now.getMonth() + 1);

  // Form states
  const [schemeForm, setSchemeForm] = useState({
    name: "", description: "", type: "flat_rate",
    base_rate_pct: "", base_amount_czk: "",
    cap_monthly_czk: "", cap_annual_czk: "",
  });
  const [commForm, setCommForm] = useState({
    employee_uuid: "", scheme_uuid: "",
    period_year: String(now.getFullYear()),
    period_month: String(now.getMonth() + 1),
    revenue_czk: "", units_sold: "", notes: "",
  });

  const fetchSchemes = useCallback(async () => {
    try {
      const res = await apiClient.authenticatedFetch("/v2/commissions/schemes");
      if (res.ok) {
        const data = await res.json();
        setSchemes(data.schemes || []);
      }
    } catch (error) {
      console.error("Failed to fetch schemes:", error);
    }
  }, []);

  const fetchCommissions = useCallback(async () => {
    try {
      const res = await apiClient.authenticatedFetch(`/v2/commissions?year=${filterYear}&month=${filterMonth}`);
      if (res.ok) {
        const data = await res.json();
        setCommissions(data.commissions || []);
      }
    } catch (error) {
      console.error("Failed to fetch commissions:", error);
    }
  }, [filterYear, filterMonth]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchSchemes(), fetchCommissions()]).finally(() => setLoading(false));
  }, [fetchSchemes, fetchCommissions]);

  const createScheme = async () => {
    try {
      const payload: any = { name: schemeForm.name, type: schemeForm.type };
      if (schemeForm.description) payload.description = schemeForm.description;
      if (schemeForm.base_rate_pct) payload.base_rate_pct = parseFloat(schemeForm.base_rate_pct);
      if (schemeForm.base_amount_czk) payload.base_amount_czk = parseInt(schemeForm.base_amount_czk);
      if (schemeForm.cap_monthly_czk) payload.cap_monthly_czk = parseInt(schemeForm.cap_monthly_czk);
      if (schemeForm.cap_annual_czk) payload.cap_annual_czk = parseInt(schemeForm.cap_annual_czk);

      const res = await apiClient.authenticatedFetch("/v2/commissions/schemes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        toast({ title: "Provizní schéma vytvořeno" });
        setSchemeDialogOpen(false);
        setSchemeForm({ name: "", description: "", type: "flat_rate", base_rate_pct: "", base_amount_czk: "", cap_monthly_czk: "", cap_annual_czk: "" });
        fetchSchemes();
      } else {
        const err = await res.json();
        toast({ title: "Chyba", description: err.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba při vytváření schématu", variant: "destructive" });
    }
  };

  const createCommission = async () => {
    try {
      const payload: any = {
        employee_uuid: commForm.employee_uuid,
        scheme_uuid: commForm.scheme_uuid,
        period_year: parseInt(commForm.period_year),
        period_month: parseInt(commForm.period_month),
      };
      if (commForm.revenue_czk) payload.revenue_czk = parseInt(commForm.revenue_czk);
      if (commForm.units_sold) payload.units_sold = parseInt(commForm.units_sold);
      if (commForm.notes) payload.notes = commForm.notes;

      const res = await apiClient.authenticatedFetch("/v2/commissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        toast({ title: "Provize vypočtena" });
        setCommDialogOpen(false);
        setCommForm({ employee_uuid: "", scheme_uuid: "", period_year: String(now.getFullYear()), period_month: String(now.getMonth() + 1), revenue_czk: "", units_sold: "", notes: "" });
        fetchCommissions();
      } else {
        const err = await res.json();
        toast({ title: "Chyba", description: err.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba při výpočtu provize", variant: "destructive" });
    }
  };

  const approveCommission = async (uuid: string) => {
    try {
      const res = await apiClient.authenticatedFetch(`/v2/commissions/${uuid}/approve`, {
        method: "POST",
      });
      if (res.ok) {
        toast({ title: "Provize schválena" });
        fetchCommissions();
      } else {
        const err = await res.json();
        toast({ title: "Chyba", description: err.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba při schvalování", variant: "destructive" });
    }
  };

  const getTypeLabel = (type: string) => SCHEME_TYPES.find(t => t.value === type)?.label || type;

  const statusBadge = (status: string) => {
    const map: Record<string, "default" | "outline" | "secondary" | "destructive"> = {
      draft: "outline", calculated: "secondary", approved: "default", paid: "default",
    };
    const labels: Record<string, string> = {
      draft: "Koncept", calculated: "Vypočteno", approved: "Schváleno", paid: "Vyplaceno",
    };
    return <Badge variant={map[status] || "secondary"}>{labels[status] || status}</Badge>;
  };

  const monthName = (m: number) => ["", "Leden", "Únor", "Březen", "Duben", "Květen", "Červen", "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec"][m] || "";

  const totalCommissions = commissions.reduce((sum, c) => sum + (c.final_commission_czk || 0), 0);

  const tabs = [
    { id: "schemes" as const, label: "Schémata", icon: TrendingUp },
    { id: "commissions" as const, label: "Provize", icon: Coins },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Provize</h1>
          <p className="text-muted-foreground">Provizní schémata a výpočet provizí zaměstnanců</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { fetchSchemes(); fetchCommissions(); }}>
          <RefreshCw className="h-4 w-4 mr-1" /> Obnovit
        </Button>
      </div>

      <div className="flex gap-1 border-b pb-1">
        {tabs.map(tab => (
          <Button key={tab.id} variant={activeTab === tab.id ? "default" : "ghost"} size="sm" onClick={() => setActiveTab(tab.id)}>
            <tab.icon className="h-4 w-4 mr-1" /> {tab.label}
          </Button>
        ))}
      </div>

      {/* Schemes Tab */}
      {activeTab === "schemes" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Dialog open={schemeDialogOpen} onOpenChange={setSchemeDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nové schéma</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Vytvořit provizní schéma</DialogTitle></DialogHeader>
                <div className="space-y-4 mt-2">
                  <div><Label>Název</Label><Input value={schemeForm.name} onChange={e => setSchemeForm(p => ({ ...p, name: e.target.value }))} placeholder="Název provizního schématu" /></div>
                  <div>
                    <Label>Typ</Label>
                    <Select value={schemeForm.type} onValueChange={v => setSchemeForm(p => ({ ...p, type: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SCHEME_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Základní sazba (%)</Label><Input type="number" value={schemeForm.base_rate_pct} onChange={e => setSchemeForm(p => ({ ...p, base_rate_pct: e.target.value }))} placeholder="5" /></div>
                  <div><Label>Základní částka (Kč)</Label><Input type="number" value={schemeForm.base_amount_czk} onChange={e => setSchemeForm(p => ({ ...p, base_amount_czk: e.target.value }))} placeholder="Volitelné" /></div>
                  <div><Label>Měsíční limit (Kč)</Label><Input type="number" value={schemeForm.cap_monthly_czk} onChange={e => setSchemeForm(p => ({ ...p, cap_monthly_czk: e.target.value }))} placeholder="Volitelné" /></div>
                  <div><Label>Roční limit (Kč)</Label><Input type="number" value={schemeForm.cap_annual_czk} onChange={e => setSchemeForm(p => ({ ...p, cap_annual_czk: e.target.value }))} placeholder="Volitelné" /></div>
                  <Button onClick={createScheme} disabled={!schemeForm.name} className="w-full">Vytvořit</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {loading ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Načítání...</CardContent></Card>
          ) : schemes.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <TrendingUp className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">Žádná provizní schémata</h3>
                <p className="text-muted-foreground mb-4">Vytvořte provizní schéma pro výpočet odměn.</p>
                <Button onClick={() => setSchemeDialogOpen(true)}><Plus className="h-4 w-4 mr-1" /> Nové schéma</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {schemes.map(scheme => (
                <Card key={scheme.uuid}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{scheme.name}</CardTitle>
                      <Badge variant={scheme.is_active ? "default" : "secondary"}>
                        {scheme.is_active ? "Aktivní" : "Neaktivní"}
                      </Badge>
                    </div>
                    <CardDescription>{getTypeLabel(scheme.type)}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1 text-sm">
                      {scheme.base_rate_pct != null && (
                        <div className="flex justify-between"><span className="text-muted-foreground">Sazba:</span><span className="font-medium">{scheme.base_rate_pct}%</span></div>
                      )}
                      {scheme.base_amount_czk != null && (
                        <div className="flex justify-between"><span className="text-muted-foreground">Fixní:</span><span className="font-medium">{scheme.base_amount_czk.toLocaleString("cs-CZ")} Kč</span></div>
                      )}
                      {scheme.cap_monthly_czk != null && (
                        <div className="flex justify-between"><span className="text-muted-foreground">Měs. limit:</span><span>{scheme.cap_monthly_czk.toLocaleString("cs-CZ")} Kč</span></div>
                      )}
                      {scheme.cap_annual_czk != null && (
                        <div className="flex justify-between"><span className="text-muted-foreground">Roční limit:</span><span>{scheme.cap_annual_czk.toLocaleString("cs-CZ")} Kč</span></div>
                      )}
                      {scheme.tiers && scheme.tiers.length > 0 && (
                        <div className="pt-2 border-t">
                          <span className="text-muted-foreground">Stupně: {scheme.tiers.length}</span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Commissions Tab */}
      {activeTab === "commissions" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Select value={String(filterMonth)} onValueChange={v => setFilterMonth(parseInt(v))}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 12 }, (_, i) => (
                    <SelectItem key={i + 1} value={String(i + 1)}>{monthName(i + 1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={String(filterYear)} onValueChange={v => setFilterYear(parseInt(v))}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[2023, 2024, 2025, 2026].map(y => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Dialog open={commDialogOpen} onOpenChange={setCommDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Calculator className="h-4 w-4 mr-1" /> Vypočítat provizi</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Vypočítat provizi zaměstnance</DialogTitle></DialogHeader>
                <div className="space-y-4 mt-2">
                  <div><Label>UUID zaměstnance</Label><Input value={commForm.employee_uuid} onChange={e => setCommForm(p => ({ ...p, employee_uuid: e.target.value }))} placeholder="UUID zaměstnance" /></div>
                  <div><Label>UUID provizního schématu</Label><Input value={commForm.scheme_uuid} onChange={e => setCommForm(p => ({ ...p, scheme_uuid: e.target.value }))} placeholder="UUID schématu" /></div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><Label>Rok</Label><Input type="number" value={commForm.period_year} onChange={e => setCommForm(p => ({ ...p, period_year: e.target.value }))} /></div>
                    <div><Label>Měsíc</Label><Input type="number" value={commForm.period_month} onChange={e => setCommForm(p => ({ ...p, period_month: e.target.value }))} min="1" max="12" /></div>
                  </div>
                  <div><Label>Obrat (Kč)</Label><Input type="number" value={commForm.revenue_czk} onChange={e => setCommForm(p => ({ ...p, revenue_czk: e.target.value }))} placeholder="0" /></div>
                  <div><Label>Prodané kusy</Label><Input type="number" value={commForm.units_sold} onChange={e => setCommForm(p => ({ ...p, units_sold: e.target.value }))} placeholder="0" /></div>
                  <div><Label>Poznámka</Label><Input value={commForm.notes} onChange={e => setCommForm(p => ({ ...p, notes: e.target.value }))} placeholder="Volitelné" /></div>
                  <Button onClick={createCommission} disabled={!commForm.employee_uuid || !commForm.scheme_uuid} className="w-full">Vypočítat</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {/* Summary */}
          {commissions.length > 0 && (
            <Card>
              <CardContent className="pt-6 flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{monthName(filterMonth)} {filterYear} — celkem provizí</p>
                  <p className="text-2xl font-bold">{totalCommissions.toLocaleString("cs-CZ")} Kč</p>
                </div>
                <Badge variant="outline">{commissions.length} záznamů</Badge>
              </CardContent>
            </Card>
          )}

          {commissions.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Coins className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">Žádné provize</h3>
                <p className="text-muted-foreground">Pro vybrané období nebyly nalezeny žádné provize.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {commissions.map(comm => (
                <Card key={comm.uuid}>
                  <CardContent className="py-3 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <Coins className="h-5 w-5 text-yellow-500" />
                      <div>
                        <p className="font-medium">{comm.employee_name}</p>
                        <p className="text-sm text-muted-foreground">
                          {comm.scheme_name} · {monthName(comm.period_month)} {comm.period_year}
                          {comm.revenue_czk ? ` · Obrat: ${comm.revenue_czk.toLocaleString("cs-CZ")} Kč` : ""}
                          {comm.units_sold ? ` · ${comm.units_sold} ks` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-lg">{comm.final_commission_czk?.toLocaleString("cs-CZ")} Kč</span>
                      {statusBadge(comm.status)}
                      {(comm.status === "calculated" || comm.status === "draft") && (
                        <Button size="sm" variant="outline" onClick={() => approveCommission(comm.uuid)}>
                          <CheckCircle className="h-4 w-4 mr-1" /> Schválit
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
