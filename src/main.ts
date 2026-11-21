// Composition root: wires game logic (src/game, three-free) to rendering,
// input, HUD and audio. One scene; mode decides which groups are visible.
import * as THREE from 'three';
import { Sfx } from './audio/sfx.ts';
import { ARCHIVE_KEY, addScan, emptyArchive, parseArchive, serializeArchive } from './game/archive.ts';
import { buildCabinWorld, CABIN, nearPedestal } from './game/cabin.ts';
import { ModeMachine, type Playable } from './game/mode.ts';
import { clamp, damp } from './game/rng.ts';
import { Robot } from './game/robot.ts';
import { hazardEffect, SCAN, Scanner, type ScanTarget } from './game/scan.ts';
import { forwardOf, Ship, SHIP } from './game/ship.ts';
import { PLANETS, planetById, SECTOR_RADIUS, solidBodies, SUN_DIR, type PlanetDef } from './game/space.ts';
import { Controls } from './input/controls.ts';
import { buildCabin } from './render/cabin.ts';
import { Hud } from './render/hud.ts';
import { buildRobot } from './render/robot.ts';
import { buildShip } from './render/ship.ts';
import { bakeSky, makeStars } from './render/sky.ts';
import { RING_QUAT } from './render/rings.ts';
import { buildSpace } from './render/space.ts';

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

const cam = { yaw: 0, pitch: 0.3, zoom: 1, shipYaw: 0, shipPitch: 0 };
const CAM_PITCH_MIN = 0.14;
const CAM_PITCH_MAX = 1.15;

function applyScene(s: Playable): void {
  const inSpace = s === 'space';
  cabin.group.visible = !inSpace;
  robotView.group.visible = !inSpace;
  space.near.visible = inSpace;
  shipView.group.visible = inSpace;
  // per-scene exposure: the white cabin needs a darker grade than open space
  renderer.toneMappingExposure = inSpace ? 1.0 : 0.72;
  camera.near = inSpace ? 0.5 : 0.08;
  camera.updateProjectionMatrix();
}

const mode = new ModeMachine('cabin', {
  onSwap(to) {
    if (to === 'space') {
      ship = new Ship({ x: 0, y: 10, z: -40 }, 0);
      cam.shipYaw = 0.5; // start off-axis so the camera swings in behind the ship
      cam.shipPitch = -0.15;
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
hud.setTargets(PLANETS, targetId, selectTarget);
space.setTarget(targetId);
function applyTargetHolo(p: PlanetDef): void {
  if (p.kind === 'binary') cabin.setHoloColor(0xbfe0ff, 0xffb066);
  else cabin.setHoloColor(p.colors[2]);
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
  hud.setTargets(PLANETS, id, selectTarget);
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
    hud.setTargets(PLANETS, targetId, selectTarget);
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
  camera.fov = fovFor(60, 60) + ship.speedFrac * 14 + (ship.boosting ? 4 : 0);
  camera.updateProjectionMatrix();
  hud.setFlight(ship.speed, ship.energy / SHIP.energyMax, ship.depleted);
  hud.setTip(ship.depleted ? '推进能量耗尽 · 充能中' : Math.hypot(ship.pos.x, ship.pos.y, ship.pos.z) > SECTOR_RADIUS ? '已到达星域边界 · 自动返航' : '');
  const selectedPlanet = targetId === null ? undefined : planetById(targetId);
  const warnHazard = near?.hazard ?? (selectedPlanet?.kind === 'binary' ? selectedPlanet.hazard : undefined);
  const warnText = near ? hazard.warn : warnHazard ? hazardEffect(warnHazard).warn : null;
  hud.setWarn(warnText, warnHazard ?? null);

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
    } else if (p.kind === 'binary') {
      // ~3.2R approach off anti-sun: frames dual cool/warm lit planet with warm companion star in view
      dist = p.radius * 3.15;
      dir.set(-0.78, 0.14, 0.61).normalize();
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
    ship.roll = 0;
    ship.speed = SHIP.brakeSpeed;
    ship.energy = SHIP.energyMax;
    cam.shipYaw = ship.yaw;
    cam.shipPitch = ship.pitch;
    return true;
  },
};
