// ====================================
// 👤 Employee Self-Service Portal Page
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
  User, FileText, Palmtree, Users, Calendar, RefreshCw,
  Eye, Clock, Shield, CheckCircle, XCircle, AlertCircle, Coins,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import CryptoSettingsPanel from "@/components/portal/CryptoSettingsPanel";

interface Profile {
  uuid: string;
  name: string;
  email: string;
  position_title?: string;
  typ_uvazku?: string;
  nastup?: string;
  osobni_cislo?: string;
  status?: string;
}

interface Payslip {
  id: number;
  year: number;
  month: number;
  gross_salary: number;
  net_salary: number;
  sp_employee: number;
  zp_employee: number;
  tax: number;
  period_status: string;
}

interface VacationRequest {
  id: number;
  uuid: string;
  start_date: string;
  end_date: string;
  days: number;
  type: string;
  status: string;
  note: string | null;
}

interface VacationBalance {
  year: number;
  entitlement: number;
  used: number;
  remaining: number;
}

export default function Portal() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"profile" | "payslips" | "vacations" | "crypto" | "manager">("profile");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [vacations, setVacations] = useState<VacationRequest[]>([]);
  const [balance, setBalance] = useState<VacationBalance | null>(null);
  const [team, setTeam] = useState<any[]>([]);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [vacDialogOpen, setVacDialogOpen] = useState(false);
  const [vacForm, setVacForm] = useState({ start_date: "", end_date: "", type: "dovolena", note: "" });

  const fetchProfile = useCallback(async () => {
    try {
      const res = await apiClient.authenticatedFetch("/v2/portal/me");
      if (res.ok) {
        const data = await res.json();
        setProfile(data.profile || null);
      }
    } catch (error) {
      console.error("Failed to fetch profile:", error);
    }
  }, []);

  const fetchPayslips = useCallback(async () => {
    try {
      const res = await apiClient.authenticatedFetch("/v2/portal/payslips");
      if (res.ok) {
        const data = await res.json();
        setPayslips(data.payslips || []);
      }
    } catch (error) {
      console.error("Failed to fetch payslips:", error);
    }
  }, []);

  const fetchVacations = useCallback(async () => {
    try {
      const res = await apiClient.authenticatedFetch("/v2/portal/vacations");
      if (res.ok) {
        const data = await res.json();
        setVacations(data.requests || []);
        setBalance(data.balance || null);
      }
    } catch (error) {
      console.error("Failed to fetch vacations:", error);
    }
  }, []);

  const fetchTeam = useCallback(async () => {
    try {
      const res = await apiClient.authenticatedFetch("/v2/portal/manager/team");
      if (res.ok) {
        const data = await res.json();
        setTeam(data.team || []);
      }
    } catch { /* May not be a manager */ }
  }, []);

  const fetchPending = useCallback(async () => {
    try {
      const res = await apiClient.authenticatedFetch("/v2/portal/manager/pending");
      if (res.ok) {
        const data = await res.json();
        setPendingRequests(data.requests || []);
      }
    } catch { /* May not be a manager */ }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchProfile(), fetchPayslips(), fetchVacations(), fetchTeam(), fetchPending()])
      .finally(() => setLoading(false));
  }, [fetchProfile, fetchPayslips, fetchVacations, fetchTeam, fetchPending]);

  const submitVacation = async () => {
    try {
      const res = await apiClient.authenticatedFetch("/v2/portal/vacations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vacForm),
      });
      if (res.ok) {
        toast({ title: "Žádost o dovolenou odeslána" });
        setVacDialogOpen(false);
        setVacForm({ start_date: "", end_date: "", type: "dovolena", note: "" });
        fetchVacations();
      } else {
        const err = await res.json();
        toast({ title: "Chyba", description: err.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba při odesílání žádosti", variant: "destructive" });
    }
  };

  const approveRequest = async (uuid: string) => {
    try {
      const res = await apiClient.authenticatedFetch(`/v2/portal/manager/approve-request/${uuid}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      if (res.ok) {
        toast({ title: "Žádost schválena" });
        fetchPending();
      }
    } catch {
      toast({ title: "Chyba", variant: "destructive" });
    }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; icon: any }> = {
      approved: { variant: "default", icon: CheckCircle },
      pending: { variant: "outline", icon: Clock },
      rejected: { variant: "destructive", icon: XCircle },
    };
    const s = map[status] || { variant: "secondary" as const, icon: AlertCircle };
    return (
      <Badge variant={s.variant} className="flex items-center gap-1">
        <s.icon className="h-3 w-3" /> {status === "approved" ? "Schváleno" : status === "pending" ? "Čeká" : status === "rejected" ? "Zamítnuto" : status}
      </Badge>
    );
  };

  const monthName = (m: number) => ["", "Leden", "Únor", "Březen", "Duben", "Květen", "Červen", "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec"][m] || "";

  const tabs = [
    { id: "profile" as const, label: "Můj profil", icon: User },
    { id: "payslips" as const, label: "Výplatní pásky", icon: FileText },
    { id: "vacations" as const, label: "Dovolená", icon: Palmtree },
    { id: "crypto" as const, label: "Krypto", icon: Coins },
    { id: "manager" as const, label: "Manažer tým", icon: Users },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Zaměstnanecký portál</h1>
          <p className="text-muted-foreground">Samoobslužný portál pro zaměstnance</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { fetchProfile(); fetchPayslips(); fetchVacations(); }}>
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

      {/* Profile Tab */}
      {activeTab === "profile" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><User className="h-5 w-5" /> Můj profil</CardTitle>
            <CardDescription>Základní údaje o vašem zaměstnaneckém profilu</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground">Načítání...</p>
            ) : !profile ? (
              <div className="text-center py-8">
                <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">Profil nedostupný</h3>
                <p className="text-muted-foreground">Váš účet není propojen se zaměstnaneckým profilem. Kontaktujte administrátora.</p>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                <div><Label className="text-muted-foreground text-xs">Jméno</Label><p className="font-medium">{profile.name}</p></div>
                <div><Label className="text-muted-foreground text-xs">E-mail</Label><p className="font-medium">{profile.email}</p></div>
                {profile.position_title && <div><Label className="text-muted-foreground text-xs">Pozice</Label><p className="font-medium">{profile.position_title}</p></div>}
                {profile.typ_uvazku && <div><Label className="text-muted-foreground text-xs">Typ úvazku</Label><p className="font-medium">{profile.typ_uvazku}</p></div>}
                {profile.nastup && <div><Label className="text-muted-foreground text-xs">Nástup</Label><p className="font-medium">{profile.nastup}</p></div>}
                {profile.osobni_cislo && <div><Label className="text-muted-foreground text-xs">Osobní číslo</Label><p className="font-medium">{profile.osobni_cislo}</p></div>}
                {profile.status && <div><Label className="text-muted-foreground text-xs">Status</Label><Badge variant={profile.status === "active" ? "default" : "secondary"}>{profile.status}</Badge></div>}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Payslips Tab */}
      {activeTab === "payslips" && (
        <div className="space-y-4">
          {payslips.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">Žádné výplatní pásky</h3>
                <p className="text-muted-foreground">Výplatní pásky se zobrazí po zpracování prvního mzdového období.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {payslips.map((ps, idx) => (
                <Card key={idx}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{monthName(ps.month)} {ps.year}</CardTitle>
                      <Badge variant={ps.period_status === "closed" ? "default" : "outline"}>
                        {ps.period_status === "closed" ? "Uzavřeno" : "Koncept"}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between"><span className="text-muted-foreground">Hrubá mzda:</span><span>{ps.gross_salary?.toLocaleString("cs-CZ")} Kč</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">SP zaměstnanec:</span><span>-{ps.sp_employee?.toLocaleString("cs-CZ")} Kč</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">ZP zaměstnanec:</span><span>-{ps.zp_employee?.toLocaleString("cs-CZ")} Kč</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Záloha na daň:</span><span>-{ps.tax?.toLocaleString("cs-CZ")} Kč</span></div>
                      <div className="flex justify-between border-t pt-1 font-bold"><span>Čistá mzda:</span><span className="text-green-600">{ps.net_salary?.toLocaleString("cs-CZ")} Kč</span></div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Vacations Tab */}
      {activeTab === "vacations" && (
        <div className="space-y-4">
          {balance && (
            <div className="grid gap-4 md:grid-cols-3">
              <Card><CardContent className="pt-6 text-center"><p className="text-2xl font-bold">{balance.entitlement}</p><p className="text-sm text-muted-foreground">Nárok {balance.year}</p></CardContent></Card>
              <Card><CardContent className="pt-6 text-center"><p className="text-2xl font-bold text-orange-600">{balance.used}</p><p className="text-sm text-muted-foreground">Čerpáno</p></CardContent></Card>
              <Card><CardContent className="pt-6 text-center"><p className="text-2xl font-bold text-green-600">{balance.remaining}</p><p className="text-sm text-muted-foreground">Zbývá</p></CardContent></Card>
            </div>
          )}

          <div className="flex justify-end">
            <Dialog open={vacDialogOpen} onOpenChange={setVacDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Palmtree className="h-4 w-4 mr-1" /> Nová žádost</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Žádost o dovolenou</DialogTitle></DialogHeader>
                <div className="space-y-4 mt-2">
                  <div><Label>Datum od</Label><Input type="date" value={vacForm.start_date} onChange={e => setVacForm(p => ({ ...p, start_date: e.target.value }))} /></div>
                  <div><Label>Datum do</Label><Input type="date" value={vacForm.end_date} onChange={e => setVacForm(p => ({ ...p, end_date: e.target.value }))} /></div>
                  <div><Label>Poznámka</Label><Input value={vacForm.note} onChange={e => setVacForm(p => ({ ...p, note: e.target.value }))} placeholder="Volitelné" /></div>
                  <Button onClick={submitVacation} disabled={!vacForm.start_date || !vacForm.end_date} className="w-full">Odeslat žádost</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {vacations.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Žádné žádosti o dovolenou.</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {vacations.map(v => (
                <Card key={v.uuid || v.id}>
                  <CardContent className="py-3 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="font-medium">{v.start_date} — {v.end_date}</p>
                        <p className="text-sm text-muted-foreground">{v.days} {v.days === 1 ? "den" : v.days < 5 ? "dny" : "dní"}{v.note ? ` · ${v.note}` : ""}</p>
                      </div>
                    </div>
                    {statusBadge(v.status)}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Crypto Tab */}
      {activeTab === "crypto" && (
        <CryptoSettingsPanel />
      )}

      {/* Manager Tab */}
      {activeTab === "manager" && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" /> Můj tým</CardTitle>
            </CardHeader>
            <CardContent>
              {team.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">Žádní podřízení zaměstnanci nebo nemáte manažerská oprávnění.</p>
              ) : (
                <div className="space-y-2">
                  {team.map((member: any, idx: number) => (
                    <div key={idx} className="flex items-center justify-between p-2 border rounded">
                      <div>
                        <p className="font-medium">{member.name}</p>
                        <p className="text-sm text-muted-foreground">{member.position_title || member.email}</p>
                      </div>
                      <Badge>{member.status || "active"}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {pendingRequests.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5" /> Čekající žádosti ({pendingRequests.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {pendingRequests.map((req: any) => (
                    <div key={req.uuid} className="flex items-center justify-between p-3 border rounded">
                      <div>
                        <p className="font-medium">{req.employee_name}</p>
                        <p className="text-sm text-muted-foreground">{req.type}: {req.start_date} — {req.end_date}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => approveRequest(req.uuid)}>
                          <CheckCircle className="h-4 w-4 mr-1" /> Schválit
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
