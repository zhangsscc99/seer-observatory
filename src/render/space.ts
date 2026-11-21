// Space sector: sun (+ billboard flare), planets with fresnel atmospheres,
// instanced asteroid belt, stardust that streams past the ship, and the
// observatory station exterior. Built from src/game/space.ts data.
import * as THREE from 'three';
import { mulberry32 } from '../game/rng.ts';
import { beltRocks, BINARY_STARS, PLANETS, STATION, SUN_DIR, SUN_DISTANCE, SUN_RADIUS, type BinaryStarDef, type PlanetDef } from '../game/space.ts';
import { MAT, arc, glow } from './materials.ts';
import { PAL } from './palette.ts';
import { buildRings } from './rings.ts';
import { binaryTexture, flareTexture, planetTexture, radialTexture, redGiantTexture, rockTexture } from './textures.ts';

const sunDir = new THREE.Vector3(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z);

const PLANET_VERT = /* glsl */ `
varying vec3 vN; varying vec3 vW; varying vec2 vUv;
void main() {
  vUv = uv;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// lit surface + inner fresnel rim tinted by the atmosphere
const PLANET_FRAG = /* glsl */ `
uniform sampler2D uMap; uniform vec3 uSun; uniform vec3 uAtmo; uniform float uGlow; uniform float uSpec; uniform float uTime; uniform float uStorm;
varying vec3 vN; varying vec3 vW; varying vec2 vUv;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  float ndl = dot(n, uSun);
  float day = smoothstep(-0.06, 0.30, ndl);
  vec3 albedo;
  if (uStorm > 0.5) {
    float lat = (vUv.y - 0.5) * 2.0;
    float jet = 1.0 - 0.65 * lat * lat;
    vec2 uv1 = vec2(vUv.x + uTime * 0.006 * jet, clamp(vUv.y, 0.001, 0.999));
    vec2 dEye = vec2(mod(uv1.x - 0.62 + 0.5, 1.0) - 0.5, uv1.y - 0.42);
    vec2 eNorm = dEye / vec2(0.082, 0.046);
    float r = length(eNorm);
    float eyeMask = smoothstep(1.25, 0.15, r);
    float ang = uTime * 0.25 * smoothstep(1.25, 0.1, r);
    float ca = cos(ang), sa = sin(ang);
    vec2 rotNorm = mat2(ca, -sa, sa, ca) * eNorm * (1.0 - 0.04 * eyeMask * sin(uTime * 0.8));
    vec2 uvEye = vec2(0.62 + rotNorm.x * 0.082, clamp(0.42 + rotNorm.y * 0.046, 0.001, 0.999));
    vec3 baseCol = texture2D(uMap, mix(uv1, uvEye, eyeMask)).rgb;
    float shear = 0.004 * sin(vUv.y * 26.0 + uTime * 0.28);
    vec2 uv2 = vec2(vUv.x + uTime * 0.012 * jet + shear, clamp(vUv.y + 0.003 * cos(vUv.x * 18.84955 + uTime * 0.15), 0.001, 0.999));
    vec3 upperCol = texture2D(uMap, uv2).rgb;
    albedo = mix(baseCol, upperCol, 0.28 * (1.0 - eyeMask * 0.85));
  } else {
    albedo = texture2D(uMap, vUv).rgb;
  }
  vec3 col = albedo * (0.10 + 0.92 * day);
  float limbFactor = pow(1.0 - abs(dot(n, v)), 1.5);
  col += albedo * uAtmo * 0.10 * (1.0 - day) * limbFactor * uStorm;
  col += albedo * uGlow * (1.0 - day) * smoothstep(0.55, 1.0, albedo.r); // night-side emissive (lava)
  float spec = pow(max(dot(n, normalize(v + uSun)), 0.0), 48.0) * 0.18 * day;
  col += vec3(spec) * uSpec; // ice/gas only — lava stays matte
  float fres = pow(1.0 - max(dot(n, v), 0.0), 2.6);
  col += uAtmo * fres * smoothstep(-0.35, 0.30, ndl);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// outer halo shell (BackSide, additive): peaks at the planet limb, fades
// outward. Lit side only for planets; full 360° when uSelfLit = 1 (stars).
const HALO_FRAG = /* glsl */ `
uniform vec3 uSun; uniform vec3 uAtmo; uniform float uEdge; uniform float uPow; uniform float uGain; uniform float uSelfLit;
varying vec3 vN; varying vec3 vW;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  float d = clamp(-dot(n, v) / uEdge, 0.0, 1.0);
  float a = pow(d, uPow);
  float ndl = dot(n, uSun);
  float lit = mix(smoothstep(-0.35, 0.30, ndl), 1.0, uSelfLit);
  float term = smoothstep(0.25, 0.85, 1.0 - abs(ndl)) * (1.0 - uSelfLit);
  vec3 tint = mix(uAtmo, uAtmo * vec3(1.08, 1.0, 0.92), term);
  gl_FragColor = vec4(tint * a * lit * uGain, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// self-luminous red-giant photosphere: slow convection flow + limb darkening
// (edges darker & redder via pow(1 - dot(N, V), 1.6)), no sunDir diffuse term.
const RED_GIANT_FRAG = /* glsl */ `
uniform sampler2D uMap; uniform float uTime; uniform float uGlow; uniform vec3 uAtmo;
varying vec3 vN; varying vec3 vW; varying vec2 vUv;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  float flow = uTime * 0.02;
  vec2 uv1 = vec2(
    vUv.x + flow * 0.14 + 0.003 * sin(vUv.y * 18.0 + flow * 1.1),
    clamp(vUv.y + 0.0025 * cos(vUv.x * 25.1327 + flow * 0.9), 0.001, 0.999)
  );
  vec2 uv2 = vec2(
    uv1.x - flow * 0.09 + 0.004 * cos(vUv.y * 28.0 - flow * 1.3),
    clamp(uv1.y + 0.003 * sin(vUv.x * 37.699 + flow * 1.2), 0.001, 0.999)
  );
  vec3 baseCol = texture2D(uMap, uv1).rgb;
  vec3 boilCol = texture2D(uMap, uv2).rgb;
  vec3 albedo = mix(baseCol, boilCol, 0.18);

  float ndv = max(dot(n, v), 0.0);
  float limb = pow(1.0 - ndv, 1.6);
  // center stays hot incandescent orange-cream; limb darkens and shifts deeper crimson-red
  float limbDark = mix(1.0, 0.34, limb);
  vec3 limbTint = mix(vec3(1.0, 1.0, 1.0), vec3(0.86, 0.24, 0.06), limb);

  // extra radiance on hot flare cores so they read incandescent through ACES
  float hotCore = smoothstep(0.68, 0.96, albedo.g);
  vec3 col = albedo * (uGlow + hotCore * 0.85) * limbDark * limbTint;
  // subtle fiery chromosphere rim right at the silhouette edge
  float chromo = pow(1.0 - ndv, 4.2);
  col += uAtmo * vec3(1.15, 0.48, 0.16) * chromo * 0.42;

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// coronal prominence arch ribbons (additive, gentle breathing with uTime)
const PROMINENCE_VERT = /* glsl */ `
attribute float aPhase;
uniform float uTime;
varying vec2 vUv;
varying float vPhase;
void main() {
  vUv = uv;
  vPhase = aPhase;
  float arch = sin(uv.x * 3.14159265);
  float pulse = 1.0 + 0.045 * sin(uTime * 0.9 + aPhase + uv.x * 3.14159) * arch;
  vec3 pos = position * pulse;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}`;

const PROMINENCE_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vPhase;
void main() {
  float across = sin(vUv.y * 3.14159265);
  float ends = smoothstep(0.0, 0.14, vUv.x) * smoothstep(1.0, 0.86, vUv.x);
  float stream = 0.68 + 0.32 * sin(vUv.x * 16.0 - uTime * 1.15 + vPhase * 2.0 + vUv.y * 4.5);
  float wisp = 0.72 + 0.28 * sin(vUv.x * 29.0 + uTime * 0.65 - vUv.y * 9.0 + vPhase);
  float breathe = 0.82 + 0.18 * sin(uTime * 0.75 + vPhase);
  float core = pow(across, 1.8) * ends * stream * wisp * breathe;
  vec3 col = mix(vec3(0.95, 0.22, 0.05), vec3(1.0, 0.76, 0.34), pow(across, 2.2) * stream);
  gl_FragColor = vec4(col * core * 1.15, core);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// backlit warm dust veil shell (radius ~2.6R, transparent, depthWrite: false)
// keeps center sightline clear while revealing warm backlit grain toward the limbs
const DUST_VEIL_FRAG = /* glsl */ `
uniform vec3 uAtmo; uniform vec3 uCenter; uniform float uTime;
varying vec3 vN; varying vec3 vW;
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vnoise3(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3(1.0, 0.0, 0.0)), u.x), mix(hash3(i + vec3(0.0, 1.0, 0.0)), hash3(i + vec3(1.0, 1.0, 0.0)), u.x), u.y),
    mix(mix(hash3(i + vec3(0.0, 0.0, 1.0)), hash3(i + vec3(1.0, 0.0, 1.0)), u.x), mix(hash3(i + vec3(0.0, 1.0, 1.0)), hash3(i + vec3(1.0, 1.0, 1.0)), u.x), u.y),
    u.z);
}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  float ndv = abs(dot(n, v));
  // low opacity straight through center so the star face stays crisp; richer dusty ring off-center
  float ring = smoothstep(0.96, 0.34, ndv) * smoothstep(0.03, 0.26, ndv);
  vec3 dir = normalize(vW - uCenter);
  float drift = uTime * 0.015;
  float cloud = vnoise3(dir * 5.5 + vec3(drift, -drift * 0.6, drift * 0.8));
  float fine = vnoise3(dir * 26.0 - vec3(drift * 1.4, drift, -drift * 0.9));
  float grain = smoothstep(0.52, 0.94, vnoise3(dir * 78.0 + vec3(drift * 2.0, 0.0, -drift * 1.5)));
  // backlit warm amber-copper dust with subtle sunlit bright motes
  vec3 dustCol = mix(uAtmo * vec3(0.75, 0.42, 0.24), vec3(1.0, 0.78, 0.48), grain * 0.75 + cloud * 0.25);
  float alpha = (0.045 + ring * 0.24) * (0.42 + 0.58 * cloud) * (0.65 + 0.35 * fine) + grain * ring * 0.14;
  gl_FragColor = vec4(dustCol, clamp(alpha, 0.0, 0.34));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// thin additive frost veil (FrontSide): sun-side drifting noise, alpha ≤ 0.12
const FROST_FRAG = /* glsl */ `
uniform vec3 uSun; uniform vec3 uAtmo; uniform float uTime;
varying vec3 vN; varying vec3 vW;
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vnoise3(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3(1.0, 0.0, 0.0)), u.x), mix(hash3(i + vec3(0.0, 1.0, 0.0)), hash3(i + vec3(1.0, 1.0, 0.0)), u.x), u.y),
    mix(mix(hash3(i + vec3(0.0, 0.0, 1.0)), hash3(i + vec3(1.0, 0.0, 1.0)), u.x), mix(hash3(i + vec3(0.0, 1.0, 1.0)), hash3(i + vec3(1.0, 1.0, 1.0)), u.x), u.y),
    u.z);
}
void main() {
  vec3 n = normalize(vN);
  float day = smoothstep(-0.15, 0.45, dot(n, uSun));
  float wisp = vnoise3(n * 5.0 + vec3(uTime * 0.06, uTime * 0.04, uTime * 0.05));
  float a = day * (0.35 + 0.65 * wisp) * 0.12;
  gl_FragColor = vec4(uAtmo, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// self-luminous twin star photosphere: incandescent white-hot core fading to
// color-temperature outer disc with subtle boiling plasma shimmer
const BINARY_STAR_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uIntensity; uniform float uTime;
varying vec3 vN; varying vec3 vW;
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vnoise3(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3(1.0, 0.0, 0.0)), u.x), mix(hash3(i + vec3(0.0, 1.0, 0.0)), hash3(i + vec3(1.0, 1.0, 0.0)), u.x), u.y),
    mix(mix(hash3(i + vec3(0.0, 0.0, 1.0)), hash3(i + vec3(1.0, 0.0, 1.0)), u.x), mix(hash3(i + vec3(0.0, 1.0, 1.0)), hash3(i + vec3(1.0, 1.0, 1.0)), u.x), u.y),
    u.z);
}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  float ndv = max(dot(n, v), 0.0);
  float boil = vnoise3(n * 8.5 + vec3(uTime * 0.25, -uTime * 0.18, uTime * 0.21));
  float fine = vnoise3(n * 22.0 - vec3(uTime * 0.35, uTime * 0.28, -uTime * 0.19));
  float core = pow(ndv, 0.58);
  vec3 hotCore = mix(uColor, vec3(1.0, 0.99, 0.97), 0.68 * core);
  float shimmer = 0.92 + 0.14 * boil + 0.08 * fine;
  float limbGlow = pow(1.0 - ndv, 2.4) * 0.55;
  vec3 col = (hotCore * (1.15 + 0.55 * core) * shimmer + uColor * limbGlow) * uIntensity;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// binary-system planet: dual-star cool/warm illumination, subtle cirrus drift,
// dual-sided fresnel rim (cool on star-A side, warm on star-B side), night >= 0.08
const BINARY_PLANET_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uStarA; uniform vec3 uColA;
uniform vec3 uStarB; uniform vec3 uColB;
uniform float uTime;
varying vec3 vN; varying vec3 vW; varying vec2 vUv;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  float ndlA = dot(n, uStarA);
  float ndlB = dot(n, uStarB);
  float dayA = smoothstep(-0.12, 0.42, ndlA);
  float dayB = smoothstep(-0.12, 0.42, ndlB);

  // gentle differential cirrus drift so clouds feel alive without smearing detail
  float lat = (vUv.y - 0.5) * 2.0;
  float drift = uTime * 0.0022 * (1.0 - 0.45 * lat * lat);
  vec2 uv1 = vec2(vUv.x + drift, clamp(vUv.y, 0.001, 0.999));
  vec2 uv2 = vec2(vUv.x + drift * 1.9 + 0.002 * sin(vUv.y * 20.0 + uTime * 0.15), clamp(vUv.y, 0.001, 0.999));
  vec3 albedo = mix(texture2D(uMap, uv1).rgb, texture2D(uMap, uv2).rgb, 0.20);

  // dual-color-temperature lighting with guaranteed night-side floor (>= 0.08)
  vec3 ambient = vec3(0.09, 0.10, 0.13);
  vec3 lightA = uColA * dayA * 0.88;
  vec3 lightB = uColB * dayB * 0.74;
  vec3 col = albedo * (ambient + lightA + lightB);

  // subtle twin-star specular glints on high cirrus clouds
  float specA = pow(max(dot(n, normalize(v + uStarA)), 0.0), 42.0) * 0.22 * dayA;
  float specB = pow(max(dot(n, normalize(v + uStarB)), 0.0), 36.0) * 0.20 * dayB;
  col += uColA * specA + uColB * specB;

  // dual-sided fresnel inner rim: cool cyan-blue on star-A face, warm amber-orange on star-B face
  float fres = pow(1.0 - max(dot(n, v), 0.0), 2.5);
  float rimA = smoothstep(-0.32, 0.36, ndlA);
  float rimB = smoothstep(-0.32, 0.36, ndlB);
  col += vec3(0.56, 0.84, 1.0) * fres * rimA * 0.78;
  col += vec3(1.0, 0.66, 0.34) * fres * rimB * 0.72;
  // subtle night-side indigo scatter so silhouette stays crisp
  col += vec3(0.18, 0.26, 0.42) * fres * (1.0 - max(rimA, rimB)) * 0.16;

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// dual-tinted outer halo shell for the binary planet (BackSide, additive)
const BINARY_HALO_FRAG = /* glsl */ `
uniform vec3 uStarA; uniform vec3 uColA;
uniform vec3 uStarB; uniform vec3 uColB;
uniform float uEdge; uniform float uPow; uniform float uGain;
varying vec3 vN; varying vec3 vW;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  float d = clamp(-dot(n, v) / uEdge, 0.0, 1.0);
  float a = pow(d, uPow);
  float litA = smoothstep(-0.35, 0.35, dot(n, uStarA));
  float litB = smoothstep(-0.35, 0.35, dot(n, uStarB));
  vec3 tint = uColA * litA * 0.85 + uColB * litB * 0.80;
  gl_FragColor = vec4(tint * a * uGain, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const HALO_SCALE = 1.16;
const HALO_SCALE_NARROW = 1.05;
const FROST_SCALE = 1.02;
const DUST_VEIL_SCALE = 2.6;

/** procedural coronal prominence arch ribbons (5 magnetic plasma loops in 1 draw call) */
function buildProminences(p: PlanetDef): { mesh: THREE.Mesh; material: THREE.ShaderMaterial } {
  // 5 loops distributed around the limb (especially visible from the focusPlanet approach) and upper/lower latitudes
  const specs: { dir: [number, number, number]; tang: [number, number, number]; span: number; apex: number; width: number; phase: number }[] = [
    { dir: [-0.84, 0.32, -0.44], tang: [0.22, 0.92, -0.32], span: 0.36, apex: 0.30, width: 0.068, phase: 0.4 },
    { dir: [0.76, 0.44, 0.48], tang: [-0.34, 0.88, -0.34], span: 0.32, apex: 0.25, width: 0.058, phase: 1.9 },
    { dir: [0.58, -0.72, 0.38], tang: [0.74, 0.56, -0.37], span: 0.34, apex: 0.28, width: 0.062, phase: 3.3 },
    { dir: [-0.66, -0.58, -0.48], tang: [-0.62, 0.76, -0.18], span: 0.28, apex: 0.21, width: 0.052, phase: 4.7 },
    { dir: [-0.14, 0.92, 0.36], tang: [0.96, 0.16, -0.22], span: 0.30, apex: 0.23, width: 0.054, phase: 5.8 },
  ];

  const segs = 28;
  const positions: number[] = [];
  const uvs: number[] = [];
  const phases: number[] = [];
  const indices: number[] = [];
  let vBase = 0;

  const cVec = new THREE.Vector3();
  const tVec = new THREE.Vector3();
  const bVec = new THREE.Vector3();
  const pt = new THREE.Vector3();
  const prevPt = new THREE.Vector3();
  const nextPt = new THREE.Vector3();
  const loopTan = new THREE.Vector3();
  const sideA = new THREE.Vector3();
  const sideB = new THREE.Vector3();
  const ribbonDir = new THREE.Vector3();

  const archPoint = (out: THREE.Vector3, c: THREE.Vector3, t: THREE.Vector3, span: number, apex: number, u: number): void => {
    const theta = (u - 0.5) * 2 * span;
    const elev = Math.pow(Math.sin(u * Math.PI), 0.78);
    const r = p.radius * (0.96 + apex * elev);
    out.copy(c).multiplyScalar(Math.cos(theta)).addScaledVector(t, Math.sin(theta)).normalize().multiplyScalar(r);
  };

  for (const s of specs) {
    cVec.set(s.dir[0], s.dir[1], s.dir[2]).normalize();
    tVec.set(s.tang[0], s.tang[1], s.tang[2]);
    // orthogonalize tangent against surface normal
    tVec.addScaledVector(cVec, -tVec.dot(cVec)).normalize();
    bVec.crossVectors(cVec, tVec).normalize();

    // build two crossed ribbons (0° and 65° about the arch tangent) so the loop reads from any camera angle
    for (const crossAng of [0, 1.13]) {
      const ca = Math.cos(crossAng);
      const sa = Math.sin(crossAng);
      for (let i = 0; i <= segs; i++) {
        const u = i / segs;
        archPoint(pt, cVec, tVec, s.span, s.apex, u);
        archPoint(prevPt, cVec, tVec, s.span, s.apex, Math.max(0, u - 0.02));
        archPoint(nextPt, cVec, tVec, s.span, s.apex, Math.min(1, u + 0.02));
        loopTan.subVectors(nextPt, prevPt).normalize();
        sideA.copy(bVec);
        sideB.crossVectors(loopTan, sideA).normalize();
        ribbonDir.copy(sideA).multiplyScalar(ca).addScaledVector(sideB, sa).normalize();

        const halfW = p.radius * s.width * (0.55 + 0.45 * Math.sin(u * Math.PI));
        for (const side of [-1, 1]) {
          positions.push(
            pt.x + ribbonDir.x * halfW * side,
            pt.y + ribbonDir.y * halfW * side,
            pt.z + ribbonDir.z * halfW * side,
          );
          uvs.push(u, side < 0 ? 0 : 1);
          phases.push(s.phase);
        }
        if (i < segs) {
          const k = vBase + i * 2;
          indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
        }
      }
      vBase += (segs + 1) * 2;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
  geo.setIndex(indices);

  const material = new THREE.ShaderMaterial({
    vertexShader: PROMINENCE_VERT,
    fragmentShader: PROMINENCE_FRAG,
    uniforms: { uTime: { value: 0 } },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'prominences';
  return { mesh, material };
}

/** warm backlit dust veil (~2.6R thin shell + granular backlit dust motes) */
function buildDustVeil(p: PlanetDef, atmo: THREE.Color): { group: THREE.Group; shellMat: THREE.ShaderMaterial; motes: THREE.Points } {
  const group = new THREE.Group();
  group.name = 'dustVeil';

  const shellMat = new THREE.ShaderMaterial({
    vertexShader: PLANET_VERT,
    fragmentShader: DUST_VEIL_FRAG,
    uniforms: {
      uAtmo: { value: atmo },
      uCenter: { value: new THREE.Vector3(p.pos.x, p.pos.y, p.pos.z) },
      uTime: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const shell = new THREE.Mesh(new THREE.SphereGeometry(p.radius * DUST_VEIL_SCALE, 48, 32), shellMat);
  group.add(shell);

  // backlit warm dust particles inside the 1.45R..2.65R envelope for crisp near-camera grain
  const count = 420;
  const rnd = mulberry32(p.seed + 909);
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const z = rnd() * 2 - 1;
    const phi = rnd() * Math.PI * 2;
    const s = Math.sqrt(Math.max(0, 1 - z * z));
    const r = p.radius * (1.45 + Math.pow(rnd(), 0.72) * 1.2);
    pos[i * 3] = s * Math.cos(phi) * r;
    pos[i * 3 + 1] = z * r;
    pos[i * 3 + 2] = s * Math.sin(phi) * r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const moteMat = new THREE.PointsMaterial({
    map: radialTexture(
      [
        [0, 'rgba(255,232,190,1)'],
        [0.35, 'rgba(255,156,78,0.65)'],
        [1, 'rgba(180,72,24,0)'],
      ],
      64,
    ),
    color: 0xffb472,
    size: p.radius * 0.048,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.62,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const motes = new THREE.Points(geo, moteMat);
  motes.name = 'dustMotes';
  group.add(motes);

  return { group, shellMat, motes };
}

/** procedural orbital gas-harvesting station (~0.28R across, ≤9 draw calls) */
function buildGasStation(p: PlanetDef): THREE.Group {
  const r = p.radius * 0.20;
  const root = new THREE.Group();
  const offset = new THREE.Vector3(p.radius * 0.35, p.radius * 0.72, -p.radius * 1.05);
  const radial = offset.clone().normalize();
  root.position.copy(offset);
  root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), radial);
  root.userData.basePos = offset.clone();
  root.userData.radial = radial.clone();
  root.userData.bobAmp = p.radius * 0.02;
  root.userData.baseQuat = root.quaternion.clone();

  const body = new THREE.Group();
  body.name = 'gasStationBody';
  root.add(body);

  // upper collector ring platform
  body.add(
    arc(
      [
        [r * 0.62, r * 0.08],
        [r * 0.96, r * 0.08],
        [r, r * 0.16],
        [r * 0.96, r * 0.24],
        [r * 0.62, r * 0.24],
        [r * 0.62, r * 0.08],
      ],
      0,
      360,
      MAT.hull,
      32,
    ),
  );
  // upper rim cyan light strip
  body.add(
    arc(
      [
        [r * 1.005, r * 0.14],
        [r * 1.005, r * 0.18],
      ],
      0,
      360,
      MAT.cyanGlow,
      32,
    ),
  );
  // lower truss/collector ring
  body.add(
    arc(
      [
        [r * 0.48, -r * 0.26],
        [r * 0.78, -r * 0.22],
        [r * 0.78, -r * 0.14],
        [r * 0.48, -r * 0.14],
        [r * 0.48, -r * 0.26],
      ],
      0,
      360,
      MAT.hullShade,
      28,
    ),
  );
  // central core tower & spire
  body.add(
    arc(
      [
        [0, -r * 0.56],
        [r * 0.18, -r * 0.45],
        [r * 0.26, -r * 0.15],
        [r * 0.26, r * 0.32],
        [r * 0.14, r * 0.48],
        [r * 0.06, r * 0.88],
        [0, r * 0.92],
      ],
      0,
      360,
      MAT.metal,
      20,
    ),
  );

  // 6 truss struts connecting upper & lower rings (1 draw call)
  const strutGeo = new THREE.CylinderGeometry(r * 0.032, r * 0.032, r * 0.44, 6);
  const struts = new THREE.InstancedMesh(strutGeo, MAT.metalDark, 6);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const sc = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    q.setFromEuler(e.set(0, -a, -0.26));
    m.compose(new THREE.Vector3(Math.cos(a) * r * 0.7, -r * 0.02, Math.sin(a) * r * 0.7), q, sc);
    struts.setMatrixAt(i, m);
  }
  struts.instanceMatrix.needsUpdate = true;
  body.add(struts);

  // ring of 16 window lights around upper platform (1 draw call)
  const winGeo = new THREE.BoxGeometry(r * 0.14, r * 0.07, r * 0.05);
  const wins = new THREE.InstancedMesh(winGeo, MAT.cyanGlow, 16);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    q.setFromEuler(e.set(0, a, 0));
    m.compose(new THREE.Vector3(Math.sin(a) * r * 1.005, r * 0.2, Math.cos(a) * r * 1.005), q, sc);
    wins.setMatrixAt(i, m);
  }
  wins.instanceMatrix.needsUpdate = true;
  body.add(wins);

  // 3 warm-white work lights on the central tower collar (1 draw call)
  const workGeo = new THREE.BoxGeometry(r * 0.13, r * 0.08, r * 0.08);
  const workLights = new THREE.InstancedMesh(workGeo, glow(0xffe6c0, 1.6), 3);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    q.setFromEuler(e.set(0, a, 0));
    m.compose(new THREE.Vector3(Math.sin(a) * r * 0.29, r * 0.34, Math.cos(a) * r * 0.29), q, sc);
    workLights.setMatrixAt(i, m);
  }
  workLights.instanceMatrix.needsUpdate = true;
  body.add(workLights);

  // bottom beacon (pulses in update)
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(r * 0.08, 12, 10), glow(PAL.tealAccent, 1.9));
  beacon.position.y = -r * 0.62;
  beacon.name = 'gasBeacon';
  body.add(beacon);

  // thin dark harvesting tether dipping into the upper cloud deck
  const tetherLen = p.radius * 0.3;
  const tether = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.012, r * 0.012, tetherLen, 6), MAT.metalDark);
  tether.position.y = -r * 0.62 - tetherLen * 0.5;
  root.add(tether);

  return root;
}

function haloShell(p: PlanetDef, scale: number, peakPow: number, gain: number, atmo: THREE.Color, selfLit = false): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.SphereGeometry(p.radius * scale, 48, 32),
    new THREE.ShaderMaterial({
      vertexShader: PLANET_VERT,
      fragmentShader: HALO_FRAG,
      uniforms: {
        uSun: { value: sunDir },
        uAtmo: { value: atmo },
        uEdge: { value: Math.sqrt(1 - 1 / (scale * scale)) },
        uPow: { value: peakPow },
        uGain: { value: gain },
        uSelfLit: { value: selfLit ? 1 : 0 },
      },
      side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
}

function starHaloShell(radius: number, scale: number, peakPow: number, gain: number, color: THREE.Color): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.SphereGeometry(radius * scale, 40, 28),
    new THREE.ShaderMaterial({
      vertexShader: PLANET_VERT,
      fragmentShader: HALO_FRAG,
      uniforms: {
        uSun: { value: sunDir },
        uAtmo: { value: color },
        uEdge: { value: Math.sqrt(1 - 1 / (scale * scale)) },
        uPow: { value: peakPow },
        uGain: { value: gain },
        uSelfLit: { value: 1 },
      },
      side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
}

/** self-luminous twin star with 1.14R / 1.28R paired corona halos + billboard flare */
function buildBinaryStar(s: BinaryStarDef): { group: THREE.Group; mat: THREE.ShaderMaterial; flare: THREE.Sprite; baseScale: number } {
  const g = new THREE.Group();
  g.name = s.id;
  g.position.set(s.pos.x, s.pos.y, s.pos.z);
  const col = new THREE.Color(s.color);
  const mat = new THREE.ShaderMaterial({
    vertexShader: PLANET_VERT,
    fragmentShader: BINARY_STAR_FRAG,
    uniforms: {
      uColor: { value: col },
      uIntensity: { value: s.intensity },
      uTime: { value: 0 },
    },
  });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(s.radius, 48, 32), mat);
  const haloInner = starHaloShell(s.radius, 1.14, 3.2, 0.72, col);
  const haloOuter = starHaloShell(s.radius, 1.28, 1.9, 0.48, col);
  const baseScale = s.radius * (s.intensity > 1.8 ? 6.2 : 5.6);
  const flare = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: flareTexture(),
      color: col,
      opacity: s.intensity > 1.8 ? 0.72 : 0.68,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }),
  );
  flare.scale.setScalar(baseScale);
  g.add(sphere, haloInner, haloOuter, flare);
  return { group: g, mat, flare, baseScale };
}

function binaryHaloShell(
  p: PlanetDef,
  scale: number,
  peakPow: number,
  gain: number,
  starA: THREE.Vector3,
  colA: THREE.Color,
  starB: THREE.Vector3,
  colB: THREE.Color,
): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.SphereGeometry(p.radius * scale, 48, 32),
    new THREE.ShaderMaterial({
      vertexShader: PLANET_VERT,
      fragmentShader: BINARY_HALO_FRAG,
      uniforms: {
        uStarA: { value: starA },
        uColA: { value: colA },
        uStarB: { value: starB },
        uColB: { value: colB },
        uEdge: { value: Math.sqrt(1 - 1 / (scale * scale)) },
        uPow: { value: peakPow },
        uGain: { value: gain },
      },
      side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
}

function buildPlanet(p: PlanetDef): THREE.Group {
  const g = new THREE.Group();
  g.position.set(p.pos.x, p.pos.y, p.pos.z);
  const atmo = new THREE.Color(p.atmosphere);

  if (p.kind === 'red-giant') {
    const surfaceMat = new THREE.ShaderMaterial({
      vertexShader: PLANET_VERT,
      fragmentShader: RED_GIANT_FRAG,
      uniforms: {
        uMap: { value: redGiantTexture(p) },
        uTime: { value: 0 },
        uGlow: { value: 1.7 },
        uAtmo: { value: atmo },
      },
    });
    const surface = new THREE.Mesh(new THREE.SphereGeometry(p.radius, 72, 48), surfaceMat);
    surface.name = 'surface';
    surface.rotation.z = 0.14;
    // dual self-lit corona halo: thicker & brighter than planets (wide 1.16R + narrow bright rim)
    const wideHalo = haloShell(p, HALO_SCALE, 1.9, 0.62, atmo, true);
    const narrowHalo = haloShell(p, 1.06, 3.8, 0.72, new THREE.Color(0xffb45c), true);
    const prom = buildProminences(p);
    const veil = buildDustVeil(p, atmo);
    const starFlare = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: flareTexture(),
        color: new THREE.Color(0xff9640),
        opacity: 0.78,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      }),
    );
    starFlare.name = 'starFlare';
    starFlare.scale.setScalar(p.radius * 5.8);
    starFlare.userData.baseScale = p.radius * 5.8;

    g.add(surface, wideHalo, narrowHalo, prom.mesh, veil.group, starFlare);
    g.userData.timeMats = [surfaceMat, prom.material, veil.shellMat];
    return g;
  }

  if (p.kind === 'binary') {
    const sA = BINARY_STARS[0];
    const sB = BINARY_STARS[1];
    const dirA = new THREE.Vector3(sA.pos.x - p.pos.x, sA.pos.y - p.pos.y, sA.pos.z - p.pos.z).normalize();
    const dirB = new THREE.Vector3(sB.pos.x - p.pos.x, sB.pos.y - p.pos.y, sB.pos.z - p.pos.z).normalize();
    const colA = new THREE.Color(sA.color);
    const colB = new THREE.Color(sB.color);
    const surfaceMat = new THREE.ShaderMaterial({
      vertexShader: PLANET_VERT,
      fragmentShader: BINARY_PLANET_FRAG,
      uniforms: {
        uMap: { value: binaryTexture(p) },
        uStarA: { value: dirA },
        uColA: { value: colA },
        uStarB: { value: dirB },
        uColB: { value: colB },
        uTime: { value: 0 },
      },
    });
    const surface = new THREE.Mesh(new THREE.SphereGeometry(p.radius, 64, 40), surfaceMat);
    surface.name = 'surface';
    // align cool hemisphere toward primary star A, warm hemisphere toward companion B
    surface.rotation.y = 0.55;
    surface.rotation.z = 0.16;
    const wideHalo = binaryHaloShell(p, HALO_SCALE, 3.0, 0.44, dirA, colA, dirB, colB);
    const narrowHalo = binaryHaloShell(p, HALO_SCALE_NARROW, 5.4, 0.36, dirA, colA, dirB, colB);
    g.add(surface, wideHalo, narrowHalo);
    g.userData.timeMats = [surfaceMat];
    return g;
  }

  const surface = new THREE.Mesh(
    new THREE.SphereGeometry(p.radius, 64, 40),
    new THREE.ShaderMaterial({
      vertexShader: PLANET_VERT,
      fragmentShader: PLANET_FRAG,
      uniforms: {
        uMap: { value: planetTexture(p) },
        uSun: { value: sunDir },
        uAtmo: { value: atmo },
        uGlow: { value: p.kind === 'lava' ? 0.9 : 0 },
        uSpec: { value: p.kind === 'ice-ring' || p.kind === 'ice' || p.kind === 'gas' ? 1 : p.kind === 'gas-storm' ? 0.45 : 0 },
        uTime: { value: 0 },
        uStorm: { value: p.kind === 'gas-storm' ? 1 : 0 },
      },
    }),
  );
  surface.name = 'surface';
  surface.rotation.z = 0.25;
  const halo = haloShell(p, HALO_SCALE, p.kind === 'gas-storm' ? 4.5 : 3.2, p.kind === 'gas-storm' ? 0.38 : 0.45, atmo);
  g.add(surface, halo);
  const timeMats: THREE.ShaderMaterial[] = [];
  if (p.kind === 'gas-storm') {
    g.add(haloShell(p, HALO_SCALE_NARROW, 5.5, 0.24, atmo));
    timeMats.push(surface.material as THREE.ShaderMaterial);
    const gasStation = buildGasStation(p);
    gasStation.name = 'gasStation';
    g.add(gasStation);
  }
  if (p.kind === 'ice-ring') {
    // dual halo: narrow bright rim (sharper peak) inside the wide mist
    g.add(haloShell(p, HALO_SCALE_NARROW, 6.0, 0.5, atmo));
    // low-temperature frost veil on the sun side
    const frost = new THREE.Mesh(
      new THREE.SphereGeometry(p.radius * FROST_SCALE, 48, 32),
      new THREE.ShaderMaterial({
        vertexShader: PLANET_VERT,
        fragmentShader: FROST_FRAG,
        uniforms: { uSun: { value: sunDir }, uAtmo: { value: atmo }, uTime: { value: 0 } },
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    g.add(frost);
    const rings = buildRings(p);
    g.add(rings);
    timeMats.push(rings.userData.material as THREE.ShaderMaterial, frost.material as THREE.ShaderMaterial);
  }
  g.userData.timeMats = timeMats;
  return g;
}

function buildBelt(): THREE.InstancedMesh {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  // lumpy rock: displace vertices deterministically (same position → same offset)
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = 0.78 + 0.4 * Math.abs(Math.sin(x * 12.9 + y * 78.2 + z * 37.7) * 43758.5 % 1);
    pos.setXYZ(i, x * k, y * k, z * k);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ map: rockTexture(), color: 0xb9b2ac, roughness: 0.95, metalness: 0.05, flatShading: true });
  const rocks = beltRocks();
  const mesh = new THREE.InstancedMesh(geo, mat, rocks.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  rocks.forEach((r, i) => {
    q.setFromEuler(e.set(r.rot.x, r.rot.y, r.rot.z));
    m.compose(new THREE.Vector3(r.pos.x, r.pos.y, r.pos.z), q, new THREE.Vector3(r.scale.x, r.scale.y, r.scale.z));
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/** observatory exterior, shown only in space mode */
function buildStation(): THREE.Group {
  const g = new THREE.Group();
  g.position.set(STATION.pos.x, STATION.pos.y, STATION.pos.z);
  g.add(arc([[0, -5], [6, -4.4], [13, -1.6], [16, 0.2], [16, 1.2], [12.5, 2.2], [9, 3.4], [7.6, 3.6]], 0, 360, MAT.hull, 56));
  g.add(arc([[16.03, 0.4], [16.03, 1.0]], 0, 360, MAT.cyanGlow, 56));
  g.add(arc([[9.2, 3.38], [8.6, 3.55]], 0, 360, MAT.cyanGlow, 56));
  // glass observatory dome
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(7.6, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x9fe4ff, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.45, emissive: 0x2a8ac8, emissiveIntensity: 0.5 }),
  );
  dome.position.y = 3.5;
  dome.scale.y = 0.55;
  g.add(dome);
  // dome ribs + window lights around the rim
  for (let i = 0; i < 6; i++) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(7.62, 0.12, 6, 32, Math.PI), MAT.hull);
    rib.position.y = 3.5;
    rib.scale.y = 0.55;
    rib.rotation.y = (i / 6) * Math.PI;
    g.add(rib);
  }
  const port = new THREE.BoxGeometry(1.4, 0.5, 0.1);
  const portMat = glow(0xcff4ff, 1.5);
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    const w = new THREE.Mesh(port, portMat);
    w.position.set(Math.sin(a) * 14.35, 1.75, Math.cos(a) * 14.35);
    w.rotation.set(-0.28, a, 0, 'YXZ');
    g.add(w);
  }
  // keel + antenna
  const keel = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 0.5, 5, 16), MAT.metal);
  keel.position.y = -6.5;
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10), glow(PAL.tealAccent, 1.8));
  beacon.position.y = -9.2;
  beacon.name = 'beacon';
  g.add(keel, beacon);
  return g;
}

export interface SpaceView {
  /** always visible (also seen through the cabin windows) */
  far: THREE.Group;
  /** only in flight */
  near: THREE.Group;
  sunLight: THREE.DirectionalLight;
  setTarget(id: string | null): void;
  update(t: number, dt: number, cam: THREE.Camera, shipPos: THREE.Vector3, shipFwd: THREE.Vector3, speedFrac: number): void;
}

const DUST_COUNT = 420;
const DUST_BOX = 260;

export function buildSpace(): SpaceView {
  const far = new THREE.Group();
  const near = new THREE.Group();

  // sun
  const sunPos = sunDir.clone().multiplyScalar(SUN_DISTANCE);
  const sun = new THREE.Mesh(new THREE.SphereGeometry(SUN_RADIUS, 32, 20), glow(PAL.sun, 2.4, { fog: false }));
  sun.position.copy(sunPos);
  const flare = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: flareTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
  );
  flare.position.copy(sunPos);
  flare.scale.setScalar(SUN_RADIUS * 14);
  const corona = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: radialTexture([[0, 'rgba(255,240,200,0.9)'], [0.3, 'rgba(255,200,120,0.35)'], [1, 'rgba(255,160,80,0)']], 256),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }),
  );
  corona.position.copy(sunPos);
  corona.scale.setScalar(SUN_RADIUS * 7);
  far.add(sun, corona, flare);

  const binaryStars = BINARY_STARS.map(buildBinaryStar);
  for (const bs of binaryStars) far.add(bs.group);

  const planets = PLANETS.map(buildPlanet);
  far.add(...planets);
  far.add(buildBelt());
  const markerMat = new THREE.MeshBasicMaterial({
    color: PAL.cyan, transparent: true, opacity: 0.7,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const marker = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.12, 72), markerMat);
  marker.rotation.x = -Math.PI / 2;
  marker.visible = false;
  far.add(marker);

  const station = buildStation();
  near.add(station);
  const beacon = station.getObjectByName('beacon')!;

  // lighting for lit meshes in flight (ship, rocks, station)
  const baseSunColor = new THREE.Color(0xfff4e0);
  const coolStarColor = new THREE.Color(BINARY_STARS[0].color);
  const warmStarColor = new THREE.Color(BINARY_STARS[1].color);
  const sunLight = new THREE.DirectionalLight(baseSunColor, 2.6);
  const baseSunPos = sunDir.clone().multiplyScalar(100);
  sunLight.position.copy(baseSunPos);
  const fill = new THREE.HemisphereLight(0xbfd4ff, 0x5a4a9a, 1.25);
  near.add(sunLight, sunLight.target, fill);
  // local warm-orange DirectionalLight for the binary system (in `near`, so cabin is isolated,
  // and smoothly attenuated by ship distance to binary center so the rest of the sector stays untouched)
  const binaryPlanet = PLANETS.find((p) => p.kind === 'binary');
  const binaryCenter = binaryPlanet ? new THREE.Vector3(binaryPlanet.pos.x, binaryPlanet.pos.y, binaryPlanet.pos.z) : null;
  const binaryCoolPos = binaryCenter
    ? new THREE.Vector3(
        BINARY_STARS[0].pos.x - binaryCenter.x,
        BINARY_STARS[0].pos.y - binaryCenter.y,
        BINARY_STARS[0].pos.z - binaryCenter.z,
      )
        .normalize()
        .multiplyScalar(100)
    : baseSunPos.clone();
  const binaryWarmDir = new THREE.Vector3(BINARY_STARS[1].pos.x, BINARY_STARS[1].pos.y, BINARY_STARS[1].pos.z).normalize();
  const binaryWarmLight = new THREE.DirectionalLight(warmStarColor, 0);
  binaryWarmLight.position.copy(binaryWarmDir).multiplyScalar(100);
  near.add(binaryWarmLight, binaryWarmLight.target);
  // local warm-orange PointLight on red-giant star (range-limited so it never pollutes cabin/origin)
  for (const p of PLANETS) {
    if (p.kind !== 'red-giant') continue;
    const starLight = new THREE.PointLight(0xff8438, 1200, p.radius * 3.8, 0.85);
    starLight.position.set(p.pos.x, p.pos.y, p.pos.z);
    near.add(starLight);
  }

  // stardust: points in a box around the ship, wrapped as it moves
  const rnd = mulberry32(3);
  const dust = new Float32Array(DUST_COUNT * 3);
  for (let i = 0; i < dust.length; i++) dust[i] = (rnd() - 0.5) * DUST_BOX;
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dust, 3));
  const dustMat = new THREE.PointsMaterial({
    map: radialTexture([[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(180,230,255,0.5)'], [1, 'rgba(120,200,255,0)']], 32),
    color: 0xcfeeff, size: 1.1, sizeAttenuation: true, transparent: true, opacity: 0.6,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const dustPts = new THREE.Points(dustGeo, dustMat);
  dustPts.frustumCulled = false;
  near.add(dustPts);

  return {
    far,
    near,
    sunLight,
    setTarget(id) {
      const p = id === null ? undefined : PLANETS.find((planet) => planet.id === id);
      if (!p) {
        marker.visible = false;
        return;
      }
      marker.position.set(p.pos.x, p.pos.y - p.radius * 1.3, p.pos.z);
      marker.scale.setScalar(p.radius * 1.3);
      marker.visible = true;
    },
    update(t, dt, _cam, shipPos, _fwd, speedFrac) {
      for (const p of planets) {
        p.getObjectByName('surface')!.rotation.y += dt * 0.01;
        for (const m of (p.userData.timeMats ?? []) as THREE.ShaderMaterial[]) m.uniforms.uTime.value = t;
        const gs = p.getObjectByName('gasStation');
        if (gs) {
          const base = gs.userData.basePos as THREE.Vector3;
          const rad = gs.userData.radial as THREE.Vector3;
          const amp = (gs.userData.bobAmp as number) ?? 2.9;
          gs.position.copy(base).addScaledVector(rad, Math.sin(t * 0.7) * amp);
          const body = gs.getObjectByName('gasStationBody');
          if (body) body.rotation.y += dt * 0.22;
          const gb = gs.getObjectByName('gasBeacon');
          if (gb) gb.scale.setScalar(1 + 0.45 * Math.max(0, Math.sin(t * 3.2)));
        }
        const sf = p.getObjectByName('starFlare') as THREE.Sprite | undefined;
        if (sf) {
          const bs = (sf.userData.baseScale as number) ?? 1500;
          sf.material.rotation = t * 0.032;
          sf.scale.setScalar(bs * (1 + 0.045 * Math.sin(t * 0.75)));
        }
        const dm = p.getObjectByName('dustMotes');
        if (dm) dm.rotation.y += dt * 0.008;
      }
      markerMat.opacity = 0.55 + 0.25 * Math.sin(t * 2.4);
      flare.material.rotation = t * 0.02;
      flare.scale.setScalar(SUN_RADIUS * (14 + Math.sin(t * 0.9) * 0.8));
      binaryStars.forEach((bs, idx) => {
        bs.mat.uniforms.uTime.value = t;
        bs.flare.material.rotation = t * (idx === 0 ? 0.026 : -0.031);
        bs.flare.scale.setScalar(bs.baseScale * (1 + 0.04 * Math.sin(t * (idx === 0 ? 0.85 : 1.05) + idx * 1.7)));
      });
      if (binaryCenter) {
        // smooth distance attenuation: full dual-temperature lighting <= 550, zero >= 1100
        const dBin = shipPos.distanceTo(binaryCenter);
        const u = Math.max(0, Math.min(1, (dBin - 550) / (1100 - 550)));
        const w = 1 - u * u * (3 - 2 * u);
        binaryWarmLight.intensity = 1.5 * w;
        sunLight.color.copy(baseSunColor).lerp(coolStarColor, w);
        sunLight.position.copy(baseSunPos).lerp(binaryCoolPos, w);
      }
      beacon.scale.setScalar(1 + 0.5 * Math.max(0, Math.sin(t * 3)));
      // wrap dust into the box centred on the ship
      const h = DUST_BOX / 2;
      for (let i = 0; i < DUST_COUNT; i++) {
        for (let k = 0; k < 3; k++) {
          const c = k === 0 ? shipPos.x : k === 1 ? shipPos.y : shipPos.z;
          let v = dust[i * 3 + k];
          if (v - c > h) v -= DUST_BOX * Math.ceil((v - c - h) / DUST_BOX);
          else if (v - c < -h) v += DUST_BOX * Math.ceil((c - h - v) / DUST_BOX);
          dust[i * 3 + k] = v;
        }
      }
      dustGeo.attributes.position.needsUpdate = true;
      dustMat.size = 0.9 + speedFrac * 1.6;
    },
  };
}
