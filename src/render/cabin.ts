// Observatory cabin mesh builder. Geometry is primitives + lathe sweeps laid
// out from the pure layout in src/game/cabin.ts (same numbers as collision).
import * as THREE from 'three';
import { CABIN, CONSOLES, polar, seatPositions } from '../game/cabin.ts';
import { MAT, arc, glow } from './materials.ts';
import { PAL } from './palette.ts';
import { consoleScreenTexture, floorTextures, radialTexture } from './textures.ts';

const D2R = Math.PI / 180;

export interface CabinView {
  group: THREE.Group;
  /** t: seconds, thrust: 0..1 launch charge */
  update(t: number, dt: number, thrust: number): void;
  setHoloColor(hex: number): void;
}

function place(obj: THREE.Object3D, deg: number, r: number, y = 0): THREE.Object3D {
  const p = polar(deg, r);
  obj.position.set(p.x, y, p.z);
  obj.rotation.y = deg * D2R; // local +z → radially outward
  return obj;
}

function buildConsole(a0: number, a1: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  const ri = CABIN.consoleInnerR;
  const ro = CABIN.consoleOuterR;
  // body cross-section (r, y): kick → inner face → lip → slanted desk → back rim
  g.add(
    arc(
      [
        [ri, 0], [ri, 0.4], [ri + 0.1, 0.5], [ri + 0.17, 0.52], [ro - 0.36, 0.76], [ro - 0.27, 0.78],
        [ro - 0.27, 0.92], [ro - 0.05, 0.92], [ro, 0.86], [ro, 0],
      ],
      a0, a1, MAT.hull,
    ),
  );
  // slanted readout screen (unlit, glows)
  const screen = consoleScreenTexture(seed);
  const sm = new THREE.MeshBasicMaterial({ map: screen, side: THREE.DoubleSide });
  sm.color.setScalar(1.35);
  g.add(arc([[ri + 0.2, 0.545], [ro - 0.39, 0.755]], a0 + 2, a1 - 2, sm, 12, true));
  // light bands: inner face strip, kick shadow, rim line
  g.add(arc([[ri - 0.006, 0.2], [ri - 0.006, 0.28]], a0 + 1, a1 - 1, MAT.cyanGlow));
  g.add(arc([[ri - 0.004, 0], [ri - 0.004, 0.07]], a0, a1, MAT.metalDark));
  g.add(arc([[ro - 0.275, 0.8], [ro - 0.275, 0.88]], a0 + 1.5, a1 - 1.5, MAT.cyanGlow));
  g.add(arc([[ro + 0.004, 0.3], [ro + 0.004, 0.36]], a0 + 1, a1 - 1, MAT.cyanGlow));
  // teal status ticks on the lip — the "极少量青绿点缀"
  for (const f of [0.2, 0.5, 0.8]) {
    const d = a0 + (a1 - a0) * f;
    g.add(arc([[ri + 0.03, 0.44], [ri + 0.09, 0.5]], d - 0.7, d + 0.7, MAT.tealGlow, 1));
  }
  // end caps
  const capGeo = new THREE.BoxGeometry(0.1, 0.98, ro - ri + 0.1);
  for (const a of [a0, a1]) {
    const cap = new THREE.Mesh(capGeo, MAT.hullShade);
    place(cap, a, (ri + ro) / 2, 0.49);
    g.add(cap);
  }
  return g;
}

function buildSeat(): THREE.Group {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.27, 20, 14), MAT.hull);
  shell.scale.set(1, 1.45, 0.9);
  shell.position.y = 0.4;
  shell.rotation.x = -0.12;
  const cushion = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), MAT.cushion);
  cushion.scale.set(1, 1.35, 0.6);
  cushion.position.set(0, 0.42, 0.14);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.1, 20), MAT.metal);
  base.position.y = 0.05;
  g.add(shell, cushion, base);
  return g;
}

function buildPedestal(): { group: THREE.Group; globe: THREE.Group; beam: THREE.Mesh; rings: THREE.Mesh[] } {
  const g = new THREE.Group();
  g.position.set(CABIN.pedestal.x, 0, CABIN.pedestal.z);
  g.add(
    arc(
      [[1.02, 0], [0.9, 0.14], [0.56, 0.22], [0.5, 0.5], [0.86, 0.66], [1.05, 0.7], [1.05, 0.8], [0.7, 0.86], [0, 0.86]],
      0, 360, MAT.hull, 40,
    ),
  );
  g.add(arc([[0.535, 0.28], [0.515, 0.44]], 0, 360, MAT.cyanGlow, 40));
  g.add(arc([[1.056, 0.72], [1.056, 0.78]], 0, 360, MAT.greenGlow, 40));
  const emitter = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.56, 0.05, 32), MAT.metalDark);
  emitter.position.y = 0.885;
  g.add(emitter);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.42, 32), glow(PAL.holoGreen, 1.2));
  lens.rotation.x = -Math.PI / 2;
  lens.position.y = 0.912;
  g.add(lens);
  // slanted helm screen facing the room
  const helm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.3), MAT.hullShade);
  helm.position.set(0, 0.78, 0.98);
  helm.rotation.x = 0.7;
  const helmScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.22), new THREE.MeshBasicMaterial({ map: consoleScreenTexture(42) }));
  helmScreen.position.set(0, 0.795, 0.995);
  helmScreen.rotation.x = 0.7 - Math.PI / 2;
  g.add(helm, helmScreen);

  // hologram
  const globe = new THREE.Group();
  globe.position.y = 1.62;
  const wire = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 18, 12),
    new THREE.MeshBasicMaterial({ color: PAL.holoGreen, wireframe: true, transparent: true, opacity: 0.9 }),
  );
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.485, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0x1fae6a, transparent: true, opacity: 0.38, depthWrite: false }),
  );
  // "continents": a coarse inner wire shell for parallax
  const inner = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.36, 1),
    new THREE.MeshBasicMaterial({ color: 0xb6ffd8, wireframe: true, transparent: true, opacity: 0.5 }),
  );
  globe.add(core, wire, inner);
  g.add(globe);
  const rings: THREE.Mesh[] = [];
  for (const [rad, tilt] of [[0.68, 0.35], [0.8, -0.5]] as const) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(rad, 0.012, 6, 64),
      new THREE.MeshBasicMaterial({ color: PAL.holoGreen, transparent: true, opacity: 0.85 }),
    );
    ring.rotation.x = Math.PI / 2 + tilt;
    ring.position.y = 1.62;
    rings.push(ring);
    g.add(ring);
  }
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.62, 0.4, 0.75, 32, 1, true),
    new THREE.MeshBasicMaterial({
      color: PAL.holoGreen, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  beam.position.y = 1.29;
  g.add(beam);
  return { group: g, globe, beam, rings };
}

export function buildCabin(): CabinView {
  const group = new THREE.Group();
  const R = CABIN.wallR;
  const H = CABIN.ceilingY;

  // floor — glossy tile with painted rings; picks up scene.environment
  const ft = floorTextures(R + 0.3);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(R + 0.3, 96),
    new THREE.MeshStandardMaterial({
      map: ft.map, emissiveMap: ft.emissive, emissive: 0xffffff, emissiveIntensity: 1.3,
      roughnessMap: ft.rough, roughness: 1, metalness: 0.22, envMapIntensity: 1.6,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);

  // sill wall all round, back wall (aft, between the two aft pillars), top band
  group.add(arc([[R, 0], [R, 0.84], [R + 0.28, 0.95]], 0, 360, MAT.hull, 96));
  group.add(arc([[R - 0.006, 0.66], [R - 0.006, 0.72]], 0, 360, MAT.cyanGlow, 96));
  group.add(arc([[R - 0.004, 0], [R - 0.004, 0.1]], 0, 360, MAT.metalDark, 96));
  group.add(arc([[R + 0.02, 0.95], [R + 0.02, H]], -38, 38, MAT.hull, 24));
  group.add(arc([[R + 0.3, H - 0.7], [R, H - 0.58], [R, H]], 0, 360, MAT.hull, 96));
  group.add(arc([[R - 0.006, H - 0.52], [R - 0.006, H - 0.47]], 0, 360, MAT.cyanGlow, 96));

  // aft door
  const door = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2.1, 0.16), MAT.hullShade);
  frame.position.y = 1.05;
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(1.36, 1.86, 0.2), MAT.metal);
  leaf.position.y = 0.95;
  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.86, 0.22), MAT.cyanGlow);
  seam.position.y = 0.95;
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.07, 0.22), MAT.tealGlow);
  lamp.position.y = 2.0;
  door.add(frame, leaf, seam, lamp);
  place(door, 0, R - 0.06);
  group.add(door);
  // wall panels beside the door
  for (const d of [-24, 24]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, 0.08), MAT.hullShade);
    place(panel, d, R - 0.05, 1.75);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.34), new THREE.MeshBasicMaterial({ map: consoleScreenTexture(d + 60) }));
    place(scr, d, R - 0.1, 1.75);
    scr.rotation.y += Math.PI;
    group.add(panel, scr);
  }

  // window pillars: tapered column + inner buttress with a light strip
  const colGeo = new THREE.BoxGeometry(0.62, H, 0.5);
  const butGeo = new THREE.CylinderGeometry(0.2, 0.42, 1.5, 4, 1);
  const capGeo = new THREE.CylinderGeometry(0.5, 0.26, 0.9, 4, 1);
  const stripGeo = new THREE.BoxGeometry(0.1, 1.15, 0.03);
  for (const d of CABIN.pillars) {
    const col = new THREE.Mesh(colGeo, MAT.hull);
    place(col, d, R + 0.18, H / 2);
    const but = new THREE.Mesh(butGeo, MAT.hullShade);
    place(but, d, R - 0.1, 0.75);
    but.rotation.y += Math.PI / 4;
    const cap = new THREE.Mesh(capGeo, MAT.hullShade);
    place(cap, d, R - 0.12, H - 0.45);
    cap.rotation.y += Math.PI / 4;
    const strip = new THREE.Mesh(stripGeo, MAT.cyanGlow);
    place(strip, d, R - 0.085, 1.85);
    group.add(col, but, cap, strip);
  }

  // glass: barely-there tint so the windows read as glazed
  const glass = arc(
    [[R + 0.2, 0.95], [R + 0.2, H - 0.65]], 38, 322,
    new THREE.MeshBasicMaterial({
      color: 0x7fd4ff, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
    48, true,
  );
  group.add(glass);

  // ceiling ring with a big round skylight
  const ceil = new THREE.Mesh(new THREE.RingGeometry(CABIN.skylightR, R + 0.3, 96, 1), MAT.hull);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = H;
  group.add(ceil);
  group.add(arc([[CABIN.skylightR, H - 0.16], [CABIN.skylightR, H + 0.35]], 0, 360, MAT.hullShade, 64));
  group.add(arc([[CABIN.skylightR + 0.3, H - 0.01], [CABIN.skylightR + 0.02, H - 0.16]], 0, 360, MAT.hull, 64));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(CABIN.skylightR + 0.02, 0.05, 8, 96), MAT.cyanGlow);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = H - 0.16;
  group.add(rim);
  // skylight spokes
  for (let i = 0; i < 4; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, CABIN.skylightR * 2), MAT.hullShade);
    spoke.position.y = H + 0.3;
    spoke.rotation.y = (i / 4) * Math.PI;
    group.add(spoke);
  }

  // light-panel array (instanced, unlit white)
  const panelGeo = new THREE.BoxGeometry(0.5, 0.04, 1);
  const panels = new THREE.InstancedMesh(panelGeo, MAT.whiteGlow, 36);
  const bezel = new THREE.InstancedMesh(new THREE.BoxGeometry(0.62, 0.03, 1.12), MAT.hullShade, 36);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  let n = 0;
  for (let i = 0; i < 12; i++) {
    const deg = i * 30 + 15;
    for (const [r, len] of [[3.75, 1.2], [5.15, 1.2], [6.45, 0.9]] as const) {
      const p = polar(deg, r);
      q.setFromAxisAngle(up, deg * D2R);
      m4.compose(new THREE.Vector3(p.x, H - 0.02, p.z), q, new THREE.Vector3(1 + (r - 3.75) * 0.22, 1, len));
      panels.setMatrixAt(n, m4);
      m4.compose(new THREE.Vector3(p.x, H - 0.005, p.z), q, new THREE.Vector3(1 + (r - 3.75) * 0.22, 1, len));
      bezel.setMatrixAt(n, m4);
      n++;
    }
  }
  group.add(panels, bezel);

  // consoles + seats
  CONSOLES.forEach((c, i) => group.add(buildConsole(c.a0, c.a1, 7 + i * 13)));
  for (const s of seatPositions()) {
    const seat = buildSeat();
    seat.position.set(s.x, 0, s.z);
    seat.rotation.y = s.deg * D2R; // cushion faces the console
    group.add(seat);
  }

  const ped = buildPedestal();
  group.add(ped.group);

  // contact shadows: soft radial pools grounding seats, consoles, pedestal
  const shadowTex = radialTexture([[0, 'rgba(8,16,34,0.45)'], [0.55, 'rgba(8,16,34,0.18)'], [1, 'rgba(8,16,34,0)']]);
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
  const shadowAt = (x: number, z: number, sx: number, sz: number, deg = 0): void => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), shadowMat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = deg * D2R;
    m.position.set(x, 0.006, z);
    group.add(m);
  };
  for (const s of seatPositions()) shadowAt(s.x, s.z, 1.15, 1.15);
  for (const c of CONSOLES) {
    const mid = (c.a0 + c.a1) / 2;
    const p = polar(mid, (CABIN.consoleInnerR + CABIN.consoleOuterR) / 2);
    shadowAt(p.x, p.z, 4.4, 1.9, mid);
  }
  shadowAt(CABIN.pedestal.x, CABIN.pedestal.z, 3.0, 3.0);

  // light spill: soft additive pools on the floor under each window + glow at the sill
  const spillTex = radialTexture([[0, 'rgba(120,200,255,0.55)'], [0.5, 'rgba(90,150,255,0.18)'], [1, 'rgba(60,110,255,0)']]);
  const spillMat = new THREE.MeshBasicMaterial({ map: spillTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const windows = [65.5, 120.5, 180, 239.5, 294.5];
  for (const d of windows) {
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 2.2), spillMat);
    pool.rotation.x = -Math.PI / 2;
    const p = polar(d, R - 0.9);
    pool.position.set(p.x, 0.012, p.z);
    pool.rotation.z = d * D2R;
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.3), spillMat);
    place(halo, d, R - 0.02, 0.98);
    halo.rotation.y += Math.PI;
    group.add(pool, halo);
  }
  // green pool under the hologram
  const holoPool = new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, 4.2),
    new THREE.MeshBasicMaterial({
      map: radialTexture([[0, 'rgba(77,255,160,0.5)'], [0.45, 'rgba(77,255,160,0.14)'], [1, 'rgba(77,255,160,0)']]),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );
  holoPool.rotation.x = -Math.PI / 2;
  holoPool.position.set(CABIN.pedestal.x, 0.014, CABIN.pedestal.z);
  group.add(holoPool);

  // lights: soft white fill + key from the skylight + holo green + cool rim
  const hemi = new THREE.HemisphereLight(0xffffff, 0x9fb8e0, 1.05);
  const key = new THREE.DirectionalLight(0xffffff, 1.15);
  key.position.set(1.5, 6, 2.5);
  const holoLight = new THREE.PointLight(PAL.holoGreen, 5, 7, 1.6);
  holoLight.position.set(CABIN.pedestal.x, 1.7, CABIN.pedestal.z);
  const cool = new THREE.PointLight(0x8fdcff, 9, 12, 1.4);
  cool.position.set(0, 2.9, 0);
  group.add(hemi, key, key.target, holoLight, cool);

  const holoMats = [
    ped.globe.children[0],
    ped.globe.children[1],
    ped.globe.children[2],
    ...ped.rings,
    ped.beam,
  ].map((m) => (m as THREE.Mesh).material as THREE.MeshBasicMaterial);
  const baseOpacity = holoMats.map((m) => m.opacity);

  return {
    group,
    setHoloColor(hex) {
      const color = new THREE.Color(hex);
      for (const m of holoMats) m.color.copy(color);
    },
    update(t, dt, thrust) {
      const spin = 0.5 + thrust * 14;
      ped.globe.rotation.y += dt * spin;
      ped.globe.children[2].rotation.x += dt * 0.7;
      ped.globe.position.y = 1.62 + Math.sin(t * 1.4) * 0.03 + thrust * 0.25;
      ped.globe.scale.setScalar(1 + thrust * 0.35);
      ped.rings[0].rotation.z += dt * (0.8 + thrust * 8);
      ped.rings[1].rotation.z -= dt * (0.6 + thrust * 8);
      ped.rings.forEach((r) => (r.position.y = ped.globe.position.y));
      // hologram flicker
      const flick = 0.92 + 0.08 * Math.sin(t * 23) * Math.sin(t * 7.3);
      holoMats.forEach((m, i) => (m.opacity = Math.min(1, baseOpacity[i] * flick * (1 + thrust))));
      (ped.beam.material as THREE.MeshBasicMaterial).opacity = 0.14 + 0.04 * Math.sin(t * 3) + thrust * 0.4;
      holoLight.intensity = 5 + thrust * 30;
    },
  };
}
