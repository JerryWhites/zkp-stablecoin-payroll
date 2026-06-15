import React from "react";
import type { Employee } from "@/lib/payroll-types";
import { TOKEN_CONFIG, ALEO_EXPLORER_URL } from "@/lib/payroll-types";

interface PayrollProgressProps {
  selectedEmployees: Employee[];
  currentRunStatus: { [key: string]: string };
  transactionIds: { [email: string]: string };
}

const PayrollProgress: React.FC<PayrollProgressProps> = ({
  selectedEmployees,
  currentRunStatus,
  transactionIds,
}) => {
  const completedCount = Object.values(currentRunStatus).filter(
    (s) => s === "Paid" || s === "Failed"
  ).length;

  return (
    <div
      style={{
        background: "linear-gradient(135deg, hsl(0, 0%, 3%), hsl(350, 65%, 10%, 0.1))",
        border: "1px solid hsl(350, 65%, 45%, 0.3)",
        padding: "20px",
        marginBottom: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "hsl(350, 65%, 50%)",
            animation: "pulse 1.5s infinite",
          }}
        />
        <span
          style={{
            fontSize: 10,
            color: "hsl(350, 65%, 55%)",
            letterSpacing: "0.2em",
            fontWeight: 600,
          }}
        >
          ŽIVÝ ZK PROOF PIPELINE
        </span>
        <span style={{ fontSize: 10, color: "hsl(220, 10%, 40%)", marginLeft: "auto" }}>
          {Object.values(currentRunStatus).filter((s) => s === "Paid").length}/
          {selectedEmployees.length} HOTOVO
        </span>
      </div>

      {/* Pipeline visualization */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {selectedEmployees.map((emp, idx) => {
          const status = currentRunStatus[emp.email] || "Queued";
          const isActive = status === "Processing...";
          const isDone = status === "Paid";
          const isFailed = status === "Failed";
          const txId = transactionIds[emp.email];

          return (
            <div
              key={emp.email}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 14px",
                background: isActive
                  ? "linear-gradient(90deg, hsl(350, 65%, 45%, 0.15), transparent)"
                  : isDone
                    ? "hsl(140, 60%, 40%, 0.08)"
                    : isFailed
                      ? "hsl(0, 60%, 40%, 0.08)"
                      : "transparent",
                borderLeft: isActive
                  ? "3px solid hsl(350, 65%, 50%)"
                  : isDone
                    ? "3px solid hsl(140, 60%, 50%)"
                    : isFailed
                      ? "3px solid hsl(0, 60%, 50%)"
                      : "3px solid hsl(220, 10%, 15%)",
                transition: "all 0.5s ease",
              }}
            >
              {/* Step number */}
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10,
                  fontWeight: 700,
                  background: isDone
                    ? "hsl(140, 60%, 40%)"
                    : isFailed
                      ? "hsl(0, 60%, 40%)"
                      : isActive
                        ? "hsl(350, 65%, 50%)"
                        : "hsl(220, 10%, 15%)",
                  color: isDone || isFailed || isActive ? "#fff" : "hsl(220, 10%, 40%)",
                }}
              >
                {isDone ? "✓" : isFailed ? "✗" : idx + 1}
              </div>

              {/* Employee info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "hsl(220, 20%, 90%)" }}>
                  {emp.name}
                </div>
                <div style={{ fontSize: 10, color: "hsl(220, 10%, 50%)" }}>
                  {emp.aleo_address.slice(0, 12)}...{emp.aleo_address.slice(-6)}
                </div>
              </div>

              {/* Amount */}
              <div style={{ textAlign: "right", minWidth: 80 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "hsl(220, 20%, 90%)" }}>
                  {(emp.salary / TOKEN_CONFIG.decimals).toFixed(2)}
                </div>
                <div style={{ fontSize: 9, color: "hsl(220, 10%, 50%)", letterSpacing: "0.1em" }}>
                  ALEO
                </div>
              </div>

              {/* Status with animation */}
              <div style={{ minWidth: 120, textAlign: "right" }}>
                {isActive && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      justifyContent: "flex-end",
                    }}
                  >
                    <div style={{ display: "flex", gap: 2 }}>
                      {[0, 1, 2].map((i) => (
                        <div
                          key={i}
                          style={{
                            width: 4,
                            height: 4,
                            borderRadius: "50%",
                            background: "hsl(350, 65%, 50%)",
                            animation: `pulse 1s ${i * 0.2}s infinite`,
                          }}
                        />
                      ))}
                    </div>
                    <span
                      style={{
                        fontSize: 10,
                        color: "hsl(350, 65%, 55%)",
                        fontWeight: 600,
                        letterSpacing: "0.05em",
                      }}
                    >
                      ZK PROVING
                    </span>
                  </div>
                )}
                {isDone && txId && (
                  <a
                    href={`${ALEO_EXPLORER_URL}/${txId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: 10,
                      color: "hsl(140, 60%, 50%)",
                      textDecoration: "none",
                      letterSpacing: "0.05em",
                    }}
                  >
                    ✓ CONFIRMED ↗
                  </a>
                )}
                {isDone && !txId && (
                  <span
                    style={{
                      fontSize: 10,
                      color: "hsl(140, 60%, 50%)",
                      letterSpacing: "0.05em",
                    }}
                  >
                    ✓ CONFIRMED
                  </span>
                )}
                {isFailed && (
                  <span
                    style={{ fontSize: 10, color: "hsl(0, 60%, 50%)", letterSpacing: "0.05em" }}
                  >
                    ✗ FAILED
                  </span>
                )}
                {!isActive && !isDone && !isFailed && (
                  <span
                    style={{
                      fontSize: 10,
                      color: "hsl(220, 10%, 35%)",
                      letterSpacing: "0.05em",
                    }}
                  >
                    QUEUED
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Progress bar */}
      <div style={{ marginTop: 16, height: 3, background: "hsl(220, 10%, 12%)", overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${(completedCount / selectedEmployees.length) * 100}%`,
            background: "linear-gradient(90deg, hsl(350, 65%, 50%), hsl(140, 60%, 50%))",
            transition: "width 1s ease",
          }}
        />
      </div>
    </div>
  );
};

export default PayrollProgress;
