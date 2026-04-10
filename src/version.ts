import { readFileSync } from "node:fs";
import path from "node:path";

function getInjectedPackageVersion(): string | undefined {
  return process.env.PRISMA_SQLMODEL_GEN_PACKAGE_VERSION;
}

export function resolvePackageVersion(
  injectedVersion: string | undefined = getInjectedPackageVersion(),
  readPackageJson: () => unknown = () =>
    JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { version?: unknown }
): string {
  try {
    if (typeof injectedVersion === "string" && injectedVersion.trim().length > 0) {
      return injectedVersion;
    }

    const packageJson = readPackageJson() as { version?: unknown };
    if (typeof packageJson.version === "string" && packageJson.version.trim().length > 0) {
      return packageJson.version;
    }
  } catch {
    // Fall through to the default placeholder below.
  }

  return "0.0.0";
}

export const PACKAGE_VERSION = resolvePackageVersion();
