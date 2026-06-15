// ====================================
// 📊 Dashboard — Real-time Payroll Overview
// ====================================

import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCredits } from "@/hooks/useCredits";
import { apiClient } from "@/lib/api-client";
import {
  Users,
  Coins,
  FileCheck,
  CalendarCheck,
  Wallet,
  CreditCard,
  Zap,
  Play,
  Building2,
  Shield,
} from "lucide-react";
import { useState, useEffect } from "react";

interface DashboardStats {
  has_company: boolean;
  active_employees: number;
  periods: {
    total: number;
    locked: number;
    calculated: number;
    last_locked: string | null;
  };
  totals: {
    employees_paid: number;
    hruba_czk: number;
    cista_czk: number;
    k_vyplate_czk: number;
    srazky_czk: number;
    nemoc_czk: number;
  };
  recent_periods: {
    year: number;
    month: number;
    status: string;
    uuid: string;
    employee_count: number;
    total_cista: number;
    total_hruba: number;
  }[];
}

const MONTH_NAMES = [
  "", "Leden", "Únor", "Březen", "Duben", "Květen", "Červen",
  "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec",
];

const formatCZK = (amount: number) =>
  new Intl.NumberFormat("cs-CZ").format(Math.round(amount)) + " Kč";

const Dashboard = () => {
  const { credits, transactions, loading: creditsLoading } = useCredits();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await apiClient.authenticatedFetch("/v2/payroll/stats");
        if (res.ok) {
          setStats(await res.json());
        }
      } catch {
        // Dashboard stats are non-critical
      } finally {
        setStatsLoading(false);
      }
    };
    fetchStats();
  }, []);

  const isLoading = statsLoading || creditsLoading;

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div>
          <Skeleton className="h-8 w-64 mb-2" />
          <Skeleton className="h-5 w-96" />
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-2"><Skeleton className="h-4 w-24" /></CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16 mb-2" />
                <Skeleton className="h-3 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <CardHeader><Skeleton className="h-5 w-36" /></CardHeader>
            <CardContent className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><Skeleton className="h-5 w-28" /></CardHeader>
            <CardContent className="space-y-3">
              {[1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // No company set up yet
  if (stats && !stats.has_company) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Vítejte v CZKP</h1>
          <p className="text-muted-foreground text-lg">Začněte nastavením vaší firmy.</p>
        </div>
        <Card className="max-w-lg">
          <CardContent className="p-8 text-center">
            <Building2 className="w-12 h-12 text-accent mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Nastavte svou firmu</h2>
            <p className="text-muted-foreground mb-6">
              Pro začátek práce s payroll systémem je nutné nejprve vytvořit firmu a přidat zaměstnance.
            </p>
            <Link to="/cz/company">
              <Button className="bg-accent hover:bg-accent/90 text-accent-foreground">
                <Building2 className="w-4 h-4 mr-2" />
                Nastavit firmu
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const statCards = [
    {
      label: "Aktivní zaměstnanci",
      value: stats?.active_employees?.toString() || "0",
      icon: Users,
      sub: `${stats?.periods.locked || 0} uzavřených období`,
    },
    {
      label: "Celkem hrubá mzda",
      value: formatCZK(stats?.totals.hruba_czk || 0),
      icon: Coins,
      sub: `Čistá: ${formatCZK(stats?.totals.cista_czk || 0)}`,
    },
    {
      label: "Zpracovaná období",
      value: stats?.periods.total?.toString() || "0",
      icon: CalendarCheck,
      sub: stats?.periods.last_locked
        ? `Poslední: ${stats.periods.last_locked}`
        : "Zatím žádné uzavřené",
    },
    {
      label: "Zaměstnanců vyplaceno",
      value: stats?.totals.employees_paid?.toString() || "0",
      icon: FileCheck,
      sub: stats?.totals.srazky_czk
        ? `Srážky: ${formatCZK(stats.totals.srazky_czk)}`
        : "Žádné srážky",
    },
  ];

  return (
    <div className="space-y-8">
      {/* Welcome */}
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">Přehled</h1>
        <p className="text-muted-foreground text-lg">
          Přehled vašeho payroll systému s technologií zero-knowledge proofs.
        </p>
      </div>

      {/* Credit Balance Card */}
      {credits && (
        <Card className="bg-gradient-to-br from-accent/20 via-card to-card border-accent/30">
          <CardContent className="p-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-accent/20 rounded-2xl flex items-center justify-center">
                  <CreditCard className="w-7 h-7 text-accent" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Kreditní zůstatek</p>
                  <p className="text-4xl font-bold text-foreground">
                    {formatCZK(credits.balance_czk ?? credits.balance_usd ?? 0)}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-6">
                <div className="text-center">
                  <p className="text-2xl font-bold text-foreground">{credits.estimates.active_employees}</p>
                  <p className="text-xs text-muted-foreground">Zaměstnanci</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-foreground">{formatCZK(credits.estimates.next_payroll_cost)}</p>
                  <p className="text-xs text-muted-foreground">Další payroll</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-accent">{credits.estimates.payrolls_remaining}</p>
                  <p className="text-xs text-muted-foreground">Zbývá runů</p>
                </div>

                <div className="flex gap-2">
                  <Link to="/cz/payroll">
                    <Button size="sm" className="bg-accent hover:bg-accent/90 text-accent-foreground">
                      <Play className="w-4 h-4 mr-1" />
                      Spustit payroll
                    </Button>
                  </Link>
                  <Link to="/subscription">
                    <Button variant="outline" size="sm" className="border-accent/50 text-accent hover:bg-accent/10">
                      <Zap className="w-4 h-4 mr-1" />
                      Dobít kredit
                    </Button>
                  </Link>
                  <Link to="/subscription">
                    <Badge variant="outline" className="bg-accent/10 text-accent border-accent/30 cursor-pointer hover:bg-accent/20">
                      {credits.tier.display_name}
                    </Badge>
                  </Link>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats Grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((stat) => (
          <Card key={stat.label} className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{stat.label}</CardTitle>
              <div className="w-10 h-10 bg-accent/10 rounded-lg flex items-center justify-center">
                <stat.icon className="w-5 h-5 text-accent" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground mb-1">{stat.value}</div>
              <p className="text-xs text-muted-foreground">{stat.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Bottom Row */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Recent Periods */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-xl">Nedávná období</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats && stats.recent_periods.length > 0 ? (
                stats.recent_periods.map((p) => (
                  <Link
                    key={p.uuid}
                    to="/cz/payroll"
                    className="flex items-center justify-between py-3 border-b border-border last:border-0 hover:bg-muted/50 -mx-2 px-2 rounded transition-colors"
                  >
                    <div>
                      <p className="font-medium text-foreground">
                        {MONTH_NAMES[p.month]} {p.year}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {p.employee_count} zaměstnanců
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-foreground">
                        {formatCZK(p.total_hruba)}
                      </span>
                      <Badge
                        variant="outline"
                        className={
                          p.status === "locked"
                            ? "bg-green-100 text-green-800 border-green-200 dark:bg-green-900 dark:text-green-300"
                            : p.status === "calculated"
                            ? "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900 dark:text-amber-300"
                            : "bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-900 dark:text-gray-300"
                        }
                      >
                        {p.status === "locked" ? "Uzavřeno" : p.status === "calculated" ? "Vypočteno" : "Nové"}
                      </Badge>
                    </div>
                  </Link>
                ))
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Wallet className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>Zatím žádná období</p>
                  <Link to="/cz/payroll" className="text-accent hover:underline text-sm">
                    Vytvořte první mzdové období →
                  </Link>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Credit Transactions & System Status */}
        <div className="space-y-6">
          {/* Recent Transactions */}
          {transactions.length > 0 && (
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-xl">Poslední transakce</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {transactions.slice(0, 4).map((tx) => (
                    <div key={tx.uuid} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                      <div>
                        <p className="text-sm font-medium text-foreground">{tx.description}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(tx.created_at).toLocaleDateString("cs-CZ")}
                        </p>
                      </div>
                      <span className={`text-sm font-medium ${(tx.amount_czk ?? tx.amount_usd) > 0 ? "text-green-600" : "text-destructive"}`}>
                        {(tx.amount_czk ?? tx.amount_usd) > 0 ? "+" : ""}
                        {formatCZK(tx.amount_czk ?? tx.amount_usd)}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* System Status */}
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-xl">Stav systému</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 bg-green-500/10 rounded-xl flex items-center justify-center">
                  <Shield className="w-6 h-6 text-green-500" />
                </div>
                <div>
                  <p className="text-lg font-bold text-foreground">Provozuschopný</p>
                  <p className="text-sm text-muted-foreground">Šifrování · 2FA · ZK Ready</p>
                </div>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ZK platby</span>
                  <span className="text-green-600 font-medium">Aleo TestnetBeta</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Šifrování dat</span>
                  <span className="text-green-600 font-medium">AES-256-GCM</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Uzavřených období</span>
                  <span className="text-foreground font-medium">{stats?.periods.locked || 0}</span>
                </div>
                {stats?.periods.last_locked && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Poslední payroll</span>
                    <span className="text-foreground font-medium">{stats.periods.last_locked}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
