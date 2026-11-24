// Emissive faceted crystal cluster (`crystal-cluster`) — 2 color variants:
//   'warm' — golden-amber emissive crystals (spire crowns, cliff lanterns, pedestals)
//   'cool' — aqua-cyan emissive crystals (cool foreground & rock crevice accents)
// Exports both single mesh factory AND shared geometry for InstancedMesh scatter.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyVerticalAO, getOceanMaterials } from './materials.ts';

export type CrystalVariant = 'warm' | 'cool';

let cachedShardGeo: THREE.BufferGeometry | null = null;
let cachedPlinthGeo: THREE.BufferGeometry | null = null;

function makeHexShard(radius: number, height: number): THREE.BufferGeometry {
  const shaftH = height * 0.68;
  const tipH = height * 0.32;
  const shaft = new THREE.CylinderGeometry(radius * 0.85, radius, shaftH, 6, 1, false);
  shaft.translate(0, shaftH * 0.5, 0);
  const tip = new THREE.ConeGeometry(radius * 0.85, tipH, 6);
  tip.translate(0, shaftH + tipH * 0.5, 0);
  const g = mergeGeometries([shaft.toNonIndexed(), tip.toNonIndexed()], false)!;
  shaft.dispose();
  tip.dispose();
  return g;
}

export function getCrystalClusterGeometry(): THREE.BufferGeometry {
  if (cachedShardGeo) return cachedShardGeo;
  const specs: [number, number, number, number, number, number, number][] = [
    // [r, h, tx, ty, tz, rx, rz]
    [0.34, 2.05, 0.0, 0.0, 0.0, 0.06, -0.08],
    [0.24, 1.45, 0.36, -0.05, 0.22, 0.24, -0.34],
    [0.22, 1.32, -0.34, -0.05, 0.24, 0.26, 0.38],
    [0.2, 1.18, 0.14, -0.08, -0.38, -0.36, -0.18],
    [0.18, 0.96, -0.32, -0.08, -0.26, -0.28, 0.42],
  ];
  const parts = specs.map(([r, h, tx, ty, tz, rx, rz]) => {
    const s = makeHexShard(r, h);
    s.rotateX(rx);
    s.rotateZ(rz);
    s.translate(tx, ty, tz);
    return s;
  });
  cachedShardGeo = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  // Rich base-to-tip crystal translucency gradient so clusters read 3D and jewel-like
  applyVerticalAO(cachedShardGeo, -0.1, 2.05, new THREE.Color(0x5a7078), new THREE.Color(0xffffff));
  return cachedShardGeo;
}

export function getCrystalPlinthGeometry(): THREE.BufferGeometry {
  if (cachedPlinthGeo) return cachedPlinthGeo;
  const base = new THREE.DodecahedronGeometry(0.68, 0);
  base.scale(1.15, 0.45, 1.05);
  base.translate(0, 0.05, 0);
  base.computeBoundingBox();
  cachedPlinthGeo = base;
  return cachedPlinthGeo;
}

export function createCrystalCluster(variant: CrystalVariant, withBase = true): THREE.Group {
  const mats = getOceanMaterials();
  const g = new THREE.Group();
  const shards = new THREE.Mesh(
    getCrystalClusterGeometry(),
    variant === 'warm' ? mats.warmCrystal : mats.coolCrystal,
  );
  g.add(shards);
  if (withBase) {
    const base = new THREE.Mesh(getCrystalPlinthGeometry(), mats.darkTrim);
    g.add(base);
  }
  return g;
}
