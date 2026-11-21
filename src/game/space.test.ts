import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanResult } from './scan.ts';
import { PLANETS, SECTOR_RADIUS, TARGETS, planetById } from './space.ts';

test('every target id resolves and the target list covers the sector', () => {
  for (const id of TARGETS) assert.ok(planetById(id), id);
  assert.equal(TARGETS.length, PLANETS.length);
});

test('hazards follow the sector design table', () => {
  assert.equal(planetById('kelos')!.hazard, undefined);
  assert.equal(planetById('helka')!.hazard, 'wind');
  assert.equal(planetById('seron')!.hazard, 'cold');
  assert.equal(planetById('volc')!.hazard, 'radiation');
  assert.equal(planetById('icer')!.hazard, 'cold');
  assert.equal(planetById('gas-storm')!.hazard, 'gravity');
});

test('icer: ice-ring planet registered and scannable', () => {
  const p = planetById('icer');
  assert.ok(p);
  assert.equal(p.kind, 'ice-ring');
  assert.equal(p.hazard, 'cold');
  assert.ok(TARGETS.includes('icer'));
  assert.equal(TARGETS.filter((id) => id === 'icer').length, 1);
});

test('gas-storm: gas-storm planet registered and scannable', () => {
  const p = planetById('gas-storm');
  assert.ok(p);
  assert.equal(p.kind, 'gas-storm');
  assert.equal(p.hazard, 'gravity');
  assert.ok(TARGETS.includes('gas-storm'));
  assert.equal(TARGETS.filter((id) => id === 'gas-storm').length, 1);
  const res = scanResult('gas-storm');
  assert.equal(res.resource, '风暴氦芯');
  assert.ok(res.amount >= 3 && res.amount <= 7, `amount ${res.amount}`);
  const len = [...res.log].length;
  assert.ok(len >= 20 && len <= 40, `log length ${len}`);
});

test('planet bounding spheres never overlap', () => {
  for (let i = 0; i < PLANETS.length; i++) {
    for (let j = i + 1; j < PLANETS.length; j++) {
      const a = PLANETS[i];
      const b = PLANETS[j];
      const d = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z);
      assert.ok(d > a.radius + b.radius, `${a.id} vs ${b.id}: ${d.toFixed(1)} <= ${a.radius + b.radius}`);
    }
  }
});

test('every planet sits inside the sector radius', () => {
  for (const p of PLANETS) {
    const d = Math.hypot(p.pos.x, p.pos.y, p.pos.z);
    assert.ok(d <= SECTOR_RADIUS, `${p.id} at ${d.toFixed(1)} > ${SECTOR_RADIUS}`);
  }
});
