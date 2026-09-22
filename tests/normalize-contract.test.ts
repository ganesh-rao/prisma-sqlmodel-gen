import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseContractDocument } from "../src/contract.js";
import { buildSchemaDefinitionFromContract } from "../src/normalize-contract.js";
import type { Diagnostic, SchemaDefinition } from "../src/types.js";

async function loadContract(name: string): Promise<{
  definition: SchemaDefinition;
  diagnostics: Diagnostic[];
}> {
  const text = await readFile(new URL(`./fixtures/contracts/${name}`, import.meta.url), "utf8");
  const { document, diagnostics } = parseContractDocument(text);
  expect(diagnostics).toEqual([]);
  if (!document) {
    throw new Error("fixture contract failed to parse");
  }
  return buildSchemaDefinitionFromContract(document, true);
}

describe("buildSchemaDefinitionFromContract: real Prisma 8 contract", () => {
  it("normalizes an emitted realworld contract without diagnostics", async () => {
    const { definition, diagnostics } = await loadContract("realworld.json");
    expect(diagnostics).toEqual([]);

    expect(definition.models.map((model) => model.name).sort()).toEqual([
      "ApiKey",
      "Comment",
      "Membership",
      "Post",
      "PostTag",
      "Profile",
      "Tag",
      "User"
    ]);

    const postTag = definition.models.find((model) => model.name === "PostTag")!;
    expect(postTag.relationFields.find((field) => field.name === "post")).toMatchObject({
      backPopulates: "tags"
    });

    const post = definition.models.find((model) => model.name === "Post")!;
    expect(post.scalarFields.find((field) => field.name === "views")).toMatchObject({
      defaultValue: 0
    });

    const user = definition.models.find((model) => model.name === "User")!;
    expect(user.scalarFields.find((field) => field.name === "updatedAt")).toMatchObject({
      isUpdatedAt: true,
      hasDefaultValue: true
    });
    expect(user.scalarFields.find((field) => field.name === "role")).toMatchObject({
      defaultValue: "MEMBER"
    });
  });
});

describe("buildSchemaDefinitionFromContract: ported v7 user schema", () => {
  it("normalizes an emitted user-schema contract without diagnostics", async () => {
    const { definition, diagnostics } = await loadContract("user-schema.json");
    expect(diagnostics).toEqual([]);

    expect(definition.models.map((model) => model.name).sort()).toEqual([
      "Article",
      "Company",
      "Filing",
      "FilingChunk"
    ]);

    const article = definition.models.find((model) => model.name === "Article")!;
    expect(article.tableName).toBe("article");
    expect(article.constraints).toContainEqual({
      kind: "index",
      fields: [{ name: "authors" }],
      name: "pgarticle_authors",
      algorithm: "gin"
    });
    expect(article.relationFields.find((field) => field.name === "company")).toMatchObject({
      targetModel: "Company",
      backPopulates: "articles"
    });
    expect(article.scalarFields.find((field) => field.name === "content")).toMatchObject({
      prismaType: "Jsonb",
      nativeType: { name: "JsonB", args: [] }
    });

    const chunk = definition.models.find((model) => model.name === "FilingChunk")!;
    expect(chunk.constraints).toContainEqual({
      kind: "unique",
      fields: [{ name: "filingId" }, { name: "kind" }, { name: "ordinal" }],
      name: "pgfilingchunk_filing_kind_ordinal"
    });

    const company = definition.models.find((model) => model.name === "Company")!;
    expect(company.scalarFields.find((field) => field.name === "ticker")).toMatchObject({
      isUnique: false
    });
    expect(company.constraints).toContainEqual({
      kind: "unique",
      fields: [{ name: "ticker" }],
      name: "pgcompany_ticker"
    });

    const filing = definition.models.find((model) => model.name === "Filing")!;
    expect(filing.constraints).toContainEqual({
      kind: "unique",
      fields: [{ name: "sourceUrl" }],
      name: "pgfiling_source_url"
    });
  });
});

describe("buildSchemaDefinitionFromContract: basic models", () => {
  it("builds tables, columns, defaults, and enums", async () => {
    const { definition, diagnostics } = await loadContract("basic-postgres.json");
    expect(diagnostics).toEqual([]);

    expect(definition.provider).toBe("postgresql");
    expect(definition.models.map((model) => model.name)).toEqual(["Post", "User"]);

    const user = definition.models.find((model) => model.name === "User")!;
    expect(user.tableName).toBe("user");
    expect(user.tableSchema).toBeUndefined();
    expect(user.scalarFields.map((field) => field.name)).toEqual([
      "createdAt",
      "email",
      "id",
      "name",
      "priority",
      "role",
      "tags",
      "updatedAt"
    ]);

    const id = user.scalarFields.find((field) => field.name === "id")!;
    expect(id.isId).toBe(true);
    expect(id.pythonType).toBe("UUID");
    expect(id.nativeType).toMatchObject({ name: "Uuid", args: [] });
    expect(id.defaultValue).toMatchObject({ name: "uuid", args: [] });

    const email = user.scalarFields.find((field) => field.name === "email")!;
    expect(email.isUnique).toBe(true);
    expect(email.nativeType).toMatchObject({ name: "VarChar", args: ["255"] });

    const name = user.scalarFields.find((field) => field.name === "name")!;
    expect(name.isNullable).toBe(true);
    expect(name.nativeType).toMatchObject({ name: "VarChar", args: ["35"] });

    const createdAt = user.scalarFields.find((field) => field.name === "createdAt")!;
    expect(createdAt.defaultValue).toMatchObject({ name: "now", args: [] });

    const updatedAt = user.scalarFields.find((field) => field.name === "updatedAt")!;
    expect(updatedAt.isUpdatedAt).toBe(true);

    const tags = user.scalarFields.find((field) => field.name === "tags")!;
    expect(tags.isList).toBe(true);
    expect(tags.pythonType).toBe("str");

    const priorityField = user.scalarFields.find((field) => field.name === "priority")!;
    expect(priorityField.defaultValue).toBe("LOW");
    expect(priorityField.nativeType).toEqual({ name: "Text", args: [] });

    const roleField = user.scalarFields.find((field) => field.name === "role")!;
    expect(roleField.nativeType).toBeUndefined();

    expect(definition.enums.map((entry) => entry.name).sort()).toEqual(["Priority", "Role"]);
    const priority = definition.enums.find((entry) => entry.name === "Priority")!;
    expect(priority.storage).toBe("text");
    expect(priority.values).toEqual([
      { name: "Low", pythonName: "LOW", value: "low" },
      { name: "High", pythonName: "HIGH", value: "high" }
    ]);
    const role = definition.enums.find((entry) => entry.name === "Role")!;
    expect(role.storage).toBe("native");
  });

  it("builds relations with back-population and FK actions", async () => {
    const { definition } = await loadContract("basic-postgres.json");

    const post = definition.models.find((model) => model.name === "Post")!;
    expect(post.relationFields.map((field) => field.name)).toEqual(["user"]);
    const userRelation = post.relationFields[0]!;
    expect(userRelation.targetModel).toBe("User");
    expect(userRelation.backPopulates).toBe("posts");
    expect(userRelation.foreignKeyFieldNames).toEqual(["userId"]);

    const userId = post.scalarFields.find((field) => field.name === "userId")!;
    expect(userId.foreignKey).toMatchObject({
      targetModel: "User",
      targetFields: ["id"],
      onDelete: "CASCADE"
    });

    const user = definition.models.find((model) => model.name === "User")!;
    expect(user.relationFields.map((field) => field.name)).toEqual(["posts"]);
    expect(user.relationFields[0]!.backPopulates).toBe("user");
    expect(user.relationFields[0]!.isList).toBe(true);

    const index = post.constraints.find((constraint) => constraint.kind === "index")!;
    expect(index.name).toBe("post_userId_idx_a489d58a");
    expect(index.fields).toEqual([{ name: "userId" }]);

    const userChecks = user.checks ?? [];
    expect(userChecks.map((check) => check.name)).toEqual([
      "user_priority_check_dea9d0ab",
      "user_tags_elem_not_null_aecbe9e2"
    ]);
  });
});

describe("buildSchemaDefinitionFromContract: relations and scalars", () => {
  it("reports client-side id generators as errors", async () => {
    const { diagnostics } = await loadContract("relations-types.json");

    expect(diagnostics.map((entry) => entry.code)).toEqual([
      "UNSUPPORTED_CLIENT_SIDE_DEFAULT",
      "UNSUPPORTED_CLIENT_SIDE_DEFAULT",
      "UNSUPPORTED_CLIENT_SIDE_DEFAULT"
    ]);
    expect(diagnostics.map((entry) => entry.field).sort()).toEqual(["nano", "uid2", "ul"]);
  });

  it("builds one-to-one relations", async () => {
    const { definition } = await loadContract("relations-types.json");

    const profile = definition.models.find((model) => model.name === "Profile")!;
    const userRelation = profile.relationFields.find((field) => field.name === "user")!;
    expect(userRelation.isList).toBe(false);
    expect(userRelation.backPopulates).toBe("profile");
    expect(userRelation.foreignKeyFieldNames).toEqual(["userId"]);

    const userId = profile.scalarFields.find((field) => field.name === "userId")!;
    expect(userId.isUnique).toBe(true);
    expect(userId.foreignKey).toMatchObject({ targetModel: "User", onDelete: "CASCADE" });

    const user = definition.models.find((model) => model.name === "User")!;
    const profileRelation = user.relationFields.find((field) => field.name === "profile")!;
    expect(profileRelation.isList).toBe(false);
    expect(profileRelation.backPopulates).toBe("user");
    expect(profileRelation.foreignKeyFieldNames).toEqual([]);
  });

  it("pairs multiple named relations between the same models", async () => {
    const { definition } = await loadContract("relations-types.json");

    const post = definition.models.find((model) => model.name === "Post")!;
    const author = post.relationFields.find((field) => field.name === "author")!;
    expect(author.backPopulates).toBe("posts");
    expect(post.scalarFields.find((field) => field.name === "authorId")!.foreignKey).toMatchObject({
      name: "fk_post_author",
      onDelete: "CASCADE"
    });

    const reviewer = post.relationFields.find((field) => field.name === "reviewer")!;
    expect(reviewer.backPopulates).toBe("reviews");
    expect(reviewer.isNullable).toBe(true);
    expect(post.scalarFields.find((field) => field.name === "reviewerId")!.foreignKey).toMatchObject({
      onDelete: "SET NULL"
    });

    const user = definition.models.find((model) => model.name === "User")!;
    expect(user.relationFields.find((field) => field.name === "posts")!.backPopulates).toBe("author");
    expect(user.relationFields.find((field) => field.name === "reviews")!.backPopulates).toBe(
      "reviewer"
    );
  });

  it("builds self relations", async () => {
    const { definition } = await loadContract("relations-types.json");

    const category = definition.models.find((model) => model.name === "Category")!;
    const parent = category.relationFields.find((field) => field.name === "parent")!;
    expect(parent.targetModel).toBe("Category");
    expect(parent.backPopulates).toBe("children");
    expect(parent.foreignKeyFieldNames).toEqual(["parentId"]);
    const children = category.relationFields.find((field) => field.name === "children")!;
    expect(children.isList).toBe(true);
    expect(children.backPopulates).toBe("parent");
  });

  it("builds expression and access-method indexes", async () => {
    const { definition } = await loadContract("relations-types.json");

    const post = definition.models.find((model) => model.name === "Post")!;
    const expression = post.constraints.find((constraint) => constraint.expression !== undefined)!;
    expect(expression).toMatchObject({
      kind: "index",
      expression: "lower(title)",
      name: "post_title_lower_40104d8c"
    });
    const hashed = post.constraints.find((constraint) => constraint.algorithm !== undefined)!;
    expect(hashed).toMatchObject({
      kind: "index",
      algorithm: "hash",
      name: "post_author_hash_94e691a2",
      fields: [{ name: "authorId" }]
    });
  });

  it("maps the full scalar type surface", async () => {
    const { definition } = await loadContract("relations-types.json");

    const types = definition.models.find((model) => model.name === "Types")!;
    const byName = (name: string) => types.scalarFields.find((field) => field.name === name)!;
    expect(byName("b")).toMatchObject({ pythonType: "bytes", nativeType: { name: "ByteA", args: [] } });
    expect(byName("dec")).toMatchObject({
      pythonType: "Decimal",
      nativeType: { name: "Decimal", args: ["10", "2"] }
    });
    expect(byName("j")).toMatchObject({ pythonType: "Any", prismaType: "Json" });
    expect(byName("jb")).toMatchObject({ pythonType: "Any", prismaType: "Jsonb" });
    expect(byName("r")).toMatchObject({ pythonType: "float", nativeType: { name: "Real", args: [] } });
    expect(byName("inet")).toMatchObject({ pythonType: "str", nativeType: { name: "Inet", args: [] } });
    expect(byName("d")).toMatchObject({ pythonType: "date", nativeType: { name: "Date", args: [] } });
    expect(byName("t")).toMatchObject({ pythonType: "time", nativeType: { name: "Time", args: [] } });
    expect(byName("tstr")).toMatchObject({ pythonType: "datetime" });
    expect(byName("c")).toMatchObject({ nativeType: { name: "Char", args: ["3"] } });
    expect(byName("si")).toMatchObject({ nativeType: { name: "SmallInt", args: [] } });
    expect(byName("gen").defaultValue).toMatchObject({ name: "dbgenerated", args: ["upper('x')"] });
  });

  it("pairs counterparts by target model when field names are ambiguous", () => {
    const doc = {
      storage: {
        namespaces: {
          public: {
            entries: {
              table: {
                post: { columns: { id: { nativeType: "int4" } } },
                comment: { columns: { id: { nativeType: "int4" } } },
                posttag: { columns: { postId: { nativeType: "int4" } } }
              }
            }
          }
        }
      },
      domain: {
        namespaces: {
          public: {
            models: {
              Post: {
                fields: {},
                relations: {
                  comments: {
                    cardinality: "1:N",
                    to: { model: "Comment", namespace: "public" },
                    on: { localFields: ["id"], targetFields: ["postId"] }
                  },
                  stray: {
                    cardinality: "1:N",
                    to: { model: "PostTag" }
                  },
                  tags: {
                    cardinality: "1:N",
                    to: { model: "PostTag", namespace: "public" },
                    on: { localFields: ["id"], targetFields: ["postId"] }
                  }
                },
                storage: { table: "post", namespaceId: "public", fields: { id: { column: "id" } } }
              },
              Comment: {
                fields: {},
                relations: {},
                storage: { table: "comment", namespaceId: "public", fields: { id: { column: "id" } } }
              },
              PostTag: {
                fields: {},
                relations: {
                  post: {
                    cardinality: "N:1",
                    to: { model: "Post", namespace: "public" },
                    on: { localFields: ["postId"], targetFields: ["id"] }
                  }
                },
                storage: {
                  table: "posttag",
                  namespaceId: "public",
                  fields: { postId: { column: "postId" } }
                }
              }
            }
          }
        }
      }
    };

    const { definition, diagnostics } = buildDoc(doc, true);
    expect(diagnostics).toEqual([]);
    const post = definition.models
      .find((model) => model.name === "PostTag")!
      .relationFields.find((field) => field.name === "post")!;
    expect(post.backPopulates).toBe("tags");
  });
});

describe("buildSchemaDefinitionFromContract: explicit many-to-many and composite keys", () => {
  it("links many-to-many relations through the join model", async () => {
    const { definition, diagnostics } = await loadContract("join-composite.json");
    expect(diagnostics).toEqual([]);

    const book = definition.models.find((model) => model.name === "Book")!;
    const tags = book.relationFields.find((field) => field.name === "tags")!;
    expect(tags.isList).toBe(true);
    expect(tags.targetModel).toBe("Tag");
    expect(tags.backPopulates).toBe("books");
    expect(tags.linkModelName).toBe("BookTag");

    const tag = definition.models.find((model) => model.name === "Tag")!;
    const books = tag.relationFields.find((field) => field.name === "books")!;
    expect(books.backPopulates).toBe("tags");
    expect(books.linkModelName).toBe("BookTag");

    const join = definition.models.find((model) => model.name === "BookTag")!;
    expect(join.tableName).toBe("book_tag");
    expect(join.constraints).toEqual(
      expect.arrayContaining([{ kind: "primary_key", fields: [{ name: "bookId" }, { name: "tagId" }] }])
    );
    const autoIndexes = join.constraints.filter((constraint) => constraint.kind === "index");
    expect(autoIndexes.map((constraint) => constraint.fields)).toEqual([
      [{ name: "bookId" }],
      [{ name: "tagId" }]
    ]);
  });

  it("builds composite primary keys and foreign keys", async () => {
    const { definition } = await loadContract("join-composite.json");

    const tenant = definition.models.find((model) => model.name === "Tenant")!;
    expect(tenant.constraints).toMatchObject([
      { kind: "primary_key", fields: [{ name: "orgId" }, { name: "teamId" }] }
    ]);

    const member = definition.models.find((model) => model.name === "Member")!;
    expect(member.foreignKeys).toHaveLength(1);
    expect(member.foreignKeys[0]).toMatchObject({
      fields: ["orgId", "teamId"],
      targetModel: "Tenant",
      targetFields: ["orgId", "teamId"],
      onDelete: "CASCADE"
    });
  });

  it("marks relations without a back side as one-sided", async () => {
    const { definition } = await loadContract("join-composite.json");

    const member = definition.models.find((model) => model.name === "Member")!;
    const tenant = member.relationFields.find((field) => field.name === "tenant")!;
    expect(tenant.backPopulates).toBe("");
    expect(tenant.foreignKeyFieldNames).toEqual(["orgId", "teamId"]);
  });
});

describe("buildSchemaDefinitionFromContract: value objects and variants", () => {
  it("builds value objects as nested models over jsonb columns", async () => {
    const { definition, diagnostics } = await loadContract("advanced.json");
    expect(diagnostics).toEqual([]);

    expect(definition.valueObjects?.map((entry) => entry.name)).toEqual(["Address"]);
    const address = definition.valueObjects![0]!;
    expect(address.fields).toEqual([
      { name: "street", pythonName: "street", pythonType: "str", isNullable: false, isList: false },
      { name: "zip", pythonName: "zip", pythonType: "str", isNullable: true, isList: false }
    ]);

    const doc = definition.models.find((model) => model.name === "Doc")!;
    const addressField = doc.scalarFields.find((field) => field.name === "address")!;
    expect(addressField.pythonType).toBe("Address");
    expect(addressField.isNullable).toBe(true);
    expect(addressField.nativeType).toMatchObject({ name: "JsonB", args: [] });
  });

  it("builds checks and partial indexes", async () => {
    const { definition } = await loadContract("advanced.json");

    const doc = definition.models.find((model) => model.name === "Doc")!;
    expect(doc.checks).toEqual([
      { name: "doc_email_len_5aab927d", expression: "char_length(email) > 3" }
    ]);
    const partial = doc.constraints.find((constraint) => constraint.where !== undefined)!;
    expect(partial).toMatchObject({
      kind: "index",
      name: "doc_email_active_106036f9",
      where: "(email <> '')",
      fields: [{ name: "email" }]
    });
  });

  it("merges single-table variant columns into the base model", async () => {
    const { definition } = await loadContract("advanced.json");

    const task = definition.models.find((model) => model.name === "Task")!;
    expect(task.inheritance).toEqual({
      kind: "base",
      discriminatorField: "type",
      variants: [{ model: "Bug", value: "bug" }]
    });
    const severity = task.scalarFields.find((field) => field.name === "severity")!;
    expect(severity.isNullable).toBe(true);
    expect(severity.pythonType).toBe("str");

    const bug = definition.models.find((model) => model.name === "Bug")!;
    expect(bug.inheritance).toEqual({ kind: "variant", baseModel: "Task", value: "bug", ownsTable: false });
    expect(bug.scalarFields).toEqual([]);
    expect(bug.constraints).toEqual([]);
  });

  it("builds joined-table variants as their own tables", async () => {
    const { definition, diagnostics } = await loadContract("joined-variant.json");
    expect(diagnostics).toEqual([]);

    const bug = definition.models.find((model) => model.name === "Bug")!;
    expect(bug.inheritance).toEqual({ kind: "variant", baseModel: "Task", value: "bug", ownsTable: true });
    expect(bug.tableName).toBe("bug");
    const id = bug.scalarFields.find((field) => field.name === "id")!;
    expect(id.isId).toBe(true);
    expect(id.foreignKey).toMatchObject({ targetModel: "Task", targetFields: ["id"] });

    const task = definition.models.find((model) => model.name === "Task")!;
    expect(task.scalarFields.find((field) => field.name === "severity")).toBeUndefined();
  });
});

describe("buildSchemaDefinitionFromContract: remaining scalars", () => {
  it("maps integers, floats, precisions, and uuid variants", async () => {
    const { definition, diagnostics } = await loadContract("scalars.json");
    expect(diagnostics).toEqual([]);

    const probe = definition.models.find((model) => model.name === "Probe")!;
    const byName = (name: string) => probe.scalarFields.find((field) => field.name === name)!;
    expect(byName("f")).toMatchObject({
      pythonType: "float",
      nativeType: { name: "DoublePrecision", args: [] }
    });
    expect(byName("bi")).toMatchObject({ pythonType: "int", nativeType: { name: "BigInt", args: [] } });
    expect(byName("dec")).toMatchObject({
      pythonType: "Decimal",
      nativeType: { name: "Decimal", args: [] }
    });
    expect(byName("ts").nativeType).toMatchObject({ name: "Timestamp", args: ["3"] });
    expect(byName("tstz").nativeType).toMatchObject({ name: "Timestamptz", args: ["6"] });
    expect(byName("tm").nativeType).toMatchObject({ name: "Time", args: ["2"] });
    expect(byName("ttz").nativeType).toMatchObject({ name: "Timetz", args: [] });
    expect(byName("u4").defaultValue).toMatchObject({ name: "uuid", args: [] });
    expect(byName("u7").defaultValue).toMatchObject({ name: "uuid", args: [] });

    const level = definition.enums.find((entry) => entry.name === "Level")!;
    expect(level.storage).toBe("integer");
    expect(level.values).toEqual([
      { name: "Low", pythonName: "LOW", value: 1 },
      { name: "High", pythonName: "HIGH", value: 2 }
    ]);
    expect(byName("lvl").nativeType).toEqual({ name: "Integer", args: [] });
  });

  it("maps timestampNow execution defaults to client factories", () => {
    const doc = {
      storage: {
        namespaces: {
          public: {
            entries: {
              table: {
                t: {
                  columns: {
                    id: { nativeType: "int4" },
                    u: { nativeType: "timestamptz" }
                  }
                }
              }
            }
          }
        }
      },
      domain: {
        namespaces: {
          public: {
            models: {
              M: {
                fields: {},
                relations: {},
                storage: {
                  table: "t",
                  namespaceId: "public",
                  fields: { id: { column: "id" }, u: { column: "u" } }
                }
              }
            }
          }
        }
      },
      execution: {
        mutations: {
          defaults: [
            {
              ref: { namespace: "public", table: "t", column: "u" },
              onCreate: { kind: "generator", id: "timestampNow" },
              onUpdate: { kind: "generator", id: "timestampNow" }
            }
          ]
        }
      }
    };

    const { definition, diagnostics } = buildDoc(doc, true);
    expect(diagnostics).toEqual([]);
    const field = definition.models
      .find((model) => model.name === "M")!
      .scalarFields.find((entry) => entry.name === "u")!;
    expect(field.isUpdatedAt).toBe(true);
    expect(field.hasDefaultValue).toBe(true);
    expect(field.defaultValue).toMatchObject({ name: "now_client" });
  });

  it("coerces numeric literal defaults by column type", () => {
    const columns: Record<string, unknown> = {
      i: { nativeType: "int4", default: { kind: "literal", value: "0" } },
      b: { nativeType: "int8", default: { kind: "literal", value: "42" } },
      huge: { nativeType: "int8", default: { kind: "literal", value: "9223372036854775807" } },
      junk: { nativeType: "int4", default: { kind: "literal", value: "abc" } },
      f: { nativeType: "float8", default: { kind: "literal", value: "4.5" } },
      n: { nativeType: "numeric", default: { kind: "literal", value: "4.20" } },
      inf: { nativeType: "float8", default: { kind: "literal", value: "1e999" } },
      nf: { nativeType: "float8", default: { kind: "literal", value: "xyz" } },
      s: { nativeType: "text", default: { kind: "literal", value: "hi" } },
      ok: { nativeType: "bool", default: { kind: "literal", value: false } }
    };
    const fields: Record<string, unknown> = {};
    for (const name of Object.keys(columns)) {
      fields[name] = { column: name };
    }
    const doc = {
      storage: { namespaces: { public: { entries: { table: { t: { columns } } } } } },
      domain: {
        namespaces: {
          public: {
            models: {
              M: {
                fields: {},
                relations: {},
                storage: { table: "t", namespaceId: "public", fields }
              }
            }
          }
        }
      }
    };

    const { definition, diagnostics } = buildDoc(doc, true);
    expect(diagnostics).toEqual([]);
    const byName = (name: string) =>
      definition.models.find((model) => model.name === "M")!.scalarFields.find((field) => field.name === name)!;
    expect(byName("i").defaultValue).toBe(0);
    expect(byName("b").defaultValue).toBe(42);
    expect(byName("huge").defaultValue).toBe("9223372036854775807");
    expect(byName("junk").defaultValue).toBe("abc");
    expect(byName("f").defaultValue).toBe(4.5);
    expect(byName("n").defaultValue).toBe(4.2);
    expect(byName("inf").defaultValue).toBe("1e999");
    expect(byName("nf").defaultValue).toBe("xyz");
    expect(byName("s").defaultValue).toBe("hi");
    expect(byName("ok").defaultValue).toBe(false);
  });
});

describe("buildSchemaDefinitionFromContract: malformed and edge-case contracts", () => {
  it("builds an empty definition from an empty contract", () => {
    const { definition, diagnostics } = buildDoc({ storage: {}, domain: {} });

    expect(diagnostics).toEqual([]);
    expect(definition.models).toEqual([]);
    expect(definition.enums).toEqual([]);
  });

  it("tolerates missing optional table sections", () => {
    const { definition, diagnostics } = buildDoc({
      storage: {
        namespaces: {
          public: {
            entries: {
              table: {
                t: {
                  columns: {
                    a: { nativeType: "text", codecId: "pg/text@1" },
                    b: {
                      nativeType: "text",
                      codecId: "pg/text@1",
                      nullable: false,
                      default: { kind: "weird" }
                    },
                    c: 42,
                    vs: { nativeType: "text", codecId: "pg/text@1", nullable: true, valueSet: {} },
                    dflt: {
                      nativeType: "text",
                      codecId: "pg/text@1",
                      nullable: true,
                      default: { kind: "literal", value: null }
                    },
                    objlit: {
                      nativeType: "text",
                      codecId: "pg/text@1",
                      nullable: true,
                      default: { kind: "literal", value: {} }
                    },
                    notype: {
                      nativeType: "character varying",
                      codecId: "sql/varchar@1",
                      nullable: true,
                      typeRef: "Nope"
                    },
                    lit2: {
                      nativeType: "text",
                      codecId: "pg/text@1",
                      nullable: true,
                      default: { kind: "literal" }
                    },
                    fnexpr: {
                      nativeType: "text",
                      codecId: "pg/text@1",
                      nullable: true,
                      default: { kind: "function" }
                    },
                    charbare: { nativeType: "character", nullable: true },
                    tsbare: { nativeType: "timestamp", nullable: true },
                    ttzp: { nativeType: "timetz", nullable: true, typeParams: { precision: 3 } },
                    nump: { nativeType: "numeric", nullable: true, typeParams: { precision: 10 } },
                    c2: { nativeType: "text", nullable: true }
                  },
                  uniques: [{ columns: ["a", "b"] }, {}],
                  indexes: [42, { columns: ["a"], name: "i_a" }],
                  checks: [{}, { expression: "a <> b" }],
                  foreignKeys: [
                    {},
                    { source: { columns: ["a"] }, target: {} },
                    { source: { columns: ["a"] }, target: { columns: ["b"] } },
                    {
                      source: { columns: ["b"] },
                      target: { columns: ["b"], tableName: "ghost" }
                    }
                  ]
                }
              }
            }
          }
        }
      },
      domain: {
        namespaces: {
          public: {
            models: {
              M: {
                fields: { a: { type: { kind: "valueObject" }, valueSet: {} } },
                relations: {},
                storage: { table: "t", namespaceId: "public", fields: { a: { column: "a" }, ghost: {} } }
              }
            }
          }
        }
      },
      execution: {
        mutations: {
          defaults: [
            {
              ref: { namespace: "public", table: "t", column: "b" },
              onUpdate: { kind: "generator", id: "instantNow" }
            },
            { ref: { namespace: "public", table: "t", column: "a" }, onCreate: 42 },
            {
              ref: { namespace: "public", table: "t", column: "c2" },
              onCreate: { kind: "generator", id: "cuid2" }
            },
            { ref: 42 },
            42
          ]
        }
      }
    });

    expect(diagnostics.map((entry) => entry.code)).toEqual([
      "UNKNOWN_COLUMN_TYPE",
      "UNSUPPORTED_CLIENT_SIDE_DEFAULT"
    ]);
    expect(diagnostics[1]!.field).toBe("c2");
    const model = definition.models.find((entry) => entry.name === "M")!;
    const byName = (name: string) => model.scalarFields.find((field) => field.name === name)!;
    expect(byName("a").isNullable).toBe(true);
    expect(byName("a").pythonType).toBe("str");
    expect(byName("lit2").hasDefaultValue).toBe(false);
    expect(byName("fnexpr").defaultValue).toMatchObject({ name: "dbgenerated", args: [""] });
    expect(byName("b").isUpdatedAt).toBe(true);
    expect(byName("b").hasDefaultValue).toBe(false);
    expect(byName("dflt").defaultValue).toBeNull();
    expect(byName("dflt").defaultKind).toBe("scalar");
    expect(byName("objlit").defaultValue).toEqual({});
    expect(byName("notype").nativeType).toEqual({ name: "VarChar", args: [] });
    expect(byName("vs").pythonType).toBe("str");
    expect(model.constraints).toMatchObject([
      { kind: "unique", fields: [{ name: "a" }, { name: "b" }] },
      { kind: "index", name: "i_a", fields: [{ name: "a" }] }
    ]);
    expect(model.checks).toEqual([{ name: undefined, expression: "a <> b" }]);
    expect(byName("a").foreignKey).toMatchObject({ targetModel: "", targetFields: ["b"] });
    expect(byName("b").foreignKey).toMatchObject({ targetModel: "ghost", targetFields: ["b"] });
    expect(byName("charbare").nativeType).toEqual({ name: "Char", args: [] });
    expect(byName("tsbare").nativeType).toEqual({ name: "Timestamp", args: [] });
    expect(byName("ttzp").nativeType).toEqual({ name: "Timetz", args: ["3"] });
    expect(byName("nump").nativeType).toEqual({ name: "Decimal", args: ["10"] });
  });

  it("detects cross-namespace variants and qualifies non-public tables", () => {
    const { definition, diagnostics } = buildDoc({
      storage: {
        namespaces: {
          public: { entries: { table: { plain: { columns: { id: { nativeType: "int4" } } } } } },
          billing: { entries: { table: { plain: { columns: { id: { nativeType: "int4" } } } } } }
        }
      },
      domain: {
        namespaces: {
          public: {
            models: {
              Plain: { storage: { table: "plain", namespaceId: "public", fields: {} } }
            }
          },
          billing: {
            models: {
              V3: {
                base: { model: "Plain", namespaceId: "public" },
                storage: { table: "plain", namespaceId: "billing", fields: {} }
              }
            }
          }
        }
      }
    });

    expect(diagnostics).toEqual([]);
    const variant = definition.models.find((entry) => entry.name === "V3")!;
    expect(variant.inheritance).toEqual({
      kind: "variant",
      baseModel: "Plain",
      value: "",
      ownsTable: true
    });
    expect(variant.tableSchema).toBe("billing");
    expect(definition.models.find((entry) => entry.name === "Plain")!.tableSchema).toBeUndefined();
  });

  it("leaves the table schema off shared-table variants", () => {
    const { definition, diagnostics } = buildDoc({
      storage: {
        namespaces: {
          billing: {
            entries: {
              table: {
                t: {
                  columns: {
                    id: { nativeType: "int4", nullable: false },
                    type: { nativeType: "text", nullable: false }
                  },
                  primaryKey: { columns: ["id"] }
                }
              }
            }
          }
        }
      },
      domain: {
        namespaces: {
          billing: {
            models: {
              Base: {
                discriminator: { field: "type" },
                variants: { V: { value: "v" } },
                storage: { table: "t", namespaceId: "billing", fields: {} }
              },
              V: {
                base: { model: "Base", namespaceId: "billing" },
                storage: { table: "t", namespaceId: "billing", fields: {} }
              }
            }
          }
        }
      }
    });

    expect(diagnostics).toEqual([]);
    const base = definition.models.find((entry) => entry.name === "Base")!;
    expect(base.tableSchema).toBe("billing");
    const variant = definition.models.find((entry) => entry.name === "V")!;
    expect(variant.inheritance).toMatchObject({ kind: "variant", ownsTable: false });
    expect(variant.tableSchema).toBeUndefined();
  });

  it("normalizes every referential action and reports unknown ones", () => {
    const foreignKeys = [
      { column: "c0", onDelete: "setDefault" },
      { column: "c1", onDelete: "restrict", onUpdate: "setNull" },
      { column: "c2", onDelete: "noAction" }
    ].map(({ column, onDelete, onUpdate }) => ({
      source: { columns: [column] },
      target: { columns: ["id"], namespaceId: "public", tableName: "t" },
      onDelete,
      ...(onUpdate ? { onUpdate } : {})
    }));

    const { definition, diagnostics } = buildDoc({
      storage: {
        namespaces: {
          public: {
            entries: {
              table: {
                t: {
                  columns: {
                    id: { nativeType: "int4", codecId: "pg/int4@1", nullable: false },
                    c0: { nativeType: "int4", codecId: "pg/int4@1", nullable: true },
                    c1: { nativeType: "int4", codecId: "pg/int4@1", nullable: true },
                    c2: { nativeType: "int4", codecId: "pg/int4@1", nullable: true },
                    c3: { nativeType: "int4", codecId: "pg/int4@1", nullable: true },
                    e: { nativeType: "int4", codecId: "pg/int4@1", nullable: true }
                  },
                  primaryKey: { columns: ["id"] },
                  uniques: [],
                  indexes: [],
                  checks: [],
                  foreignKeys: [
                    ...foreignKeys,
                    {
                      source: { columns: ["c3"] },
                      target: { columns: ["id"], namespaceId: "public", tableName: "t" },
                      onDelete: "wiggle"
                    },
                    {
                      source: { columns: ["e"] },
                      target: { columns: ["id"], namespaceId: "public", tableName: "t" },
                      onDelete: "wiggle"
                    }
                  ]
                }
              }
            }
          }
        }
      },
      domain: {
        namespaces: {
          public: {
            models: {
              M: {
                fields: {},
                relations: {},
                storage: {
                  table: "t",
                  namespaceId: "public",
                  fields: {
                    id: { column: "id" },
                    c0: { column: "c0" },
                    c1: { column: "c1" },
                    c2: { column: "c2" },
                    c3: { column: "c3" }
                  }
                }
              }
            }
          }
        }
      }
    });

    expect(diagnostics.map((entry) => entry.code)).toEqual([
      "UNSUPPORTED_REFERENTIAL_ACTION",
      "UNSUPPORTED_REFERENTIAL_ACTION"
    ]);
    expect(diagnostics.map((entry) => entry.field)).toEqual(["c3", "e"]);
    const model = definition.models.find((entry) => entry.name === "M")!;
    const byName = (name: string) => model.scalarFields.find((field) => field.name === name)!;
    expect(byName("c0").foreignKey?.onDelete).toBe("SET DEFAULT");
    expect(byName("c1").foreignKey).toMatchObject({ onDelete: "RESTRICT", onUpdate: "SET NULL" });
    expect(byName("c2").foreignKey?.onDelete).toBe("NO ACTION");
    expect(byName("c3").foreignKey?.onDelete).toBeUndefined();
  });

  it("reports relations to missing models in strict mode and skips them otherwise", () => {
    const doc = {
      storage: {
        namespaces: {
          public: {
            entries: {
              table: {
                a: { columns: { id: { nativeType: "int4" } } },
                et2: 42
              }
            }
          }
        }
      },
      domain: {
        namespaces: {
          public: {
            models: {
              A: {
                fields: {},
                relations: {
                  r1: 42,
                  r2: {
                    cardinality: "N:1",
                    to: { model: "Ghost", namespace: "public" },
                    on: { localFields: ["id"], targetFields: ["id"] }
                  },
                  r3: {
                    cardinality: "N:1",
                    to: { model: "A", namespace: "public" },
                    on: { localFields: ["id", "a"] }
                  }
                },
                storage: { table: "a", namespaceId: "public", fields: { id: { column: "id" } } }
              },
              ET2: { storage: { table: "et2", namespaceId: "public", fields: {} } }
            }
          }
        }
      }
    };

    const strict = buildDoc(doc, true);
    expect(strict.diagnostics.map((entry) => entry.code)).toEqual([
      "UNRESOLVED_RELATION_TARGET",
      "UNRESOLVED_RELATION_TARGET"
    ]);
    expect(
      strict.definition.models.find((entry) => entry.name === "A")!.relationFields.map((entry) => entry.name)
    ).toEqual(["r3"]);

    const lax = buildDoc(doc, false);
    expect(lax.diagnostics).toEqual([]);
    const relations = lax.definition.models.find((entry) => entry.name === "A")!.relationFields;
    expect(relations.map((entry) => entry.name)).toEqual(["r3"]);
    expect(relations[0]).toMatchObject({ backPopulates: "" });
  });

  it("reports many-to-many relations with an unresolvable join table", () => {
    const doc = {
      storage: {
        namespaces: {
          public: {
            entries: {
              table: {
                a: { columns: { id: { nativeType: "int4" } } },
                b: { columns: { id: { nativeType: "int4" } } },
                j: { columns: { id: { nativeType: "int4" } } }
              }
            }
          }
        }
      },
      domain: {
        namespaces: {
          public: {
            models: {
              A: {
                fields: {},
                relations: {
                  items: {
                    cardinality: "N:M",
                    to: { model: "B", namespace: "public" },
                    on: { localFields: ["id"], targetFields: ["x"] },
                    through: { table: "nope", namespaceId: "public" }
                  },
                  items3: {
                    cardinality: "N:M",
                    to: { model: "B", namespace: "public" },
                    on: { localFields: ["id"], targetFields: ["x"] },
                    through: { table: "j" }
                  },
                  items4: {
                    cardinality: "N:M",
                    to: { model: "B", namespace: "public" },
                    on: { localFields: ["id"], targetFields: ["x"] }
                  },
                  items5: {
                    cardinality: "N:M",
                    to: { model: "B", namespace: "public" },
                    through: { table: "j", namespaceId: "public" }
                  }
                },
                storage: { table: "a", namespaceId: "public", fields: { id: { column: "id" } } }
              },
              B: {
                fields: {},
                relations: {
                  other: {
                    cardinality: "N:M",
                    to: { model: "A", namespace: "public" },
                    on: { localFields: ["id"], targetFields: ["x"] },
                    through: { table: "other" }
                  },
                  other2: {
                    cardinality: "N:M",
                    to: { model: "A", namespace: "public" },
                    on: { localFields: ["id"], targetFields: ["x"] },
                    through: { table: "j", namespaceId: "other-ns" }
                  },
                  junk: 42,
                  other3: {
                    cardinality: "N:M",
                    to: { model: "A" },
                    on: { localFields: ["id"], targetFields: ["x"] },
                    through: { table: "j" }
                  }
                },
                storage: { table: "b", namespaceId: "public", fields: { id: { column: "id" } } }
              },
              J: {
                fields: {},
                relations: {},
                storage: { table: "j", namespaceId: "public", fields: { id: { column: "id" } } }
              }
            }
          }
        }
      }
    };

    const strict = buildDoc(doc, true);
    expect(strict.diagnostics.map((entry) => entry.code)).toEqual([
      "UNRESOLVED_LINK_MODEL",
      "UNRESOLVED_LINK_MODEL",
      "UNRESOLVED_LINK_MODEL",
      "UNRESOLVED_LINK_MODEL",
      "UNRESOLVED_RELATION_TARGET"
    ]);

    const lax = buildDoc(doc, false);
    expect(lax.diagnostics).toEqual([]);
    const relations = lax.definition.models.find((entry) => entry.name === "A")!.relationFields;
    expect(relations.map((entry) => entry.name)).toEqual(["items3", "items5"]);
    expect(relations[0]).toMatchObject({ linkModelName: "J", backPopulates: "other3" });
    const bRelations = lax.definition.models.find((entry) => entry.name === "B")!.relationFields;
    expect(bRelations.map((entry) => entry.name)).toEqual(["other3"]);
    expect(bRelations[0]).toMatchObject({ linkModelName: "J", backPopulates: "items3" });
  });

  it("leaves back-population empty for one-sided many-to-many relations", () => {
    const doc = {
      storage: {
        namespaces: {
          public: {
            entries: {
              table: {
                a: { columns: { id: { nativeType: "int4" } } },
                b: { columns: { id: { nativeType: "int4" } } },
                j: { columns: { id: { nativeType: "int4" } } }
              }
            }
          }
        }
      },
      domain: {
        namespaces: {
          public: {
            models: {
              A: {
                fields: {},
                relations: {
                  items: {
                    cardinality: "N:M",
                    to: { model: "B", namespace: "public" },
                    on: { localFields: ["id"], targetFields: ["id"] },
                    through: { table: "j", namespaceId: "public" }
                  }
                },
                storage: { table: "a", namespaceId: "public", fields: { id: { column: "id" } } }
              },
              B: {
                fields: {},
                relations: {},
                storage: { table: "b", namespaceId: "public", fields: { id: { column: "id" } } }
              },
              J: {
                fields: {},
                relations: {},
                storage: { table: "j", namespaceId: "public", fields: { id: { column: "id" } } }
              }
            }
          }
        }
      }
    };

    const strict = buildDoc(doc, true);
    expect(strict.diagnostics).toEqual([]);
    const relations = strict.definition.models.find((entry) => entry.name === "A")!.relationFields;
    expect(relations).toHaveLength(1);
    expect(relations[0]).toMatchObject({ name: "items", linkModelName: "J", backPopulates: "" });
  });

  it("reports composite primary keys with defaults only in strict mode", () => {
    const doc = {
      storage: {
        namespaces: {
          public: {
            entries: {
              table: {
                t: {
                  columns: {
                    a: {
                      nativeType: "text",
                      nullable: false,
                      default: { kind: "literal", value: "x" }
                    },
                    b: { nativeType: "text", nullable: false },
                    c: {
                      nativeType: "text",
                      nullable: true,
                      default: { kind: "literal", value: "y" }
                    }
                  },
                  primaryKey: { columns: ["a", "b"] }
                }
              }
            }
          }
        }
      },
      domain: {
        namespaces: {
          public: {
            models: {
              M: {
                fields: {},
                relations: {},
                storage: { table: "t", namespaceId: "public", fields: { a: { column: "a" } } }
              }
            }
          }
        }
      }
    };

    expect(buildDoc(doc, true).diagnostics.map((entry) => entry.code)).toEqual([
      "UNSUPPORTED_COMPOSITE_PK_DEFAULT"
    ]);
    expect(buildDoc(doc, false).diagnostics).toEqual([]);
  });

  it("reports Python name collisions for types, fields, and enum values", () => {
    const { diagnostics } = buildDoc({
      storage: {
        namespaces: {
          public: {
            entries: {
              table: {
                t1: { columns: { c1: { nativeType: "text" }, c2: { nativeType: "text" } } },
                t2: { columns: { c1: { nativeType: "text" } } }
              }
            }
          }
        }
      },
      domain: {
        namespaces: {
          public: {
            models: {
              "my-model": {
                fields: {},
                relations: {},
                storage: {
                  table: "t1",
                  namespaceId: "public",
                  fields: { "a-b": { column: "c1" }, a_b: { column: "c2" } }
                }
              },
              my_model: {
                fields: {},
                relations: {},
                storage: { table: "t2", namespaceId: "public", fields: {} }
              }
            },
            enum: { E: { codecId: "pg/text@1", members: [{ name: "x-y" }, { name: "x_y" }] } }
          }
        }
      }
    });

    expect(diagnostics.map((entry) => entry.code)).toEqual([
      "PYTHON_TYPE_NAME_COLLISION",
      "PYTHON_FIELD_NAME_COLLISION",
      "PYTHON_ENUM_VALUE_COLLISION"
    ]);
  });

  it("reports unknown sections, enums, defaults, and value-object codecs", () => {
    const { definition, diagnostics } = buildDoc({
      storage: {
        namespaces: {
          public: {
            entries: {
              table: {
                t: { columns: { id: { nativeType: "int4" } } },
                t2: {
                  columns: {
                    e: { nativeType: "text", valueSet: { entityName: "Nope" } },
                    lit: {
                      nativeType: "text",
                      valueSet: { entityName: "Lit", namespaceId: "public" },
                      default: { kind: "literal", value: "zzz" }
                    }
                  }
                },
                orph: { columns: { id: { nativeType: "int4" } } },
                plain: { columns: { id: { nativeType: "int4" } } },
                v2: { columns: { id: { nativeType: "int4" } } }
              },
              native_enum: { N: {} },
              view: {}
            }
          },
          weird: 42
        }
      },
      domain: {
        namespaces: {
          weird: 42,
          empty: {},
          public: {
            models: {
              M: {
                fields: {},
                relations: {},
                variants: { Ok: { value: "v" }, Bad: 42 },
                discriminator: { field: "t" },
                storage: { table: "t", namespaceId: "public", fields: {} }
              },
              M2: {
                fields: 42,
                relations: 42,
                variants: { Z: { value: "z" } },
                storage: { table: "t2", namespaceId: "public", fields: 42 }
              },
              Lonely: {},
              Broken: 42,
              Orphan: { base: {}, storage: { table: "orph", namespaceId: "public", fields: {} } },
              Plain: {
                variants: { Other: { value: "o" } },
                storage: { table: "plain", namespaceId: "public", fields: {} }
              },
              V2: {
                base: { model: "Plain", namespaceId: "public" },
                storage: { table: "v2", namespaceId: "public", fields: {} }
              }
            },
            enum: {
              E: 42,
              Lit: { codecId: "pg/text@1", members: [{ name: "A", value: "a" }, 42] }
            },
            valueObjects: {
              V: { fields: { x: { type: { kind: "scalar", codecId: "xx" }, many: true } } },
              N: {
                fields: {
                  inner: { type: { kind: "valueObject", name: "V" } },
                  noname: { type: { kind: "valueObject" } },
                  broken: 42,
                  notype: {}
                }
              },
              W: 42,
              W2: { fields: 42 }
            },
            bogus: {}
          }
        }
      }
    });

    expect(diagnostics.map((entry) => entry.code)).toEqual([
      "UNSUPPORTED_CONTRACT_SECTION",
      "UNSUPPORTED_CONTRACT_SECTION",
      "UNKNOWN_VALUE_OBJECT_TYPE",
      "UNKNOWN_VALUE_OBJECT_TYPE",
      "UNKNOWN_VALUE_OBJECT_TYPE",
      "UNKNOWN_VALUE_OBJECT_TYPE",
      "UNKNOWN_ENUM_REFERENCE",
      "UNKNOWN_ENUM_DEFAULT_VALUE",
      "UNRESOLVED_MODEL_TABLE",
      "UNRESOLVED_MODEL_TABLE",
      "PYTHON_TYPE_NAME_COLLISION"
    ]);

    const model = definition.models.find((entry) => entry.name === "M")!;
    expect(model.inheritance).toEqual({
      kind: "base",
      discriminatorField: "t",
      variants: [{ model: "Ok", value: "v" }]
    });
    expect(definition.valueObjects?.find((entry) => entry.name === "V")?.fields).toEqual([
      { name: "x", pythonName: "x", pythonType: "Any", isNullable: true, isList: true }
    ]);
    expect(definition.valueObjects?.find((entry) => entry.name === "N")?.fields).toEqual([
      { name: "inner", pythonName: "inner", pythonType: "V", isNullable: true, isList: false },
      { name: "noname", pythonName: "noname", pythonType: "Any", isNullable: true, isList: false },
      { name: "broken", pythonName: "broken", pythonType: "Any", isNullable: true, isList: false },
      { name: "notype", pythonName: "notype", pythonType: "Any", isNullable: true, isList: false }
    ]);
    expect(definition.valueObjects?.find((entry) => entry.name === "W")?.fields).toEqual([]);
    expect(definition.valueObjects?.find((entry) => entry.name === "W2")?.fields).toEqual([]);
    const m2 = definition.models.find((entry) => entry.name === "M2")!;
    expect(m2.inheritance).toEqual({
      kind: "base",
      discriminatorField: "",
      variants: [{ model: "Z", value: "z" }]
    });
    expect(definition.models.find((entry) => entry.name === "Orphan")!.inheritance).toEqual({
      kind: "variant",
      baseModel: "",
      value: "",
      ownsTable: true
    });
    expect(definition.models.find((entry) => entry.name === "V2")!.inheritance).toEqual({
      kind: "variant",
      baseModel: "Plain",
      value: "",
      ownsTable: true
    });
    const textEnum = definition.enums.find((entry) => entry.name === "E")!;
    expect(textEnum.storage).toBe("text");
    expect(textEnum.values).toEqual([]);
    expect(definition.enums.find((entry) => entry.name === "N")!.values).toEqual([]);
  });

  it("reports unknown column types and execution defaults", () => {
    const { diagnostics } = buildDoc({
      storage: {
        namespaces: {
          public: {
            entries: {
              table: {
                t: {
                  columns: {
                    weird: { nativeType: "vector(3)", codecId: "pgvector/vector@1", nullable: true },
                    gen: { nativeType: "text", nullable: true }
                  }
                }
              }
            }
          }
        }
      },
      domain: {
        namespaces: {
          public: {
            models: {
              M: {
                fields: {},
                relations: {},
                storage: { table: "t", namespaceId: "public", fields: {} }
              }
            }
          }
        }
      },
      execution: {
        mutations: {
          defaults: [
            {
              ref: { namespace: "public", table: "t", column: "gen" },
              onCreate: { kind: "generator", id: "flux9" },
              onUpdate: { kind: "generator", id: "flux9" }
            }
          ]
        }
      }
    });

    expect(diagnostics.map((entry) => entry.code)).toEqual([
      "UNKNOWN_COLUMN_TYPE",
      "UNSUPPORTED_EXECUTION_DEFAULT",
      "UNSUPPORTED_EXECUTION_DEFAULT"
    ]);
  });

  it("falls back to UNKNOWN for unnamed enum members", () => {
    const { definition } = buildDoc({
      storage: { namespaces: {} },
      domain: {
        namespaces: {
          public: {
            models: {},
            enum: { E: { members: [{}, { name: "X", value: true }] } }
          }
        }
      }
    });

    expect(definition.enums.find((entry) => entry.name === "E")!.values).toEqual([
      { name: "UNKNOWN", pythonName: "UNKNOWN", value: "" },
      { name: "X", pythonName: "X", value: "" }
    ]);
  });
});

function buildDoc(
  doc: Record<string, unknown>,
  strict = true
): { definition: SchemaDefinition; diagnostics: Diagnostic[] } {
  const text = JSON.stringify({
    schemaVersion: "1",
    targetFamily: "sql",
    target: "postgres",
    ...doc
  });
  const parsed = parseContractDocument(text);
  expect(parsed.diagnostics).toEqual([]);
  if (!parsed.document) {
    throw new Error("synthetic contract failed to parse");
  }
  return buildSchemaDefinitionFromContract(parsed.document, strict);
}
