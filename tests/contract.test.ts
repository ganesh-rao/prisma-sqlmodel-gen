import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  contractBoolean,
  contractRecord,
  contractString,
  contractStringArray,
  parseContractDocument
} from "../src/contract.js";

async function loadFixture(name: string): Promise<string> {
  return readFile(new URL(`./fixtures/contracts/${name}`, import.meta.url), "utf8");
}

describe("parseContractDocument", () => {
  it("parses a real emitted contract without diagnostics", async () => {
    const text = await loadFixture("basic-postgres.json");

    const { document, diagnostics } = parseContractDocument(text);

    expect(diagnostics).toEqual([]);
    expect(document?.schemaVersion).toBe(1);
    expect(document?.targetFamily).toBe("sql");
    expect(document?.target).toBe("postgres");
  });

  it("reports invalid JSON", () => {
    const { document, diagnostics } = parseContractDocument("{not json");

    expect(document).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: "CONTRACT_JSON_PARSE_ERROR",
      severity: "error"
    });
  });

  it.each(["42", '"str"', "[1, 2]", "null"])("rejects non-object JSON %s", (text) => {
    const { document, diagnostics } = parseContractDocument(text);

    expect(document).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("INVALID_CONTRACT_DOCUMENT");
  });

  it("tolerates a minimal envelope without sections", () => {
    const { document, diagnostics } = parseContractDocument(
      JSON.stringify({ schemaVersion: "1", targetFamily: "sql", target: "postgres" })
    );

    expect(diagnostics).toEqual([]);
    expect(document?.domain).toEqual({});
    expect(document?.storage).toEqual({});
    expect(document?.execution).toEqual({});
  });

  it.each([
    [{ schemaVersion: 2 }, []],
    [{ schemaVersion: "2" }, []],
    [{}, ["schemaVersion"]]
  ] as Array<[Record<string, unknown>, string[]]>)(
    "rejects unsupported schemaVersion %j",
    (override, omit) => {
      const { document, diagnostics } = parseContractDocument(envelopeWith(override, omit));

      expect(document).toBeUndefined();
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({
        code: "UNSUPPORTED_CONTRACT_VERSION",
        severity: "error"
      });
    }
  );

  it.each([
    [{ targetFamily: "document" }, []],
    [{ target: "mongo" }, []],
    [{}, ["target"]]
  ] as Array<[Record<string, unknown>, string[]]>)(
    "rejects unsupported target %j",
    (override, omit) => {
      const { document, diagnostics } = parseContractDocument(envelopeWith(override, omit));

      expect(document).toBeUndefined();
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({
        code: "UNSUPPORTED_CONTRACT_TARGET",
        severity: "error"
      });
    }
  );
});

function envelopeWith(overrides: Record<string, unknown>, omit: string[]): string {
  const base: Record<string, unknown> = {
    schemaVersion: 1,
    targetFamily: "sql",
    target: "postgres"
  };
  for (const key of omit) {
    delete base[key];
  }
  return JSON.stringify({ ...base, ...overrides });
}

describe("contract narrowing helpers", () => {
  it("narrows records", () => {
    expect(contractRecord({ a: 1 })).toEqual({ a: 1 });
    expect(contractRecord([1])).toBeUndefined();
    expect(contractRecord(null)).toBeUndefined();
  });

  it("narrows strings", () => {
    expect(contractString("x")).toBe("x");
    expect(contractString(42)).toBeUndefined();
  });

  it("narrows booleans", () => {
    expect(contractBoolean(true)).toBe(true);
    expect(contractBoolean("true")).toBeUndefined();
  });

  it("narrows string arrays", () => {
    expect(contractStringArray(["a", "b"])).toEqual(["a", "b"]);
    expect(contractStringArray("a")).toBeUndefined();
    expect(contractStringArray(["a", 1])).toBeUndefined();
  });
});
