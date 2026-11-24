// Circular sanctuary altar / glowing fountain dais (`altar-module`, diameter 6m)
// sitting at the heart of the central shallow water plaza.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyVerticalAO, getOceanMaterials, normalizeForMerge } from './materials.ts';

export function createAltarModule(radius = 3.0): THREE.Group {
  const mats = getOceanMaterials();
  const g = new THREE.Group();

  const stoneParts: THREE.BufferGeometry[] = [];

  // Stepped concentric stone dais (walkable outer rim top at y = 0.34m matching `surf-altar-rim`!)
  const step1 = new THREE.CylinderGeometry(radius, radius + 0.22, 0.18, 32);
  step1.translate(0, 0.09, 0);
  stoneParts.push(step1);

  const step2 = new THREE.CylinderGeometry(radius * 0.84, radius * 0.88, 0.16, 32);
  step2.translate(0, 0.26, 0);
  stoneParts.push(step2);

  // Carved central fountain basin rim wall (r = 1.42m, height 0.78m)
  const basinRim = new THREE.TorusGeometry(1.32, 0.22, 8, 28);
  basinRim.rotateX(Math.PI / 2);
  basinRim.translate(0, 0.58, 0);
  stoneParts.push(basinRim);

  const basinWall = new THREE.CylinderGeometry(1.42, 1.48, 0.54, 24);
  basinWall.translate(0, 0.32, 0);
  stoneParts.push(basinWall);

  // 6 carved radial stone plinth bosses around the fountain rim
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const boss = new THREE.BoxGeometry(0.42, 0.44, 0.58);
    boss.rotateY(a);
    boss.translate(Math.sin(a) * 1.45, 0.52, Math.cos(a) * 1.45);
    stoneParts.push(boss);
  }

  // Central inner crystal socket pedestal
  const socket = new THREE.CylinderGeometry(0.42, 0.58, 0.55, 8);
  socket.translate(0, 0.72, 0);
  stoneParts.push(socket);

  const mergedStone = mergeGeometries(
    stoneParts.map((p) => {
      const n = normalizeForMerge(p);
      p.dispose();
      return n;
    }),
    false,
  )!;
  applyVerticalAO(mergedStone, 0, 1.0, new THREE.Color(0x5b7c82), new THREE.Color(0xf2efe0));
  g.add(new THREE.Mesh(mergedStone, mats.paving));

  // Glowing golden fountain pool + central faceted golden crystal obelisk!
  const glowParts: THREE.BufferGeometry[] = [];
  const pool = new THREE.CylinderGeometry(1.18, 1.18, 0.08, 24);
  pool.translate(0, 0.62, 0);
  glowParts.push(pool);

  // Outer carved golden rune ring inlaid in the stepped dais
  const runeRing = new THREE.TorusGeometry(2.05, 0.055, 6, 36);
  runeRing.rotateX(Math.PI / 2);
  runeRing.translate(0, 0.36, 0);
  glowParts.push(runeRing);

  // Central heroic warm golden crystal spire + flanking shards
  const mainShard = new THREE.ConeGeometry(0.36, 1.85, 6);
  mainShard.translate(0, 1.78, 0);
  glowParts.push(mainShard);

  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const sub = new THREE.ConeGeometry(0.18, 1.05, 6);
    sub.rotateZ(0.28);
    sub.rotateY(a);
    sub.translate(Math.sin(a) * 0.34, 1.28, Math.cos(a) * 0.34);
    glowParts.push(sub);
  }

  const mergedGlow = mergeGeometries(
    glowParts.map((p) => {
      const n = normalizeForMerge(p, undefined, false);
      p.dispose();
      return n;
    }),
    false,
  )!;
  g.add(new THREE.Mesh(mergedGlow, mats.warmCrystal));

  return g;
}
