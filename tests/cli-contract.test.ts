import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiagnosticError } from "../src/diagnostics.js";
import type { ContractGeneratorInput } from "../src/types.js";

describe("cli --contract", () => {
  const originalArgv = process.argv.slice();
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    process.argv = originalArgv.slice();
    process.exitCode = originalExitCode;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    process.argv = originalArgv.slice();
    process.exitCode = originalExitCode;
  });

  async function importCliWithMocks(options: {
    argv: string[];
    contractText?: string;
    generateSqlModel?: ReturnType<typeof vi.fn>;
    checkSqlModelGeneration?: ReturnType<typeof vi.fn>;
  }) {
    vi.resetModules();
    const readFile = vi.fn().mockResolvedValue(options.contractText ?? "{}");
    const generateSqlModel =
      options.generateSqlModel ??
      vi.fn().mockResolvedValue({ files: [], diagnostics: [] });
    const checkSqlModelGeneration =
      options.checkSqlModelGeneration ??
      vi.fn().mockResolvedValue({ files: [], diagnostics: [] });

    vi.doMock("node:fs/promises", () => ({ readFile }));
    vi.doMock("@prisma/internals", () => {
      throw new Error("the contract CLI must not load the Prisma engines");
    });
    vi.doMock("../src/generate.js", () => ({
      generateSqlModel,
      checkSqlModelGeneration
    }));

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    process.argv = ["node", "cli", ...options.argv];

    await import("../src/cli.js");
    await new Promise((resolve) => setTimeout(resolve, 0));

    return {
      readFile,
      generateSqlModel,
      checkSqlModelGeneration,
      consoleError
    };
  }

  function generatedInput(mock: ReturnType<typeof vi.fn>): ContractGeneratorInput {
    expect(mock).toHaveBeenCalledOnce();
    return mock.mock.calls[0][0] as ContractGeneratorInput;
  }

  it("generates from a contract file without touching the Prisma engines", async () => {
    const cli = await importCliWithMocks({
      argv: ["--contract", "/tmp/contract.json", "--output", "/tmp/out"],
      contractText: "{\"schemaVersion\": \"1\"}"
    });

    expect(cli.readFile).toHaveBeenCalledWith(path.resolve("/tmp/contract.json"), "utf8");
    expect(cli.checkSqlModelGeneration).not.toHaveBeenCalled();
    const input = generatedInput(cli.generateSqlModel);
    expect(input.contractPath).toBe(path.resolve("/tmp/contract.json"));
    expect(input.contractText).toBe("{\"schemaVersion\": \"1\"}");
    expect(input.outputDir).toBe(path.resolve("/tmp/out"));
    expect(input.config.moduleName).toBe("models.py");
    expect(cli.consoleError).not.toHaveBeenCalled();
  });

  it("checks contract output with --check", async () => {
    const cli = await importCliWithMocks({
      argv: ["--contract", "/tmp/contract.json", "--output", "/tmp/out", "--check"]
    });

    expect(cli.checkSqlModelGeneration).toHaveBeenCalledOnce();
    expect(cli.generateSqlModel).not.toHaveBeenCalled();
  });

  it("defaults the output directory next to the contract file", async () => {
    const cli = await importCliWithMocks({ argv: ["--contract", "/tmp/contract.json"] });

    const input = generatedInput(cli.generateSqlModel);
    expect(input.outputDir).toBe(path.resolve("/tmp/generated/sqlmodel"));
  });

  it("honors module name and init overrides", async () => {
    const cli = await importCliWithMocks({
      argv: ["--contract", "/tmp/contract.json", "--module-name", "custom", "--no-emit-init"]
    });

    const input = generatedInput(cli.generateSqlModel);
    expect(input.config.moduleName).toBe("custom.py");
    expect(input.config.emitInit).toBe(false);
  });

  it("honors explicit --emit-init", async () => {
    const cli = await importCliWithMocks({
      argv: ["--contract", "/tmp/contract.json", "--emit-init"]
    });

    expect(generatedInput(cli.generateSqlModel).config.emitInit).toBe(true);
  });

  it("rejects unknown arguments", async () => {
    const cli = await importCliWithMocks({
      argv: ["--contract", "/tmp/contract.json", "--wat"]
    });

    expect(cli.consoleError).toHaveBeenCalledWith("Unknown argument: --wat");
    expect(process.exitCode).toBe(1);
  });

  it("requires --contract", async () => {
    const cli = await importCliWithMocks({ argv: [] });

    expect(cli.consoleError).toHaveBeenCalledWith("Missing required --contract argument.");
    expect(process.exitCode).toBe(1);
  });

  it("reports contract diagnostics without a stack trace", async () => {
    const failure = new DiagnosticError("bad contract", [
      {
        code: "CONTRACT_JSON_PARSE_ERROR",
        severity: "error",
        message: "Contract file is not valid JSON.",
        suggestion: "Re-emit."
      }
    ]);
    const cli = await importCliWithMocks({
      argv: ["--contract", "/tmp/contract.json"],
      generateSqlModel: vi.fn().mockRejectedValue(failure)
    });

    expect(cli.consoleError).toHaveBeenCalledOnce();
    const message = String(cli.consoleError.mock.calls[0][0]);
    expect(message).toContain("CONTRACT_JSON_PARSE_ERROR");
    expect(message).toContain("Contract file is not valid JSON.");
    expect(process.exitCode).toBe(1);
  });

  it("reports unexpected contract failures", async () => {
    const cli = await importCliWithMocks({
      argv: ["--contract", "/tmp/contract.json"],
      generateSqlModel: vi.fn().mockRejectedValue(new Error("explode"))
    });

    expect(cli.consoleError).toHaveBeenCalledWith("explode");
    expect(process.exitCode).toBe(1);
  });

  it("reports non-error contract failures", async () => {
    const cli = await importCliWithMocks({
      argv: ["--contract", "/tmp/contract.json"],
      generateSqlModel: vi.fn().mockRejectedValue("string failure")
    });

    expect(cli.consoleError).toHaveBeenCalledWith("string failure");
    expect(process.exitCode).toBe(1);
  });
});
