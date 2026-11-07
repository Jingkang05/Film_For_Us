import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Compile the actual controller in memory, without relying on a prior public/ui build.
const compile = async (name) => ts.transpileModule(await readFile(new URL(`../src/${name}.ts`, import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const moduleURL = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const config = moduleURL(await compile("envelope-config"));
const { createEnvelopeOpening } = await import(moduleURL((await compile("envelope-motion")).replace("./envelope-config.js", config)));
const flush = () => new Promise(resolve => setImmediate(resolve));

function setup(t, reduced = false) {
  const prior = Object.fromEntries(["window", "matchMedia", "getComputedStyle"].map(key => [key, globalThis[key]]));
  t.after(() => { for (const [key, value] of Object.entries(prior)) globalThis[key] = value; });
  const animations = [];
  const media = Object.assign(new EventTarget(), { matches: reduced });
  globalThis.window = new EventTarget();
  globalThis.matchMedia = () => media;
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "-66%" });
  function element(name) {
    return { name, style: {}, disabled: false, dataset: {}, isConnected: true,
      setAttribute() {}, removeAttribute() {},
      animate(keyframes, options) {
        let finish, cancel;
        const finished = new Promise((resolve, reject) => { finish = resolve; cancel = () => reject(new Error("Cancelled")); });
        const animation = { name, keyframes, options, finished, finish, cancel };
        animations.push(animation);
        if (options.duration === 0) queueMicrotask(finish);
        return animation;
      },
    };
  }
  const seal = element("seal"), assembly = element("assembly"), hinge = element("hinge"), insert = element("insert"), root = element("envelope");
  const hint = element("hint");
  const room = { classList: { add() {}, remove() {} }, querySelector: () => hint };
  root.closest = () => room;
  root.querySelector = selector => ({ ".wax-seal": seal, ".seal-assembly": assembly, ".envelope-hinge": hinge, ".envelope-insert": insert })[selector];
  let reveals = 0;
  const controller = createEnvelopeOpening(root, () => { reveals++; });
  t.after(() => controller.destroy());
  return { controller, root, seal, hint, animations, media, get reveals() { return reveals; } };
}

test("unsealing is ordered, locks repeated activation, and reveals only once", async t => {
  const view = setup(t);
  const opening = view.controller.open();
  await view.controller.open();
  assert.equal(view.root.dataset.envelopeState, "sealReleasing");
  assert.equal(view.seal.disabled, true);
  assert.equal(view.animations.length, 1);
  assert.equal(view.animations[0].name, "assembly", "the seal and plant roots must peel together");
  assert.equal(view.hint.style.opacity, "0");
  view.animations[0].finish();
  await flush();
  assert.equal(view.root.dataset.envelopeState, "flapOpening");
  assert.equal(view.animations[1].name, "hinge");
  assert.match(view.animations[1].keyframes.at(-1).transform, /rotateX\(-176deg\)/);
  view.animations[1].finish();
  await flush();
  assert.equal(view.root.dataset.envelopeState, "letterEmerging");
  assert.equal(view.reveals, 0);
  view.animations[2].finish();
  view.animations[3].finish();
  await opening;
  await view.controller.open();
  assert.equal(view.root.dataset.envelopeState, "transitioning");
  assert.equal(view.reveals, 1);
  assert.equal(view.animations.length, 4);
});

test("destroying during release cancels the sequence without a stale scene change", async t => {
  const view = setup(t);
  const opening = view.controller.open();
  view.controller.destroy();
  await opening;
  await view.controller.open();
  assert.equal(view.reveals, 0);
  assert.equal(view.seal.disabled, false);
  assert.equal(view.animations.length, 1);
});

test("pagehide cancels a partial fold and restores an operable sealed envelope", async t => {
  const view = setup(t);
  const opening = view.controller.open();
  view.animations[0].finish();
  await flush();
  window.dispatchEvent(new Event("pagehide"));
  await opening;
  assert.equal(view.root.dataset.envelopeState, "sealed");
  assert.equal(view.seal.disabled, false);
  assert.equal(view.reveals, 0);
  const replay = view.controller.open();
  assert.equal(view.root.dataset.envelopeState, "sealReleasing");
  assert.equal(view.animations.length, 3);
  view.controller.destroy();
  await replay;
});

test("reduced motion keeps short feedback and omits all spatial animations", async t => {
  const view = setup(t, true);
  const opening = view.controller.open();
  assert.equal(view.animations.length, 1);
  assert.equal(view.animations[0].options.duration, 120);
  assert.equal(view.animations[0].keyframes.some(frame => frame.transform), false);
  view.animations[0].finish();
  await opening;
  assert.equal(view.reveals, 1);
  assert.equal(view.animations.length, 1);
});

test("enabling reduced motion during opening finishes without waiting or replaying", async t => {
  const view = setup(t);
  const opening = view.controller.open();
  view.media.matches = true;
  view.media.dispatchEvent(new Event("change"));
  await opening;
  assert.equal(view.reveals, 1);
  assert.ok(view.animations.slice(1).every(animation => animation.options.duration === 0));
});
