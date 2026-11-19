// Space backdrop: a nebula shader is baked ONCE into a cubemap (so the
// per-frame cost is a single cube lookup — mobile friendly) and used as
// scene.background + scene.environment. Crisp stars are a separate Points
// layer that follows the camera.
import * as THREE from 'three';
import { mulberry32 } from '../game/rng.ts';
import { SUN_DIR } from '../game/space.ts';

const NEBULA_FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 uSun;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x),
                 mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
                 mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) { s += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  // domain-warped clouds
  vec3 w = vec3(fbm(d * 1.6 + 1.3), fbm(d * 1.6 + 5.2), fbm(d * 1.6 + 9.1));
  float n1 = fbm(d * 2.2 + w * 1.6);
  float n2 = fbm(d * 3.4 - w * 1.2 + 4.0);
  float n3 = fbm(d * 5.0 + w * 2.0 + 8.0);

  // never-black base: deep indigo → royal blue
  vec3 col = mix(vec3(0.030, 0.050, 0.150), vec3(0.060, 0.120, 0.340), smoothstep(0.25, 0.75, n1));
  // violet / magenta clouds
  col += vec3(0.42, 0.16, 0.72) * pow(smoothstep(0.42, 0.82, n2), 1.5) * 0.9;
  // blue-cyan clouds
  col += vec3(0.08, 0.42, 0.85) * pow(smoothstep(0.40, 0.80, n1), 1.4) * 0.9;
  // bright teal/pink knots
  float knot = smoothstep(0.62, 0.9, n3) * smoothstep(0.45, 0.7, n1);
  col += mix(vec3(0.25, 0.85, 0.80), vec3(0.95, 0.45, 0.75), n2) * knot * 0.55;
  // dark dust lanes for depth (multiplicative, floor stays > 0)
  col *= 0.62 + 0.38 * smoothstep(0.30, 0.55, fbm(d * 2.8 + 20.0));

  // warm scatter around the sun
  float sd = max(dot(d, normalize(uSun)), 0.0);
  col += vec3(1.0, 0.72, 0.42) * (pow(sd, 6.0) * 0.30 + pow(sd, 40.0) * 0.5);

  // baked faint star field (crisp bright stars are Points)
  vec3 cell = floor(d * 190.0);
  float h = hash(cell);
  float star = step(0.9965, h) * (0.4 + 0.6 * hash(cell + 3.0));
  col += vec3(0.75, 0.85, 1.0) * star * 0.8;

  gl_FragColor = vec4(col, 1.0);
}`;

const NEBULA_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export function bakeSky(renderer: THREE.WebGLRenderer, size: number): THREE.CubeTexture {
  const rt = new THREE.WebGLCubeRenderTarget(size, {
    type: THREE.HalfFloatType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
  });
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    vertexShader: NEBULA_VERT,
    fragmentShader: NEBULA_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uSun: { value: new THREE.Vector3(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z) } },
  });
  const geo = new THREE.BoxGeometry(2, 2, 2);
  scene.add(new THREE.Mesh(geo, mat));
  const cam = new THREE.CubeCamera(0.1, 10, rt);
  cam.update(renderer, scene);
  geo.dispose();
  mat.dispose();
  return rt.texture;
}

/** crisp star layer: fixed-size points on a far shell */
export function makeStars(count: number, radius: number): THREE.Points {
  const rnd = mulberry32(99);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const z = rnd() * 2 - 1;
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    pos[i * 3] = Math.cos(a) * r * radius;
    pos[i * 3 + 1] = z * radius;
    pos[i * 3 + 2] = Math.sin(a) * r * radius;
    const t = rnd();
    const b = 0.55 + Math.pow(rnd(), 2) * 0.9;
    col[i * 3] = (t < 0.2 ? 1.0 : 0.8) * b;
    col[i * 3 + 1] = (t < 0.2 ? 0.86 : 0.92) * b;
    col[i * 3 + 2] = (t < 0.2 ? 0.7 : 1.0) * b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 2.2,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = -10;
  return pts;
}
