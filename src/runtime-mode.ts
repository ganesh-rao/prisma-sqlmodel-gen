export function shouldRunAsGenerator(
  argv: string[],
  env: NodeJS.ProcessEnv,
  stdinIsTTY: boolean | undefined
): boolean {
  if (env.PRISMA_GENERATOR_INVOCATION) {
    return true;
  }

  return argv.length === 0 && stdinIsTTY === false;
}
