// Arcade flight kinematics for the scout ship. Yaw/pitch steering, a
// throttle that eases toward cruise / boost / brake targets, a boost energy
// pool, soft sector bounds and sphere push-out against solid bodies.
import { clamp, damp } from './rng.ts';
import type { Body, Vec3 } from './space.ts';

export interface FlightInput {
  /** -1..1, right positive */
  steerX: number;
  /** -1..1, nose-up positive */
  steerY: number;
  boost: boolean;
  brake: boolean;
}

export const SHIP = {
  radius: 3,
  cruise: 45,
  boostSpeed: 170,
  brakeSpeed: 6,
  accel: 1.6,
  brakeRate: 2.4,
  yawRate: 1.5,
  pitchRate: 1.1,
  maxPitch: 1.25,
  steerLag: 5,
  maxRoll: 0.75,
  energyMax: 100,
  energyDrain: 22,
  energyRegen: 14,
  /** boost can't re-engage below this after running dry */
  energyRearm: 15,
} as const;

export function forwardOf(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

export class Ship {
  pos: Vec3;
  yaw: number;
  pitch = 0;
  /** visual bank, radians (negative = right wing down) */
  roll = 0;
  speed: number = SHIP.cruise;
  energy: number = SHIP.energyMax;
  /** smoothed steering actually applied */
  steerX = 0;
  steerY = 0;
  boosting = false;
  /** true after energy hit 0 until it regenerates past energyRearm */
  depleted = false;
  /** set for one update when a body was hit */
  bumped = false;

  constructor(pos: Vec3 = { x: 0, y: 0, z: 0 }, yaw = 0) {
    this.pos = { ...pos };
    this.yaw = yaw;
  }

  get forward(): Vec3 {
    return forwardOf(this.yaw, this.pitch);
  }

  /** 0 at rest, 1 at full boost speed */
  get speedFrac(): number {
    return clamp(this.speed / SHIP.boostSpeed, 0, 1);
  }

  update(dt: number, input: FlightInput, bodies: readonly Body[] = [], sectorR = Infinity, energyMul = 1): void {
    const ks = damp(SHIP.steerLag, dt);
    this.steerX += (clamp(input.steerX, -1, 1) - this.steerX) * ks;
    this.steerY += (clamp(input.steerY, -1, 1) - this.steerY) * ks;

    // soft sector bound: outside, blend steering so the nose swings home
    const dist = Math.hypot(this.pos.x, this.pos.y, this.pos.z);
    let yawIn = this.steerX;
    let pitchIn = this.steerY;
    if (dist > sectorR) {
      const f = this.forward;
      const outward = (f.x * this.pos.x + f.y * this.pos.y + f.z * this.pos.z) / dist;
      if (outward > -0.3) {
        // turn toward the origin: sign from the cross product on XZ
        const cross = f.x * -this.pos.z - f.z * -this.pos.x;
        yawIn = cross > 0 ? 1 : -1;
        pitchIn = clamp(-this.pos.y / dist - f.y, -1, 1);
      }
    }

    this.yaw -= yawIn * SHIP.yawRate * dt;
    this.pitch = clamp(this.pitch + pitchIn * SHIP.pitchRate * dt, -SHIP.maxPitch, SHIP.maxPitch);
    this.roll += (-yawIn * SHIP.maxRoll - this.roll) * damp(4, dt);

    // boost / energy
    if (this.depleted && this.energy >= SHIP.energyRearm) this.depleted = false;
    this.boosting = input.boost && !input.brake && !this.depleted && this.energy > 0;
    if (this.boosting) {
      this.energy = Math.max(0, this.energy - SHIP.energyDrain * dt);
      if (this.energy === 0) this.depleted = true;
    } else {
      this.energy = Math.min(SHIP.energyMax, this.energy + SHIP.energyRegen * energyMul * dt);
    }

    const target = input.brake ? SHIP.brakeSpeed : this.boosting ? SHIP.boostSpeed : SHIP.cruise;
    const rate = target < this.speed ? SHIP.brakeRate * (input.brake ? 1 : 0.5) : SHIP.accel;
    this.speed += (target - this.speed) * damp(rate, dt);

    const f = this.forward;
    this.pos.x += f.x * this.speed * dt;
    this.pos.y += f.y * this.speed * dt;
    this.pos.z += f.z * this.speed * dt;

    this.bumped = false;
    for (const b of bodies) {
      const dx = this.pos.x - b.pos.x;
      const dy = this.pos.y - b.pos.y;
      const dz = this.pos.z - b.pos.z;
      const min = b.radius + SHIP.radius;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2) || 1;
      const k = min / d;
      this.pos.x = b.pos.x + dx * k;
      this.pos.y = b.pos.y + dy * k;
      this.pos.z = b.pos.z + dz * k;
      // scrub speed proportional to how head-on the hit was
      const into = -(f.x * dx + f.y * dy + f.z * dz) / d;
      if (into > 0) this.speed *= 1 - 0.8 * into * Math.min(1, dt * 10);
      this.bumped = true;
    }
  }
}
