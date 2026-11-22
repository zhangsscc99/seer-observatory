// Black-hole tidal field & relativistic time-dilation logic — pure, no three, no DOM.
// Zones around a black hole of radius R:
//   > 3.2R       safe    (timeScale = 1.0)
//   1.6R..3.2R   hazard  (timeScale smoothly worsens 1.2 → 2.4 as distance drops)
//   < 1.6R       crush   (tidal tensor accumulates; reaching 1.0 triggers ejection + cooldown)
import { clamp } from './rng.ts';
import type { Vec3 } from './space.ts';

export type TidalZone = 'safe' | 'hazard' | 'crush';

export interface TidalState {
  zone: TidalZone;
  timeScale: number;
}

export interface TidalStep {
  zone: TidalZone;
  timeScale: number;
  /** 0..1 accumulated tidal tensor while inside crush zone */
  tension: number;
  /** seconds remaining before crush tension can accumulate again */
  cooldown: number;
  /** true on the single update tick when auto-ejection triggers */
  ejected: boolean;
}

export const TIDAL = {
  /** outer hazard boundary in multiples of black-hole radius */
  hazardFactor: 3.2,
  /** inner crush boundary in multiples of black-hole radius */
  crushFactor: 1.6,
  /** radial distance (× radius) the ship is bounced out to on ejection */
  ejectFactor: 2.35,
  /** time dilation at the outer hazard edge (3.2R) */
  hazardTimeMin: 1.2,
  /** time dilation at the inner hazard edge (1.6R) */
  hazardTimeMax: 2.4,
  /** maximum time dilation deep in crush zone */
  crushTimeMax: 3.6,
  /** tidal tensor accumulation per second inside crush zone */
  fillRate: 0.45,
  /** tidal tensor decay per second outside crush zone */
  decayRate: 0.6,
  /** post-ejection cooldown (seconds) so repeated re-entry cannot spam eject */
  cooldown: 3.0,
} as const;

export function tidalState(distance: number, radius: number): TidalState {
  if (radius <= 0 || !Number.isFinite(distance)) return { zone: 'safe', timeScale: 1.0 };
  const ratio = Math.max(0, distance) / radius;
  if (ratio > TIDAL.hazardFactor) {
    return { zone: 'safe', timeScale: 1.0 };
  }
  if (ratio >= TIDAL.crushFactor) {
    const t = clamp((TIDAL.hazardFactor - ratio) / (TIDAL.hazardFactor - TIDAL.crushFactor), 0, 1);
    const timeScale = TIDAL.hazardTimeMin + (TIDAL.hazardTimeMax - TIDAL.hazardTimeMin) * t;
    return { zone: 'hazard', timeScale };
  }
  const deep = clamp((TIDAL.crushFactor - ratio) / 0.6, 0, 1);
  const timeScale = TIDAL.hazardTimeMax + (TIDAL.crushTimeMax - TIDAL.hazardTimeMax) * deep;
  return { zone: 'crush', timeScale };
}

/** compute safe radial push-out position outside the crush zone */
export function computeEjectTarget(shipPos: Vec3, center: Vec3, radius: number): Vec3 {
  let dx = shipPos.x - center.x;
  let dy = shipPos.y - center.y;
  let dz = shipPos.z - center.z;
  let d = Math.hypot(dx, dy, dz);
  if (d < 1e-4) {
    dx = 0;
    dy = 0.25;
    dz = 1;
    d = Math.hypot(dx, dy, dz);
  }
  const targetR = radius * TIDAL.ejectFactor;
  const k = targetR / d;
  return {
    x: center.x + dx * k,
    y: center.y + dy * k,
    z: center.z + dz * k,
  };
}

export class TidalField {
  zone: TidalZone = 'safe';
  timeScale = 1.0;
  tension = 0;
  cooldown = 0;

  reset(): void {
    this.zone = 'safe';
    this.timeScale = 1.0;
    this.tension = 0;
    this.cooldown = 0;
  }

  update(dt: number, distance: number, radius: number): TidalStep {
    const stepDt = Math.max(0, dt);
    const st = tidalState(distance, radius);
    this.zone = st.zone;
    this.timeScale = st.timeScale;
    let ejected = false;

    if (this.cooldown > 0) {
      this.cooldown = Math.max(0, this.cooldown - stepDt);
      this.tension = Math.max(0, this.tension - TIDAL.decayRate * stepDt);
    } else if (st.zone === 'crush') {
      this.tension = Math.min(1, this.tension + TIDAL.fillRate * stepDt);
      if (this.tension >= 1) {
        ejected = true;
        this.tension = 0;
        this.cooldown = TIDAL.cooldown;
      }
    } else {
      this.tension = Math.max(0, this.tension - TIDAL.decayRate * stepDt);
    }

    return {
      zone: this.zone,
      timeScale: this.timeScale,
      tension: this.tension,
      cooldown: this.cooldown,
      ejected,
    };
  }
}
