import type {
  ConstraintDefinition,
  EnumDefinition,
  ModelDefinition,
  NativeType,
  RelationFieldDefinition,
  ScalarFieldDefinition,
  SchemaDefinition
} from "./types.js";
import type { AstMetadata } from "./prisma-ast.js";
import { toPythonIdentifier } from "./utils.js";

export function buildSchemaDefinition(dmmf: any, metadata: AstMetadata): SchemaDefinition {
  const models = [...dmmf.datamodel.models].map((model: any) =>
    buildModelDefinition(model, dmmf, metadata)
  );
  const enums = dmmf.datamodel.enums.map((entry: any): EnumDefinition => ({
    name: entry.name,
    pythonName: toPythonIdentifier(entry.name),
    values: entry.values.map((value: any) => ({
      name: value.name,
      pythonName: toPythonIdentifier(value.name).toUpperCase(),
      value: value.dbName ?? value.name
    }))
  }));

  return {
    provider: metadata.provider,
    enums,
    models
  };
}

function buildModelDefinition(
  model: any,
  dmmf: any,
  metadata: AstMetadata
): ModelDefinition {
  const modelMetadata = metadata.models.get(model.name);
  const constraints = [...(modelMetadata?.constraints ?? [])];
  const scalarFields: ScalarFieldDefinition[] = [];
  const relationFields: RelationFieldDefinition[] = [];

  for (const field of model.fields) {
    if (field.kind === "object") {
      relationFields.push(buildRelationFieldDefinition(model, field, dmmf.datamodel.models));
      continue;
    }

    if (field.kind !== "scalar" && field.kind !== "enum") {
      continue;
    }

    const namedUnique = getNamedUniqueConstraint(modelMetadata, field.name);
    if (field.isUnique && namedUnique) {
      constraints.push({
        kind: "unique",
        fields: [field.name],
        name: namedUnique
      });
    }

    scalarFields.push({
      kind: "scalar",
      name: field.name,
      pythonName: toPythonIdentifier(field.name),
      columnName: field.dbName ?? field.name,
      prismaType: field.type,
      pythonType: field.kind === "enum" ? field.type : scalarTypeToPython(field.type),
      isList: field.isList,
      isNullable: !field.isRequired,
      isId: isFieldPartOfPrimaryKey(model, field.name, modelMetadata?.constraints ?? []),
      isUnique: field.isUnique && !namedUnique,
      hasDefaultValue: field.hasDefaultValue,
      defaultValue: field.default,
      isUpdatedAt: Boolean(field.isUpdatedAt),
      nativeType: extractNativeType(field.nativeType),
      foreignKey: extractForeignKey(model, field.name)
    });
  }

  return {
    name: model.name,
    pythonName: toPythonIdentifier(model.name),
    tableName: modelMetadata?.tableName ?? model.dbName ?? model.name,
    scalarFields,
    relationFields,
    constraints: dedupeConstraints(constraints)
  };
}

function buildRelationFieldDefinition(
  model: any,
  field: any,
  allModels: any[]
): RelationFieldDefinition {
  const targetModel = allModels.find((candidate) => candidate.name === field.type);
  const relationFromFields = Array.isArray(field.relationFromFields) ? field.relationFromFields : [];
  const relationToFields = Array.isArray(field.relationToFields) ? field.relationToFields : [];
  const backRelation = findBackRelation(model.name, field, targetModel?.fields ?? []);

  return {
    kind: "relation",
    name: field.name,
    pythonName: toPythonIdentifier(field.name),
    targetModel: field.type,
    isList: field.isList,
    isNullable: !field.isRequired,
    relationName: field.relationName ?? `${model.name}_${field.name}`,
    relationFromFields: [...relationFromFields],
    relationToFields: [...relationToFields],
    backPopulates: backRelation?.name ?? inferBackPopulatesName(model.name, field.name),
    foreignKeyFieldNames: [...relationFromFields]
  };
}

function extractForeignKey(model: any, scalarFieldName: string): ScalarFieldDefinition["foreignKey"] {
  const relationField = model.fields.find(
    (field: any) => {
      const relationFromFields = getRelationFieldNames(field.relationFromFields);
      const relationToFields = getRelationFieldNames(field.relationToFields);
      return (
        field.kind === "object" &&
        relationFromFields.includes(scalarFieldName) &&
        relationToFields.length === relationFromFields.length
      );
    }
  );

  if (!relationField) {
    return undefined;
  }

  const index = relationField.relationFromFields.indexOf(scalarFieldName);
  const targetField = relationField.relationToFields?.[index];
  if (!targetField) {
    return undefined;
  }

  return {
    targetModel: relationField.type,
    targetField
  };
}

function isFieldPartOfPrimaryKey(
  model: any,
  fieldName: string,
  constraints: ConstraintDefinition[]
): boolean {
  if (model.fields.some((field: any) => field.name === fieldName && field.isId)) {
    return true;
  }

  return constraints.some(
    (constraint) => constraint.kind === "primary_key" && constraint.fields.includes(fieldName)
  );
}

function getNamedUniqueConstraint(
  modelMetadata: AstMetadata["models"] extends Map<string, infer T> ? T | undefined : never,
  fieldName: string
): string | undefined {
  return modelMetadata?.fieldConstraintNames.get(fieldName);
}

function findBackRelation(modelName: string, field: any, targetFields: any[]): any | undefined {
  return (
    targetFields.find(
      (candidate: any) =>
        candidate.kind === "object" &&
        candidate.type === modelName &&
        candidate.relationName === field.relationName &&
        candidate.name !== field.name
    ) ??
    targetFields.find(
      (candidate: any) =>
        candidate.kind === "object" &&
        candidate.type === modelName &&
        candidate.relationName === field.relationName
    )
  );
}

function getRelationFieldNames(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function extractNativeType(nativeType: unknown): NativeType | undefined {
  if (!Array.isArray(nativeType) || nativeType.length < 1) {
    return undefined;
  }

  const [name, args] = nativeType;
  return {
    name: String(name),
    args: Array.isArray(args) ? args.map(String) : []
  };
}

function scalarTypeToPython(type: string): string {
  switch (type) {
    case "String":
      return "str";
    case "Boolean":
      return "bool";
    case "Int":
    case "BigInt":
      return "int";
    case "Float":
      return "float";
    case "Decimal":
      return "Decimal";
    case "Bytes":
      return "bytes";
    case "DateTime":
      return "datetime";
    case "Json":
      return "Any";
    default:
      return type;
  }
}

function inferBackPopulatesName(modelName: string, fieldName: string): string {
  const lowerModel = modelName[0].toLowerCase() + modelName.slice(1);
  return fieldName === lowerModel ? `${lowerModel}s` : lowerModel;
}

function dedupeConstraints(constraints: ConstraintDefinition[]): ConstraintDefinition[] {
  const seen = new Set<string>();
  return constraints.filter((constraint) => {
    const key = `${constraint.kind}:${constraint.name ?? ""}:${constraint.fields.join(",")}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
