// Semi-circular & circular stepped ruin terrace platforms (`terrace-module`) —
// stacked 3 tiers (0 / 1.6 / 3.2m) on the right midground + full-disc landings.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyVerticalAO, getOceanMaterials, normalizeForMerge } from './materials.ts';

export interface TerraceOpts {
  radius: number;
  height: number;
  fullDisc?: boolean;
  tier?: number;
}

export function createTerraceModule(opts: TerraceOpts): THREE.Group {
  const mats = getOceanMaterials();
  const g = new THREE.Group();
  const R = opts.radius;
  const H = Math.max(0.14, opts.height);
  const full = Boolean(opts.fullDisc);

  // Semi-circle faces local +Z (thetaStart = -PI/2, thetaLength = PI in Three CylinderGeometry where 0 = +Z!)
  const thetaStart = full ? 0 : -Math.PI * 0.56;
  const thetaLen = full ? Math.PI * 2 : Math.PI * 1.12;
  const segs = full ? 28 : 24;

  const stoneParts: THREE.BufferGeometry[] = [];

  // Main cylindrical masonry drum (top surface at EXACT local y = H!)
  const drum = new THREE.CylinderGeometry(R, R + 0.28, H, segs, 1, false, thetaStart, thetaLen);
  drum.translate(0, H * 0.5, 0);
  stoneParts.push(drum);

  // Projecting sculpted rim cornice right at top edge
  const corniceH = Math.min(0.24, H);
  const cornice = new THREE.CylinderGeometry(R + 0.22, R + 0.08, corniceH, segs, 1, false, thetaStart, thetaLen);
  cornice.translate(0, H - corniceH * 0.5, 0);
  stoneParts.push(cornice);

  // Stepped base moulding ring along bottom edge
  if (H >= 0.8) {
    const skirt = new THREE.CylinderGeometry(R + 0.34, R + 0.52, 0.35, segs, 1, false, thetaStart, thetaLen);
    skirt.translate(0, 0.175, 0);
    stoneParts.push(skirt);

    // Back closure slab for semi-circular terraces so it embeds cleanly into eastern cliffs
    if (!full) {
      const backSlab = new THREE.BoxGeometry(R * 2.02, H, 2.2);
      backSlab.translate(0, H * 0.5, -1.0);
      stoneParts.push(backSlab);
    }
  }

  const merged = mergeGeometries(
    stoneParts.map((p) => {
      const n = normalizeForMerge(p);
      p.dispose();
      return n;
    }),
    false,
  )!;
  applyVerticalAO(merged, 0, H, new THREE.Color(0x52757c), new THREE.Color(0xeae8d6));
  g.add(new THREE.Mesh(merged, mats.paving));

  // Warm golden carved frieze niches spaced along the curved retaining wall (height >= 1.2m)
  if (H >= 1.2 && !full) {
    const glowParts: THREE.BufferGeometry[] = [];
    const nLights = 5;
    for (let i = 0; i < nLights; i++) {
      const a = -Math.PI * 0.42 + (i / (nLights - 1)) * Math.PI * 0.84;
      const lamp = new THREE.BoxGeometry(0.45, 0.22, 0.12);
      lamp.rotateY(a);
      lamp.translate(Math.sin(a) * (R + 0.18), H * 0.55, Math.cos(a) * (R + 0.18));
      glowParts.push(lamp);
    }
    const gMerged = mergeGeometries(
      glowParts.map((p) => {
        const n = normalizeForMerge(p, undefined, false);
        p.dispose();
        return n;
      }),
      false,
    )!;
    g.add(new THREE.Mesh(gMerged, mats.bridgeGoldTrim));
  }

  return g;
}
