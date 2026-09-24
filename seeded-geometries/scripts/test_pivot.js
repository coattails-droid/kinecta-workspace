// test_pivot.js — the tri-layer pivot is locked to the frame center.
//
// Every layer is an exact rotation of the base layer about one shared pivot
// (the frame center), and the frame zoom is centered on the same point. If
// any rotation center or the zoom center ever drifted, these fail.
//
// Node: node scripts/test_pivot.js
"use strict";
const assert = require("assert");
const SeedKit = require("../js/seed.js");
const Traits = require("../js/traits.js");
const SGArt = require("../js/artwork.js");

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log("ok - " + name); }
  catch (e) { console.error("FAIL - " + name + ": " + e.message); process.exitCode = 1; }
}

const HASHES = [13, 7, 42, 1, 99].map((i) => SeedKit.demoMintHash(i));
const S = 720;

function rotPt(x, y, ang, p) {
  const dx = x - p.x, dy = y - p.y;
  const c = Math.cos(ang), s = Math.sin(ang);
  return [p.x + dx * c - dy * s, p.y + dx * s + dy * c];
}

// One layer's full geometry: every edge (kind + endpoints).
function layerSoup(hash, layer) {
  const t = Traits.deriveTraits(hash);
  const mods = SGArt.DENSITY_MODULES[t.density] || SGArt.DENSITY_MODULES.standard;
  const mod = S / mods;
  return { soup: SGArt._layerSoup(hash, mod, S, layer).soup, u: mod / 3 };
}

// The pivot lock, per layer: un-rotating a layer's edges by -LAYER_ANGLES
// about the pivot must land every endpoint exactly on the canonical square
// lattice (integer multiples of u = mod/3). Any drift of a layer's rotation
// center — or its angle — breaks this, for every edge of every layer.
function checkLayerPivot(hash, layer) {
  const p = SGArt._pivot(S);
  const ang = SGArt.LAYER_ANGLES[layer];
  const L = layerSoup(hash, layer);
  const TOL = 1e-6;
  for (const e of L.soup) {
    const pts = [[e.x1, e.y1], [e.x2, e.y2]];
    for (const pt of pts) {
      const r = rotPt(pt[0], pt[1], -ang, p);
      const fu = r[0] / L.u, fv = r[1] / L.u;
      assert(Math.abs(fu - Math.round(fu)) < TOL,
        "layer " + layer + " " + e.kind + " edge endpoint x is off-lattice (" + fu + ")");
      assert(Math.abs(fv - Math.round(fv)) < TOL,
        "layer " + layer + " " + e.kind + " edge endpoint y is off-lattice (" + fv + ")");
    }
  }
}

ok("the locked pivot is exactly the frame center", () => {
  for (const s of [360, 720, 1080]) {
    const p = SGArt._pivot(s);
    assert.strictEqual(p.x, s / 2, "pivot.x at S=" + s);
    assert.strictEqual(p.y, s / 2, "pivot.y at S=" + s);
  }
});

ok("every layer pivots exactly on the frame center (base, 30°)", () => {
  for (const h of HASHES) { checkLayerPivot(h, 0); checkLayerPivot(h, 1); }
});

ok("every layer pivots exactly on the frame center (+60° duplicate)", () => {
  for (const h of HASHES) checkLayerPivot(h, 2);
});

ok("the frame zoom is centered on the locked pivot", () => {
  const calls = [];
  const ctx = new Proxy({}, {
    get(tgt, prop) {
      if (prop === "globalAlpha") return 1;
      return function () { calls.push([prop].concat([].slice.call(arguments))); };
    },
    set() { return true; }
  });
  SGArt.render(ctx, S, HASHES[0], null, 0);
  const p = SGArt._pivot(S);
  const ti = calls.findIndex((c) => c[0] === "translate" && c[1] === p.x && c[2] === p.y);
  const si = calls.findIndex((c) => c[0] === "scale");
  assert(ti >= 0, "render never translates to the pivot");
  assert(si > ti, "zoom scale does not follow the pivot translate");
});

console.log(passed + " pivot tests passed");
