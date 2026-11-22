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
  "gas-storm": "\u98CE\u66B4\u6C26\u82AF",
  "red-giant": "\u7EA2\u5DE8\u661F\u7B49\u79BB\u5B50",
  binary: "\u53CC\u661F\u7B49\u79BB\u5B50",
  blackhole: "\u5F15\u529B\u6CE2\u6676",
  "ring-city": "\u73AF\u57CE\u901A\u884C\u5BC6\u94A5",
  magnetar: "\u8D85\u5BFC\u78C1\u6676",
  ocean: "\u91CD\u6C34\u6837\u672C",
  gas: "\u6C26\u6C14\u7F50",
  ice: "\u51B0\u6676",
  lava: "\u786B\u5316\u7269"
};
var RESOURCE_BY_ID = {
  kelos: "\u91CD\u6C34\u6837\u672C",
  helka: "\u6C26\u6C14\u7F50",
  seron: "\u51B0\u6676",
  volc: "\u786B\u5316\u7269",
  icer: "\u6C26-3 \u51B0\u82AF",
  "gas-storm": "\u98CE\u66B4\u6C26\u82AF",
  "red-giant": "\u7EA2\u5DE8\u661F\u7B49\u79BB\u5B50",
  binary: "\u53CC\u661F\u7B49\u79BB\u5B50",
  blackhole: "\u5F15\u529B\u6CE2\u6676",
  "ring-city": "\u73AF\u57CE\u901A\u884C\u5BC6\u94A5",
  magnetar: "\u8D85\u5BFC\u78C1\u6676"
};
var LOG_BY_ID = {
  kelos: "\u5168\u7403\u6D77\u6D0B\u8986\u76D6\uFF0C\u6DF1\u5C42\u6D0B\u6D41\u4E2D\u5BCC\u542B\u91CD\u6C34\uFF0C\u91C7\u6837\u6570\u636E\u7A33\u5B9A\u3002",
  helka: "\u9AD8\u5C42\u5927\u6C14\u6C26\u6D53\u5EA6\u504F\u9AD8\uFF0C\u98CE\u5E26\u6E4D\u6025\u4F46\u91C7\u96C6\u7A97\u53E3\u5145\u8DB3\u3002",
  seron: "\u6781\u51A0\u51B0\u5C42\u7EAF\u51C0\u900F\u4EAE\uFF0C\u51B0\u6676\u6676\u683C\u5B8C\u6574\uFF0C\u9002\u5408\u957F\u671F\u5C01\u5B58\u3002",
  volc: "\u5CA9\u6D46\u6D3B\u52A8\u9891\u7E41\uFF0C\u55B7\u53E3\u5468\u8FB9\u5BCC\u96C6\u786B\u5316\u7269\u7ED3\u6676\u4FE1\u53F7\u3002",
  icer: "\u73AF\u5E26\u51B0\u7C92\u7EAF\u51C0\uFF0C\u82AF\u90E8\u6C26-3\u4E30\u5EA6\u6781\u9AD8\uFF0C\u5361\u897F\u5C3C\u7F1D\u8FB9\u7F18\u7ED3\u6676\u5B8C\u6574\u3002",
  "gas-storm": "\u5DE8\u578B\u53CD\u6C14\u65CB\u98CE\u66B4\u773C\u6301\u7EED\u65CB\u8F6C\uFF0C\u8F68\u9053\u60AC\u6D6E\u91C7\u96C6\u7AD9\u6B63\u4ECE\u4E91\u5E26\u62BD\u53D6\u9AD8\u7EAF\u6C26\u82AF\u3002",
  "red-giant": "\u7EA2\u5DE8\u661F\u65E5\u5195\u8000\u6591\u5267\u70C8\u7FFB\u6D8C\uFF0C\u5F3A\u8F90\u5C04\u7A7F\u900F\u539A\u91CD\u5C18\u57C3\u5E55\uFF0C\u9AD8\u6E29\u7B49\u79BB\u5B50\u4FE1\u53F7\u5145\u76C8\u661F\u57DF\u3002",
  binary: "\u53CC\u661F\u51B7\u767D\u4E0E\u6696\u6A59\u53CC\u8272\u6E29\u8F90\u5C04\u5728\u6B64\u4EA4\u6C47\uFF0C\u6668\u660F\u73AF\u5E26\u9AD8\u80FD\u5377\u4E91\u7FFB\u6D8C\uFF0C\u5F3A\u5149\u5B50\u573A\u6301\u7EED\u4E3A\u98DE\u8239\u63A8\u8FDB\u5668\u63D0\u4F9B\u7A33\u5B9A\u56DE\u5145\u589E\u76CA\u3002",
  blackhole: "\u5F25\u591C\u4E8B\u4EF6\u89C6\u754C\u5916\u4FA7\u767D\u70ED\u5149\u5B50\u73AF\u6E05\u6670\u53EF\u8FA8\uFF0C\u9AD8\u901F\u65CB\u8F6C\u7684\u5438\u79EF\u76D8\u56E0\u591A\u666E\u52D2\u6548\u5E94\u5448\u73B0\u84DD\u767D\u4E0E\u6697\u7EA2\u4E0D\u5BF9\u79F0\u5149\u5E26\uFF0C\u5F3A\u6F6E\u6C50\u529B\u573A\u5DF2\u5F15\u53D1\u663E\u8457\u65F6\u95F4\u81A8\u80C0\u6548\u5E94\u3002",
  "ring-city": "\u62FE\u5149\u73AF\u57CE\u7531\u7CBE\u5BC6\u53CC\u5C42\u91D1\u5C5E\u505C\u9760\u73AF\u6784\u7B51\u800C\u6210\uFF0C\u73AF\u5468\u7A97\u5149\u6392\u5E03\u4E25\u8C28\u6709\u5E8F\u4E14\u660E\u6697\u9519\u843D\uFF0C\u56DB\u5EA7\u5BF9\u7F6E\u505C\u9760\u5854\u6807\u793A\u51FA\u9AD8\u80FD\u8865\u7ED9\u7AD9\u4F4D\uFF0C\u73AF\u57CE\u822A\u9053\u4FE1\u6807\u6301\u7EED\u4E3A\u8FC7\u5F80\u98DE\u8239\u63D0\u4F9B\u7A33\u5B9A\u56DE\u5145\u589E\u76CA\u3002",
  magnetar: "\u5C9A\u5F27\u78C1\u661F\u9AD8\u5BC6\u91D1\u5C5E\u5730\u58F3\u5E03\u6EE1\u9752\u7FE0\u78C1\u9707\u88C2\u7EB9\uFF0C\u53CC\u6781\u5076\u6781\u78C1\u529B\u7EBF\u5F27\u643A\u9AD8\u80FD\u7B49\u79BB\u5B50\u8109\u51B2\u6A2A\u8DE8\u661F\u57DF\uFF0C\u5F3A\u78C1\u66B4\u573A\u6301\u7EED\u5F15\u53D1\u611F\u5E94\u5E72\u6270\uFF0C\u6781\u51A0\u8282\u70B9\u6790\u51FA\u9AD8\u7EAF\u8D85\u5BFC\u78C1\u6676\u3002"
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
  gravity: { energyMul: 0.8, warn: "\u5F3A\u5F15\u529B\xB7\u6CE8\u610F\u8DDD\u79BB" },
  photon: { energyMul: 1.3, warn: "\u53CC\u661F\u5149\u5B50\u573A\xB7\u56DE\u5145 \xD71.3" },
  tidal: { energyMul: 0.7, warn: "\u6F6E\u6C50\u529B\u573A\xB7\u56DE\u5145 \xD70.7" },
  traffic: { energyMul: 1.15, warn: "\u73AF\u57CE\u822A\u9053\xB7\u56DE\u5145 \xD71.15" },
  // Alternating magnetospheric flux induces eddy-current drag on thruster capacitors (25% slower recharge, cyan warning)
  magnetic: { energyMul: 0.75, warn: "\u5F3A\u78C1\u66B4\u573A\xB7\u56DE\u5145 \xD70.75" }
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
  { id: "volc", name: "\u706B\u5C71\u661F", pos: { x: 330, y: -150, z: 700 }, radius: 95, hazard: "radiation", colors: [4198938, 12728862, 16761418], atmosphere: 16738890, kind: "lava", seed: 41 },
  { id: "icer", name: "\u51B0\u73AF\u5E26", pos: { x: -80, y: 120, z: -1180 }, radius: 120, hazard: "cold", colors: [9425138, 15267839, 16777215], atmosphere: 10479359, kind: "ice-ring", seed: 53 },
  { id: "gas-storm", name: "\u6C14\u6001\u5DE8\u884C\u661F", pos: { x: 620, y: 60, z: 780 }, radius: 145, hazard: "gravity", colors: [5909012, 12876346, 16770744], atmosphere: 16760954, kind: "gas-storm", seed: 67 },
  { id: "red-giant", name: "\u7EA2\u5DE8\u661F\u7CFB", pos: { x: -480, y: 160, z: 1020 }, radius: 280, hazard: "radiation", colors: [8002574, 15885337, 16773840], atmosphere: 16745528, kind: "red-giant", seed: 89 },
  { id: "binary", name: "\u53CC\u5B50\u661F\u57DF", pos: { x: 1100, y: -30, z: -520 }, radius: 135, hazard: "photon", colors: [3833813, 15764538, 15923199], atmosphere: 14280959, kind: "binary", seed: 97 },
  { id: "blackhole", name: "\u9ED1\u6D1E\u8FB9\u7F18 \xB7 \u5F25\u591C", pos: { x: -1080, y: 110, z: -520 }, radius: 105, hazard: "tidal", colors: [1838390, 9133302, 16052479], atmosphere: 12163327, kind: "blackhole", seed: 113 },
  { id: "ring-city", name: "\u73AF\u5F62\u57CE\u5E02 \xB7 \u62FE\u5149", pos: { x: 260, y: -150, z: -1330 }, radius: 130, hazard: "traffic", colors: [1317412, 16757860, 15398143], atmosphere: 10475775, kind: "ring-city", seed: 131 },
  // 磁暴星域 · 岚弧: deep magnetized indigo-slate iron crust + vivid emerald-teal fissures & mint-cyan dipole plasma arcs
  // (emerald-teal primary palette is visually distinct from all 6 prior worlds: ice-blue, orange-red, ochre, blue/orange, violet/gold, steel/amber)
  { id: "magnetar", name: "\u78C1\u66B4\u661F\u57DF \xB7 \u5C9A\u5F27", pos: { x: -720, y: -120, z: -1020 }, radius: 100, hazard: "magnetic", colors: [1254973, 1632440, 12124144], atmosphere: 2683596, kind: "magnetar", seed: 149 }
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
  assert.equal(hazardEffect("photon").energyMul, 1.3);
  assert.equal(hazardEffect("photon").warn, "\u53CC\u661F\u5149\u5B50\u573A\xB7\u56DE\u5145 \xD71.3");
  assert.equal(hazardEffect("tidal").energyMul, 0.7);
  assert.equal(hazardEffect("tidal").warn, "\u6F6E\u6C50\u529B\u573A\xB7\u56DE\u5145 \xD70.7");
  assert.equal(hazardEffect("traffic").energyMul, 1.15);
  assert.equal(hazardEffect("traffic").warn, "\u73AF\u57CE\u822A\u9053\xB7\u56DE\u5145 \xD71.15");
  assert.equal(hazardEffect("magnetic").energyMul, 0.75);
  assert.equal(hazardEffect("magnetic").warn, "\u5F3A\u78C1\u66B4\u573A\xB7\u56DE\u5145 \xD70.75");
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
  assert.equal(planetById("icer").hazard, "cold");
  assert.equal(planetById("gas-storm").hazard, "gravity");
  assert.equal(planetById("red-giant").hazard, "radiation");
  assert.equal(planetById("binary").hazard, "photon");
  assert.equal(planetById("blackhole").hazard, "tidal");
  assert.equal(planetById("ring-city").hazard, "traffic");
  assert.equal(planetById("magnetar").hazard, "magnetic");
  assert.equal(scanResult("icer").resource, "\u6C26-3 \u51B0\u82AF");
  assert.equal(scanResult("gas-storm").resource, "\u98CE\u66B4\u6C26\u82AF");
  assert.equal(scanResult("red-giant").resource, "\u7EA2\u5DE8\u661F\u7B49\u79BB\u5B50");
  const binRes = scanResult("binary");
  assert.equal(binRes.resource, "\u53CC\u661F\u7B49\u79BB\u5B50");
  assert.ok([...binRes.log].length >= 40 && binRes.log[0] !== " ");
  const bhRes = scanResult("blackhole");
  assert.equal(bhRes.resource, "\u5F15\u529B\u6CE2\u6676");
  assert.ok([...bhRes.log].length >= 40 && /吸积盘/.test(bhRes.log) && /时间膨胀/.test(bhRes.log) && /光子环/.test(bhRes.log));
  const rcRes = scanResult("ring-city");
  assert.equal(rcRes.resource, "\u73AF\u57CE\u901A\u884C\u5BC6\u94A5");
  assert.ok([...rcRes.log].length >= 40 && /停靠环/.test(rcRes.log) && /窗光排布/.test(rcRes.log) && /补给站位/.test(rcRes.log));
  const magRes = scanResult("magnetar");
  assert.equal(magRes.resource, "\u8D85\u5BFC\u78C1\u6676");
  assert.ok([...magRes.log].length >= 40 && /磁力线弧/.test(magRes.log) && /强磁暴/.test(magRes.log) && /超导磁晶/.test(magRes.log));
  assert.ok(PLANETS.length === TARGETS.length);
});
