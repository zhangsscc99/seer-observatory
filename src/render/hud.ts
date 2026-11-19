// Minimal DOM HUD. Markup + CSS live in index.html; this wires behaviour.
import type { Playable } from '../game/mode.ts';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export interface HudHandlers {
  onStart(): void;
  onAct(): void;
  onDock(): void;
  onMute(): boolean; // returns new muted state
  onHold(which: 'boost' | 'brake', down: boolean): void;
}

export class Hud {
  private place = $('place');
  private goal = $('goal');
  private tip = $('tip');
  private act = $('act');
  private boost = $('boost');
  private brake = $('brake');
  private dock = $('dock');
  private mute = $('mute');
  private flight = $('flight');
  private speed = $('speed');
  private energy = $('energy');
  private energyBar = this.energy.firstElementChild as HTMLElement;
  private energyPct = $('energyPct');
  private fadeEl = $('fade');
  private start = $('start');
  private lastSpeed = -1;
  private lastEnergy = -1;
  private lastTip = '';

  constructor(h: HudHandlers, muted: boolean) {
    const tap = (el: HTMLElement, fn: () => void): void => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
      });
    };
    tap($('go'), () => {
      this.start.classList.add('hidden');
      h.onStart();
    });
    tap(this.act, h.onAct);
    tap(this.dock, h.onDock);
    tap(this.mute, () => this.setMuted(h.onMute()));
    for (const [el, which] of [[this.boost, 'boost'], [this.brake, 'brake']] as const) {
      const set = (down: boolean) => (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (down) el.setPointerCapture(e.pointerId);
        el.classList.toggle('held', down);
        h.onHold(which, down);
      };
      el.addEventListener('pointerdown', set(true));
      el.addEventListener('pointerup', set(false));
      el.addEventListener('pointercancel', set(false));
    }
    this.setMuted(muted);
    this.setScene('cabin', false);
  }

  setMuted(m: boolean): void {
    this.mute.textContent = m ? '✕' : '♪';
    this.mute.style.opacity = m ? '0.6' : '1';
    this.mute.setAttribute('aria-pressed', String(m));
  }

  /** swap the control set for the visible scene; `busy` hides action buttons mid-transit */
  setScene(scene: Playable, busy: boolean): void {
    const space = scene === 'space';
    this.place.textContent = space ? '星域 · 自由飞行' : '瞭望舱 I';
    this.goal.textContent = space ? '目标：探索行星与小行星带' : '目标：前往全息星图台，启航';
    this.flight.classList.toggle('hidden', !space);
    this.boost.classList.toggle('hidden', !space || busy);
    this.brake.classList.toggle('hidden', !space || busy);
    this.dock.classList.toggle('hidden', !space || busy);
    if (space || busy) this.setInteract(false);
  }

  setInteract(show: boolean): void {
    this.act.classList.toggle('hidden', !show);
  }

  setTip(text: string): void {
    if (text === this.lastTip) return;
    this.lastTip = text;
    this.tip.textContent = text;
    this.tip.classList.toggle('hidden', text === '');
  }

  setFlight(speed: number, energyFrac: number, depleted: boolean): void {
    const s = Math.round(speed);
    if (s !== this.lastSpeed) {
      this.lastSpeed = s;
      this.speed.textContent = String(s);
    }
    const e = Math.round(energyFrac * 100);
    if (e !== this.lastEnergy) {
      this.lastEnergy = e;
      this.energyBar.style.transform = `scaleX(${energyFrac.toFixed(3)})`;
      this.energyPct.textContent = `${e}%`;
    }
    this.energy.classList.toggle('low', depleted);
  }

  setFade(a: number): void {
    this.fadeEl.style.opacity = a <= 0 ? '0' : a.toFixed(3);
  }
}
