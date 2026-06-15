// ====================================
// 👥 Employee Management Page (CZ Payroll)
// ====================================

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/lib/api-client";
import { formatCZK, ZP_CODES } from "@/lib/cz-payroll-types";
import type { CZEmployee, CZEmployeeFormData, TypUvazku, InvaliditaType } from "@/lib/cz-payroll-types";
import { Users, Plus, Pencil, Trash2, Loader2, Search } from "lucide-react";

const EMPTY_FORM: CZEmployeeFormData = {
  name: "",
  email: "",
  osobni_cislo: "",
  rodne_cislo: "",
  datum_narozeni: "",
  adresa: "",
  bank_account: "",
  aleo_address: "",
  nastup: new Date().toISOString().slice(0, 10),
  typ_uvazku: "HPP",
  hruba_mzda_czk: 0,
  uvazek_hodiny: 40,
  podepsane_prohlaseni: true,
  pocet_deti: 0,
  deti_ztp: 0,
  invalidita: "none",
  sleva_student: false,
  zp_code: "111",
};

export default function EmployeeManagement() {
  const { toast } = useToast();
  const [employees, setEmployees] = useState<CZEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editUuid, setEditUuid] = useState<string | null>(null);
  const [form, setForm] = useState<CZEmployeeFormData>({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ uuid: string; name: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.authenticatedFetch("/v2/employees");
      if (res.ok) {
        const data = await res.json();
        setEmployees(data.employees || []);
      }
    } catch {
      toast({ title: "Chyba", description: "Nepodařilo se načíst zaměstnance", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  function openAdd() {
    setEditUuid(null);
    setForm({ ...EMPTY_FORM });
    setDialogOpen(true);
  }

  function openEdit(emp: CZEmployee) {
    setEditUuid(emp.uuid);
    setForm({
      name: emp.name,
      email: emp.email,
      osobni_cislo: emp.osobni_cislo || "",
      rodne_cislo: emp.rodne_cislo || "",
      datum_narozeni: emp.datum_narozeni || "",
      adresa: emp.adresa || "",
      bank_account: emp.bank_account || "",
      aleo_address: emp.aleo_address || "",
      nastup: emp.nastup || "",
      typ_uvazku: emp.typ_uvazku,
      hruba_mzda_czk: emp.hruba_mzda_czk,
      uvazek_hodiny: emp.uvazek_hodiny,
      podepsane_prohlaseni: emp.podepsane_prohlaseni,
      pocet_deti: emp.pocet_deti,
      deti_ztp: emp.deti_ztp,
      invalidita: emp.invalidita,
      sleva_student: emp.sleva_student,
      zp_code: emp.zp_code || "111",
    });
    setDialogOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    try {
      const url = editUuid ? `/v2/employees/${editUuid}` : "/v2/employees";
      const method = editUuid ? "PUT" : "POST";

      const res = await apiClient.authenticatedFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Chyba", description: data.error || "Nepodařilo se uložit", variant: "destructive" });
        return;
      }

      toast({ title: editUuid ? "Aktualizováno" : "Přidáno", description: `${form.name} byl(a) uložen(a)` });
      setDialogOpen(false);
      load();
    } catch {
      toast({ title: "Chyba", description: "Chyba připojení", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(uuid: string, name: string) {
    setDeleteTarget({ uuid, name });
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const { uuid, name } = deleteTarget;
    setDeleteTarget(null);

    try {
      const res = await apiClient.authenticatedFetch(`/v2/employees/${uuid}`, { method: "DELETE" });
      if (res.ok) {
        toast({ title: "Deaktivováno", description: `${name} byl(a) deaktivován(a)` });
        load();
      }
    } catch {
      toast({ title: "Chyba", description: "Nepodařilo se deaktivovat", variant: "destructive" });
    }
  }

  const filtered = employees.filter(e =>
    !search || e.name.toLowerCase().includes(search.toLowerCase()) ||
    e.osobni_cislo?.includes(search) || e.email.toLowerCase().includes(search.toLowerCase())
  );

  const typBadge = (typ: TypUvazku) => {
    const colors: Record<TypUvazku, string> = {
      HPP: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
      DPP: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300",
      DPC: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
    };
    return <Badge className={colors[typ]}>{typ}</Badge>;
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 p-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <Users className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Zaměstnanci</h1>
            <p className="text-muted-foreground">{employees.length} zaměstnanců</p>
          </div>
        </div>
        <div className="flex gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Hledat..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10 w-[200px]" />
          </div>
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4 mr-2" /> Přidat
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Číslo</TableHead>
                  <TableHead>Jméno</TableHead>
                  <TableHead>Typ</TableHead>
                  <TableHead className="text-right">Hrubá mzda</TableHead>
                  <TableHead>Úvazek</TableHead>
                  <TableHead>Prohlášení</TableHead>
                  <TableHead>Děti</TableHead>
                  <TableHead className="text-right">Akce</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-16 text-muted-foreground">
                      {search ? (
                        <div>
                          <Search className="h-8 w-8 mx-auto mb-2 opacity-30" />
                          <p>Žádní zaměstnanci nevyhovují hledání</p>
                        </div>
                      ) : (
                        <div>
                          <Users className="h-8 w-8 mx-auto mb-2 opacity-30" />
                          <p className="mb-2">Zatím nemáte žádné zaměstnance</p>
                          <Button variant="outline" size="sm" onClick={openAdd}>
                            <Plus className="h-4 w-4 mr-2" /> Přidat prvního zaměstnance
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ) : filtered.map(emp => (
                  <TableRow key={emp.uuid} className={emp.status === "inactive" ? "opacity-50" : ""}>
                    <TableCell className="font-mono text-sm">{emp.osobni_cislo || "—"}</TableCell>
                    <TableCell>
                      <div className="font-medium">{emp.name}</div>
                      <div className="text-xs text-muted-foreground">{emp.email}</div>
                    </TableCell>
                    <TableCell>{typBadge(emp.typ_uvazku)}</TableCell>
                    <TableCell className="text-right font-mono">{formatCZK(emp.hruba_mzda_czk)}</TableCell>
                    <TableCell>{emp.uvazek_hodiny}h/týd</TableCell>
                    <TableCell>{emp.podepsane_prohlaseni ? "✅" : "❌"}</TableCell>
                    <TableCell>{emp.pocet_deti > 0 ? `${emp.pocet_deti}${emp.deti_ztp > 0 ? ` (${emp.deti_ztp} ZTP)` : ""}` : "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(emp)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {emp.status === "active" && (
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(emp.uuid, emp.name)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editUuid ? "Upravit zaměstnance" : "Nový zaměstnanec"}</DialogTitle>
            <DialogDescription>
              {editUuid ? "Upravte údaje zaměstnance" : "Vyplňte údaje nového zaměstnance"}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            {/* Personal */}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Jméno *</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
              </div>
              <div>
                <Label>Email *</Label>
                <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
              </div>
              <div>
                <Label>Osobní číslo</Label>
                <Input value={form.osobni_cislo} onChange={e => setForm(f => ({ ...f, osobni_cislo: e.target.value }))} />
              </div>
              <div>
                <Label>Rodné číslo</Label>
                <Input value={form.rodne_cislo} onChange={e => setForm(f => ({ ...f, rodne_cislo: e.target.value }))} placeholder="YYMMDD/XXXX" />
              </div>
              <div>
                <Label>Datum narození</Label>
                <Input type="date" value={form.datum_narozeni} onChange={e => setForm(f => ({ ...f, datum_narozeni: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <Label>Adresa</Label>
                <Input value={form.adresa} onChange={e => setForm(f => ({ ...f, adresa: e.target.value }))} placeholder="Ulice 123, Praha" />
              </div>
              <div>
                <Label>Bankovní účet</Label>
                <Input value={form.bank_account} onChange={e => setForm(f => ({ ...f, bank_account: e.target.value }))} placeholder="19-1234567890/0800" />
                <p className="text-xs text-muted-foreground mt-1">Formát: předčíslí-číslo/kód banky (předčíslí volitelné)</p>
              </div>
              <div>
                <Label>Aleo adresa</Label>
                <Input value={form.aleo_address} onChange={e => setForm(f => ({ ...f, aleo_address: e.target.value }))} placeholder="aleo1..." />
              </div>
            </div>

            {/* Employment */}
            <div className="border-t pt-4">
              <h3 className="font-medium mb-3">Pracovní poměr</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Typ úvazku *</Label>
                  <Select value={form.typ_uvazku} onValueChange={v => setForm(f => ({ ...f, typ_uvazku: v as TypUvazku }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="HPP">HPP — pracovní poměr</SelectItem>
                      <SelectItem value="DPP">DPP — dohoda o provedení práce</SelectItem>
                      <SelectItem value="DPC">DPČ — dohoda o pracovní činnosti</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Datum nástupu</Label>
                  <Input type="date" value={form.nastup} onChange={e => setForm(f => ({ ...f, nastup: e.target.value }))} />
                </div>
                <div>
                  <Label>Hrubá mzda (CZK) *</Label>
                  <Input type="number" min={0} value={form.hruba_mzda_czk} onChange={e => setForm(f => ({ ...f, hruba_mzda_czk: Number(e.target.value) }))} required />
                </div>
                <div>
                  <Label>Týdenní úvazek (h)</Label>
                  <Input type="number" min={1} max={40} value={form.uvazek_hodiny} onChange={e => setForm(f => ({ ...f, uvazek_hodiny: Number(e.target.value) }))} />
                </div>
                <div>
                  <Label>ZP kód</Label>
                  <Select value={form.zp_code || "111"} onValueChange={v => setForm(f => ({ ...f, zp_code: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(ZP_CODES).map(([code, name]) => (
                        <SelectItem key={code} value={code}>{code} — {name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Tax */}
            <div className="border-t pt-4">
              <h3 className="font-medium mb-3">Daňové údaje</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-3">
                  <Switch
                    checked={form.podepsane_prohlaseni}
                    onCheckedChange={v => setForm(f => ({ ...f, podepsane_prohlaseni: v }))}
                  />
                  <Label>Podepsané prohlášení poplatníka</Label>
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={form.sleva_student}
                    onCheckedChange={v => setForm(f => ({ ...f, sleva_student: v }))}
                  />
                  <Label>Sleva na studenta</Label>
                </div>
                <div>
                  <Label>Počet dětí</Label>
                  <Input type="number" min={0} max={10} value={form.pocet_deti} onChange={e => setForm(f => ({ ...f, pocet_deti: Number(e.target.value) }))} />
                </div>
                <div>
                  <Label>Z toho ZTP/P</Label>
                  <Input type="number" min={0} max={form.pocet_deti} value={form.deti_ztp} onChange={e => setForm(f => ({ ...f, deti_ztp: Number(e.target.value) }))} />
                </div>
                <div>
                  <Label>Invalidita</Label>
                  <Select value={form.invalidita} onValueChange={v => setForm(f => ({ ...f, invalidita: v as InvaliditaType }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Žádná</SelectItem>
                      <SelectItem value="1">I. stupeň</SelectItem>
                      <SelectItem value="2">II. stupeň</SelectItem>
                      <SelectItem value="3">III. stupeň (ZTP/P)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Zrušit</Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {editUuid ? "Uložit" : "Přidat"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deaktivovat zaměstnance?</AlertDialogTitle>
            <AlertDialogDescription>
              Opravdu chcete deaktivovat zaměstnance <strong>{deleteTarget?.name}</strong>?
              Zaměstnanec bude přesunut do stavu neaktivní.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Zrušit</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Deaktivovat
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
