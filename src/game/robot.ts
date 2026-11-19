// Third-person walker for the Seer robot. Pure kinematics on the XZ plane:
// camera-relative input → velocity (with accel smoothing) → collision.
import { resolve, type CabinWorld } from './collision.ts';
import { angleDelta, clamp, damp } from './rng.ts';

export interface WalkInput {
  /** strafe, -1..1 (right positive) */
  moveX: number;
  /** forward, -1..1 (away from camera positive) */
  moveY: number;
  run: boolean;
  /** camera yaw in radians; yaw 0 looks toward -z */
  camYaw: number;
}

export const ROBOT = {
  radius: 0.28,
  height: 0.8,
  walkSpeed: 2.2,
  runSpeed: 4.4,
  accel: 14,
  turnRate: 14,
  /** metres travelled per footstep */
  stride: 0.55,
} as const;

export class Robot {
  x: number;
  z: number;
  /** facing: (sin heading, cos heading) on XZ */
  heading: number;
  vx = 0;
  vz = 0;
  /** accumulates distance; drives the walk cycle */
  walkPhase = 0;
  /** incremented once per footfall — renderer/audio diff this */
  steps = 0;

  constructor(x = 0, z = 0, heading = 0) {
    this.x = x;
    this.z = z;
    this.heading = heading;
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  update(dt: number, input: WalkInput, world: CabinWorld): void {
    let mx = clamp(input.moveX, -1, 1);
    let my = clamp(input.moveY, -1, 1);
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    const sin = Math.sin(input.camYaw);
    const cos = Math.cos(input.camYaw);
    // forward f = (-sin, -cos), right r = (cos, -sin)
    const dirX = -sin * my + cos * mx;
    const dirZ = -cos * my - sin * mx;
    const top = input.run ? ROBOT.runSpeed : ROBOT.walkSpeed;
    const k = damp(ROBOT.accel, dt);
    this.vx += (dirX * top - this.vx) * k;
    this.vz += (dirZ * top - this.vz) * k;
    if (len < 0.01 && this.speed < 0.02) this.vx = this.vz = 0;

    const px = this.x;
    const pz = this.z;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    if (resolve(this, ROBOT.radius, world) && dt > 0) {
      // keep only the velocity that actually happened so we slide, not stick
      this.vx = (this.x - px) / dt;
      this.vz = (this.z - pz) / dt;
    }

    if (len > 0.05) {
      const want = Math.atan2(dirX, dirZ);
      this.heading += angleDelta(this.heading, want) * damp(ROBOT.turnRate, dt);
    }

    const travelled = Math.hypot(this.x - px, this.z - pz);
    const before = Math.floor(this.walkPhase / ROBOT.stride);
    this.walkPhase += travelled;
    if (Math.floor(this.walkPhase / ROBOT.stride) > before) this.steps++;
  }
}
