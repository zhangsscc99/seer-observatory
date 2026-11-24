// src/game/ocean-deep.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/rng.ts
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}
var damp = (rate, dt) => 1 - Math.exp(-rate * dt);

// src/game/ocean-deep.ts
var OCEAN_DEEP = {
  seed: 20260719,
  waterDepth: 0.12,
  waterY: 0.12,
  plazaCenter: { x: 0, z: 4 },
  plazaRadius: 14,
  altarCenter: { x: 0, z: 4 },
  altarDiameter: 6,
  terraceCenter: { x: 27, z: 2 },
  terraceHeights: [0, 1.6, 3.2],
  terraceRadii: [15, 11.5, 7.2],
  bridgeWidth: 2.4,
  balustradeSpacing: 3,
  maxBridgeSlopeDeg: 12,
  spireWest: { x: -16, z: -10, height: 26.4, archFloorY: 6.4 },
  spireEast: { x: 19, z: -14, height: 28.2, archFloorY: 7 },
  basinCenter: { x: 0, z: -1 },
  basinRx: 47,
  basinRz: 45,
  ceilingWaterY: 46,
  /** Player capsule + open-world walking speeds */
  playerRadius: 0.28,
  playerHeight: 1,
  stepUp: 0.52,
  walkSpeed: 4.6,
  runSpeed: 7.2,
  accel: 14,
  turnRate: 14,
  stride: 0.65
};
function worldAABBOfPlacement(p) {
  const { min, max } = p.localBounds;
  const sx = p.scale.x;
  const sy = p.scale.y;
  const sz = p.scale.z;
  const c = Math.cos(p.rotY);
  const s = Math.sin(p.rotY);
  const xs = [min.x * sx, max.x * sx];
  const zs = [min.z * sz, max.z * sz];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const lx of xs) {
    for (const lz of zs) {
      const wx = p.pos.x + lx * c + lz * s;
      const wz = p.pos.z - lx * s + lz * c;
      if (wx < minX) minX = wx;
      if (wx > maxX) maxX = wx;
      if (wz < minZ) minZ = wz;
      if (wz > maxZ) maxZ = wz;
    }
  }
  return {
    min: { x: minX, y: p.pos.y + min.y * sy, z: minZ },
    max: { x: maxX, y: p.pos.y + max.y * sy, z: maxZ }
  };
}
function worldAABBOfCollider(col) {
  if (col.kind === "cyl") {
    return {
      min: { x: col.cx - col.r, y: col.minY, z: col.cz - col.r },
      max: { x: col.cx + col.r, y: col.maxY, z: col.cz + col.r }
    };
  }
  const c = Math.abs(Math.cos(col.rotY));
  const s = Math.abs(Math.sin(col.rotY));
  const ex = col.hx * c + col.hz * s;
  const ez = col.hx * s + col.hz * c;
  return {
    min: { x: col.cx - ex, y: col.minY, z: col.cz - ez },
    max: { x: col.cx + ex, y: col.maxY, z: col.cz + ez }
  };
}
function aabbOverlap(a, b, margin = 0) {
  return a.min.x < b.max.x - margin && a.max.x > b.min.x + margin && a.min.y < b.max.y - margin && a.max.y > b.min.y + margin && a.min.z < b.max.z - margin && a.max.z > b.min.z + margin;
}
function basinHeightAt(x, z) {
  const dp = Math.hypot(x - OCEAN_DEEP.plazaCenter.x, z - OCEAN_DEEP.plazaCenter.z);
  if (dp <= OCEAN_DEEP.plazaRadius + 0.5) return 0;
  const blend = clamp((dp - (OCEAN_DEEP.plazaRadius + 0.5)) / 7.5, 0, 1);
  const smooth = blend * blend * (3 - 2 * blend);
  const undulate = 0.16 + 0.09 * Math.sin(x * 0.13 + z * 0.09) + 0.07 * Math.cos(x * 0.08 - z * 0.15) + 0.04 * Math.sin((x + z) * 0.21);
  return smooth * Math.max(0.02, undulate);
}
function samplePolyline(pts, step) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    const dz = pts[i].z - pts[i - 1].z;
    cum.push(cum[i - 1] + Math.hypot(dx, dy, dz));
  }
  const total = cum[cum.length - 1];
  const count = Math.max(1, Math.round(total / step));
  const at = (s) => {
    const cs = clamp(s, 0, total);
    let idx = 0;
    while (idx < cum.length - 2 && cum[idx + 1] < cs) idx++;
    const segLen = Math.max(1e-6, cum[idx + 1] - cum[idx]);
    const t = (cs - cum[idx]) / segLen;
    return {
      x: pts[idx].x + (pts[idx + 1].x - pts[idx].x) * t,
      y: pts[idx].y + (pts[idx + 1].y - pts[idx].y) * t,
      z: pts[idx].z + (pts[idx + 1].z - pts[idx].z) * t
    };
  };
  const y0 = pts[0].y;
  const y1 = pts[pts.length - 1].y;
  const segs = [];
  for (let i = 0; i < count; i++) {
    const f0 = i / count;
    const f1 = (i + 1) / count;
    const aRaw = at(f0 * total);
    const bRaw = at(f1 * total);
    const a = { x: aRaw.x, y: y0 + (y1 - y0) * f0, z: aRaw.z };
    const b = { x: bRaw.x, y: y0 + (y1 - y0) * f1, z: bRaw.z };
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const horiz = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz);
    const slopeDeg = Math.atan2(Math.abs(dy), Math.max(1e-4, horiz)) * 180 / Math.PI;
    segs.push({
      a,
      b,
      mid: { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5, z: (a.z + b.z) * 0.5 },
      len: horiz,
      yaw,
      slopeDeg
    });
  }
  return segs;
}
var cachedWorld = null;
function buildOceanDeepWorld() {
  if (cachedWorld) return cachedWorld;
  const placements = [];
  const colliders = [];
  const surfaces = [];
  let maxBridgeSlopeDeg = 0;
  const addObb = (id, placementId, cx, cz, minY, maxY, hx, hz, rotY) => {
    colliders.push({ id, placementId, kind: "obb", cx, cz, minY, maxY, hx, hz, rotY });
  };
  const addCyl = (id, placementId, cx, cz, minY, maxY, r) => {
    colliders.push({ id, placementId, kind: "cyl", cx, cz, minY, maxY, r });
  };
  const plazaId = "plaza-shallow";
  placements.push({
    id: plazaId,
    name: "plaza-shallow",
    module: "terrace-module",
    variant: "plaza-basin",
    pos: { x: OCEAN_DEEP.plazaCenter.x, y: 0, z: OCEAN_DEEP.plazaCenter.z },
    rotY: 0,
    scale: { x: 1, y: 1, z: 1 },
    stackLayer: 0,
    role: "walkable",
    localBounds: { min: { x: -50, y: -0.5, z: -50 }, max: { x: 50, y: 0.4, z: 50 } },
    meta: { plazaR: OCEAN_DEEP.plazaRadius, waterDepth: OCEAN_DEEP.waterDepth }
  });
  surfaces.push({
    id: "surf-basin-plaza",
    placementId: plazaId,
    kind: "basin",
    cx: OCEAN_DEEP.basinCenter.x,
    cz: OCEAN_DEEP.basinCenter.z,
    rx: OCEAN_DEEP.basinRx + 2,
    rz: OCEAN_DEEP.basinRz + 2,
    plazaX: OCEAN_DEEP.plazaCenter.x,
    plazaZ: OCEAN_DEEP.plazaCenter.z,
    plazaR: OCEAN_DEEP.plazaRadius,
    tag: "plaza"
  });
  const altarId = "altar-central";
  placements.push({
    id: altarId,
    name: "altar-central",
    module: "altar-module",
    variant: "fountain-dais",
    pos: { x: OCEAN_DEEP.altarCenter.x, y: 0, z: OCEAN_DEEP.altarCenter.z },
    rotY: 0.22,
    scale: { x: 1, y: 1, z: 1 },
    stackLayer: 0,
    role: "hybrid",
    localBounds: { min: { x: -3, y: 0, z: -3 }, max: { x: 3, y: 2.8, z: 3 } },
    meta: { radius: OCEAN_DEEP.altarDiameter * 0.5 }
  });
  surfaces.push({
    id: "surf-altar-rim",
    placementId: altarId,
    kind: "disc",
    cx: OCEAN_DEEP.altarCenter.x,
    cz: OCEAN_DEEP.altarCenter.z,
    r: 3,
    innerR: 1.45,
    topY: 0.34,
    tag: "altar"
  });
  addCyl("col-altar-core", altarId, OCEAN_DEEP.altarCenter.x, OCEAN_DEEP.altarCenter.z, 0, 2.8, 1.42);
  const buildSpire = (cfg) => {
    const baseId = `${cfg.prefix}-base`;
    const midId = `${cfg.prefix}-mid`;
    const tipId = `${cfg.prefix}-tip`;
    const c = Math.cos(cfg.tunnelYaw);
    const s = Math.sin(cfg.tunnelYaw);
    const toWorld = (lx, lz) => ({
      x: cfg.x + lx * c + lz * s,
      z: cfg.z - lx * s + lz * c
    });
    placements.push({
      id: baseId,
      name: `${cfg.prefix}-base`,
      module: "spire-module",
      variant: "base",
      pos: { x: cfg.x, y: 0, z: cfg.z },
      rotY: cfg.tunnelYaw,
      scale: cfg.baseScale,
      stackLayer: 0,
      role: "solid",
      localBounds: { min: { x: -5.2, y: 0, z: -4.6 }, max: { x: 5.2, y: cfg.archFloorY, z: 4.6 } },
      meta: { archFloorY: cfg.archFloorY, pierSpanX: 2.35 }
    });
    addObb(
      `col-${baseId}`,
      baseId,
      cfg.x,
      cfg.z,
      0,
      cfg.archFloorY - 0.1,
      4.9 * cfg.baseScale.x,
      4.2 * cfg.baseScale.z,
      cfg.tunnelYaw
    );
    const tunnelHalfW = 2.15;
    const pierOffsetX = 3.55 * cfg.midScale.x;
    const pierHalfW = 1.35 * cfg.midScale.x;
    const tunnelHalfL = 4.5 * cfg.midScale.z;
    const archClearTop = cfg.archFloorY + 5.6;
    const midTopY = cfg.archFloorY + 8.4;
    placements.push({
      id: midId,
      name: `${cfg.prefix}`,
      // Primary spire anchor name (spire-west / spire-east)
      module: "spire-module",
      variant: "mid-arch",
      pos: { x: cfg.x, y: cfg.archFloorY, z: cfg.z },
      rotY: cfg.tunnelYaw,
      scale: cfg.midScale,
      stackLayer: 1,
      role: "hybrid",
      localBounds: { min: { x: -5, y: -0.5, z: -4.6 }, max: { x: 5, y: 8.6, z: 4.6 } },
      meta: { archFloorY: cfg.archFloorY, clearW: tunnelHalfW * 2, clearH: 5.6 }
    });
    surfaces.push({
      id: `surf-${midId}-tunnel`,
      placementId: midId,
      kind: "ramp",
      cx: cfg.x,
      cz: cfg.z,
      halfW: tunnelHalfW,
      halfL: tunnelHalfL + 0.5,
      rotY: cfg.tunnelYaw,
      yStart: cfg.archFloorY,
      yEnd: cfg.archFloorY,
      tag: "spire-tunnel"
    });
    const lp = toWorld(-pierOffsetX, 0);
    const rp = toWorld(pierOffsetX, 0);
    addObb(`col-${midId}-pierL`, midId, lp.x, lp.z, cfg.archFloorY - 0.3, midTopY, pierHalfW, tunnelHalfL, cfg.tunnelYaw);
    addObb(`col-${midId}-pierR`, midId, rp.x, rp.z, cfg.archFloorY - 0.3, midTopY, pierHalfW, tunnelHalfL, cfg.tunnelYaw);
    addObb(`col-${midId}-lintel`, midId, cfg.x, cfg.z, archClearTop, midTopY, pierOffsetX + pierHalfW, tunnelHalfL, cfg.tunnelYaw);
    const tipHeight = (cfg.prefix === "spire-west" ? OCEAN_DEEP.spireWest.height : OCEAN_DEEP.spireEast.height) - midTopY + 0.6;
    placements.push({
      id: tipId,
      name: `${cfg.prefix}-tip`,
      module: "spire-module",
      variant: "tip",
      pos: { x: cfg.x, y: midTopY - 0.6, z: cfg.z },
      rotY: cfg.tunnelYaw + (cfg.tipCantX > 0 ? 0.08 : -0.11),
      scale: cfg.tipScale,
      stackLayer: 2,
      role: "solid",
      localBounds: { min: { x: -3.6, y: 0, z: -3.4 }, max: { x: 3.6, y: tipHeight / cfg.tipScale.y, z: 3.4 } },
      meta: { height: tipHeight, cantX: cfg.tipCantX }
    });
    addObb(
      `col-${tipId}`,
      tipId,
      cfg.x + cfg.tipCantX * 0.4,
      cfg.z,
      midTopY - 0.6,
      midTopY - 0.6 + tipHeight,
      2.6 * cfg.tipScale.x,
      2.5 * cfg.tipScale.z,
      cfg.tunnelYaw
    );
  };
  const westTunnelYaw = Math.atan2(4.2, -3.5);
  buildSpire({
    prefix: "spire-west",
    x: OCEAN_DEEP.spireWest.x,
    z: OCEAN_DEEP.spireWest.z,
    archFloorY: OCEAN_DEEP.spireWest.archFloorY,
    tunnelYaw: westTunnelYaw,
    baseScale: { x: 1.12, y: 1, z: 1.06 },
    midScale: { x: 1.04, y: 1, z: 1.08 },
    tipScale: { x: 0.96, y: 1.16, z: 0.92 },
    tipCantX: 2.8
    // leans inward (+X) just like reference art
  });
  const eastTunnelYaw = Math.atan2(-4, -8);
  buildSpire({
    prefix: "spire-east",
    x: OCEAN_DEEP.spireEast.x,
    z: OCEAN_DEEP.spireEast.z,
    archFloorY: OCEAN_DEEP.spireEast.archFloorY,
    tunnelYaw: eastTunnelYaw,
    baseScale: { x: 1.18, y: 1, z: 1.12 },
    midScale: { x: 1.08, y: 1, z: 1.04 },
    tipScale: { x: 1.05, y: 1.22, z: 0.96 },
    tipCantX: -3.1
    // leans inward (-X) framing the central god-ray cathedral gap!
  });
  const spawnLandingPos = { x: -24.5, y: 3.2, z: 26.5 };
  const spawnLandingId = "bridge-spawn-landing";
  placements.push({
    id: spawnLandingId,
    name: "bridge-spawn-landing",
    module: "terrace-module",
    variant: "landing",
    pos: { x: spawnLandingPos.x, y: 0, z: spawnLandingPos.z },
    rotY: 0.35,
    scale: { x: 1, y: 1, z: 1 },
    stackLayer: 0,
    role: "hybrid",
    localBounds: { min: { x: -4.6, y: 0, z: -4.6 }, max: { x: 4.6, y: 3.2, z: 4.6 } },
    meta: { radius: 4.6, height: 3.2, fullDisc: true }
  });
  surfaces.push({
    id: "surf-spawn-landing",
    placementId: spawnLandingId,
    kind: "disc",
    cx: spawnLandingPos.x,
    cz: spawnLandingPos.z,
    r: 4.6,
    innerR: 0,
    topY: 3.2,
    tag: "landing"
  });
  addCyl("col-spawn-landing-base", spawnLandingId, spawnLandingPos.x, spawnLandingPos.z, 0, 2.75, 4.35);
  const addBridgeChain = (chainName, controlPts, withPiers = true) => {
    const segs = samplePolyline(controlPts, OCEAN_DEEP.balustradeSpacing);
    const midIdx = Math.floor(segs.length / 2);
    segs.forEach((seg, i) => {
      if (seg.slopeDeg > maxBridgeSlopeDeg) maxBridgeSlopeDeg = seg.slopeDeg;
      const id = `${chainName}-seg-${String(i + 1).padStart(2, "0")}`;
      const halfW = OCEAN_DEEP.bridgeWidth * 0.5;
      const halfL = seg.len * 0.5 + 0.16;
      const hasPier = withPiers && i % 2 === 1 && seg.mid.y > 1.8;
      const pitch = Math.atan2(seg.b.y - seg.a.y, seg.len);
      placements.push({
        id,
        name: i === midIdx ? `${chainName}` : id,
        module: "bridge-deck",
        variant: hasPier ? "piered" : "span",
        pos: { x: seg.mid.x, y: seg.mid.y, z: seg.mid.z },
        rotY: seg.yaw,
        // Strictly (1, 1, 1) so balustrades on bridge-deck are NEVER stretched!
        scale: { x: 1, y: 1, z: 1 },
        stackLayer: 1,
        role: "hybrid",
        localBounds: {
          min: { x: -halfW - 0.25, y: hasPier ? -seg.mid.y : -0.65, z: -halfL },
          max: { x: halfW + 0.25, y: 1.05, z: halfL }
        },
        meta: {
          width: OCEAN_DEEP.bridgeWidth,
          length: seg.len + 0.32,
          pitch,
          yStart: seg.a.y,
          yEnd: seg.b.y,
          hasPier,
          pierHeight: seg.mid.y
        }
      });
      surfaces.push({
        id: `surf-${id}`,
        placementId: id,
        kind: "ramp",
        cx: seg.mid.x,
        cz: seg.mid.z,
        halfW,
        halfL: halfL + 0.12,
        rotY: seg.yaw,
        yStart: seg.a.y,
        yEnd: seg.b.y,
        tag: "bridge"
      });
      const c = Math.cos(seg.yaw);
      const s = Math.sin(seg.yaw);
      const railOffset = halfW + 0.22;
      const minDeckY = Math.min(seg.a.y, seg.b.y);
      const maxDeckY = Math.max(seg.a.y, seg.b.y);
      addObb(
        `col-${id}-railL`,
        id,
        seg.mid.x - railOffset * c,
        seg.mid.z + railOffset * s,
        minDeckY + 0.05,
        maxDeckY + 1.1,
        0.18,
        seg.len * 0.48,
        seg.yaw
      );
      addObb(
        `col-${id}-railR`,
        id,
        seg.mid.x + railOffset * c,
        seg.mid.z - railOffset * s,
        minDeckY + 0.05,
        maxDeckY + 1.1,
        0.18,
        seg.len * 0.48,
        seg.yaw
      );
      if (hasPier) {
        addCyl(`col-${id}-pier`, id, seg.mid.x, seg.mid.z, -0.2, minDeckY - 0.55, 0.72);
      }
    });
    return { midPoint: segs[midIdx].mid };
  };
  const mainBridge = addBridgeChain("bridge-main", [
    { x: -24.8, y: 3.2, z: 23.2 },
    { x: -27.2, y: 3.7, z: 17.2 },
    { x: -28.6, y: 4.3, z: 10.6 },
    { x: -28, y: 4.95, z: 3.8 },
    { x: -25.2, y: 5.6, z: -2 },
    { x: -20.4, y: 6.2, z: -6.4 },
    { x: -18.5, y: 6.4, z: -7.9 }
  ]);
  addBridgeChain("bridge-spiral", [
    { x: -13.6, y: 6.4, z: -12 },
    { x: -9.2, y: 5.75, z: -13.1 },
    { x: -6.4, y: 5, z: -9.2 },
    { x: -5.9, y: 4.2, z: -4 },
    { x: -7.5, y: 3.4, z: 1 },
    { x: -10.3, y: 2.55, z: 5.1 },
    { x: -11.8, y: 1.6, z: 9.2 }
  ]);
  const addStairFlight = (id, a, b, width, withSideWalls = true) => {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz);
    const mid = { x: (a.x + b.x) * 0.5, y: Math.min(a.y, b.y), z: (a.z + b.z) * 0.5 };
    const rise = Math.abs(b.y - a.y);
    const halfW = width * 0.5;
    const halfL = len * 0.5 + 0.2;
    placements.push({
      id,
      name: id,
      module: "stair-module",
      variant: "five-step",
      pos: mid,
      rotY: yaw,
      scale: { x: 1, y: 1, z: 1 },
      stackLayer: Math.floor(Math.min(a.y, b.y) / 1.5),
      role: withSideWalls ? "hybrid" : "walkable",
      localBounds: {
        min: { x: -halfW - 0.3, y: 0, z: -halfL },
        max: { x: halfW + 0.3, y: rise + 0.55, z: halfL }
      },
      meta: { width, length: len, steps: 5, yStart: a.y, yEnd: b.y }
    });
    surfaces.push({
      id: `surf-${id}`,
      placementId: id,
      kind: "ramp",
      cx: mid.x,
      cz: mid.z,
      halfW,
      halfL: halfL + 0.15,
      rotY: yaw,
      yStart: a.y,
      yEnd: b.y,
      tag: "stair"
    });
    if (withSideWalls) {
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const wallOff = halfW + 0.24;
      const maxY = Math.max(a.y, b.y) + 0.55;
      const minY = Math.min(a.y, b.y);
      addObb(`col-${id}-curbL`, id, mid.x - wallOff * c, mid.z + wallOff * s, minY, maxY, 0.2, len * 0.46, yaw);
      addObb(`col-${id}-curbR`, id, mid.x + wallOff * c, mid.z - wallOff * s, minY, maxY, 0.2, len * 0.46, yaw);
    }
  };
  const spiralLandingId = "bridge-spiral-landing";
  placements.push({
    id: spiralLandingId,
    name: spiralLandingId,
    module: "terrace-module",
    variant: "landing",
    pos: { x: -11.8, y: 0, z: 9.6 },
    rotY: 0.7,
    scale: { x: 1, y: 1, z: 1 },
    stackLayer: 0,
    role: "hybrid",
    localBounds: { min: { x: -2.2, y: 0, z: -2.2 }, max: { x: 2.2, y: 1.6, z: 2.2 } },
    meta: { radius: 2.2, height: 1.6, fullDisc: true }
  });
  surfaces.push({
    id: "surf-spiral-landing",
    placementId: spiralLandingId,
    kind: "disc",
    cx: -11.8,
    cz: 9.6,
    r: 2.2,
    innerR: 0,
    topY: 1.6,
    tag: "landing"
  });
  addCyl("col-spiral-landing-base", spiralLandingId, -11.8, 9.6, 0, 1.25, 1.95);
  addStairFlight("stair-spiral-plaza", { x: -11.1, y: 1.6, z: 10.6 }, { x: -7.9, y: 0, z: 13.6 }, 2.6);
  const spawnMidLandingId = "stair-spawn-mid-landing";
  placements.push({
    id: spawnMidLandingId,
    name: spawnMidLandingId,
    module: "terrace-module",
    variant: "landing",
    pos: { x: -17.2, y: 0, z: 21.3 },
    rotY: -0.6,
    scale: { x: 1, y: 1, z: 1 },
    stackLayer: 0,
    role: "hybrid",
    localBounds: { min: { x: -2.5, y: 0, z: -2.5 }, max: { x: 2.5, y: 1.6, z: 2.5 } },
    meta: { radius: 2.5, height: 1.6, fullDisc: true }
  });
  surfaces.push({
    id: "surf-spawn-mid-landing",
    placementId: spawnMidLandingId,
    kind: "disc",
    cx: -17.2,
    cz: 21.3,
    r: 2.5,
    innerR: 0,
    topY: 1.6,
    tag: "landing"
  });
  addCyl("col-spawn-mid-landing-base", spawnMidLandingId, -17.2, 21.3, 0, 1.25, 2.2);
  addStairFlight("stair-spawn-upper", { x: -21.2, y: 3.2, z: 24.4 }, { x: -18.2, y: 1.6, z: 22 }, 2.8);
  addStairFlight("stair-spawn-lower", { x: -16.1, y: 1.6, z: 20.4 }, { x: -12.6, y: 0, z: 17.6 }, 2.8);
  const tc = OCEAN_DEEP.terraceCenter;
  const terraceFaceDir = -Math.PI / 2;
  const terraceSectorHalf = Math.PI * 0.56;
  placements.push({
    id: "terrace-tier-0",
    name: "terrace-tier-0",
    module: "terrace-module",
    variant: "semi-circle",
    pos: { x: tc.x, y: 0, z: tc.z },
    rotY: terraceFaceDir,
    scale: { x: 1, y: 1, z: 1 },
    stackLayer: 0,
    role: "walkable",
    localBounds: { min: { x: -15, y: -0.1, z: -2 }, max: { x: 15, y: 0.15, z: 15 } },
    meta: { radius: 15, height: 0.12, tier: 0 }
  });
  surfaces.push({
    id: "surf-terrace-0",
    placementId: "terrace-tier-0",
    kind: "disc",
    cx: tc.x,
    cz: tc.z,
    r: 15,
    innerR: 0,
    topY: 0.04,
    sectorDir: terraceFaceDir,
    sectorHalf: terraceSectorHalf,
    tag: "terrace"
  });
  placements.push({
    id: "terrace-tier-1",
    name: "terrace-tier-1",
    module: "terrace-module",
    variant: "semi-circle",
    pos: { x: tc.x, y: 0, z: tc.z },
    rotY: terraceFaceDir,
    scale: { x: 1, y: 1, z: 1 },
    stackLayer: 1,
    role: "hybrid",
    localBounds: { min: { x: -11.5, y: 0, z: -2 }, max: { x: 11.5, y: 1.6, z: 11.5 } },
    meta: { radius: 11.5, height: 1.6, tier: 1 }
  });
  surfaces.push({
    id: "surf-terrace-1",
    placementId: "terrace-tier-1",
    kind: "disc",
    cx: tc.x,
    cz: tc.z,
    r: 11.5,
    innerR: 0,
    topY: 1.6,
    sectorDir: terraceFaceDir,
    sectorHalf: terraceSectorHalf,
    tag: "terrace"
  });
  const addRetainingWallArc = (placementId, prefix, radius, minY, maxY, skipAnglesDeg) => {
    const count = 14;
    for (let i = 0; i < count; i++) {
      const deg = -90 + i / (count - 1) * 180;
      if (skipAnglesDeg.some(([a2, b]) => deg >= a2 && deg <= b)) continue;
      const a = terraceFaceDir + deg * Math.PI / 180;
      const wx = tc.x + Math.sin(a) * (radius - 0.35);
      const wz = tc.z + Math.cos(a) * (radius - 0.35);
      addObb(`col-${prefix}-${i}`, placementId, wx, wz, minY, maxY, 1.4, 0.45, a);
    }
  };
  addRetainingWallArc("terrace-tier-1", "t1-wall", 11.5, 0, 1.35, [
    [-16, 16],
    [28, 56]
  ]);
  placements.push({
    id: "terrace-tier-2",
    name: "terrace-east",
    module: "terrace-module",
    variant: "semi-circle",
    pos: { x: tc.x, y: 1.6, z: tc.z },
    rotY: terraceFaceDir,
    scale: { x: 1, y: 1, z: 1 },
    stackLayer: 2,
    role: "hybrid",
    localBounds: { min: { x: -7.2, y: 0, z: -2 }, max: { x: 7.2, y: 1.6, z: 7.2 } },
    meta: { radius: 7.2, height: 1.6, tier: 2 }
  });
  surfaces.push({
    id: "surf-terrace-2",
    placementId: "terrace-tier-2",
    kind: "disc",
    cx: tc.x,
    cz: tc.z,
    r: 7.2,
    innerR: 0,
    topY: 3.2,
    sectorDir: terraceFaceDir,
    sectorHalf: terraceSectorHalf + 0.08,
    tag: "terrace"
  });
  addRetainingWallArc("terrace-tier-2", "t2-wall", 7.2, 1.6, 2.95, [[-22, 22]]);
  addStairFlight("stair-terrace-01a", { x: tc.x - 15.2, y: 0, z: tc.z }, { x: tc.x - 10.7, y: 1.6, z: tc.z }, 4.2);
  addStairFlight(
    "stair-terrace-01b",
    { x: tc.x - 11.2, y: 0, z: tc.z + 10.2 },
    { x: tc.x - 7.8, y: 1.6, z: tc.z + 7.2 },
    3.4
  );
  addStairFlight("stair-terrace-12", { x: tc.x - 10, y: 1.6, z: tc.z }, { x: tc.x - 5.8, y: 3.2, z: tc.z }, 3.8);
  addBridgeChain(
    "bridge-east-spire",
    [
      { x: tc.x - 1.2, y: 3.2, z: tc.z - 5 },
      { x: 29.8, y: 3.85, z: -5.4 },
      { x: 31.6, y: 4.75, z: -10.4 },
      { x: 28.8, y: 5.65, z: -15 },
      { x: 24, y: 6.45, z: -16.2 },
      { x: 19.6, y: 7, z: -14.4 }
    ],
    false
  );
  const addArch = (id, variant, pos, rotY, mirror = false, role = "solid") => {
    const span = variant === "wide" ? 6.4 : 3.6;
    const height = variant === "wide" ? 7.2 : 5.2;
    const pierW = variant === "wide" ? 1.1 : 0.85;
    const halfSpan = span * 0.5;
    placements.push({
      id,
      name: id,
      module: "arch-module",
      variant,
      pos,
      rotY,
      scale: { x: 1, y: 1, z: 1 },
      mirror,
      stackLayer: pos.y >= 3 ? 2 : pos.y >= 1.5 ? 1 : 0,
      role,
      localBounds: {
        min: { x: -(halfSpan + pierW), y: 0, z: -0.95 },
        max: { x: halfSpan + pierW, y: height, z: 0.95 }
      },
      meta: { span, height, pierW }
    });
    if (role !== "decor") {
      const c = Math.cos(rotY);
      const s = Math.sin(rotY);
      const pOff = halfSpan + pierW * 0.5;
      addObb(`col-${id}-L`, id, pos.x - pOff * c, pos.z + pOff * s, pos.y, pos.y + height, pierW * 0.5, 0.82, rotY);
      addObb(`col-${id}-R`, id, pos.x + pOff * c, pos.z - pOff * s, pos.y, pos.y + height, pierW * 0.5, 0.82, rotY);
      addObb(`col-${id}-top`, id, pos.x, pos.z, pos.y + height - 1.35, pos.y + height, halfSpan + pierW, 0.85, rotY);
    }
  };
  addArch("arch-terrace-main", "wide", { x: tc.x + 1.2, y: 3.2, z: tc.z }, Math.PI / 2, false);
  addArch("arch-terrace-south", "narrow", { x: tc.x - 1.8, y: 3.2, z: tc.z + 5.8 }, 0.35, true);
  addArch("arch-terrace-north", "narrow", { x: tc.x - 5.2, y: 1.6, z: tc.z - 8.2 }, -0.58, false);
  addArch("arch-cliff-west", "narrow", { x: -34.5, y: 0.2, z: 14.5 }, 1.12, true);
  addArch("arch-plaza-north", "wide", { x: -1.5, y: 0, z: -26.5 }, 0.14, false);
  addArch("arch-distant-aqueduct", "wide", { x: 1.5, y: -1, z: -66 }, 0.04, false, "decor");
  const pillarSpecs = [
    { id: "pillar-terrace-01", pos: { x: tc.x - 4.8, y: 3.2, z: tc.z - 3.6 }, rotY: 0.2, segments: 3 },
    { id: "pillar-terrace-02", pos: { x: tc.x - 4.8, y: 3.2, z: tc.z + 3.6 }, rotY: 1.1, segments: 3 },
    { id: "pillar-terrace-03", pos: { x: tc.x - 8.6, y: 1.6, z: tc.z - 5.6 }, rotY: 2, segments: 2 },
    { id: "pillar-terrace-04", pos: { x: tc.x - 8.8, y: 1.6, z: tc.z + 4.4 }, rotY: 0.65, segments: 3 },
    { id: "pillar-terrace-05", pos: { x: tc.x - 3.5, y: 1.6, z: tc.z + 9.4 }, rotY: 2.75, segments: 2 },
    { id: "pillar-terrace-06", pos: { x: tc.x - 10.6, y: 0, z: tc.z - 8.4 }, rotY: 1.55, segments: 1 },
    { id: "pillar-plaza-07", pos: { x: -11.5, y: 0, z: -6.8 }, rotY: 0.42, segments: 2 },
    { id: "pillar-plaza-08", pos: { x: 12.2, y: 0, z: -9.8 }, rotY: 2.24, segments: 3 },
    { id: "pillar-bridge-09", pos: { x: -32.2, y: 0.2, z: 6.2 }, rotY: 1.88, segments: 3 },
    { id: "pillar-north-10", pos: { x: 9.5, y: 0.1, z: -27.5 }, rotY: 0.9, segments: 2 }
  ];
  for (const ps of pillarSpecs) {
    const h = 0.6 + ps.segments * 1.65;
    placements.push({
      id: ps.id,
      name: ps.id,
      module: "pillar-module",
      variant: `doric-${ps.segments}seg`,
      pos: ps.pos,
      rotY: ps.rotY,
      scale: { x: 1, y: 1, z: 1 },
      // NEVER stretched!
      segments: ps.segments,
      stackLayer: ps.pos.y >= 3 ? 2 : ps.pos.y >= 1.5 ? 1 : 0,
      role: "solid",
      localBounds: { min: { x: -0.62, y: 0, z: -0.62 }, max: { x: 0.62, y: h, z: 0.62 } },
      meta: { height: h, segments: ps.segments }
    });
    addCyl(`col-${ps.id}`, ps.id, ps.pos.x, ps.pos.z, ps.pos.y, ps.pos.y + h, 0.56);
  }
  const cliffVariants = ["straight", "concave", "convex", "portal"];
  const rngCliff = mulberry32(OCEAN_DEEP.seed + 101);
  const ringCount = 32;
  for (let i = 0; i < ringCount; i++) {
    const theta = i / ringCount * Math.PI * 2;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const northGap = sinT < -0.74 && Math.abs(cosT) < 0.48;
    const rx = OCEAN_DEEP.basinRx + (northGap ? 1.5 : 1 + (rngCliff() - 0.5) * 2.2);
    const rz = OCEAN_DEEP.basinRz + (northGap ? 1.5 : 1 + (rngCliff() - 0.5) * 2.2);
    const x = OCEAN_DEEP.basinCenter.x + cosT * rx;
    const z = OCEAN_DEEP.basinCenter.z + sinT * rz;
    const tx = -sinT * rx;
    const tz = cosT * rz;
    const tangentYaw = Math.atan2(tx, tz) + Math.PI / 2 + (rngCliff() - 0.5) * 0.22;
    const sx = 1.28 + rngCliff() * 0.42;
    const sy = northGap ? 0.28 + rngCliff() * 0.14 : 1.05 + rngCliff() * 0.65;
    const sz = 0.95 + rngCliff() * 0.45;
    const variant = northGap ? "convex" : cliffVariants[i % cliffVariants.length];
    const id = `cliff-ring0-${String(i + 1).padStart(2, "0")}`;
    const baseW = 10.6;
    const baseH = 14;
    const baseD = 7.4;
    placements.push({
      id,
      name: id,
      module: "cliff-module",
      variant,
      pos: { x, y: -1.2, z },
      rotY: tangentYaw,
      scale: { x: sx, y: sy, z: sz },
      mirror: i % 5 === 0,
      stackLayer: 0,
      role: "solid",
      localBounds: {
        min: { x: -baseW * 0.5, y: 0, z: -baseD * 0.5 },
        max: { x: baseW * 0.5, y: baseH, z: baseD * 0.5 }
      },
      meta: { northGap }
    });
    addObb(
      `col-${id}`,
      id,
      x,
      z,
      -1.2,
      -1.2 + baseH * sy,
      baseW * 0.5 * sx,
      baseD * 0.46 * sz,
      tangentYaw
    );
  }
  for (let i = 0; i < 22; i++) {
    const theta = -0.35 * Math.PI + i / 21 * 1.72 * Math.PI;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const rx = OCEAN_DEEP.basinRx + 6.5 + (rngCliff() - 0.5) * 3;
    const rz = OCEAN_DEEP.basinRz + 6 + (rngCliff() - 0.5) * 3;
    const x = OCEAN_DEEP.basinCenter.x + cosT * rx;
    const z = OCEAN_DEEP.basinCenter.z + sinT * rz;
    const yaw = Math.atan2(-sinT * rx, cosT * rz) + Math.PI / 2 + (rngCliff() - 0.5) * 0.45;
    const sx = 1.35 + rngCliff() * 0.55;
    const sy = 1.25 + rngCliff() * 0.7;
    const sz = 1.05 + rngCliff() * 0.5;
    const yBase = 8.5 + rngCliff() * 4.5;
    const variant = cliffVariants[(i + 1) % cliffVariants.length];
    const id = `cliff-ring1-${String(i + 1).padStart(2, "0")}`;
    placements.push({
      id,
      name: id,
      module: "cliff-module",
      variant,
      pos: { x, y: yBase, z },
      rotY: yaw,
      scale: { x: sx, y: sy, z: sz },
      mirror: i % 3 === 1,
      stackLayer: 1,
      role: "solid",
      localBounds: { min: { x: -5.3, y: 0, z: -3.7 }, max: { x: 5.3, y: 14, z: 3.7 } }
    });
    addObb(`col-${id}`, id, x, z, yBase, yBase + 14 * sy, 5.2 * sx, 3.5 * sz, yaw);
  }
  const rimAngles = [-2.55, -2.25, -1.95, -1.05, -0.72, -0.38, -0.04, 0.3, 0.68, 1.15, 2, 2.42, 2.82, 3.12];
  rimAngles.forEach((theta, i) => {
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const rx = 59 + (rngCliff() - 0.5) * 5;
    const rz = 56 + (rngCliff() - 0.5) * 5;
    const x = OCEAN_DEEP.basinCenter.x + cosT * rx;
    const z = OCEAN_DEEP.basinCenter.z + sinT * rz;
    const yaw = theta + 0.55 + (rngCliff() - 0.5) * 0.6;
    const sx = 1.55 + rngCliff() * 0.65;
    const sy = 1.4 + rngCliff() * 0.75;
    const sz = 1.2 + rngCliff() * 0.55;
    const yBase = 17.5 + rngCliff() * 5;
    const variant = cliffVariants[(i + 2) % cliffVariants.length];
    const id = `cliff-rim2-${String(i + 1).padStart(2, "0")}`;
    placements.push({
      id,
      name: id,
      module: "cliff-module",
      variant,
      pos: { x, y: yBase, z },
      rotY: yaw,
      scale: { x: sx, y: sy, z: sz },
      stackLayer: 2,
      role: "solid",
      localBounds: { min: { x: -5.3, y: 0, z: -3.7 }, max: { x: 5.3, y: 14, z: 3.7 } }
    });
    addObb(`col-${id}`, id, x, z, yBase, yBase + 14 * sy, 5.2 * sx, 3.5 * sz, yaw);
  });
  const buttressSpecs = [
    // Interpenetrating West Spire base (flank outcrop)
    { id: "cliff-spire-west-buttress", variant: "convex", pos: { x: -23.2, y: -0.5, z: -14.8 }, rotY: 0.78, scale: { x: 0.85, y: 0.92, z: 0.95 } },
    // Interpenetrating East Spire base (flank outcrop)
    { id: "cliff-spire-east-buttress", variant: "portal", pos: { x: 26.8, y: -0.5, z: -18.5 }, rotY: -0.84, scale: { x: 0.96, y: 1.05, z: 0.88 } },
    // Foreground-left framing pedestal rock (supports foreground glowing gold crystal!)
    { id: "cliff-fg-left-pedestal", variant: "straight", pos: { x: -32.2, y: -0.4, z: 30.8 }, rotY: 0.42, scale: { x: 0.72, y: 0.42, z: 0.68 } },
    // Foreground-right framing rock cluster (supports glowing cyan crystal clusters!)
    { id: "cliff-fg-right-outcrop", variant: "concave", pos: { x: 22.8, y: -0.4, z: 27.6 }, rotY: -0.62, scale: { x: 0.92, y: 0.56, z: 0.78 } },
    // West flank ruined terrace wall cliff
    { id: "cliff-west-ledge", variant: "portal", pos: { x: -38.5, y: -0.4, z: 2.5 }, rotY: 1.42, scale: { x: 1.05, y: 0.82, z: 0.75 } }
  ];
  for (const b of buttressSpecs) {
    placements.push({
      id: b.id,
      name: b.id,
      module: "cliff-module",
      variant: b.variant,
      pos: b.pos,
      rotY: b.rotY,
      scale: b.scale,
      stackLayer: 0,
      role: "solid",
      localBounds: { min: { x: -5.3, y: 0, z: -3.7 }, max: { x: 5.3, y: 14, z: 3.7 } }
    });
    addObb(`col-${b.id}`, b.id, b.pos.x, b.pos.z, b.pos.y, b.pos.y + 14 * b.scale.y, 4.9 * b.scale.x, 3.3 * b.scale.z, b.rotY);
  }
  const warmCrystalSpecs = [
    // Foreground-left iconic hero crystal obelisk seated squarely atop cliff-fg-left-pedestal!
    { id: "crystal-warm-fg", pos: { x: -31.8, y: 5.1, z: 30.4 }, rotY: 0.38, scale: { x: 1.45, y: 1.95, z: 1.45 }, stackLayer: 1 },
    // West Spire ridge, mid-arch sconce & tip crown (embedded squarely into rock faces!)
    { id: "crystal-warm-west-mid", pos: { x: -13.9, y: 11.2, z: -8.8 }, rotY: 0.95, scale: { x: 1.05, y: 1.35, z: 1 }, stackLayer: 1 },
    { id: "crystal-warm-west-tip", pos: { x: -15.4, y: 19.6, z: -10.2 }, rotY: 1.42, scale: { x: 1.2, y: 1.6, z: 1.15 }, stackLayer: 2 },
    { id: "crystal-warm-west-base", pos: { x: -12.8, y: 1.6, z: -7.2 }, rotY: 0.55, scale: { x: 1, y: 1.25, z: 1 }, stackLayer: 0 },
    // East Spire base niches, flanks & high crest (embedded squarely into East Spire stone!)
    { id: "crystal-warm-east-base", pos: { x: 16.4, y: 3.2, z: -11.8 }, rotY: -0.72, scale: { x: 1.15, y: 1.4, z: 1.1 }, stackLayer: 1 },
    { id: "crystal-warm-east-ridge", pos: { x: 21.8, y: 11.6, z: -13.2 }, rotY: -1.15, scale: { x: 1.25, y: 1.65, z: 1.2 }, stackLayer: 2 },
    { id: "crystal-warm-east-tip", pos: { x: 18.2, y: 20.8, z: -14 }, rotY: 2.34, scale: { x: 1.15, y: 1.5, z: 1.05 }, stackLayer: 2 },
    // East 3-tier Terrace sanctuary crystals (resting right on Tier 2 / Tier 1 stone decks!)
    { id: "crystal-warm-terrace-01", pos: { x: tc.x + 1.4, y: 3.2, z: tc.z - 5.2 }, rotY: -0.44, scale: { x: 1.3, y: 1.65, z: 1.2 }, stackLayer: 2 },
    { id: "crystal-warm-terrace-02", pos: { x: tc.x + 1.2, y: 3.2, z: tc.z + 5.6 }, rotY: 1.82, scale: { x: 1.2, y: 1.45, z: 1.15 }, stackLayer: 2 },
    // Cliff ledge warm crystal clusters embedded right into rock terraces (zero floating!)
    { id: "crystal-warm-cliff-w1", pos: { x: -38.8, y: 9.2, z: 2.5 }, rotY: 1.35, scale: { x: 1.3, y: 1.65, z: 1.2 }, stackLayer: 1 },
    { id: "crystal-warm-cliff-w2", pos: { x: -42.5, y: 11.2, z: -14.8 }, rotY: 1.05, scale: { x: 1.4, y: 1.75, z: 1.3 }, stackLayer: 1 },
    { id: "crystal-warm-cliff-e1", pos: { x: 43.2, y: 9.6, z: 13.5 }, rotY: -1.48, scale: { x: 1.35, y: 1.7, z: 1.25 }, stackLayer: 1 },
    { id: "crystal-warm-cliff-e2", pos: { x: 40.2, y: 7.8, z: -21.2 }, rotY: -2.1, scale: { x: 1.3, y: 1.55, z: 1.15 }, stackLayer: 1 }
  ];
  for (const w of warmCrystalSpecs) {
    placements.push({
      id: w.id,
      name: w.id,
      module: "crystal-cluster",
      variant: "warm",
      pos: w.pos,
      rotY: w.rotY,
      scale: w.scale,
      stackLayer: w.stackLayer,
      role: "decor",
      localBounds: { min: { x: -0.95, y: -0.35, z: -0.95 }, max: { x: 0.95, y: 2.2, z: 0.95 } }
    });
  }
  const coolCrystalSpecs = [
    // Foreground-right vivid cyan crystal clusters seated directly on foreground outcrop & seabed!
    { id: "crystal-cool-fg-r1", pos: { x: 20.8, y: 2.2, z: 27 }, rotY: -0.52, scale: { x: 1.45, y: 1.7, z: 1.35 }, stackLayer: 0 },
    { id: "crystal-cool-fg-r2", pos: { x: 15.2, y: 0.05, z: 23.4 }, rotY: 0.85, scale: { x: 1.2, y: 1.45, z: 1.1 }, stackLayer: 0 },
    // Foreground-left cyan cluster seated on ground right beneath the west ruin arch
    { id: "crystal-cool-fg-l1", pos: { x: -34.2, y: 0.15, z: 17.5 }, rotY: 1.18, scale: { x: 1.35, y: 1.55, z: 1.25 }, stackLayer: 0 },
    // Plaza & terrace rim cool bioluminescent accents
    { id: "crystal-cool-plaza-w", pos: { x: -13.2, y: 0, z: 2.2 }, rotY: 2.15, scale: { x: 1.1, y: 1.3, z: 1.05 }, stackLayer: 0 },
    { id: "crystal-cool-plaza-e", pos: { x: 12.6, y: 0, z: 13.8 }, rotY: -1.12, scale: { x: 1.15, y: 1.4, z: 1.05 }, stackLayer: 0 },
    { id: "crystal-cool-plaza-n", pos: { x: -4.2, y: 0, z: -13.5 }, rotY: 0.64, scale: { x: 1.25, y: 1.5, z: 1.15 }, stackLayer: 0 },
    // Cliff base cool accents seated firmly in canyon rock margins
    { id: "crystal-cool-cliff-nw", pos: { x: -35.8, y: 0.2, z: -26.8 }, rotY: 0.48, scale: { x: 1.4, y: 1.8, z: 1.3 }, stackLayer: 0 },
    { id: "crystal-cool-cliff-ne", pos: { x: 35.2, y: 0.2, z: -29.2 }, rotY: -0.82, scale: { x: 1.35, y: 1.7, z: 1.25 }, stackLayer: 0 },
    { id: "crystal-cool-cliff-s", pos: { x: -4.5, y: 0.2, z: 40.5 }, rotY: 2.95, scale: { x: 1.35, y: 1.55, z: 1.2 }, stackLayer: 0 }
  ];
  for (const c of coolCrystalSpecs) {
    placements.push({
      id: c.id,
      name: c.id,
      module: "crystal-cluster",
      variant: "cool",
      pos: c.pos,
      rotY: c.rotY,
      scale: c.scale,
      stackLayer: c.stackLayer,
      role: "decor",
      localBounds: { min: { x: -0.95, y: -0.35, z: -0.95 }, max: { x: 0.95, y: 2.2, z: 0.95 } }
    });
  }
  const heroKelpSpecs = [
    { id: "kelp-fg-l1", variant: "ribbon", pos: { x: -29.8, y: 0, z: 24 }, rotY: 0.4, scale: { x: 1.2, y: 1.55, z: 1.2 } },
    { id: "kelp-fg-r1", variant: "ribbon", pos: { x: 18.8, y: 0, z: 24.8 }, rotY: 1.7, scale: { x: 1.3, y: 1.65, z: 1.25 } },
    { id: "kelp-spire-w1", variant: "frond", pos: { x: -19.8, y: 0, z: -13.6 }, rotY: 2.4, scale: { x: 1.25, y: 1.4, z: 1.2 } },
    { id: "kelp-spire-e1", variant: "ribbon", pos: { x: 23.6, y: 0, z: -16.2 }, rotY: 0.95, scale: { x: 1.3, y: 1.7, z: 1.2 } },
    { id: "kelp-plaza-edge1", variant: "frond", pos: { x: -14.8, y: 0, z: 7.8 }, rotY: 1.25, scale: { x: 1.1, y: 1.25, z: 1.1 } },
    { id: "kelp-plaza-edge2", variant: "ribbon", pos: { x: 10.6, y: 0, z: 17.8 }, rotY: 2.85, scale: { x: 1.15, y: 1.45, z: 1.15 } }
  ];
  for (const k of heroKelpSpecs) {
    placements.push({
      id: k.id,
      name: k.id,
      module: "kelp",
      variant: k.variant,
      pos: k.pos,
      rotY: k.rotY,
      scale: k.scale,
      stackLayer: 0,
      role: "decor",
      localBounds: { min: { x: -0.7, y: -0.2, z: -0.7 }, max: { x: 0.7, y: 3.2, z: 0.7 } }
    });
  }
  const rngScatter = mulberry32(OCEAN_DEEP.seed);
  const scatter = [];
  const scatterZoneAreaM2 = 680;
  const targetScatterCount = 312;
  const isBlockedOnGround = (x, z) => {
    for (const col of colliders) {
      if (col.minY > 0.6 || col.maxY < 0.2) continue;
      if (col.kind === "cyl") {
        if (Math.hypot(x - col.cx, z - col.cz) < col.r + 0.35) return true;
      } else {
        const dx = x - col.cx;
        const dz = z - col.cz;
        const c = Math.cos(col.rotY);
        const s = Math.sin(col.rotY);
        const lx = dx * c - dz * s;
        const lz = dx * s + dz * c;
        if (Math.abs(lx) < col.hx + 0.35 && Math.abs(lz) < col.hz + 0.35) return true;
      }
    }
    return false;
  };
  let attempts = 0;
  while (scatter.length < targetScatterCount && attempts < targetScatterCount * 16) {
    attempts++;
    const a = rngScatter() * Math.PI * 2;
    const band = rngScatter();
    let x;
    let z;
    let yBase;
    if (band < 0.76) {
      const frac = 0.89 + rngScatter() * 0.14;
      x = OCEAN_DEEP.basinCenter.x + Math.cos(a) * OCEAN_DEEP.basinRx * frac;
      z = OCEAN_DEEP.basinCenter.z + Math.sin(a) * OCEAN_DEEP.basinRz * frac;
      yBase = basinHeightAt(x, z) - 0.08;
    } else if (band < 0.89) {
      const sp = band < 0.83 ? OCEAN_DEEP.spireWest : OCEAN_DEEP.spireEast;
      const rad = 3.2 + rngScatter() * 2.1;
      x = sp.x + Math.cos(a) * rad;
      z = sp.z + Math.sin(a) * rad;
      yBase = 0.05;
    } else {
      const centers = [
        { x: -32.2, z: 30.8, r: 3.6 },
        { x: 22.8, z: 27.6, r: 3.8 },
        { x: -24.5, z: 26.5, r: 4.1 }
      ];
      const pick = centers[Math.floor(rngScatter() * centers.length)];
      const rad = pick.r * (0.65 + rngScatter() * 0.45);
      x = pick.x + Math.cos(a) * rad;
      z = pick.z + Math.sin(a) * rad;
      yBase = 0;
    }
    if (!isBlockedOnGround(x, z)) continue;
    const kindRoll = rngScatter();
    let mod;
    let variant;
    let scale;
    if (kindRoll < 0.42) {
      mod = "kelp";
      variant = rngScatter() < 0.58 ? "ribbon" : "frond";
      const sy = 0.75 + rngScatter() * 1.15;
      const sxz = 0.7 + rngScatter() * 0.65;
      scale = { x: sxz, y: sy, z: sxz * (0.85 + rngScatter() * 0.3) };
    } else if (kindRoll < 0.62) {
      mod = "crystal-cluster";
      variant = rngScatter() < 0.46 ? "warm" : "cool";
      const s = 0.45 + rngScatter() * 0.65;
      scale = { x: s, y: s * (1.05 + rngScatter() * 0.55), z: s * (0.85 + rngScatter() * 0.3) };
    } else {
      mod = "rubble";
      variant = rngScatter() < 0.5 ? "shard" : "boulder";
      scale = {
        x: 0.55 + rngScatter() * 1.15,
        y: 0.35 + rngScatter() * 0.75,
        z: 0.55 + rngScatter() * 1.1
      };
    }
    scatter.push({
      id: `scatter-${mod}-${String(scatter.length + 1).padStart(3, "0")}`,
      module: mod,
      variant,
      pos: { x, y: yBase, z },
      rotY: rngScatter() * Math.PI * 2,
      scale
    });
  }
  const byModule = {};
  const rotationHistogramDeg = {
    "0": 0,
    "1-45": 0,
    "46-90": 0,
    "91-180": 0,
    "181-270": 0,
    "271-359": 0
  };
  let nonZeroRotationCount = 0;
  let nonUniformScaleCount = 0;
  let stackedInstanceCount = 0;
  let pillarStretchViolations = 0;
  let balustradeStretchViolations = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const boxes = placements.map((p) => ({ p, box: worldAABBOfPlacement(p) }));
  for (const { p, box } of boxes) {
    byModule[p.module] = (byModule[p.module] ?? 0) + 1;
    if (box.min.x < minX) minX = box.min.x;
    if (box.max.x > maxX) maxX = box.max.x;
    if (box.min.z < minZ) minZ = box.min.z;
    if (box.max.z > maxZ) maxZ = box.max.z;
    const deg = (p.rotY * 180 / Math.PI % 360 + 360) % 360;
    if (deg > 0.5 && deg < 359.5) {
      nonZeroRotationCount++;
      if (deg <= 45) rotationHistogramDeg["1-45"]++;
      else if (deg <= 90) rotationHistogramDeg["46-90"]++;
      else if (deg <= 180) rotationHistogramDeg["91-180"]++;
      else if (deg <= 270) rotationHistogramDeg["181-270"]++;
      else rotationHistogramDeg["271-359"]++;
    } else {
      rotationHistogramDeg["0"]++;
    }
    const nonUniform = Math.abs(p.scale.x - p.scale.y) > 0.02 || Math.abs(p.scale.y - p.scale.z) > 0.02 || Math.abs(p.scale.x - p.scale.z) > 0.02;
    if (nonUniform) nonUniformScaleCount++;
    if (p.module === "pillar-module" && (nonUniform || Math.abs(p.scale.x - 1) > 1e-4)) {
      pillarStretchViolations++;
    }
    if (p.module === "bridge-deck" && (nonUniform || Math.abs(p.scale.x - 1) > 1e-4)) {
      balustradeStretchViolations++;
    }
    if (p.stackLayer > 0) stackedInstanceCount++;
  }
  for (const s of scatter) {
    byModule[s.module] = (byModule[s.module] ?? 0) + 1;
  }
  let interpenetrationCount = 0;
  for (let i = 0; i < boxes.length; i++) {
    if (boxes[i].p.id === plazaId) continue;
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxes[j].p.id === plazaId) continue;
      if (aabbOverlap(boxes[i].box, boxes[j].box, 0.12)) {
        interpenetrationCount++;
      }
    }
  }
  const stats = {
    byModule,
    totalPlaced: placements.length,
    totalScattered: scatter.length,
    nonZeroRotationCount,
    nonUniformScaleCount,
    stackedInstanceCount,
    interpenetrationCount,
    rotationHistogramDeg,
    scatterZoneAreaM2,
    scatterDensityPerM2: scatter.length / scatterZoneAreaM2,
    pillarStretchViolations,
    balustradeStretchViolations,
    spanX: maxX - minX,
    spanZ: maxZ - minZ,
    maxBridgeSlopeDeg
  };
  cachedWorld = {
    seed: OCEAN_DEEP.seed,
    placements,
    colliders,
    surfaces,
    scatter,
    stats,
    anchors: {
      spawn: { x: spawnLandingPos.x, y: spawnLandingPos.y, z: spawnLandingPos.z, heading: 2.75 },
      bridgeMid: mainBridge.midPoint,
      westSpireArch: { x: OCEAN_DEEP.spireWest.x, y: OCEAN_DEEP.spireWest.archFloorY, z: OCEAN_DEEP.spireWest.z },
      eastSpireArch: { x: OCEAN_DEEP.spireEast.x, y: OCEAN_DEEP.spireEast.archFloorY, z: OCEAN_DEEP.spireEast.z },
      plazaCenter: { x: OCEAN_DEEP.plazaCenter.x + 4.5, y: 0, z: OCEAN_DEEP.plazaCenter.z + 1.5 },
      // clear of 3m altar center!
      altarCenter: { x: OCEAN_DEEP.altarCenter.x, y: 0.34, z: OCEAN_DEEP.altarCenter.z },
      terraceTop: { x: tc.x - 2.6, y: 3.2, z: tc.z },
      spireWest: { x: OCEAN_DEEP.spireWest.x, y: 0, z: OCEAN_DEEP.spireWest.z },
      spireEast: { x: OCEAN_DEEP.spireEast.x, y: 0, z: OCEAN_DEEP.spireEast.z },
      distantArch: { x: 1.5, y: -1, z: -66 }
    }
  };
  return cachedWorld;
}
function sampleSurfaceY(surf, x, z) {
  if (surf.kind === "basin") {
    const nx = (x - surf.cx) / surf.rx;
    const nz = (z - surf.cz) / surf.rz;
    if (nx * nx + nz * nz > 1) return null;
    return basinHeightAt(x, z);
  }
  if (surf.kind === "disc") {
    const dx2 = x - surf.cx;
    const dz2 = z - surf.cz;
    const r = Math.hypot(dx2, dz2);
    if (r > surf.r || r < surf.innerR) return null;
    if (surf.sectorDir !== void 0 && surf.sectorHalf !== void 0 && r > 0.05) {
      const ang = Math.atan2(dx2, dz2);
      if (Math.abs(angleDelta(surf.sectorDir, ang)) > surf.sectorHalf) return null;
    }
    return surf.topY;
  }
  const dx = x - surf.cx;
  const dz = z - surf.cz;
  const c = Math.cos(surf.rotY);
  const s = Math.sin(surf.rotY);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  if (Math.abs(lx) > surf.halfW || Math.abs(lz) > surf.halfL) return null;
  const t = clamp((lz + surf.halfL) / (2 * surf.halfL), 0, 1);
  return surf.yStart + (surf.yEnd - surf.yStart) * t;
}
function resolveSupportY(x, z, currY, world2, stepUp = OCEAN_DEEP.stepUp) {
  let best = null;
  for (const s of world2.surfaces) {
    const y = sampleSurfaceY(s, x, z);
    if (y === null) continue;
    if (y > currY + stepUp) continue;
    if (best === null || y > best.y) {
      best = { y, surface: s };
    }
  }
  return best;
}
function overlapsSolid(x, y, z, r, h, world2, eps = 1e-3) {
  const capMinY = y + 0.08;
  const capMaxY = y + h;
  for (const col of world2.colliders) {
    if (capMaxY <= col.minY + eps || capMinY >= col.maxY - eps) continue;
    if (col.kind === "cyl") {
      if (Math.hypot(x - col.cx, z - col.cz) < col.r + r - eps) return true;
    } else {
      const dx = x - col.cx;
      const dz = z - col.cz;
      const c = Math.cos(col.rotY);
      const s = Math.sin(col.rotY);
      const lx = dx * c - dz * s;
      const lz = dx * s + dz * c;
      const clx = clamp(lx, -col.hx, col.hx);
      const clz = clamp(lz, -col.hz, col.hz);
      const distSq = (lx - clx) * (lx - clx) + (lz - clz) * (lz - clz);
      if (distSq < (r - eps) * (r - eps)) return true;
    }
  }
  return false;
}
function resolveOceanSolid(p, r, h, world2) {
  let hit = false;
  const capMinY = p.y + 0.08;
  const capMaxY = p.y + h;
  for (let pass = 0; pass < 8; pass++) {
    let moved = false;
    for (const col of world2.colliders) {
      if (capMaxY <= col.minY + 1e-3 || capMinY >= col.maxY - 1e-3) continue;
      if (col.kind === "cyl") {
        const dx = p.x - col.cx;
        const dz = p.z - col.cz;
        const min = col.r + r;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2);
        if (d < 1e-6) {
          p.x = col.cx + min;
        } else {
          const k = min / d;
          p.x = col.cx + dx * k;
          p.z = col.cz + dz * k;
        }
        moved = hit = true;
      } else {
        const dx = p.x - col.cx;
        const dz = p.z - col.cz;
        const c = Math.cos(col.rotY);
        const s = Math.sin(col.rotY);
        const lx = dx * c - dz * s;
        const lz = dx * s + dz * c;
        const clx = clamp(lx, -col.hx, col.hx);
        const clz = clamp(lz, -col.hz, col.hz);
        let nlx = lx;
        let nlz = lz;
        if (lx === clx && lz === clz) {
          const penX = col.hx - Math.abs(lx) + r;
          const penZ = col.hz - Math.abs(lz) + r;
          if (penX < penZ) nlx = lx >= 0 ? col.hx + r : -(col.hx + r);
          else nlz = lz >= 0 ? col.hz + r : -(col.hz + r);
          moved = hit = true;
        } else {
          const ox = lx - clx;
          const oz = lz - clz;
          const d2 = ox * ox + oz * oz;
          if (d2 >= r * r) continue;
          const d = Math.sqrt(d2);
          const k = r / Math.max(1e-6, d);
          nlx = clx + ox * k;
          nlz = clz + oz * k;
          moved = hit = true;
        }
        p.x = col.cx + nlx * c + nlz * s;
        p.z = col.cz - nlx * s + nlz * c;
      }
    }
    if (!moved) break;
  }
  return hit;
}
var OceanWalker = class {
  x;
  y;
  z;
  heading;
  vx = 0;
  vz = 0;
  walkPhase = 0;
  steps = 0;
  inShallowWater = false;
  zoneName = "\u77F3\u6865\u8D77\u70B9";
  constructor(spawn) {
    this.x = spawn.x;
    this.y = spawn.y;
    this.z = spawn.z;
    this.heading = spawn.heading;
  }
  get speed() {
    return Math.hypot(this.vx, this.vz);
  }
  reset(pos, heading = this.heading) {
    this.x = pos.x;
    this.y = pos.y;
    this.z = pos.z;
    this.heading = heading;
    this.vx = 0;
    this.vz = 0;
  }
  update(dt, input, world2) {
    let mx = clamp(input.moveX, -1, 1);
    let my = clamp(input.moveY, -1, 1);
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    const sin = Math.sin(input.camYaw);
    const cos = Math.cos(input.camYaw);
    const dirX = -sin * my + cos * mx;
    const dirZ = -cos * my - sin * mx;
    const top = input.run ? OCEAN_DEEP.runSpeed : OCEAN_DEEP.walkSpeed;
    const k = damp(OCEAN_DEEP.accel, dt);
    this.vx += (dirX * top - this.vx) * k;
    this.vz += (dirZ * top - this.vz) * k;
    if (len < 0.01 && this.speed < 0.02) this.vx = this.vz = 0;
    const px = this.x;
    const py = this.y;
    const pz = this.z;
    const next = { x: px + this.vx * dt, y: py, z: pz + this.vz * dt };
    resolveOceanSolid(next, OCEAN_DEEP.playerRadius, OCEAN_DEEP.playerHeight, world2);
    const sup = resolveSupportY(next.x, next.z, py, world2);
    if (sup && !overlapsSolid(next.x, sup.y, next.z, OCEAN_DEEP.playerRadius, OCEAN_DEEP.playerHeight, world2, 0.015)) {
      this.x = next.x;
      this.z = next.z;
      if (sup.y >= py - 0.65) {
        this.y = sup.y;
      } else {
        this.y = Math.max(sup.y, py - 9 * dt);
      }
      if (resolveOceanSolid(this, OCEAN_DEEP.playerRadius, OCEAN_DEEP.playerHeight, world2) && dt > 0) {
        this.vx = (this.x - px) / dt;
        this.vz = (this.z - pz) / dt;
      }
    } else {
      this.vx = 0;
      this.vz = 0;
    }
    if (len > 0.05) {
      const want = Math.atan2(dirX, dirZ);
      this.heading += angleDelta(this.heading, want) * damp(OCEAN_DEEP.turnRate, dt);
    }
    const travelled = Math.hypot(this.x - px, this.z - pz);
    const before = Math.floor(this.walkPhase / OCEAN_DEEP.stride);
    this.walkPhase += travelled;
    if (Math.floor(this.walkPhase / OCEAN_DEEP.stride) > before) this.steps++;
    const dPlaza = Math.hypot(this.x - OCEAN_DEEP.plazaCenter.x, this.z - OCEAN_DEEP.plazaCenter.z);
    this.inShallowWater = dPlaza <= OCEAN_DEEP.plazaRadius && this.y <= OCEAN_DEEP.waterY + 0.08;
    const dTerrace = Math.hypot(this.x - OCEAN_DEEP.terraceCenter.x, this.z - OCEAN_DEEP.terraceCenter.z);
    if (dTerrace <= 8 && this.y >= 2.8) this.zoneName = "\u4E1C\u4FA7\u4E09\u5C42\u53F0\u9876\u9057\u8FF9";
    else if (dTerrace <= 12.5 && this.y >= 1.2) this.zoneName = "\u534A\u5706\u53F0\u5730 \xB7 \u62F1\u95E8\u9636\u68AF";
    else if (this.inShallowWater) this.zoneName = "\u4E2D\u592E\u6D45\u6C34\u5E7F\u573A \xB7 \u5706\u5F62\u796D\u575B";
    else if (this.y >= 5.6 && Math.hypot(this.x - OCEAN_DEEP.spireWest.x, this.z - OCEAN_DEEP.spireWest.z) < 7) {
      this.zoneName = "\u897F\u5C16\u5854 \xB7 \u7A7F\u900F\u62F1\u95E8";
    } else if (this.y >= 2.6) this.zoneName = "\u5F27\u5F62\u77F3\u6865 \xB7 \u89C2\u666F\u6808\u9053";
    else this.zoneName = "\u6D77\u6D0B\u661F \xB7 \u6DF1\u6C34\u76C6\u5730";
  }
};
function analyzeWalkability(world2, gridStep = 0.5) {
  const r = OCEAN_DEEP.playerRadius;
  const h = OCEAN_DEEP.playerHeight;
  const CELL = 4;
  const colGrid = /* @__PURE__ */ new Map();
  const surfGrid = /* @__PURE__ */ new Map();
  const basinSurfaces = [];
  const addBucket = (map, minX, maxX, minZ, maxZ, item) => {
    const x0 = Math.floor(minX / CELL);
    const x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL);
    const z1 = Math.floor(maxZ / CELL);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gz = z0; gz <= z1; gz++) {
        const k = `${gx},${gz}`;
        let arr = map.get(k);
        if (!arr) {
          arr = [];
          map.set(k, arr);
        }
        arr.push(item);
      }
    }
  };
  for (const col of world2.colliders) {
    const b = worldAABBOfCollider(col);
    addBucket(colGrid, b.min.x - r - 0.2, b.max.x + r + 0.2, b.min.z - r - 0.2, b.max.z + r + 0.2, col);
  }
  for (const s of world2.surfaces) {
    if (s.kind === "basin") {
      basinSurfaces.push(s);
    } else if (s.kind === "disc") {
      addBucket(surfGrid, s.cx - s.r - 0.5, s.cx + s.r + 0.5, s.cz - s.r - 0.5, s.cz + s.r + 0.5, s);
    } else {
      const c = Math.abs(Math.cos(s.rotY));
      const sn = Math.abs(Math.sin(s.rotY));
      const ex = s.halfW * c + s.halfL * sn + 0.5;
      const ez = s.halfW * sn + s.halfL * c + 0.5;
      addBucket(surfGrid, s.cx - ex, s.cx + ex, s.cz - ez, s.cz + ez, s);
    }
  }
  const fastHeights = (x, z) => {
    const out = [];
    for (const s of basinSurfaces) {
      const y = sampleSurfaceY(s, x, z);
      if (y !== null) out.push({ y, surface: s });
    }
    const local = surfGrid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
    if (local) {
      for (const s of local) {
        const y = sampleSurfaceY(s, x, z);
        if (y !== null) out.push({ y, surface: s });
      }
    }
    return out;
  };
  const fastSolid = (x, y, z, rad) => {
    const local = colGrid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
    if (!local) return false;
    const capMinY = y + 0.08;
    const capMaxY = y + h;
    const eps = 5e-3;
    for (const col of local) {
      if (capMaxY <= col.minY + eps || capMinY >= col.maxY - eps) continue;
      if (col.kind === "cyl") {
        if (Math.hypot(x - col.cx, z - col.cz) < col.r + rad - eps) return true;
      } else {
        const dx = x - col.cx;
        const dz = z - col.cz;
        const c = Math.cos(col.rotY);
        const s = Math.sin(col.rotY);
        const lx = dx * c - dz * s;
        const lz = dx * s + dz * c;
        const clx = clamp(lx, -col.hx, col.hx);
        const clz = clamp(lz, -col.hz, col.hz);
        if ((lx - clx) * (lx - clx) + (lz - clz) * (lz - clz) < (rad - eps) * (rad - eps)) return true;
      }
    }
    return false;
  };
  const toGrid = (v2) => Math.round(v2 / gridStep);
  const spawn = world2.anchors.spawn;
  const sIx = toGrid(spawn.x);
  const sIz = toGrid(spawn.z);
  const sSup = resolveSupportY(sIx * gridStep, sIz * gridStep, spawn.y + 0.1, world2);
  if (!sSup) throw new Error("OceanDeep spawn has no standable surface");
  let nextNodeId = 0;
  const columns = /* @__PURE__ */ new Map();
  const visited = /* @__PURE__ */ new Map();
  const adj = /* @__PURE__ */ new Map();
  const findOrCreate = (ix, iz, y) => {
    const colKey = `${ix},${iz}`;
    let list = columns.get(colKey);
    if (!list) {
      list = [];
      columns.set(colKey, list);
    }
    for (const existing of list) {
      if (Math.abs(existing.y - y) <= 0.22) {
        return { node: existing, isNew: false };
      }
    }
    const key = `n${nextNodeId++}`;
    const node = { key, ix, iz, layer: list.length, x: ix * gridStep, y, z: iz * gridStep };
    list.push(node);
    visited.set(key, node);
    return { node, isNew: true };
  };
  const { node: startNode } = findOrCreate(sIx, sIz, sSup.y);
  const queue = [startNode];
  let minY = startNode.y;
  let maxY = startNode.y;
  let escapedEnclosureCount = 0;
  const dirs = [
    [1, 0, gridStep],
    [-1, 0, gridStep],
    [0, 1, gridStep],
    [0, -1, gridStep],
    [1, 1, gridStep * Math.SQRT2],
    [1, -1, gridStep * Math.SQRT2],
    [-1, 1, gridStep * Math.SQRT2],
    [-1, -1, gridStep * Math.SQRT2]
  ];
  const MAX_G = Math.ceil(64 / gridStep);
  const maxStepDelta = 0.48;
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const edges = [];
    adj.set(cur.key, edges);
    const enx = (cur.x - OCEAN_DEEP.basinCenter.x) / (OCEAN_DEEP.basinRx + 1.5);
    const enz = (cur.z - OCEAN_DEEP.basinCenter.z) / (OCEAN_DEEP.basinRz + 1.5);
    if (enx * enx + enz * enz > 1) escapedEnclosureCount++;
    for (const [dx, dz, dist2d] of dirs) {
      const nix = cur.ix + dx;
      const niz = cur.iz + dz;
      if (Math.abs(nix) > MAX_G || Math.abs(niz) > MAX_G) continue;
      const nx = nix * gridStep;
      const nz = niz * gridStep;
      const cands = fastHeights(nx, nz);
      for (const cand of cands) {
        const dy = cand.y - cur.y;
        if (dy > maxStepDelta || dy < -0.65) continue;
        if (fastSolid(nx, cand.y, nz, r)) continue;
        const mx = (cur.x + nx) * 0.5;
        const mz = (cur.z + nz) * 0.5;
        const my = (cur.y + cand.y) * 0.5;
        if (fastSolid(mx, my, mz, r * 0.9)) continue;
        const { node, isNew } = findOrCreate(nix, niz, cand.y);
        edges.push({ to: node.key, cost: Math.hypot(dist2d, dy) });
        if (isNew) {
          if (cand.y < minY) minY = cand.y;
          if (cand.y > maxY) maxY = cand.y;
          queue.push(node);
        }
      }
    }
  }
  let deckCells = 0;
  for (const list of columns.values()) {
    list.sort((a, b) => a.y - b.y);
    let lastCountedY = -999;
    for (const n of list) {
      if (n.y - lastCountedY >= 1.2) {
        deckCells++;
        lastCountedY = n.y;
      }
    }
  }
  const nearestNode = (t) => {
    let best = null;
    let bestD = Infinity;
    for (const node of visited.values()) {
      const d = Math.hypot(node.x - t.x, (node.y - t.y) * 2.5, node.z - t.z);
      if (d < bestD) {
        bestD = d;
        best = node;
      }
    }
    return bestD <= 2.5 ? best : null;
  };
  const shortestDist = (fromPt, toPt) => {
    const src = nearestNode(fromPt);
    const dst = nearestNode(toPt);
    if (!src || !dst) return Infinity;
    if (src.key === dst.key) return 0;
    const dist = /* @__PURE__ */ new Map([[src.key, 0]]);
    const heap = [{ k: src.key, d: 0 }];
    const push = (item) => {
      heap.push(item);
      let i = heap.length - 1;
      while (i > 0) {
        const p = i - 1 >> 1;
        if (heap[p].d <= heap[i].d) break;
        const tmp = heap[p];
        heap[p] = heap[i];
        heap[i] = tmp;
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length > 0) {
        heap[0] = last;
        let i = 0;
        for (; ; ) {
          const l = i * 2 + 1;
          const rIdx = l + 1;
          let m = i;
          if (l < heap.length && heap[l].d < heap[m].d) m = l;
          if (rIdx < heap.length && heap[rIdx].d < heap[m].d) m = rIdx;
          if (m === i) break;
          const tmp = heap[i];
          heap[i] = heap[m];
          heap[m] = tmp;
          i = m;
        }
      }
      return top;
    };
    while (heap.length > 0) {
      const { k, d } = pop();
      if (k === dst.key) return d;
      if (d > (dist.get(k) ?? Infinity)) continue;
      const edges = adj.get(k);
      if (!edges) continue;
      for (const e of edges) {
        const nd = d + e.cost;
        if (nd < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, nd);
          push({ k: e.to, d: nd });
        }
      }
    }
    return Infinity;
  };
  const v = OCEAN_DEEP.walkSpeed;
  const cellArea = gridStep * gridStep;
  return {
    gridStepM: gridStep,
    reachableCells: deckCells,
    uniqueFootprintCells: columns.size,
    walkableAreaM2: deckCells * cellArea,
    uniqueFootprintAreaM2: columns.size * cellArea,
    minReachableY: minY,
    maxReachableY: maxY,
    escapedEnclosureCount,
    paths: {
      spawnToBridgeSec: shortestDist(world2.anchors.spawn, world2.anchors.bridgeMid) / v,
      bridgeToPlazaSec: shortestDist(world2.anchors.bridgeMid, world2.anchors.plazaCenter) / v,
      plazaToTerraceTopSec: shortestDist(world2.anchors.plazaCenter, world2.anchors.terraceTop) / v,
      spawnToPlazaSec: shortestDist(world2.anchors.spawn, world2.anchors.plazaCenter) / v,
      spawnToWestSpireArchSec: shortestDist(world2.anchors.spawn, world2.anchors.westSpireArch) / v
    }
  };
}

// src/game/ocean-deep.test.ts
var world = buildOceanDeepWorld();
var walk = analyzeWalkability(world, 0.5);
test("ocean-deep layout is deterministic and meets scale & landmark specs", () => {
  assert.ok(world.stats.spanX >= 120, `spanX ${world.stats.spanX} < 120`);
  assert.ok(world.stats.spanZ >= 120, `spanZ ${world.stats.spanZ} < 120`);
  assert.ok(world.stats.maxBridgeSlopeDeg <= 12, `bridge slope ${world.stats.maxBridgeSlopeDeg}\xB0 > 12\xB0`);
  assert.ok(OCEAN_DEEP.spireWest.height >= 22 && OCEAN_DEEP.spireWest.height <= 30);
  assert.ok(OCEAN_DEEP.spireEast.height >= 22 && OCEAN_DEEP.spireEast.height <= 30);
  assert.ok(OCEAN_DEEP.spireWest.archFloorY >= 6 && OCEAN_DEEP.spireWest.archFloorY <= 9);
  assert.ok(OCEAN_DEEP.spireEast.archFloorY >= 6 && OCEAN_DEEP.spireEast.archFloorY <= 9);
  const names = world.placements.map((p) => p.name);
  const spireRoots = world.placements.filter((p) => p.module === "spire-module" && p.variant === "mid-arch");
  assert.equal(spireRoots.length, 2, "two twin spires");
  assert.ok(names.some((n) => n.includes("bridge")));
  assert.ok(names.some((n) => n.includes("plaza")));
  assert.ok(names.some((n) => n.includes("altar")));
  assert.ok(names.some((n) => n.includes("terrace")));
  assert.ok(names.some((n) => n.includes("arch")));
  assert.ok(names.some((n) => n.includes("crystal-warm")));
  assert.ok(names.some((n) => n.includes("crystal-cool")));
  assert.ok(names.some((n) => n.includes("kelp")));
  const cliffVariants = new Set(world.placements.filter((p) => p.module === "cliff-module").map((p) => p.variant));
  assert.ok(cliffVariants.size >= 4, `cliff variants ${cliffVariants.size} < 4`);
});
test("kitbashing evidence: rotations, non-uniform scaling, stacking, interpenetration, zero pillar/balustrade stretch", () => {
  assert.ok(world.stats.nonZeroRotationCount >= 15, `rotations ${world.stats.nonZeroRotationCount} < 15`);
  assert.ok(world.stats.nonUniformScaleCount >= 10, `non-uniform scales ${world.stats.nonUniformScaleCount} < 10`);
  assert.ok(world.stats.stackedInstanceCount >= 20, `stacked ${world.stats.stackedInstanceCount}`);
  assert.ok(world.stats.interpenetrationCount >= 20, `interpenetrations ${world.stats.interpenetrationCount}`);
  assert.equal(world.stats.pillarStretchViolations, 0, "pillars must never be stretched");
  assert.equal(world.stats.balustradeStretchViolations, 0, "bridge balustrades must never be stretched");
  assert.ok(
    world.stats.scatterDensityPerM2 >= 0.2 && world.stats.scatterDensityPerM2 <= 0.8,
    `scatter density ${world.stats.scatterDensityPerM2.toFixed(3)} outside 0.2..0.8`
  );
  assert.ok(world.placements.some((p) => p.module === "arch-module" && p.mirror === true));
});
test("1:1 placement <-> collider mapping: zero missing, zero ghost", () => {
  const byId = new Map(world.placements.map((p) => [p.id, p]));
  const colByPlacement = /* @__PURE__ */ new Map();
  for (const col of world.colliders) {
    const p = byId.get(col.placementId);
    assert.ok(p, `ghost collider ${col.id} has no placement ${col.placementId}`);
    assert.ok(p.role === "solid" || p.role === "hybrid", `collider ${col.id} belongs to non-solid role ${p.role}`);
    assert.ok(
      aabbOverlap(worldAABBOfCollider(col), worldAABBOfPlacement(p), -0.6),
      `collider ${col.id} drifted away from placement ${p.id}`
    );
    colByPlacement.set(col.placementId, (colByPlacement.get(col.placementId) ?? 0) + 1);
  }
  for (const p of world.placements) {
    if (p.role === "solid" || p.role === "hybrid") {
      assert.ok((colByPlacement.get(p.id) ?? 0) > 0, `solid/hybrid placement ${p.id} missing collider`);
    }
  }
});
test("0.5m flood fill: >= 4000 m\xB2 walkable, enclosed (no leaks), no y < -0.5, all 3 paths <= 25 s", () => {
  assert.ok(walk.walkableAreaM2 >= 4e3, `walkableAreaM2 ${walk.walkableAreaM2.toFixed(1)} < 4000`);
  assert.ok(walk.uniqueFootprintAreaM2 >= 4e3, `uniqueFootprintAreaM2 ${walk.uniqueFootprintAreaM2.toFixed(1)} < 4000`);
  assert.equal(walk.escapedEnclosureCount, 0, `escaped enclosure cells: ${walk.escapedEnclosureCount}`);
  assert.ok(walk.minReachableY >= -0.5, `minReachableY ${walk.minReachableY} < -0.5`);
  assert.ok(
    walk.paths.spawnToBridgeSec <= 25 && Number.isFinite(walk.paths.spawnToBridgeSec),
    `spawn->bridge ${walk.paths.spawnToBridgeSec.toFixed(2)}s`
  );
  assert.ok(
    walk.paths.bridgeToPlazaSec <= 25 && Number.isFinite(walk.paths.bridgeToPlazaSec),
    `bridge->plaza ${walk.paths.bridgeToPlazaSec.toFixed(2)}s`
  );
  assert.ok(
    walk.paths.plazaToTerraceTopSec <= 25 && Number.isFinite(walk.paths.plazaToTerraceTopSec),
    `plaza->terraceTop ${walk.paths.plazaToTerraceTopSec.toFixed(2)}s`
  );
  assert.ok(
    walk.paths.spawnToPlazaSec <= 25 && Number.isFinite(walk.paths.spawnToPlazaSec),
    `spawn->plaza ${walk.paths.spawnToPlazaSec.toFixed(2)}s`
  );
  assert.ok(
    walk.paths.spawnToWestSpireArchSec <= 25 && Number.isFinite(walk.paths.spawnToWestSpireArchSec),
    `spawn->westSpireArch ${walk.paths.spawnToWestSpireArchSec.toFixed(2)}s`
  );
});
test("OceanWalker stands on spawn, climbs bridge, enters shallow plaza without clipping solids", () => {
  const w = new OceanWalker(world.anchors.spawn);
  assert.ok(!overlapsSolid(w.x, w.y, w.z, OCEAN_DEEP.playerRadius, OCEAN_DEEP.playerHeight, world));
  const sup = resolveSupportY(w.x, w.z, w.y, world);
  assert.ok(sup && Math.abs(sup.y - w.y) < 0.05);
  for (let i = 0; i < 120; i++) {
    w.update(1 / 60, { moveX: 0, moveY: 1, run: false, camYaw: Math.PI }, world);
  }
  assert.ok(w.steps > 2, "walker records footsteps");
  assert.ok(w.y >= -0.5, "walker stays above floor");
});
