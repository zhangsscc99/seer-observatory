// src/game/dock.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/game/dock.ts
var DOCK = {
  /** approach band outer edge = station radius × this */
  approachFactor: 2.2,
  /** hold zone outer edge = station radius × this */
  holdFactor: 1.7,
  /** ship speed above which the hold zone doesn't count */
  maxSpeed: 25,
  /** seconds of continuous hold to dock */
  holdTime: 2.5,
  /** fraction of hold progress lost per second outside the hold zone */
  decay: 0.5,
  /** seconds after a dock before another reward can trigger */
  cooldown: 60
};
function dockState(distance, radius, speed, holdSeconds = 0) {
  if (distance > radius * DOCK.approachFactor) return "far";
  if (distance > radius * DOCK.holdFactor || speed > DOCK.maxSpeed) return "approach";
  return holdSeconds >= DOCK.holdTime ? "docked" : "hold";
}
function dockReward() {
  return {
    refuel: true,
    resource: "\u73AF\u57CE\u901A\u884C\u5BC6\u94A5",
    amount: 1,
    log: "\u505C\u9760\u8865\u7ED9\u5B8C\u6210\uFF1A\u63A8\u8FDB\u80FD\u91CF\u5DF2\u91CD\u65B0\u5145\u6EE1\uFF0C\u73AF\u57CE\u6E2F\u52A1\u5C40\u7B7E\u53D1\u901A\u884C\u5BC6\u94A5\u4E00\u679A\uFF0C\u62FE\u5149\u822A\u9053\u4FE1\u6807\u9891\u6BB5\u5DF2\u540C\u6B65\u81F3\u672C\u8239\u5BFC\u822A\uFF0C\u6B22\u8FCE\u518D\u6B21\u505C\u9760\u3002"
  };
}
var RANK = { far: 0, approach: 1, hold: 2, docked: 3 };
var Docker = class {
  state = "far";
  /** accumulated seconds inside the hold zone (decays outside, never resets) */
  holdSeconds = 0;
  /** seconds left before another dock reward can trigger */
  cooldown = 0;
  /** total completed docks this session */
  docks = 0;
  /** 0..1 progress toward the next dock */
  get progress() {
    return Math.min(1, this.holdSeconds / DOCK.holdTime);
  }
  update(dt, distance, radius, speed) {
    const ev = [];
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    const prev = this.state;
    const zone = dockState(distance, radius, speed);
    if (zone !== "hold") {
      this.holdSeconds = Math.max(0, this.holdSeconds - DOCK.decay * dt * DOCK.holdTime);
      if (RANK[prev] > RANK[zone]) ev.push({ type: "leave", state: zone });
      else if (prev === "far" && zone === "approach") ev.push({ type: "enter", state: "approach" });
      this.state = zone;
      return ev;
    }
    if (prev !== "hold" && prev !== "docked") ev.push({ type: "enter", state: "hold" });
    if (prev === "docked") {
      this.holdSeconds = DOCK.holdTime;
      return ev;
    }
    const before = this.progress;
    this.holdSeconds = Math.min(DOCK.holdTime, this.holdSeconds + dt);
    this.state = "hold";
    if (this.progress !== before) ev.push({ type: "progress", progress: this.progress });
    if (this.holdSeconds >= DOCK.holdTime && this.cooldown <= 0) {
      this.state = "docked";
      this.cooldown = DOCK.cooldown;
      this.docks += 1;
      const r = dockReward();
      ev.push({ type: "docked", resource: r.resource, amount: r.amount, log: r.log });
    }
    return ev;
  }
};

// src/game/dock.test.ts
var DT = 0.1;
var R = 130;
var types = (evs) => evs.map((e) => e.type);
test("dockState zone boundaries: far / approach / hold", () => {
  assert.equal(dockState(R * 2.21, R, 0), "far");
  assert.equal(dockState(R * 2.2, R, 0), "approach");
  assert.equal(dockState(R * 1.9, R, 0), "approach");
  assert.equal(dockState(R * 1.71, R, 0), "approach");
  assert.equal(dockState(R * 1.7, R, 20), "hold");
  assert.equal(dockState(R * 1.2, R, 0), "hold");
});
test("dockState: too fast inside 1.7R never gives hold", () => {
  assert.equal(dockState(R * 1.5, R, DOCK.maxSpeed + 0.1), "approach");
  assert.equal(dockState(R * 1.5, R, DOCK.maxSpeed), "hold");
  assert.equal(dockState(R * 1.01, R, 200), "approach");
});
test("dockState: accumulated hold promotes to docked at 2.5 s", () => {
  assert.equal(dockState(R * 1.5, R, 0, DOCK.holdTime - 0.01), "hold");
  assert.equal(dockState(R * 1.5, R, 0, DOCK.holdTime), "docked");
});
test("holding ~2.5 s docks exactly once, then stays docked", () => {
  const d = new Docker();
  let docked = 0;
  for (let i = 0; i < 40; i++) {
    for (const e of d.update(DT, R * 1.5, R, 0)) if (e.type === "docked") docked++;
  }
  assert.equal(docked, 1);
  assert.equal(d.docks, 1);
  assert.equal(d.state, "docked");
  assert.equal(d.progress, 1);
});
test("approach fires enter; leaving fires leave and decays progress, never resets", () => {
  const d = new Docker();
  assert.deepEqual(types(d.update(DT, R * 2, R, 0)), ["enter"]);
  for (let i = 0; i < 15; i++) d.update(DT, R * 1.5, R, 0);
  const held = d.progress;
  assert.ok(held > 0.4 && held < 0.7, `progress ${held}`);
  const evs = d.update(DT, R * 2, R, 0);
  assert.ok(types(evs).includes("leave"));
  assert.equal(d.state, "approach");
  const decayed = d.progress;
  assert.ok(decayed > 0 && decayed < held, `decayed ${decayed} < ${held}`);
  d.update(DT, R * 2.5, R, 0);
  assert.equal(d.state, "far");
  const afterFar = d.progress;
  assert.ok(afterFar > 0 && afterFar < decayed, `far-decayed ${afterFar} < ${decayed}`);
  d.update(DT, R * 1.5, R, 0);
  assert.ok(d.progress > afterFar);
});
test("fast pass through the hold zone accumulates nothing", () => {
  const d = new Docker();
  for (let i = 0; i < 40; i++) d.update(DT, R * 1.5, R, DOCK.maxSpeed + 5);
  assert.equal(d.state, "approach");
  assert.equal(d.progress, 0);
  assert.equal(d.docks, 0);
});
test("cooldown: after docking, re-approach within 60 s only reaches hold \u2014 no reward", () => {
  const d = new Docker();
  while (d.docks === 0) d.update(DT, R * 1.5, R, 0);
  assert.equal(d.cooldown, DOCK.cooldown);
  for (let i = 0; i < 20; i++) d.update(DT, R * 2.5, R, 0);
  let docked = 0;
  for (let i = 0; i < 40; i++) {
    for (const e of d.update(DT, R * 1.5, R, 0)) if (e.type === "docked") docked++;
    assert.notEqual(d.state, "docked");
    assert.equal(d.state, "hold");
  }
  assert.equal(docked, 0);
  assert.equal(d.progress, 1);
});
test("after cooldown expires, a fresh hold docks again and pays out once more", () => {
  const d = new Docker();
  while (d.docks === 0) d.update(DT, R * 1.5, R, 0);
  for (let i = 0; i < DOCK.cooldown / DT * 1.05; i++) d.update(DT, R * 2.5, R, 0);
  assert.equal(d.cooldown, 0);
  assert.equal(d.progress, 0);
  let docked = 0;
  for (let i = 0; i < 40; i++) {
    for (const e of d.update(DT, R * 1.5, R, 0)) if (e.type === "docked") docked++;
  }
  assert.equal(docked, 1);
  assert.equal(d.docks, 2);
});
test("dockReward: refuel + \u73AF\u57CE\u901A\u884C\u5BC6\u94A5 + >= 40 \u5B57 observation log", () => {
  const r = dockReward();
  assert.equal(r.refuel, true);
  assert.equal(r.resource, "\u73AF\u57CE\u901A\u884C\u5BC6\u94A5");
  assert.ok(r.amount >= 1);
  assert.ok([...r.log].length >= 40, `log length ${[...r.log].length}`);
});
