// Modular ruin archway — 2 span variants ('wide' 6.4m, 'narrow' 3.6m), mirrorable.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyVerticalAO, getOceanMaterials, normalizeForMerge } from './materials.ts';

export type ArchVariant = 'wide' | 'narrow';

const cachedGeos = new Map<ArchVariant, THREE.BufferGeometry>();

function buildArchGeo(variant: ArchVariant): THREE.BufferGeometry {
  const span = variant === 'wide' ? 6.4 : 3.6;
  const height = variant === 'wide' ? 7.2 : 5.2;
  const pierW = variant === 'wide' ? 1.1 : 0.85;
  const depth = variant === 'wide' ? 1.55 : 1.25;
  const halfSpan = span * 0.5;
  const outerW = halfSpan + pierW;
  const springY = height - halfSpan - 1.05;

  const parts: THREE.BufferGeometry[] = [];

  // Main semicircular carved stone arch wall
  const shape = new THREE.Shape();
  shape.moveTo(-outerW, 0);
  shape.lineTo(-outerW, height - 0.35);
  // Asymmetric weathered ruin roofline (makes mirror: true visually distinct!)
  shape.lineTo(-outerW * 0.45, height);
  shape.lineTo(outerW * 0.35, height - 0.12);
  shape.lineTo(outerW * 0.82, height - 0.55);
  shape.lineTo(outerW, height - 0.7);
  shape.lineTo(outerW, 0);
  shape.lineTo(halfSpan, 0);
  shape.lineTo(halfSpan, springY);
  shape.absarc(0, springY, halfSpan, 0, Math.PI, false);
  shape.lineTo(-halfSpan, 0);
  shape.closePath();

  const body = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 14 });
  body.translate(0, 0, -depth * 0.5);
  parts.push(body);

  // Moulded plinth bases + impost capitals on both piers
  for (const sx of [-1, 1]) {
    const px = sx * (halfSpan + pierW * 0.5);
    const plinth = new THREE.BoxGeometry(pierW + 0.36, 0.55, depth + 0.36);
    plinth.translate(px, 0.275, 0);
    parts.push(plinth);

    const impost = new THREE.BoxGeometry(pierW + 0.3, 0.32, depth + 0.3);
    impost.translate(px, springY, 0);
    parts.push(impost);
  }

  // Projecting keystone at arch apex
  const keystone = new THREE.BoxGeometry(0.68, 0.95, depth + 0.34);
  keystone.translate(0, springY + halfSpan + 0.32, 0);
  parts.push(keystone);

  // Partial broken entablature cornice on left-of-center
  const cornice = new THREE.BoxGeometry(outerW * 1.48, 0.38, depth + 0.44);
  cornice.translate(-outerW * 0.18, height - 0.15, 0);
  parts.push(cornice);

  const merged = mergeGeometries(
    parts.map((p) => {
      const n = normalizeForMerge(p);
      p.dispose();
      return n;
    }),
    false,
  )!;
  applyVerticalAO(merged, 0, height, new THREE.Color(0x5d7a80), new THREE.Color(0xe5ebe0));
  return merged;
}

export function createArchModule(variant: ArchVariant, mirror = false): THREE.Mesh {
  let geo = cachedGeos.get(variant);
  if (!geo) {
    geo = buildArchGeo(variant);
    cachedGeos.set(variant, geo);
  }
  const mesh = new THREE.Mesh(geo, getOceanMaterials().limestone);
  if (mirror) mesh.scale.x = -1;
  return mesh;
}
