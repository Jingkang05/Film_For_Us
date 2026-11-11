import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const code = ts.transpileModule(await readFile(new URL("../src/viewer-collection.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { viewerCollection } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

test("returning viewer's saved likes are already hung, with nothing to develop", () => {
  assert.deepEqual(viewerCollection(["a", "c"], new Set(["a", "c"])), { hung: ["a", "c"], pending: [] });
});
test("a first visit still develops newly selected photos", () => {
  assert.deepEqual(viewerCollection(["a", "c"], new Set()), { hung: [], pending: ["a", "c"] });
});
test("mixed collection hangs saved photos and only develops new selections", () => {
  assert.deepEqual(viewerCollection(["a", "d", "e"], new Set(["a", "c", "e"])), { hung: ["a", "e"], pending: ["d"] });
});
test("unliked and deleted photos cannot remain in the displayed collection", () => {
  assert.deepEqual(viewerCollection(["c"], new Set(["a", "c", "deleted"])), { hung: ["c"], pending: [] });
  assert.deepEqual(viewerCollection([], new Set(["a"])), { hung: [], pending: [] });
});
test("prints developed during the current visit stay ready when reopening the collection", () => {
  const ready = new Set(["a"]);
  ready.add("new");
  assert.deepEqual(viewerCollection(["new", "a"], ready), { hung: ["new", "a"], pending: [] });
});
