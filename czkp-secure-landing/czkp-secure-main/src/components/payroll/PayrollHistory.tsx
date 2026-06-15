import React from "react";
import type { HistoryRecord } from "@/lib/payroll-types";
import { TOKEN_CONFIG, ALEO_EXPLORER_URL } from "@/lib/payroll-types";
import { styles, getBadgeStyle, CornerAccents } from "./payroll-styles";

interface PayrollHistoryProps {
  history: HistoryRecord[];
}

const PayrollHistory: React.FC<PayrollHistoryProps> = ({ history }) => (
  <div style={styles.card}>
    <CornerAccents />
    <span
      style={{
        fontSize: 10,
        color: "hsl(350, 65%, 55%)",
        letterSpacing: "0.2em",
        border: "1px solid hsl(350, 65%, 45%, 0.3)",
        padding: "4px 8px",
      }}
    >
      ARCHIV
    </span>
    <h3
      style={{
        fontFamily: "'Cinzel', serif",
        letterSpacing: "0.05em",
        marginTop: 8,
        marginBottom: 20,
      }}
    >
      Historie transakcí
    </h3>

    {history.length === 0 ? (
      <div style={{ textAlign: "center", padding: "40px", color: "hsl(220, 10%, 50%)" }}>
        <p style={{ fontFamily: "'Cinzel', serif", letterSpacing: "0.1em" }}>Žádné záznamy</p>
      </div>
    ) : (
      <>
        {history.map((h) => (
          <div
            key={h.id}
            style={{
              marginBottom: 24,
              paddingBottom: 24,
              borderBottom: "1px solid hsl(220, 10%, 18%)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <div>
                <span style={{ fontSize: 12, color: "hsl(220, 10%, 50%)" }}>
                  {new Date(h.date).toLocaleString()}
                </span>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 600,
                    fontFamily: "'Cinzel', serif",
                    marginTop: 4,
                  }}
                >
                  {h.count} zaměstnanců •{" "}
                  <span style={{ color: "hsl(350, 65%, 55%)" }}>
                    {(h.total / TOKEN_CONFIG.decimals).toFixed(2)} ALEO
                  </span>
                </div>
              </div>
              <span style={getBadgeStyle("Success")}>{h.txs.length} transakcí</span>
            </div>

            <table style={{ ...styles.table, marginTop: 8 }}>
              <thead>
                <tr>
                  <th style={styles.th}>Zaměstnanec</th>
                  <th style={styles.th}>Částka</th>
                  <th style={styles.th}>Stav</th>
                  <th style={styles.th}>Transakce</th>
                </tr>
              </thead>
              <tbody>
                {h.employees.map((emp, idx) => (
                  <tr key={idx}>
                    <td style={styles.td}>{emp.name}</td>
                    <td style={styles.td}>
                      {(emp.amount / TOKEN_CONFIG.decimals).toFixed(2)} ALEO
                    </td>
                    <td style={styles.td}>
                      <span style={getBadgeStyle(emp.status)}>{emp.status}</span>
                    </td>
                    <td style={styles.td}>
                      {emp.txId ? (
                        <a
                          href={`${ALEO_EXPLORER_URL}/${emp.txId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            color: "hsl(350, 65%, 55%)",
                            fontSize: 11,
                            textDecoration: "none",
                            fontFamily: "monospace",
                          }}
                        >
                          {emp.txId.slice(0, 12)}... ↗
                        </a>
                      ) : (
                        <span style={{ color: "hsl(220, 10%, 40%)" }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </>
    )}
  </div>
);

export default PayrollHistory;
