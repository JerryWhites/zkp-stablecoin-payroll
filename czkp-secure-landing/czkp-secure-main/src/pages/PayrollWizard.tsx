// ====================================
// 💰 CZ Payroll Wizard — 4-Step Monthly Workflow
// ====================================
// Step 1: Select month (create period)
// Step 2: Enter hours / bonuses / srážky
// Step 3: Calculate & review
// Step 4: Lock & export

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/lib/api-client";
import ZKPaymentStep from "@/components/payroll/ZKPaymentStep";
import {
  formatCZK,
  periodLabel,
  MONTHS_CZ,
  type PayrollPeriod,
  type PayrollPeriodDetail,
  type PayrollItem,
  type PayrollSummary,
  type CalculateResponse,
  type PeriodStatus,
} from "@/lib/cz-payroll-types";
import {
  Calendar,
  Clock,
  Calculator,
  Lock,
  Download,
  FileText,
  ChevronLeft,
  ChevronRight,
  Loader2,
  CheckCircle,
  AlertCircle,
  FileSpreadsheet,
  Archive,
  Wallet,
} from "lucide-react";

const CURRENT_YEAR = new Date().getFullYear();
const CURRENT_MONTH = new Date().getMonth() + 1;

const STEPS = [
  { id: 1, label: "Období", icon: Calendar },
  { id: 2, label: "Hodiny", icon: Clock },
  { id: 3, label: "Výpočet", icon: Calculator },
  { id: 4, label: "Uzavření", icon: Lock },
  { id: 5, label: "ZK Platby", icon: Wallet },
];

export default function PayrollWizard() {
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Step 1 state
  const [year, setYear] = useState(CURRENT_YEAR);
  const [month, setMonth] = useState(CURRENT_MONTH);
  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [selectedPeriodUuid, setSelectedPeriodUuid] = useState<string | null>(null);

  // Step 2-4 state
  const [periodDetail, setPeriodDetail] = useState<PayrollPeriodDetail | null>(null);
  const [editedItems, setEditedItems] = useState<Record<string, Partial<PayrollItem>>>({});
  const [calcResult, setCalcResult] = useState<CalculateResponse | null>(null);
  const [showLockConfirm, setShowLockConfirm] = useState(false);

  // Load existing periods
  const loadPeriods = useCallback(async () => {
    try {
      const res = await apiClient.authenticatedFetch("/v2/payroll/periods");
      if (res.ok) {
        const data = await res.json();
        setPeriods(data.periods || []);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => { loadPeriods(); }, [loadPeriods]);

  // Load period detail
  async function loadPeriodDetail(uuid: string) {
    setLoading(true);
    try {
      const res = await apiClient.authenticatedFetch(`/v2/payroll/periods/${uuid}`);
      if (res.ok) {
        const data: PayrollPeriodDetail = await res.json();
        setPeriodDetail(data);
        setSelectedPeriodUuid(uuid);

        // Auto-advance to correct step based on status
        if (data.period.status === "locked") {
          setStep(4);
        } else if (data.period.status === "calculated") {
          setStep(3);
        } else {
          setStep(2);
        }
      }
    } catch {
      toast({ title: "Chyba", description: "Nepodařilo se načíst období", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  // Step 1: Create new period
  async function createPeriod() {
    setLoading(true);
    try {
      const res = await apiClient.authenticatedFetch("/v2/payroll/periods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, month }),
      });

      const data = await res.json();
      if (!res.ok) {
        // Period exists — load it
        if (res.status === 409) {
          const existing = periods.find(p => p.year === year && p.month === month);
          if (existing) {
            await loadPeriodDetail(existing.uuid);
            return;
          }
        }
        toast({ title: "Chyba", description: data.error, variant: "destructive" });
        return;
      }

      toast({ title: "Vytvořeno", description: `Období ${MONTHS_CZ[month]} ${year}` });
      await loadPeriods();
      await loadPeriodDetail(data.period.uuid);
    } catch {
      toast({ title: "Chyba", description: "Chyba připojení", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  // Step 2: Save edited items
  async function saveItems() {
    if (!selectedPeriodUuid || Object.keys(editedItems).length === 0) {
      setStep(3);
      return;
    }

    setLoading(true);
    try {
      const items = Object.entries(editedItems).map(([uuid, changes]) => ({
        uuid,
        ...changes,
      }));

      const res = await apiClient.authenticatedFetch("/v2/payroll/items", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period_uuid: selectedPeriodUuid, items }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast({ title: "Chyba", description: data.error, variant: "destructive" });
        return;
      }

      setEditedItems({});
      toast({ title: "Uloženo" });
      setStep(3);
    } catch {
      toast({ title: "Chyba", description: "Chyba připojení", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  // Step 3: Calculate
  async function runCalculation() {
    if (!selectedPeriodUuid) return;

    setLoading(true);
    try {
      const res = await apiClient.authenticatedFetch("/v2/payroll/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period_uuid: selectedPeriodUuid }),
      });

      const data: CalculateResponse = await res.json();
      if (!res.ok) {
        toast({ title: "Chyba", description: (data as any).error, variant: "destructive" });
        return;
      }

      setCalcResult(data);
      toast({ title: "Vypočteno", description: `Mzdy pro ${data.summary.employeeCount} zaměstnanců` });

      // Reload detail
      await loadPeriodDetail(selectedPeriodUuid);
    } catch {
      toast({ title: "Chyba", description: "Chyba připojení", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  // Step 4: Lock
  async function lockPeriod() {
    if (!selectedPeriodUuid) return;
    setShowLockConfirm(true);
  }

  async function confirmLockPeriod() {
    if (!selectedPeriodUuid) return;
    setShowLockConfirm(false);

    setLoading(true);
    try {
      const res = await apiClient.authenticatedFetch("/v2/payroll/lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period_uuid: selectedPeriodUuid }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast({ title: "Chyba", description: data.error, variant: "destructive" });
        return;
      }

      toast({ title: "Uzavřeno", description: "Období bylo zamčeno" });
      await loadPeriodDetail(selectedPeriodUuid);
    } catch {
      toast({ title: "Chyba", description: "Chyba připojení", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  // Download helpers
  function downloadFile(url: string) {
    const a = document.createElement("a");
    a.href = `${import.meta.env.VITE_API_BASE || "http://localhost:5000/api"}${url}`;
    // Add auth header via fetch
    apiClient.authenticatedFetch(url).then(res => {
      if (!res.ok) throw new Error();
      return res.blob();
    }).then(blob => {
      const blobUrl = URL.createObjectURL(blob);
      a.href = blobUrl;
      a.download = "";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    }).catch(() => {
      toast({ title: "Chyba", description: "Stažení se nezdařilo", variant: "destructive" });
    });
  }

  // Step indicator
  function StepIndicator() {
    return (
      <div className="flex items-center justify-center gap-1 mb-8">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const isActive = step === s.id;
          const isCompleted = step > s.id;
          return (
            <div key={s.id} className="flex items-center">
              <div
                className={`flex items-center gap-2 px-4 py-2 rounded-full cursor-pointer transition-colors ${
                  isActive ? "bg-primary text-primary-foreground" :
                  isCompleted ? "bg-primary/20 text-primary" :
                  "bg-muted text-muted-foreground"
                }`}
                onClick={() => {
                  if (isCompleted || s.id <= getMaxStep()) setStep(s.id);
                }}
              >
                <Icon className="h-4 w-4" />
                <span className="text-sm font-medium hidden sm:inline">{s.label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <ChevronRight className="h-4 w-4 text-muted-foreground mx-1" />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  function getMaxStep(): number {
    if (!periodDetail) return 1;
    switch (periodDetail.period.status) {
      case "locked": return 5;
      case "calculated": return 4;
      case "draft": return 3;
      default: return 1;
    }
  }

  function statusBadge(status: PeriodStatus) {
    const map: Record<PeriodStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      draft: { label: "Rozpracováno", variant: "secondary" },
      calculated: { label: "Vypočteno", variant: "default" },
      locked: { label: "Zamčeno", variant: "outline" },
    };
    const { label, variant } = map[status] || { label: status, variant: "default" as const };
    return <Badge variant={variant}>{label}</Badge>;
  }

  // ======== RENDER STEPS ========

  function renderStep1() {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Nové období</CardTitle>
            <CardDescription>Vyberte měsíc a rok pro výpočet mezd</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 items-end">
              <div>
                <Label>Měsíc</Label>
                <Select value={String(month)} onValueChange={v => setMonth(Number(v))}>
                  <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MONTHS_CZ.slice(1).map((name, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Rok</Label>
                <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
                  <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[2024, 2025, 2026, 2027].map(y => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={createPeriod} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Calendar className="h-4 w-4 mr-2" />}
                Vytvořit období
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Existing periods */}
        {periods.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Existující období</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Období</TableHead>
                    <TableHead>Stav</TableHead>
                    <TableHead className="text-right">Zaměstnanců</TableHead>
                    <TableHead className="text-right">Hrubé mzdy</TableHead>
                    <TableHead className="text-right">Čisté mzdy</TableHead>
                    <TableHead className="text-right">Akce</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {periods.map(p => (
                    <TableRow key={p.uuid} className="cursor-pointer hover:bg-muted/50" onClick={() => loadPeriodDetail(p.uuid)}>
                      <TableCell className="font-medium">{periodLabel(p.year, p.month)}</TableCell>
                      <TableCell>{statusBadge(p.status)}</TableCell>
                      <TableCell className="text-right">{p.item_count || 0}</TableCell>
                      <TableCell className="text-right font-mono">{formatCZK(p.total_hruba)}</TableCell>
                      <TableCell className="text-right font-mono">{formatCZK(p.total_cista)}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm">Otevřít</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  function renderStep2() {
    if (!periodDetail) return null;
    const { period, items } = periodDetail;

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">{periodLabel(period.year, period.month)}</h2>
            <p className="text-muted-foreground">{items.length} zaměstnanců • Zadejte odpracované hodiny</p>
          </div>
          {statusBadge(period.status)}
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Zaměstnanec</TableHead>
                    <TableHead>Typ</TableHead>
                    <TableHead className="text-right">Fond (h)</TableHead>
                    <TableHead className="text-right">Odpracováno (h)</TableHead>
                    <TableHead className="text-right">Absence (h)</TableHead>
                    <TableHead className="text-right">Bonus (Kč)</TableHead>
                    <TableHead className="text-right">Srážka (Kč)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map(item => {
                    const edits = editedItems[item.uuid] || {};
                    const isLocked = period.status === "locked";
                    return (
                      <TableRow key={item.uuid}>
                        <TableCell>
                          <div className="font-medium">{item.name}</div>
                          <div className="text-xs text-muted-foreground">{item.osobni_cislo}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{item.typ_uvazku}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">{item.fond_hodin}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            step={0.5}
                            className="w-20 text-right ml-auto"
                            value={edits.odpracovane_hodiny ?? item.odpracovane_hodiny}
                            disabled={isLocked}
                            onChange={e => setEditedItems(prev => ({
                              ...prev,
                              [item.uuid]: { ...prev[item.uuid], odpracovane_hodiny: Number(e.target.value) },
                            }))}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            step={0.5}
                            className="w-20 text-right ml-auto"
                            value={edits.absence_hodiny ?? item.absence_hodiny}
                            disabled={isLocked}
                            onChange={e => setEditedItems(prev => ({
                              ...prev,
                              [item.uuid]: { ...prev[item.uuid], absence_hodiny: Number(e.target.value) },
                            }))}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            className="w-24 text-right ml-auto"
                            value={edits.bonus_czk ?? item.bonus_czk}
                            disabled={isLocked}
                            onChange={e => setEditedItems(prev => ({
                              ...prev,
                              [item.uuid]: { ...prev[item.uuid], bonus_czk: Number(e.target.value) },
                            }))}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            className="w-24 text-right ml-auto"
                            value={edits.srazka_czk ?? item.srazka_czk}
                            disabled={isLocked}
                            onChange={e => setEditedItems(prev => ({
                              ...prev,
                              [item.uuid]: { ...prev[item.uuid], srazka_czk: Number(e.target.value) },
                            }))}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-between">
          <Button variant="outline" onClick={() => setStep(1)}>
            <ChevronLeft className="h-4 w-4 mr-2" /> Zpět
          </Button>
          <Button onClick={saveItems} disabled={loading || period.status === "locked"}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Uložit a pokračovat <ChevronRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </div>
    );
  }

  function renderStep3() {
    if (!periodDetail) return null;
    const { period, items, summary } = periodDetail;

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">{periodLabel(period.year, period.month)} — Výpočet</h2>
            <p className="text-muted-foreground">
              {period.status === "calculated" || period.status === "locked"
                ? "Mzdy byly vypočteny" : "Spusťte výpočet mezd"}
            </p>
          </div>
          <div className="flex gap-2">
            {statusBadge(period.status)}
            {period.status !== "locked" && (
              <Button onClick={runCalculation} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Calculator className="h-4 w-4 mr-2" />}
                {period.status === "calculated" ? "Přepočítat" : "Spočítat mzdy"}
              </Button>
            )}
          </div>
        </div>

        {/* Results table */}
        {(period.status === "calculated" || period.status === "locked") && (
          <>
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Zaměstnanec</TableHead>
                        <TableHead>Typ</TableHead>
                        <TableHead className="text-right">Hrubá</TableHead>
                        <TableHead className="text-right">SP zam</TableHead>
                        <TableHead className="text-right">ZP zam</TableHead>
                        <TableHead className="text-right">Daň</TableHead>
                        <TableHead className="text-right">D. bonus</TableHead>
                        <TableHead className="text-right font-bold">Čistá</TableHead>
                        <TableHead className="text-right">Náklady</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map(item => (
                        <TableRow key={item.uuid}>
                          <TableCell>
                            <div className="font-medium">{item.name}</div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{item.typ_uvazku}</Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono">{formatCZK(item.celkova_hruba_czk)}</TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground">{formatCZK(item.sp_zamestnanec)}</TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground">{formatCZK(item.zp_zamestnanec)}</TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground">{formatCZK(item.vysledek_dan)}</TableCell>
                          <TableCell className="text-right font-mono text-green-600">{item.danovy_bonus ? formatCZK(item.danovy_bonus) : "—"}</TableCell>
                          <TableCell className="text-right font-mono font-bold">{formatCZK(item.cista_mzda_czk)}</TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground">{formatCZK(item.celkove_naklady)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* Summary cards */}
            {summary && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-sm text-muted-foreground">Platba FÚ</div>
                    <div className="text-xl font-bold font-mono">{formatCZK(summary.platbaFU)}</div>
                    <div className="text-xs text-muted-foreground">Záloha na daň</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-sm text-muted-foreground">Platba OSSZ</div>
                    <div className="text-xl font-bold font-mono">{formatCZK(summary.platbaOSSZ)}</div>
                    <div className="text-xs text-muted-foreground">Sociální pojištění</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-sm text-muted-foreground">Platba ZP</div>
                    <div className="text-xl font-bold font-mono">{formatCZK(summary.platbaZP)}</div>
                    <div className="text-xs text-muted-foreground">Zdravotní pojištění</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-sm text-muted-foreground">Čisté mzdy</div>
                    <div className="text-xl font-bold font-mono">{formatCZK(summary.platbaMzdy)}</div>
                    <div className="text-xs text-muted-foreground">{summary.employeeCount} zaměstnanců</div>
                  </CardContent>
                </Card>
              </div>
            )}
          </>
        )}

        <div className="flex justify-between">
          <Button variant="outline" onClick={() => setStep(2)}>
            <ChevronLeft className="h-4 w-4 mr-2" /> Zpět na hodiny
          </Button>
          {(period.status === "calculated" || period.status === "locked") && (
            <Button onClick={() => setStep(4)}>
              Pokračovat k uzavření <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          )}
        </div>
      </div>
    );
  }

  function renderStep4() {
    if (!periodDetail) return null;
    const { period, summary } = periodDetail;
    const isLocked = period.status === "locked";

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">{periodLabel(period.year, period.month)} — Uzavření</h2>
            <p className="text-muted-foreground">
              {isLocked ? "Období je uzavřeno" : "Uzavřete období a stáhněte exporty"}
            </p>
          </div>
          {statusBadge(period.status)}
        </div>

        {/* Lock action */}
        {!isLocked && (
          <Card className="border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20">
            <CardContent className="pt-6">
              <div className="flex items-start gap-4">
                <AlertCircle className="h-8 w-8 text-amber-500 shrink-0" />
                <div>
                  <h3 className="font-bold">Uzavřít období</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Po uzavření již nebude možné měnit hodiny ani přepočítat mzdy. Ujistěte se, že jsou všechny údaje správné.
                  </p>
                  <Button onClick={lockPeriod} disabled={loading} className="mt-4" variant="destructive">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Lock className="h-4 w-4 mr-2" />}
                    Zamknout období
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Success */}
        {isLocked && (
          <Card className="border-green-500/50 bg-green-50/50 dark:bg-green-950/20">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <CheckCircle className="h-8 w-8 text-green-500" />
                <div>
                  <h3 className="font-bold text-green-800 dark:text-green-300">Období zamčeno</h3>
                  <p className="text-sm text-muted-foreground">
                    {period.locked_at ? `Zamčeno: ${new Date(period.locked_at).toLocaleString("cs-CZ")}` : ""}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Summary */}
        {summary && (
          <Card>
            <CardHeader>
              <CardTitle>Souhrn plateb</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span>Finanční úřad (záloha na daň)</span>
                  <span className="font-mono font-bold">{formatCZK(summary.platbaFU)}</span>
                </div>
                <div className="flex justify-between">
                  <span>OSSZ (sociální pojištění)</span>
                  <span className="font-mono font-bold">{formatCZK(summary.platbaOSSZ)}</span>
                </div>
                <div className="flex justify-between">
                  <span>ZP (zdravotní pojištění)</span>
                  <span className="font-mono font-bold">{formatCZK(summary.platbaZP)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Čisté mzdy zaměstnancům</span>
                  <span className="font-mono font-bold">{formatCZK(summary.platbaMzdy)}</span>
                </div>
                <Separator />
                <div className="flex justify-between text-lg font-bold">
                  <span>Celkové výdaje</span>
                  <span className="font-mono">{formatCZK(summary.celkoveNaklady)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Export buttons */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" /> Exporty
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Button variant="outline" onClick={() => downloadFile(`/v2/exports/vyplatnice/${period.uuid}`)}>
                <FileText className="h-4 w-4 mr-2" /> Výplatní lístky (PDF)
              </Button>
              <Button variant="outline" onClick={() => downloadFile(`/v2/exports/bank-csv/${period.uuid}`)}>
                <FileSpreadsheet className="h-4 w-4 mr-2" /> Bankovní příkaz (CSV)
              </Button>
              <Button variant="outline" onClick={() => downloadFile(`/v2/exports/institution-csv/${period.uuid}/fu`)}>
                <FileSpreadsheet className="h-4 w-4 mr-2" /> Přehled FÚ (CSV)
              </Button>
              <Button variant="outline" onClick={() => downloadFile(`/v2/exports/institution-csv/${period.uuid}/ossz`)}>
                <FileSpreadsheet className="h-4 w-4 mr-2" /> Přehled OSSZ (CSV)
              </Button>
              <Button variant="outline" onClick={() => downloadFile(`/v2/exports/institution-csv/${period.uuid}/zp`)}>
                <FileSpreadsheet className="h-4 w-4 mr-2" /> Přehled ZP (CSV)
              </Button>
              <Button variant="outline" onClick={() => downloadFile(`/v2/exports/zip/${period.uuid}`)}>
                <Archive className="h-4 w-4 mr-2" /> Vše v ZIP
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-between">
          <Button variant="outline" onClick={() => setStep(3)}>
            <ChevronLeft className="h-4 w-4 mr-2" /> Zpět na výpočet
          </Button>
          <div className="flex gap-2">
            {isLocked && (
              <Button onClick={() => setStep(5)} className="bg-accent hover:bg-accent/90 text-accent-foreground">
                <Wallet className="h-4 w-4 mr-2" /> ZK Platby (Aleo)
              </Button>
            )}
            <Button variant="outline" onClick={() => {
              setSelectedPeriodUuid(null);
              setPeriodDetail(null);
              setCalcResult(null);
              setStep(1);
            }}>
              Nové období
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <Calculator className="h-8 w-8 text-primary" />
        <h1 className="text-2xl font-bold">Mzdový výpočet</h1>
      </div>

      <StepIndicator />

      {loading && step === 1 ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
          {step === 3 && renderStep3()}
          {step === 4 && renderStep4()}
          {step === 5 && periodDetail && (
            <ZKPaymentStep
              items={periodDetail.items}
              periodUuid={periodDetail.period.uuid}
              czk_aleo_rate={periodDetail.period.czk_aleo_rate ?? null}
            />
          )}
        </>
      )}

      {/* Lock period confirmation */}
      <AlertDialog open={showLockConfirm} onOpenChange={setShowLockConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Uzavřít období?</AlertDialogTitle>
            <AlertDialogDescription>
              Opravdu chcete uzavřít toto mzdové období? Po uzavření již nebude možné provádět žádné změny.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Zrušit</AlertDialogCancel>
            <AlertDialogAction onClick={confirmLockPeriod}>Uzavřít</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
