import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOCK, Docker, dockReward, dockState } from './dock.ts';

const DT = 0.1;
const R = 130;
const types = (evs: { type: string }[]): string[] => evs.map((e) => e.type);

test('dockState zone boundaries: far / approach / hold', () => {
  assert.equal(dockState(R * 2.21, R, 0), 'far');
  assert.equal(dockState(R * 2.2, R, 0), 'approach');
  assert.equal(dockState(R * 1.9, R, 0), 'approach');
  assert.equal(dockState(R * 1.71, R, 0), 'approach');
  assert.equal(dockState(R * 1.7, R, 20), 'hold');
  assert.equal(dockState(R * 1.2, R, 0), 'hold');
});

test('dockState: too fast inside 1.7R never gives hold', () => {
  assert.equal(dockState(R * 1.5, R, DOCK.maxSpeed + 0.1), 'approach');
  assert.equal(dockState(R * 1.5, R, DOCK.maxSpeed), 'hold');
  assert.equal(dockState(R * 1.01, R, 200), 'approach');
});

test('dockState: accumulated hold promotes to docked at 2.5 s', () => {
  assert.equal(dockState(R * 1.5, R, 0, DOCK.holdTime - 0.01), 'hold');
  assert.equal(dockState(R * 1.5, R, 0, DOCK.holdTime), 'docked');
});

test('holding ~2.5 s docks exactly once, then stays docked', () => {
  const d = new Docker();
  let docked = 0;
  for (let i = 0; i < 40; i++) {
    for (const e of d.update(DT, R * 1.5, R, 0)) if (e.type === 'docked') docked++;
  }
  assert.equal(docked, 1);
  assert.equal(d.docks, 1);
  assert.equal(d.state, 'docked');
  assert.equal(d.progress, 1);
});

test('approach fires enter; leaving fires leave and decays progress, never resets', () => {
  const d = new Docker();
  assert.deepEqual(types(d.update(DT, R * 2.0, R, 0)), ['enter']);
  for (let i = 0; i < 15; i++) d.update(DT, R * 1.5, R, 0); // ~1.5 s of hold
  const held = d.progress;
  assert.ok(held > 0.4 && held < 0.7, `progress ${held}`);
  const evs = d.update(DT, R * 2.0, R, 0);
  assert.ok(types(evs).includes('leave'));
  assert.equal(d.state, 'approach');
  const decayed = d.progress;
  assert.ok(decayed > 0 && decayed < held, `decayed ${decayed} < ${held}`);
  // out of range also decays, keeps partial credit
  d.update(DT, R * 2.5, R, 0);
  assert.equal(d.state, 'far');
  const afterFar = d.progress;
  assert.ok(afterFar > 0 && afterFar < decayed, `far-decayed ${afterFar} < ${decayed}`);
  // re-entering hold resumes from the decayed value, not from zero
  d.update(DT, R * 1.5, R, 0);
  assert.ok(d.progress > afterFar);
});

test('fast pass through the hold zone accumulates nothing', () => {
  const d = new Docker();
  for (let i = 0; i < 40; i++) d.update(DT, R * 1.5, R, DOCK.maxSpeed + 5);
  assert.equal(d.state, 'approach');
  assert.equal(d.progress, 0);
  assert.equal(d.docks, 0);
});

test('cooldown: after docking, re-approach within 60 s only reaches hold — no reward', () => {
  const d = new Docker();
  while (d.docks === 0) d.update(DT, R * 1.5, R, 0);
  assert.equal(d.cooldown, DOCK.cooldown);
  // leave → progress decays, then come back while still cooling
  for (let i = 0; i < 20; i++) d.update(DT, R * 2.5, R, 0);
  let docked = 0;
  for (let i = 0; i < 40; i++) {
    for (const e of d.update(DT, R * 1.5, R, 0)) if (e.type === 'docked') docked++;
    assert.notEqual(d.state, 'docked');
    assert.equal(d.state, 'hold');
  }
  assert.equal(docked, 0);
  assert.equal(d.progress, 1); // hold still saturates, just no reward/state upgrade
});

test('after cooldown expires, a fresh hold docks again and pays out once more', () => {
  const d = new Docker();
  while (d.docks === 0) d.update(DT, R * 1.5, R, 0);
  // wait out the cooldown in open space
  for (let i = 0; i < (DOCK.cooldown / DT) * 1.05; i++) d.update(DT, R * 2.5, R, 0);
  assert.equal(d.cooldown, 0);
  assert.equal(d.progress, 0);
  let docked = 0;
  for (let i = 0; i < 40; i++) {
    for (const e of d.update(DT, R * 1.5, R, 0)) if (e.type === 'docked') docked++;
  }
  assert.equal(docked, 1);
  assert.equal(d.docks, 2);
});

test('dockReward: refuel + 环城通行密钥 + >= 40 字 observation log', () => {
  const r = dockReward();
  assert.equal(r.refuel, true);
  assert.equal(r.resource, '环城通行密钥');
  assert.ok(r.amount >= 1);
  assert.ok([...r.log].length >= 40, `log length ${[...r.log].length}`);
});
