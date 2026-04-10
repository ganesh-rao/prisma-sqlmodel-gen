import { getSchema, type Block, type PrismaParser } from "@mrleebo/prisma-ast";
import { PrismaParser as PrismaAstParser } from "@mrleebo/prisma-ast";
import type { ConstraintDefinition, SupportedProvider } from "./types.js";
import { normalizeStringLiteral } from "./utils.js";

type SourceLocation = {
  line: number;
  column: number;
};

type ModelMetadata = {
  tableName: string;
  constraints: ConstraintDefinition[];
  fieldConstraintNames: Map<string, string>;
  fieldLocations: Map<string, SourceLocation>;
};

export type AstMetadata = {
  provider: SupportedProvider;
  models: Map<string, ModelMetadata>;
  modelLocations: Map<string, SourceLocation>;
  fieldLocations: Map<string, Map<string, SourceLocation>>;
};

export function extractAstMetadata(datamodel: string, dmmf: any): AstMetadata {
  const schema = getSchema(datamodel, {
    parser: new PrismaAstParser({ nodeLocationTracking: "full" }) as PrismaParser
  } as any);
  const provider = extractProvider(schema);
  const scannedLocations = scanSourceLocations(datamodel);
  const astModels = new Map<string, ModelMetadata>();
  const modelLocations = new Map<string, SourceLocation>();
  const fieldLocations = new Map<string, Map<string, SourceLocation>>();

  for (const model of dmmf.datamodel.models) {
    const block = findModelBlock(schema, model.name);
    const scannedModelLocation = scannedLocations.models.get(model.name);
    const scannedFieldLocations = scannedLocations.fields.get(model.name) ?? new Map<string, SourceLocation>();

    astModels.set(model.name, {
      tableName: findModelTableName(block) ?? model.dbName ?? model.name,
      constraints: block ? extractModelConstraints(block) : [],
      fieldConstraintNames: block ? extractFieldConstraintNames(block) : new Map(),
      fieldLocations: scannedFieldLocations
    });

    if (scannedModelLocation) {
      modelLocations.set(model.name, scannedModelLocation);
    }
    fieldLocations.set(model.name, scannedFieldLocations);
  }

  return {
    provider,
    models: astModels,
    modelLocations,
    fieldLocations
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
  const datasource = schema.list.find(
    (entry): entry is Extract<Block, { type: "datasource" }> => entry.type === "datasource"
  );
  const providerAssignment = datasource?.assignments.find(
    (assignment): assignment is Extract<typeof datasource.assignments[number], { type: "assignment" }> =>
      assignment.type === "assignment" && assignment.key === "provider"
  );
  const provider = normalizeStringLiteral(providerAssignment?.value);

  if (provider === "postgresql" || provider === "mysql") {
    return provider;
  }

  throw new Error(
    `Unsupported Prisma datasource provider${provider ? ` '${provider}'` : ""}. Supported providers are 'postgresql' and 'mysql'.`
  );
}

function findModelTableName(block?: Extract<Block, { type: "model" }>): string | undefined {
  const mapAttribute = block?.properties.find(
    (property) => property.type === "attribute" && property.kind === "object" && property.name === "map"
  );
  const mapValue = mapAttribute && "args" in mapAttribute ? mapAttribute.args?.[0]?.value : undefined;
  return normalizeStringLiteral(mapValue);
}

function extractModelConstraints(block: Extract<Block, { type: "model" }>): ConstraintDefinition[] {
  const constraints: ConstraintDefinition[] = [];

  for (const property of block.properties) {
    if (property.type !== "attribute" || property.kind !== "object") {
      continue;
    }

    if (property.name !== "id" && property.name !== "unique" && property.name !== "index") {
      continue;
    }

    const fieldsArg = property.args?.find((arg) => !isKeyValueAttributeArgument(arg.value));
    if (!fieldsArg || !isArrayValue(fieldsArg.value)) {
      continue;
    }

    const fields = fieldsArg.value.args.flatMap((value) => (typeof value === "string" ? [value] : []));
    constraints.push({
      kind: property.name === "id" ? "primary_key" : property.name,
      fields,
      name: extractConstraintName(property)
    });
  }

  return constraints;
}

function extractFieldConstraintNames(block: Extract<Block, { type: "model" }>): Map<string, string> {
  const names = new Map<string, string>();

  for (const property of block.properties) {
    if (property.type !== "field") {
      continue;
    }

    for (const attribute of property.attributes ?? []) {
      if (attribute.type !== "attribute" || attribute.kind !== "field" || attribute.name !== "unique") {
        continue;
      }

      const name = extractConstraintName(attribute);
      if (name) {
        names.set(property.name, name);
      }
    }
  }

  return names;
}

function extractConstraintName(attribute: { args?: Array<{ value: unknown }> }): string | undefined {
  const namedArg = attribute.args?.find(
    (arg: { value: unknown }) =>
      isKeyValueAttributeArgument(arg.value) && (arg.value.key === "map" || arg.value.key === "name")
  );
  return namedArg && isKeyValueAttributeArgument(namedArg.value)
    ? normalizeStringLiteral(namedArg.value.value)
    : undefined;
}

function isKeyValueAttributeArgument(value: unknown): value is { type: "keyValue"; key: string; value: unknown } {
  return typeof value === "object" && value !== null && "type" in value && value.type === "keyValue";
}

function isArrayValue(value: unknown): value is { type: "array"; args: unknown[] } {
  return typeof value === "object" && value !== null && "type" in value && value.type === "array";
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
