import { describe, expect, it } from "vitest";
import { shouldRunAsGenerator } from "../src/runtime-mode.js";

describe("shouldRunAsGenerator", () => {
  it("prefers generator mode when Prisma marks the invocation", () => {
    expect(shouldRunAsGenerator(["--schema", "schema.prisma"], { PRISMA_GENERATOR_INVOCATION: "true" }, true)).toBe(
      true
    );
  });

  it("falls back to generator mode for stdin-driven invocations with no args", () => {
    expect(shouldRunAsGenerator([], {}, false)).toBe(true);
  });

  it("uses CLI mode for normal command-line usage", () => {
    expect(shouldRunAsGenerator(["--schema", "schema.prisma"], {}, true)).toBe(false);
    expect(shouldRunAsGenerator([], {}, true)).toBe(false);
  });
});
