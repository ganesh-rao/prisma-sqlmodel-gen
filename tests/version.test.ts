import { describe, expect, it } from "vitest";
import { resolvePackageVersion } from "../src/version.js";

describe("resolvePackageVersion", () => {
  it("prefers the injected version", () => {
    expect(
      resolvePackageVersion("2.0.0", () => {
        throw new Error("must not read package.json");
      })
    ).toBe("2.0.0");
  });

  it("falls back to the package.json version", () => {
    expect(resolvePackageVersion("  ", () => ({ version: "1.2.3" }))).toBe("1.2.3");
  });

  it("falls back to 0.0.0 when the version is missing", () => {
    expect(resolvePackageVersion(undefined, () => ({}))).toBe("0.0.0");
  });

  it("falls back to 0.0.0 when package.json is unreadable", () => {
    expect(
      resolvePackageVersion(undefined, () => {
        throw new Error("nope");
      })
    ).toBe("0.0.0");
  });

  it("reads the repository package.json by default", () => {
    expect(resolvePackageVersion()).not.toBe("0.0.0");
  });
});
