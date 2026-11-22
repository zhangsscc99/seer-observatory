// Composition root: wires game logic (src/game, three-free) to rendering,
// input, HUD and audio. One scene; mode decides which groups are visible.
import * as THREE from 'three';
import { Sfx } from './audio/sfx.ts';
import { ARCHIVE_KEY, addScan, emptyArchive, parseArchive, serializeArchive } from './game/archive.ts';
import { buildCabinWorld, CABIN, nearPedestal } from './game/cabin.ts';
import { Docker } from './game/dock.ts';
import { ModeMachine, type Playable } from './game/mode.ts';
import { clamp, damp } from './game/rng.ts';
import { Robot } from './game/robot.ts';
import { hazardEffect, SCAN, Scanner, type ScanTarget } from './game/scan.ts';
import { forwardOf, Ship, SHIP } from './game/ship.ts';
import { BINARY_STARS, PLANETS, planetById, SECTOR_RADIUS, solidBodies, SUN_DIR, type PlanetDef } from './game/space.ts';
import { computeEjectTarget, TidalField } from './game/tidal.ts';
import { Controls } from './input/controls.ts';
import { buildCabin } from './render/cabin.ts';
import { Hud } from './render/hud.ts';
import { buildRobot } from './render/robot.ts';
import { buildShip } from './render/ship.ts';
import { bakeSky, makeStars } from './render/sky.ts';
import { RING_QUAT } from './render/rings.ts';
import { BH_DISK_QUAT, buildSpace, MAGNETAR_QUAT, RING_CITY_QUAT } from './render/space.ts';

declare global {
  interface Window {
    __frames: number;
    __seer: Record<string, unknown>;
  }
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 9000);
scene.add(camera);

// sky: baked once
const coarse = matchMedia('(pointer: coarse)').matches;
const sky = bakeSky(renderer, coarse ? 512 : 1024);
scene.background = sky;
scene.environment = sky;
scene.environmentIntensity = 0.9;
scene.backgroundIntensity = 1.0;
const stars = makeStars(1100, 4000);
scene.add(stars);

const cabin = buildCabin();
const space = buildSpace();
const robotView = buildRobot();
const shipView = buildShip();
scene.add(cabin.group, space.far, space.near, robotView.group, shipView.group);

// ── game state ───────────────────────────────────────────────────────
const world = buildCabinWorld();
const bodies = solidBodies();
const robot = new Robot(CABIN.spawn.x, CABIN.spawn.z, CABIN.spawn.heading);
let ship = new Ship({ x: 0, y: 10, z: -40 }, 0);
const sfx = new Sfx();
const controls = new Controls(canvas);
let started = false;
const scanner = new Scanner();
const docker = new Docker();
const tidalField = new TidalField();
const blackholePlanet = planetById('blackhole');
const ringCityPlanet = planetById('ring-city');
let tidalFlash = 0;
let archive = emptyArchive();
let targetId: string | null = null;
try {
  archive = parseArchive(localStorage.getItem(ARCHIVE_KEY));
} catch {
  archive = emptyArchive();
}
try {
  const savedTarget = localStorage.getItem('seer.target');
  if (savedTarget !== null && planetById(savedTarget)) targetId = savedTarget;
} catch {
  targetId = null;
}

const cam = { yaw: 0, pitch: 0.3, zoom: 1, shipYaw: 0, shipPitch: 0, focusFovV: 0 };
const CAM_PITCH_MIN = 0.14;
const CAM_PITCH_MAX = 1.15;

function applyScene(s: Playable): void {
  const inSpace = s === 'space';
  cabin.group.visible = !inSpace;
  robotView.group.visible = !inSpace;
  space.near.visible = inSpace;
  shipView.group.visible = inSpace;
  // per-scene exposure: tuned so cabin PBR + directional key stays cleanly inside 110..135 mean
  renderer.toneMappingExposure = inSpace ? 1.0 : 1.04;
  camera.near = inSpace ? 0.5 : 0.08;
  camera.updateProjectionMatrix();
}

const mode = new ModeMachine('cabin', {
  onSwap(to) {
    if (to === 'space') {
      ship = new Ship({ x: 0, y: 10, z: -40 }, 0);
      cam.shipYaw = 0.5; // start off-axis so the camera swings in behind the ship
      cam.shipPitch = -0.15;
      cam.focusFovV = 0;
    } else {
      // step back out of the hologram, facing the room
      robot.x = CABIN.pedestal.x;
      robot.z = CABIN.pedestal.z + 1.9;
      robot.vx = robot.vz = 0;
      robot.heading = 0;
      cam.yaw = 0;
      cam.pitch = 0.3;
      hud.setWarn(null, null);
      hud.setScan(null, 0, false);
      tidalField.reset();
      tidalFlash = 0;
      hud.setTidal(1, 0, 0);
      sfx.play('dock');
    }
    applyScene(to);
    hud.setScene(to, true);
  },
  onArrive(at) {
    hud.setScene(at, false);
  },
});

const hud = new Hud(
  {
    onStart() {
      started = true;
      sfx.unlock();
      sfx.play('confirm');
    },
    onAct: cabinInteract,
    onDock: tryDock,
    onMute() {
      sfx.unlock();
      sfx.setMuted(!sfx.muted);
      return sfx.muted;
    },
    onHold(which, down) {
      if (which === 'boost') controls.boostBtn = down;
      else controls.brakeBtn = down;
    },
  },
  sfx.muted,
);
hud.setArchive(archive);
hud.setTargets(PLANETS, targetId, selectTarget, previewTarget);
space.setTarget(targetId);
function applyTargetHolo(p: PlanetDef): void {
  if (p.kind === 'binary') cabin.setHoloColor(0xbfe0ff, 0xffb066);
  else if (p.kind === 'blackhole') cabin.setHoloColor(0xf4ecff, 0x3b186e);
  else if (p.kind === 'ring-city') cabin.setHoloColor(0xfff1dc, 0xffb464);
  else cabin.setHoloColor(p.colors[2]);
}
function previewTarget(id: string): void {
  const p = planetById(id);
  if (!p) return;
  applyTargetHolo(p);
  if ((p.kind === 'blackhole' || p.kind === 'ring-city') && p.hazard) {
    hud.setWarn(hazardEffect(p.hazard).warn, p.hazard);
  } else if (mode.mode === 'cabin') {
    hud.setWarn(null, null);
  }
}

const savedTargetPlanet = targetId === null ? undefined : planetById(targetId);
if (savedTargetPlanet) {
  applyTargetHolo(savedTargetPlanet);
  hud.setGoal(`航行至 ${savedTargetPlanet.name} 执行扫描`);
}
applyScene('cabin');

function canLaunch(): boolean {
  return started && mode.mode === 'cabin' && nearPedestal(robot.x, robot.z);
}
function tryLaunch(): void {
  if (mode.requestLaunch(canLaunch())) {
    sfx.play('launch');
    hud.setScene('cabin', true);
    hud.setTip('');
  } else if (mode.mode === 'cabin' && started) sfx.play('deny');
}
function tryDock(): void {
  if (mode.requestDock()) {
    controls.boostBtn = controls.brakeBtn = false;
    hud.setScene('space', true);
  }
}
function selectTarget(id: string): void {
  const p = planetById(id);
  if (!p) {
    sfx.play('deny');
    return;
  }
  targetId = id;
  try {
    localStorage.setItem('seer.target', id);
  } catch {
    /* private mode */
  }
  space.setTarget(id);
  applyTargetHolo(p);
  hud.setGoal(`航行至 ${p.name} 执行扫描`);
  hud.setTargets(PLANETS, id, selectTarget, previewTarget);
  hud.closeTargets();
  sfx.play('confirm');
  tryLaunch();
}
function cabinInteract(): void {
  if (!started) return;
  if (mode.mode !== 'cabin') return;
  if (hud.targetsOpen) {
    hud.closeTargets();
    return;
  }
  if (hud.archiveOpen) {
    hud.closePanels();
    return;
  }
  if (nearPedestal(robot.x, robot.z)) {
    hud.setTargets(PLANETS, targetId, selectTarget, previewTarget);
    hud.toggleTargets();
  } else {
    sfx.play('deny');
  }
}
controls.onInteract = cabinInteract;
controls.onAnyGesture = () => {
  if (started) sfx.unlock();
};
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR' && started) tryDock();
  if (e.code === 'KeyM') hud.setMuted((sfx.setMuted(!sfx.muted), sfx.muted));
});

// ── resize ───────────────────────────────────────────────────────────
let aspect = 1;
function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h, false);
  aspect = w / h;
  camera.aspect = aspect;
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
resize();

/** vertical fov that keeps ≥ `hDeg` horizontal coverage in portrait */
function fovFor(baseV: number, hDeg: number): number {
  const need = (2 * Math.atan(Math.tan((hDeg * Math.PI) / 360) / aspect) * 180) / Math.PI;
  return clamp(Math.max(baseV, need), baseV, 96);
}

// ── frame ────────────────────────────────────────────────────────────
const look = new THREE.Vector3();
const shipPos = new THREE.Vector3();
const shipFwd = new THREE.Vector3();
let wasNear = false;
let lastSteps = 0;
let last = performance.now();
let time = 0;
window.__frames = 0;

function updateCabin(dt: number, active: boolean): void {
  const l = controls.consumeLook();
  if (active) {
    cam.yaw -= l.dx * 0.0055;
    cam.pitch = clamp(cam.pitch + l.dy * 0.004, CAM_PITCH_MIN, CAM_PITCH_MAX);
  }
  const moving = active && !hud.panelOpen;
  robot.update(dt, { moveX: moving ? controls.moveX : 0, moveY: moving ? controls.moveY : 0, run: moving && controls.run, camYaw: cam.yaw }, world);
  if (robot.steps !== lastSteps) {
    lastSteps = robot.steps;
    sfx.play('footstep');
  }
  robotView.group.position.set(robot.x, 0, robot.z);
  robotView.group.rotation.y = robot.heading;
  robotView.setHover(mode.thrust > 0.01); // legs retract while the launch burn runs
  robotView.animate(robot.walkPhase, robot.speed, time, dt);

  const near = canLaunch();
  if (near && !wasNear) sfx.play('prompt');
  wasNear = near;
  if (mode.mode === 'cabin') {
    hud.setInteract(near && !hud.panelOpen);
    hud.setTip(near ? '全息星图台已就绪 · 点击「星图」或按 E' : '');
  }

  // orbit camera, pulled in so it never leaves the hull
  const thrust = mode.thrust;
  const ease = thrust * thrust * (3 - 2 * thrust);
  const portrait = aspect < 1;
  const tx = robot.x;
  const ty = 0.66;
  const tz = robot.z;
  let dist = (portrait ? 3.3 : 2.9) * cam.zoom * (1 - ease * 0.35);
  const cp = Math.cos(cam.pitch);
  const dx = Math.sin(cam.yaw) * cp;
  const dy = Math.sin(cam.pitch);
  const dz = Math.cos(cam.yaw) * cp;
  const maxR = CABIN.wallR - 0.35;
  for (let i = 0; i < 12; i++) {
    const x = tx + dx * dist;
    const z = tz + dz * dist;
    if (Math.hypot(x, z) <= maxR && ty + dy * dist <= CABIN.ceilingY - 0.4) break;
    dist *= 0.88;
  }
  camera.position.set(tx + dx * dist, ty + dy * dist, tz + dz * dist);
  if (ease > 0) {
    const k = ease * 0.035;
    camera.position.x += Math.sin(time * 71) * k;
    camera.position.y += Math.sin(time * 93) * k;
  }
  look.set(tx, ty + 0.25 + (portrait ? 0.35 : 0.15), tz);
  camera.lookAt(look);
  camera.fov = fovFor(58, 62) + ease * 22;
  camera.updateProjectionMatrix();
  cabin.update(time, dt, thrust);
}

function nearestScanTarget(): ScanTarget | null {
  let best: ScanTarget | null = null;
  let bestDist = Infinity;
  for (const p of PLANETS) {
    const d = Math.hypot(ship.pos.x - p.pos.x, ship.pos.y - p.pos.y, ship.pos.z - p.pos.z);
    if (d <= p.radius * SCAN.rangeFactor && d < bestDist) {
      bestDist = d;
      best = { id: p.id, name: p.name, radius: p.radius, hazard: p.hazard };
    }
  }
  return best;
}

function updateSpace(dt: number, active: boolean): void {
  controls.consumeLook();
  const near = nearestScanTarget();
  const hazard = hazardEffect(near?.hazard);
  ship.update(
    dt,
    { steerX: active ? controls.moveX : 0, steerY: active ? controls.moveY : 0, boost: active && controls.boost, brake: active && controls.brake },
    bodies,
    SECTOR_RADIUS,
    hazard.energyMul,
  );
  if (ship.bumped && ship.speed > 20) sfx.play('bump');

  // black-hole tidal field: time dilation, edge vignette, and crush auto-ejection
  let tidalZone: 'safe' | 'hazard' | 'crush' = 'safe';
  let tidalTension = 0;
  let tidalScale = 1.0;
  if (blackholePlanet) {
    const bhDist = Math.hypot(
      ship.pos.x - blackholePlanet.pos.x,
      ship.pos.y - blackholePlanet.pos.y,
      ship.pos.z - blackholePlanet.pos.z,
    );
    const step = tidalField.update(dt, bhDist, blackholePlanet.radius);
    tidalZone = step.zone;
    tidalTension = step.tension;
    tidalScale = step.timeScale;
    if (step.ejected) {
      const targetPos = computeEjectTarget(ship.pos, blackholePlanet.pos, blackholePlanet.radius);
      ship.pos.x = targetPos.x;
      ship.pos.y = targetPos.y;
      ship.pos.z = targetPos.z;
      ship.speed = SHIP.cruise;
      tidalFlash = 0.55;
      space.triggerTidalPulse();
      sfx.play('eject');
    }
  }
  tidalFlash = Math.max(0, tidalFlash - dt * 1.15);
  const vignette =
    tidalZone === 'crush'
      ? 0.42 + 0.3 * tidalTension
      : tidalZone === 'hazard'
        ? 0.08 + 0.24 * clamp((tidalScale - 1.2) / 1.2, 0, 1)
        : 0;
  hud.setTidal(tidalScale, vignette, tidalFlash);

  shipPos.set(ship.pos.x, ship.pos.y, ship.pos.z);
  shipView.group.position.copy(shipPos);
  shipView.group.rotation.set(ship.pitch, ship.yaw, ship.roll, 'YXZ');
  shipView.animate(ship.speedFrac, ship.boosting, time);

  // chase camera: orientation lags the ship, distance stretches with speed
  const k = damp(3.2, dt);
  cam.shipYaw += (ship.yaw - cam.shipYaw) * k;
  cam.shipPitch += (ship.pitch - cam.shipPitch) * k;
  const f = forwardOf(cam.shipYaw, cam.shipPitch);
  const portrait = aspect < 1;
  const back = (portrait ? 19 : 14) + ship.speedFrac * 5;
  camera.position.set(ship.pos.x - f.x * back, ship.pos.y - f.y * back + (portrait ? 5.5 : 4), ship.pos.z - f.z * back);
  const sf = ship.forward;
  shipFwd.set(sf.x, sf.y, sf.z);
  look.copy(shipPos).addScaledVector(shipFwd, 14);
  look.y += 1.5;
  camera.lookAt(look);
  camera.rotateZ(ship.roll * 0.25);
  if (active && (Math.abs(controls.moveX) > 0.05 || Math.abs(controls.moveY) > 0.05 || controls.boost || controls.brake)) {
    cam.focusFovV = 0;
  }
  const baseFov = fovFor(60, 60) + ship.speedFrac * 14 + (ship.boosting ? 4 : 0);
  camera.fov = cam.focusFovV > 0 ? Math.max(baseFov, cam.focusFovV) : baseFov;
  camera.updateProjectionMatrix();
  hud.setFlight(ship.speed, ship.energy / SHIP.energyMax, ship.depleted);
  hud.setTip(ship.depleted ? '推进能量耗尽 · 充能中' : Math.hypot(ship.pos.x, ship.pos.y, ship.pos.z) > SECTOR_RADIUS ? '已到达星域边界 · 自动返航' : '');
  const selectedPlanet = targetId === null ? undefined : planetById(targetId);
  const warnHazard =
    tidalZone === 'crush'
      ? 'tidal'
      : near?.hazard ??
        (selectedPlanet?.kind === 'binary' || selectedPlanet?.kind === 'blackhole' || selectedPlanet?.kind === 'ring-city'
          ? selectedPlanet.hazard
          : undefined);
  const warnText =
    tidalZone === 'crush'
      ? `潮汐临界·引力张量 ${Math.round(tidalTension * 100)}% · 自动弹离就绪`
      : near
        ? hazard.warn
        : warnHazard
          ? hazardEffect(warnHazard).warn
          : null;
  hud.setWarn(warnText, warnHazard ?? null);

  // ring-city docking: hold within 1.7R at ≤25 km/s for 2.5 s → resupply
  // (energy refill + 环城通行密钥 into the archive); 60 s cooldown between rewards
  if (ringCityPlanet) {
    const dRc = Math.hypot(
      ship.pos.x - ringCityPlanet.pos.x,
      ship.pos.y - ringCityPlanet.pos.y,
      ship.pos.z - ringCityPlanet.pos.z,
    );
    for (const ev of docker.update(dt, dRc, ringCityPlanet.radius, ship.speed)) {
      if (ev.type !== 'docked') continue;
      ship.energy = SHIP.energyMax;
      archive = addScan(
        archive,
        { id: ringCityPlanet.id, name: ringCityPlanet.name, resource: ev.resource, amount: ev.amount },
        Date.now(),
      );
      try {
        localStorage.setItem(ARCHIVE_KEY, serializeArchive(archive));
      } catch {
        /* private mode */
      }
      hud.setArchive(archive);
      hud.showScanCard(ringCityPlanet.name, ev.resource, ev.amount, ev.log);
      sfx.play('confirm');
    }
    hud.setDock(docker.state, docker.progress, docker.cooldown);
  }

  const events = scanner.update(dt, near, active && controls.act);
  for (const ev of events) {
    if (ev.type !== 'complete') continue;
    const p = planetById(ev.id);
    const name = p?.name ?? ev.id;
    archive = addScan(archive, { id: ev.id, name, resource: ev.resource, amount: ev.amount }, Date.now());
    try {
      localStorage.setItem(ARCHIVE_KEY, serializeArchive(archive));
    } catch {
      /* private mode */
    }
    hud.setArchive(archive);
    hud.showScanCard(name, ev.resource, ev.amount, ev.log);
    sfx.play('confirm');
  }
  hud.setScan(near?.name ?? null, scanner.progress, scanner.done);
}

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;
  controls.poll();
  mode.update(dt);
  hud.setFade(mode.fade);

  const active = started && mode.mode !== 'transit';
  const sceneNow = mode.scene;
  if (sceneNow === 'cabin') updateCabin(dt, active);
  else updateSpace(dt, active);
  space.update(time, dt, camera, shipPos, shipFwd, sceneNow === 'space' ? ship.speedFrac : 0);
  stars.position.copy(camera.position);

  sfx.setLoops(started && sceneNow === 'cabin' ? 1 : 0.25, sceneNow === 'space' ? Math.max(0.05, ship.speedFrac) : mode.thrust * 0.6, ship.boosting);
  renderer.render(scene, camera);
  window.__frames++;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// e2e / debug hooks
window.__seer = {
  mode,
  robot,
  robotView,
  controls,
  sfx,
  space,
  scanner,
  docker,
  get ship() {
    return ship;
  },
  get archive() {
    return archive;
  },
  get targetId() {
    return targetId;
  },
  get started() {
    return started;
  },
  cam,
  /** teleport next to the holo table (e2e shortcut) */
  gotoPedestal() {
    robot.x = CABIN.pedestal.x;
    robot.z = CABIN.pedestal.z + 1.8;
  },
  launch: tryLaunch,
  dock: tryDock,
  info: () => renderer.info.render,
  /** e2e/debug: teleport the ship near a planet, facing it. Ice-ring planets
   *  get a 3/4 view: 3.2R out, 12° above the ring plane, ~60° off the
   *  anti-sun azimuth so the terminator cuts the disc and the umbra arc
   *  lands on the near ring. Other planets: 3R out, sun at our back. */
  focusPlanet(id: string) {
    const p = planetById(id);
    if (!p || mode.mode !== 'space') return false;
    const dir = new THREE.Vector3(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z);
    let dist = p.radius * 3;
    cam.focusFovV = 0;
    if (p.kind === 'ice-ring') {
      dist = p.radius * 3.2;
      const n = new THREE.Vector3(0, 1, 0).applyQuaternion(RING_QUAT);
      const a = dir.clone().negate().addScaledVector(n, dir.dot(n)).normalize();
      const t = new THREE.Vector3().crossVectors(n, a);
      const az = (60 * Math.PI) / 180;
      const el = (12 * Math.PI) / 180;
      dir.copy(a)
        .multiplyScalar(Math.cos(az))
        .addScaledVector(t, Math.sin(az))
        .multiplyScalar(Math.cos(el))
        .addScaledVector(n, Math.sin(el));
    } else if (p.kind === 'gas-storm') {
      // 3/4 lit view with ~15° elevation so zonal bands, storm eye and station read
      dist = p.radius * 2.6;
      dir.set(0.75, Math.sin((15 * Math.PI) / 180), -0.6).normalize();
    } else if (p.kind === 'red-giant') {
      // close approach inside 3.2R scan range (radiation HUD warn active) & edge of 2.6R dust veil
      dist = p.radius * 2.55;
      dir.set(0.48, 0.14, -0.86).normalize();
    } else if (p.kind === 'blackhole') {
      // 3/4 hero view ~18° above the tilted accretion disk plane, inside 3.2R hazard/scan range
      // so photon ring + Doppler-beamed disk + lensed arch + ship rim light + time dilation HUD all frame together
      dist = p.radius * 3.05;
      const localView = new THREE.Vector3(0.32, Math.sin((18 * Math.PI) / 180), 0.90).normalize();
      dir.copy(localView).applyQuaternion(BH_DISK_QUAT).normalize();
      tidalField.reset();
      tidalFlash = 0;
    } else if (p.kind === 'ring-city') {
      // 3.0R hero view ~23° above the tilted ring plane on the inward-sunlit 3/4 side (stays well inside
      // SECTOR_RADIUS so no boundary warning triggers, and frames ellipse + 4 docking towers + window grid)
      dist = p.radius * 3.0;
      const n = new THREE.Vector3(0, 1, 0).applyQuaternion(RING_CITY_QUAT).normalize();
      const inward = new THREE.Vector3(-p.pos.x, -p.pos.y, -p.pos.z);
      const inProj = inward.addScaledVector(n, -inward.dot(n)).normalize();
      const tangent = new THREE.Vector3().crossVectors(n, inProj).normalize();
      if (tangent.dot(dir) < 0) tangent.negate();
      const az = (48 * Math.PI) / 180;
      const el = (23 * Math.PI) / 180;
      dir.copy(inProj)
        .multiplyScalar(Math.cos(az))
        .addScaledVector(tangent, Math.sin(az))
        .multiplyScalar(Math.cos(el))
        .addScaledVector(n, Math.sin(el))
        .normalize();
    } else if (p.kind === 'binary') {
      // 3.3R outer-side framing (away from twin-star midpoint, slight +Y lift) so both star discs + planet fit cleanly
      dist = p.radius * 3.3;
      const sA = BINARY_STARS[0];
      const sB = BINARY_STARS[1];
      const midX = (sA.pos.x + sB.pos.x) * 0.5;
      const midY = (sA.pos.y + sB.pos.y) * 0.5;
      const midZ = (sA.pos.z + sB.pos.z) * 0.5;
      dir.set(p.pos.x - midX, p.pos.y - midY, p.pos.z - midZ).normalize();
      dir.y += 0.06;
      dir.normalize();
    } else if (p.kind === 'magnetar') {
      // 4.2R 侧斜 3/4 构图（磁赤道上方 18°、朝太阳偏转 46° 并微压机头 0.08 rad）：
      // 兼顾铁壳昼夜明暗交界与 L=1.74..2.60R 偶极磁力线弧笼全景入画，且让星体盘面浮于飞船轮廓上方不被挡死
      dist = p.radius * 4.2;
      const pole = new THREE.Vector3(0, 1, 0).applyQuaternion(MAGNETAR_QUAT).normalize();
      const inward = new THREE.Vector3(-p.pos.x, -p.pos.y, -p.pos.z);
      const inEq = inward.addScaledVector(pole, -inward.dot(pole)).normalize();
      const tangent = new THREE.Vector3().crossVectors(pole, inEq).normalize();
      if (tangent.dot(dir) < 0) tangent.negate();
      const az = (46 * Math.PI) / 180;
      const el = (18 * Math.PI) / 180;
      dir.copy(inEq)
        .multiplyScalar(Math.cos(az))
        .addScaledVector(tangent, Math.sin(az))
        .multiplyScalar(Math.cos(el))
        .addScaledVector(pole, Math.sin(el))
        .normalize();
    }
    ship.pos.x = p.pos.x + dir.x * dist;
    ship.pos.y = p.pos.y + dir.y * dist;
    ship.pos.z = p.pos.z + dir.z * dist;
    const fx = p.pos.x - ship.pos.x;
    const fy = p.pos.y - ship.pos.y;
    const fz = p.pos.z - ship.pos.z;
    const fl = Math.hypot(fx, fy, fz);
    ship.yaw = Math.atan2(-fx / fl, -fz / fl);
    ship.pitch = Math.asin(fy / fl);
    if (p.kind === 'magnetar') ship.pitch -= 0.08;
    ship.roll = 0;
    ship.speed = SHIP.brakeSpeed;
    ship.energy = SHIP.energyMax;
    cam.shipYaw = ship.yaw;
    cam.shipPitch = ship.pitch;
    if (p.kind === 'blackhole') {
      cam.focusFovV = aspect < 1 ? 82 : 64;
    } else if (p.kind === 'ring-city') {
      cam.focusFovV = aspect < 1 ? 88 : 66;
    } else if (p.kind === 'magnetar') {
      cam.focusFovV = aspect < 1 ? 104 : 66;
    } else if (p.kind === 'binary') {
      // angular-separation / FOV check: ensure both stars stay inside the frame with margin on landscape & portrait
      const portrait = aspect < 1;
      const speedFrac = ship.speedFrac;
      const back = (portrait ? 19 : 14) + speedFrac * 5;
      const f = forwardOf(ship.yaw, ship.pitch);
      const camPos = new THREE.Vector3(ship.pos.x - f.x * back, ship.pos.y - f.y * back + (portrait ? 5.5 : 4), ship.pos.z - f.z * back);
      const lookPos = new THREE.Vector3(ship.pos.x + f.x * 14, ship.pos.y + f.y * 14 + 1.5, ship.pos.z + f.z * 14);
      const fwd = lookPos.sub(camPos).normalize();
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
      const up = new THREE.Vector3().crossVectors(right, fwd);
      let reqTanV = 0;
      const margin = 1.32;
      for (const s of BINARY_STARS) {
        const v = new THREE.Vector3(s.pos.x - camPos.x, s.pos.y - camPos.y, s.pos.z - camPos.z);
        const z = Math.max(1, v.dot(fwd));
        const x = Math.abs(v.dot(right)) + s.radius * 1.4;
        const y = Math.abs(v.dot(up)) + s.radius * 1.4;
        reqTanV = Math.max(reqTanV, (y / z) * margin, ((x / z) * margin) / Math.max(0.35, aspect));
      }
      cam.focusFovV = clamp((2 * Math.atan(reqTanV) * 180) / Math.PI, 60, 102);
    }
    return true;
  },
};
