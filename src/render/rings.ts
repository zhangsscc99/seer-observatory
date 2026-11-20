// Ice-ring system: one RingGeometry + a radial-band ShaderMaterial.
// Three octaves of 1-D value noise carve concentric bands, a forced Cassini
// division at t≈0.62, planet umbra as an anti-sun arc, forward scattering,
// and slowly rotating ice-crystal sparkles (all driven by uTime).
import * as THREE from 'three';
import { SUN_DIR, type PlanetDef } from '../game/space.ts';

const sunDir = new THREE.Vector3(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z).normalize();

export const RING_INNER = 1.5; // × planet radius
export const RING_OUTER = 2.35;
const TILT_X = (17 * Math.PI) / 180;
const TILT_Z = (9 * Math.PI) / 180;
/** ring-plane orientation in world space (ring local XZ → world) */
export const RING_QUAT = new THREE.Quaternion().setFromEuler(new THREE.Euler(TILT_X, 0, TILT_Z));

const RING_VERT = /* glsl */ `
varying vec3 vLocal; varying vec3 vW;
void main() {
  vLocal = position; // ring plane is local XZ (geo pre-rotated)
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const RING_FRAG = /* glsl */ `
uniform float uTime; uniform float uInner; uniform float uOuter; uniform float uRadius;
uniform vec3 uSun; uniform vec3 uSunL;
uniform vec3 uCol0; uniform vec3 uCol1; uniform vec3 uCol2;
varying vec3 vLocal; varying vec3 vW;

float hash1(float x) { return fract(sin(x * 127.1 + 311.7) * 43758.5453); }
float hash2(vec2 v) { return fract(sin(dot(v, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(float x) {
  float i = floor(x); float f = fract(x);
  float u = f * f * (3.0 - 2.0 * f);
  return mix(hash1(i), hash1(i + 1.0), u);
}

void main() {
  float r = length(vLocal.xz);
  float t = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);

  // three radial noise octaves → concentric bands of mixed widths
  float band = 0.52 * vnoise(t * 6.0 + 3.1)
             + 0.30 * vnoise(t * 15.0 + 17.7)
             + 0.18 * vnoise(t * 37.0 + 41.3);
  float alpha = (0.15 + 0.75 * band) * (0.85 + 0.15 * vnoise(t * 90.0 + 7.7));

  // Cassini division: t in 0.58..0.66 pressed to ~0, 0.01 smooth edges
  float cass = smoothstep(0.57, 0.58, t) * (1.0 - smoothstep(0.66, 0.67, t));

  // colour ramp deep → mid → bright, outermost fading to white
  vec3 col = t < 0.5 ? mix(uCol0, uCol1, t * 2.0) : mix(uCol1, uCol2, t * 2.0 - 1.0);
  col = mix(col, vec3(1.0), smoothstep(0.82, 1.0, t) * 0.35);

  // ring plane lit by the sun on both faces (DoubleSide)
  col *= 0.35 + 0.65 * abs(uSunL.y);

  // forward scattering: dust brightens when looking sunward
  vec3 viewDir = normalize(vW - cameraPosition);
  float fwd = pow(max(dot(viewDir, uSun), 0.0), 8.0);
  col += uCol2 * fwd * 0.9;
  alpha += fwd * 0.25;

  // planet umbra: anti-sun arc |perp| < R behind the disc → ×0.18
  vec2 ax = normalize(uSunL.xz + vec2(1e-5, 0.0));
  float along = dot(vLocal.xz, ax);
  float perp = abs(vLocal.x * ax.y - vLocal.z * ax.x);
  float umbra = smoothstep(-uRadius * 0.1, uRadius * 0.35, -along)
              * (1.0 - smoothstep(uRadius * 0.92, uRadius * 1.05, perp));
  col *= 1.0 - 0.82 * umbra;

  // ice crystals: sparse rotating grain, threshold + pow, emissive tint
  float ang = atan(vLocal.z, vLocal.x) + uTime * 0.05;
  float sp = hash2(floor(vec2(ang * 60.0, t * 240.0)));
  float sparkle = pow(max(sp - 0.97, 0.0) / 0.03, 3.0);
  col += uCol2 * sparkle * (0.9 + 0.6 * fwd) * (1.0 - cass * 0.9);

  // inner/outer edges fade over 0.06 of the band; gap pressed last (to ~0)
  alpha *= smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.94, 1.0, t));
  alpha = min(alpha, 1.0) * (1.0 - cass);

  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Saturn-style ring group for `ice-ring` planets. Returned group's
 *  userData.material is the ShaderMaterial (drive uniforms.uTime). */
export function buildRings(p: PlanetDef): THREE.Group {
  const g = new THREE.Group();
  g.name = 'rings';
  g.quaternion.copy(RING_QUAT);

  const inner = p.radius * RING_INNER;
  const outer = p.radius * RING_OUTER;
  const geo = new THREE.RingGeometry(inner, outer, 192, 4);
  geo.rotateX(-Math.PI / 2); // ring plane → local XZ, normal +Y

  // sun direction in ring-local space (tilt inverse) for umbra + lighting
  const sunL = sunDir.clone().applyQuaternion(g.quaternion.clone().invert());

  const material = new THREE.ShaderMaterial({
    vertexShader: RING_VERT,
    fragmentShader: RING_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uInner: { value: inner },
      uOuter: { value: outer },
      uRadius: { value: p.radius },
      uSun: { value: sunDir },
      uSunL: { value: sunL },
      uCol0: { value: new THREE.Color(p.colors[0]) },
      uCol1: { value: new THREE.Color(p.colors[1]) },
      uCol2: { value: new THREE.Color(p.colors[2]) },
    },
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.renderOrder = 2; // after the planet halo
  g.add(mesh);
  g.userData.material = material;
  return g;
}
