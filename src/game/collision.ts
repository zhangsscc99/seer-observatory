// 2D (XZ plane) collision for the cabin: the walker is a circle, obstacles
// are circles, and the room is a circular boundary centred on the origin.

export interface Circle {
  x: number;
  z: number;
  r: number;
}

export interface CabinWorld {
  circles: readonly Circle[];
  /** walkable radius of the room (walker centre may reach boundR - radius) */
  boundR: number;
}

export interface XZ {
  x: number;
  z: number;
}

const PASSES = 8;

/** Push a circle of `radius` at `p` out of all obstacles and back inside the
 *  room. Mutates and returns `p`. Returns true via `hit` flag if anything touched. */
export function resolve(p: XZ, radius: number, world: CabinWorld): boolean {
  let hit = false;
  for (let pass = 0; pass < PASSES; pass++) {
    let moved = false;
    for (const c of world.circles) {
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const min = c.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2);
      if (d < 1e-6) {
        // dead centre: eject toward the room centre side deterministically
        p.x = c.x;
        p.z = c.z + min;
      } else {
        const k = min / d;
        p.x = c.x + dx * k;
        p.z = c.z + dz * k;
      }
      moved = hit = true;
    }
    const lim = world.boundR - radius;
    const r = Math.hypot(p.x, p.z);
    if (r > lim) {
      p.x *= lim / r;
      p.z *= lim / r;
      moved = hit = true;
    }
    if (!moved) break;
  }
  return hit;
}

/** true when the circle overlaps nothing and is inside the room */
export function isFree(p: XZ, radius: number, world: CabinWorld, eps = 1e-3): boolean {
  if (Math.hypot(p.x, p.z) > world.boundR - radius + eps) return false;
  for (const c of world.circles) {
    if (Math.hypot(p.x - c.x, p.z - c.z) < c.r + radius - eps) return false;
  }
  return true;
}
