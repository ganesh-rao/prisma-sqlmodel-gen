import { getSchema, type Block, type PrismaParser } from "@mrleebo/prisma-ast";
import { PrismaParser as PrismaAstParser } from "@mrleebo/prisma-ast";
import type { Diagnostic, SupportedProvider } from "./types.js";
import { normalizeStringLiteral } from "./utils.js";

type SourceLocation = {
  line: number;
  column: number;
};

type RelationMetadata = {
  map?: string;
};

type ModelMetadata = {
  tableName: string;
  tableSchema?: string;
  ignored: boolean;
  fieldLocations: Map<string, SourceLocation>;
  ignoredFields: Set<string>;
  relationFields: Map<string, RelationMetadata>;
};

export type AstMetadata = {
  provider: SupportedProvider;
  relationMode?: string;
  models: Map<string, ModelMetadata>;
  modelLocations: Map<string, SourceLocation>;
  fieldLocations: Map<string, Map<string, SourceLocation>>;
  unsupportedDiagnostics: Diagnostic[];
};

export function extractAstMetadata(datamodel: string, dmmf: any): AstMetadata {
  const schema = getSchema(datamodel, {
    parser: new PrismaAstParser({ nodeLocationTracking: "full" }) as PrismaParser
  } as any);
  const provider = extractProvider(schema);
  const relationMode = extractDatasourceSetting(schema, "relationMode");
  const scannedLocations = scanSourceLocations(datamodel);
  const astModels = new Map<string, ModelMetadata>();
  const modelLocations = new Map<string, SourceLocation>();
  const fieldLocations = new Map<string, Map<string, SourceLocation>>();
  const unsupportedDiagnostics: Diagnostic[] = [];

  const dmmfModelByName = new Map<string, any>(dmmf.datamodel.models.map((model: any) => [model.name, model]));
  const modelNames = new Set<string>([
    ...dmmf.datamodel.models.map((model: any) => model.name),
    ...schema.list
      .filter((entry): entry is Extract<Block, { type: "model" }> => entry.type === "model")
      .map((entry) => entry.name)
  ]);

  for (const modelName of modelNames) {
    const model = dmmfModelByName.get(modelName);
    const block = findModelBlock(schema, modelName);
    const scannedModelLocation = scannedLocations.models.get(modelName);
    const scannedFieldLocations = scannedLocations.fields.get(modelName) ?? new Map<string, SourceLocation>();

    astModels.set(modelName, {
      tableName: findModelTableName(block) ?? model?.dbName ?? modelName,
      tableSchema: findModelSchema(block) ?? model?.schema ?? undefined,
      ignored: hasModelAttribute(block, "ignore"),
      fieldLocations: scannedFieldLocations,
      ignoredFields: extractIgnoredFields(block),
      relationFields: extractRelationFieldMetadata(block)
    });
    unsupportedDiagnostics.push(...extractUnsupportedIndexDiagnostics(block, modelName, scannedModelLocation, scannedFieldLocations));

    if (scannedModelLocation) {
      modelLocations.set(modelName, scannedModelLocation);
    }
    fieldLocations.set(modelName, scannedFieldLocations);
  }

  return {
    provider,
    relationMode,
    models: astModels,
    modelLocations,
    fieldLocations,
    unsupportedDiagnostics
  };
}

function findModelBlock(
  schema: ReturnType<typeof getSchema>,
  modelName: string
): Extract<Block, { type: "model" }> | undefined {
  return schema.list.find(
    (entry): entry is Extract<Block, { type: "model" }> => entry.type === "model" && entry.name === modelName
  );
}

function extractProvider(schema: ReturnType<typeof getSchema>): SupportedProvider {
  const provider = extractDatasourceSetting(schema, "provider");

  if (provider === "postgresql" || provider === "mysql") {
    return provider;
  }

  throw new Error(
    `Unsupported Prisma datasource provider${provider ? ` '${provider}'` : ""}. Supported providers are 'postgresql' and 'mysql'.`
  );
}

function extractDatasourceSetting(
  schema: ReturnType<typeof getSchema>,
  key: string
): string | undefined {
  const datasource = schema.list.find(
    (entry): entry is Extract<Block, { type: "datasource" }> => entry.type === "datasource"
  );
  const assignment = datasource?.assignments.find(
    (candidate): candidate is Extract<typeof datasource.assignments[number], { type: "assignment" }> =>
      candidate.type === "assignment" && candidate.key === key
  );
  return normalizeStringLiteral(assignment?.value);
}

function findModelTableName(block?: Extract<Block, { type: "model" }>): string | undefined {
  return extractModelAttributeString(block, "map");
}

function findModelSchema(block?: Extract<Block, { type: "model" }>): string | undefined {
  return extractModelAttributeString(block, "schema");
}

function extractModelAttributeString(
  block: Extract<Block, { type: "model" }> | undefined,
  attributeName: string
): string | undefined {
  const attribute = block?.properties.find(
    (property) => property.type === "attribute" && property.kind === "object" && property.name === attributeName
  );
  const value = attribute && "args" in attribute ? attribute.args?.[0]?.value : undefined;
  return normalizeStringLiteral(value);
}

function hasModelAttribute(block: Extract<Block, { type: "model" }> | undefined, attributeName: string): boolean {
  return Boolean(
    block?.properties.find(
      (property) => property.type === "attribute" && property.kind === "object" && property.name === attributeName
    )
  );
}

function extractIgnoredFields(block: Extract<Block, { type: "model" }> | undefined): Set<string> {
  const ignored = new Set<string>();
  for (const property of block?.properties ?? []) {
    if (property.type !== "field") {
      continue;
    }

    if (property.attributes?.some((attribute) => attribute.type === "attribute" && attribute.name === "ignore")) {
      ignored.add(property.name);
    }
  }

  return ignored;
}

function extractRelationFieldMetadata(
  block: Extract<Block, { type: "model" }> | undefined
): Map<string, RelationMetadata> {
  const metadata = new Map<string, RelationMetadata>();

  for (const property of block?.properties ?? []) {
    if (property.type !== "field") {
      continue;
    }

    const relationAttribute = property.attributes?.find(
      (attribute) => attribute.type === "attribute" && attribute.kind === "field" && attribute.name === "relation"
    );
    if (!relationAttribute) {
      continue;
    }

    const mapArg = relationAttribute.args?.find(
      (arg) =>
        isKeyValueAttributeArgument(arg.value) &&
        arg.value.key === "map"
    );

    metadata.set(property.name, {
      map: mapArg && isKeyValueAttributeArgument(mapArg.value) ? normalizeStringLiteral(mapArg.value.value) : undefined
    });
  }

  return metadata;
}

function extractUnsupportedIndexDiagnostics(
  block: Extract<Block, { type: "model" }> | undefined,
  modelName: string,
  modelLocation: SourceLocation | undefined,
  fieldLocations: Map<string, SourceLocation>
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const property of block?.properties ?? []) {
    if (property.type !== "attribute" || property.kind !== "object") {
      continue;
    }

    if (property.name !== "index" && property.name !== "unique") {
      continue;
    }

    const typeArg = property.args?.find(
      (arg) => isKeyValueAttributeArgument(arg.value) && arg.value.key === "type"
    );
    const typeValue = typeArg?.value;
    const indexType = isKeyValueAttributeArgument(typeValue)
      ? normalizeStringLiteral(typeValue.value) ?? String(typeValue.value)
      : undefined;

    if (indexType) {
      diagnostics.push({
        code: "UNSUPPORTED_ADVANCED_INDEX",
        severity: "error",
        model: modelName,
        location: modelLocation,
        message: `Prisma index type '${indexType}' does not map 1:1 to generated SQLModel metadata in strict mode.`,
        suggestion: "Use Prisma's default index behavior or manage the advanced index manually in migrations."
      });
    }

    const fieldsArg = property.args?.find((arg) => isArrayAttributeArgument(arg.value));
    const fieldEntries = fieldsArg && isArrayAttributeArgument(fieldsArg.value) ? fieldsArg.value.args : [];
    for (const entry of fieldEntries) {
      if (typeof entry === "string") {
        continue;
      }

      if (!isFunctionAttributeArgument(entry)) {
        diagnostics.push({
          code: "UNSUPPORTED_ADVANCED_INDEX",
          severity: "error",
          model: modelName,
          location: modelLocation,
          message: "Non-field index expressions cannot be emitted 1:1 to SQLModel metadata.",
          suggestion: "Use plain field indexes in generated models and keep expression indexes in migrations."
        });
        continue;
      }

      for (const param of entry.params ?? []) {
        if (!isKeyValueAttributeArgument(param)) {
          diagnostics.push({
            code: "UNSUPPORTED_ADVANCED_INDEX",
            severity: "error",
            model: modelName,
            field: entry.name,
            location: fieldLocations.get(entry.name) ?? modelLocation,
            message: "Unsupported index field modifiers cannot be emitted 1:1 to SQLModel metadata.",
            suggestion: "Use only supported sort/length modifiers or manage the advanced index manually in migrations."
          });
          continue;
        }

        if (param.key === "sort" || param.key === "length") {
          continue;
        }

        diagnostics.push({
          code: "UNSUPPORTED_ADVANCED_INDEX",
          severity: "error",
          model: modelName,
          field: entry.name,
          location: fieldLocations.get(entry.name) ?? modelLocation,
          message: `Prisma index field modifier '${param.key}' does not map 1:1 to generated SQLModel metadata.`,
          suggestion: "Use only supported sort/length modifiers or manage the advanced index manually in migrations."
        });
      }
    }
  }

  return diagnostics;
}

function isKeyValueAttributeArgument(value: unknown): value is { type: "keyValue"; key: string; value: unknown } {
  return typeof value === "object" && value !== null && "type" in value && value.type === "keyValue";
}

function isArrayAttributeArgument(value: unknown): value is { type: "array"; args: unknown[] } {
  return typeof value === "object" && value !== null && "type" in value && value.type === "array";
}

function isFunctionAttributeArgument(value: unknown): value is { type: "function"; name: string; params?: unknown[] } {
  return typeof value === "object" && value !== null && "type" in value && value.type === "function";
}

function scanSourceLocations(datamodel: string): {
  models: Map<string, SourceLocation>;
  fields: Map<string, Map<string, SourceLocation>>;
} {
  const models = new Map<string, SourceLocation>();
  const fields = new Map<string, Map<string, SourceLocation>>();
  const lines = datamodel.split(/\r?\n/);
  let activeModel: string | undefined;
  let braceDepth = 0;

  for (const [index, rawLine] of lines.entries()) {
    const lineNumber = index + 1;
    const line = rawLine.trim();

    if (!activeModel) {
      const modelMatch = /^model\s+([A-Za-z][\w-]*)\s*\{/.exec(line);
      if (modelMatch) {
        activeModel = modelMatch[1];
        braceDepth = 1;
        models.set(activeModel, {
          line: lineNumber,
          column: rawLine.indexOf("model") + 1
        });
        fields.set(activeModel, new Map());
      }
      continue;
    }

    braceDepth += countChar(rawLine, "{");
    braceDepth -= countChar(rawLine, "}");

    if (line.length > 0 && !line.startsWith("//") && !line.startsWith("@@") && !line.startsWith("}")) {
      const fieldMatch = /^([A-Za-z][\w-]*)\s+/.exec(line);
      /* v8 ignore next 5 */
      if (fieldMatch) {
        fields.get(activeModel)?.set(fieldMatch[1], {
          line: lineNumber,
          column: rawLine.indexOf(fieldMatch[1]) + 1
        });
      }
    }

    if (braceDepth <= 0) {
      activeModel = undefined;
      braceDepth = 0;
    }
  }

  return { models, fields };
}

function countChar(input: string, char: string): number {
  return [...input].filter((entry) => entry === char).length;
}
