import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { startPreview } from "./preview-phase4.mjs";

const fixture=process.env.QA_ORIGIN ? null : await startPreview();
const origin=process.env.QA_ORIGIN||fixture.origin;
if(new URL(origin).hostname!=="127.0.0.1") throw new Error("This synthetic QA script only targets loopback.");
const output=resolve(".data/phase4-qa");await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
const page=await context.newPage(),errors=[],checks=[];
page.on("pageerror",error=>errors.push(error.message));
page.on("dialog",dialog=>dialog.accept());
async function shot(name) { await page.evaluate(()=>document.fonts.ready); await page.screenshot({path:`${output}/${name}.png`,fullPage:true,animations:"disabled"}); }
async function check(name,work) { await work();checks.push(name);console.log(`PASS ${name}`); }
try {
  await check("public Viewer and modal sidebar",async()=>{
    await page.goto(`${origin}/a/offline-fixture`);await page.locator(".viewer-menu-toggle").click();
    await page.locator(".viewer-menu[open]").waitFor();await shot("desktop-menu");
    assert.equal(await page.locator(".viewer-menu-toggle").getAttribute("aria-expanded"),"true");
    await page.keyboard.press("Escape");await page.locator(".viewer-menu[open]").waitFor({state:"hidden"});
    assert.equal(await page.locator(".viewer-menu-toggle").evaluate(el=>document.activeElement===el),true);
    await page.locator(".viewer-menu-toggle").click();
    await page.locator('[data-destination="/create"]').click();await page.waitForURL("**/login?next=/create");
    await page.locator('[name="email"]').waitFor();await shot("desktop-login");
  });
  await check("numeric OTP preserves Create redirect",async()=>{
    await page.locator('[name="email"]').fill("mistyped@example.test");await page.locator('button[type="submit"]').click();
    await page.locator('[data-change-email]').waitFor({state:"visible"});await page.locator('[data-change-email]').click();
    assert.equal(await page.locator('[name="email"]').getAttribute("readonly"),null);
    await page.locator('[name="email"]').fill("browser-creator@example.test");await page.locator('button[type="submit"]').click();
    await page.locator('[name="code"]').waitFor({state:"visible"});await shot("desktop-otp");await page.locator('[name="code"]').fill("99999999");
    await page.locator('button[type="submit"]').click();await page.locator(".owner-feedback--error").waitFor();await shot("desktop-otp-error");
    await page.locator('[name="code"]').fill("12345678");
    await page.locator('button[type="submit"]').click();await page.waitForURL("**/create");
    await page.locator(".template-choice").waitFor();await shot("desktop-create");
    const albums=await page.request.get(`${origin}/api/editor`);assert.deepEqual((await albums.json()).albums,[]);
    await page.locator(".template-choice button").click();await page.waitForURL(/\/editor\/[A-Za-z0-9_-]{16}$/);
    await page.locator('[name="title"]').waitFor();
    assert.equal((await (await page.request.get(`${origin}/api/editor`)).json()).albums.length,1);
  });
  const id=new URL(page.url()).pathname.split("/").pop();
  await check("Editor upload, save, private preview and publish",async()=>{
    await page.locator('[name="title"]').fill("Browser QA memory");
    await page.locator('[name="letter"]').fill("A sample memory for local end-to-end verification.");
    for(let i=0;i<3;i++) {
      await page.locator(`[name="roll-name"][data-roll="roll-${i+1}"]`).fill(`Sample roll ${i+1}`);
    }
    for(let i=0;i<3;i++) {
      await page.locator('[name="upload-roll"]').selectOption(`roll-${i+1}`);
      await page.locator('[name="files"]').setInputFiles(resolve(`public/samples/${["rain-1","sea-1","home-1"][i]}.webp`));
      await page.locator('[data-action="upload"]').click();
      await page.waitForFunction(count=>document.querySelectorAll(".owner-photo").length===count,i+1);
    }
    await page.locator('[data-action="save"]').click();await page.locator('[data-action="save"]:not([disabled])').waitFor();await shot("desktop-editor");
    await page.locator('[data-action="preview"]').click();await page.waitForURL(`**/preview/${id}`);
    await page.locator(".preview-link").waitFor();await page.locator(".preview-link").click();await page.waitForURL(`**/editor/${id}`);
    await page.locator('[data-action="publish"]').click();await page.locator(".share-field").waitFor();
    await page.goto(`${origin}/dashboard`);await page.locator(".album-row").waitFor();await shot("desktop-dashboard");
  });
  await check("logout leaves public viewing open and drafts private",async()=>{
    await page.locator('[data-library="logout"]').click();await page.waitForURL(/\/login\?next=/);
    const draft=await page.request.get(`${origin}/api/editor/${id}`);assert.equal(draft.status(),401);
    const published=await page.request.get(`${origin}/api/a/${id}`);assert.equal(published.status(),200);
    await page.goto(`${origin}/a/${id}`);await page.locator(".viewer-menu-toggle").waitFor();await shot("desktop-viewer");
  });
  await check("envelope, film, new likes, developing, hanging and ending invitation",async()=>{
    await page.locator('[data-action="unseal"]').click();await page.locator('.letter-paper [data-action="table"]').click();
    await page.locator('[data-action="roll"][data-id="roll-1"]').click();
    await page.locator('[data-action="frame"]').first().click();await page.locator('#dialog[open]').waitFor();await page.keyboard.press("Escape");
    await page.locator('#dialog[open]').waitFor({state:"hidden"});await page.locator('.scene-actions [data-action="table"]').click();
    await page.locator('[data-action="roll"][data-id="roll-2"]').click();
    await page.locator('[data-action="advance-viewer"]').click();
    await page.locator('[data-action="mark-viewer"]').waitFor({state:"visible"});await page.locator('[data-action="mark-viewer"]').click();
    await page.locator('[data-action="tray"]').click();await page.locator('[data-action="develop"]').click();
    await page.locator('[data-action="hang"]').click();await page.locator('.memory-invitation').waitFor();
    await shot("desktop-collection");
    assert.equal(await page.locator('.hanging-print').count(),1);
    await page.locator('[data-create-memory]').click();await page.waitForURL("**/login?next=/create");
  });
  await check("mobile login, Create, Studio and Viewer fit 390px",async()=>{
    await page.setViewportSize({width:390,height:844});
    for(const [route,name] of [[`/a/${id}`,"mobile-viewer"],["/login?next=/dashboard","mobile-login"]]) {
      await page.goto(origin+route);await page.locator(route.startsWith("/a/")?".viewer-menu-toggle":"[name=email]").waitFor();await shot(name);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name} overflow`);
      if(name==="mobile-viewer") {
        assert.ok(await page.evaluate(()=>{const status=document.querySelector('.scene-bar > :last-child').getBoundingClientRect(),language=document.querySelector('.language-switcher').getBoundingClientRect();return status.right<=language.left || status.bottom<=language.top || status.top>=language.bottom;}),"scene status does not overlap language controls");
        await page.locator('.viewer-menu-toggle').click();await shot("mobile-menu");
        await page.mouse.click(5,400);await page.locator('.viewer-menu[open]').waitFor({state:"hidden"});
      }
    }
    await page.locator('[name="email"]').fill("mobile-creator@example.test");await page.locator('button[type="submit"]').click();await page.locator('[name="code"]').waitFor({state:"visible"});
    await page.locator('[name="code"]').fill("12345678");await page.locator('button[type="submit"]').click();await page.waitForURL("**/dashboard");
    await page.locator(".studio-empty").waitFor();await shot("mobile-studio-empty");
    await page.locator('.studio-empty a').click();await page.waitForURL("**/create");await page.locator(".template-choice").waitFor();await shot("mobile-create");
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.locator('[data-ui-language="en"]').click();
    await shot("mobile-create-english");assert.match(await page.locator('h1').innerText(),/Create a Memory/);
  });
  assert.deepEqual(errors,[]);
  await writeFile(`${output}/browser-results.json`,JSON.stringify({checks,errors,synthetic:true,origin},null,2));
  console.log(`Screenshots and results: ${output}`);
} catch(error) {await shot("failure");throw error;} finally {await browser.close();await fixture?.close();}
