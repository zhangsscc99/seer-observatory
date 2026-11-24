// Stackable giant bone-limestone spire module (3 segments):
//   'base'     — terraced buttressed monolith plinth with carved relief panels
//   'mid-arch' — true open walkthrough stone archway (floor at local y = 0, clear 4.3m × 5.6m)
//   'tip'      — dramatic canted jagged bone-limestone pinnacle leaning inward
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyVerticalAO, getOceanMaterials, normalizeForMerge } from './materials.ts';

export type SpireVariant = 'base' | 'mid-arch' | 'tip';

function displaceSpire(geo: THREE.BufferGeometry, amp: number, cantX: number, hSpan: number, phase: number): THREE.BufferGeometry {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const frac = Math.max(0, Math.min(1, y / Math.max(0.1, hSpan)));
    const crag = Math.sin(y * 1.1 + x * 0.7 + phase) * 0.55 + Math.cos(z * 0.85 - y * 0.75 + phase) * 0.45;
    // Quadratic inward lean matching the iconic twin converging jagged spires in reference art
    const lean = cantX * Math.pow(frac, 1.35);
    pos.setXYZ(i, x + lean + crag * amp * (0.4 + 0.6 * frac), y, z + crag * amp * 0.65);
  }
  geo.computeVertexNormals();
  return geo;
}

export function createSpireModule(
  variant: SpireVariant,
  opts: { archFloorY?: number; height?: number; cantX?: number } = {},
): THREE.Group {
  const mats = getOceanMaterials();
  const g = new THREE.Group();

  if (variant === 'base') {
    const H = opts.archFloorY ?? 6.4;
    const parts: THREE.BufferGeometry[] = [];
    // Broad stepped octagonal rocky plinth
    const lower = new THREE.CylinderGeometry(4.2, 5.4, H * 0.58, 8, 3);
    lower.scale(1.06, 1, 0.92);
    lower.translate(0, H * 0.29, 0);
    displaceSpire(lower, 0.35, 0, H, 1.2);
    parts.push(lower);

    // Carved ashlar buttress plinth upper tier
    const upper = new THREE.BoxGeometry(9.6, H * 0.46, 8.2, 4, 2, 3);
    upper.translate(0, H * 0.77, 0);
    displaceSpire(upper, 0.22, 0, H, 2.5);
    parts.push(upper);

    // Flanking carved pilasters & diagonal buttresses
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const rib = new THREE.BoxGeometry(1.4, H * 0.92, 1.4);
        rib.rotateZ(sx * -0.14);
        rib.translate(sx * 4.4, H * 0.46, sz * 3.2);
        parts.push(rib);
      }
    }
    const merged = mergeGeometries(
      parts.map((p) => {
        const n = normalizeForMerge(p);
        p.dispose();
        return n;
      }),
      false,
    )!;
    applyVerticalAO(merged, 0, H, new THREE.Color(0x476870), new THREE.Color(0xd2ddd4));
    g.add(new THREE.Mesh(merged, mats.limestoneMoss));

    // Warm glowing carved diamond-alcove sconces on base flanks
    const glowParts: THREE.BufferGeometry[] = [];
    for (const sz of [-1, 1]) {
      for (const sx of [-2.4, 2.4]) {
        const niche = new THREE.OctahedronGeometry(0.45, 0);
        niche.scale(0.85, 1.3, 0.35);
        niche.translate(sx, H * 0.56, sz * 4.25);
        glowParts.push(niche);
      }
    }
    const glowMerged = mergeGeometries(
      glowParts.map((p) => {
        const n = normalizeForMerge(p, undefined, false);
        p.dispose();
        return n;
      }),
      false,
    )!;
    g.add(new THREE.Mesh(glowMerged, mats.warmCrystalCore));
  } else if (variant === 'mid-arch') {
    // True pass-through vaulted stone tunnel sculpted into a tapering monolithic rock spire!
    // Local y = 0 is the exact walkable tunnel floor!
    const clearHalfW = 2.25; // 4.5m clear width
    const clearSpringY = 3.5;
    const totalH = 8.4;
    const outerHalfW = 5.15;
    const depth = 8.6;

    const parts: THREE.BufferGeometry[] = [];
    // Walkable tunnel deck slab (top face at EXACT y = 0.0 so downward raycast hits y = 0.0!)
    const deck = new THREE.BoxGeometry(outerHalfW * 1.92, 0.6, depth + 0.4);
    deck.translate(0, -0.3, 0);
    parts.push(deck);

    // Sculpted tapered rocky arch monolith (steep trapezoidal crag — zero boxy cube corners!)
    const shape = new THREE.Shape();
    shape.moveTo(-outerHalfW, -0.3);
    shape.lineTo(-outerHalfW * 0.96, totalH * 0.38);
    shape.lineTo(-outerHalfW * 0.78, totalH * 0.82);
    shape.lineTo(-outerHalfW * 0.62, totalH + 0.5);
    shape.lineTo(outerHalfW * 0.62, totalH + 0.5);
    shape.lineTo(outerHalfW * 0.78, totalH * 0.82);
    shape.lineTo(outerHalfW * 0.96, totalH * 0.38);
    shape.lineTo(outerHalfW, -0.3);
    shape.lineTo(clearHalfW, -0.3);
    shape.lineTo(clearHalfW, clearSpringY);
    shape.absarc(0, clearSpringY, clearHalfW, 0, Math.PI, false);
    shape.lineTo(-clearHalfW, -0.3);
    shape.closePath();

    const archBody = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 14 });
    archBody.translate(0, 0, -depth * 0.5);
    parts.push(archBody);

    // Carved projecting arch ring voussoir frames at both tunnel mouths
    const ringShape = new THREE.Shape();
    ringShape.absarc(0, clearSpringY, clearHalfW + 0.65, 0, Math.PI, false);
    ringShape.lineTo(-(clearHalfW + 0.65), 0);
    ringShape.lineTo(-clearHalfW, 0);
    ringShape.lineTo(-clearHalfW, clearSpringY);
    ringShape.absarc(0, clearSpringY, clearHalfW, Math.PI, 0, true);
    ringShape.lineTo(clearHalfW, 0);
    ringShape.lineTo(clearHalfW + 0.65, 0);
    ringShape.closePath();
    for (const sz of [-1, 1]) {
      const ring = new THREE.ExtrudeGeometry(ringShape, { depth: 0.45, bevelEnabled: false, curveSegments: 14 });
      ring.translate(0, 0, sz > 0 ? depth * 0.5 - 0.15 : -depth * 0.5 - 0.3);
      parts.push(ring);
    }

    // Rugged tapering rocky shoulder ribs clinging tightly to the arch flanks (breaks up flat faces!)
    for (const sx of [-1, 1]) {
      const shoulder = new THREE.CylinderGeometry(1.15, 2.35, totalH * 1.04, 6, 4);
      shoulder.scale(0.85, 1, 1.8);
      shoulder.translate(sx * (outerHalfW * 0.82), totalH * 0.48, 0);
      displaceSpire(shoulder, 0.42, -sx * 0.9, totalH, sx < 0 ? 1.7 : 4.1);
      parts.push(shoulder);
    }

    const merged = mergeGeometries(
      parts.map((p) => {
        const n = normalizeForMerge(p);
        p.dispose();
        return n;
      }),
      false,
    )!;
    applyVerticalAO(merged, -0.4, totalH + 0.5, new THREE.Color(0x7c9898), new THREE.Color(0xf2f4e8));
    g.add(new THREE.Mesh(merged, mats.limestone));

    // Glowing golden arch-interior sconce strips lighting the walkthrough portal
    const lightParts: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-2.4, 2.4]) {
        const sconce = new THREE.BoxGeometry(0.16, 0.85, 0.32);
        sconce.translate(sx * (clearHalfW - 0.06), 2.5, sz);
        lightParts.push(sconce);
      }
    }
    const keyStoneLight = new THREE.OctahedronGeometry(0.42, 0);
    keyStoneLight.translate(0, clearSpringY + clearHalfW + 0.35, depth * 0.5 + 0.25);
    lightParts.push(keyStoneLight);
    const keyStoneBack = keyStoneLight.clone();
    keyStoneBack.translate(0, 0, -(depth + 0.5));
    lightParts.push(keyStoneBack);
    const lightsMerged = mergeGeometries(
      lightParts.map((p) => {
        const n = normalizeForMerge(p, undefined, false);
        p.dispose();
        return n;
      }),
      false,
    )!;
    g.add(new THREE.Mesh(lightsMerged, mats.warmCrystalCore));
  } else {
    // 'tip': broad, monumental leaning jagged bone-limestone spire pinnacle matching reference art!
    const H = (opts.height ?? 12.6) * 1.12;
    const cantX = (opts.cantX ?? 2.8) * 1.28;
    const parts: THREE.BufferGeometry[] = [];

    // Main broad tapered jagged rock spire monolith locking seamlessly onto mid-arch top
    const main = new THREE.CylinderGeometry(0.45, 4.45, H, 7, 9);
    main.scale(1.05, 1, 0.92);
    main.translate(0, H * 0.46, 0);
    displaceSpire(main, 0.72, cantX, H, cantX > 0 ? 1.5 : 3.9);
    parts.push(main);

    // Secondary jagged dorsal rock ridge echoing the stepped twin spire profiles in reference art
    const fin = new THREE.CylinderGeometry(0.3, 2.55, H * 0.78, 6, 7);
    fin.translate(cantX > 0 ? -1.85 : 1.85, H * 0.36, -0.45);
    displaceSpire(fin, 0.58, cantX * 0.92, H, cantX > 0 ? 5.1 : 7.3);
    parts.push(fin);

    // Front stepped crag flank merging spire neck into the archway gable
    const frontRib = new THREE.CylinderGeometry(0.42, 2.2, H * 0.58, 6, 5);
    frontRib.translate(cantX > 0 ? 1.15 : -1.15, H * 0.26, 1.45);
    displaceSpire(frontRib, 0.45, cantX * 0.55, H, cantX > 0 ? 2.4 : 6.2);
    parts.push(frontRib);

    const merged = mergeGeometries(
      parts.map((p) => {
        const n = normalizeForMerge(p);
        p.dispose();
        return n;
      }),
      false,
    )!;
    // Bright sunlit bone-white upper ridges contrasting against turquoise shadow crevices
    applyVerticalAO(merged, 0, H, new THREE.Color(0x88a0a0), new THREE.Color(0xfaf9ee));
    g.add(new THREE.Mesh(merged, mats.limestone));
  }

  return g;
}
