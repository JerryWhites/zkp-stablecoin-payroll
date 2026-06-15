// ====================================
// 🎁 Benefits Administration Page
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
  Gift, Plus, Users, Calculator, Utensils, Car,
  Heart, Coins, GraduationCap, Dumbbell, RefreshCw,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const BENEFIT_TYPES = [
  { value: "meal_voucher", label: "Stravenky", icon: Utensils },
  { value: "meal_allowance", label: "Stravenkový paušál", icon: Utensils },
  { value: "pension_contribution", label: "Penzijní připojištění", icon: Coins },
  { value: "life_insurance", label: "Životní pojištění", icon: Heart },
  { value: "company_car", label: "Služební automobil", icon: Car },
  { value: "cafeteria", label: "Cafeterie", icon: Gift },
  { value: "transport", label: "Doprava", icon: Car },
  { value: "education", label: "Vzdělávání", icon: GraduationCap },
  { value: "sport", label: "Sport & wellness", icon: Dumbbell },
  { value: "other", label: "Ostatní", icon: Gift },
];

interface BenefitPlan {
  id: number;
  uuid: string;
  type: string;
  name: string;
  description: string | null;
  voucher_value_czk: number | null;
  employer_contribution_pct: number | null;
  employer_contribution_czk: number | null;
  monthly_contribution_czk: number | null;
  annual_budget_czk: number | null;
  remaining_budget_czk: number | null;
  car_price_czk: number | null;
  car_is_ev: boolean;
  is_taxable: boolean;
  is_active: boolean;
  enrolled_count: number;
}

export default function Benefits() {
  const { toast } = useToast();
  const [plans, setPlans] = useState<BenefitPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mealCalc, setMealCalc] = useState<any>(null);
  const [carCalc, setCarCalc] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<"plans" | "meal" | "car">("plans");

  // Form state
  const [form, setForm] = useState({
    type: "meal_voucher",
    name: "",
    description: "",
    voucher_value_czk: "",
    employer_contribution_pct: "55",
    monthly_contribution_czk: "",
    annual_budget_czk: "",
    car_price_czk: "",
    car_is_ev: false,
  });

  const fetchPlans = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiClient.authenticatedFetch("/v2/benefits/plans");
      if (res.ok) {
        const data = await res.json();
        setPlans(data.plans || []);
      }
    } catch (error) {
      console.error("Failed to fetch benefit plans:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPlans(); }, [fetchPlans]);

  const createPlan = async () => {
    try {
      const payload: any = {
        type: form.type,
        name: form.name,
      };
      if (form.description) payload.description = form.description;
      if (form.voucher_value_czk) payload.voucher_value_czk = parseInt(form.voucher_value_czk);
      if (form.employer_contribution_pct) payload.employer_contribution_pct = parseFloat(form.employer_contribution_pct);
      if (form.monthly_contribution_czk) payload.monthly_contribution_czk = parseInt(form.monthly_contribution_czk);
      if (form.annual_budget_czk) payload.annual_budget_czk = parseInt(form.annual_budget_czk);
      if (form.car_price_czk) payload.car_price_czk = parseInt(form.car_price_czk);
      if (form.car_is_ev) payload.car_is_ev = true;

      const res = await apiClient.authenticatedFetch("/v2/benefits/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        toast({ title: "Benefitní plán vytvořen" });
        setDialogOpen(false);
        setForm({ type: "meal_voucher", name: "", description: "", voucher_value_czk: "", employer_contribution_pct: "55", monthly_contribution_czk: "", annual_budget_czk: "", car_price_czk: "", car_is_ev: false });
        fetchPlans();
      } else {
        const err = await res.json();
        toast({ title: "Chyba", description: err.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba při vytváření plánu", variant: "destructive" });
    }
  };

  const calculateMeal = async () => {
    try {
      const res = await apiClient.authenticatedFetch("/v2/benefits/calculate/meal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worked_days: 22, voucher_value_czk: 150, employer_contribution_pct: 55 }),
      });
      if (res.ok) {
        const data = await res.json();
        setMealCalc(data.calculation || data);
      }
    } catch {
      toast({ title: "Chyba při výpočtu", variant: "destructive" });
    }
  };

  const calculateCar = async () => {
    try {
      const res = await apiClient.authenticatedFetch("/v2/benefits/calculate/car", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ car_price_czk: 800000, is_ev: false }),
      });
      if (res.ok) {
        const data = await res.json();
        setCarCalc(data.calculation || data);
      }
    } catch {
      toast({ title: "Chyba při výpočtu", variant: "destructive" });
    }
  };

  const getTypeLabel = (type: string) => BENEFIT_TYPES.find(t => t.value === type)?.label || type;
  const getTypeIcon = (type: string) => {
    const found = BENEFIT_TYPES.find(t => t.value === type);
    const Icon = found?.icon || Gift;
    return <Icon className="h-4 w-4" />;
  };

  const tabs = [
    { id: "plans" as const, label: "Benefitní plány", icon: Gift },
    { id: "meal" as const, label: "Kalkulačka stravenek", icon: Utensils },
    { id: "car" as const, label: "Služební auto", icon: Car },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Benefity</h1>
          <p className="text-muted-foreground">Správa zaměstnaneckých benefitů a výhod</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchPlans}>
            <RefreshCw className="h-4 w-4 mr-1" /> Obnovit
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nový plán</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Vytvořit benefitní plán</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <div>
                  <Label>Typ benefitu</Label>
                  <Select value={form.type} onValueChange={v => setForm(p => ({ ...p, type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {BENEFIT_TYPES.map(t => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Název</Label>
                  <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Název plánu" />
                </div>
                <div>
                  <Label>Popis</Label>
                  <Input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Volitelný popis" />
                </div>
                {(form.type === "meal_voucher" || form.type === "meal_allowance") && (
                  <>
                    <div>
                      <Label>Hodnota stravenky (Kč)</Label>
                      <Input type="number" value={form.voucher_value_czk} onChange={e => setForm(p => ({ ...p, voucher_value_czk: e.target.value }))} placeholder="150" />
                    </div>
                    <div>
                      <Label>Příspěvek zaměstnavatele (%)</Label>
                      <Input type="number" value={form.employer_contribution_pct} onChange={e => setForm(p => ({ ...p, employer_contribution_pct: e.target.value }))} placeholder="55" />
                    </div>
                  </>
                )}
                {form.type === "company_car" && (
                  <>
                    <div>
                      <Label>Pořizovací cena vozu (Kč)</Label>
                      <Input type="number" value={form.car_price_czk} onChange={e => setForm(p => ({ ...p, car_price_czk: e.target.value }))} placeholder="800000" />
                    </div>
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={form.car_is_ev} onChange={e => setForm(p => ({ ...p, car_is_ev: e.target.checked }))} />
                      <Label>Elektromobil (nižší benefit 0,5%)</Label>
                    </div>
                  </>
                )}
                {(form.type === "pension_contribution" || form.type === "life_insurance") && (
                  <div>
                    <Label>Měsíční příspěvek (Kč)</Label>
                    <Input type="number" value={form.monthly_contribution_czk} onChange={e => setForm(p => ({ ...p, monthly_contribution_czk: e.target.value }))} placeholder="2000" />
                  </div>
                )}
                {form.type === "cafeteria" && (
                  <div>
                    <Label>Roční rozpočet na zaměstnance (Kč)</Label>
                    <Input type="number" value={form.annual_budget_czk} onChange={e => setForm(p => ({ ...p, annual_budget_czk: e.target.value }))} placeholder="20000" />
                  </div>
                )}
                <Button onClick={createPlan} disabled={!form.name} className="w-full">Vytvořit</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b pb-1">
        {tabs.map(tab => (
          <Button key={tab.id} variant={activeTab === tab.id ? "default" : "ghost"} size="sm" onClick={() => setActiveTab(tab.id)}>
            <tab.icon className="h-4 w-4 mr-1" /> {tab.label}
          </Button>
        ))}
      </div>

      {/* Plans Tab */}
      {activeTab === "plans" && (
        <div className="space-y-4">
          {loading ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Načítání...</CardContent></Card>
          ) : plans.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Gift className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">Žádné benefitní plány</h3>
                <p className="text-muted-foreground mb-4">Vytvořte první benefitní plán pro vaše zaměstnance.</p>
                <Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 mr-1" /> Nový plán</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {plans.map(plan => (
                <Card key={plan.uuid}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {getTypeIcon(plan.type)}
                        <CardTitle className="text-base">{plan.name}</CardTitle>
                      </div>
                      <Badge variant={plan.is_active ? "default" : "secondary"}>
                        {plan.is_active ? "Aktivní" : "Neaktivní"}
                      </Badge>
                    </div>
                    <CardDescription>{getTypeLabel(plan.type)}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 text-sm">
                      {plan.voucher_value_czk && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Hodnota stravenky:</span>
                          <span className="font-medium">{plan.voucher_value_czk} Kč</span>
                        </div>
                      )}
                      {plan.employer_contribution_pct && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Příspěvek:</span>
                          <span className="font-medium">{plan.employer_contribution_pct}%</span>
                        </div>
                      )}
                      {plan.monthly_contribution_czk && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Měsíčně:</span>
                          <span className="font-medium">{plan.monthly_contribution_czk.toLocaleString("cs-CZ")} Kč</span>
                        </div>
                      )}
                      {plan.car_price_czk && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Cena vozidla:</span>
                          <span className="font-medium">{plan.car_price_czk.toLocaleString("cs-CZ")} Kč</span>
                        </div>
                      )}
                      {plan.annual_budget_czk && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Roční rozpočet:</span>
                          <span className="font-medium">{plan.annual_budget_czk.toLocaleString("cs-CZ")} Kč</span>
                        </div>
                      )}
                      <div className="flex justify-between pt-2 border-t">
                        <span className="text-muted-foreground flex items-center gap-1"><Users className="h-3 w-3" /> Přihlášeno:</span>
                        <span className="font-medium">{plan.enrolled_count} zaměstnanců</span>
                      </div>
                      <Badge variant={plan.is_taxable ? "destructive" : "outline"} className="text-xs">
                        {plan.is_taxable ? "Zdanitelný" : "Osvobozený od daně"}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Meal Calculator Tab */}
      {activeTab === "meal" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Utensils className="h-5 w-5" /> Kalkulačka stravenek</CardTitle>
            <CardDescription>Výpočet nákladů na stravenky / stravenkový paušál</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Vzorový výpočet: 22 pracovních dní, stravenka 150 Kč, příspěvek zaměstnavatele 55%.
            </p>
            <Button onClick={calculateMeal}><Calculator className="h-4 w-4 mr-1" /> Vypočítat</Button>
            {mealCalc && (
              <div className="bg-muted p-4 rounded-lg space-y-2 text-sm">
                <div className="flex justify-between"><span>Odpracované dny:</span><span className="font-medium">{mealCalc.workedDays || mealCalc.worked_days || 22}</span></div>
                <div className="flex justify-between"><span>Hodnota stravenky:</span><span className="font-medium">{mealCalc.voucherValueCzk || mealCalc.voucher_value_czk || 150} Kč</span></div>
                <div className="flex justify-between"><span>Příspěvek zaměstnavatele:</span><span className="font-medium">{mealCalc.employerCostCzk || mealCalc.employer_cost_czk || "—"} Kč</span></div>
                <div className="flex justify-between"><span>Příspěvek zaměstnance:</span><span className="font-medium">{mealCalc.employeeCostCzk || mealCalc.employee_cost_czk || "—"} Kč</span></div>
                <div className="flex justify-between border-t pt-2"><span className="font-medium">Celkem:</span><span className="font-bold">{mealCalc.totalCostCzk || mealCalc.total_cost_czk || "—"} Kč</span></div>
                {mealCalc.taxFree !== undefined && (
                  <Badge variant={mealCalc.taxFree ? "outline" : "destructive"}>
                    {mealCalc.taxFree ? "Osvobozeno od daně" : "Částečně zdanitelné"}
                  </Badge>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Car Calculator Tab */}
      {activeTab === "car" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Car className="h-5 w-5" /> Služební automobil</CardTitle>
            <CardDescription>Výpočet nepeněžního příjmu ze služebního vozu (§6 odst. 6 ZDP)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Vzorový výpočet: pořizovací cena 800 000 Kč, spalovací motor (1% měsíčně).
            </p>
            <Button onClick={calculateCar}><Calculator className="h-4 w-4 mr-1" /> Vypočítat</Button>
            {carCalc && (
              <div className="bg-muted p-4 rounded-lg space-y-2 text-sm">
                <div className="flex justify-between"><span>Pořizovací cena:</span><span className="font-medium">{(carCalc.carPriceCzk || carCalc.car_price_czk || 800000).toLocaleString("cs-CZ")} Kč</span></div>
                <div className="flex justify-between"><span>Typ:</span><span className="font-medium">{carCalc.isEV || carCalc.is_ev ? "Elektromobil (0,5%)" : "Spalovací (1%)"}</span></div>
                <div className="flex justify-between border-t pt-2"><span className="font-medium">Měsíční benefit:</span><span className="font-bold">{(carCalc.monthlyBenefitCzk || carCalc.monthly_benefit_czk || "—").toLocaleString("cs-CZ")} Kč</span></div>
                <div className="flex justify-between"><span className="font-medium">Roční benefit:</span><span className="font-bold">{(carCalc.annualBenefitCzk || carCalc.annual_benefit_czk || "—").toLocaleString("cs-CZ")} Kč</span></div>
                <p className="text-xs text-muted-foreground mt-2">
                  Nepeněžní příjem se připočítává ke hrubé mzdě zaměstnance a podléhá dani i odvodům.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
