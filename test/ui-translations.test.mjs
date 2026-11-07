import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const compile = async name => ts.transpileModule(await readFile(new URL(`../src/${name}.ts`, import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const moduleURL = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const dictionaryURL = moduleURL(await compile("ui-translations"));
const { zh, en } = await import(dictionaryURL);
const { t, ui, errorKey } = await import(moduleURL((await compile("ui-language")).replace("./ui-translations.js", dictionaryURL)));

test("both UI dictionaries cover the same keys and interpolation values", () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  for (const key of Object.keys(zh)) {
    const placeholders = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    assert.deepEqual(placeholders(en[key]), placeholders(zh[key]), key);
    assert.ok(en[key].trim() && zh[key].trim(), key);
  }
});

test("UI markup escapes user values while preserving the original text and Unicode punctuation", () => {
  const name = '若雪，Happy Birthday！<script>"&';
  const original = { name, count: 3 };
  assert.equal(t("rollFrames", original), `${name}，共 3 格底片`);
  const markup = ui("rollFrames", original);
  assert.ok(markup.includes("若雪，Happy Birthday！&lt;script&gt;&quot;&amp;"));
  assert.ok(!markup.includes("<script>"));
  assert.deepEqual(original, { name, count: 3 });
  assert.ok(zh.openEnvelope.includes("，"));
  assert.ok(zh.firstHint.includes("。"));
});

test("only known application feedback maps to translated errors", () => {
  assert.equal(errorKey("Incorrect password. Try again."), "incorrectPassword");
  assert.equal(errorKey("The draft changed in another tab. Reload and review the latest version before editing."), "draftConflict");
  assert.equal(errorKey("若雪，Happy Birthday！"), "genericError");
});
