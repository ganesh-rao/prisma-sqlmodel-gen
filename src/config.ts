import type { GeneratorConfig } from "./types.js";

export function resolveGeneratorConfig(overrides?: Partial<GeneratorConfig>): GeneratorConfig {
  const moduleName = overrides?.moduleName ?? "models.py";
  return {
    moduleName: moduleName.endsWith(".py") ? moduleName : `${moduleName}.py`,
    emitInit: overrides?.emitInit ?? true,
    strict: overrides?.strict ?? true,
    headerComment: overrides?.headerComment ?? true,
    packageName: overrides?.packageName,
    sqlmodelImportStyle: parseImportStyle(overrides?.sqlmodelImportStyle)
  };
}

function parseImportStyle(value: string | undefined): "sqlmodel" {
  if (!value || value === "sqlmodel") {
    return "sqlmodel";
  }

  throw new Error(
    `Unsupported sqlmodelImportStyle '${value}'. The only supported style is 'sqlmodel'.`
  );
}
