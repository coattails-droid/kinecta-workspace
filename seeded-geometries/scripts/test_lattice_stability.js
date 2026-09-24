// test_lattice_stability.js — regression tests for the welded tri-layer lattice.
//
// Token 13 once showed a horizontal lattice line "popping in and out of
// visibility": per-row alpha cycled down to 0.224 while the row swept through
// its motion. The fix (kept here) gives every parent stroke a visibility
// floor — (0.45 + tone·0.40) × (1 + 0.08·osc), floor 0.378 on the base layer,
// dimmed per duplicate layer — extended to the triangle outlines as well.
// These tests lock the floor in, plus the weld invariants: every crossing or
// touch between any two edges (within or across the three rotated layers) is
// a shared vertex, and welded vertices never move, so the graph can't tear.
//
// Node: node scripts/test_lattice_stability.js
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
const H13 = HASHES[0];
const PHASES = [];
for (let i = 0; i < 72; i++) PHASES.push(i / 72);

// Recording mock ctx: logs globalAlpha + path geometry per stroke.
function renderStrokes(hash, S, phase) {
  const strokes = []; // { alpha, pts }
  let cur = null, alpha = 1;
  const ctx = new Proxy({}, {
    get(tgt, prop) {
      if (prop === "globalAlpha") return alpha;
      return (...args) => {
        if (prop === "beginPath") cur = { alpha: alpha, pts: [] };
        else if (prop === "moveTo" || prop === "lineTo") { if (cur) cur.pts.push([args[0], args[1]]); }
        else if (prop === "stroke") { if (cur) { strokes.push(cur); cur = null; } }
      };
    },
    set(tgt, prop, v) { if (prop === "globalAlpha") alpha = v; return true; },
  });
  SGArt.render(ctx, S, hash, null, phase);
  // linework strokes are the ones built from moveTo/lineTo (circles/dots use
  // arc, the border uses strokeRect)
  return strokes.filter((s) => s.pts.length > 0);
}

function graphFor(hash, S) {
  const t = Traits.deriveTraits(hash);
  const mods = SGArt.DENSITY_MODULES[t.density] || SGArt.DENSITY_MODULES.standard;
  return SGArt.fusedGraph(hash, S, S / mods);
}

ok("edge alpha never drops below the visibility floor (per layer)", () => {
  const m = { k: 2, amp: 0.03, seed: 42.5 };
  for (const layer of [0, 1, 2]) {
    const floor = 0.378 * SGArt.LAYER_DIM[layer];
    for (const kind of ["h", "v", "tri"]) {
      let mn = Infinity, mx = -Infinity;
      for (const phase of PHASES) {
        for (const tone of [0, 0.5, 0.999]) {
          for (const pidx of [0, 7, 12345]) {
            const a = SGArt._edgeAlpha(kind, layer, tone, m, pidx, phase);
            if (a < mn) mn = a;
            if (a > mx) mx = a;
          }
        }
      }
      assert(mn >= floor - 1e-12,
        `layer ${layer} ${kind}: floor violated: min ${mn.toFixed(4)} < ${floor.toFixed(4)}`);
      assert(mx <= 1.0 + 1e-12, `layer ${layer} ${kind}: alpha exceeds 1: ${mx}`);
    }
  }
});

ok("duplicate layers are exactly the base alpha stepped down for depth", () => {
  const m = { k: 2, amp: 0.03, seed: 42.5 };
  for (const kind of ["h", "v", "tri"]) {
    for (const phase of [0, 0.13, 0.5, 0.87]) {
      const base = SGArt._edgeAlpha(kind, 0, 0.63, m, 11, phase);
      for (const layer of [1, 2]) {
        const dup = SGArt._edgeAlpha(kind, layer, 0.63, m, 11, phase);
        assert(Math.abs(dup / base - SGArt.LAYER_DIM[layer] / SGArt.LAYER_DIM[0]) < 1e-12,
          `layer ${layer} ${kind}: not an exact dim step`);
      }
    }
  }
});

ok("linework stroke count is constant across all phases", () => {
  for (const h of HASHES) {
    const counts = PHASES.map((p) => renderStrokes(h, 412, p).length);
    const first = counts[0];
    assert(first > 0, "no strokes drawn");
    for (const c of counts) assert.strictEqual(c, first, "stroke count changed mid-loop");
  }
});

ok("every stroke stays finite (no tears, no NaN)", () => {
  for (const h of HASHES) {
    for (const p of PHASES) {
      for (const s of renderStrokes(h, 412, p)) {
        for (const pt of s.pts) {
          assert(Number.isFinite(pt[0]) && Number.isFinite(pt[1]),
            "non-finite coordinate at phase " + p);
        }
      }
    }
  }
});

ok("rendered linework alphas respect the per-layer floors", () => {
  for (const h of HASHES) {
    let mn = Infinity;
    for (const p of PHASES) {
      for (const s of renderStrokes(h, 412, p)) if (s.alpha < mn) mn = s.alpha;
    }
    // weakest legal stroke: base floor 0.378 × dimmest layer 0.5
    assert(mn >= 0.378 * 0.5 - 1e-9, "linework alpha below the dimmest floor: " + mn.toFixed(4));
  }
});

ok("no vertex lies strictly inside another edge (the weld is complete)", () => {
  // Bucketed check: for each edge, any vertex inside its swept buckets must
  // be one of its endpoints, else a crossing/touch was missed.
  const S = 360;
  const G = graphFor(H13, S);
  const B = S / 24;
  const buckets = new Map();
  G.verts.forEach(function (v, i) {
    const k = Math.floor(v.x / B) + "," + Math.floor(v.y / B);
    let arr = buckets.get(k);
    if (!arr) { arr = []; buckets.set(k, arr); }
    arr.push(i);
  });
  let checked = 0;
  for (const e of G.edges) {
    const A = G.verts[e.a], Bp = G.verts[e.b];
    const x0 = Math.floor(Math.min(A.x, Bp.x) / B), x1 = Math.floor(Math.max(A.x, Bp.x) / B);
    const y0 = Math.floor(Math.min(A.y, Bp.y) / B), y1 = Math.floor(Math.max(A.y, Bp.y) / B);
    const dx = Bp.x - A.x, dy = Bp.y - A.y;
    const len2 = dx * dx + dy * dy;
    for (let bx = x0; bx <= x1; bx++) for (let by = y0; by <= y1; by++) {
      const arr = buckets.get(bx + "," + by);
      if (!arr) continue;
      for (const vi of arr) {
        if (vi === e.a || vi === e.b) continue;
        const V = G.verts[vi];
        const tt = ((V.x - A.x) * dx + (V.y - A.y) * dy) / len2;
        if (tt <= 0 || tt >= 1) continue;
        const px = A.x + tt * dx, py = A.y + tt * dy;
        const d = Math.hypot(V.x - px, V.y - py);
        assert(d >= 1e-9, `unwelded vertex ${vi} inside edge (${e.layer},${e.kind})`);
        checked++;
      }
    }
  }
  assert(checked > 1000, "weld check touched too few vertices: " + checked);
  console.log("    (" + G.edges.length + " edges checked, " + checked + " near-misses cleared)");
});

ok("every in-canvas base lattice vertex is a welded vertex", () => {
  const S = 720;
  const t = Traits.deriveTraits(H13);
  const mod = S / SGArt.DENSITY_MODULES[t.density];
  const G = graphFor(H13, S);
  const vkeys = new Set(G.verts.map((v) =>
    Math.round(v.x / 1e-6) + "," + Math.round(v.y / 1e-6)));
  // the base vertex set is the module grid rotated with the base layer:
  // ORIENT_CW about the frame-center pivot. (The triangle field shares the
  // grid's vertex set exactly now — TRI_SUBDIV=1 — so the welded vertex set
  // is the module lattice, not the subcell ninths. At exactly 30° this test
  // used to pass on the unrotated grid by accident — the +60° duplicate sat
  // at 90° and mapped the lattice onto itself.)
  const patch = SGArt.gridPatch(mod, S, 0);
  const pv = SGArt._pivot(S);
  const ang = SGArt.ORIENT_CW;
  const cosA = Math.cos(ang), sinA = Math.sin(ang);
  const rot = (x, y) => {
    const dx = x - pv.x, dy = y - pv.y;
    return [pv.x + dx * cosA - dy * sinA, pv.y + dx * sinA + dy * cosA];
  };
  let checked = 0;
  const k0 = Math.ceil(patch.i0 / 3), k1 = Math.floor(patch.i1 / 3);
  for (let i = k0; i <= k1; i++) {
    const x = i * mod;
    if (x < -1 || x > S + 1) continue;
    for (let j = k0; j <= k1; j++) {
      const y = j * mod;
      if (y < -1 || y > S + 1) continue;
      const rp = rot(x, y);
      checked++;
      assert(vkeys.has(Math.round(rp[0] / 1e-6) + "," + Math.round(rp[1] / 1e-6)),
        `base vertex (${x.toFixed(2)},${y.toFixed(2)}) missing from the weld`);
    }
  }
  assert(checked > 20, "too few vertices checked: " + checked);
  console.log("    (" + checked + " base vertices verified in the weld)");
});

ok("center-band base horizontals are stroked at every phase", () => {
  const S = 412;
  const G = graphFor(H13, S);
  const mid = G.parents.map((p, i) => ({ p: p, i: i }))
    .filter((o) => o.p.layer === 0 && o.p.kind === "h");
  assert(mid.length > 0, "no base horizontal parents");
  // every base horizontal parent must own at least one in-canvas sub-edge
  for (const o of mid) {
    const list = G.byParent[o.i];
    assert(list.length > 0, "base horizontal parent " + o.p.pi + " lost all sub-edges");
  }
  // and the render actually strokes a constant, non-trivial set each phase
  const n0 = renderStrokes(H13, S, 0).length;
  assert(n0 > 100, "suspiciously few strokes: " + n0);
  for (const p of PHASES) {
    assert.strictEqual(renderStrokes(H13, S, p).length, n0, "stroke set changed at phase " + p);
  }
  console.log("    (" + mid.length + " base horizontal parents, " + n0 + " strokes/phase)");
});

console.log("\n" + passed + " lattice stability tests passed.");
