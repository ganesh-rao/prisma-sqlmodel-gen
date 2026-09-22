const PYTHON_KEYWORDS = new Set([
  "False",
  "None",
  "True",
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "try",
  "while",
  "with",
  "yield"
]);

export function toPythonIdentifier(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^[^a-zA-Z_]+/, "_");
  if (sanitized.length === 0) {
    return "_";
  }
  return PYTHON_KEYWORDS.has(sanitized) ? `${sanitized}_` : sanitized;
}

export function escapePythonString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function quotePythonString(value: string): string {
  return `'${escapePythonString(value)}'`;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
