// ====================================
// 📊 Accounting & CZ System Export Page
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
  BookOpen, Plus, Download, RefreshCw, FileSpreadsheet,
  ArrowRightLeft, Settings2, FileText, Calculator,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const ACCOUNT_TYPES = [
  { value: "asset", label: "Aktiva" },
  { value: "liability", label: "Pasiva" },
  { value: "equity", label: "Vlastní kapitál" },
  { value: "revenue", label: "Výnosy" },
  { value: "expense", label: "Náklady" },
];

const PAYROLL_COMPONENTS = [
  { value: "gross_salary", label: "Hrubá mzda" },
  { value: "sp_employee", label: "SP zaměstnanec" },
  { value: "zp_employee", label: "ZP zaměstnanec" },
  { value: "tax", label: "Záloha na daň" },
  { value: "sp_employer", label: "SP zaměstnavatel" },
  { value: "zp_employer", label: "ZP zaměstnavatel" },
  { value: "net_salary", label: "Čistá mzda" },
  { value: "meal_voucher_employer", label: "Stravenky zaměstnavatel" },
  { value: "pension_contribution", label: "Penzijní připojištění" },
  { value: "life_insurance", label: "Životní pojištění" },
  { value: "commission", label: "Provize" },
  { value: "bonus", label: "Bonus/prémie" },
  { value: "vacation_payout", label: "Proplacení dovolené" },
  { value: "severance", label: "Odstupné" },
  { value: "sick_leave", label: "Nemocenská" },
  { value: "other", label: "Ostatní" },
];

interface Account {
  id: number;
  uuid: string;
  account_number: string;
  name: string;
  type: string;
  parent_account: string | null;
}

interface Mapping {
  id: number;
  uuid: string;
  payroll_component: string;
  debit_account: string;
  credit_account: string;
  cost_center_code: string | null;
  description: string | null;
}

interface JournalEntry {
  id: number;
  uuid: string;
  entry_date: string;
  description: string;
  total_debit_czk: number;
  total_credit_czk: number;
  status: string;
  exported_to: string | null;
}

export default function Accounting() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"chart" | "mappings" | "journal" | "export">("chart");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [acctDialogOpen, setAcctDialogOpen] = useState(false);
  const [mapDialogOpen, setMapDialogOpen] = useState(false);

  const now = new Date();
  const [exportYear, setExportYear] = useState(now.getFullYear());
  const [exportMonth, setExportMonth] = useState(now.getMonth() + 1);
  const [journalYear, setJournalYear] = useState(now.getFullYear());
  const [journalMonth, setJournalMonth] = useState(now.getMonth() + 1);

  // Form states
  const [acctForm, setAcctForm] = useState({ account_number: "", name: "", type: "expense", parent_account: "" });
  const [mapForm, setMapForm] = useState({ payroll_component: "gross_salary", debit_account: "", credit_account: "", description: "" });

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await apiClient.authenticatedFetch("/v2/accounting/chart");
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts || []);
      }
    } catch (error) {
      console.error("Failed to fetch chart:", error);
    }
  }, []);

  const fetchMappings = useCallback(async () => {
    try {
      const res = await apiClient.authenticatedFetch("/v2/accounting/mappings");
      if (res.ok) {
        const data = await res.json();
        setMappings(data.mappings || []);
      }
    } catch (error) {
      console.error("Failed to fetch mappings:", error);
    }
  }, []);

  const fetchJournal = useCallback(async () => {
    try {
      const res = await apiClient.authenticatedFetch(`/v2/accounting/journal?year=${journalYear}&month=${journalMonth}`);
      if (res.ok) {
        const data = await res.json();
        setJournal(data.journal_entries || []);
      }
    } catch (error) {
      console.error("Failed to fetch journal:", error);
    }
  }, [journalYear, journalMonth]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchAccounts(), fetchMappings(), fetchJournal()]).finally(() => setLoading(false));
  }, [fetchAccounts, fetchMappings, fetchJournal]);

  const createAccount = async () => {
    try {
      const payload: any = {
        account_number: acctForm.account_number,
        name: acctForm.name,
        type: acctForm.type,
      };
      if (acctForm.parent_account) payload.parent_account = acctForm.parent_account;

      const res = await apiClient.authenticatedFetch("/v2/accounting/chart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        toast({ title: "Účet vytvořen" });
        setAcctDialogOpen(false);
        setAcctForm({ account_number: "", name: "", type: "expense", parent_account: "" });
        fetchAccounts();
      } else {
        const err = await res.json();
        toast({ title: "Chyba", description: err.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba při vytváření účtu", variant: "destructive" });
    }
  };

  const createMapping = async () => {
    try {
      const payload: any = {
        payroll_component: mapForm.payroll_component,
        debit_account: mapForm.debit_account,
        credit_account: mapForm.credit_account,
      };
      if (mapForm.description) payload.description = mapForm.description;

      const res = await apiClient.authenticatedFetch("/v2/accounting/mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        toast({ title: "Předkontace vytvořena" });
        setMapDialogOpen(false);
        setMapForm({ payroll_component: "gross_salary", debit_account: "", credit_account: "", description: "" });
        fetchMappings();
      } else {
        const err = await res.json();
        toast({ title: "Chyba", description: err.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba při vytváření předkontace", variant: "destructive" });
    }
  };

  const seedDefaults = async () => {
    try {
      const res = await apiClient.authenticatedFetch("/v2/accounting/mappings/seed-defaults", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        toast({ title: "Výchozí předkontace vytvořeny", description: data.message });
        fetchMappings();
      }
    } catch {
      toast({ title: "Chyba", variant: "destructive" });
    }
  };

  const generateJournal = async () => {
    try {
      const res = await apiClient.authenticatedFetch(`/v2/accounting/journal/generate/${exportYear}/${exportMonth}`, {
        method: "POST",
      });
      if (res.ok) {
        toast({ title: "Účetní zápisy vygenerovány" });
        fetchJournal();
      } else {
        const err = await res.json();
        toast({ title: "Chyba", description: err.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba při generování zápisů", variant: "destructive" });
    }
  };

  const exportData = async (format: "pohoda" | "moneys3" | "csv") => {
    try {
      const res = await apiClient.authenticatedFetch(`/v2/accounting/export/${format}/${exportYear}/${exportMonth}`, {
        method: "POST",
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const ext = format === "csv" ? "csv" : "xml";
        a.href = url;
        a.download = `${format}-mzdy-${exportYear}-${String(exportMonth).padStart(2, "0")}.${ext}`;
        a.click();
        URL.revokeObjectURL(url);
        toast({ title: `Export ${format.toUpperCase()} stažen` });
      } else {
        const err = await res.json().catch(() => ({ error: "Chyba exportu" }));
        toast({ title: "Chyba", description: err.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba při exportu", variant: "destructive" });
    }
  };

  const getTypeLabel = (type: string) => ACCOUNT_TYPES.find(t => t.value === type)?.label || type;
  const getComponentLabel = (comp: string) => PAYROLL_COMPONENTS.find(c => c.value === comp)?.label || comp;
  const monthName = (m: number) => ["", "Leden", "Únor", "Březen", "Duben", "Květen", "Červen", "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec"][m] || "";

  const statusBadge = (status: string) => {
    const map: Record<string, "default" | "outline" | "secondary" | "destructive"> = {
      draft: "outline", posted: "default", exported: "default", voided: "destructive",
    };
    const labels: Record<string, string> = {
      draft: "Koncept", posted: "Zaúčtováno", exported: "Exportováno", voided: "Stornováno",
    };
    return <Badge variant={map[status] || "secondary"}>{labels[status] || status}</Badge>;
  };

  const tabs = [
    { id: "chart" as const, label: "Účtový rozvrh", icon: BookOpen },
    { id: "mappings" as const, label: "Předkontace", icon: ArrowRightLeft },
    { id: "journal" as const, label: "Účetní zápisy", icon: FileSpreadsheet },
    { id: "export" as const, label: "Export", icon: Download },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Účetnictví</h1>
          <p className="text-muted-foreground">Účtový rozvrh, předkontace, zaúčtování a export</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { fetchAccounts(); fetchMappings(); fetchJournal(); }}>
          <RefreshCw className="h-4 w-4 mr-1" /> Obnovit
        </Button>
      </div>

      <div className="flex gap-1 border-b pb-1 flex-wrap">
        {tabs.map(tab => (
          <Button key={tab.id} variant={activeTab === tab.id ? "default" : "ghost"} size="sm" onClick={() => setActiveTab(tab.id)}>
            <tab.icon className="h-4 w-4 mr-1" /> {tab.label}
          </Button>
        ))}
      </div>

      {/* Chart of Accounts Tab */}
      {activeTab === "chart" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Dialog open={acctDialogOpen} onOpenChange={setAcctDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nový účet</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Přidat účet do rozvrhu</DialogTitle></DialogHeader>
                <div className="space-y-4 mt-2">
                  <div><Label>Číslo účtu</Label><Input value={acctForm.account_number} onChange={e => setAcctForm(p => ({ ...p, account_number: e.target.value }))} placeholder="521, 331..." /></div>
                  <div><Label>Název</Label><Input value={acctForm.name} onChange={e => setAcctForm(p => ({ ...p, name: e.target.value }))} placeholder="Mzdové náklady" /></div>
                  <div>
                    <Label>Typ</Label>
                    <Select value={acctForm.type} onValueChange={v => setAcctForm(p => ({ ...p, type: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ACCOUNT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Nadřazený účet</Label><Input value={acctForm.parent_account} onChange={e => setAcctForm(p => ({ ...p, parent_account: e.target.value }))} placeholder="Volitelné" /></div>
                  <Button onClick={createAccount} disabled={!acctForm.account_number || !acctForm.name} className="w-full">Přidat</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {loading ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Načítání...</CardContent></Card>
          ) : accounts.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <BookOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">Prázdný účtový rozvrh</h3>
                <p className="text-muted-foreground mb-4">Přidejte účty pro mzdové účetnictví.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="text-left p-3 font-medium">Číslo</th>
                    <th className="text-left p-3 font-medium">Název</th>
                    <th className="text-left p-3 font-medium">Typ</th>
                    <th className="text-left p-3 font-medium">Nadřazený</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map(acct => (
                    <tr key={acct.uuid} className="border-t hover:bg-muted/50">
                      <td className="p-3 font-mono font-medium">{acct.account_number}</td>
                      <td className="p-3">{acct.name}</td>
                      <td className="p-3"><Badge variant="outline">{getTypeLabel(acct.type)}</Badge></td>
                      <td className="p-3 text-muted-foreground">{acct.parent_account || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Mappings Tab */}
      {activeTab === "mappings" && (
        <div className="space-y-4">
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={seedDefaults}>
              <Settings2 className="h-4 w-4 mr-1" /> Výchozí předkontace
            </Button>
            <Dialog open={mapDialogOpen} onOpenChange={setMapDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nová předkontace</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Vytvořit předkontaci</DialogTitle></DialogHeader>
                <div className="space-y-4 mt-2">
                  <div>
                    <Label>Mzdová složka</Label>
                    <Select value={mapForm.payroll_component} onValueChange={v => setMapForm(p => ({ ...p, payroll_component: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PAYROLL_COMPONENTS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>MD (Debet)</Label><Input value={mapForm.debit_account} onChange={e => setMapForm(p => ({ ...p, debit_account: e.target.value }))} placeholder="521" /></div>
                  <div><Label>DAL (Kredit)</Label><Input value={mapForm.credit_account} onChange={e => setMapForm(p => ({ ...p, credit_account: e.target.value }))} placeholder="331" /></div>
                  <div><Label>Popis</Label><Input value={mapForm.description} onChange={e => setMapForm(p => ({ ...p, description: e.target.value }))} placeholder="Volitelné" /></div>
                  <Button onClick={createMapping} disabled={!mapForm.debit_account || !mapForm.credit_account} className="w-full">Vytvořit</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {mappings.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <ArrowRightLeft className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">Žádné předkontace</h3>
                <p className="text-muted-foreground mb-4">Vytvořte předkontace nebo načtěte výchozí nastavení.</p>
                <Button onClick={seedDefaults}><Settings2 className="h-4 w-4 mr-1" /> Načíst výchozí</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="text-left p-3 font-medium">Složka</th>
                    <th className="text-left p-3 font-medium">MD</th>
                    <th className="text-left p-3 font-medium">DAL</th>
                    <th className="text-left p-3 font-medium">Popis</th>
                  </tr>
                </thead>
                <tbody>
                  {mappings.map(m => (
                    <tr key={m.uuid} className="border-t hover:bg-muted/50">
                      <td className="p-3 font-medium">{getComponentLabel(m.payroll_component)}</td>
                      <td className="p-3 font-mono">{m.debit_account}</td>
                      <td className="p-3 font-mono">{m.credit_account}</td>
                      <td className="p-3 text-muted-foreground">{m.description || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Journal Entries Tab */}
      {activeTab === "journal" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Select value={String(journalMonth)} onValueChange={v => setJournalMonth(parseInt(v))}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 12 }, (_, i) => (
                    <SelectItem key={i + 1} value={String(i + 1)}>{monthName(i + 1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={String(journalYear)} onValueChange={v => setJournalYear(parseInt(v))}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[2023, 2024, 2025, 2026].map(y => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" onClick={generateJournal}>
              <Calculator className="h-4 w-4 mr-1" /> Generovat zápisy
            </Button>
          </div>

          {journal.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <FileSpreadsheet className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">Žádné účetní zápisy</h3>
                <p className="text-muted-foreground mb-4">Vygenerujte účetní zápisy z uzavřeného mzdového období.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {journal.map(entry => (
                <Card key={entry.uuid}>
                  <CardContent className="py-3 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <FileSpreadsheet className="h-5 w-5 text-blue-600" />
                      <div>
                        <p className="font-medium">{entry.description}</p>
                        <p className="text-sm text-muted-foreground">
                          {entry.entry_date} · MD: {entry.total_debit_czk?.toLocaleString("cs-CZ")} Kč / DAL: {entry.total_credit_czk?.toLocaleString("cs-CZ")} Kč
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {statusBadge(entry.status)}
                      {entry.exported_to && <Badge variant="outline">{entry.exported_to}</Badge>}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Export Tab */}
      {activeTab === "export" && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Download className="h-5 w-5" /> Export mzdových dat</CardTitle>
              <CardDescription>Export účetních zápisů do českých účetních systémů</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center gap-4">
                <div>
                  <Label>Období</Label>
                  <div className="flex gap-2 mt-1">
                    <Select value={String(exportMonth)} onValueChange={v => setExportMonth(parseInt(v))}>
                      <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 12 }, (_, i) => (
                          <SelectItem key={i + 1} value={String(i + 1)}>{monthName(i + 1)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={String(exportYear)} onValueChange={v => setExportYear(parseInt(v))}>
                      <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {[2023, 2024, 2025, 2026].map(y => (
                          <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <Card className="border-2 hover:border-primary transition-colors cursor-pointer" onClick={() => exportData("pohoda")}>
                  <CardContent className="pt-6 text-center">
                    <FileText className="h-10 w-10 mx-auto mb-3 text-blue-600" />
                    <h3 className="font-medium">Pohoda XML</h3>
                    <p className="text-sm text-muted-foreground mt-1">Import do Stormware Pohoda</p>
                    <Button variant="outline" size="sm" className="mt-3">
                      <Download className="h-4 w-4 mr-1" /> Stáhnout
                    </Button>
                  </CardContent>
                </Card>

                <Card className="border-2 hover:border-primary transition-colors cursor-pointer" onClick={() => exportData("moneys3")}>
                  <CardContent className="pt-6 text-center">
                    <FileText className="h-10 w-10 mx-auto mb-3 text-green-600" />
                    <h3 className="font-medium">Money S3</h3>
                    <p className="text-sm text-muted-foreground mt-1">Import do Cígler Money S3</p>
                    <Button variant="outline" size="sm" className="mt-3">
                      <Download className="h-4 w-4 mr-1" /> Stáhnout
                    </Button>
                  </CardContent>
                </Card>

                <Card className="border-2 hover:border-primary transition-colors cursor-pointer" onClick={() => exportData("csv")}>
                  <CardContent className="pt-6 text-center">
                    <FileSpreadsheet className="h-10 w-10 mx-auto mb-3 text-orange-600" />
                    <h3 className="font-medium">CSV Export</h3>
                    <p className="text-sm text-muted-foreground mt-1">Univerzální CSV pro libovolný systém</p>
                    <Button variant="outline" size="sm" className="mt-3">
                      <Download className="h-4 w-4 mr-1" /> Stáhnout
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
