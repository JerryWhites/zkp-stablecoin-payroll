import { Navigate, Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useCredits } from "@/hooks/useCredits";
import { SUBSCRIPTION_TIERS } from "@/lib/payroll-types";
import { Shield, Check, X, ArrowLeft, Crown, Zap, Building2, Rocket, Mail, Users, PlayCircle, UserCheck, ShoppingCart, Minus, Plus } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

const tierIcons: Record<string, typeof Shield> = {
  start: Zap,
  growth: Rocket,
  business: Crown,
  enterprise: Building2,
};

const tierAccents: Record<string, string> = {
  start: "hsl(220, 15%, 55%)",
  growth: "hsl(350, 65%, 50%)",
  business: "hsl(38, 65%, 55%)",
  enterprise: "hsl(260, 50%, 60%)",
};

const tierGlows: Record<string, string> = {
  start: "rgba(140, 150, 170, 0.08)",
  growth: "rgba(180, 60, 80, 0.12)",
  business: "rgba(200, 160, 60, 0.12)",
  enterprise: "rgba(140, 100, 200, 0.10)",
};

const featureLabels: Record<string, string> = {
  zkTransfers: "ZK soukromé převody",
  csvImport: "CSV import",
  auditLog: "Základní audit log",
  api: "API přístup",
  autoPayroll: "Automatický payroll",
  customReports: "Custom reporty",
  webhooks: "Webhooks + integrace",
  integrations: "Integrace",
  rbac: "RBAC (role)",
  multiSig: "Multi-sig schvalování",
  whiteLabel: "White-label",
  prioritySupport: "Prioritní podpora",
  dedicatedSupport: "Dedikovaný správce",
  onPremise: "On-premise / VPC",
};

// Features displayed in feature checklist (in order)
const displayFeatureKeys = [
  "zkTransfers", "csvImport", "auditLog",
  "api", "autoPayroll", "customReports",
  "webhooks", "rbac",
  "multiSig", "whiteLabel",
  "dedicatedSupport", "onPremise",
];

const formatCZK = (amount: number) =>
  new Intl.NumberFormat('cs-CZ').format(amount);

const Subscription = () => {
  const { user, loading: authLoading } = useAuth();
  const { credits, changeTier, purchaseRuns, loading: creditsLoading, fetchCredits } = useCredits();
  const { toast } = useToast();
  const [changingTier, setChangingTier] = useState<string | null>(null);
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly');
  const [runsToBuy, setRunsToBuy] = useState(1);
  const [purchasing, setPurchasing] = useState(false);

  if (authLoading) return null;
  if (!user) return <Navigate to="/login" replace />;

  const currentTier = credits?.tier?.name?.toLowerCase() || "start";

  const handleChangeTier = async (tierId: string) => {
    if (tierId === "enterprise") return;
    if (tierId === currentTier) return;

    setChangingTier(tierId);
    try {
      await changeTier(tierId);
      toast({
        title: "Plán změněn",
        description: `Nyní jste na plánu ${SUBSCRIPTION_TIERS.find(t => t.id === tierId)?.name}.`,
      });
      await fetchCredits();
    } catch (err: any) {
      toast({
        title: "Změna plánu selhala",
        description: err.message || "Zkuste to prosím znovu.",
        variant: "destructive",
      });
    } finally {
      setChangingTier(null);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "hsl(0, 0%, 4%)", color: "hsl(220, 20%, 90%)" }}>
      {/* Header */}
      <header style={{
        borderBottom: "1px solid hsl(220, 10%, 14%)",
        background: "hsl(0, 0%, 7%)",
      }}>
        <div style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "0 24px",
          height: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}>
          <Link to="/dashboard" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none", color: "inherit" }}>
            <div style={{
              width: 40, height: 40,
              background: "linear-gradient(135deg, hsl(38, 40%, 50%), hsl(38, 50%, 65%))",
              borderRadius: 8,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Shield size={24} color="hsl(0, 0%, 10%)" />
            </div>
            <span style={{ fontFamily: "'Cinzel', serif", fontSize: 20, fontWeight: 700 }}>CZKP</span>
          </Link>
          <Link
            to="/dashboard"
            style={{
              display: "flex", alignItems: "center", gap: 6,
              color: "hsl(220, 10%, 55%)", textDecoration: "none", fontSize: 14,
              transition: "color 0.2s",
            }}
            onMouseEnter={e => (e.currentTarget.style.color = "hsl(220, 20%, 80%)")}
            onMouseLeave={e => (e.currentTarget.style.color = "hsl(220, 10%, 55%)")}
          >
            <ArrowLeft size={16} />
            Zpět na Dashboard
          </Link>
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "48px 24px 80px" }}>
        {/* Title */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <h1 style={{
            fontFamily: "'Cinzel', serif",
            fontSize: 36,
            fontWeight: 700,
            marginBottom: 12,
            letterSpacing: "0.02em",
          }}>
            Vyberte si plán
          </h1>
          <p style={{ color: "hsl(220, 10%, 50%)", fontSize: 16, maxWidth: 520, margin: "0 auto" }}>
            Škálujte svůj zero-knowledge payroll s tím správným předplatným. Všechny plány zahrnují soukromé Aleo transakce.
          </p>
          {credits && (
            <div style={{
              marginTop: 20,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 20px",
              borderRadius: 999,
              background: "hsl(0, 0%, 10%)",
              border: `1px solid ${tierAccents[currentTier] || tierAccents.start}33`,
              fontSize: 13,
              color: "hsl(220, 10%, 60%)",
            }}>
              Aktuální plán: <span style={{ color: tierAccents[currentTier] || tierAccents.start, fontWeight: 600 }}>{credits.tier.display_name}</span>
              <span style={{ color: "hsl(220, 10%, 35%)" }}>·</span>
              <span style={{ color: "hsl(350, 65%, 55%)" }}>{credits.tier.included_employees || '—'} zaměstnanců v ceně</span>
            </div>
          )}
        </div>

        {/* Billing Period Toggle */}
        <div style={{
          display: "flex",
          justifyContent: "center",
          marginBottom: 40,
          gap: 0,
        }}>
          <div style={{
            display: "inline-flex",
            borderRadius: 12,
            border: "1px solid hsl(220, 10%, 18%)",
            background: "hsl(0, 0%, 7%)",
            padding: 3,
          }}>
            <button
              onClick={() => setBillingPeriod('monthly')}
              style={{
                padding: "10px 24px",
                borderRadius: 10,
                border: "none",
                background: billingPeriod === 'monthly' ? "hsl(0, 0%, 14%)" : "transparent",
                color: billingPeriod === 'monthly' ? "hsl(220, 20%, 92%)" : "hsl(220, 10%, 45%)",
                fontWeight: 600,
                fontSize: 14,
                cursor: "pointer",
                transition: "all 0.2s",
              }}
            >
              Měsíčně
            </button>
            <button
              onClick={() => setBillingPeriod('annual')}
              style={{
                padding: "10px 24px",
                borderRadius: 10,
                border: "none",
                background: billingPeriod === 'annual' ? "hsl(0, 0%, 14%)" : "transparent",
                color: billingPeriod === 'annual' ? "hsl(220, 20%, 92%)" : "hsl(220, 10%, 45%)",
                fontWeight: 600,
                fontSize: 14,
                cursor: "pointer",
                transition: "all 0.2s",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              Ročně
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                color: "hsl(140, 60%, 50%)",
                background: "hsl(140, 60%, 50%, 0.12)",
                padding: "2px 8px",
                borderRadius: 999,
                letterSpacing: "0.05em",
              }}>
                SLEVA
              </span>
            </button>
          </div>
        </div>

        {/* Tier Cards */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(270px, 1fr))",
          gap: 20,
          maxWidth: 1160,
          margin: "0 auto",
        }}>
          {SUBSCRIPTION_TIERS.map((tier) => {
            const isCurrent = tier.id === currentTier;
            const isEnterprise = tier.id === "enterprise";
            const accent = tierAccents[tier.id] || tierAccents.start;
            const Icon = tierIcons[tier.id] || Zap;
            const isPopular = tier.id === "business";
            const isLoading = changingTier === tier.id;

            const displayPrice = billingPeriod === 'annual' && tier.annual_monthly_price_czk
              ? tier.annual_monthly_price_czk
              : tier.monthly_price_czk;
            
            const originalPrice = tier.monthly_price_czk;
            const hasDiscount = billingPeriod === 'annual' && tier.annual_monthly_price_czk != null && tier.annual_monthly_price_czk < tier.monthly_price_czk;
            const discountPercent = hasDiscount
              ? Math.round((1 - (tier.annual_monthly_price_czk! / tier.monthly_price_czk)) * 100)
              : 0;

            return (
              <div
                key={tier.id}
                style={{
                  position: "relative",
                  background: isCurrent
                    ? `linear-gradient(165deg, hsl(0, 0%, 9%), hsl(0, 0%, 7%))`
                    : "hsl(0, 0%, 7%)",
                  border: `1px solid ${isCurrent ? accent : "hsl(220, 10%, 16%)"}`,
                  borderRadius: 16,
                  padding: "32px 24px 24px",
                  display: "flex",
                  flexDirection: "column",
                  transition: "border-color 0.3s, box-shadow 0.3s, transform 0.2s",
                  boxShadow: isCurrent
                    ? `0 0 30px ${tierGlows[tier.id]}, inset 0 1px 0 ${accent}22`
                    : "none",
                  cursor: isCurrent ? "default" : "pointer",
                  transform: isPopular && !isCurrent ? "scale(1.02)" : "none",
                }}
                onMouseEnter={e => {
                  if (!isCurrent) {
                    e.currentTarget.style.borderColor = accent;
                    e.currentTarget.style.boxShadow = `0 0 24px ${tierGlows[tier.id]}`;
                    e.currentTarget.style.transform = "translateY(-2px)";
                  }
                }}
                onMouseLeave={e => {
                  if (!isCurrent) {
                    e.currentTarget.style.borderColor = "hsl(220, 10%, 16%)";
                    e.currentTarget.style.boxShadow = "none";
                    e.currentTarget.style.transform = "none";
                  }
                }}
              >
                {/* Popular badge */}
                {isPopular && (
                  <div style={{
                    position: "absolute",
                    top: -12,
                    left: "50%",
                    transform: "translateX(-50%)",
                    background: `linear-gradient(135deg, ${accent}, hsl(38, 55%, 45%))`,
                    color: "hsl(0, 0%, 5%)",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    padding: "5px 16px",
                    borderRadius: 999,
                  }}>
                    Nejoblíbenější
                  </div>
                )}

                {/* Current badge */}
                {isCurrent && (
                  <div style={{
                    position: "absolute",
                    top: -12,
                    right: 20,
                    background: accent,
                    color: "hsl(0, 0%, 5%)",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    padding: "5px 14px",
                    borderRadius: 999,
                  }}>
                    Aktuální
                  </div>
                )}

                {/* Icon + Name */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
                  <div style={{
                    width: 44, height: 44,
                    borderRadius: 12,
                    background: `${accent}18`,
                    border: `1px solid ${accent}30`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <Icon size={22} color={accent} />
                  </div>
                  <div>
                    <h3 style={{
                      fontFamily: "'Cinzel', serif",
                      fontSize: 18,
                      fontWeight: 700,
                      color: "hsl(220, 20%, 92%)",
                      margin: 0,
                    }}>
                      {tier.name}
                    </h3>
                  </div>
                </div>

                {/* Price */}
                <div style={{ marginBottom: 20 }}>
                  {isEnterprise && billingPeriod === 'annual' ? (
                    <div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                        <span style={{ fontSize: 14, color: "hsl(220, 10%, 40%)", textDecoration: "line-through" }}>
                          {formatCZK(originalPrice)} Kč
                        </span>
                      </div>
                      <span style={{
                        fontSize: 28,
                        fontWeight: 700,
                        fontFamily: "'Cinzel', serif",
                        color: accent,
                      }}>
                        Individuální
                      </span>
                      <p style={{ fontSize: 12, color: "hsl(220, 10%, 45%)", marginTop: 4 }}>
                        Roční smlouva na míru
                      </p>
                    </div>
                  ) : isEnterprise ? (
                    <div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                        <span style={{ fontSize: 12, color: "hsl(220, 10%, 40%)" }}>od</span>
                        <span style={{
                          fontSize: 36,
                          fontWeight: 700,
                          fontFamily: "'Cinzel', serif",
                          color: "hsl(220, 20%, 92%)",
                          lineHeight: 1,
                        }}>
                          {formatCZK(displayPrice)}
                        </span>
                        <span style={{ fontSize: 14, color: "hsl(220, 10%, 45%)" }}>Kč/mo</span>
                      </div>
                      <p style={{ fontSize: 12, color: "hsl(220, 10%, 45%)", marginTop: 4 }}>
                        + onboarding fee od 20 000 Kč
                      </p>
                    </div>
                  ) : (
                    <div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                        {hasDiscount && (
                          <span style={{ fontSize: 14, color: "hsl(220, 10%, 35%)", textDecoration: "line-through", marginRight: 4 }}>
                            {formatCZK(originalPrice)}
                          </span>
                        )}
                        <span style={{
                          fontSize: 36,
                          fontWeight: 700,
                          fontFamily: "'Cinzel', serif",
                          color: "hsl(220, 20%, 92%)",
                          lineHeight: 1,
                        }}>
                          {formatCZK(displayPrice)}
                        </span>
                        <span style={{ fontSize: 14, color: "hsl(220, 10%, 45%)" }}>Kč/mo</span>
                        {hasDiscount && (
                          <span style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: "hsl(140, 60%, 50%)",
                            background: "hsl(140, 60%, 50%, 0.12)",
                            padding: "2px 8px",
                            borderRadius: 999,
                            marginLeft: 6,
                          }}>
                            –{discountPercent}%
                          </span>
                        )}
                      </div>

                      {/* Included employees + overage */}
                      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
                        <div style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "4px 12px",
                          borderRadius: 8,
                          background: `${accent}12`,
                          border: `1px solid ${accent}20`,
                        }}>
                          <Users size={13} color={accent} />
                          <span style={{ fontSize: 13, fontWeight: 600, color: accent }}>
                            {tier.included_employees} zaměstnanců v ceně
                          </span>
                        </div>
                        <span style={{ fontSize: 12, color: "hsl(220, 10%, 42%)", paddingLeft: 4 }}>
                          {tier.overage_per_employee_czk} Kč za dalšího zaměstnance
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Key limits row */}
                <div style={{
                  display: "flex",
                  gap: 12,
                  marginBottom: 16,
                  padding: "10px 0",
                  borderTop: "1px solid hsl(220, 10%, 14%)",
                  borderBottom: "1px solid hsl(220, 10%, 14%)",
                }}>
                  <div style={{ flex: 1, textAlign: "center" }}>
                    <PlayCircle size={14} color="hsl(220, 10%, 45%)" style={{ marginBottom: 2 }} />
                    <div style={{ fontSize: 12, fontWeight: 600, color: "hsl(220, 15%, 70%)" }}>
                      {tier.max_payroll_runs === null ? "∞" : tier.max_payroll_runs}
                    </div>
                    <div style={{ fontSize: 9, color: "hsl(220, 10%, 40%)", letterSpacing: "0.05em" }}>
                      {tier.run_limit_type === 'soft' ? 'RUNŮ (FAIR USE)' : tier.max_payroll_runs === null ? 'NEOMEZENO' : 'RUNŮ/MĚSÍC'}
                    </div>
                  </div>
                  <div style={{ width: 1, background: "hsl(220, 10%, 14%)" }} />
                  <div style={{ flex: 1, textAlign: "center" }}>
                    <UserCheck size={14} color="hsl(220, 10%, 45%)" style={{ marginBottom: 2 }} />
                    <div style={{ fontSize: 12, fontWeight: 600, color: "hsl(220, 15%, 70%)" }}>
                      {tier.max_seats === null ? "∞" : tier.max_seats}
                    </div>
                    <div style={{ fontSize: 9, color: "hsl(220, 10%, 40%)", letterSpacing: "0.05em" }}>
                      {tier.max_seats === null ? 'NEOMEZENO' : tier.max_seats === 1 ? 'UŽIVATEL' : 'UŽIVATELÉ'}
                    </div>
                  </div>
                </div>

                {/* Features */}
                <div style={{ flex: 1, marginBottom: 20 }}>
                  {displayFeatureKeys.map((fKey) => {
                    const hasFeature = tier.features[fKey] === true;
                    // Only show advanced features for relevant tiers
                    const isAdvanced = ["multiSig", "whiteLabel", "dedicatedSupport", "onPremise"].includes(fKey);
                    if (isAdvanced && (tier.id === "start" || tier.id === "growth")) return null;

                    return (
                      <div
                        key={fKey}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "5px 0",
                          fontSize: 13,
                          color: hasFeature ? "hsl(220, 15%, 70%)" : "hsl(220, 10%, 30%)",
                        }}
                      >
                        {hasFeature ? (
                          <Check size={15} color={accent} strokeWidth={2.5} />
                        ) : (
                          <X size={15} color="hsl(220, 10%, 25%)" strokeWidth={2} />
                        )}
                        <span>{featureLabels[fKey] || fKey}</span>
                      </div>
                    );
                  })}
                  
                  {/* SLA line */}
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "5px 0",
                    fontSize: 13,
                    color: "hsl(220, 15%, 70%)",
                  }}>
                    <Check size={15} color={accent} strokeWidth={2.5} />
                    <span>SLA: {tier.sla}</span>
                  </div>
                </div>

                {/* CTA Button */}
                {isEnterprise ? (
                  <a
                    href="mailto:sales@czkpayroll.com?subject=Enterprise%20plán%20–%20zájem"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      padding: "12px 0",
                      borderRadius: 10,
                      background: "transparent",
                      border: `1px solid ${accent}50`,
                      color: accent,
                      fontWeight: 600,
                      fontSize: 14,
                      textDecoration: "none",
                      transition: "background 0.2s, border-color 0.2s",
                      cursor: "pointer",
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = `${accent}15`;
                      e.currentTarget.style.borderColor = accent;
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.borderColor = `${accent}50`;
                    }}
                  >
                    <Mail size={16} />
                    Kontaktovat obchod
                  </a>
                ) : isCurrent ? (
                  <div style={{
                    padding: "12px 0",
                    borderRadius: 10,
                    background: `${accent}15`,
                    border: `1px solid ${accent}30`,
                    color: accent,
                    fontWeight: 600,
                    fontSize: 14,
                    textAlign: "center",
                  }}>
                    Aktuální plán
                  </div>
                ) : (
                  <button
                    onClick={() => handleChangeTier(tier.id)}
                    disabled={isLoading}
                    style={{
                      padding: "12px 0",
                      borderRadius: 10,
                      background: isPopular
                        ? `linear-gradient(135deg, ${accent}, hsl(38, 55%, 45%))`
                        : accent,
                      border: "none",
                      color: "hsl(0, 0%, 5%)",
                      fontWeight: 700,
                      fontSize: 14,
                      cursor: isLoading ? "wait" : "pointer",
                      transition: "opacity 0.2s, transform 0.15s",
                      opacity: isLoading ? 0.7 : 1,
                      width: "100%",
                    }}
                    onMouseEnter={e => { if (!isLoading) e.currentTarget.style.opacity = "0.85"; }}
                    onMouseLeave={e => { if (!isLoading) e.currentTarget.style.opacity = "1"; }}
                  >
                    {isLoading
                      ? "Přepínám..."
                      : SUBSCRIPTION_TIERS.findIndex(t => t.id === tier.id) > SUBSCRIPTION_TIERS.findIndex(t => t.id === currentTier)
                        ? `Upgradovat na ${tier.name}`
                        : `Přejít na ${tier.name}`}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Buy Additional Payroll Runs */}
        {credits && (
          <div style={{
            marginTop: 48,
            maxWidth: 600,
            marginLeft: "auto",
            marginRight: "auto",
            borderRadius: 16,
            background: "linear-gradient(165deg, hsl(0, 0%, 9%), hsl(0, 0%, 6%))",
            border: "1px solid hsl(38, 40%, 30%)",
            padding: "32px 28px",
            boxShadow: "0 0 40px rgba(200, 160, 60, 0.06)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <div style={{
                width: 44, height: 44,
                borderRadius: 12,
                background: "hsl(38, 40%, 50%, 0.15)",
                border: "1px solid hsl(38, 40%, 50%, 0.3)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <ShoppingCart size={22} color="hsl(38, 50%, 55%)" />
              </div>
              <div>
                <h3 style={{
                  fontFamily: "'Cinzel', serif",
                  fontSize: 20,
                  fontWeight: 700,
                  color: "hsl(220, 20%, 92%)",
                  margin: 0,
                }}>
                  Koupit payroll runy
                </h3>
                <p style={{ fontSize: 13, color: "hsl(220, 10%, 50%)", margin: 0 }}>
                  Dokupte si další payroll zpracování nad rámec plánu
                </p>
              </div>
            </div>

            {/* Current plan info */}
            <div style={{
              display: "flex",
              gap: 16,
              marginBottom: 24,
              padding: "14px 16px",
              borderRadius: 10,
              background: "hsl(0, 0%, 5%)",
              border: "1px solid hsl(220, 10%, 14%)",
            }}>
              <div style={{ flex: 1, textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "hsl(220, 10%, 45%)", marginBottom: 4, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                  Váš plán
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "hsl(38, 50%, 55%)" }}>
                  {credits.tier.display_name}
                </div>
              </div>
              <div style={{ width: 1, background: "hsl(220, 10%, 14%)" }} />
              <div style={{ flex: 1, textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "hsl(220, 10%, 45%)", marginBottom: 4, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                  Cena za run
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "hsl(220, 20%, 92%)" }}>
                  {formatCZK(credits.tier.cost_per_run_czk || 0)} Kč
                </div>
              </div>
              <div style={{ width: 1, background: "hsl(220, 10%, 14%)" }} />
              <div style={{ flex: 1, textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "hsl(220, 10%, 45%)", marginBottom: 4, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                  Zbývá runů
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "hsl(140, 60%, 55%)" }}>
                  {credits.estimates.payrolls_remaining}
                </div>
              </div>
            </div>

            {/* Run quantity selector */}
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 20,
              marginBottom: 20,
            }}>
              <button
                onClick={() => setRunsToBuy(Math.max(1, runsToBuy - 1))}
                disabled={runsToBuy <= 1}
                style={{
                  width: 40, height: 40,
                  borderRadius: 10,
                  border: "1px solid hsl(220, 10%, 20%)",
                  background: "hsl(0, 0%, 8%)",
                  color: runsToBuy <= 1 ? "hsl(220, 10%, 25%)" : "hsl(220, 20%, 80%)",
                  cursor: runsToBuy <= 1 ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 18,
                  transition: "all 0.2s",
                }}
              >
                <Minus size={18} />
              </button>
              
              <div style={{ textAlign: "center", minWidth: 80 }}>
                <div style={{
                  fontSize: 40,
                  fontWeight: 700,
                  fontFamily: "'Cinzel', serif",
                  color: "hsl(220, 20%, 92%)",
                  lineHeight: 1,
                }}>
                  {runsToBuy}
                </div>
                <div style={{ fontSize: 12, color: "hsl(220, 10%, 45%)", marginTop: 2 }}>
                  {runsToBuy === 1 ? 'payroll run' : 'payroll runů'}
                </div>
              </div>
              
              <button
                onClick={() => setRunsToBuy(Math.min(100, runsToBuy + 1))}
                disabled={runsToBuy >= 100}
                style={{
                  width: 40, height: 40,
                  borderRadius: 10,
                  border: "1px solid hsl(220, 10%, 20%)",
                  background: "hsl(0, 0%, 8%)",
                  color: runsToBuy >= 100 ? "hsl(220, 10%, 25%)" : "hsl(220, 20%, 80%)",
                  cursor: runsToBuy >= 100 ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 18,
                  transition: "all 0.2s",
                }}
              >
                <Plus size={18} />
              </button>
            </div>

            {/* Quick select buttons */}
            <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 24 }}>
              {[1, 3, 5, 10, 20].map(n => (
                <button
                  key={n}
                  onClick={() => setRunsToBuy(n)}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 8,
                    border: `1px solid ${runsToBuy === n ? 'hsl(38, 50%, 50%)' : 'hsl(220, 10%, 18%)'}`,
                    background: runsToBuy === n ? "hsl(38, 50%, 50%, 0.15)" : "hsl(0, 0%, 7%)",
                    color: runsToBuy === n ? "hsl(38, 50%, 65%)" : "hsl(220, 10%, 50%)",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.2s",
                  }}
                >
                  {n}×
                </button>
              ))}
            </div>

            {/* Total & Purchase button */}
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "16px 20px",
              borderRadius: 12,
              background: "hsl(0, 0%, 5%)",
              border: "1px solid hsl(220, 10%, 16%)",
            }}>
              <div>
                <div style={{ fontSize: 12, color: "hsl(220, 10%, 45%)", marginBottom: 2 }}>Celkem</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: "hsl(220, 20%, 92%)" }}>
                  {formatCZK(runsToBuy * (credits.tier.cost_per_run_czk || 0))} Kč
                </div>
                <div style={{ fontSize: 11, color: "hsl(220, 10%, 40%)" }}>
                  {runsToBuy}× run × {formatCZK(credits.tier.cost_per_run_czk || 0)} Kč
                </div>
              </div>
              <button
                onClick={async () => {
                  setPurchasing(true);
                  try {
                    const result = await purchaseRuns(runsToBuy);
                    toast({
                      title: "Runy zakoupeny!",
                      description: result.message || `${runsToBuy}× payroll run přidáno`,
                    });
                    setRunsToBuy(1);
                  } catch (err: any) {
                    toast({
                      title: "Nákup selhal",
                      description: err.message || "Zkuste to prosím znovu.",
                      variant: "destructive",
                    });
                  } finally {
                    setPurchasing(false);
                  }
                }}
                disabled={purchasing || (credits.tier.cost_per_run_czk || 0) === 0}
                style={{
                  padding: "14px 28px",
                  borderRadius: 10,
                  background: purchasing ? "hsl(38, 30%, 35%)" : "linear-gradient(135deg, hsl(38, 50%, 50%), hsl(38, 55%, 42%))",
                  border: "none",
                  color: "hsl(0, 0%, 5%)",
                  fontWeight: 700,
                  fontSize: 15,
                  cursor: purchasing ? "wait" : "pointer",
                  transition: "opacity 0.2s",
                  opacity: purchasing ? 0.7 : 1,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <ShoppingCart size={18} />
                {purchasing ? "Zpracovávám..." : "Koupit runy"}
              </button>
            </div>
          </div>
        )}

        {/* Bottom note */}
        <div style={{
          textAlign: "center",
          marginTop: 48,
          padding: "20px 24px",
          borderRadius: 12,
          background: "hsl(0, 0%, 6%)",
          border: "1px solid hsl(220, 10%, 14%)",
          maxWidth: 640,
          margin: "48px auto 0",
        }}>
          <p style={{ fontSize: 13, color: "hsl(220, 10%, 45%)", lineHeight: 1.6 }}>
            Měsíční paušál pokrývá uvedený počet zaměstnanců. Za další zaměstnance se účtuje overage dle sazby plánu.
            Všechny transakce jsou zpracovány soukromě na Aleo blockchainu pomocí zero-knowledge proofs.
            Ceny jsou v CZK bez DPH.
          </p>
        </div>
      </main>
    </div>
  );
};

export default Subscription;
