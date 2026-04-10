import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  entry: {
    bin: "src/bin.ts",
    cli: "src/cli.ts",
    generator: "src/generator.ts"
  },
  define: {
    __PACKAGE_VERSION__: JSON.stringify(packageJson.version)
  },
  format: ["esm", "cjs"],
  sourcemap: true,
  clean: true,
  dts: true,
  splitting: false,
  outDir: "dist",
  target: "node20",
  shims: false
});
