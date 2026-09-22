export type SupportedProvider = "postgresql";

export type GeneratorConfig = {
  moduleName: string;
  packageName?: string;
  emitInit: boolean;
  strict: boolean;
  headerComment: boolean;
  sqlmodelImportStyle: "sqlmodel";
};

export type ContractGeneratorInput = {
  contractPath: string;
  contractText: string;
  outputDir: string;
  config: GeneratorConfig;
};

export type ConstraintKind = "primary_key" | "unique" | "index";

export type ConstraintFieldDefinition = {
  name: string;
  sort?: "asc" | "desc";
};

export type ConstraintDefinition = {
  kind: ConstraintKind;
  fields: ConstraintFieldDefinition[];
  name?: string;
  algorithm?: string;
  expression?: string;
  where?: string;
  unique?: boolean;
};

export type CheckDefinition = {
  name?: string;
  expression: string;
};

export type NativeType = {
  name: string;
  args: string[];
};

export type ScalarFieldDefinition = {
  kind: "scalar";
  name: string;
  pythonName: string;
  columnName: string;
  prismaType: string;
  pythonType: string;
  isList: boolean;
  isNullable: boolean;
  isId: boolean;
  isUnique: boolean;
  hasDefaultValue: boolean;
  defaultValue?: unknown;
  isUpdatedAt: boolean;
  nativeType?: NativeType;
  foreignKey?: ForeignKeyDefinition;
  defaultKind?: "scalar" | "function";
};

export type RelationFieldDefinition = {
  kind: "relation";
  name: string;
  pythonName: string;
  targetModel: string;
  isList: boolean;
  isNullable: boolean;
  relationName: string;
  relationFromFields: string[];
  relationToFields: string[];
  backPopulates: string;
  foreignKeyFieldNames: string[];
  onDelete?: string;
  onUpdate?: string;
  foreignKeyConstraintName?: string;
  linkModelName?: string;
};

export type ForeignKeyDefinition = {
  name?: string;
  fields: string[];
  targetModel: string;
  targetFields: string[];
  onDelete?: string;
  onUpdate?: string;
};

export type EnumDefinition = {
  name: string;
  pythonName: string;
  storage?: "native" | "text" | "integer";
  values: Array<{
    name: string;
    pythonName: string;
    value: string | number;
  }>;
};

export type ValueObjectFieldDefinition = {
  name: string;
  pythonName: string;
  pythonType: string;
  isNullable: boolean;
  isList: boolean;
};

export type ValueObjectDefinition = {
  name: string;
  pythonName: string;
  fields: ValueObjectFieldDefinition[];
};

export type ModelInheritance =
  | {
      kind: "base";
      discriminatorField: string;
      variants: Array<{ model: string; value: string }>;
    }
  | {
      kind: "variant";
      baseModel: string;
      value: string;
      ownsTable: boolean;
    };

export type ModelDefinition = {
  name: string;
  pythonName: string;
  tableName: string;
  tableSchema?: string;
  scalarFields: ScalarFieldDefinition[];
  relationFields: RelationFieldDefinition[];
  constraints: ConstraintDefinition[];
  foreignKeys: ForeignKeyDefinition[];
  checks?: CheckDefinition[];
  inheritance?: ModelInheritance;
};

export type SchemaDefinition = {
  provider: SupportedProvider;
  enums: EnumDefinition[];
  models: ModelDefinition[];
  valueObjects?: ValueObjectDefinition[];
};

export type DiagnosticSeverity = "error" | "warning";

export type Diagnostic = {
  code: string;
  message: string;
  severity: DiagnosticSeverity;
  model?: string;
  field?: string;
  suggestion?: string;
  location?: {
    line: number;
    column: number;
  };
};

export type GenerateResult = {
  files: string[];
  diagnostics: Diagnostic[];
};
