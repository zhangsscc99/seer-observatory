// Space sector: sun (+ billboard flare), planets with fresnel atmospheres,
// instanced asteroid belt, stardust that streams past the ship, and the
// observatory station exterior. Built from src/game/space.ts data.
import * as THREE from 'three';
import { mulberry32 } from '../game/rng.ts';
import { beltRocks, PLANETS, STATION, SUN_DIR, SUN_DISTANCE, SUN_RADIUS, type PlanetDef } from '../game/space.ts';
import { MAT, arc, glow } from './materials.ts';
import { PAL } from './palette.ts';
import { buildRings } from './rings.ts';
import { flareTexture, planetTexture, radialTexture, rockTexture } from './textures.ts';

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
    float ang = uTime * 0.45 * smoothstep(1.25, 0.1, r);
    float ca = cos(ang), sa = sin(ang);
    vec2 rotNorm = mat2(ca, -sa, sa, ca) * eNorm * (1.0 - 0.05 * eyeMask * sin(uTime * 1.1));
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
// outward. Lit side only (no baseline); the terminator scatters ~8% warmer.
const HALO_FRAG = /* glsl */ `
uniform vec3 uSun; uniform vec3 uAtmo; uniform float uEdge; uniform float uPow; uniform float uGain;
varying vec3 vN; varying vec3 vW;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  float d = clamp(-dot(n, v) / uEdge, 0.0, 1.0);
  float a = pow(d, uPow);
  float ndl = dot(n, uSun);
  float lit = smoothstep(-0.35, 0.30, ndl);
  float term = smoothstep(0.25, 0.85, 1.0 - abs(ndl));
  vec3 tint = mix(uAtmo, uAtmo * vec3(1.08, 1.0, 0.92), term);
  gl_FragColor = vec4(tint * a * lit * uGain, 1.0);
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

const HALO_SCALE = 1.16;
const HALO_SCALE_NARROW = 1.05;
const FROST_SCALE = 1.02;

/** procedural orbital gas-harvesting station (~0.22R across, ≤8 draw calls) */
function buildGasStation(p: PlanetDef): THREE.Group {
  const r = p.radius * 0.11; // ~0.22R diameter
  const root = new THREE.Group();
  const offset = new THREE.Vector3(p.radius * 0.9, p.radius * 0.72, p.radius * 0.35);
  const radial = offset.clone().normalize();
  root.position.copy(offset);
  root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), radial);
  root.userData.basePos = offset.clone();
  root.userData.radial = radial.clone();
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
  const winGeo = new THREE.BoxGeometry(r * 0.13, r * 0.06, r * 0.04);
  const wins = new THREE.InstancedMesh(winGeo, MAT.cyanGlow, 16);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    q.setFromEuler(e.set(0, a, 0));
    m.compose(new THREE.Vector3(Math.sin(a) * r * 0.97, r * 0.2, Math.cos(a) * r * 0.97), q, sc);
    wins.setMatrixAt(i, m);
  }
  wins.instanceMatrix.needsUpdate = true;
  body.add(wins);

  // bottom beacon (pulses in update)
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(r * 0.08, 12, 10), glow(PAL.tealAccent, 1.9));
  beacon.position.y = -r * 0.62;
  beacon.name = 'gasBeacon';
  body.add(beacon);

  // thin dark harvesting tether dipping into the upper cloud deck
  const tetherLen = p.radius * 0.24;
  const tether = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.015, r * 0.009, tetherLen, 6), MAT.metalDark);
  tether.position.y = -r * 0.62 - tetherLen * 0.5;
  root.add(tether);

  return root;
}

function haloShell(p: PlanetDef, scale: number, peakPow: number, gain: number, atmo: THREE.Color): THREE.Mesh {
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
      },
      side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
}

function buildPlanet(p: PlanetDef): THREE.Group {
  const g = new THREE.Group();
  g.position.set(p.pos.x, p.pos.y, p.pos.z);
  const atmo = new THREE.Color(p.atmosphere);
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
  const halo = haloShell(p, HALO_SCALE, 3.2, p.kind === 'gas-storm' ? 0.42 : 0.45, atmo);
  g.add(surface, halo);
  const timeMats: THREE.ShaderMaterial[] = [];
  if (p.kind === 'gas-storm') {
    g.add(haloShell(p, HALO_SCALE_NARROW, 5.5, 0.36, atmo));
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
  const sunLight = new THREE.DirectionalLight(0xfff4e0, 2.6);
  sunLight.position.copy(sunDir).multiplyScalar(100);
  const fill = new THREE.HemisphereLight(0xbfd4ff, 0x5a4a9a, 1.25);
  near.add(sunLight, sunLight.target, fill);

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
          gs.position.copy(base).addScaledVector(rad, Math.sin(t * 0.6) * 1.8);
          const body = gs.getObjectByName('gasStationBody');
          if (body) body.rotation.y = t * 0.14;
          const gb = gs.getObjectByName('gasBeacon');
          if (gb) gb.scale.setScalar(1 + 0.45 * Math.max(0, Math.sin(t * 3.2)));
        }
      }
      markerMat.opacity = 0.55 + 0.25 * Math.sin(t * 2.4);
      flare.material.rotation = t * 0.02;
      flare.scale.setScalar(SUN_RADIUS * (14 + Math.sin(t * 0.9) * 0.8));
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
