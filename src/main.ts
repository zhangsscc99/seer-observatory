// Composition root: wires game logic (src/game, three-free) to rendering,
// input, HUD and audio. One scene; mode decides which groups are visible.
import * as THREE from 'three';
import { Sfx } from './audio/sfx.ts';
import { buildCabinWorld, CABIN, nearPedestal } from './game/cabin.ts';
import { ModeMachine, type Playable } from './game/mode.ts';
import { clamp, damp } from './game/rng.ts';
import { Robot } from './game/robot.ts';
import { forwardOf, Ship, SHIP } from './game/ship.ts';
import { SECTOR_RADIUS, solidBodies } from './game/space.ts';
import { Controls } from './input/controls.ts';
import { buildCabin } from './render/cabin.ts';
import { Hud } from './render/hud.ts';
import { buildRobot } from './render/robot.ts';
import { buildShip } from './render/ship.ts';
import { bakeSky, makeStars } from './render/sky.ts';
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

const cam = { yaw: 0, pitch: 0.3, shipYaw: 0, shipPitch: 0 };
const CAM_PITCH_MIN = 0.14;
const CAM_PITCH_MAX = 1.15;

function applyScene(s: Playable): void {
  const inSpace = s === 'space';
  cabin.group.visible = !inSpace;
  robotView.group.visible = !inSpace;
  space.near.visible = inSpace;
  shipView.group.visible = inSpace;
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
    onAct: tryLaunch,
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
controls.onInteract = () => {
  if (!started) return;
  if (mode.mode === 'cabin') tryLaunch();
};
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
  robot.update(dt, { moveX: active ? controls.moveX : 0, moveY: active ? controls.moveY : 0, run: controls.run, camYaw: cam.yaw }, world);
  if (robot.steps !== lastSteps) {
    lastSteps = robot.steps;
    sfx.play('footstep');
  }
  robotView.group.position.set(robot.x, 0, robot.z);
  robotView.group.rotation.y = robot.heading;
  robotView.animate(robot.walkPhase, robot.speed, time, dt);

  const near = canLaunch();
  if (near && !wasNear) sfx.play('prompt');
  wasNear = near;
  if (mode.mode === 'cabin') {
    hud.setInteract(near);
    hud.setTip(near ? '全息星图台已就绪 · 点击「启航」或按 E' : '');
  }

  // orbit camera, pulled in so it never leaves the hull
  const thrust = mode.thrust;
  const ease = thrust * thrust * (3 - 2 * thrust);
  const portrait = aspect < 1;
  const tx = robot.x;
  const ty = 0.66;
  const tz = robot.z;
  let dist = (portrait ? 3.3 : 2.9) * (1 - ease * 0.35);
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

function updateSpace(dt: number, active: boolean): void {
  controls.consumeLook();
  ship.update(
    dt,
    { steerX: active ? controls.moveX : 0, steerY: active ? controls.moveY : 0, boost: active && controls.boost, brake: active && controls.brake },
    bodies,
    SECTOR_RADIUS,
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
  controls,
  sfx,
  get ship() {
    return ship;
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
};
