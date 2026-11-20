// Material recipes — see docs/ART-SPEC.md §2. Shared instances so the whole
// cabin compiles a handful of programs.
import * as THREE from 'three';
import { PAL } from './palette.ts';

const std = (p: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial(p);

/** emissive that reads as a light source after ACES: unlit colour pushed > 1 */
export function glow(hex: number, gain = 1.6, opts: THREE.MeshBasicMaterialParameters = {}): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ ...opts });
  m.color.setHex(hex).multiplyScalar(gain);
  return m;
}

export const MAT = {
  /** moulded matte plastic shell */
  hull: std({ color: PAL.hullWhite, roughness: 0.72, metalness: 0.05, side: THREE.DoubleSide }),
  hullShade: std({ color: PAL.hullShade, roughness: 0.68, metalness: 0.08, side: THREE.DoubleSide }),
  /** brushed alloy trim */
  metal: std({ color: PAL.panelGrey, roughness: 0.3, metalness: 0.85, side: THREE.DoubleSide }),
  metalDark: std({ color: PAL.metalDark, roughness: 0.4, metalness: 0.7, side: THREE.DoubleSide }),
  visor: std({ color: PAL.visor, roughness: 0.08, metalness: 0.6 }),
  cushion: std({ color: 0x4a78d0, roughness: 0.85, metalness: 0 }),
  cyanGlow: glow(PAL.cyan, 1.5, { side: THREE.DoubleSide }),
  tealGlow: glow(PAL.tealAccent, 1.4, { side: THREE.DoubleSide }),
  greenGlow: glow(PAL.holoGreen, 1.5, { side: THREE.DoubleSide }),
  whiteGlow: glow(0xf4fbff, 1.8, { side: THREE.DoubleSide }),
};

const D2R = Math.PI / 180;

/** Sweep an (r, y) profile around +y between two angles (degrees, cabin
 *  polar convention). Flat-shaded so hard profile corners stay crisp. */
export function arcGeo(profile: [number, number][], a0: number, a1: number, segs = 0, smooth = false): THREE.BufferGeometry {
  const n = segs || Math.max(4, Math.ceil((a1 - a0) / 4));
  const g = new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    n,
    a0 * D2R,
    (a1 - a0) * D2R,
  );
  if (smooth) return g;
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  g.dispose();
  return flat;
}

export function arc(profile: [number, number][], a0: number, a1: number, mat: THREE.Material, segs = 0, smooth = false): THREE.Mesh {
  return new THREE.Mesh(arcGeo(profile, a0, a1, segs, smooth), mat);
}
