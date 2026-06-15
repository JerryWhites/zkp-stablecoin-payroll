// ====================================
// 📊 OSVČ Dashboard Page
// ====================================

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/lib/api-client";
import {
  Loader2, TrendingUp, TrendingDown, AlertTriangle, CheckCircle,
  Calendar, DollarSign, PiggyBank,
} from "lucide-react";
import type { OSVCAdvance, OSVCIncome, OSVCDashboardData } from "@/lib/cz-payroll-types";
import { formatCZK, MONTHS_CZ } from "@/lib/cz-payroll-types";

export default function OSVCDashboard() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState<OSVCDashboardData | null>(null);
  const [advances, setAdvances] = useState<OSVCAdvance[]>([]);
  const [incomeRecords, setIncomeRecords] = useState<OSVCIncome[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [tab, setTab] = useState("prehled");

  // Income form
  const [incomeMonth, setIncomeMonth] = useState(new Date().getMonth() + 1);
  const [incomeRevenue, setIncomeRevenue] = useState(0);
  const [incomeExpenses, setIncomeExpenses] = useState(0);
  const [savingIncome, setSavingIncome] = useState(false);
  const [generatingAdvances, setGeneratingAdvances] = useState(false);
  const [predchoziZisk, setPredchoziZisk] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setLoading(true);
    Promise.all([loadDashboard(), loadAdvances(), loadIncome()])
      .finally(() => setLoading(false));
  }, [year]);

  async function loadDashboard() {
    try {
      const res = await apiClient.authenticatedFetch(`/v2/osvc/dashboard?year=${year}`);
      if (res.ok) {
        const data = await res.json();
        setDashboard(data);
      } else {
        const data = await res.json();
        setError(data.error || 'Chyba při načítání přehledu');
      }
    } catch (e) {
      setError('Nepodařilo se načíst přehled OSVČ');
    }
  }

  async function loadAdvances() {
    try {
      const res = await apiClient.authenticatedFetch(`/v2/osvc/advances?year=${year}`);
      if (res.ok) {
        const data = await res.json();
        setAdvances(data.advances || []);
      }
    } catch {
      toast({ title: "Chyba", description: "Nepodařilo se načíst zálohy", variant: "destructive" });
    }
  }

  async function loadIncome() {
    try {
      const res = await apiClient.authenticatedFetch(`/v2/osvc/income?year=${year}`);
      if (res.ok) {
        const data = await res.json();
        setIncomeRecords(data.income || []);
      }
    } catch {
      toast({ title: "Chyba", description: "Nepodařilo se načíst příjmy", variant: "destructive" });
    }
  }

  async function saveIncome() {
    setSavingIncome(true);
    try {
      const res = await apiClient.authenticatedFetch("/v2/osvc/income", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year,
          month: incomeMonth,
          revenue_czk: incomeRevenue,
          expenses_czk: incomeExpenses,
        }),
      });

      if (res.ok) {
        toast({ title: "Uloženo", description: `Příjmy za ${MONTHS_CZ[incomeMonth]} ${year} uloženy` });
        loadIncome();
        loadDashboard();
      } else {
        const data = await res.json();
        toast({ title: "Chyba", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba", description: "Nepodařilo se uložit", variant: "destructive" });
    } finally {
      setSavingIncome(false);
    }
  }

  async function generateAdvances() {
    setGeneratingAdvances(true);
    try {
      const res = await apiClient.authenticatedFetch("/v2/osvc/advances/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, predchoziRocniZisk: predchoziZisk }),
      });

      if (res.ok) {
        toast({ title: "Vygenerováno", description: `Zálohy pro rok ${year} vytvořeny` });
        loadAdvances();
      } else {
        const data = await res.json();
        toast({ title: "Chyba", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba", description: "Nepodařilo se vygenerovat", variant: "destructive" });
    } finally {
      setGeneratingAdvances(false);
    }
  }

  async function markAdvancePaid(id: number) {
    try {
      const res = await apiClient.authenticatedFetch(`/v2/osvc/advances/${id}/pay`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (res.ok) {
        toast({ title: "Uhrazeno" });
        loadAdvances();
        loadDashboard();
      }
    } catch {
      toast({ title: "Chyba", variant: "destructive" });
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md w-full">
          <CardContent className="py-8 text-center">
            <AlertTriangle className="h-12 w-12 mx-auto mb-3 text-yellow-500" />
            <p className="text-muted-foreground">{error}</p>
            <Button variant="outline" className="mt-4" onClick={() => { setError(null); setLoading(true); Promise.all([loadDashboard(), loadAdvances(), loadIncome()]).finally(() => setLoading(false)); }}>
              Zkusit znovu
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">OSVČ Přehled</h1>
          <p className="text-muted-foreground">
            {dashboard?.company?.name} &middot; IČO: {dashboard?.company?.ico}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label>Rok:</Label>
          <Input
            type="number"
            className="w-24"
            value={year}
            onChange={e => setYear(parseInt(e.target.value) || new Date().getFullYear())}
            min={2020}
            max={2035}
          />
        </div>
      </div>

      {/* Summary Cards */}
      {dashboard && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
                <TrendingUp className="h-4 w-4" /> Příjmy (YTD)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {formatCZK(dashboard.ytdIncome.revenue)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
                <TrendingDown className="h-4 w-4" /> Výdaje (YTD)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-500">
                {formatCZK(dashboard.ytdIncome.expenses)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
                <PiggyBank className="h-4 w-4" /> Zálohy uhrazeny
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatCZK(dashboard.annualAdvances.paid)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                z {formatCZK(dashboard.annualAdvances.total)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
                {dashboard.overdueCount > 0 ? (
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                ) : (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                )}
                Po splatnosti
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${dashboard.overdueCount > 0 ? 'text-red-500' : 'text-green-600'}`}>
                {dashboard.overdueCount}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="prehled">Zálohy</TabsTrigger>
          <TabsTrigger value="prijmy">Příjmy / Výdaje</TabsTrigger>
        </TabsList>

        {/* Advances Tab */}
        <TabsContent value="prehled" className="space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <h2 className="text-lg font-semibold">Zálohy SP / ZP — {year}</h2>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2">
                <Label className="text-sm whitespace-nowrap">Předchozí zisk:</Label>
                <Input
                  type="number"
                  className="w-32"
                  value={predchoziZisk}
                  onChange={e => setPredchoziZisk(parseInt(e.target.value) || 0)}
                  min={0}
                  placeholder="Kč"
                />
              </div>
              <Button onClick={generateAdvances} disabled={generatingAdvances} variant="outline">
                {generatingAdvances ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Calendar className="h-4 w-4 mr-2" />}
                Vygenerovat zálohy
              </Button>
            </div>
          </div>

          {advances.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Žádné zálohy pro rok {year}. Klikněte na "Vygenerovat zálohy".
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-2">
              <div className="grid grid-cols-5 gap-2 px-3 py-2 text-sm font-medium text-muted-foreground">
                <div>Měsíc</div>
                <div>Typ</div>
                <div className="text-right">Částka</div>
                <div>Splatnost</div>
                <div>Stav</div>
              </div>
              {advances.map((a) => (
                <Card key={a.id} className="p-0">
                  <div className="grid grid-cols-5 gap-2 items-center px-3 py-2">
                    <div className="text-sm font-medium">{MONTHS_CZ[a.month]}</div>
                    <div>
                      <Badge variant={a.type === 'sp' ? 'default' : 'secondary'}>
                        {a.type === 'sp' ? 'Sociální' : a.type === 'zp' ? 'Zdravotní' : 'Daň'}
                      </Badge>
                    </div>
                    <div className="text-right font-mono text-sm">{formatCZK(a.amount_czk)}</div>
                    <div className="text-sm text-muted-foreground">
                      {new Date(a.due_date).toLocaleDateString('cs-CZ')}
                    </div>
                    <div>
                      {a.status === 'paid' ? (
                        <Badge variant="outline" className="text-green-600 border-green-300">
                          <CheckCircle className="h-3 w-3 mr-1" /> Uhrazeno
                        </Badge>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => markAdvancePaid(a.id)}>
                          Uhradit
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Income Tab */}
        <TabsContent value="prijmy" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Zadat příjmy</CardTitle>
              <CardDescription>Měsíční evidování příjmů a výdajů</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div>
                  <Label>Měsíc</Label>
                  <select
                    className="w-full h-10 border rounded-md px-3 text-sm"
                    value={incomeMonth}
                    onChange={e => setIncomeMonth(parseInt(e.target.value))}
                  >
                    {MONTHS_CZ.slice(1).map((m, i) => (
                      <option key={i + 1} value={i + 1}>{m}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Příjmy (Kč)</Label>
                  <Input
                    type="number"
                    value={incomeRevenue}
                    onChange={e => setIncomeRevenue(parseInt(e.target.value) || 0)}
                    min={0}
                  />
                </div>
                <div>
                  <Label>Výdaje (Kč)</Label>
                  <Input
                    type="number"
                    value={incomeExpenses}
                    onChange={e => setIncomeExpenses(parseInt(e.target.value) || 0)}
                    min={0}
                  />
                </div>
                <div className="flex items-end">
                  <Button onClick={saveIncome} disabled={savingIncome} className="w-full">
                    {savingIncome ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <DollarSign className="h-4 w-4 mr-2" />}
                    Uložit
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Income records table */}
          {incomeRecords.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Evidence {year}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="grid grid-cols-4 gap-2 px-3 py-2 text-sm font-medium text-muted-foreground">
                    <div>Měsíc</div>
                    <div className="text-right">Příjmy</div>
                    <div className="text-right">Výdaje</div>
                    <div className="text-right">Rozdíl</div>
                  </div>
                  {incomeRecords.map((inc) => (
                    <div key={`${inc.year}-${inc.month}`} className="grid grid-cols-4 gap-2 px-3 py-2 border rounded-md">
                      <div className="font-medium">{MONTHS_CZ[inc.month]}</div>
                      <div className="text-right text-green-600 font-mono">{formatCZK(inc.revenue_czk)}</div>
                      <div className="text-right text-red-500 font-mono">{formatCZK(inc.expenses_czk)}</div>
                      <div className={`text-right font-mono font-medium ${inc.revenue_czk - inc.expenses_czk >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {formatCZK(inc.revenue_czk - inc.expenses_czk)}
                      </div>
                    </div>
                  ))}
                  {/* Totals row */}
                  <div className="grid grid-cols-4 gap-2 px-3 py-2 border-t-2 font-bold">
                    <div>Celkem</div>
                    <div className="text-right text-green-600 font-mono">
                      {formatCZK(incomeRecords.reduce((s, i) => s + i.revenue_czk, 0))}
                    </div>
                    <div className="text-right text-red-500 font-mono">
                      {formatCZK(incomeRecords.reduce((s, i) => s + i.expenses_czk, 0))}
                    </div>
                    <div className="text-right font-mono">
                      {formatCZK(incomeRecords.reduce((s, i) => s + i.revenue_czk - i.expenses_czk, 0))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
