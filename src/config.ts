import path from "node:path";
import type { GeneratorOptions } from "@prisma/generator";
import type { GeneratorConfig } from "./types.js";

export function resolveGeneratorConfig(
  generator?: GeneratorOptions["generator"],
  overrides?: Partial<GeneratorConfig>
): GeneratorConfig {
  const raw = generator?.config ?? {};
  const moduleName = overrides?.moduleName ?? firstString(raw.moduleName) ?? "models.py";
  const emitInit = overrides?.emitInit ?? parseBoolean(firstString(raw.emitInit), true);
  const strict = overrides?.strict ?? parseBoolean(firstString(raw.strict), true);
  const headerComment =
    overrides?.headerComment ?? parseBoolean(firstString(raw.headerComment), true);
  const packageName =
    overrides?.packageName ??
    firstString(raw.packageName) ??
    derivePackageName(generator?.output?.value ?? undefined);
  const sqlmodelImportStyle = parseImportStyle(firstString(raw.sqlmodelImportStyle));

  return {
    moduleName: moduleName.endsWith(".py") ? moduleName : `${moduleName}.py`,
    emitInit,
    strict,
    headerComment,
    packageName,
    sqlmodelImportStyle
  };
}

export function resolveOutputDir(
  schemaPath: string,
  generator?: GeneratorOptions["generator"],
  explicitOutput?: string
): string {
  if (explicitOutput) {
    return path.resolve(explicitOutput);
  }

  const outputValue = generator?.output?.value;
  if (!outputValue) {
    throw new Error("Generator output is required. Set `output` in the Prisma generator block.");
  }

  return path.resolve(path.dirname(schemaPath), outputValue);
}

function firstString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return fallback;
}

function parseImportStyle(value: string | undefined): "sqlmodel" {
  if (!value || value === "sqlmodel") {
    return "sqlmodel";
  }

  throw new Error(
    `Unsupported sqlmodelImportStyle '${value}'. The only supported style is 'sqlmodel'.`
  );
}

function derivePackageName(outputValue: string | undefined): string | undefined {
  if (!outputValue) {
    return undefined;
  }

  const normalized = path.basename(outputValue).trim();
  return normalized.length > 0 ? normalized : undefined;
}
