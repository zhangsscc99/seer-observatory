// Modular 5-step stone stairway (`stair-module`) — 5 crisp masonry treads per
// unit with overhanging lips and flanking stepped cheek walls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyVerticalAO, getOceanMaterials, normalizeForMerge } from './materials.ts';

export interface StairOpts {
  width: number;
  length: number;
  steps?: number;
  yStart: number;
  yEnd: number;
}

export function createStairModule(opts: StairOpts): THREE.Mesh {
  const mats = getOceanMaterials();
  const W = opts.width;
  const L = opts.length;
  const N = opts.steps ?? 5;
  const baseY = Math.min(opts.yStart, opts.yEnd);
  const rise = Math.abs(opts.yEnd - opts.yStart);
  const ascending = opts.yEnd >= opts.yStart;
  const treadLen = L / N;
  const stepRise = rise / N;

  const parts: THREE.BufferGeometry[] = [];

  for (let i = 0; i < N; i++) {
    // Step index 0..N-1 from local z = -L/2 to +L/2, centered closely on the linear ramp envelope
    const stepIdx = ascending ? i : N - 1 - i;
    const frac = Math.min(1, (stepIdx + 0.72) / N);
    const stepTop = frac * rise;
    const h = Math.max(0.24, stepTop + 0.32);
    const cz = -L * 0.5 + (i + 0.5) * treadLen;

    // Solid masonry step block resting cleanly into foundation
    const step = new THREE.BoxGeometry(W, h, treadLen + 0.08);
    step.translate(0, stepTop - h * 0.5, cz);
    parts.push(step);

    // Subtle bullnose tread lip
    const lip = new THREE.BoxGeometry(W + 0.06, 0.08, treadLen + 0.12);
    lip.translate(0, stepTop - 0.04, cz);
    parts.push(lip);

    // Stepped cheek wall blocks on left and right sides
    for (const sx of [-1, 1]) {
      const curbH = stepTop + 0.52;
      const curb = new THREE.BoxGeometry(0.38, curbH, treadLen + 0.1);
      curb.translate(sx * (W * 0.5 + 0.2), curbH * 0.5 - 0.08, cz);
      parts.push(curb);
    }
  }

  // Smooth sloped foundation belly underneath steps so stair underside never shows gaps
  const belly = new THREE.BoxGeometry(W + 0.72, 0.36, L + 0.24);
  belly.translate(0, 0.14, 0);
  parts.push(belly);

  const merged = mergeGeometries(
    parts.map((p) => {
      const n = normalizeForMerge(p);
      p.dispose();
      return n;
    }),
    false,
  )!;
  applyVerticalAO(merged, 0, Math.max(0.5, rise + 0.55), new THREE.Color(0x5e7d82), new THREE.Color(0xeeeadd));
  void baseY;
  return new THREE.Mesh(merged, mats.paving);
}
