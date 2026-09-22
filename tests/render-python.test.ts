import { describe, expect, it } from "vitest";
import { renderPythonModule } from "../src/render-python.js";
import type {
  ModelDefinition,
  RelationFieldDefinition,
  ScalarFieldDefinition,
  SchemaDefinition
} from "../src/types.js";

const OPTIONS = {
  moduleName: "models.py",
  headerComment: false,
  schemaHash: "test",
  packageVersion: "2.0.0-test"
};

function scalar(overrides: Partial<ScalarFieldDefinition> & { name: string }): ScalarFieldDefinition {
  return {
    kind: "scalar",
    pythonName: overrides.name,
    columnName: overrides.name,
    prismaType: "Int",
    pythonType: "int",
    isList: false,
    isNullable: false,
    isId: false,
    isUnique: false,
    hasDefaultValue: false,
    isUpdatedAt: false,
    nativeType: { name: "Integer", args: [] },
    ...overrides
  };
}

function relation(
  overrides: Partial<RelationFieldDefinition> & { name: string; targetModel: string }
): RelationFieldDefinition {
  return {
    kind: "relation",
    pythonName: overrides.name,
    isList: false,
    isNullable: false,
    relationName: `${overrides.name}_rel`,
    relationFromFields: [],
    relationToFields: [],
    backPopulates: "",
    foreignKeyFieldNames: [],
    ...overrides
  };
}

function model(overrides: Partial<ModelDefinition> & { name: string }): ModelDefinition {
  return {
    pythonName: overrides.name,
    tableName: overrides.name.toLowerCase(),
    scalarFields: [],
    relationFields: [],
    constraints: [],
    foreignKeys: [],
    ...overrides
  };
}

function schema(models: ModelDefinition[], overrides?: Partial<SchemaDefinition>): SchemaDefinition {
  return { provider: "postgresql", enums: [], models, ...overrides };
}

function fieldLine(output: string, pythonName: string): string {
  const line = output.split("\n").find((entry) => entry.startsWith(`    ${pythonName}:`));
  expect(line, `expected a rendered line for ${pythonName}`).toBeDefined();
  return line!;
}

describe("renderPythonModule: scalar column types", () => {
  it("renders non-native scalar columns with generic imports", () => {
    const fields: Array<[string, string, string, string]> = [
      ["s", "String", "str", "String()"],
      ["b", "Boolean", "bool", "Boolean()"],
      ["i", "Int", "int", "Integer()"],
      ["bi", "BigInt", "int", "BigInteger()"],
      ["f", "Float", "float", "Float()"],
      ["d", "Decimal", "Decimal", "Numeric()"],
      ["by", "Bytes", "bytes", "LargeBinary()"],
      ["dt", "DateTime", "datetime", "DateTime()"]
    ];
    const output = renderPythonModule(
      schema([
        model({
          name: "M",
          scalarFields: fields.map(([name, prismaType, pythonType]) =>
            scalar({ name, prismaType, pythonType, nativeType: undefined })
          )
        })
      ]),
      OPTIONS
    );

    for (const [name, , , column] of fields) {
      expect(fieldLine(output, name)).toContain(`Column(${column}, nullable=False)`);
    }
    expect(output).toContain(
      "from sqlalchemy import BigInteger, Boolean, Column, DateTime, Float, Integer, LargeBinary, Numeric, String"
    );
  });

  it("renders non-native Json columns as JSONB", () => {
    const output = renderPythonModule(
      schema([
        model({
          name: "M",
          scalarFields: [
            scalar({ name: "j", prismaType: "Json", pythonType: "Any", nativeType: undefined })
          ]
        })
      ]),
      OPTIONS
    );

    expect(fieldLine(output, "j")).toContain("Column(JSONB, nullable=False)");
    expect(output).toContain("from sqlalchemy.dialects.postgresql import JSONB");
  });

  it("renders custom and unsupported scalars by type name", () => {
    const output = renderPythonModule(
      schema([
        model({
          name: "M",
          scalarFields: [
            scalar({ name: "c", prismaType: "custom", pythonType: "custom", nativeType: undefined }),
            scalar({
              name: "u",
              prismaType: "Unsupported",
              pythonType: "Any",
              nativeType: undefined
            })
          ]
        })
      ]),
      OPTIONS
    );

    expect(fieldLine(output, "c")).toContain("Column(custom, nullable=False)");
    expect(fieldLine(output, "u")).toContain("Column(Unsupported, nullable=False)");
  });

  it("aliases the Postgres UUID type to avoid shadowing uuid.UUID", () => {
    const output = renderPythonModule(
      schema([
        model({
          name: "M",
          scalarFields: [
            scalar({
              name: "id",
              prismaType: "Uuid",
              pythonType: "UUID",
              isId: true,
              nativeType: { name: "Uuid", args: [] }
            })
          ]
        })
      ]),
      OPTIONS
    );

    expect(fieldLine(output, "id")).toContain("id: UUID = Field(");
    expect(fieldLine(output, "id")).toContain("Column(PG_UUID(as_uuid=True),");
    expect(output).toContain("from uuid import UUID");
    expect(output).toContain("from sqlalchemy.dialects.postgresql import UUID as PG_UUID");
  });

  it("renders enum lists as arrays", () => {
    const output = renderPythonModule(
      schema(
        [
          model({
            name: "M",
            scalarFields: [
              scalar({
                name: "roles",
                prismaType: "Role",
                pythonType: "Role",
                isList: true,
                nativeType: undefined
              }),
              scalar({
                name: "tags",
                prismaType: "Priority",
                pythonType: "Priority",
                isList: true,
                nativeType: { name: "Text", args: [] }
              })
            ]
          })
        ],
        {
          enums: [
            {
              name: "Role",
              pythonName: "Role",
              values: [{ name: "ADMIN", pythonName: "ADMIN", value: "ADMIN" }]
            },
            {
              name: "Priority",
              pythonName: "Priority",
              storage: "text",
              values: [{ name: "LOW", pythonName: "LOW", value: "low" }]
            }
          ]
        }
      ),
      OPTIONS
    );

    expect(fieldLine(output, "roles")).toContain("list[Role]");
    expect(fieldLine(output, "roles")).toContain("ARRAY(SAEnum(Role, name='Role'))");
    expect(fieldLine(output, "tags")).toContain("list[Priority]");
    expect(fieldLine(output, "tags")).toContain("ARRAY(TEXT())");
  });

  it("renders exotic and custom native types", () => {
    const output = renderPythonModule(
      schema([
        model({
          name: "M",
          scalarFields: [
            scalar({ name: "x", nativeType: { name: "Xml", args: [] } }),
            scalar({ name: "ci", nativeType: { name: "Citext", args: [] } }),
            scalar({ name: "ts", nativeType: { name: "Tsvector", args: [] } })
          ]
        })
      ]),
      OPTIONS
    );

    expect(fieldLine(output, "x")).toContain("Column(XML(), nullable=False)");
    expect(fieldLine(output, "ci")).toContain("Column(CITEXT(), nullable=False)");
    expect(fieldLine(output, "ts")).toContain("Column(TSVECTOR(), nullable=False)");
    expect(output).toContain("from sqlalchemy.dialects.postgresql import CITEXT, TSVECTOR, XML");
  });

  it("renders timestamp precisions with and without arguments", () => {
    const output = renderPythonModule(
      schema([
        model({
          name: "M",
          scalarFields: [
            scalar({ name: "a", nativeType: { name: "Timestamp", args: ["3"] } }),
            scalar({ name: "b", nativeType: { name: "Timestamp", args: [] } }),
            scalar({ name: "c", nativeType: { name: "Time", args: ["3"] } }),
            scalar({ name: "d", nativeType: { name: "Time", args: [] } }),
            scalar({ name: "e", nativeType: { name: "Timestamptz", args: ["3"] } }),
            scalar({ name: "f", nativeType: { name: "Timestamptz", args: [] } }),
            scalar({ name: "g", nativeType: { name: "Timetz", args: ["3"] } }),
            scalar({ name: "h", nativeType: { name: "Timetz", args: [] } })
          ]
        })
      ]),
      OPTIONS
    );

    expect(fieldLine(output, "a")).toContain("TIMESTAMP(precision=3)");
    expect(fieldLine(output, "b")).toContain("TIMESTAMP()");
    expect(fieldLine(output, "c")).toContain("TIME(precision=3)");
    expect(fieldLine(output, "d")).toContain("TIME()");
    expect(fieldLine(output, "e")).toContain("TIMESTAMP(precision=3, timezone=True)");
    expect(fieldLine(output, "f")).toContain("TIMESTAMP(timezone=True)");
    expect(fieldLine(output, "g")).toContain("TIME(precision=3, timezone=True)");
    expect(fieldLine(output, "h")).toContain("TIME(timezone=True)");
  });
});

describe("renderPythonModule: scalar defaults", () => {
  it("renders literal defaults", () => {
    const output = renderPythonModule(
      schema([
        model({
          name: "M",
          scalarFields: [
            scalar({
              name: "s",
              prismaType: "String",
              pythonType: "str",
              nativeType: { name: "Text", args: [] },
              hasDefaultValue: true,
              defaultValue: "hi"
            }),
            scalar({ name: "i", hasDefaultValue: true, defaultValue: 3 }),
            scalar({
              name: "b",
              prismaType: "Boolean",
              pythonType: "bool",
              nativeType: { name: "Boolean", args: [] },
              hasDefaultValue: true,
              defaultValue: true
            })
          ]
        })
      ]),
      OPTIONS
    );

    expect(fieldLine(output, "s")).toContain("default='hi'");
    expect(fieldLine(output, "i")).toContain("default=3");
    expect(fieldLine(output, "b")).toContain("default=True");
  });

  it("renders function defaults tolerantly", () => {
    const output = renderPythonModule(
      schema([
        model({
          name: "M",
          scalarFields: [
            scalar({ name: "u", hasDefaultValue: true, defaultValue: { name: "uuid" } }),
            scalar({
              name: "g",
              hasDefaultValue: true,
              defaultValue: { name: "dbgenerated", args: [42] }
            }),
            scalar({ name: "m", hasDefaultValue: true, defaultValue: { name: "mystery" } }),
            scalar({ name: "n", hasDefaultValue: true, defaultValue: null })
          ]
        })
      ]),
      OPTIONS
    );

    expect(fieldLine(output, "u")).toContain("default_factory=uuid4");
    expect(fieldLine(output, "g")).toBe(
      "    g: int | None = Field(sa_column=Column(INTEGER(), nullable=False), default=None)"
    );
    expect(fieldLine(output, "m")).not.toContain("default");
    expect(fieldLine(output, "n")).not.toContain("default");
  });
});

describe("renderPythonModule: names and models", () => {
  it("renders mapped column names and sanitization comments", () => {
    const output = renderPythonModule(
      schema([
        model({
          name: "123Bad",
          pythonName: "_Bad",
          tableName: "bad",
          scalarFields: [
            scalar({ name: "class", pythonName: "class_" }),
            scalar({ name: "userId", columnName: "user_id" })
          ]
        })
      ]),
      OPTIONS
    );

    expect(output).toContain("# Prisma model '123Bad' emitted as Python class '_Bad'.");
    expect(output).toContain("# Prisma field 'class' emitted as Python attribute 'class_'.");
    expect(fieldLine(output, "userId")).toContain("Column('user_id', INTEGER(), nullable=False)");
  });

  it("renders empty models with pass", () => {
    const output = renderPythonModule(schema([model({ name: "Bare", tableName: "bare" })]), OPTIONS);

    expect(output).toContain("class Bare(SQLModel, table=True):\n    __tablename__ = 'bare'\n    pass");
  });

  it("renders schema-qualified models, enums, and references", () => {
    const output = renderPythonModule(
      schema(
        [
          model({
            name: "User",
            tableName: "users",
            tableSchema: "tenant",
            scalarFields: [
              scalar({ name: "id", isId: true }),
              scalar({ name: "role", prismaType: "Role", pythonType: "Role", nativeType: undefined })
            ]
          }),
          model({
            name: "Order",
            tableName: "orders",
            scalarFields: [
              scalar({ name: "id", isId: true }),
              scalar({
                name: "userId",
                foreignKey: { fields: ["userId"], targetModel: "User", targetFields: ["id"] }
              })
            ]
          })
        ],
        {
          enums: [
            {
              name: "Role",
              pythonName: "Role",
              values: [{ name: "ADMIN", pythonName: "ADMIN", value: "ADMIN" }]
            }
          ]
        }
      ),
      OPTIONS
    );

    expect(output).toContain(`{"schema": 'tenant'}`);
    expect(output).toContain("SAEnum(Role, name='Role', schema='tenant')");
    expect(output).toContain("ForeignKey('tenant.users.id')");
  });
});

describe("renderPythonModule: constraints", () => {
  it("renders named primary keys and plain unique constraints", () => {
    const output = renderPythonModule(
      schema([
        model({
          name: "M",
          scalarFields: [scalar({ name: "a" }), scalar({ name: "b" }), scalar({ name: "email" })],
          constraints: [
            {
              kind: "primary_key",
              fields: [{ name: "a" }, { name: "b" }],
              name: "pk_ab"
            },
            { kind: "unique", fields: [{ name: "email" }], name: "uq_email" }
          ]
        })
      ]),
      OPTIONS
    );

    expect(output).toContain("PrimaryKeyConstraint('a', 'b', name='pk_ab')");
    expect(output).toContain("UniqueConstraint('email', name='uq_email')");
    expect(output).toContain("UniqueConstraint");
  });

  it("renders descending sorted uniques as unique indexes", () => {
    const output = renderPythonModule(
      schema([
        model({
          name: "M",
          scalarFields: [scalar({ name: "email" })],
          constraints: [
            {
              kind: "unique",
              fields: [{ name: "email", sort: "desc" }],
              name: "uq_email_sort"
            }
          ]
        })
      ]),
      OPTIONS
    );

    expect(output).toContain("Index('uq_email_sort', desc('email'), unique=True)");
    const importLine = output.split("\n").find((line) => line.startsWith("from sqlalchemy import "))!;
    expect(importLine).toContain("desc");
  });

  it("renders ascending sorted uniques as unique indexes", () => {
    const output = renderPythonModule(
      schema([
        model({
          name: "M",
          scalarFields: [scalar({ name: "email" })],
          constraints: [
            {
              kind: "unique",
              fields: [{ name: "email", sort: "asc" }],
              name: "uq_email_sort"
            }
          ]
        })
      ]),
      OPTIONS
    );

    expect(output).toContain("Index('uq_email_sort', asc('email'), unique=True)");
    const importLine = output.split("\n").find((line) => line.startsWith("from sqlalchemy import "))!;
    expect(importLine).toContain("asc");
  });

  it("renders sorted and unnamed indexes", () => {
    const output = renderPythonModule(
      schema([
        model({
          name: "M",
          scalarFields: [
            scalar({ name: "title" }),
            scalar({ name: "created" }),
            scalar({ name: "nick", pythonName: "nick_" })
          ],
          constraints: [
            {
              kind: "index",
              fields: [{ name: "title", sort: "desc" }, { name: "created", sort: "asc" }, { name: "nick" }]
            },
            { kind: "index", fields: [{ name: "title" }] }
          ]
        })
      ]),
      OPTIONS
    );

    expect(output).toContain("Index(desc('title'), asc('created'), 'nick')");
    expect(output).toContain("Index('title')");
  });

  it("renders unsupported index algorithms without a using clause", () => {
    const output = renderPythonModule(
      schema([
        model({
          name: "M",
          scalarFields: [scalar({ name: "a" })],
          constraints: [{ kind: "index", fields: [{ name: "a" }], name: "ix", algorithm: "bloom" }]
        })
      ]),
      OPTIONS
    );

    expect(output).toContain("Index('ix', 'a')");
    expect(output).not.toContain("postgresql_using");
  });

  it("renders dangling references tolerantly", () => {
    const output = renderPythonModule(
      schema([
        model({
          name: "M1",
          scalarFields: [scalar({ name: "id", isId: true })],
          constraints: [{ kind: "unique", fields: [{ name: "ghost" }] }],
          foreignKeys: [{ fields: ["ghost_col"], targetModel: "Missing", targetFields: ["id"] }],
          relationFields: [
            relation({ name: "rel1", targetModel: "M2", backPopulates: "ghost" }),
            relation({ name: "rel2", targetModel: "Missing", backPopulates: "" })
          ]
        }),
        model({
          name: "M2",
          scalarFields: [scalar({ name: "id", isId: true })],
          relationFields: [relation({ name: "other", targetModel: "M1", backPopulates: "nothing" })]
        })
      ]),
      OPTIONS
    );

    expect(output).toContain("UniqueConstraint('ghost')");
    expect(output).toContain("ForeignKeyConstraint(['ghost_col'], ['Missing.id'])");
    expect(output).toContain("back_populates='ghost'");
    expect(fieldLine(output, "rel2")).toBe(`    rel2: 'Missing' = Relationship()`);
  });
});

describe("renderPythonModule: foreign keys and relations", () => {
  it("renders named foreign keys with actions", () => {
    const output = renderPythonModule(
      schema([
        model({
          name: "M",
          scalarFields: [
            scalar({ name: "a" }),
            scalar({ name: "b" }),
            scalar({ name: "c" }),
            scalar({ name: "d" }),
            scalar({
              name: "x",
              foreignKey: {
                fields: ["x"],
                targetModel: "T",
                targetFields: ["x"],
                onUpdate: "SET NULL"
              }
            })
          ],
          foreignKeys: [
            {
              name: "fk_a",
              fields: ["a", "b"],
              targetModel: "T",
              targetFields: ["a", "b"],
              onDelete: "CASCADE"
            },
            { fields: ["c", "d"], targetModel: "T", targetFields: ["c", "d"], onUpdate: "CASCADE" }
          ]
        }),
        model({
          name: "T",
          tableName: "targets",
          scalarFields: [
            scalar({ name: "a" }),
            scalar({ name: "b" }),
            scalar({ name: "c" }),
            scalar({ name: "d" }),
            scalar({ name: "x" })
          ]
        })
      ]),
      OPTIONS
    );

    expect(output).toContain(
      "ForeignKeyConstraint(['a', 'b'], ['targets.a', 'targets.b'], name='fk_a', ondelete='CASCADE')"
    );
    expect(output).toContain(
      "ForeignKeyConstraint(['c', 'd'], ['targets.c', 'targets.d'], onupdate='CASCADE')"
    );
    expect(fieldLine(output, "x")).toContain("ForeignKey('targets.x', onupdate='SET NULL')");
  });

  it("renders self-referential relations with remote_side", () => {
    const output = renderPythonModule(
      schema([
        model({
          name: "M",
          scalarFields: [scalar({ name: "id", isId: true }), scalar({ name: "a" }), scalar({ name: "b" })],
          relationFields: [
            relation({
              name: "manager",
              targetModel: "M",
              backPopulates: "x",
              relationFromFields: ["id"],
              relationToFields: ["id"]
            }),
            relation({
              name: "reports",
              targetModel: "M",
              backPopulates: "y",
              relationFromFields: ["a", "b"],
              relationToFields: ["a", "b"]
            })
          ]
        })
      ]),
      OPTIONS
    );

    expect(fieldLine(output, "manager")).toContain(`"remote_side": 'M.id'`);
    expect(fieldLine(output, "reports")).toContain(`"remote_side": '[M.a, M.b]'`);
  });
});
