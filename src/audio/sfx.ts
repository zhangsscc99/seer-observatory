// Procedural WebAudio — zero audio files. Event table: docs/ART-SPEC.md §4.
// One-shots: footstep, prompt, confirm, launch, dock, bump, deny.
// Loops (gain-driven every frame): cabin ambience hum, thruster drone.
// The AudioContext is created lazily in the first user gesture; the mute
// flag is persisted in localStorage.

export type SfxName = 'footstep' | 'prompt' | 'confirm' | 'launch' | 'dock' | 'bump' | 'deny' | 'eject';

const MUTE_KEY = 'seer.muted';

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export class Sfx {
  muted = readMuted();
  unlocked = false;
  /** per-event play counts (for e2e) */
  readonly counts: Record<string, number> = {};
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private ambGain: GainNode | null = null;
  private thrGain: GainNode | null = null;
  private thrOsc: OscillatorNode[] = [];
  private thrFilter: BiquadFilterNode | null = null;

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // cabin ambience: two detuned low sines + band-passed air noise
    this.ambGain = ctx.createGain();
    this.ambGain.gain.value = 0;
    this.ambGain.connect(this.master);
    for (const [f, g] of [[55, 0.22], [82.6, 0.1], [110.4, 0.05]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(this.ambGain);
      o.start();
    }
    const air = this.loopNoise();
    const airF = ctx.createBiquadFilter();
    airF.type = 'bandpass';
    airF.frequency.value = 420;
    airF.Q.value = 0.6;
    const airG = ctx.createGain();
    airG.gain.value = 0.035;
    air.connect(airF).connect(airG).connect(this.ambGain);

    // thruster: saw pair through a low-pass + rumble noise
    this.thrGain = ctx.createGain();
    this.thrGain.gain.value = 0;
    this.thrFilter = ctx.createBiquadFilter();
    this.thrFilter.type = 'lowpass';
    this.thrFilter.frequency.value = 300;
    this.thrFilter.Q.value = 2;
    this.thrFilter.connect(this.thrGain).connect(this.master);
    for (const f of [62, 93.5]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = 0.16;
      o.connect(og).connect(this.thrFilter);
      o.start();
      this.thrOsc.push(o);
    }
    const rum = this.loopNoise();
    const rumG = ctx.createGain();
    rumG.gain.value = 0.35;
    rum.connect(rumG).connect(this.thrFilter);
    this.unlocked = true;
  }

  private loopNoise(): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.start();
    return s;
  }

  setMuted(v: boolean): void {
    this.muted = v;
    try {
      localStorage.setItem(MUTE_KEY, v ? '1' : '0');
    } catch {
      /* private mode */
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v ? 0 : 0.8, this.ctx.currentTime, 0.03);
  }

  /** per-frame loop mix. ambience 0..1, thrust 0..1 (speed fraction), boost flag */
  setLoops(ambience: number, thrust: number, boosting: boolean): void {
    if (!this.ctx || !this.ambGain || !this.thrGain || !this.thrFilter) return;
    const t = this.ctx.currentTime;
    this.ambGain.gain.setTargetAtTime(ambience * 0.5, t, 0.2);
    this.thrGain.gain.setTargetAtTime(thrust > 0 ? 0.12 + thrust * 0.4 : 0, t, 0.12);
    this.thrFilter.frequency.setTargetAtTime(220 + thrust * 1500 + (boosting ? 700 : 0), t, 0.15);
    this.thrOsc[0].frequency.setTargetAtTime(55 + thrust * 60, t, 0.15);
    this.thrOsc[1].frequency.setTargetAtTime(82 + thrust * 92, t, 0.15);
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(type: BiquadFilterType, f0: number, f1: number, dur: number, vol: number, q = 1): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.loopStart = Math.random() * 0.5;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master!);
    s.start(t, Math.random() * 0.5, dur + 0.05);
  }

  play(name: SfxName): void {
    this.counts[name] = (this.counts[name] ?? 0) + 1;
    if (!this.ctx || !this.master || this.muted) return;
    switch (name) {
      case 'footstep': // soft servo-tap on tile
        this.burst('bandpass', 900 + Math.random() * 300, 300, 0.07, 0.22, 2);
        this.tone('sine', 190, 120, 0.06, 0.1);
        break;
      case 'prompt': // rising two-note chime
        this.tone('sine', 880, 880, 0.12, 0.16);
        this.tone('sine', 1318, 1318, 0.18, 0.14, 0.09);
        break;
      case 'confirm':
        this.tone('triangle', 660, 660, 0.09, 0.2);
        this.tone('triangle', 990, 990, 0.09, 0.2, 0.07);
        this.tone('triangle', 1320, 1320, 0.22, 0.2, 0.14);
        break;
      case 'launch': // charge-up sweep + whoosh
        this.tone('sawtooth', 70, 520, 1.1, 0.16);
        this.tone('sine', 220, 1760, 1.0, 0.1);
        this.burst('bandpass', 200, 3200, 1.3, 0.4, 0.8);
        break;
      case 'dock':
        this.tone('sine', 1040, 520, 0.4, 0.16);
        this.burst('lowpass', 2400, 200, 0.6, 0.25);
        break;
      case 'bump':
        this.tone('sine', 110, 40, 0.3, 0.5);
        this.burst('lowpass', 800, 100, 0.25, 0.4);
        break;
      case 'deny':
        this.tone('square', 196, 150, 0.14, 0.08);
        break;
      case 'eject': // clean gravitational repulsion wave (non-combat)
        this.tone('sine', 180, 560, 0.45, 0.22);
        this.tone('triangle', 360, 720, 0.35, 0.12, 0.05);
        this.burst('bandpass', 320, 1800, 0.5, 0.24, 1.4);
        break;
    }
  }
}
