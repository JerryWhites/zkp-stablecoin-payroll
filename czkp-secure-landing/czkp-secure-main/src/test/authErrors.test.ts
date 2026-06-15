// ====================================
// 🧪 Auth Error Sanitizer — Unit Tests
// ====================================

import { describe, it, expect } from "vitest";
import { sanitizeAuthError } from "@/lib/authErrors";

describe("sanitizeAuthError", () => {
  it("hides credential details for invalid login", () => {
    const result = sanitizeAuthError(new Error("Invalid credentials"));
    expect(result).toBe("Invalid email or password. Please try again.");
    expect(result).not.toContain("credentials");
  });

  it("hides user enumeration for not found", () => {
    const result = sanitizeAuthError(new Error("User not found"));
    expect(result).toBe("Invalid email or password. Please try again.");
    expect(result).not.toContain("not found");
  });

  it("handles email confirmation", () => {
    const result = sanitizeAuthError(new Error("Email not confirmed"));
    expect(result).toContain("confirm");
  });

  it("prevents user enumeration on already registered", () => {
    const result = sanitizeAuthError(new Error("User already registered"));
    expect(result).not.toContain("already registered");
    expect(result).toContain("different email");
  });

  it("handles rate limiting", () => {
    const result = sanitizeAuthError(new Error("Rate limit exceeded"));
    expect(result).toContain("few minutes");
  });

  it("passes through password validation specifics", () => {
    const result = sanitizeAuthError(new Error("Password must be at least 12 characters"));
    expect(result).toContain("12 characters");
  });

  it("handles network errors", () => {
    const result = sanitizeAuthError(new Error("Network error: fetch failed"));
    expect(result).toContain("internet");
  });

  it("returns generic fallback for unknown errors", () => {
    const result = sanitizeAuthError(new Error("some_internal_db_error_xyz"));
    expect(result).toBe("Authentication failed. Please try again or contact support.");
    expect(result).not.toContain("db_error");
  });

  it("never exposes raw error messages", () => {
    const sensitiveErrors = [
      "SQL injection detected",
      "Database connection timeout",
      "ECONNREFUSED 127.0.0.1:5432",
      "JWT malformed",
    ];
    for (const msg of sensitiveErrors) {
      const result = sanitizeAuthError(new Error(msg));
      expect(result).not.toContain(msg);
    }
  });
});
