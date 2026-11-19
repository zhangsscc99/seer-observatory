// Three-mode state machine: cabin ⇄ transit ⇄ space.
// `transit` is the only way between the two playable modes; it carries a
// direction (`to`) and a timer split into phases the renderer reads:
//   launch: thrust (0.8 s, cabin still visible, camera push) → fade-out
//           (0.35 s to white) → [scene swap] → fade-in (0.6 s)
//   dock:   fade-out (0.35 s) → [scene swap] → fade-in (0.6 s)

export type Mode = 'cabin' | 'transit' | 'space';
export type Playable = 'cabin' | 'space';

export const TRANSIT = {
  thrust: 0.8,
  fadeOut: 0.35,
  fadeIn: 0.6,
} as const;

export interface ModeEvents {
  /** fired exactly once per transit at the moment the visible scene must change */
  onSwap?: (to: Playable) => void;
  onArrive?: (at: Playable) => void;
}

export class ModeMachine {
  mode: Mode;
  /** destination while in transit; otherwise the current playable mode */
  to: Playable;
  /** seconds since the transit began */
  t = 0;
  swapped = false;
  private events: ModeEvents;

  constructor(start: Playable = 'cabin', events: ModeEvents = {}) {
    this.mode = start;
    this.to = start;
    this.events = events;
  }

  /** which scene should be drawn right now */
  get scene(): Playable {
    if (this.mode !== 'transit') return this.mode;
    return this.swapped ? this.to : this.to === 'space' ? 'cabin' : 'space';
  }

  private get lead(): number {
    return this.to === 'space' ? TRANSIT.thrust : 0;
  }

  get duration(): number {
    return this.lead + TRANSIT.fadeOut + TRANSIT.fadeIn;
  }

  /** 0..1 progress of the launch thrust phase (1 once past it; 0 outside launch) */
  get thrust(): number {
    if (this.mode !== 'transit' || this.to !== 'space') return 0;
    return Math.min(1, this.t / TRANSIT.thrust);
  }

  /** 0..1 opacity of the full-screen fade overlay */
  get fade(): number {
    if (this.mode !== 'transit') return 0;
    const t = this.t - this.lead;
    if (t <= 0) return 0;
    if (t < TRANSIT.fadeOut) return t / TRANSIT.fadeOut;
    return Math.max(0, 1 - (t - TRANSIT.fadeOut) / TRANSIT.fadeIn);
  }

  /** cabin → space. `canLaunch` is the proximity gate (near the holo table). */
  requestLaunch(canLaunch: boolean): boolean {
    if (this.mode !== 'cabin' || !canLaunch) return false;
    this.begin('space');
    return true;
  }

  /** space → cabin */
  requestDock(): boolean {
    if (this.mode !== 'space') return false;
    this.begin('cabin');
    return true;
  }

  private begin(to: Playable): void {
    this.mode = 'transit';
    this.to = to;
    this.t = 0;
    this.swapped = false;
  }

  update(dt: number): void {
    if (this.mode !== 'transit') return;
    this.t += dt;
    if (!this.swapped && this.t >= this.lead + TRANSIT.fadeOut) {
      this.swapped = true;
      this.events.onSwap?.(this.to);
    }
    if (this.t >= this.duration) {
      this.mode = this.to;
      this.t = 0;
      this.events.onArrive?.(this.to);
    }
  }
}
