// ====================================
// 🔐 ZK Payment Step — Aleo Private Payments (ALEO + USDCx)
// ====================================
// Self-contained wallet provider + payment execution for PayrollWizard Step 5.
// Supports dual-token: ALEO credits + USDCx stablecoin via token_registry.aleo.
// Connects to Aleo wallet, executes private transfers, records TX IDs on backend.

import { useMemo, useState, useCallback } from "react";
import { WalletProvider, useWallet } from "@demox-labs/aleo-wallet-adapter-react";
import { WalletModalProvider, WalletMultiButton } from "@demox-labs/aleo-wallet-adapter-reactui";
import { LeoWalletAdapter } from "@demox-labs/aleo-wallet-adapter-leo";
import { PuzzleWalletDemoxAdapter } from "@/lib/PuzzleWalletDemoxAdapter";
import { ShieldWalletDemoxAdapter } from "@/lib/ShieldWalletDemoxAdapter";
import { Transaction, DecryptPermission } from "@demox-labs/aleo-wallet-adapter-base";
import "@demox-labs/aleo-wallet-adapter-reactui/styles.css";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Wallet,
  CheckCircle,
  XCircle,
  Loader2,
  ExternalLink,
  AlertTriangle,
  Zap,
  Shield,
  DollarSign,
  Coins,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/lib/api-client";

import type { PayrollItem } from "@/lib/cz-payroll-types";
import {
  TOKEN_CONFIG,
  USDCX_TOKEN_CONFIG,
  PAYROLL_PROGRAM_ID,
  PAYROLL_FUNCTION_ALEO,
  PAYROLL_FUNCTION_USDCX,
  NETWORK_MODE,
  PAYROLL_FUNCTION,
  FEE_NETWORK,
  ALEO_EXPLORER_URL,
} from "@/lib/payroll-types";
import { logger } from "@/lib/logger";

// ── Types ──

type PaymentToken = "ALEO" | "USDCx";

interface ZKPaymentStepProps {
  items: PayrollItem[];
  periodUuid: string;
  czk_aleo_rate: number | null;
  czk_usd_rate?: number | null;
}

interface EmployeePayment {
  uuid: string;
  name: string;
  aleo_address: string;
  wallet_address?: string | null;
  cista_czk: number;
  fiat_payout_czk: number;
  crypto_payout_czk: number;
  crypto_payout_amount: number; // base units
  crypto_payout_token: PaymentToken | "NONE";
  status: "pending" | "processing" | "sent" | "failed" | "skipped";
  tx_id?: string;
  error?: string;
}

// ── Inner Component (uses wallet context) ──

function ZKPaymentInner({ items, periodUuid, czk_aleo_rate, czk_usd_rate }: ZKPaymentStepProps) {
  const wallet = useWallet();
  const { toast } = useToast();
  const publicKey = wallet?.publicKey?.toString() || "";

  const [payments, setPayments] = useState<EmployeePayment[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [logs, setLogs] = useState<string[]>([]);
  const [initialized, setInitialized] = useState(false);

  const addLog = useCallback((msg: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString("cs-CZ")}] ${msg}`]);
  }, []);

  // Build payment list from items that have crypto payouts
  const initializePayments = useCallback(() => {
    const payable = items
      .filter((item) => {
        // Employee needs either aleo_address or wallet_address, and crypto_payout_amount > 0
        const addr = item.wallet_address || item.aleo_address;
        return addr && addr.startsWith("aleo1") && (item.crypto_payout_amount || 0) > 0;
      })
      .map((item) => ({
        uuid: item.uuid,
        name: item.name || "—",
        aleo_address: item.aleo_address || "",
        wallet_address: item.wallet_address,
        cista_czk: item.k_vyplate_czk || item.cista_mzda_czk || 0,
        fiat_payout_czk: item.fiat_payout_czk || 0,
        crypto_payout_czk: item.crypto_payout_czk || 0,
        crypto_payout_amount: item.crypto_payout_amount || 0,
        crypto_payout_token: (item.crypto_payout_token || "NONE") as PaymentToken | "NONE",
        status: "pending" as const,
      }));

    // Also include legacy items that only have aleo_address + cista_mzda_aleo (no crypto split yet)
    const legacyPayable = items
      .filter((item) => {
        if (payable.find(p => p.uuid === item.uuid)) return false; // already included
        return item.aleo_address?.startsWith("aleo1") && (item.cista_mzda_aleo || 0) > 0;
      })
      .map((item) => ({
        uuid: item.uuid,
        name: item.name || "—",
        aleo_address: item.aleo_address!,
        wallet_address: null,
        cista_czk: item.cista_mzda_czk || 0,
        fiat_payout_czk: 0,
        crypto_payout_czk: item.cista_mzda_czk || 0,
        crypto_payout_amount: item.cista_mzda_aleo || 0,
        crypto_payout_token: "ALEO" as const,
        status: "pending" as const,
      }));

    const allPayments = [...payable, ...legacyPayable];
    setPayments(allPayments);
    setInitialized(true);

    const usdcxCount = allPayments.filter(p => p.crypto_payout_token === "USDCx").length;
    const aleoCount = allPayments.filter(p => p.crypto_payout_token === "ALEO").length;
    addLog(`Nalezeno ${allPayments.length} zaměstnanců s krypto výplatou (${aleoCount} ALEO, ${usdcxCount} USDCx).`);
    if (czk_aleo_rate && czk_aleo_rate > 0) addLog(`Kurz: 1 ALEO = ${czk_aleo_rate.toFixed(2)} CZK`);
    if (czk_usd_rate && czk_usd_rate > 0) addLog(`Kurz: 1 USD = ${czk_usd_rate.toFixed(2)} CZK`);
  }, [items, czk_aleo_rate, czk_usd_rate, addLog]);

  if (!initialized) {
    initializePayments();
  }

  // Count stats
  const sentCount = payments.filter((p) => p.status === "sent").length;
  const failedCount = payments.filter((p) => p.status === "failed").length;
  const pendingCount = payments.filter((p) => p.status === "pending").length;
  const progress = payments.length > 0
    ? Math.round(((sentCount + failedCount) / payments.length) * 100)
    : 0;

  const totalAleoAmount = payments
    .filter(p => p.crypto_payout_token === "ALEO")
    .reduce((s, p) => s + p.crypto_payout_amount, 0);
  const totalUsdcxAmount = payments
    .filter(p => p.crypto_payout_token === "USDCx")
    .reduce((s, p) => s + p.crypto_payout_amount, 0);

  // Build transaction for a payment
  function buildTransaction(payment: EmployeePayment) {
    const recipientAddr = payment.wallet_address || payment.aleo_address;

    if (payment.crypto_payout_token === "USDCx") {
      // USDCx via czkp_payroll_v4.aleo/pay_employee_usdcx
      return Transaction.createTransaction(
        publicKey,
        NETWORK_MODE,
        PAYROLL_PROGRAM_ID,
        PAYROLL_FUNCTION_USDCX,
        [recipientAddr, `${payment.crypto_payout_amount}u128`],
        FEE_NETWORK,
        false
      );
    } else {
      // ALEO credits via czkp_payroll_v4.aleo/pay_employee_aleo
      return Transaction.createTransaction(
        publicKey,
        NETWORK_MODE,
        PAYROLL_PROGRAM_ID,
        PAYROLL_FUNCTION_ALEO,
        [recipientAddr, `${payment.crypto_payout_amount}u64`],
        FEE_NETWORK,
        false
      );
    }
  }

  // Execute all payments sequentially
  const executePayments = async () => {
    if (!wallet.connected || !publicKey) {
      toast({ title: "Připojte peněženku", description: "Nejprve připojte Aleo peněženku.", variant: "destructive" });
      return;
    }

    if (!wallet.requestTransaction) {
      toast({ title: "Nepodporovaná peněženka", description: "Vaše peněženka nepodporuje odesílání transakcí.", variant: "destructive" });
      return;
    }

    setIsExecuting(true);
    addLog("🚀 Spouštím ZK platby...");

    for (let i = 0; i < payments.length; i++) {
      const payment = payments[i];
      if (payment.status !== "pending") continue;
      if (payment.crypto_payout_amount <= 0 || payment.crypto_payout_token === "NONE") {
        updatePayment(i, { status: "skipped", error: "Nulová částka / bez tokenu" });
        addLog(`⏭️ ${payment.name}: přeskočen`);
        continue;
      }

      setCurrentIndex(i);
      updatePayment(i, { status: "processing" });

      const tokenLabel = payment.crypto_payout_token;
      const decimals = tokenLabel === "USDCx" ? USDCX_TOKEN_CONFIG.decimals : TOKEN_CONFIG.decimals;
      const amountFormatted = (payment.crypto_payout_amount / decimals).toFixed(tokenLabel === "USDCx" ? 2 : 4);
      addLog(`🔐 Zpracovávám: ${payment.name} — ${amountFormatted} ${tokenLabel}`);

      try {
        const tx = buildTransaction(payment);
        const txId = await wallet.requestTransaction(tx);

        if (!txId) {
          throw new Error("Peněženka nevrátila ID transakce");
        }

        updatePayment(i, { status: "sent", tx_id: txId });
        addLog(`✅ ${payment.name}: TX ${String(txId).slice(0, 20)}...`);

        // Record on backend
        try {
          await apiClient.authenticatedFetch("/v2/payroll/aleo-payment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              item_uuid: payment.uuid,
              aleo_tx_id: String(txId),
              status: "sent",
              payment_token: tokenLabel,
            }),
          });
        } catch {
          logger.warn("Failed to record TX on backend", { uuid: payment.uuid, txId });
        }
      } catch (err: any) {
        const msg = err?.message?.substring(0, 100) || String(err);
        updatePayment(i, { status: "failed", error: msg });
        addLog(`❌ ${payment.name}: ${msg}`);

        // Record failure on backend
        try {
          await apiClient.authenticatedFetch("/v2/payroll/aleo-payment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              item_uuid: payment.uuid,
              aleo_tx_id: "",
              status: "failed",
              payment_token: payment.crypto_payout_token,
            }),
          });
        } catch { /* ignore */ }
      }
    }

    setIsExecuting(false);
    setCurrentIndex(-1);
    addLog("🏁 Všechny platby zpracovány.");
    toast({
      title: "ZK platby dokončeny",
      description: `Odesláno: ${payments.filter(p => p.status === "sent").length}, chyby: ${payments.filter(p => p.status === "failed").length}`,
    });
  };

  // Retry a single failed payment
  const retryPayment = async (index: number) => {
    if (!wallet.connected || !wallet.requestTransaction) return;

    const payment = payments[index];
    updatePayment(index, { status: "processing", error: undefined, tx_id: undefined });
    addLog(`🔄 Opakuji: ${payment.name}`);

    try {
      const tx = buildTransaction(payment);
      const txId = await wallet.requestTransaction(tx);
      if (!txId) throw new Error("Peněženka nevrátila ID transakce");

      updatePayment(index, { status: "sent", tx_id: txId });
      addLog(`✅ ${payment.name}: TX ${String(txId).slice(0, 20)}...`);

      await apiClient.authenticatedFetch("/v2/payroll/aleo-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_uuid: payment.uuid,
          aleo_tx_id: String(txId),
          status: "sent",
          payment_token: payment.crypto_payout_token,
        }),
      }).catch(() => {});
    } catch (err: any) {
      const msg = err?.message?.substring(0, 100) || String(err);
      updatePayment(index, { status: "failed", error: msg });
      addLog(`❌ ${payment.name}: ${msg}`);
    }
  };

  function updatePayment(index: number, update: Partial<EmployeePayment>) {
    setPayments((prev) => prev.map((p, i) => (i === index ? { ...p, ...update } : p)));
  }

  const formatToken = (baseUnits: number, token: string) => {
    const decimals = token === "USDCx" ? USDCX_TOKEN_CONFIG.decimals : TOKEN_CONFIG.decimals;
    const dp = token === "USDCx" ? 2 : 4;
    return (baseUnits / decimals).toFixed(dp);
  };

  const formatCZK = (amount: number) =>
    new Intl.NumberFormat("cs-CZ").format(Math.round(amount)) + " Kč";

  const tokenBadge = (token: string) => {
    if (token === "USDCx") return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300"><DollarSign className="w-3 h-3 mr-0.5" />USDCx</Badge>;
    if (token === "ALEO") return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300"><Coins className="w-3 h-3 mr-0.5" />ALEO</Badge>;
    return <Badge variant="secondary">—</Badge>;
  };

  // ── No employees with crypto payout ──
  if (initialized && payments.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Wallet className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-semibold mb-2">Žádné krypto výplaty</h3>
          <p className="text-muted-foreground text-sm max-w-md mx-auto">
            Žádný zaměstnanec nemá nastavenu krypto výplatu. Zaměstnanci si mohou
            nastavit podíl krypto výplaty a wallet adresu v&nbsp;portálu, nebo to nastaví HR.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Wallet Connection */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-accent" />
              Aleo Peněženka
            </CardTitle>
            <WalletMultiButton />
          </div>
        </CardHeader>
        <CardContent>
          {wallet.connected ? (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle className="w-4 h-4" />
              Připojeno: {publicKey.slice(0, 12)}...{publicKey.slice(-6)}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Připojte Leo, Puzzle nebo Shield peněženku pro odesílání ZK plateb.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Payment Summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-accent" />
            ZK Platby ({payments.length} zaměstnanců)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm">
            {totalAleoAmount > 0 && (
              <div>
                <p className="text-muted-foreground">Celkem ALEO</p>
                <p className="text-lg font-bold">{formatToken(totalAleoAmount, "ALEO")}</p>
              </div>
            )}
            {totalUsdcxAmount > 0 && (
              <div>
                <p className="text-muted-foreground">Celkem USDCx</p>
                <p className="text-lg font-bold text-emerald-600">{formatToken(totalUsdcxAmount, "USDCx")}</p>
              </div>
            )}
            <div>
              <p className="text-muted-foreground">Odesláno</p>
              <p className="text-lg font-bold text-green-600">{sentCount}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Čeká</p>
              <p className="text-lg font-bold">{pendingCount}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Chyby</p>
              <p className="text-lg font-bold text-destructive">{failedCount}</p>
            </div>
          </div>

          {isExecuting && <Progress value={progress} className="h-2" />}

          <Separator />

          {/* Employee payment table */}
          <ScrollArea className="max-h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Zaměstnanec</TableHead>
                  <TableHead className="text-right">Fiat (CZK)</TableHead>
                  <TableHead className="text-right">Krypto</TableHead>
                  <TableHead className="text-center">Token</TableHead>
                  <TableHead className="text-center">Stav</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((p, i) => (
                  <TableRow
                    key={p.uuid}
                    className={currentIndex === i ? "bg-accent/10" : ""}
                  >
                    <TableCell>
                      <div>
                        <p className="font-medium">{p.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">
                          {(p.wallet_address || p.aleo_address).slice(0, 14)}...
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {p.fiat_payout_czk > 0 ? formatCZK(p.fiat_payout_czk) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm font-mono">
                      {formatToken(p.crypto_payout_amount, p.crypto_payout_token)}
                    </TableCell>
                    <TableCell className="text-center">
                      {tokenBadge(p.crypto_payout_token)}
                    </TableCell>
                    <TableCell className="text-center">
                      {p.status === "pending" && (
                        <Badge variant="outline">Čeká</Badge>
                      )}
                      {p.status === "processing" && (
                        <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300">
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          Odesílám
                        </Badge>
                      )}
                      {p.status === "sent" && (
                        <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">
                          <CheckCircle className="w-3 h-3 mr-1" />
                          Odesláno
                        </Badge>
                      )}
                      {p.status === "failed" && (
                        <Badge variant="destructive">
                          <XCircle className="w-3 h-3 mr-1" />
                          Chyba
                        </Badge>
                      )}
                      {p.status === "skipped" && (
                        <Badge variant="secondary">Přeskočen</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {p.tx_id && (
                          <a
                            href={`${ALEO_EXPLORER_URL}/${p.tx_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent hover:underline"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        )}
                        {p.status === "failed" && !isExecuting && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => retryPayment(i)}
                            className="text-xs"
                          >
                            Opakovat
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>

          {/* Action buttons */}
          <div className="flex justify-end gap-3">
            {pendingCount > 0 && !isExecuting && (
              <Button
                onClick={executePayments}
                disabled={!wallet.connected}
                className="bg-accent hover:bg-accent/90 text-accent-foreground"
              >
                <Zap className="w-4 h-4 mr-2" />
                Odeslat ZK platby ({pendingCount})
              </Button>
            )}
            {isExecuting && (
              <Button disabled>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Odesílám... ({sentCount + failedCount}/{payments.length})
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Execution Log */}
      {logs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Protokol</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[200px]">
              <div className="space-y-1 font-mono text-xs">
                {logs.map((log, i) => (
                  <p key={i} className="text-muted-foreground">{log}</p>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Wrapper with Self-Contained Wallet Provider ──

export default function ZKPaymentStep(props: ZKPaymentStepProps) {
  const wallets = useMemo(
    () => [
      new ShieldWalletDemoxAdapter() as any,
      new LeoWalletAdapter({ appName: "CZKP Payroll" }),
      new PuzzleWalletDemoxAdapter({ appName: "CZKP Payroll" }) as any,
    ],
    []
  );

  return (
    <WalletProvider
      wallets={wallets}
      autoConnect
      network={NETWORK_MODE}
      decryptPermission={DecryptPermission.AutoDecrypt}
      programs={["credits.aleo", "token_registry.aleo", "czkp_payroll_v4.aleo"]}
    >
      <WalletModalProvider>
        <ZKPaymentInner {...props} />
      </WalletModalProvider>
    </WalletProvider>
  );
}
