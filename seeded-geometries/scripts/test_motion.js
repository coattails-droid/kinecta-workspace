// test_motion.js — seamless-loop animation invariants.
//
// Every animated quantity is built from osc(), which is exactly 0 at phase 0
// and phase 1, so frame(1) === frame(0): the MP4 loop always closes.
// Node: node scripts/test_motion.js
"use strict";
const assert = require("assert");
const SeedKit = require("../js/seed.js");
const SGTraits = require("../js/traits.js");
const SGArt = require("../js/artwork.js");
const SGLayers = require("../js/layers.js");

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log("ok - " + name);
}

// Recording mock canvas: every method call and property set is logged with
// numbers rounded to 4 decimals, so float dust (sin(2π) ≈ -2.4e-16) cannot
// break equality.
function mockCtx() {
  const calls = [];
  const TAU = Math.PI * 2;
  // -0 and 0 are the same pixel; collapse them so loop-closure compares geometry.
  const norm = (a) => (typeof a === "number" ? (+a.toFixed(4) || 0) : a);
  return new Proxy({ _calls: calls }, {
    get(t, prop) {
      if (prop === "_calls") return calls;
      return (...args) => {
        // rotation is modulo 2π: a square turned by full extra turns renders
        // identically, so normalize before comparing.
        if (prop === "rotate") args = args.map((a) => ((a % TAU) + TAU) % TAU);
        calls.push([prop, ...args.map(norm)]);
      };
    },
    set(t, prop, v) { calls.push(["set:" + String(prop), norm(v)]); return true; },
  });
}

function renderCalls(hash, phase) {
  const ctx = mockCtx();
  SGArt.render(ctx, 360, hash, null, phase);
  return ctx._calls;
}

// Lattice geometry only (moveTo/lineTo): excludes the gently pulsing accent
// dots and alpha breathing, so this compares true geometric motion.
function geomCalls(hash, phase) {
  return renderCalls(hash, phase)
    .filter((c) => c[0] === "moveTo" || c[0] === "lineTo");
}

ok("phase defaults to 0 (static render unchanged)", () => {
  const h = SeedKit.demoMintHash(13);
  const a = mockCtx(); SGArt.render(a, 360, h, null);
  const b = mockCtx(); SGArt.render(b, 360, h, null, 0);
  assert.deepStrictEqual(a._calls, b._calls);
});

ok("the loop closes: phase 1 renders identically to phase 0 (fusion composite)", () => {
  for (const i of [13, 7, 42]) {
    const h = SeedKit.demoMintHash(i);
    assert.deepStrictEqual(renderCalls(h, 1), renderCalls(h, 0),
      "phase 1 !== phase 0 for mint " + i);
  }
});

ok("motion window: 2s rest, 4s motion, 2s rest of the 8s loop", () => {
  assert.strictEqual(SGArt._motionMu(0), -1);
  assert.strictEqual(SGArt._motionMu(0.1), -1);
  assert.strictEqual(SGArt._motionMu(0.9), -1);
  assert.strictEqual(SGArt._motionMu(0.75), -1);
  assert.strictEqual(SGArt._motionMu(0.25), 0);
  assert.strictEqual(SGArt._motionMu(0.5), 0.5);
  for (const i of [13, 7, 42]) {
    const h = SeedKit.demoMintHash(i);
    // rest windows are geometrically identical to the static piece
    assert.deepStrictEqual(geomCalls(h, 0.1), geomCalls(h, 0),
      "geometry moves during the opening rest for mint " + i);
    assert.deepStrictEqual(geomCalls(h, 0.9), geomCalls(h, 0),
      "geometry moves during the closing rest for mint " + i);
    // ...and the window actually moves the lattice
    assert.notDeepStrictEqual(geomCalls(h, 0.5), geomCalls(h, 0),
      "no motion inside the window for mint " + i);
  }
});

ok("render is deterministic at any phase", () => {
  const h = SeedKit.demoMintHash(42);
  assert.deepStrictEqual(renderCalls(h, 0.37), renderCalls(h, 0.37));
});

ok("undulate tile closes the loop too (phase 1 === phase 0, 0.25 differs)", () => {
  function tileCalls(phase) {
    const ctx = mockCtx();
    const rs = SeedKit.streamFor(SeedKit.demoMintHash(5), "layer:undulate:0");
    SGLayers.DYNAMIC.undulate(ctx, 256, rs, { ink: "#201c16" },
      { piPhase: Math.PI / 4, phase: phase });
    return ctx._calls;
  }
  assert.deepStrictEqual(tileCalls(1), tileCalls(0));
  assert.notDeepStrictEqual(tileCalls(0.25), tileCalls(0));
});

ok("shatter envelope: obliterate, instant reversal, long reconfigure, forced rest only", () => {
  const env = SGArt._shatterEnv;
  // exact rest at the loop endpoints for every possible shard delay
  // (max delay SHATTER_DMAX -> local clocks at phase 0 sit in [1-DMAX, 1])
  for (let d = 0; d <= SGArt.SHATTER_DMAX; d += 0.01) {
    assert.strictEqual(env(((0 - d) % 1 + 1) % 1), 0, "shard not intact at phase 0, delay " + d);
    assert.strictEqual(env(((1 - d) % 1 + 1) % 1), 0, "shard not intact at phase 1, delay " + d);
    assert(d + 0.80 <= 1, "shard still reconfiguring when the loop closes, delay " + d);
  }
  // shape: 0 -> 1 over [0, 0.20), instant reversal at the peak,
  // 1 -> 0 over (0.20, 0.80], 0 after
  assert.strictEqual(env(0), 0);
  assert(env(0.1) > 0 && env(0.1) < 1, "explode is not gradual");
  assert.strictEqual(env(0.20), 1);
  assert(env(0.21) > 0 && env(0.21) < 1, "no instant reversal after the peak");
  assert(env(0.5) > 0 && env(0.5) < 1, "reconfigure is not gradual");
  assert.strictEqual(env(0.80), 0);
  assert.strictEqual(env(0.9), 0);
  // monotonic on the transitions, continuous at the joints
  let prev = -1;
  for (let x = 0; x <= 0.20; x += 0.005) { const v = env(x); assert(v >= prev); prev = v; }
  prev = 2;
  for (let x = 0.20; x <= 0.80; x += 0.005) { const v = env(x); assert(v <= prev); prev = v; }
  assert(Math.abs(env(0.20 - 1e-9) - 1) < 1e-6, "explode does not reach 1 at the joint");
  assert(Math.abs(env(0.80 - 1e-9)) < 1e-6, "reconfigure does not reach 0 at the joint");
  // no extended rest: the envelope is active (nonzero) on [0, 0.80)
  let active = 0;
  for (let x = 0; x < 1; x += 0.01) if (env(x) > 0) active++;
  assert(active >= 79, "envelope rests too long: active " + active + "% of the loop");
});

ok("shatter displaces shards substantially mid-window (token 13)", () => {
  const h = SeedKit.demoMintHash(13);
  const S = 360, box = [S / 4, S / 4, (3 * S) / 4, (3 * S) / 4]; // visible window
  const inBox = (x, y) => x > box[0] && x < box[2] && y > box[1] && y < box[3];
  const cmds = (phase) => geomCalls(h, phase);
  const p0 = cmds(0), p2 = cmds(0.35); // mu = 0.2: envelope peak for zero-delay shards
  assert.strictEqual(p0.length, p2.length, "path command count changed mid-loop");
  // Only the visible lattice counts: off-frame shards are pinned by the
  // frame hold, so the all-commands fraction would understate the motion
  // the viewer sees. Index by rest-visible segments (the command list is
  // stable across phases; only coordinates change).
  const vis = [];
  for (let i = 0; i + 1 < p0.length; i += 2) {
    if (inBox(p0[i][1], p0[i][2]) || inBox(p0[i + 1][1], p0[i + 1][2])) vis.push(i, i + 1);
  }
  assert(vis.length > 0, "no visible segments at rest (vacuous test)");
  let diff = 0, maxD = 0;
  for (const i of vis) {
    if (p0[i][1] !== p2[i][1] || p0[i][2] !== p2[i][2]) {
      diff++;
      maxD = Math.max(maxD, Math.hypot(p0[i][1] - p2[i][1], p0[i][2] - p2[i][2]));
    }
  }
  assert(diff / vis.length > 0.25, "shatter barely moves the lattice: " + (diff / vis.length));
  assert(maxD > 10, "no shard travels a visible distance: " + maxD);
});

ok("shards stretch (protrude) mid-window: linework length grows", () => {
  const h = SeedKit.demoMintHash(13);
  const pathLen = (phase) => {
    const cmds = geomCalls(h, phase);
    let len = 0;
    for (let i = 0; i + 1 < cmds.length; i += 2) {
      assert.strictEqual(cmds[i][0], "moveTo");
      assert.strictEqual(cmds[i + 1][0], "lineTo");
      len += Math.hypot(cmds[i + 1][1] - cmds[i][1], cmds[i + 1][2] - cmds[i][2]);
    }
    return len;
  };
  const rest = pathLen(0), mid = pathLen(0.35);
  assert.ok(rest > 0, "no linework at rest");
  assert.ok(mid > rest * 1.05,
    `shards do not extend mid-window: ${mid.toFixed(1)} vs rest ${rest.toFixed(1)}`);
  assert.ok(pathLen(1) === rest, "stretch does not vanish at loop close");
});

ok("shatter epicenter is seeded inside the piece", () => {
  for (const i of [13, 7, 42]) {
    const h = SeedKit.demoMintHash(i);
    const e = SGArt._shatterEpicenter(h, 360);
    assert(e.x >= 108 && e.x <= 252 && e.y >= 108 && e.y <= 252,
      "epicenter outside the central region for mint " + i + ": " + e.x + "," + e.y);
  }
  const a = SGArt._shatterEpicenter(SeedKit.demoMintHash(13), 360);
  const b = SGArt._shatterEpicenter(SeedKit.demoMintHash(13), 360);
  assert.deepStrictEqual(a, b, "epicenter is not deterministic");
});

ok("shatter delay follows a quarter-sine radial profile (pi in the wave)", () => {
  const h = SeedKit.demoMintHash(13);
  const SU = 360;
  const f = SGArt._shatterField(h, SU, [90, 90, 270, 270]);
  // at the epicenter the radial term vanishes: only the +/-0.03 jitter remains
  const d0 = SGArt._shatterDelay(f, f.x, f.y, SU, 0.5);
  assert(Math.abs(d0) < 1e-9, "nonzero delay at the epicenter: " + d0);
  // at the farthest corner the radial term saturates at SHATTER_DMAX
  const corner = [[90, 90], [270, 90], [90, 270], [270, 270]]
    .map((c) => Math.hypot(c[0] - f.x, c[1] - f.y))
    .reduce((a, b) => Math.max(a, b));
  assert(Math.abs(corner - f.maxD) < 1e-9, "maxD is not the farthest corner");
  const dMax = SGArt._shatterDelay(f, 90, 90, SU, 0.5);
  // one of the corners is the farthest; check the delay there saturates
  let sat = 0;
  for (const c of [[90, 90], [270, 90], [90, 270], [270, 270]]) {
    const dd = Math.hypot(c[0] - f.x, c[1] - f.y);
    if (Math.abs(dd - f.maxD) < 1e-9) {
      sat = SGArt._shatterDelay(f, c[0], c[1], SU, 0.5);
    }
  }
  assert(Math.abs(sat - SGArt.SHATTER_DMAX) < 1e-9, "delay does not saturate at the far corner: " + sat);
  // quarter sine: delay(r) = DMAX * sin(r * pi/2) (+ jitter); check mid-radius
  // with zero jitter against the analytic profile, and monotonicity overall
  let prev = -1;
  for (let k = 0; k <= 10; k++) {
    const r = k / 10;
    const x = f.x + r * f.maxD, y = f.y;
    const d = SGArt._shatterDelay(f, x, y, SU, 0.5);
    assert(d >= prev - 1e-12, "delay not monotonic in radius at r=" + r);
    prev = d;
    const expected = SGArt.SHATTER_DMAX * Math.sin(r * Math.PI / 2);
    assert(Math.abs(d - expected) < 1e-9,
      "delay deviates from the pi/2 profile at r=" + r + ": " + d + " vs " + expected);
  }
  void dMax;
});

ok("accent dots ride the wave outward: away from the epicenter", () => {
  const S = 720;
  const h = SeedKit.demoMintHash(13); // bold, turquoise+gold dots
  const t = SGTraits.deriveTraits(h);
  assert(t.hues.length > 0, "token 13 has no accent hues");
  const mod = S / SGArt.DENSITY_MODULES[t.density];
  const G = SGArt.fusedGraph(h, S, mod);
  const P = { accents: t.hues.map((k) => SGArt.HUE_COLORS[k]) };
  const _vr = 1 / (2 * SGArt.ZOOM); const region = [S * (0.5 - _vr), S * (0.5 - _vr), S * (0.5 + _vr), S * (0.5 + _vr)]; // visibleRegion(S)
  const epi = SGArt._shatterEpicenter(h, S);
  const sim = (phase) =>
    SGArt._dotsSim(G, P, t, h, S, mod / 3, phase, region, region, SGArt.LAYER_ANGLES);
  const rest = sim(0), mid = sim(0.5);
  assert.ok(rest.dots.length > 0, "no accent dots at rest");
  assert.strictEqual(rest.dots.length, SGArt.ACCENT_DOTS + SGArt.ACCENT_DOTS_OUTER,
    `expected inner + outer rings, got ${rest.dots.length} dots`);
  assert.strictEqual(mid.dots.length, rest.dots.length, "dot count changed mid-flight");
  rest.dots.forEach((r, i) => {
    const m = mid.dots[i];
    assert.strictEqual(m.color, r.color, `dot ${i} color changed mid-flight`);
    const dR = Math.hypot(r.x - epi.x, r.y - epi.y);
    if (dR < 1e-6) return; // a dot exactly on the epicenter has nowhere to fly
    const dM = Math.hypot(m.x - epi.x, m.y - epi.y);
    // at phase 0.5 every dot's envelope is in [0.5, 0.9] and its flight
    // fraction in [0.15, 0.60], so each dot is at least 7.5% farther out
    assert(dM > dR * 1.07, `dot ${i} did not fly outward: ${dR.toFixed(2)} -> ${dM.toFixed(2)}`);
    // the flight is exactly radial: the displacement points away from the epicenter
    const dot = (r.x - epi.x) * (m.x - r.x) + (r.y - epi.y) * (m.y - r.y);
    assert(dot > 0, `dot ${i} is not flying away from the epicenter`);
    // the accent layer keeps full visibility mid-flight: no dissolve
    assert(!("fade" in m), `dot ${i} still carries a fade field`);
    // full visibility is rendered at a constant 0.9 alpha on every dot
  });
  // the loop still closes on the accent layer
  assert.deepStrictEqual(sim(1).dots, rest.dots, "accent dots do not close the loop");
});

ok("frame hold: linework keeps crossing the frame's edge during the shatter", () => {
  const h = SeedKit.demoMintHash(13);
  const S = 360, box = [S / 4, S / 4, (3 * S) / 4, (3 * S) / 4]; // visible window
  // holdWeight unit behavior
  assert.strictEqual(SGArt._holdWeight(box[0], S / 2, box, S), 0, "edge not pinned");
  assert.strictEqual(SGArt._holdWeight(S / 2, S / 2, box, S), 1, "center not free");
  assert.strictEqual(SGArt._holdWeight(S / 2, S / 2, null, S), 1, "null box should not hold");
  assert.strictEqual(SGArt._holdWeight(0, 0, box, S), 0, "off-frame not frozen");
  // behavioral: lattice segments crossing the frame's edge, at rest vs
  // mid-shatter. A segment crosses when exactly one endpoint is in the box.
  const inBox = (x, y) => x > box[0] && x < box[2] && y > box[1] && y < box[3];
  const crossings = (phase) => {
    const cmds = geomCalls(h, phase);
    let n = 0;
    for (let i = 0; i + 1 < cmds.length; i += 2) {
      if (inBox(cmds[i][1], cmds[i][2]) !== inBox(cmds[i + 1][1], cmds[i + 1][2])) n++;
    }
    return n;
  };
  const rest = crossings(0);
  assert(rest > 0, "no edge crossings at rest (vacuous test)");
  for (const phase of [0.3, 0.35, 0.5, 0.65]) {
    const mid = crossings(phase);
    assert(mid >= rest * 0.9,
      `edge crossings fell ${rest} -> ${mid} at phase ${phase}: lines pull back from the frame`);
  }
});

ok("shards twist out and back with no snap", () => {
  const TAU = Math.PI * 2;
  // SPIN_TURNS: peak of the out-and-back twist, in seeded direction —
  // a third slower than the old half-turn spin.
  assert.strictEqual(SGArt.SPIN_TURNS, 0.335, "spin is not 33% slower");
  // SPIN_WINDOW: the twist resolves over the first 0.55 of the local
  // clock — before the radial wave (envelope out to x = 0.80) finishes.
  assert.strictEqual(SGArt.SPIN_WINDOW, 0.55, "twist window changed");
  const W = SGArt.SPIN_WINDOW;
  // _spinTwist: the twist profile — 0 at flight start, 1 at mid-window,
  // exactly 0 from SPIN_WINDOW on (the glide-home zone), smooth (zero
  // velocity) at both joints, rising then falling in between.
  assert.strictEqual(SGArt._spinTwist(0), 0, "twist does not start at 0");
  assert(Math.abs(SGArt._spinTwist(W / 2) - 1) < 1e-9, "twist does not peak mid-window");
  assert.strictEqual(SGArt._spinTwist(W), 0, "twist not resolved at end of window");
  assert.strictEqual(SGArt._spinTwist(0.8), 0, "twist does not unwind to 0 at rest");
  assert.strictEqual(SGArt._spinTwist(1), 0, "twist not clamped past the active zone");
  let prev = 0;
  for (let x = 0.001; x < W / 2; x += 0.001) {
    const p = SGArt._spinTwist(x);
    assert(p > prev, "twist not rising at x=" + x.toFixed(3));
    prev = p;
  }
  prev = 1; // the peak
  for (let x = W / 2 + 0.01; x < W; x += 0.01) {
    const p = SGArt._spinTwist(x);
    assert(p < prev, "twist not falling at x=" + x.toFixed(3));
    prev = p;
  }
  assert(SGArt._spinTwist(0.01) < 0.01, "twist starts with a kick");
  assert(SGArt._spinTwist(W - 0.01) < 0.01, "twist ends with a kick");
  // the glide-home zone: twist is exactly 0 while the radial wave still
  // has the shard in flight — untwist first, then slide into place.
  for (let x = W; x <= 0.8; x += 0.01) {
    assert.strictEqual(SGArt._spinTwist(x), 0, "twist not zero in glide-home zone at x=" + x.toFixed(3));
  }
  // the peak twist is exactly SPIN_TURNS turns
  const peak = TAU * SGArt.SPIN_TURNS * SGArt._spinTwist(W / 2);
  assert(Math.abs(peak - TAU * 0.335) < 1e-9, "twist peak is not 0.335 turns");

  // behavioral: every mid-flight shard transform is a valid rotation, no
  // shard ever twists past the peak, and just before the motion window
  // closes every shard is back at rest (null transform = original
  // position AND original orientation — no snap).
  const S = 720;
  const h = SeedKit.demoMintHash(13);
  const t = SGTraits.deriveTraits(h);
  const mod = S / SGArt.DENSITY_MODULES[t.density];
  const G = SGArt.fusedGraph(h, S, mod);
  const _vr = 1 / (2 * SGArt.ZOOM); const region = [S * (0.5 - _vr), S * (0.5 - _vr), S * (0.5 + _vr), S * (0.5 + _vr)]; // visibleRegion(S)
  const sim = (phase) => SGArt._weldedSim(G, {}, t, h, S, mod / 3, phase, null, region, region);
  let midActive = 0, maxTwist = 0;
  for (let pi = 0; pi <= 200; pi++) {
    const phase = 0.25 + (0.5 * pi) / 200; // sweep the whole motion window
    for (const xf of sim(phase).shardXf) {
      if (!xf) continue;
      midActive++;
      assert(Math.abs(xf.c * xf.c + xf.s * xf.s - 1) < 1e-12, "shard rotation is not a rotation");
      const ang = Math.abs(Math.atan2(xf.s, xf.c));
      if (ang > maxTwist) maxTwist = ang;
      assert(ang <= TAU * SGArt.SPIN_TURNS + 1e-9,
        "shard twisted past the peak (would snap at envelope close): " + ang.toFixed(3));
    }
  }
  assert(midActive > 0, "no shards mid-flight (vacuous test)");
  assert(maxTwist > TAU * SGArt.SPIN_TURNS * 0.5, "twist never engaged (vacuous test)");
  const late = sim(0.74).shardXf; // mu = 0.98: every local clock in the forced rest zone
  assert(late.every((xf) => xf === null), "shards have not resolved back into place");
});

ok("circles ride the radial wave outward, no dissolve", () => {
  const S = 720;
  const h = SeedKit.demoMintHash(13);
  const t = SGTraits.deriveTraits(h);
  const mod = S / SGArt.DENSITY_MODULES[t.density];
  const G = SGArt.fusedGraph(h, S, mod);
  const _vr = 1 / (2 * SGArt.ZOOM); const region = [S * (0.5 - _vr), S * (0.5 - _vr), S * (0.5 + _vr), S * (0.5 + _vr)]; // visibleRegion(S)
  const epi = SGArt._shatterEpicenter(h, S);
  const sim = (phase) => SGArt._weldedSim(G, {}, t, h, S, mod / 3, phase, null, region, region);
  const rest = sim(0), mid = sim(0.5);
  for (let layer = 0; layer < 3; layer++) {
    assert(rest.circles[layer].length > 0, "no circles on layer " + layer);
    assert.strictEqual(mid.circles[layer].length, rest.circles[layer].length,
      "circle count changed mid-flight on layer " + layer);
    rest.circles[layer].forEach((r, ci) => {
      const m = mid.circles[layer][ci];
      assert.strictEqual(m.baseR, r.baseR, `circle ${ci} radius changed mid-flight`);
      assert.strictEqual(m.baseA, r.baseA, `circle ${ci} alpha changed mid-flight`);
      // no dissolve: the sim carries no fade field and the raster draws at baseA
      assert(!("fade" in m), `circle ${ci} still carries a fade field`);
      const dR = Math.hypot(r.x - epi.x, r.y - epi.y);
      if (dR < 1e-6) return; // a circle exactly on the epicenter has nowhere to fly
      const dM = Math.hypot(m.x - epi.x, m.y - epi.y);
      // at phase 0.5 every circle's envelope is in [0.5, 0.9] and its flight
      // fraction in [0.15, 0.60], so each is at least 7.5% farther out
      assert(dM > dR * 1.07, `circle ${ci} did not fly outward: ${dR.toFixed(2)} -> ${dM.toFixed(2)}`);
      // the flight is exactly radial: the displacement points away from the epicenter
      const dot = (r.x - epi.x) * (m.x - r.x) + (r.y - epi.y) * (m.y - r.y);
      assert(dot > 0, `circle ${ci} is not flying away from the epicenter`);
    });
  }
  // the loop still closes on the circle field
  assert.deepStrictEqual(sim(1).circles, rest.circles, "circles do not close the loop");
});

console.log("\n" + passed + " motion tests passed.");
