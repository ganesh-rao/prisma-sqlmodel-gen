import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { getDMMF } from "@prisma/internals";
import { resolveGeneratorConfig } from "../src/config.js";
import { formatDiagnostics } from "../src/diagnostics.js";
import { checkSqlModelGeneration, generateSqlModel } from "../src/generate.js";
import { PACKAGE_VERSION } from "../src/version.js";

const postgresSchema = `datasource db {
  provider = "postgresql"
}

generator sqlmodel {
  provider = "prisma-sqlmodel-gen"
  output   = "./generated/sqlmodel"
}

enum Role {
  ADMIN
  USER
}

model User {
  id           Int       @id @default(autoincrement())
  email        String    @unique @db.VarChar(255)
  displayName  String?   @map("display_name") @db.VarChar(120)
  role         Role      @default(USER)
  posts        Post[]
  profile      Profile?
  createdAt    DateTime  @default(now()) @db.Timestamptz(6)

  @@map("users")
}

model Post {
  id        Int      @id @default(autoincrement())
  title     String   @db.VarChar(200)
  metadata  Json?
  authorId  Int      @map("author_id")
  author    User     @relation(fields: [authorId], references: [id])

  @@index([authorId], map: "posts_author_id_idx")
}

model Profile {
  id      Int   @id
  userId  Int   @unique(map: "profiles_user_id_key")
  user    User  @relation(fields: [userId], references: [id])
}`;

const mysqlSchema = `datasource db {
  provider = "mysql"
}

generator sqlmodel {
  provider = "prisma-sqlmodel-gen"
  output   = "./generated/sqlmodel"
}

model Device {
  id         Int      @id @default(autoincrement())
  serial     String   @unique @db.VarChar(64)
  payload    Bytes?   @db.VarBinary(255)
  amount     Decimal  @db.Decimal(10, 2)
  createdAt  DateTime @db.DateTime(3)
}`;

const explicitJoinSchema = `datasource db {
  provider = "postgresql"
}

generator sqlmodel {
  provider = "prisma-sqlmodel-gen"
  output   = "./generated/sqlmodel"
}

model User {
  id           Int          @id @default(autoincrement())
  memberships  Membership[]
}

model Project {
  id           Int          @id @default(autoincrement())
  memberships  Membership[]
}

model Membership {
  userId    Int
  projectId Int
  role      String @db.VarChar(20)
  user      User   @relation(fields: [userId], references: [id])
  project   Project @relation(fields: [projectId], references: [id])

  @@id([userId, projectId])
  @@map("memberships")
}`;

const multiRelationSchema = `datasource db {
  provider = "postgresql"
}

generator sqlmodel {
  provider = "prisma-sqlmodel-gen"
  output   = "./generated/sqlmodel"
}

model User {
  id            Int    @id @default(autoincrement())
  authoredPosts Post[] @relation("AuthoredPosts")
  reviewedPosts Post[] @relation("ReviewedPosts")
}

model Post {
  id         Int   @id @default(autoincrement())
  authorId   Int   @map("author_id")
  reviewerId Int?  @map("reviewer_id")
  author     User  @relation("AuthoredPosts", fields: [authorId], references: [id])
  reviewer   User? @relation("ReviewedPosts", fields: [reviewerId], references: [id])
}`;

const selfRelationSchema = `datasource db {
  provider = "postgresql"
}

generator sqlmodel {
  provider = "prisma-sqlmodel-gen"
  output   = "./generated/sqlmodel"
}

model Category {
  id       Int        @id @default(autoincrement())
  parentId Int?       @map("parent_id")
  parent   Category?  @relation("CategoryTree", fields: [parentId], references: [id])
  children Category[] @relation("CategoryTree")
}`;

const multiSchemaSchema = `datasource db {
  provider = "postgresql"
  schemas  = ["public", "tenant_a"]
}

generator sqlmodel {
  provider = "prisma-sqlmodel-gen"
  output   = "./generated/sqlmodel"
}

model User {
  id    Int    @id @default(autoincrement())
  posts Post[]

  @@map("users")
  @@schema("tenant_a")
}

model Post {
  id       Int   @id @default(autoincrement())
  authorId Int   @map("author_id")
  author   User  @relation(fields: [authorId], references: [id], onDelete: Cascade, onUpdate: Restrict, map: "posts_author_fk")

  @@schema("tenant_a")
}`;

const compositeRelationSchema = `datasource db {
  provider = "postgresql"
}

generator sqlmodel {
  provider = "prisma-sqlmodel-gen"
  output   = "./generated/sqlmodel"
}

model Parent {
  leftId  Int
  rightId Int
  kids    Child[]

  @@id([leftId, rightId])
}

model Child {
  id          Int    @id @default(autoincrement())
  parentLeft  Int
  parentRight Int
  parent      Parent @relation(fields: [parentLeft, parentRight], references: [leftId, rightId], onDelete: Cascade, onUpdate: Restrict, map: "child_parent_fk")
}`;

const postgresListsSchema = `datasource db {
  provider = "postgresql"
}

generator sqlmodel {
  provider = "prisma-sqlmodel-gen"
  output   = "./generated/sqlmodel"
}

enum Role {
  ADMIN
  USER
}

model User {
  id        Int        @id @default(autoincrement())
  tags      String[]
  scores    Int[]
  active    Boolean[]
  roles     Role[]
  seenAt    DateTime[]
}`;

const mysqlIndexOptionsSchema = `datasource db {
  provider = "mysql"
}

generator sqlmodel {
  provider = "prisma-sqlmodel-gen"
  output   = "./generated/sqlmodel"
}

model User {
  id    Int    @id @default(autoincrement())
  email String @db.VarChar(255)
  slug  String @db.VarChar(255)

  @@index([email(length: 10), slug(sort: Desc)], map: "user_lookup_idx")
}`;

const updatedAtSchema = `datasource db {
  provider = "postgresql"
}

generator sqlmodel {
  provider = "prisma-sqlmodel-gen"
  output   = "./generated/sqlmodel"
}

model Event {
  id         Int      @id @default(autoincrement())
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  touchedAt  DateTime @default(now()) @updatedAt
}`;

const relationModeSchema = `datasource db {
  provider     = "postgresql"
  relationMode = "prisma"
}

generator sqlmodel {
  provider = "prisma-sqlmodel-gen"
  output   = "./generated/sqlmodel"
}

model User {
  id Int @id @default(autoincrement())
}`;

const ignoreFieldSchema = `datasource db {
  provider = "postgresql"
}

generator sqlmodel {
  provider = "prisma-sqlmodel-gen"
  output   = "./generated/sqlmodel"
}

model User {
  id       Int    @id @default(autoincrement())
  hidden   String @ignore
}`;

const ignoreModelSchema = `datasource db {
  provider = "postgresql"
}

generator sqlmodel {
  provider = "prisma-sqlmodel-gen"
  output   = "./generated/sqlmodel"
}

model User {
  id       Int    @id @default(autoincrement())

  @@ignore
}`;

const sanitizationSchema = `datasource db {
  provider = "postgresql"
}

generator sqlmodel {
  provider = "prisma-sqlmodel-gen"
  output   = "./generated/sqlmodel"
}

model Order {
  id    Int    @id @default(autoincrement())
  from  String @db.VarChar(50)
}`;

const implicitManySchema = `datasource db {
  provider = "postgresql"
}

generator sqlmodel {
  provider = "prisma-sqlmodel-gen"
  output   = "./generated/sqlmodel"
}

model Post {
  id    Int    @id @default(autoincrement())
  tags  Tag[]
}

model Tag {
  id    Int    @id @default(autoincrement())
  posts Post[]
}`;

const unsupportedDefaultSchema = `datasource db {
  provider = "postgresql"
}

generator sqlmodel {
  provider = "prisma-sqlmodel-gen"
  output   = "./generated/sqlmodel"
}

model User {
  id String @id @default(cuid())
}`;

const sqliteSchema = `datasource db {
  provider = "sqlite"
}

generator sqlmodel {
  provider = "prisma-sqlmodel-gen"
  output   = "./generated/sqlmodel"
}

model User {
  id Int @id @default(autoincrement())
}`;

const fieldCollisionSchema = `datasource db {
  provider = "postgresql"
}

generator sqlmodel {
  provider = "prisma-sqlmodel-gen"
  output   = "./generated/sqlmodel"
}

model User {
  id     Int    @id @default(autoincrement())
  from   String @db.VarChar(50)
  from_  String @db.VarChar(50)
}`;

const advancedIndexSchema = `datasource db {
  provider = "postgresql"
}

generator sqlmodel {
  provider = "prisma-sqlmodel-gen"
  output   = "./generated/sqlmodel"
}

model User {
  id    Int    @id
  value String @db.VarChar(255)

  @@index([value(ops: raw("gin_trgm_ops"))], type: Gin)
}`;

const expressionIndexSchema = `datasource db {
  provider = "postgresql"
}

generator sqlmodel {
  provider = "prisma-sqlmodel-gen"
  output   = "./generated/sqlmodel"
}

model User {
  id    Int    @id
  value String @db.VarChar(255)

  @@index([raw("lower(value)")])
}`;

let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "prisma-sqlmodel-gen-"));
});

describe("generateSqlModel", () => {
  it("renders SQLModel models for a supported Postgres schema", async () => {
    const outputDir = path.join(tempDir, "postgres");
    await generateSqlModel(await buildInput(postgresSchema, outputDir));

    const rendered = await readFile(path.join(outputDir, "models.py"), "utf8");
    expect(rendered).toContain(`# Package version: ${PACKAGE_VERSION}`);
    expect(rendered).toContain("# Schema hash:");
    expect(rendered).toContain("class User(SQLModel, table=True):");
    expect(rendered).toContain("__tablename__ = 'users'");
    expect(rendered).toContain("email: str = Field(sa_column=Column(VARCHAR(255), unique=True, nullable=False))");
    expect(rendered).toContain("displayName: str | None = Field(sa_column=Column('display_name', VARCHAR(120), nullable=True), default=None)");
    expect(rendered).toContain("authorId: int = Field(sa_column=Column('author_id', Integer(), ForeignKey('users.id'), nullable=False))");
    expect(rendered).toContain("createdAt: datetime | None = Field(sa_column=Column(TIMESTAMP(precision=6, timezone=True), nullable=False, server_default=func.now()), default=None)");
    expect(rendered).toContain("role: Role = Field(sa_column=Column(SAEnum(Role, name='Role'), nullable=False), default=Role.USER)");
    expect(rendered).toContain("__table_args__ = (Index('posts_author_id_idx', 'author_id'),)");
    expect(rendered).toContain("profile: Optional['Profile'] = Relationship(back_populates='user', sa_relationship_kwargs={\"foreign_keys\": 'Profile.userId'})");
  });

  it("renders supported MySQL native types", async () => {
    const outputDir = path.join(tempDir, "mysql");
    await generateSqlModel(await buildInput(mysqlSchema, outputDir));

    const rendered = await readFile(path.join(outputDir, "models.py"), "utf8");
    expect(rendered).toContain("from sqlalchemy.dialects.mysql import DATETIME, DECIMAL, VARBINARY, VARCHAR");
    expect(rendered).toContain("serial: str = Field(sa_column=Column(VARCHAR(64), unique=True, nullable=False))");
    expect(rendered).toContain("payload: bytes | None = Field(sa_column=Column(VARBINARY(255), nullable=True), default=None)");
    expect(rendered).toContain("amount: Decimal = Field(sa_column=Column(DECIMAL(10, 2), nullable=False))");
    expect(rendered).toContain("createdAt: datetime = Field(sa_column=Column(DATETIME(3), nullable=False))");
  });

  it("renders explicit join models with composite primary keys", async () => {
    const outputDir = path.join(tempDir, "explicit-join");
    await generateSqlModel(await buildInput(explicitJoinSchema, outputDir));

    const rendered = await readFile(path.join(outputDir, "models.py"), "utf8");
    expect(rendered).toContain("class Membership(SQLModel, table=True):");
    expect(rendered).toContain("__tablename__ = 'memberships'");
    expect(rendered).toContain("__table_args__ = (PrimaryKeyConstraint('userId', 'projectId'),)");
    expect(rendered).toContain("memberships: list['Membership'] = Relationship(back_populates='user', sa_relationship_kwargs={\"foreign_keys\": 'Membership.userId'})");
    expect(rendered).toContain("memberships: list['Membership'] = Relationship(back_populates='project', sa_relationship_kwargs={\"foreign_keys\": 'Membership.projectId'})");
  });

  it("renders multiple named relations between the same models", async () => {
    const outputDir = path.join(tempDir, "multi-rel");
    await generateSqlModel(await buildInput(multiRelationSchema, outputDir));

    const rendered = await readFile(path.join(outputDir, "models.py"), "utf8");
    expect(rendered).toContain("authoredPosts: list['Post'] = Relationship(back_populates='author', sa_relationship_kwargs={\"foreign_keys\": 'Post.authorId'})");
    expect(rendered).toContain("reviewedPosts: list['Post'] = Relationship(back_populates='reviewer', sa_relationship_kwargs={\"foreign_keys\": 'Post.reviewerId'})");
    expect(rendered).toContain("author: 'User' = Relationship(back_populates='authoredPosts'");
    expect(rendered).toContain("reviewer: Optional['User'] = Relationship(back_populates='reviewedPosts'");
  });

  it("renders self-relations", async () => {
    const outputDir = path.join(tempDir, "self-rel");
    await generateSqlModel(await buildInput(selfRelationSchema, outputDir));

    const rendered = await readFile(path.join(outputDir, "models.py"), "utf8");
    expect(rendered).toContain("parentId: int | None = Field(sa_column=Column('parent_id', Integer(), ForeignKey('Category.id'), nullable=True), default=None)");
    expect(rendered).toContain("parent: Optional['Category'] = Relationship(back_populates='children', sa_relationship_kwargs={\"foreign_keys\": 'Category.parentId', \"remote_side\": 'Category.id'})");
    expect(rendered).toContain("children: list['Category'] = Relationship(back_populates='parent', sa_relationship_kwargs={\"foreign_keys\": 'Category.parentId'})");
  });

  it("renders PostgreSQL schema-qualified tables and foreign keys", async () => {
    const outputDir = path.join(tempDir, "multi-schema");
    await generateSqlModel(await buildInput(multiSchemaSchema, outputDir));

    const rendered = await readFile(path.join(outputDir, "models.py"), "utf8");
    expect(rendered).toContain("__tablename__ = 'users'");
    expect(rendered).toContain("__table_args__ = ({\"schema\": 'tenant_a'},)");
    expect(rendered).toContain("ForeignKey('tenant_a.users.id', name='posts_author_fk', ondelete='Cascade', onupdate='Restrict')");
  });

  it("renders composite foreign keys with referential actions in table args", async () => {
    const outputDir = path.join(tempDir, "composite-rel");
    await generateSqlModel(await buildInput(compositeRelationSchema, outputDir));

    const rendered = await readFile(path.join(outputDir, "models.py"), "utf8");
    expect(rendered).toContain("ForeignKeyConstraint(['parentLeft', 'parentRight'], ['Parent.leftId', 'Parent.rightId'], name='child_parent_fk', ondelete='Cascade', onupdate='Restrict')");
    expect(rendered).not.toContain("ForeignKey('Parent.leftId'");
  });

  it("renders PostgreSQL scalar and enum lists as ARRAY columns", async () => {
    const outputDir = path.join(tempDir, "pg-lists");
    await generateSqlModel(await buildInput(postgresListsSchema, outputDir));

    const rendered = await readFile(path.join(outputDir, "models.py"), "utf8");
    expect(rendered).toContain("from sqlalchemy.dialects.postgresql import ARRAY");
    expect(rendered).toContain("tags: list[str] = Field(sa_column=Column(ARRAY(String()), nullable=False))");
    expect(rendered).toContain("scores: list[int] = Field(sa_column=Column(ARRAY(Integer()), nullable=False))");
    expect(rendered).toContain("roles: list[Role] = Field(sa_column=Column(ARRAY(SAEnum(Role, name='Role')), nullable=False))");
  });

  it("renders MySQL index length and sort modifiers", async () => {
    const outputDir = path.join(tempDir, "mysql-index-options");
    await generateSqlModel(await buildInput(mysqlIndexOptionsSchema, outputDir));

    const rendered = await readFile(path.join(outputDir, "models.py"), "utf8");
    expect(rendered).toContain("from sqlalchemy import Column, Index, Integer, desc");
    expect(rendered).toContain("__table_args__ = (Index('user_lookup_idx', 'email', desc('slug'), mysql_length={'email': 10}),)");
  });

  it("renders updatedAt columns with ORM onupdate semantics", async () => {
    const outputDir = path.join(tempDir, "updated-at");
    await generateSqlModel(await buildInput(updatedAtSchema, outputDir));

    const rendered = await readFile(path.join(outputDir, "models.py"), "utf8");
    expect(rendered).toContain("updatedAt: datetime = Field(sa_column=Column(DateTime(), nullable=False, onupdate=func.now()))");
    expect(rendered).toContain("touchedAt: datetime | None = Field(sa_column=Column(DateTime(), nullable=False, server_default=func.now(), onupdate=func.now()), default=None)");
  });

  it("sanitizes Python keywords in generated field names", async () => {
    const outputDir = path.join(tempDir, "sanitized");
    await generateSqlModel(await buildInput(sanitizationSchema, outputDir));

    const rendered = await readFile(path.join(outputDir, "models.py"), "utf8");
    expect(rendered).toContain("# Prisma field 'from' emitted as Python attribute 'from_'.");
    expect(rendered).toContain("from_: str = Field(sa_column=Column(VARCHAR(50), nullable=False))");
  });

  it("renders implicit many-to-many relations through synthesized link models", async () => {
    const outputDir = path.join(tempDir, "implicit");
    await generateSqlModel(await buildInput(implicitManySchema, outputDir));

    const rendered = await readFile(path.join(outputDir, "models.py"), "utf8");
    expect(rendered).toContain("class PrismaImplicitLink__PostToTag(SQLModel, table=True):");
    expect(rendered).toContain("__tablename__ = '_PostToTag'");
    expect(rendered).toContain("A: int = Field(sa_column=Column(Integer(), ForeignKey('Post.id'), nullable=False))");
    expect(rendered).toContain("B: int = Field(sa_column=Column(Integer(), ForeignKey('Tag.id'), nullable=False))");
    expect(rendered).toContain("tags: list['Tag'] = Relationship(back_populates='posts', link_model=PrismaImplicitLink__PostToTag)");
    expect(rendered).toContain("posts: list['Post'] = Relationship(back_populates='tags', link_model=PrismaImplicitLink__PostToTag)");
  });

  it("fails on unsupported client-side defaults", async () => {
    const outputDir = path.join(tempDir, "unsupported-default");
    await expect(generateSqlModel(await buildInput(unsupportedDefaultSchema, outputDir))).rejects.toThrow(
      "Schema contains unsupported constructs."
    );
  });

  it("fails on unsupported datasource providers", async () => {
    const outputDir = path.join(tempDir, "sqlite");
    await expect(generateSqlModel(await buildInput(sqliteSchema, outputDir))).rejects.toThrow();
  });

  it("fails on python field name collisions after sanitization", async () => {
    const outputDir = path.join(tempDir, "collision");
    await expect(generateSqlModel(await buildInput(fieldCollisionSchema, outputDir))).rejects.toThrow(
      "Schema contains unsupported constructs."
    );
  });

  it("fails on unsupported relationMode = prisma", async () => {
    const outputDir = path.join(tempDir, "relation-mode");
    await expect(generateSqlModel(await buildInput(relationModeSchema, outputDir))).rejects.toThrow(
      "Schema contains unsupported constructs."
    );
  });

  it("fails on @ignore", async () => {
    const outputDir = path.join(tempDir, "ignore-field");
    await expect(generateSqlModel(await buildInput(ignoreFieldSchema, outputDir))).rejects.toThrow(
      "Schema contains unsupported constructs."
    );
  });

  it("fails on @@ignore", async () => {
    const outputDir = path.join(tempDir, "ignore-model");
    await expect(generateSqlModel(await buildInput(ignoreModelSchema, outputDir))).rejects.toThrow(
      "Schema contains unsupported constructs."
    );
  });

  it("detects stale generated output in --check mode", async () => {
    const outputDir = path.join(tempDir, "stale-check");
    const input = await buildInput(postgresSchema, outputDir);
    await generateSqlModel(input);
    await writeFile(path.join(outputDir, "models.py"), "# stale\n", "utf8");
    await expect(checkSqlModelGeneration(input)).rejects.toThrow("Generated output is stale or missing");
  });

  it("fails on advanced Prisma index algorithms and operator classes", async () => {
    const outputDir = path.join(tempDir, "advanced-index");
    await expect(generateSqlModel(await buildInput(advancedIndexSchema, outputDir))).rejects.toThrow(
      "Schema contains unsupported constructs."
    );
  });

  it("fails on expression-style index definitions discovered from the Prisma AST", async () => {
    const outputDir = path.join(tempDir, "expression-index");
    const dmmf = {
      datamodel: {
        indexes: [],
        enums: [],
        models: [
          {
            name: "User",
            fields: [
              { kind: "scalar", name: "id", type: "Int", isList: false, isRequired: true, isId: true, isUnique: false, hasDefaultValue: false },
              { kind: "scalar", name: "value", type: "String", isList: false, isRequired: true, isId: false, isUnique: false, hasDefaultValue: false, nativeType: ["VarChar", ["255"]] }
            ]
          }
        ]
      }
    };
    await expect(
      generateSqlModel({
        dmmf,
        schemaPath: "/virtual/schema.prisma",
        datamodel: expressionIndexSchema,
        outputDir,
        config: resolveGeneratorConfig(undefined)
      } as any)
    ).rejects.toThrow("Schema contains unsupported constructs.");
  });

  it(
    "works with provider = prisma-sqlmodel-gen via a packed local install",
    async () => {
      const repoRoot = process.cwd();
      const packDir = await mkdtemp(path.join(os.tmpdir(), "prisma-sqlmodel-pack-"));
      const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "prisma-sqlmodel-workspace-"));

      execFileSync("npm", ["run", "build"], {
        cwd: repoRoot,
        stdio: "ignore"
      });

      const packedJson = execFileSync(
        "npm",
        ["pack", "--json", "--pack-destination", packDir],
        {
          cwd: repoRoot,
          encoding: "utf8"
        }
      );
      const [{ filename }] = JSON.parse(packedJson) as Array<{ filename: string }>;
      const tarballPath = path.join(packDir, filename);

      const schemaPath = path.join(workspaceDir, "schema.prisma");
      await writeFile(schemaPath, postgresSchema, "utf8");

      execFileSync("npm", ["init", "-y"], {
        cwd: workspaceDir,
        stdio: "ignore"
      });
      execFileSync("npm", ["install", "--no-package-lock", "prisma@^7.7.0", tarballPath], {
        cwd: workspaceDir,
        stdio: "ignore"
      });
      execFileSync("npx", ["prisma", "generate", "--schema", schemaPath], {
        cwd: workspaceDir,
        stdio: "ignore"
      });

      const rendered = await readFile(
        path.join(workspaceDir, "generated", "sqlmodel", "models.py"),
        "utf8"
      );
      const installedPackage = JSON.parse(
        await readFile(path.join(workspaceDir, "node_modules", "prisma-sqlmodel-gen", "package.json"), "utf8")
      ) as { version: string };
      expect(rendered).toContain("class User(SQLModel, table=True):");
      expect(rendered).toContain("__tablename__ = 'users'");
      expect(rendered).toContain(`# Package version: ${installedPackage.version}`);
    },
    30_000
  );
});

async function buildInput(datamodel: string, outputDir: string) {
  const dmmf = await getDMMF({ datamodel });
  return {
    options: {
      generator: {
        name: "sqlmodel",
        provider: { fromEnvVar: null, value: "prisma-sqlmodel-gen" },
        output: { fromEnvVar: null, value: outputDir },
        binaryTargets: [],
        previewFeatures: [],
        config: {},
        sourceFilePath: "/virtual/schema.prisma"
      },
      otherGenerators: [],
      schemaPath: "/virtual/schema.prisma",
      dmmf,
      datasources: [],
      datamodel,
      version: "test"
    },
    dmmf,
    schemaPath: "/virtual/schema.prisma",
    datamodel,
    outputDir,
    config: resolveGeneratorConfig(undefined)
  };
}
