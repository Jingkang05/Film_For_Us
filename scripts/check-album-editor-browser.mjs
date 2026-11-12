// Disposable integration regression: no hosted writes or production credentials.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, webkit } from 'playwright';
import { startPreview } from './preview-phase4.mjs';
const fixture = await startPreview(4186);
const output = resolve('.data/album-editor-qa');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage(), checks = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('dialog', dialog => dialog.accept());
const url = path => fixture.origin + path;
const check = async (name, work) => { await work(); checks.push(name); console.log('PASS ' + name); };
const saved = () => page.locator('[data-action=save]:not([disabled])').waitFor();
const snap = async name => { await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: `${output}/${name}.png`, fullPage: true, animations: 'disabled' }); };
let editorPath;
try {
  await check('create album through real local account and template flow', async () => {
    await page.goto(url('/login?next=/create'));
    await page.locator('[name=email]').fill('editor-qa@example.test');
    await page.locator('button[type=submit]').click();
    await page.locator('[name=code]').fill('12345678'); await page.locator('button[type=submit]').click();
    await page.waitForURL('**/create'); await page.locator('.template-choice button').click();
    await page.waitForURL(/\/editor\/[\w-]+$/); editorPath = new URL(page.url()).pathname;
    for (const [i, name] of ['雨后 / After the rain', '海边 / By the sea', '归途 / On the way home'].entries()) await page.locator(`[name=roll-name][data-roll="roll-${i + 1}"]`).fill(name);
    await page.locator('[name=title]').fill('Letters from the coast · 隔离测试');
    await page.locator('[name=letter]').fill('这是一封测试用的开场信。\nFor the moments we want to keep.');
    await page.locator('.template-settings summary').click();
    await page.locator('textarea[name=description]').fill('Synthetic QA album, never production.');
    await page.locator('[name=instant-caption]').fill('Until next time.');
    await page.locator('[name=seal-motif]').selectOption('branch');
    await page.locator('[name=music-title]').fill('Local QA soundtrack');
    await page.locator('[name=share-slug]').fill('editor-qa-coast');
    await page.locator('.template-settings summary').click();
  });
  await check('upload queue, error feedback, retry and three larger thumbnails', async () => {
    await page.locator('[name=files]').setInputFiles(['rain-1', 'sea-1', 'home-1'].map(name => resolve(`public/samples/${name}.webp`)));
    assert.equal(await page.locator('.upload-list li').count(), 3);
    await page.route('**/api/editor/*/upload-target?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic upload failure' }) }));
    await page.locator('[data-action=upload]').click(); await saved();
    assert.equal(await page.locator('.upload-list li[data-state=failed]').count(), 3);
    await page.unroute('**/api/editor/*/upload-target?*');
    for (let i = 0; i < 3; i++) { await page.locator('[data-action=retry]').first().click(); await saved(); }
    assert.equal(await page.locator('.photo-select').count(), 3);
    assert.equal(await page.locator('[name=note]').count(), 1);
    assert.equal(await page.locator('.photo-select img').first().evaluate(el => getComputedStyle(el).objectFit), 'contain');
  });
  let first, second, original, originalThumb;
  await check('selection preserves unsaved captions, dates and keyboard access', async () => {
    original = (await (await page.request.get(url(editorPath.replace('/editor/', '/api/editor/')))).json()).album;
    originalThumb = await (await page.request.get(url(original.rolls[0].photos[0].thumb))).body();
    first = original.rolls[0].photos[0].id; second = original.rolls[0].photos[1].id;
    await page.locator(`[data-action=select-photo][data-id="${first}"]`).click();
    await page.locator('[name=date]').fill('2026-10-22'); await page.locator('[name=note]').fill('海风、雨声与我们。 A note kept while switching photos.');
    await page.locator(`[data-action=select-photo][data-id="${second}"]`).focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('[name=note]').getAttribute('data-id'), second);
    await page.locator(`[data-action=select-photo][data-id="${first}"]`).click();
    assert.match(await page.locator('[name=note]').inputValue(), /A note kept/);
    assert.equal(await page.locator('[name=date]').inputValue(), '2026-10-22');
    assert.equal(await page.locator('.photo-select[aria-pressed=true]').count(), 1);
    assert.match(await page.locator('#revision-status').innerText(), /未保存/);
  });
  await check('save failure keeps draft and blocks preview navigation until retry', async () => {
    await page.route('**/api/editor/*/save', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic save failure' }) }));
    await page.locator('[data-action=preview]').click(); await saved();
    assert.equal(new URL(page.url()).pathname, editorPath);
    assert.match(await page.locator('[name=note]').inputValue(), /A note kept/);
    assert.match(await page.locator('#revision-status').innerText(), /未保存/);
    await page.unroute('**/api/editor/*/save');
  });
  await check('within-roll order, category moves and replacement preserve IDs and metadata', async () => {
    await page.locator('[data-action=down]').click();
    assert.equal(await page.locator('.photo-select').nth(1).getAttribute('data-id'), first);
    await page.locator('[data-action=up]').click();
    await page.locator('[name=move]').selectOption('roll-2');
    assert.equal(await page.locator('[name=note]').getAttribute('data-id'), first);
    await page.locator('[name=replace]').setInputFiles(resolve('public/samples/sea-1.webp')); await saved();
    const current = (await (await page.request.get(url(editorPath.replace('/editor/', '/api/editor/')))).json()).album;
    const photo = current.rolls[1].photos[0];
    assert.equal(photo.id, first); assert.equal(photo.date, '2026-10-22'); assert.match(photo.note, /A note kept/);
    assert.equal(photo.thumb, original.rolls[0].photos[0].thumb);
    assert.notDeepEqual(await (await page.request.get(url(photo.thumb))).body(), originalThumb);
    assert.deepEqual(current.rolls.flatMap(r => r.photos).map(p => p.id).sort(), original.rolls.flatMap(r => r.photos).map(p => p.id).sort());
    assert.deepEqual(current.rolls[0].photos.map(p => p.id), original.rolls[0].photos.slice(1).map(p => p.id));
    assert.equal(current.rolls[0].photos[0].thumb, original.rolls[0].photos[1].thumb);
  });
  await check('save, refresh, settings and metadata round trip', async () => {
    await page.locator('[data-action=save]').click(); await saved(); await page.reload();
    await page.locator(`[data-action=select-photo][data-id="${first}"]`).click();
    assert.match(await page.locator('[name=note]').inputValue(), /A note kept/);
    await page.locator('.template-settings summary').click();
    assert.equal(await page.locator('textarea[name=description]').inputValue(), 'Synthetic QA album, never production.');
    assert.equal(await page.locator('[name=seal-motif]').inputValue(), 'branch');
    assert.equal(await page.locator('[name=music-title]').inputValue(), 'Local QA soundtrack');
    await page.locator('.template-settings summary').click();
  });
  await check('real private viewer saves changes, stays unpublished and restores editor position', async () => {
    await page.locator('[name=note]').fill('Preview saves this draft before entering the real viewer.');
    await page.locator('#photo-collection').scrollIntoViewIfNeeded();
    const position = await page.evaluate(() => scrollY);
    await page.locator('[data-action=preview]').click(); await page.waitForURL('**/preview/*');
    await page.locator('.envelope').waitFor();
    const anon = await browser.newContext();
    assert.equal((await anon.request.get(url(editorPath.replace('/editor/', '/api/editor/')))).status(), 401);
    assert.equal((await anon.request.get(url('/api/a/' + editorPath.split('/').pop()))).status(), 404);
    await anon.close();
    await page.locator('.preview-link').click(); await page.waitForURL('**' + editorPath);
    await page.locator('[name=note]').waitFor();
    assert.equal(await page.locator('[name=note]').getAttribute('data-id'), first);
    assert.match(await page.locator('[name=note]').inputValue(), /^Preview saves/);
    await page.waitForFunction(pos => Math.abs(scrollY - pos) < 100, position);
    await page.locator('[name=note]').fill('Still editable after preview.');
    await page.locator('[data-action=save]').click(); await saved();
  });
  await check('desktop, tablet, mobile and bilingual layout have no overflow', async () => {
    for (const [name, width, height] of [['desktop', 1440, 1000], ['tablet', 820, 1180], ['mobile', 390, 844], ['small-mobile', 320, 740]]) {
      await page.setViewportSize({ width, height });
      await page.locator('#photo-collection').scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} overflows: ${await page.evaluate(() => [...document.querySelectorAll(".album-editor *")].filter(el => el.getBoundingClientRect().right > innerWidth + 1).map(el => el.className || el.tagName))}`);
      assert.ok(await page.locator('.photo-select').first().evaluate(el => el.getBoundingClientRect().width >= 100));
      await page.screenshot({ path: `${output}/${name}-collection.png`, animations: 'disabled' });
      await page.evaluate(() => scrollTo(0, 0));
      await snap(name);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-ui-language=en]').click(); await snap('mobile-english');
    assert.match(await page.locator('h2#collection-heading').innerText(), /Photo collection/);
    await page.locator('[data-ui-language=zh]').click();
  });
  await check('publish, copy and existing share stay unchanged when editing draft', async () => {
    await page.locator('[data-action=publish]').click(); await saved();
    assert.equal(await page.locator('.share-field').count(), 0);
    assert.ok(await page.locator('#owner-status.owner-feedback--error').isVisible());
    await page.locator(`[data-action=select-photo][data-id="${original.rolls[0].photos[2].id}"]`).click();
    await page.locator('[name=move]').selectOption('roll-3');
    await page.locator('[data-action=publish]').click(); await page.locator('.share-field').waitFor();
    const published = await (await page.request.get(url('/api/a/editor-qa-coast'))).json();
    await page.locator('[name=title]').fill('A new unsaved title');
    await page.locator('[data-action=save]').click(); await saved();
    assert.deepEqual(await (await page.request.get(url('/api/a/editor-qa-coast'))).json(), published);
    assert.match(await page.locator('.share-field input').inputValue(), /\/a\/editor-qa-coast$/);
    await page.locator('[data-action=copy]').click();
    await page.reload(); await page.locator('[name=title]').waitFor();
    assert.equal(await page.locator('[name=title]').inputValue(), 'A new unsaved title');
  });
  await check('iPhone WebKit contact sheet and touch-sized actions', async () => {
    const safari = await webkit.launch({ headless: true });
    try {
      const iphone = await safari.newContext({ storageState: await context.storageState(), viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      const mobile = await iphone.newPage(); mobile.on('pageerror', error => errors.push(error.message));
      await mobile.goto(url(editorPath)); await mobile.locator('.photo-select').first().click();
      assert.equal(await mobile.locator('[name=note]').count(), 1);
      assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      for (const action of ['save', 'preview', 'publish']) assert.ok((await mobile.locator(`[data-action=${action}]`).boundingBox()).height >= 44);
      await mobile.evaluate(() => document.fonts.ready);
      await mobile.screenshot({ path: `${output}/iphone-webkit.png`, fullPage: true });
    } finally { await safari.close(); }
  });
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, errors, synthetic: true }, null, 2));
} catch (error) { await snap('failure'); throw error; }
finally { await browser.close(); await fixture.close(); }
