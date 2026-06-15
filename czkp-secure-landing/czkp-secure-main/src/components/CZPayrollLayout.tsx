// ====================================
// 🧭 CZ Payroll App Layout with Sidebar Navigation
// ====================================

import { ReactNode, useEffect, useState, useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  Building2,
  Users,
  Calculator,
  Wallet,
  CreditCard,
  LogOut,
  Shield,
  Menu,
  X,
  Settings,
  ClipboardList,
  UserCheck,
  CalendarCheck,
  Key,
  Clock,
  BarChart3,
  Webhook,
  ShieldCheck,
  Palette,
  Headphones,
  Activity,
  Palmtree,
  Scale,
  Timer,
  Gift,
  Network,
  Coins,
  UserPlus,
  LayoutGrid,
  BookOpen,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  roles?: string[]; // if set, only visible to these roles
  entityTypes?: string[]; // if set, only visible for these entity types (e.g. 'osvc', 'sro')
  requireEmployees?: boolean; // if true, only show for companies with employees (sro, as, etc.)
}

// Module-level cache — survives re-renders and route changes, resets on page reload
let _cachedEntityType: string | null = null;
let _entityTypeFetchedForUser: string | null = null;

const NAV_ITEMS: NavItem[] = [
  { label: "Přehled", href: "/dashboard", icon: LayoutDashboard },
  { label: "Firma", href: "/cz/company", icon: Building2 },
  { label: "Zaměstnanci", href: "/cz/employees", icon: Users, requireEmployees: true },
  { label: "OSVČ", href: "/cz/osvc", icon: UserCheck, entityTypes: ["osvc"] },
  { label: "Mzdy", href: "/cz/payroll", icon: Calculator, requireEmployees: true },
  { label: "Dovolená", href: "/cz/vacations", icon: Palmtree, requireEmployees: true },
  { label: "Srážky", href: "/cz/deductions", icon: Scale, requireEmployees: true },
  { label: "Docházka", href: "/cz/timesheets", icon: Timer, requireEmployees: true },
  { label: "Benefity", href: "/cz/benefits", icon: Gift, requireEmployees: true },
  { label: "Organizace", href: "/cz/organization", icon: Network },
  { label: "Provize", href: "/cz/commissions", icon: Coins, requireEmployees: true },
  { label: "Nástup/Odchod", href: "/cz/onboarding", icon: UserPlus, requireEmployees: true },
  { label: "Portál", href: "/cz/portal", icon: LayoutGrid },
  { label: "Účetnictví", href: "/cz/accounting", icon: BookOpen },
  { label: "Roční zpracování", href: "/cz/annual", icon: CalendarCheck },
  { label: "ALEO platby", href: "/app", icon: Wallet },
  { label: "Předplatné", href: "/subscription", icon: CreditCard },
  { label: "Audit Log", href: "/audit-log", icon: ClipboardList, roles: ["admin", "owner"] },
  { label: "API klíče", href: "/api-keys", icon: Key, roles: ["admin", "owner"] },
  { label: "Plánovač", href: "/scheduler", icon: Clock, roles: ["admin", "owner"] },
  { label: "Reporty", href: "/reports", icon: BarChart3 },
  { label: "Webhooky", href: "/webhooks", icon: Webhook, roles: ["admin", "owner"] },
  { label: "Schvalování", href: "/approvals", icon: ShieldCheck },
  { label: "White-label", href: "/whitelabel", icon: Palette, roles: ["admin", "owner"] },
  { label: "Manažer", href: "/manager", icon: Headphones, roles: ["admin", "owner"] },
  { label: "SLA", href: "/sla", icon: Activity, roles: ["admin", "owner"] },
  { label: "Nastavení", href: "/settings", icon: Settings },
];

interface Props {
  children: ReactNode;
}

export default function CZPayrollLayout({ children }: Props) {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [entityType, setEntityType] = useState<string | null>(null);

  // Fetch company entity_type for nav filtering (cached per session)
  useEffect(() => {
    if (!user) return;
    // If already fetched for this user, use cached value
    if (_entityTypeFetchedForUser === user.email && _cachedEntityType !== null) {
      setEntityType(_cachedEntityType);
      return;
    }
    async function fetchEntityType() {
      try {
        const res = await apiClient.authenticatedFetch("/companies/current");
        if (res.ok) {
          const data = await res.json();
          const et = data.company?.entity_type || null;
          _cachedEntityType = et;
          _entityTypeFetchedForUser = user!.email;
          setEntityType(et);
        }
      } catch { /* ignore */ }
    }
    fetchEntityType();
  }, [user]);

  const handleLogout = async () => {
    await signOut();
    navigate("/login");
  };

  // Filter nav items based on role and entity type
  const filteredNav = NAV_ITEMS.filter(item => {
    if (item.roles && user && !item.roles.includes(user.role)) return false;
    if (item.entityTypes && entityType && !item.entityTypes.includes(entityType)) return false;
    if (item.requireEmployees && entityType === 'osvc') return false;
    return true;
  });

  // Current page title for header
  const currentPageTitle = useMemo(() => {
    const match = NAV_ITEMS.find(item =>
      location.pathname === item.href || location.pathname.startsWith(item.href + '/')
    );
    return match?.label || "CZKP";
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-background flex">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 flex-col border-r bg-muted/30">
        {/* Logo */}
        <div className="p-6 border-b">
          <Link to="/dashboard" className="flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            <span className="font-bold text-lg">CZKP Payroll</span>
          </Link>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-4 space-y-1">
          {filteredNav.map(item => {
            const Icon = item.icon;
            const active = location.pathname === item.href || location.pathname.startsWith(item.href + '/');

            return (
              <Link
                key={item.href}
                to={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Sidebar footer - version */}
        <div className="p-4 border-t">
          <div className="text-[10px] text-muted-foreground/60 text-center">CZKP Payroll v1.0</div>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="flex-1 flex flex-col">
        <header className="md:hidden flex items-center justify-between p-4 border-b">
          <Link to="/dashboard" className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <span className="font-bold">CZKP</span>
          </Link>
          <Button variant="ghost" size="icon" onClick={() => setMobileOpen(!mobileOpen)}>
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </header>

        {/* Mobile nav */}
        {mobileOpen && (
          <nav className="md:hidden border-b p-4 space-y-1 bg-background">
            {filteredNav.map(item => {
              const Icon = item.icon;
              const active = location.pathname === item.href || location.pathname.startsWith(item.href + '/');
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium ${
                    active ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
            <Button variant="ghost" size="sm" className="w-full justify-start mt-2" onClick={handleLogout}>
              <LogOut className="h-4 w-4 mr-2" /> Odhlásit
            </Button>
          </nav>
        )}

        {/* Desktop top header */}
        <header className="hidden md:flex items-center justify-between px-6 py-3 border-b bg-background">
          <h1 className="text-lg font-semibold text-foreground">{currentPageTitle}</h1>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground truncate max-w-[200px]">{user?.email}</span>
            <Button variant="outline" size="sm" onClick={handleLogout} className="gap-2">
              <LogOut className="h-3.5 w-3.5" /> Odhlásit se
            </Button>
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
