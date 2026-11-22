// End-to-end smoke: start → walk (keyboard) → collision holds → launch gate →
// space flight (boost raises speed, drains energy) → dock back to the cabin.
// Usage: node e2e/smoke.mjs   (needs ./dist; or SEER_URL=… for a live server)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const { chromium } = await import('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let URL = process.env.SEER_URL;
let server = null;
if (!URL) {
  const port = 3990 + Math.floor(Math.random() * 9);
  server = spawn(process.execPath, [path.join(ROOT, 'server/index.js')], {
    env: { ...process.env, PORT: String(port), SEER_DIST: path.join(ROOT, 'dist') },
    stdio: 'ignore',
  });
  URL = `http://127.0.0.1:${port}/seer/`;
  await new Promise((r) => setTimeout(r, 600));
}
process.on('exit', () => server?.kill());

let page = null;
let browser = null;
const errors = [];
for (let attempt = 1; attempt <= 3 && !page; attempt++) {
  const b = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
  try {
    const p = await b.newPage({ viewport: { width: 844, height: 390 } });
    p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(URL, { waitUntil: 'commit', timeout: 20000 });
    let frames = 0;
    for (let i = 0; i < 60 && frames <= 20; i++) {
      await p.waitForTimeout(1000);
      frames = await p.evaluate(() => window.__frames ?? 0).catch(() => 0);
    }
    if (frames <= 20) throw new Error('no frames');
    page = p;
    browser = b;
  } catch (e) {
    console.log(`nav attempt ${attempt} failed: ${String(e).split('\n')[0]}`);
    await b.close().catch(() => {});
  }
}
assert.ok(page, 'page never rendered');

const S = (fn) => page.evaluate(fn);
const tap = (id) => page.evaluate((i) => document.getElementById(i).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })), id);
const until = async (fn, label, ms = 240000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.evaluate(fn)) return;
    await page.waitForTimeout(200);
  }
  throw new Error(`timeout: ${label}`);
};
const step = (name) => console.log(`ok  ${name}`);

await tap('go');
assert.equal(await S(() => window.__seer.started), true);
step('start button enters the cabin');

// launch is refused away from the table
await page.keyboard.press('KeyE');
assert.equal(await S(() => window.__seer.mode.mode), 'cabin');
assert.equal(await S(() => document.getElementById('act').classList.contains('hidden')), true);
step('launch gated: no 启航 at spawn');

// walk forward with W until the pedestal stops us
const z0 = await S(() => window.__seer.robot.z);
await page.keyboard.down('KeyW');
await until(() => !document.getElementById('act').classList.contains('hidden'), 'reach holo table');
await page.waitForTimeout(1500);
await page.keyboard.up('KeyW');
const r = await S(() => ({ x: window.__seer.robot.x, z: window.__seer.robot.z, steps: window.__seer.robot.steps }));
assert.ok(r.z < z0 - 2, `walked: ${z0} → ${r.z}`);
assert.ok(Math.hypot(r.x, r.z + 4.3) >= 1.05 + 0.28 - 0.02, 'stopped at the pedestal face');
assert.ok(r.steps > 3 && (await S(() => window.__seer.sfx.counts.footstep)) > 3);
step(`walked to the holo table (z ${z0.toFixed(1)} → ${r.z.toFixed(2)}), blocked by pedestal, footsteps fired`);

await tap('act');
assert.equal(await S(() => document.getElementById('targets').classList.contains('hidden')), false);
step('星图 opens with selectable targets');

await tap('launch');
assert.equal(await S(() => window.__seer.mode.mode), 'transit');
const chosen = await S(() => ({ saved: localStorage.getItem('seer.target'), targetId: window.__seer.targetId, goal: document.getElementById('goal').textContent }));
assert.equal(chosen.saved, chosen.targetId);
assert.match(chosen.goal, /^航行至 .+ 执行扫描$/);
await until(() => window.__seer.mode.mode === 'space', 'arrive in space');
assert.equal(await S(() => document.getElementById('boost').classList.contains('hidden')), false);
step(`target ${chosen.saved} saved; 启航 → transit → space, flight HUD shown`);

// T1: portrait 390x844 top HUD buttons must be >= 48px touch height and non-overlapping
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(150);
const topBtns = await S(() =>
  ['archBtn', 'dock', 'mute'].map((id) => {
    const el = document.getElementById(id);
    const r = el.getBoundingClientRect();
    return { id, hidden: el.classList.contains('hidden'), left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  }),
);
for (const b of topBtns) {
  assert.equal(b.hidden, false, `${b.id} visible in space`);
  assert.ok(b.height >= 48, `${b.id} height ${b.height} < 48`);
  assert.ok(b.width >= 48, `${b.id} width ${b.width} < 48`);
}
for (let i = 0; i < topBtns.length; i++) {
  for (let j = i + 1; j < topBtns.length; j++) {
    const a = topBtns[i];
    const b = topBtns[j];
    const sep = a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
    assert.ok(sep, `portrait HUD overlap: ${a.id} vs ${b.id}`);
  }
}
await page.setViewportSize({ width: 844, height: 390 });
await page.waitForTimeout(100);
step('portrait 390x844 top HUD buttons >= 48px and non-overlapping');

const v0 = await S(() => window.__seer.ship.speed);
await page.keyboard.down('Space');
await page.keyboard.down('KeyD');
await until(() => window.__seer.ship.speed > 100, 'boost speed');
const s1 = await S(() => ({ e: window.__seer.ship.energy, yaw: window.__seer.ship.yaw, txt: document.getElementById('speed').textContent }));
await page.keyboard.up('Space');
await page.keyboard.up('KeyD');
assert.ok(s1.e < 100 && s1.yaw < -0.05 && Number(s1.txt) > 90);
step(`boost ${v0.toFixed(0)} → >100, energy ${s1.e.toFixed(0)}%, turned right, HUD speed ${s1.txt}`);

// A5: portrait 390x844 ring-city traffic warn bar must be cyan and never overlap top HUD buttons
await page.setViewportSize({ width: 390, height: 844 });
assert.equal(await S(() => window.__seer.focusPlanet('ring-city')), true);
await until(() => !document.getElementById('warn').classList.contains('hidden'), 'ring-city traffic warn visible');
const warnCheck = await S(() => {
  const wEl = document.getElementById('warn');
  const wRect = wEl.getBoundingClientRect();
  const btns = ['archBtn', 'dock', 'mute'].map((id) => {
    const r = document.getElementById(id).getBoundingClientRect();
    return { id, left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  });
  return {
    text: wEl.textContent,
    cyan: wEl.classList.contains('cyan'),
    rect: { left: wRect.left, right: wRect.right, top: wRect.top, bottom: wRect.bottom },
    btns,
  };
});
assert.equal(warnCheck.cyan, true, 'ring-city warn bar is cyan');
assert.match(warnCheck.text, /环城航道/);
for (const b of warnCheck.btns) {
  assert.ok(b.height >= 48 && b.width >= 48, `${b.id} >= 48px`);
  const sep =
    warnCheck.rect.right <= b.left ||
    b.right <= warnCheck.rect.left ||
    warnCheck.rect.bottom <= b.top ||
    b.bottom <= warnCheck.rect.top;
  assert.ok(sep, `portrait warn overlaps ${b.id}`);
}
await page.setViewportSize({ width: 844, height: 390 });
await page.waitForTimeout(100);
step('portrait 390x844 ring-city cyan warn bar does not overlap top buttons');

await tap('dock');
await until(() => window.__seer.mode.mode === 'cabin', 'dock');
assert.equal(await S(() => document.getElementById('flight').classList.contains('hidden')), true);
step('返回舱内 → cabin');

await tap('mute');
assert.equal(await S(() => localStorage.getItem('seer.muted')), '1');
await tap('mute');
assert.equal(await S(() => localStorage.getItem('seer.muted')), '0');
step('mute toggle persists');

assert.deepEqual(errors, []);
await browser.close();
console.log('SMOKE OK');
process.exit(0);
