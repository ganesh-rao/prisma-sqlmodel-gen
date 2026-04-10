import type { Diagnostic } from "./types.js";

export class DiagnosticError extends Error {
  readonly diagnostics: Diagnostic[];

  constructor(message: string, diagnostics: Diagnostic[]) {
    super(message);
    this.name = "DiagnosticError";
    this.diagnostics = diagnostics;
  }
}

export function isDiagnosticError(error: unknown): error is { diagnostics: Diagnostic[] } & Error {
  return error instanceof Error && "diagnostics" in error;
}

export function formatDiagnostics(diagnostics: Diagnostic[]): string {
  const lines = diagnostics.map((diagnostic) => {
    const location = [diagnostic.model, diagnostic.field].filter(Boolean).join(".");
    const locationText = location.length > 0 ? ` (${location})` : "";
    const sourceText = diagnostic.location
      ? ` [line ${diagnostic.location.line}, col ${diagnostic.location.column}]`
      : "";
    const suggestionText = diagnostic.suggestion ? ` Suggestion: ${diagnostic.suggestion}` : "";
    return `${diagnostic.severity.toUpperCase()} ${diagnostic.code}${locationText}${sourceText}: ${diagnostic.message}${suggestionText}`;
  });

  return lines.join("\n");
}
