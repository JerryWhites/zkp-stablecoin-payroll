import { useState, useCallback } from "react";
import { logger } from "@/lib/logger";
import type { Employee } from "@/lib/payroll-types";
import { ALEO_ADDRESS_REGEX } from "@/lib/payroll-types";

export const useCSVParser = () => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);

  const parseCSV = useCallback((text: string): { employees: Employee[]; error: string | null } => {
    const lines = text.trim().split("\n");

    if (lines.length < 2) {
      return { employees: [], error: "CSV must have header + at least 1 row" };
    }

    const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const nameIdx = header.findIndex((h) => h === "name");
    const emailIdx = header.findIndex((h) => h === "email");
    const salaryIdx = header.findIndex((h) => h === "salary");
    const addressIdx = header.findIndex(
      (h) => h.includes("address") || h.includes("aleo")
    );

    if (nameIdx === -1 || salaryIdx === -1 || addressIdx === -1) {
      return { employees: [], error: "CSV must have columns: Name, Salary, AleoAddress" };
    }

    const parsed: Employee[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.trim());
      if (cols.length < 3) continue;

      const name = cols[nameIdx];
      const email = emailIdx !== -1 ? cols[emailIdx] : `emp${i}@company.local`;

      // Smart salary parsing: detect if value is in ALEO or microcredits
      const rawSalary = parseFloat(cols[salaryIdx]);
      const salary =
        rawSalary < 10_000
          ? Math.floor(rawSalary * 1_000_000) // Convert ALEO to microcredits
          : Math.floor(rawSalary); // Already in microcredits

      const aleo_address = cols[addressIdx];

      // Validate Aleo address format
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
        selected: true,
      });
    }

    if (parsed.length === 0) {
      return { employees: [], error: "No valid employees found in CSV" };
    }

    return { employees: parsed, error: null };
  }, []);

  const handleFileUpload = useCallback(
    (file: File): Promise<{ employees: Employee[]; error: string | null }> => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          const text = event.target?.result as string;
          const result = parseCSV(text);
          if (result.error) {
            setParseError(result.error);
          } else {
            setParseError(null);
            setEmployees(result.employees);
          }
          resolve(result);
        };
        reader.readAsText(file);
      });
    },
    [parseCSV]
  );

  const toggleEmployeeSelection = useCallback((email: string) => {
    setEmployees((prev) =>
      prev.map((emp) =>
        emp.email === email ? { ...emp, selected: !emp.selected } : emp
      )
    );
  }, []);

  const toggleAllEmployees = useCallback((selected: boolean) => {
    setEmployees((prev) => prev.map((emp) => ({ ...emp, selected })));
  }, []);

  const resetEmployees = useCallback(() => {
    setEmployees([]);
    setParseError(null);
  }, []);

  return {
    employees,
    setEmployees,
    parseError,
    handleFileUpload,
    toggleEmployeeSelection,
    toggleAllEmployees,
    resetEmployees,
  };
};
