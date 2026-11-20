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
  g.fillStyle = '#e9eff5';
  g.fillRect(0, 0, S, S);
  e.fillStyle = '#000';
  e.fillRect(0, 0, S, S);
  r.fillStyle = '#5a5a5a'; // roughness ~0.35 (glossy tile)
  r.fillRect(0, 0, S, S);

  // alternating panel tint by ring band
  const bands: [number, number, string][] = [
    [2.6, 3.55, '#dfe7ef'],
    [3.55, 4.75, '#eef3f8'],
    [4.75, 5.8, '#d5dee8'],
    [5.8, R, '#e4ebf2'],
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
  for (const k of CONSOLES) ringSeg(g, CABIN.consoleInnerR - 0.12, CABIN.consoleOuterR + 0.1, k.a0 - 1, k.a1 + 1, '#9fb0c4');

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
  ringSeg(g, 1.75, 2.45, 0, 359.99, '#f4f8fb');
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
  ring(g, 1.55, 4, '#f6fafd');
  // hub
  ringSeg(g, 0, 0.62, 0, 359.99, '#f4f8fb');
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
  g.fillStyle = '#d5dee8';
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
  const W = 512;
  const H = 256;
  const [c, g] = canvas(W, H);
  const img = g.createImageData(W, H);
  const n = makeNoise(p.seed, 8);
  const n2 = makeNoise(p.seed + 100, 8);
  const cols = p.colors.map((h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255]);
  const mix = (a: number[], b: number[], t: number): number[] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const ss = (a: number, b: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  for (let y = 0; y < H; y++) {
    const lat = y / H;
    for (let x = 0; x < W; x++) {
      const u = (x / W) * 8;
      const v = lat * 4;
      let rgb: number[];
      if (p.kind === 'gas') {
        const warp = n(u, v) * 0.9;
        const band = Math.sin((lat + warp * 0.08) * 34) * 0.5 + 0.5;
        const storm = ss(0.62, 0.8, n2(u * 0.7, v * 2.2));
        rgb = mix(mix(cols[0], cols[1], band), cols[2], Math.min(1, storm + ss(0.75, 1, band) * 0.5));
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
