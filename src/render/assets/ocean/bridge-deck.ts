// Tileable stone bridge deck unit (`bridge-deck`) — 2.4m clear width, 3.0m unit
// length with un-stretched vertical balustrade posts spaced every 3.0m, warm
// golden curb inlay strips, underside corbel arches, and optional stone piers.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyVerticalAO, getOceanMaterials, normalizeForMerge } from './materials.ts';

export interface BridgeDeckOpts {
  width: number;
  length: number;
  yStart: number;
  yEnd: number;
  hasPier: boolean;
  pierHeight: number;
}

/** Shear a BoxGeometry vertically along local Z so its top surface lies on
 *  the exact linear ramp y(z) = (z / length) * dy while keeping end faces plumb. */
function makeSlopedBox(w: number, h: number, len: number, dy: number, yOffset: number, xOffset = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, len, 1, 1, 2);
  g.translate(xOffset, yOffset, 0);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const t = z / Math.max(0.01, len); // -0.5 .. +0.5
    pos.setY(i, pos.getY(i) + t * dy);
  }
  g.computeVertexNormals();
  return g;
}

export function createBridgeDeck(opts: BridgeDeckOpts): THREE.Group {
  const mats = getOceanMaterials();
  const g = new THREE.Group();
  const W = opts.width; // 2.4m clear deck width
  const L = opts.length; // ~3.0m + slight overlap
  const dy = opts.yEnd - opts.yStart;
  const halfW = W * 0.5;
  const slabH = 0.52;

  const stoneParts: THREE.BufferGeometry[] = [];
  const trimParts: THREE.BufferGeometry[] = [];

  // Main sloped flagstone bridge deck slab — top surface sits at EXACT local y = (z/L)*dy!
  const deck = makeSlopedBox(W + 0.16, slabH, L, dy, -slabH * 0.5);
  stoneParts.push(deck);

  // Under-deck carved arch fascia + corbel molding along both sides
  for (const sx of [-1, 1]) {
    const curbX = sx * (halfW + 0.16);
    // Low stone parapet curb running along deck edge (0.34m above deck)
    const curb = makeSlopedBox(0.28, 0.42, L, dy, 0.14, curbX);
    stoneParts.push(curb);

    // Underside projecting cornice lip
    const cornice = makeSlopedBox(0.32, 0.24, L, dy, -slabH - 0.1, curbX);
    stoneParts.push(cornice);

    // Recessed warm amber-gold bridge light strip (signature detail from concept art!)
    const goldStrip = makeSlopedBox(0.07, 0.12, L * 0.92, dy * 0.92, -0.14, sx * (halfW + 0.31));
    trimParts.push(goldStrip);

    // Strictly UN-STRETCHED vertical carved stone balustrade post (1 pair per 3m unit!)
    // Placed at local z = 0 (3.0m center-to-center spacing along the bridge!)
    const postBase = new THREE.BoxGeometry(0.38, 0.24, 0.38);
    postBase.translate(curbX, 0.34, 0);
    stoneParts.push(postBase);

    const postShaft = new THREE.BoxGeometry(0.28, 0.62, 0.28);
    postShaft.translate(curbX, 0.72, 0);
    stoneParts.push(postShaft);

    const postCap = new THREE.BoxGeometry(0.4, 0.14, 0.4);
    postCap.translate(curbX, 1.06, 0);
    stoneParts.push(postCap);
  }

  // Optional aqueduct stone support pier extending straight down into the seabed
  if (opts.hasPier && opts.pierHeight > 1.2) {
    const ph = opts.pierHeight + 0.35;
    const pierShaft = new THREE.CylinderGeometry(0.58, 0.74, ph, 10);
    pierShaft.translate(0, -slabH - ph * 0.5 + 0.15, 0);
    stoneParts.push(pierShaft);

    // Pier capital bracket under deck
    const bracket = new THREE.BoxGeometry(W + 0.45, 0.5, 1.25);
    bracket.translate(0, -slabH - 0.22, 0);
    stoneParts.push(bracket);

    // Grounded pier plinth collar at seabed
    const foot = new THREE.CylinderGeometry(0.86, 1.02, 0.65, 10);
    foot.translate(0, -opts.pierHeight + 0.1, 0);
    stoneParts.push(foot);
  }

  const mergedStone = mergeGeometries(
    stoneParts.map((p) => {
      const n = normalizeForMerge(p);
      p.dispose();
      return n;
    }),
    false,
  )!;
  applyVerticalAO(
    mergedStone,
    opts.hasPier ? -opts.pierHeight : -0.8,
    1.15,
    new THREE.Color(0x637e84),
    new THREE.Color(0xf0eedb),
  );
  const stoneMesh = new THREE.Mesh(mergedStone, mats.paving);
  stoneMesh.name = 'bridge-stone';
  g.add(stoneMesh);

  const mergedTrim = mergeGeometries(
    trimParts.map((p) => {
      const n = normalizeForMerge(p, undefined, false);
      p.dispose();
      return n;
    }),
    false,
  )!;
  const trimMesh = new THREE.Mesh(mergedTrim, mats.bridgeGoldTrim);
  trimMesh.name = 'bridge-gold-trim';
  g.add(trimMesh);

  return g;
}
