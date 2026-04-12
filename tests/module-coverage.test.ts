import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as compatIndex from "../src/compat/index.js";
import * as compatibility from "../src/compatibility.js";
import { resolveGeneratorConfig, resolveOutputDir } from "../src/config.js";
import { DiagnosticError, formatDiagnostics } from "../src/diagnostics.js";
import * as emitPythonIndex from "../src/emit/python/index.js";
import { checkManagedFile, ensureInitFile, removeFileIfExists, writeManagedFile } from "../src/fs.js";
import { checkSqlModelGeneration, generateSqlModel } from "../src/generate.js";
import * as irIndex from "../src/ir/index.js";
import * as mapIndex from "../src/map/index.js";
import { buildSchemaDefinition } from "../src/normalize.js";
import { extractAstMetadata } from "../src/prisma-ast.js";
import { renderPythonModule } from "../src/render-python.js";
import * as utils from "../src/utils.js";
import { PACKAGE_VERSION, resolvePackageVersion } from "../src/version.js";

function makeModelMetadata(
  overrides: Partial<{
    tableName: string;
    tableSchema: string | undefined;
    ignored: boolean;
    ignoredFields: Set<string>;
    relationFields: Map<string, any>;
    fieldLocations: Map<string, { line: number; column: number }>;
  }> = {}
) {
  return {
    tableName: "DefaultTable",
    tableSchema: undefined,
    ignored: false,
    ignoredFields: new Set<string>(),
    relationFields: new Map<string, any>(),
    fieldLocations: new Map<string, { line: number; column: number }>(),
    ...overrides
  };
}

describe("utility modules", () => {
  it("covers config resolution branches", () => {
    expect(
      resolveGeneratorConfig({
        name: "sqlmodel",
        provider: { fromEnvVar: null, value: "prisma-sqlmodel-gen" },
        output: { fromEnvVar: null, value: "./generated/package-name" },
        binaryTargets: [],
        previewFeatures: [],
        config: {
          moduleName: ["custom_models"],
          emitInit: "false",
          strict: "false",
          headerComment: "false",
          sqlmodelImportStyle: "sqlmodel"
        },
        sourceFilePath: "/virtual/schema.prisma"
      } as any)
    ).toEqual({
      moduleName: "custom_models.py",
      emitInit: false,
      strict: false,
      headerComment: false,
      packageName: "package-name",
      sqlmodelImportStyle: "sqlmodel"
    });

    expect(
      resolveGeneratorConfig({
        name: "sqlmodel",
        provider: { fromEnvVar: null, value: "prisma-sqlmodel-gen" },
        output: { fromEnvVar: null, value: "./generated/sqlmodel" },
        binaryTargets: [],
        previewFeatures: [],
        config: {
          emitInit: "true",
          strict: "true",
          headerComment: "true"
        },
        sourceFilePath: "/virtual/schema.prisma"
      } as any)
    ).toMatchObject({
      emitInit: true,
      strict: true,
      headerComment: true
    });

    expect(
      resolveGeneratorConfig(
        {
          name: "sqlmodel",
          provider: { fromEnvVar: null, value: "prisma-sqlmodel-gen" },
          output: { fromEnvVar: null, value: "   " },
          binaryTargets: [],
          previewFeatures: [],
          config: {
            emitInit: "maybe",
            strict: "maybe",
            headerComment: "maybe"
          },
          sourceFilePath: "/virtual/schema.prisma"
        } as any,
        {
          moduleName: "override",
          packageName: "pkg",
          emitInit: true
        }
      )
    ).toEqual({
      moduleName: "override.py",
      emitInit: true,
      strict: true,
      headerComment: true,
      packageName: "pkg",
      sqlmodelImportStyle: "sqlmodel"
    });

    expect(
      resolveGeneratorConfig({
        name: "sqlmodel",
        provider: { fromEnvVar: null, value: "prisma-sqlmodel-gen" },
        output: { fromEnvVar: null, value: "   " },
        binaryTargets: [],
        previewFeatures: [],
        config: {},
        sourceFilePath: "/virtual/schema.prisma"
      } as any).packageName
    ).toBeUndefined();

    expect(() =>
      resolveGeneratorConfig({
        name: "sqlmodel",
        provider: { fromEnvVar: null, value: "prisma-sqlmodel-gen" },
        output: { fromEnvVar: null, value: "./generated/sqlmodel" },
        binaryTargets: [],
        previewFeatures: [],
        config: {
          sqlmodelImportStyle: "custom"
        },
        sourceFilePath: "/virtual/schema.prisma"
      } as any)
    ).toThrow("Unsupported sqlmodelImportStyle 'custom'");

    expect(resolveOutputDir("/tmp/schema.prisma", undefined, "/tmp/out")).toBe(path.resolve("/tmp/out"));
    expect(
      resolveOutputDir("/tmp/schema.prisma", {
        output: { fromEnvVar: null, value: "./generated/sqlmodel" }
      } as any)
    ).toBe(path.resolve("/tmp/generated/sqlmodel"));
    expect(() => resolveOutputDir("/tmp/schema.prisma", undefined, undefined)).toThrow(
      "Generator output is required."
    );
  });

  it("covers utility helpers", () => {
    expect(utils.toPythonIdentifier("")).toBe("_");
    expect(utils.toPythonIdentifier("from")).toBe("from_");
    expect(utils.toPythonIdentifier("1bad-name")).toBe("_bad_name");
    expect(utils.toPythonIdentifier("!!!")).toBe("___");
    expect(utils.escapePythonString("a\\b'c")).toBe("a\\\\b\\'c");
    expect(utils.quotePythonString("x")).toBe("'x'");
    expect(utils.normalizeStringLiteral('"quoted"')).toBe("quoted");
    expect(utils.normalizeStringLiteral("plain")).toBe("plain");
    expect(utils.normalizeStringLiteral(12)).toBeUndefined();
    expect(utils.isPlainObject({ a: 1 })).toBe(true);
    expect(utils.isPlainObject([])).toBe(false);
    expect(utils.isPlainObject(null)).toBe(false);
  });

  it("covers diagnostics formatting and error type", () => {
    const diagnostics = [
      {
        code: "A",
        severity: "error" as const,
        message: "first",
        model: "User",
        field: "email",
        location: { line: 10, column: 2 },
        suggestion: "fix it"
      },
      {
        code: "B",
        severity: "warning" as const,
        message: "second"
      }
    ];

    expect(formatDiagnostics(diagnostics)).toBe(
      "ERROR A (User.email) [line 10, col 2]: first Suggestion: fix it\nWARNING B: second"
    );

    const error = new DiagnosticError("boom", diagnostics);
    expect(error.name).toBe("DiagnosticError");
    expect(error.diagnostics).toBe(diagnostics);
  });

  it("covers managed file helpers", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "prisma-sqlmodel-fs-"));
    const filePath = path.join(tempDir, "nested", "models.py");

    await writeManagedFile(filePath, "content\n");
    expect(await readFile(filePath, "utf8")).toBe("content\n");
    expect(await checkManagedFile(filePath, "content\n")).toBe(true);
    expect(await checkManagedFile(filePath, "other\n")).toBe(false);
    expect(await checkManagedFile(path.join(tempDir, "missing.py"), "x")).toBe(false);

    const initPath = await ensureInitFile(path.dirname(filePath), "models.py");
    expect(await readFile(initPath, "utf8")).toBe("from .models import *\n");

    await removeFileIfExists(initPath);
    await removeFileIfExists(initPath);
    expect(await checkManagedFile(initPath, "")).toBe(false);
  });

  it("re-exports through barrel modules", () => {
    expect(compatIndex.collectCompatibilityDiagnostics).toBe(compatibility.collectCompatibilityDiagnostics);
    expect(compatIndex.DiagnosticError).toBe(DiagnosticError);
    expect(emitPythonIndex.renderPythonModule).toBe(renderPythonModule);
    expect(irIndex.buildSchemaDefinition).toBe(buildSchemaDefinition);
    expect(mapIndex.extractAstMetadata).toBe(extractAstMetadata);
  });
});

describe("compatibility diagnostics", () => {
  it("covers remaining compatibility branches", () => {
    const dmmf = {
      datamodel: {
        indexes: [
          {
            model: "Model",
            type: "id",
            fields: [{ name: "idPart" }, { name: "other" }]
          }
        ],
        models: [
          {
            name: "Model",
            fields: [
              { kind: "scalar", name: "values", type: "String", isList: true, hasDefaultValue: false },
              { kind: "enum", name: "roles", type: "Role", isList: true, hasDefaultValue: false },
              { kind: "scalar", name: "unsupported", type: "Unsupported", isList: false, hasDefaultValue: false },
              { kind: "scalar", name: "identifier", type: "String", isList: false, hasDefaultValue: true, default: { name: "ulid" } },
              { kind: "scalar", name: "idPart", type: "Int", isList: false, hasDefaultValue: true, default: { name: "autoincrement" }, isId: false },
              { kind: "scalar", name: "from", type: "String", isList: false, hasDefaultValue: false },
              { kind: "scalar", name: "from_", type: "String", isList: false, hasDefaultValue: false }
            ]
          },
          {
            name: "MissingMeta",
            fields: []
          },
          {
            name: "class",
            fields: []
          }
        ],
        enums: [
          {
            name: "class",
            values: [{ name: "A-B" }, { name: "A_B" }]
          },
          {
            name: "Role",
            values: [{ name: "A-B" }, { name: "A_B" }]
          }
        ]
      }
    };

    const metadata = {
      provider: "mysql",
      models: new Map([
        [
          "Model",
          makeModelMetadata({
            ignoredFields: new Set(["hidden"]),
            tableName: "Model",
            fieldLocations: new Map([
              ["hidden", { line: 0, column: 1 }],
              ["values", { line: 1, column: 1 }],
              ["roles", { line: 2, column: 1 }],
              ["unsupported", { line: 3, column: 1 }],
              ["identifier", { line: 4, column: 1 }],
              ["from_", { line: 5, column: 1 }]
            ])
          })
        ],
        [
          "class",
          makeModelMetadata({
            tableName: "class",
            fieldLocations: new Map()
          })
        ]
      ]),
      modelLocations: new Map([["Model", { line: 10, column: 2 }]]),
      fieldLocations: new Map([
        [
          "Model",
          new Map([
            ["values", { line: 1, column: 1 }],
            ["roles", { line: 2, column: 1 }],
            ["unsupported", { line: 3, column: 1 }],
            ["identifier", { line: 4, column: 1 }],
            ["from_", { line: 5, column: 1 }]
          ])
        ],
        ["class", new Map()]
      ])
    } as any;

    const diagnostics = compatibility.collectCompatibilityDiagnostics(dmmf, metadata, true);
    expect(diagnostics.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "UNSUPPORTED_LIST_FIELD",
        "UNSUPPORTED_ENUM_LIST",
        "UNSUPPORTED_LIST_FIELD",
        "UNSUPPORTED_SCALAR_TYPE",
        "UNSUPPORTED_CLIENT_SIDE_DEFAULT",
        "UNSUPPORTED_COMPOSITE_PK_DEFAULT",
        "UNSUPPORTED_IGNORE",
        "PYTHON_TYPE_NAME_COLLISION",
        "PYTHON_ENUM_VALUE_COLLISION",
        "PYTHON_FIELD_NAME_COLLISION"
      ])
    );

    const lenient = compatibility.collectCompatibilityDiagnostics(dmmf, metadata, false);
    expect(lenient.some((entry) => entry.code === "UNSUPPORTED_COMPOSITE_PK_DEFAULT")).toBe(false);
  });

  it("covers unsupported provider, implicit many-to-many, and model collision branches", () => {
    const dmmf = {
      datamodel: {
        indexes: [],
        models: [
          { name: "class", fields: [] },
          { name: "class_", fields: [] },
          {
            name: "ExistingGhost",
            fields: [
              {
                kind: "object",
                name: "holders",
                type: "GhostHolder",
                isList: true,
                relationFromFields: [],
                relationToFields: []
              }
            ]
          },
          {
            name: "JoinGhost",
            fields: [
              {
                kind: "object",
                name: "ghostHolder",
                type: "GhostHolder",
                isList: false,
                relationFromFields: ["ghostHolderId"],
                relationToFields: ["id"]
              }
            ]
          },
          {
            name: "GhostHolder",
            fields: [
              {
                kind: "object",
                name: "ghosts",
                type: "Ghost",
                isList: true,
                relationFromFields: [],
                relationToFields: []
              },
              {
                kind: "object",
                name: "existingGhosts",
                type: "ExistingGhost",
                isList: true,
                relationFromFields: [],
                relationToFields: []
              },
              {
                kind: "scalar",
                name: "serverGenerated",
                type: "String",
                isList: false,
                hasDefaultValue: true,
                default: { name: "uuid" }
              },
              {
                kind: "scalar",
                name: "oddGenerated",
                type: "String",
                isList: false,
                hasDefaultValue: true,
                default: { name: 12 }
              },
              {
                kind: "object",
                name: "linkedJoin",
                type: "JoinGhost",
                isList: true,
                relationFromFields: [],
                relationToFields: []
              },
              {
                kind: "object",
                name: "oddRelationShape",
                type: "Ghost",
                isList: false,
                relationFromFields: "not-an-array",
                relationToFields: null
              }
            ]
          }
        ],
        enums: []
      }
    };

    const metadata = {
      provider: "sqlite",
      models: new Map([
        ["class", makeModelMetadata({ tableName: "class", fieldLocations: new Map() })],
        ["class_", makeModelMetadata({ tableName: "class_", fieldLocations: new Map() })],
        [
          "GhostHolder",
          makeModelMetadata({
            tableName: "ghost_holder",
            fieldLocations: new Map([["ghosts", { line: 5, column: 3 }]])
          })
        ]
      ]),
      modelLocations: new Map(),
      fieldLocations: new Map([
        ["class", new Map()],
        ["class_", new Map()],
        [
          "GhostHolder",
          new Map([
            ["ghosts", { line: 5, column: 3 }],
            ["existingGhosts", { line: 6, column: 3 }],
            ["serverGenerated", { line: 7, column: 3 }],
            ["oddGenerated", { line: 8, column: 3 }],
            ["linkedJoin", { line: 9, column: 3 }],
            ["oddRelationShape", { line: 10, column: 3 }]
          ])
        ],
        ["ExistingGhost", new Map()],
        ["JoinGhost", new Map()]
      ])
    } as any;

    const diagnostics = compatibility.collectCompatibilityDiagnostics(dmmf, metadata, true);
    expect(diagnostics.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "UNSUPPORTED_PROVIDER",
        "UNSUPPORTED_IMPLICIT_M2M_SHAPE",
        "PYTHON_TYPE_NAME_COLLISION"
      ])
    );
  });

  it("covers advanced index diagnostics from DMMF and AST metadata", () => {
    const datamodel = `datasource db {
  provider = "postgresql"
}

model User {
  id    Int    @id
  value String @db.VarChar(255)

  @@index([value(ops: raw("gin_trgm_ops"))], type: Gin)
}`;

    const metadata = extractAstMetadata(datamodel, {
      datamodel: {
        models: [{ name: "User", dbName: null, fields: [] }]
      }
    });

    const diagnostics = compatibility.collectCompatibilityDiagnostics(
      {
        datamodel: {
          indexes: [
            { model: "User", type: "id", fields: [{ name: "id" }] },
            {
              model: "User",
              type: "normal",
              algorithm: "Gin",
              fields: [{ name: "value", operatorClass: "gin_trgm_ops" }]
            },
            {
              model: "User",
              type: "normal",
              fields: [{ name: "missingLocationField", operatorClass: "text_ops" }]
            },
            {
              model: "User",
              type: "normal"
            }
          ],
          models: [
            {
              name: "User",
              fields: [
                { kind: "scalar", name: "id", type: "Int", isList: false, isRequired: true, isId: true, isUnique: false, hasDefaultValue: false },
                { kind: "scalar", name: "value", type: "String", isList: false, isRequired: true, isId: false, isUnique: false, hasDefaultValue: false }
              ]
            }
          ],
          enums: []
        }
      },
      metadata,
      true
    );

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "UNSUPPORTED_ADVANCED_INDEX", model: "User" }),
        expect.objectContaining({ code: "UNSUPPORTED_ADVANCED_INDEX", model: "User", field: "value" }),
        expect.objectContaining({
          code: "UNSUPPORTED_ADVANCED_INDEX",
          model: "User",
          field: "missingLocationField",
          location: metadata.modelLocations.get("User")
        })
      ])
    );
  });
});

describe("normalize and render branches", () => {
  it("covers normalize fallbacks and deduplication", () => {
    const metadata = {
      provider: "postgresql",
      models: new Map([
        [
          "Example",
          makeModelMetadata({
            tableName: "examples"
          })
        ],
        [
          "Child",
          makeModelMetadata({
            tableName: "ChildTable"
          })
        ]
      ]),
      modelLocations: new Map(),
      fieldLocations: new Map([
        ["Example", new Map()],
        ["Child", new Map()]
      ])
    } as any;

    const dmmf = {
      datamodel: {
        indexes: [
          { model: "Example", type: "index", fields: [{ name: "field" }], dbName: "idx_one" },
          { model: "Example", type: "index", fields: [{ name: "field" }], dbName: "idx_one" }
        ],
        enums: [{ name: "ThingKind", values: [{ name: "A-B", dbName: "A_B_DB" }] }],
        models: [
          {
            name: "Example",
            dbName: "db_examples",
            fields: [
              { kind: "scalar", name: "id", type: "Int", isList: false, isRequired: true, isId: true, isUnique: false, hasDefaultValue: true, default: { name: "autoincrement" }, nativeType: ["Integer", []] },
              { kind: "scalar", name: "namedUnique", type: "String", isList: false, isRequired: true, isId: false, isUnique: true, hasDefaultValue: false, nativeType: ["VarChar", [30]] },
              { kind: "scalar", name: "customType", type: "CustomScalar", isList: false, isRequired: false, isId: false, isUnique: false, hasDefaultValue: false, nativeType: "invalid-native-type" },
              { kind: "scalar", name: "jsonField", type: "Json", isList: false, isRequired: false, isId: false, isUnique: false, hasDefaultValue: false },
              { kind: "enum", name: "kind", type: "ThingKind", isList: false, isRequired: true, isId: false, isUnique: false, hasDefaultValue: true, default: "A-B" },
              { kind: "object", name: "child", type: "Child", isList: false, isRequired: false, relationName: "ExampleChild", relationFromFields: ["childId"], relationToFields: ["id"] },
              { kind: "scalar", name: "childId", type: "Int", isList: false, isRequired: false, isId: false, isUnique: false, hasDefaultValue: false },
              { kind: "unsupportedKind", name: "ignored", type: "Ignored" }
            ]
          },
          {
            name: "Child",
            fields: [
              { kind: "scalar", name: "id", type: "Int", isList: false, isRequired: true, isId: true, isUnique: false, hasDefaultValue: false },
              { kind: "object", name: "example", type: "Example", isList: false, isRequired: true, relationName: "ExampleChild", relationFromFields: [], relationToFields: [] }
            ]
          }
        ]
      }
    };

    const definition = buildSchemaDefinition(dmmf, metadata);
    expect(definition.models[0].tableName).toBe("examples");
    expect(definition.models[0].constraints).toHaveLength(2);
    expect(definition.models[0].scalarFields.find((field) => field.name === "namedUnique")?.isUnique).toBe(false);
    expect(definition.models[0].scalarFields.find((field) => field.name === "namedUnique")?.columnName).toBe("namedUnique");
    expect(definition.models[0].scalarFields.find((field) => field.name === "customType")?.pythonType).toBe("CustomScalar");
    expect(definition.enums[0].values[0]).toEqual({
      name: "A-B",
      pythonName: "A_B",
      value: "A_B_DB"
    });
  });

  it("covers normalize relation fallbacks and scalar mappings", () => {
    const metadata = {
      provider: "postgresql",
      models: new Map([
        ["Example", makeModelMetadata({ tableName: "examples" })],
        ["Child", makeModelMetadata({ tableName: "children" })],
        ["Broken", makeModelMetadata({ tableName: "broken" })]
      ]),
      modelLocations: new Map(),
      fieldLocations: new Map([
        ["Example", new Map()],
        ["Child", new Map()],
        ["Broken", new Map()]
      ])
    } as any;

    const dmmf = {
      datamodel: {
        indexes: [],
        enums: [],
        models: [
          {
            name: "Example",
            fields: [
              {
                kind: "scalar",
                name: "enabled",
                type: "Boolean",
                isList: false,
                isRequired: true,
                isId: false,
                isUnique: false,
                hasDefaultValue: false
              },
              {
                kind: "scalar",
                name: "ratio",
                type: "Float",
                isList: false,
                isRequired: true,
                isId: false,
                isUnique: false,
                hasDefaultValue: false
              },
              {
                kind: "scalar",
                name: "childId",
                type: "Int",
                isList: false,
                isRequired: false,
                isId: false,
                isUnique: false,
                hasDefaultValue: false
              },
              {
                kind: "scalar",
                name: "brokenId",
                type: "Int",
                isList: false,
                isRequired: false,
                isId: false,
                isUnique: false,
                hasDefaultValue: false
              },
              {
                kind: "scalar",
                name: "unmatchedId",
                type: "Int",
                isList: false,
                isRequired: false,
                isId: false,
                isUnique: false,
                hasDefaultValue: false
              },
              {
                kind: "object",
                name: "shared",
                type: "Child",
                isList: false,
                isRequired: false,
                relationName: "SharedLink",
                relationFromFields: ["childId"],
                relationToFields: ["id"]
              },
              {
                kind: "object",
                name: "example",
                type: "Order",
                isList: false,
                isRequired: false,
                relationFromFields: undefined,
                relationToFields: undefined
              },
              {
                kind: "object",
                name: "broken",
                type: "Broken",
                isList: false,
                isRequired: false,
                relationName: "BrokenLink",
                relationFromFields: ["brokenId"],
                relationToFields: [""]
              },
              {
                kind: "object",
                name: "unmatched",
                type: "Broken",
                isList: false,
                isRequired: false,
                relationName: "BrokenMismatch",
                relationFromFields: ["unmatchedId"],
                relationToFields: []
              },
              {
                kind: "object",
                name: "ghostTarget",
                type: "MissingModel",
                isList: false,
                isRequired: false,
                relationName: "GhostTarget"
              }
            ]
          },
          {
            name: "Child",
            fields: [
              {
                kind: "scalar",
                name: "id",
                type: "Int",
                isList: false,
                isRequired: true,
                isId: true,
                isUnique: false,
                hasDefaultValue: false
              },
              {
                kind: "object",
                name: "shared",
                type: "Example",
                isList: false,
                isRequired: false,
                relationName: "SharedLink",
                relationFromFields: [],
                relationToFields: []
              }
            ]
          },
          {
            name: "Order",
            dbName: "db_orders",
            fields: [
              {
                kind: "scalar",
                name: "nativeOdd",
                type: "String",
                isList: false,
                isRequired: true,
                isId: false,
                isUnique: false,
                hasDefaultValue: false,
                nativeType: ["OddType", "not-an-array"]
              }
            ]
          },
          {
            name: "PlainFallback",
            fields: []
          },
          { name: "Broken", fields: [] }
        ]
      }
    };

    const definition = buildSchemaDefinition(dmmf, metadata);
    const example = definition.models.find((model) => model.name === "Example")!;
    expect(example.scalarFields.find((field) => field.name === "enabled")?.pythonType).toBe("bool");
    expect(example.scalarFields.find((field) => field.name === "ratio")?.pythonType).toBe("float");
    expect(example.scalarFields.find((field) => field.name === "brokenId")?.foreignKey).toBeUndefined();
    expect(example.scalarFields.find((field) => field.name === "unmatchedId")?.foreignKey).toBeUndefined();
    expect(example.relationFields.find((field) => field.name === "shared")?.backPopulates).toBe("shared");
    expect(example.relationFields.find((field) => field.name === "example")?.backPopulates).toBe("examples");
    expect(example.relationFields.find((field) => field.name === "ghostTarget")?.backPopulates).toBe("example");
    expect(definition.models.find((model) => model.name === "Order")?.tableName).toBe("db_orders");
    expect(definition.models.find((model) => model.name === "Order")?.scalarFields[0]?.nativeType).toEqual({
      name: "OddType",
      args: []
    });
    expect(definition.models.find((model) => model.name === "PlainFallback")?.tableName).toBe("PlainFallback");
  });

  it("covers render-python mapping branches for postgres and mysql", () => {
    const postgresSchema = {
      provider: "postgresql",
      enums: [
        {
          name: "FancyEnum",
          pythonName: "FancyEnum",
          values: [{ name: "ONE", pythonName: "ONE", value: "one" }]
        }
      ],
      models: [
        {
          name: "123Bad",
          pythonName: "_23Bad",
          tableName: "bad_table",
          constraints: [
            { kind: "primary_key", fields: ["pk1", "pk2"] },
            { kind: "unique", fields: ["varcharField"], name: "uq_varchar" },
            { kind: "index", fields: ["fallbackConstraint"], name: "ix_fallback" },
            { kind: "unique", fields: ["missingConstraintField"], name: "uq_missing" }
          ],
          scalarFields: [
            { kind: "scalar", name: "pk1", pythonName: "pk1", columnName: "pk1", prismaType: "Int", pythonType: "int", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false },
            { kind: "scalar", name: "pk2", pythonName: "pk2", columnName: "pk2", prismaType: "Int", pythonType: "int", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false },
            { kind: "scalar", name: "plainBool", pythonName: "plainBool", columnName: "plainBool", prismaType: "Boolean", pythonType: "bool", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false },
            { kind: "scalar", name: "plainBigInt", pythonName: "plainBigInt", columnName: "plainBigInt", prismaType: "BigInt", pythonType: "int", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false },
            { kind: "scalar", name: "plainFloat", pythonName: "plainFloat", columnName: "plainFloat", prismaType: "Float", pythonType: "float", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false },
            { kind: "scalar", name: "plainDecimal", pythonName: "plainDecimal", columnName: "plainDecimal", prismaType: "Decimal", pythonType: "Decimal", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false },
            { kind: "scalar", name: "plainBytes", pythonName: "plainBytes", columnName: "plainBytes", prismaType: "Bytes", pythonType: "bytes", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false },
            { kind: "scalar", name: "plainDateTime", pythonName: "plainDateTime", columnName: "plainDateTime", prismaType: "DateTime", pythonType: "datetime", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false },
            { kind: "scalar", name: "varcharField", pythonName: "varcharField", columnName: "varchar_col", prismaType: "String", pythonType: "str", isList: false, isNullable: false, isId: false, isUnique: true, hasDefaultValue: true, defaultValue: "hello", isUpdatedAt: false, nativeType: { name: "VarChar", args: ["20"] } },
            { kind: "scalar", name: "charField", pythonName: "charField", columnName: "charField", prismaType: "String", pythonType: "str", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "Char", args: ["2"] } },
            { kind: "scalar", name: "textField", pythonName: "textField", columnName: "textField", prismaType: "String", pythonType: "str", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "Text", args: [] } },
            { kind: "scalar", name: "boolField", pythonName: "boolField", columnName: "boolField", prismaType: "Boolean", pythonType: "bool", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: true, defaultValue: true, isUpdatedAt: false, nativeType: { name: "Boolean", args: [] } },
            { kind: "scalar", name: "boolFalseField", pythonName: "boolFalseField", columnName: "boolFalseField", prismaType: "Boolean", pythonType: "bool", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: true, defaultValue: false, isUpdatedAt: false },
            { kind: "scalar", name: "smallIntField", pythonName: "smallIntField", columnName: "smallIntField", prismaType: "Int", pythonType: "int", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "SmallInt", args: [] } },
            { kind: "scalar", name: "integerField", pythonName: "integerField", columnName: "integerField", prismaType: "Int", pythonType: "int", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "Integer", args: [] } },
            { kind: "scalar", name: "bigIntField", pythonName: "bigIntField", columnName: "bigIntField", prismaType: "BigInt", pythonType: "int", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "BigInt", args: [] } },
            { kind: "scalar", name: "realField", pythonName: "realField", columnName: "realField", prismaType: "Float", pythonType: "float", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "Real", args: [] } },
            { kind: "scalar", name: "doubleField", pythonName: "doubleField", columnName: "doubleField", prismaType: "Float", pythonType: "float", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "DoublePrecision", args: [] } },
            { kind: "scalar", name: "decimalField", pythonName: "decimalField", columnName: "decimalField", prismaType: "Decimal", pythonType: "Decimal", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: true, defaultValue: 3.14, isUpdatedAt: false, nativeType: { name: "Decimal", args: ["8", "2"] } },
            { kind: "scalar", name: "timestampField", pythonName: "timestampField", columnName: "timestampField", prismaType: "DateTime", pythonType: "datetime", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: true, defaultValue: { name: "now" }, isUpdatedAt: false, nativeType: { name: "Timestamp", args: ["4"] } },
            { kind: "scalar", name: "timestampNoPrecision", pythonName: "timestampNoPrecision", columnName: "timestampNoPrecision", prismaType: "DateTime", pythonType: "datetime", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "Timestamp", args: [] } },
            { kind: "scalar", name: "timestamptzField", pythonName: "timestamptzField", columnName: "timestamptzField", prismaType: "DateTime", pythonType: "datetime", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: true, nativeType: { name: "Timestamptz", args: ["6"] } },
            { kind: "scalar", name: "timestamptzNoPrecision", pythonName: "timestamptzNoPrecision", columnName: "timestamptzNoPrecision", prismaType: "DateTime", pythonType: "datetime", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "Timestamptz", args: [] } },
            { kind: "scalar", name: "dateField", pythonName: "dateField", columnName: "dateField", prismaType: "DateTime", pythonType: "datetime", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "Date", args: [] } },
            { kind: "scalar", name: "timeField", pythonName: "timeField", columnName: "timeField", prismaType: "DateTime", pythonType: "datetime", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "Time", args: ["3"] } },
            { kind: "scalar", name: "timeNoPrecision", pythonName: "timeNoPrecision", columnName: "timeNoPrecision", prismaType: "DateTime", pythonType: "datetime", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "Time", args: [] } },
            { kind: "scalar", name: "timetzField", pythonName: "timetzField", columnName: "timetzField", prismaType: "DateTime", pythonType: "datetime", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "Timetz", args: ["3"] } },
            { kind: "scalar", name: "timetzNoPrecision", pythonName: "timetzNoPrecision", columnName: "timetzNoPrecision", prismaType: "DateTime", pythonType: "datetime", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "Timetz", args: [] } },
            { kind: "scalar", name: "jsonNativeField", pythonName: "jsonNativeField", columnName: "jsonNativeField", prismaType: "Json", pythonType: "Any", isList: false, isNullable: true, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "Json", args: [] } },
            { kind: "scalar", name: "jsonbField", pythonName: "jsonbField", columnName: "jsonbField", prismaType: "Json", pythonType: "Any", isList: false, isNullable: true, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "JsonB", args: [] } },
            { kind: "scalar", name: "byteaField", pythonName: "byteaField", columnName: "byteaField", prismaType: "Bytes", pythonType: "bytes", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "ByteA", args: [] } },
            { kind: "scalar", name: "uuidField", pythonName: "uuidField", columnName: "uuidField", prismaType: "String", pythonType: "str", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: true, defaultValue: { name: "uuid" }, isUpdatedAt: false, nativeType: { name: "Uuid", args: [] } },
            { kind: "scalar", name: "dbgeneratedField", pythonName: "dbgeneratedField", columnName: "dbgeneratedField", prismaType: "String", pythonType: "str", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: true, defaultValue: { name: "dbgenerated", args: ["gen_random_uuid()"] }, isUpdatedAt: false },
            { kind: "scalar", name: "dbgeneratedNoArg", pythonName: "dbgeneratedNoArg", columnName: "dbgeneratedNoArg", prismaType: "String", pythonType: "str", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: true, defaultValue: { name: "dbgenerated", args: [1] }, isUpdatedAt: false },
            { kind: "scalar", name: "unknownGenerated", pythonName: "unknownGenerated", columnName: "unknownGenerated", prismaType: "Int", pythonType: "int", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: true, defaultValue: { name: "other" }, isUpdatedAt: false },
            { kind: "scalar", name: "objectDefaultField", pythonName: "objectDefaultField", columnName: "objectDefaultField", prismaType: "String", pythonType: "str", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: true, defaultValue: { nope: true }, isUpdatedAt: false },
            { kind: "scalar", name: "listScalar", pythonName: "listScalar", columnName: "listScalar", prismaType: "String", pythonType: "str", isList: true, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false },
            { kind: "scalar", name: "enumField", pythonName: "enumField", columnName: "enumField", prismaType: "FancyEnum", pythonType: "FancyEnum", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: true, defaultValue: "ONE", isUpdatedAt: false },
            { kind: "scalar", name: "customField", pythonName: "customField", columnName: "customField", prismaType: "CustomScalar", pythonType: "CustomScalar", isList: false, isNullable: true, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false },
            { kind: "scalar", name: "lowerCustomField", pythonName: "lowerCustomField", columnName: "lowerCustomField", prismaType: "customScalar", pythonType: "customScalar", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false },
            { kind: "scalar", name: "geometryField", pythonName: "geometryField", columnName: "geometryField", prismaType: "String", pythonType: "str", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "Geometry", args: ["1"] } },
            { kind: "scalar", name: "fallbackConstraint", pythonName: "fallbackConstraint", columnName: "fallbackConstraint", prismaType: "String", pythonType: "str", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false },
            { kind: "scalar", name: "foreignId", pythonName: "foreignId", columnName: "foreign_id", prismaType: "Int", pythonType: "int", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, foreignKey: { targetModel: "Target", targetField: "mappedId" } },
            { kind: "scalar", name: "fallbackForeign", pythonName: "fallbackForeign", columnName: "fallbackForeign", prismaType: "Int", pythonType: "int", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, foreignKey: { targetModel: "MissingTarget", targetField: "id" } },
            { kind: "scalar", name: "legacyForeignId", pythonName: "legacyForeignId", columnName: "legacy_foreign_id", prismaType: "Int", pythonType: "int", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, foreignKey: { field: "legacyForeignId", targetModel: "Target", targetField: "mappedId" } }
          ],
          relationFields: [],
          foreignKeys: [{ fields: ["ghostLocalA", "ghostLocalB"], targetModel: "Target", targetFields: ["mappedId", "mappedId"] }]
        },
        {
          name: "Source",
          pythonName: "Source",
          tableName: "sources",
          constraints: [],
          scalarFields: [
            { kind: "scalar", name: "id", pythonName: "id", columnName: "id", prismaType: "Int", pythonType: "int", isList: false, isNullable: false, isId: true, isUnique: false, hasDefaultValue: false, isUpdatedAt: false },
            { kind: "scalar", name: "compositeA", pythonName: "compositeA", columnName: "composite_a", prismaType: "Int", pythonType: "int", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false },
            { kind: "scalar", name: "compositeB", pythonName: "compositeB", columnName: "composite_b", prismaType: "Int", pythonType: "int", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false }
          ],
          foreignKeys: [],
          relationFields: [
            { kind: "relation", name: "owners", pythonName: "owners", targetModel: "Owner", isList: true, isNullable: false, relationName: "Ownership", relationFromFields: [], relationToFields: [], backPopulates: "missingOwners", foreignKeyFieldNames: [] },
            { kind: "relation", name: "fallbacks", pythonName: "fallbacks", targetModel: "FallbackOwner", isList: true, isNullable: false, relationName: "FallbackLink", relationFromFields: [], relationToFields: [], backPopulates: "missingFallbacks", foreignKeyFieldNames: [] },
            { kind: "relation", name: "orphans", pythonName: "orphans", targetModel: "Orphan", isList: true, isNullable: false, relationName: "OrphanLink", relationFromFields: [], relationToFields: [], backPopulates: "missingOrphans", foreignKeyFieldNames: [] },
            { kind: "relation", name: "missingTargetRelation", pythonName: "missingTargetRelation", targetModel: "MissingRelationTarget", isList: false, isNullable: false, relationName: "MissingTargetRel", relationFromFields: [], relationToFields: [], backPopulates: "unknownBackref", foreignKeyFieldNames: [] }
          ]
        },
        {
          name: "Owner",
          pythonName: "Owner",
          tableName: "owners",
          constraints: [],
          scalarFields: [
            { kind: "scalar", name: "id", pythonName: "id", columnName: "id", prismaType: "Int", pythonType: "int", isList: false, isNullable: false, isId: true, isUnique: false, hasDefaultValue: false, isUpdatedAt: false },
            { kind: "scalar", name: "sourceId", pythonName: "sourceId", columnName: "source_id", prismaType: "Int", pythonType: "int", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false }
          ],
          foreignKeys: [],
          relationFields: [
            { kind: "relation", name: "sourceLink", pythonName: "sourceLink", targetModel: "Source", isList: false, isNullable: false, relationName: "Ownership", relationFromFields: ["sourceId"], relationToFields: ["id"], backPopulates: "owners", foreignKeyFieldNames: ["sourceId"] },
            { kind: "relation", name: "compositeSource", pythonName: "compositeSource", targetModel: "Source", isList: false, isNullable: false, relationName: "CompositeOwnership", relationFromFields: ["sourceId", "id"], relationToFields: ["compositeA", "compositeB"], backPopulates: "unusedComposite", foreignKeyFieldNames: ["sourceId", "id"] }
          ]
        },
        {
          name: "FallbackOwner",
          pythonName: "FallbackOwner",
          tableName: "fallback_owners",
          constraints: [],
          scalarFields: [
            { kind: "scalar", name: "id", pythonName: "id", columnName: "id", prismaType: "Int", pythonType: "int", isList: false, isNullable: false, isId: true, isUnique: false, hasDefaultValue: false, isUpdatedAt: false },
            { kind: "scalar", name: "sourceId", pythonName: "sourceId", columnName: "source_id", prismaType: "Int", pythonType: "int", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false }
          ],
          foreignKeys: [],
          relationFields: [
            { kind: "relation", name: "otherSide", pythonName: "otherSide", targetModel: "Source", isList: false, isNullable: false, relationName: "SomethingElse", relationFromFields: ["sourceId"], relationToFields: ["id"], backPopulates: "fallbacks", foreignKeyFieldNames: ["sourceId"] }
          ]
        },
        {
          name: "Orphan",
          pythonName: "Orphan",
          tableName: "orphans",
          constraints: [],
          foreignKeys: [],
          scalarFields: [{ kind: "scalar", name: "id", pythonName: "id", columnName: "id", prismaType: "Int", pythonType: "int", isList: false, isNullable: false, isId: true, isUnique: false, hasDefaultValue: false, isUpdatedAt: false }],
          relationFields: [{ kind: "relation", name: "other", pythonName: "other", targetModel: "Source", isList: false, isNullable: false, relationName: "OrphanLink", relationFromFields: [], relationToFields: [], backPopulates: "notOrphans", foreignKeyFieldNames: [] }]
        },
        {
          name: "Target",
          pythonName: "Target",
          tableName: "targets",
          constraints: [],
          scalarFields: [
            { kind: "scalar", name: "mappedId", pythonName: "mappedId", columnName: "mapped_id", prismaType: "Int", pythonType: "int", isList: false, isNullable: false, isId: true, isUnique: false, hasDefaultValue: false, isUpdatedAt: false }
          ],
          foreignKeys: [],
          relationFields: []
        },
        {
          name: "Bare",
          pythonName: "Bare",
          tableName: "bare",
          constraints: [],
          foreignKeys: [],
          scalarFields: [],
          relationFields: []
        },
        {
          name: "Node",
          pythonName: "Node",
          tableName: "nodes",
          constraints: [],
          scalarFields: [
            { kind: "scalar", name: "leftId", pythonName: "leftId", columnName: "left_id", prismaType: "Int", pythonType: "int", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false },
            { kind: "scalar", name: "rightId", pythonName: "rightId", columnName: "right_id", prismaType: "Int", pythonType: "int", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false }
          ],
          foreignKeys: [],
          relationFields: [
            { kind: "relation", name: "pair", pythonName: "pair", targetModel: "Node", isList: false, isNullable: false, relationName: "NodePair", relationFromFields: ["leftId", "rightId"], relationToFields: ["leftId", "rightId"], backPopulates: "pairBack", foreignKeyFieldNames: ["leftId", "rightId"] },
            { kind: "relation", name: "pairBack", pythonName: "pairBack", targetModel: "Node", isList: true, isNullable: false, relationName: "NodePair", relationFromFields: [], relationToFields: [], backPopulates: "pair", foreignKeyFieldNames: [] }
          ]
        }
      ]
    } as any;

    const mysqlSchema = {
      provider: "mysql",
      enums: [],
      models: [
        {
          name: "MysqlThing",
          pythonName: "MysqlThing",
          tableName: "mysql_things",
          constraints: [],
          scalarFields: [
            { kind: "scalar", name: "charField", pythonName: "charField", columnName: "charField", prismaType: "String", pythonType: "str", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "Char", args: ["2"] } },
            { kind: "scalar", name: "textField", pythonName: "textField", columnName: "textField", prismaType: "String", pythonType: "str", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "Text", args: [] } },
            { kind: "scalar", name: "tinyTextField", pythonName: "tinyTextField", columnName: "tinyTextField", prismaType: "String", pythonType: "str", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "TinyText", args: [] } },
            { kind: "scalar", name: "mediumTextField", pythonName: "mediumTextField", columnName: "mediumTextField", prismaType: "String", pythonType: "str", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "MediumText", args: [] } },
            { kind: "scalar", name: "longTextField", pythonName: "longTextField", columnName: "longTextField", prismaType: "String", pythonType: "str", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "LongText", args: [] } },
            { kind: "scalar", name: "tinyIntField", pythonName: "tinyIntField", columnName: "tinyIntField", prismaType: "Int", pythonType: "int", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "TinyInt", args: [] } },
            { kind: "scalar", name: "smallIntField", pythonName: "smallIntField", columnName: "smallIntField", prismaType: "Int", pythonType: "int", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "SmallInt", args: [] } },
            { kind: "scalar", name: "mediumIntField", pythonName: "mediumIntField", columnName: "mediumIntField", prismaType: "Int", pythonType: "int", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "MediumInt", args: [] } },
            { kind: "scalar", name: "intField", pythonName: "intField", columnName: "intField", prismaType: "Int", pythonType: "int", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "Int", args: [] } },
            { kind: "scalar", name: "bigIntField", pythonName: "bigIntField", columnName: "bigIntField", prismaType: "BigInt", pythonType: "int", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "BigInt", args: [] } },
            { kind: "scalar", name: "unsignedTinyIntField", pythonName: "unsignedTinyIntField", columnName: "unsignedTinyIntField", prismaType: "Int", pythonType: "int", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "UnsignedTinyInt", args: [] } },
            { kind: "scalar", name: "unsignedSmallIntField", pythonName: "unsignedSmallIntField", columnName: "unsignedSmallIntField", prismaType: "Int", pythonType: "int", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "UnsignedSmallInt", args: [] } },
            { kind: "scalar", name: "unsignedMediumIntField", pythonName: "unsignedMediumIntField", columnName: "unsignedMediumIntField", prismaType: "Int", pythonType: "int", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "UnsignedMediumInt", args: [] } },
            { kind: "scalar", name: "unsignedIntField", pythonName: "unsignedIntField", columnName: "unsignedIntField", prismaType: "Int", pythonType: "int", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "UnsignedInt", args: [] } },
            { kind: "scalar", name: "unsignedBigIntField", pythonName: "unsignedBigIntField", columnName: "unsignedBigIntField", prismaType: "BigInt", pythonType: "int", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "UnsignedBigInt", args: [] } },
            { kind: "scalar", name: "decimalField", pythonName: "decimalField", columnName: "decimalField", prismaType: "Decimal", pythonType: "Decimal", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "Decimal", args: ["6", "2"] } },
            { kind: "scalar", name: "floatField", pythonName: "floatField", columnName: "floatField", prismaType: "Float", pythonType: "float", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "Float", args: [] } },
            { kind: "scalar", name: "doubleField", pythonName: "doubleField", columnName: "doubleField", prismaType: "Float", pythonType: "float", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "Double", args: [] } },
            { kind: "scalar", name: "dateTimeField", pythonName: "dateTimeField", columnName: "dateTimeField", prismaType: "DateTime", pythonType: "datetime", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "DateTime", args: ["3"] } },
            { kind: "scalar", name: "timestampField", pythonName: "timestampField", columnName: "timestampField", prismaType: "DateTime", pythonType: "datetime", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "Timestamp", args: ["6"] } },
            { kind: "scalar", name: "dateField", pythonName: "dateField", columnName: "dateField", prismaType: "DateTime", pythonType: "datetime", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "Date", args: [] } },
            { kind: "scalar", name: "timeField", pythonName: "timeField", columnName: "timeField", prismaType: "DateTime", pythonType: "datetime", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "Time", args: [] } },
            { kind: "scalar", name: "yearField", pythonName: "yearField", columnName: "yearField", prismaType: "Int", pythonType: "int", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "Year", args: [] } },
            { kind: "scalar", name: "jsonField", pythonName: "jsonField", columnName: "jsonField", prismaType: "Json", pythonType: "Any", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "Json", args: [] } },
            { kind: "scalar", name: "binaryField", pythonName: "binaryField", columnName: "binaryField", prismaType: "Bytes", pythonType: "bytes", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "Binary", args: ["8"] } },
            { kind: "scalar", name: "varBinaryField", pythonName: "varBinaryField", columnName: "varBinaryField", prismaType: "Bytes", pythonType: "bytes", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "VarBinary", args: ["8"] } },
            { kind: "scalar", name: "tinyBlobField", pythonName: "tinyBlobField", columnName: "tinyBlobField", prismaType: "Bytes", pythonType: "bytes", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "TinyBlob", args: [] } },
            { kind: "scalar", name: "blobField", pythonName: "blobField", columnName: "blobField", prismaType: "Bytes", pythonType: "bytes", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "Blob", args: [] } },
            { kind: "scalar", name: "mediumBlobField", pythonName: "mediumBlobField", columnName: "mediumBlobField", prismaType: "Bytes", pythonType: "bytes", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "MediumBlob", args: [] } },
            { kind: "scalar", name: "longBlobField", pythonName: "longBlobField", columnName: "longBlobField", prismaType: "Bytes", pythonType: "bytes", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "LongBlob", args: [] } },
            { kind: "scalar", name: "fallbackField", pythonName: "fallbackField", columnName: "fallbackField", prismaType: "String", pythonType: "str", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "Geometry", args: ["1"] } }
          ],
          relationFields: []
        }
      ]
    } as any;

    const postgresRendered = renderPythonModule(postgresSchema, {
      moduleName: "models.py",
      headerComment: false,
      schemaHash: "hash",
      packageVersion: PACKAGE_VERSION
    });
    const mysqlRendered = renderPythonModule(mysqlSchema, {
      moduleName: "models.py",
      headerComment: true,
      schemaHash: "hash",
      packageVersion: PACKAGE_VERSION
    });

    expect(postgresRendered).toContain("from uuid import uuid4");
    expect(postgresRendered).toContain("ARRAY(String())");
    expect(postgresRendered).toContain("server_default=text('gen_random_uuid()')");
    expect(postgresRendered).toContain("UUID(as_uuid=True)");
    expect(postgresRendered).toContain("TIMESTAMP(precision=6, timezone=True)");
    expect(postgresRendered).toContain("TIMESTAMP()");
    expect(postgresRendered).toContain("TIMESTAMP(timezone=True)");
    expect(postgresRendered).toContain("TIME(precision=3, timezone=True)");
    expect(postgresRendered).toContain("TIME()");
    expect(postgresRendered).toContain("TIME(timezone=True)");
    expect(postgresRendered).toContain("from sqlalchemy import ");
    expect(postgresRendered).toContain("BigInteger");
    expect(postgresRendered).toContain("Boolean");
    expect(postgresRendered).toContain("DateTime");
    expect(postgresRendered).toContain("LargeBinary");
    expect(postgresRendered).toContain("Numeric");
    expect(postgresRendered).toContain("from sqlalchemy.dialects.postgresql import");
    expect(postgresRendered).toContain("JSONB");
    expect(postgresRendered).toContain("BYTEA()");
    expect(postgresRendered).toContain("INTEGER()");
    expect(postgresRendered).toContain("GEOMETRY(1)");
    expect(postgresRendered).toContain("default=False");
    expect(postgresRendered).toContain("MissingTarget.id");
    expect(postgresRendered).toContain("targets.mapped_id");
    expect(postgresRendered).toContain("legacy_foreign_id', Integer(), ForeignKey('targets.mapped_id'), nullable=False");
    expect(postgresRendered).toContain("ForeignKeyConstraint(['ghostLocalA', 'ghostLocalB'], ['targets.mapped_id', 'targets.mapped_id'])");
    expect(postgresRendered).toContain("UniqueConstraint('missingConstraintField', name='uq_missing')");
    expect(postgresRendered).toContain("owners: list['Owner'] = Relationship(back_populates='missingOwners', sa_relationship_kwargs={\"foreign_keys\": 'Owner.sourceId'})");
    expect(postgresRendered).toContain("fallbacks: list['FallbackOwner'] = Relationship(back_populates='missingFallbacks', sa_relationship_kwargs={\"foreign_keys\": 'FallbackOwner.sourceId'})");
    expect(postgresRendered).toContain("orphans: list['Orphan'] = Relationship(back_populates='missingOrphans')");
    expect(postgresRendered).toContain("missingTargetRelation: 'MissingRelationTarget' = Relationship(back_populates='unknownBackref')");
    expect(postgresRendered).toContain("compositeSource: 'Source' = Relationship(back_populates='unusedComposite', sa_relationship_kwargs={\"foreign_keys\": '[Owner.sourceId, Owner.id]'})");
    expect(postgresRendered).toContain("pair: 'Node' = Relationship(back_populates='pairBack', sa_relationship_kwargs={\"foreign_keys\": '[Node.leftId, Node.rightId]', \"remote_side\": '[Node.leftId, Node.rightId]'})");
    expect(postgresRendered).toContain("class Bare(SQLModel, table=True):\n    __tablename__ = 'bare'\n    pass");
    expect(postgresRendered).toContain("# Prisma model '123Bad' emitted as Python class '_23Bad'.");

    expect(mysqlRendered).toContain(`# Package version: ${PACKAGE_VERSION}`);
    expect(mysqlRendered).toContain("from sqlalchemy.dialects.mysql import");
    expect(mysqlRendered).toContain("TINYTEXT()");
    expect(mysqlRendered).toContain("MEDIUMINT(unsigned=True)");
    expect(mysqlRendered).toContain("INTEGER(unsigned=True)");
    expect(mysqlRendered).toContain("LONGBLOB()");
    expect(mysqlRendered).toContain("GEOMETRY(1)");
  });

  it("covers new implicit many-to-many, enum schema, and native-type expansion branches", () => {
    const compatibilityMetadata = {
      provider: "postgresql",
      models: new Map([
        [
          "User",
          makeModelMetadata({
            tableName: "users",
            fieldLocations: new Map([["friends", { line: 4, column: 3 }]])
          })
        ]
      ]),
      modelLocations: new Map(),
      fieldLocations: new Map([
        [
          "User",
          new Map([["friends", { line: 4, column: 3 }]])
        ]
      ])
    } as any;

    const selfImplicitDmmf = {
      datamodel: {
        indexes: [{ model: "User", type: "id", fields: [{ name: "id" }] }],
        enums: [],
        models: [
          {
            name: "User",
            fields: [
              { kind: "scalar", name: "id", type: "Int", isList: false, isRequired: true, isId: true, isUnique: false, hasDefaultValue: false },
              { kind: "object", name: "friends", type: "User", isList: true, relationName: "FriendLinks", relationFromFields: [], relationToFields: [] },
              { kind: "object", name: "friendedBy", type: "User", isList: true, relationName: "FriendLinks", relationFromFields: [], relationToFields: [] }
            ]
          }
        ]
      }
    };

    expect(compatibility.collectCompatibilityDiagnostics(selfImplicitDmmf, compatibilityMetadata, true)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "UNSUPPORTED_IMPLICIT_M2M_SHAPE",
          field: "friends"
        })
      ])
    );

    const customImplicitMetadata = {
      provider: "postgresql",
      relationMode: "foreignKeys",
      models: new Map([
        ["Post", makeModelMetadata({ tableName: "Post" })],
        ["Tag", makeModelMetadata({ tableName: "Tag" })]
      ]),
      modelLocations: new Map(),
      fieldLocations: new Map([
        ["Post", new Map()],
        ["Tag", new Map()]
      ])
    } as any;

    const customImplicitDmmf = {
      datamodel: {
        indexes: [
          { model: "Post", type: "id", fields: [{ name: "id" }] },
          { model: "Tag", type: "id", fields: [{ name: "id" }] }
        ],
        enums: [],
        models: [
          {
            name: "Post",
            fields: [
              { kind: "scalar", name: "id", type: "Int", isList: false, isRequired: true, isId: true, isUnique: false, hasDefaultValue: false },
              { kind: "object", name: "customTags", type: "Tag", isList: true, isRequired: true, relationName: "CustomLink", relationFromFields: [], relationToFields: [] }
            ]
          },
          {
            name: "Tag",
            fields: [
              { kind: "scalar", name: "id", type: "Int", isList: false, isRequired: true, isId: true, isUnique: false, hasDefaultValue: false },
              { kind: "object", name: "customPosts", type: "Post", isList: true, isRequired: true, relationName: "CustomLink", relationFromFields: [], relationToFields: [] }
            ]
          }
        ]
      }
    };

    const customImplicitDefinition = buildSchemaDefinition(customImplicitDmmf, customImplicitMetadata);
    expect(customImplicitDefinition.models.find((model) => model.isGeneratedLinkModel)?.tableName).toBe("_CustomLink");

    const selfImplicitDefinition = buildSchemaDefinition(selfImplicitDmmf, compatibilityMetadata);
    expect(selfImplicitDefinition.models.find((model) => model.isGeneratedLinkModel)?.tableName).toBe("_FriendLinks");

    const reorderedImplicitDefinition = buildSchemaDefinition(
      {
        datamodel: {
          indexes: [
            { model: "Zebra", type: "id", fields: [{ name: "id" }] },
            { model: "Alpha", type: "id", fields: [{ name: "id" }] }
          ],
          enums: [],
          models: [
            {
              name: "Zebra",
              fields: [
                { kind: "scalar", name: "id", type: "Int", isList: false, isRequired: true, isId: true, isUnique: false, hasDefaultValue: false },
                { kind: "object", name: "alphas", type: "Alpha", isList: true, isRequired: true, relationName: "AlphabetSoup", relationFromFields: [], relationToFields: [] }
              ]
            },
            {
              name: "Alpha",
              fields: [
                { kind: "scalar", name: "id", type: "Int", isList: false, isRequired: true, isId: true, isUnique: false, hasDefaultValue: false },
                { kind: "object", name: "zebras", type: "Zebra", isList: true, isRequired: true, relationName: "AlphabetSoup", relationFromFields: [], relationToFields: [] }
              ]
            }
          ]
        }
      },
      {
        provider: "postgresql",
        relationMode: "foreignKeys",
        models: new Map([
          ["Zebra", makeModelMetadata({ tableName: "Zebra" })],
          ["Alpha", makeModelMetadata({ tableName: "Alpha" })]
        ]),
        modelLocations: new Map(),
        fieldLocations: new Map([
          ["Zebra", new Map()],
          ["Alpha", new Map()]
        ])
      } as any
    );
    expect(reorderedImplicitDefinition.models.find((model) => model.isGeneratedLinkModel)?.tableName).toBe("_AlphabetSoup");

    const invalidImplicitDmmf = {
      datamodel: {
        indexes: [],
        enums: [],
        models: [
          {
            name: "A",
            fields: [
              { kind: "object", name: "bs", type: "B", isList: true, isRequired: true, relationName: "ABLinks", relationFromFields: [], relationToFields: [] }
            ]
          },
          {
            name: "B",
            fields: [
              { kind: "object", name: "as", type: "A", isList: true, isRequired: true, relationName: "ABLinks", relationFromFields: [], relationToFields: [] }
            ]
          }
        ]
      }
    };

    const invalidImplicitMetadata = {
      provider: "postgresql",
      relationMode: "foreignKeys",
      models: new Map([
        ["A", makeModelMetadata({ tableName: "A" })],
        ["B", makeModelMetadata({ tableName: "B" })]
      ]),
      modelLocations: new Map(),
      fieldLocations: new Map([
        ["A", new Map()],
        ["B", new Map()]
      ])
    } as any;

    expect(() => buildSchemaDefinition(invalidImplicitDmmf, invalidImplicitMetadata)).toThrow(
      "does not have a single-column primary key suitable for implicit many-to-many synthesis"
    );

    const missingCounterpartDefinition = buildSchemaDefinition(
      {
        datamodel: {
          indexes: [{ model: "Lonely", type: "id", fields: [{ name: "id" }] }],
          enums: [],
          models: [
            {
              name: "Lonely",
              fields: [
                { kind: "scalar", name: "id", type: "Int", isList: false, isRequired: true, isId: true, isUnique: false, hasDefaultValue: false },
                { kind: "object", name: "ghosts", type: "Missing", isList: true, isRequired: true, relationName: "GhostLink", relationFromFields: [], relationToFields: [] }
              ]
            }
          ]
        }
      },
      {
        provider: "postgresql",
        relationMode: "foreignKeys",
        models: new Map([["Lonely", makeModelMetadata({ tableName: "Lonely" })]]),
        modelLocations: new Map(),
        fieldLocations: new Map([["Lonely", new Map()]])
      } as any
    );
    expect(missingCounterpartDefinition.models).toHaveLength(1);

    const undefinedDefaultDefinition = buildSchemaDefinition(
      {
        datamodel: {
          indexes: [],
          enums: [],
          models: [
            {
              name: "Odd",
              fields: [
                {
                  kind: "scalar",
                  name: "value",
                  type: "String",
                  isList: false,
                  isRequired: true,
                  isId: false,
                  isUnique: false,
                  hasDefaultValue: true,
                  default: undefined
                }
              ]
            }
          ]
        }
      },
      {
        provider: "postgresql",
        relationMode: "foreignKeys",
        models: new Map([["Odd", makeModelMetadata({ tableName: "Odd" })]]),
        modelLocations: new Map(),
        fieldLocations: new Map([["Odd", new Map()]])
      } as any
    );
    expect(undefinedDefaultDefinition.models[0].scalarFields[0]?.defaultKind).toBeUndefined();

    const invalidSortDefinition = buildSchemaDefinition(
      {
        datamodel: {
          indexes: [
            {
              model: "Sorted",
              type: "index",
              dbName: "sorted_idx",
              fields: [{ name: "label", sortOrder: "Sideways" }]
            }
          ],
          enums: [],
          models: [
            {
              name: "Sorted",
              fields: [
                {
                  kind: "scalar",
                  name: "label",
                  type: "String",
                  isList: false,
                  isRequired: true,
                  isId: false,
                  isUnique: false,
                  hasDefaultValue: false
                }
              ]
            }
          ]
        }
      },
      {
        provider: "postgresql",
        relationMode: "foreignKeys",
        models: new Map([["Sorted", makeModelMetadata({ tableName: "Sorted" })]]),
        modelLocations: new Map(),
        fieldLocations: new Map([["Sorted", new Map()]])
      } as any
    );
    expect(invalidSortDefinition.models[0].constraints[0]?.fields[0]?.sort).toBeUndefined();

    const postgresRendered = renderPythonModule(
      {
        provider: "postgresql",
        enums: [
          {
            name: "FancyEnum",
            pythonName: "FancyEnum",
            values: [{ name: "ONE", pythonName: "ONE", value: "one" }]
          }
        ],
        models: [
          {
            name: "Parent",
            pythonName: "Parent",
            tableName: "parents",
            tableSchema: "tenant_a",
            constraints: [{ kind: "index", name: "ix_parent_xml", fields: [{ name: "xmlField", length: 4 }] }],
            foreignKeys: [],
            scalarFields: [
              { kind: "scalar", name: "status", pythonName: "status", columnName: "status", prismaType: "FancyEnum", pythonType: "FancyEnum", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false },
              { kind: "scalar", name: "xmlField", pythonName: "xmlField", columnName: "xmlField", prismaType: "String", pythonType: "str", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "Xml", args: [] } },
              { kind: "scalar", name: "inetField", pythonName: "inetField", columnName: "inetField", prismaType: "String", pythonType: "str", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "Inet", args: [] } },
              { kind: "scalar", name: "citextField", pythonName: "citextField", columnName: "citextField", prismaType: "String", pythonType: "str", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false, nativeType: { name: "Citext", args: [] } }
            ],
            relationFields: [
              {
                kind: "relation",
                name: "children",
                pythonName: "children",
                targetModel: "Child",
                isList: true,
                isNullable: false,
                relationName: "FallbackBranch",
                relationFromFields: [],
                relationToFields: [],
                backPopulates: "missingChildren",
                foreignKeyFieldNames: []
              }
            ]
          },
          {
            name: "Child",
            pythonName: "Child",
            tableName: "children",
            constraints: [],
            foreignKeys: [],
            scalarFields: [
              { kind: "scalar", name: "parentId", pythonName: "parentId", columnName: "parent_id", prismaType: "Int", pythonType: "int", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false }
            ],
            relationFields: [
              {
                kind: "relation",
                name: "owner",
                pythonName: "owner",
                targetModel: "Parent",
                isList: false,
                isNullable: false,
                relationName: "DifferentName",
                relationFromFields: ["parentId"],
                relationToFields: ["id"],
                backPopulates: "children",
                foreignKeyFieldNames: ["parentId"]
              }
            ]
          }
        ]
      } as any,
      {
        moduleName: "models.py",
        headerComment: false,
        schemaHash: "hash",
        packageVersion: PACKAGE_VERSION
      }
    );

    expect(postgresRendered).toContain("SAEnum(FancyEnum, name='FancyEnum', schema='tenant_a')");
    expect(postgresRendered).toContain("from sqlalchemy.dialects.postgresql import CITEXT, INET, XML");
    expect(postgresRendered).toContain("children: list['Child'] = Relationship(back_populates='missingChildren', sa_relationship_kwargs={\"foreign_keys\": 'Child.parentId'})");
    expect(postgresRendered).toContain("Index('ix_parent_xml', 'xmlField')");

    const mysqlRendered = renderPythonModule(
      {
        provider: "mysql",
        enums: [],
        models: [
          {
            name: "Keyworded",
            pythonName: "Keyworded",
            tableName: "keyworded",
            constraints: [
              { kind: "unique", name: "uq_keyworded_slug", fields: [{ name: "slug", length: 8 }] },
              { kind: "index", name: "ix_keyworded_from", fields: [{ name: "from" }] },
              { kind: "index", name: "ix_keyworded_slug", fields: [{ name: "slug", sort: "asc" }] },
              { kind: "index", fields: [{ name: "missingField", length: 5 }] },
              { kind: "index", fields: [{ name: "slug" }] }
            ],
            foreignKeys: [],
            scalarFields: [
              { kind: "scalar", name: "from", pythonName: "from_", columnName: "from", prismaType: "String", pythonType: "str", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false },
              { kind: "scalar", name: "slug", pythonName: "slug", columnName: "slug", prismaType: "String", pythonType: "str", isList: false, isNullable: false, isId: false, isUnique: false, hasDefaultValue: false, isUpdatedAt: false }
            ],
            relationFields: []
          }
        ]
      } as any,
      {
        moduleName: "models.py",
        headerComment: false,
        schemaHash: "hash",
        packageVersion: PACKAGE_VERSION
      }
    );

    expect(mysqlRendered).toContain("Index('ix_keyworded_from', 'from')");
    expect(mysqlRendered).toContain("Index('ix_keyworded_slug', asc('slug'))");
    expect(mysqlRendered).toContain("Index('uq_keyworded_slug', 'slug', unique=True, mysql_length={'slug': 8})");
    expect(mysqlRendered).toContain("Index('missingField', mysql_length={'missingField': 5})");
    expect(mysqlRendered).toContain("Index('slug')");
  });
});

describe("version resolution", () => {
  it("uses the installed package version when available and falls back otherwise", () => {
    const originalInjectedVersion = process.env.PRISMA_SQLMODEL_GEN_PACKAGE_VERSION;

    try {
      process.env.PRISMA_SQLMODEL_GEN_PACKAGE_VERSION = "1.2.3";
      expect(resolvePackageVersion()).toBe("1.2.3");
    } finally {
      if (originalInjectedVersion === undefined) {
        delete process.env.PRISMA_SQLMODEL_GEN_PACKAGE_VERSION;
      } else {
        process.env.PRISMA_SQLMODEL_GEN_PACKAGE_VERSION = originalInjectedVersion;
      }
    }

    expect(resolvePackageVersion("   ", () => ({ version: "9.9.9" }))).toBe("9.9.9");
    expect(resolvePackageVersion(undefined, () => ({ version: "   " }))).toBe("0.0.0");
    expect(resolvePackageVersion(undefined, () => {
      throw new Error("boom");
    })).toBe("0.0.0");
  });
});

describe("entrypoints", () => {
  const originalArgv = process.argv.slice();
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    process.argv = originalArgv.slice();
    process.exitCode = originalExitCode;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    process.argv = originalArgv.slice();
    process.exitCode = originalExitCode;
  });

  async function importCliWithMocks(options: {
    argv: string[];
    readFile?: ReturnType<typeof vi.fn>;
    getConfig?: ReturnType<typeof vi.fn>;
    getDMMF?: ReturnType<typeof vi.fn>;
    resolveGeneratorConfig?: ReturnType<typeof vi.fn>;
    resolveOutputDir?: ReturnType<typeof vi.fn>;
    generateSqlModel?: ReturnType<typeof vi.fn>;
    checkSqlModelGeneration?: ReturnType<typeof vi.fn>;
    formatDiagnostics?: ReturnType<typeof vi.fn>;
  }) {
    vi.resetModules();
    const readFile = options.readFile ?? vi.fn().mockResolvedValue("datasource db { provider = \"postgresql\" }");
    const getConfig =
      options.getConfig ??
      vi.fn().mockResolvedValue({
        generators: [
          {
            name: "sqlmodel",
            provider: { value: "prisma-sqlmodel-gen" },
            output: { value: "./generated/sqlmodel" },
            config: {}
          }
        ],
        datasources: []
      });
    const getDMMF = options.getDMMF ?? vi.fn().mockResolvedValue({ datamodel: { models: [], enums: [] } });
    const resolveGeneratorConfigMock =
      options.resolveGeneratorConfig ?? vi.fn().mockReturnValue(resolveGeneratorConfig(undefined));
    const resolveOutputDirMock =
      options.resolveOutputDir ?? vi.fn().mockReturnValue("/tmp/generated/sqlmodel");
    const generateSqlModelMock = options.generateSqlModel ?? vi.fn().mockResolvedValue({ files: [], diagnostics: [] });
    const checkSqlModelGenerationMock =
      options.checkSqlModelGeneration ?? vi.fn().mockResolvedValue({ files: [], diagnostics: [] });
    const formatDiagnosticsMock = options.formatDiagnostics ?? vi.fn().mockReturnValue("formatted diagnostics");

    vi.doMock("node:fs/promises", () => ({ readFile }));
    vi.doMock("@prisma/internals", () => ({
      default: {
        getConfig,
        getDMMF
      }
    }));
    vi.doMock("../src/config.js", () => ({
      resolveGeneratorConfig: resolveGeneratorConfigMock,
      resolveOutputDir: resolveOutputDirMock
    }));
    vi.doMock("../src/generate.js", () => ({
      generateSqlModel: generateSqlModelMock,
      checkSqlModelGeneration: checkSqlModelGenerationMock
    }));
    vi.doMock("../src/diagnostics.js", async () => {
      const actual = await vi.importActual<typeof import("../src/diagnostics.js")>("../src/diagnostics.js");
      return {
        ...actual,
        formatDiagnostics: formatDiagnosticsMock
      };
    });

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    process.argv = ["node", "cli", ...options.argv];

    await import("../src/cli.js");
    await new Promise((resolve) => setTimeout(resolve, 0));

    return {
      readFile,
      getConfig,
      getDMMF,
      resolveGeneratorConfigMock,
      resolveOutputDirMock,
      generateSqlModelMock,
      checkSqlModelGenerationMock,
      formatDiagnosticsMock,
      consoleError
    };
  }

  it("covers the CLI success path for generate and check", async () => {
    const first = await importCliWithMocks({
      argv: [
        "--schema",
        "/tmp/schema.prisma",
        "--generator",
        "sqlmodel",
        "--module-name",
        "custom",
        "--emit-init"
      ]
    });
    expect(first.readFile).toHaveBeenCalledWith(path.resolve("/tmp/schema.prisma"), "utf8");
    expect(first.generateSqlModelMock).toHaveBeenCalledOnce();
    expect(first.checkSqlModelGenerationMock).not.toHaveBeenCalled();

    const second = await importCliWithMocks({
      argv: ["--schema", "/tmp/schema.prisma", "--output", "/tmp/out", "--check", "--no-emit-init"],
      getConfig: vi.fn().mockResolvedValue({ generators: [], datasources: [] })
    });
    expect(second.checkSqlModelGenerationMock).toHaveBeenCalledOnce();
    expect(second.generateSqlModelMock).not.toHaveBeenCalled();
  });

  it("covers CLI error handling branches", async () => {
    const missingSchema = await importCliWithMocks({
      argv: []
    });
    expect(missingSchema.consoleError).toHaveBeenCalledWith("Missing required --schema argument.");

    const noGenerator = await importCliWithMocks({
      argv: ["--schema", "/tmp/schema.prisma"],
      getConfig: vi.fn().mockResolvedValue({ generators: [], datasources: [] })
    });
    expect(noGenerator.consoleError).toHaveBeenCalledWith(
      "No SQLModel generator block found. Provide --output or add a generator block."
    );

    const diagnosticError = new DiagnosticError("bad schema", [{ code: "X", severity: "error", message: "bad" }]);
    const formatted = await importCliWithMocks({
      argv: ["--schema", "/tmp/schema.prisma"],
      generateSqlModel: vi.fn().mockRejectedValue(diagnosticError)
    });
    expect(formatted.consoleError).toHaveBeenCalledWith("formatted diagnostics");
    expect(process.exitCode).toBe(1);

    const unknown = await importCliWithMocks({
      argv: ["--schema", "/tmp/schema.prisma", "--wat"]
    });
    expect(unknown.consoleError).toHaveBeenCalledWith("Unknown argument: --wat");
    expect(process.exitCode).toBe(1);

    const generic = await importCliWithMocks({
      argv: ["--schema", "/tmp/schema.prisma"],
      generateSqlModel: vi.fn().mockRejectedValue(new Error("explode"))
    });
    expect(generic.consoleError).toHaveBeenCalledWith("explode");
    expect(process.exitCode).toBe(1);

    const primitive = await importCliWithMocks({
      argv: ["--schema", "/tmp/schema.prisma"],
      generateSqlModel: vi.fn().mockRejectedValue("string failure")
    });
    expect(primitive.consoleError).toHaveBeenCalledWith("string failure");
    expect(process.exitCode).toBe(1);
  });

  it("covers the generator entrypoint", async () => {
    let capturedHandlers: any;
    const generatorHandler = vi.fn((handlers) => {
      capturedHandlers = handlers;
    });
    const resolveGeneratorConfigMock = vi.fn().mockReturnValue(resolveGeneratorConfig(undefined));
    const resolveOutputDirMock = vi.fn().mockReturnValue("/tmp/output");
    const generateSqlModelMock = vi.fn().mockResolvedValue({ files: [], diagnostics: [] });

    vi.doMock("@prisma/generator-helper", () => ({
      default: {
        generatorHandler
      }
    }));
    vi.doMock("../src/config.js", () => ({
      resolveGeneratorConfig: resolveGeneratorConfigMock,
      resolveOutputDir: resolveOutputDirMock
    }));
    vi.doMock("../src/generate.js", () => ({
      generateSqlModel: generateSqlModelMock
    }));
    vi.doMock("../src/diagnostics.js", async () => {
      const actual = await vi.importActual<typeof import("../src/diagnostics.js")>("../src/diagnostics.js");
      return {
        ...actual,
        formatDiagnostics: vi.fn().mockReturnValue("formatted from generator")
      };
    });

    await import("../src/generator.js");
    expect(generatorHandler).toHaveBeenCalledOnce();
    expect(capturedHandlers.onManifest()).toEqual({
      prettyName: "Prisma SQLModel Gen",
      defaultOutput: "./generated/sqlmodel"
    });

    const options = {
      generator: {
        name: "sqlmodel",
        provider: { value: "prisma-sqlmodel-gen" },
        output: { value: "./generated/sqlmodel" },
        config: {}
      },
      schemaPath: "/tmp/schema.prisma",
      datamodel: "datasource db { provider = \"postgresql\" }",
      dmmf: { datamodel: { models: [], enums: [] } }
    };
    await capturedHandlers.onGenerate(options);
    expect(generateSqlModelMock).toHaveBeenCalledOnce();

    generateSqlModelMock.mockRejectedValueOnce(
      new DiagnosticError("bad schema", [{ code: "X", severity: "error", message: "bad" }])
    );
    await expect(capturedHandlers.onGenerate(options)).rejects.toThrow("bad schema\nformatted from generator");

    generateSqlModelMock.mockRejectedValueOnce(new Error("plain failure"));
    await expect(capturedHandlers.onGenerate(options)).rejects.toThrow("plain failure");
  });
});

describe("generate check branches", () => {
  it("covers stale init and emitInit false branches", async () => {
    const datamodel = `datasource db {
  provider = "postgresql"
}

generator sqlmodel {
  provider = "prisma-sqlmodel-gen"
  output   = "./generated/sqlmodel"
}

model User {
  id Int @id @default(autoincrement())
}`;
    const dmmf = {
      datamodel: {
        enums: [],
        models: [
          {
            name: "User",
            fields: [{ kind: "scalar", name: "id", type: "Int", isList: false, isRequired: true, isId: true, isUnique: false, hasDefaultValue: true, default: { name: "autoincrement" } }]
          }
        ]
      }
    };
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "prisma-sqlmodel-check-"));
    const input = {
      dmmf,
      schemaPath: "/virtual/schema.prisma",
      datamodel,
      outputDir,
      config: resolveGeneratorConfig(undefined)
    } as any;

    await generateSqlModel(input);
    await expect(checkSqlModelGeneration(input)).resolves.toMatchObject({
      files: [path.join(outputDir, "models.py")]
    });
    await writeFile(path.join(outputDir, "__init__.py"), "stale\n", "utf8");
    await expect(checkSqlModelGeneration(input)).rejects.toThrow("__init__.py");

    const noInitInput = {
      ...input,
      config: {
        ...input.config,
        emitInit: false
      }
    };
    await generateSqlModel(noInitInput);
    await expect(checkSqlModelGeneration(noInitInput)).resolves.toMatchObject({
      files: [path.join(outputDir, "models.py")]
    });
  });

  it("throws diagnostics during check mode before file comparison", async () => {
    const datamodel = `datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

model User {
  id   Int      @id
  tags String[]
}`;
    const input = {
      dmmf: {
        datamodel: {
          enums: [],
          models: [
            {
              name: "User",
              fields: [
                { kind: "scalar", name: "id", type: "Int", isList: false, isRequired: true, isId: true, isUnique: false, hasDefaultValue: false },
                { kind: "scalar", name: "tags", type: "String", isList: true, isRequired: true, isId: false, isUnique: false, hasDefaultValue: false }
              ]
            }
          ]
        }
      },
      schemaPath: "/virtual/schema.prisma",
      datamodel,
      outputDir: "/tmp/does-not-matter",
      config: resolveGeneratorConfig(undefined)
    } as any;

    await expect(checkSqlModelGeneration(input)).rejects.toBeInstanceOf(DiagnosticError);
  });
});

describe("prisma ast metadata", () => {
  it("keeps default model metadata when optional AST attributes are absent", () => {
    const datamodel = `datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id Int @id

  @@index(name: "idx_only_name")
}`;

    const metadata = extractAstMetadata(datamodel, {
      datamodel: {
        models: [{ name: "User", dbName: null, fields: [] }]
      }
    });

    expect(metadata.models.get("User")).toMatchObject({
      tableName: "User",
      tableSchema: undefined,
      ignored: false
    });
  });

  it("covers provider errors, missing blocks, and Prisma-specific AST metadata", () => {
    const unsupported = `datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model User {
  id Int @id
}`;
    expect(() =>
      extractAstMetadata(unsupported, {
        datamodel: {
          models: [{ name: "User", dbName: null, fields: [] }]
        }
      })
    ).toThrow("Unsupported Prisma datasource provider 'sqlite'");

    expect(() =>
      extractAstMetadata(
        `model User {
  id Int @id
}`,
        {
          datamodel: {
            models: [{ name: "User", dbName: null, fields: [] }]
          }
        }
      )
    ).toThrow("Unsupported Prisma datasource provider");

    const datamodel = `datasource db {
  provider = "postgresql"
  relationMode = "foreignKeys"
  url      = env("DATABASE_URL")
}

model User {
  id    Int    @id
  email String
  friendId Int?
  friend User? @relation(fields: [friendId], references: [id], map: "user_friend_fk")
  helper String @ignore

  @@schema("tenant_a")
  @@ignore
}
`;
    const metadata = extractAstMetadata(datamodel, {
      datamodel: {
        models: [
          { name: "User", dbName: null, fields: [] },
          { name: "Missing", dbName: null, fields: [] }
        ]
      }
    });

    expect(metadata.relationMode).toBe("foreignKeys");
    expect(metadata.models.get("User")).toMatchObject({
      tableName: "User",
      tableSchema: "tenant_a",
      ignored: true
    });
    expect(metadata.models.get("User")?.ignoredFields.has("helper")).toBe(true);
    expect(metadata.models.get("User")?.relationFields.get("friend")).toEqual({
      map: "user_friend_fk"
    });
    expect(metadata.models.get("Missing")).toMatchObject({
      tableName: "Missing"
    });
    expect(metadata.unsupportedDiagnostics).toEqual([]);
  });


  it("captures unsupported non-field index expressions from the AST", () => {
    const datamodel = `datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id    Int    @id
  value String @db.VarChar(255)

  @@index([[value]])
}`;

    const metadata = extractAstMetadata(datamodel, {
      datamodel: {
        models: [{ name: "User", dbName: null, fields: [] }]
      }
    });

    expect(metadata.unsupportedDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "UNSUPPORTED_ADVANCED_INDEX",
          model: "User",
          message: expect.stringContaining("Non-field index expressions")
        })
      ])
    );
  });

  it("handles basic index metadata without advanced diagnostics", () => {
    const datamodel = `datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id    Int    @id
  value String @db.VarChar(255)

  @@index([value], map: "user_value_idx")
}`;

    const metadata = extractAstMetadata(datamodel, {
      datamodel: {
        models: [{ name: "User", dbName: null, fields: [] }]
      }
    });

    expect(metadata.unsupportedDiagnostics).toEqual([]);
  });

  it("captures malformed index modifier parameters with model-location fallback", () => {
    const datamodel = `datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id    Int    @id
  value String @db.VarChar(255)

  @@index([ghost(raw("lower(value)"))])
}`;

    const metadata = extractAstMetadata(datamodel, {
      datamodel: {
        models: [{ name: "User", dbName: null, fields: [] }]
      }
    });

    expect(metadata.unsupportedDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "UNSUPPORTED_ADVANCED_INDEX",
          model: "User",
          field: "ghost",
          location: metadata.modelLocations.get("User")
        })
      ])
    );
  });

  it("covers index function entries without modifier params", () => {
    const datamodel = `datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id    Int    @id
  value String @db.VarChar(255)

  @@index([value()])
}`;

    const metadata = extractAstMetadata(datamodel, {
      datamodel: {
        models: [{ name: "User", dbName: null, fields: [] }]
      }
    });

    expect(metadata.unsupportedDiagnostics).toEqual([]);
  });

  it("falls back to the model location for unsupported named index modifiers", () => {
    const datamodel = `datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id    Int    @id
  value String @db.VarChar(255)

  @@index([ghost(ops: raw("gin_trgm_ops"))])
}`;

    const metadata = extractAstMetadata(datamodel, {
      datamodel: {
        models: [{ name: "User", dbName: null, fields: [] }]
      }
    });

    expect(metadata.unsupportedDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "UNSUPPORTED_ADVANCED_INDEX",
          model: "User",
          field: "ghost",
          location: metadata.modelLocations.get("User"),
          message: expect.stringContaining("field modifier 'ops'")
        })
      ])
    );
  });

  it("captures unsupported advanced index metadata from the AST", () => {
    const datamodel = `datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id    Int    @id
  value String @db.VarChar(255)

  @@index([value(ops: raw("gin_trgm_ops"))], type: Gin)
}`;

    const metadata = extractAstMetadata(datamodel, {
      datamodel: {
        models: [{ name: "User", dbName: null, fields: [] }]
      }
    });

    expect(metadata.unsupportedDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "UNSUPPORTED_ADVANCED_INDEX", model: "User" }),
        expect.objectContaining({ code: "UNSUPPORTED_ADVANCED_INDEX", model: "User", field: "value" })
      ])
    );
  });

  it("covers fallback stringification for non-literal index types", () => {
    const datamodel = `datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id    Int    @id
  value String @db.VarChar(255)

  @@index([value], type: raw("Gin"))
}`;

    const metadata = extractAstMetadata(datamodel, {
      datamodel: {
        models: [{ name: "User", dbName: null, fields: [] }]
      }
    });

    expect(metadata.unsupportedDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "UNSUPPORTED_ADVANCED_INDEX",
          model: "User",
          message: expect.stringContaining("[object Object]")
        })
      ])
    );
  });
});
