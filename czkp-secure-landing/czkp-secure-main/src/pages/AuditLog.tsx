// ====================================
// 📋 Audit Log Viewer — Security Event History
// ====================================

import { useState, useEffect, useCallback } from "react";
import { apiClient } from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Shield, Search, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";

interface AuditEntry {
  id: number;
  user_email: string;
  action: string;
  resource_type: string;
  resource_id: string;
  ip_address: string;
  created_at: string;
  metadata: Record<string, unknown>;
}

const ACTION_COLORS: Record<string, string> = {
  LOGIN: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  LOGIN_FAILED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  LOGOUT: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300",
  REGISTER: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  PAYROLL_CALCULATED: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300",
  PAYROLL_LOCKED: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  EMPLOYEE_CREATED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300",
  EXPORT_PAYSLIPS: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-300",
};

const ACTION_LABELS: Record<string, string> = {
  LOGIN: "Přihlášení",
  LOGIN_FAILED: "Neúspěšný pokus",
  LOGOUT: "Odhlášení",
  REGISTER: "Registrace",
  PAYROLL_CALCULATED: "Výpočet mezd",
  PAYROLL_LOCKED: "Uzavření období",
  PAYROLL_PERIOD_CREATED: "Nové období",
  EMPLOYEE_CREATED: "Nový zaměstnanec",
  EMPLOYEE_UPDATED: "Editace zaměstnance",
  EMPLOYEE_DEACTIVATED: "Deaktivace zaměstnance",
  EXPORT_PAYSLIPS: "Export výplatnic",
  EXPORT_BANK: "Export bankovního CSV",
  COMPANY_CREATED: "Vytvoření firmy",
  COMPANY_UPDATED: "Editace firmy",
  ABSENCE_CREATED: "Nová absence",
  ABSENCE_APPROVED: "Schválení absence",
  ABSENCE_CANCELLED: "Zrušení absence",
  DEDUCTION_CREATED: "Nová srážka",
  DEDUCTION_UPDATED: "Editace srážky",
  DEDUCTION_DEACTIVATED: "Deaktivace srážky",
  VACATION_ENTITLEMENTS_INIT: "Init dovolených",
};

export default function AuditLog() {
  const { toast } = useToast();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const PER_PAGE = 25;

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PER_PAGE),
      });
      if (search) params.set("search", search);
      if (actionFilter !== "all") params.set("action", actionFilter);

      const res = await apiClient.authenticatedFetch(`/audit-log?${params}`);
      const data = await res.json();
      if (res.ok) {
        setEntries(data.entries || data.logs || []);
        setTotalPages(Math.ceil((data.total || data.count || 0) / PER_PAGE) || 1);
      } else {
        toast({ title: "Chyba", description: data.error || "Nelze načíst audit log", variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba", description: "Chyba při komunikaci se serverem", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [page, search, actionFilter, toast]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString("cs-CZ", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" /> Audit Log
          </h1>
          <p className="text-muted-foreground">Historie bezpečnostních a systémových událostí</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchLogs}>
          <RefreshCw className="h-4 w-4 mr-2" /> Obnovit
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Hledat (e-mail, akce, zdroj)..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="pl-9"
              />
            </div>
            <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Filtr akce" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Všechny akce</SelectItem>
                <SelectItem value="LOGIN">Přihlášení</SelectItem>
                <SelectItem value="LOGIN_FAILED">Neúspěšné přihlášení</SelectItem>
                <SelectItem value="PAYROLL_CALCULATED">Výpočet mezd</SelectItem>
                <SelectItem value="PAYROLL_LOCKED">Uzavření období</SelectItem>
                <SelectItem value="EMPLOYEE_CREATED">Nový zaměstnanec</SelectItem>
                <SelectItem value="EXPORT_PAYSLIPS">Export výplatnic</SelectItem>
                <SelectItem value="ABSENCE_CREATED">Absence</SelectItem>
                <SelectItem value="DEDUCTION_CREATED">Srážky</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Záznamy</CardTitle>
          <CardDescription>Strana {page} z {totalPages}</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[600px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[160px]">Čas</TableHead>
                  <TableHead className="w-[180px]">Uživatel</TableHead>
                  <TableHead className="w-[180px]">Akce</TableHead>
                  <TableHead>Zdroj</TableHead>
                  <TableHead className="w-[120px]">IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    </TableRow>
                  ))
                ) : entries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      Žádné záznamy
                    </TableCell>
                  </TableRow>
                ) : (
                  entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="text-xs font-mono">{formatDate(entry.created_at)}</TableCell>
                      <TableCell className="text-sm truncate max-w-[180px]">{entry.user_email || "—"}</TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={ACTION_COLORS[entry.action] || ""}
                        >
                          {ACTION_LABELS[entry.action] || entry.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {entry.resource_type && (
                          <span>{entry.resource_type}{entry.resource_id ? `: ${entry.resource_id.substring(0, 8)}…` : ""}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">{entry.ip_address}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>

          {/* Pagination */}
          <div className="flex items-center justify-between pt-4 border-t mt-4">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Předchozí
            </Button>
            <span className="text-sm text-muted-foreground">Strana {page} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              Další <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
