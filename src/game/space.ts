// Space sector layout — pure data + deterministic asteroid belt generation.
// The observatory station sits at the origin; the bow (-z) faces planet Kelos.
import { mulberry32 } from './rng.ts';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PlanetDef {
  id: string;
  name: string;
  pos: Vec3;
  radius: number;
  /** surface palette: [deep, mid, bright] hex */
  colors: [number, number, number];
  atmosphere: number;
  /** texture recipe */
  kind: 'ocean' | 'gas' | 'ice' | 'lava';
  seed: number;
}

export const PLANETS: readonly PlanetDef[] = [
  { id: 'kelos', name: '克洛斯星', pos: { x: -260, y: 40, z: -620 }, radius: 150, colors: [0x0b3a8a, 0x1f8f6a, 0xdff6ff], atmosphere: 0x62c8ff, kind: 'ocean', seed: 11 },
  { id: 'helka', name: '赫尔卡星', pos: { x: 640, y: 130, z: -260 }, radius: 110, colors: [0x5a2a8a, 0xd8742c, 0xffe2a8], atmosphere: 0xffa85e, kind: 'gas', seed: 23 },
  { id: 'seron', name: '塞西利亚星', pos: { x: -560, y: -60, z: 330 }, radius: 80, colors: [0x7fb8e8, 0xcfeaff, 0xffffff], atmosphere: 0xa8f0ff, kind: 'ice', seed: 37 },
  { id: 'volc', name: '火山星', pos: { x: 330, y: -150, z: 700 }, radius: 95, colors: [0x40121a, 0xc23a1e, 0xffc24a], atmosphere: 0xff6a4a, kind: 'lava', seed: 41 },
];

/** unit direction from the origin toward the sun */
export const SUN_DIR: Vec3 = (() => {
  const v = { x: 0.55, y: 0.5, z: -0.67 };
  const l = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
})();
export const SUN_DISTANCE = 3200;
export const SUN_RADIUS = 170;

export const STATION = { pos: { x: 0, y: 0, z: 0 }, radius: 17 } as const;

/** play-space radius: beyond this the ship is steered back */
export const SECTOR_RADIUS = 1500;

export const BELT = {
  /** the belt orbits planet index 1 (Helka) */
  planet: 1,
  innerR: 175,
  outerR: 290,
  thickness: 16,
  count: 700,
  /** tilt of the ring plane (radians, about x then z) */
  tiltX: 0.32,
  tiltZ: -0.18,
} as const;

export interface Rock {
  pos: Vec3;
  scale: Vec3;
  rot: Vec3;
}

export function beltRocks(seed = 7): Rock[] {
  const rnd = mulberry32(seed);
  const c = PLANETS[BELT.planet].pos;
  const cx = Math.cos(BELT.tiltX);
  const sx = Math.sin(BELT.tiltX);
  const cz = Math.cos(BELT.tiltZ);
  const sz = Math.sin(BELT.tiltZ);
  const out: Rock[] = [];
  for (let i = 0; i < BELT.count; i++) {
    const a = rnd() * Math.PI * 2;
    // bias toward the middle of the band
    const t = (rnd() + rnd()) / 2;
    const r = BELT.innerR + (BELT.outerR - BELT.innerR) * t;
    let x = Math.cos(a) * r;
    let y = (rnd() - 0.5) * BELT.thickness;
    let z = Math.sin(a) * r;
    // tilt about x
    const y1 = y * cx - z * sx;
    const z1 = y * sx + z * cx;
    // tilt about z
    const x2 = x * cz - y1 * sz;
    const y2 = x * sz + y1 * cz;
    x = x2;
    y = y2;
    z = z1;
    const s = 1.2 + Math.pow(rnd(), 3) * 7;
    out.push({
      pos: { x: c.x + x, y: c.y + y, z: c.z + z },
      scale: { x: s * (0.7 + rnd() * 0.6), y: s * (0.6 + rnd() * 0.5), z: s * (0.7 + rnd() * 0.6) },
      rot: { x: rnd() * 6.283, y: rnd() * 6.283, z: rnd() * 6.283 },
    });
  }
  return out;
}

export interface Body {
  pos: Vec3;
  radius: number;
}

/** solid bodies the ship can't fly through */
export function solidBodies(): Body[] {
  return [...PLANETS.map((p) => ({ pos: p.pos, radius: p.radius })), { pos: STATION.pos, radius: STATION.radius }];
}
