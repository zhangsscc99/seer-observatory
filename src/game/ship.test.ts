import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ship, SHIP, forwardOf, type FlightInput } from './ship.ts';
import { beltRocks, BELT, PLANETS, solidBodies, SUN_DIR, SECTOR_RADIUS } from './space.ts';

const DT = 1 / 60;
const inp = (p: Partial<FlightInput> = {}): FlightInput => ({ steerX: 0, steerY: 0, boost: false, brake: false, ...p });
function step(s: Ship, i: FlightInput, seconds: number, bodies = solidBodies(), sector = Infinity): void {
  for (let n = Math.round(seconds / DT); n > 0; n--) s.update(DT, i, bodies, sector);
}

test('forward convention: yaw 0 → -z, positive pitch → up', () => {
  assert.deepEqual(forwardOf(0, 0), { x: -0, y: 0, z: -1 });
  assert.ok(forwardOf(0, 0.5).y > 0);
  assert.ok(forwardOf(-Math.PI / 2, 0).x > 0.99);
});

test('cruises straight; boost accelerates and drains energy; release regenerates', () => {
  const s = new Ship({ x: 0, y: 0, z: -40 });
  step(s, inp(), 1, []);
  assert.ok(Math.abs(s.speed - SHIP.cruise) < 1);
  assert.ok(s.pos.z < -80 && s.pos.x === 0);
  step(s, inp({ boost: true }), 2, []);
  assert.ok(s.speed > SHIP.cruise * 2.5, `speed ${s.speed}`);
  assert.ok(s.energy < SHIP.energyMax - 30);
  const e = s.energy;
  step(s, inp(), 1, []);
  assert.ok(s.energy > e);
});

test('boost cuts out when energy is empty and needs rearm', () => {
  const s = new Ship();
  step(s, inp({ boost: true }), SHIP.energyMax / SHIP.energyDrain + 0.5, []);
  assert.equal(s.boosting, false);
  assert.equal(s.depleted, true);
  assert.ok(s.energy < SHIP.energyRearm);
  step(s, inp({ boost: true }), 3, []);
  assert.ok(s.speed < SHIP.boostSpeed, 'never sustains boost while held dry');
  step(s, inp(), 2, []);
  assert.equal(s.depleted, false);
});

test('brake slows well below cruise', () => {
  const s = new Ship();
  step(s, inp({ brake: true }), 2, []);
  assert.ok(s.speed < 12, `speed ${s.speed}`);
});

test('steer right turns toward +x and banks; pitch is clamped', () => {
  const s = new Ship();
  step(s, inp({ steerX: 1 }), 0.8, []);
  assert.ok(s.forward.x > 0.5);
  assert.ok(s.roll < -0.3);
  step(s, inp({ steerY: 1 }), 5, []);
  assert.ok(s.pitch <= SHIP.maxPitch + 1e-9 && s.pitch > 1);
});

test('cannot fly through a planet', () => {
  const p = PLANETS[0];
  const s = new Ship({ x: p.pos.x, y: p.pos.y, z: p.pos.z + p.radius + 60 });
  step(s, inp({ boost: true }), 4);
  const d = Math.hypot(s.pos.x - p.pos.x, s.pos.y - p.pos.y, s.pos.z - p.pos.z);
  assert.ok(d >= p.radius + SHIP.radius - 1e-6, `inside planet: ${d}`);
  assert.ok(s.speed < SHIP.boostSpeed * 0.5, 'head-on hit scrubs speed');
});

test('sector bound turns the ship back', () => {
  const s = new Ship({ x: 0, y: 0, z: -SECTOR_RADIUS + 50 });
  step(s, inp({ boost: true }), 30, [], SECTOR_RADIUS);
  assert.ok(Math.hypot(s.pos.x, s.pos.y, s.pos.z) < SECTOR_RADIUS + 400);
});

test('layout: ≥3 planets that do not overlap, belt is deterministic and in band', () => {
  assert.ok(PLANETS.length >= 3);
  for (let i = 0; i < PLANETS.length; i++)
    for (let j = i + 1; j < PLANETS.length; j++) {
      const a = PLANETS[i];
      const b = PLANETS[j];
      const d = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z);
      assert.ok(d > a.radius + b.radius + 100);
    }
  const r1 = beltRocks();
  const r2 = beltRocks();
  assert.equal(r1.length, BELT.count);
  assert.deepEqual(r1[17], r2[17]);
  const c = PLANETS[BELT.planet].pos;
  for (const r of r1) {
    const d = Math.hypot(r.pos.x - c.x, r.pos.y - c.y, r.pos.z - c.z);
    assert.ok(d > BELT.innerR - BELT.thickness && d < BELT.outerR + BELT.thickness);
  }
  assert.ok(Math.abs(Math.hypot(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z) - 1) < 1e-9);
});
