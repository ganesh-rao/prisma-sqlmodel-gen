import type { ContractDocument } from "./contract.js";
import { contractBoolean, contractRecord, contractString, contractStringArray } from "./contract.js";
import type {
  ConstraintDefinition,
  Diagnostic,
  EnumDefinition,
  ForeignKeyDefinition,
  ModelDefinition,
  ModelInheritance,
  NativeType,
  RelationFieldDefinition,
  ScalarFieldDefinition,
  SchemaDefinition,
  ValueObjectDefinition
} from "./types.js";
import { isPlainObject, toPythonIdentifier } from "./utils.js";

type StorageColumnView = {
  name: string;
  codecId?: string;
  nativeType?: string;
  nullable: boolean;
  many: boolean;
  defaultValue: unknown;
  typeRef?: string;
  typeParams: Record<string, unknown>;
  enumRef?: { namespaceId: string; name: string };
};

type StorageTableView = {
  namespaceId: string;
  tableName: string;
  columns: StorageColumnView[];
  primaryKey: string[];
  uniques: Array<{ columns: string[]; name?: string }>;
  foreignKeys: Array<{
    name?: string;
    onDelete?: string;
    onUpdate?: string;
    sourceColumns: string[];
    targetNamespace?: string;
    targetTable?: string;
    targetColumns: string[];
  }>;
  indexes: Array<{
    name?: string;
    columns: string[];
    expression?: string;
    unique: boolean;
    where?: string;
    type?: string;
  }>;
  checks: Array<{ name?: string; expression: string }>;
};

type DomainModelView = {
  name: string;
  namespaceId: string;
  table?: string;
  tableNamespace?: string;
  fields: Record<string, unknown>;
  relations: Record<string, unknown>;
  columnToField: Map<string, string>;
  base?: { model: string; namespace: string };
  discriminatorField?: string;
  variantsList: Array<{ model: string; value: string }>;
};

type EnumView = {
  name: string;
  namespaceId: string;
  storage: "native" | "text" | "integer";
  members: Array<{ name: string; value: string | number }>;
};

type BuildContext = {
  diagnostics: Diagnostic[];
  strict: boolean;
  enums: EnumView[];
  tables: Map<string, StorageTableView>;
  models: Map<string, DomainModelView>;
  executionDefaults: Array<{
    namespace?: string;
    table?: string;
    column?: string;
    onCreate?: string;
    onUpdate?: string;
  }>;
  namedTypes: Record<string, unknown>;
  tableOwners: Map<string, DomainModelView>;
  valueObjects: ValueObjectDefinition[];
};

export function buildSchemaDefinitionFromContract(
  document: ContractDocument,
  strict: boolean
): { definition: SchemaDefinition; diagnostics: Diagnostic[] } {
  const context: BuildContext = {
    diagnostics: [],
    strict,
    enums: [],
    tables: new Map(),
    models: new Map(),
    executionDefaults: [],
    namedTypes: {},
    tableOwners: new Map(),
    valueObjects: []
  };

  collectStorageTables(document, context);
  collectDomainModels(document, context);
  for (const model of context.models.values()) {
    if (model.table) {
      context.tableOwners.set(`${model.tableNamespace}.${model.table}`, model);
    }
  }
  collectEnums(document, context);
  collectExecutionDefaults(document, context);
  collectNamedTypes(document, context);
  collectValueObjects(document, context);

  const models: ModelDefinition[] = [];
  for (const model of context.models.values()) {
    const built = buildModel(model, context);
    if (built) {
      models.push(built);
    }
  }
  validateCollisions(models, context);

  return {
    definition: {
      provider: "postgresql",
      enums: context.enums.map((entry) => ({
        name: entry.name,
        pythonName: toPythonIdentifier(entry.name),
        storage: entry.storage,
        values: entry.members.map((member) => ({
          name: member.name,
          pythonName: enumMemberPythonName(member.name),
          value: member.value
        }))
      })),
      models,
      valueObjects: context.valueObjects
    },
    diagnostics: context.diagnostics
  };
}

function enumMemberPythonName(name: string): string {
  return toPythonIdentifier(name).toUpperCase();
}

const KNOWN_STORAGE_SECTIONS = new Set(["table", "native_enum", "valueSet"]);
const KNOWN_DOMAIN_SECTIONS = new Set(["models", "enum", "valueObjects"]);

function reportUnknownSection(
  plane: string,
  namespaceId: string,
  section: string,
  context: BuildContext
): void {
  context.diagnostics.push({
    code: "UNSUPPORTED_CONTRACT_SECTION",
    severity: "error",
    message: `Unsupported contract ${plane} section '${section}' in namespace '${namespaceId}'.`,
    suggestion: "Re-emit contract.json with a supported Prisma 8 toolchain version."
  });
}

function collectStorageTables(document: ContractDocument, context: BuildContext): void {
  const namespaces = contractRecord(document.storage.namespaces) ?? {};
  for (const [namespaceId, namespaceValue] of Object.entries(namespaces)) {
    const entries = contractRecord(contractRecord(namespaceValue)?.entries) ?? {};
    for (const section of Object.keys(entries)) {
      if (!KNOWN_STORAGE_SECTIONS.has(section)) {
        reportUnknownSection("storage", namespaceId, section, context);
      }
    }
    const tables = contractRecord(entries.table) ?? {};
    for (const [tableName, tableValue] of Object.entries(tables)) {
      const table = contractRecord(tableValue) ?? {};
      context.tables.set(`${namespaceId}.${tableName}`, {
        namespaceId,
        tableName,
        columns: collectColumns(table),
        primaryKey: contractStringArray(contractRecord(table.primaryKey)?.columns) ?? [],
        uniques: collectUnions(table),
        foreignKeys: collectForeignKeys(table),
        indexes: collectIndexes(table),
        checks: collectChecks(table)
      });
    }
  }
}

function collectColumns(table: Record<string, unknown>): StorageColumnView[] {
  const columns = contractRecord(table.columns) ?? {};
  return Object.entries(columns).map(([name, value]) => {
    const column = contractRecord(value) ?? {};
    const valueSet = contractRecord(column.valueSet);
    return {
      name,
      codecId: contractString(column.codecId),
      nativeType: contractString(column.nativeType),
      nullable: contractBoolean(column.nullable) ?? true,
      many: contractBoolean(column.many) ?? false,
      defaultValue: column.default,
      typeRef: contractString(column.typeRef),
      typeParams: contractRecord(column.typeParams) ?? {},
      enumRef: valueSet
        ? {
            namespaceId: contractString(valueSet.namespaceId) ?? "",
            name: contractString(valueSet.entityName) ?? ""
          }
        : undefined
    };
  });
}

function collectUnions(table: Record<string, unknown>): Array<{ columns: string[]; name?: string }> {
  if (!Array.isArray(table.uniques)) {
    return [];
  }
  return table.uniques.flatMap((entry) => {
    const record = contractRecord(entry);
    const columns = contractStringArray(record?.columns);
    return columns ? [{ columns, name: contractString(record?.name) }] : [];
  });
}

function collectForeignKeys(table: Record<string, unknown>): StorageTableView["foreignKeys"] {
  if (!Array.isArray(table.foreignKeys)) {
    return [];
  }
  return table.foreignKeys.flatMap((entry) => {
    const key = contractRecord(entry);
    const source = contractRecord(key?.source);
    const target = contractRecord(key?.target);
    const sourceColumns = contractStringArray(source?.columns) ?? [];
    const targetColumns = contractStringArray(target?.columns) ?? [];
    if (sourceColumns.length === 0 || targetColumns.length === 0) {
      return [];
    }
    return [
      {
        name: contractString(key?.name),
        onDelete: contractString(key?.onDelete),
        onUpdate: contractString(key?.onUpdate),
        sourceColumns,
        targetNamespace: contractString(target?.namespaceId),
        targetTable: contractString(target?.tableName),
        targetColumns
      }
    ];
  });
}

function collectIndexes(table: Record<string, unknown>): StorageTableView["indexes"] {
  if (!Array.isArray(table.indexes)) {
    return [];
  }
  return table.indexes.flatMap((entry) => {
    const index = contractRecord(entry);
    if (!index) {
      return [];
    }
    return [
      {
        name: contractString(index.name),
        columns: contractStringArray(index.columns) ?? [],
        expression: contractString(index.expression),
        unique: contractBoolean(index.unique) ?? false,
        where: contractString(index.where),
        type: contractString(index.type)
      }
    ];
  });
}

function collectChecks(table: Record<string, unknown>): StorageTableView["checks"] {
  if (!Array.isArray(table.checks)) {
    return [];
  }
  return table.checks.flatMap((entry) => {
    const expression = contractString(contractRecord(entry)?.expression);
    if (!expression) {
      return [];
    }
    return [{ name: contractString(contractRecord(entry)?.name), expression }];
  });
}

function collectDomainModels(document: ContractDocument, context: BuildContext): void {
  const namespaces = contractRecord(document.domain.namespaces) ?? {};
  for (const [namespaceId, namespaceValue] of Object.entries(namespaces)) {
    const namespace = contractRecord(namespaceValue) ?? {};
    for (const section of Object.keys(namespace)) {
      if (!KNOWN_DOMAIN_SECTIONS.has(section)) {
        reportUnknownSection("domain", namespaceId, section, context);
      }
    }
    const models = contractRecord(namespace.models) ?? {};
    for (const [name, modelValue] of Object.entries(models)) {
      const model = contractRecord(modelValue) ?? {};
      const storage = contractRecord(model.storage) ?? {};
      const storageFields = contractRecord(storage.fields) ?? {};
      const columnToField = new Map<string, string>();
      for (const [fieldName, fieldValue] of Object.entries(storageFields)) {
        const column = contractString(contractRecord(fieldValue)?.column);
        if (column !== undefined) {
          columnToField.set(column, fieldName);
        }
      }
      context.models.set(`${namespaceId}.${name}`, {
        name,
        namespaceId,
        table: contractString(storage.table),
        tableNamespace: contractString(storage.namespaceId),
        fields: contractRecord(model.fields) ?? {},
        relations: contractRecord(model.relations) ?? {},
        columnToField,
        base: parseModelBase(model, namespaceId),
        discriminatorField: contractString(contractRecord(model.discriminator)?.field),
        variantsList: parseModelVariants(model)
      });
    }
  }
}

function parseModelBase(
  model: Record<string, unknown>,
  namespaceId: string
): { model: string; namespace: string } | undefined {
  const base = contractRecord(model.base);
  if (!base) {
    return undefined;
  }
  return {
    model: contractString(base.model) ?? "",
    namespace: contractString(base.namespace) ?? namespaceId
  };
}

function parseModelVariants(model: Record<string, unknown>): Array<{ model: string; value: string }> {
  const variants = contractRecord(model.variants) ?? {};
  return Object.entries(variants).flatMap(([name, value]) => {
    const entryValue = contractString(contractRecord(value)?.value);
    return entryValue === undefined ? [] : [{ model: name, value: entryValue }];
  });
}

function collectEnums(document: ContractDocument, context: BuildContext): void {
  const domainNamespaces = contractRecord(document.domain.namespaces) ?? {};
  for (const [namespaceId, namespaceValue] of Object.entries(domainNamespaces)) {
    const enums = contractRecord(contractRecord(namespaceValue)?.enum) ?? {};
    for (const [name, enumValue] of Object.entries(enums)) {
      const entry = contractRecord(enumValue) ?? {};
      const codecId = contractString(entry.codecId);
      const members = Array.isArray(entry.members) ? entry.members : [];
      context.enums.push({
        name,
        namespaceId,
        storage: typeof codecId === "string" && codecId.startsWith("pg/int") ? "integer" : "text",
        members: members.map((member) => {
          const item = contractRecord(member) ?? {};
          const memberName = contractString(item.name) ?? "UNKNOWN";
          return { name: memberName, value: enumMemberValue(item.value) };
        })
      });
    }
  }

  const storageNamespaces = contractRecord(document.storage.namespaces) ?? {};
  for (const [namespaceId, namespaceValue] of Object.entries(storageNamespaces)) {
    const entries = contractRecord(contractRecord(namespaceValue)?.entries) ?? {};
    const nativeEnums = contractRecord(entries.native_enum) ?? {};
    for (const [name, enumValue] of Object.entries(nativeEnums)) {
      const members = contractStringArray(contractRecord(enumValue)?.members) ?? [];
      context.enums.push({
        name,
        namespaceId,
        storage: "native",
        members: members.map((value) => ({ name: value, value }))
      });
    }
  }
}

function enumMemberValue(value: unknown): string | number {
  return typeof value === "string" || typeof value === "number" ? value : "";
}

function collectExecutionDefaults(document: ContractDocument, context: BuildContext): void {
  const mutations = contractRecord(contractRecord(document.execution)?.mutations) ?? {};
  const defaults = Array.isArray(mutations.defaults) ? mutations.defaults : [];
  for (const entry of defaults) {
    const item = contractRecord(entry) ?? {};
    const ref = contractRecord(item.ref) ?? {};
    context.executionDefaults.push({
      namespace: contractString(ref.namespace),
      table: contractString(ref.table),
      column: contractString(ref.column),
      onCreate: contractString(contractRecord(item.onCreate)?.id),
      onUpdate: contractString(contractRecord(item.onUpdate)?.id)
    });
  }
}

function collectNamedTypes(document: ContractDocument, context: BuildContext): void {
  context.namedTypes = contractRecord(document.storage.types) ?? {};
}

const VALUE_OBJECT_CODEC_PYTHON_TYPES: Record<string, string> = {
  text: "str",
  varchar: "str",
  char: "str",
  bool: "bool",
  int2: "int",
  int4: "int",
  int8: "int",
  float4: "float",
  float8: "float",
  numeric: "Decimal",
  timestamp: "datetime",
  "timestamp-temporal": "datetime",
  timestamptz: "datetime",
  "timestamptz-temporal": "datetime",
  "timestamptz-string": "str",
  date: "date",
  "date-temporal": "date",
  time: "time",
  "time-temporal": "time",
  timetz: "time",
  json: "Any",
  jsonb: "Any",
  bytea: "bytes",
  uuid: "UUID",
  inet: "str"
};

function collectValueObjects(document: ContractDocument, context: BuildContext): void {
  const namespaces = contractRecord(document.domain.namespaces) ?? {};
  for (const [, namespaceValue] of Object.entries(namespaces)) {
    const valueObjects = contractRecord(contractRecord(namespaceValue)?.valueObjects) ?? {};
    for (const [name, valueObjectValue] of Object.entries(valueObjects)) {
      const valueObject = contractRecord(valueObjectValue) ?? {};
      const fields = contractRecord(valueObject.fields) ?? {};
      context.valueObjects.push({
        name,
        pythonName: toPythonIdentifier(name),
        fields: Object.entries(fields).map(([fieldName, fieldValue]) =>
          buildValueObjectField(name, fieldName, fieldValue, context)
        )
      });
    }
  }
}

function buildValueObjectField(
  valueObjectName: string,
  fieldName: string,
  fieldValue: unknown,
  context: BuildContext
): ValueObjectDefinition["fields"][number] {
  const field = contractRecord(fieldValue) ?? {};
  const type = contractRecord(field.type) ?? {};
  const reference =
    contractString(type.kind) === "valueObject" ? contractString(type.name) : undefined;
  return {
    name: fieldName,
    pythonName: toPythonIdentifier(fieldName),
    pythonType:
      reference === undefined
        ? mapValueObjectCodec(type, valueObjectName, fieldName, context)
        : toPythonIdentifier(reference),
    isNullable: contractBoolean(field.nullable) ?? true,
    isList: contractBoolean(field.many) ?? false
  };
}

function mapValueObjectCodec(
  type: Record<string, unknown>,
  valueObjectName: string,
  fieldName: string,
  context: BuildContext
): string {
  const codec = contractString(type.codecId) ?? "";
  const parts = codec.split("/");
  const middle = parts.length > 1 ? parts[1] : "";
  const base = middle.split("@")[0];
  const mapped = VALUE_OBJECT_CODEC_PYTHON_TYPES[base];
  if (mapped === undefined) {
    context.diagnostics.push({
      code: "UNKNOWN_VALUE_OBJECT_TYPE",
      severity: "error",
      model: valueObjectName,
      field: fieldName,
      message: `Value object field '${fieldName}' has an unsupported type codec '${codec || "missing"}'.`,
      suggestion: "Use a supported scalar field type inside value objects."
    });
    return "Any";
  }
  return mapped;
}

function validateCollisions(models: ModelDefinition[], context: BuildContext): void {
  const seenTypes = new Map<string, string>();
  const checkTypeName = (kind: string, name: string): void => {
    const pythonName = toPythonIdentifier(name);
    const existing = seenTypes.get(pythonName);
    if (existing) {
      context.diagnostics.push({
        code: "PYTHON_TYPE_NAME_COLLISION",
        severity: "error",
        model: name,
        message: `${capitalize(kind)} '${name}' collides with ${existing} after Python name sanitization.`,
        suggestion: "Rename one of the models, enums, or value objects so their Python type names are unique."
      });
      return;
    }
    seenTypes.set(pythonName, `${kind} '${name}'`);
  };

  for (const model of context.models.values()) {
    checkTypeName("model", model.name);
  }
  for (const entry of context.enums) {
    checkTypeName("enum", entry.name);
  }
  for (const entry of context.valueObjects) {
    checkTypeName("value object", entry.name);
  }

  for (const model of models) {
    const seenFields = new Map<string, string>();
    for (const field of [...model.scalarFields, ...model.relationFields]) {
      const existing = seenFields.get(field.pythonName);
      if (existing) {
        context.diagnostics.push({
          code: "PYTHON_FIELD_NAME_COLLISION",
          severity: "error",
          model: model.name,
          field: field.name,
          message: `Field '${field.name}' collides with '${existing}' after Python name sanitization.`,
          suggestion: "Rename one of the fields so the generated Python attribute names are unique."
        });
        continue;
      }
      seenFields.set(field.pythonName, field.name);
    }
  }

  for (const entry of context.enums) {
    const seenMembers = new Set<string>();
    for (const member of entry.members) {
      const memberName = toPythonIdentifier(member.name).toUpperCase();
      if (seenMembers.has(memberName)) {
        context.diagnostics.push({
          code: "PYTHON_ENUM_VALUE_COLLISION",
          severity: "error",
          model: entry.name,
          field: member.name,
          message: `Enum value '${member.name}' collides with another enum value after Python name sanitization.`,
          suggestion: "Rename enum values so their generated Python enum members are unique."
        });
      }
      seenMembers.add(memberName);
    }
  }
}

function capitalize(value: string): string {
  return value[0].toUpperCase() + value.slice(1);
}

function buildModel(model: DomainModelView, context: BuildContext): ModelDefinition | undefined {
  const table = model.table ? context.tables.get(`${model.tableNamespace}.${model.table}`) : undefined;
  if (!table) {
    context.diagnostics.push({
      code: "UNRESOLVED_MODEL_TABLE",
      severity: "error",
      model: model.name,
      message: `Model '${model.name}' does not resolve to a storage table.`,
      suggestion: "Re-emit contract.json with `prisma contract emit`."
    });
    return undefined;
  }

  const inheritance = resolveInheritance(model, context);
  const sharedTableVariant = inheritance?.kind === "variant" && !inheritance.ownsTable;
  const scalarFields = sharedTableVariant
    ? []
    : table.columns.map((column) => buildScalarField(model, table, column, context));
  const constraints = sharedTableVariant ? [] : buildConstraints(model, table);
  const foreignKeys = sharedTableVariant ? [] : buildCompositeForeignKeys(model, table, context);
  const relationFields = buildRelationFields(model, context);
  validateCompositePrimaryKey(model, table, scalarFields, context);

  return {
    name: model.name,
    pythonName: toPythonIdentifier(model.name),
    tableName: table.tableName,
    tableSchema: sharedTableVariant
      ? undefined
      : table.namespaceId === "public"
        ? undefined
        : table.namespaceId,
    scalarFields,
    relationFields,
    constraints,
    foreignKeys,
    checks: sharedTableVariant
      ? []
      : table.checks.map((check) => ({ name: check.name, expression: check.expression })),
    inheritance
  };
}

function resolveInheritance(
  model: DomainModelView,
  context: BuildContext
): ModelInheritance | undefined {
  if (model.base) {
    const base = context.models.get(`${model.base.namespace}.${model.base.model}`);
    const match = base?.variantsList.find((entry) => entry.model === model.name);
    return {
      kind: "variant",
      baseModel: model.base.model,
      value: match ? match.value : "",
      ownsTable: model.table !== base?.table || model.tableNamespace !== base?.tableNamespace
    };
  }
  if (model.discriminatorField !== undefined || model.variantsList.length > 0) {
    return {
      kind: "base",
      discriminatorField: model.discriminatorField ?? "",
      variants: model.variantsList.map((entry) => ({ model: entry.model, value: entry.value }))
    };
  }
  return undefined;
}

function validateCompositePrimaryKey(
  model: DomainModelView,
  table: StorageTableView,
  scalarFields: ScalarFieldDefinition[],
  context: BuildContext
): void {
  if (context.strict && table.primaryKey.length > 1) {
    const defaulted = scalarFields.some(
      (field) => field.hasDefaultValue && table.primaryKey.includes(field.columnName)
    );
    if (defaulted) {
      context.diagnostics.push({
        code: "UNSUPPORTED_COMPOSITE_PK_DEFAULT",
        severity: "error",
        model: model.name,
        message: "Composite primary keys with generated defaults are not supported.",
        suggestion: "Remove generated defaults from composite primary key fields or use a single-column primary key."
      });
    }
  }
}

function buildScalarField(
  model: DomainModelView,
  table: StorageTableView,
  column: StorageColumnView,
  context: BuildContext
): ScalarFieldDefinition {
  const logicalName = tableColumnToField(model, column.name);
  const domainField = contractRecord(model.fields[logicalName]);
  const enumView = resolveEnum(model, column, domainField, context);
  const mapping = mapColumnType(model, column, enumView, context);
  const domainType = contractRecord(domainField?.type);
  const valueObjectRef =
    contractString(domainType?.kind) === "valueObject" ? contractString(domainType?.name) : undefined;
  const isId = table.primaryKey.length === 1 && table.primaryKey[0] === column.name;
  const isUnique = table.uniques.some(
    (entry) => entry.columns.length === 1 && entry.columns[0] === column.name && entry.name === undefined
  );
  const { hasDefaultValue, defaultValue, isUpdatedAt } = resolveColumnDefault(
    model,
    table,
    column,
    enumView?.name,
    context
  );

  return {
    kind: "scalar",
    name: logicalName,
    pythonName: toPythonIdentifier(logicalName),
    columnName: column.name,
    prismaType: mapping.prismaType,
    pythonType:
      valueObjectRef === undefined ? mapping.pythonType : toPythonIdentifier(valueObjectRef),
    isList: column.many,
    isNullable: column.nullable,
    isId,
    isUnique,
    hasDefaultValue,
    defaultValue,
    defaultKind: inferDefaultKind(defaultValue, hasDefaultValue),
    isUpdatedAt,
    nativeType: mapping.nativeType,
    foreignKey: buildSingleColumnForeignKey(model, table, column, context)
  };
}

function tableColumnToField(model: DomainModelView, columnName: string): string {
  return model.columnToField.get(columnName) ?? columnName;
}

function resolveEnum(
  model: DomainModelView,
  column: StorageColumnView,
  domainField: Record<string, unknown> | undefined,
  context: BuildContext
): EnumView | undefined {
  const direct = column.enumRef ?? enumRefFromDomain(domainField);
  if (!direct || direct.name.length === 0) {
    return undefined;
  }
  const resolved = context.enums.find(
    (entry) => entry.namespaceId === model.namespaceId && entry.name === direct.name
  );
  if (!resolved) {
    context.diagnostics.push({
      code: "UNKNOWN_ENUM_REFERENCE",
      severity: "error",
      model: model.name,
      field: model.columnToField.get(column.name) ?? column.name,
      message: `Column '${column.name}' references unknown enum '${direct.name}'.`,
      suggestion: "Re-emit contract.json with `prisma contract emit`."
    });
    return undefined;
  }
  return resolved;
}

function enumRefFromDomain(
  domainField: Record<string, unknown> | undefined
): { namespaceId: string; name: string } | undefined {
  const valueSet = contractRecord(domainField?.valueSet);
  if (!valueSet) {
    return undefined;
  }
  return {
    namespaceId: contractString(valueSet.namespaceId) ?? "",
    name: contractString(valueSet.entityName) ?? ""
  };
}

function mapColumnType(
  model: DomainModelView,
  column: StorageColumnView,
  enumView: EnumView | undefined,
  context: BuildContext
): { prismaType: string; pythonType: string; nativeType?: NativeType } {
  if (enumView) {
    return {
      prismaType: enumView.name,
      pythonType: enumView.name,
      nativeType:
        enumView.storage === "text"
          ? { name: "Text", args: [] }
          : enumView.storage === "integer"
            ? { name: "Integer", args: [] }
            : undefined
    };
  }

  const params = resolveTypeParams(column, context);
  const length = formatTypeParam(params.length);
  const precision = formatTypeParam(params.precision);
  const scale = formatTypeParam(params.scale);

  switch (column.nativeType) {
    case "character varying":
      return {
        prismaType: "String",
        pythonType: "str",
        nativeType: { name: "VarChar", args: length ? [length] : [] }
      };
    case "character":
      return {
        prismaType: "String",
        pythonType: "str",
        nativeType: { name: "Char", args: length ? [length] : [] }
      };
    case "text":
      return { prismaType: "String", pythonType: "str", nativeType: { name: "Text", args: [] } };
    case "bool":
      return {
        prismaType: "Boolean",
        pythonType: "bool",
        nativeType: { name: "Boolean", args: [] }
      };
    case "int2":
      return { prismaType: "Int", pythonType: "int", nativeType: { name: "SmallInt", args: [] } };
    case "int4":
      return { prismaType: "Int", pythonType: "int", nativeType: { name: "Integer", args: [] } };
    case "int8":
      return { prismaType: "BigInt", pythonType: "int", nativeType: { name: "BigInt", args: [] } };
    case "float4":
      return { prismaType: "Float", pythonType: "float", nativeType: { name: "Real", args: [] } };
    case "float8":
      return {
        prismaType: "Float",
        pythonType: "float",
        nativeType: { name: "DoublePrecision", args: [] }
      };
    case "numeric":
      return {
        prismaType: "Decimal",
        pythonType: "Decimal",
        nativeType: { name: "Decimal", args: formatPrecisionScale(precision, scale) }
      };
    case "timestamp":
      return {
        prismaType: "DateTime",
        pythonType: "datetime",
        nativeType: { name: "Timestamp", args: precision ? [precision] : [] }
      };
    case "timestamptz":
      return {
        prismaType: "DateTime",
        pythonType: "datetime",
        nativeType: { name: "Timestamptz", args: precision ? [precision] : [] }
      };
    case "date":
      return { prismaType: "DateTime", pythonType: "date", nativeType: { name: "Date", args: [] } };
    case "time":
      return {
        prismaType: "DateTime",
        pythonType: "time",
        nativeType: { name: "Time", args: precision ? [precision] : [] }
      };
    case "timetz":
      return {
        prismaType: "DateTime",
        pythonType: "time",
        nativeType: { name: "Timetz", args: precision ? [precision] : [] }
      };
    case "json":
      return { prismaType: "Json", pythonType: "Any", nativeType: { name: "Json", args: [] } };
    case "jsonb":
      return { prismaType: "Jsonb", pythonType: "Any", nativeType: { name: "JsonB", args: [] } };
    case "bytea":
      return { prismaType: "Bytes", pythonType: "bytes", nativeType: { name: "ByteA", args: [] } };
    case "uuid":
      return { prismaType: "Uuid", pythonType: "UUID", nativeType: { name: "Uuid", args: [] } };
    case "inet":
      return { prismaType: "String", pythonType: "str", nativeType: { name: "Inet", args: [] } };
    default:
      context.diagnostics.push({
        code: "UNKNOWN_COLUMN_TYPE",
        severity: "error",
        model: model.name,
        field: model.columnToField.get(column.name) ?? column.name,
        message: `Column '${column.name}' has an unsupported storage type '${column.nativeType ?? "missing"}'.`,
        suggestion: "Use a supported Postgres column type or map the extension type explicitly."
      });
      return { prismaType: "String", pythonType: "str", nativeType: { name: "Text", args: [] } };
  }
}

function resolveTypeParams(
  column: StorageColumnView,
  context: BuildContext
): Record<string, unknown> {
  const named = column.typeRef ? contractRecord(context.namedTypes[column.typeRef]) : undefined;
  const namedParams = contractRecord(named?.typeParams) ?? {};
  return { ...namedParams, ...column.typeParams };
}

function formatTypeParam(value: unknown): string | undefined {
  return value == null ? undefined : String(value);
}

function formatPrecisionScale(precision: string | undefined, scale: string | undefined): string[] {
  if (precision === undefined) {
    return [];
  }
  return scale === undefined ? [precision] : [precision, scale];
}

function resolveColumnDefault(
  model: DomainModelView,
  table: StorageTableView,
  column: StorageColumnView,
  enumName: string | undefined,
  context: BuildContext
): { hasDefaultValue: boolean; defaultValue?: unknown; isUpdatedAt: boolean } {
  let hasDefaultValue = false;
  let defaultValue: unknown;
  let isUpdatedAt = false;

  const storageDefault = contractRecord(column.defaultValue);
  if (storageDefault) {
    if (contractString(storageDefault.kind) === "literal" && "value" in storageDefault) {
      hasDefaultValue = true;
      defaultValue = mapLiteralDefault(storageDefault.value, enumName, context, model, column);
    } else if (contractString(storageDefault.kind) === "function") {
      const expression = contractString(storageDefault.expression) ?? "";
      hasDefaultValue = true;
      defaultValue = mapFunctionDefault(expression);
    }
  }

  const execution = context.executionDefaults.find(
    (entry) =>
      entry.namespace === table.namespaceId &&
      entry.table === table.tableName &&
      entry.column === column.name
  );
  if (execution) {
    if (execution.onCreate === "uuidv4" || execution.onCreate === "uuidv7") {
      hasDefaultValue = true;
      defaultValue = { name: "uuid", args: [] };
    } else if (execution.onCreate === "cuid2" || execution.onCreate === "ulid" || execution.onCreate === "nanoid") {
      context.diagnostics.push({
        code: "UNSUPPORTED_CLIENT_SIDE_DEFAULT",
        severity: "error",
        model: model.name,
        field: model.columnToField.get(column.name) ?? column.name,
        message: `Prisma ${execution.onCreate}() defaults do not have a built-in SQLModel/Python equivalent in strict mode.`,
        suggestion: "Use uuid() or a database-side default if the database should own ID generation."
      });
    } else if (
      execution.onCreate !== undefined &&
      execution.onCreate !== "instantNow" &&
      execution.onCreate !== "timestampNow"
    ) {
      context.diagnostics.push({
        code: "UNSUPPORTED_EXECUTION_DEFAULT",
        severity: "error",
        model: model.name,
        field: model.columnToField.get(column.name) ?? column.name,
        message: `Execution default '${execution.onCreate}' does not have a SQLModel equivalent.`,
        suggestion: "Use a supported default generator."
      });
    }
    if (execution.onCreate === "instantNow" || execution.onCreate === "timestampNow") {
      hasDefaultValue = true;
      defaultValue = { name: "now_client", args: [] };
    }
    if (execution.onUpdate === "instantNow" || execution.onUpdate === "timestampNow") {
      isUpdatedAt = true;
    } else if (execution.onUpdate !== undefined) {
      context.diagnostics.push({
        code: "UNSUPPORTED_EXECUTION_DEFAULT",
        severity: "error",
        model: model.name,
        field: model.columnToField.get(column.name) ?? column.name,
        message: `Execution on-update generator '${execution.onUpdate}' does not have a SQLModel equivalent.`,
        suggestion: "Use temporal.updatedAt() for auto-updated timestamps."
      });
    }
  }

  return { hasDefaultValue, defaultValue, isUpdatedAt };
}

function mapLiteralDefault(
  value: unknown,
  enumName: string | undefined,
  context: BuildContext,
  model: DomainModelView,
  column: StorageColumnView
): unknown {
  if (!enumName) {
    return coerceLiteralDefault(value, column.nativeType);
  }
  const enumDef = context.enums.find(
    (entry) => entry.namespaceId === model.namespaceId && entry.name === enumName
  );
  const member = enumDef?.members.find((candidate) => candidate.value === enumMemberValue(value));
  if (!member) {
    context.diagnostics.push({
      code: "UNKNOWN_ENUM_DEFAULT_VALUE",
      severity: "error",
      model: model.name,
      field: model.columnToField.get(column.name) ?? column.name,
      message: `Default value does not match any member of enum '${enumName}'.`,
      suggestion: "Re-emit contract.json with `prisma contract emit`."
    });
    return value;
  }
  return enumMemberPythonName(member.name);
}

function coerceLiteralDefault(value: unknown, nativeType: string | undefined): unknown {
  if (typeof value !== "string") {
    return value;
  }
  if (nativeType === "int2" || nativeType === "int4" || nativeType === "int8") {
    if (/^-?\d+$/.test(value)) {
      const parsed = Number(value);
      if (Number.isSafeInteger(parsed)) {
        return parsed;
      }
    }
    return value;
  }
  if (nativeType === "float4" || nativeType === "float8" || nativeType === "numeric") {
    if (/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(value)) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return value;
  }
  return value;
}

function mapFunctionDefault(expression: string): unknown {
  if (expression === "autoincrement()") {
    return { name: "autoincrement", args: [] };
  }
  if (expression === "now()") {
    return { name: "now", args: [] };
  }
  return { name: "dbgenerated", args: [expression] };
}

function inferDefaultKind(defaultValue: unknown, hasDefaultValue: boolean): "scalar" | "function" | undefined {
  if (!hasDefaultValue) {
    return undefined;
  }
  return isPlainObject(defaultValue) && "name" in defaultValue ? "function" : "scalar";
}

function buildConstraints(model: DomainModelView, table: StorageTableView): ConstraintDefinition[] {
  const constraints: ConstraintDefinition[] = [];

  if (table.primaryKey.length > 1) {
    constraints.push({
      kind: "primary_key",
      fields: table.primaryKey.map((column) => ({ name: model.columnToField.get(column) ?? column }))
    });
  }

  for (const unique of table.uniques) {
    if (unique.columns.length > 1 || unique.name !== undefined) {
      constraints.push({
        kind: "unique",
        fields: unique.columns.map((column) => ({ name: model.columnToField.get(column) ?? column })),
        name: unique.name
      });
    }
  }

  for (const index of table.indexes) {
    constraints.push({
      kind: "index",
      fields: index.columns.map((column) => ({ name: model.columnToField.get(column) ?? column })),
      name: index.name,
      algorithm: index.type,
      expression: index.expression,
      where: index.where,
      unique: index.unique ? true : undefined
    });
  }

  return constraints;
}

function buildSingleColumnForeignKey(
  model: DomainModelView,
  table: StorageTableView,
  column: StorageColumnView,
  context: BuildContext
): ScalarFieldDefinition["foreignKey"] {
  const key = table.foreignKeys.find(
    (entry) => entry.sourceColumns.length === 1 && entry.sourceColumns[0] === column.name
  );
  if (!key) {
    return undefined;
  }
  return buildForeignKeyDefinition(model, key, context);
}

function buildCompositeForeignKeys(
  model: DomainModelView,
  table: StorageTableView,
  context: BuildContext
): ForeignKeyDefinition[] {
  return table.foreignKeys
    .filter((entry) => entry.sourceColumns.length > 1)
    .map((entry) => buildForeignKeyDefinition(model, entry, context));
}

function buildForeignKeyDefinition(
  model: DomainModelView,
  key: StorageTableView["foreignKeys"][number],
  context: BuildContext
): ForeignKeyDefinition {
  const targetModel = key.targetTable
    ? context.tableOwners.get(`${key.targetNamespace}.${key.targetTable}`)
    : undefined;
  return {
    name: key.name,
    fields: key.sourceColumns.map((column) => model.columnToField.get(column) ?? column),
    targetModel: targetModel?.name ?? key.targetTable ?? "",
    targetFields: key.targetColumns.map(
      (column) => targetModel?.columnToField.get(column) ?? column
    ),
    onDelete: normalizeReferentialAction(key.onDelete, context, model, key.sourceColumns[0]),
    onUpdate: normalizeReferentialAction(key.onUpdate, context, model, key.sourceColumns[0])
  };
}

function normalizeReferentialAction(
  action: string | undefined,
  context: BuildContext,
  model: DomainModelView,
  columnName: string
): string | undefined {
  if (action === undefined) {
    return undefined;
  }
  switch (action.toLowerCase()) {
    case "cascade":
      return "CASCADE";
    case "setnull":
      return "SET NULL";
    case "setdefault":
      return "SET DEFAULT";
    case "restrict":
      return "RESTRICT";
    case "noaction":
      return "NO ACTION";
    default:
      context.diagnostics.push({
        code: "UNSUPPORTED_REFERENTIAL_ACTION",
        severity: "error",
        model: model.name,
        field: model.columnToField.get(columnName) ?? columnName,
        message: `Referential action '${action}' does not map to SQLModel metadata.`,
        suggestion: "Use cascade, setNull, setDefault, restrict, or noAction."
      });
      return undefined;
  }
}

function buildRelationFields(
  model: DomainModelView,
  context: BuildContext
): RelationFieldDefinition[] {
  return Object.entries(model.relations).flatMap(([name, relation]) => {
    const built = buildRelationField(model, name, contractRecord(relation) ?? {}, context);
    return built ? [built] : [];
  });
}

function buildRelationField(
  model: DomainModelView,
  name: string,
  relation: Record<string, unknown>,
  context: BuildContext
): RelationFieldDefinition | undefined {
  const cardinality = contractString(relation.cardinality);
  const target = contractRecord(relation.to) ?? {};
  const targetModelName = contractString(target.model) ?? "";
  const targetNamespace = contractString(target.namespace) ?? model.namespaceId;
  const targetModel = context.models.get(`${targetNamespace}.${targetModelName}`);
  if (!targetModel) {
    if (context.strict) {
      context.diagnostics.push({
        code: "UNRESOLVED_RELATION_TARGET",
        severity: "error",
        model: model.name,
        field: name,
        message: `Relation '${name}' points to '${targetModelName || "missing"}', which is not declared in the contract.`,
        suggestion: "Declare the target model in the contract or run in non-strict mode to skip the relation."
      });
    }
    return undefined;
  }
  const on = contractRecord(relation.on) ?? {};
  const localFields = contractStringArray(on.localFields) ?? [];
  const targetFields = contractStringArray(on.targetFields) ?? [];
  const isNullable = contractBoolean(relation.nullable) ?? false;
  if (cardinality === "N:M") {
    return buildManyToManyField(model, name, relation, targetModel, localFields, targetFields, isNullable, context);
  }
  const counterpart = findCounterpart(targetModel, model, localFields, targetFields);

  return {
    kind: "relation",
    name,
    pythonName: toPythonIdentifier(name),
    targetModel: targetModelName,
    isList: cardinality === "1:N",
    isNullable,
    relationName: `${model.name}_${name}`,
    relationFromFields: [...localFields],
    relationToFields: [...targetFields],
    backPopulates: counterpart ?? "",
    foreignKeyFieldNames: cardinality === "N:1" ? [...localFields] : [],
    onDelete: undefined,
    onUpdate: undefined
  };
}

function buildManyToManyField(
  model: DomainModelView,
  name: string,
  relation: Record<string, unknown>,
  targetModel: DomainModelView,
  localFields: string[],
  targetFields: string[],
  isNullable: boolean,
  context: BuildContext
): RelationFieldDefinition | undefined {
  const through = contractRecord(relation.through) ?? {};
  const throughTable = contractString(through.table);
  const throughNamespace = contractString(through.namespaceId) ?? model.namespaceId;
  const linkOwner = throughTable
    ? context.tableOwners.get(`${throughNamespace}.${throughTable}`)
    : undefined;
  if (!throughTable || !linkOwner) {
    if (context.strict) {
      context.diagnostics.push({
        code: "UNRESOLVED_LINK_MODEL",
        severity: "error",
        model: model.name,
        field: name,
        message: `Many-to-many relation '${name}' does not resolve to a join model.`,
        suggestion: "Declare the join table as a model or run in non-strict mode to skip the relation."
      });
    }
    return undefined;
  }
  const counterpart = findThroughCounterpart(targetModel, model, throughTable, throughNamespace);
  return {
    kind: "relation",
    name,
    pythonName: toPythonIdentifier(name),
    targetModel: targetModel.name,
    isList: true,
    isNullable,
    relationName: `${model.name}_${name}`,
    relationFromFields: [...localFields],
    relationToFields: [...targetFields],
    backPopulates: counterpart ?? "",
    foreignKeyFieldNames: [],
    onDelete: undefined,
    onUpdate: undefined,
    linkModelName: toPythonIdentifier(linkOwner.name)
  };
}

function findThroughCounterpart(
  targetModel: DomainModelView,
  sourceModel: DomainModelView,
  throughTable: string,
  throughNamespace: string
): string | undefined {
  for (const [name, relation] of Object.entries(targetModel.relations)) {
    const candidate = contractRecord(relation) ?? {};
    const through = contractRecord(candidate.through);
    const to = contractRecord(candidate.to) ?? {};
    if (
      through &&
      contractString(through.table) === throughTable &&
      (contractString(through.namespaceId) ?? targetModel.namespaceId) === throughNamespace &&
      contractString(to.model) === sourceModel.name &&
      (contractString(to.namespace) ?? targetModel.namespaceId) === sourceModel.namespaceId
    ) {
      return name;
    }
  }
  return undefined;
}

function findCounterpart(
  targetModel: DomainModelView,
  sourceModel: DomainModelView,
  localFields: string[],
  targetFields: string[]
): string | undefined {
  for (const [name, relation] of Object.entries(targetModel.relations)) {
    const candidate = contractRecord(relation) ?? {};
    const to = contractRecord(candidate.to) ?? {};
    if (
      contractString(to.model) !== sourceModel.name ||
      (contractString(to.namespace) ?? targetModel.namespaceId) !== sourceModel.namespaceId
    ) {
      continue;
    }
    const on = contractRecord(candidate.on) ?? {};
    const candidateLocal = contractStringArray(on.localFields) ?? [];
    const candidateTarget = contractStringArray(on.targetFields) ?? [];
    if (arraysEqual(candidateLocal, targetFields) && arraysEqual(candidateTarget, localFields)) {
      return name;
    }
  }
  return undefined;
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}
