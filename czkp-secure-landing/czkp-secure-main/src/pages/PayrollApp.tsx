import { logger } from "@/lib/logger";
import React, { useMemo, useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { WalletProvider, useWallet } from "@demox-labs/aleo-wallet-adapter-react";
import { WalletModalProvider, WalletMultiButton } from "@demox-labs/aleo-wallet-adapter-reactui";
import { LeoWalletAdapter } from "@demox-labs/aleo-wallet-adapter-leo";
import { PuzzleWalletDemoxAdapter, type RecordWithPlaintext } from "@/lib/PuzzleWalletDemoxAdapter";
import { ShieldWalletDemoxAdapter } from "@/lib/ShieldWalletDemoxAdapter";
import { Transaction, DecryptPermission } from "@demox-labs/aleo-wallet-adapter-base";
import { useToast } from "@/hooks/use-toast";
import "@demox-labs/aleo-wallet-adapter-reactui/styles.css";

// Shared types & config
import type { Employee, HistoryRecord, WalletRecord, CreditInfo } from "@/lib/payroll-types";
import {
  TOKEN_CONFIG,
  NETWORK_MODE,
  API_BASE,
  PAYROLL_FUNCTION,
  FEE_NETWORK,
  ALEO_EXPLORER_URL,
  ALEO_ADDRESS_REGEX,
  DEFAULT_OVERAGE_CZK,
} from "@/lib/payroll-types";

// Extracted UI components
import PayrollConfirmDialog from "@/components/payroll/PayrollConfirmDialog";
import PayrollSummary from "@/components/payroll/PayrollSummary";
import EmployeeTable from "@/components/payroll/EmployeeTable";
import PayrollProgress from "@/components/payroll/PayrollProgress";
import PayrollHistory from "@/components/payroll/PayrollHistory";
import { styles, getBadgeStyle, CornerAccents } from "@/components/payroll/payroll-styles";

// Backend authentication helper
const getBackendToken = (): string | null => {
  try {
    const stored = sessionStorage.getItem("payroll_auth");
    if (stored) {
      const tokens = JSON.parse(stored);
      return tokens.accessToken;
    }
  } catch (e) {}
  return null;
};

function PayrollAppInner() {
  const wallet = useWallet();
  const publicKey = wallet?.publicKey?.toString() || "";
  const { toast } = useToast();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentRunStatus, setCurrentRunStatus] = useState<{ [key: string]: string }>({});
  const [viewState, setViewState] = useState<"payroll" | "history" | "preview">("payroll");
  const [logs, setLogs] = useState<string[]>([]);
  const [currentPayrollId, setCurrentPayrollId] = useState<string | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [lastPayrollRecord, setLastPayrollRecord] = useState<HistoryRecord | null>(null);
  
  // Wallet balance tracking (Aleo Credits only)
  const [walletRecords, setWalletRecords] = useState<WalletRecord[]>([]);
  const [totalBalance, setTotalBalance] = useState<number>(0);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [balanceStatus, setBalanceStatus] = useState("");
  
  // Track transaction IDs for explorer links
  const [transactionIds, setTransactionIds] = useState<{ [email: string]: string }>({});

  // Credit system state (USD credits for service fee)
  const [creditInfo, setCreditInfo] = useState<CreditInfo | null>(null);
  const [isLoadingCredits, setIsLoadingCredits] = useState(false);

  // Load credit balance from backend
  const loadCreditBalance = async () => {
    const token = getBackendToken();
    logger.log("loadCreditBalance - token:", token ? "exists" : "missing");
    if (!token) {
      logger.warn("No backend token found - user may need to log in again");
      return;
    }
    
    setIsLoadingCredits(true);
    try {
      const res = await fetch(`${API_BASE}/credits/balance`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      logger.log("Credit balance response status:", res.status);
      if (res.ok) {
        const data = await res.json();
        logger.log("Credit balance data:", data);
        setCreditInfo(data);
      } else {
        logger.error("Failed to fetch credits:", await res.text());
      }
    } catch (e) {
      logger.error("Failed to load credits:", e);
    }
    setIsLoadingCredits(false);
  };

  useEffect(() => {
    const saved = localStorage.getItem("payroll_history_zk_v2");
    if (saved) setHistory(JSON.parse(saved));
    // Load credit balance on mount
    loadCreditBalance();
  }, []);

  // Load wallet balance when wallet connects
  useEffect(() => {
    if (publicKey) {
      loadWalletBalance();
    } else {
      setWalletRecords([]);
      setTotalBalance(0);
    }
  }, [publicKey]);

  const loadWalletBalance = async (): Promise<WalletRecord[]> => {
    if (!publicKey) return [];
    setIsLoadingBalance(true);
    
    try {
      logger.log("=== Loading Wallet Balance ===");
      logger.log("Address:", publicKey);
      
      let privateBalance = 0;
      let publicBalance = 0;
      const allRecords: WalletRecord[] = [];

      // Detect adapter type
      const _adapter = wallet.wallet?.adapter as any;
      const isPuzzle = !!(
        _adapter?.isPuzzleAdapter === true ||
        _adapter?.name === "Puzzle Wallet" ||
        (typeof _adapter?.getPrivateRecords === 'function' && typeof _adapter?.transferPrivate === 'function')
      );
      const isShield = !!(_adapter?.isShieldAdapter === true || _adapter?.name === "Shield Wallet");
      logger.log("Wallet detection:", { isPuzzle, isShield, adapterName: _adapter?.name });

      // Helper to parse microcredits from various record formats
      const parseMicrocredits = (record: any): { microcredits: number; spent: boolean; plaintext: string } => {
        const realPlaintext = (typeof record.plaintext === 'string' && record.plaintext.length > 0) ? record.plaintext : null;
        if (typeof record.microcredits === 'number') return { microcredits: record.microcredits, spent: !!record.spent, plaintext: realPlaintext || JSON.stringify(record) };
        if (typeof record.microcredits === 'string') {
          const m = record.microcredits.match(/(\d+)/); if (m) return { microcredits: parseInt(m[1]), spent: !!record.spent, plaintext: realPlaintext || JSON.stringify(record) };
        }
        if (record.data?.microcredits) {
          const v = record.data.microcredits;
          if (typeof v === 'number') return { microcredits: v, spent: !!record.spent, plaintext: realPlaintext || JSON.stringify(record) };
          const m = String(v).match(/(\d+)/); if (m) return { microcredits: parseInt(m[1]), spent: !!record.spent, plaintext: realPlaintext || JSON.stringify(record) };
        }
        const pt = record.plaintext || record.data || record.record || JSON.stringify(record);
        const str = String(pt);
        for (const p of [/microcredits[:\s]+(\d+)u64/i, /microcredits[:\s]+"?(\d+)"?/i, /(\d{6,})u64/]) {
          const m = str.match(p); if (m) return { microcredits: parseInt(m[1]), spent: !!record.spent, plaintext: str };
        }
        return { microcredits: 0, spent: false, plaintext: str };
      };

      // ─── Strategy 1: Puzzle-native getPrivateRecords (richest data) ───
      if (isPuzzle && typeof _adapter?.getPrivateRecords === 'function') {
        setBalanceStatus("Checking wallet records...");
        logger.log("[Puzzle] Trying native getPrivateRecords...");
        try {
          const puzzleAdapter = _adapter as PuzzleWalletDemoxAdapter;
          const records = await puzzleAdapter.getPrivateRecords("credits.aleo", "Unspent");
          logger.log(`[Puzzle] Found ${records.length} unspent records`);
          for (const r of records) {
            const mc = typeof r.microcredits === 'number' ? r.microcredits : parseInt(String(r.microcredits).replace(/[^0-9]/g, ''), 10) || 0;
            if (mc > 0) {
              allRecords.push({ plaintext: r.plaintext || JSON.stringify(r), spent: false, microcredits: mc, ciphertext: r.ciphertext, rawRecord: r });
              privateBalance += mc;
            }
          }
        } catch (e) {
          logger.warn("[Puzzle] getPrivateRecords error (falling back to requestRecords):", e);
        }
      }

      // ─── Strategy 2: Puzzle-native getWalletBalance ───
      if (isPuzzle && typeof _adapter?.getWalletBalance === 'function' && privateBalance === 0) {
        setBalanceStatus("Querying wallet balance...");
        try {
          const balance = await (_adapter as PuzzleWalletDemoxAdapter).getWalletBalance();
          logger.log("[Puzzle] SDK balance:", balance);
          if (balance.private > 0) privateBalance = Math.round(balance.private * 1_000_000);
          if (balance.public > 0) publicBalance = Math.round(balance.public * 1_000_000);
        } catch (e) {
          logger.warn("[Puzzle] getWalletBalance error:", e);
        }
      }

      // ─── Strategy 3: Standard requestRecords (works for ALL wallets including Puzzle fallback) ───
      if (allRecords.length === 0 && wallet.requestRecords) {
        setBalanceStatus("Requesting credit records...");
        logger.log("Trying wallet.requestRecords('credits.aleo')...");
        try {
          const records = await wallet.requestRecords("credits.aleo");
          if (Array.isArray(records) && records.length > 0) {
            logger.log(`Found ${records.length} records via requestRecords`);
            // Log FULL first record for debugging
            logger.log("Record[0] keys:", Object.keys(records[0]));
            logger.log("Record[0] full:", JSON.stringify(records[0]).substring(0, 500));
            for (const r of records) {
              const parsed = parseMicrocredits(r);
              if (!parsed.spent && parsed.microcredits > 0) {
                allRecords.push({ plaintext: parsed.plaintext, spent: parsed.spent, microcredits: parsed.microcredits, ciphertext: r.ciphertext, rawRecord: r });
                privateBalance += parsed.microcredits;
              }
            }
          }
        } catch (e) {
          logger.warn("requestRecords failed:", e);
        }
      }

      // ─── Strategy 4: requestRecordPlaintexts (Leo Wallet fallback) ───
      if (allRecords.length === 0 && (wallet as any).requestRecordPlaintexts) {
        try {
          const records = await (wallet as any).requestRecordPlaintexts("credits.aleo");
          if (Array.isArray(records) && records.length > 0) {
            for (const r of records) {
              const parsed = parseMicrocredits(r);
              if (!parsed.spent && parsed.microcredits > 0) {
                allRecords.push({ plaintext: parsed.plaintext, spent: parsed.spent, microcredits: parsed.microcredits });
                privateBalance += parsed.microcredits;
              }
            }
          }
        } catch (e) {
          logger.warn("requestRecordPlaintexts failed:", e);
        }
      }
      
      logger.log("PRIVATE balance:", privateBalance, "microcredits =", privateBalance / 1_000_000, "ALEO");
      
      // ─── Strategy 5: PUBLIC balance from on-chain API (always try) ───
      if (publicBalance === 0) {
        setBalanceStatus("Querying on-chain public balance...");
        try {
          const url = `https://api.explorer.provable.com/v1/testnet/program/credits.aleo/mapping/account/${publicKey}`;
          const res = await fetch(url);
          if (res.ok) {
            const data = await res.text();
            const match = data.match(/(\d+)u64/);
            if (match) {
              publicBalance = parseInt(match[1]);
              logger.log("PUBLIC balance:", publicBalance / 1_000_000, "ALEO");
            }
          }
        } catch (e) {
          logger.warn("Public balance API failed:", e);
        }
      }
      
      // Use PRIVATE balance if available, otherwise fall back to public
      const totalBal = privateBalance > 0 ? privateBalance : publicBalance;
      logger.log("=== Final Balance ===");
      logger.log("Private:", privateBalance / 1_000_000, "ALEO");
      logger.log("Public:", publicBalance / 1_000_000, "ALEO");
      logger.log("Using:", totalBal / 1_000_000, "ALEO");
      logger.log("Records found:", allRecords.length);
      
      setTotalBalance(totalBal);
      if (allRecords.length > 0) {
        setWalletRecords(allRecords);
      }
      
      setIsLoadingBalance(false);
      setBalanceStatus("");
      // Return records directly so caller doesn't have to wait for state update
      return allRecords;
      
    } catch (err) {
      logger.error("Failed to load balance:", err);
      setIsLoadingBalance(false);
      setBalanceStatus("");
      return [];
    }
  };

  const addLog = (msg: string) => {
    logger.log(msg);
    setLogs(prev => [...prev, msg]);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.trim().split('\n');
      
      if (lines.length < 2) {
        toast({ title: "Neplatný CSV", description: "CSV musí obsahovat hlavičku + alespoň 1 řádek", variant: "destructive" });
        return;
      }
      
      // Parse header
      const header = lines[0].split(',').map(h => h.trim().toLowerCase());
      const nameIdx = header.findIndex(h => h === 'name');
      const emailIdx = header.findIndex(h => h === 'email');
      const salaryIdx = header.findIndex(h => h === 'salary');
      const addressIdx = header.findIndex(h => h.includes('address') || h.includes('aleo'));
      
      if (nameIdx === -1 || salaryIdx === -1 || addressIdx === -1) {
        toast({ title: "Neplatný formát CSV", description: "CSV musí obsahovat sloupce: Name, Salary, AleoAddress", variant: "destructive" });
        return;
      }
      
      // Parse rows
      const parsed: Employee[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.trim());
        if (cols.length < 3) continue;
        
        const name = cols[nameIdx];
        const email = emailIdx !== -1 ? cols[emailIdx] : `emp${i}@company.local`;
        // Smart salary parsing: detect if value is in ALEO or microcredits
        // Values < 10,000 are treated as whole ALEO and converted to microcredits
        // Values >= 10,000 are treated as microcredits directly
        const rawSalary = parseFloat(cols[salaryIdx]);
        const salary = rawSalary < 10_000 
          ? Math.floor(rawSalary * 1_000_000)  // Convert ALEO to microcredits
          : Math.floor(rawSalary);               // Already in microcredits
        const aleo_address = cols[addressIdx];
        
        // Validate Aleo address format: must be aleo1 followed by 58 lowercase alphanumeric chars
        if (!name || isNaN(salary) || !ALEO_ADDRESS_REGEX.test(aleo_address)) {
          logger.warn(`Skipping invalid row ${i}:`, cols);
          continue;
        }
        
        parsed.push({
          id: i,
          name,
          email,
          salary,
          aleo_address,
          selected: true
        });
      }
      
      if (parsed.length === 0) {
        toast({ title: "Žádní zaměstnanci", description: "V CSV nebyli nalezeni platní zaměstnanci. Zkontrolujte formát.", variant: "destructive" });
        return;
      }
      
      setEmployees(parsed);
      
      const initStatus: { [key: string]: string } = {};
      parsed.forEach(e => initStatus[e.email] = 'Ready');
      setCurrentRunStatus(initStatus);
      
      addLog(`✅ Loaded ${parsed.length} employees from CSV`);
    };
    
    reader.readAsText(file);
  };

  const resetUpload = () => {
    setEmployees([]);
    setCurrentRunStatus({});
    setTransactionIds({});
    setLogs([]);
  };

  // NEW: Toggle employee selection
  const toggleEmployeeSelection = (email: string) => {
    setEmployees(prev => prev.map(emp => 
      emp.email === email ? { ...emp, selected: !emp.selected } : emp
    ));
  };

  // NEW: Select/deselect all
  const toggleAllEmployees = (selected: boolean) => {
    setEmployees(prev => prev.map(emp => ({ ...emp, selected })));
  };

  // NEW: Retry failed payments
  const retryFailed = async () => {
    // First cancel the current payroll to get refund
    if (currentPayrollId) {
      await cancelPayroll(currentPayrollId);
    }
    // Select only failed employees for retry
    setEmployees(prev => prev.map(emp => ({
      ...emp,
      selected: currentRunStatus[emp.email] === 'Failed'
    })));
    setCurrentRunStatus({});
    setLogs([]);
    setViewState('payroll');
  };

  // Cancel payroll and get refund
  const cancelPayroll = async (payrollId: string) => {
    const token = getBackendToken();
    if (!token) return;
    
    try {
      addLog(`🔄 Cancelling payroll and refunding credits...`);
      const res = await fetch(`${API_BASE}/payroll/cancel`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ payroll_id: payrollId })
      });
      
      if (res.ok) {
        addLog(`✅ Payroll cancelled - credits refunded`);
        setCurrentPayrollId(null);
        await loadCreditBalance();
      } else {
        const data = await res.json();
        logger.error("Cancel failed:", data);
      }
    } catch (e) {
      logger.error("Cancel payroll error:", e);
    }
  };

  // Clear failed state and reset
  const clearPayrollState = async () => {
    if (currentPayrollId) {
      await cancelPayroll(currentPayrollId);
    }
    setCurrentRunStatus({});
    setLogs([]);
    setCurrentPayrollId(null);
    setEmployees(prev => prev.map(emp => ({ ...emp, selected: false })));
  };

  // Calculate selected employees and totals
  const selectedEmployees = employees.filter(e => e.selected);
  const totalSalaries = selectedEmployees.reduce((sum, e) => sum + e.salary, 0);
  const totalGas = selectedEmployees.length * FEE_NETWORK;
  const grandTotal = totalSalaries + totalGas;
  
  // Check balance (only Aleo Credits now)
  const hasEnoughBalance = totalBalance >= grandTotal;
  const failedCount = Object.values(currentRunStatus).filter(s => s === 'Failed').length;

  // Credit system calculations — CZK included/overage model
  const includedEmployees = creditInfo?.tier?.included_employees ?? 10;
  const overageRate = creditInfo?.tier?.overage_per_employee_czk ?? DEFAULT_OVERAGE_CZK;
  const overageCount = Math.max(0, selectedEmployees.length - includedEmployees);
  const creditCost = overageCount * overageRate;
  const currentCreditBalance = creditInfo?.balance_czk ?? creditInfo?.balance_usd ?? 0;
  const hasEnoughCredits = currentCreditBalance >= creditCost;

  // Prepare payroll with backend (reserves credits)
  const preparePayrollWithBackend = async (): Promise<string | null> => {
    const token = getBackendToken();
    if (!token) {
      toast({ title: "Vyžadováno přihlášení", description: "Pro použití kreditového systému se nejprve přihlaste", variant: "destructive" });
      return null;
    }
    
    try {
      const res = await fetch(`${API_BASE}/payroll/prepare`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({
          employee_count: selectedEmployees.length,
          employees: selectedEmployees.map(e => ({
            name: e.name, 
            email: e.email, 
            salary: e.salary, 
            aleo_address: e.aleo_address
          }))
        })
      });
      
      const data = await res.json();
      
      if (!data.success) {
        if (data.error?.includes("Insufficient")) {
          toast({ title: "Nedostatek kreditů", description: `Potřeba ${creditCost} Kč, máte ${currentCreditBalance} Kč. Dobijte si kredity.`, variant: "destructive" });
        } else {
          toast({ title: "Příprava payrollu selhala", description: data.error || "Nepodařilo se připravit payroll", variant: "destructive" });
        }
        return null;
      }
      
      return data.payroll_id;
    } catch (e: any) {
      logger.error("Prepare payroll error:", e);
      toast({ title: "Chyba payrollu", description: "Selhala příprava: " + e.message, variant: "destructive" });
      return null;
    }
  };

  // Confirm payroll completion with backend
  const confirmPayrollWithBackend = async (payrollId: string, employeeResults: any[]) => {
    const token = getBackendToken();
    if (!token) return;
    
    // Get the first successful transaction ID for the payroll confirmation
    const successfulTx = employeeResults.find(e => e.status === 'Success' && e.txId);
    if (!successfulTx) {
      logger.log('No successful transactions to confirm');
      return;
    }
    
    try {
      const res = await fetch(`${API_BASE}/payroll/confirm`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({
          payroll_id: payrollId,
          tx_id: successfulTx.txId  // Backend expects tx_id not employees array
        })
      });
      
      const data = await res.json();
      logger.log('Payroll confirm response:', data);
      
      // Refresh credit balance after successful payroll
      await loadCreditBalance();
    } catch (e) {
      logger.error("Confirm payroll error:", e);
    }
  };

  const executePayroll = async () => {
    if (!publicKey) {
      toast({ title: "Peněženka vyžadována", description: "Nejprve připojte svou peněženku", variant: "destructive" });
      return;
    }
    if (selectedEmployees.length === 0) {
      toast({ title: "Nikdo nevybrán", description: "Vyberte alespoň jednoho zaměstnance k vyplacení", variant: "destructive" });
      return;
    }
    if (!hasEnoughBalance) {
      toast({ title: "Nedostatečný zůstatek", description: `Potřeba ${(grandTotal / TOKEN_CONFIG.decimals).toFixed(2)} ALEO, máte ${(totalBalance / TOKEN_CONFIG.decimals).toFixed(2)} ALEO`, variant: "destructive" });
      return;
    }
    
    // Step 1: Enforce platform credit system
    const hasBackendAuth = !!getBackendToken();
    let payrollId: string | null = null;
    
    if (!hasBackendAuth) {
      toast({ title: "Vyžadováno přihlášení", description: "Pro zpracování payrollu se přihlaste.", variant: "destructive" });
      return;
    }
    
    if (!hasEnoughCredits) {
      toast({ title: "Nedostatek kreditů", description: `Potřeba ${creditCost} Kč, máte ${currentCreditBalance} Kč. Dobijte si kredity.`, variant: "destructive" });
      addLog(`❌ Platba zablokována — nedostatek kreditů (${currentCreditBalance} Kč < ${creditCost} Kč)`);
      return;
    }
    
    addLog(`💳 Rezervace kreditů (${creditCost} Kč za ${selectedEmployees.length} zaměstnanců, ${includedEmployees} v ceně)...`);
    payrollId = await preparePayrollWithBackend();
    if (payrollId) {
      addLog(`✅ Payroll prepared (ID: ${payrollId.slice(0, 8)}...)`);
    } else {
      toast({ title: "Příprava payrollu selhala", description: "Nepodařilo se rezervovat kredity. Zkuste to znovu.", variant: "destructive" });
      addLog(`❌ Backend preparation failed — payment blocked`);
      return;
    }
    if (payrollId) setCurrentPayrollId(payrollId);
    
    setIsProcessing(true);
    setViewState('payroll');
    addLog(`🚀 Starting ALEO Payroll Process...`);
    addLog(`⚠️ IMPORTANT: Keep this tab OPEN and FOCUSED. Switching tabs will PAUSE the ZK proof generation.`);
    addLog(`⚠️ Note: Each transaction takes 2-5 minutes for ZK proof generation`);

    // Refresh records before starting
    await loadWalletBalance();
    
    addLog(`💰 Available ALEO: ${(totalBalance / TOKEN_CONFIG.decimals).toFixed(2)}`);
    addLog(`📋 Processing ${selectedEmployees.length} employees sequentially...`);

    let successCount = 0;
    const txIds: string[] = [];
    const employeeResults: { name: string; amount: number; txId: string; status: string }[] = [];

    // Track locally-spent record IDs/plaintexts to prevent double-use.
    // Wallet extensions may not immediately update their record state after a
    // pending transaction, so we exclude recently-used records ourselves.
    const locallySpentRecords = new Set<string>();

    // Helper function to wait for transaction confirmation
    const waitForTransaction = async (txId: string, maxWaitMs: number = 300000): Promise<boolean> => {
      const startTime = Date.now();

      // Check whether the wallet actually supports status polling
      const hasStatusSupport = typeof wallet.transactionStatus === 'function';

      if (!hasStatusSupport) {
        // No status API → wait a reasonable fixed period then optimistically proceed.
        // The wallet already returned a txId which means the ZK proof was generated
        // and submitted to the network.
        addLog(`⏳ Wallet does not support status polling — waiting 30s before proceeding...`);
        await new Promise(r => setTimeout(r, 30000));
        addLog(`✅ Proceeding (tx submitted, confirmation will happen on-chain)`);
        return true;
      }

      addLog(`⏳ Waiting for transaction confirmation (may take 2-5 min for ZK proof)...`);

      let consecutiveErrors = 0;
      
      while (Date.now() - startTime < maxWaitMs) {
        try {
          const status = await wallet.transactionStatus!(txId);
          logger.log(`TX ${txId.slice(0, 10)} status:`, status);
          consecutiveErrors = 0; // reset on success

          // Handle various status formats from different wallet versions
          const statusStr = typeof status === 'string' ? status.toLowerCase() : (status as any)?.status?.toLowerCase?.() || '';
          
          // Success states
          if (['completed', 'finalized', 'confirmed', 'accepted'].includes(statusStr)) {
            addLog(`✅ Transaction confirmed on-chain!`);
            return true;
          }
          
          // Failure states
          if (['failed', 'rejected', 'error'].includes(statusStr)) {
            addLog(`❌ Transaction failed on-chain: ${statusStr}`);
            return false;
          }
          
          // Processing/pending/creating states — keep waiting
        } catch (e: any) {
          consecutiveErrors++;
          logger.log('Status check error:', e?.message || e);
          // If we get many consecutive errors the wallet may have lost connection → bail
          if (consecutiveErrors >= 5) {
            addLog(`⚠️ Lost connection to wallet extension during status polling`);
            break;
          }
        }
        
        // Wait 10 seconds before checking again
        await new Promise(r => setTimeout(r, 10000));
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        if (elapsed % 30 < 11) { // Log roughly every 30s, not every tick
          addLog(`⏳ Still processing... (${elapsed}s elapsed, ZK proof generation in progress)`);
        }
      }
      
      // Timeout or lost connection — verify via balance change
      addLog(`⚠️ Status polling ended — verifying via balance change...`);
      try {
        const balanceBefore = walletRecords.reduce((sum, r) => sum + r.microcredits, 0);
        await new Promise(r => setTimeout(r, 5000)); // small settle delay
        const freshRecords = await loadWalletBalance();
        const balanceAfter = freshRecords.reduce((sum, r) => sum + r.microcredits, 0);
        
        if (balanceAfter < balanceBefore) {
          addLog(`✅ Balance changed — transaction likely succeeded`);
          return true;
        } else {
          // Don't assume failure — the tx might still be pending on-chain.
          // Return true with a warning so the flow continues.
          addLog(`⚠️ Balance unchanged — tx may still be pending. Proceeding optimistically.`);
          return true;
        }
      } catch (e) {
        logger.log('Balance verification error:', e);
        // Optimistically proceed — the tx was submitted
        addLog(`⚠️ Could not verify balance — proceeding optimistically`);
        return true;
      }
    };

    for (const emp of selectedEmployees) {
      if (currentRunStatus[emp.email] === 'Paid') continue;

      setCurrentRunStatus(prev => ({ ...prev, [emp.email]: 'Processing...' }));

      // Declare variables at loop scope so catch block can access them
      let salaryAmount = 0;
      let record: WalletRecord | null = null;

      try {
        // IMPORTANT: Refresh wallet records before EACH transaction to get latest UTXOs
        addLog(`🔄 Fetching latest wallet records...`);
        const freshRecords = await loadWalletBalance();
        logger.log("Fresh records from wallet:", freshRecords.length, freshRecords);
        
        if (!freshRecords || freshRecords.length === 0) {
          throw new Error("No records found in wallet. Please check your balance.");
        }
        
        salaryAmount = Math.floor(emp.salary);
        const totalNeeded = salaryAmount + FEE_NETWORK;
        
        // Validate employee address format (must be valid Aleo address)
        if (!emp.aleo_address || !emp.aleo_address.startsWith('aleo1') || emp.aleo_address.length !== 63) {
          throw new Error(`Invalid Aleo address for ${emp.name}: ${emp.aleo_address}. Address must start with 'aleo1' and be 63 characters.`);
        }
        
        // Validate salary amount is positive
        if (salaryAmount <= 0) {
          throw new Error(`Invalid salary amount for ${emp.name}: ${salaryAmount}`);
        }
        
        // Derive a stable identifier for each record to track local spending.
        // Prefer the record id, then ciphertext, then plaintext as fallback.
        const recordKey = (r: WalletRecord): string => {
          const raw = r.rawRecord;
          if (raw?.id) return raw.id;
          if (r.ciphertext) return r.ciphertext;
          return r.plaintext;
        };
        
        // Find suitable record from fresh records, excluding locally-spent ones
        const availableRecords = freshRecords.filter(r => !r.spent && r.microcredits > 0 && !locallySpentRecords.has(recordKey(r)));
        const recordIndex = availableRecords.findIndex(r => r.microcredits >= totalNeeded);

        if (recordIndex === -1) {
          const availableBalance = availableRecords.reduce((sum, r) => sum + r.microcredits, 0);
          const largest = availableRecords.length > 0 ? Math.max(...availableRecords.map(r => r.microcredits)) : 0;
          throw new Error(`No single record with sufficient balance. Need ${(totalNeeded / TOKEN_CONFIG.decimals).toFixed(2)} ALEO in one record, largest available: ${(largest / TOKEN_CONFIG.decimals).toFixed(2)} ALEO. Total across ${availableRecords.length} records: ${(availableBalance / TOKEN_CONFIG.decimals).toFixed(2)} ALEO (${locallySpentRecords.size} records pending from earlier payments)`);
        }

        record = availableRecords[recordIndex];
        
        // Mark this record as locally spent BEFORE submitting the tx
        locallySpentRecords.add(recordKey(record));

        // Detect wallet type for transfer method
        const _txAdapter = wallet.wallet?.adapter as any;
        const usingPuzzle = !!(
          _txAdapter?.isPuzzleAdapter === true ||
          _txAdapter?.name === "Puzzle Wallet" ||
          (typeof _txAdapter?.getPrivateRecords === 'function' && typeof _txAdapter?.transferPrivate === 'function')
        );
        
        addLog(`🔍 Wallet: ${usingPuzzle ? 'Puzzle (native ZKP)' : 'Standard (Leo/other)'}`);
        
        let txId: string | undefined;

        // ─── Attempt 1: Puzzle-native transferPrivate ───
        if (usingPuzzle && _txAdapter && record.rawRecord) {
          const puzzleAdapter = _txAdapter as PuzzleWalletDemoxAdapter;
          const rawRec = record.rawRecord as RecordWithPlaintext;
          
          addLog(`🔐 [Puzzle] Private ZK transfer for ${emp.name}...`);
          addLog(`   📦 Record: ${record.microcredits / TOKEN_CONFIG.decimals} ALEO → sending ${salaryAmount / TOKEN_CONFIG.decimals} ALEO + ${FEE_NETWORK / TOKEN_CONFIG.decimals} fee`);
          addLog(`   🎯 To: ${emp.aleo_address.slice(0, 12)}...${emp.aleo_address.slice(-6)}`);
          
          logger.log("=== PUZZLE TRANSFER_PRIVATE ===");
          logger.log("rawRecord type:", typeof rawRec);
          logger.log("rawRecord keys:", rawRec ? Object.keys(rawRec) : 'null');
          logger.log("rawRecord.plaintext:", rawRec?.plaintext?.substring(0, 80));
          logger.log("rawRecord.microcredits:", rawRec?.microcredits);
          logger.log("to:", emp.aleo_address);
          logger.log("amount:", salaryAmount, "microcredits =", salaryAmount / 1_000_000, "ALEO");
          logger.log("fee:", FEE_NETWORK, "microcredits =", FEE_NETWORK / 1_000_000, "ALEO");
          
          // The Puzzle SDK's requestCreateEvent extracts .plaintext from record objects.
          // We need the record to have a non-empty plaintext string.
          const hasPlaintext = typeof rawRec?.plaintext === 'string' && rawRec.plaintext.length > 10;
          
          if (hasPlaintext) {
            try {
              txId = await puzzleAdapter.transferPrivate(rawRec, emp.aleo_address, salaryAmount, FEE_NETWORK);
            } catch (puzzleErr: any) {
              addLog(`⚠️ Puzzle native transfer failed: ${puzzleErr?.message?.substring(0, 80) || puzzleErr}`);
              logger.error("Puzzle transferPrivate error:", puzzleErr);
              // Will fall through to standard path below
            }
          } else {
            addLog(`⚠️ Record missing/invalid plaintext (got: ${typeof rawRec?.plaintext}) — falling back to standard path`);
            logger.warn("Record plaintext issue:", { type: typeof rawRec?.plaintext, len: rawRec?.plaintext?.length, preview: String(rawRec?.plaintext).substring(0, 40) });
          }
        }

        // ─── Attempt 2: Standard Transaction.createTransaction (Leo/Puzzle fallback) ───
        if (!txId) {
          // Per the official @demox-labs/aleo-wallet-adapter example:
          //   const inputs = [recordObject, "aleo1...", `${amount}u64`];
          //   Transaction.createTransaction(publicKey, network, program, function, inputs, fee, feePrivate)
          //
          // CRITICAL: feePrivate must be FALSE to pay fees from public balance.
          // When feePrivate=true, the wallet needs a SEPARATE record for the fee.
          // If user has only 1 record, this fails with INVALID_PARAMS.
          // Using public fees (feePrivate=false) avoids this entirely.

          // Determine the record input — try multiple formats
          let inputRecord: any;
          if (record.rawRecord && typeof record.rawRecord === 'object') {
            inputRecord = record.rawRecord;
          } else if (record.plaintext && typeof record.plaintext === 'string' && record.plaintext.length > 10) {
            inputRecord = record.plaintext.trim();
          } else {
            throw new Error("Invalid record format: no record data available for transaction");
          }

          addLog(`🔐 [Standard] Requesting wallet signature for ${emp.name}...`);
          addLog(`   📦 Amount: ${salaryAmount / TOKEN_CONFIG.decimals} ALEO → ${emp.aleo_address.slice(0, 12)}...`);
          addLog(`   💰 Fee: ${FEE_NETWORK / TOKEN_CONFIG.decimals} ALEO (from public balance)`);

          // Detailed debug logging
          logger.log("=== STANDARD TRANSFER_PRIVATE ===");
          logger.log("from:", publicKey);
          logger.log("to:", emp.aleo_address);
          logger.log("amount:", salaryAmount, "u64");
          logger.log("fee:", FEE_NETWORK, "feePrivate: false (public fee)");
          logger.log("record type:", typeof inputRecord);
          if (typeof inputRecord === 'object') {
            logger.log("record keys:", Object.keys(inputRecord));
            logger.log("record.id:", inputRecord?.id?.substring?.(0, 20));
            logger.log("record.program_id:", inputRecord?.program_id);
            logger.log("record.microcredits:", inputRecord?.microcredits ?? inputRecord?.data?.microcredits);
            logger.log("record.spent:", inputRecord?.spent);
            logger.log("record.plaintext:", typeof inputRecord?.plaintext === 'string' ? inputRecord.plaintext.substring(0, 100) : typeof inputRecord?.plaintext);
            logger.log("record (full, first 300 chars):", JSON.stringify(inputRecord).substring(0, 300));
          } else {
            logger.log("record (string, first 120 chars):", String(inputRecord).substring(0, 120));
          }

          if (!wallet.requestTransaction) {
            throw new Error("Wallet does not support requestTransaction. Please use Puzzle or Leo Wallet.");
          }

          // Build candidate record inputs — we'll try each until one works.
          // Different Leo Wallet versions expect different formats:
          //   1. The raw record object from requestRecords (current Leo Wallet)
          //   2. The Aleo plaintext string with visibility modifiers + nonce (older versions)
          //   3. The JSON-serialized record object (some intermediate versions)
          const candidateInputs: { label: string; value: any }[] = [];

          // Candidate 1: Raw record object (what the official example shows)
          if (record.rawRecord && typeof record.rawRecord === 'object') {
            candidateInputs.push({ label: "raw object", value: record.rawRecord });
          }

          // Candidate 2: Record plaintext string (Aleo format with visibility modifiers)
          if (record.rawRecord?.plaintext && typeof record.rawRecord.plaintext === 'string') {
            candidateInputs.push({ label: "record.plaintext", value: record.rawRecord.plaintext });
          } else if (record.plaintext && typeof record.plaintext === 'string' && record.plaintext.includes('microcredits')) {
            candidateInputs.push({ label: "stored plaintext", value: record.plaintext.trim() });
          }

          // Candidate 3: JSON string of the record object
          if (record.rawRecord && typeof record.rawRecord === 'object') {
            candidateInputs.push({ label: "JSON.stringify", value: JSON.stringify(record.rawRecord) });
          }

          if (candidateInputs.length === 0) {
            throw new Error("No valid record representation available for transaction");
          }

          // Try each candidate with both feePrivate=false (public fee) and feePrivate=true
          // Primary: feePrivate=false (uses public balance for fee — no second record needed)
          // Fallback: feePrivate=true (uses private record for fee — needs 2 records)
          const feeStrategies = [
            { feePrivate: false, label: "public fee" },
            { feePrivate: true, label: "private fee" },
          ];

          let lastError: any = null;

          for (const feeSt of feeStrategies) {
            for (const candidate of candidateInputs) {
              if (txId) break;
              try {
                addLog(`   🔄 Trying ${candidate.label} + ${feeSt.label}...`);
                logger.log(`Attempt: ${candidate.label} + ${feeSt.label}, input type:`, typeof candidate.value);

                const tx = Transaction.createTransaction(
                  publicKey,
                  NETWORK_MODE,
                  TOKEN_CONFIG.programId,
                  PAYROLL_FUNCTION,
                  [candidate.value, emp.aleo_address, `${salaryAmount}u64`],
                  FEE_NETWORK,
                  feeSt.feePrivate
                );

                // Use requestTransaction (the standard path that works with Leo Wallet)
                txId = await wallet.requestTransaction(tx);
                if (txId) {
                  addLog(`   ✅ Success with ${candidate.label} + ${feeSt.label}`);
                  logger.log(`SUCCESS: ${candidate.label} + ${feeSt.label} → txId:`, txId);
                  break;
                }
              } catch (err: any) {
                lastError = err;
                const msg = err?.message?.substring(0, 80) || String(err).substring(0, 80);
                logger.warn(`Failed (${candidate.label} + ${feeSt.label}):`, msg);
                addLog(`   ⚠️ ${candidate.label} + ${feeSt.label}: ${msg}`);
              }
            }
            if (txId) break;
          }

          if (!txId && lastError) {
            throw lastError;
          }
        }

        if (!txId) {
          throw new Error("No transaction ID returned from wallet — transfer may have been cancelled");
        }

        addLog(`📤 TX Submitted: ${txId.slice(0, 20)}...`);
        txIds.push(txId);
        
        // Store transaction ID for this employee
        setTransactionIds(prev => ({ ...prev, [emp.email]: txId! }));
        
        // Wait for transaction to be confirmed before proceeding to next employee
        const confirmed = await waitForTransaction(txId);
        
        if (confirmed) {
          addLog(`✅ TX Confirmed for ${emp.name}!`);
          setCurrentRunStatus(prev => ({ ...prev, [emp.email]: 'Paid' }));
          employeeResults.push({ name: emp.name, amount: salaryAmount, txId, status: 'Success' });
          successCount++;
        } else {
          addLog(`❌ TX Failed for ${emp.name}`);
          setCurrentRunStatus(prev => ({ ...prev, [emp.email]: 'Failed' }));
          employeeResults.push({ name: emp.name, amount: salaryAmount, txId, status: 'Failed' });
        }

        logger.log(`Transaction ${txId} recorded for ${emp.email}`);
        
        // Small delay before next employee
        await new Promise(r => setTimeout(r, 1000));

      } catch (err: any) {
        logger.error("❌ Payment failed for", emp.email, err);
        
        // Show the FULL error in logs so user can report it
        const errorMsg = err?.message || String(err);
        addLog(`❌ ERROR: ${errorMsg}`);
        
        // Also show user-friendly version
        let userFriendlyError = errorMsg;
        
        if (errorMsg.includes('insufficient') || errorMsg.includes('balance')) {
          userFriendlyError = 'Insufficient balance in record';
        } else if (errorMsg.includes('rejected') || errorMsg.includes('denied')) {
          userFriendlyError = 'Transaction rejected by wallet';
        } else if (errorMsg.includes('record') && errorMsg.includes('spent')) {
          userFriendlyError = 'Record already spent - please refresh and retry';
        } else if (errorMsg.includes('address') || errorMsg.includes('invalid')) {
          userFriendlyError = 'Invalid recipient address';
        } else if (errorMsg.includes('timeout') || errorMsg.includes('network')) {
          userFriendlyError = 'Network timeout - please retry';
        } else if (errorMsg.includes('proof')) {
          userFriendlyError = 'ZK proof generation failed - please retry';
        }
        
        addLog(`❌ Failed: ${emp.name} - ${userFriendlyError}`);
        setCurrentRunStatus(prev => ({ ...prev, [emp.email]: 'Failed' }));
        employeeResults.push({ name: emp.name, amount: emp.salary, txId: '', status: 'Failed' });
      }
    }

    // Save to history with token info
    if (employeeResults.length > 0) {
      const newRecord: HistoryRecord = {
        id: Date.now(),
        date: new Date().toISOString(),
        count: successCount,
        total: employeeResults.filter(e => e.status === 'Success').reduce((a, b) => a + b.amount, 0),
        txs: txIds,
        employees: employeeResults
      };
      const newHistory = [newRecord, ...history];
      setHistory(newHistory);
      localStorage.setItem("payroll_history_zk_v2", JSON.stringify(newHistory));

      // Show completion summary modal
      setLastPayrollRecord(newRecord);
      setShowSummary(true);
    }

    // Handle completion based on success/failure
    if (successCount > 0) {
      // Confirm with backend and charge credits for successful payments
      await confirmPayrollWithBackend(payrollId, employeeResults.filter(e => e.status === 'Success'));
      const chargedCredits = Math.max(0, successCount - includedEmployees) * overageRate;
      addLog(`💳 Účtováno: ${chargedCredits} Kč (${successCount} zaměstnanců, ${includedEmployees} v ceně)`);
      
      if (successCount === selectedEmployees.length) {
        // All succeeded - clear payroll tracking
        setCurrentPayrollId(null);
      }
    }
    
    if (successCount === 0) {
      // All failed - cancel payroll to refund credits
      addLog(`❌ All payments failed - cancelling payroll for credit refund...`);
      await cancelPayroll(payrollId);
    } else if (successCount < selectedEmployees.length) {
      // Partial success - keep payroll ID for retry
      addLog(`⚠️ ${selectedEmployees.length - successCount} payments failed. Click RETRY FAILED to retry.`);
    }

    // Refresh balances
    await loadWalletBalance();
    await loadCreditBalance();
    
    setIsProcessing(false);
    addLog(`\n✨ ALEO Payroll Complete: ${successCount}/${selectedEmployees.length} successful`);
  };

  // Calculate credit info values
  const creditBalance = creditInfo?.balance_czk ?? creditInfo?.balance_usd ?? 0;
  const creditTier = creditInfo?.tier?.display_name || 'Start';
  const activeEmployees = creditInfo?.estimates?.active_employees || employees.length;
  const payrollsRemaining = creditInfo?.estimates?.payrolls_remaining || 0;

  return (
    <div style={styles.container}>
      {/* Corner decorations */}
      <div style={{ position: 'fixed', top: 20, left: 20, width: 60, height: 60, borderLeft: '1px solid hsl(350, 65%, 45%, 0.2)', borderTop: '1px solid hsl(350, 65%, 45%, 0.2)' }} />
      <div style={{ position: 'fixed', top: 20, right: 20, width: 60, height: 60, borderRight: '1px solid hsl(350, 65%, 45%, 0.2)', borderTop: '1px solid hsl(350, 65%, 45%, 0.2)' }} />
      <div style={{ position: 'fixed', bottom: 20, left: 20, width: 60, height: 60, borderLeft: '1px solid hsl(350, 65%, 45%, 0.2)', borderBottom: '1px solid hsl(350, 65%, 45%, 0.2)' }} />
      <div style={{ position: 'fixed', bottom: 20, right: 20, width: 60, height: 60, borderRight: '1px solid hsl(350, 65%, 45%, 0.2)', borderBottom: '1px solid hsl(350, 65%, 45%, 0.2)' }} />
      
      <header style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <Link to="/dashboard" style={styles.backBtn}>← ZPĚT NA PŘEHLED</Link>
          <div style={styles.logo}>CZKP PAYROLL</div>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button 
            style={viewState === 'payroll' ? { ...styles.secondaryBtn, background: 'linear-gradient(135deg, hsl(350, 65%, 50%), hsl(350, 70%, 38%))', color: 'hsl(220, 20%, 95%)', borderColor: 'transparent' } : styles.secondaryBtn}
            onClick={() => setViewState('payroll')}
          >
            Payroll
          </button>
          <button 
            style={viewState === 'history' ? { ...styles.secondaryBtn, background: 'linear-gradient(135deg, hsl(350, 65%, 50%), hsl(350, 70%, 38%))', color: 'hsl(220, 20%, 95%)', borderColor: 'transparent' } : styles.secondaryBtn}
            onClick={() => setViewState('history')}
          >
            History
          </button>
          
          {/* Platform Credits Info Panel */}
          <div style={{ 
            display: 'flex', 
            gap: '16px',
            alignItems: 'center',
            padding: '8px 16px',
            background: 'hsl(0, 0%, 5%)',
            border: '1px solid hsl(350, 65%, 45%, 0.3)',
          }}>
            <Link to="/subscription" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textDecoration: 'none', cursor: 'pointer' }} title="Change subscription">
              <span style={{ fontSize: 9, color: 'hsl(220, 10%, 50%)', letterSpacing: '0.1em' }}>TIER</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'hsl(350, 65%, 55%)' }}>
                {isLoadingCredits ? '...' : creditTier}
              </span>
            </Link>
            <div style={{ width: 1, height: 24, background: 'hsl(220, 10%, 18%)' }} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ fontSize: 9, color: 'hsl(220, 10%, 50%)', letterSpacing: '0.1em' }}>KREDIT</span>
              <span style={{ 
                fontSize: 14, 
                fontWeight: 600, 
                color: creditBalance > 0 ? 'hsl(140, 60%, 50%)' : 'hsl(0, 60%, 50%)' 
              }}>
                {isLoadingCredits ? '...' : `${creditBalance.toFixed(0)} Kč`}
              </span>
            </div>
            <div style={{ width: 1, height: 24, background: 'hsl(220, 10%, 18%)' }} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ fontSize: 9, color: 'hsl(220, 10%, 50%)', letterSpacing: '0.1em' }}>VÝPLATY</span>
              <span style={{ 
                fontSize: 14, 
                fontWeight: 600, 
                color: payrollsRemaining > 0 ? 'hsl(220, 20%, 90%)' : 'hsl(0, 60%, 50%)' 
              }}>
                {isLoadingCredits ? '...' : `${payrollsRemaining}`}
              </span>
            </div>
          </div>
          
          {/* Wallet Balance Widget - Enhanced with record count */}
          <div style={styles.walletWidget}>
            <div style={styles.balanceIndicator}>
              <span style={{ fontSize: 10, color: 'hsl(220, 10%, 50%)', letterSpacing: '0.1em' }}>ALEO</span>
              <span style={{ fontSize: 16, fontWeight: 600, color: totalBalance > 0 ? 'hsl(140, 60%, 50%)' : 'hsl(220, 10%, 50%)' }}>
                {isLoadingBalance ? '...' : `${(totalBalance / TOKEN_CONFIG.decimals).toFixed(2)}`}
              </span>
              {isLoadingBalance && balanceStatus && (
                <span style={{ fontSize: 8, color: 'hsl(350, 65%, 55%)', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
                  {balanceStatus}
                </span>
              )}
            </div>
            {walletRecords.length > 0 && (
              <div title={`${walletRecords.length} privátních záznamů (UTXO) ve vaší peněžence. Každá platba spotřebuje jeden záznam.`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 8px', borderLeft: '1px solid hsl(220, 10%, 18%)', cursor: 'help' }}>
                <span style={{ fontSize: 9, color: 'hsl(220, 10%, 50%)', letterSpacing: '0.1em' }}>ZÁZNAMY</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'hsl(350, 65%, 55%)' }}>{walletRecords.length}</span>
              </div>
            )}
            <WalletMultiButton style={{ backgroundColor: 'hsl(0, 0%, 7%)', border: '1px solid hsl(350, 65%, 45%, 0.5)', borderRadius: 0 }} />
          </div>
        </div>
      </header>

      <main style={styles.main}>
        {/* Stats Overview */}
        {employees.length > 0 && viewState !== 'history' && (
          <div style={styles.statsGrid}>
            <div style={styles.statCard}>
              <CornerAccents />
              <span style={{ fontSize: 10, color: 'hsl(220, 10%, 50%)', letterSpacing: '0.15em' }}>VYBRÁNO</span>
              <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "'Cinzel', serif", color: 'hsl(350, 65%, 55%)', marginTop: 4 }}>
                {selectedEmployees.length}<span style={{ fontSize: 14, color: 'hsl(220, 10%, 50%)' }}>/{employees.length}</span>
              </div>
            </div>
            <div style={styles.statCard}>
              <CornerAccents />
              <span style={{ fontSize: 10, color: 'hsl(220, 10%, 50%)', letterSpacing: '0.15em' }}>MZDY CELKEM</span>
              <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "'Cinzel', serif", color: 'hsl(220, 20%, 90%)', marginTop: 4 }}>
                {(totalSalaries / TOKEN_CONFIG.decimals).toFixed(2)}
                <span style={{ fontSize: 12, marginLeft: 4, color: 'hsl(220, 10%, 50%)' }}>ALEO</span>
              </div>
            </div>
            <div style={styles.statCard}>
              <CornerAccents />
              <span style={{ fontSize: 10, color: 'hsl(220, 10%, 50%)', letterSpacing: '0.15em' }}>POPLATEK</span>
              <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "'Cinzel', serif", color: hasEnoughCredits ? 'hsl(350, 65%, 55%)' : 'hsl(0, 60%, 50%)', marginTop: 4 }}>
                {creditCost}
                <span style={{ fontSize: 10, marginLeft: 4, color: 'hsl(220, 10%, 50%)' }}>Kč</span>
              </div>
              {overageCount > 0 && (
                <span style={{ fontSize: 9, color: 'hsl(220, 10%, 42%)' }}>{overageCount} nad rámec</span>
              )}
            </div>
            <div style={styles.statCard}>
              <CornerAccents />
              <span style={{ fontSize: 10, color: 'hsl(220, 10%, 50%)', letterSpacing: '0.15em' }}>CELKEM K ÚHRADĚ</span>
              <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "'Cinzel', serif", color: hasEnoughBalance ? 'hsl(140, 60%, 50%)' : 'hsl(0, 60%, 50%)', marginTop: 4 }}>
                {(grandTotal / TOKEN_CONFIG.decimals).toFixed(2)}
                <span style={{ fontSize: 12, marginLeft: 4, color: 'hsl(220, 10%, 50%)' }}>ALEO</span>
              </div>
            </div>
          </div>
        )}

        {viewState === 'payroll' && (
          <>
            {employees.length === 0 ? (
              <div style={styles.card}>
                <CornerAccents />
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                  <span style={{ fontSize: 10, color: 'hsl(350, 65%, 55%)', letterSpacing: '0.2em', border: '1px solid hsl(350, 65%, 45%, 0.3)', padding: '4px 8px' }}>NAHRÁT</span>
                </div>
                <h3 style={{ fontFamily: "'Cinzel', serif", letterSpacing: '0.05em', marginBottom: 12 }}>CSV zaměstnanců</h3>
                <p style={{ color: 'hsl(220, 10%, 50%)', fontSize: '12px', marginBottom: '20px', letterSpacing: '0.05em' }}>
                  Formát: <code style={{ color: 'hsl(350, 65%, 55%)' }}>Name, Email, Salary, AleoAddress</code>
                </p>
                <div style={styles.uploadZone}>
                  <input type="file" accept=".csv" onChange={handleFileUpload} style={{ display: 'none' }} id="csv-upload" />
                  <label htmlFor="csv-upload" style={{ cursor: 'pointer', display: 'block' }}>
                    <p style={{ fontFamily: "'Cinzel', serif", letterSpacing: '0.1em', marginBottom: 8 }}>Klikněte pro nahrání</p>
                    <small style={{ color: 'hsl(220, 10%, 50%)', fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase' }}>Zero-Knowledge privátní payroll</small>
                  </label>
                </div>
              </div>
            ) : (
              <div style={styles.card}>
                <CornerAccents />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div>
                    <span style={{ fontSize: 10, color: 'hsl(350, 65%, 55%)', letterSpacing: '0.2em', border: '1px solid hsl(350, 65%, 45%, 0.3)', padding: '4px 8px' }}>FRONTA</span>
                    <h3 style={{ fontFamily: "'Cinzel', serif", letterSpacing: '0.05em', marginTop: 8 }}>Fronta výplat</h3>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {failedCount > 0 && (
                      <button onClick={retryFailed} style={{ ...styles.secondaryBtn, borderColor: 'hsl(45, 100%, 50%, 0.5)', color: 'hsl(45, 100%, 60%)' }}>
                        Opakovat selhané ({failedCount})
                      </button>
                    )}
                    <button onClick={failedCount > 0 || currentPayrollId ? clearPayrollState : resetUpload} style={{ ...styles.secondaryBtn, color: 'hsl(0, 60%, 50%)', borderColor: 'hsl(0, 60%, 40%, 0.5)' }}>
                      Vymazat
                    </button>
                  </div>
                </div>

                {/* Selection controls */}
                <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                  <button onClick={() => toggleAllEmployees(true)} style={{ ...styles.secondaryBtn, fontSize: 10, padding: '6px 12px' }}>Vybrat vše</button>
                  <button onClick={() => toggleAllEmployees(false)} style={{ ...styles.secondaryBtn, fontSize: 10, padding: '6px 12px' }}>Zrušit výběr</button>
                  <button onClick={() => loadWalletBalance()} style={{ ...styles.secondaryBtn, fontSize: 10, padding: '6px 12px' }}>↻ Obnovit zůstatek</button>
                </div>

                {/* ZK Proof Pipeline - Live Transaction Tracker */}
                {isProcessing && selectedEmployees.length > 0 && (
                  <PayrollProgress
                    selectedEmployees={selectedEmployees}
                    currentRunStatus={currentRunStatus}
                    transactionIds={transactionIds}
                  />
                )}

                {/* Log console */}
                <div style={{ maxHeight: isProcessing ? '60px' : '80px', overflowY: 'auto', background: 'hsl(0, 0%, 3%)', padding: '10px', fontSize: '11px', fontFamily: 'monospace', color: 'hsl(220, 10%, 50%)', border: '1px solid hsl(220, 10%, 15%)', marginBottom: 16 }}>
                  {logs.length === 0 ? "Připraveno ke zpracování..." : logs.map((l, i) => <div key={i}>{l}</div>)}
                </div>

                <EmployeeTable
                  employees={employees}
                  selectedCount={selectedEmployees.length}
                  currentRunStatus={currentRunStatus}
                  transactionIds={transactionIds}
                  onToggleEmployee={toggleEmployeeSelection}
                  onToggleAll={toggleAllEmployees}
                />

                {/* Preview & Execute */}
                <div style={styles.previewSection}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 10, color: 'hsl(220, 10%, 50%)', letterSpacing: '0.15em', marginBottom: 4 }}>
                        NÁHLED ALEO TRANSAKCE
                      </div>
                      <div style={{ fontSize: 14 }}>
                        <span style={{ color: 'hsl(220, 20%, 90%)' }}>{selectedEmployees.length} zaměstnanců</span>
                        <span style={{ color: 'hsl(220, 10%, 40%)', margin: '0 8px' }}>•</span>
                        <span style={{ color: 'hsl(220, 20%, 90%)' }}>{(totalSalaries / TOKEN_CONFIG.decimals).toFixed(2)} mzdy</span>
                        <span style={{ color: 'hsl(220, 10%, 40%)', margin: '0 8px' }}>•</span>
                        <span style={{ color: 'hsl(220, 10%, 60%)' }}>{(totalGas / TOKEN_CONFIG.decimals).toFixed(2)} poplatky</span>
                        <span style={{ color: 'hsl(220, 10%, 40%)', margin: '0 8px' }}>=</span>
                        <span style={{ color: hasEnoughBalance ? 'hsl(140, 60%, 50%)' : 'hsl(0, 60%, 50%)', fontWeight: 600 }}>
                          {(grandTotal / TOKEN_CONFIG.decimals).toFixed(2)} ALEO
                        </span>
                      </div>
                      {!hasEnoughBalance && (
                        <div style={{ color: 'hsl(0, 60%, 50%)', fontSize: 11, marginTop: 4 }}>
                          ⚠️ Nedostatek ALEO (chybí {((grandTotal - totalBalance) / TOKEN_CONFIG.decimals).toFixed(2)})
                        </div>
                      )}
                    </div>
                    <button 
                      style={{ ...styles.primaryBtn, opacity: (isProcessing || !hasEnoughBalance || selectedEmployees.length === 0) ? 0.5 : 1 }} 
                      onClick={() => setShowConfirmDialog(true)} 
                      disabled={isProcessing || !hasEnoughBalance || selectedEmployees.length === 0}
                    >
                      {isProcessing ? "Zpracovávám..." : "Zaplatit v ALEO"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {viewState === 'history' && <PayrollHistory history={history} />}
      </main>
      
      {/* Payroll Confirmation Dialog */}
      <PayrollConfirmDialog
        show={showConfirmDialog}
        onClose={() => setShowConfirmDialog(false)}
        onConfirm={executePayroll}
        selectedEmployees={selectedEmployees}
        totalSalaries={totalSalaries}
        totalGas={totalGas}
        grandTotal={grandTotal}
        totalBalance={totalBalance}
        hasEnoughBalance={hasEnoughBalance}
      />

      {/* Payroll Completion Summary */}
      {lastPayrollRecord && (
        <PayrollSummary
          show={showSummary}
          onClose={() => setShowSummary(false)}
          record={lastPayrollRecord}
          selectedCount={selectedEmployees.length}
        />
      )}
      
      {/* Footer decoration */}
      <div style={{ marginTop: 'auto', paddingTop: 40, display: 'flex', alignItems: 'center', gap: 8, color: 'hsl(350, 65%, 45%, 0.4)' }}>
        <span>◆</span>
      </div>
    </div>
  );
}

export default function PayrollApp() {
  // Use compatibility wrappers for Puzzle/Shield so they work with demox WalletProvider
  const wallets = useMemo(() => [
    new ShieldWalletDemoxAdapter() as any,
    new LeoWalletAdapter({ appName: "CZKP Payroll" }),
    new PuzzleWalletDemoxAdapter({ appName: "CZKP Payroll" }) as any
  ], []);
  return (
    <WalletProvider 
      wallets={wallets} 
      autoConnect 
      network={NETWORK_MODE}
      decryptPermission={DecryptPermission.AutoDecrypt}
      programs={["credits.aleo", "czkp_payroll_v2.aleo"]}
    >
      <WalletModalProvider>
        <PayrollAppInner />
      </WalletModalProvider>
    </WalletProvider>
  );
}
