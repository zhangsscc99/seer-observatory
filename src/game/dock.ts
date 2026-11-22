// Ring-city docking / resupply logic — pure, no three, no DOM. Same contract
// style as Scanner: dockState() is a pure zone function, Docker keeps the
// cross-frame engagement state so hold progress decays (never hard-resets)
// when the ship drifts out, and a cooldown throttles repeat rewards.

export type DockState = 'far' | 'approach' | 'hold' | 'docked';

export const DOCK = {
  /** approach band outer edge = station radius × this */
  approachFactor: 2.2,
  /** hold zone outer edge = station radius × this */
  holdFactor: 1.7,
  /** ship speed above which the hold zone doesn't count */
  maxSpeed: 25,
  /** seconds of continuous hold to dock */
  holdTime: 2.5,
  /** fraction of hold progress lost per second outside the hold zone */
  decay: 0.5,
  /** seconds after a dock before another reward can trigger */
  cooldown: 60,
} as const;

/**
 * Instantaneous zone. `holdSeconds` (the caller's accumulated hold time,
 * default 0) promotes `hold` → `docked` once it reaches DOCK.holdTime.
 */
export function dockState(distance: number, radius: number, speed: number, holdSeconds = 0): DockState {
  if (distance > radius * DOCK.approachFactor) return 'far';
  if (distance > radius * DOCK.holdFactor || speed > DOCK.maxSpeed) return 'approach';
  return holdSeconds >= DOCK.holdTime ? 'docked' : 'hold';
}

export interface DockReward {
  /** energy refill marker — the caller sets ship energy to max */
  refuel: true;
  resource: string;
  amount: number;
  log: string;
}

/** resupply payload for a completed dock at the ring city */
export function dockReward(): DockReward {
  return {
    refuel: true,
    resource: '环城通行密钥',
    amount: 1,
    log: '停靠补给完成：推进能量已重新充满，环城港务局签发通行密钥一枚，拾光航道信标频段已同步至本船导航，欢迎再次停靠。',
  };
}

export type DockEvent =
  | { type: 'enter'; state: 'approach' | 'hold' }
  | { type: 'progress'; progress: number }
  | { type: 'docked'; resource: string; amount: number; log: string }
  | { type: 'leave'; state: DockState };

const RANK: Record<DockState, number> = { far: 0, approach: 1, hold: 2, docked: 3 };

export class Docker {
  state: DockState = 'far';
  /** accumulated seconds inside the hold zone (decays outside, never resets) */
  holdSeconds = 0;
  /** seconds left before another dock reward can trigger */
  cooldown = 0;
  /** total completed docks this session */
  docks = 0;

  /** 0..1 progress toward the next dock */
  get progress(): number {
    return Math.min(1, this.holdSeconds / DOCK.holdTime);
  }

  update(dt: number, distance: number, radius: number, speed: number): DockEvent[] {
    const ev: DockEvent[] = [];
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    const prev = this.state;
    // instantaneous zone without the docked promotion: accumulation is ours
    const zone = dockState(distance, radius, speed);

    if (zone !== 'hold') {
      this.holdSeconds = Math.max(0, this.holdSeconds - DOCK.decay * dt * DOCK.holdTime);
      if (RANK[prev] > RANK[zone]) ev.push({ type: 'leave', state: zone });
      else if (prev === 'far' && zone === 'approach') ev.push({ type: 'enter', state: 'approach' });
      this.state = zone;
      return ev;
    }

    if (prev !== 'hold' && prev !== 'docked') ev.push({ type: 'enter', state: 'hold' });

    if (prev === 'docked') {
      // still parked: hold stays saturated, nothing new happens
      this.holdSeconds = DOCK.holdTime;
      return ev;
    }

    const before = this.progress;
    this.holdSeconds = Math.min(DOCK.holdTime, this.holdSeconds + dt);
    this.state = 'hold';
    if (this.progress !== before) ev.push({ type: 'progress', progress: this.progress });

    // cooling down: hold is allowed but the reward stays locked
    if (this.holdSeconds >= DOCK.holdTime && this.cooldown <= 0) {
      this.state = 'docked';
      this.cooldown = DOCK.cooldown;
      this.docks += 1;
      const r = dockReward();
      ev.push({ type: 'docked', resource: r.resource, amount: r.amount, log: r.log });
    }
    return ev;
  }
}
