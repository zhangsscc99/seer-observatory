import { test } from 'node:test';
import assert from 'node:assert/strict';
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
});

test('icer: ice-ring planet registered and scannable', () => {
  const p = planetById('icer');
  assert.ok(p);
  assert.equal(p.kind, 'ice-ring');
  assert.equal(p.hazard, 'cold');
  assert.ok(TARGETS.includes('icer'));
  assert.equal(TARGETS.filter((id) => id === 'icer').length, 1);
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
