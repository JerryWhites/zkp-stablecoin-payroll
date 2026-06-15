import { logger } from "@/lib/logger";
import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "./useAuth";
import { apiClient } from "@/lib/api-client";

export interface CreditBalance {
  currency: string;
  balance_czk: number;
  balance_usd: number; // legacy compat
  total_spent_czk: number;
  total_spent_usd: number; // legacy compat
  last_topped_up: string | null;
  tier: {
    name: string;
    display_name: string;
    monthly_price_czk: number;
    annual_monthly_price_czk: number | null;
    included_employees: number;
    overage_per_employee_czk: number;
    max_payroll_runs: number | null;
    run_limit_type: string;
    max_seats: number | null;
    max_employees: number | null;
    features: Record<string, boolean>;
    sla: string;
    gdpr_support: string;
    cost_per_run_czk: number;
    // Legacy compat
    rate_per_employee: number;
    monthly_price: number;
  };
  billing_period: string;
  runs_this_period: number;
  estimates: {
    active_employees: number;
    next_payroll_cost_czk: number;
    next_payroll_cost: number;
    included_remaining: number;
    overage_employees: number;
    payrolls_remaining: number;
  };
}

export interface CreditTransaction {
  uuid: string;
  type: "topup" | "charge" | "refund" | "adjustment";
  amount_czk: number;
  amount_usd: number; // legacy compat
  balance_after_czk: number;
  balance_after: number; // legacy compat
  description: string;
  payment_method: string | null;
  created_at: string;
}

export const useCredits = () => {
  const { session } = useAuth();
  const [credits, setCredits] = useState<CreditBalance | null>(null);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Authenticated fetch using the shared apiClient
  const backendFetch = useCallback(
    async (endpoint: string, options: RequestInit = {}) => {
      return apiClient.authenticatedFetch(endpoint, options);
    },
    []
  );

  // Fetch credit balance
  const fetchCredits = useCallback(async () => {
    if (!session) return;

    setLoading(true);
    setError(null);

    try {
      const res = await backendFetch("/credits/balance");
      if (res.ok) {
        const data = await res.json();
        setCredits(data);
      } else {
        const errData = await res.json();
        setError(errData.error || "Failed to fetch credits");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [session, backendFetch]);

  // Fetch transaction history
  const fetchTransactions = useCallback(
    async (limit = 20) => {
      if (!session) return;

      try {
        const res = await backendFetch(`/credits/history?limit=${limit}`);
        if (res.ok) {
          const data = await res.json();
          setTransactions(data.transactions || []);
        }
      } catch (e) {
        logger.error("Failed to fetch transactions:", e);
      }
    },
    [session, backendFetch]
  );

  // Request top-up
  const requestTopup = useCallback(
    async (amount: number) => {
      const res = await backendFetch("/credits/topup/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount_usd: amount }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to request top-up");
      }

      return res.json();
    },
    [backendFetch]
  );

  // Prepare payroll (checks credits)
  const preparePayroll = useCallback(async () => {
    const res = await backendFetch("/payroll/prepare", {
      method: "POST",
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Failed to prepare payroll");
    }

    // Refresh credits after payroll
    await fetchCredits();

    return data;
  }, [backendFetch, fetchCredits]);

  // Change subscription tier
  const changeTier = useCallback(
    async (tier: string) => {
      const res = await backendFetch("/subscription/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to change subscription");
      }

      const data = await res.json();
      // Refresh credits to get updated tier info
      await fetchCredits();
      return data;
    },
    [backendFetch, fetchCredits]
  );

  // Purchase additional payroll runs
  const purchaseRuns = useCallback(
    async (runs: number) => {
      const res = await backendFetch("/credits/purchase-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runs }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Nákup runů selhal");
      }

      const data = await res.json();
      // Refresh credits to reflect updated balance
      await fetchCredits();
      await fetchTransactions();
      return data;
    },
    [backendFetch, fetchCredits, fetchTransactions]
  );

  // Initial fetch when session changes — only fetch once per session
  const hasFetchedRef = useRef(false);
  useEffect(() => {
    if (session) {
      if (!hasFetchedRef.current) {
        hasFetchedRef.current = true;
        fetchCredits();
        fetchTransactions();
      }
    } else {
      hasFetchedRef.current = false;
      setCredits(null);
      setTransactions([]);
    }
  }, [session, fetchCredits, fetchTransactions]);

  return {
    credits,
    transactions,
    loading,
    error,
    fetchCredits,
    fetchTransactions,
    requestTopup,
    preparePayroll,
    changeTier,
    purchaseRuns,
    backendFetch,
    isConnected: !!session,
  };
};
