import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

export function commandAvailable(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function packArtifact(packDir: string): string {
  if (!existsSync(path.join(REPO_ROOT, "dist", "cli.js"))) {
    throw new Error("dist/cli.js is missing. Run `npm run build` before the integration suites.");
  }
  const output = execFileSync("npm", ["pack", "--pack-destination", packDir, "--loglevel=error"], {
    cwd: REPO_ROOT,
    encoding: "utf8"
  });
  const tarball = output.trim().split("\n").at(-1)!;
  return path.join(packDir, tarball);
}

export function installArtifact(tarball: string, prefix: string): string {
  execFileSync(
    "npm",
    [
      "install",
      tarball,
      "--prefix",
      prefix,
      "--no-audit",
      "--no-fund",
      "--no-save",
      "--loglevel=error"
    ],
    { cwd: REPO_ROOT, encoding: "utf8" }
  );
  return path.join(prefix, "node_modules", ".bin", "prisma-sqlmodel-gen");
}

export type CliResult = { status: number; stdout: string; stderr: string };

export function tryRunCli(binPath: string, args: string[]): CliResult {
  try {
    const stdout = execFileSync(process.execPath, [binPath, ...args], { encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stdout?: unknown; stderr?: unknown };
    return {
      status: failure.status ?? 1,
      stdout: String(failure.stdout ?? ""),
      stderr: String(failure.stderr ?? "")
    };
  }
}
