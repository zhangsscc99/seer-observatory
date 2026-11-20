// src/game/cabin.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/cabin.ts
var D2R = Math.PI / 180;
var CABIN = {
  /** inner wall radius (window sill) */
  wallR: 7.2,
  /** walkable boundary for collision */
  boundR: 6.85,
  ceilingY: 4.2,
  skylightR: 2.7,
  /** console cross-section radii */
  consoleInnerR: 4.75,
  consoleOuterR: 5.75,
  consoleTopY: 0.62,
  seatR: 4.15,
  /** central round platform */
  platformR: 1.6,
  /** holo-globe pedestal */
  pedestal: { x: 0, z: -4.3, r: 1.05 },
  /** distance from the pedestal centre within which "启航" is offered */
  interactR: 2.5,
  spawn: { x: 0, z: 2.6, heading: Math.PI },
  /** window pillars (degrees) */
  pillars: [38, 93, 148, 212, 267, 322]
};
var CONSOLES = (() => {
  const right = [
    { a0: 40, a1: 68 },
    { a0: 80, a1: 108 },
    { a0: 120, a1: 148 }
  ];
  const left = right.map((c) => ({ a0: 360 - c.a1, a1: 360 - c.a0 }));
  return [...right, ...left];
})();
function polar(deg, r) {
  return { x: Math.sin(deg * D2R) * r, z: Math.cos(deg * D2R) * r };
}
function seatPositions() {
  const out = [];
  for (const c of CONSOLES) {
    for (const f of [0.3, 0.7]) {
      const deg = c.a0 + (c.a1 - c.a0) * f;
      out.push({ ...polar(deg, CABIN.seatR), deg });
    }
  }
  return out;
}
var SEAT_COLLIDER_R = 0.3;
function buildCabinWorld() {
  const circles = [];
  const midR = (CABIN.consoleInnerR + CABIN.consoleOuterR) / 2;
  const halfDepth = (CABIN.consoleOuterR - CABIN.consoleInnerR) / 2;
  for (const c of CONSOLES) {
    const inset = halfDepth / midR / D2R;
    const span = c.a1 - c.a0 - inset * 2;
    const n = Math.ceil(span * D2R * midR / 0.4);
    for (let i = 0; i <= n; i++) {
      const deg = c.a0 + inset + span * i / n;
      circles.push({ ...polar(deg, midR), r: halfDepth });
    }
  }
  const cr = 0.25;
  for (const c of CONSOLES) {
    for (const r of [CABIN.consoleInnerR + cr, CABIN.consoleOuterR - cr]) {
      const inset = cr / r / D2R;
      circles.push({ ...polar(c.a0 + inset, r), r: cr }, { ...polar(c.a1 - inset, r), r: cr });
    }
  }
  for (const s of seatPositions()) circles.push({ x: s.x, z: s.z, r: SEAT_COLLIDER_R });
  circles.push({ ...CABIN.pedestal });
  return { circles, boundR: CABIN.boundR };
}
function nearPedestal(x, z) {
  return Math.hypot(x - CABIN.pedestal.x, z - CABIN.pedestal.z) <= CABIN.interactR;
}

// src/game/collision.ts
var PASSES = 8;
function resolve(p, radius, world2) {
  let hit = false;
  for (let pass = 0; pass < PASSES; pass++) {
    let moved = false;
    for (const c of world2.circles) {
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const min = c.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2);
      if (d < 1e-6) {
        p.x = c.x;
        p.z = c.z + min;
      } else {
        const k = min / d;
        p.x = c.x + dx * k;
        p.z = c.z + dz * k;
      }
      moved = hit = true;
    }
    const lim = world2.boundR - radius;
    const r = Math.hypot(p.x, p.z);
    if (r > lim) {
      p.x *= lim / r;
      p.z *= lim / r;
      moved = hit = true;
    }
    if (!moved) break;
  }
  return hit;
}
function isFree(p, radius, world2, eps = 1e-3) {
  if (Math.hypot(p.x, p.z) > world2.boundR - radius + eps) return false;
  for (const c of world2.circles) {
    if (Math.hypot(p.x - c.x, p.z - c.z) < c.r + radius - eps) return false;
  }
  return true;
}

// src/game/rng.ts
var clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}
var damp = (rate, dt) => 1 - Math.exp(-rate * dt);

// src/game/robot.ts
var ROBOT = {
  radius: 0.28,
  height: 0.8,
  walkSpeed: 2.2,
  runSpeed: 4.4,
  accel: 14,
  turnRate: 14,
  /** metres travelled per footstep */
  stride: 0.55
};
var Robot = class {
  x;
  z;
  /** facing: (sin heading, cos heading) on XZ */
  heading;
  vx = 0;
  vz = 0;
  /** accumulates distance; drives the walk cycle */
  walkPhase = 0;
  /** incremented once per footfall — renderer/audio diff this */
  steps = 0;
  constructor(x = 0, z = 0, heading = 0) {
    this.x = x;
    this.z = z;
    this.heading = heading;
  }
  get speed() {
    return Math.hypot(this.vx, this.vz);
  }
  update(dt, input, world2) {
    let mx = clamp(input.moveX, -1, 1);
    let my = clamp(input.moveY, -1, 1);
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    const sin = Math.sin(input.camYaw);
    const cos = Math.cos(input.camYaw);
    const dirX = -sin * my + cos * mx;
    const dirZ = -cos * my - sin * mx;
    const top = input.run ? ROBOT.runSpeed : ROBOT.walkSpeed;
    const k = damp(ROBOT.accel, dt);
    this.vx += (dirX * top - this.vx) * k;
    this.vz += (dirZ * top - this.vz) * k;
    if (len < 0.01 && this.speed < 0.02) this.vx = this.vz = 0;
    const px = this.x;
    const pz = this.z;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    if (resolve(this, ROBOT.radius, world2) && dt > 0) {
      this.vx = (this.x - px) / dt;
      this.vz = (this.z - pz) / dt;
    }
    if (len > 0.05) {
      const want = Math.atan2(dirX, dirZ);
      this.heading += angleDelta(this.heading, want) * damp(ROBOT.turnRate, dt);
    }
    const travelled = Math.hypot(this.x - px, this.z - pz);
    const before = Math.floor(this.walkPhase / ROBOT.stride);
    this.walkPhase += travelled;
    if (Math.floor(this.walkPhase / ROBOT.stride) > before) this.steps++;
  }
};

// src/game/cabin.test.ts
var DT = 1 / 60;
var world = buildCabinWorld();
var inp = (p = {}) => ({ moveX: 0, moveY: 0, run: false, camYaw: 0, ...p });
function step(r, i, seconds) {
  for (let n = Math.round(seconds / DT); n > 0; n--) r.update(DT, i, world);
}
test("layout: 6 consoles, 3 per side, mirrored", () => {
  assert.equal(CONSOLES.length, 6);
  const right = CONSOLES.filter((c) => polar((c.a0 + c.a1) / 2, 1).x > 0);
  assert.equal(right.length, 3);
  for (const c of right) assert.ok(CONSOLES.some((l) => l.a0 === 360 - c.a1 && l.a1 === 360 - c.a0));
});
test("spawn point and platform centre are free", () => {
  assert.ok(isFree(CABIN.spawn, ROBOT.radius, world));
  assert.ok(isFree({ x: 0, z: 0 }, ROBOT.radius, world));
});
test("walking forward from spawn reaches the pedestal and stops at its face", () => {
  const r = new Robot(CABIN.spawn.x, CABIN.spawn.z, CABIN.spawn.heading);
  step(r, inp({ moveY: 1, run: true }), 4);
  const d = Math.hypot(r.x - CABIN.pedestal.x, r.z - CABIN.pedestal.z);
  assert.ok(Math.abs(d - (CABIN.pedestal.r + ROBOT.radius)) < 0.02, `dist ${d}`);
  assert.ok(nearPedestal(r.x, r.z));
  const z = r.z;
  step(r, inp({ moveY: 1, run: true }), 1);
  assert.ok(Math.abs(r.z - z) < 0.01, "no creep");
});
test("cannot leave the room in any direction", () => {
  for (let k = 0; k < 24; k++) {
    const r = new Robot(0, 0, 0);
    step(r, inp({ moveY: 1, run: true, camYaw: k / 24 * Math.PI * 2 }), 6);
    assert.ok(Math.hypot(r.x, r.z) <= CABIN.boundR - ROBOT.radius + 1e-6, `k=${k} r=${Math.hypot(r.x, r.z)}`);
    assert.ok(isFree(r, ROBOT.radius, world, 0.01), `k=${k} overlapping`);
  }
});
test("cannot pass through a console: radial sprint at each console is stopped inside", () => {
  for (const c of CONSOLES) {
    for (const f of [0.3, 0.5, 0.7]) {
      const deg = c.a0 + (c.a1 - c.a0) * f;
      const dir = polar(deg, 1);
      const camYaw = Math.atan2(-dir.x, -dir.z);
      const r = new Robot(dir.x * 2.5, dir.z * 2.5, 0);
      step(r, inp({ moveY: 1, run: true, camYaw }), 5);
      const rad = Math.hypot(r.x, r.z);
      assert.ok(rad < CABIN.consoleInnerR + 0.05, `deg ${deg}: got to r=${rad}`);
    }
  }
});
test("gaps between consoles are walkable (can reach the window sill)", () => {
  const dir = polar(74, 1);
  const camYaw = Math.atan2(-dir.x, -dir.z);
  const r = new Robot(dir.x * 3, dir.z * 3, 0);
  step(r, inp({ moveY: 1, camYaw }), 6);
  assert.ok(Math.hypot(r.x, r.z) > CABIN.consoleOuterR, `r=${Math.hypot(r.x, r.z)}`);
});
test("running at every seat from the centre ends in a free, stable spot", () => {
  for (const s of seatPositions()) {
    for (const off of [-6, 0, 6]) {
      const dir = polar(s.deg + off, 1);
      const camYaw = Math.atan2(-dir.x, -dir.z);
      const r = new Robot(dir.x, dir.z, 0);
      step(r, inp({ moveY: 1, run: true, camYaw }), 4);
      assert.ok(isFree(r, ROBOT.radius, world, 0.02), `seat ${s.deg}+${off} \u2192 ${r.x},${r.z}`);
      const { x, z } = r;
      step(r, inp({ moveY: 1, run: true, camYaw }), 0.5);
      assert.ok(Math.hypot(r.x - x, r.z - z) < 0.05, "jitter");
    }
  }
});
test("run is faster than walk; stopping decelerates to rest", () => {
  const a = new Robot(0, 2, 0);
  const b = new Robot(0, 2, 0);
  step(a, inp({ moveX: 1 }), 0.5);
  step(b, inp({ moveX: 1, run: true }), 0.5);
  assert.ok(b.x > a.x * 1.5);
  step(b, inp(), 1);
  assert.equal(b.speed, 0);
});
test("camera-relative input + heading turns to face travel; footsteps count", () => {
  const r = new Robot(0, 0, 0);
  step(r, inp({ moveY: 1, camYaw: Math.PI / 2 }), 1);
  assert.ok(r.x < -1 && Math.abs(r.z) < 0.01);
  assert.ok(Math.abs(Math.sin(r.heading) + 1) < 0.01, `heading ${r.heading}`);
  assert.ok(r.steps >= 3);
});
test("nearPedestal gate", () => {
  assert.equal(nearPedestal(CABIN.spawn.x, CABIN.spawn.z), false);
  assert.equal(nearPedestal(0, CABIN.pedestal.z + 2), true);
});
