// Observatory cabin layout — pure data shared by collision (game) and the
// mesh builder (render). Units are metres; +y up, the bow is -z.
// Polar convention: angle θ (degrees) → (x, z) = (sin θ, cos θ)·r, so θ=0 is
// aft (+z), θ=90 starboard (+x), θ=180 the bow (-z).
import type { CabinWorld, Circle } from './collision.ts';

export interface ConsoleArc {
  /** start / end angle in degrees (a0 < a1) */
  a0: number;
  a1: number;
}

const D2R = Math.PI / 180;

export const CABIN = {
  /** inner wall radius (window sill) */
  wallR: 7.2,
  /** walkable boundary for collision */
  boundR: 6.85,
  ceilingY: 4.2,
  skylightR: 2.7,
  /** console cross-section radii */
  consoleInnerR: 4.75,
  consoleOuterR: 5.75,
  consoleTopY: 0.62,
  seatR: 4.15,
  /** central round platform */
  platformR: 1.6,
  /** holo-globe pedestal */
  pedestal: { x: 0, z: -4.3, r: 1.05 },
  /** distance from the pedestal centre within which "启航" is offered */
  interactR: 2.5,
  spawn: { x: 0, z: 2.6, heading: Math.PI },
  /** window pillars (degrees) */
  pillars: [38, 93, 148, 212, 267, 322] as readonly number[],
} as const;

/** 6 consoles: 3 starboard + 3 port (mirrored) */
export const CONSOLES: readonly ConsoleArc[] = (() => {
  const right: ConsoleArc[] = [
    { a0: 40, a1: 68 },
    { a0: 80, a1: 108 },
    { a0: 120, a1: 148 },
  ];
  const left = right.map((c) => ({ a0: 360 - c.a1, a1: 360 - c.a0 }));
  return [...right, ...left];
})();

export function polar(deg: number, r: number): { x: number; z: number } {
  return { x: Math.sin(deg * D2R) * r, z: Math.cos(deg * D2R) * r };
}

/** two egg seats in front of every console */
export function seatPositions(): { x: number; z: number; deg: number }[] {
  const out: { x: number; z: number; deg: number }[] = [];
  for (const c of CONSOLES) {
    for (const f of [0.3, 0.7]) {
      const deg = c.a0 + (c.a1 - c.a0) * f;
      out.push({ ...polar(deg, CABIN.seatR), deg });
    }
  }
  return out;
}

export const SEAT_COLLIDER_R = 0.3;

export function buildCabinWorld(): CabinWorld {
  const circles: Circle[] = [];
  const midR = (CABIN.consoleInnerR + CABIN.consoleOuterR) / 2;
  const halfDepth = (CABIN.consoleOuterR - CABIN.consoleInnerR) / 2;
  for (const c of CONSOLES) {
    // chain of circles along the arc, spaced tighter than their radius so a
    // 0.28 m walker can't slip between two of them
    // (end circles are inset by their radius so the gaps stay walkable)
    const inset = (halfDepth / midR) / D2R;
    const span = c.a1 - c.a0 - inset * 2;
    const n = Math.ceil((span * D2R * midR) / 0.4);
    for (let i = 0; i <= n; i++) {
      const deg = c.a0 + inset + (span * i) / n;
      circles.push({ ...polar(deg, midR), r: halfDepth });
    }
  }
  // square off the console ends with small corner circles
  const cr = 0.25;
  for (const c of CONSOLES) {
    for (const r of [CABIN.consoleInnerR + cr, CABIN.consoleOuterR - cr]) {
      const inset = (cr / r) / D2R;
      circles.push({ ...polar(c.a0 + inset, r), r: cr }, { ...polar(c.a1 - inset, r), r: cr });
    }
  }
  for (const s of seatPositions()) circles.push({ x: s.x, z: s.z, r: SEAT_COLLIDER_R });
  circles.push({ ...CABIN.pedestal });
  return { circles, boundR: CABIN.boundR };
}

export function nearPedestal(x: number, z: number): boolean {
  return Math.hypot(x - CABIN.pedestal.x, z - CABIN.pedestal.z) <= CABIN.interactR;
}
