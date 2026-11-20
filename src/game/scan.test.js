// src/game/scan.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/scan.ts
var SCAN = {
  /** engage distance = planet radius × this */
  rangeFactor: 3.2,
  /** seconds of holding `act` to finish a scan */
  duration: 4.2,
  /** progress lost per second while released / out of range */
  decay: 0.35
};
function withinScan(dist, radius) {
  return dist <= radius * SCAN.rangeFactor;
}
function hashId(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
var RESOURCE_BY_KIND = {
  "ice-ring": "\u6C26-3 \u51B0\u82AF",
  ocean: "\u91CD\u6C34\u6837\u672C",
  gas: "\u6C26\u6C14\u7F50",
  ice: "\u51B0\u6676",
  lava: "\u786B\u5316\u7269"
};
var RESOURCE_BY_ID = {
  kelos: "\u91CD\u6C34\u6837\u672C",
  helka: "\u6C26\u6C14\u7F50",
  seron: "\u51B0\u6676",
  volc: "\u786B\u5316\u7269"
};
var LOG_BY_ID = {
  kelos: "\u5168\u7403\u6D77\u6D0B\u8986\u76D6\uFF0C\u6DF1\u5C42\u6D0B\u6D41\u4E2D\u5BCC\u542B\u91CD\u6C34\uFF0C\u91C7\u6837\u6570\u636E\u7A33\u5B9A\u3002",
  helka: "\u9AD8\u5C42\u5927\u6C14\u6C26\u6D53\u5EA6\u504F\u9AD8\uFF0C\u98CE\u5E26\u6E4D\u6025\u4F46\u91C7\u96C6\u7A97\u53E3\u5145\u8DB3\u3002",
  seron: "\u6781\u51A0\u51B0\u5C42\u7EAF\u51C0\u900F\u4EAE\uFF0C\u51B0\u6676\u6676\u683C\u5B8C\u6574\uFF0C\u9002\u5408\u957F\u671F\u5C01\u5B58\u3002",
  volc: "\u5CA9\u6D46\u6D3B\u52A8\u9891\u7E41\uFF0C\u55B7\u53E3\u5468\u8FB9\u5BCC\u96C6\u786B\u5316\u7269\u7ED3\u6676\u4FE1\u53F7\u3002"
};
var GENERIC_LOGS = [
  "\u5149\u8C31\u626B\u63CF\u5B8C\u6210\uFF0C\u8868\u5C42\u6210\u5206\u4E0E\u8F90\u5C04\u6C34\u5E73\u5DF2\u8BB0\u5165\u6863\u6848\u3002",
  "\u8FDC\u8DDD\u79BB\u89C2\u6D4B\u7ED3\u675F\uFF0C\u8F68\u9053\u53C2\u6570\u4E0E\u8D28\u91CF\u4F30\u7B97\u5DF2\u5F52\u6863\u3002",
  "\u626B\u63CF\u6CE2\u675F\u56DE\u6CE2\u6E05\u6670\uFF0C\u77FF\u7269\u5206\u5E03\u56FE\u8C31\u4FDD\u5B58\u5B8C\u6BD5\u3002"
];
function scanResult(id) {
  const kinds = Object.keys(RESOURCE_BY_KIND);
  const resource = RESOURCE_BY_ID[id] ?? RESOURCE_BY_KIND[kinds[hashId(id) % kinds.length]];
  return {
    resource,
    amount: 3 + hashId(id) % 5,
    log: LOG_BY_ID[id] ?? GENERIC_LOGS[hashId(id) % GENERIC_LOGS.length]
  };
}
var HAZARDS = {
  cold: { energyMul: 0.55, warn: "\u4F4E\u6E29\xB7\u63A8\u8FDB\u5668\u6548\u7387\u4E0B\u964D" },
  radiation: { energyMul: 1, warn: "\u5F3A\u8F90\u5C04\xB7\u62A4\u76FE\u8B66\u62A5" },
  wind: { energyMul: 1, warn: "\u6C14\u6D41\xB7\u822A\u5411\u6F02\u79FB" },
  gravity: { energyMul: 0.8, warn: "\u5F3A\u5F15\u529B\xB7\u6CE8\u610F\u8DDD\u79BB" }
};
function hazardEffect(h) {
  if (!h) return { energyMul: 1, warn: null };
  const e = HAZARDS[h];
  return { energyMul: e.energyMul, warn: e.warn };
}
var Scanner = class {
  /** engaged target id (kept while out of range so progress can resume) */
  id = null;
  progress = 0;
  done = false;
  /**
   * @param near  the in-range target this frame (null when none)
   * @param holding  interaction key held
   */
  update(dt, near, holding) {
    const ev = [];
    if (near && near.id !== this.id) {
      if (this.id !== null) ev.push({ type: "leave", id: this.id });
      this.id = near.id;
      this.progress = 0;
      this.done = false;
      ev.push({ type: "enter", id: near.id });
    }
    if (this.id === null || this.done) return ev;
    const before = this.progress;
    if (near && holding) this.progress = Math.min(1, this.progress + dt / SCAN.duration);
    else this.progress = Math.max(0, this.progress - SCAN.decay * dt);
    if (this.progress !== before) ev.push({ type: "progress", id: this.id, progress: this.progress });
    if (this.progress >= 1) {
      this.done = true;
      ev.push({ type: "complete", id: this.id, ...scanResult(this.id) });
    }
    return ev;
  }
};

// src/game/space.ts
var PLANETS = [
  { id: "kelos", name: "\u514B\u6D1B\u65AF\u661F", pos: { x: -260, y: 40, z: -620 }, radius: 150, colors: [735882, 2068330, 14677759], atmosphere: 6473983, kind: "ocean", seed: 11 },
  { id: "helka", name: "\u8D6B\u5C14\u5361\u661F", pos: { x: 640, y: 130, z: -260 }, radius: 110, hazard: "wind", colors: [5909130, 14185516, 16769704], atmosphere: 16754782, kind: "gas", seed: 23 },
  { id: "seron", name: "\u585E\u897F\u5229\u4E9A\u661F", pos: { x: -560, y: -60, z: 330 }, radius: 80, hazard: "cold", colors: [8370408, 13626111, 16777215], atmosphere: 11071743, kind: "ice", seed: 37 },
  { id: "volc", name: "\u706B\u5C71\u661F", pos: { x: 330, y: -150, z: 700 }, radius: 95, hazard: "radiation", colors: [4198938, 12728862, 16761418], atmosphere: 16738890, kind: "lava", seed: 41 }
];
function planetById(id) {
  return PLANETS.find((p) => p.id === id);
}
var TARGETS = PLANETS.map((p) => p.id);
var SUN_DIR = (() => {
  const v = { x: 0.55, y: 0.5, z: -0.67 };
  const l = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
})();

// src/game/scan.test.ts
var DT = 0.1;
var tgt = (id, radius = 100) => ({ id, name: id, radius });
var types = (evs) => evs.map((e) => e.type);
test("out of range \u2192 no events; entering range fires enter exactly once", () => {
  const s = new Scanner();
  assert.deepEqual(s.update(DT, null, true), []);
  assert.deepEqual(s.update(DT, null, false), []);
  const t = tgt("kelos");
  assert.deepEqual(types(s.update(DT, t, false)), ["enter"]);
  assert.equal(s.update(DT, t, false).filter((e) => e.type === "enter").length, 0);
});
test("range rule: dist <= radius \xD7 rangeFactor", () => {
  assert.equal(withinScan(100 * SCAN.rangeFactor, 100), true);
  assert.equal(withinScan(100 * SCAN.rangeFactor + 0.01, 100), false);
});
test("holding ~4.2 s of dt slices completes once, then never again", () => {
  const s = new Scanner();
  const t = tgt("kelos");
  s.update(DT, t, false);
  let completes = 0;
  for (let i = 0; i < 60; i++) {
    for (const e of s.update(DT, t, true)) if (e.type === "complete") completes++;
  }
  assert.equal(completes, 1);
  assert.equal(s.progress, 1);
  assert.equal(s.done, true);
  assert.deepEqual(s.update(DT, t, true), []);
});
test("release decays but never resets; re-holding resumes from there", () => {
  const s = new Scanner();
  const t = tgt("seron");
  s.update(DT, t, false);
  for (let i = 0; i < 20; i++) s.update(DT, t, true);
  const held = s.progress;
  assert.ok(held > 0.3 && held < 0.6, `progress ${held}`);
  for (let i = 0; i < 3; i++) s.update(DT, t, false);
  const decayed = s.progress;
  assert.ok(decayed > 0 && decayed < held, `decayed ${decayed} < ${held}`);
  s.update(DT, t, true);
  assert.ok(s.progress > decayed);
  s.update(DT, null, false);
  const p = s.progress;
  s.update(DT, t, false);
  assert.equal(s.id, "seron");
  assert.ok(s.progress <= p + 1e-9);
});
test("switching targets emits leave first, resets progress to 0", () => {
  const s = new Scanner();
  s.update(DT, tgt("kelos"), false);
  for (let i = 0; i < 20; i++) s.update(DT, tgt("kelos"), true);
  const evs = s.update(DT, tgt("helka"), true);
  assert.equal(evs[0].type, "leave");
  assert.equal(evs[0].id, "kelos");
  assert.equal(evs[1].type, "enter");
  assert.equal(evs[1].id, "helka");
  assert.ok(s.progress < 0.05, `fresh progress ${s.progress}`);
});
test("scanResult is stable per id and from the fixed table", () => {
  const a = scanResult("kelos");
  assert.deepEqual(a, scanResult("kelos"));
  assert.equal(a.resource, "\u91CD\u6C34\u6837\u672C");
  assert.equal(scanResult("helka").resource, "\u6C26\u6C14\u7F50");
  assert.equal(scanResult("seron").resource, "\u51B0\u6676");
  assert.equal(scanResult("volc").resource, "\u786B\u5316\u7269");
  assert.ok(a.amount >= 3 && a.amount <= 7);
  const len = [...a.log].length;
  assert.ok(len >= 20 && len <= 40, `log length ${len}`);
  const u = scanResult("rogue-1");
  assert.ok(u.resource.length > 0 && u.amount >= 3 && u.amount <= 7);
});
test("hazardEffect: cold cuts energy regen; no hazard \u2192 neutral", () => {
  assert.ok(hazardEffect("cold").energyMul < 1);
  assert.equal(hazardEffect("cold").warn, "\u4F4E\u6E29\xB7\u63A8\u8FDB\u5668\u6548\u7387\u4E0B\u964D");
  assert.equal(hazardEffect("radiation").warn, "\u5F3A\u8F90\u5C04\xB7\u62A4\u76FE\u8B66\u62A5");
  assert.equal(hazardEffect("wind").warn, "\u6C14\u6D41\xB7\u822A\u5411\u6F02\u79FB");
  assert.equal(hazardEffect("gravity").warn, "\u5F3A\u5F15\u529B\xB7\u6CE8\u610F\u8DDD\u79BB");
  const none = hazardEffect(void 0);
  assert.equal(none.energyMul, 1);
  assert.equal(none.warn, null);
});
test("sector data: every TARGET resolves, hazards assigned per design", () => {
  for (const id of TARGETS) assert.ok(planetById(id), id);
  assert.equal(planetById("kelos").hazard, void 0);
  assert.equal(planetById("helka").hazard, "wind");
  assert.equal(planetById("seron").hazard, "cold");
  assert.equal(planetById("volc").hazard, "radiation");
  assert.ok(PLANETS.length === TARGETS.length);
});
