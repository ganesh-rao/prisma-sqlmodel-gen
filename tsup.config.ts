import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    generator: "src/generator.ts"
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
