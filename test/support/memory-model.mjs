import { readFile } from "node:fs/promises";
import ts from "typescript";
const url = code => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
export async function compile(name) {
  return ts.transpileModule(await readFile(new URL(`../../src/${name}.ts`, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
}
const polaroid = url(await compile("polaroid-config"));
const envelope = url(await compile("envelope-config"));
const config = url((await compile("template-config")).replace("./polaroid-config.js", polaroid).replace("./envelope-config.js", envelope));
export const modelURL = url((await compile("memory-project")).replace("./template-config.js", config));
export const { toMemoryProject } = await import(modelURL);
