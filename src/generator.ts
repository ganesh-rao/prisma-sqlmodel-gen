import prismaGeneratorHelper from "@prisma/generator-helper";
import { resolveGeneratorConfig, resolveOutputDir } from "./config.js";
import { formatDiagnostics, isDiagnosticError } from "./diagnostics.js";
import { generateSqlModel } from "./generate.js";

const { generatorHandler } = prismaGeneratorHelper;

generatorHandler({
  onManifest() {
    return {
      prettyName: "Prisma SQLModel Gen",
      defaultOutput: "./generated/sqlmodel"
    };
  },
  async onGenerate(options) {
    const config = resolveGeneratorConfig(options.generator);
    const outputDir = resolveOutputDir(options.schemaPath, options.generator);

    try {
      await generateSqlModel({
        options,
        dmmf: options.dmmf,
        schemaPath: options.schemaPath,
        datamodel: options.datamodel,
        outputDir,
        config
      });
    } catch (error) {
      if (isDiagnosticError(error)) {
        const message = formatDiagnostics(error.diagnostics);
        throw new Error(`${error.message}\n${message}`);
      }
      throw error;
    }
  }
});
