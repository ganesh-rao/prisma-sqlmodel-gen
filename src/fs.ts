import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export async function writeManagedFile(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  await writeFile(tempPath, contents, "utf8");
  await rename(tempPath, filePath);
}

export async function ensureInitFile(dirPath: string, moduleName: string): Promise<string> {
  const initPath = path.join(dirPath, "__init__.py");
  const moduleBaseName = moduleName.replace(/\.py$/, "");
  const contents = `from .${moduleBaseName} import *\n`;
  await writeManagedFile(initPath, contents);
  return initPath;
}

export async function checkManagedFile(filePath: string, expectedContents: string): Promise<boolean> {
  const current = await readFile(filePath, "utf8").catch(() => null);
  return current === expectedContents;
}
