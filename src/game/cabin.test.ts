import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCabinWorld, CABIN, CONSOLES, nearPedestal, polar, seatPositions } from './cabin.ts';
import { isFree, resolve } from './collision.ts';
import { Robot, ROBOT, type WalkInput } from './robot.ts';

const DT = 1 / 60;
const world = buildCabinWorld();
const inp = (p: Partial<WalkInput> = {}): WalkInput => ({ moveX: 0, moveY: 0, run: false, camYaw: 0, ...p });
function step(r: Robot, i: WalkInput, seconds: number): void {
  for (let n = Math.round(seconds / DT); n > 0; n--) r.update(DT, i, world);
}

test('layout: 6 consoles, 3 per side, mirrored', () => {
  assert.equal(CONSOLES.length, 6);
  const right = CONSOLES.filter((c) => polar((c.a0 + c.a1) / 2, 1).x > 0);
  assert.equal(right.length, 3);
  for (const c of right) assert.ok(CONSOLES.some((l) => l.a0 === 360 - c.a1 && l.a1 === 360 - c.a0));
});

test('spawn point and platform centre are free', () => {
  assert.ok(isFree(CABIN.spawn, ROBOT.radius, world));
  assert.ok(isFree({ x: 0, z: 0 }, ROBOT.radius, world));
});

test('walking forward from spawn reaches the pedestal and stops at its face', () => {
  const r = new Robot(CABIN.spawn.x, CABIN.spawn.z, CABIN.spawn.heading);
  step(r, inp({ moveY: 1, run: true }), 4);
  const d = Math.hypot(r.x - CABIN.pedestal.x, r.z - CABIN.pedestal.z);
  assert.ok(Math.abs(d - (CABIN.pedestal.r + ROBOT.radius)) < 0.02, `dist ${d}`);
  assert.ok(nearPedestal(r.x, r.z));
  const z = r.z;
  step(r, inp({ moveY: 1, run: true }), 1);
  assert.ok(Math.abs(r.z - z) < 0.01, 'no creep');
});

test('cannot leave the room in any direction', () => {
  for (let k = 0; k < 24; k++) {
    const r = new Robot(0, 0, 0);
    step(r, inp({ moveY: 1, run: true, camYaw: (k / 24) * Math.PI * 2 }), 6);
    assert.ok(Math.hypot(r.x, r.z) <= CABIN.boundR - ROBOT.radius + 1e-6, `k=${k} r=${Math.hypot(r.x, r.z)}`);
    assert.ok(isFree(r, ROBOT.radius, world, 0.01), `k=${k} overlapping`);
  }
});

test('cannot pass through a console: radial sprint at each console is stopped inside', () => {
  for (const c of CONSOLES) {
    for (const f of [0.3, 0.5, 0.7]) {
      const deg = c.a0 + (c.a1 - c.a0) * f;
      const dir = polar(deg, 1);
      // camYaw such that forward (-sin, -cos) == dir
      const camYaw = Math.atan2(-dir.x, -dir.z);
      const r = new Robot(dir.x * 2.5, dir.z * 2.5, 0);
      step(r, inp({ moveY: 1, run: true, camYaw }), 5);
      const rad = Math.hypot(r.x, r.z);
      assert.ok(rad < CABIN.consoleInnerR + 0.05, `deg ${deg}: got to r=${rad}`);
    }
  }
});

test('gaps between consoles are walkable (can reach the window sill)', () => {
  const dir = polar(74, 1);
  const camYaw = Math.atan2(-dir.x, -dir.z);
  const r = new Robot(dir.x * 3, dir.z * 3, 0);
  step(r, inp({ moveY: 1, camYaw }), 6);
  assert.ok(Math.hypot(r.x, r.z) > CABIN.consoleOuterR, `r=${Math.hypot(r.x, r.z)}`);
});

test('running at every seat from the centre ends in a free, stable spot', () => {
  for (const s of seatPositions()) {
    for (const off of [-6, 0, 6]) {
      const dir = polar(s.deg + off, 1);
      const camYaw = Math.atan2(-dir.x, -dir.z);
      const r = new Robot(dir.x, dir.z, 0);
      step(r, inp({ moveY: 1, run: true, camYaw }), 4);
      assert.ok(isFree(r, ROBOT.radius, world, 0.02), `seat ${s.deg}+${off} → ${r.x},${r.z}`);
      const { x, z } = r;
      step(r, inp({ moveY: 1, run: true, camYaw }), 0.5);
      assert.ok(Math.hypot(r.x - x, r.z - z) < 0.05, 'jitter');
    }
  }
});

test('run is faster than walk; stopping decelerates to rest', () => {
  const a = new Robot(0, 2, 0);
  const b = new Robot(0, 2, 0);
  step(a, inp({ moveX: 1 }), 0.5);
  step(b, inp({ moveX: 1, run: true }), 0.5);
  assert.ok(b.x > a.x * 1.5);
  step(b, inp(), 1);
  assert.equal(b.speed, 0);
});

test('camera-relative input + heading turns to face travel; footsteps count', () => {
  const r = new Robot(0, 0, 0);
  step(r, inp({ moveY: 1, camYaw: Math.PI / 2 }), 1); // camera looks toward -x
  assert.ok(r.x < -1 && Math.abs(r.z) < 0.01);
  assert.ok(Math.abs(Math.sin(r.heading) + 1) < 0.01, `heading ${r.heading}`);
  assert.ok(r.steps >= 3);
});

test('nearPedestal gate', () => {
  assert.equal(nearPedestal(CABIN.spawn.x, CABIN.spawn.z), false);
  assert.equal(nearPedestal(0, CABIN.pedestal.z + 2), true);
});
