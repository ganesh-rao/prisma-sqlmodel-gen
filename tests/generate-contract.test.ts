import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DiagnosticError, isDiagnosticError } from "../src/diagnostics.js";
import {
  checkSqlModelGeneration,
  generateSqlModel
} from "../src/generate.js";
import type { ContractGeneratorInput, GeneratorConfig } from "../src/types.js";

const FIXTURE_URL = new URL("./fixtures/contracts/basic-postgres.json", import.meta.url);

function testConfig(overrides?: Partial<GeneratorConfig>): GeneratorConfig {
  return {
    moduleName: "models.py",
    emitInit: false,
    strict: true,
    headerComment: false,
    sqlmodelImportStyle: "sqlmodel",
    ...overrides
  };
}

async function testInput(
  outputDir: string,
  overrides?: { contractText?: string; config?: Partial<GeneratorConfig> }
): Promise<ContractGeneratorInput> {
  return {
    contractPath: fileURLToPath(FIXTURE_URL),
    contractText: overrides?.contractText ?? (await readFile(FIXTURE_URL, "utf8")),
    outputDir,
    config: testConfig(overrides?.config)
  };
}

async function captureDiagnosticCodes(operation: () => Promise<unknown>): Promise<string[]> {
  try {
    await operation();
  } catch (error) {
    expect(error).toBeInstanceOf(DiagnosticError);
    expect(isDiagnosticError(error)).toBe(true);
    return isDiagnosticError(error) ? error.diagnostics.map((entry) => entry.code) : [];
  }
  expect.unreachable("expected the operation to throw a DiagnosticError");
}

describe("generateSqlModel", () => {
  it("generates a SQLModel module from contract text", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "prisma-sqlmodel-contract-"));
    const result = await generateSqlModel(await testInput(outputDir));

    expect(result.diagnostics).toEqual([]);
    expect(result.files).toEqual([path.join(outputDir, "models.py")]);
    const rendered = await readFile(path.join(outputDir, "models.py"), "utf8");
    expect(rendered).toContain("class User(SQLModel, table=True):");
    expect(rendered).toContain("class Post(SQLModel, table=True):");
  });

  it("emits an init file when configured", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "prisma-sqlmodel-contract-init-"));
    const result = await generateSqlModel(
      await testInput(outputDir, { config: { emitInit: true } })
    );

    expect(result.files).toEqual([
      path.join(outputDir, "models.py"),
      path.join(outputDir, "__init__.py")
    ]);
    await expect(readFile(path.join(outputDir, "__init__.py"), "utf8")).resolves.toBe(
      "from .models import *\n"
    );
  });

  it("rejects unparsable contract text with diagnostics", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "prisma-sqlmodel-contract-badjson-"));
    const input = await testInput(outputDir, { contractText: "{oops" });
    await expect(captureDiagnosticCodes(() => generateSqlModel(input))).resolves.toEqual(
      ["CONTRACT_JSON_PARSE_ERROR"]
    );
  });

  it("rejects unsupported contract versions with diagnostics", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "prisma-sqlmodel-contract-version-"));
    const input = await testInput(outputDir, {
      contractText: JSON.stringify({ schemaVersion: 999, targetFamily: "sql", target: "postgres" })
    });
    await expect(captureDiagnosticCodes(() => generateSqlModel(input))).resolves.toEqual(
      ["UNSUPPORTED_CONTRACT_VERSION"]
    );
  });

  it("rejects strict-mode normalize errors with diagnostics", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "prisma-sqlmodel-contract-strict-"));
    const dangling = {
      schemaVersion: "1",
      targetFamily: "sql",
      target: "postgres",
      storage: {
        namespaces: { public: { entries: { table: { a: { columns: { id: { nativeType: "int4" } } } } } } }
      },
      domain: {
        namespaces: {
          public: {
            models: {
              A: {
                fields: {},
                relations: {
                  ghost: { cardinality: "N:1", to: { model: "Missing", namespace: "public" } }
                },
                storage: { table: "a", namespaceId: "public", fields: { id: { column: "id" } } }
              }
            }
          }
        }
      }
    };
    const input = await testInput(outputDir, { contractText: JSON.stringify(dangling) });
    await expect(captureDiagnosticCodes(() => generateSqlModel(input))).resolves.toEqual(
      ["UNRESOLVED_RELATION_TARGET"]
    );
  });
});

describe("checkSqlModelGeneration", () => {
  it("passes when the generated module is fresh", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "prisma-sqlmodel-contract-check-"));
    const input = await testInput(outputDir);
    await generateSqlModel(input);

    const result = await checkSqlModelGeneration(input);
    expect(result.diagnostics).toEqual([]);
    expect(result.files).toEqual([path.join(outputDir, "models.py")]);
  });

  it("passes with an init file when configured", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "prisma-sqlmodel-contract-checkinit-"));
    const input = await testInput(outputDir, { config: { emitInit: true } });
    await generateSqlModel(input);

    const result = await checkSqlModelGeneration(input);
    expect(result.diagnostics).toEqual([]);
    expect(result.files).toEqual([path.join(outputDir, "models.py")]);
  });

  it("fails when output was never generated", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "prisma-sqlmodel-contract-missing-"));
    const input = await testInput(outputDir);

    await expect(checkSqlModelGeneration(input)).rejects.toThrow(
      `Generated output is stale or missing: ${path.join(outputDir, "models.py")}`
    );
  });

  it("fails when the generated module is stale", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "prisma-sqlmodel-contract-stale-"));
    const input = await testInput(outputDir);
    await generateSqlModel(input);
    await writeFile(path.join(outputDir, "models.py"), "# stale\n");

    await expect(checkSqlModelGeneration(input)).rejects.toThrow(
      `Generated output is stale or missing: ${path.join(outputDir, "models.py")}`
    );
  });

  it("fails when the init file is stale", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "prisma-sqlmodel-contract-staleinit-"));
    const input = await testInput(outputDir, { config: { emitInit: true } });
    await generateSqlModel(input);
    await writeFile(path.join(outputDir, "__init__.py"), "# stale\n");

    await expect(checkSqlModelGeneration(input)).rejects.toThrow(
      `Generated output is stale or missing: ${path.join(outputDir, "__init__.py")}`
    );
  });
});
