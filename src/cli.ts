#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { GeneratorConfig as PrismaGeneratorConfig } from "@prisma/generator";
import prismaInternals from "@prisma/internals";
import { resolveGeneratorConfig, resolveOutputDir } from "./config.js";
import { formatDiagnostics, isDiagnosticError } from "./diagnostics.js";
import { checkSqlModelGeneration, generateSqlModel } from "./generate.js";
import type { GeneratorInput } from "./types.js";

const { getConfig, getDMMF } = prismaInternals;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  /* v8 ignore next 3 -- exercised through the real CLI entrypoint, not via in-process unit tests */
  if (!args.schema) {
    throw new Error("Missing required --schema argument.");
  }

  const schemaPath = path.resolve(args.schema);
  const datamodel = await readFile(schemaPath, "utf8");
  const config = await getConfig({ datamodel });
  const discoveredGenerator = findRequestedGenerator(config.generators, args.generator);
  /* v8 ignore next 3 -- exercised through the real CLI entrypoint, not via in-process unit tests */
  if (!discoveredGenerator && !args.output) {
    throw new Error("No SQLModel generator block found. Provide --output or add a generator block.");
  }

  const generator = discoveredGenerator ?? createAdHocGenerator(args.output!, schemaPath);
  const dmmf = await getDMMF({ datamodel });
  const input = buildCliGeneratorInput({
    args,
    config,
    datamodel,
    dmmf,
    generator,
    schemaPath
  });

  try {
    await runCliOperation(args, input);
  } catch (error) {
    if (isDiagnosticError(error)) {
      console.error(formatDiagnostics(error.diagnostics));
      process.exitCode = 1;
      return;
    }

    throw error;
  }
}

type CliArgs = {
  schema?: string;
  output?: string;
  moduleName?: string;
  generator?: string;
  check: boolean;
  emitInit?: boolean;
};

function findRequestedGenerator(
  generators: PrismaGeneratorConfig[],
  requestedName?: string
): PrismaGeneratorConfig | undefined {
  if (requestedName) {
    return generators.find((entry) => entry.name === requestedName);
  }

  return (
    generators.find((entry) => entry.provider.value === "prisma-sqlmodel-gen") ??
    generators.find((entry) => entry.name === "sqlmodel") ??
    generators.find((entry) => entry.provider.value?.includes("prisma-sqlmodel-gen")) ??
    generators.find((entry) => entry.provider.value?.includes("sqlmodel"))
  );
}

function createAdHocGenerator(output: string, schemaPath: string): PrismaGeneratorConfig {
  return {
    name: "sqlmodel",
    provider: { fromEnvVar: null, value: "prisma-sqlmodel-gen" },
    output: { fromEnvVar: null, value: output },
    binaryTargets: [],
    previewFeatures: [],
    config: {},
    sourceFilePath: schemaPath
  };
}

function buildCliGeneratorInput(params: {
  args: CliArgs;
  config: Awaited<ReturnType<typeof getConfig>>;
  datamodel: string;
  dmmf: Awaited<ReturnType<typeof getDMMF>>;
  generator: PrismaGeneratorConfig;
  schemaPath: string;
}): GeneratorInput {
  const { args, config, datamodel, dmmf, generator, schemaPath } = params;

  return {
    options: {
      generator,
      schemaPath,
      datamodel,
      dmmf,
      datasources: config.datasources,
      otherGenerators: config.generators.filter((entry) => entry.name !== generator.name),
      version: "unknown"
    },
    dmmf,
    schemaPath,
    datamodel,
    outputDir: resolveOutputDir(schemaPath, generator, args.output),
    config: resolveGeneratorConfig(generator, {
      moduleName: args.moduleName,
      emitInit: args.emitInit
    })
  };
}

async function runCliOperation(args: CliArgs, input: GeneratorInput): Promise<void> {
  /* v8 ignore next 4 -- the check path is covered via CLI-level tests instead of a direct in-process call */
  if (args.check) {
    await checkSqlModelGeneration(input);
    return;
  }

  await generateSqlModel(input);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { check: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--schema") {
      args.schema = argv[++index];
    } else if (arg === "--output") {
      args.output = argv[++index];
    } else if (arg === "--module-name") {
      args.moduleName = argv[++index];
    } else if (arg === "--generator") {
      args.generator = argv[++index];
    } else if (arg === "--check") {
      args.check = true;
    } else if (arg === "--emit-init") {
      args.emitInit = true;
    } else if (arg === "--no-emit-init") {
      args.emitInit = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
