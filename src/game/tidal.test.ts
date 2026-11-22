import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIDAL, TidalField, computeEjectTarget, tidalState } from './tidal.ts';

const R = 100;

test('tidalState classifies safe / hazard / crush with monotonic timeScale', () => {
  const far = tidalState(R * 4.0, R);
  assert.equal(far.zone, 'safe');
  assert.equal(far.timeScale, 1.0);

  const edgeSafe = tidalState(R * 3.21, R);
  assert.equal(edgeSafe.zone, 'safe');
  assert.equal(edgeSafe.timeScale, 1.0);

  const outerHaz = tidalState(R * 3.2, R);
  assert.equal(outerHaz.zone, 'hazard');
  assert.ok(Math.abs(outerHaz.timeScale - 1.2) < 1e-6);

  const midHaz = tidalState(R * 2.4, R);
  assert.equal(midHaz.zone, 'hazard');
  assert.ok(Math.abs(midHaz.timeScale - 1.8) < 1e-6);

  const innerHaz = tidalState(R * 1.6, R);
  assert.equal(innerHaz.zone, 'hazard');
  assert.ok(Math.abs(innerHaz.timeScale - 2.4) < 1e-6);

  const crush = tidalState(R * 1.3, R);
  assert.equal(crush.zone, 'crush');
  assert.ok(crush.timeScale > 2.4 && crush.timeScale <= TIDAL.crushTimeMax);

  // guard degenerate radius
  assert.deepEqual(tidalState(50, 0), { zone: 'safe', timeScale: 1.0 });
});

test('crush accumulates tension and leaving decays it without ejecting', () => {
  const tf = new TidalField();
  // enter crush briefly (~1.0s < threshold ~2.22s)
  for (let i = 0; i < 10; i++) {
    const s = tf.update(0.1, R * 1.3, R);
    assert.equal(s.zone, 'crush');
    assert.equal(s.ejected, false);
  }
  const peak = tf.tension;
  assert.ok(peak > 0.35 && peak < 0.6, `peak tension ${peak}`);

  // pull back into hazard: tension decays toward 0
  for (let i = 0; i < 5; i++) {
    const s = tf.update(0.1, R * 2.0, R);
    assert.equal(s.zone, 'hazard');
    assert.equal(s.ejected, false);
  }
  assert.ok(tf.tension < peak && tf.tension > 0, `decayed ${tf.tension} < ${peak}`);

  // stay outside until fully decayed
  for (let i = 0; i < 10; i++) tf.update(0.1, R * 3.5, R);
  assert.equal(tf.tension, 0);
});

test('staying in crush triggers ejected once, starts cooldown, and repeated re-entry does not spam', () => {
  const tf = new TidalField();
  let ejects = 0;
  for (let i = 0; i < 30; i++) {
    const s = tf.update(0.1, R * 1.2, R);
    if (s.ejected) ejects++;
  }
  assert.equal(ejects, 1, 'should eject exactly once');
  assert.equal(tf.tension, 0);
  assert.ok(tf.cooldown > 0, `cooldown active: ${tf.cooldown}`);

  // immediately re-entering crush repeatedly during cooldown must NOT re-trigger or build tension
  for (let i = 0; i < 15; i++) {
    const s = tf.update(0.1, R * 1.15, R);
    assert.equal(s.ejected, false);
    assert.equal(s.tension, 0);
  }
  assert.ok(tf.cooldown > 0);

  // let cooldown finish completely
  for (let i = 0; i < 20; i++) tf.update(0.1, R * 2.5, R);
  assert.equal(tf.cooldown, 0);

  // re-entering crush after cooldown can accumulate and trigger ejected again
  let secondEjects = 0;
  for (let i = 0; i < 30; i++) {
    if (tf.update(0.1, R * 1.2, R).ejected) secondEjects++;
  }
  assert.equal(secondEjects, 1, 'should eject again after cooldown');
});

test('computeEjectTarget pushes ship radially out to ejectFactor * radius', () => {
  const center = { x: -1000, y: 100, z: -500 };
  const target = computeEjectTarget({ x: -1000, y: 100, z: -380 }, center, R);
  const dist = Math.hypot(target.x - center.x, target.y - center.y, target.z - center.z);
  assert.ok(Math.abs(dist - R * TIDAL.ejectFactor) < 1e-4, `eject dist ${dist}`);
  assert.ok(target.z > center.z, 'preserves outward direction');

  // degenerate same-point fallback still lands at ejectFactor * radius
  const fallback = computeEjectTarget(center, center, R);
  const fdist = Math.hypot(fallback.x - center.x, fallback.y - center.y, fallback.z - center.z);
  assert.ok(Math.abs(fdist - R * TIDAL.ejectFactor) < 1e-4);
});
