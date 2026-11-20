// Robot look shots: enters the cabin, orbits the camera to face the robot's
// front and back, and saves PNGs to e2e/shots/robot-*.png (portrait+landscape).
// Usage: node e2e/robot-shots.mjs   (needs ./dist; or SEER_URL=… for live)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const { chromium } = await import('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'e2e/shots');
mkdirSync(SHOTS, { recursive: true });

let URL = process.env.SEER_URL;
let server = null;
if (!URL) {
  const port = 3950 + Math.floor(Math.random() * 40);
  server = spawn(process.execPath, [path.join(ROOT, 'server/index.js')], {
    env: { ...process.env, PORT: String(port), SEER_DIST: path.join(ROOT, 'dist') },
    stdio: 'ignore',
  });
  URL = `http://127.0.0.1:${port}/seer/`;
  await new Promise((r) => setTimeout(r, 800));
}
process.on('exit', () => server?.kill());

const LAUNCH = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'];
const S = (page, fn) => page.evaluate(fn);
const tap = (page, id) => page.evaluate((i) => document.getElementById(i).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })), id);
const frames = async (page, n = 30) => {
  const f0 = await S(page, () => window.__frames);
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(150);
    if ((await S(page, () => window.__frames)) - f0 >= n) return;
  }
};

for (const [w, h] of [[390, 844], [844, 390]]) {
  const browser = await chromium.launch({ headless: true, args: LAUNCH });
  const page = await browser.newPage({ viewport: { width: w, height: h }, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL, { waitUntil: 'commit', timeout: 20000 });
  for (let i = 0; i < 60 && (await S(page, () => window.__frames ?? 0)) <= 20; i++) await page.waitForTimeout(1000);
  await tap(page, 'go');
  assert.equal(await S(page, () => window.__seer.started), true);
  for (let i = 0; i < 100; i++) {
    if ((await S(page, () => window.__seer.robotView.source)) === 'glb') break;
    await page.waitForTimeout(100);
  }
  console.log(`${w}x${h} robotView.source =`, await S(page, () => window.__seer.robotView.source));
  await frames(page, 20);

  for (const [view, yaw, zoom, pitch] of [
    ['front', 0, 0.42, 0.14],   // 正面特写
    ['back', Math.PI, 0.55, 0.14],
    ['mid', 0, 1.0, 0.3],       // 舱内中景
  ]) {
    await page.evaluate(([y, z, p]) => {
      window.__seer.cam.yaw = y;
      window.__seer.cam.zoom = z;
      window.__seer.cam.pitch = p;
      window.__seer.robot.heading = 0; // model faces +z; camera at +z sees the front
    }, [yaw, zoom, pitch]);
    await frames(page, 8);
    for (let a = 0; a < 3; a++) {
      try {
        await page.screenshot({ path: path.join(SHOTS, `robot-${view}-${w}x${h}.png`), timeout: 90000 });
        break;
      } catch (e) {
        if (a === 2) throw e;
      }
    }
    console.log(`shot robot-${view}-${w}x${h}.png`);
  }
  assert.deepEqual(errors, []);
  await browser.close();
}
console.log('ROBOT SHOTS OK');
