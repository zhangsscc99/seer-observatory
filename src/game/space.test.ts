import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hazardEffect, scanResult } from './scan.ts';
import { BINARY_STARS, PLANETS, SECTOR_RADIUS, TARGETS, planetById } from './space.ts';

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
  assert.equal(planetById('gas-storm')!.hazard, 'gravity');
  assert.equal(planetById('red-giant')!.hazard, 'radiation');
  assert.equal(planetById('binary')!.hazard, 'photon');
  assert.equal(planetById('blackhole')!.hazard, 'tidal');
});

test('icer: ice-ring planet registered and scannable', () => {
  const p = planetById('icer');
  assert.ok(p);
  assert.equal(p.kind, 'ice-ring');
  assert.equal(p.hazard, 'cold');
  assert.ok(TARGETS.includes('icer'));
  assert.equal(TARGETS.filter((id) => id === 'icer').length, 1);
});

test('gas-storm: gas-storm planet registered and scannable', () => {
  const p = planetById('gas-storm');
  assert.ok(p);
  assert.equal(p.kind, 'gas-storm');
  assert.equal(p.hazard, 'gravity');
  assert.ok(TARGETS.includes('gas-storm'));
  assert.equal(TARGETS.filter((id) => id === 'gas-storm').length, 1);
  const res = scanResult('gas-storm');
  assert.equal(res.resource, '风暴氦芯');
  assert.ok(res.amount >= 3 && res.amount <= 7, `amount ${res.amount}`);
  const len = [...res.log].length;
  assert.ok(len >= 20 && len <= 40, `log length ${len}`);
});

test('red-giant: red-giant star registered, largest body, scannable with radiation warn', () => {
  const p = planetById('red-giant');
  assert.ok(p);
  assert.equal(p.kind, 'red-giant');
  assert.equal(p.hazard, 'radiation');
  assert.ok(TARGETS.includes('red-giant'));
  assert.equal(TARGETS.filter((id) => id === 'red-giant').length, 1);
  for (const other of PLANETS) {
    if (other.id !== 'red-giant') assert.ok(p.radius > other.radius, `red-giant r=${p.radius} > ${other.id} r=${other.radius}`);
  }
  const res = scanResult('red-giant');
  assert.equal(res.resource, '红巨星等离子');
  assert.ok(res.amount >= 3 && res.amount <= 7, `amount ${res.amount}`);
  const len = [...res.log].length;
  assert.ok(len >= 20 && len <= 40, `log length ${len}`);
  assert.match(res.log, /辐射/);
  assert.match(res.log, /日冕/);
  assert.match(res.log, /尘埃幕/);
  const eff = hazardEffect(p.hazard);
  assert.ok(eff.warn && eff.warn.length > 0);
  assert.equal(eff.warn, '强辐射·护盾警报');
});

test('binary: binary system registered, scannable, photon hazard and twin stars valid', () => {
  const p = planetById('binary');
  assert.ok(p);
  assert.equal(p.kind, 'binary');
  assert.equal(p.hazard, 'photon');
  assert.ok(TARGETS.includes('binary'));
  assert.equal(TARGETS.filter((id) => id === 'binary').length, 1);
  const res = scanResult('binary');
  assert.equal(res.resource, '双星等离子');
  assert.ok(res.amount >= 3 && res.amount <= 7, `amount ${res.amount}`);
  const len = [...res.log].length;
  assert.ok(len >= 40, `log length ${len} < 40`);
  assert.notEqual(res.log[0], ' ');
  const eff = hazardEffect(p.hazard);
  assert.equal(eff.energyMul, 1.3);
  assert.equal(eff.warn, '双星光子场·回充 ×1.3');
  for (const other of PLANETS) {
    if (other.id === 'binary') continue;
    const d = Math.hypot(p.pos.x - other.pos.x, p.pos.y - other.pos.y, p.pos.z - other.pos.z);
    assert.ok(d > p.radius + other.radius + 100, `binary vs ${other.id}: ${d.toFixed(1)} <= ${p.radius + other.radius + 100}`);
  }
  assert.equal(BINARY_STARS.length, 2);
  assert.notEqual(BINARY_STARS[0].color, BINARY_STARS[1].color);
  for (const s of BINARY_STARS) {
    const dist = Math.hypot(s.pos.x, s.pos.y, s.pos.z);
    assert.ok(dist >= 1500 && dist <= 2600, `${s.id} dist ${dist.toFixed(1)}`);
    assert.ok(s.radius > 0 && s.intensity > 0);
  }
});

test('blackhole: registered, non-overlapping, tidal hazard, and scan log valid', () => {
  const p = planetById('blackhole');
  assert.ok(p);
  assert.equal(p.kind, 'blackhole');
  assert.equal(p.hazard, 'tidal');
  assert.ok(p.radius >= 90 && p.radius <= 120, `radius ${p.radius}`);
  assert.ok(TARGETS.includes('blackhole'));
  assert.equal(TARGETS.filter((id) => id === 'blackhole').length, 1);
  const res = scanResult('blackhole');
  assert.equal(res.resource, '引力波晶');
  assert.ok(res.amount >= 3 && res.amount <= 7, `amount ${res.amount}`);
  const len = [...res.log].length;
  assert.ok(len >= 40, `log length ${len} < 40`);
  assert.match(res.log, /吸积盘/);
  assert.match(res.log, /时间膨胀/);
  assert.match(res.log, /光子环/);
  const eff = hazardEffect(p.hazard);
  assert.equal(eff.energyMul, 0.7);
  assert.equal(eff.warn, '潮汐力场·回充 ×0.7');
  for (const other of PLANETS) {
    if (other.id === 'blackhole') continue;
    const d = Math.hypot(p.pos.x - other.pos.x, p.pos.y - other.pos.y, p.pos.z - other.pos.z);
    assert.ok(d > p.radius + other.radius + 100, `blackhole vs ${other.id}: ${d.toFixed(1)} <= ${p.radius + other.radius + 100}`);
  }
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
