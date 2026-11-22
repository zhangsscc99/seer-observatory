// Procedural canvas textures — zero image files. Everything is painted once
// at boot on 2D canvases and uploaded as CanvasTexture.
import * as THREE from 'three';
import { CABIN, CONSOLES } from '../game/cabin.ts';
import { mulberry32 } from '../game/rng.ts';
import type { PlanetDef } from '../game/space.ts';
import { PAL, css } from './palette.ts';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** tileable-in-x value noise on a lattice, fbm'd */
function makeNoise(seed: number, period: number): (x: number, y: number) => number {
  const rnd = mulberry32(seed);
  const N = 64;
  const g = new Float32Array(N * N);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const at = (x: number, y: number, p: number): number => g[(((y % N) + N) % N) * N + ((((x % p) + p) % p) % N)];
  const one = (x: number, y: number, p: number): number => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi, p);
    const b = at(xi + 1, yi, p);
    const c = at(xi, yi + 1, p);
    const d = at(xi + 1, yi + 1, p);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (x, y) => {
    let sum = 0;
    let amp = 0.5;
    let f = 1;
    for (let o = 0; o < 5; o++) {
      sum += one(x * f, y * f, period * f) * amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / 0.96875;
  };
}

const D2R = Math.PI / 180;

/** deterministic 2-D int → [0,1) hash (voronoi feature-point jitter) */
function vhash(i: number, j: number): number {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Cabin floor: top-down map of the whole disc (canvas top = bow).
 *  Returns colour + emissive maps. */
export function floorTextures(R: number): { map: THREE.Texture; emissive: THREE.Texture; rough: THREE.Texture } {
  const S = 1024;
  const [c, g] = canvas(S, S);
  const [ce, e] = canvas(S, S);
  const [cr, r] = canvas(S, S);
  const m = S / 2 / R; // px per metre
  const cx = S / 2;
  const cy = S / 2;
  // polar helper: our θ (0 = aft/+z = canvas down, 90 = +x = right) → canvas angle
  const ca = (deg: number): number => (90 - deg) * D2R;
  const ringSeg = (ctx: CanvasRenderingContext2D, r0: number, r1: number, a0: number, a1: number, fill: string): void => {
    ctx.beginPath();
    ctx.arc(cx, cy, r1 * m, ca(a0), ca(a1), true);
    ctx.arc(cx, cy, r0 * m, ca(a1), ca(a0), false);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };
  const ring = (ctx: CanvasRenderingContext2D, rad: number, w: number, stroke: string): void => {
    ctx.beginPath();
    ctx.arc(cx, cy, rad * m, 0, Math.PI * 2);
    ctx.lineWidth = w;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  };

  // base plating
  g.fillStyle = '#ccd6e1';
  g.fillRect(0, 0, S, S);
  e.fillStyle = '#000';
  e.fillRect(0, 0, S, S);
  // low-frequency roughness variation across tiles (0.25..0.65) so floor shows worn/polished sheen contrast
  const rImg = r.createImageData(S, S);
  const nRough1 = makeNoise(19, 6);
  const nRough2 = makeNoise(73, 14);
  for (let y = 0; y < S; y++) {
    const dy = (y - cy) / m;
    for (let x = 0; x < S; x++) {
      const dx = (x - cx) / m;
      const dist = Math.hypot(dx, dy);
      const u = (x / S) * 6;
      const v = (y / S) * 6;
      const lf = nRough1(u, v) * 0.7 + nRough2(u * 2.1, v * 2.1) * 0.3;
      // subtle foot-traffic polish along the main circular walkway (r ≈ 2.6..3.6) and bow approach
      const walkway = Math.exp(-Math.pow((dist - 3.05) / 0.75, 2)) * 0.14;
      const roughVal = Math.max(0.25, Math.min(0.65, 0.27 + lf * 0.38 - walkway));
      const byte = Math.round(roughVal * 255);
      const idx = (y * S + x) * 4;
      rImg.data[idx] = byte;
      rImg.data[idx + 1] = byte;
      rImg.data[idx + 2] = byte;
      rImg.data[idx + 3] = 255;
    }
  }
  r.putImageData(rImg, 0, 0);

  // alternating panel tint by ring band
  const bands: [number, number, string][] = [
    [2.6, 3.55, '#c2cddb'],
    [3.55, 4.75, '#d5dde8'],
    [4.75, 5.8, '#bfcad8'],
    [5.8, R, '#c7d1df'],
  ];
  for (const [r0, r1, col] of bands) ringSeg(g, r0, r1, 0, 359.99, col);

  // blue striped carpet under the seats (both sides)
  for (const side of [1, -1]) {
    const a0 = side === 1 ? 38 : 210;
    const a1 = side === 1 ? 150 : 322;
    ringSeg(g, 3.6, 4.75, a0, a1, css(PAL.blueCarpet));
    ringSeg(r, 3.6, 4.75, a0, a1, '#d0d0d0');
    g.strokeStyle = 'rgba(120,170,255,0.55)';
    g.lineWidth = 2;
    for (let a = a0; a <= a1; a += 1.5) {
      g.beginPath();
      g.moveTo(cx + Math.cos(ca(a)) * 3.62 * m, cy + Math.sin(ca(a)) * 3.62 * m);
      g.lineTo(cx + Math.cos(ca(a)) * 4.73 * m, cy + Math.sin(ca(a)) * 4.73 * m);
      g.stroke();
    }
    ring(g, 3.6, 3, '#f6fafd');
  }
  // console footprints: darker plinth shadow
  for (const k of CONSOLES) ringSeg(g, CABIN.consoleInnerR - 0.12, CABIN.consoleOuterR + 0.1, k.a0 - 1, k.a1 + 1, '#8b9cb2');

  // seams: concentric + radial
  g.globalAlpha = 0.5;
  for (const rad of [2.6, 3.55, 4.75, 5.8, 6.6]) ring(g, rad, 2, '#8fa0b4');
  g.strokeStyle = '#8fa0b4';
  g.lineWidth = 2;
  for (let a = 0; a < 360; a += 15) {
    const r0 = a % 30 === 0 ? 2.6 : 3.55;
    g.beginPath();
    g.moveTo(cx + Math.cos(ca(a)) * r0 * m, cy + Math.sin(ca(a)) * r0 * m);
    g.lineTo(cx + Math.cos(ca(a)) * R * m, cy + Math.sin(ca(a)) * R * m);
    g.stroke();
  }
  g.globalAlpha = 1;

  // ── central platform ─────────────────────────────────────────────
  // outer grille ring (segmented dark vents)
  ringSeg(g, 1.75, 2.45, 0, 359.99, '#dbe4ee');
  for (let a = 0; a < 360; a += 30) {
    ringSeg(g, 1.85, 2.35, a + 3, a + 27, '#566579');
    ringSeg(r, 1.85, 2.35, a + 3, a + 27, '#b0b0b0');
    g.strokeStyle = '#2f3b4c';
    g.lineWidth = 1.5;
    for (let rr = 1.9; rr < 2.34; rr += 0.07) {
      g.beginPath();
      g.arc(cx, cy, rr * m, ca(a + 3), ca(a + 27), true);
      g.stroke();
    }
  }
  // glowing cyan ring between grille and platform
  for (const ctx of [g, e]) ring(ctx, 1.68, 5, css(PAL.cyan));
  ring(e, 1.68, 14, 'rgba(56,225,255,0.25)');
  // circuit disc
  ringSeg(g, 0.62, 1.55, 0, 359.99, '#17385c');
  ringSeg(r, 0.62, 1.55, 0, 359.99, '#303030');
  const rnd = mulberry32(5);
  for (const ctx of [g, e]) {
    ctx.strokeStyle = css(PAL.cyan);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * 360 + rnd() * 4;
      const r0 = 0.7 + rnd() * 0.25;
      const r1 = r0 + 0.2 + rnd() * 0.4;
      const a2 = a + (rnd() - 0.5) * 16;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ca(a)) * r0 * m, cy + Math.sin(ca(a)) * r0 * m);
      ctx.lineTo(cx + Math.cos(ca(a)) * r1 * m, cy + Math.sin(ca(a)) * r1 * m);
      ctx.arc(cx, cy, r1 * m, ca(a), ca(a2), a2 > a);
      ctx.lineTo(cx + Math.cos(ca(a2)) * Math.min(1.5, r1 + 0.25) * m, cy + Math.sin(ca(a2)) * Math.min(1.5, r1 + 0.25) * m);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + Math.cos(ca(a)) * r0 * m, cy + Math.sin(ca(a)) * r0 * m, 2.5, 0, 7);
      ctx.fillStyle = css(PAL.cyan);
      ctx.fill();
    }
    ring(ctx, 1.1, 1.5, 'rgba(56,225,255,0.7)');
  }
  ring(g, 1.55, 4, '#eef3f9');
  // hub
  ringSeg(g, 0, 0.62, 0, 359.99, '#dbe4ee');
  for (const ctx of [g, e]) ring(ctx, 0.45, 3, css(PAL.tealAccent));
  ring(g, 0.62, 3, '#9fb0c4');

  // approach chevrons toward the holo table (teal, tiny accent)
  for (const ctx of [g, e]) {
    ctx.fillStyle = css(PAL.tealAccent);
    for (let i = 0; i < 3; i++) {
      const y = cy - (2.75 + i * 0.28) * m;
      ctx.beginPath();
      ctx.moveTo(cx, y - 9);
      ctx.lineTo(cx + 11, y + 5);
      ctx.lineTo(cx - 11, y + 5);
      ctx.fill();
    }
  }
  // pedestal dais ring
  const pz = cy + CABIN.pedestal.z * m;
  g.beginPath();
  g.arc(cx, pz, 1.5 * m, 0, 7);
  g.fillStyle = '#bfcad8';
  g.fill();
  for (const ctx of [g, e]) {
    ctx.beginPath();
    ctx.arc(cx, pz, 1.42 * m, 0, 7);
    ctx.lineWidth = 4;
    ctx.strokeStyle = css(PAL.holoGreen);
    ctx.stroke();
  }

  const map = tex(c);
  const emissive = tex(ce);
  const rough = tex(cr, false);
  return { map, emissive, rough };
}

/** Console slanted screen: rows of cyan readout bars (used as map + emissiveMap) */
export function consoleScreenTexture(seed: number): THREE.Texture {
  const [c, g] = canvas(512, 128);
  const rnd = mulberry32(seed);
  g.fillStyle = '#0b2a52';
  g.fillRect(0, 0, 512, 128);
  for (let p = 0; p < 4; p++) {
    const x0 = 10 + p * 126;
    g.fillStyle = '#103a6e';
    g.fillRect(x0, 10, 114, 108);
    const kind = Math.floor(rnd() * 3);
    if (kind === 0) {
      for (let i = 0; i < 5; i++) {
        g.fillStyle = i % 2 ? css(PAL.cyan) : '#b8f4ff';
        g.fillRect(x0 + 10, 20 + i * 19, 30 + rnd() * 64, 11);
      }
    } else if (kind === 1) {
      g.strokeStyle = css(PAL.cyan);
      g.lineWidth = 3;
      g.beginPath();
      for (let i = 0; i <= 12; i++) g.lineTo(x0 + 8 + i * 8.2, 64 + Math.sin(i * 1.3 + rnd()) * 30 * rnd());
      g.stroke();
      g.fillStyle = css(PAL.tealAccent);
      g.fillRect(x0 + 10, 100, 94, 6);
    } else {
      g.strokeStyle = '#b8f4ff';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(x0 + 57, 64, 34, 0, 7);
      g.stroke();
      g.strokeStyle = css(PAL.cyan);
      g.beginPath();
      g.arc(x0 + 57, 64, 22, rnd() * 3, 3 + rnd() * 3);
      g.stroke();
      g.fillStyle = css(PAL.tealAccent);
      g.beginPath();
      g.arc(x0 + 57 + rnd() * 20 - 10, 64 + rnd() * 20 - 10, 5, 0, 7);
      g.fill();
    }
  }
  return tex(c);
}

/** soft radial blob — contact shadows, glows, flares */
export function radialTexture(stops: [number, string][], size = 128): THREE.Texture {
  const [c, g] = canvas(size, size);
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grd.addColorStop(o, col);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return tex(c);
}

/** sun flare: core glow + cross streaks + ring */
export function flareTexture(): THREE.Texture {
  const S = 512;
  const [c, g] = canvas(S, S);
  const h = S / 2;
  const grd = g.createRadialGradient(h, h, 0, h, h, h);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.08, 'rgba(255,246,214,0.95)');
  grd.addColorStop(0.2, 'rgba(255,214,140,0.45)');
  grd.addColorStop(0.5, 'rgba(255,170,90,0.12)');
  grd.addColorStop(1, 'rgba(255,150,80,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i++) {
    g.save();
    g.translate(h, h);
    g.rotate((i / 6) * Math.PI + 0.2);
    const len = i % 3 === 0 ? h : h * 0.6;
    const sg = g.createLinearGradient(-len, 0, len, 0);
    sg.addColorStop(0, 'rgba(255,230,180,0)');
    sg.addColorStop(0.5, 'rgba(255,250,235,0.8)');
    sg.addColorStop(1, 'rgba(255,230,180,0)');
    g.fillStyle = sg;
    g.scale(1, i % 3 === 0 ? 0.012 : 0.007);
    g.beginPath();
    g.arc(0, 0, len, 0, 7);
    g.fill();
    g.restore();
  }
  g.strokeStyle = 'rgba(255,220,170,0.12)';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(h, h, h * 0.62, 0, 7);
  g.stroke();
  return tex(c);
}

/** equirect planet albedo by recipe */
export function planetTexture(p: PlanetDef): THREE.Texture {
  if (p.kind === 'red-giant') return redGiantTexture(p);
  if (p.kind === 'binary') return binaryTexture(p);
  const isStorm = p.kind === 'gas-storm';
  const W = isStorm ? 1024 : 512;
  const H = isStorm ? 512 : 256;
  const [c, g] = canvas(W, H);
  const img = g.createImageData(W, H);
  const n = makeNoise(p.seed, 8);
  const n2 = makeNoise(p.seed + 100, 8);
  const nWarp1 = isStorm ? makeNoise(p.seed, 16) : n;
  const nWarp2 = isStorm ? makeNoise(p.seed + 17, 32) : n2;
  const nTurb = isStorm ? makeNoise(p.seed + 31, 64) : n2;
  const nWisp = isStorm ? makeNoise(p.seed + 53, 32) : n;
  const nMacro = isStorm ? makeNoise(p.seed + 71, 4) : n;
  const cols = p.colors.map((h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255]);
  const mix = (a: number[], b: number[], t: number): number[] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const ss = (a: number, b: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  for (let y = 0; y < H; y++) {
    const lat = y / H;
    const vNorm = 1 - lat;
    for (let x = 0; x < W; x++) {
      const uNorm = x / W;
      const u = uNorm * 8;
      const v = lat * 4;
      let rgb: number[];
      if (p.kind === 'gas') {
        const warp = n(u, v) * 0.9;
        const band = Math.sin((lat + warp * 0.08) * 34) * 0.5 + 0.5;
        const storm = ss(0.62, 0.8, n2(u * 0.7, v * 2.2));
        rgb = mix(mix(cols[0], cols[1], band), cols[2], Math.min(1, storm + ss(0.75, 1, band) * 0.5));
      } else if (p.kind === 'gas-storm') {
        const w1 = nWarp1(uNorm * 16, vNorm * 9.6) * 2 - 1;
        const w2 = nWarp2(uNorm * 32, vNorm * 21.2) * 2 - 1;
        const qv = vNorm + 0.045 * w1 + 0.02 * w2;
        const p1 = (nWarp1(uNorm * 16, vNorm * 6 + 3.1) - 0.5) * 1.8;
        const p2 = (nWarp2(uNorm * 32, vNorm * 11 + 7.4) - 0.5) * 2.2;
        const p3 = (nWisp(uNorm * 32, vNorm * 16 + 1.7) - 0.5) * 2.5;
        const p4 = (nTurb(uNorm * 64, vNorm * 22 + 5.3) - 0.5) * 2.8;
        const b1 = Math.sin(qv * Math.PI * 6.5 + p1);
        const b2 = Math.sin(qv * Math.PI * 14.0 + p2);
        const b3 = Math.sin(qv * Math.PI * 26.0 + p3);
        const b4 = Math.sin(qv * Math.PI * 44.0 + p4);
        const turb = (nTurb(uNorm * 64, vNorm * 28) * 2 - 1) * 0.055;
        const wisp = (nWisp(uNorm * 32 + b1 * 0.75, vNorm * 7.5) * 2 - 1) * 0.075;
        const bandVal = 0.60 + 0.14 * b1 + 0.11 * b2 + 0.065 * b3 + 0.045 * b4 + turb + wisp;
        rgb = mix(mix(cols[0], cols[1], ss(0.3, 0.62, bandVal)), cols[2], ss(0.62, 0.92, bandVal));
        const macro = 0.88 + 0.24 * nMacro(uNorm * 4, vNorm * 3);
        const fine = (nTurb(uNorm * 64 + 11, vNorm * 32 + 4) - 0.5) * 0.1;
        const lumaMul = macro * (1 + fine);
        rgb = [
          Math.max(0, Math.min(255, rgb[0] * lumaMul)),
          Math.max(0, Math.min(255, rgb[1] * lumaMul)),
          Math.max(0, Math.min(255, rgb[2] * lumaMul)),
        ];
        // darker polar hoods
        const pole = ss(0.33, 0.48, Math.abs(vNorm - 0.5) + w1 * 0.03);
        rgb = mix(rgb, [cols[0][0] * 0.68, cols[0][1] * 0.68, cols[0][2] * 0.68], pole * 0.72);
        // giant anticyclonic storm eye at u≈0.62, v≈0.42
        let du = uNorm - 0.62;
        du -= Math.round(du);
        const dv = vNorm - 0.42;
        const ex = du / 0.082;
        const ey = dv / 0.046;
        const er = Math.hypot(ex, ey);
        if (er < 1.4) {
          const ang = Math.atan2(ey, ex);
          const sn = nWisp(uNorm * 32, vNorm * 18);
          const sn2 = nTurb(uNorm * 64, vNorm * 28);
          const erW = er + (sn - 0.5) * 0.18 + (sn2 - 0.5) * 0.1;
          const spiral = 0.5 + 0.5 * Math.sin(3.0 * (ang + 2.2 * Math.log(er + 0.15)) + (sn - 0.5) * 3.8 + (sn2 - 0.5) * 2.2);
          const armMix = ss(0.2, 0.88, spiral * 0.68 + sn2 * 0.32) * ss(0.18, 0.45, er) * (1 - ss(0.75, 1.0, er));
          const swirlMid = mix([cols[0][0] * 0.92, cols[0][1] * 0.84, cols[0][2] * 0.78], cols[1], 0.74);
          const swirlCol = mix(swirlMid, cols[2], armMix * 0.56 + (sn - 0.5) * 0.12);
          const coreBoost = ss(0.35, 0.03, erW);
          const eyeInterior = mix(swirlCol, [252, 240, 218], coreBoost * 0.78);
          const bodyMask = 1 - ss(0.76, 1.08, erW);
          rgb = mix(rgb, eyeInterior, bodyMask);
          const ringMask = ss(0.75, 0.88, erW) * (1 - ss(0.95, 1.05, erW));
          const ringCol = [cols[0][0] * 0.56, cols[0][1] * 0.5, cols[0][2] * 0.46];
          rgb = mix(rgb, ringCol, ringMask * (0.68 + 0.18 * sn));
          const rimMask = ss(1.02, 1.07, erW) * (1 - ss(1.11, 1.15, erW));
          rgb = mix(rgb, cols[2], rimMask * (0.18 + 0.1 * sn));
        }
      } else if (p.kind === 'ocean') {
        const hgt = n(u, v);
        const land = ss(0.5, 0.56, hgt);
        const sea = mix(cols[0], [40, 120, 210], ss(0.3, 0.5, hgt));
        const ground = mix(cols[1], [190, 200, 120], ss(0.6, 0.78, hgt));
        rgb = mix(sea, ground, land);
        const cloud = ss(0.55, 0.75, n2(u * 1.3 + 3, v * 1.6));
        rgb = mix(rgb, cols[2], cloud * 0.85);
        const pole = ss(0.4, 0.47, Math.abs(lat - 0.5) + (hgt - 0.5) * 0.08);
        rgb = mix(rgb, [245, 250, 255], pole);
      } else if (p.kind === 'ice') {
        const hgt = n(u * 1.4, v * 1.4);
        const crack = Math.abs(n2(u * 2, v * 2) - 0.5) < 0.015 ? 1 : 0;
        rgb = mix(mix(cols[0], cols[1], ss(0.3, 0.6, hgt)), cols[2], ss(0.6, 0.8, hgt));
        rgb = mix(rgb, [70, 130, 200], crack * 0.7);
      } else if (p.kind === 'ice-ring') {
        // bright ice shell mottled blue-white
        const hgt = n(u * 1.6, v * 1.6);
        rgb = mix(mix(cols[0], cols[1], ss(0.3, 0.68, hgt)), cols[2], ss(0.62, 0.92, hgt));
        // fine polygonal cracks: jittered-grid voronoi, F2−F1 edge distance
        let f1 = 1e9;
        let f2 = 1e9;
        const ci = Math.floor(u / 0.5);
        const cj = Math.floor(v / 0.5);
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const ii = ci + di;
            const jj = cj + dj;
            const px = (ii + vhash(ii * 7, jj * 13)) * 0.5;
            const py = (jj + vhash(ii * 13, jj * 7)) * 0.5;
            let dx = u - px;
            dx -= Math.round(dx / 8) * 8; // u tiles with period 8
            const dy = v - py;
            const d = dx * dx + dy * dy;
            if (d < f1) {
              f2 = f1;
              f1 = d;
            } else if (d < f2) {
              f2 = d;
            }
          }
        }
        const crack = ss(0.045, 0.012, Math.sqrt(f2) - Math.sqrt(f1));
        rgb = mix(rgb, cols[0], crack * (0.25 + 0.45 * n2(u * 3, v * 3)));
        // polar caps: brighter, bluer
        const cap = ss(0.3, 0.42, Math.abs(lat - 0.5) + (hgt - 0.5) * 0.06);
        rgb = mix(rgb, [248, 252, 255], cap);
      } else {
        const hgt = n(u * 1.2, v * 1.2);
        const vein = 1 - ss(0, 0.05, Math.abs(n2(u * 1.6, v * 1.6) - 0.5));
        rgb = mix(mix(cols[0], [90, 40, 40], ss(0.4, 0.7, hgt)), cols[1], vein * 0.9);
        rgb = mix(rgb, cols[2], ss(0.6, 1, vein));
      }
      const i = (y * W + x) * 4;
      img.data[i] = rgb[0];
      img.data[i + 1] = rgb[1];
      img.data[i + 2] = rgb[2];
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = tex(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** equirect red-giant photosphere: multi-scale Voronoi convection granules
 *  (coarse + 3.3x finer cells) with crisp dark intergranular lanes, 16 bright
 *  flare cores (~#fff2d0), and slight polar darkening / equatorial brightening. */
export function redGiantTexture(p: PlanetDef): THREE.Texture {
  const W = 1024;
  const H = 512;
  const [c, g] = canvas(W, H);
  const img = g.createImageData(W, H);
  const rnd = mulberry32(p.seed + 211);

  const nWarp = makeNoise(p.seed + 11, 16);
  const nFbm = makeNoise(p.seed + 37, 32);
  const nMacro = makeNoise(p.seed + 73, 8);

  const cols = p.colors.map((h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255]);
  const trenchCol = [cols[0][0] * 0.42, cols[0][1] * 0.34, cols[0][2] * 0.3];
  const hotMidCol = [255, 164, 58];
  const mix = (a: number[], b: number[], t: number): number[] => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
  const ss = (a: number, b: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  // Precompute jittered Voronoi cell centers for two scales (12x6 and 40x20 -> 3.33x ratio)
  const makeGrid = (nx: number, ny: number, salt: number): { px: Float32Array; py: Float32Array; nx: number; ny: number } => {
    const px = new Float32Array(nx * ny);
    const py = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const idx = j * nx + i;
        px[idx] = i + 0.14 + 0.72 * vhash(i * 19 + salt, j * 31 + salt);
        py[idx] = j + 0.14 + 0.72 * vhash(i * 37 + salt, j * 17 + salt);
      }
    }
    return { px, py, nx, ny };
  };
  const gCoarse = makeGrid(12, 6, p.seed * 3 + 7);
  const gFine = makeGrid(40, 20, p.seed * 7 + 59);

  // Tileable-in-x Voronoi returning (F2 - F1) edge distance and F1 cell center distance
  const voronoi = (
    u: number,
    v: number,
    grid: { px: Float32Array; py: Float32Array; nx: number; ny: number },
  ): [number, number] => {
    const { px, py, nx, ny } = grid;
    const gx = ((u % 1) + 1) % 1 * nx;
    const gy = Math.max(0.001, Math.min(ny - 0.001, v * ny));
    const ci = Math.floor(gx);
    const cj = Math.floor(gy);
    let f1 = 1e9;
    let f2 = 1e9;
    for (let dj = -1; dj <= 1; dj++) {
      const jj = cj + dj;
      if (jj < 0 || jj >= ny) continue;
      for (let di = -1; di <= 1; di++) {
        const ii = ((ci + di) % nx + nx) % nx;
        const idx = jj * nx + ii;
        let dx = gx - px[idx];
        if (dx > nx * 0.5) dx -= nx;
        else if (dx < -nx * 0.5) dx += nx;
        const dy = gy - py[idx];
        const d = dx * dx + dy * dy;
        if (d < f1) {
          f2 = f1;
          f1 = d;
        } else if (d < f2) {
          f2 = d;
        }
      }
    }
    const r1 = Math.sqrt(f1);
    const r2 = Math.sqrt(f2);
    return [r2 - r1, r1];
  };

  // 16 bright active flare cores (concentrated in mid/equatorial belt)
  const flares: { u: number; v: number; ru: number; rv: number; gain: number }[] = [];
  for (let i = 0; i < 16; i++) {
    flares.push({
      u: rnd(),
      v: 0.18 + rnd() * 0.64,
      ru: 0.015 + rnd() * 0.016,
      rv: 0.012 + rnd() * 0.014,
      gain: 0.72 + rnd() * 0.28,
    });
  }

  for (let y = 0; y < H; y++) {
    const lat = (y + 0.5) / H;
    const eq = Math.sin(lat * Math.PI); // 0 at poles, 1 at equator
    const latMul = 0.74 + 0.32 * Math.pow(eq, 0.65);

    for (let x = 0; x < W; x++) {
      const uNorm = (x + 0.5) / W;
      // organic domain warp so intergranular lanes bend like boiling plasma
      const wx = (nWarp(uNorm * 16, lat * 8) - 0.5) * 0.042;
      const wy = (nWarp(uNorm * 16 + 5.3, lat * 8 + 2.7) - 0.5) * 0.038;
      const uW = uNorm + wx;
      const vW = Math.max(0.002, Math.min(0.998, lat + wy));

      const [edge1, r1] = voronoi(uW, vW, gCoarse);
      const [edge2] = voronoi(uW + wx * 0.4, Math.max(0.002, Math.min(0.998, vW + wy * 0.4)), gFine);

      const fbm = nFbm(uNorm * 32, lat * 16);
      const macro = nMacro(uNorm * 8, lat * 4);

      // crisp dark intergranular lanes: coarse super-granules + fine secondary granules
      const lane1 = ss(0.025, 0.23, edge1 + (fbm - 0.5) * 0.055);
      const lane2 = ss(0.03, 0.22, edge2 + (fbm - 0.5) * 0.04);
      const cellBody = lane1 * (0.52 + 0.48 * lane2);
      const cellDome = ss(0.58, 0.08, r1) * lane1;

      let heat = cellBody * (0.64 + 0.24 * fbm + 0.14 * macro) + cellDome * 0.22;
      heat = Math.max(0, Math.min(1, heat));

      // 4-stop thermal ramp: deep ember trench -> rust red -> vivid orange -> hot golden-cream
      let rgb: number[];
      if (heat < 0.26) {
        rgb = mix(trenchCol, cols[0], ss(0.0, 0.26, heat));
      } else if (heat < 0.66) {
        rgb = mix(cols[0], cols[1], ss(0.26, 0.66, heat));
      } else if (heat < 0.88) {
        rgb = mix(cols[1], hotMidCol, ss(0.66, 0.88, heat));
      } else {
        rgb = mix(hotMidCol, cols[2], ss(0.88, 1.0, heat) * 0.65);
      }

      // bright flare cores (faculae / active regions approaching #fff2d0)
      let flare = 0;
      for (let k = 0; k < flares.length; k++) {
        const fl = flares[k];
        let du = uNorm - fl.u;
        du -= Math.round(du);
        const dv = lat - fl.v;
        const d2 = (du * du) / (fl.ru * fl.ru) + (dv * dv) / (fl.rv * fl.rv);
        if (d2 < 3.6) {
          const d = Math.sqrt(d2) + (fbm - 0.5) * 0.35;
          const spot = ss(1.45, 0.12, d) * fl.gain;
          if (spot > flare) flare = spot;
        }
      }
      if (flare > 0.001) {
        rgb = mix(rgb, hotMidCol, Math.min(1, flare * 0.65));
        rgb = mix(rgb, cols[2], ss(0.22, 0.92, flare) * 0.95);
      }

      // slightly darker poles, slightly brighter equator
      const i = (y * W + x) * 4;
      img.data[i] = Math.min(255, rgb[0] * latMul);
      img.data[i + 1] = Math.min(255, rgb[1] * latMul);
      img.data[i + 2] = Math.min(255, rgb[2] * latMul);
      img.data[i + 3] = 255;
    }
  }

  g.putImageData(img, 0, 0);
  const t = tex(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** equirect binary-system planet albedo (1024x512, zero external assets):
 *  cool-blue / warm-orange dual hemispheres divided by a luminous twilight
 *  cloud belt, high-frequency cloud tufts + fine filamentary cirrus streaks,
 *  subtly darkened polar hoods, and twin sub-stellar glare spots (cool & warm). */
export function binaryTexture(p: PlanetDef): THREE.Texture {
  const W = 1024;
  const H = 512;
  const [c, g] = canvas(W, H);
  const img = g.createImageData(W, H);

  const nWarp = makeNoise(p.seed + 5, 8);
  const nMid = makeNoise(p.seed + 19, 16);
  const nCirrus = makeNoise(p.seed + 43, 32);
  const nTuft = makeNoise(p.seed + 71, 64);
  const nFine = makeNoise(p.seed + 107, 64);

  const cols = p.colors.map((h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255]);
  const coolDeep = [22, 62, 132];
  const coolMid = cols[0];
  const coolHigh = [158, 214, 255];
  const coolSpotCol = [234, 248, 255];
  const warmDeep = [104, 42, 18];
  const warmMid = cols[1];
  const warmHigh = [255, 204, 140];
  const warmSpotCol = [255, 238, 202];
  const twilightCool = [212, 240, 255];
  const twilightWarm = [255, 232, 198];

  const mix = (a: number[], b: number[], t: number): number[] => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
  const ss = (a: number, b: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  // Tilted dipole axis separating cool hemisphere (+1) and warm hemisphere (-1)
  const ax = 0.963;
  const ay = 0.27;

  for (let y = 0; y < H; y++) {
    const lat = (y + 0.5) / H;
    const theta = lat * Math.PI;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    const latOff = Math.abs(lat - 0.5);

    for (let x = 0; x < W; x++) {
      const uNorm = (x + 0.5) / W;
      const phi = uNorm * Math.PI * 2;
      // Spherical unit vector (matches Three.js SphereGeometry: u=0 -> -X, u=0.5 -> +X)
      const sx = Math.cos(phi) * sinT;
      const sy = cosT;

      // Multi-scale atmospheric domain warp
      const w1 = nWarp(uNorm * 8, lat * 4) - 0.5;
      const w2 = nMid(uNorm * 16 + w1 * 1.4, lat * 8 + w1 * 0.9) - 0.5;
      const shear = Math.sin(lat * Math.PI * 5 + w1 * 4.2) * 0.032;

      // High-frequency cloud tufts + fine filamentary cirrus streaks
      const deck = nMid(uNorm * 16 + shear * 8, lat * 12 + w1 * 1.1);
      const tuft = nTuft(uNorm * 64 + w2 * 3.2, lat * 32 + w1 * 2.0);
      const fine = nFine(uNorm * 64 + 13.7 + shear * 24, lat * 44 + 7.1 + w2 * 2.5);
      const r1 = 1 - Math.abs(nCirrus(uNorm * 32 + shear * 18 + w1 * 2.2, lat * 26 + w2 * 1.6) * 2 - 1);
      const r2 = 1 - Math.abs(nFine(uNorm * 64 - shear * 16 + w2 * 3.0, lat * 52 - w1 * 2.4) * 2 - 1);
      const cirrus = Math.pow(r1, 2.5) * 0.62 + Math.pow(r2, 3.0) * 0.48;
      const tuftMask = ss(0.42, 0.78, tuft * 0.68 + fine * 0.32);

      // Hemisphere coordinate (+1 cool side, -1 warm side) warped organically by winds
      const dipole = sx * ax + sy * ay;
      const hemi = dipole + w1 * 0.24 + w2 * 0.11 + (tuft - 0.5) * 0.06;
      const coolFrac = ss(-0.22, 0.22, hemi);

      // Cool hemisphere cloud palette (non-uniform mottled deck + tufts + cirrus)
      const coolBase = mix(coolDeep, coolMid, ss(0.22, 0.76, deck * 0.72 + tuft * 0.28));
      let coolRgb = mix(coolBase, coolHigh, Math.min(1, tuftMask * 0.52 + cirrus * 0.58));

      // Warm hemisphere cloud palette
      const warmBase = mix(warmDeep, warmMid, ss(0.22, 0.76, deck * 0.72 + fine * 0.28));
      let warmRgb = mix(warmBase, warmHigh, Math.min(1, tuftMask * 0.5 + cirrus * 0.56));

      // Combine hemispheres
      let rgb = mix(warmRgb, coolRgb, coolFrac);

      // Luminous twilight dividing band along hemi ≈ 0 (textured with swirling cirrus)
      const twiBand = Math.exp(-(hemi * hemi) / (0.135 * 0.135));
      const twiCol = mix(twilightWarm, twilightCool, ss(-0.14, 0.14, hemi));
      const twiStrength = twiBand * (0.46 + 0.42 * cirrus + 0.22 * tuftMask);
      rgb = mix(rgb, twiCol, Math.min(0.90, twiStrength));

      // 3 flanking fine cirrus cloud bands on each side of the twilight belt
      const absH = Math.abs(hemi);
      const flank1 = Math.exp(-Math.pow((absH - 0.18 + shear * 0.9) / 0.032, 2));
      const flank2 = Math.exp(-Math.pow((absH - 0.34 - shear * 1.1) / 0.036, 2));
      const flank3 = Math.exp(-Math.pow((absH - 0.51 + shear * 0.8) / 0.042, 2));
      const flankStr = Math.min(1, (flank1 * 0.85 + flank2 * 0.72 + flank3 * 0.58) * (0.42 + 0.58 * cirrus));
      const flankCol = hemi >= 0 ? [216, 240, 255] : [255, 224, 184];
      rgb = mix(rgb, flankCol, flankStr * 0.62);

      // Fine bright cirrus wisps overlaid across both hemispheres
      const wispBoost = ss(0.45, 0.92, cirrus) * (0.28 + 0.34 * tuftMask);
      rgb = mix(rgb, cols[2], Math.min(0.68, wispBoost));

      // Twin sub-stellar direct-illumination highlight spots (one cool, one warm)
      const coolSpot = ss(0.72, 0.985, dipole + (cirrus - 0.5) * 0.08 + (tuft - 0.5) * 0.05);
      if (coolSpot > 0.001) {
        rgb = mix(rgb, coolSpotCol, coolSpot * (0.62 + 0.26 * tuftMask));
        rgb = mix(rgb, [255, 255, 255], ss(0.55, 1.0, coolSpot) * 0.45);
      }
      const warmSpot = ss(0.72, 0.985, -dipole + (cirrus - 0.5) * 0.08 + (fine - 0.5) * 0.05);
      if (warmSpot > 0.001) {
        rgb = mix(rgb, warmSpotCol, warmSpot * (0.62 + 0.26 * tuftMask));
        rgb = mix(rgb, [255, 248, 232], ss(0.55, 1.0, warmSpot) * 0.42);
      }

      // Slightly darker polar hoods
      const pole = ss(0.31, 0.49, latOff + w1 * 0.05);
      const poleMul = 1 - 0.34 * pole;
      const i = (y * W + x) * 4;
      img.data[i] = Math.max(0, Math.min(255, rgb[0] * poleMul));
      img.data[i + 1] = Math.max(0, Math.min(255, rgb[1] * poleMul));
      img.data[i + 2] = Math.max(0, Math.min(255, rgb[2] * poleMul));
      img.data[i + 3] = 255;
    }
  }

  g.putImageData(img, 0, 0);
  const t = tex(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** grey rock albedo for the asteroid belt */
export function rockTexture(): THREE.Texture {
  const [c, g] = canvas(128, 128);
  const img = g.createImageData(128, 128);
  const n = makeNoise(77, 8);
  for (let i = 0; i < 128 * 128; i++) {
    const v = 110 + n((i % 128) / 16, Math.floor(i / 128) / 16) * 130;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v * 0.95;
    img.data[i * 4 + 2] = v * 0.92;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return tex(c);
}

/** 1024×512 polar-strip black-hole accretion disk texture (u = azimuth [0,1) tileable,
 *  v = normalized radius 0 inner → 1 outer): fine radial shear lanes + logarithmic
 *  spiral filaments + fbm plasma turbulence + incandescent inner → deep crimson-violet outer fade. */
export function blackholeDiskTexture(seed = 113): THREE.Texture {
  const W = 1024;
  const H = 512;
  const [c, g] = canvas(W, H);
  const img = g.createImageData(W, H);

  const nWarp = makeNoise(seed + 7, 16);
  const nTurb = makeNoise(seed + 29, 32);
  const nFine = makeNoise(seed + 61, 64);
  const nRad = makeNoise(seed + 97, 8);

  const ss = (a: number, b: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const mix3 = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];

  const colHot: [number, number, number] = [244, 249, 255];
  const colGold: [number, number, number] = [255, 206, 132];
  const colAmber: [number, number, number] = [238, 118, 48];
  const colCrimson: [number, number, number] = [164, 48, 46];
  const colViolet: [number, number, number] = [96, 44, 136];

  for (let y = 0; y < H; y++) {
    // v = 0 at inner edge (bottom of canvas, UV v=0), v = 1 at outer edge (top, UV v=1)
    const v = 1 - (y + 0.5) / H;
    const innerFade = ss(0.0, 0.075, v);
    const outerFade = 1 - ss(0.72, 1.0, v);
    const radialEnv = innerFade * outerFade;

    // fine concentric Keplerian shear tracks (purely radial backbone)
    const rN1 = nRad(2.3, v * 10.0);
    const rN2 = nRad(5.7, v * 26.0);
    const laneFine =
      0.52 +
      0.24 * Math.sin(v * 34.0 + rN1 * 4.5) +
      0.16 * Math.sin(v * 82.0 + rN2 * 5.2) +
      0.10 * Math.sin(v * 165.0 - rN1 * 6.0);

    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      const w1 = nWarp(u * 16, v * 12) - 0.5;
      const turb = nTurb(u * 32 + w1 * 2.2, v * 24 + w1 * 1.4);
      const fine = nFine(u * 64 - w1 * 3.0, v * 48 + turb * 1.8);

      // logarithmic spiral plasma arms (primary 4-arm + secondary 7-arm)
      const logR = Math.log(v + 0.13);
      const phi1 = u * Math.PI * 2 * 4 + 10.5 * logR + w1 * 3.2;
      const phi2 = u * Math.PI * 2 * 7 + 16.0 * logR - turb * 3.4;
      const sp1 = Math.pow(0.5 + 0.5 * Math.sin(phi1), 2.1);
      const sp2 = Math.pow(0.5 + 0.5 * Math.sin(phi2), 2.8);
      const spiral = sp1 * 0.65 + sp2 * 0.45;

      // combine radial shear lanes + logarithmic spirals + plasma clumps
      const streak = Math.max(0.08, laneFine) * (0.48 + 0.72 * spiral) * (0.62 + 0.55 * turb) * (0.78 + 0.34 * fine);
      // extra incandescent hot ridge near ISCO inner edge
      const innerRidge = Math.exp(-Math.pow((v - 0.11) / 0.09, 2)) * (0.75 + 0.45 * fine);
      const energy = Math.min(1.35, (streak * 0.92 + innerRidge * 0.65) * radialEnv);

      // temperature color ramp along radius (inner white-hot -> gold -> amber -> crimson -> violet outer mist)
      let rgb: [number, number, number];
      if (v < 0.18) {
        rgb = mix3(colHot, colGold, ss(0.02, 0.18, v));
      } else if (v < 0.48) {
        rgb = mix3(colGold, colAmber, ss(0.18, 0.48, v));
      } else if (v < 0.78) {
        rgb = mix3(colAmber, colCrimson, ss(0.48, 0.78, v));
      } else {
        rgb = mix3(colCrimson, colViolet, ss(0.78, 0.98, v));
      }
      // push hot spiral crests brighter toward white-gold
      const crest = ss(0.55, 1.08, energy);
      rgb = mix3(rgb, colHot, crest * 0.48);

      const intensity = Math.min(1, energy);
      const idx = (y * W + x) * 4;
      img.data[idx] = Math.min(255, rgb[0] * intensity);
      img.data[idx + 1] = Math.min(255, rgb[1] * intensity);
      img.data[idx + 2] = Math.min(255, rgb[2] * intensity);
      img.data[idx + 3] = Math.min(255, Math.round(intensity * 255));
    }
  }

  g.putImageData(img, 0, 0);
  const t = tex(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** 512×512 polar-strip gravitationally lensed starlight & nebula arc texture
 *  (u = angle around Einstein ring, v = radial 1.15R → 1.60R). */
export function blackholeLensTexture(seed = 131): THREE.Texture {
  const W = 512;
  const H = 512;
  const [c, g] = canvas(W, H);
  const img = g.createImageData(W, H);
  const nNeb1 = makeNoise(seed + 3, 8);
  const nNeb2 = makeNoise(seed + 41, 16);
  const rnd = mulberry32(seed + 83);

  const ss = (a: number, b: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  // base tangentially sheared cosmic nebula wisps (deep cyan-blue & violet)
  for (let y = 0; y < H; y++) {
    const v = 1 - (y + 0.5) / H;
    const radEnv = ss(0.0, 0.16, v) * (1 - ss(0.72, 1.0, v));
    // peak brightness near the Einstein ring (~v=0.22..0.48)
    const einstein = Math.exp(-Math.pow((v - 0.30) / 0.24, 2));
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      // stretched strongly along u (tangential) and finely striated along v (radial)
      const w = nNeb1(u * 8, v * 14);
      const w2 = nNeb2(u * 16 + w * 1.4, v * 30);
      const wisp = Math.pow(ss(0.28, 0.88, w * 0.55 + w2 * 0.45), 1.45);
      const str = (0.18 + 0.82 * wisp) * (0.42 + 0.58 * einstein) * radEnv;
      const r = (92 + 110 * w2) * str;
      const gr = (132 + 95 * w) * str;
      const b = (225 + 30 * w2) * str;
      const idx = (y * W + x) * 4;
      img.data[idx] = Math.min(255, r);
      img.data[idx + 1] = Math.min(255, gr);
      img.data[idx + 2] = Math.min(255, b);
      img.data[idx + 3] = Math.min(255, Math.round(str * 255));
    }
  }
  g.putImageData(img, 0, 0);

  // overlay curved/stretched background starlight arcs along tangential streaks
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 34; i++) {
    const u0 = rnd();
    const vPos = 0.12 + rnd() * 0.68;
    const yPx = (1 - vPos) * H;
    const spanPx = (28 + rnd() * 96) * (1.2 - vPos * 0.6); // stronger tangential stretch closer to horizon
    const thick = 1.2 + rnd() * 2.6;
    const huePick = rnd();
    const col =
      huePick < 0.45
        ? 'rgba(182, 224, 255, 0.88)'
        : huePick < 0.78
          ? 'rgba(216, 186, 255, 0.82)'
          : 'rgba(255, 232, 198, 0.78)';
    for (const shift of [-W, 0, W]) {
      const cx = u0 * W + shift;
      const grd = g.createLinearGradient(cx - spanPx * 0.5, yPx, cx + spanPx * 0.5, yPx);
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(0.5, col);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(cx - spanPx * 0.5, yPx - thick * 0.5, spanPx, thick);
    }
  }

  const t = tex(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Tileable dark metallic hull plating for artificial structures (ring-city main/inner rings). */
export function ringCityHullTexture(seed = 131): THREE.Texture {
  const W = 512;
  const H = 256;
  const [c, g] = canvas(W, H);
  const rnd = mulberry32(seed + 11);

  // dark slate-steel base
  g.fillStyle = '#242e3d';
  g.fillRect(0, 0, W, H);

  // ordered architectural hull plates (no organic clouds)
  const cols = 16;
  const rows = 8;
  const pw = W / cols;
  const ph = H / rows;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const shade = 26 + Math.floor(rnd() * 20);
      g.fillStyle = `rgb(${shade}, ${shade + 8}, ${shade + 18})`;
      g.fillRect(k * pw + 1, r * ph + 1, pw - 2, ph - 2);
      // subtle inner structural recess on alternating plates
      if ((r + k) % 3 === 0) {
        g.fillStyle = 'rgba(10, 14, 22, 0.35)';
        g.fillRect(k * pw + 4, r * ph + 5, pw - 8, ph - 10);
      }
      // crisp metallic highlight bevel along top edge
      g.fillStyle = 'rgba(165, 195, 228, 0.14)';
      g.fillRect(k * pw + 1, r * ph + 1, pw - 2, 1.5);
    }
  }

  // expansion joint grid seams
  g.strokeStyle = 'rgba(8, 12, 18, 0.72)';
  g.lineWidth = 2;
  for (let k = 0; k <= cols; k++) {
    g.beginPath();
    g.moveTo(k * pw, 0);
    g.lineTo(k * pw, H);
    g.stroke();
  }
  for (let r = 0; r <= rows; r++) {
    g.beginPath();
    g.moveTo(0, r * ph);
    g.lineTo(W, r * ph);
    g.stroke();
  }

  // fine longitudinal brushed metal streaks
  g.fillStyle = 'rgba(180, 210, 240, 0.05)';
  for (let i = 0; i < 60; i++) {
    g.fillRect(0, Math.floor(rnd() * H), W, 1);
  }

  const t = tex(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 1);
  return t;
}

/** Low-albedo paneled reactor core texture for ring-city central sphere. */
export function ringCityCoreTexture(seed = 131): THREE.Texture {
  const W = 512;
  const H = 256;
  const [c, g] = canvas(W, H);
  const rnd = mulberry32(seed + 47);

  g.fillStyle = '#141b26';
  g.fillRect(0, 0, W, H);

  // armored meridian & latitude ribs
  const cols = 24;
  const rows = 10;
  const pw = W / cols;
  const ph = H / rows;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const v = 16 + Math.floor(rnd() * 14);
      g.fillStyle = `rgb(${v}, ${v + 5}, ${v + 12})`;
      g.fillRect(k * pw + 1, r * ph + 1, pw - 2, ph - 2);
    }
  }
  g.strokeStyle = 'rgba(6, 10, 16, 0.8)';
  g.lineWidth = 1.5;
  for (let k = 0; k <= cols; k++) {
    g.beginPath();
    g.moveTo(k * pw, 0);
    g.lineTo(k * pw, H);
    g.stroke();
  }
  for (let r = 0; r <= rows; r++) {
    g.beginPath();
    g.moveTo(0, r * ph);
    g.lineTo(W, r * ph);
    g.stroke();
  }

  // dark equatorial recessed band where the blue core ring sits
  g.fillStyle = '#0b1018';
  g.fillRect(0, H * 0.44, W, H * 0.12);

  const t = tex(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
