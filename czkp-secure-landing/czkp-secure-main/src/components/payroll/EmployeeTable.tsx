import React from "react";
import type { Employee } from "@/lib/payroll-types";
import { TOKEN_CONFIG, ALEO_EXPLORER_URL } from "@/lib/payroll-types";
import { styles, getBadgeStyle } from "./payroll-styles";

interface EmployeeTableProps {
  employees: Employee[];
  selectedCount: number;
  currentRunStatus: { [key: string]: string };
  transactionIds: { [email: string]: string };
  onToggleEmployee: (email: string) => void;
  onToggleAll: (selected: boolean) => void;
}

const EmployeeTable: React.FC<EmployeeTableProps> = ({
  employees,
  selectedCount,
  currentRunStatus,
  transactionIds,
  onToggleEmployee,
  onToggleAll,
}) => (
  <table style={styles.table}>
    <thead>
      <tr>
        <th style={{ ...styles.th, width: 40 }}>
          <input
            type="checkbox"
            checked={selectedCount === employees.length}
            onChange={(e) => onToggleAll(e.target.checked)}
            style={styles.checkbox}
          />
        </th>
        <th style={styles.th}>Zaměstnanec</th>
        <th style={styles.th}>Peněženka</th>
        <th style={styles.th}>Částka</th>
        <th style={styles.th}>Stav</th>
        <th style={styles.th}>TX</th>
      </tr>
    </thead>
    <tbody>
      {employees.map((e) => (
        <tr key={e.email} style={{ opacity: e.selected ? 1 : 0.5 }}>
          <td style={styles.td}>
            <input
              type="checkbox"
              checked={e.selected}
              onChange={() => onToggleEmployee(e.email)}
              style={styles.checkbox}
              disabled={currentRunStatus[e.email] === "Paid"}
            />
          </td>
          <td style={styles.td}>
            <div style={{ fontWeight: 500 }}>{e.name}</div>
            <div style={{ fontSize: "11px", color: "hsl(220, 10%, 50%)" }}>{e.email}</div>
          </td>
          <td
            style={{
              ...styles.td,
              fontFamily: "monospace",
              fontSize: "11px",
              color: "hsl(350, 65%, 55%)",
            }}
          >
            {e.aleo_address.slice(0, 10)}...{e.aleo_address.slice(-4)}
          </td>
          <td style={styles.td}>
            {(e.salary / TOKEN_CONFIG.decimals).toFixed(2)}
            <span style={{ fontSize: 9, marginLeft: 4, color: "hsl(220, 10%, 50%)" }}>ALEO</span>
          </td>
          <td style={styles.td}>
            <span style={getBadgeStyle(currentRunStatus[e.email] || "Ready")}>
              {currentRunStatus[e.email] || "Ready"}
            </span>
          </td>
          <td style={styles.td}>
            {transactionIds[e.email] && (
              <a
                href={`${ALEO_EXPLORER_URL}/${transactionIds[e.email]}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "hsl(350, 65%, 55%)", fontSize: 11, textDecoration: "none" }}
              >
                View ↗
              </a>
            )}
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

export default EmployeeTable;
