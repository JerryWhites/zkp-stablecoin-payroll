// ====================================
// 📋 Onboarding & Offboarding Page
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
  UserPlus, UserMinus, Plus, ClipboardList, CheckCircle,
  Circle, RefreshCw, FileText, Calendar,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface OnboardingTemplate {
  id: number;
  uuid: string;
  name: string;
  description: string | null;
  contract_type: string;
  checklist_items: { id: number; title: string; required: boolean; category: string }[];
  is_active: boolean;
}

interface OnboardingProcess {
  id: number;
  uuid: string;
  employee_name: string;
  employee_uuid: string;
  type: "onboarding" | "offboarding";
  status: string;
  checklist_progress: { id: number; title: string; completed: boolean; category: string }[];
  assigned_to_email: string | null;
  created_at: string;
}

const CATEGORIES = [
  { value: "document", label: "Dokumenty" },
  { value: "access", label: "Přístupy" },
  { value: "equipment", label: "Vybavení" },
  { value: "training", label: "Školení" },
  { value: "admin", label: "Administrativa" },
  { value: "other", label: "Ostatní" },
];

export default function Onboarding() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"processes" | "templates">("processes");
  const [templates, setTemplates] = useState<OnboardingTemplate[]>([]);
  const [processes, setProcesses] = useState<OnboardingProcess[]>([]);
  const [loading, setLoading] = useState(true);
  const [tmplDialogOpen, setTmplDialogOpen] = useState(false);
  const [startDialogOpen, setStartDialogOpen] = useState(false);
  const [filterType, setFilterType] = useState<string>("");

  // Template form
  const [tmplForm, setTmplForm] = useState({
    name: "", description: "", contract_type: "all",
    checklist_items: [{ title: "", required: true, category: "admin" }],
  });

  // Start process form
  const [startForm, setStartForm] = useState({
    employee_uuid: "", template_uuid: "", type: "onboarding" as "onboarding" | "offboarding",
  });

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await apiClient.authenticatedFetch("/v2/onboarding/templates");
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates || []);
      }
    } catch (error) {
      console.error("Failed to fetch templates:", error);
    }
  }, []);

  const fetchProcesses = useCallback(async () => {
    try {
      let url = "/v2/onboarding";
      if (filterType) url += `?type=${filterType}`;
      const res = await apiClient.authenticatedFetch(url);
      if (res.ok) {
        const data = await res.json();
        setProcesses(data.processes || []);
      }
    } catch (error) {
      console.error("Failed to fetch processes:", error);
    }
  }, [filterType]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchTemplates(), fetchProcesses()]).finally(() => setLoading(false));
  }, [fetchTemplates, fetchProcesses]);

  const createTemplate = async () => {
    try {
      const items = tmplForm.checklist_items.filter(i => i.title.trim());
      if (items.length === 0) {
        toast({ title: "Přidejte alespoň jednu položku", variant: "destructive" });
        return;
      }
      const res = await apiClient.authenticatedFetch("/v2/onboarding/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: tmplForm.name,
          description: tmplForm.description || undefined,
          contract_type: tmplForm.contract_type,
          checklist_items: items,
        }),
      });
      if (res.ok) {
        toast({ title: "Šablona vytvořena" });
        setTmplDialogOpen(false);
        setTmplForm({ name: "", description: "", contract_type: "all", checklist_items: [{ title: "", required: true, category: "admin" }] });
        fetchTemplates();
      } else {
        const err = await res.json();
        toast({ title: "Chyba", description: err.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba při vytváření šablony", variant: "destructive" });
    }
  };

  const startProcess = async () => {
    try {
      const payload: any = {
        employee_uuid: startForm.employee_uuid,
        type: startForm.type,
      };
      if (startForm.template_uuid) payload.template_uuid = startForm.template_uuid;

      const res = await apiClient.authenticatedFetch("/v2/onboarding/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        toast({ title: startForm.type === "onboarding" ? "Nástup zahájen" : "Odchod zahájen" });
        setStartDialogOpen(false);
        setStartForm({ employee_uuid: "", template_uuid: "", type: "onboarding" });
        fetchProcesses();
      } else {
        const err = await res.json();
        toast({ title: "Chyba", description: err.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba při zahájení procesu", variant: "destructive" });
    }
  };

  const toggleChecklistItem = async (processUuid: string, itemId: number, completed: boolean) => {
    try {
      const res = await apiClient.authenticatedFetch(`/v2/onboarding/${processUuid}/checklist/${itemId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed }),
      });
      if (res.ok) {
        fetchProcesses();
      }
    } catch {
      toast({ title: "Chyba při aktualizaci", variant: "destructive" });
    }
  };

  const addChecklistItem = () => {
    setTmplForm(p => ({
      ...p,
      checklist_items: [...p.checklist_items, { title: "", required: true, category: "admin" }],
    }));
  };

  const getProgressPct = (items: { completed: boolean }[]) => {
    if (!items || items.length === 0) return 0;
    return Math.round((items.filter(i => i.completed).length / items.length) * 100);
  };

  const statusBadge = (status: string) => {
    const map: Record<string, "default" | "outline" | "secondary" | "destructive"> = {
      not_started: "outline", in_progress: "secondary", completed: "default", cancelled: "destructive",
    };
    const labels: Record<string, string> = {
      not_started: "Nezahájeno", in_progress: "Probíhá", completed: "Dokončeno", cancelled: "Zrušeno",
    };
    return <Badge variant={map[status] || "secondary"}>{labels[status] || status}</Badge>;
  };

  const tabs = [
    { id: "processes" as const, label: "Procesy", icon: ClipboardList },
    { id: "templates" as const, label: "Šablony", icon: FileText },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Nástup & Odchod</h1>
          <p className="text-muted-foreground">Onboarding a offboarding zaměstnanců</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { fetchTemplates(); fetchProcesses(); }}>
            <RefreshCw className="h-4 w-4 mr-1" /> Obnovit
          </Button>
          <Dialog open={startDialogOpen} onOpenChange={setStartDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><UserPlus className="h-4 w-4 mr-1" /> Zahájit proces</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Zahájit nástup / odchod</DialogTitle></DialogHeader>
              <div className="space-y-4 mt-2">
                <div><Label>UUID zaměstnance</Label><Input value={startForm.employee_uuid} onChange={e => setStartForm(p => ({ ...p, employee_uuid: e.target.value }))} placeholder="UUID zaměstnance" /></div>
                <div>
                  <Label>Typ</Label>
                  <Select value={startForm.type} onValueChange={v => setStartForm(p => ({ ...p, type: v as any }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="onboarding">Nástup (Onboarding)</SelectItem>
                      <SelectItem value="offboarding">Odchod (Offboarding)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {templates.length > 0 && (
                  <div>
                    <Label>Šablona (volitelné)</Label>
                    <Select value={startForm.template_uuid} onValueChange={v => setStartForm(p => ({ ...p, template_uuid: v }))}>
                      <SelectTrigger><SelectValue placeholder="Výchozí checklist" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">Výchozí</SelectItem>
                        {templates.map(t => <SelectItem key={t.uuid} value={t.uuid}>{t.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <Button onClick={startProcess} disabled={!startForm.employee_uuid} className="w-full">Zahájit</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex gap-1 border-b pb-1">
        {tabs.map(tab => (
          <Button key={tab.id} variant={activeTab === tab.id ? "default" : "ghost"} size="sm" onClick={() => setActiveTab(tab.id)}>
            <tab.icon className="h-4 w-4 mr-1" /> {tab.label}
          </Button>
        ))}
      </div>

      {/* Processes Tab */}
      {activeTab === "processes" && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button size="sm" variant={filterType === "" ? "default" : "ghost"} onClick={() => setFilterType("")}>Vše</Button>
            <Button size="sm" variant={filterType === "onboarding" ? "default" : "ghost"} onClick={() => setFilterType("onboarding")}>
              <UserPlus className="h-4 w-4 mr-1" /> Nástupy
            </Button>
            <Button size="sm" variant={filterType === "offboarding" ? "default" : "ghost"} onClick={() => setFilterType("offboarding")}>
              <UserMinus className="h-4 w-4 mr-1" /> Odchody
            </Button>
          </div>

          {loading ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Načítání...</CardContent></Card>
          ) : processes.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <ClipboardList className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">Žádné aktivní procesy</h3>
                <p className="text-muted-foreground mb-4">Zahajte nástup nebo odchod zaměstnance.</p>
                <Button onClick={() => setStartDialogOpen(true)}><UserPlus className="h-4 w-4 mr-1" /> Zahájit proces</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {processes.map(proc => {
                const pct = getProgressPct(proc.checklist_progress || []);
                return (
                  <Card key={proc.uuid}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {proc.type === "onboarding" ? <UserPlus className="h-5 w-5 text-green-600" /> : <UserMinus className="h-5 w-5 text-orange-600" />}
                          <div>
                            <CardTitle className="text-base">{proc.employee_name}</CardTitle>
                            <CardDescription>{proc.type === "onboarding" ? "Nástup" : "Odchod"} · {new Date(proc.created_at).toLocaleDateString("cs-CZ")}</CardDescription>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{pct}%</span>
                          {statusBadge(proc.status)}
                        </div>
                      </div>
                      {/* Progress bar */}
                      <div className="w-full bg-muted rounded-full h-2 mt-2">
                        <div className="bg-primary rounded-full h-2 transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </CardHeader>
                    <CardContent>
                      {proc.checklist_progress && proc.checklist_progress.length > 0 && (
                        <div className="space-y-1 text-sm">
                          {proc.checklist_progress.map(item => (
                            <div key={item.id} className="flex items-center gap-2 py-1">
                              <button
                                onClick={() => toggleChecklistItem(proc.uuid, item.id, !item.completed)}
                                className="flex-shrink-0"
                              >
                                {item.completed ? (
                                  <CheckCircle className="h-4 w-4 text-green-600" />
                                ) : (
                                  <Circle className="h-4 w-4 text-muted-foreground" />
                                )}
                              </button>
                              <span className={item.completed ? "line-through text-muted-foreground" : ""}>
                                {item.title}
                              </span>
                              <Badge variant="outline" className="text-xs ml-auto">
                                {CATEGORIES.find(c => c.value === item.category)?.label || item.category}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Templates Tab */}
      {activeTab === "templates" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Dialog open={tmplDialogOpen} onOpenChange={setTmplDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nová šablona</Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
                <DialogHeader><DialogTitle>Vytvořit šablonu checklistu</DialogTitle></DialogHeader>
                <div className="space-y-4 mt-2">
                  <div><Label>Název</Label><Input value={tmplForm.name} onChange={e => setTmplForm(p => ({ ...p, name: e.target.value }))} placeholder="Název šablony" /></div>
                  <div><Label>Popis</Label><Input value={tmplForm.description} onChange={e => setTmplForm(p => ({ ...p, description: e.target.value }))} placeholder="Volitelný popis" /></div>
                  <div>
                    <Label>Typ smlouvy</Label>
                    <Select value={tmplForm.contract_type} onValueChange={v => setTmplForm(p => ({ ...p, contract_type: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Vše</SelectItem>
                        <SelectItem value="HPP">HPP</SelectItem>
                        <SelectItem value="DPP">DPP</SelectItem>
                        <SelectItem value="DPC">DPČ</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="mb-2 block">Položky checklistu</Label>
                    {tmplForm.checklist_items.map((item, idx) => (
                      <div key={idx} className="flex gap-2 mb-2">
                        <Input
                          value={item.title}
                          onChange={e => {
                            const items = [...tmplForm.checklist_items];
                            items[idx] = { ...items[idx], title: e.target.value };
                            setTmplForm(p => ({ ...p, checklist_items: items }));
                          }}
                          placeholder={`Položka ${idx + 1}`}
                          className="flex-1"
                        />
                        <Select
                          value={item.category}
                          onValueChange={v => {
                            const items = [...tmplForm.checklist_items];
                            items[idx] = { ...items[idx], category: v };
                            setTmplForm(p => ({ ...p, checklist_items: items }));
                          }}
                        >
                          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                    <Button variant="outline" size="sm" onClick={addChecklistItem}><Plus className="h-3 w-3 mr-1" /> Další položka</Button>
                  </div>
                  <Button onClick={createTemplate} disabled={!tmplForm.name} className="w-full">Vytvořit šablonu</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {templates.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">Žádné šablony</h3>
                <p className="text-muted-foreground mb-4">Vytvořte šablony checklistů pro standardizovaný nástup/odchod.</p>
                <Button onClick={() => setTmplDialogOpen(true)}><Plus className="h-4 w-4 mr-1" /> Nová šablona</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {templates.map(tmpl => (
                <Card key={tmpl.uuid}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{tmpl.name}</CardTitle>
                      <Badge variant="outline">{tmpl.contract_type === "all" ? "Vše" : tmpl.contract_type}</Badge>
                    </div>
                    {tmpl.description && <CardDescription>{tmpl.description}</CardDescription>}
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1 text-sm">
                      {tmpl.checklist_items?.map((item, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <Circle className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                          <span>{item.title}</span>
                          {item.required && <Badge variant="destructive" className="text-[10px] px-1">Povinné</Badge>}
                        </div>
                      ))}
                      <p className="text-muted-foreground mt-2">{tmpl.checklist_items?.length || 0} položek</p>
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
