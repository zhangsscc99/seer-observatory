// src/game/space.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/scan.ts
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
  blackhole: "\u5F15\u529B\u6CE2\u6676"
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
  blackhole: "\u5F25\u591C\u4E8B\u4EF6\u89C6\u754C\u5916\u4FA7\u767D\u70ED\u5149\u5B50\u73AF\u6E05\u6670\u53EF\u8FA8\uFF0C\u9AD8\u901F\u65CB\u8F6C\u7684\u5438\u79EF\u76D8\u56E0\u591A\u666E\u52D2\u6548\u5E94\u5448\u73B0\u84DD\u767D\u4E0E\u6697\u7EA2\u4E0D\u5BF9\u79F0\u5149\u5E26\uFF0C\u5F3A\u6F6E\u6C50\u529B\u573A\u5DF2\u5F15\u53D1\u663E\u8457\u65F6\u95F4\u81A8\u80C0\u6548\u5E94\u3002"
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
  tidal: { energyMul: 0.7, warn: "\u6F6E\u6C50\u529B\u573A\xB7\u56DE\u5145 \xD70.7" }
};
function hazardEffect(h) {
  if (!h) return { energyMul: 1, warn: null };
  const e = HAZARDS[h];
  return { energyMul: e.energyMul, warn: e.warn };
}

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
  { id: "blackhole", name: "\u9ED1\u6D1E\u8FB9\u7F18 \xB7 \u5F25\u591C", pos: { x: -1080, y: 110, z: -520 }, radius: 105, hazard: "tidal", colors: [1838390, 9133302, 16052479], atmosphere: 12163327, kind: "blackhole", seed: 113 }
];
var BINARY_STARS = [
  { id: "binary-a", name: "\u53CC\u5B50\u4E3B\u661F\xB7\u51B7\u767D", pos: { x: 380, y: 560, z: -1960 }, radius: 88, color: 12574975, intensity: 2.2 },
  { id: "binary-b", name: "\u53CC\u5B50\u4F34\u661F\xB7\u6696\u6A59", pos: { x: 1460, y: -480, z: -1760 }, radius: 70, color: 16756838, intensity: 1.5 }
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
var SECTOR_RADIUS = 1500;

// src/game/space.test.ts
test("every target id resolves and the target list covers the sector", () => {
  for (const id of TARGETS) assert.ok(planetById(id), id);
  assert.equal(TARGETS.length, PLANETS.length);
});
test("hazards follow the sector design table", () => {
  assert.equal(planetById("kelos").hazard, void 0);
  assert.equal(planetById("helka").hazard, "wind");
  assert.equal(planetById("seron").hazard, "cold");
  assert.equal(planetById("volc").hazard, "radiation");
  assert.equal(planetById("icer").hazard, "cold");
  assert.equal(planetById("gas-storm").hazard, "gravity");
  assert.equal(planetById("red-giant").hazard, "radiation");
  assert.equal(planetById("binary").hazard, "photon");
  assert.equal(planetById("blackhole").hazard, "tidal");
});
test("icer: ice-ring planet registered and scannable", () => {
  const p = planetById("icer");
  assert.ok(p);
  assert.equal(p.kind, "ice-ring");
  assert.equal(p.hazard, "cold");
  assert.ok(TARGETS.includes("icer"));
  assert.equal(TARGETS.filter((id) => id === "icer").length, 1);
});
test("gas-storm: gas-storm planet registered and scannable", () => {
  const p = planetById("gas-storm");
  assert.ok(p);
  assert.equal(p.kind, "gas-storm");
  assert.equal(p.hazard, "gravity");
  assert.ok(TARGETS.includes("gas-storm"));
  assert.equal(TARGETS.filter((id) => id === "gas-storm").length, 1);
  const res = scanResult("gas-storm");
  assert.equal(res.resource, "\u98CE\u66B4\u6C26\u82AF");
  assert.ok(res.amount >= 3 && res.amount <= 7, `amount ${res.amount}`);
  const len = [...res.log].length;
  assert.ok(len >= 20 && len <= 40, `log length ${len}`);
});
test("red-giant: red-giant star registered, largest body, scannable with radiation warn", () => {
  const p = planetById("red-giant");
  assert.ok(p);
  assert.equal(p.kind, "red-giant");
  assert.equal(p.hazard, "radiation");
  assert.ok(TARGETS.includes("red-giant"));
  assert.equal(TARGETS.filter((id) => id === "red-giant").length, 1);
  for (const other of PLANETS) {
    if (other.id !== "red-giant") assert.ok(p.radius > other.radius, `red-giant r=${p.radius} > ${other.id} r=${other.radius}`);
  }
  const res = scanResult("red-giant");
  assert.equal(res.resource, "\u7EA2\u5DE8\u661F\u7B49\u79BB\u5B50");
  assert.ok(res.amount >= 3 && res.amount <= 7, `amount ${res.amount}`);
  const len = [...res.log].length;
  assert.ok(len >= 20 && len <= 40, `log length ${len}`);
  assert.match(res.log, /辐射/);
  assert.match(res.log, /日冕/);
  assert.match(res.log, /尘埃幕/);
  const eff = hazardEffect(p.hazard);
  assert.ok(eff.warn && eff.warn.length > 0);
  assert.equal(eff.warn, "\u5F3A\u8F90\u5C04\xB7\u62A4\u76FE\u8B66\u62A5");
});
test("binary: binary system registered, scannable, photon hazard and twin stars valid", () => {
  const p = planetById("binary");
  assert.ok(p);
  assert.equal(p.kind, "binary");
  assert.equal(p.hazard, "photon");
  assert.ok(TARGETS.includes("binary"));
  assert.equal(TARGETS.filter((id) => id === "binary").length, 1);
  const res = scanResult("binary");
  assert.equal(res.resource, "\u53CC\u661F\u7B49\u79BB\u5B50");
  assert.ok(res.amount >= 3 && res.amount <= 7, `amount ${res.amount}`);
  const len = [...res.log].length;
  assert.ok(len >= 40, `log length ${len} < 40`);
  assert.notEqual(res.log[0], " ");
  const eff = hazardEffect(p.hazard);
  assert.equal(eff.energyMul, 1.3);
  assert.equal(eff.warn, "\u53CC\u661F\u5149\u5B50\u573A\xB7\u56DE\u5145 \xD71.3");
  for (const other of PLANETS) {
    if (other.id === "binary") continue;
    const d = Math.hypot(p.pos.x - other.pos.x, p.pos.y - other.pos.y, p.pos.z - other.pos.z);
    assert.ok(d > p.radius + other.radius + 100, `binary vs ${other.id}: ${d.toFixed(1)} <= ${p.radius + other.radius + 100}`);
  }
  assert.equal(BINARY_STARS.length, 2);
  assert.notEqual(BINARY_STARS[0].color, BINARY_STARS[1].color);
  for (const s of BINARY_STARS) {
    const dist = Math.hypot(s.pos.x, s.pos.y, s.pos.z);
    assert.ok(dist >= 1500 && dist <= 2600, `${s.id} dist ${dist.toFixed(1)}`);
    assert.ok(s.radius > 0 && s.intensity > 0);
  }
});
test("blackhole: registered, non-overlapping, tidal hazard, and scan log valid", () => {
  const p = planetById("blackhole");
  assert.ok(p);
  assert.equal(p.kind, "blackhole");
  assert.equal(p.hazard, "tidal");
  assert.ok(p.radius >= 90 && p.radius <= 120, `radius ${p.radius}`);
  assert.ok(TARGETS.includes("blackhole"));
  assert.equal(TARGETS.filter((id) => id === "blackhole").length, 1);
  const res = scanResult("blackhole");
  assert.equal(res.resource, "\u5F15\u529B\u6CE2\u6676");
  assert.ok(res.amount >= 3 && res.amount <= 7, `amount ${res.amount}`);
  const len = [...res.log].length;
  assert.ok(len >= 40, `log length ${len} < 40`);
  assert.match(res.log, /吸积盘/);
  assert.match(res.log, /时间膨胀/);
  assert.match(res.log, /光子环/);
  const eff = hazardEffect(p.hazard);
  assert.equal(eff.energyMul, 0.7);
  assert.equal(eff.warn, "\u6F6E\u6C50\u529B\u573A\xB7\u56DE\u5145 \xD70.7");
  for (const other of PLANETS) {
    if (other.id === "blackhole") continue;
    const d = Math.hypot(p.pos.x - other.pos.x, p.pos.y - other.pos.y, p.pos.z - other.pos.z);
    assert.ok(d > p.radius + other.radius + 100, `blackhole vs ${other.id}: ${d.toFixed(1)} <= ${p.radius + other.radius + 100}`);
  }
});
test("planet bounding spheres never overlap", () => {
  for (let i = 0; i < PLANETS.length; i++) {
    for (let j = i + 1; j < PLANETS.length; j++) {
      const a = PLANETS[i];
      const b = PLANETS[j];
      const d = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z);
      assert.ok(d > a.radius + b.radius, `${a.id} vs ${b.id}: ${d.toFixed(1)} <= ${a.radius + b.radius}`);
    }
  }
});
test("every planet sits inside the sector radius", () => {
  for (const p of PLANETS) {
    const d = Math.hypot(p.pos.x, p.pos.y, p.pos.z);
    assert.ok(d <= SECTOR_RADIUS, `${p.id} at ${d.toFixed(1)} > ${SECTOR_RADIUS}`);
  }
});
