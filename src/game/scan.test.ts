import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scanner, SCAN, hazardEffect, scanResult, withinScan, type ScanTarget } from './scan.ts';
import { PLANETS, TARGETS, planetById } from './space.ts';

const DT = 0.1;
const tgt = (id: string, radius = 100): ScanTarget => ({ id, name: id, radius });
const types = (evs: { type: string }[]): string[] => evs.map((e) => e.type);

test('out of range → no events; entering range fires enter exactly once', () => {
  const s = new Scanner();
  assert.deepEqual(s.update(DT, null, true), []);
  assert.deepEqual(s.update(DT, null, false), []);
  const t = tgt('kelos');
  assert.deepEqual(types(s.update(DT, t, false)), ['enter']);
  assert.equal(s.update(DT, t, false).filter((e) => e.type === 'enter').length, 0);
});

test('range rule: dist <= radius × rangeFactor', () => {
  assert.equal(withinScan(100 * SCAN.rangeFactor, 100), true);
  assert.equal(withinScan(100 * SCAN.rangeFactor + 0.01, 100), false);
});

test('holding ~4.2 s of dt slices completes once, then never again', () => {
  const s = new Scanner();
  const t = tgt('kelos');
  s.update(DT, t, false); // enter
  let completes = 0;
  for (let i = 0; i < 60; i++) {
    for (const e of s.update(DT, t, true)) if (e.type === 'complete') completes++;
  }
  assert.equal(completes, 1);
  assert.equal(s.progress, 1);
  assert.equal(s.done, true);
  // keep holding: still no second complete, no progress events
  assert.deepEqual(s.update(DT, t, true), []);
});

test('release decays but never resets; re-holding resumes from there', () => {
  const s = new Scanner();
  const t = tgt('seron');
  s.update(DT, t, false);
  for (let i = 0; i < 20; i++) s.update(DT, t, true); // ~2 s held → ~0.48
  const held = s.progress;
  assert.ok(held > 0.3 && held < 0.6, `progress ${held}`);
  for (let i = 0; i < 3; i++) s.update(DT, t, false); // decay 0.35/s
  const decayed = s.progress;
  assert.ok(decayed > 0 && decayed < held, `decayed ${decayed} < ${held}`);
  // resume exactly where it decayed to
  s.update(DT, t, true);
  assert.ok(s.progress > decayed);
  // out of range also decays, keeps id, resumes on re-entry without new enter
  s.update(DT, null, false);
  const p = s.progress;
  s.update(DT, t, false);
  assert.equal(s.id, 'seron');
  assert.ok(s.progress <= p + 1e-9);
});

test('switching targets emits leave first, resets progress to 0', () => {
  const s = new Scanner();
  s.update(DT, tgt('kelos'), false);
  for (let i = 0; i < 20; i++) s.update(DT, tgt('kelos'), true);
  const evs = s.update(DT, tgt('helka'), true);
  assert.equal(evs[0].type, 'leave');
  assert.equal((evs[0] as { id: string }).id, 'kelos');
  assert.equal(evs[1].type, 'enter');
  assert.equal((evs[1] as { id: string }).id, 'helka');
  assert.ok(s.progress < 0.05, `fresh progress ${s.progress}`);
});

test('scanResult is stable per id and from the fixed table', () => {
  const a = scanResult('kelos');
  assert.deepEqual(a, scanResult('kelos'));
  assert.equal(a.resource, '重水样本');
  assert.equal(scanResult('helka').resource, '氦气罐');
  assert.equal(scanResult('seron').resource, '冰晶');
  assert.equal(scanResult('volc').resource, '硫化物');
  assert.ok(a.amount >= 3 && a.amount <= 7);
  const len = [...a.log].length;
  assert.ok(len >= 20 && len <= 40, `log length ${len}`);
  // unknown ids still produce a deterministic, in-range result
  const u = scanResult('rogue-1');
  assert.ok(u.resource.length > 0 && u.amount >= 3 && u.amount <= 7);
});

test('hazardEffect: cold cuts energy regen; no hazard → neutral', () => {
  assert.ok(hazardEffect('cold').energyMul < 1);
  assert.equal(hazardEffect('cold').warn, '低温·推进器效率下降');
  assert.equal(hazardEffect('radiation').warn, '强辐射·护盾警报');
  assert.equal(hazardEffect('wind').warn, '气流·航向漂移');
  assert.equal(hazardEffect('gravity').warn, '强引力·注意距离');
  assert.equal(hazardEffect('photon').energyMul, 1.3);
  assert.equal(hazardEffect('photon').warn, '双星光子场·回充 ×1.3');
  const none = hazardEffect(undefined);
  assert.equal(none.energyMul, 1);
  assert.equal(none.warn, null);
});

test('sector data: every TARGET resolves, hazards assigned per design', () => {
  for (const id of TARGETS) assert.ok(planetById(id), id);
  assert.equal(planetById('kelos')!.hazard, undefined);
  assert.equal(planetById('helka')!.hazard, 'wind');
  assert.equal(planetById('seron')!.hazard, 'cold');
  assert.equal(planetById('volc')!.hazard, 'radiation');
  assert.equal(planetById('icer')!.hazard, 'cold');
  assert.equal(planetById('gas-storm')!.hazard, 'gravity');
  assert.equal(planetById('red-giant')!.hazard, 'radiation');
  assert.equal(planetById('binary')!.hazard, 'photon');
  assert.equal(scanResult('icer').resource, '氦-3 冰芯');
  assert.equal(scanResult('gas-storm').resource, '风暴氦芯');
  assert.equal(scanResult('red-giant').resource, '红巨星等离子');
  const binRes = scanResult('binary');
  assert.equal(binRes.resource, '双星等离子');
  assert.ok([...binRes.log].length >= 40 && binRes.log[0] !== ' ');
  assert.ok(PLANETS.length === TARGETS.length);
});
