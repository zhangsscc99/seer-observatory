// Shared procedural materials, canvas textures, and custom underwater shaders
// for the Ocean Planet "Deep Water Zone" modular kit. Zero external image files.
import * as THREE from 'three';
import { mulberry32 } from '../../../game/rng.ts';

export interface OceanMaterials {
  limestone: THREE.MeshLambertMaterial;
  limestoneMoss: THREE.MeshLambertMaterial;
  cliffRock: THREE.MeshLambertMaterial;
  paving: THREE.MeshLambertMaterial;
  plazaFloor: THREE.MeshLambertMaterial;
  darkTrim: THREE.MeshLambertMaterial;
  bridgeGoldTrim: THREE.MeshBasicMaterial;
  warmCrystal: THREE.MeshLambertMaterial;
  warmCrystalCore: THREE.MeshBasicMaterial;
  coolCrystal: THREE.MeshLambertMaterial;
  coolCrystalCore: THREE.MeshBasicMaterial;
  kelp: THREE.MeshLambertMaterial;
  plazaWater: THREE.ShaderMaterial;
  waterCeiling: THREE.ShaderMaterial;
  godRay: THREE.ShaderMaterial;
  fishSilhouette: THREE.MeshBasicMaterial;
  /** Animated shader time uniform list */
  update(t: number, playerX: number, playerY: number, playerZ: number): void;
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function makeNoise2D(seed: number, period: number): (x: number, y: number) => number {
  const rnd = mulberry32(seed);
  const N = 64;
  const g = new Float32Array(N * N);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const at = (x: number, y: number, p: number): number =>
    g[((((y % p) + p) % p) % N) * N + ((((x % p) + p) % p) % N)];
  const sample = (x: number, y: number, p: number): number => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi, p);
    const b = at(xi + 1, yi, p);
    const c = at(xi, yi + 1, p);
    const d = at(xi + 1, yi + 1, p);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (x, y) => {
    let sum = 0;
    let amp = 0.5;
    let freq = 1;
    for (let o = 0; o < 4; o++) {
      sum += sample(x * freq, y * freq, period * freq) * amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / 0.9375;
  };
}

function uploadTex(c: HTMLCanvasElement, repeatX = 1, repeatY = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 4;
  return t;
}

/** Bone-white / weathered grey-limestone carved ruin stone texture */
function createLimestoneTexture(seed: number, mossy: boolean): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = makeCanvas(S, S);
  const img = g.createImageData(S, S);
  const n1 = makeNoise2D(seed, 8);
  const n2 = makeNoise2D(seed + 19, 16);
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const f = n1(u * 8, v * 8);
      const fine = n2(u * 16, v * 16);
      const strata = 0.5 + 0.5 * Math.sin((v * 9 + f * 0.45) * Math.PI * 2);
      // Ashlar masonry mortar seams
      const row = Math.floor(v * 6);
      const colFrac = (u * 3 + (row % 2) * 0.5) % 1;
      const rowFrac = (v * 6) % 1;
      const seam = colFrac < 0.035 || rowFrac < 0.04 ? 0.66 : 1.0;

      // Bone-white / pale grey-limestone base
      let r = (156 + f * 38 + strata * 16 + (fine - 0.5) * 22) * seam;
      let gr = (168 + f * 34 + strata * 14 + (fine - 0.5) * 20) * seam;
      let b = (158 + f * 28 + strata * 12 + (fine - 0.5) * 18) * seam;

      if (mossy) {
        const moss = Math.max(0, Math.min(1, (f * 0.7 + fine * 0.3 - 0.44) * 3.2));
        r = r * (1 - moss * 0.52) + 34 * moss * 0.52;
        gr = gr * (1 - moss * 0.25) + 118 * moss * 0.25;
        b = b * (1 - moss * 0.42) + 96 * moss * 0.42;
      }
      const idx = (y * S + x) * 4;
      img.data[idx] = Math.max(0, Math.min(255, r));
      img.data[idx + 1] = Math.max(0, Math.min(255, gr));
      img.data[idx + 2] = Math.max(0, Math.min(255, b));
      img.data[idx + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return uploadTex(c, 2, 2);
}

/** Deep ocean stratified cliff limestone rock texture */
function createCliffTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = makeCanvas(S, S);
  const img = g.createImageData(S, S);
  const n1 = makeNoise2D(307, 8);
  const n2 = makeNoise2D(613, 16);
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const f = n1(u * 8, v * 8);
      const fine = n2(u * 16, v * 16);
      // Strong horizontal geological ledges + crack veins
      const ledge = 0.5 + 0.5 * Math.sin((v * 14 + f * 0.85) * Math.PI * 2);
      const crack = Math.abs(fine - 0.5) < 0.03 ? 0.55 : 1.0;
      const moss = Math.max(0, Math.min(1, (ledge - 0.55) * 1.8 * f));

      let r = (54 + f * 44 + ledge * 28) * crack;
      let gr = (88 + f * 52 + ledge * 34) * crack;
      let b = (96 + f * 48 + ledge * 28) * crack;
      // Subtle teal-emerald mossy sheen on ledges
      r = r * (1 - moss * 0.28) + 46 * moss * 0.28;
      gr = gr * (1 - moss * 0.15) + 128 * moss * 0.15;
      b = b * (1 - moss * 0.22) + 104 * moss * 0.22;

      const idx = (y * S + x) * 4;
      img.data[idx] = Math.max(0, Math.min(255, r));
      img.data[idx + 1] = Math.max(0, Math.min(255, gr));
      img.data[idx + 2] = Math.max(0, Math.min(255, b));
      img.data[idx + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return uploadTex(c, 2, 2);
}

/** Carved flagstone paving for bridge decks, stairs, and terraces */
function createPavingTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = makeCanvas(S, S);
  const rnd = mulberry32(911);
  g.fillStyle = '#3a5458';
  g.fillRect(0, 0, S, S);
  const rows = 8;
  const cols = 4;
  const rh = S / rows;
  const cw = S / cols;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * (cw * 0.5);
    for (let col = -1; col <= cols; col++) {
      const shade = 152 + Math.floor(rnd() * 44);
      const warm = Math.floor(rnd() * 14);
      const cool = Math.floor(rnd() * 10);
      g.fillStyle = `rgb(${shade + warm},${shade + 4},${shade - 10 + cool})`;
      const x = col * cw + off + 2;
      const y = r * rh + 2;
      g.fillRect(x, y, cw - 4, rh - 4);
      // Subtle top bevel highlight
      g.fillStyle = 'rgba(235, 240, 224, 0.25)';
      g.fillRect(x, y, cw - 4, 2);
    }
  }
  return uploadTex(c, 1, 1);
}

/** Sunlit turquoise-emerald seabed & carved central plaza mosaic */
function createPlazaMosaicTexture(): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = makeCanvas(S, S);
  const n1 = makeNoise2D(441, 8);
  const n2 = makeNoise2D(719, 16);
  const img = g.createImageData(S, S);
  const half = S / 2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x - half) / half;
      const dy = (y - half) / half;
      const r = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);
      const f = n1((x / S) * 8, (y / S) * 8);
      const fine = n2((x / S) * 16, (y / S) * 16);
      // Vivid sunlit emerald-turquoise central plaza fading sharply into darker mossy ancient stone seabed outside
      const inPlaza = Math.max(0, Math.min(1, 1 - (r - 0.21) / 0.14));
      const outerStone = Math.max(0, Math.min(1, (r - 0.25) / 0.16));
      const ring = Math.abs(Math.sin(r * 28 * Math.PI)) < 0.08 && r < 0.34 ? 1.18 : 1.0;
      const spoke = Math.abs(Math.sin(ang * 12)) < 0.06 && r < 0.32 && r > 0.06 ? 1.12 : 1.0;
      const flagstone = outerStone * ((Math.sin(x * 0.22) * Math.sin(y * 0.22)) > 0.55 ? 0.82 : 1.0);
      const detail = ring * spoke * (1 - flagstone * 0.22);

      const baseR = (18 + inPlaza * 56 + f * 20 + fine * 10 - outerStone * 6) * detail;
      const baseG = (56 + inPlaza * 136 + f * 34 + fine * 16 - outerStone * 16) * detail;
      const baseB = (62 + inPlaza * 92 + f * 26 + fine * 12 - outerStone * 14) * detail;
      const idx = (y * S + x) * 4;
      img.data[idx] = Math.max(0, Math.min(255, baseR));
      img.data[idx + 1] = Math.max(0, Math.min(255, baseG));
      img.data[idx + 2] = Math.max(0, Math.min(255, baseB));
      img.data[idx + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const PLAZA_WATER_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// Lightweight turquoise shallow-water shader: dual caustic waves + altar concentric ripples + player splash ring
const PLAZA_WATER_FRAG = /* glsl */ `
uniform float uTime;
uniform vec2 uCenter;
uniform float uRadius;
uniform vec3 uPlayer;
varying vec3 vWorld;
varying vec2 vUv;

void main() {
  vec2 dC = vWorld.xz - uCenter;
  float dist = length(dC);
  float edgeFade = 1.0 - smoothstep(uRadius * 0.78, uRadius * 1.05, dist);
  if (edgeFade <= 0.01) discard;

  // Dual animated caustic interference pattern
  vec2 p = vWorld.xz * 0.65;
  float c1 = sin(p.x * 1.9 + uTime * 1.15 + sin(p.y * 1.4 - uTime * 0.8));
  float c2 = cos(p.y * 2.1 - uTime * 0.95 + cos(p.x * 1.6 + uTime * 0.7));
  float caustic = pow(max(0.0, (c1 * c2) * 0.5 + 0.5), 3.0);

  // Gentle concentric ripples around central altar
  float altarRip = sin(dist * 3.8 - uTime * 2.1) * 0.5 + 0.5;
  altarRip *= exp(-max(0.0, dist - 2.8) * 0.16);

  // Subtle player footstep ripple ring when standing in shallow water
  float pDist = length(vWorld.xz - uPlayer.xz);
  float inWater = step(uPlayer.y, 0.35);
  float pRip = sin(pDist * 7.0 - uTime * 5.2) * 0.5 + 0.5;
  pRip *= exp(-pDist * 0.55) * inWater;

  // Fresnel sky reflection
  vec3 vDir = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - clamp(vDir.y, 0.0, 1.0), 2.4);

  vec3 shallowCol = vec3(0.18, 0.78, 0.68);
  vec3 causticCol = vec3(0.56, 1.0, 0.90);
  vec3 col = mix(shallowCol, causticCol, clamp(caustic * 0.55 + altarRip * 0.25 + pRip * 0.45, 0.0, 1.0));
  col += vec3(0.32, 0.84, 0.86) * fres * 0.42;

  float alpha = edgeFade * clamp(0.32 + fres * 0.28 + caustic * 0.14 + altarRip * 0.10 + pRip * 0.20, 0.0, 0.78);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const WATER_CEILING_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// Backlit underside of the ocean surface: bright turquoise Snell's window + animated surface wave caustics
const WATER_CEILING_FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
varying vec2 vUv;
void main() {
  vec2 p = vWorld.xz * 0.085;
  float w1 = sin(p.x * 3.1 + uTime * 0.85 + cos(p.y * 2.3 - uTime * 0.55));
  float w2 = cos(p.y * 3.6 - uTime * 0.72 + sin(p.x * 2.7 + uTime * 0.62));
  float ripple = (w1 * 0.5 + w2 * 0.5) * 0.5 + 0.5;
  float r = length(vWorld.xz - vec2(0.0, -14.0));
  float snell = exp(-(r * r) / (34.0 * 34.0));
  vec3 deepAqua = vec3(0.07, 0.42, 0.50);
  vec3 brightAqua = vec3(0.45, 0.96, 0.93);
  vec3 sunCore = vec3(0.86, 1.0, 0.98);
  vec3 col = mix(deepAqua, brightAqua, clamp(snell * 0.82 + ripple * 0.26, 0.0, 1.0));
  col = mix(col, sunCore, pow(snell, 2.2) * (0.55 + 0.45 * ripple));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const GODRAY_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vViewPos;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = -mv.xyz;
  vNormalV = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}`;

// Soft volumetric god-ray light shafts pouring diagonally down through the canyon skylight
const GODRAY_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vViewPos;
void main() {
  // vUv.y = 1 at ocean ceiling, 0 near plaza floor
  float topFade = smoothstep(1.0, 0.82, vUv.y);
  float botFade = smoothstep(0.0, 0.42, vUv.y);
  float edge = pow(abs(dot(normalize(vNormalV), normalize(vViewPos))), 1.35);
  float streak1 = 0.55 + 0.45 * sin(vUv.x * 18.8495 + uTime * 0.32);
  float streak2 = 0.65 + 0.35 * cos(vUv.x * 31.4159 - uTime * 0.21 + vUv.y * 2.5);
  float intensity = topFade * botFade * edge * streak1 * streak2;
  vec3 rayCol = mix(vec3(0.28, 0.86, 0.84), vec3(0.74, 1.0, 0.96), vUv.y);
  gl_FragColor = vec4(rayCol * intensity * 0.24, intensity * 0.24);
}`;

let cachedMats: OceanMaterials | null = null;

export function getOceanMaterials(): OceanMaterials {
  if (cachedMats) return cachedMats;

  const limestoneTex = createLimestoneTexture(113, false);
  const limestoneMossTex = createLimestoneTexture(229, true);
  const cliffTex = createCliffTexture();
  const pavingTex = createPavingTexture();
  const plazaTex = createPlazaMosaicTexture();

  const limestone = new THREE.MeshLambertMaterial({
    map: limestoneTex,
    color: 0xe6eadc,
    vertexColors: true,
  });

  const limestoneMoss = new THREE.MeshLambertMaterial({
    map: limestoneMossTex,
    color: 0xcad8ce,
    vertexColors: true,
  });

  const cliffRock = new THREE.MeshLambertMaterial({
    map: cliffTex,
    color: 0x8cb8be,
    vertexColors: true,
  });

  const paving = new THREE.MeshLambertMaterial({
    map: pavingTex,
    color: 0xe6e0c8,
    vertexColors: true,
  });

  const plazaFloor = new THREE.MeshLambertMaterial({
    map: plazaTex,
    color: 0xd4f6ec,
  });

  const darkTrim = new THREE.MeshLambertMaterial({
    color: 0x2b454e,
  });

  const bridgeGoldTrim = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc04c).multiplyScalar(1.45) });

  const warmCrystal = new THREE.MeshLambertMaterial({
    color: 0xffd278,
    emissive: 0xe87a12,
    emissiveIntensity: 1.15,
    vertexColors: true,
  });
  const warmCrystalCore = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe69c).multiplyScalar(1.55) });

  const coolCrystal = new THREE.MeshLambertMaterial({
    color: 0x3ef0ff,
    emissive: 0x0a98b8,
    emissiveIntensity: 1.1,
    vertexColors: true,
  });
  const coolCrystalCore = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x6cffff).multiplyScalar(1.5) });

  const kelp = new THREE.MeshLambertMaterial({
    color: 0x3f8f6b,
    vertexColors: true,
    side: THREE.DoubleSide,
  });

  const plazaWater = new THREE.ShaderMaterial({
    vertexShader: PLAZA_WATER_VERT,
    fragmentShader: PLAZA_WATER_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector2(0, 4) },
      uRadius: { value: 15.2 },
      uPlayer: { value: new THREE.Vector3(0, 5, 0) },
    },
    transparent: true,
    depthWrite: false,
  });

  const waterCeiling = new THREE.ShaderMaterial({
    vertexShader: WATER_CEILING_VERT,
    fragmentShader: WATER_CEILING_FRAG,
    uniforms: { uTime: { value: 0 } },
    side: THREE.DoubleSide,
  });

  const godRay = new THREE.ShaderMaterial({
    vertexShader: GODRAY_VERT,
    fragmentShader: GODRAY_FRAG,
    uniforms: { uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const fishSilhouette = new THREE.MeshBasicMaterial({
    color: 0x0a3444,
    transparent: true,
    opacity: 0.72,
    side: THREE.DoubleSide,
  });

  cachedMats = {
    limestone,
    limestoneMoss,
    cliffRock,
    paving,
    plazaFloor,
    darkTrim,
    bridgeGoldTrim,
    warmCrystal,
    warmCrystalCore,
    coolCrystal,
    coolCrystalCore,
    kelp,
    plazaWater,
    waterCeiling,
    godRay,
    fishSilhouette,
    update(t, px, py, pz) {
      plazaWater.uniforms.uTime.value = t;
      plazaWater.uniforms.uPlayer.value.set(px, py, pz);
      waterCeiling.uniforms.uTime.value = t;
      godRay.uniforms.uTime.value = t;
    },
  };
  return cachedMats;
}

/** Paint vertical AO + sunlit-ridge vertex colors onto a BufferGeometry so
 *  rock masses and spires read with crisp three-dimensional depth without shadow maps. */
export function applyVerticalAO(
  geo: THREE.BufferGeometry,
  minY: number,
  maxY: number,
  bottomTint = new THREE.Color(0x4b6a72),
  topTint = new THREE.Color(0xeef5ef),
): THREE.BufferGeometry {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const span = Math.max(0.01, maxY - minY);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = Math.max(0, Math.min(1, (y - minY) / span));
    c.copy(bottomTint).lerp(topTint, Math.pow(t, 0.75));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/** Ensure geometry is non-indexed with exact [position, normal, uv, color] attributes for safe merging. */
export function normalizeForMerge(
  geo: THREE.BufferGeometry,
  tint = new THREE.Color(0xffffff),
  includeColor = true,
): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  // Strip any unexpected attributes so mergeGeometries never rejects mismatched attribute sets
  for (const key of Object.keys(g.attributes)) {
    if (key !== 'position' && key !== 'normal' && key !== 'uv' && (key !== 'color' || !includeColor)) {
      g.deleteAttribute(key);
    }
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  const count = g.attributes.position.count;
  if (!g.attributes.uv) {
    const uvs = new Float32Array(count * 2);
    const pos = g.attributes.position;
    for (let i = 0; i < count; i++) {
      uvs[i * 2] = (pos.getX(i) + pos.getZ(i)) * 0.14;
      uvs[i * 2 + 1] = pos.getY(i) * 0.14;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  }
  if (includeColor && !g.attributes.color) {
    const cols = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      cols[i * 3] = tint.r;
      cols[i * 3 + 1] = tint.g;
      cols[i * 3 + 2] = tint.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  }
  return g;
}
