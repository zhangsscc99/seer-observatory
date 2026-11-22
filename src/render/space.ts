// Space sector: sun (+ billboard flare), planets with fresnel atmospheres,
// instanced asteroid belt, stardust that streams past the ship, and the
// observatory station exterior. Built from src/game/space.ts data.
import * as THREE from 'three';
import { mulberry32 } from '../game/rng.ts';
import { beltRocks, BINARY_STARS, PLANETS, STATION, SUN_DIR, SUN_DISTANCE, SUN_RADIUS, type BinaryStarDef, type PlanetDef } from '../game/space.ts';
import { MAT, arc, glow } from './materials.ts';
import { PAL } from './palette.ts';
import { buildRings } from './rings.ts';
import {
  binaryTexture,
  blackholeDiskTexture,
  blackholeLensTexture,
  flareTexture,
  planetTexture,
  radialTexture,
  redGiantTexture,
  ringCityCoreTexture,
  ringCityHullTexture,
  rockTexture,
} from './textures.ts';

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

// self-luminous twin star photosphere: incandescent white-hot core fading smoothly
// into saturated color-temperature chromosphere (avoids flat solid-disc ACES clipping)
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
  float core = pow(ndv, 1.35);
  float innerHot = smoothstep(0.42, 0.96, ndv);
  vec3 outerCol = mix(uColor * 0.68, uColor * 1.12, pow(ndv, 0.65));
  vec3 photosphere = mix(outerCol, vec3(1.0, 0.99, 0.97) * 1.85, innerHot * 0.88);
  float shimmer = 0.92 + 0.14 * boil + 0.08 * fine;
  vec3 col = photosphere * shimmer * (0.68 + 0.46 * core) * uIntensity;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// binary-system planet: dual-star cool/warm illumination, 3 fine counter-drifting
// cirrus cloud bands on each side of the twilight belt, soft dual fresnel, night >= 0.08
const BINARY_PLANET_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uStarA; uniform vec3 uColA;
uniform vec3 uStarB; uniform vec3 uColB;
uniform float uTime;
varying vec3 vN; varying vec3 vW; varying vec2 vUv;
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise2(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  float ndlA = dot(n, uStarA);
  float ndlB = dot(n, uStarB);
  float dayA = smoothstep(-0.14, 0.42, ndlA);
  float dayB = smoothstep(-0.14, 0.42, ndlB);
  // soft atmospheric twilight wrap so cloud bands read across the backlit crescent face
  float wrapA = smoothstep(-0.55, 0.25, ndlA);
  float wrapB = smoothstep(-0.55, 0.25, ndlB);

  // differential base deck + counter-sheared upper cirrus sampling
  float lat = (vUv.y - 0.5) * 2.0;
  float drift = uTime * 0.0024 * (1.0 - 0.45 * lat * lat);
  vec2 uv1 = vec2(vUv.x + drift, clamp(vUv.y, 0.001, 0.999));
  vec2 uv2 = vec2(vUv.x - drift * 1.45 + 0.003 * sin(vUv.y * 24.0 + uTime * 0.18), clamp(vUv.y, 0.001, 0.999));
  vec3 albedo = mix(texture2D(uMap, uv1).rgb, texture2D(uMap, uv2).rgb, 0.24);

  // 3 fine cirrus cloud bands on each side of the twilight belt (twi = 0) at distinct speeds/directions
  float twi = ndlA - ndlB;
  vec3 beltAxis = normalize(cross(uStarA, uStarB));
  float along = dot(n, beltAxis);
  float waveA1 = 0.022 * sin(along * 9.0 + uTime * 0.24);
  float waveA2 = 0.026 * sin(along * 13.0 - uTime * 0.17 + 1.4);
  float waveA3 = 0.018 * sin(along * 17.0 + uTime * 0.12 + 2.8);
  float bA1 = exp(-pow((twi - (0.13 + waveA1)) / 0.032, 2.0)) * (0.45 + 0.55 * vnoise2(vec2(along * 11.0 + uTime * 0.18, twi * 22.0)));
  float bA2 = exp(-pow((twi - (0.28 + waveA2)) / 0.036, 2.0)) * (0.40 + 0.60 * vnoise2(vec2(along * 15.0 - uTime * 0.14, twi * 26.0 + 3.1)));
  float bA3 = exp(-pow((twi - (0.45 + waveA3)) / 0.040, 2.0)) * (0.35 + 0.65 * vnoise2(vec2(along * 19.0 + uTime * 0.10, twi * 30.0 + 6.4)));
  float coolCirrus = clamp(bA1 * 0.85 + bA2 * 0.78 + bA3 * 0.65, 0.0, 1.0);

  float waveB1 = 0.022 * sin(along * 10.0 - uTime * 0.22 + 0.7);
  float waveB2 = 0.026 * sin(along * 14.0 + uTime * 0.16 + 2.1);
  float waveB3 = 0.018 * sin(along * 18.0 - uTime * 0.11 + 4.0);
  float bB1 = exp(-pow((twi + (0.13 + waveB1)) / 0.032, 2.0)) * (0.45 + 0.55 * vnoise2(vec2(along * 12.0 - uTime * 0.17, twi * 22.0 + 1.7)));
  float bB2 = exp(-pow((twi + (0.28 + waveB2)) / 0.036, 2.0)) * (0.40 + 0.60 * vnoise2(vec2(along * 16.0 + uTime * 0.13, twi * 26.0 + 5.2)));
  float bB3 = exp(-pow((twi + (0.45 + waveB3)) / 0.040, 2.0)) * (0.35 + 0.65 * vnoise2(vec2(along * 20.0 - uTime * 0.09, twi * 30.0 + 8.3)));
  float warmCirrus = clamp(bB1 * 0.85 + bB2 * 0.78 + bB3 * 0.65, 0.0, 1.0);

  albedo = mix(albedo, vec3(0.84, 0.94, 1.0), coolCirrus * 0.52);
  albedo = mix(albedo, vec3(1.0, 0.88, 0.72), warmCirrus * 0.52);

  // dual-color-temperature lighting with guaranteed night-side floor (>= 0.08)
  vec3 ambient = vec3(0.085, 0.095, 0.125);
  vec3 lightA = uColA * (dayA * 0.86 + wrapA * 0.24);
  vec3 lightB = uColB * (dayB * 0.76 + wrapB * 0.22);
  vec3 col = albedo * (ambient + lightA + lightB);
  // subtle illuminated scatter on the fine cirrus ribbons near the terminator
  col += vec3(0.62, 0.86, 1.0) * coolCirrus * (0.10 + 0.18 * wrapA);
  col += vec3(1.0, 0.72, 0.42) * warmCirrus * (0.10 + 0.18 * wrapB);

  // subtle twin-star specular glints on high cirrus clouds
  float specA = pow(max(dot(n, normalize(v + uStarA)), 0.0), 42.0) * 0.20 * dayA;
  float specB = pow(max(dot(n, normalize(v + uStarB)), 0.0), 36.0) * 0.18 * dayB;
  col += uColA * specA + uColB * specB;

  // softer dual-sided fresnel inner rim: cool cyan-blue on star-A face, warm amber-orange on star-B face
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  float rimA = smoothstep(-0.32, 0.38, ndlA);
  float rimB = smoothstep(-0.32, 0.38, ndlB);
  col += vec3(0.50, 0.82, 1.0) * fres * rimA * 0.52;
  col += vec3(1.0, 0.60, 0.28) * fres * rimB * 0.48;
  // subtle night-side indigo scatter so silhouette stays crisp
  col += vec3(0.18, 0.26, 0.42) * fres * (1.0 - max(rimA, rimB)) * 0.14;

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// softer dual-tinted outer halo shell for the binary planet (BackSide, additive)
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
  float litA = smoothstep(-0.30, 0.42, dot(n, uStarA));
  float litB = smoothstep(-0.30, 0.42, dot(n, uStarB));
  vec3 tintA = uColA * vec3(0.76, 0.92, 1.0);
  vec3 tintB = uColB * vec3(1.0, 0.74, 0.44);
  vec3 tint = tintA * litA * 0.72 + tintB * litB * 0.68;
  // prevent overlapping star-lit limbs from blowing out into a hard white ring
  float peak = max(1.0, max(tint.r, max(tint.g, tint.b)));
  tint /= peak;
  gl_FragColor = vec4(tint * a * uGain, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const HALO_SCALE = 1.16;
const HALO_SCALE_NARROW = 1.05;
const FROST_SCALE = 1.02;
const DUST_VEIL_SCALE = 2.6;

/** tilted accretion disk orientation in world space (local XZ -> tilted world plane, ~17° tilt) */
export const BH_DISK_QUAT = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.28, 0.14, -0.22));
export const BH_SPIN_AXIS = new THREE.Vector3(0, 1, 0).applyQuaternion(BH_DISK_QUAT).normalize();

/** tilted orbital ring-city plane orientation in world space (~16° tilt) */
export const RING_CITY_QUAT = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.22, -0.18, 0.14));

// thin artificial shield shell (1.00R–1.04R, FrontSide, pale blue, alpha <= 0.18, no natural haze)
const RING_SHIELD_FRAG = /* glsl */ `
uniform vec3 uCol;
uniform float uTime;
varying vec3 vN;
varying vec3 vW;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  float ndv = abs(dot(n, v));
  float rim = pow(1.0 - ndv, 2.5);
  float band = 0.88 + 0.12 * sin(vW.y * 0.25 + uTime * 1.4);
  // faint face sheen + bright fresnel rim so the shell reads as an energy envelope
  float a = clamp(0.05 + rim * 0.30 * band, 0.0, 0.30);
  gl_FragColor = vec4(uCol, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** RingGeometry in local XZ (or XY when `inXY = true`) with seamless polar UVs:
 *  u = azimuth [0,1) around the ring, v = radial [0,1] from innerR to outerR. */
function polarRingGeometry(innerR: number, outerR: number, thetaSegs = 128, radialSegs = 6, inXY = false): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const cols = thetaSegs + 1;
  const rows = radialSegs + 1;
  const positions = new Float32Array(cols * rows * 3);
  const normals = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  const indices: number[] = [];

  for (let rIdx = 0; rIdx < rows; rIdx++) {
    const v = rIdx / radialSegs;
    const r = innerR + (outerR - innerR) * v;
    for (let tIdx = 0; tIdx < cols; tIdx++) {
      const u = tIdx / thetaSegs;
      const ang = u * Math.PI * 2;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const idx = rIdx * cols + tIdx;
      if (inXY) {
        positions[idx * 3] = ca * r;
        positions[idx * 3 + 1] = sa * r;
        positions[idx * 3 + 2] = 0;
        normals[idx * 3] = 0;
        normals[idx * 3 + 1] = 0;
        normals[idx * 3 + 2] = 1;
      } else {
        positions[idx * 3] = ca * r;
        positions[idx * 3 + 1] = 0;
        positions[idx * 3 + 2] = sa * r;
        normals[idx * 3] = 0;
        normals[idx * 3 + 1] = 1;
        normals[idx * 3 + 2] = 0;
      }
      uvs[idx * 2] = u;
      uvs[idx * 2 + 1] = v;
    }
  }
  for (let rIdx = 0; rIdx < radialSegs; rIdx++) {
    for (let tIdx = 0; tIdx < thetaSegs; tIdx++) {
      const a = rIdx * cols + tIdx;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/** Black hole (`blackhole`): event horizon + asymmetric white-hot photon ring +
 *  dual tilted Keplerian accretion disks with relativistic Doppler beaming +
 *  gravitationally lensed back-side disk arch + 1.15R–1.60R bent starlight Einstein ring +
 *  backlit purple/gold dust veil & 420 dust motes. All materials follow the rendering ladder
 *  (MeshBasicMaterial / PointsMaterial + onBeforeCompile; zero RawShaderMaterial / post-FX). */
function buildBlackhole(p: PlanetDef): THREE.Group {
  const g = new THREE.Group();
  g.position.set(p.pos.x, p.pos.y, p.pos.z);

  const center = new THREE.Vector3(p.pos.x, p.pos.y, p.pos.z);
  const bhUniforms = {
    uTime: { value: 0 },
    uCenter: { value: center },
    uSpinAxis: { value: BH_SPIN_AXIS.clone() },
    uCamPhase: { value: 0 },
  };

  // 1) Event horizon: pure void-black sphere (1.005R avoids any z-fighting with inner shells)
  const horizonR = p.radius * 1.005;
  const horizon = new THREE.Mesh(
    new THREE.SphereGeometry(horizonR, 64, 48),
    new THREE.MeshBasicMaterial({ color: 0x000000 }),
  );
  horizon.name = 'surface';
  horizon.renderOrder = 1;
  g.add(horizon);

  // 2) Asymmetric white-hot photon ring (1.02R–1.085R BackSide additive shell via onBeforeCompile)
  const photonScale = 1.088;
  const photonEdge = Math.sqrt(1 - Math.pow(horizonR / (p.radius * photonScale), 2));
  const photonMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.BackSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  photonMat.customProgramCacheKey = () => 'bh-photon-ring-v1';
  photonMat.onBeforeCompile = (shader) => {
    shader.uniforms.uCenter = bhUniforms.uCenter;
    shader.uniforms.uSpinAxis = bhUniforms.uSpinAxis;
    shader.uniforms.uEdge = { value: photonEdge };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBhW;\nvarying vec3 vBhN;')
      .replace(
        '#include <project_vertex>',
        'vBhN = normalize(mat3(modelMatrix) * normal);\nvBhW = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#include <project_vertex>',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uCenter;\nuniform vec3 uSpinAxis;\nuniform float uEdge;\nvarying vec3 vBhW;\nvarying vec3 vBhN;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 n = normalize(vBhN);
        vec3 v = normalize(cameraPosition - vBhW);
        float d = clamp(-dot(n, v) / uEdge, 0.0, 1.0);
        // razor-sharp incandescent photon ring at 1.005R..1.05R + soft lavender-gold outer halo
        float sharp = pow(d, 7.2) * 2.55;
        float glow = pow(d, 2.3) * 0.58;
        vec3 rad = normalize(vBhW - uCenter);
        vec3 tang = cross(uSpinAxis, rad);
        float tLen = length(tang);
        vec3 vel = tLen > 0.001 ? tang / tLen : vec3(0.0, 1.0, 0.0);
        float doppler = dot(vel, v);
        // observer-facing approaching side burns white-hot blue-white; receding side is softer warm-violet
        float asym = mix(0.55, 1.62, smoothstep(-0.85, 0.85, doppler));
        vec3 colApproach = vec3(0.92, 0.96, 1.0);
        vec3 colRecede = vec3(1.0, 0.72, 0.56);
        vec3 ringTint = mix(colRecede, colApproach, smoothstep(-0.75, 0.75, doppler));
        vec3 outerTint = mix(vec3(0.56, 0.34, 0.88), vec3(0.84, 0.88, 1.0), smoothstep(-0.6, 0.6, doppler));
        diffuseColor.rgb = (ringTint * sharp + outerTint * glow) * asym;
        diffuseColor.a = 1.0;`,
      );
  };
  const photonRing = new THREE.Mesh(new THREE.SphereGeometry(p.radius * photonScale, 64, 48), photonMat);
  photonRing.renderOrder = 3;
  g.add(photonRing);

  // 3) Accretion Disk: dual tilted Keplerian disks (inner 1.35R..2.38R faster, outer 1.95R..3.42R slower)
  const diskTex = blackholeDiskTexture(p.seed);
  const makeDiskMat = (cacheKey: string, speed: number, gain: number, warmShift: number): THREE.MeshBasicMaterial => {
    const mat = new THREE.MeshBasicMaterial({
      map: diskTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    mat.customProgramCacheKey = () => cacheKey;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = bhUniforms.uTime;
      shader.uniforms.uCenter = bhUniforms.uCenter;
      shader.uniforms.uSpinAxis = bhUniforms.uSpinAxis;
      shader.uniforms.uSpeed = { value: speed };
      shader.uniforms.uGain = { value: gain };
      shader.uniforms.uWarmShift = { value: warmShift };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vBhW;\nvarying vec2 vBhUv;')
        .replace(
          '#include <project_vertex>',
          'vBhUv = uv;\nvBhW = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#include <project_vertex>',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform float uTime;\nuniform vec3 uCenter;\nuniform vec3 uSpinAxis;\nuniform float uSpeed;\nuniform float uGain;\nuniform float uWarmShift;\nvarying vec3 vBhW;\nvarying vec2 vBhUv;',
        )
        .replace(
          '#include <map_fragment>',
          `// Keplerian differential UV advection: inner orbits sweep noticeably faster than outer edge
          float kepler = 1.0 + 1.35 * (1.0 - vBhUv.y);
          vec2 uvA = vec2(fract(vBhUv.x - uTime * uSpeed * kepler), clamp(vBhUv.y, 0.002, 0.998));
          vec2 uvB = vec2(fract(vBhUv.x - uTime * uSpeed * kepler * 0.62 + 0.37), clamp(vBhUv.y * 0.96 + 0.02, 0.002, 0.998));
          vec4 texA = texture2D(map, uvA);
          vec4 texB = texture2D(map, uvB);
          vec3 diskRgb = mix(texA.rgb, texB.rgb, 0.34);
          // Relativistic Doppler beaming: approaching side blue-white & intense, receding side red-dim
          vec3 rad = normalize(vBhW - uCenter);
          vec3 tang = cross(uSpinAxis, rad);
          float tLen = length(tang);
          vec3 vel = tLen > 0.001 ? tang / tLen : vec3(1.0, 0.0, 0.0);
          vec3 toCam = normalize(cameraPosition - vBhW);
          float doppler = dot(vel, toCam);
          float beam = mix(0.32, 1.98, smoothstep(-0.88, 0.88, doppler));
          vec3 shiftHot = mix(vec3(1.0), vec3(0.76, 0.92, 1.32), max(doppler, 0.0));
          vec3 shiftCool = mix(vec3(1.0), vec3(1.18, 0.42, 0.30), max(-doppler, 0.0));
          vec3 radialTint = mix(vec3(1.0), vec3(0.95, 0.72, 0.88), uWarmShift * vBhUv.y);
          float edgeFade = smoothstep(0.0, 0.10, vBhUv.y) * (1.0 - smoothstep(0.78, 1.0, vBhUv.y));
          diffuseColor.rgb = diskRgb * shiftHot * shiftCool * radialTint * beam * uGain * edgeFade;
          diffuseColor.a = 1.0;`,
        );
    };
    return mat;
  };

  const diskGroup = new THREE.Group();
  diskGroup.name = 'accretionDisk';
  diskGroup.quaternion.copy(BH_DISK_QUAT);

  const innerDiskMat = makeDiskMat('bh-disk-inner-v1', 0.055, 1.18, 0.0);
  const innerDisk = new THREE.Mesh(polarRingGeometry(p.radius * 1.35, p.radius * 2.38, 128, 6), innerDiskMat);
  innerDisk.name = 'innerDisk';
  innerDisk.renderOrder = 4;

  const outerDiskMat = makeDiskMat('bh-disk-outer-v1', 0.022, 0.88, 0.45);
  const outerDisk = new THREE.Mesh(polarRingGeometry(p.radius * 1.95, p.radius * 3.42, 128, 6), outerDiskMat);
  outerDisk.name = 'outerDisk';
  outerDisk.position.y = p.radius * 0.012;
  outerDisk.renderOrder = 4;

  diskGroup.add(innerDisk, outerDisk);
  g.add(diskGroup);

  // 4) Gravitationally lensed back-side accretion disk arch (billboard aligned to projected spin axis)
  const lensedDiskMat = new THREE.MeshBasicMaterial({
    map: diskTex,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  lensedDiskMat.customProgramCacheKey = () => 'bh-lensed-disk-v1';
  lensedDiskMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = bhUniforms.uTime;
    shader.uniforms.uCenter = bhUniforms.uCenter;
    shader.uniforms.uSpinAxis = bhUniforms.uSpinAxis;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBhW;\nvarying vec2 vBhUv;')
      .replace(
        '#include <project_vertex>',
        'vBhUv = uv;\nvBhW = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#include <project_vertex>',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uTime;\nuniform vec3 uCenter;\nuniform vec3 uSpinAxis;\nvarying vec3 vBhW;\nvarying vec2 vBhUv;',
      )
      .replace(
        '#include <map_fragment>',
        `// local billboard XY: angle 0 = +X (disk equator), angle PI/2 = +Y (upper lensed arch), -PI/2 = -Y (lower arch)
        float ang = vBhUv.x * 6.2831853;
        float sinA = sin(ang);
        float cosA = cos(ang);
        // upper arch (sinA > 0) brighter/fuller, lower secondary arch (sinA < 0) thinner; equatorial band attenuated
        float upperArch = smoothstep(0.05, 0.55, sinA);
        float lowerArch = smoothstep(-0.08, -0.62, sinA) * 0.65;
        float archMask = upperArch + lowerArch;
        float radEnv = smoothstep(0.0, 0.14, vBhUv.y) * (1.0 - smoothstep(0.42 + 0.34 * upperArch, 0.98, vBhUv.y));
        vec2 uvL = vec2(fract(vBhUv.x * 1.5 - uTime * 0.042), clamp(vBhUv.y * 0.82 + 0.06, 0.002, 0.998));
        vec3 texRgb = texture2D(map, uvL).rgb;
        // Doppler asymmetry consistent with the 3D disk (cosA aligns with approaching/receding tangent)
        vec3 rad = normalize(vBhW - uCenter);
        vec3 tang = cross(uSpinAxis, rad);
        float tLen = length(tang);
        vec3 vel = tLen > 0.001 ? tang / tLen : vec3(1.0, 0.0, 0.0);
        vec3 toCam = normalize(cameraPosition - vBhW);
        float doppler = dot(vel, toCam);
        float beam = mix(0.45, 1.65, smoothstep(-0.85, 0.85, doppler));
        vec3 shiftHot = mix(vec3(1.0), vec3(0.80, 0.94, 1.28), max(doppler, 0.0));
        vec3 shiftCool = mix(vec3(1.0), vec3(1.16, 0.48, 0.38), max(-doppler, 0.0));
        diffuseColor.rgb = texRgb * shiftHot * shiftCool * beam * archMask * radEnv * 0.92;
        diffuseColor.a = 1.0;`,
      );
  };
  const lensedDisk = new THREE.Mesh(polarRingGeometry(p.radius * 1.03, p.radius * 1.72, 112, 4, true), lensedDiskMat);
  lensedDisk.name = 'lensedDisk';
  lensedDisk.renderOrder = 3;
  g.add(lensedDisk);

  // 5) Gravitational Lensing Starlight / Nebula Arc (1.15R–1.60R billboard Einstein ring, distinct cool layer)
  const lensTex = blackholeLensTexture(p.seed + 18);
  const lensMat = new THREE.MeshBasicMaterial({
    map: lensTex,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  lensMat.customProgramCacheKey = () => 'bh-einstein-lens-v1';
  lensMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = bhUniforms.uTime;
    shader.uniforms.uCamPhase = bhUniforms.uCamPhase;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vBhUv;')
      .replace('#include <project_vertex>', 'vBhUv = uv;\n#include <project_vertex>');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uTime;\nuniform float uCamPhase;\nvarying vec2 vBhUv;',
      )
      .replace(
        '#include <map_fragment>',
        `// Einstein-ring tangential distortion stronger near 1.15R, decaying toward 1.60R
        float bend = 0.18 / (vBhUv.y + 0.24);
        vec2 uv1 = vec2(fract(vBhUv.x + bend + uCamPhase + uTime * 0.004), clamp(vBhUv.y, 0.002, 0.998));
        vec2 uv2 = vec2(fract(vBhUv.x - bend * 0.65 + uCamPhase * 0.7 - uTime * 0.003 + 0.5), clamp(vBhUv.y * 0.92 + 0.04, 0.002, 0.998));
        vec3 s1 = texture2D(map, uv1).rgb;
        vec3 s2 = texture2D(map, uv2).rgb;
        float arcEnv = sin(vBhUv.y * 3.14159265);
        float caustic = 0.72 + 0.28 * sin(vBhUv.x * 12.56637 + uCamPhase * 6.28318);
        diffuseColor.rgb = (s1 * 0.78 + s2 * 0.36) * vec3(0.76, 0.88, 1.15) * arcEnv * caustic * 0.68;
        diffuseColor.a = 1.0;`,
      );
  };
  const lensRing = new THREE.Mesh(polarRingGeometry(p.radius * 1.15, p.radius * 1.62, 112, 4, true), lensMat);
  lensRing.name = 'lensRing';
  lensRing.renderOrder = 2;
  g.add(lensRing);

  // 6) Volumetric backlit dust veil shell (~2.9R, hollow center, lifts dark space >= 0.06)
  const veilMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  veilMat.customProgramCacheKey = () => 'bh-dust-veil-v1';
  veilMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = bhUniforms.uTime;
    shader.uniforms.uCenter = bhUniforms.uCenter;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBhW;\nvarying vec3 vBhN;')
      .replace(
        '#include <project_vertex>',
        'vBhN = normalize(mat3(modelMatrix) * normal);\nvBhW = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#include <project_vertex>',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform vec3 uCenter;
        varying vec3 vBhW;
        varying vec3 vBhN;
        float bhHash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float bhNoise3(vec3 p) {
          vec3 i = floor(p); vec3 f = fract(p);
          vec3 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(bhHash3(i), bhHash3(i + vec3(1.0, 0.0, 0.0)), u.x), mix(bhHash3(i + vec3(0.0, 1.0, 0.0)), bhHash3(i + vec3(1.0, 1.0, 0.0)), u.x), u.y),
            mix(mix(bhHash3(i + vec3(0.0, 0.0, 1.0)), bhHash3(i + vec3(1.0, 0.0, 1.0)), u.x), mix(bhHash3(i + vec3(0.0, 1.0, 1.0)), bhHash3(i + vec3(1.0, 1.0, 1.0)), u.x), u.y),
            u.z);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 n = normalize(vBhN);
        vec3 v = normalize(cameraPosition - vBhW);
        float ndv = abs(dot(n, v));
        float limb = smoothstep(0.95, 0.30, ndv) * smoothstep(0.04, 0.28, ndv);
        vec3 dir = normalize(vBhW - uCenter);
        float drift = uTime * 0.012;
        float cloud = bhNoise3(dir * 4.8 + vec3(drift, -drift * 0.5, drift * 0.7));
        float fine = bhNoise3(dir * 22.0 - vec3(drift * 1.2, drift * 0.8, -drift));
        vec3 dustCol = mix(vec3(0.24, 0.16, 0.44), vec3(0.88, 0.64, 0.48), cloud * 0.55 + fine * 0.45);
        diffuseColor.rgb = dustCol;
        diffuseColor.a = clamp((0.04 + limb * 0.18) * (0.45 + 0.55 * cloud) * (0.72 + 0.28 * fine), 0.0, 0.24);`,
      );
  };
  const dustVeil = new THREE.Mesh(new THREE.SphereGeometry(p.radius * 2.9, 44, 28), veilMat);
  dustVeil.name = 'bhDustVeil';
  dustVeil.renderOrder = 2;
  g.add(dustVeil);

  // 7) 420 (>=300) backlit orbiting dust motes in 1.55R..3.6R envelope
  const moteCount = 420;
  const rnd = mulberry32(p.seed + 503);
  const mPos = new Float32Array(moteCount * 3);
  const mCol = new Float32Array(moteCount * 3);
  const tmpPt = new THREE.Vector3();
  for (let i = 0; i < moteCount; i++) {
    const phi = rnd() * Math.PI * 2;
    const z = (rnd() * 2 - 1) * (rnd() < 0.65 ? 0.34 : 0.92); // denser near disk plane
    const s = Math.sqrt(Math.max(0, 1 - z * z));
    const r = p.radius * (1.55 + Math.pow(rnd(), 0.78) * 2.1);
    tmpPt.set(s * Math.cos(phi) * r, z * r, s * Math.sin(phi) * r).applyQuaternion(BH_DISK_QUAT);
    mPos[i * 3] = tmpPt.x;
    mPos[i * 3 + 1] = tmpPt.y;
    mPos[i * 3 + 2] = tmpPt.z;
    const warm = Math.max(0, 1 - Math.abs(z) * 1.8);
    const br = 0.62 + rnd() * 0.38;
    mCol[i * 3] = (0.64 + 0.36 * warm) * br;
    mCol[i * 3 + 1] = (0.58 + 0.26 * warm) * br;
    mCol[i * 3 + 2] = (1.0 - 0.34 * warm) * br;
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(mPos, 3));
  moteGeo.setAttribute('color', new THREE.BufferAttribute(mCol, 3));
  const motes = new THREE.Points(
    moteGeo,
    new THREE.PointsMaterial({
      map: radialTexture(
        [
          [0, 'rgba(255,248,240,1)'],
          [0.35, 'rgba(216,190,255,0.68)'],
          [1, 'rgba(120,86,210,0)'],
        ],
        64,
      ),
      size: p.radius * 0.052,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  motes.name = 'dustMotes';
  g.add(motes);

  g.userData.bhUniforms = bhUniforms;
  g.userData.bhCenter = center;
  g.userData.lensedDisk = lensedDisk;
  g.userData.lensRing = lensRing;
  return g;
}

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

/** Artificial orbital ring city (`ring-city`): double metallic rings (1.55R–1.75R main +
 *  1.25R–1.30R inner), >=600 instanced warm-white/amber window light grid, 60 phased
 *  cool-white nav beacons (every 6 deg), 12 ring modules (every 30 deg) with teal strips,
 *  4 opposing docking towers, dark paneled core with blue equatorial lamp + 4 spokes,
 *  and narrow 1.00R–1.04R pale-blue artificial shield (alpha <= 0.18). */
function buildRingCity(p: PlanetDef): THREE.Group {
  const g = new THREE.Group();
  g.position.set(p.pos.x, p.pos.y, p.pos.z);

  const R = p.radius;
  const rnd = mulberry32(p.seed + 31);

  const tilt = new THREE.Group();
  tilt.quaternion.copy(RING_CITY_QUAT);
  g.add(tilt);

  // Rotating ring-city assembly (must be named 'surface' for space.update spin)
  const surface = new THREE.Group();
  surface.name = 'surface';
  tilt.add(surface);

  const hullTex = ringCityHullTexture(p.seed);
  const hullMat = new THREE.MeshStandardMaterial({
    map: hullTex,
    color: 0x8ea6c4,
    metalness: 0.65,
    roughness: 0.35,
    envMapIntensity: 1.55,
    side: THREE.DoubleSide,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0x4e6480,
    metalness: 0.68,
    roughness: 0.35,
    envMapIntensity: 1.45,
    side: THREE.DoubleSide,
  });
  const coreMat = new THREE.MeshStandardMaterial({
    map: ringCityCoreTexture(p.seed),
    color: 0x7389a6,
    metalness: 0.58,
    roughness: 0.5,
    envMapIntensity: 1.45,
  });

  // 1) Main outer ring (1.55R–1.75R) with chamfered architectural profile
  const mainH = R * 0.082;
  const mainRing = arc(
    [
      [R * 1.55, -mainH * 0.65],
      [R * 1.575, -mainH],
      [R * 1.725, -mainH],
      [R * 1.75, -mainH * 0.65],
      [R * 1.75, mainH * 0.65],
      [R * 1.725, mainH],
      [R * 1.575, mainH],
      [R * 1.55, mainH * 0.65],
      [R * 1.55, -mainH * 0.65],
    ],
    0,
    360,
    hullMat,
    96,
  );
  // Structural top/bottom keel rails along the main ring
  const railTop = arc(
    [
      [R * 1.62, mainH],
      [R * 1.62, mainH + R * 0.018],
      [R * 1.68, mainH + R * 0.018],
      [R * 1.68, mainH],
    ],
    0,
    360,
    trimMat,
    96,
  );
  const railBot = arc(
    [
      [R * 1.62, -mainH],
      [R * 1.62, -mainH - R * 0.018],
      [R * 1.68, -mainH - R * 0.018],
      [R * 1.68, -mainH],
    ],
    0,
    360,
    trimMat,
    96,
  );
  surface.add(mainRing, railTop, railBot);

  // Inner secondary ring (1.25R–1.30R) + subtle cyan inner transit line
  const subH = R * 0.036;
  const innerRing = arc(
    [
      [R * 1.25, -subH * 0.7],
      [R * 1.26, -subH],
      [R * 1.29, -subH],
      [R * 1.30, -subH * 0.7],
      [R * 1.30, subH * 0.7],
      [R * 1.29, subH],
      [R * 1.26, subH],
      [R * 1.25, subH * 0.7],
      [R * 1.25, -subH * 0.7],
    ],
    0,
    360,
    trimMat,
    72,
  );
  const transitLine = arc(
    [
      [R * 1.246, -R * 0.008],
      [R * 1.246, R * 0.008],
    ],
    0,
    360,
    glow(0x6fe2ff, 1.45, { side: THREE.DoubleSide }),
    72,
  );
  surface.add(innerRing, transitLine);

  // 2) Dense architectural window light grid: 3 brightness tiers (1.9 / 1.35 / 0.7) via setColorAt,
  //    7:3 cool:warm mix, 28% unlit for crisp urban rhythm (single MeshBasicMaterial)
  type WinSlot = { x: number; y: number; z: number; rotX: number; rotY: number; sx: number; sy: number; col: THREE.Color };
  const winSlots: WinSlot[] = [];
  const coolWhite = new THREE.Color(0xeaf4ff);
  const paleCyan = new THREE.Color(0xcceaff);
  const warmAmber = new THREE.Color(0xffb464);
  const warmCream = new THREE.Color(0xffe4b2);
  const WIN_BASE_GAIN = 1.35;
  const pickWinColor = (): THREE.Color | null => {
    const v = rnd();
    if (v < 0.28) return null; // unlit window for realistic residential/commercial rhythm
    // 7:3 cool:warm palette split
    const isCool = rnd() < 0.7;
    const base = isCool
      ? (rnd() < 0.62 ? coolWhite : paleCyan)
      : (rnd() < 0.58 ? warmAmber : warmCream);
    // 3-tier luminance gain: bright core 1.9 / regular 1.35 / dim 0.7 (scaled against winMat 1.35)
    const t = rnd();
    const gain = t < 0.20 ? 1.9 : t < 0.68 ? 1.35 : 0.7;
    return base.clone().multiplyScalar(gain / WIN_BASE_GAIN);
  };

  // Outer facade (3 rows × 108 cols), inner facade (2 rows × 96 cols),
  // top/bottom promenade decks (2 rows × 96 cols), inner sub-ring outer wall (1 row × 72 cols)
  const addWallBand = (cols: number, rad: number, yLevels: number[], outward: boolean, sx: number, sy: number): void => {
    for (let i = 0; i < cols; i++) {
      const a = (i / cols) * Math.PI * 2;
      // Leave narrow dark structural gaps around the 12 heavy modules (every 30 deg)
      const deg = (i / cols) * 360;
      const modDist = Math.abs(((deg + 15) % 30) - 15);
      if (modDist < 2.2) continue;
      for (const y of yLevels) {
        const col = pickWinColor();
        if (!col) continue;
        winSlots.push({
          x: Math.sin(a) * rad,
          y,
          z: Math.cos(a) * rad,
          rotX: 0,
          rotY: outward ? a : a + Math.PI,
          sx,
          sy,
          col,
        });
      }
    }
  };
  const addDeckBand = (cols: number, rads: number[], y: number, faceUp: boolean, sx: number, sy: number): void => {
    for (let i = 0; i < cols; i++) {
      const a = (i / cols) * Math.PI * 2;
      const deg = (i / cols) * 360;
      const modDist = Math.abs(((deg + 15) % 30) - 15);
      if (modDist < 2.4) continue;
      for (const rad of rads) {
        const col = pickWinColor();
        if (!col) continue;
        winSlots.push({
          x: Math.sin(a) * rad,
          y,
          z: Math.cos(a) * rad,
          rotX: faceUp ? -Math.PI / 2 : Math.PI / 2,
          rotY: a,
          sx,
          sy,
          col,
        });
      }
    }
  };

  addWallBand(120, R * 1.753, [-R * 0.038, 0, R * 0.038], true, R * 0.046, R * 0.017);
  addWallBand(108, R * 1.547, [-R * 0.030, R * 0.030], false, R * 0.044, R * 0.016);
  addDeckBand(108, [R * 1.592, R * 1.708], mainH + R * 0.004, true, R * 0.046, R * 0.022);
  addDeckBand(96, [R * 1.592, R * 1.708], -mainH - R * 0.004, false, R * 0.042, R * 0.020);
  addWallBand(84, R * 1.303, [-R * 0.014, R * 0.014], true, R * 0.038, R * 0.013);

  const winGeo = new THREE.PlaneGeometry(1, 1);
  // gain 1.35 (not >2): keeps warm-white lit but lets amber / dim-gold tiers read
  // as distinct brightness levels instead of clipping into one white mass
  const winMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(1.35, 1.35, 1.35),
    transparent: true,
    opacity: 1.0,
    side: THREE.DoubleSide,
  });
  const winMesh = new THREE.InstancedMesh(winGeo, winMat, winSlots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const posV = new THREE.Vector3();
  const scV = new THREE.Vector3();
  winSlots.forEach((s, i) => {
    e.set(s.rotX, s.rotY, 0, 'YXZ');
    q.setFromEuler(e);
    m.compose(posV.set(s.x, s.y, s.z), q, scV.set(s.sx, s.sy, 1));
    winMesh.setMatrixAt(i, m);
    winMesh.setColorAt(i, s.col);
  });
  winMesh.instanceMatrix.needsUpdate = true;
  if (winMesh.instanceColor) winMesh.instanceColor.needsUpdate = true;
  surface.add(winMesh);

  // 3) Outer sparse cool-white navigation beacons (every 6 deg = 60 beacons, phased blink)
  const navCount = 60;
  const navGeo = new THREE.OctahedronGeometry(R * 0.015, 0);
  const navPhases = new Float32Array(navCount);
  for (let i = 0; i < navCount; i++) navPhases[i] = (i * 1.37 + rnd() * 2.5) % (Math.PI * 2);
  navGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(navPhases, 1));
  const navUniforms = { uTime: { value: 0 } };
  const navMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xdcf4ff).multiplyScalar(2.0),
    transparent: true,
    opacity: 1.0,
  });
  navMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = navUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPhase;\nvarying float vNavPhase;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvNavPhase = aPhase;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vNavPhase;')
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        'float navBlink = 0.22 + 0.78 * pow(0.5 + 0.5 * sin(uTime * 2.8 + vNavPhase), 4.0);\nvec4 diffuseColor = vec4( diffuse * navBlink, opacity * (0.35 + 0.65 * navBlink) );',
      );
  };
  const navMesh = new THREE.InstancedMesh(navGeo, navMat, navCount);
  scV.set(1, 1, 1);
  for (let i = 0; i < navCount; i++) {
    const a = (i / navCount) * Math.PI * 2;
    const ySign = i % 2 === 0 ? 1 : -1;
    q.setFromEuler(e.set(0, a, 0));
    m.compose(posV.set(Math.sin(a) * R * 1.772, ySign * R * 0.056, Math.cos(a) * R * 1.772), q, scV);
    navMesh.setMatrixAt(i, m);
  }
  navMesh.instanceMatrix.needsUpdate = true;
  surface.add(navMesh);

  // 4) 12 thickened ring modules (every 30 deg) + teal accent strips
  const modGeo = new THREE.BoxGeometry(R * 0.24, R * 0.21, R * 0.265);
  const modMesh = new THREE.InstancedMesh(modGeo, trimMat, 12);
  const stripGeo = new THREE.BoxGeometry(R * 0.25, R * 0.016, R * 0.272);
  const stripMesh = new THREE.InstancedMesh(stripGeo, glow(PAL.tealAccent, 1.55), 24);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    q.setFromEuler(e.set(0, a, 0));
    m.compose(posV.set(Math.sin(a) * R * 1.65, 0, Math.cos(a) * R * 1.65), q, scV);
    modMesh.setMatrixAt(i, m);
    for (let s = 0; s < 2; s++) {
      const yOff = s === 0 ? R * 0.088 : -R * 0.088;
      m.compose(posV.set(Math.sin(a) * R * 1.65, yOff, Math.cos(a) * R * 1.65), q, scV);
      stripMesh.setMatrixAt(i * 2 + s, m);
    }
  }
  modMesh.instanceMatrix.needsUpdate = true;
  stripMesh.instanceMatrix.needsUpdate = true;
  surface.add(modMesh, stripMesh);

  // 4b) >=24 sets (36 sets) of instanced outer-ring greebles (all <= 0.06R):
  //     radiator fins, antenna masts, and service/hangar bay housings placed uniformly + jitter
  const detailSets = 36;
  const finGeo = new THREE.BoxGeometry(R * 0.012, R * 0.044, R * 0.056);
  const mastGeo = new THREE.CylinderGeometry(R * 0.004, R * 0.009, R * 0.058, 6);
  const bayGeo = new THREE.BoxGeometry(R * 0.058, R * 0.036, R * 0.030);
  const finMesh = new THREE.InstancedMesh(finGeo, hullMat, detailSets);
  const mastMesh = new THREE.InstancedMesh(mastGeo, hullMat, detailSets);
  const bayMesh = new THREE.InstancedMesh(bayGeo, trimMat, detailSets);
  let dIdx = 0;
  for (let mod = 0; mod < 12; mod++) {
    const baseDeg = mod * 30;
    for (let slot = 0; slot < 3; slot++) {
      // 3 slots cleanly inside each 30° inter-module span (~7.5°, 15°, 22.5°) + subtle jitter
      const finDeg = baseDeg + 6.5 + slot * 8.2 + (rnd() - 0.5) * 1.4;
      const finA = (finDeg * Math.PI) / 180;
      const finR = R * (1.774 + (rnd() - 0.5) * 0.008);
      const finY = (dIdx % 2 === 0 ? 1 : -1) * R * (0.018 + rnd() * 0.014);
      q.setFromEuler(e.set(0, finA, 0));
      scV.set(1, 0.82 + rnd() * 0.18, 0.82 + rnd() * 0.18);
      m.compose(posV.set(Math.sin(finA) * finR, finY, Math.cos(finA) * finR), q, scV);
      finMesh.setMatrixAt(dIdx, m);

      const mastDeg = baseDeg + 8.5 + slot * 7.8 + (rnd() - 0.5) * 1.6;
      const mastA = (mastDeg * Math.PI) / 180;
      const mastR = R * (1.695 + (rnd() - 0.5) * 0.045);
      const mastUp = dIdx % 3 !== 2;
      const mastY = (mastUp ? 1 : -1) * (mainH + R * 0.028);
      q.setFromEuler(e.set(mastUp ? 0 : Math.PI, mastA, 0));
      scV.set(1, 0.72 + rnd() * 0.28, 1);
      m.compose(posV.set(Math.sin(mastA) * mastR, mastY, Math.cos(mastA) * mastR), q, scV);
      mastMesh.setMatrixAt(dIdx, m);

      const bayDeg = baseDeg + 7.2 + slot * 8.0 + (rnd() - 0.5) * 1.5;
      const bayA = (bayDeg * Math.PI) / 180;
      const bayR = R * (1.735 + (rnd() - 0.5) * 0.014);
      const bayY = (dIdx % 2 === 0 ? 1 : -1) * (mainH + R * 0.015);
      q.setFromEuler(e.set(0, bayA, 0));
      scV.set(0.84 + rnd() * 0.16, 0.85 + rnd() * 0.15, 0.85 + rnd() * 0.15);
      m.compose(posV.set(Math.sin(bayA) * bayR, bayY, Math.cos(bayA) * bayR), q, scV);
      bayMesh.setMatrixAt(dIdx, m);

      dIdx++;
    }
  }
  scV.set(1, 1, 1);
  for (const im of [finMesh, mastMesh, bayMesh]) {
    im.instanceMatrix.needsUpdate = true;
    surface.add(im);
  }

  // 5) 4 opposing docking towers (0, 90, 180, 270 deg): pylon + ring platforms + top beacon
  //    + rectangular dark hangar bay mouths with inner warm light strips at each tower base
  const towerBodyGeo = new THREE.BoxGeometry(R * 0.11, R * 0.68, R * 0.15);
  const towerBody = new THREE.InstancedMesh(towerBodyGeo, hullMat, 4);
  const towerCollarGeo = new THREE.CylinderGeometry(R * 0.145, R * 0.16, R * 0.048, 12);
  const towerCollar = new THREE.InstancedMesh(towerCollarGeo, trimMat, 4);
  const towerRingLightGeo = new THREE.TorusGeometry(R * 0.154, R * 0.011, 8, 24);
  towerRingLightGeo.rotateX(Math.PI / 2);
  const towerRingLight = new THREE.InstancedMesh(towerRingLightGeo, glow(0x7ae4ff, 1.9), 4);
  const towerSpireGeo = new THREE.CylinderGeometry(R * 0.012, R * 0.032, R * 0.22, 8);
  const towerSpire = new THREE.InstancedMesh(towerSpireGeo, trimMat, 4);
  const towerTopLampGeo = new THREE.SphereGeometry(R * 0.026, 12, 10);
  const towerTopLamp = new THREE.InstancedMesh(towerTopLampGeo, glow(0xffd28a, 2.15), 4);
  const hangarDarkMat = new THREE.MeshStandardMaterial({ color: 0x0a0f18, roughness: 0.92, metalness: 0.1 });
  const towerHangarGeo = new THREE.BoxGeometry(R * 0.072, R * 0.068, R * 0.158);
  const towerHangar = new THREE.InstancedMesh(towerHangarGeo, hangarDarkMat, 4);
  const towerHangarStripGeo = new THREE.BoxGeometry(R * 0.056, R * 0.014, R * 0.162);
  const towerHangarStrip = new THREE.InstancedMesh(towerHangarStripGeo, glow(0xffb866, 1.85), 4);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const rx = Math.sin(a) * R * 1.65;
    const rz = Math.cos(a) * R * 1.65;
    q.setFromEuler(e.set(0, a, 0));
    m.compose(posV.set(rx, R * 0.12, rz), q, scV);
    towerBody.setMatrixAt(i, m);
    m.compose(posV.set(rx, R * 0.152, rz), q, scV);
    towerHangar.setMatrixAt(i, m);
    m.compose(posV.set(rx, R * 0.170, rz), q, scV);
    towerHangarStrip.setMatrixAt(i, m);
    m.compose(posV.set(rx, R * 0.30, rz), q, scV);
    towerCollar.setMatrixAt(i, m);
    towerRingLight.setMatrixAt(i, m);
    m.compose(posV.set(rx, R * 0.49, rz), q, scV);
    towerSpire.setMatrixAt(i, m);
    m.compose(posV.set(rx, R * 0.61, rz), q, scV);
    towerTopLamp.setMatrixAt(i, m);
  }
  for (const im of [towerBody, towerHangar, towerHangarStrip, towerCollar, towerRingLight, towerSpire, towerTopLamp]) {
    im.instanceMatrix.needsUpdate = true;
    surface.add(im);
  }

  // 6) Inhabited central core hub: paneled sphere + 3 glowing ring bands + >=180 instanced
  //    warm-white/amber cabin windows (15% unlit) + polar cap light dot rings + 4 spokes
  const coreR = R * 0.44;
  const coreSphere = new THREE.Mesh(new THREE.SphereGeometry(coreR, 36, 24), coreMat);
  const coreRing = new THREE.Mesh(
    new THREE.TorusGeometry(R * 0.465, R * 0.022, 10, 64),
    glow(0x52c8ff, 1.95),
  );
  coreRing.rotation.x = Math.PI / 2;

  // 2 additional mid-latitude glowing ring bands (instanced, ±34°)
  const subRingLat = (34 * Math.PI) / 180;
  const subRingR = coreR * Math.cos(subRingLat) + R * 0.012;
  const subRingY = coreR * Math.sin(subRingLat);
  const coreSubRingGeo = new THREE.TorusGeometry(subRingR, R * 0.011, 8, 56);
  coreSubRingGeo.rotateX(Math.PI / 2);
  const coreSubRings = new THREE.InstancedMesh(coreSubRingGeo, glow(0x74dcff, 1.75), 2);
  scV.set(1, 1, 1);
  q.identity();
  m.compose(posV.set(0, subRingY, 0), q, scV);
  coreSubRings.setMatrixAt(0, m);
  m.compose(posV.set(0, -subRingY, 0), q, scV);
  coreSubRings.setMatrixAt(1, m);
  coreSubRings.instanceMatrix.needsUpdate = true;

  // Instanced self-luminous cabin windows on the core sphere (6 latitude bands, 15% unlit -> >220 lit)
  const coreWinSlots: { pos: THREE.Vector3; nrm: THREE.Vector3; sx: number; sy: number; col: THREE.Color }[] = [];
  const coreBands: [number, number][] = [
    [-46, 40],
    [-24, 52],
    [-14, 54],
    [14, 54],
    [24, 52],
    [46, 40],
  ];
  const coreWarmWhite = new THREE.Color(0xfff1d6);
  const coreAmber = new THREE.Color(0xffb464);
  for (const [latDeg, count] of coreBands) {
    const lat = (latDeg * Math.PI) / 180;
    const cosL = Math.cos(lat);
    const sinL = Math.sin(lat);
    for (let i = 0; i < count; i++) {
      if (rnd() < 0.15) continue; // 15% unlit for inhabited city rhythm
      const lon = ((i + (latDeg > 0 ? 0.25 : 0)) / count) * Math.PI * 2;
      const nx = cosL * Math.sin(lon);
      const ny = sinL;
      const nz = cosL * Math.cos(lon);
      const nrm = new THREE.Vector3(nx, ny, nz);
      const pos = nrm.clone().multiplyScalar(coreR + R * 0.005);
      const base = rnd() < 0.56 ? coreWarmWhite : coreAmber;
      const tier = rnd();
      const gain = tier < 0.25 ? 1.45 : tier < 0.78 ? 1.0 : 0.58;
      coreWinSlots.push({
        pos,
        nrm,
        sx: R * (0.025 + rnd() * 0.008) * Math.max(0.75, cosL),
        sy: R * 0.013,
        col: base.clone().multiplyScalar(gain),
      });
    }
  }
  const coreWinMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(1.4, 1.4, 1.4),
    transparent: true,
    opacity: 1.0,
    side: THREE.FrontSide,
  });
  const coreWinMesh = new THREE.InstancedMesh(winGeo, coreWinMat, coreWinSlots.length);
  const upRef = new THREE.Vector3(0, 1, 0);
  const tangR = new THREE.Vector3();
  const tangU = new THREE.Vector3();
  const basisM = new THREE.Matrix4();
  coreWinSlots.forEach((s, i) => {
    tangR.crossVectors(upRef, s.nrm);
    if (tangR.lengthSq() < 1e-4) tangR.set(1, 0, 0);
    tangR.normalize();
    tangU.crossVectors(s.nrm, tangR).normalize();
    basisM.makeBasis(tangR, tangU, s.nrm);
    q.setFromRotationMatrix(basisM);
    m.compose(s.pos, q, scV.set(s.sx, s.sy, 1));
    coreWinMesh.setMatrixAt(i, m);
    coreWinMesh.setColorAt(i, s.col);
  });
  coreWinMesh.instanceMatrix.needsUpdate = true;
  if (coreWinMesh.instanceColor) coreWinMesh.instanceColor.needsUpdate = true;

  const coreCapGeo = new THREE.CylinderGeometry(R * 0.14, R * 0.22, R * 0.12, 16);
  const coreCapTop = new THREE.Mesh(coreCapGeo, trimMat);
  coreCapTop.position.y = coreR;
  const coreCapBot = new THREE.Mesh(coreCapGeo, trimMat);
  coreCapBot.position.y = -coreR;
  coreCapBot.rotation.x = Math.PI;

  // Polar cap rings of glowing light dots (16 top + 16 bottom, instanced)
  const polarDotGeo = new THREE.SphereGeometry(R * 0.011, 8, 6);
  const polarDotMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.9, 1.9, 1.9) });
  const polarDotsPerCap = 16;
  const corePolarDots = new THREE.InstancedMesh(polarDotGeo, polarDotMat, polarDotsPerCap * 2);
  const dotCyan = new THREE.Color(0x9eeeff);
  const dotWarm = new THREE.Color(0xffd28a);
  scV.set(1, 1, 1);
  q.identity();
  for (let cap = 0; cap < 2; cap++) {
    const ySign = cap === 0 ? 1 : -1;
    const dotY = ySign * (coreR + R * 0.048);
    const dotR = R * 0.172;
    for (let i = 0; i < polarDotsPerCap; i++) {
      const a = (i / polarDotsPerCap) * Math.PI * 2;
      const idx = cap * polarDotsPerCap + i;
      m.compose(posV.set(Math.sin(a) * dotR, dotY, Math.cos(a) * dotR), q, scV);
      corePolarDots.setMatrixAt(idx, m);
      corePolarDots.setColorAt(idx, i % 4 === 0 ? dotWarm : dotCyan);
    }
  }
  corePolarDots.instanceMatrix.needsUpdate = true;
  if (corePolarDots.instanceColor) corePolarDots.instanceColor.needsUpdate = true;

  surface.add(coreSphere, coreRing, coreSubRings, coreWinMesh, coreCapTop, coreCapBot, corePolarDots);

  const spokeLen = R * 1.16;
  const spokeGeo = new THREE.BoxGeometry(R * 0.055, R * 0.044, spokeLen);
  const spokeMesh = new THREE.InstancedMesh(spokeGeo, trimMat, 4);
  const spokeLineGeo = new THREE.BoxGeometry(R * 0.014, R * 0.012, spokeLen * 0.94);
  const spokeLine = new THREE.InstancedMesh(spokeLineGeo, glow(0x6ad6ff, 1.5), 4);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const midR = R * 1.00;
    q.setFromEuler(e.set(0, a, 0));
    m.compose(posV.set(Math.sin(a) * midR, 0, Math.cos(a) * midR), q, scV);
    spokeMesh.setMatrixAt(i, m);
    m.compose(posV.set(Math.sin(a) * midR, R * 0.026, Math.cos(a) * midR), q, scV);
    spokeLine.setMatrixAt(i, m);
  }
  spokeMesh.instanceMatrix.needsUpdate = true;
  spokeLine.instanceMatrix.needsUpdate = true;
  surface.add(spokeMesh, spokeLine);

  // 7) Narrow low-opacity pale-blue artificial shield shell (1.00R–1.04R, alpha <= 0.18, no natural haze)
  const shieldMat = new THREE.ShaderMaterial({
    vertexShader: PLANET_VERT,
    fragmentShader: RING_SHIELD_FRAG,
    uniforms: {
      uCol: { value: new THREE.Color(p.atmosphere) },
      uTime: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  const shield = new THREE.Mesh(new THREE.SphereGeometry(R * 1.04, 48, 32), shieldMat);
  g.add(shield);

  // 8) Sun-facing outer rim/fresnel bright edge (1.755R, width ~0.02R, additive, instanced)
  const centerVec = new THREE.Vector3(p.pos.x, p.pos.y, p.pos.z);
  const rimGeo = new THREE.TorusGeometry(R * 1.755, R * 0.011, 10, 128);
  rimGeo.rotateX(Math.PI / 2);
  const rimColor = new THREE.Color(PAL.cyan).lerp(new THREE.Color(0xffffff), 0.45).multiplyScalar(1.55);
  const rimMat = new THREE.MeshBasicMaterial({
    color: rimColor,
    transparent: true,
    opacity: 0.92,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  rimMat.onBeforeCompile = (shader) => {
    shader.uniforms.uSun = { value: sunDir };
    shader.uniforms.uCenter = { value: centerVec };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRimWPos;\nvarying vec3 vRimWNorm;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 rimLoc = vec4( transformed, 1.0 );
        vec3 rimNLoc = normal;
        #ifdef USE_INSTANCING
          rimLoc = instanceMatrix * rimLoc;
          rimNLoc = mat3( instanceMatrix ) * rimNLoc;
        #endif
        vRimWPos = ( modelMatrix * rimLoc ).xyz;
        vRimWNorm = normalize( mat3( modelMatrix ) * rimNLoc );`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSun;\nuniform vec3 uCenter;\nvarying vec3 vRimWPos;\nvarying vec3 vRimWNorm;')
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        `vec3 rimRad = normalize( vRimWPos - uCenter );
        float sunSide = smoothstep( -0.20, 0.42, dot( rimRad, uSun ) );
        float sunWeight = mix( 0.10, 1.0, sunSide );
        vec3 rimView = normalize( cameraPosition - vRimWPos );
        float rimFres = 0.50 + 0.50 * pow( 1.0 - abs( dot( normalize( vRimWNorm ), rimView ) ), 1.3 );
        float rimGain = sunWeight * rimFres;
        vec4 diffuseColor = vec4( diffuse, opacity * rimGain );`,
      );
  };
  const rimMesh = new THREE.InstancedMesh(rimGeo, rimMat, 1);
  q.identity();
  scV.set(1, 1, 1);
  m.compose(posV.set(0, 0, 0), q, scV);
  rimMesh.setMatrixAt(0, m);
  rimMesh.instanceMatrix.needsUpdate = true;
  tilt.add(rimMesh);

  // 9) Upper & lower warm additive city haze planes (alpha <= 0.10, outerR ~2.0R, radial exp decay)
  const hazeGeo = polarRingGeometry(R * 1.05, R * 2.02, 96, 10);
  const hazeMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xffbe74),
    transparent: true,
    opacity: 0.085,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  hazeMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vHazeUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHazeUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vHazeUv;')
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        `float rR = mix( 1.05, 2.02, vHazeUv.y );
        float outFade = exp( -max( 0.0, rR - 1.65 ) * 6.0 ) * smoothstep( 2.02, 1.88, rR );
        float inFade = exp( -max( 0.0, 1.65 - rR ) * 3.8 ) * smoothstep( 1.05, 1.22, rR );
        float hMask = ( rR >= 1.65 ? outFade : inFade );
        vec3 warmGrad = mix( diffuse * vec3( 1.06, 0.96, 0.86 ), diffuse * vec3( 1.0, 0.72, 0.48 ), clamp( ( rR - 1.65 ) / 0.37, 0.0, 1.0 ) );
        vec4 diffuseColor = vec4( warmGrad, min( 0.10, opacity * hMask ) );`,
      );
  };
  const hazeMesh = new THREE.InstancedMesh(hazeGeo, hazeMat, 2);
  m.compose(posV.set(0, mainH * 1.35, 0), q, scV);
  hazeMesh.setMatrixAt(0, m);
  m.compose(posV.set(0, -mainH * 1.35, 0), q, scV);
  hazeMesh.setMatrixAt(1, m);
  hazeMesh.instanceMatrix.needsUpdate = true;
  tilt.add(hazeMesh);

  g.userData.timeMats = [shieldMat];
  g.userData.ringCity = {
    center: centerVec,
    winMat,
    coreWinMat,
    navMat,
    navUniforms,
  };
  return g;
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

/** self-luminous twin star with paired corona halos + radial corona + billboard flare */
function buildBinaryStar(s: BinaryStarDef): { group: THREE.Group; mat: THREE.ShaderMaterial; flare: THREE.Sprite; baseScale: number } {
  const g = new THREE.Group();
  g.name = s.id;
  g.position.set(s.pos.x, s.pos.y, s.pos.z);
  const isPrimary = s.intensity > 1.8;
  // visually emphasize primary > companion while keeping both discs >= 22px in 844x390
  const visR = s.radius * (isPrimary ? 1.12 : 0.86);
  const col = new THREE.Color(isPrimary ? 0x8cd0ff : 0xff8c38);
  const haloCol = new THREE.Color(isPrimary ? 0x7ac6ff : 0xff7b24);
  const mat = new THREE.ShaderMaterial({
    vertexShader: PLANET_VERT,
    fragmentShader: BINARY_STAR_FRAG,
    uniforms: {
      uColor: { value: col },
      uIntensity: { value: isPrimary ? 2.35 : 1.7 },
      uTime: { value: 0 },
    },
  });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(visR, 48, 32), mat);
  const haloInner = starHaloShell(visR, isPrimary ? 1.24 : 1.22, isPrimary ? 2.4 : 2.5, isPrimary ? 0.92 : 0.86, haloCol);
  const haloOuter = starHaloShell(visR, isPrimary ? 1.58 : 1.50, isPrimary ? 1.65 : 1.75, isPrimary ? 0.62 : 0.54, haloCol);
  const corona = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: radialTexture(
        [
          [0, 'rgba(255,255,255,0.95)'],
          [0.18, 'rgba(255,255,255,0.68)'],
          [0.45, 'rgba(255,255,255,0.22)'],
          [1, 'rgba(255,255,255,0)'],
        ],
        256,
      ),
      color: haloCol,
      opacity: isPrimary ? 0.9 : 0.82,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }),
  );
  corona.scale.setScalar(visR * (isPrimary ? 7.2 : 5.6));
  const baseScale = visR * (isPrimary ? 9.5 : 6.8);
  const flare = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: flareTexture(),
      color: isPrimary ? 0x9cd8ff : 0xff8830,
      opacity: isPrimary ? 0.88 : 0.78,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }),
  );
  flare.scale.setScalar(baseScale);
  g.add(sphere, haloInner, haloOuter, corona, flare);
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

  if (p.kind === 'blackhole') return buildBlackhole(p);
  if (p.kind === 'ring-city') return buildRingCity(p);

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
    const wideHalo = binaryHaloShell(p, 1.14, 3.8, 0.26, dirA, colA, dirB, colB);
    const narrowHalo = binaryHaloShell(p, 1.045, 6.5, 0.22, dirA, colA, dirB, colB);
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
  /** trigger expanding cyan-white tidal repulsion shockwave ring at the black hole */
  triggerTidalPulse(): void;
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

  // local weak warm-white PointLight + cool-white key DirectionalLight on ring-city
  // (both in `near` and distance-attenuated so cabin & distant planets are never polluted)
  const ringCityPlanet = PLANETS.find((p) => p.kind === 'ring-city');
  const ringCityCenter = ringCityPlanet
    ? new THREE.Vector3(ringCityPlanet.pos.x, ringCityPlanet.pos.y, ringCityPlanet.pos.z)
    : null;
  const ringCityLight = ringCityPlanet
    ? new THREE.PointLight(0xffe6c4, 0, ringCityPlanet.radius * 5.2, 0.5)
    : null;
  if (ringCityLight && ringCityPlanet) {
    ringCityLight.position.set(ringCityPlanet.pos.x, ringCityPlanet.pos.y + ringCityPlanet.radius * 0.25, ringCityPlanet.pos.z);
    near.add(ringCityLight);
  }
  const ringCityKeyDir = new THREE.Vector3()
    .crossVectors(sunDir, new THREE.Vector3(0, 1, 0))
    .normalize()
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), (-22 * Math.PI) / 180)
    .add(new THREE.Vector3(0, 0.22, 0))
    .normalize();
  const ringCityKeyLight = ringCityPlanet ? new THREE.DirectionalLight(0xdceeff, 0) : null;
  if (ringCityKeyLight && ringCityCenter) {
    ringCityKeyLight.position.copy(ringCityCenter).addScaledVector(ringCityKeyDir, 300);
    ringCityKeyLight.target.position.copy(ringCityCenter);
    ringCityKeyLight.target.updateMatrixWorld();
    near.add(ringCityKeyLight, ringCityKeyLight.target);
  }

  // local accretion-disk warm-white & cool-violet PointLights + directional rim light for blackhole
  // (all isolated inside `near` so cabin lighting is never affected)
  const bhPlanet = PLANETS.find((p) => p.kind === 'blackhole');
  const bhCenter = bhPlanet ? new THREE.Vector3(bhPlanet.pos.x, bhPlanet.pos.y, bhPlanet.pos.z) : null;
  const bhRimLight = new THREE.DirectionalLight(0xffe6c8, 0);
  near.add(bhRimLight, bhRimLight.target);
  if (bhPlanet) {
    const warmDiskLight = new THREE.PointLight(0xffd6a6, 1700, bhPlanet.radius * 6.5, 0.88);
    warmDiskLight.position.set(bhPlanet.pos.x + bhPlanet.radius * 1.4, bhPlanet.pos.y + bhPlanet.radius * 0.4, bhPlanet.pos.z + bhPlanet.radius * 0.8);
    const violetHaloLight = new THREE.PointLight(0xa382ff, 1150, bhPlanet.radius * 6.5, 0.9);
    violetHaloLight.position.set(bhPlanet.pos.x - bhPlanet.radius * 1.2, bhPlanet.pos.y - bhPlanet.radius * 0.5, bhPlanet.pos.z - bhPlanet.radius * 0.9);
    near.add(warmDiskLight, violetHaloLight);
  }
  // expanding cyan-white shockwave ring on crush auto-ejection (non-combat visual cue)
  const pulseMat = new THREE.MeshBasicMaterial({
    color: 0xaef6ff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const pulseRing = new THREE.Mesh(new THREE.RingGeometry(0.92, 1.0, 72), pulseMat);
  pulseRing.visible = false;
  if (bhCenter) pulseRing.position.copy(bhCenter);
  near.add(pulseRing);
  let tidalPulseAge = -1;
  const bhLookDir = new THREE.Vector3();
  const bhProjUp = new THREE.Vector3();
  const bhRight = new THREE.Vector3();
  const bhBasis = new THREE.Matrix4();

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
    triggerTidalPulse() {
      if (!bhCenter) return;
      tidalPulseAge = 0;
      pulseRing.position.copy(bhCenter);
      pulseRing.visible = true;
    },
    update(t, dt, cam, shipPos, _fwd, speedFrac) {
      for (const p of planets) {
        p.getObjectByName('surface')!.rotation.y += dt * 0.01;
        for (const m of (p.userData.timeMats ?? []) as THREE.ShaderMaterial[]) m.uniforms.uTime.value = t;
        const bhU = p.userData.bhUniforms as { uTime: { value: number }; uCamPhase: { value: number } } | undefined;
        if (bhU) {
          bhU.uTime.value = t;
          const c = p.userData.bhCenter as THREE.Vector3;
          bhLookDir.subVectors(cam.position, c).normalize();
          bhU.uCamPhase.value = Math.atan2(bhLookDir.x, bhLookDir.z) / (Math.PI * 2);
          // orient lensed back-disk billboard toward camera, rolled so +Y aligns with projected BH_SPIN_AXIS
          const lensed = p.userData.lensedDisk as THREE.Mesh | undefined;
          if (lensed) {
            bhProjUp.copy(BH_SPIN_AXIS).addScaledVector(bhLookDir, -BH_SPIN_AXIS.dot(bhLookDir));
            if (bhProjUp.lengthSq() < 1e-4) bhProjUp.set(0, 1, 0);
            bhProjUp.normalize();
            bhRight.crossVectors(bhProjUp, bhLookDir).normalize();
            bhProjUp.crossVectors(bhLookDir, bhRight).normalize();
            bhBasis.makeBasis(bhRight, bhProjUp, bhLookDir);
            lensed.quaternion.setFromRotationMatrix(bhBasis);
          }
          const lens = p.userData.lensRing as THREE.Mesh | undefined;
          if (lens) lens.quaternion.copy(cam.quaternion);
        }
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
        const rc = p.userData.ringCity as
          | {
              center: THREE.Vector3;
              winMat: THREE.MeshBasicMaterial;
              coreWinMat: THREE.MeshBasicMaterial;
              navMat: THREE.MeshBasicMaterial;
              navUniforms: { uTime: { value: number } };
            }
          | undefined;
        if (rc) {
          rc.navUniforms.uTime.value = t;
          // distance LOD fade-out so dense window grid & beacons stay crisp up close and never smear at long range
          const dCam = cam.position.distanceTo(rc.center);
          const fadeT = Math.max(0, Math.min(1, (dCam - 680) / (1650 - 680)));
          const smoothFade = fadeT * fadeT * (3 - 2 * fadeT);
          rc.winMat.opacity = 1.0 - smoothFade * 0.72;
          rc.coreWinMat.opacity = 1.0 - smoothFade * 0.72;
          rc.navMat.opacity = 1.0 - smoothFade * 0.66;
        }
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
      if (ringCityCenter && ringCityLight && ringCityPlanet) {
        // enable local warm point light (<= 0.8) + cool-white key light (1.6) only near ring-city
        const dRc = shipPos.distanceTo(ringCityCenter);
        const u = Math.max(0, Math.min(1, (dRc - ringCityPlanet.radius * 3.8) / (ringCityPlanet.radius * 2.0)));
        const w = 1 - u * u * (3 - 2 * u);
        ringCityLight.intensity = 0.78 * w;
        if (ringCityKeyLight) {
          const uk = Math.max(0, Math.min(1, (dRc - ringCityPlanet.radius * 3.5) / (ringCityPlanet.radius * 1.5)));
          const wk = 1 - uk * uk * (3 - 2 * uk);
          ringCityKeyLight.intensity = 1.6 * wk;
        }
      }
      if (bhCenter && bhPlanet) {
        // smooth distance-attenuated rim key light from the accretion disk onto the ship's BH-facing hull
        const dBh = shipPos.distanceTo(bhCenter);
        const u = Math.max(0, Math.min(1, (dBh - 480) / (860 - 480)));
        const w = 1 - u * u * (3 - 2 * u);
        bhRimLight.intensity = 2.35 * w;
        bhRimLight.position.copy(bhCenter);
        bhRimLight.target.position.copy(shipPos);
        bhRimLight.target.updateMatrixWorld();
        if (tidalPulseAge >= 0) {
          tidalPulseAge += dt;
          const dur = 0.85;
          if (tidalPulseAge >= dur) {
            tidalPulseAge = -1;
            pulseRing.visible = false;
            pulseMat.opacity = 0;
          } else {
            const pFrac = tidalPulseAge / dur;
            const ease = 1 - Math.pow(1 - pFrac, 2.4);
            pulseRing.quaternion.copy(cam.quaternion);
            pulseRing.scale.setScalar(bhPlanet.radius * (1.15 + ease * 2.35));
            pulseMat.opacity = (1 - pFrac) * 0.85;
          }
        }
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
