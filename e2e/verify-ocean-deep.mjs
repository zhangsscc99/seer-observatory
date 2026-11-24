// End-to-end machine verification + 6-shot visual capture for Ocean Planet
// "Deep Water Zone" (海洋星 · 深水区).
// Usage: node e2e/verify-ocean-deep.mjs   (needs ./dist; or SEER_URL=…)
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
  if (!existsSync(path.join(ROOT, 'dist/index.html'))) {
    console.error('FAIL — dist/ missing, run `npm run build` first');
    process.exit(1);
  }
  const port = 3980 + Math.floor(Math.random() * 9);
  server = spawn(process.execPath, [path.join(ROOT, 'server/index.js')], {
    env: { ...process.env, PORT: String(port), SEER_DIST: path.join(ROOT, 'dist') },
    stdio: 'ignore',
  });
  URL = `http://127.0.0.1:${port}/seer/?scene=ocean-deep`;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) break;
    } catch {
      /* waiting for preview server */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
} else if (!URL.includes('scene=ocean-deep')) {
  URL += (URL.includes('?') ? '&' : '?') + 'scene=ocean-deep';
}
process.on('exit', () => server?.kill());

const LAUNCH_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
];

const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];

let browser = null;
let page = null;
for (let attempt = 1; attempt <= 3 && !page; attempt++) {
  const b = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  try {
    // Start in 390x844 mobile viewport for the 10-second continuous walk budget check
    const p = await b.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    await p.addInitScript(() => {
      const origRAF = window.requestAnimationFrame.bind(window);
      window.__frameExecMs = [];
      window.__rafDeltaMs = [];
      let lastTs = 0;
      window.requestAnimationFrame = (cb) =>
        origRAF((ts) => {
          const t0 = performance.now();
          if (lastTs > 0) window.__rafDeltaMs.push(ts - lastTs);
          lastTs = ts;
          cb(ts);
          window.__frameExecMs.push(performance.now() - t0);
          if (window.__frameExecMs.length > 900) window.__frameExecMs.shift();
          if (window.__rafDeltaMs.length > 900) window.__rafDeltaMs.shift();
        });
    });
    p.on('pageerror', (e) => {
      pageErrors.push(String(e));
      console.error('PAGEERROR:', String(e));
    });
    p.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
        console.error('CONSOLE ERROR:', msg.text());
      }
    });
    p.on('requestfailed', (req) => {
      failedRequests.push(`${req.method()} ${req.url()} (${req.failure()?.errorText ?? 'failed'})`);
    });
    p.on('response', (res) => {
      if (res.status() >= 400) failedRequests.push(`${res.status()} ${res.url()}`);
    });

    await p.goto(URL, { waitUntil: 'commit', timeout: 25000 });
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      await p.waitForTimeout(500);
      ready = await p
        .evaluate(() => Boolean(window.__frames > 15 && window.__seer?.oceanDeep?.active))
        .catch(() => false);
    }
    if (!ready) throw new Error('OceanDeep scene did not activate');
    browser = b;
    page = p;
  } catch (e) {
    console.log(`nav attempt ${attempt} failed: ${String(e).split('\n')[0]}`);
    await b.close().catch(() => {});
  }
}
assert.ok(page, 'OceanDeep page never became ready');

const S = (fn, arg) => page.evaluate(fn, arg);
const waitFrames = async (n) => {
  const f0 = await S(() => window.__frames);
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(100);
    if ((await S(() => window.__frames)) - f0 >= n) return;
  }
};

// ── Assertions 1–5: Runtime Scene Graph, 1:1 Colliders, Downward Raycast, Flood Fill, Kitbash Stats ──
const report = await S(() => window.__seer.oceanDeep.verifyRuntime());

console.log('=== ANCHORS ===', JSON.stringify(report.anchors));
assert.equal(report.anchors.spire, 2, `expected 2 spires, got ${report.anchors.spire}`);
for (const key of ['bridge', 'plaza', 'altar', 'terrace', 'arch', 'crystal-warm', 'crystal-cool', 'kelp']) {
  assert.ok(report.anchors[key] >= 1, `missing anchor ${key}`);
}

console.log('=== WALKABILITY & PATHS ===', JSON.stringify(report.walkability));
assert.ok(
  report.walkability.walkableAreaM2 >= 4000,
  `walkableAreaM2 ${report.walkability.walkableAreaM2.toFixed(1)} < 4000`,
);
assert.ok(
  report.walkability.uniqueFootprintAreaM2 >= 4000,
  `uniqueFootprintAreaM2 ${report.walkability.uniqueFootprintAreaM2.toFixed(1)} < 4000`,
);
assert.equal(
  report.walkability.escapedEnclosureCount,
  0,
  `air-wall / enclosure leak: ${report.walkability.escapedEnclosureCount}`,
);
assert.ok(
  report.walkability.minReachableY >= -0.5,
  `reachable point below y=-0.5: ${report.walkability.minReachableY}`,
);
assert.ok(
  report.walkability.paths.spawnToBridgeSec <= 25,
  `spawn->bridge ${report.walkability.paths.spawnToBridgeSec.toFixed(2)}s > 25s`,
);
assert.ok(
  report.walkability.paths.bridgeToPlazaSec <= 25,
  `bridge->plaza ${report.walkability.paths.bridgeToPlazaSec.toFixed(2)}s > 25s`,
);
assert.ok(
  report.walkability.paths.plazaToTerraceTopSec <= 25,
  `plaza->terraceTop ${report.walkability.paths.plazaToTerraceTopSec.toFixed(2)}s > 25s`,
);
assert.ok(
  report.walkability.paths.spawnToPlazaSec <= 25,
  `spawn->plaza ${report.walkability.paths.spawnToPlazaSec.toFixed(2)}s > 25s`,
);

console.log('=== COLLISION 1:1 ===', JSON.stringify(report.collision1to1));
assert.equal(
  report.collision1to1.missingColliders.length,
  0,
  `missing colliders: ${report.collision1to1.missingColliders.join(', ')}`,
);
assert.equal(
  report.collision1to1.ghostColliders.length,
  0,
  `ghost colliders: ${report.collision1to1.ghostColliders.join(', ')}`,
);

console.log('=== RAYCAST STANDING ===', JSON.stringify(report.raycastStanding));
assert.equal(
  report.raycastStanding.failedSamples.length,
  0,
  `failed raycast samples: ${JSON.stringify(report.raycastStanding.failedSamples.slice(0, 5))}`,
);

console.log('=== KITBASH STATS ===', JSON.stringify(report.stats));
assert.ok(report.stats.spanX >= 120, `spanX ${report.stats.spanX.toFixed(1)} < 120`);
assert.ok(report.stats.spanZ >= 120, `spanZ ${report.stats.spanZ.toFixed(1)} < 120`);
assert.ok(report.stats.maxBridgeSlopeDeg <= 12, `bridge slope ${report.stats.maxBridgeSlopeDeg.toFixed(1)}° > 12°`);
assert.ok(report.stats.nonZeroRotationCount >= 15, `nonZeroRotationCount ${report.stats.nonZeroRotationCount} < 15`);
assert.ok(report.stats.nonUniformScaleCount >= 10, `nonUniformScaleCount ${report.stats.nonUniformScaleCount} < 10`);
assert.equal(report.stats.pillarStretchViolations, 0, 'pillars must not be stretched');
assert.equal(report.stats.balustradeStretchViolations, 0, 'balustrades must not be stretched');
assert.ok(
  report.stats.scatterDensityPerM2 >= 0.2 && report.stats.scatterDensityPerM2 <= 0.8,
  `scatter density ${report.stats.scatterDensityPerM2.toFixed(3)} out of 0.2..0.8`,
);

// ── Assertion 6: Mobile 390×844 Continuous 10s Walk Budget Check (calls <= 320, tris <= 420k, p95 <= 22ms) ──
await page.setViewportSize({ width: 390, height: 844 });
await S(() => {
  const od = window.__seer.oceanDeep;
  od.clearCamera();
  od.teleport(od.world.anchors.spawn.x, od.world.anchors.spawn.y, od.world.anchors.spawn.z, 2.75);
  od.setAutopilot({ moveX: 0, moveY: 1, run: false, camYaw: -0.22 });
});
// Wait for async robot GLB (Draco) load + first-frame WebGL shader compilation to complete before measuring steady-state walk
for (let i = 0; i < 40; i++) {
  const loaded = await S(() => window.__seer.robotView.source !== 'primitive');
  if (loaded) break;
  await page.waitForTimeout(300);
}
await waitFrames(5);
await S(() => {
  const od = window.__seer.oceanDeep;
  od.teleport(od.world.anchors.spawn.x, od.world.anchors.spawn.y, od.world.anchors.spawn.z, 2.75);
  od.walker.steps = 0;
  window.__frameExecMs = [];
  window.__rafDeltaMs = [];
});
const walkStart = Date.now();
while (true) {
  await page.waitForTimeout(500);
  const elapsed = Date.now() - walkStart;
  const count = await S(() => window.__frameExecMs?.length ?? 0);
  if (elapsed >= 10000 && (count >= 25 || elapsed >= 45000)) break;
}

const perf = await S(() => {
  window.__seer.oceanDeep.setAutopilot(null);
  const exec = [...(window.__frameExecMs ?? [])].sort((a, b) => a - b);
  const raf = [...(window.__rafDeltaMs ?? [])].sort((a, b) => a - b);
  const pct = (arr, q) => arr[Math.min(arr.length - 1, Math.floor(arr.length * q))] ?? 0;
  const info = window.__seer.info();
  const canvas = document.getElementById('game');
  const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
  const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
  const gpuRenderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  const w = window.__seer.oceanDeep.walker;
  return {
    gpuRenderer,
    isSwiftShader: /swiftshader/i.test(gpuRenderer),
    frames: exec.length,
    calls: info.calls,
    triangles: info.triangles,
    frameExecP50Ms: +pct(exec, 0.5).toFixed(2),
    frameExecP95Ms: +pct(exec, 0.95).toFixed(2),
    rafP50Ms: +pct(raf, 0.5).toFixed(2),
    rafP95Ms: +pct(raf, 0.95).toFixed(2),
    endPos: { x: +w.x.toFixed(2), y: +w.y.toFixed(2), z: +w.z.toFixed(2), steps: w.steps },
  };
});

console.log('=== MOBILE 390x844 10s WALK BUDGET ===', JSON.stringify(perf));
assert.ok(perf.frames >= 10, `too few frames measured (${perf.frames})`);
assert.ok(perf.endPos.steps >= 5, `robot did not walk during 10s test (steps=${perf.endPos.steps})`);
assert.ok(perf.calls <= 320, `draw calls ${perf.calls} > 320`);
assert.ok(perf.triangles <= 420000, `triangles ${perf.triangles} > 420000`);
assert.ok(perf.frameExecP95Ms <= 22, `p95 frame exec time ${perf.frameExecP95Ms}ms > 22ms`);
if (!perf.isSwiftShader) {
  assert.ok(perf.rafP95Ms <= 22, `p95 rAF interval ${perf.rafP95Ms}ms > 22ms`);
}

// ── Capture 6 Required Composition Screenshots (844x390 landscape matching measure-look) ──
await page.setViewportSize({ width: 844, height: 390 });
await waitFrames(2);
const shotList = [
  ['spires-front', 'ocean-deep-01-spires-front.png'],
  ['bridge-view', 'ocean-deep-02-bridge-view.png'],
  ['plaza-altar', 'ocean-deep-03-plaza-altar.png'],
  ['terrace-ruins', 'ocean-deep-04-terrace-ruins.png'],
  ['volumetric-godrays', 'ocean-deep-05-volumetric-godrays.png'],
  ['bridge-panorama', 'ocean-deep-06-bridge-panorama.png'],
];

const shotPaths = [];
for (const [preset, filename] of shotList) {
  const okPreset = await S((name) => window.__seer.oceanDeep.applyPreset(name), preset);
  assert.equal(okPreset, true, `preset ${preset} missing`);
  await waitFrames(2);
  let png = null;
  for (let attempt = 1; attempt <= 3 && !png; attempt++) {
    try {
      png = await page.screenshot({ timeout: 240000 });
    } catch (e) {
      if (attempt === 3) throw e;
      await page.waitForTimeout(1000);
    }
  }
  const out = path.join(SHOTS, filename);
  writeFileSync(out, png);
  shotPaths.push(path.relative(ROOT, out));
  console.log(`shot ok  ${filename}`);
}

// ── Assertion 7: Console 0, Page Errors 0, Failed Requests 0 ──
assert.deepEqual(pageErrors, [], `pageErrors: ${pageErrors.join('; ')}`);
assert.deepEqual(consoleErrors, [], `consoleErrors: ${consoleErrors.join('; ')}`);
assert.deepEqual(failedRequests, [], `failedRequests: ${failedRequests.join('; ')}`);

await browser.close();
console.log('SHOTS:', shotPaths.join(', '));
console.log('VERIFY OCEAN-DEEP OK');
process.exit(0);
