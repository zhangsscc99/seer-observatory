import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANETS, TARGETS, planetById } from './space.ts';

test('every target id resolves and the target list covers the sector', () => {
  for (const id of TARGETS) assert.ok(planetById(id), id);
  assert.equal(TARGETS.length, PLANETS.length);
});

test('hazards follow the sector design table', () => {
  assert.equal(planetById('kelos')!.hazard, undefined);
  assert.equal(planetById('helka')!.hazard, 'wind');
  assert.equal(planetById('seron')!.hazard, 'cold');
  assert.equal(planetById('volc')!.hazard, 'radiation');
});
