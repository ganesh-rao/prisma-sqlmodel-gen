#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveGeneratorConfig } from "./config.js";
import { formatDiagnostics, isDiagnosticError } from "./diagnostics.js";
import { checkSqlModelGeneration, generateSqlModel } from "./generate.js";
import type { ContractGeneratorInput } from "./types.js";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  /* v8 ignore next 3 -- exercised through the real CLI entrypoint, not via in-process unit tests */
  if (!args.contract) {
    throw new Error("Missing required --contract argument.");
  }

  const contractPath = path.resolve(args.contract);
  const contractText = await readFile(contractPath, "utf8");
  const input: ContractGeneratorInput = {
    contractPath,
    contractText,
    outputDir: resolveContractOutputDir(contractPath, args.output),
    config: resolveGeneratorConfig({
      moduleName: args.moduleName,
      emitInit: args.emitInit
    })
  };

  await runWithDiagnosticReporting(() => runCliOperation(args, input));
}

async function runWithDiagnosticReporting(operation: () => Promise<void>): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (isDiagnosticError(error)) {
      console.error(formatDiagnostics(error.diagnostics));
      process.exitCode = 1;
      return;
    }

    throw error;
  }
}

function resolveContractOutputDir(contractPath: string, explicitOutput?: string): string {
  if (explicitOutput) {
    return path.resolve(explicitOutput);
  }

  return path.resolve(path.dirname(contractPath), "generated", "sqlmodel");
}

type CliArgs = {
  contract?: string;
  output?: string;
  moduleName?: string;
  check: boolean;
  emitInit?: boolean;
};

async function runCliOperation(args: CliArgs, input: ContractGeneratorInput): Promise<void> {
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
    if (arg === "--contract") {
      args.contract = argv[++index];
    } else if (arg === "--output") {
      args.output = argv[++index];
    } else if (arg === "--module-name") {
      args.moduleName = argv[++index];
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
