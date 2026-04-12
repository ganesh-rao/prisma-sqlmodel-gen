import type { AstMetadata } from "./prisma-ast.js";
import type { Diagnostic, SupportedProvider } from "./types.js";
import { toPythonIdentifier } from "./utils.js";

const SUPPORTED_PROVIDERS = new Set<SupportedProvider>(["postgresql", "mysql"]);

export function collectCompatibilityDiagnostics(
  dmmf: any,
  metadata: AstMetadata,
  strict: boolean
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const provider = metadata.provider;
  const indexes = dmmf.datamodel.indexes ?? [];

  if (!SUPPORTED_PROVIDERS.has(provider)) {
    diagnostics.push({
      code: "UNSUPPORTED_PROVIDER",
      severity: "error",
      message: `Unsupported datasource provider '${provider}'.`,
      suggestion: "Use a Prisma datasource provider of 'postgresql' or 'mysql'."
    });
  }

  if (metadata.relationMode && metadata.relationMode !== "foreignKeys") {
    diagnostics.push({
      code: "UNSUPPORTED_RELATION_MODE_PRISMA",
      severity: "error",
      message: `Datasource relationMode '${metadata.relationMode}' is Prisma-client-only behavior and cannot be emitted 1:1 via SQLModel.`,
      suggestion: "Use relationMode = \"foreignKeys\" or remove the relationMode setting."
    });
  }

  diagnostics.push(...(metadata.unsupportedDiagnostics ?? []));

  validateTypeNameCollisions(dmmf, diagnostics);

  for (const [modelName, modelMetadata] of metadata.models.entries()) {
    if (modelMetadata.ignored) {
      diagnostics.push({
        code: "UNSUPPORTED_IGNORE",
        severity: "error",
        model: modelName,
        location: metadata.modelLocations.get(modelName),
        message: "@@ignore is Prisma-client-only behavior and is not emitted in generated SQLModel table models.",
        suggestion: "Remove @@ignore or exclude the model from SQLModel generation another way."
      });
    }

    for (const fieldName of modelMetadata.ignoredFields) {
      diagnostics.push({
        code: "UNSUPPORTED_IGNORE",
        severity: "error",
        model: modelName,
        field: fieldName,
        location: metadata.fieldLocations.get(modelName)?.get(fieldName),
        message: "@ignore is Prisma-client-only behavior and is not emitted in generated SQLModel table models.",
        suggestion: "Remove @ignore or exclude the field from generation another way."
      });
    }
  }

  for (const model of dmmf.datamodel.models) {
    const modelMetadata = metadata.models.get(model.name);
    if (!modelMetadata) {
      continue;
    }

    validateFieldNameCollisions(model, diagnostics, metadata);
    validateAdvancedIndexSupport(model.name, indexes, diagnostics, metadata);

    const compositePrimaryKey = indexes.find(
      (constraint: any) => constraint.model === model.name && constraint.type === "id"
    );

    for (const field of model.fields) {
      if (field.kind === "scalar" || field.kind === "enum") {
        validateScalarLikeField(provider, model.name, field, diagnostics, metadata);
      }
      if (isImplicitRelationField(field)) {
        const targetModel = dmmf.datamodel.models.find((candidate: any) => candidate.name === field.type);
        const hasJoinModel = Boolean(
          targetModel?.fields.some(
            (candidate: any) =>
              candidate.kind === "object" &&
              candidate.type === model.name &&
              getRelationFieldCount(candidate.relationFromFields) > 0
          )
        );

        if (!hasJoinModel && field.isList) {
          const backRelation = targetModel?.fields.find(
            (candidate: any) =>
              candidate.kind === "object" &&
              candidate.type === model.name &&
              candidate.relationName === field.relationName
          );
          const modelPkCount = countPrimaryKeyFields(model, indexes);
          const targetPkCount = targetModel ? countPrimaryKeyFields(targetModel, indexes) : 0;
          if (field.type === model.name) {
            diagnostics.push({
              code: "UNSUPPORTED_IMPLICIT_M2M_SHAPE",
              severity: "error",
              model: model.name,
              field: field.name,
              location: metadata.fieldLocations.get(model.name)?.get(field.name),
              message: "Self implicit many-to-many relations are not emitted deterministically in SQLModel output.",
              suggestion: "Define an explicit join model for the self relation."
            });
            continue;
          }
          if (!backRelation?.isList || modelPkCount !== 1 || targetPkCount !== 1) {
            diagnostics.push({
              code: "UNSUPPORTED_IMPLICIT_M2M_SHAPE",
              severity: "error",
              model: model.name,
              field: field.name,
              location: metadata.fieldLocations.get(model.name)?.get(field.name),
              message: "This implicit many-to-many relation shape cannot be emitted 1:1 in SQLModel output.",
              suggestion: "Use an explicit join model with concrete foreign keys."
            });
            continue;
          }
        }

      }
    }

    if (!strict) {
      continue;
    }

    if (compositePrimaryKey && compositePrimaryKey.fields.length > 1) {
      const defaulted = compositePrimaryKey.fields.some((entry: any) => {
        const field = model.fields.find((candidate: any) => candidate.name === entry.name);
        return field?.hasDefaultValue;
      });

      if (defaulted) {
        diagnostics.push({
          code: "UNSUPPORTED_COMPOSITE_PK_DEFAULT",
          severity: "error",
          model: model.name,
          location: metadata.modelLocations.get(model.name),
          message: "Composite primary keys with generated defaults are not supported.",
          suggestion: "Remove generated defaults from composite primary key fields or use a single-column primary key."
        });
      }
    }
  }

  return diagnostics;
}

function validateAdvancedIndexSupport(
  modelName: string,
  indexes: any[],
  diagnostics: Diagnostic[],
  metadata: AstMetadata
): void {
  for (const entry of indexes) {
    if (entry.model !== modelName) {
      continue;
    }

    if (
      typeof entry.algorithm === "string" &&
      entry.algorithm.length > 0 &&
      !isSupportedIndexAlgorithm(metadata.provider, entry.algorithm)
    ) {
      diagnostics.push({
        code: "UNSUPPORTED_ADVANCED_INDEX",
        severity: "error",
        model: modelName,
        location: metadata.modelLocations.get(modelName),
        message: `Prisma index algorithm '${entry.algorithm}' does not map 1:1 to generated SQLModel metadata.`,
        suggestion: "Use Prisma's default index behavior or manage the advanced index manually in migrations."
      });
    }

    for (const field of entry.fields ?? []) {
      if (typeof field.operatorClass === "string" && field.operatorClass.length > 0) {
        diagnostics.push({
          code: "UNSUPPORTED_ADVANCED_INDEX",
          severity: "error",
          model: modelName,
          field: field.name,
          location: metadata.fieldLocations.get(modelName)?.get(field.name) ?? metadata.modelLocations.get(modelName),
          message: `Prisma operator class '${field.operatorClass}' does not map 1:1 to generated SQLModel metadata.`,
          suggestion: "Use plain field indexes in generated models and manage operator classes manually in migrations."
        });
      }
    }
  }
}

const SUPPORTED_POSTGRES_INDEX_ALGORITHMS = new Set(["btree", "brin", "gin", "hash", "spgist"]);

function isSupportedIndexAlgorithm(provider: SupportedProvider, algorithm: string): boolean {
  return provider === "postgresql" && SUPPORTED_POSTGRES_INDEX_ALGORITHMS.has(algorithm.toLowerCase());
}

function validateScalarLikeField(
  provider: SupportedProvider,
  modelName: string,
  field: any,
  diagnostics: Diagnostic[],
  metadata: AstMetadata
): void {
  if (field.kind === "enum" && field.isList && provider !== "postgresql") {
    diagnostics.push({
      code: "UNSUPPORTED_ENUM_LIST",
      severity: "error",
      model: modelName,
      field: field.name,
      location: metadata.fieldLocations.get(modelName)?.get(field.name),
      message: "Enum list fields are only supported for PostgreSQL.",
      suggestion: "Use PostgreSQL for enum lists or remodel the field as a separate table."
    });
  }

  if (field.kind === "scalar" && field.type === "Unsupported") {
    diagnostics.push({
      code: "UNSUPPORTED_SCALAR_TYPE",
      severity: "error",
      model: modelName,
      field: field.name,
      location: metadata.fieldLocations.get(modelName)?.get(field.name),
      message: "Prisma Unsupported fields cannot be emitted as SQLModel types.",
      suggestion: "Replace the Unsupported field with a supported native Prisma scalar or exclude the field from generated models."
    });
  }

  if (field.isList && provider !== "postgresql") {
    diagnostics.push({
      code: "UNSUPPORTED_LIST_FIELD",
      severity: "error",
      model: modelName,
      field: field.name,
      location: metadata.fieldLocations.get(modelName)?.get(field.name),
      message: "Scalar list fields are only supported for PostgreSQL.",
      suggestion: "Move the datasource to PostgreSQL or remodel the list as a child table."
    });
  }

  if (field.hasDefaultValue && typeof field.default === "object" && field.default !== null && "name" in field.default) {
    const name = typeof field.default.name === "string" ? field.default.name : "";
    if (name === "cuid" || name === "ulid" || name === "nanoid") {
      diagnostics.push({
        code: "UNSUPPORTED_CLIENT_SIDE_DEFAULT",
        severity: "error",
        model: modelName,
        field: field.name,
        location: metadata.fieldLocations.get(modelName)?.get(field.name),
        message: `Prisma ${name}() defaults do not have a built-in SQLModel/Python equivalent in strict mode.`,
        suggestion: "Use uuid() or dbgenerated(...) if the database should own ID generation, or remove the default from generated SQLModel output."
      });
    }
  }
}

function isImplicitRelationField(field: any): boolean {
  return (
    field.kind === "object" &&
    getRelationFieldCount(field.relationFromFields) === 0 &&
    getRelationFieldCount(field.relationToFields) === 0
  );
}

function getRelationFieldCount(fields: unknown): number {
  return Array.isArray(fields) ? fields.length : 0;
}

function countPrimaryKeyFields(model: any, indexes: any[]): number {
  const idIndex = indexes.find((entry: any) => entry.model === model.name && entry.type === "id");
  if (idIndex) {
    return idIndex.fields.length;
  }
  return model.fields.filter((field: any) => field.isId).length;
}

function validateTypeNameCollisions(dmmf: any, diagnostics: Diagnostic[]): void {
  const seen = new Map<string, { kind: string; name: string }>();

  for (const model of dmmf.datamodel.models) {
    const pythonName = toPythonIdentifier(model.name);
    const existing = seen.get(pythonName);
    if (existing) {
      diagnostics.push({
        code: "PYTHON_TYPE_NAME_COLLISION",
        severity: "error",
        model: model.name,
        message: `Model '${model.name}' collides with ${existing.kind} '${existing.name}' after Python name sanitization.`,
        suggestion: "Rename one of the Prisma models or enums so their generated Python type names are unique."
      });
      continue;
    }
    seen.set(pythonName, { kind: "model", name: model.name });
  }

  for (const entry of dmmf.datamodel.enums) {
    const pythonName = toPythonIdentifier(entry.name);
    const existing = seen.get(pythonName);
    if (existing) {
      diagnostics.push({
        code: "PYTHON_TYPE_NAME_COLLISION",
        severity: "error",
        model: entry.name,
        message: `Enum '${entry.name}' collides with ${existing.kind} '${existing.name}' after Python name sanitization.`,
        suggestion: "Rename one of the Prisma models or enums so their generated Python type names are unique."
      });
      continue;
    }
    seen.set(pythonName, { kind: "enum", name: entry.name });

    const enumValueSeen = new Set<string>();
    for (const value of entry.values) {
      const pythonValueName = toPythonIdentifier(value.name).toUpperCase();
      if (enumValueSeen.has(pythonValueName)) {
        diagnostics.push({
          code: "PYTHON_ENUM_VALUE_COLLISION",
          severity: "error",
          model: entry.name,
          field: value.name,
          message: `Enum value '${value.name}' collides with another enum value after Python name sanitization.`,
          suggestion: "Rename enum values so their generated Python enum members are unique."
        });
      }
      enumValueSeen.add(pythonValueName);
    }
  }
}

function validateFieldNameCollisions(model: any, diagnostics: Diagnostic[], metadata: AstMetadata): void {
  const seen = new Map<string, string>();

  for (const field of model.fields) {
    const pythonName = toPythonIdentifier(field.name);
    const existing = seen.get(pythonName);
    if (existing) {
      diagnostics.push({
        code: "PYTHON_FIELD_NAME_COLLISION",
        severity: "error",
        model: model.name,
        field: field.name,
        location: metadata.fieldLocations.get(model.name)?.get(field.name),
        message: `Field '${field.name}' collides with '${existing}' after Python name sanitization.`,
        suggestion: "Rename one of the Prisma fields so the generated Python attribute names are unique."
      });
      continue;
    }

    seen.set(pythonName, field.name);
  }
}
