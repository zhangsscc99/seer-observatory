// Playable Ocean Planet "Deep Water Zone" (海洋星 · 深水区) scene builder,
// underwater atmosphere/lighting/god-rays/fish-schools, third-person walker
// runtime, and live 3D collision/raycast verification hooks.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CABIN } from '../game/cabin.ts';
import {
  analyzeWalkability,
  basinHeightAt,
  buildOceanDeepWorld,
  OCEAN_DEEP,
  OceanWalker,
  worldAABBOfCollider,
  type FloodFillReport,
  type OceanDeepWorld,
  type Placement,
  type Vec3,
} from '../game/ocean-deep.ts';
import { clamp, mulberry32 } from '../game/rng.ts';
import {
  createAltarModule,
  createArchModule,
  createBridgeDeck,
  createKelpModule,
  createSpireModule,
  createStairModule,
  createTerraceModule,
  getCliffGeometry,
  getCrystalClusterGeometry,
  getCrystalPlinthGeometry,
  getKelpGeometry,
  getOceanMaterials,
  getPillarGeometry,
  getRubbleGeometry,
  type ArchVariant,
  type CliffVariant,
  type KelpVariant,
  type OceanMaterials,
  type SpireVariant,
} from './assets/ocean/index.ts';
import { radialTexture } from './textures.ts';

export interface CameraPreset {
  name: string;
  label: string;
  pos: [number, number, number];
  lookAt: [number, number, number];
  fov: number;
}

export const OCEAN_CAMERA_PRESETS: readonly CameraPreset[] = [
  {
    name: 'spires-front',
    label: '双尖塔正面',
    pos: [-23.5, 11.2, 33.5],
    lookAt: [1.5, 9.2, -16.0],
    fov: 62,
  },
  {
    name: 'bridge-view',
    label: '石桥视角',
    pos: [-27.8, 6.2, 23.8],
    lookAt: [-20.5, 7.6, -9.5],
    fov: 60,
  },
  {
    name: 'plaza-altar',
    label: '浅水广场与祭坛',
    pos: [-11.5, 4.6, 17.8],
    lookAt: [1.8, 3.2, 1.0],
    fov: 60,
  },
  {
    name: 'terrace-ruins',
    label: '半圆台地',
    pos: [2.5, 5.8, 15.2],
    lookAt: [25.5, 4.0, 1.5],
    fov: 58,
  },
  {
    name: 'volumetric-godrays',
    label: '顶部体积光',
    pos: [-1.5, 3.2, 16.5],
    lookAt: [1.0, 26.5, -18.0],
    fov: 74,
  },
  {
    name: 'bridge-panorama',
    label: '从桥上看全景',
    pos: [-26.6, 7.6, 7.8],
    lookAt: [7.5, 4.2, -1.2],
    fov: 66,
  },
];

interface FishAnim {
  baseX: number;
  baseY: number;
  baseZ: number;
  radius: number;
  speed: number;
  phase: number;
  scale: number;
  dir: number;
}

interface PlacementHandle {
  obj: THREE.Object3D;
  /** Present when placement is rendered inside a batched InstancedMesh */
  instanced?: { mesh: THREE.InstancedMesh; index: number };
  /** Present when placement was merged into a static world-space chain mesh */
  bakedBox?: THREE.Box3;
}

interface BuiltOceanScene {
  group: THREE.Group;
  mats: OceanMaterials;
  fishMesh: THREE.InstancedMesh;
  fishData: FishAnim[];
  placementObjects: Map<string, PlacementHandle>;
  walkableMeshes: THREE.Mesh[];
  update(t: number, playerX: number, playerY: number, playerZ: number): void;
}

function tagTree(obj: THREE.Object3D, placement: Placement): void {
  obj.name = placement.name;
  obj.userData.placementId = placement.id;
  obj.userData.role = placement.role;
  obj.userData.module = placement.module;
  obj.userData.variant = placement.variant;
  obj.traverse((child) => {
    child.userData.placementId = placement.id;
    child.userData.role = placement.role;
    child.userData.module = placement.module;
    child.userData.variant = placement.variant;
  });
}

function buildSeabedMesh(mats: OceanMaterials): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(122, 122, 24, 24);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i) + OCEAN_DEEP.plazaCenter.z;
    pos.setY(i, basinHeightAt(x, z));
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mats.plazaFloor);
  mesh.position.set(OCEAN_DEEP.plazaCenter.x, 0, OCEAN_DEEP.plazaCenter.z);
  return mesh;
}

/** Reverse triangle winding on a non-indexed BufferGeometry after negative-determinant (mirrored) transform. */
function flipWinding(geo: THREE.BufferGeometry): void {
  const attrs = Object.values(geo.attributes);
  const count = geo.attributes.position.count;
  for (const attr of attrs) {
    const itemSize = attr.itemSize;
    const arr = attr.array as Float32Array;
    for (let i = 0; i + 2 < count; i += 3) {
      const i1 = (i + 1) * itemSize;
      const i2 = (i + 2) * itemSize;
      for (let k = 0; k < itemSize; k++) {
        const tmp = arr[i1 + k];
        arr[i1 + k] = arr[i2 + k];
        arr[i2 + k] = tmp;
      }
    }
    attr.needsUpdate = true;
  }
  geo.computeVertexNormals();
}

function buildDistantAqueduct(mats: OceanMaterials): THREE.Mesh {
  // Monumental silhouetted stone aqueduct spanning the misty north valley behind the twin spires (1 merged draw call!)
  const parts: THREE.BufferGeometry[] = [];
  const pushMesh = (m: THREE.Mesh, flip = false): void => {
    m.updateMatrix();
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrix);
    const ni = g.index ? g.toNonIndexed() : g;
    if (flip) flipWinding(ni);
    parts.push(ni);
  };
  const centerArch = createArchModule('wide', false);
  centerArch.scale.set(2.8, 2.7, 2.2);
  pushMesh(centerArch);
  for (const sx of [-1, 1]) {
    const flank = createArchModule('narrow', sx < 0);
    flank.position.set(sx * 16.5, -0.8, 1.5);
    flank.scale.set(sx < 0 ? -2.2 : 2.2, 2.0, 2.0);
    pushMesh(flank, sx < 0);
  }
  const beamGeo = new THREE.BoxGeometry(52, 2.2, 3.6);
  beamGeo.translate(0, 18.4, 0.5);
  const bn = beamGeo.toNonIndexed();
  const cnt = bn.attributes.position.count;
  const cols = new Float32Array(cnt * 3).fill(0.72);
  bn.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  parts.push(bn);
  beamGeo.dispose();

  const merged = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  return new THREE.Mesh(merged, mats.limestoneMoss);
}

function buildGodRays(mats: OceanMaterials): THREE.Mesh {
  const shafts: THREE.BufferGeometry[] = [];
  const specs: [number, number, number, number, number, number][] = [
    // [x, z, rTop, rBot, tiltZ, tiltX]
    [0.5, -10, 3.4, 8.8, -0.18, 0.08],
    [-6.5, -4, 2.6, 7.2, -0.22, 0.1],
    [7.2, -8, 2.8, 7.6, -0.16, 0.06],
    [1.8, 4.5, 3.0, 8.2, -0.2, 0.05],
    [-11.5, 6.5, 2.2, 5.8, -0.24, 0.11],
    [12.8, 2.5, 2.4, 6.2, -0.15, 0.08],
    [0.0, -26, 3.6, 9.6, -0.14, 0.04],
  ];
  const h = 47;
  for (const [x, z, rt, rb, tz, tx] of specs) {
    const c = new THREE.CylinderGeometry(rt, rb, h, 10, 1, true);
    c.rotateZ(tz);
    c.rotateX(tx);
    c.translate(x, h * 0.5 + 0.5, z);
    shafts.push(c.toNonIndexed());
    c.dispose();
  }
  const merged = mergeGeometries(shafts, false)!;
  shafts.forEach((s) => s.dispose());
  const mesh = new THREE.Mesh(merged, mats.godRay);
  mesh.name = 'godrays';
  mesh.renderOrder = 4;
  return mesh;
}

function buildFishSchool(mats: OceanMaterials): { mesh: THREE.InstancedMesh; data: FishAnim[] } {
  // Lightweight crisp 2-fin silhouette fish (6 triangles)
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.42);
  shape.lineTo(0.14, 0.1);
  shape.lineTo(0.06, -0.22);
  shape.lineTo(0.18, -0.44);
  shape.lineTo(0, -0.32);
  shape.lineTo(-0.18, -0.44);
  shape.lineTo(-0.06, -0.22);
  shape.lineTo(-0.14, 0.1);
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape, 1);
  geo.rotateX(Math.PI / 2);

  const count = 68;
  const mesh = new THREE.InstancedMesh(geo, mats.fishSilhouette, count);
  mesh.name = 'fish-school';
  const rnd = mulberry32(OCEAN_DEEP.seed + 777);
  const data: FishAnim[] = [];
  for (let i = 0; i < count; i++) {
    const westSchool = i < 34;
    const baseX = (westSchool ? -20 : 22) + (rnd() - 0.5) * 16;
    const baseY = 23.5 + rnd() * 11.5;
    const baseZ = -22 - rnd() * 24;
    data.push({
      baseX,
      baseY,
      baseZ,
      radius: 4.5 + rnd() * 7.5,
      speed: 0.14 + rnd() * 0.12,
      phase: rnd() * Math.PI * 2,
      scale: 0.75 + rnd() * 0.95,
      dir: westSchool ? 1 : -1,
    });
  }
  return { mesh, data };
}

function buildGlowHaloPoints(world: OceanDeepWorld): THREE.Points {
  // Single draw-call warm/cool lantern & crystal bloom halos around key emissive points
  const positions: number[] = [];
  const colors: number[] = [];
  const warmCol = new THREE.Color(0xffbe55);
  const coolCol = new THREE.Color(0x38f2ff);
  // Altar core glow
  positions.push(OCEAN_DEEP.altarCenter.x, 1.9, OCEAN_DEEP.altarCenter.z);
  colors.push(warmCol.r, warmCol.g, warmCol.b);

  for (const p of world.placements) {
    if (p.module !== 'crystal-cluster') continue;
    positions.push(p.pos.x, p.pos.y + 1.15 * p.scale.y, p.pos.z);
    const c = p.variant === 'warm' ? warmCol : coolCol;
    colors.push(c.r, c.g, c.b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const tex = radialTexture([
    [0, 'rgba(255,255,255,0.85)'],
    [0.32, 'rgba(255,244,210,0.40)'],
    [1, 'rgba(255,220,160,0)'],
  ]);
  const mat = new THREE.PointsMaterial({
    size: 2.8,
    map: tex,
    vertexColors: true,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const pts = new THREE.Points(geo, mat);
  pts.name = 'crystal-glow-halos';
  pts.renderOrder = 3;
  return pts;
}

export function buildOceanDeepScene(world: OceanDeepWorld): BuiltOceanScene {
  const mats = getOceanMaterials();
  const group = new THREE.Group();
  group.name = 'ocean-deep-scene';

  const placementObjects = new Map<string, PlacementHandle>();
  const walkableMeshes: THREE.Mesh[] = [];

  // 1. Seabed + Central Shallow Water Plaza (R = 14m, water depth 0.12m)
  const plazaPlacement = world.placements.find((p) => p.id === 'plaza-shallow')!;
  const seabed = buildSeabedMesh(mats);
  tagTree(seabed, plazaPlacement);
  group.add(seabed);
  placementObjects.set(plazaPlacement.id, { obj: seabed });
  walkableMeshes.push(seabed);

  const waterGeo = new THREE.CircleGeometry(15.6, 36);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMesh = new THREE.Mesh(waterGeo, mats.plazaWater);
  waterMesh.name = 'plaza-water';
  waterMesh.position.set(OCEAN_DEEP.plazaCenter.x, OCEAN_DEEP.waterY, OCEAN_DEEP.plazaCenter.z);
  waterMesh.renderOrder = 2;
  group.add(waterMesh);

  // Batch static paving/limestone groups (30 bridge decks -> 3 chains, 6 stairs -> 1 mesh,
  // 7 terraces -> 1 stone + 1 glow mesh, 5 basin arches -> 1 mesh) to keep total draw calls ~25
  // while recording each placement's exact world Box3 for genuine 1:1 collider verification!
  const bridgeTrimGeos: THREE.BufferGeometry[] = [];
  const bridgeChainGeos = new Map<string, { geos: THREE.BufferGeometry[]; placements: Placement[] }>();
  const stairGeos: THREE.BufferGeometry[] = [];
  const stairPlacements: Placement[] = [];
  const terraceGeos: THREE.BufferGeometry[] = [];
  const terracePlacements: Placement[] = [];
  const archGeos: THREE.BufferGeometry[] = [];
  const archPlacements: Placement[] = [];
  const cliffBuckets: Record<CliffVariant, Placement[]> = {
    straight: [],
    concave: [],
    convex: [],
    portal: [],
  };
  const pillarBuckets: Record<number, Placement[]> = { 1: [], 2: [], 3: [] };
  const crystalHeroBuckets: Record<'warm' | 'cool', Placement[]> = { warm: [], cool: [] };
  const kelpHeroBuckets: Record<KelpVariant, Placement[]> = { ribbon: [], frond: [] };
  const tmpM4 = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpP = new THREE.Vector3();
  const tmpS = new THREE.Vector3();
  const tmpUp = new THREE.Vector3(0, 1, 0);

  for (const p of world.placements) {
    if (p.id === 'plaza-shallow') continue;
    if (p.module === 'cliff-module') {
      cliffBuckets[p.variant as CliffVariant].push(p);
      continue;
    }
    if (p.module === 'pillar-module') {
      const seg = (p.segments ?? 3) <= 1 ? 1 : p.segments === 2 ? 2 : 3;
      pillarBuckets[seg].push(p);
      continue;
    }
    if (p.module === 'crystal-cluster') {
      crystalHeroBuckets[p.variant === 'warm' ? 'warm' : 'cool'].push(p);
      continue;
    }
    if (p.module === 'kelp') {
      kelpHeroBuckets[p.variant === 'frond' ? 'frond' : 'ribbon'].push(p);
      continue;
    }
    tmpP.set(p.pos.x, p.pos.y, p.pos.z);
    tmpQ.setFromAxisAngle(tmpUp, p.rotY);
    tmpS.set(p.scale.x * (p.mirror ? -1 : 1), p.scale.y, p.scale.z);
    tmpM4.compose(tmpP, tmpQ, tmpS);

    if (p.module === 'bridge-deck') {
      const built = createBridgeDeck({
        width: Number(p.meta?.width ?? OCEAN_DEEP.bridgeWidth),
        length: Number(p.meta?.length ?? 3.2),
        yStart: Number(p.meta?.yStart ?? p.pos.y),
        yEnd: Number(p.meta?.yEnd ?? p.pos.y),
        hasPier: Boolean(p.meta?.hasPier),
        pierHeight: Number(p.meta?.pierHeight ?? p.pos.y),
      });
      const trim = built.getObjectByName('bridge-gold-trim') as THREE.Mesh | undefined;
      if (trim) {
        const gClone = trim.geometry.clone();
        gClone.applyMatrix4(tmpM4);
        bridgeTrimGeos.push(gClone);
        trim.geometry.dispose();
      }
      const stone = built.getObjectByName('bridge-stone') as THREE.Mesh | undefined;
      if (stone) {
        const sClone = stone.geometry.clone();
        sClone.applyMatrix4(tmpM4);
        const chainKey = p.id.replace(/-seg-\d+$/, '');
        let bucket = bridgeChainGeos.get(chainKey);
        if (!bucket) {
          bucket = { geos: [], placements: [] };
          bridgeChainGeos.set(chainKey, bucket);
        }
        bucket.geos.push(sClone);
        bucket.placements.push(p);
        stone.geometry.dispose();
      }
      continue;
    }
    if (p.module === 'stair-module') {
      const st = createStairModule({
        width: Number(p.meta?.width ?? 2.8),
        length: Number(p.meta?.length ?? 4.5),
        steps: Number(p.meta?.steps ?? 5),
        yStart: Number(p.meta?.yStart ?? 0),
        yEnd: Number(p.meta?.yEnd ?? 1.6),
      });
      const gClone = st.geometry.clone();
      gClone.applyMatrix4(tmpM4);
      stairGeos.push(gClone);
      stairPlacements.push(p);
      st.geometry.dispose();
      continue;
    }
    if (p.module === 'terrace-module') {
      const tg = createTerraceModule({
        radius: Number(p.meta?.radius ?? 7.2),
        height: Number(p.meta?.height ?? 1.6),
        fullDisc: Boolean(p.meta?.fullDisc),
        tier: Number(p.meta?.tier ?? 0),
      });
      const stoneMesh = tg.children[0] as THREE.Mesh | undefined;
      if (stoneMesh) {
        const gClone = stoneMesh.geometry.clone();
        gClone.applyMatrix4(tmpM4);
        terraceGeos.push(gClone);
        terracePlacements.push(p);
        stoneMesh.geometry.dispose();
      }
      const glowMesh = tg.children[1] as THREE.Mesh | undefined;
      if (glowMesh) {
        const gClone = glowMesh.geometry.clone();
        gClone.applyMatrix4(tmpM4);
        bridgeTrimGeos.push(gClone);
        glowMesh.geometry.dispose();
      }
      continue;
    }
    if (p.module === 'arch-module' && p.id !== 'arch-distant-aqueduct') {
      const am = createArchModule(p.variant as ArchVariant, false);
      const gClone = am.geometry.clone();
      gClone.applyMatrix4(tmpM4);
      if (p.mirror) flipWinding(gClone);
      archGeos.push(gClone);
      archPlacements.push(p);
      continue;
    }

    let obj: THREE.Object3D;
    if (p.module === 'spire-module') {
      obj = createSpireModule(p.variant as SpireVariant, {
        archFloorY: typeof p.meta?.archFloorY === 'number' ? p.meta.archFloorY : undefined,
        height: typeof p.meta?.height === 'number' ? p.meta.height : undefined,
        cantX: typeof p.meta?.cantX === 'number' ? p.meta.cantX : undefined,
      });
    } else if (p.module === 'arch-module') {
      obj = buildDistantAqueduct(mats);
    } else if (p.module === 'altar-module') {
      obj = createAltarModule(Number(p.meta?.radius ?? 3.0));
    } else {
      obj = createKelpModule(p.variant as KelpVariant);
    }

    obj.position.set(p.pos.x, p.pos.y, p.pos.z);
    obj.rotation.y = p.rotY;
    const mx = obj.scale.x < 0 ? -1 : 1;
    obj.scale.set(p.scale.x * mx, p.scale.y, p.scale.z);
    tagTree(obj, p);
    group.add(obj);
    placementObjects.set(p.id, { obj });

    if (p.role === 'walkable' || p.role === 'hybrid') {
      obj.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          walkableMeshes.push(child as THREE.Mesh);
        }
      });
    }
  }

  const commitMergedBatch = (
    name: string,
    geos: THREE.BufferGeometry[],
    items: Placement[],
    mat: THREE.Material,
    walkable: boolean,
  ): void => {
    if (geos.length === 0) return;
    const segBoxes = geos.map((g) => {
      g.computeBoundingBox();
      return g.boundingBox!.clone();
    });
    const merged = mergeGeometries(geos, false)!;
    geos.forEach((g) => g.dispose());
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = name;
    group.add(mesh);
    if (walkable) walkableMeshes.push(mesh);
    items.forEach((p, idx) => {
      placementObjects.set(p.id, { obj: mesh, bakedBox: segBoxes[idx] });
    });
  };

  // Merge all bridge stone decks into 1 crisp mesh (`bridge-main`, saves 2 more calls while keeping exact per-segment Box3!)
  const allBridgeGeos: THREE.BufferGeometry[] = [];
  const allBridgePlacements: Placement[] = [];
  for (const [, bucket] of bridgeChainGeos) {
    allBridgeGeos.push(...bucket.geos);
    allBridgePlacements.push(...bucket.placements);
  }
  commitMergedBatch('bridge-main', allBridgeGeos, allBridgePlacements, mats.paving, true);
  commitMergedBatch('stair-flights-batch', stairGeos, stairPlacements, mats.paving, true);
  commitMergedBatch('terrace-east', terraceGeos, terracePlacements, mats.paving, true);
  commitMergedBatch('arch-ruins', archGeos, archPlacements, mats.limestone, false);

  // Build InstancedMesh batches for cliffs, Doric pillars, and hero crystals (cuts draw calls in half!)
  const instM4 = new THREE.Matrix4();
  const instQ = new THREE.Quaternion();
  const instP = new THREE.Vector3();
  const instS = new THREE.Vector3();
  const instUp = new THREE.Vector3(0, 1, 0);

  const registerInstancedPlacements = (
    name: string,
    items: Placement[],
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
  ): THREE.InstancedMesh | null => {
    if (items.length === 0) return null;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const im = new THREE.InstancedMesh(geo, mat, items.length);
    im.name = name;
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      instP.set(p.pos.x, p.pos.y, p.pos.z);
      instQ.setFromAxisAngle(instUp, p.rotY);
      instS.set(p.scale.x * (p.mirror ? -1 : 1), p.scale.y, p.scale.z);
      instM4.compose(instP, instQ, instS);
      im.setMatrixAt(i, instM4);
      placementObjects.set(p.id, { obj: im, instanced: { mesh: im, index: i } });
    }
    im.instanceMatrix.needsUpdate = true;
    group.add(im);
    return im;
  };

  for (const variant of ['straight', 'concave', 'convex', 'portal'] as const) {
    // Rotate mirrored cliffs by +PI instead of negative scale so front-face culling works cleanly with zero DoubleSide!
    const items = cliffBuckets[variant].map((p) => (p.mirror ? { ...p, rotY: p.rotY + Math.PI, mirror: false } : p));
    registerInstancedPlacements(`cliff-module-${variant}`, items, getCliffGeometry(variant), mats.cliffRock);
  }
  for (const seg of [1, 2, 3] as const) {
    registerInstancedPlacements(`pillar-module-${seg}seg`, pillarBuckets[seg], getPillarGeometry(seg), mats.limestone);
  }
  // Combine hero + scattered crystals & kelp into shared InstancedMeshes (saves 4 draw calls!)
  const scatterBuckets: Record<string, typeof world.scatter[number][]> = {
    'kelp:ribbon': [],
    'kelp:frond': [],
    'crystal-cluster:warm': [],
    'crystal-cluster:cool': [],
    'rubble:shard': [],
    'rubble:boulder': [],
  };
  for (const s of world.scatter) {
    const key = `${s.module}:${s.variant}`;
    if (scatterBuckets[key]) scatterBuckets[key].push(s);
  }
  const addCombinedInstanced = (
    name: string,
    heroes: Placement[],
    scattered: typeof world.scatter[number][],
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
  ): void => {
    const total = heroes.length + scattered.length;
    if (total === 0) return;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const im = new THREE.InstancedMesh(geo, mat, total);
    im.name = name;
    im.userData.role = 'decor';
    let idx = 0;
    for (const p of heroes) {
      instP.set(p.pos.x, p.pos.y, p.pos.z);
      instQ.setFromAxisAngle(instUp, p.rotY);
      instS.set(p.scale.x, p.scale.y, p.scale.z);
      instM4.compose(instP, instQ, instS);
      im.setMatrixAt(idx, instM4);
      placementObjects.set(p.id, { obj: im, instanced: { mesh: im, index: idx } });
      idx++;
    }
    for (const s of scattered) {
      instP.set(s.pos.x, s.pos.y, s.pos.z);
      instQ.setFromAxisAngle(instUp, s.rotY);
      instS.set(s.scale.x, s.scale.y, s.scale.z);
      instM4.compose(instP, instQ, instS);
      im.setMatrixAt(idx, instM4);
      idx++;
    }
    im.instanceMatrix.needsUpdate = true;
    group.add(im);
  };

  addCombinedInstanced('crystal-warm', crystalHeroBuckets.warm, scatterBuckets['crystal-cluster:warm'], getCrystalClusterGeometry(), mats.warmCrystal);
  addCombinedInstanced('crystal-cool', crystalHeroBuckets.cool, scatterBuckets['crystal-cluster:cool'], getCrystalClusterGeometry(), mats.coolCrystal);
  addCombinedInstanced('kelp-ribbon', kelpHeroBuckets.ribbon, scatterBuckets['kelp:ribbon'], getKelpGeometry('ribbon'), mats.kelp);
  addCombinedInstanced('kelp-frond', kelpHeroBuckets.frond, scatterBuckets['kelp:frond'], getKelpGeometry('frond'), mats.kelp);

  const allHeroCrystals = [...crystalHeroBuckets.warm, ...crystalHeroBuckets.cool];
  if (allHeroCrystals.length > 0) {
    const plinthMesh = new THREE.InstancedMesh(getCrystalPlinthGeometry(), mats.darkTrim, allHeroCrystals.length);
    plinthMesh.name = 'crystal-hero-plinths';
    for (let i = 0; i < allHeroCrystals.length; i++) {
      const p = allHeroCrystals[i];
      instP.set(p.pos.x, p.pos.y, p.pos.z);
      instQ.setFromAxisAngle(instUp, p.rotY);
      instS.set(p.scale.x, p.scale.y, p.scale.z);
      instM4.compose(instP, instQ, instS);
      plinthMesh.setMatrixAt(i, instM4);
    }
    plinthMesh.instanceMatrix.needsUpdate = true;
    group.add(plinthMesh);
  }

  if (bridgeTrimGeos.length > 0) {
    const mergedTrim = mergeGeometries(bridgeTrimGeos, false)!;
    bridgeTrimGeos.forEach((g) => g.dispose());
    const trimMesh = new THREE.Mesh(mergedTrim, mats.bridgeGoldTrim);
    trimMesh.name = 'bridge-gold-trim-batch';
    trimMesh.userData.role = 'decor';
    group.add(trimMesh);
  }

  const allRubble = [...scatterBuckets['rubble:shard'], ...scatterBuckets['rubble:boulder']];
  addCombinedInstanced('rubble-scatter', [], allRubble, getRubbleGeometry('shard'), mats.cliffRock);

  // 4. Overhead Backlit Ocean Ceiling, Seamless Underwater Depth Backdrop, Volumetric God Rays, Fish Schools, Glow Halos
  const ceilGeo = new THREE.PlaneGeometry(420, 420, 2, 2);
  ceilGeo.rotateX(Math.PI / 2);
  const ceilMesh = new THREE.Mesh(ceilGeo, mats.waterCeiling);
  ceilMesh.name = 'ocean-surface-ceiling';
  ceilMesh.position.set(0, OCEAN_DEEP.ceilingWaterY, -6);
  group.add(ceilMesh);

  // Soft vertical-gradient underwater horizon cylinder wrapping far beyond the canyon (eliminates hard ceiling cutoff!)
  const skyCylGeo = new THREE.CylinderGeometry(165, 165, 92, 20, 1, true);
  skyCylGeo.translate(0, 22, -6);
  const sPos = skyCylGeo.attributes.position;
  const sCol = new Float32Array(sPos.count * 3);
  const cBot = new THREE.Color(0x0b4858);
  const cTop = new THREE.Color(0x4ddad4);
  const cTmp = new THREE.Color();
  for (let i = 0; i < sPos.count; i++) {
    const t = clamp((sPos.getY(i) + 12) / 58, 0, 1);
    cTmp.copy(cBot).lerp(cTop, Math.pow(t, 1.1));
    sCol[i * 3] = cTmp.r;
    sCol[i * 3 + 1] = cTmp.g;
    sCol[i * 3 + 2] = cTmp.b;
  }
  skyCylGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 3));
  const skyCyl = new THREE.Mesh(
    skyCylGeo,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  skyCyl.name = 'ocean-depth-backdrop';
  group.add(skyCyl);

  group.add(buildGodRays(mats));
  const fish = buildFishSchool(mats);
  group.add(fish.mesh);
  group.add(buildGlowHaloPoints(world));

  // 5. Underwater Lighting Rig (1 Hemi + 1 Dir + 2 Local Warm Accents — fast on mobile & SwiftShader!)
  const hemi = new THREE.HemisphereLight(0x7af5ee, 0x0f3b4a, 1.32);
  const sunKey = new THREE.DirectionalLight(0xc8fff6, 2.05);
  sunKey.position.set(-14, 58, -18);
  sunKey.target.position.set(2, 0, 2);
  const altarLight = new THREE.PointLight(0xffba48, 18, 28, 1.3);
  altarLight.position.set(OCEAN_DEEP.altarCenter.x, 2.4, OCEAN_DEEP.altarCenter.z);
  const spireLight = new THREE.PointLight(0xffae42, 16, 30, 1.25);
  spireLight.position.set(-14, 9.5, -9);
  group.add(hemi, sunKey, sunKey.target, altarLight, spireLight);

  // Pre-allocated animation temporaries (zero per-frame GC!)
  const fMat = new THREE.Matrix4();
  const fPos = new THREE.Vector3();
  const fQuat = new THREE.Quaternion();
  const fScale = new THREE.Vector3();
  const fUp = new THREE.Vector3(0, 1, 0);
  let lastFishUpdate = -1;

  return {
    group,
    mats,
    fishMesh: fish.mesh,
    fishData: fish.data,
    placementObjects,
    walkableMeshes,
    update(t, px, py, pz) {
      mats.update(t, px, py, pz);
      if (lastFishUpdate >= 0 && t - lastFishUpdate < 0.032) return;
      lastFishUpdate = t;
      for (let i = 0; i < fish.data.length; i++) {
        const fd = fish.data[i];
        const a = fd.phase + t * fd.speed * fd.dir;
        const fx = fd.baseX + Math.cos(a) * fd.radius;
        const fy = fd.baseY + Math.sin(a * 2.1 + fd.phase) * 0.9;
        const fz = fd.baseZ + Math.sin(a) * fd.radius * 0.55;
        const vx = -Math.sin(a) * fd.dir;
        const vz = Math.cos(a) * 0.55 * fd.dir;
        fPos.set(fx, fy, fz);
        fQuat.setFromAxisAngle(fUp, Math.atan2(vx, vz));
        fScale.setScalar(fd.scale);
        fMat.compose(fPos, fQuat, fScale);
        fish.mesh.setMatrixAt(i, fMat);
      }
      fish.mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

// ── Playable Runtime Controller (Attached Lazily via space.ts & hud.ts) ──

interface SeerGlobal {
  mode?: { mode: string };
  robot?: { x: number; z: number; vx: number; vz: number; heading: number; walkPhase: number; steps: number };
  robotView?: { group: THREE.Group; animate(phase: number, speed: number, t: number, dt: number): void; setHover(on: boolean): void };
  controls?: { moveX: number; moveY: number; run: boolean };
  sfx?: { play(kind: string): void };
  cam?: { yaw: number; pitch: number; zoom: number };
  info?: () => { calls: number; triangles: number; points: number; lines: number; frame: number };
  oceanDeep?: OceanDeepController;
}

export interface RuntimeVerificationResult {
  anchors: Record<string, number>;
  collision1to1: {
    checkedMeshes: number;
    checkedColliders: number;
    missingColliders: string[];
    ghostColliders: string[];
  };
  raycastStanding: {
    totalSamples: number;
    hits: number;
    failedSamples: { id: string; tag: string; expectedY: number; hitY: number | null }[];
    maxErrorM: number;
  };
  walkability: FloodFillReport;
  stats: OceanDeepWorld['stats'];
}

export class OceanDeepController {
  active = false;
  world: OceanDeepWorld | null = null;
  built: BuiltOceanScene | null = null;
  walker: OceanWalker | null = null;
  readonly presets = OCEAN_CAMERA_PRESETS;

  private hostScene: THREE.Scene | null = null;
  private savedBg: THREE.Scene['background'] = null;
  private savedEnv: THREE.Scene['environment'] = null;
  private savedFog: THREE.Scene['fog'] = null;
  private savedEnvIntensity = 0.9;
  private savedVis = new Map<THREE.Object3D, boolean>();
  private savedRobotPos: { x: number; z: number; heading: number } = {
    x: CABIN.spawn.x,
    z: CABIN.spawn.z,
    heading: CABIN.spawn.heading,
  };
  private lastSteps = 0;
  private camOverride: { pos: THREE.Vector3; lookAt: THREE.Vector3; fov: number } | null = null;
  private autopilot: { moveX: number; moveY: number; run: boolean; camYaw?: number } | null = null;
  private exitBtn: HTMLButtonElement | null = null;
  private readonly tmpLook = new THREE.Vector3();
  private pendingEnter = false;
  private lastHudZone = '';
  private lastHudWater: boolean | null = null;
  private hudInitialized = false;
  lastUpdateMs = 0;

  attachScene(scene: THREE.Scene): void {
    this.hostScene = scene;
    const seer = (window as unknown as { __seer?: SeerGlobal }).__seer;
    if (seer && !seer.oceanDeep) {
      seer.oceanDeep = this;
    }
    if (this.pendingEnter && !this.active) {
      this.pendingEnter = false;
      this.enter();
    }
  }

  requestEnter(): void {
    if (this.hostScene) this.enter();
    else this.pendingEnter = true;
  }

  enter(): boolean {
    if (this.active) return true;
    const scene = this.hostScene;
    if (!scene) {
      this.pendingEnter = true;
      return false;
    }
    // Dismiss start overlay cleanly so main.ts `started` becomes true (enabling pointer look + WASD)
    const startEl = document.getElementById('start');
    const goEl = document.getElementById('go');
    if (startEl && !startEl.classList.contains('hidden') && goEl) {
      goEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    }
    // Close any open modal panel (such as Star Map)
    document.getElementById('targets')?.classList.add('hidden');
    document.getElementById('archive')?.classList.add('hidden');

    if (!this.world) this.world = buildOceanDeepWorld();
    if (!this.built) this.built = buildOceanDeepScene(this.world);
    if (!this.walker) this.walker = new OceanWalker(this.world.anchors.spawn);
    else this.walker.reset(this.world.anchors.spawn, this.world.anchors.spawn.heading);
    this.lastSteps = this.walker.steps;

    const seer = (window as unknown as { __seer?: SeerGlobal }).__seer;
    if (seer?.robot) {
      this.savedRobotPos = { x: seer.robot.x, z: seer.robot.z, heading: seer.robot.heading };
    }
    if (seer?.cam) {
      // Face northeast down the sweeping stone bridge toward twin spires & plaza
      seer.cam.yaw = -0.35;
      seer.cam.pitch = 0.28;
    }

    // Save & swap scene visibility + underwater environment (disable space cubemap IBL underwater!)
    this.savedBg = scene.background;
    this.savedEnv = scene.environment;
    this.savedFog = scene.fog;
    this.savedEnvIntensity = scene.environmentIntensity;
    this.savedVis.clear();
    const robotGrp = seer?.robotView?.group;
    for (const child of scene.children) {
      if (child === this.built.group) continue;
      this.savedVis.set(child, child.visible);
      if (child !== robotGrp && !(child as THREE.Camera).isCamera) {
        child.visible = false;
      }
    }
    if (robotGrp) robotGrp.visible = true;
    if (!this.built.group.parent) scene.add(this.built.group);
    this.built.group.visible = true;

    scene.background = new THREE.Color(0x0d5d6e);
    scene.environment = null;
    scene.fog = new THREE.FogExp2(0x0d5d6e, 0.0082);
    scene.environmentIntensity = 0;

    this.active = true;
    this.camOverride = null;
    this.hudInitialized = false;
    this.lastHudZone = '';
    this.lastHudWater = null;
    this.ensureExitButton(true);
    this.updateHudText();
    return true;
  }

  exit(): void {
    if (!this.active) return;
    const scene = this.hostScene;
    if (scene) {
      if (this.built) this.built.group.visible = false;
      for (const [child, vis] of this.savedVis) child.visible = vis;
      scene.background = this.savedBg;
      scene.environment = this.savedEnv;
      scene.fog = this.savedFog;
      scene.environmentIntensity = this.savedEnvIntensity;
    }
    const seer = (window as unknown as { __seer?: SeerGlobal }).__seer;
    if (seer?.robot) {
      seer.robot.x = this.savedRobotPos.x;
      seer.robot.z = this.savedRobotPos.z;
      seer.robot.heading = this.savedRobotPos.heading;
      seer.robot.vx = 0;
      seer.robot.vz = 0;
    }
    this.active = false;
    this.camOverride = null;
    this.autopilot = null;
    this.ensureExitButton(false);
    const placeEl = document.getElementById('place');
    if (placeEl) placeEl.textContent = '瞭望舱 I';
  }

  private ensureExitButton(show: boolean): void {
    if (!show) {
      if (this.exitBtn) this.exitBtn.style.display = 'none';
      return;
    }
    if (!this.exitBtn) {
      const btn = document.createElement('button');
      btn.id = 'oceanExit';
      btn.className = 'btn';
      btn.textContent = '返回瞭望舱';
      btn.style.cssText = 'right: calc(68px + var(--sr)); top: calc(12px + var(--st)); height: 48px; padding: 0 12px; font-size: 13px; z-index: 12;';
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.exit();
      });
      document.getElementById('hud')?.appendChild(btn);
      this.exitBtn = btn;
    }
    this.exitBtn.style.display = 'flex';
  }

  private updateHudText(): void {
    if (!this.walker) return;
    if (!this.hudInitialized) {
      this.hudInitialized = true;
      const placeEl = document.getElementById('place');
      if (placeEl) placeEl.textContent = '海洋星 · 深水区';
      document.getElementById('act')?.classList.add('hidden');
    }
    if (this.walker.zoneName !== this.lastHudZone) {
      this.lastHudZone = this.walker.zoneName;
      const goalEl = document.getElementById('goal');
      if (goalEl) goalEl.textContent = `${this.walker.zoneName} · 穿行石桥、浅水祭坛与三层遗迹`;
    }
    if (this.walker.inShallowWater !== this.lastHudWater) {
      this.lastHudWater = this.walker.inShallowWater;
      const tipEl = document.getElementById('tip');
      if (tipEl) {
        if (this.walker.inShallowWater) {
          tipEl.textContent = '浅水广场（水深 0.12m）· 东侧阶梯可登三层半圆台地';
          tipEl.classList.remove('hidden');
        } else {
          tipEl.classList.add('hidden');
        }
      }
    }
  }

  teleport(x: number, y: number, z: number, heading?: number): void {
    if (!this.walker) return;
    this.walker.reset({ x, y, z }, heading ?? this.walker.heading);
    this.updateHudText();
  }

  setCamera(pos: [number, number, number], lookAt: [number, number, number], fov = 62): void {
    this.camOverride = {
      pos: new THREE.Vector3(pos[0], pos[1], pos[2]),
      lookAt: new THREE.Vector3(lookAt[0], lookAt[1], lookAt[2]),
      fov,
    };
  }

  applyPreset(name: string): boolean {
    const p = OCEAN_CAMERA_PRESETS.find((c) => c.name === name);
    if (!p) return false;
    this.setCamera(p.pos, p.lookAt, p.fov);
    return true;
  }

  clearCamera(): void {
    this.camOverride = null;
  }

  setAutopilot(cmd: { moveX: number; moveY: number; run: boolean; camYaw?: number } | null): void {
    this.autopilot = cmd;
  }

  update(time: number, dt: number, camObj: THREE.Camera, scene: THREE.Object3D | null): void {
    const camera = camObj as THREE.PerspectiveCamera;
    if (scene && (scene as THREE.Scene).isScene && !this.hostScene) {
      this.attachScene(scene as THREE.Scene);
    }
    if (!this.active || !this.world || !this.built || !this.walker) return;
    const t0 = performance.now();

    const seer = (window as unknown as { __seer?: SeerGlobal }).__seer;
    // Keep cabin robot pinned at spawn so main.ts cabin update never triggers cabin footsteps or holo prompts
    if (seer?.robot) {
      seer.robot.x = CABIN.spawn.x;
      seer.robot.z = CABIN.spawn.z;
      seer.robot.vx = 0;
      seer.robot.vz = 0;
      seer.robot.walkPhase = 0;
    }

    const ctrl = seer?.controls;
    const camState = seer?.cam ?? { yaw: -0.35, pitch: 0.28, zoom: 1 };
    const input = this.autopilot
      ? {
          moveX: this.autopilot.moveX,
          moveY: this.autopilot.moveY,
          run: this.autopilot.run,
          camYaw: this.autopilot.camYaw ?? camState.yaw,
        }
      : {
          moveX: ctrl?.moveX ?? 0,
          moveY: ctrl?.moveY ?? 0,
          run: Boolean(ctrl?.run),
          camYaw: camState.yaw,
        };

    this.walker.update(dt, input, this.world);
    if (this.walker.steps !== this.lastSteps) {
      this.lastSteps = this.walker.steps;
      seer?.sfx?.play('footstep');
    }

    // Position and animate Seer robot in Ocean Deep
    if (seer?.robotView) {
      seer.robotView.group.visible = !this.camOverride;
      seer.robotView.group.position.set(this.walker.x, this.walker.y, this.walker.z);
      seer.robotView.group.rotation.y = this.walker.heading;
      seer.robotView.setHover(false);
      seer.robotView.animate(this.walker.walkPhase, this.walker.speed, time, dt);
    }

    // Update camera (cinematic preset override OR live third-person orbit camera)
    const wantNear = 0.15;
    const wantFar = 360;
    let wantFov: number;
    if (this.camOverride) {
      camera.position.copy(this.camOverride.pos);
      camera.lookAt(this.camOverride.lookAt);
      const aspect = camera.aspect || 1;
      const baseV = this.camOverride.fov;
      wantFov = aspect < 1 ? clamp(baseV + 14, baseV, 90) : baseV;
    } else {
      const portrait = (camera.aspect || 1) < 1;
      const dist = (portrait ? 6.2 : 5.4) * (camState.zoom || 1);
      const pitch = clamp(camState.pitch, 0.14, 1.05);
      const cp = Math.cos(pitch);
      const ox = Math.sin(camState.yaw) * cp * dist;
      const oy = Math.sin(pitch) * dist + 1.35;
      const oz = Math.cos(camState.yaw) * cp * dist;
      camera.position.set(this.walker.x + ox, this.walker.y + oy, this.walker.z + oz);
      this.tmpLook.set(this.walker.x, this.walker.y + 1.15, this.walker.z);
      camera.lookAt(this.tmpLook);
      wantFov = portrait ? 72 : 60;
    }
    if (camera.near !== wantNear || camera.far !== wantFar || Math.abs(camera.fov - wantFov) > 0.01) {
      camera.near = wantNear;
      camera.far = wantFar;
      camera.fov = wantFov;
      camera.updateProjectionMatrix();
    }

    // Update underwater shaders & gliding fish schools
    this.built.update(time, this.walker.x, this.walker.y, this.walker.z);
    this.updateHudText();
    this.lastUpdateMs = performance.now() - t0;
  }

  /** Machine-verifiable 3D runtime audit: anchors, 1:1 visible-mesh <-> collider
   *  correspondence, downward THREE.Raycaster on bridge decks / stairs / terraces,
   *  0.5m flood fill reachability, and kitbash statistics. */
  verifyRuntime(): RuntimeVerificationResult {
    if (!this.world || !this.built) {
      throw new Error('OceanDeep must be entered before verifyRuntime()');
    }
    const world = this.world;
    const built = this.built;
    built.group.updateMatrixWorld(true);

    // 1. Anchor counts by traversing live Three.js scene graph names
    const allNames: string[] = [];
    built.group.traverse((o) => {
      if (o.name) allNames.push(o.name);
    });
    const spireRoots = world.placements.filter((p) => p.module === 'spire-module' && p.variant === 'mid-arch');
    const anchors: Record<string, number> = {
      spire: spireRoots.filter((s) => built.group.getObjectByName(s.name) !== undefined).length,
      bridge: allNames.filter((n) => n.includes('bridge')).length,
      plaza: allNames.filter((n) => n.includes('plaza')).length,
      altar: allNames.filter((n) => n.includes('altar')).length,
      terrace: allNames.filter((n) => n.includes('terrace')).length,
      arch: allNames.filter((n) => n.includes('arch')).length,
      'crystal-warm': allNames.filter((n) => n.includes('crystal-warm')).length,
      'crystal-cool': allNames.filter((n) => n.includes('crystal-cool')).length,
      kelp: allNames.filter((n) => n.includes('kelp')).length,
    };

    // 2. 1:1 Visible Mesh <-> Collider verification using live Three.js Box3
    const collidersByPid = new Map<string, typeof world.colliders[number][]>();
    for (const col of world.colliders) {
      const list = collidersByPid.get(col.placementId) ?? [];
      list.push(col);
      collidersByPid.set(col.placementId, list);
    }

    const missingColliders: string[] = [];
    const ghostColliders: string[] = [];
    const box3 = new THREE.Box3();
    const instMat = new THREE.Matrix4();
    let checkedMeshes = 0;

    const getHandleWorldBox = (h: PlacementHandle, out: THREE.Box3): boolean => {
      if (!h.obj.visible) return false;
      if (h.bakedBox) {
        out.copy(h.bakedBox);
        return true;
      }
      if (h.instanced) {
        const { mesh, index } = h.instanced;
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        mesh.getMatrixAt(index, instMat);
        out.copy(mesh.geometry.boundingBox!).applyMatrix4(instMat).applyMatrix4(mesh.matrixWorld);
        return true;
      }
      out.setFromObject(h.obj);
      return true;
    };

    for (const p of world.placements) {
      if (p.role !== 'solid' && p.role !== 'hybrid') continue;
      checkedMeshes++;
      const handle = built.placementObjects.get(p.id);
      const cols = collidersByPid.get(p.id);
      if (!handle || !getHandleWorldBox(handle, box3) || !cols || cols.length === 0) {
        missingColliders.push(p.id);
        continue;
      }
      // Verify at least one collider overlaps the actual rendered Three.js world Box3
      const anyMatch = cols.some((c) => {
        const cb = worldAABBOfCollider(c);
        return (
          cb.min.x <= box3.max.x + 0.8 &&
          cb.max.x >= box3.min.x - 0.8 &&
          cb.min.y <= box3.max.y + 0.8 &&
          cb.max.y >= box3.min.y - 0.8 &&
          cb.min.z <= box3.max.z + 0.8 &&
          cb.max.z >= box3.min.z - 0.8
        );
      });
      if (!anyMatch) missingColliders.push(p.id);
    }

    for (const col of world.colliders) {
      const handle = built.placementObjects.get(col.placementId);
      if (!handle || !getHandleWorldBox(handle, box3)) {
        ghostColliders.push(col.id);
        continue;
      }
      const cb = worldAABBOfCollider(col);
      const overlaps =
        cb.min.x <= box3.max.x + 0.8 &&
        cb.max.x >= box3.min.x - 0.8 &&
        cb.min.y <= box3.max.y + 0.8 &&
        cb.max.y >= box3.min.y - 0.8 &&
        cb.min.z <= box3.max.z + 0.8 &&
        cb.max.z >= box3.min.z - 0.8;
      if (!overlaps) ghostColliders.push(col.id);
    }

    // 3. Downward THREE.Raycaster standing check on every bridge deck, stair, terrace & spire tunnel!
    const raycaster = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const origin = new THREE.Vector3();
    const failedSamples: { id: string; tag: string; expectedY: number; hitY: number | null }[] = [];
    let totalSamples = 0;
    let hits = 0;
    let maxErrorM = 0;

    const testSample = (id: string, tag: string, x: number, expectedY: number, z: number, tol: number): void => {
      totalSamples++;
      origin.set(x, expectedY + 1.25, z);
      raycaster.set(origin, down);
      raycaster.far = 3.2;
      const res = raycaster.intersectObjects(built.walkableMeshes, false);
      // Pick closest hit near expectedY (handles multi-level overlap like bridge over ground)
      let bestHitY: number | null = null;
      let bestErr = Infinity;
      for (const hit of res) {
        const err = Math.abs(hit.point.y - expectedY);
        if (err < bestErr) {
          bestErr = err;
          bestHitY = hit.point.y;
        }
      }
      if (bestHitY !== null && bestErr <= tol) {
        hits++;
        if (bestErr > maxErrorM) maxErrorM = bestErr;
      } else {
        failedSamples.push({ id, tag, expectedY, hitY: bestHitY });
      }
    };

    for (const s of world.surfaces) {
      if (s.kind === 'ramp') {
        const c = Math.cos(s.rotY);
        const sn = Math.sin(s.rotY);
        const tol = s.tag === 'stair' ? 0.34 : 0.16; // 5-step stair treads step around linear ramp envelope
        for (const frac of [-0.45, 0, 0.45]) {
          const lz = frac * s.halfL;
          const wx = s.cx + lz * sn;
          const wz = s.cz + lz * c;
          const t = (lz + s.halfL) / (2 * s.halfL);
          const ey = s.yStart + (s.yEnd - s.yStart) * t;
          testSample(s.id, s.tag, wx, ey, wz, tol);
        }
      } else if (s.kind === 'disc') {
        const rMid = s.innerR > 0 ? (s.innerR + s.r) * 0.5 : s.r * 0.52;
        const dir = s.sectorDir ?? 0;
        const wx = s.cx + Math.sin(dir) * rMid;
        const wz = s.cz + Math.cos(dir) * rMid;
        testSample(s.id, s.tag, wx, s.topY, wz, 0.16);
      } else {
        // Basin / plaza sample points
        testSample(s.id, 'plaza', 4.5, 0, 5.5, 0.12);
        testSample(s.id, 'plaza', -5.5, 0, 6.0, 0.12);
      }
    }

    const walkability = analyzeWalkability(world, 0.5);

    return {
      anchors,
      collision1to1: {
        checkedMeshes,
        checkedColliders: world.colliders.length,
        missingColliders,
        ghostColliders,
      },
      raycastStanding: {
        totalSamples,
        hits,
        failedSamples,
        maxErrorM,
      },
      walkability,
      stats: world.stats,
    };
  }
}

export const oceanDeepController = new OceanDeepController();
