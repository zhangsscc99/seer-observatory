// Minimal DOM HUD. Markup + CSS live in index.html; this wires behaviour.
import type { Archive } from '../game/archive.ts';
import type { Playable } from '../game/mode.ts';
import type { HazardKind } from '../game/scan.ts';
import type { PlanetDef } from '../game/space.ts';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const KIND_LABEL: Record<PlanetDef['kind'], string> = {
  ocean: '海洋行星',
  gas: '气态行星',
  ice: '冰封行星',
  lava: '熔岩行星',
  'ice-ring': '冰环行星',
  'gas-storm': '气态巨行星',
  'red-giant': '红巨星',
  binary: '双星系',
};

const HAZARD_LABEL: Record<HazardKind, string> = {
  cold: '低温',
  radiation: '强辐射',
  wind: '湍流',
  gravity: '强引力',
  photon: '光子场',
};

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
  private targets = $('targets');
  private targetRows = $('targetRows');
  private launch = $<HTMLButtonElement>('launch');
  private archivePanel = $('archive');
  private archiveRows = $('archiveRows');
  private scan = $('scan');
  private scanName = $('scanName');
  private scanPct = $('scanPct');
  private scanBar = $('scanBarFill');
  private warn = $('warn');
  private card = $('card');
  private cardName = $('cardName');
  private cardMeta = $('cardMeta');
  private cardLog = $('cardLog');
  private lastSpeed = -1;
  private lastEnergy = -1;
  private lastTip = '';
  private currentScene: Playable = 'cabin';
  private goalOverride: string | null = null;
  private targetPlanets: readonly PlanetDef[] = [];
  private selectedTargetId: string | null = null;
  private onPickTarget: (id: string) => void = () => {};
  private cardTimer: number | undefined;

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
    tap($('archBtn'), () => this.toggleArchive());
    tap($('targetsClose'), () => this.closeTargets());
    tap($('archiveClose'), () => this.closeArchive());
    tap(this.launch, () => {
      if (this.selectedTargetId !== null) this.onPickTarget(this.selectedTargetId);
    });
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
    this.closePanels();
    this.setWarn(null, null);
    this.setScan(null, 0, false);
  }

  setMuted(m: boolean): void {
    this.mute.textContent = m ? '✕' : '♪';
    this.mute.style.opacity = m ? '0.6' : '1';
    this.mute.setAttribute('aria-pressed', String(m));
  }

  /** swap the control set for the visible scene; `busy` hides action buttons mid-transit */
  setScene(scene: Playable, busy: boolean): void {
    const space = scene === 'space';
    this.currentScene = scene;
    this.place.textContent = space ? '星域 · 自由飞行' : '瞭望舱 I';
    this.applyGoal();
    this.flight.classList.toggle('hidden', !space);
    this.boost.classList.toggle('hidden', !space || busy);
    this.brake.classList.toggle('hidden', !space || busy);
    this.dock.classList.toggle('hidden', !space || busy);
    if (space || busy) {
      this.setInteract(false);
      this.closePanels();
    }
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

  setGoal(text: string | null): void {
    this.goalOverride = text && text.length > 0 ? text : null;
    this.applyGoal();
  }

  private applyGoal(): void {
    this.goal.textContent =
      this.goalOverride ?? (this.currentScene === 'space' ? '目标：探索行星与小行星带' : '目标：前往全息星图台，启航');
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

  setTargets(planets: readonly PlanetDef[], selectedId: string | null, onPick: (id: string) => void): void {
    this.targetPlanets = planets;
    this.onPickTarget = onPick;
    const valid = selectedId !== null && planets.some((p) => p.id === selectedId);
    this.selectedTargetId = valid ? selectedId : (planets[0]?.id ?? null);
    this.renderTargets();
  }

  toggleTargets(): void {
    if (this.targetsOpen) {
      this.closeTargets();
      return;
    }
    this.closeArchive();
    this.renderTargets();
    this.targets.classList.remove('hidden');
  }

  closeTargets(): void {
    this.targets.classList.add('hidden');
  }

  get targetsOpen(): boolean {
    return !this.targets.classList.contains('hidden');
  }

  get archiveOpen(): boolean {
    return !this.archivePanel.classList.contains('hidden');
  }

  get panelOpen(): boolean {
    return this.targetsOpen || this.archiveOpen;
  }

  closePanels(): void {
    this.closeTargets();
    this.closeArchive();
  }

  private renderTargets(): void {
    const frag = document.createDocumentFragment();
    for (const p of this.targetPlanets) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'targetRow';
      row.classList.toggle('sel', p.id === this.selectedTargetId);

      const name = document.createElement('span');
      name.className = 'targetName';
      name.textContent = p.name;
      const meta = document.createElement('span');
      meta.className = 'targetMeta';
      meta.textContent = `${KIND_LABEL[p.kind]} · ${p.hazard ? HAZARD_LABEL[p.hazard] : '环境稳定'}`;
      row.append(name, meta);
      row.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.selectedTargetId = p.id;
        this.renderTargets();
      });
      frag.appendChild(row);
    }
    this.targetRows.replaceChildren(frag);
    this.launch.disabled = this.selectedTargetId === null;
  }

  private toggleArchive(): void {
    if (this.archiveOpen) {
      this.closeArchive();
      return;
    }
    this.closeTargets();
    this.archivePanel.classList.remove('hidden');
  }

  private closeArchive(): void {
    this.archivePanel.classList.add('hidden');
  }

  setArchive(a: Archive): void {
    const entries = Object.values(a.scans).sort((x, y) => y.last - x.last);
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = '尚无档案';
      this.archiveRows.replaceChildren(empty);
      return;
    }
    const frag = document.createDocumentFragment();
    for (const e of entries) {
      const row = document.createElement('div');
      row.className = 'archiveRow';
      const name = document.createElement('span');
      name.className = 'archiveName';
      name.textContent = e.name || e.id;
      const count = document.createElement('span');
      count.className = 'archiveCount';
      count.textContent = `${e.scans} 次扫描`;
      const loot = document.createElement('span');
      loot.className = 'archiveLoot';
      loot.textContent = `${e.resource || '未知资源'} × ${e.amount}`;
      row.append(name, count, loot);
      frag.appendChild(row);
    }
    this.archiveRows.replaceChildren(frag);
  }

  setWarn(text: string | null, hazard: HazardKind | null): void {
    this.warn.classList.toggle('hidden', !text);
    if (!text) return;
    this.warn.textContent = text;
    const gold = hazard === 'radiation' || hazard === 'wind' || hazard === 'gravity';
    this.warn.classList.toggle('gold', gold);
    this.warn.classList.toggle('cyan', !gold);
  }

  setScan(name: string | null, progress: number, done: boolean): void {
    this.scan.classList.toggle('hidden', name === null);
    if (name === null) return;
    const p = Math.max(0, Math.min(1, progress));
    this.scanName.textContent = name;
    this.scanPct.textContent = `${Math.round(p * 100)}%`;
    this.scanBar.style.transform = `scaleX(${p.toFixed(3)})`;
    this.scan.classList.toggle('done', done);
  }

  showScanCard(name: string, resource: string, amount: number, log: string): void {
    if (this.cardTimer !== undefined) window.clearTimeout(this.cardTimer);
    this.cardName.textContent = `扫描完成 · ${name}`;
    this.cardMeta.textContent = `${resource} × ${amount}`;
    this.cardLog.textContent = log;
    this.card.classList.add('show');
    this.cardTimer = window.setTimeout(() => this.card.classList.remove('show'), 2200);
  }

  setFade(a: number): void {
    this.fadeEl.style.opacity = a <= 0 ? '0' : a.toFixed(3);
  }
}
