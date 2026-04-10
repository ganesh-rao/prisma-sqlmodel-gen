import { readFileSync } from "node:fs";
import path from "node:path";

declare const __PACKAGE_VERSION__: string | undefined;

export function resolvePackageVersion(
  readPackageJson: () => unknown = () =>
    JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { version?: unknown }
): string {
  try {
    if (typeof __PACKAGE_VERSION__ === "string" && __PACKAGE_VERSION__.trim().length > 0) {
      return __PACKAGE_VERSION__;
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
