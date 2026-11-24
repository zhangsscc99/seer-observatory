// Underwater flora (`kelp` — 2 variants: tall 'ribbon' & leafy 'frond') plus
// procedural seabed rubble rock geometry for deterministic off-path scattering.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyVerticalAO, getOceanMaterials, normalizeForMerge } from './materials.ts';

export type KelpVariant = 'ribbon' | 'frond';

const cachedKelpGeos = new Map<KelpVariant, THREE.BufferGeometry>();
let cachedRubbleShard: THREE.BufferGeometry | null = null;
let cachedRubbleBoulder: THREE.BufferGeometry | null = null;

function buildRibbonBlade(height: number, width: number, curve: number, twist: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(width, height, 1, 4);
  g.translate(0, height * 0.5, 0);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const t = Math.max(0, Math.min(1, y / height));
    // Graceful taper toward blade tip + organic underwater wave bend
    const taper = Math.sin(Math.min(1, t * 0.92 + 0.08) * Math.PI * 0.85);
    const bx = x * taper;
    const ang = t * twist;
    const sway = Math.sin(t * Math.PI * 1.45) * curve;
    const nx = bx * Math.cos(ang) + sway;
    const nz = bx * Math.sin(ang) + Math.pow(t, 1.8) * curve * 0.7;
    pos.setXYZ(i, nx, y, nz);
  }
  g.computeVertexNormals();
  return g;
}

export function getKelpGeometry(variant: KelpVariant): THREE.BufferGeometry {
  const cached = cachedKelpGeos.get(variant);
  if (cached) return cached;

  const parts: THREE.BufferGeometry[] = [];
  if (variant === 'ribbon') {
    // 5 tall twisting emerald kelp ribbons fanning out from a rock crevice
    const specs: [number, number, number, number, number][] = [
      [3.1, 0.34, 0.35, 1.3, 0.0],
      [2.65, 0.3, 0.42, -1.1, 1.25],
      [2.35, 0.28, 0.38, 1.4, 2.5],
      [2.85, 0.32, 0.44, -1.2, 3.8],
      [1.95, 0.26, 0.32, 1.0, 5.05],
    ];
    for (const [h, w, curve, twist, rotY] of specs) {
      const b = buildRibbonBlade(h, w, curve, twist);
      b.rotateY(rotY);
      b.translate(Math.sin(rotY) * 0.16, 0, Math.cos(rotY) * 0.16);
      parts.push(b);
    }
  } else {
    // 'frond': shorter broad sea-fern cluster (6 arched fronds)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + (i % 2) * 0.25;
      const h = 1.25 + (i % 3) * 0.28;
      const b = buildRibbonBlade(h, 0.46, 0.55, 0.45);
      b.rotateX(0.32);
      b.rotateY(a);
      parts.push(b);
    }
  }

  const merged = mergeGeometries(
    parts.map((p) => {
      const n = normalizeForMerge(p);
      p.dispose();
      return n;
    }),
    false,
  )!;
  applyVerticalAO(
    merged,
    0,
    variant === 'ribbon' ? 3.1 : 1.8,
    new THREE.Color(0x16443a),
    new THREE.Color(0x52c88e),
  );
  cachedKelpGeos.set(variant, merged);
  return merged;
}

export function createKelpModule(variant: KelpVariant): THREE.Mesh {
  return new THREE.Mesh(getKelpGeometry(variant), getOceanMaterials().kelp);
}

export function getRubbleGeometry(variant: 'shard' | 'boulder'): THREE.BufferGeometry {
  if (variant === 'shard') {
    if (!cachedRubbleShard) {
      const g = new THREE.DodecahedronGeometry(0.65, 0);
      g.scale(1.1, 0.72, 0.85);
      g.translate(0, 0.35, 0);
      applyVerticalAO(g, 0, 0.85, new THREE.Color(0x284852), new THREE.Color(0x88b4b4));
      cachedRubbleShard = g;
    }
    return cachedRubbleShard;
  }
  if (!cachedRubbleBoulder) {
    const g = new THREE.IcosahedronGeometry(0.75, 0);
    g.scale(1.25, 0.62, 1.05);
    g.translate(0, 0.3, 0);
    applyVerticalAO(g, 0, 0.8, new THREE.Color(0x24424c), new THREE.Color(0x7aa4a6));
    cachedRubbleBoulder = g;
  }
  return cachedRubbleBoulder;
}
