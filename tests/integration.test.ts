import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  commandAvailable,
  installArtifact,
  packArtifact,
  REPO_ROOT,
  tryRunCli
} from "./helpers/packed-install.js";

const pythonAvailable = commandAvailable("python3", ["--version"]);

describe("offline integration", () => {
  let binPath = "";
  let workspace = "";

  beforeAll(async () => {
    const packDir = await mkdtemp(path.join(os.tmpdir(), "psg-pack-"));
    try {
      const tarball = packArtifact(packDir);
      workspace = await mkdtemp(path.join(os.tmpdir(), "psg-workspace-"));
      binPath = installArtifact(tarball, workspace);
    } finally {
      await rm(packDir, { recursive: true, force: true });
    }
  }, 180000);

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  function contractFixture(name: string): string {
    return path.join(REPO_ROOT, "tests", "fixtures", "contracts", name);
  }

  it("generates SQLModel modules from a contract", async () => {
    const outDir = path.join(workspace, "out-basic");
    const result = tryRunCli(binPath, [
      "--contract",
      contractFixture("basic-postgres.json"),
      "--output",
      outDir
    ]);

    expect(result.status).toBe(0);
    const rendered = await readFile(path.join(outDir, "models.py"), "utf8");
    expect(rendered).toContain("class User(SQLModel, table=True):");
    expect(rendered).toContain("class Post(SQLModel, table=True):");
    expect(rendered).toContain("class Role(str, Enum):");
    expect(rendered).toContain("class Priority(str, Enum):");
    expect(rendered).toContain("back_populates=");
  });

  it("emits an init file by default and honors --no-emit-init", async () => {
    const withInit = path.join(workspace, "out-init");
    const withoutInit = path.join(workspace, "out-no-init");

    expect(
      tryRunCli(binPath, ["--contract", contractFixture("scalars.json"), "--output", withInit])
        .status
    ).toBe(0);
    await expect(readFile(path.join(withInit, "__init__.py"), "utf8")).resolves.toBe(
      "from .models import *\n"
    );

    expect(
      tryRunCli(binPath, [
        "--contract",
        contractFixture("scalars.json"),
        "--output",
        withoutInit,
        "--no-emit-init"
      ]).status
    ).toBe(0);
    await expect(readFile(path.join(withoutInit, "__init__.py"), "utf8")).rejects.toThrow();
  });

  it("generates deterministically", async () => {
    const first = path.join(workspace, "out-first");
    const second = path.join(workspace, "out-second");

    for (const outDir of [first, second]) {
      const result = tryRunCli(binPath, [
        "--contract",
        contractFixture("join-composite.json"),
        "--output",
        outDir
      ]);
      expect(result.status).toBe(0);
    }

    await expect(readFile(path.join(first, "models.py"), "utf8")).resolves.toBe(
      await readFile(path.join(second, "models.py"), "utf8")
    );
    await expect(readFile(path.join(first, "__init__.py"), "utf8")).resolves.toBe(
      await readFile(path.join(second, "__init__.py"), "utf8")
    );
  });

  it("checks fresh output and rejects stale output", async () => {
    const outDir = path.join(workspace, "out-check");
    const args = ["--contract", contractFixture("basic-postgres.json"), "--output", outDir];
    expect(tryRunCli(binPath, args).status).toBe(0);
    expect(tryRunCli(binPath, [...args, "--check"]).status).toBe(0);

    await writeFile(path.join(outDir, "models.py"), "# stale\n");
    const stale = tryRunCli(binPath, [...args, "--check"]);
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain("Generated output is stale or missing");
  });

  it("rejects invalid contracts with diagnostics", async () => {
    const badContract = path.join(workspace, "bork.json");
    await writeFile(badContract, "{oops");
    const result = tryRunCli(binPath, [
      "--contract",
      badContract,
      "--output",
      path.join(workspace, "out-bork")
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CONTRACT_JSON_PARSE_ERROR");
  });

  it("requires --contract", async () => {
    const result = tryRunCli(binPath, []);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Missing required --contract argument.");
  });

  it.runIf(pythonAvailable)("generates syntax-valid Python", async () => {
    const outDir = path.join(workspace, "out-syntax");
    const result = tryRunCli(binPath, [
      "--contract",
      contractFixture("advanced.json"),
      "--output",
      outDir
    ]);
    expect(result.status).toBe(0);

    execFileSync(
      "python3",
      ["-c", "import ast,sys; ast.parse(open(sys.argv[1]).read())", path.join(outDir, "models.py")],
      { encoding: "utf8" }
    );
  });
});
