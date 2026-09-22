import type { Diagnostic } from "./types.js";
import { isPlainObject } from "./utils.js";

export const SUPPORTED_CONTRACT_SCHEMA_VERSION = 1;

export type ContractDocument = {
  schemaVersion: number;
  targetFamily: string;
  target: string;
  domain: Record<string, unknown>;
  storage: Record<string, unknown>;
  execution: Record<string, unknown>;
  [key: string]: unknown;
};

export type ContractStorageColumn = {
  name: string;
  codecId?: string;
  nativeType?: string;
  nullable: boolean;
  many: boolean;
  default?: unknown;
  typeRef?: string;
  typeParams?: Record<string, unknown>;
  valueSet?: Record<string, unknown>;
};

export type ContractForeignKeyRef = {
  columns: string[];
  namespaceId?: string;
  tableName?: string;
};

export type ContractForeignKey = {
  name?: string;
  onDelete?: string;
  onUpdate?: string;
  source: ContractForeignKeyRef;
  target: ContractForeignKeyRef;
};

export type ContractIndex = {
  name?: string;
  columns: string[];
  expression?: string;
  unique: boolean;
  where?: string;
  type?: string;
};

export type ContractCheck = {
  name?: string;
  expression: string;
};

export type ContractStorageTable = {
  name: string;
  namespaceId: string;
  columns: ContractStorageColumn[];
  primaryKey: string[];
  uniques: string[][];
  foreignKeys: ContractForeignKey[];
  indexes: ContractIndex[];
  checks: ContractCheck[];
};

export type ContractDomainFieldType = {
  kind?: string;
  codecId?: string;
  name?: string;
};

export type ContractDomainField = {
  name: string;
  nullable: boolean;
  many: boolean;
  type: ContractDomainFieldType;
  enumName?: string;
  column?: string;
};

export type ContractDomainRelation = {
  name: string;
  cardinality?: string;
  nullable: boolean;
  localFields: string[];
  targetFields: string[];
  targetModel?: string;
  targetNamespace?: string;
  throughTable?: string;
  throughNamespace?: string;
};

export type ContractDomainModel = {
  name: string;
  namespaceId: string;
  table?: string;
  fields: ContractDomainField[];
  relations: ContractDomainRelation[];
  discriminatorField?: string;
  variants: Array<{ model: string; value: string }>;
  baseModel?: string;
  baseValue?: string;
};

export type ContractDomainEnum = {
  name: string;
  codecId?: string;
  members: Array<{ name: string; value: string }>;
};

export type ContractValueObject = {
  name: string;
  fields: ContractDomainField[];
};

export type ContractExecutionDefault = {
  table?: string;
  namespace?: string;
  column?: string;
  onCreate?: string;
  onUpdate?: string;
};

export function parseContractDocument(text: string): {
  document: ContractDocument | undefined;
  diagnostics: Diagnostic[];
} {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return {
      document: undefined,
      diagnostics: [
        {
          code: "CONTRACT_JSON_PARSE_ERROR",
          severity: "error",
          message: "Contract file is not valid JSON.",
          suggestion: "Re-emit contract.json with `prisma contract emit`."
        }
      ]
    };
  }

  if (!isPlainObject(value)) {
    return {
      document: undefined,
      diagnostics: [
        {
          code: "INVALID_CONTRACT_DOCUMENT",
          severity: "error",
          message: "Contract file does not contain a JSON object.",
          suggestion: "Re-emit contract.json with `prisma contract emit`."
        }
      ]
    };
  }

  if (value.schemaVersion !== SUPPORTED_CONTRACT_SCHEMA_VERSION && value.schemaVersion !== "1") {
    return {
      document: undefined,
      diagnostics: [
        {
          code: "UNSUPPORTED_CONTRACT_VERSION",
          severity: "error",
          message: `Unsupported contract schemaVersion '${formatReceived(value.schemaVersion)}'. This package supports schemaVersion ${SUPPORTED_CONTRACT_SCHEMA_VERSION}.`,
          suggestion: "Re-emit contract.json with a supported Prisma 8 toolchain version."
        }
      ]
    };
  }

  if (value.targetFamily !== "sql" || value.target !== "postgres") {
    return {
      document: undefined,
      diagnostics: [
        {
          code: "UNSUPPORTED_CONTRACT_TARGET",
          severity: "error",
          message: `Unsupported contract target '${formatReceived(value.targetFamily)}:${formatReceived(value.target)}'. Only Postgres SQL contracts are supported.`,
          suggestion: "Emit the contract from a Postgres Prisma 8 project."
        }
      ]
    };
  }

  return {
    document: {
      ...value,
      schemaVersion: SUPPORTED_CONTRACT_SCHEMA_VERSION,
      targetFamily: "sql",
      target: "postgres",
      domain: contractRecord(value.domain) ?? {},
      storage: contractRecord(value.storage) ?? {},
      execution: contractRecord(value.execution) ?? {}
    },
    diagnostics: []
  };
}

export function contractRecord(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? value : undefined;
}

export function contractString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function contractBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function contractStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.every((entry) => typeof entry === "string") ? [...value] : undefined;
}

function formatReceived(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "missing";
}
