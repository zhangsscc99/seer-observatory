import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModeMachine, TRANSIT } from './mode.ts';

test('launch is gated on proximity and only from the cabin', () => {
  const m = new ModeMachine();
  assert.equal(m.requestLaunch(false), false);
  assert.equal(m.mode, 'cabin');
  assert.equal(m.requestDock(), false);
  assert.equal(m.requestLaunch(true), true);
  assert.equal(m.mode, 'transit');
  assert.equal(m.requestLaunch(true), false, 'no re-entry mid-transit');
  assert.equal(m.requestDock(), false);
});

test('launch timeline: 0.8 s thrust in cabin → fade → swap once → arrive in space', () => {
  const log: string[] = [];
  const m = new ModeMachine('cabin', { onSwap: (to) => log.push(`swap:${to}`), onArrive: (at) => log.push(`arrive:${at}`) });
  m.requestLaunch(true);
  m.update(0.4);
  assert.equal(m.scene, 'cabin');
  assert.equal(m.thrust, 0.5);
  assert.equal(m.fade, 0);
  m.update(0.4 + TRANSIT.fadeOut / 2);
  assert.equal(m.scene, 'cabin');
  assert.ok(Math.abs(m.fade - 0.5) < 1e-6);
  m.update(TRANSIT.fadeOut / 2 + 0.001);
  assert.equal(m.scene, 'space');
  assert.ok(m.fade > 0.9);
  assert.deepEqual(log, ['swap:space']);
  for (let i = 0; i < 60; i++) m.update(1 / 60);
  assert.equal(m.mode, 'space');
  assert.equal(m.fade, 0);
  assert.deepEqual(log, ['swap:space', 'arrive:space']);
});

test('dock: no thrust phase, returns to cabin, round-trips', () => {
  const m = new ModeMachine('space');
  assert.equal(m.requestDock(), true);
  assert.equal(m.thrust, 0);
  assert.equal(m.duration, TRANSIT.fadeOut + TRANSIT.fadeIn);
  m.update(TRANSIT.fadeOut + 0.01);
  assert.equal(m.scene, 'cabin');
  m.update(TRANSIT.fadeIn);
  assert.equal(m.mode, 'cabin');
  assert.equal(m.requestLaunch(true), true);
});

test('a huge dt still swaps exactly once and lands', () => {
  let swaps = 0;
  const m = new ModeMachine('cabin', { onSwap: () => swaps++ });
  m.requestLaunch(true);
  m.update(10);
  assert.equal(swaps, 1);
  assert.equal(m.mode, 'space');
});
