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
  /** moulded matte plastic shell (roughness 0.74, metalness 0.04) */
  hull: std({ color: PAL.hullWhite, roughness: 0.74, metalness: 0.04, envMapIntensity: 0.55, side: THREE.DoubleSide }),
  hullShade: std({ color: PAL.hullShade, roughness: 0.70, metalness: 0.05, envMapIntensity: 0.6, side: THREE.DoubleSide }),
  /** brushed alloy trim — darkened one stop so metal reads metallic, not white plastic */
  metal: std({ color: 0x5c6d84, roughness: 0.25, metalness: 0.90, envMapIntensity: 1.45, side: THREE.DoubleSide }),
  metalDark: std({ color: 0x263244, roughness: 0.36, metalness: 0.88, envMapIntensity: 1.3, side: THREE.DoubleSide }),
  visor: std({ color: PAL.visor, roughness: 0.08, metalness: 0.6, envMapIntensity: 1.3 }),
  /** desaturated matte fabric cushion */
  cushion: std({ color: 0x4b6b9c, roughness: 0.85, metalness: 0, envMapIntensity: 0.35 }),
  cyanGlow: glow(PAL.cyan, 1.5, { side: THREE.DoubleSide }),
  tealGlow: glow(PAL.tealAccent, 1.4, { side: THREE.DoubleSide }),
  greenGlow: glow(PAL.holoGreen, 1.5, { side: THREE.DoubleSide }),
  whiteGlow: glow(0xf4fbff, 1.8, { side: THREE.DoubleSide }),
};

/** Panoramic viewport glazing: MeshPhysicalMaterial with clearcoat + high envMapIntensity
 *  + custom Fresnel & edge-thickness reflection via onBeforeCompile. */
export function createWindowGlassMaterial(): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x98d4f4,
    roughness: 0.06,
    metalness: 0.08,
    ior: 1.52,
    reflectivity: 0.95,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    envMapIntensity: 1.45,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGlassWorld;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvGlassWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGlassWorld;')
      .replace(
        '#include <dithering_fragment>',
        `
        // Fresnel grazing reflection + subtle pane thickness tint at sill/header & diagonal sheen
        vec3 gN = normalize(vNormal);
        vec3 gV = normalize(vViewPosition);
        float gFres = pow(1.0 - abs(dot(gN, gV)), 2.6);
        float sillEdge = smoothstep(1.24, 0.95, vGlassWorld.y) + smoothstep(3.26, 3.55, vGlassWorld.y);
        float diagSheen = pow(max(0.0, sin(atan(vGlassWorld.x, vGlassWorld.z) * 5.0 + vGlassWorld.y * 1.15)), 8.0);
        vec3 glassEdgeTint = vec3(0.72, 0.90, 1.0);
        gl_FragColor.rgb += glassEdgeTint * (gFres * 0.52 + sillEdge * 0.28 + diagSheen * 0.22);
        gl_FragColor.a = clamp(gl_FragColor.a + gFres * 0.36 + sillEdge * 0.24 + diagSheen * 0.12, 0.10, 0.65);
        #include <dithering_fragment>
        `,
      );
  };
  return mat;
}

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
