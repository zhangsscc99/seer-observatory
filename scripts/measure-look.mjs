// Look-metrics gate. Opens the built game, enters the cabin, screenshots and
// asserts luminance stats (cabin AND space) so "too dark / washed out" can't
// regress silently. Also writes the four reference shots to e2e/shots/.
// Software WebGL (SwiftShader) is enough — we measure pixels, not fps.
//
// Usage: node scripts/measure-look.mjs
//   SEER_URL=http://127.0.0.1:3029/seer/  measure a running server instead
//   of spawning a private preview of ./dist.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'e2e/shots');
mkdirSync(SHOTS, { recursive: true });

const LAUNCH_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'];
// per-scene luminance bands (844×390 landscape only; portrait is info-only)
const THRESH = {
  cabin: { meanMin: 110, meanMax: 135, darkFrac: 0.15, p95: 120 },
  space: { meanMin: 45, meanMax: 95, darkFrac: null, p95: 120 },
};

// ── private preview server over ./dist ───────────────────────────────
const EXPLICIT_URL = process.env.SEER_URL;
let server = null;
let serverPort = 0;
let URL = EXPLICIT_URL || '';

async function pingHealth(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function spawnPreview() {
  if (server) {
    server._stopping = true;
    server.kill();
    server = null;
  }
  if (!existsSync(path.join(ROOT, 'dist/index.html'))) {
    console.error('FAIL — dist/ missing, run `npm run build` first');
    process.exit(1);
  }
  const port = 3900 + Math.floor(Math.random() * 90);
  const child = spawn(process.execPath, [path.join(ROOT, 'server/index.js')], {
    env: { ...process.env, PORT: String(port), SEER_DIST: path.join(ROOT, 'dist') },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  child.on('exit', (code, signal) => {
    if (!child._stopping) {
      console.error(`preview server (port ${port}) exited unexpectedly: code=${code} signal=${signal}${stderr ? `\n${stderr.trim()}` : ''}`);
    }
  });
  child.on('error', (err) => {
    console.error(`preview server (port ${port}) error: ${err.message}`);
  });
  server = child;
  serverPort = port;
  URL = `http://127.0.0.1:${port}/seer/`;
  for (let i = 0; i < 40; i++) {
    if (child.exitCode !== null) break;
    if (await pingHealth(port)) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

async function ensureServer() {
  if (EXPLICIT_URL) return;
  if (server && server.exitCode === null && (await pingHealth(serverPort))) return;
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (server) console.log(`preview server health check failed; respawning (${attempt}/2)`);
    if (await spawnPreview()) return;
  }
  console.error('FAIL — preview server failed to become healthy after 2 attempts');
  process.exit(1);
}

const cleanup = () => {
  if (server) {
    server._stopping = true;
    server.kill();
  }
};
process.on('exit', cleanup);

/** Open the game in a fresh browser; WSL chromium navigation occasionally
 *  wedges, so retry up to 3 times with a new process each time. */
async function open(width, height, errors) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await ensureServer();
    const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
    try {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: true });
      page.on('pageerror', (e) => errors.push(String(e)));
      // 'commit', then poll frames: the module script blocks DCL on WebGL init
      await page.goto(URL, { waitUntil: 'commit', timeout: 20000 });
      let frames = 0;
      for (let i = 0; i < 60 && frames <= 20; i++) {
        await page.waitForTimeout(1000);
        frames = await page.evaluate(() => window.__frames ?? 0).catch(() => 0);
      }
      if (frames <= 20) throw new Error('frames never advanced past 20');
      return { browser, page };
    } catch (e) {
      console.log(`nav attempt ${attempt} (${width}x${height}) failed: ${String(e).split('\n')[0]}`);
      await browser.close().catch(() => {});
    }
  }
  return null;
}

const waitFrames = async (page, n) => {
  const start = await page.evaluate(() => window.__frames);
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(250);
    if ((await page.evaluate(() => window.__frames)) - start >= n) return;
  }
};

async function screenshotWithRetry(page, label) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await page.screenshot({ timeout: 120000 });
    } catch (e) {
      if (attempt === 3) throw e;
      console.log(`screenshot ${label} attempt ${attempt}/3 failed: ${String(e).split('\n')[0]}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function stats(page, png) {
  return page.evaluate(async (b64) => {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = `data:image/png;base64,${b64}`;
    });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
    const n = width * height;
    const luma = new Float32Array(n);
    const topRows = Math.floor(height * 0.3);
    let sum = 0, topSum = 0, dark = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        luma[y * width + x] = l;
        sum += l;
        if (y < topRows) topSum += l;
        if (l < 10) dark++;
      }
    luma.sort();
    return { mean: sum / n, top30: topSum / (topRows * width), darkFrac: dark / n, p95: luma[Math.floor(0.95 * (n - 1))] };
  }, png.toString('base64'));
}

function report(label, s, th) {
  const checks = [
    ['mean', s.mean, `${th.meanMin}..${th.meanMax}`, s.mean >= th.meanMin && s.mean <= th.meanMax],
    ['top30', s.top30, 'info', true],
    ['p95', s.p95, `>= ${th.p95}`, s.p95 >= th.p95],
  ];
  if (th.darkFrac !== null) checks.push(['darkFrac', s.darkFrac, `<= ${th.darkFrac}`, s.darkFrac <= th.darkFrac]);
  let ok = true;
  console.log(`── ${label}`);
  for (const [name, v, range, pass] of checks) {
    ok &&= pass;
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(8)} ${v.toFixed(2).padStart(7)}  ${range}`);
  }
  return ok;
}

let ok = true;
const errors = [];
// landscape is the gated viewport; portrait is shot for the record
const VIEWS = process.env.SEER_FAST ? [[844, 390, true]] : [[844, 390, true], [390, 844, false]];
for (const [w, h, gate] of VIEWS) {
  const s = await open(w, h, errors);
  if (!s) {
    console.error('FAIL — page never rendered frames');
    process.exit(1);
  }
  const { browser, page } = s;
  const tag = `${w}x${h}`;
  // enter the game the way a player does: tap 开始探索
  await page.evaluate(() => document.getElementById('go').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })));
  if (!(await page.evaluate(() => window.__seer.started))) {
    console.error('FAIL — start button did not start the game');
    process.exit(1);
  }
  await waitFrames(page, 12);
  let png = await screenshotWithRetry(page, `cabin ${tag}`);
  writeFileSync(path.join(SHOTS, `cabin-${tag}.png`), png);
  const cabin = await stats(page, png);
  const cabinPass = report(`cabin ${tag}${gate ? '' : ' (info)'}`, cabin, THRESH.cabin);
  if (gate && !cabinPass) ok = false;

  // walk-up shortcut, then the real launch path (proximity gate → transit)
  await page.evaluate(() => {
    window.__seer.gotoPedestal();
  });
  await waitFrames(page, 3);
  const actVisible = await page.evaluate(() => !document.getElementById('act').classList.contains('hidden'));
  if (!actVisible) {
    console.log('FAIL  启航 button not shown next to the holo table');
    ok = false;
  }
  await page.evaluate(() => document.getElementById('act').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })));
  await page.evaluate(() => document.getElementById('launch').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })));
  for (let i = 0; i < 600; i++) {
    await page.waitForTimeout(250);
    if ((await page.evaluate(() => window.__seer.mode.mode)) === 'space') break;
  }
  if ((await page.evaluate(() => window.__seer.mode.mode)) !== 'space') {
    console.log('FAIL  never arrived in space mode');
    ok = false;
  }
  await waitFrames(page, 10);
  png = await screenshotWithRetry(page, `space ${tag}`);
  writeFileSync(path.join(SHOTS, `space-${tag}.png`), png);
  const space = await stats(page, png);
  const spacePass = report(`space ${tag}${gate ? '' : ' (info)'}`, space, THRESH.space);
  if (gate && !spacePass) ok = false;

  // planet close-ups (info-only): icer 3/4 ring view + gas-storm + red-giant
  for (const [id, shotName] of [
    ['icer', 'icer'],
    ['gas-storm', 'gas'],
    ['red-giant', 'red'],
  ]) {
    const focused = await page.evaluate((pid) => window.__seer.focusPlanet(pid), id);
    if (!focused) {
      console.log(`FAIL  focusPlanet(${id}) returned false`);
      ok = false;
    } else {
      await waitFrames(page, 8);
      png = await screenshotWithRetry(page, `${shotName} ${tag}`);
      writeFileSync(path.join(SHOTS, `${shotName}-${tag}.png`), png);
      const st = await stats(page, png);
      console.log(`── ${shotName} ${tag} (info)  mean ${st.mean.toFixed(1)}  p95 ${st.p95.toFixed(1)}`);
    }
  }
  await browser.close();
}

if (errors.length) {
  ok = false;
  console.log(`FAIL  js errors:\n${errors.join('\n')}`);
}
console.log(`shots: ${path.relative(ROOT, SHOTS)}/{cabin,space,gas,icer,red}-{844x390,390x844}.png`);
console.log(ok ? 'LOOK OK' : 'LOOK FAILED');
cleanup();
process.exit(ok ? 0 : 1);
