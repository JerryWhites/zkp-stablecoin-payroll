import React from "react";
import type { Employee } from "@/lib/payroll-types";
import { TOKEN_CONFIG } from "@/lib/payroll-types";

interface PayrollConfirmDialogProps {
  show: boolean;
  onClose: () => void;
  onConfirm: () => void;
  selectedEmployees: Employee[];
  totalSalaries: number;
  totalGas: number;
  grandTotal: number;
  totalBalance: number;
  hasEnoughBalance: boolean;
}

const CornerAccents = () => (
  <>
    <div style={{ position: "absolute", top: 0, left: 0, width: 12, height: 12, borderTop: "2px solid hsl(350, 65%, 45%)", borderLeft: "2px solid hsl(350, 65%, 45%)" }} />
    <div style={{ position: "absolute", top: 0, right: 0, width: 12, height: 12, borderTop: "2px solid hsl(350, 65%, 45%)", borderRight: "2px solid hsl(350, 65%, 45%)" }} />
    <div style={{ position: "absolute", bottom: 0, left: 0, width: 12, height: 12, borderBottom: "2px solid hsl(350, 65%, 45%)", borderLeft: "2px solid hsl(350, 65%, 45%)" }} />
    <div style={{ position: "absolute", bottom: 0, right: 0, width: 12, height: 12, borderBottom: "2px solid hsl(350, 65%, 45%)", borderRight: "2px solid hsl(350, 65%, 45%)" }} />
  </>
);

const PayrollConfirmDialog: React.FC<PayrollConfirmDialogProps> = ({
  show,
  onClose,
  onConfirm,
  selectedEmployees,
  totalSalaries,
  totalGas,
  grandTotal,
  totalBalance,
  hasEnoughBalance,
}) => {
  if (!show) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0, 0, 0, 0.8)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        style={{
          background: "hsl(0, 0%, 7%)",
          border: "1px solid hsl(350, 65%, 45%)",
          padding: "32px",
          maxWidth: 500,
          width: "90%",
          position: "relative",
        }}
      >
        <CornerAccents />
        <h3
          style={{
            fontFamily: "'Cinzel', serif",
            fontSize: 18,
            letterSpacing: "0.1em",
            marginBottom: 20,
            color: "hsl(220, 20%, 90%)",
          }}
        >
          POTVRZENÍ VÝPLATY
        </h3>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
          <Row label="Zaměstnanců" value={`${selectedEmployees.length}`} />
          <Row label="Mzdy celkem" value={`${(totalSalaries / TOKEN_CONFIG.decimals).toFixed(2)} ALEO`} />
          <Row label="Síťové poplatky" value={`${(totalGas / TOKEN_CONFIG.decimals).toFixed(2)} ALEO`} muted />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "8px 0",
              borderBottom: "1px solid hsl(350, 65%, 45%, 0.3)",
            }}
          >
            <span style={{ color: "hsl(350, 65%, 55%)", fontSize: 12, fontWeight: 600 }}>CELKOVÁ CENA</span>
            <span style={{ color: "hsl(350, 65%, 55%)", fontWeight: 700, fontSize: 16 }}>
              {(grandTotal / TOKEN_CONFIG.decimals).toFixed(2)} ALEO
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0" }}>
            <span style={{ color: "hsl(220, 10%, 50%)", fontSize: 12 }}>Zůstatek peněženky</span>
            <span
              style={{
                color: hasEnoughBalance ? "hsl(140, 60%, 50%)" : "hsl(0, 60%, 50%)",
                fontWeight: 600,
              }}
            >
              {(totalBalance / TOKEN_CONFIG.decimals).toFixed(2)} ALEO
            </span>
          </div>
          {selectedEmployees.some((e) => e.salary / TOKEN_CONFIG.decimals > 100) && (
            <div
              style={{
                background: "hsl(45, 100%, 50%, 0.1)",
                border: "1px solid hsl(45, 100%, 50%, 0.3)",
                padding: 12,
                fontSize: 11,
                color: "hsl(45, 100%, 60%)",
              }}
            >
              VAROVÁNÍ: Jedna nebo více plateb přesahuje 100 ALEO. Ověřte prosím částky.
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              padding: "12px 24px",
              background: "transparent",
              color: "hsl(220, 20%, 90%)",
              border: "1px solid hsl(350, 65%, 45%, 0.5)",
              borderRadius: "0",
              cursor: "pointer",
              fontSize: "11px",
              letterSpacing: "0.1em",
              textTransform: "uppercase" as const,
            }}
          >
            ZRUŠIT
          </button>
          <button
            onClick={() => {
              onClose();
              onConfirm();
            }}
            style={{
              padding: "14px 28px",
              background: "linear-gradient(135deg, hsl(350, 65%, 50%), hsl(350, 70%, 38%))",
              color: "hsl(220, 20%, 95%)",
              border: "none",
              borderRadius: "0",
              fontSize: "12px",
              fontWeight: "600",
              cursor: "pointer",
              letterSpacing: "0.15em",
              textTransform: "uppercase" as const,
              boxShadow: "0 0 40px hsl(350, 65%, 45%, 0.2)",
            }}
          >
            POTVRDIT A ZAPLATIT
          </button>
        </div>
      </div>
    </div>
  );
};

const Row: React.FC<{ label: string; value: string; muted?: boolean }> = ({
  label,
  value,
  muted,
}) => (
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      padding: "8px 0",
      borderBottom: "1px solid hsl(220, 10%, 15%)",
    }}
  >
    <span style={{ color: "hsl(220, 10%, 50%)", fontSize: 12 }}>{label}</span>
    <span
      style={{
        color: muted ? "hsl(220, 10%, 60%)" : "hsl(220, 20%, 90%)",
        fontWeight: 600,
      }}
    >
      {value}
    </span>
  </div>
);

export default PayrollConfirmDialog;
