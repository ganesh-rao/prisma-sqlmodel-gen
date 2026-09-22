import { describe, expect, it } from "vitest";
import { DiagnosticError, formatDiagnostics, isDiagnosticError } from "../src/diagnostics.js";

describe("formatDiagnostics", () => {
  it("formats model locations and suggestions", () => {
    expect(
      formatDiagnostics([
        {
          code: "X",
          severity: "error",
          model: "User",
          field: "email",
          message: "bad",
          suggestion: "fix it"
        }
      ])
    ).toBe("ERROR X (User.email): bad Suggestion: fix it");
  });

  it("formats source locations without model or suggestion", () => {
    expect(
      formatDiagnostics([
        {
          code: "Y",
          severity: "warning",
          message: "iffy",
          location: { line: 3, column: 7 }
        }
      ])
    ).toBe("WARNING Y [line 3, col 7]: iffy");
  });

  it("joins multiple diagnostics with newlines", () => {
    expect(
      formatDiagnostics([
        { code: "A", severity: "error", message: "first" },
        { code: "B", severity: "error", message: "second" }
      ])
    ).toBe("ERROR A: first\nERROR B: second");
  });
});

describe("DiagnosticError", () => {
  it("carries diagnostics", () => {
    const diagnostics = [{ code: "X", severity: "error" as const, message: "bad" }];
    const error = new DiagnosticError("failed", diagnostics);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("DiagnosticError");
    expect(error.message).toBe("failed");
    expect(error.diagnostics).toBe(diagnostics);
    expect(isDiagnosticError(error)).toBe(true);
  });

  it("rejects values without diagnostics", () => {
    expect(isDiagnosticError(new Error("plain"))).toBe(false);
    expect(isDiagnosticError({})).toBe(false);
  });
});
