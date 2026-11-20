// Seer robot view: loads the AI-built GLB (public/models/seer-express.glb,
// Tencent Hunyuan hy-3d-express image-to-3D) with a two-step fallback —
// Blender-built seer.glb, then a primitive lookalike — so there is never a
// blank screen. The models face local +z; origin at the feet.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MAT, glow } from './materials.ts';
import { PAL } from './palette.ts';
import { radialTexture } from './textures.ts';

export interface RobotView {
  group: THREE.Group;
  /** 'express' once the AI model is in, 'glb' for the Blender fallback,
   *  'primitive' while pending or if both GLBs fail */
  readonly source: 'primitive' | 'glb' | 'express';
  /** phase: metres walked; speed: m/s; t: seconds */
  animate(phase: number, speed: number, t: number, dt: number): void;
  /** tuck the telescoping legs and float (launch cinematic) */
  setHover(on: boolean): void;
}

/** animation targets shared by both rigs */
interface Rig {
  root: THREE.Object3D;
  body: THREE.Object3D;
  head?: THREE.Object3D;
  armL?: THREE.Object3D;
  armR?: THREE.Object3D;
  legL?: THREE.Object3D;
  legR?: THREE.Object3D;
  legTubeL?: THREE.Object3D;
  legTubeR?: THREE.Object3D;
  antenna?: { o: THREE.Object3D; rest: THREE.Euler };
  eye?: { o: THREE.Object3D; y: number };
  tip?: { o: THREE.Object3D; s: number };
  core?: { o: THREE.Object3D; s: number };
  /** glowing-eye breathing: pulse emissiveIntensity (std) or colour (basic) */
  eyeGlow?: { mat: THREE.Material; base: number; baseColor?: THREE.Color };
  /** single-mesh model (no named nodes): whole-body procedural animation */
  solid?: boolean;
}

/** eye-brightness pulse: standard materials breathe via emissiveIntensity,
 *  the primitive fallback's MeshBasicMaterial via colour gain. */
function bindGlow(mat: THREE.Material | undefined): Rig['eyeGlow'] {
  if (!mat) return undefined;
  const std = mat as THREE.MeshStandardMaterial;
  if (std.emissiveIntensity !== undefined && std.emissiveIntensity > 0) {
    return { mat, base: std.emissiveIntensity };
  }
  const basic = mat as THREE.MeshBasicMaterial;
  if (basic.isMeshBasicMaterial) return { mat, base: 0, baseColor: basic.color.clone() };
  return undefined;
}

const pick = (root: THREE.Object3D, name: string): THREE.Object3D | undefined => root.getObjectByName(name);

function primitiveRig(): Rig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const eyeMat = glow(PAL.cyan, 2.0);
  const jointMat = glow(PAL.cyan, 1.3);

  // torso
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.19, 24, 18), MAT.hull);
  torso.scale.set(1, 1.05, 0.9);
  torso.position.y = 0.3;
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.022, 8, 32), MAT.metal);
  belt.rotation.x = Math.PI / 2;
  belt.position.y = 0.21;
  const chest = new THREE.Mesh(new THREE.CircleGeometry(0.05, 20), eyeMat);
  chest.position.set(0, 0.33, 0.167);
  chest.rotation.x = -0.12;
  const chestRing = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.01, 6, 24), MAT.metal);
  chestRing.position.copy(chest.position);
  chestRing.rotation.x = -0.12;
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.1), MAT.hullShade);
  pack.position.set(0, 0.33, -0.17);
  const packLight = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.02), jointMat);
  packLight.position.set(0, 0.36, -0.225);
  body.add(torso, belt, chest, chestRing, pack, packLight);

  // head
  const head = new THREE.Group();
  head.position.y = 0.58;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.235, 28, 20), MAT.hull);
  skull.scale.set(1.08, 0.88, 1);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 16), MAT.visor);
  visor.scale.set(1.02, 0.62, 0.8);
  visor.position.set(0, -0.005, 0.085);
  const eyeGeo = new THREE.SphereGeometry(0.042, 16, 12);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.scale.set(1, 1.25, 0.5);
    eye.position.set(sx * 0.085, 0, 0.232);
    eye.name = 'eye';
    const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 20), MAT.metal);
    ear.rotation.z = Math.PI / 2;
    ear.position.set(sx * 0.25, 0, 0);
    const earLight = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 16), jointMat);
    earLight.rotation.z = Math.PI / 2;
    earLight.position.set(sx * 0.255, 0, 0);
    head.add(eye, ear, earLight);
  }
  const antenna = new THREE.Group();
  antenna.position.y = 0.22;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.12, 8), MAT.metal);
  mast.position.y = 0.03;
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 10), eyeMat);
  tip.position.y = 0.1;
  antenna.add(mast, tip);
  const crest = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.26), MAT.hullShade);
  crest.position.y = 0.2;
  head.add(skull, visor, antenna, crest);
  body.add(head);

  // limbs — pivots at shoulder / hip
  const limb = (x: number, y: number, len: number, rad: number, foot: boolean): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const joint = new THREE.Mesh(new THREE.SphereGeometry(rad * 1.15, 12, 10), jointMat);
    const seg = new THREE.Mesh(new THREE.CapsuleGeometry(rad, len, 4, 12), MAT.hull);
    seg.position.y = -len / 2 - rad * 0.8;
    pivot.add(joint, seg);
    if (foot) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), MAT.hullShade);
      f.scale.set(1, 0.6, 1.45);
      f.position.set(0, -len - rad * 1.6, 0.03);
      pivot.add(f);
    } else {
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), MAT.hullShade);
      hand.position.y = -len - rad * 2;
      pivot.add(hand);
    }
    return pivot;
  };
  const armL = limb(-0.215, 0.38, 0.1, 0.042, false);
  const armR = limb(0.215, 0.38, 0.1, 0.042, false);
  armL.rotation.z = -0.25;
  armR.rotation.z = 0.25;
  const legL = limb(-0.09, 0.17, 0.035, 0.05, true);
  const legR = limb(0.09, 0.17, 0.035, 0.05, true);
  body.add(armL, armR, legL, legR);

  const eyes = head.children.filter((c) => c.name === 'eye');
  return {
    root, body, head, armL, armR, legL, legR,
    antenna: { o: antenna, rest: antenna.rotation.clone() },
    eye: { o: eyes[0], y: 1.25 },
    tip: { o: tip, s: 1 },
    core: { o: chest, s: 1 },
    eyeGlow: bindGlow(eyeMat),
  };
}

/** Bind the GLB scene graph to a rig. Returns null if key nodes are missing. */
function glbRig(model: THREE.Object3D): Rig | null {
  const body = pick(model, 'body');
  if (!body) return null;
  const eyeO = pick(model, 'eye');
  const tipO = pick(model, 'tip');
  const coreO = pick(model, 'core');
  const antO = pick(model, 'antenna');
  let eyeMat: THREE.Material | undefined;
  (eyeO ?? model).traverse((n) => {
    const m = n as THREE.Mesh;
    const mm = m.material as THREE.MeshStandardMaterial;
    if (!eyeMat && m.isMesh && mm.emissive && mm.emissiveIntensity &&
        mm.emissive.r + mm.emissive.g + mm.emissive.b > 0) {
      eyeMat = mm;
    }
  });
  return {
    root: model,
    body,
    head: pick(model, 'head'),
    armL: pick(model, 'arm_L'),
    armR: pick(model, 'arm_R'),
    legL: pick(model, 'leg_L'),
    legR: pick(model, 'leg_R'),
    legTubeL: pick(model, 'leg_tube_L'),
    legTubeR: pick(model, 'leg_tube_R'),
    antenna: antO ? { o: antO, rest: antO.rotation.clone() } : undefined,
    eye: eyeO ? { o: eyeO, y: eyeO.scale.y } : undefined,
    tip: tipO ? { o: tipO, s: tipO.scale.x } : undefined,
    core: coreO ? { o: coreO, s: coreO.scale.x } : undefined,
    eyeGlow: bindGlow(eyeMat),
  };
}

// hy-3d-express bakes a +90°X transform on its root node — the loaded scene
// already stands upright and faces +z (checked against front/back shots), so
// no yaw fix-up is needed, only measurement + normalisation.
/** Wrap the AI GLB in a normalising rig: scale to 1 m tall, feet on y=0,
 *  facing +z. Returns null when the scene has no usable mesh. */
function expressRig(model: THREE.Object3D): Rig | null {
  let meshes = 0;
  model.traverse((n) => {
    const m = n as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    m.castShadow = m.receiveShadow = true;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      const std = mat as THREE.MeshStandardMaterial;
      if (std.map) std.map.colorSpace = THREE.SRGBColorSpace;
      // let the baked-sky environment through — cabin light strips reflect
      // (scene.environmentIntensity carries the per-scene level)
      if (std.isMeshStandardMaterial) std.envMapIntensity = 1.0;
      std.needsUpdate = true;
    }
  });
  if (!meshes) return null;

  const norm = new THREE.Group();
  norm.add(model);
  const box = new THREE.Box3().setFromObject(norm);
  const size = box.getSize(new THREE.Vector3());
  if (!(size.y > 0)) return null;
  const s = 1 / size.y;
  norm.scale.setScalar(s);
  const c = box.getCenter(new THREE.Vector3());
  norm.position.set(-c.x * s, -box.min.y * s, -c.z * s);

  const body = new THREE.Group();
  body.add(norm);
  const root = new THREE.Group();
  root.add(body);
  return { root, body, solid: true };
}

export function buildRobot(): RobotView {
  const group = new THREE.Group();

  // contact shadow blob — stays whatever the rig is
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.95, 0.95),
    new THREE.MeshBasicMaterial({
      map: radialTexture([[0, 'rgba(10,20,45,0.6)'], [0.55, 'rgba(10,20,45,0.28)'], [1, 'rgba(10,20,45,0)']]),
      transparent: true, depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.016;
  shadow.renderOrder = 1;
  group.add(shadow);

  let rig = primitiveRig();
  group.add(rig.root);

  let attached = rig.root;
  let src: 'primitive' | 'glb' | 'express' = 'primitive';

  let lean = 0;
  let hover = false;
  let hoverK = 0;

  // 3-level chain: AI model → Blender GLB → primitive (already on screen)
  const base = import.meta.env.BASE_URL;
  // seer-express.glb is KHR_draco_mesh_compressed; decoder ships in three's
  // package, served from public/draco (no new dependency)
  const draco = new DRACOLoader().setDecoderPath(`${base}draco/`);
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const adopt = (r2: Rig, s: 'glb' | 'express'): void => {
    group.remove(attached);
    group.add(r2.root);
    attached = r2.root;
    rig = r2;
    src = s;
  };
  const loadSeer = (): void => {
    loader.load(
      `${base}models/seer.glb`,
      (g) => {
        const r2 = glbRig(g.scene);
        if (r2) adopt(r2, 'glb');
      },
      undefined,
      (e) => console.warn('seer.glb failed to load — keeping primitive robot', e),
    );
  };
  loader.load(
    `${base}models/seer-express.glb`,
    (g) => {
      const r2 = expressRig(g.scene);
      if (r2) adopt(r2, 'express');
      else loadSeer(); // empty/degenerate GLB — drop to the Blender model
    },
    undefined,
    (e) => {
      console.warn('seer-express.glb failed to load — falling back to seer.glb', e);
      loadSeer();
    },
  );

  return {
    group,
    get source() {
      return src;
    },
    setHover(on) {
      hover = on;
    },
    animate(phase, speed, t, dt) {
      const gait = Math.min(1, speed / 2.2);
      const run = Math.max(0, Math.min(1, (speed - 2.4) / 2));
      const a = (phase / 0.55) * Math.PI; // one stride per 0.55 m, per leg alternates
      hoverK += ((hover ? 1 : 0) - hoverK) * Math.min(1, dt * 4);

      if (rig.solid) {
        // monolith mesh — no limbs to articulate, move the whole body:
        // idle: ±1 cm hover on a 1.6 s cycle + very slow gaze wander;
        // walk: 3–5° forward lean, per-stride bounce, slight roll sway;
        // hover: lift 0.15 m
        const idleK = (1 - gait) * (1 - hoverK);
        rig.body.position.y =
          Math.abs(Math.sin(a)) * 0.04 * gait * (1 - hoverK) +
          Math.sin((t * Math.PI * 2) / 1.6) * 0.01 * idleK +
          hoverK * 0.15;
        const wantLean = ((3 + run * 2) * Math.PI / 180) * gait * (1 - hoverK);
        lean += (wantLean - lean) * Math.min(1, dt * 8);
        rig.body.rotation.x = lean;
        rig.body.rotation.z = Math.sin(a) * 0.05 * gait * (1 - hoverK);
        rig.body.rotation.y = Math.sin(t * 0.45) * 0.1 * idleK;
        return;
      }

      const swing = Math.sin(a) * (0.7 + run * 0.35) * gait * (1 - hoverK);
      const fold = -0.9 * hoverK; // legs tuck forward/up when hovering
      if (rig.legL) {
        rig.legL.rotation.x = swing + fold;
        rig.legL.scale.y = 1 - hoverK * 0.5;
      }
      if (rig.legR) {
        rig.legR.rotation.x = -swing + fold;
        rig.legR.scale.y = 1 - hoverK * 0.5;
      }
      // bellows stretch: each tube lengthens as its leg swings forward
      if (rig.legTubeL) rig.legTubeL.scale.y = 1 + 0.14 * gait * (0.5 + 0.5 * Math.sin(a)) * (1 - hoverK);
      if (rig.legTubeR) rig.legTubeR.scale.y = 1 + 0.14 * gait * (0.5 - 0.5 * Math.sin(a)) * (1 - hoverK);
      const armFold = 0.5 * hoverK;
      if (rig.armL) rig.armL.rotation.x = -swing * 0.9 + armFold;
      if (rig.armR) rig.armR.rotation.x = swing * 0.9 + armFold;

      const idle = Math.sin(t * 2.2) * 0.008;
      rig.body.position.y =
        Math.abs(Math.cos(a)) * 0.035 * gait * (1 - hoverK) +
        idle * (1 - gait) +
        hoverK * (0.1 + Math.sin(t * 1.6) * 0.025);
      lean += ((0.05 + run * 0.14) * gait * (1 - hoverK) - lean) * Math.min(1, dt * 8);
      rig.body.rotation.x = lean;
      if (rig.head) {
        rig.head.rotation.y = Math.sin(t * 0.7) * 0.12 * (1 - gait);
        rig.head.rotation.x = -lean * 0.6;
      }
      if (rig.antenna) {
        rig.antenna.o.rotation.x = rig.antenna.rest.x + Math.sin(t * 1.9) * 0.08;
      }

      // blink — eye strip squashes vertically
      if (rig.eye) rig.eye.o.scale.y = rig.eye.y * (t % 3.7 < 0.12 ? 0.15 : 1);
      // eye glow breathing
      if (rig.eyeGlow) {
        const b = 0.78 + 0.28 * Math.sin(t * 2.0);
        const m = rig.eyeGlow.mat as THREE.MeshStandardMaterial;
        if (m.emissiveIntensity !== undefined) m.emissiveIntensity = rig.eyeGlow.base * b;
        else (m as unknown as THREE.MeshBasicMaterial).color.copy(rig.eyeGlow.baseColor!).multiplyScalar(b);
      }
      if (rig.tip) rig.tip.o.scale.setScalar(rig.tip.s * (1 + 0.25 * Math.sin(t * 5)));
      if (rig.core) rig.core.o.scale.setScalar(rig.core.s * (1 + 0.08 * Math.sin(t * 2.6)));
    },
  };
}
