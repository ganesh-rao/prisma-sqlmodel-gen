#!/usr/bin/env node
import { shouldRunAsGenerator } from "./runtime-mode.js";

type Entrypoint = "./generator.js" | "./cli.js";

export function resolveEntrypoint(
  argv: string[],
  env: NodeJS.ProcessEnv,
  stdinIsTTY: boolean | undefined
): Entrypoint {
  return shouldRunAsGenerator(argv, env, stdinIsTTY) ? "./generator.js" : "./cli.js";
}

export async function runBin(
  argv: string[],
  env: NodeJS.ProcessEnv,
  stdinIsTTY: boolean | undefined,
  importer: (specifier: Entrypoint) => Promise<unknown> = (specifier) => import(specifier)
): Promise<void> {
  await importer(resolveEntrypoint(argv, env, stdinIsTTY));
}

export function formatEntrypointError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* v8 ignore next 4 */
runBin(process.argv.slice(2), process.env, process.stdin.isTTY).catch((error) => {
  console.error(formatEntrypointError(error));
  process.exitCode = 1;
});
