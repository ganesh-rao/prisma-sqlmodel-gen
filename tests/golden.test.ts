import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { getDMMF } from "@prisma/internals";
import { resolveGeneratorConfig } from "../src/config.js";
import { generateSqlModel } from "../src/generate.js";

const fixtures: Record<string, string> = {
  simple: `datasource db {
  provider = "postgresql"
}

generator sqlmodel {
  provider = "prisma-sqlmodel-gen"
  output   = "./generated/sqlmodel"
}

model User {
  id    Int    @id @default(autoincrement())
  email String @unique @db.VarChar(255)
}`,
  mapped_enum: `datasource db {
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
  id    Int    @id @default(autoincrement())
  role  Role   @default(USER)

  @@map("users")
}`,
  self_relation: `datasource db {
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
}`
};

let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "prisma-sqlmodel-golden-"));
});

describe("golden output", () => {
  for (const [name, datamodel] of Object.entries(fixtures)) {
    it(`matches the snapshot for ${name}`, async () => {
      const outputDir = path.join(tempDir, name);
      const dmmf = await getDMMF({ datamodel });
      await generateSqlModel({
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
      });

      const rendered = await readFile(path.join(outputDir, "models.py"), "utf8");
      const normalized = rendered
        .replace(/^# Package version: .+$/m, "# Package version: <dynamic>")
        .replace(/^# Schema hash: .+$/m, "# Schema hash: <dynamic>");
      expect(normalized).toMatchSnapshot();
    });
  }
});
