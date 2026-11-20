import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addScan, emptyArchive, parseArchive, serializeArchive, totalScans } from './archive.ts';

const kelos = { id: 'kelos', name: '克洛斯星', resource: '重水样本', amount: 5 };

test('addScan accumulates scan counts and resource totals immutably', () => {
  const a0 = emptyArchive();
  const a1 = addScan(a0, kelos, 1000);
  assert.equal(a1.scans.kelos.scans, 1);
  assert.equal(a1.scans.kelos.name, '克洛斯星');
  assert.equal(a1.scans.kelos.last, 1000);
  assert.equal(a1.resources['重水样本'], 5);
  assert.equal(totalScans(a1), 1);
  const a2 = addScan(a1, kelos, 2000);
  assert.equal(a2.scans.kelos.scans, 2);
  assert.equal(a2.scans.kelos.last, 2000);
  assert.equal(a2.resources['重水样本'], 10);
  const a3 = addScan(a2, { id: 'volc', name: '火山星', resource: '硫化物', amount: 4 }, 3000);
  assert.equal(totalScans(a3), 3);
  assert.equal(a3.resources['硫化物'], 4);
  // original untouched
  assert.equal(a0.scans.kelos, undefined);
  assert.equal(a1.scans.kelos.scans, 1);
});

test('parseArchive never throws: bad JSON / missing fields → empty archive', () => {
  assert.deepEqual(parseArchive('not json'), emptyArchive());
  assert.deepEqual(parseArchive(null), emptyArchive());
  assert.deepEqual(parseArchive('42'), emptyArchive());
  assert.deepEqual(parseArchive('"str"'), emptyArchive());
  assert.deepEqual(parseArchive('{"scans":{}}'), emptyArchive());
  assert.deepEqual(parseArchive('{"resources":{}}'), emptyArchive());
  assert.deepEqual(parseArchive('[]'), emptyArchive());
});

test('serialize → parse round-trips', () => {
  let a = emptyArchive();
  a = addScan(a, kelos, 111);
  a = addScan(a, { id: 'seron', name: '塞西利亚星', resource: '冰晶', amount: 6 }, 222);
  assert.deepEqual(parseArchive(serializeArchive(a)), a);
});

test('parseArchive sanitises malformed entries without throwing', () => {
  const a = parseArchive('{"scans":{"x":{"id":"x","name":null,"scans":"q","last":1,"resource":"r","amount":2},"bad":7},"resources":{"r":"oops","ok":3}}');
  assert.equal(a.scans.x.scans, 0);
  assert.equal(a.scans.x.amount, 2);
  assert.equal(a.resources.r, 0);
  assert.equal(a.resources.ok, 3);
});
