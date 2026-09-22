import { createHash } from "node:crypto";
import path from "node:path";
import { parseContractDocument, type ContractDocument } from "./contract.js";
import { DiagnosticError } from "./diagnostics.js";
import { ensureInitFile, writeManagedFile, checkManagedFile } from "./fs.js";
import { buildSchemaDefinitionFromContract } from "./normalize-contract.js";
import { renderPythonModule } from "./render-python.js";
import type {
  ContractGeneratorInput,
  Diagnostic,
  GenerateResult,
  SchemaDefinition
} from "./types.js";
import { PACKAGE_VERSION } from "./version.js";

export async function generateSqlModel(input: ContractGeneratorInput): Promise<GenerateResult> {
  const { diagnostics, renderedModule } = analyzeContractInput(input);
  const modulePath = getModulePath(input);
  await writeManagedFile(modulePath, renderedModule);
  const files = [modulePath];

  if (input.config.emitInit) {
    files.push(await ensureInitFile(input.outputDir, input.config.moduleName));
  }

  return {
    files,
    diagnostics
  };
}

export async function checkSqlModelGeneration(
  input: ContractGeneratorInput
): Promise<GenerateResult> {
  const { diagnostics, renderedModule } = analyzeContractInput(input);
  const modulePath = getModulePath(input);
  const matches = await checkManagedFile(modulePath, renderedModule);
  if (!matches) {
    throw new Error(`Generated output is stale or missing: ${modulePath}`);
  }

  if (input.config.emitInit) {
    const initPath = path.join(input.outputDir, "__init__.py");
    const initMatches = await checkManagedFile(initPath, renderInitFile(input.config.moduleName));
    if (!initMatches) {
      throw new Error(`Generated output is stale or missing: ${initPath}`);
    }
  }

  return {
    files: [modulePath],
    diagnostics
  };
}

function createSchemaHash(definition: SchemaDefinition): string {
  return createHash("sha256").update(stableStringify(definition)).digest("hex").slice(0, 12);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right)
    );
    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function analyzeContractInput(input: ContractGeneratorInput): {
  diagnostics: Diagnostic[];
  definition: SchemaDefinition;
  renderedModule: string;
} {
  const parsed = parseContractDocument(input.contractText);
  assertNoErrorDiagnostics(parsed.diagnostics);
  // parseContractDocument returns a document whenever diagnostics hold no errors.
  const built = buildSchemaDefinitionFromContract(
    parsed.document as ContractDocument,
    input.config.strict
  );
  const diagnostics = [...parsed.diagnostics, ...built.diagnostics];
  assertNoErrorDiagnostics(diagnostics);

  return {
    diagnostics,
    definition: built.definition,
    renderedModule: renderManagedModule(input, built.definition)
  };
}

function assertNoErrorDiagnostics(diagnostics: Diagnostic[]): void {
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new DiagnosticError("Schema contains unsupported constructs.", diagnostics);
  }
}

function renderManagedModule(
  input: Pick<ContractGeneratorInput, "config">,
  definition: SchemaDefinition
): string {
  return renderPythonModule(definition, {
    moduleName: input.config.moduleName,
    headerComment: input.config.headerComment,
    schemaHash: createSchemaHash(definition),
    packageVersion: PACKAGE_VERSION
  });
}

function getModulePath(input: Pick<ContractGeneratorInput, "config" | "outputDir">): string {
  return path.join(input.outputDir, input.config.moduleName);
}

function renderInitFile(moduleName: string): string {
  return `from .${moduleName.replace(/\.py$/, "")} import *\n`;
}
