// ====================================
// 💰 Crypto Settings Panel — Employee Self-Service
// ====================================
// Allows employees to set their crypto payout preferences:
// - Opt-in/out of crypto payouts
// - Choose token (ALEO or USDCx)
// - Set percentage of net salary paid in crypto
// - Enter/update wallet address

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/lib/api-client";
import { Coins, DollarSign, Wallet, Shield, Loader2, Save, Info } from "lucide-react";
import { ALEO_ADDRESS_REGEX } from "@/lib/payroll-types";

interface CryptoSettings {
  stablecoin_pct: number;
  preferred_token: "NONE" | "ALEO" | "USDCx";
  wallet_address: string | null;
  crypto_opt_in: boolean;
  crypto_settings_updated_at: string | null;
}

export default function CryptoSettingsPanel() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<CryptoSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state
  const [optIn, setOptIn] = useState(false);
  const [token, setToken] = useState<"NONE" | "ALEO" | "USDCx">("NONE");
  const [pct, setPct] = useState(0);
  const [walletAddr, setWalletAddr] = useState("");

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.authenticatedFetch("/v2/portal/crypto-settings");
      if (res.ok) {
        const data: CryptoSettings = await res.json();
        setSettings(data);
        setOptIn(data.crypto_opt_in);
        setToken(data.preferred_token);
        setPct(data.stablecoin_pct);
        setWalletAddr(data.wallet_address || "");
      }
    } catch (error) {
      console.error("Failed to fetch crypto settings:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const saveSettings = async () => {
    // Validate wallet address when opting in
    if (optIn && token !== "NONE" && pct > 0) {
      if (!walletAddr.trim()) {
        toast({ title: "Chyba", description: "Vyplňte Aleo wallet adresu.", variant: "destructive" });
        return;
      }
      if (!ALEO_ADDRESS_REGEX.test(walletAddr.trim())) {
        toast({ title: "Chyba", description: "Neplatný formát Aleo adresy (aleo1...).", variant: "destructive" });
        return;
      }
    }

    setSaving(true);
    try {
      const res = await apiClient.authenticatedFetch("/v2/portal/crypto-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stablecoin_pct: pct,
          preferred_token: token,
          wallet_address: walletAddr.trim() || null,
          crypto_opt_in: optIn,
        }),
      });
      if (res.ok) {
        toast({ title: "Krypto nastavení uloženo" });
        fetchSettings();
      } else {
        const err = await res.json();
        toast({ title: "Chyba", description: err.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba při ukládání", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">Načítání krypto nastavení...</p>
        </CardContent>
      </Card>
    );
  }

  const effectiveToken = optIn ? token : "NONE";
  const effectivePct = optIn && token !== "NONE" ? pct : 0;
  const fiatPct = 100 - effectivePct;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5" /> Krypto výplata
          </CardTitle>
          <CardDescription>
            Nastavte, jakou část čisté mzdy chcete dostávat v kryptoměně (ALEO nebo USDCx).
            Zbývající část bude vyplacena standardním bankovním převodem.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Opt-in toggle */}
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label className="font-medium">Aktivovat krypto výplatu</Label>
              <p className="text-sm text-muted-foreground">
                Část vaší mzdy bude vyplacena jako soukromá ZK transakce na Aleo.
              </p>
            </div>
            <Switch checked={optIn} onCheckedChange={setOptIn} />
          </div>

          {optIn && (
            <>
              {/* Token selection */}
              <div className="space-y-2">
                <Label>Preferovaný token</Label>
                <Select value={token} onValueChange={(v) => setToken(v as typeof token)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">
                      <span className="flex items-center gap-2">Žádný (vše fiatem)</span>
                    </SelectItem>
                    <SelectItem value="USDCx">
                      <span className="flex items-center gap-2">
                        <DollarSign className="h-4 w-4 text-emerald-600" /> USDCx — USD stablecoin (Circle)
                      </span>
                    </SelectItem>
                    <SelectItem value="ALEO">
                      <span className="flex items-center gap-2">
                        <Coins className="h-4 w-4 text-blue-600" /> ALEO — nativní token
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {token !== "NONE" && (
                <>
                  {/* Percentage slider */}
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <Label>Podíl krypto výplaty</Label>
                      <span className="text-sm font-bold">{pct}%</span>
                    </div>
                    <Slider
                      value={[pct]}
                      onValueChange={([v]) => setPct(v)}
                      max={100}
                      min={0}
                      step={5}
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>0% (vše fiatem)</span>
                      <span>100% (vše kryptem)</span>
                    </div>

                    {/* Visual split bar */}
                    <div className="flex h-6 rounded-full overflow-hidden border">
                      {fiatPct > 0 && (
                        <div
                          className="bg-blue-200 dark:bg-blue-900 flex items-center justify-center text-xs font-medium"
                          style={{ width: `${fiatPct}%` }}
                        >
                          {fiatPct > 15 ? `${fiatPct}% CZK` : ""}
                        </div>
                      )}
                      {effectivePct > 0 && (
                        <div
                          className={`flex items-center justify-center text-xs font-medium ${
                            token === "USDCx"
                              ? "bg-emerald-200 dark:bg-emerald-900"
                              : "bg-violet-200 dark:bg-violet-900"
                          }`}
                          style={{ width: `${effectivePct}%` }}
                        >
                          {effectivePct > 15 ? `${effectivePct}% ${token}` : ""}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Wallet address */}
                  <div className="space-y-2">
                    <Label>Aleo wallet adresa</Label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Wallet className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          className="pl-9 font-mono text-sm"
                          value={walletAddr}
                          onChange={(e) => setWalletAddr(e.target.value)}
                          placeholder="aleo1..."
                        />
                      </div>
                    </div>
                    {walletAddr && !ALEO_ADDRESS_REGEX.test(walletAddr) && (
                      <p className="text-xs text-destructive">Neplatný formát. Adresa musí začínat aleo1 a mít 63 znaků.</p>
                    )}
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Shield className="h-3 w-3" />
                      Podporované peněženky: Shield Wallet, Leo Wallet, Puzzle
                    </p>
                  </div>

                  {/* Info about USDCx */}
                  {token === "USDCx" && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950 p-3 text-sm">
                      <div className="flex items-start gap-2">
                        <Info className="h-4 w-4 mt-0.5 text-emerald-600" />
                        <div>
                          <p className="font-medium text-emerald-800 dark:text-emerald-200">USDCx — soukromý USD stablecoin</p>
                          <p className="text-emerald-700 dark:text-emerald-300 mt-1">
                            USDCx je 1:1 krytý USDC (Circle xReserve) na Aleo blockchainu.
                            Díky ZK technologii je příjemce, odesílatel i částka plně soukromá.
                            Můžete ho kdykoliv vyměnit zpět na USDC přes{" "}
                            <a href="https://usdcx.aleo.org" target="_blank" rel="noopener noreferrer" className="underline font-medium">
                              usdcx.aleo.org
                            </a>.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* Save button */}
          <div className="flex justify-end pt-2">
            <Button onClick={saveSettings} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Uložit nastavení
            </Button>
          </div>

          {/* Last updated */}
          {settings?.crypto_settings_updated_at && (
            <p className="text-xs text-muted-foreground text-right">
              Naposledy změněno: {new Date(settings.crypto_settings_updated_at).toLocaleString("cs-CZ")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
