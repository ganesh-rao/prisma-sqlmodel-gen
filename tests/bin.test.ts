import { describe, expect, it, vi } from "vitest";
import { formatEntrypointError, resolveEntrypoint, runBin } from "../src/bin.js";

describe("bin entrypoint", () => {
  it("resolves the generator entrypoint for Prisma generator invocations", () => {
    expect(resolveEntrypoint([], { PRISMA_GENERATOR_INVOCATION: "true" }, true)).toBe("./generator.js");
  });

  it("resolves the CLI entrypoint for direct command usage", () => {
    expect(resolveEntrypoint(["--schema", "schema.prisma"], {}, true)).toBe("./cli.js");
  });

  it("imports the selected entrypoint", async () => {
    const importer = vi.fn<(specifier: "./generator.js" | "./cli.js") => Promise<unknown>>().mockResolvedValue({});

    await runBin([], { PRISMA_GENERATOR_INVOCATION: "true" }, true, importer);
    await runBin(["--schema", "schema.prisma"], {}, true, importer);

    expect(importer).toHaveBeenNthCalledWith(1, "./generator.js");
    expect(importer).toHaveBeenNthCalledWith(2, "./cli.js");
  });

  it("formats unknown errors safely", () => {
    expect(formatEntrypointError(new Error("boom"))).toBe("boom");
    expect(formatEntrypointError("boom")).toBe("boom");
  });
});
