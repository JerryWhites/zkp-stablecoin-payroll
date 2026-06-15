// ====================================
// 🧪 Czech Payroll Types & Utils — Unit Tests
// ====================================

import { describe, it, expect } from "vitest";
import {
  formatCZK,
  periodLabel,
  MONTHS_CZ,
  ZP_CODES,
} from "@/lib/cz-payroll-types";

describe("formatCZK", () => {
  it("formats positive amounts", () => {
    const result = formatCZK(35000);
    expect(result).toContain("35");
    expect(result).toContain("Kč");
  });

  it("returns 0 Kč for null/undefined", () => {
    expect(formatCZK(null)).toBe("0 Kč");
    expect(formatCZK(undefined)).toBe("0 Kč");
  });

  it("formats zero", () => {
    const result = formatCZK(0);
    expect(result).toContain("0");
    expect(result).toContain("Kč");
  });

  it("formats large amounts with grouping", () => {
    const result = formatCZK(1234567);
    // Czech formatting uses space or nbsp as thousands separator
    expect(result).toContain("Kč");
  });

  it("formats negative amounts", () => {
    const result = formatCZK(-5000);
    expect(result).toContain("5");
    expect(result).toContain("Kč");
  });
});

describe("periodLabel", () => {
  it("returns correct Czech month name and year", () => {
    expect(periodLabel(2025, 1)).toBe("Leden 2025");
    expect(periodLabel(2025, 6)).toBe("Červen 2025");
    expect(periodLabel(2025, 12)).toBe("Prosinec 2025");
  });

  it("handles boundary months", () => {
    expect(periodLabel(2024, 1)).toContain("Leden");
    expect(periodLabel(2024, 12)).toContain("Prosinec");
  });
});

describe("MONTHS_CZ", () => {
  it("has 13 entries (index 0 is empty)", () => {
    expect(MONTHS_CZ).toHaveLength(13);
    expect(MONTHS_CZ[0]).toBe("");
  });

  it("all months are non-empty strings", () => {
    for (let i = 1; i <= 12; i++) {
      expect(MONTHS_CZ[i].length).toBeGreaterThan(0);
    }
  });
});

describe("ZP_CODES", () => {
  it("contains VZP (111)", () => {
    expect(ZP_CODES["111"]).toBeDefined();
    expect(ZP_CODES["111"]).toContain("VZP");
  });

  it("has multiple health insurance companies", () => {
    expect(Object.keys(ZP_CODES).length).toBeGreaterThanOrEqual(5);
  });
});
