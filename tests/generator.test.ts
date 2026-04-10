import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { getDMMF } from "@prisma/internals";
import { resolveGeneratorConfig } from "../src/config.js";
import { formatDiagnostics } from "../src/diagnostics.js";
import { checkSqlModelGeneration, generateSqlModel } from "../src/generate.js";

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

let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "prisma-sqlmodel-gen-"));
});

describe("generateSqlModel", () => {
  it("renders SQLModel models for a supported Postgres schema", async () => {
    const outputDir = path.join(tempDir, "postgres");
    await generateSqlModel(await buildInput(postgresSchema, outputDir));

    const rendered = await readFile(path.join(outputDir, "models.py"), "utf8");
    expect(rendered).toContain("# Package version: 0.1.0");
    expect(rendered).toContain("# Schema hash:");
    expect(rendered).toContain("class User(SQLModel, table=True):");
    expect(rendered).toContain("__tablename__ = 'users'");
    expect(rendered).toContain("email: str = Field(sa_column=Column(VARCHAR(255), unique=True, nullable=False))");
    expect(rendered).toContain("displayName: str | None = Field(sa_column=Column('display_name', VARCHAR(120), nullable=True), default=None)");
    expect(rendered).toContain("authorId: int = Field(sa_column=Column('author_id', Integer(), ForeignKey('users.id'), nullable=False))");
    expect(rendered).toContain("createdAt: datetime | None = Field(sa_column=Column(TIMESTAMP(precision=6, timezone=True), nullable=False, server_default=func.now()), default=None)");
    expect(rendered).toContain("role: Role = Field(sa_column=Column(SAEnum(Role, name='role'), nullable=False), default=Role.USER)");
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

  it("sanitizes Python keywords in generated field names", async () => {
    const outputDir = path.join(tempDir, "sanitized");
    await generateSqlModel(await buildInput(sanitizationSchema, outputDir));

    const rendered = await readFile(path.join(outputDir, "models.py"), "utf8");
    expect(rendered).toContain("# Prisma field 'from' emitted as Python attribute 'from_'.");
    expect(rendered).toContain("from_: str = Field(sa_column=Column(VARCHAR(50), nullable=False))");
  });

  it("fails on implicit many-to-many relations with actionable diagnostics", async () => {
    const outputDir = path.join(tempDir, "implicit");

    await expect(generateSqlModel(await buildInput(implicitManySchema, outputDir))).rejects.toMatchObject({
      name: "DiagnosticError"
    });

    try {
      await generateSqlModel(await buildInput(implicitManySchema, outputDir));
    } catch (error) {
      const diagnostics = (error as { diagnostics: Parameters<typeof formatDiagnostics>[0] }).diagnostics;
      const formatted = formatDiagnostics(diagnostics);
      expect(formatted).toContain("UNSUPPORTED_IMPLICIT_MANY_TO_MANY");
      expect(formatted).toContain("line");
      expect(formatted).toContain("Suggestion:");
    }
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

  it("detects stale generated output in --check mode", async () => {
    const outputDir = path.join(tempDir, "stale-check");
    const input = await buildInput(postgresSchema, outputDir);
    await generateSqlModel(input);
    await writeFile(path.join(outputDir, "models.py"), "# stale\n", "utf8");
    await expect(checkSqlModelGeneration(input)).rejects.toThrow("Generated output is stale or missing");
  });
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
