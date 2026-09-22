import { describe, expect, it } from "vitest";
import { resolveGeneratorConfig } from "../src/config.js";

describe("resolveGeneratorConfig", () => {
  it("resolves defaults without overrides", () => {
    expect(resolveGeneratorConfig()).toEqual({
      moduleName: "models.py",
      emitInit: true,
      strict: true,
      headerComment: true,
      packageName: undefined,
      sqlmodelImportStyle: "sqlmodel"
    });
  });

  it("resolves defaults with empty overrides", () => {
    expect(resolveGeneratorConfig({})).toMatchObject({
      moduleName: "models.py",
      emitInit: true,
      strict: true,
      headerComment: true
    });
  });

  it("honors overrides", () => {
    expect(
      resolveGeneratorConfig({
        moduleName: "custom",
        emitInit: false,
        strict: false,
        headerComment: false,
        packageName: "pkg",
        sqlmodelImportStyle: "sqlmodel"
      })
    ).toEqual({
      moduleName: "custom.py",
      emitInit: false,
      strict: false,
      headerComment: false,
      packageName: "pkg",
      sqlmodelImportStyle: "sqlmodel"
    });
  });

  it("keeps module names that already end with .py", () => {
    expect(resolveGeneratorConfig({ moduleName: "custom.py" }).moduleName).toBe("custom.py");
  });

  it("rejects unsupported import styles", () => {
    expect(() =>
      resolveGeneratorConfig({ sqlmodelImportStyle: "dataclasses" as "sqlmodel" })
    ).toThrow("Unsupported sqlmodelImportStyle 'dataclasses'. The only supported style is 'sqlmodel'.");
  });
});
