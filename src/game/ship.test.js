// src/game/ship.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/rng.ts
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
var damp = (rate, dt) => 1 - Math.exp(-rate * dt);

// src/game/ship.ts
var SHIP = {
  radius: 3,
  cruise: 45,
  boostSpeed: 170,
  brakeSpeed: 6,
  accel: 1.6,
  brakeRate: 2.4,
  yawRate: 1.5,
  pitchRate: 1.1,
  maxPitch: 1.25,
  steerLag: 5,
  maxRoll: 0.75,
  energyMax: 100,
  energyDrain: 22,
  energyRegen: 14,
  /** boost can't re-engage below this after running dry */
  energyRearm: 15
};
function forwardOf(yaw, pitch) {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}
var Ship = class {
  pos;
  yaw;
  pitch = 0;
  /** visual bank, radians (negative = right wing down) */
  roll = 0;
  speed = SHIP.cruise;
  energy = SHIP.energyMax;
  /** smoothed steering actually applied */
  steerX = 0;
  steerY = 0;
  boosting = false;
  /** true after energy hit 0 until it regenerates past energyRearm */
  depleted = false;
  /** set for one update when a body was hit */
  bumped = false;
  constructor(pos = { x: 0, y: 0, z: 0 }, yaw = 0) {
    this.pos = { ...pos };
    this.yaw = yaw;
  }
  get forward() {
    return forwardOf(this.yaw, this.pitch);
  }
  /** 0 at rest, 1 at full boost speed */
  get speedFrac() {
    return clamp(this.speed / SHIP.boostSpeed, 0, 1);
  }
  update(dt, input, bodies = [], sectorR = Infinity, energyMul = 1) {
    const ks = damp(SHIP.steerLag, dt);
    this.steerX += (clamp(input.steerX, -1, 1) - this.steerX) * ks;
    this.steerY += (clamp(input.steerY, -1, 1) - this.steerY) * ks;
    const dist = Math.hypot(this.pos.x, this.pos.y, this.pos.z);
    let yawIn = this.steerX;
    let pitchIn = this.steerY;
    if (dist > sectorR) {
      const f2 = this.forward;
      const outward = (f2.x * this.pos.x + f2.y * this.pos.y + f2.z * this.pos.z) / dist;
      if (outward > -0.3) {
        const cross = f2.x * -this.pos.z - f2.z * -this.pos.x;
        yawIn = cross > 0 ? 1 : -1;
        pitchIn = clamp(-this.pos.y / dist - f2.y, -1, 1);
      }
    }
    this.yaw -= yawIn * SHIP.yawRate * dt;
    this.pitch = clamp(this.pitch + pitchIn * SHIP.pitchRate * dt, -SHIP.maxPitch, SHIP.maxPitch);
    this.roll += (-yawIn * SHIP.maxRoll - this.roll) * damp(4, dt);
    if (this.depleted && this.energy >= SHIP.energyRearm) this.depleted = false;
    this.boosting = input.boost && !input.brake && !this.depleted && this.energy > 0;
    if (this.boosting) {
      this.energy = Math.max(0, this.energy - SHIP.energyDrain * dt);
      if (this.energy === 0) this.depleted = true;
    } else {
      this.energy = Math.min(SHIP.energyMax, this.energy + SHIP.energyRegen * energyMul * dt);
    }
    const target = input.brake ? SHIP.brakeSpeed : this.boosting ? SHIP.boostSpeed : SHIP.cruise;
    const rate = target < this.speed ? SHIP.brakeRate * (input.brake ? 1 : 0.5) : SHIP.accel;
    this.speed += (target - this.speed) * damp(rate, dt);
    const f = this.forward;
    this.pos.x += f.x * this.speed * dt;
    this.pos.y += f.y * this.speed * dt;
    this.pos.z += f.z * this.speed * dt;
    this.bumped = false;
    for (const b of bodies) {
      const dx = this.pos.x - b.pos.x;
      const dy = this.pos.y - b.pos.y;
      const dz = this.pos.z - b.pos.z;
      const min = b.radius + SHIP.radius;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2) || 1;
      const k = min / d;
      this.pos.x = b.pos.x + dx * k;
      this.pos.y = b.pos.y + dy * k;
      this.pos.z = b.pos.z + dz * k;
      const into = -(f.x * dx + f.y * dy + f.z * dz) / d;
      if (into > 0) this.speed *= 1 - 0.8 * into * Math.min(1, dt * 10);
      this.bumped = true;
    }
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
  { id: "red-giant", name: "\u7EA2\u5DE8\u661F\u7CFB", pos: { x: -480, y: 160, z: 1020 }, radius: 280, hazard: "radiation", colors: [8002574, 15885337, 16773840], atmosphere: 16745528, kind: "red-giant", seed: 89 }
];
var TARGETS = PLANETS.map((p) => p.id);
var SUN_DIR = (() => {
  const v = { x: 0.55, y: 0.5, z: -0.67 };
  const l = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
})();
var STATION = { pos: { x: 0, y: 0, z: 0 }, radius: 17 };
var SECTOR_RADIUS = 1500;
var BELT = {
  /** the belt orbits planet index 1 (Helka) */
  planet: 1,
  innerR: 175,
  outerR: 290,
  thickness: 16,
  count: 700,
  /** tilt of the ring plane (radians, about x then z) */
  tiltX: 0.32,
  tiltZ: -0.18
};
function beltRocks(seed = 7) {
  const rnd = mulberry32(seed);
  const c = PLANETS[BELT.planet].pos;
  const cx = Math.cos(BELT.tiltX);
  const sx = Math.sin(BELT.tiltX);
  const cz = Math.cos(BELT.tiltZ);
  const sz = Math.sin(BELT.tiltZ);
  const out = [];
  for (let i = 0; i < BELT.count; i++) {
    const a = rnd() * Math.PI * 2;
    const t = (rnd() + rnd()) / 2;
    const r = BELT.innerR + (BELT.outerR - BELT.innerR) * t;
    let x = Math.cos(a) * r;
    let y = (rnd() - 0.5) * BELT.thickness;
    let z = Math.sin(a) * r;
    const y1 = y * cx - z * sx;
    const z1 = y * sx + z * cx;
    const x2 = x * cz - y1 * sz;
    const y2 = x * sz + y1 * cz;
    x = x2;
    y = y2;
    z = z1;
    const s = 1.2 + Math.pow(rnd(), 3) * 7;
    out.push({
      pos: { x: c.x + x, y: c.y + y, z: c.z + z },
      scale: { x: s * (0.7 + rnd() * 0.6), y: s * (0.6 + rnd() * 0.5), z: s * (0.7 + rnd() * 0.6) },
      rot: { x: rnd() * 6.283, y: rnd() * 6.283, z: rnd() * 6.283 }
    });
  }
  return out;
}
function solidBodies() {
  return [...PLANETS.map((p) => ({ pos: p.pos, radius: p.radius })), { pos: STATION.pos, radius: STATION.radius }];
}

// src/game/ship.test.ts
var DT = 1 / 60;
var inp = (p = {}) => ({ steerX: 0, steerY: 0, boost: false, brake: false, ...p });
function step(s, i, seconds, bodies = solidBodies(), sector = Infinity) {
  for (let n = Math.round(seconds / DT); n > 0; n--) s.update(DT, i, bodies, sector);
}
test("forward convention: yaw 0 \u2192 -z, positive pitch \u2192 up", () => {
  assert.deepEqual(forwardOf(0, 0), { x: -0, y: 0, z: -1 });
  assert.ok(forwardOf(0, 0.5).y > 0);
  assert.ok(forwardOf(-Math.PI / 2, 0).x > 0.99);
});
test("cruises straight; boost accelerates and drains energy; release regenerates", () => {
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
test("boost cuts out when energy is empty and needs rearm", () => {
  const s = new Ship();
  step(s, inp({ boost: true }), SHIP.energyMax / SHIP.energyDrain + 0.5, []);
  assert.equal(s.boosting, false);
  assert.equal(s.depleted, true);
  assert.ok(s.energy < SHIP.energyRearm);
  step(s, inp({ boost: true }), 3, []);
  assert.ok(s.speed < SHIP.boostSpeed, "never sustains boost while held dry");
  step(s, inp(), 2, []);
  assert.equal(s.depleted, false);
});
test("brake slows well below cruise", () => {
  const s = new Ship();
  step(s, inp({ brake: true }), 2, []);
  assert.ok(s.speed < 12, `speed ${s.speed}`);
});
test("steer right turns toward +x and banks; pitch is clamped", () => {
  const s = new Ship();
  step(s, inp({ steerX: 1 }), 0.8, []);
  assert.ok(s.forward.x > 0.5);
  assert.ok(s.roll < -0.3);
  step(s, inp({ steerY: 1 }), 5, []);
  assert.ok(s.pitch <= SHIP.maxPitch + 1e-9 && s.pitch > 1);
});
test("cannot fly through a planet", () => {
  const p = PLANETS[0];
  const s = new Ship({ x: p.pos.x, y: p.pos.y, z: p.pos.z + p.radius + 60 });
  step(s, inp({ boost: true }), 4);
  const d = Math.hypot(s.pos.x - p.pos.x, s.pos.y - p.pos.y, s.pos.z - p.pos.z);
  assert.ok(d >= p.radius + SHIP.radius - 1e-6, `inside planet: ${d}`);
  assert.ok(s.speed < SHIP.boostSpeed * 0.5, "head-on hit scrubs speed");
});
test("sector bound turns the ship back", () => {
  const s = new Ship({ x: 0, y: 0, z: -SECTOR_RADIUS + 50 });
  step(s, inp({ boost: true }), 30, [], SECTOR_RADIUS);
  assert.ok(Math.hypot(s.pos.x, s.pos.y, s.pos.z) < SECTOR_RADIUS + 400);
});
test("layout: \u22653 planets that do not overlap, belt is deterministic and in band", () => {
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
