// src/game/tidal.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/rng.ts
var clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

// src/game/tidal.ts
var TIDAL = {
  /** outer hazard boundary in multiples of black-hole radius */
  hazardFactor: 3.2,
  /** inner crush boundary in multiples of black-hole radius */
  crushFactor: 1.6,
  /** radial distance (× radius) the ship is bounced out to on ejection */
  ejectFactor: 2.35,
  /** time dilation at the outer hazard edge (3.2R) */
  hazardTimeMin: 1.2,
  /** time dilation at the inner hazard edge (1.6R) */
  hazardTimeMax: 2.4,
  /** maximum time dilation deep in crush zone */
  crushTimeMax: 3.6,
  /** tidal tensor accumulation per second inside crush zone */
  fillRate: 0.45,
  /** tidal tensor decay per second outside crush zone */
  decayRate: 0.6,
  /** post-ejection cooldown (seconds) so repeated re-entry cannot spam eject */
  cooldown: 3
};
function tidalState(distance, radius) {
  if (radius <= 0 || !Number.isFinite(distance)) return { zone: "safe", timeScale: 1 };
  const ratio = Math.max(0, distance) / radius;
  if (ratio > TIDAL.hazardFactor) {
    return { zone: "safe", timeScale: 1 };
  }
  if (ratio >= TIDAL.crushFactor) {
    const t = clamp((TIDAL.hazardFactor - ratio) / (TIDAL.hazardFactor - TIDAL.crushFactor), 0, 1);
    const timeScale2 = TIDAL.hazardTimeMin + (TIDAL.hazardTimeMax - TIDAL.hazardTimeMin) * t;
    return { zone: "hazard", timeScale: timeScale2 };
  }
  const deep = clamp((TIDAL.crushFactor - ratio) / 0.6, 0, 1);
  const timeScale = TIDAL.hazardTimeMax + (TIDAL.crushTimeMax - TIDAL.hazardTimeMax) * deep;
  return { zone: "crush", timeScale };
}
function computeEjectTarget(shipPos, center, radius) {
  let dx = shipPos.x - center.x;
  let dy = shipPos.y - center.y;
  let dz = shipPos.z - center.z;
  let d = Math.hypot(dx, dy, dz);
  if (d < 1e-4) {
    dx = 0;
    dy = 0.25;
    dz = 1;
    d = Math.hypot(dx, dy, dz);
  }
  const targetR = radius * TIDAL.ejectFactor;
  const k = targetR / d;
  return {
    x: center.x + dx * k,
    y: center.y + dy * k,
    z: center.z + dz * k
  };
}
var TidalField = class {
  zone = "safe";
  timeScale = 1;
  tension = 0;
  cooldown = 0;
  reset() {
    this.zone = "safe";
    this.timeScale = 1;
    this.tension = 0;
    this.cooldown = 0;
  }
  update(dt, distance, radius) {
    const stepDt = Math.max(0, dt);
    const st = tidalState(distance, radius);
    this.zone = st.zone;
    this.timeScale = st.timeScale;
    let ejected = false;
    if (this.cooldown > 0) {
      this.cooldown = Math.max(0, this.cooldown - stepDt);
      this.tension = Math.max(0, this.tension - TIDAL.decayRate * stepDt);
    } else if (st.zone === "crush") {
      this.tension = Math.min(1, this.tension + TIDAL.fillRate * stepDt);
      if (this.tension >= 1) {
        ejected = true;
        this.tension = 0;
        this.cooldown = TIDAL.cooldown;
      }
    } else {
      this.tension = Math.max(0, this.tension - TIDAL.decayRate * stepDt);
    }
    return {
      zone: this.zone,
      timeScale: this.timeScale,
      tension: this.tension,
      cooldown: this.cooldown,
      ejected
    };
  }
};

// src/game/tidal.test.ts
var R = 100;
test("tidalState classifies safe / hazard / crush with monotonic timeScale", () => {
  const far = tidalState(R * 4, R);
  assert.equal(far.zone, "safe");
  assert.equal(far.timeScale, 1);
  const edgeSafe = tidalState(R * 3.21, R);
  assert.equal(edgeSafe.zone, "safe");
  assert.equal(edgeSafe.timeScale, 1);
  const outerHaz = tidalState(R * 3.2, R);
  assert.equal(outerHaz.zone, "hazard");
  assert.ok(Math.abs(outerHaz.timeScale - 1.2) < 1e-6);
  const midHaz = tidalState(R * 2.4, R);
  assert.equal(midHaz.zone, "hazard");
  assert.ok(Math.abs(midHaz.timeScale - 1.8) < 1e-6);
  const innerHaz = tidalState(R * 1.6, R);
  assert.equal(innerHaz.zone, "hazard");
  assert.ok(Math.abs(innerHaz.timeScale - 2.4) < 1e-6);
  const crush = tidalState(R * 1.3, R);
  assert.equal(crush.zone, "crush");
  assert.ok(crush.timeScale > 2.4 && crush.timeScale <= TIDAL.crushTimeMax);
  assert.deepEqual(tidalState(50, 0), { zone: "safe", timeScale: 1 });
});
test("crush accumulates tension and leaving decays it without ejecting", () => {
  const tf = new TidalField();
  for (let i = 0; i < 10; i++) {
    const s = tf.update(0.1, R * 1.3, R);
    assert.equal(s.zone, "crush");
    assert.equal(s.ejected, false);
  }
  const peak = tf.tension;
  assert.ok(peak > 0.35 && peak < 0.6, `peak tension ${peak}`);
  for (let i = 0; i < 5; i++) {
    const s = tf.update(0.1, R * 2, R);
    assert.equal(s.zone, "hazard");
    assert.equal(s.ejected, false);
  }
  assert.ok(tf.tension < peak && tf.tension > 0, `decayed ${tf.tension} < ${peak}`);
  for (let i = 0; i < 10; i++) tf.update(0.1, R * 3.5, R);
  assert.equal(tf.tension, 0);
});
test("staying in crush triggers ejected once, starts cooldown, and repeated re-entry does not spam", () => {
  const tf = new TidalField();
  let ejects = 0;
  for (let i = 0; i < 30; i++) {
    const s = tf.update(0.1, R * 1.2, R);
    if (s.ejected) ejects++;
  }
  assert.equal(ejects, 1, "should eject exactly once");
  assert.equal(tf.tension, 0);
  assert.ok(tf.cooldown > 0, `cooldown active: ${tf.cooldown}`);
  for (let i = 0; i < 15; i++) {
    const s = tf.update(0.1, R * 1.15, R);
    assert.equal(s.ejected, false);
    assert.equal(s.tension, 0);
  }
  assert.ok(tf.cooldown > 0);
  for (let i = 0; i < 20; i++) tf.update(0.1, R * 2.5, R);
  assert.equal(tf.cooldown, 0);
  let secondEjects = 0;
  for (let i = 0; i < 30; i++) {
    if (tf.update(0.1, R * 1.2, R).ejected) secondEjects++;
  }
  assert.equal(secondEjects, 1, "should eject again after cooldown");
});
test("computeEjectTarget pushes ship radially out to ejectFactor * radius", () => {
  const center = { x: -1e3, y: 100, z: -500 };
  const target = computeEjectTarget({ x: -1e3, y: 100, z: -380 }, center, R);
  const dist = Math.hypot(target.x - center.x, target.y - center.y, target.z - center.z);
  assert.ok(Math.abs(dist - R * TIDAL.ejectFactor) < 1e-4, `eject dist ${dist}`);
  assert.ok(target.z > center.z, "preserves outward direction");
  const fallback = computeEjectTarget(center, center, R);
  const fdist = Math.hypot(fallback.x - center.x, fallback.y - center.y, fallback.z - center.z);
  assert.ok(Math.abs(fdist - R * TIDAL.ejectFactor) < 1e-4);
});
