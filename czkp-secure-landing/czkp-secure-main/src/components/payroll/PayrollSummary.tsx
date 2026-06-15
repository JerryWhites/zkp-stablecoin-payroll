import React from "react";
import type { HistoryRecord } from "@/lib/payroll-types";
import { TOKEN_CONFIG, ALEO_EXPLORER_URL } from "@/lib/payroll-types";
import { getBadgeStyle } from "./payroll-styles";

interface PayrollSummaryProps {
  show: boolean;
  onClose: () => void;
  record: HistoryRecord;
  selectedCount: number;
}

const PayrollSummary: React.FC<PayrollSummaryProps> = ({
  show,
  onClose,
  record,
  selectedCount,
}) => {
  if (!show) return null;

  const successCount = record.employees.filter((e) => e.status === "Success").length;
  const failedCount = record.employees.filter((e) => e.status === "Failed").length;
  const totalPaid = record.employees
    .filter((e) => e.status === "Success")
    .reduce((sum, e) => sum + e.amount, 0);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0, 0, 0, 0.85)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(6px)",
      }}
    >
      <div
        style={{
          background: "hsl(0, 0%, 7%)",
          border: `1px solid ${failedCount === 0 ? "hsl(140, 60%, 40%)" : "hsl(45, 100%, 50%)"}`,
          padding: "32px",
          maxWidth: 600,
          width: "90%",
          maxHeight: "80vh",
          overflowY: "auto",
          position: "relative",
        }}
      >
        {/* Corner accents */}
        {["top", "bottom"].map((v) =>
          ["left", "right"].map((h) => (
            <div
              key={`${v}-${h}`}
              style={{
                position: "absolute",
                [v]: 0,
                [h]: 0,
                width: 12,
                height: 12,
                [`border${v === "top" ? "Top" : "Bottom"}`]: `2px solid ${failedCount === 0 ? "hsl(140, 60%, 40%)" : "hsl(45, 100%, 50%)"}`,
                [`border${h === "left" ? "Left" : "Right"}`]: `2px solid ${failedCount === 0 ? "hsl(140, 60%, 40%)" : "hsl(45, 100%, 50%)"}`,
              }}
            />
          ))
        )}

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div
            style={{
              fontSize: 36,
              marginBottom: 8,
            }}
          >
            {failedCount === 0 ? "✓" : "⚠"}
          </div>
          <h3
            style={{
              fontFamily: "'Cinzel', serif",
              fontSize: 18,
              letterSpacing: "0.1em",
              color: failedCount === 0 ? "hsl(140, 60%, 50%)" : "hsl(45, 100%, 60%)",
              marginBottom: 4,
            }}
          >
            {failedCount === 0 ? "VÝPLATA DOKONČENA" : "VÝPLATA DOKONČENA S CHYBAMI"}
          </h3>
          <p style={{ fontSize: 12, color: "hsl(220, 10%, 50%)" }}>
            {new Date(record.date).toLocaleString()}
          </p>
        </div>

        {/* Stats summary */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 12,
            marginBottom: 24,
          }}
        >
          <StatBox label="ÚspĚCH" value={`${successCount}`} color="hsl(140, 60%, 50%)" />
          <StatBox label="SELHALO" value={`${failedCount}`} color={failedCount > 0 ? "hsl(0, 60%, 50%)" : "hsl(220, 10%, 40%)"} />
          <StatBox
            label="VYPLACENO"
            value={`${(totalPaid / TOKEN_CONFIG.decimals).toFixed(2)}`}
            color="hsl(350, 65%, 55%)"
            suffix="ALEO"
          />
        </div>

        {/* Per-employee breakdown */}
        <div style={{ marginBottom: 24 }}>
          <div
            style={{
              fontSize: 10,
              color: "hsl(220, 10%, 50%)",
              letterSpacing: "0.15em",
              marginBottom: 8,
              textTransform: "uppercase",
            }}
          >
            DETAILY TRANSAKCÍ
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {record.employees.map((emp, idx) => (
              <div
                key={idx}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 12px",
                  background:
                    emp.status === "Success"
                      ? "hsl(140, 60%, 40%, 0.06)"
                      : "hsl(0, 60%, 40%, 0.06)",
                  borderLeft: `3px solid ${emp.status === "Success" ? "hsl(140, 60%, 50%)" : "hsl(0, 60%, 50%)"}`,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "hsl(220, 20%, 90%)" }}>
                    {emp.name}
                  </div>
                  {emp.txId && (
                    <a
                      href={`${ALEO_EXPLORER_URL}/${emp.txId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: 10,
                        color: "hsl(350, 65%, 55%)",
                        textDecoration: "none",
                        fontFamily: "monospace",
                      }}
                    >
                      {emp.txId.slice(0, 16)}... ↗
                    </a>
                  )}
                </div>
                <div style={{ textAlign: "right", minWidth: 80 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "hsl(220, 20%, 90%)" }}>
                    {(emp.amount / TOKEN_CONFIG.decimals).toFixed(2)}
                  </div>
                  <div style={{ fontSize: 9, color: "hsl(220, 10%, 50%)", letterSpacing: "0.1em" }}>
                    ALEO
                  </div>
                </div>
                <span style={getBadgeStyle(emp.status)}>{emp.status}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <button
            onClick={onClose}
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
            ZAVŘÍT
          </button>
        </div>
      </div>
    </div>
  );
};

const StatBox: React.FC<{
  label: string;
  value: string;
  color: string;
  suffix?: string;
}> = ({ label, value, color, suffix }) => (
  <div
    style={{
      background: "hsl(0, 0%, 5%)",
      border: "1px solid hsl(220, 10%, 18%)",
      padding: "12px",
      textAlign: "center",
    }}
  >
    <div style={{ fontSize: 9, color: "hsl(220, 10%, 50%)", letterSpacing: "0.15em" }}>
      {label}
    </div>
    <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'Cinzel', serif", color, marginTop: 4 }}>
      {value}
      {suffix && (
        <span style={{ fontSize: 10, marginLeft: 4, color: "hsl(220, 10%, 50%)" }}>{suffix}</span>
      )}
    </div>
  </div>
);

export default PayrollSummary;
