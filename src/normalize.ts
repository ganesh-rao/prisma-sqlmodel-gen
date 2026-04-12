import type {
  ConstraintDefinition,
  ConstraintFieldDefinition,
  EnumDefinition,
  ForeignKeyDefinition,
  ModelDefinition,
  NativeType,
  RelationFieldDefinition,
  ScalarFieldDefinition,
  SchemaDefinition
} from "./types.js";
import type { AstMetadata } from "./prisma-ast.js";
import { toPythonIdentifier } from "./utils.js";

export function buildSchemaDefinition(dmmf: any, metadata: AstMetadata): SchemaDefinition {
  const baseModels = [...dmmf.datamodel.models].map((model: any) => buildModelDefinition(model, dmmf, metadata));
  const implicitLinkModels = buildImplicitManyToManyLinkModels(baseModels);
  const models = [...baseModels, ...implicitLinkModels];
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
    relationMode: metadata.relationMode,
    enums,
    models
  };
}

function buildModelDefinition(model: any, dmmf: any, metadata: AstMetadata): ModelDefinition {
  const indexes = dmmf.datamodel.indexes ?? [];
  const modelMetadata = metadata.models.get(model.name);
  const scalarFields: ScalarFieldDefinition[] = [];
  const relationFields: RelationFieldDefinition[] = [];

  for (const field of model.fields) {
    if (field.kind === "object") {
      relationFields.push(buildRelationFieldDefinition(model, field, dmmf.datamodel.models, metadata));
      continue;
    }

    if (field.kind !== "scalar" && field.kind !== "enum") {
      continue;
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
      isId: isFieldPartOfPrimaryKey(model, field.name, indexes),
      isUnique: isSingleFieldUnique(model.name, field.name, indexes),
      hasDefaultValue: field.hasDefaultValue,
      defaultValue: field.default,
      defaultKind: field.hasDefaultValue ? inferDefaultKind(field.default) : undefined,
      isUpdatedAt: Boolean(field.isUpdatedAt),
      nativeType: extractNativeType(field.nativeType),
      foreignKey: extractForeignKey(model, field.name, metadata)
    });
  }

  return {
    name: model.name,
    pythonName: toPythonIdentifier(model.name),
    tableName: modelMetadata?.tableName ?? model.dbName ?? model.name,
    tableSchema: modelMetadata?.tableSchema,
    isGeneratedLinkModel: false,
    scalarFields,
    relationFields,
    constraints: extractConstraints(model.name, indexes),
    foreignKeys: extractForeignKeys(model, metadata)
  };
}

function buildRelationFieldDefinition(
  model: any,
  field: any,
  allModels: any[],
  metadata: AstMetadata
): RelationFieldDefinition {
  const targetModel = allModels.find((candidate) => candidate.name === field.type);
  const relationFromFields = Array.isArray(field.relationFromFields) ? field.relationFromFields : [];
  const relationToFields = Array.isArray(field.relationToFields) ? field.relationToFields : [];
  const backRelation = findBackRelation(model.name, field, targetModel?.fields ?? []);
  const relationMetadata = metadata.models.get(model.name)?.relationFields?.get(field.name);
  const isImplicitManyToMany =
    field.kind === "object" &&
    field.isList &&
    relationFromFields.length === 0 &&
    relationToFields.length === 0 &&
    Boolean(backRelation?.isList);

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
    foreignKeyFieldNames: [...relationFromFields],
    onDelete: typeof field.relationOnDelete === "string" ? field.relationOnDelete : undefined,
    onUpdate: typeof field.relationOnUpdate === "string" ? field.relationOnUpdate : undefined,
    foreignKeyConstraintName: relationMetadata?.map,
    isImplicitManyToMany,
    linkModelName: isImplicitManyToMany
      ? buildImplicitLinkModelName(resolveImplicitRelationTableName(model.name, field.type, field.relationName))
      : undefined
  };
}

function extractConstraints(modelName: string, indexes: any[]): ConstraintDefinition[] {
  return indexes
    .filter((entry) => entry.model === modelName)
    .filter((entry) => !(entry.type === "unique" && entry.isDefinedOnField !== false && !entry.dbName))
    .map((entry) => ({
      kind:
        entry.type === "id"
          ? "primary_key"
          : entry.type === "unique"
            ? "unique"
            : "index",
      fields: entry.fields.map((field: any) => ({
        name: field.name,
        sort: typeof field.sortOrder === "string" ? normalizeSort(field.sortOrder) : undefined,
        length: typeof field.length === "number" ? field.length : undefined
      })),
      name: entry.dbName ?? undefined,
      algorithm: typeof entry.algorithm === "string" ? entry.algorithm : undefined
    }));
}

function extractForeignKeys(model: any, metadata: AstMetadata): ForeignKeyDefinition[] {
  const keys: ForeignKeyDefinition[] = [];

  for (const field of model.fields) {
    if (field.kind !== "object") {
      continue;
    }

    const relationFromFields = Array.isArray(field.relationFromFields) ? field.relationFromFields : [];
    const relationToFields = Array.isArray(field.relationToFields) ? field.relationToFields : [];
    if (relationFromFields.length === 0 || relationToFields.length === 0) {
      continue;
    }

    const relationMetadata = metadata.models.get(model.name)?.relationFields?.get(field.name);
    keys.push({
      name: relationMetadata?.map,
      fields: [...relationFromFields],
      targetModel: field.type,
      targetFields: [...relationToFields],
      onDelete: typeof field.relationOnDelete === "string" ? field.relationOnDelete : undefined,
      onUpdate: typeof field.relationOnUpdate === "string" ? field.relationOnUpdate : undefined
    });
  }

  return keys;
}

function extractForeignKey(
  model: any,
  scalarFieldName: string,
  metadata: AstMetadata
): ScalarFieldDefinition["foreignKey"] {
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

  const relationFromFields = getRelationFieldNames(relationField.relationFromFields);
  const relationToFields = getRelationFieldNames(relationField.relationToFields);
  if (relationFromFields.length !== 1 || relationToFields.length !== 1) {
    return undefined;
  }

  return {
    name: metadata.models.get(model.name)?.relationFields?.get(relationField.name)?.map,
    fields: [...relationFromFields],
    targetModel: relationField.type,
    targetFields: [...relationToFields],
    onDelete: typeof relationField.relationOnDelete === "string" ? relationField.relationOnDelete : undefined,
    onUpdate: typeof relationField.relationOnUpdate === "string" ? relationField.relationOnUpdate : undefined
  };
}

function buildImplicitManyToManyLinkModels(models: ModelDefinition[]): ModelDefinition[] {
  const generated = new Map<string, ModelDefinition>();

  for (const model of models) {
    for (const field of model.relationFields) {
      if (!field.isImplicitManyToMany || !field.linkModelName) {
        continue;
      }

      const targetModel = models.find((candidate) => candidate.name === field.targetModel);
      const counterpart = findRelationCounterpart(targetModel, field);
      /* v8 ignore next 3 -- implicit many-to-many normalization only marks fields when a counterpart exists */
      if (!targetModel || !counterpart) {
        continue;
      }

      if (!shouldCreateImplicitLinkModel(model, field, targetModel, counterpart)) {
        continue;
      }

      const relationTableName = resolveImplicitRelationTableName(model.name, targetModel.name, field.relationName);
      const columnA = "A";
      const columnB = "B";
      const left = model;
      const right = targetModel;

      generated.set(
        field.linkModelName,
        {
          name: field.linkModelName,
          pythonName: field.linkModelName,
          tableName: relationTableName,
          tableSchema: model.tableSchema ?? targetModel.tableSchema,
          isGeneratedLinkModel: true,
          scalarFields: [
            {
              kind: "scalar",
              name: columnA,
              pythonName: columnA,
              columnName: columnA,
              prismaType: getPrimaryKeyField(left).prismaType,
              pythonType: getPrimaryKeyField(left).pythonType,
              isList: false,
              isNullable: false,
              isId: true,
              isUnique: false,
              hasDefaultValue: false,
              isUpdatedAt: false,
              nativeType: getPrimaryKeyField(left).nativeType,
              foreignKey: {
                fields: [columnA],
                targetModel: left.name,
                targetFields: [getPrimaryKeyField(left).name]
              }
            },
            {
              kind: "scalar",
              name: columnB,
              pythonName: columnB,
              columnName: columnB,
              prismaType: getPrimaryKeyField(right).prismaType,
              pythonType: getPrimaryKeyField(right).pythonType,
              isList: false,
              isNullable: false,
              isId: true,
              isUnique: false,
              hasDefaultValue: false,
              isUpdatedAt: false,
              nativeType: getPrimaryKeyField(right).nativeType,
              foreignKey: {
                fields: [columnB],
                targetModel: right.name,
                targetFields: [getPrimaryKeyField(right).name]
              }
            }
          ],
          relationFields: [],
          constraints: [
            {
              kind: "primary_key",
              fields: [{ name: columnA }, { name: columnB }]
            }
          ],
          foreignKeys: [
            {
              fields: [columnA],
              targetModel: left.name,
              targetFields: [getPrimaryKeyField(left).name]
            },
            {
              fields: [columnB],
              targetModel: right.name,
              targetFields: [getPrimaryKeyField(right).name]
            }
          ]
        }
      );
    }
  }

  return [...generated.values()];
}

function getPrimaryKeyField(model: ModelDefinition): ScalarFieldDefinition {
  const field = model.scalarFields.find((candidate) => candidate.isId);
  if (!field) {
    throw new Error(`Model ${model.name} does not have a single-column primary key suitable for implicit many-to-many synthesis.`);
  }
  return field;
}

function shouldCreateImplicitLinkModel(
  model: ModelDefinition,
  field: RelationFieldDefinition,
  targetModel: ModelDefinition,
  counterpart: RelationFieldDefinition
): boolean {
  if (model.name === targetModel.name) {
    return field.name < counterpart.name;
  }
  return model.name < targetModel.name;
}

function resolveImplicitRelationTableName(leftModelName: string, rightModelName: string, relationName: string): string {
  if (relationName && relationName !== `${leftModelName}To${rightModelName}` && relationName !== `${rightModelName}To${leftModelName}`) {
    return `_${relationName}`;
  }

  const [first, second] = [leftModelName, rightModelName].sort((a, b) => a.localeCompare(b));
  return `_${first}To${second}`;
}

function buildImplicitLinkModelName(tableName: string): string {
  return `PrismaImplicitLink_${tableName.replace(/[^A-Za-z0-9_]/g, "_")}`;
}

function isSingleFieldUnique(modelName: string, fieldName: string, indexes: any[]): boolean {
  return indexes.some(
    (entry) =>
      entry.model === modelName &&
      entry.type === "unique" &&
      entry.fields.length === 1 &&
      entry.fields[0].name === fieldName &&
      entry.isDefinedOnField !== false &&
      !entry.dbName
  );
}

function isFieldPartOfPrimaryKey(model: any, fieldName: string, indexes: any[]): boolean {
  if (model.fields.some((field: any) => field.name === fieldName && field.isId)) {
    return true;
  }

  return indexes.some(
    (entry) =>
      entry.model === model.name &&
      entry.type === "id" &&
      entry.fields.some((field: any) => field.name === fieldName)
  );
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

function findRelationCounterpart(
  targetModel: ModelDefinition | undefined,
  field: RelationFieldDefinition
): RelationFieldDefinition | undefined {
  return targetModel?.relationFields.find((candidate) => candidate.name === field.backPopulates);
}

function getRelationFieldNames(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
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

function inferDefaultKind(defaultValue: unknown): "scalar" | "function" | undefined {
  if (defaultValue && typeof defaultValue === "object" && "name" in defaultValue) {
    return "function";
  }
  if (defaultValue !== undefined) {
    return "scalar";
  }
  return undefined;
}

function normalizeSort(sortOrder: string): "asc" | "desc" | undefined {
  const normalized = sortOrder.toLowerCase();
  return normalized === "asc" || normalized === "desc" ? normalized : undefined;
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
