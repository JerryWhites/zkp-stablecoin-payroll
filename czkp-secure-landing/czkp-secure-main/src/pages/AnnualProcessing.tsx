// ====================================
// 📅 Annual Processing Page
// ====================================

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/lib/api-client";
import {
  Loader2, FileText, Calculator, Send, CheckCircle, AlertCircle,
  ClipboardList, Users, Building2,
} from "lucide-react";
import type { AnnualProcessingRecord, CZEmployee, RocniZuctovaniResult } from "@/lib/cz-payroll-types";
import { formatCZK } from "@/lib/cz-payroll-types";

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  draft: { label: "Rozpracováno", variant: "secondary" },
  calculated: { label: "Vypočítáno", variant: "default" },
  submitted: { label: "Podáno", variant: "outline" },
  accepted: { label: "Přijato", variant: "outline" },
  rejected: { label: "Zamítnuto", variant: "destructive" },
};

const TYPE_LABELS: Record<string, string> = {
  rocni_zuctovani: "Roční zúčtování",
  eldp: "ELDP",
  prehled_ossz: "Přehled OSSZ",
  prehled_zp: "Přehled ZP",
  danove_priznani: "Daňové přiznání",
  vyuctovani_dane: "Vyúčtování daně",
};

export default function AnnualProcessing() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<AnnualProcessingRecord[]>([]);
  const [employees, setEmployees] = useState<CZEmployee[]>([]);
  const [year, setYear] = useState(new Date().getFullYear() - 1);
  const [tab, setTab] = useState("prehled");

  // Roční zúčtování form
  const [selectedEmployee, setSelectedEmployee] = useState<string>("");
  const [rzUroky, setRzUroky] = useState(0);
  const [rzDary, setRzDary] = useState(0);
  const [rzPenzijko, setRzPenzijko] = useState(0);
  const [rzZivotko, setRzZivotko] = useState(0);
  const [calculating, setCalculating] = useState(false);
  const [rzResult, setRzResult] = useState<RocniZuctovaniResult | null>(null);

  // ELDP
  const [eldpEmployee, setEldpEmployee] = useState<string>("");
  const [generatingEldp, setGeneratingEldp] = useState(false);
  const [generatingAllEldp, setGeneratingAllEldp] = useState(false);

  // Přehledy OSVČ
  const [entityType, setEntityType] = useState<string | null>(null);
  const [generatingOSSZ, setGeneratingOSSZ] = useState(false);
  const [generatingZP, setGeneratingZP] = useState(false);
  const [prehledResult, setPrehledResult] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    loadRecords();
    loadEmployees();
    loadEntityType();
  }, [year]);

  async function loadRecords() {
    setLoading(true);
    try {
      const res = await apiClient.authenticatedFetch(`/v2/annual?year=${year}`);
      if (res.ok) {
        const data = await res.json();
        setRecords(data.records || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function loadEmployees() {
    try {
      const res = await apiClient.authenticatedFetch("/v2/employees");
      if (res.ok) {
        const data = await res.json();
        setEmployees(data.employees || []);
      }
    } catch { /* ignore */ }
  }

  async function loadEntityType() {
    try {
      const res = await apiClient.authenticatedFetch("/companies/current");
      if (res.ok) {
        const data = await res.json();
        setEntityType(data.company?.entity_type || null);
      }
    } catch { /* ignore */ }
  }

  async function calculateRocniZuctovani() {
    if (!selectedEmployee) {
      toast({ title: "Vyberte zaměstnance", variant: "destructive" });
      return;
    }
    setCalculating(true);
    setRzResult(null);

    try {
      const res = await apiClient.authenticatedFetch("/v2/annual/rocni-zuctovani", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year,
          employee_id: parseInt(selectedEmployee),
          rocniUroky: rzUroky,
          rocniDary: rzDary,
          rocniPenzijko: rzPenzijko,
          rocniZivotko: rzZivotko,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setRzResult(data.result);
        toast({ title: "Vypočítáno", description: `Roční zúčtování pro ${data.employee?.jmeno} ${data.employee?.prijmeni}` });
        loadRecords();
      } else {
        toast({ title: "Chyba", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba", description: "Výpočet selhal", variant: "destructive" });
    } finally {
      setCalculating(false);
    }
  }

  async function generateEldp() {
    if (!eldpEmployee) {
      toast({ title: "Vyberte zaměstnance", variant: "destructive" });
      return;
    }
    setGeneratingEldp(true);

    try {
      const res = await apiClient.authenticatedFetch("/v2/annual/eldp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, employee_id: parseInt(eldpEmployee) }),
      });

      const data = await res.json();
      if (res.ok) {
        toast({ title: "ELDP vygenerován" });
        loadRecords();
      } else {
        toast({ title: "Chyba", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba", variant: "destructive" });
    } finally {
      setGeneratingEldp(false);
    }
  }

  async function submitRecord(id: number) {
    try {
      const res = await apiClient.authenticatedFetch(`/v2/annual/${id}/submit`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (res.ok) {
        toast({ title: "Označeno jako podáno" });
        loadRecords();
      } else {
        const data = await res.json();
        toast({ title: "Chyba", description: data.error, variant: "destructive" });
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Roční zpracování</h1>
          <p className="text-muted-foreground">Roční zúčtování daně, ELDP a přehledy</p>
        </div>
        <div className="flex items-center gap-2">
          <Label>Rok:</Label>
          <Input
            type="number"
            className="w-24"
            value={year}
            onChange={e => setYear(parseInt(e.target.value) || new Date().getFullYear() - 1)}
            min={2020}
            max={2035}
          />
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="prehled">
            <ClipboardList className="h-4 w-4 mr-1" /> Přehled
          </TabsTrigger>
          <TabsTrigger value="zuctovani">
            <Calculator className="h-4 w-4 mr-1" /> Roční zúčtování
          </TabsTrigger>
          <TabsTrigger value="eldp">
            <FileText className="h-4 w-4 mr-1" /> ELDP
          </TabsTrigger>
          {entityType === 'osvc' && (
            <TabsTrigger value="prehledy">
              <Building2 className="h-4 w-4 mr-1" /> Přehledy OSVČ
            </TabsTrigger>
          )}
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="prehled" className="space-y-4">
          {records.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
                Žádné záznamy za rok {year}. Použijte záložky k vytvoření.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {records.map((rec) => (
                <Card key={rec.id}>
                  <CardContent className="flex items-center justify-between py-4">
                    <div className="flex items-center gap-3">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <div className="font-medium">{TYPE_LABELS[rec.type] || rec.type}</div>
                        <div className="text-sm text-muted-foreground">
                          {rec.year}
                          {rec.employee_id && ` — Zaměstnanec #${rec.employee_id}`}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant={STATUS_LABELS[rec.status]?.variant || "secondary"}>
                        {STATUS_LABELS[rec.status]?.label || rec.status}
                      </Badge>
                      {rec.status === "calculated" && (
                        <Button size="sm" variant="outline" onClick={() => submitRecord(rec.id)}>
                          <Send className="h-3 w-3 mr-1" /> Označit podáno
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Roční zúčtování Tab */}
        <TabsContent value="zuctovani" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Roční zúčtování daně</CardTitle>
              <CardDescription>
                Výpočet ročního zúčtování daně pro zaměstnance za rok {year}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {employees.length === 0 ? (
                <div className="py-4 text-center text-muted-foreground">
                  <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  Žádní zaměstnanci. Nejprve přidejte zaměstnance v sekci "Zaměstnanci".
                </div>
              ) : (<>
              <div>
                <Label>Zaměstnanec</Label>
                <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                  <SelectTrigger>
                    <SelectValue placeholder="Vyberte zaměstnance" />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((emp) => (
                      <SelectItem key={emp.id} value={String(emp.id)}>
                        {emp.name} ({emp.osobni_cislo || `#${emp.id}`})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>Úroky z hypotéky (§15 odst. 3)</Label>
                  <Input type="number" value={rzUroky} onChange={e => setRzUroky(parseInt(e.target.value) || 0)} min={0} />
                </div>
                <div>
                  <Label>Dary (§15 odst. 1)</Label>
                  <Input type="number" value={rzDary} onChange={e => setRzDary(parseInt(e.target.value) || 0)} min={0} />
                </div>
                <div>
                  <Label>Penzijní připojištění (§15 odst. 5)</Label>
                  <Input type="number" value={rzPenzijko} onChange={e => setRzPenzijko(parseInt(e.target.value) || 0)} min={0} />
                </div>
                <div>
                  <Label>Životní pojištění (§15 odst. 6)</Label>
                  <Input type="number" value={rzZivotko} onChange={e => setRzZivotko(parseInt(e.target.value) || 0)} min={0} />
                </div>
              </div>

              <Button onClick={calculateRocniZuctovani} disabled={calculating}>
                {calculating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Calculator className="h-4 w-4 mr-2" />}
                Vypočítat
              </Button>
              </>)}

              {/* Result */}
              {rzResult && (
                <div className="mt-4 border rounded-lg p-4 space-y-3">
                  <h3 className="font-semibold text-lg">Výsledek ročního zúčtování</h3>

                  {(rzResult as RocniZuctovaniResult & { warning?: string }).warning && (
                    <div className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-md text-sm text-yellow-800">
                      <AlertCircle className="h-4 w-4 flex-shrink-0" />
                      {(rzResult as RocniZuctovaniResult & { warning?: string }).warning}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="text-muted-foreground">Roční hrubá mzda</div>
                    <div className="text-right font-mono">{formatCZK(rzResult.rocniHruba)}</div>

                    <div className="text-muted-foreground">Nezdanitelné odpočty</div>
                    <div className="text-right font-mono">{formatCZK(rzResult.odpocty)}</div>

                    <div className="text-muted-foreground">Snížený základ daně</div>
                    <div className="text-right font-mono">{formatCZK(rzResult.sniZenyZaklad)}</div>

                    <div className="text-muted-foreground">Roční daň</div>
                    <div className="text-right font-mono">{formatCZK(rzResult.rocniDan)}</div>

                    <div className="text-muted-foreground">Slevy na dani</div>
                    <div className="text-right font-mono">{formatCZK(rzResult.rocniSlevy)}</div>

                    <div className="text-muted-foreground">Daň po slevách</div>
                    <div className="text-right font-mono">{formatCZK(rzResult.rocniDanPoSlevach)}</div>

                    <div className="text-muted-foreground">Daňové zvýhodnění</div>
                    <div className="text-right font-mono">{formatCZK(rzResult.rocniZvyhodneni)}</div>

                    <div className="text-muted-foreground">Skutečná daňová povinnost</div>
                    <div className="text-right font-mono">{formatCZK(rzResult.vysledkDan)}</div>

                    <div className="text-muted-foreground">Zaplaceno na zálohách</div>
                    <div className="text-right font-mono">{formatCZK(rzResult.zaplacenaDan)}</div>
                  </div>

                  <div className="border-t pt-3">
                    <div className={`flex items-center justify-between text-lg font-bold ${
                      rzResult.vysledek === 'preplatek' ? 'text-green-600' :
                      rzResult.vysledek === 'nedoplatek' ? 'text-red-500' : ''
                    }`}>
                      <span className="flex items-center gap-2">
                        {rzResult.vysledek === 'preplatek' ? (
                          <><CheckCircle className="h-5 w-5" /> Přeplatek</>
                        ) : rzResult.vysledek === 'nedoplatek' ? (
                          <><AlertCircle className="h-5 w-5" /> Nedoplatek</>
                        ) : (
                          <><CheckCircle className="h-5 w-5" /> Vyrovnáno</>
                        )}
                      </span>
                      <span>{formatCZK(rzResult.castka)}</span>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ELDP Tab */}
        <TabsContent value="eldp" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Evidenční list důchodového pojištění</CardTitle>
              <CardDescription>
                ELDP se generuje pro každého zaměstnance za rok {year}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {employees.length === 0 ? (
                <div className="py-4 text-center text-muted-foreground">
                  <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  Žádní zaměstnanci. Nejprve přidejte zaměstnance v sekci "Zaměstnanci".
                </div>
              ) : (<>
              <div>
                <Label>Zaměstnanec</Label>
                <Select value={eldpEmployee} onValueChange={setEldpEmployee}>
                  <SelectTrigger>
                    <SelectValue placeholder="Vyberte zaměstnance" />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((emp) => (
                      <SelectItem key={emp.id} value={String(emp.id)}>
                        {emp.name} ({emp.osobni_cislo || `#${emp.id}`})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex gap-2">
                <Button onClick={generateEldp} disabled={generatingEldp || !eldpEmployee}>
                  {generatingEldp ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileText className="h-4 w-4 mr-2" />}
                  Vygenerovat ELDP
                </Button>

                {employees.length > 0 && (
                  <Button
                    variant="outline"
                    disabled={generatingAllEldp}
                    onClick={async () => {
                      setGeneratingAllEldp(true);
                      let success = 0;
                      let failed = 0;
                      for (const emp of employees) {
                        try {
                          const res = await apiClient.authenticatedFetch("/v2/annual/eldp", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ year, employee_id: emp.id }),
                          });
                          if (res.ok) success++;
                          else failed++;
                        } catch { failed++; }
                      }
                      setGeneratingAllEldp(false);
                      toast({
                        title: "Hotovo",
                        description: `ELDP vygenerovány: ${success} úspěšně${failed > 0 ? `, ${failed} chyb` : ''}`,
                        variant: failed > 0 ? "destructive" : undefined,
                      });
                      loadRecords();
                    }}
                  >
                    {generatingAllEldp ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Users className="h-4 w-4 mr-2" />}
                    Generovat pro všechny ({employees.length})
                  </Button>
                )}
              </div>
              </>)}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Přehledy OSVČ Tab */}
        {entityType === 'osvc' && (
          <TabsContent value="prehledy" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Přehledy pro OSVČ</CardTitle>
                <CardDescription>
                  Přehled o příjmech a výdajích pro OSSZ a ZP za rok {year}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Button
                    onClick={async () => {
                      setGeneratingOSSZ(true);
                      setPrehledResult(null);
                      try {
                        const res = await apiClient.authenticatedFetch("/v2/annual/prehled-ossz", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ year }),
                        });
                        const data = await res.json();
                        if (res.ok) {
                          setPrehledResult(data.result);
                          toast({ title: "Přehled OSSZ vygenerován" });
                          loadRecords();
                        } else {
                          toast({ title: "Chyba", description: data.error, variant: "destructive" });
                        }
                      } catch {
                        toast({ title: "Chyba", description: "Generování selhalo", variant: "destructive" });
                      } finally {
                        setGeneratingOSSZ(false);
                      }
                    }}
                    disabled={generatingOSSZ}
                    variant="outline"
                    className="h-auto py-4"
                  >
                    <div className="text-left">
                      {generatingOSSZ ? <Loader2 className="h-5 w-5 animate-spin mb-1" /> : <Building2 className="h-5 w-5 mb-1" />}
                      <div className="font-medium">Přehled OSSZ</div>
                      <div className="text-xs text-muted-foreground">Sociální pojištění</div>
                    </div>
                  </Button>

                  <Button
                    onClick={async () => {
                      setGeneratingZP(true);
                      setPrehledResult(null);
                      try {
                        const res = await apiClient.authenticatedFetch("/v2/annual/prehled-zp", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ year }),
                        });
                        const data = await res.json();
                        if (res.ok) {
                          setPrehledResult(data.result);
                          toast({ title: "Přehled ZP vygenerován" });
                          loadRecords();
                        } else {
                          toast({ title: "Chyba", description: data.error, variant: "destructive" });
                        }
                      } catch {
                        toast({ title: "Chyba", description: "Generování selhalo", variant: "destructive" });
                      } finally {
                        setGeneratingZP(false);
                      }
                    }}
                    disabled={generatingZP}
                    variant="outline"
                    className="h-auto py-4"
                  >
                    <div className="text-left">
                      {generatingZP ? <Loader2 className="h-5 w-5 animate-spin mb-1" /> : <Building2 className="h-5 w-5 mb-1" />}
                      <div className="font-medium">Přehled ZP</div>
                      <div className="text-xs text-muted-foreground">Zdravotní pojištění</div>
                    </div>
                  </Button>
                </div>

                {prehledResult && (
                  <div className="mt-4 border rounded-lg p-4 space-y-3">
                    <h3 className="font-semibold text-lg">Výsledek přehledu</h3>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {(prehledResult as Record<string, unknown>).prijmy !== undefined && (
                        <>
                          <div className="text-muted-foreground">Příjmy</div>
                          <div className="text-right font-mono">{formatCZK(Number((prehledResult as Record<string, unknown>).prijmy))}</div>
                        </>
                      )}
                      {(prehledResult as Record<string, unknown>).vydaje !== undefined && (
                        <>
                          <div className="text-muted-foreground">Výdaje</div>
                          <div className="text-right font-mono">{formatCZK(Number((prehledResult as Record<string, unknown>).vydaje))}</div>
                        </>
                      )}
                      {(prehledResult as Record<string, unknown>).pojistne !== undefined && (
                        <>
                          <div className="text-muted-foreground">Pojistné</div>
                          <div className="text-right font-mono">{formatCZK(Number((prehledResult as Record<string, unknown>).pojistne))}</div>
                        </>
                      )}
                      {(prehledResult as Record<string, unknown>).zaplaceneZalohy !== undefined && (
                        <>
                          <div className="text-muted-foreground">Zaplacené zálohy</div>
                          <div className="text-right font-mono">{formatCZK(Number((prehledResult as Record<string, unknown>).zaplaceneZalohy))}</div>
                        </>
                      )}
                    </div>
                    <div className="border-t pt-3">
                      <div className={`flex items-center justify-between text-lg font-bold ${
                        (prehledResult as Record<string, unknown>).vysledek === 'preplatek' ? 'text-green-600' :
                        (prehledResult as Record<string, unknown>).vysledek === 'doplatek' ? 'text-red-500' : ''
                      }`}>
                        <span>
                          {(prehledResult as Record<string, unknown>).vysledek === 'preplatek' ? 'Přeplatek' :
                           (prehledResult as Record<string, unknown>).vysledek === 'doplatek' ? 'Doplatek' : 'Vyrovnáno'}
                        </span>
                        <span>{formatCZK(Number((prehledResult as Record<string, unknown>).castka))}</span>
                      </div>
                      {(prehledResult as Record<string, unknown>).novaZaloha && (
                        <p className="text-sm text-muted-foreground mt-2">
                          Nová výše zálohy: {formatCZK(Number((prehledResult as Record<string, unknown>).novaZaloha))} / měsíc
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
