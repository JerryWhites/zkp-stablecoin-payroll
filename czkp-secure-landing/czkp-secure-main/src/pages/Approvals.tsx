// ====================================
// ✅ Multi-sig Approvals Page
// ====================================

import { useState, useEffect, useCallback } from "react";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Shield, Plus, Trash2, ThumbsUp, ThumbsDown, Clock, CheckCircle, XCircle, Ban } from "lucide-react";

const RESOURCE_TYPES = [
  { value: "payroll", label: "Výplaty" },
  { value: "employee_add", label: "Přidání zaměstnance" },
  { value: "employee_edit", label: "Úprava zaměstnance" },
  { value: "expense", label: "Výdaj / platba" },
  { value: "settings", label: "Změna nastavení" },
];

interface Policy {
  uuid: string;
  name: string;
  resource_type: string;
  required_approvals: number;
  approver_user_ids: number[];
  auto_approve_below_czk: number | null;
  is_active: boolean;
  created_at: string;
}

interface ApprovalRequest {
  uuid: string;
  policy_name: string;
  resource_type: string;
  title: string;
  description: string | null;
  amount_czk: number | null;
  status: string;
  requested_by_email: string;
  approve_count: number;
  reject_count: number;
  required_approvals: number;
  can_vote: boolean;
  my_vote: string | null;
  created_at: string;
  resolved_at: string | null;
}

export default function Approvals() {
  const { toast } = useToast();
  const [tab, setTab] = useState<"requests" | "policies">("requests");
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const [form, setForm] = useState({
    name: "",
    resource_type: "payroll",
    required_approvals: 2,
    approver_user_ids: "",
    auto_approve_below_czk: "",
  });

  const [voteComment, setVoteComment] = useState<Record<string, string>>({});

  const fetchData = useCallback(async () => {
    try {
      const [polRes, reqRes] = await Promise.all([
        apiClient.authenticatedFetch("/v2/approvals/policies"),
        apiClient.authenticatedFetch("/v2/approvals/requests"),
      ]);
      if (polRes.ok) {
        const d = await polRes.json();
        setPolicies(d.policies || []);
      }
      if (reqRes.ok) {
        const d = await reqRes.json();
        setRequests(d.requests || []);
      }
    } catch {
      toast({ title: "Chyba", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const createPolicy = async () => {
    if (!form.name) { toast({ title: "Zadejte název", variant: "destructive" }); return; }
    // Parse approver_user_ids — comma-separated numbers
    const approverIds = form.approver_user_ids
      .split(",")
      .map(s => parseInt(s.trim()))
      .filter(n => !isNaN(n));
    if (approverIds.length === 0) {
      toast({ title: "Zadejte alespoň 1 ID schvalovatele", variant: "destructive" });
      return;
    }
    try {
      const res = await apiClient.authenticatedFetch("/v2/approvals/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          resource_type: form.resource_type,
          required_approvals: form.required_approvals,
          approver_user_ids: approverIds,
          auto_approve_below_czk: form.auto_approve_below_czk ? Number(form.auto_approve_below_czk) : undefined,
        }),
      });
      if (res.ok) {
        toast({ title: "Politika vytvořena" });
        fetchData();
        setShowCreate(false);
        setForm({ name: "", resource_type: "payroll", required_approvals: 2, approver_user_ids: "", auto_approve_below_czk: "" });
      } else {
        const d = await res.json();
        toast({ title: "Chyba", description: d.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba", variant: "destructive" });
    }
  };

  const vote = async (uuid: string, decision: "approve" | "reject") => {
    try {
      const res = await apiClient.authenticatedFetch(`/v2/approvals/requests/${uuid}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vote: decision, comment: voteComment[uuid] || null }),
      });
      if (res.ok) {
        toast({ title: decision === "approve" ? "Schváleno" : "Zamítnuto" });
        fetchData();
      } else {
        const d = await res.json();
        toast({ title: "Chyba", description: d.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba", variant: "destructive" });
    }
  };

  const cancelRequest = async (uuid: string) => {
    await apiClient.authenticatedFetch(`/v2/approvals/requests/${uuid}/cancel`, { method: "POST" });
    fetchData();
  };

  const deletePolicy = async (uuid: string) => {
    if (!confirm("Smazat politiku?")) return;
    await apiClient.authenticatedFetch(`/v2/approvals/policies/${uuid}`, { method: "DELETE" });
    fetchData();
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "pending": return <Clock className="h-4 w-4 text-yellow-500" />;
      case "approved": return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "rejected": return <XCircle className="h-4 w-4 text-red-500" />;
      case "cancelled": return <Ban className="h-4 w-4 text-gray-400" />;
      default: return null;
    }
  };

  const statusLabel = (status: string) => {
    const map: Record<string, string> = { pending: "Čeká na schválení", approved: "Schváleno", rejected: "Zamítnuto", cancelled: "Zrušeno" };
    return map[status] || status;
  };

  const pendingCount = requests.filter(r => r.status === "pending").length;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Shield className="h-6 w-6" /> Schvalování</h1>
          <p className="text-muted-foreground mt-1">Multi-sig workflow pro kritické operace</p>
        </div>
        {pendingCount > 0 && <span className="text-sm bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full">{pendingCount} čeká</span>}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b pb-2">
        <button onClick={() => setTab("requests")} className={`px-4 py-2 text-sm font-medium rounded-t ${tab === "requests" ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}>
          Žádosti {pendingCount > 0 && `(${pendingCount})`}
        </button>
        <button onClick={() => setTab("policies")} className={`px-4 py-2 text-sm font-medium rounded-t ${tab === "policies" ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}>
          Politiky ({policies.length})
        </button>
      </div>

      {loading && <div className="text-center py-8 text-muted-foreground">Načítání...</div>}

      {/* Requests Tab */}
      {!loading && tab === "requests" && (
        <div className="space-y-4">
          {requests.length === 0 ? (
            <div className="text-center py-12 border rounded-lg">
              <Shield className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="font-medium">Žádné žádosti o schválení</h3>
            </div>
          ) : (
            requests.map(r => (
              <div key={r.uuid} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      {statusIcon(r.status)}
                      <span className="font-medium">{r.policy_name || r.title}</span>
                      <span className="text-xs bg-muted px-2 py-0.5 rounded">{r.resource_type}</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      Žadatel: {r.requested_by_email} · {r.approve_count}/{r.required_approvals} schválení
                      {r.amount_czk ? ` · ${Number(r.amount_czk).toLocaleString("cs-CZ")} Kč` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString("cs-CZ")}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded ${r.status === "approved" ? "bg-green-100 text-green-800" : r.status === "rejected" ? "bg-red-100 text-red-800" : r.status === "pending" ? "bg-yellow-100 text-yellow-800" : "bg-gray-100"}`}>
                    {statusLabel(r.status)}
                  </span>
                </div>

                {/* Votes */}
                {r.my_vote && (
                  <div className="border-t pt-2">
                    <p className="text-xs text-muted-foreground">
                      Váš hlas: <span className={r.my_vote === "approve" ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                        {r.my_vote === "approve" ? "Schváleno" : "Zamítnuto"}
                      </span>
                    </p>
                  </div>
                )}

                {/* Vote actions */}
                {r.status === "pending" && r.can_vote && (
                  <div className="border-t pt-3 space-y-2">
                    <Input placeholder="Komentář (volitelný)" value={voteComment[r.uuid] || ""} onChange={e => setVoteComment(p => ({ ...p, [r.uuid]: e.target.value }))} className="text-sm" />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => vote(r.uuid, "approve")} className="bg-green-600 hover:bg-green-700">
                        <ThumbsUp className="h-3 w-3 mr-1" /> Schválit
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => vote(r.uuid, "reject")}>
                        <ThumbsDown className="h-3 w-3 mr-1" /> Zamítnout
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => cancelRequest(r.uuid)}>Zrušit žádost</Button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Policies Tab */}
      {!loading && tab === "policies" && (
        <div className="space-y-4">
          <Button onClick={() => setShowCreate(!showCreate)}><Plus className="h-4 w-4 mr-2" /> Nová politika</Button>

          {showCreate && (
            <div className="border rounded-lg p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Název politiky</label>
                  <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Schválení velkých plateb" />
                </div>
                <div>
                  <label className="text-sm font-medium">Typ zdroje</label>
                  <select className="w-full border rounded-md px-3 py-2 text-sm" value={form.resource_type} onChange={e => setForm({ ...form, resource_type: e.target.value })}>
                    {RESOURCE_TYPES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium">Požadovaných schválení</label>
                  <Input type="number" min={1} max={10} value={form.required_approvals} onChange={e => setForm({ ...form, required_approvals: Number(e.target.value) })} />
                </div>
                <div>
                  <label className="text-sm font-medium">ID schvalovatelů (čárkou oddělené)</label>
                  <Input value={form.approver_user_ids} onChange={e => setForm({ ...form, approver_user_ids: e.target.value })} placeholder="1, 2, 3" />
                </div>
                <div>
                  <label className="text-sm font-medium">Auto-schválení pod (Kč, volitelné)</label>
                  <Input type="number" value={form.auto_approve_below_czk} onChange={e => setForm({ ...form, auto_approve_below_czk: e.target.value })} placeholder="10000" />
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={createPolicy}>Vytvořit</Button>
                <Button variant="ghost" onClick={() => setShowCreate(false)}>Zrušit</Button>
              </div>
            </div>
          )}

          {policies.map(p => (
            <div key={p.uuid} className="border rounded-lg p-4 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${p.is_active ? "bg-green-500" : "bg-gray-400"}`} />
                  <span className="font-medium">{p.name}</span>
                  <span className="text-xs bg-muted px-2 py-0.5 rounded">{p.resource_type}</span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {p.required_approvals} schvalujících · {p.approver_user_ids?.length || 0} ve skupině
                  {p.auto_approve_below_czk && ` · auto pod ${Number(p.auto_approve_below_czk).toLocaleString("cs-CZ")} Kč`}
                </p>
              </div>
              <Button size="sm" variant="ghost" className="text-red-500" onClick={() => deletePolicy(p.uuid)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
