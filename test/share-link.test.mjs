import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { validateShareSlug, initialAlbum, publicationSnapshot, readPublished } from "../server/album.mjs";
const compiled = ts.transpileModule(await readFile(new URL("../src/share-link.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { normalizeShareSlug, validShareSlug, shareSlugFromTitle } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("title suggestions extract English, handle punctuation and reject titles without English or numbers", () => {
  for (const [title, expected] of [["Our Summer, 2026!", "our-summer-2026"], ["我们的 夏天！", ""], ["我们的 Summer 2026！", "summer-2026"], ["Ｃａｆé", "cafe"], ["📷✨", ""], ["a".repeat(90), "a".repeat(80)]]) {
    const slug = shareSlugFromTitle(title);
    assert.equal(slug, expected);
    assert.ok(validShareSlug(slug));
    assert.equal(validateShareSlug(slug), slug);
  }
});

test("browser and server agree on valid suffixes", () => {
  for (const value of ["", " Our-Story ", "我们的回忆", "café", "a_b", "ＡＢＣ", "e\u0301", "../x", "x/y", "x?x", "-x", "x_", "%2F", "<script>", "😀", "a".repeat(81)]) {
    if (validShareSlug(value)) assert.equal(validateShareSlug(value), normalizeShareSlug(value));
    else assert.throws(() => validateShareSlug(value), { status: 422 });
  }
});

test("non-English suffixes are rejected by both browser and server", () => {
  for (const value of ["我们的回忆", "café", "夏天-2026", "привет", "صيف"]) {
    assert.equal(validShareSlug(value), false);
    assert.throws(() => validateShareSlug(value), { status: 422 });
  }
});

test("Blob-compatible publication snapshots retain previous aliases through repeated renames and clearing", () => {
  const row = initialAlbum();
  const draft = JSON.parse(row.draft);
  for (const slug of ["first", "second", "", "first", "third"]) {
    row.draft = JSON.stringify({ ...draft, shareSlug: slug });
    row.published = publicationSnapshot(row);
  }
  for (const slug of [row.share_id, "first", "second", "third"]) {
    const album = readPublished(row, slug);
    assert.equal(album.id, row.share_id);
    assert.equal(album.shareAliases, undefined);
  }
  assert.throws(() => readPublished(row, "not-published"), { status: 404 });
  assert.deepEqual(JSON.parse(row.published).shareAliases, ["first", "second", "third"]);
});
