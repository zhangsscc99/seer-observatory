// src/game/mode.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/mode.ts
var TRANSIT = {
  thrust: 0.8,
  fadeOut: 0.35,
  fadeIn: 0.6
};
var ModeMachine = class {
  mode;
  /** destination while in transit; otherwise the current playable mode */
  to;
  /** seconds since the transit began */
  t = 0;
  swapped = false;
  events;
  constructor(start = "cabin", events = {}) {
    this.mode = start;
    this.to = start;
    this.events = events;
  }
  /** which scene should be drawn right now */
  get scene() {
    if (this.mode !== "transit") return this.mode;
    return this.swapped ? this.to : this.to === "space" ? "cabin" : "space";
  }
  get lead() {
    return this.to === "space" ? TRANSIT.thrust : 0;
  }
  get duration() {
    return this.lead + TRANSIT.fadeOut + TRANSIT.fadeIn;
  }
  /** 0..1 progress of the launch thrust phase (1 once past it; 0 outside launch) */
  get thrust() {
    if (this.mode !== "transit" || this.to !== "space") return 0;
    return Math.min(1, this.t / TRANSIT.thrust);
  }
  /** 0..1 opacity of the full-screen fade overlay */
  get fade() {
    if (this.mode !== "transit") return 0;
    const t = this.t - this.lead;
    if (t <= 0) return 0;
    if (t < TRANSIT.fadeOut) return t / TRANSIT.fadeOut;
    return Math.max(0, 1 - (t - TRANSIT.fadeOut) / TRANSIT.fadeIn);
  }
  /** cabin → space. `canLaunch` is the proximity gate (near the holo table). */
  requestLaunch(canLaunch) {
    if (this.mode !== "cabin" || !canLaunch) return false;
    this.begin("space");
    return true;
  }
  /** space → cabin */
  requestDock() {
    if (this.mode !== "space") return false;
    this.begin("cabin");
    return true;
  }
  begin(to) {
    this.mode = "transit";
    this.to = to;
    this.t = 0;
    this.swapped = false;
  }
  update(dt) {
    if (this.mode !== "transit") return;
    this.t += dt;
    if (!this.swapped && this.t >= this.lead + TRANSIT.fadeOut) {
      this.swapped = true;
      this.events.onSwap?.(this.to);
    }
    if (this.t >= this.duration) {
      this.mode = this.to;
      this.t = 0;
      this.events.onArrive?.(this.to);
    }
  }
};

// src/game/mode.test.ts
test("launch is gated on proximity and only from the cabin", () => {
  const m = new ModeMachine();
  assert.equal(m.requestLaunch(false), false);
  assert.equal(m.mode, "cabin");
  assert.equal(m.requestDock(), false);
  assert.equal(m.requestLaunch(true), true);
  assert.equal(m.mode, "transit");
  assert.equal(m.requestLaunch(true), false, "no re-entry mid-transit");
  assert.equal(m.requestDock(), false);
});
test("launch timeline: 0.8 s thrust in cabin \u2192 fade \u2192 swap once \u2192 arrive in space", () => {
  const log = [];
  const m = new ModeMachine("cabin", { onSwap: (to) => log.push(`swap:${to}`), onArrive: (at) => log.push(`arrive:${at}`) });
  m.requestLaunch(true);
  m.update(0.4);
  assert.equal(m.scene, "cabin");
  assert.equal(m.thrust, 0.5);
  assert.equal(m.fade, 0);
  m.update(0.4 + TRANSIT.fadeOut / 2);
  assert.equal(m.scene, "cabin");
  assert.ok(Math.abs(m.fade - 0.5) < 1e-6);
  m.update(TRANSIT.fadeOut / 2 + 1e-3);
  assert.equal(m.scene, "space");
  assert.ok(m.fade > 0.9);
  assert.deepEqual(log, ["swap:space"]);
  for (let i = 0; i < 60; i++) m.update(1 / 60);
  assert.equal(m.mode, "space");
  assert.equal(m.fade, 0);
  assert.deepEqual(log, ["swap:space", "arrive:space"]);
});
test("dock: no thrust phase, returns to cabin, round-trips", () => {
  const m = new ModeMachine("space");
  assert.equal(m.requestDock(), true);
  assert.equal(m.thrust, 0);
  assert.equal(m.duration, TRANSIT.fadeOut + TRANSIT.fadeIn);
  m.update(TRANSIT.fadeOut + 0.01);
  assert.equal(m.scene, "cabin");
  m.update(TRANSIT.fadeIn);
  assert.equal(m.mode, "cabin");
  assert.equal(m.requestLaunch(true), true);
});
test("a huge dt still swaps exactly once and lands", () => {
  let swaps = 0;
  const m = new ModeMachine("cabin", { onSwap: () => swaps++ });
  m.requestLaunch(true);
  m.update(10);
  assert.equal(swaps, 1);
  assert.equal(m.mode, "space");
});
