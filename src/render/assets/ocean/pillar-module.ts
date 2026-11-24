// Modular Doric column (`pillar-module`) — strictly stacked from 1, 2, or 3
// discrete segments (NEVER non-uniformly stretched!).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyVerticalAO, getOceanMaterials, normalizeForMerge } from './materials.ts';

const cachedGeos = new Map<number, THREE.BufferGeometry>();

function buildDoricGeo(segments: 1 | 2 | 3): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Base plinth + stepped torus collar (0 .. 0.60m)
  const plinth = new THREE.BoxGeometry(1.24, 0.34, 1.24);
  plinth.translate(0, 0.17, 0);
  parts.push(plinth);

  const torusBase = new THREE.CylinderGeometry(0.52, 0.58, 0.26, 16);
  torusBase.translate(0, 0.47, 0);
  parts.push(torusBase);

  // Discrete fluted Doric shaft drums (each 1.65m tall, gentle entasis taper)
  const segH = 1.65;
  let topY = 0.6;
  for (let s = 0; s < segments; s++) {
    const rBot = 0.48 - s * 0.025;
    const rTop = 0.48 - (s + 1) * 0.025;
    // 14-sided shaft gives crisp Doric fluting highlights
    const drum = new THREE.CylinderGeometry(rTop, rBot, segH, 14);
    drum.translate(0, topY + segH * 0.5, 0);
    parts.push(drum);

    // Subtle stone drum joint collar ring
    const seam = new THREE.CylinderGeometry(rBot + 0.02, rBot + 0.02, 0.07, 14);
    seam.translate(0, topY + 0.04, 0);
    parts.push(seam);

    topY += segH;
  }

  if (segments === 3) {
    // Intact Doric capital: necking ring + flaring echinus + square abacus
    const echinus = new THREE.CylinderGeometry(0.62, 0.41, 0.34, 16);
    echinus.translate(0, topY + 0.17, 0);
    parts.push(echinus);

    const abacus = new THREE.BoxGeometry(1.3, 0.28, 1.3);
    abacus.translate(0, topY + 0.46, 0);
    parts.push(abacus);
    topY += 0.6;
  } else {
    // Weathered broken top drum cap for 1- or 2-segment ruin columns
    const cap = new THREE.CylinderGeometry(0.36, 0.45, 0.32, 9);
    cap.rotateZ(0.24);
    cap.translate(0, topY + 0.1, 0);
    parts.push(cap);
    topY += 0.26;
  }

  const merged = mergeGeometries(
    parts.map((p) => {
      const n = normalizeForMerge(p);
      p.dispose();
      return n;
    }),
    false,
  )!;
  applyVerticalAO(merged, 0, topY, new THREE.Color(0x688288), new THREE.Color(0xedf2e6));
  return merged;
}

export function getPillarGeometry(segments: number): THREE.BufferGeometry {
  const segCount: 1 | 2 | 3 = segments <= 1 ? 1 : segments === 2 ? 2 : 3;
  let geo = cachedGeos.get(segCount);
  if (!geo) {
    geo = buildDoricGeo(segCount);
    geo.computeBoundingBox();
    cachedGeos.set(segCount, geo);
  }
  return geo;
}

export function createPillarModule(segments: number): THREE.Mesh {
  return new THREE.Mesh(getPillarGeometry(segments), getOceanMaterials().limestone);
}
