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

const v0 = await S(() => window.__seer.ship.speed);
await page.keyboard.down('Space');
await page.keyboard.down('KeyD');
await until(() => window.__seer.ship.speed > 100, 'boost speed');
const s1 = await S(() => ({ e: window.__seer.ship.energy, yaw: window.__seer.ship.yaw, txt: document.getElementById('speed').textContent }));
await page.keyboard.up('Space');
await page.keyboard.up('KeyD');
assert.ok(s1.e < 100 && s1.yaw < -0.05 && Number(s1.txt) > 90);
step(`boost ${v0.toFixed(0)} → >100, energy ${s1.e.toFixed(0)}%, turned right, HUD speed ${s1.txt}`);

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
