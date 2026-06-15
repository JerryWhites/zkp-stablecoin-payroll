// ====================================
// 🏢 Organization & Structure Page
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
  Building2, Plus, Users, Layers, DollarSign, History,
  Network, RefreshCw, FolderTree,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

interface Department {
  id: number;
  uuid: string;
  name: string;
  code: string | null;
  manager_name: string | null;
  parent_name: string | null;
  employee_count: number;
  is_active: boolean;
  cost_center_code: string | null;
}

interface CostCenter {
  id: number;
  uuid: string;
  code: string;
  name: string;
  budget_czk: number | null;
  is_active: boolean;
}

interface PayGrade {
  id: number;
  uuid: string;
  grade_code: string;
  name: string;
  min_salary_czk: number;
  max_salary_czk: number;
  midpoint_czk: number;
}

export default function Organization() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"departments" | "cost-centers" | "pay-grades" | "org-chart">("departments");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [payGrades, setPayGrades] = useState<PayGrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [deptDialogOpen, setDeptDialogOpen] = useState(false);
  const [ccDialogOpen, setCcDialogOpen] = useState(false);
  const [pgDialogOpen, setPgDialogOpen] = useState(false);

  // Form states
  const [deptForm, setDeptForm] = useState({ name: "", code: "", cost_center_code: "" });
  const [ccForm, setCcForm] = useState({ code: "", name: "", budget_czk: "" });
  const [pgForm, setPgForm] = useState({ grade_code: "", name: "", min_salary_czk: "", max_salary_czk: "" });

  const fetchDepartments = useCallback(async () => {
    try {
      const res = await apiClient.authenticatedFetch("/v2/organization/departments");
      if (res.ok) {
        const data = await res.json();
        setDepartments(data.departments || []);
      }
    } catch (error) {
      console.error("Failed to fetch departments:", error);
    }
  }, []);

  const fetchCostCenters = useCallback(async () => {
    try {
      const res = await apiClient.authenticatedFetch("/v2/organization/cost-centers");
      if (res.ok) {
        const data = await res.json();
        setCostCenters(data.cost_centers || []);
      }
    } catch (error) {
      console.error("Failed to fetch cost centers:", error);
    }
  }, []);

  const fetchPayGrades = useCallback(async () => {
    try {
      const res = await apiClient.authenticatedFetch("/v2/organization/pay-grades");
      if (res.ok) {
        const data = await res.json();
        setPayGrades(data.pay_grades || []);
      }
    } catch (error) {
      console.error("Failed to fetch pay grades:", error);
    }
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchDepartments(), fetchCostCenters(), fetchPayGrades()]);
    setLoading(false);
  }, [fetchDepartments, fetchCostCenters, fetchPayGrades]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const createDepartment = async () => {
    try {
      const res = await apiClient.authenticatedFetch("/v2/organization/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(deptForm),
      });
      if (res.ok) {
        toast({ title: "Oddělení vytvořeno" });
        setDeptDialogOpen(false);
        setDeptForm({ name: "", code: "", cost_center_code: "" });
        fetchDepartments();
      } else {
        const err = await res.json();
        toast({ title: "Chyba", description: err.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba při vytváření oddělení", variant: "destructive" });
    }
  };

  const createCostCenter = async () => {
    try {
      const payload: any = { code: ccForm.code, name: ccForm.name };
      if (ccForm.budget_czk) payload.budget_czk = parseInt(ccForm.budget_czk);
      const res = await apiClient.authenticatedFetch("/v2/organization/cost-centers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        toast({ title: "Středisko vytvořeno" });
        setCcDialogOpen(false);
        setCcForm({ code: "", name: "", budget_czk: "" });
        fetchCostCenters();
      } else {
        const err = await res.json();
        toast({ title: "Chyba", description: err.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba při vytváření střediska", variant: "destructive" });
    }
  };

  const createPayGrade = async () => {
    try {
      const res = await apiClient.authenticatedFetch("/v2/organization/pay-grades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grade_code: pgForm.grade_code,
          name: pgForm.name,
          min_salary_czk: parseInt(pgForm.min_salary_czk),
          max_salary_czk: parseInt(pgForm.max_salary_czk),
        }),
      });
      if (res.ok) {
        toast({ title: "Platový stupeň vytvořen" });
        setPgDialogOpen(false);
        setPgForm({ grade_code: "", name: "", min_salary_czk: "", max_salary_czk: "" });
        fetchPayGrades();
      } else {
        const err = await res.json();
        toast({ title: "Chyba", description: err.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba při vytváření platového stupně", variant: "destructive" });
    }
  };

  const tabs = [
    { id: "departments" as const, label: "Oddělení", icon: Building2 },
    { id: "cost-centers" as const, label: "Střediska", icon: Layers },
    { id: "pay-grades" as const, label: "Platové stupně", icon: DollarSign },
    { id: "org-chart" as const, label: "Org. schéma", icon: Network },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Organizace</h1>
          <p className="text-muted-foreground">Oddělení, střediska, platové stupně a organizační struktura</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchAll}>
          <RefreshCw className="h-4 w-4 mr-1" /> Obnovit
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b pb-1 flex-wrap">
        {tabs.map(tab => (
          <Button key={tab.id} variant={activeTab === tab.id ? "default" : "ghost"} size="sm" onClick={() => setActiveTab(tab.id)}>
            <tab.icon className="h-4 w-4 mr-1" /> {tab.label}
          </Button>
        ))}
      </div>

      {/* Departments Tab */}
      {activeTab === "departments" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Dialog open={deptDialogOpen} onOpenChange={setDeptDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nové oddělení</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Vytvořit oddělení</DialogTitle></DialogHeader>
                <div className="space-y-4 mt-2">
                  <div><Label>Název</Label><Input value={deptForm.name} onChange={e => setDeptForm(p => ({ ...p, name: e.target.value }))} placeholder="Název oddělení" /></div>
                  <div><Label>Kód</Label><Input value={deptForm.code} onChange={e => setDeptForm(p => ({ ...p, code: e.target.value }))} placeholder="DEV, HR, FIN..." /></div>
                  <div><Label>Středisko</Label><Input value={deptForm.cost_center_code} onChange={e => setDeptForm(p => ({ ...p, cost_center_code: e.target.value }))} placeholder="Kód střediska" /></div>
                  <Button onClick={createDepartment} disabled={!deptForm.name} className="w-full">Vytvořit</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {loading ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Načítání...</CardContent></Card>
          ) : departments.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">Žádná oddělení</h3>
                <p className="text-muted-foreground mb-4">Vytvořte první oddělení pro vaši firmu.</p>
                <Button onClick={() => setDeptDialogOpen(true)}><Plus className="h-4 w-4 mr-1" /> Nové oddělení</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {departments.map(dept => (
                <Card key={dept.uuid}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Building2 className="h-4 w-4" /> {dept.name}
                      </CardTitle>
                      {dept.code && <Badge variant="outline">{dept.code}</Badge>}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground flex items-center gap-1"><Users className="h-3 w-3" /> Zaměstnanci:</span>
                        <span className="font-medium">{dept.employee_count}</span>
                      </div>
                      {dept.manager_name && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Vedoucí:</span>
                          <span className="font-medium">{dept.manager_name}</span>
                        </div>
                      )}
                      {dept.parent_name && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Nadřazené:</span>
                          <span>{dept.parent_name}</span>
                        </div>
                      )}
                      {dept.cost_center_code && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Středisko:</span>
                          <span>{dept.cost_center_code}</span>
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

      {/* Cost Centers Tab */}
      {activeTab === "cost-centers" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Dialog open={ccDialogOpen} onOpenChange={setCcDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nové středisko</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Vytvořit středisko</DialogTitle></DialogHeader>
                <div className="space-y-4 mt-2">
                  <div><Label>Kód</Label><Input value={ccForm.code} onChange={e => setCcForm(p => ({ ...p, code: e.target.value }))} placeholder="100, 200..." /></div>
                  <div><Label>Název</Label><Input value={ccForm.name} onChange={e => setCcForm(p => ({ ...p, name: e.target.value }))} placeholder="Název střediska" /></div>
                  <div><Label>Rozpočet (Kč)</Label><Input type="number" value={ccForm.budget_czk} onChange={e => setCcForm(p => ({ ...p, budget_czk: e.target.value }))} placeholder="Volitelné" /></div>
                  <Button onClick={createCostCenter} disabled={!ccForm.code || !ccForm.name} className="w-full">Vytvořit</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {costCenters.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Layers className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">Žádná střediska</h3>
                <p className="text-muted-foreground mb-4">Definujte nákladová střediska pro účetnictví.</p>
                <Button onClick={() => setCcDialogOpen(true)}><Plus className="h-4 w-4 mr-1" /> Nové středisko</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {costCenters.map(cc => (
                <Card key={cc.uuid}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{cc.name}</CardTitle>
                      <Badge variant="outline">{cc.code}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-sm">
                      {cc.budget_czk ? (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Rozpočet:</span>
                          <span className="font-medium">{cc.budget_czk.toLocaleString("cs-CZ")} Kč</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Bez nastaveného rozpočtu</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Pay Grades Tab */}
      {activeTab === "pay-grades" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Dialog open={pgDialogOpen} onOpenChange={setPgDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nový stupeň</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Vytvořit platový stupeň</DialogTitle></DialogHeader>
                <div className="space-y-4 mt-2">
                  <div><Label>Kód</Label><Input value={pgForm.grade_code} onChange={e => setPgForm(p => ({ ...p, grade_code: e.target.value }))} placeholder="G1, G2..." /></div>
                  <div><Label>Název</Label><Input value={pgForm.name} onChange={e => setPgForm(p => ({ ...p, name: e.target.value }))} placeholder="Junior, Senior..." /></div>
                  <div><Label>Minimální mzda (Kč)</Label><Input type="number" value={pgForm.min_salary_czk} onChange={e => setPgForm(p => ({ ...p, min_salary_czk: e.target.value }))} placeholder="30000" /></div>
                  <div><Label>Maximální mzda (Kč)</Label><Input type="number" value={pgForm.max_salary_czk} onChange={e => setPgForm(p => ({ ...p, max_salary_czk: e.target.value }))} placeholder="60000" /></div>
                  <Button onClick={createPayGrade} disabled={!pgForm.grade_code || !pgForm.name || !pgForm.min_salary_czk || !pgForm.max_salary_czk} className="w-full">Vytvořit</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {payGrades.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <DollarSign className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">Žádné platové stupně</h3>
                <p className="text-muted-foreground mb-4">Definujte platové stupně pro kategorizaci pozic.</p>
                <Button onClick={() => setPgDialogOpen(true)}><Plus className="h-4 w-4 mr-1" /> Nový stupeň</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {payGrades.map(pg => (
                <Card key={pg.uuid}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{pg.name}</CardTitle>
                      <Badge>{pg.grade_code}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Min:</span>
                        <span className="font-medium">{pg.min_salary_czk?.toLocaleString("cs-CZ")} Kč</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Max:</span>
                        <span className="font-medium">{pg.max_salary_czk?.toLocaleString("cs-CZ")} Kč</span>
                      </div>
                      {pg.midpoint_czk && (
                        <div className="flex justify-between border-t pt-1">
                          <span className="text-muted-foreground">Střed:</span>
                          <span className="font-bold">{pg.midpoint_czk?.toLocaleString("cs-CZ")} Kč</span>
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

      {/* Org Chart Tab */}
      {activeTab === "org-chart" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Network className="h-5 w-5" /> Organizační schéma</CardTitle>
            <CardDescription>Hierarchická struktura oddělení a zaměstnanců</CardDescription>
          </CardHeader>
          <CardContent>
            {departments.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">Nejdříve vytvořte oddělení.</p>
            ) : (
              <div className="space-y-3">
                {departments.map(dept => (
                  <div key={dept.uuid} className={`p-3 border rounded-lg ${dept.parent_name ? 'ml-6 border-l-4 border-l-primary/30' : 'border-l-4 border-l-primary'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FolderTree className="h-4 w-4 text-primary" />
                        <span className="font-medium">{dept.name}</span>
                        {dept.code && <Badge variant="outline" className="text-xs">{dept.code}</Badge>}
                      </div>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        {dept.manager_name && <span>Vedoucí: {dept.manager_name}</span>}
                        <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {dept.employee_count}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
