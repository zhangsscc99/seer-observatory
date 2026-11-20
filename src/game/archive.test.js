// src/game/archive.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/archive.ts
function emptyArchive() {
  return { scans: {}, resources: {} };
}
function addScan(a, t, now) {
  const prev = a.scans[t.id];
  const entry = prev ? { ...prev, name: t.name, resource: t.resource, amount: t.amount, scans: prev.scans + 1, last: now } : { id: t.id, name: t.name, scans: 1, last: now, resource: t.resource, amount: t.amount };
  return {
    scans: { ...a.scans, [t.id]: entry },
    resources: { ...a.resources, [t.resource]: (a.resources[t.resource] ?? 0) + t.amount }
  };
}
var str = (v) => typeof v === "string" ? v : "";
var num = (v) => typeof v === "number" && Number.isFinite(v) ? v : 0;
function parseArchive(raw) {
  if (raw === null) return emptyArchive();
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object") return emptyArchive();
    const o = v;
    if (!o.scans || typeof o.scans !== "object" || !o.resources || typeof o.resources !== "object") {
      return emptyArchive();
    }
    const out = emptyArchive();
    for (const [k, e] of Object.entries(o.scans)) {
      if (!e || typeof e !== "object") continue;
      const en = e;
      out.scans[k] = {
        id: str(en.id) || k,
        name: str(en.name),
        scans: num(en.scans),
        last: num(en.last),
        resource: str(en.resource),
        amount: num(en.amount)
      };
    }
    for (const [k, n] of Object.entries(o.resources)) {
      out.resources[k] = num(n);
    }
    return out;
  } catch {
    return emptyArchive();
  }
}
function serializeArchive(a) {
  return JSON.stringify(a);
}
function totalScans(a) {
  let n = 0;
  for (const e of Object.values(a.scans)) n += e.scans;
  return n;
}

// src/game/archive.test.ts
var kelos = { id: "kelos", name: "\u514B\u6D1B\u65AF\u661F", resource: "\u91CD\u6C34\u6837\u672C", amount: 5 };
test("addScan accumulates scan counts and resource totals immutably", () => {
  const a0 = emptyArchive();
  const a1 = addScan(a0, kelos, 1e3);
  assert.equal(a1.scans.kelos.scans, 1);
  assert.equal(a1.scans.kelos.name, "\u514B\u6D1B\u65AF\u661F");
  assert.equal(a1.scans.kelos.last, 1e3);
  assert.equal(a1.resources["\u91CD\u6C34\u6837\u672C"], 5);
  assert.equal(totalScans(a1), 1);
  const a2 = addScan(a1, kelos, 2e3);
  assert.equal(a2.scans.kelos.scans, 2);
  assert.equal(a2.scans.kelos.last, 2e3);
  assert.equal(a2.resources["\u91CD\u6C34\u6837\u672C"], 10);
  const a3 = addScan(a2, { id: "volc", name: "\u706B\u5C71\u661F", resource: "\u786B\u5316\u7269", amount: 4 }, 3e3);
  assert.equal(totalScans(a3), 3);
  assert.equal(a3.resources["\u786B\u5316\u7269"], 4);
  assert.equal(a0.scans.kelos, void 0);
  assert.equal(a1.scans.kelos.scans, 1);
});
test("parseArchive never throws: bad JSON / missing fields \u2192 empty archive", () => {
  assert.deepEqual(parseArchive("not json"), emptyArchive());
  assert.deepEqual(parseArchive(null), emptyArchive());
  assert.deepEqual(parseArchive("42"), emptyArchive());
  assert.deepEqual(parseArchive('"str"'), emptyArchive());
  assert.deepEqual(parseArchive('{"scans":{}}'), emptyArchive());
  assert.deepEqual(parseArchive('{"resources":{}}'), emptyArchive());
  assert.deepEqual(parseArchive("[]"), emptyArchive());
});
test("serialize \u2192 parse round-trips", () => {
  let a = emptyArchive();
  a = addScan(a, kelos, 111);
  a = addScan(a, { id: "seron", name: "\u585E\u897F\u5229\u4E9A\u661F", resource: "\u51B0\u6676", amount: 6 }, 222);
  assert.deepEqual(parseArchive(serializeArchive(a)), a);
});
test("parseArchive sanitises malformed entries without throwing", () => {
  const a = parseArchive('{"scans":{"x":{"id":"x","name":null,"scans":"q","last":1,"resource":"r","amount":2},"bad":7},"resources":{"r":"oops","ok":3}}');
  assert.equal(a.scans.x.scans, 0);
  assert.equal(a.scans.x.amount, 2);
  assert.equal(a.resources.r, 0);
  assert.equal(a.resources.ok, 3);
});
