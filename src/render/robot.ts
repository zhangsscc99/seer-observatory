// Seer-style robot built from primitives: round white shell, dark visor,
// cyan glowing eyes/joints. ~0.8 m tall, chunky cartoon proportions.
// The model faces local +z; origin at the feet.
import * as THREE from 'three';
import { MAT, glow } from './materials.ts';
import { PAL } from './palette.ts';
import { radialTexture } from './textures.ts';

export interface RobotView {
  group: THREE.Group;
  /** phase: metres walked; speed: m/s; t: seconds */
  animate(phase: number, speed: number, t: number, dt: number): void;
}

export function buildRobot(): RobotView {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
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
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.12, 8), MAT.metal);
  mast.position.y = 0.25;
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 10), eyeMat);
  tip.position.y = 0.32;
  const crest = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.26), MAT.hullShade);
  crest.position.y = 0.2;
  head.add(skull, visor, mast, tip, crest);
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

  // contact shadow blob
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

  const eyes = head.children.filter((c) => c.name === 'eye');
  let lean = 0;

  return {
    group,
    animate(phase, speed, t, dt) {
      const gait = Math.min(1, speed / 2.2);
      const run = Math.max(0, Math.min(1, (speed - 2.4) / 2));
      const a = (phase / 0.55) * Math.PI; // one stride per 0.55 m, per leg alternates
      const swing = Math.sin(a) * (0.7 + run * 0.35) * gait;
      legL.rotation.x = swing;
      legR.rotation.x = -swing;
      armL.rotation.x = -swing * 0.9;
      armR.rotation.x = swing * 0.9;
      const idle = Math.sin(t * 2.2) * 0.008;
      body.position.y = Math.abs(Math.cos(a)) * 0.035 * gait + idle * (1 - gait);
      lean += ((0.1 + run * 0.16) * gait - lean) * Math.min(1, dt * 8);
      body.rotation.x = lean;
      head.rotation.y = Math.sin(t * 0.7) * 0.12 * (1 - gait);
      head.rotation.x = -lean * 0.6;
      // blink
      const blink = t % 3.7 < 0.12 ? 0.15 : 1;
      for (const e of eyes) e.scale.y = 1.25 * blink;
      tip.scale.setScalar(1 + 0.25 * Math.sin(t * 5));
    },
  };
}
