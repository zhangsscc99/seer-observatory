// Modular underwater canyon cliff blocks — 4 distinct procedural variants:
//   'straight' — stratified stepped rock wall with overhanging cornice
//   'concave'  — inward-curving cove rock mass
//   'convex'   — jutting geological buttress crag
//   'portal'   — cliff face with carved recessed archway cavern
// Built once per variant and shared across all rotated / stretched / stacked cliff instances!
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyVerticalAO, getOceanMaterials, normalizeForMerge } from './materials.ts';

export type CliffVariant = 'straight' | 'concave' | 'convex' | 'portal';

const cachedGeos = new Map<CliffVariant, THREE.BufferGeometry>();

function displaceRock(
  geo: THREE.BufferGeometry,
  ampX: number,
  ampY: number,
  ampZ: number,
  phase: number,
  peakTaper = 0.34,
): THREE.BufferGeometry {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const hFrac = Math.max(0, Math.min(1, y / 14.0));
    // Sculpt jagged sloped mountain ridges instead of flat rectangular tabletops!
    const taper = 1.0 - Math.pow(hFrac, 1.5) * peakTaper;
    const ridgeCrest = Math.pow(hFrac, 1.35) * (Math.sin(x * 0.42 + phase) * 2.1 + Math.cos(x * 0.85 - phase) * 0.9);
    const strata = Math.sin(y * 0.95 + phase) * 0.5 + Math.cos(y * 2.1 + x * 0.25) * 0.35;
    const ridge = Math.sin(x * 0.55 + z * 0.65 + phase) * Math.cos(y * 0.42 - x * 0.3);
    const edgeFactor = Math.min(1, y / 1.5);
    pos.setXYZ(
      i,
      x * taper + ridge * ampX * edgeFactor,
      y + (strata * ampY + ridgeCrest) * edgeFactor,
      z * taper + (strata * 0.55 + ridge * 0.65) * ampZ * edgeFactor,
    );
  }
  geo.computeVertexNormals();
  return geo;
}

function buildVariantGeo(variant: CliffVariant): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const W = 10.6;
  const H = 14.0;
  const D = 7.4;

  if (variant === 'straight') {
    // 3 stepped geological strata tiers forming a crisp faceted cliff face
    const lower = new THREE.BoxGeometry(W, H * 0.46, D, 3, 2, 2);
    lower.translate(0, H * 0.23, 0);
    displaceRock(lower, 0.55, 0.35, 0.65, 0.7);
    parts.push(lower);

    const mid = new THREE.BoxGeometry(W * 0.92, H * 0.36, D * 0.86, 3, 2, 2);
    mid.translate(0.15, H * 0.6, -0.35);
    displaceRock(mid, 0.6, 0.4, 0.72, 2.1);
    parts.push(mid);

    const crown = new THREE.BoxGeometry(W * 0.82, H * 0.28, D * 0.72, 3, 2, 1);
    crown.translate(-0.2, H * 0.88, -0.55);
    displaceRock(crown, 0.65, 0.5, 0.6, 3.8);
    parts.push(crown);
  } else if (variant === 'concave') {
    // Twin forward-curving flanking crags + recessed central bay wall
    const back = new THREE.BoxGeometry(W * 0.86, H * 0.96, D * 0.52, 3, 3, 1);
    back.translate(0, H * 0.48, -D * 0.22);
    displaceRock(back, 0.5, 0.4, 0.55, 1.4);
    parts.push(back);

    for (const sx of [-1, 1]) {
      const wing = new THREE.BoxGeometry(W * 0.38, H * (sx < 0 ? 1.02 : 0.9), D * 0.68, 2, 3, 2);
      wing.rotateY(sx * 0.28);
      wing.translate(sx * W * 0.34, H * 0.46, D * 0.14);
      displaceRock(wing, 0.52, 0.45, 0.62, sx < 0 ? 4.2 : 6.1);
      parts.push(wing);
    }
  } else if (variant === 'convex') {
    // Dramatic jutting central rocky prow + stepped buttress ribs
    const core = new THREE.CylinderGeometry(W * 0.34, W * 0.54, H, 6, 3);
    core.scale(1.02, 1.0, D / W);
    core.translate(0, H * 0.5, 0);
    displaceRock(core, 0.75, 0.45, 0.72, 2.9);
    parts.push(core);

    const prow = new THREE.BoxGeometry(W * 0.46, H * 0.74, D * 0.56, 2, 2, 2);
    prow.rotateY(0.18);
    prow.translate(0.3, H * 0.37, D * 0.24);
    displaceRock(prow, 0.48, 0.42, 0.55, 5.2);
    parts.push(prow);
  } else {
    // 'portal': cliff crag with recessed carved stone archway cave alcove
    const backing = new THREE.BoxGeometry(W, H, D * 0.52, 3, 3, 1);
    backing.translate(0, H * 0.5, -D * 0.24);
    displaceRock(backing, 0.55, 0.42, 0.45, 1.8);
    parts.push(backing);

    for (const sx of [-1, 1]) {
      const flank = new THREE.BoxGeometry(W * 0.31, H * 0.92, D * 0.54, 2, 2, 1);
      flank.translate(sx * W * 0.34, H * 0.46, D * 0.2);
      displaceRock(flank, 0.42, 0.32, 0.42, sx < 0 ? 2.6 : 4.9);
      parts.push(flank);
    }
    const brow = new THREE.BoxGeometry(W * 0.94, H * 0.36, D * 0.62, 3, 1, 1);
    brow.translate(0, H * 0.82, D * 0.16);
    displaceRock(brow, 0.55, 0.45, 0.55, 7.1);
    parts.push(brow);

    const shape = new THREE.Shape();
    shape.moveTo(-2.5, 0);
    shape.lineTo(-2.5, 5.6);
    shape.lineTo(2.5, 5.6);
    shape.lineTo(2.5, 0);
    shape.lineTo(1.75, 0);
    shape.lineTo(1.75, 3.2);
    shape.absarc(0, 3.2, 1.75, 0, Math.PI, false);
    shape.lineTo(-1.75, 0);
    shape.closePath();
    const frame = new THREE.ExtrudeGeometry(shape, { depth: 1.1, bevelEnabled: false, curveSegments: 7 });
    frame.translate(0, 0.2, D * 0.36);
    parts.push(frame);
  }

  const normalized = parts.map((g) => {
    const n = normalizeForMerge(g);
    g.dispose();
    return n;
  });
  const merged = mergeGeometries(normalized, false);
  normalized.forEach((g) => g.dispose());
  if (!merged) throw new Error(`Failed to merge cliff variant ${variant}`);
  applyVerticalAO(merged, 0, H, new THREE.Color(0x305560), new THREE.Color(0xc4dedc));
  merged.computeBoundingBox();
  return merged;
}

export function getCliffGeometry(variant: CliffVariant): THREE.BufferGeometry {
  let geo = cachedGeos.get(variant);
  if (!geo) {
    geo = buildVariantGeo(variant);
    cachedGeos.set(variant, geo);
  }
  return geo;
}

export function createCliffModule(variant: CliffVariant, mirror = false): THREE.Mesh {
  const geo = getCliffGeometry(variant);
  const mats = getOceanMaterials();
  const mesh = new THREE.Mesh(geo, mats.cliffRock);
  if (mirror) mesh.scale.x = -1;
  return mesh;
}
