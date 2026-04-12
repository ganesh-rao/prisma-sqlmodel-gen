import type * as DMMF from "@prisma/dmmf";
import type { GeneratorOptions } from "@prisma/generator";

export type SupportedProvider = "postgresql" | "mysql";

export type GeneratorConfig = {
  moduleName: string;
  packageName?: string;
  emitInit: boolean;
  strict: boolean;
  headerComment: boolean;
  sqlmodelImportStyle: "sqlmodel";
};

export type GeneratorInput = {
  options?: GeneratorOptions;
  dmmf: DMMF.Document | unknown;
  schemaPath: string;
  datamodel: string;
  outputDir: string;
  config: GeneratorConfig;
};

export type ConstraintKind = "primary_key" | "unique" | "index";

export type ConstraintFieldDefinition = {
  name: string;
  sort?: "asc" | "desc";
  length?: number;
};

export type ConstraintDefinition = {
  kind: ConstraintKind;
  fields: ConstraintFieldDefinition[];
  name?: string;
  algorithm?: string;
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
  isImplicitManyToMany?: boolean;
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
  values: Array<{
    name: string;
    pythonName: string;
    value: string;
  }>;
};

export type ModelDefinition = {
  name: string;
  pythonName: string;
  tableName: string;
  tableSchema?: string;
  isGeneratedLinkModel?: boolean;
  scalarFields: ScalarFieldDefinition[];
  relationFields: RelationFieldDefinition[];
  constraints: ConstraintDefinition[];
  foreignKeys: ForeignKeyDefinition[];
};

export type SchemaDefinition = {
  provider: SupportedProvider;
  relationMode?: string;
  enums: EnumDefinition[];
  models: ModelDefinition[];
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
