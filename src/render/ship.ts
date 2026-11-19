// Scout ship: white rounded hull, canopy, swept wings, twin cyan engines.
// Nose points to local -z. About 6 m long.
import * as THREE from 'three';
import { MAT, glow } from './materials.ts';
import { PAL } from './palette.ts';
import { radialTexture } from './textures.ts';

export interface ShipView {
  group: THREE.Group;
  /** throttle 0..1 (speed fraction), boosting flag, t seconds */
  animate(throttle: number, boosting: boolean, t: number): void;
}

export function buildShip(): ShipView {
  const group = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), MAT.hull);
  hull.scale.set(1.05, 0.72, 3);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.2, 20), MAT.hullShade);
  nose.rotation.x = -Math.PI / 2;
  nose.position.set(0, -0.05, -3.1);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.62, 24, 16), MAT.visor);
  canopy.scale.set(1, 0.75, 1.7);
  canopy.position.set(0, 0.42, -0.9);
  const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.93, 0.05, 8, 40), glow(PAL.cyan, 1.4));
  stripe.scale.set(1.05, 0.72, 1);
  stripe.position.z = 0.9;
  group.add(hull, nose, canopy, stripe);

  // wings: swept trapezoid extruded thin
  const shape = new THREE.Shape();
  shape.moveTo(0, -1.2);
  shape.lineTo(3.1, 0.9);
  shape.lineTo(3.1, 1.7);
  shape.lineTo(0, 1.5);
  shape.closePath();
  const wingGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2 });
  wingGeo.rotateX(Math.PI / 2); // shape y → z
  for (const sx of [-1, 1]) {
    const wing = new THREE.Mesh(wingGeo, MAT.hull);
    wing.scale.x = sx;
    wing.position.set(sx * 0.75, -0.05, 0.4);
    wing.rotation.z = sx * 0.1;
    const tipLight = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.9), glow(sx < 0 ? PAL.tealAccent : PAL.cyan, 1.5));
    tipLight.position.set(sx * 3.85, 0.22, 1.7);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.1, 1.3), MAT.hullShade);
    fin.position.set(sx * 0.75, 0.7, 2.1);
    fin.rotation.z = -sx * 0.35;
    fin.rotation.x = 0.35;
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 1.8, 20), MAT.metal);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(sx * 1.05, -0.05, 2.3);
    const nozzle = new THREE.Mesh(new THREE.CircleGeometry(0.4, 20), glow(PAL.thruster, 1.3));
    nozzle.position.set(sx * 1.05, -0.05, 3.21);
    group.add(wing, tipLight, fin, pod, nozzle);
  }

  // exhaust: additive cones + a soft glow sprite
  const flameMat = new THREE.MeshBasicMaterial({
    color: PAL.thruster, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const flameGeo = new THREE.ConeGeometry(0.36, 1, 16, 1, true);
  flameGeo.rotateX(Math.PI / 2); // tip toward +z
  flameGeo.translate(0, 0, 0.5);
  const flames: THREE.Mesh[] = [];
  const glowTex = radialTexture([[0, 'rgba(200,250,255,1)'], [0.25, 'rgba(110,220,255,0.6)'], [1, 'rgba(60,160,255,0)']]);
  const glows: THREE.Sprite[] = [];
  for (const sx of [-1, 1]) {
    const f = new THREE.Mesh(flameGeo, flameMat);
    f.position.set(sx * 1.05, -0.05, 3.22);
    flames.push(f);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.position.set(sx * 1.05, -0.05, 3.4);
    glows.push(s);
    group.add(f, s);
  }

  return {
    group,
    animate(throttle, boosting, t) {
      const flick = 0.9 + 0.1 * Math.sin(t * 47) * Math.sin(t * 31);
      const len = (0.8 + throttle * 5 + (boosting ? 2.5 : 0)) * flick;
      for (const f of flames) f.scale.set(1, 1, len);
      flameMat.opacity = 0.45 + throttle * 0.4;
      const gs = 1.6 + throttle * 2.2 + (boosting ? 1.2 : 0);
      for (const g of glows) g.scale.setScalar(gs * flick);
    },
  };
}
