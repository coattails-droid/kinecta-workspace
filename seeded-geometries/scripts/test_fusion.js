// test_fusion.js — Node tests for the Linear Grid ⊕ Triangle Field composite,
// rendered as one welded graph in three layers (base + exact +30°/+60°
// duplicates, every crossing welded).
//
// Run: node scripts/test_fusion.js
"use strict";
const assert = require("assert");
const SeedKit = require("../js/seed.js");
const SGTraits = require("../js/traits.js");
const SGArt = require("../js/artwork.js");
const SGLayers = require("../js/layers.js");

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log("ok - " + name); }
  catch (e) { console.error("FAIL - " + name + ": " + e.message); process.exitCode = 1; }
}

function mockCtx() {
  const calls = [];
  const norm = (a) => (typeof a === "number" ? +a.toFixed(4) : a);
  return new Proxy({ _calls: calls }, {
    get(t, prop) {
      if (prop === "_calls") return calls;
      return (...args) => { calls.push([prop, ...args.map(norm)]); };
    },
    set(t, prop, v) { calls.push(["set:" + String(prop), norm(v)]); return true; },
  });
}

const H13 = "4bfaf4e6d08331e5d8a46ad81a001d7afb9cb23940f3fb21cae570cdffedc226";

function graphFor(hash, S) {
  const t = SGTraits.deriveTraits(hash);
  const mods = SGArt.DENSITY_MODULES[t.density] || SGArt.DENSITY_MODULES.standard;
  return SGArt.fusedGraph(hash, S, S / mods);
}

ok("grid trait resolves to a fusion composite, ~70/30 standard/inverted", () => {
  let inv = 0;
  for (let i = 0; i < 200; i++) {
    const g = SGTraits.deriveTraits(SeedKit.demoMintHash(i)).grid;
    assert.ok(g === "fusion" || g === "fusion-inv", "stray grid at mint " + i + ": " + g);
    if (g === "fusion-inv") inv++;
  }
  assert.ok(inv > 0, "inverted fusion never rolled in 200 mints");
  assert.deepStrictEqual(SGTraits.compositeFor("fusion"), ["triangle", "linear"]);
  assert.deepStrictEqual(SGTraits.compositeFor("fusion-inv"), ["linear", "triangle"]);
  assert.deepStrictEqual(SGTraits.compositeFor("mystery"), ["mystery"], "unknown-key fallback broken");
  const feats = SGTraits.features(H13);
  assert.strictEqual(feats.find((f) => f.trait_type === "Grid System").value,
    "Linear Grid ⊕ Triangle Field");
});

ok("stroke order: dim duplicates first, base last; triangle under linear", () => {
  const G = graphFor(H13, 720);
  const ko = { tri: 0, h: 1, v: 2 };
  const ord = G.drawOrder.map((i) => G.parents[i]);
  assert(ord.length > 100, "too few parents: " + ord.length);
  for (let n = 1; n < ord.length; n++) {
    assert(ord[n].layer <= ord[n - 1].layer, "layer draw order violated at " + n);
    if (ord[n].layer === ord[n - 1].layer) {
      assert(ko[ord[n].kind] >= ko[ord[n - 1].kind],
        "kind draw order violated within layer " + ord[n].layer);
    }
  }
  const layers = new Set(G.edges.map((e) => e.layer));
  assert.deepStrictEqual([...layers].sort(), [0, 1, 2], "not all three layers contribute edges");
  console.log("    (" + ord.length + " parents in draw order)");
});

ok("duplicate layers are exact +30°/+60° rotations of the base lattice", () => {
  const S = 720;
  const t = SGTraits.deriveTraits(H13);
  const mods = SGArt.DENSITY_MODULES[t.density] || SGArt.DENSITY_MODULES.standard;
  const mod = S / mods;
  const cx = S / 2, cy = S / 2;
  // Canonical unrotated frame: the base layer soup carries the +ORIENT_CW
  // turn, so unwind it before comparing.
  const ang0 = SGArt.LAYER_ANGLES[0];
  const cos0 = Math.cos(-ang0), sin0 = Math.sin(-ang0);
  function unrot(x, y) {
    return [cx + (x - cx) * cos0 - (y - cy) * sin0,
            cy + (x - cx) * sin0 + (y - cy) * cos0];
  }
  const baseSegs = SGArt._layerSoup(H13, mod, S, 0).soup.map((e) => {
    const a = unrot(e.x1, e.y1), b = unrot(e.x2, e.y2);
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    return { x1: a[0], y1: a[1], ux: dx / l, uy: dy / l, len: l };
  });
  // slab test: does the segment pass through the central box?
  const BX0 = S * 0.35, BX1 = S * 0.65;
  function hitsBox(e) {
    let tmin = 0, tmax = 1;
    const ps = [e.x1, e.y1], ds = [e.x2 - e.x1, e.y2 - e.y1];
    for (let d = 0; d < 2; d++) {
      const p = ps[d], dd = ds[d];
      if (Math.abs(dd) < 1e-12) { if (p < BX0 || p > BX1) return false; continue; }
      let ta = (BX0 - p) / dd, tb = (BX1 - p) / dd;
      if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
      if (ta > tmin) tmin = ta;
      if (tb < tmax) tmax = tb;
      if (tmin > tmax) return false;
    }
    return true;
  }
  [1, 2].forEach(function (layer) {
    const ang = SGArt.LAYER_ANGLES[layer];
    assert(Math.abs(ang - (SGArt.ORIENT_CW + layer * Math.PI / 6)) < 1e-15,
      "layer angle is not an exact pi fraction");
    const cosA = Math.cos(-ang), sinA = Math.sin(-ang);
    function invRot(x, y) {
      return [cx + (x - cx) * cosA - (y - cy) * sinA,
              cy + (x - cx) * sinA + (y - cy) * cosA];
    }
    const soup = SGArt._layerSoup(H13, mod, S, layer).soup;
    let checked = 0;
    for (const e of soup) {
      if (!hitsBox(e)) continue;
      const a = invRot(e.x1, e.y1), b = invRot(e.x2, e.y2);
      const dx = e.x2 - e.x1, dy = e.y2 - e.y1;
      const l = Math.hypot(dx, dy) || 1;
      // the inverse-rotated direction must match a base edge's direction…
      const wx = (dx / l) * cosA - (dy / l) * sinA;
      const wy = (dx / l) * sinA + (dy / l) * cosA;
      let hit = false;
      for (const g of baseSegs) {
        if (Math.abs(wx * g.ux + wy * g.uy) < 1 - 1e-9) continue;
        // …the inverse-rotated edge must lie on that base edge's line…
        const px = a[0] - g.x1, py = a[1] - g.y1;
        if (Math.abs(px * g.uy - py * g.ux) > 1e-6) continue;
        // …with genuinely overlapping (not just touching) intervals.
        const t1 = px * g.ux + py * g.uy;
        const t2 = (b[0] - g.x1) * g.ux + (b[1] - g.y1) * g.uy;
        const lo = Math.max(0, Math.min(t1, t2)), hi = Math.min(g.len, Math.max(t1, t2));
        if (hi - lo > 1e-9) { hit = true; break; }
      }
      assert(hit, `layer ${layer} edge is not an exact rotation of a base edge`);
      checked++;
    }
    // The unified triangle field (TRI_SUBDIV=1) has fewer edges than the old
    // third-subcell field, so the central box holds fewer of them — the
    // per-edge exactness assertions above are the real check.
    assert(checked > 5, `too few central edges checked on layer ${layer}: ${checked}`);
    console.log(`    (layer ${layer}: ${checked} edges verified as exact rotations)`);
  });
});

ok("cross-layer welds exist (layers genuinely join, not just overlap)", () => {
  const G = graphFor(H13, 720);
  const layersAt = G.verts.map(() => new Set());
  G.edges.forEach(function (e) {
    layersAt[e.a].add(e.layer);
    layersAt[e.b].add(e.layer);
  });
  let multi = 0;
  layersAt.forEach(function (s) { if (s.size > 1) multi++; });
  assert(multi > 500, "too few cross-layer weld vertices: " + multi);
  console.log("    (" + multi + " vertices join 2+ layers)");
});

ok("the overlay never shifts the base streams (two renders agree exactly)", () => {
  const a = mockCtx(), b = mockCtx();
  SGArt.render(a, 720, H13, null, 0.37);
  SGArt.render(b, 720, H13, null, 0.37);
  assert.deepStrictEqual(a._calls, b._calls);
});

ok("each system's depth deck composites beneath its own linework", () => {
  function fakeDeck(tag) {
    return [{
      img: { width: 64, height: 64, _tag: tag },
      cfg: { blend: "source-over", alpha: [0.5, 0.5], scale: [1, 1], count: [1, 1], rotate: 0 },
    }];
  }
  const c = mockCtx();
  SGArt.render(c, 720, H13, { triangle: fakeDeck("tri"), linear: fakeDeck("lin") }, 0);
  const tags = c._calls.filter((k) => k[0] === "drawImage").map((k) => k[1] && k[1]._tag);
  assert.ok(tags.includes("tri"), "triangle deck never composited");
  assert.ok(tags.includes("lin"), "linear deck never composited");
  assert.ok(tags.indexOf("tri") < tags.indexOf("lin"), "deck order wrong: field must sit beneath structure");
});

ok("dynamic tile streams are namespaced per system (no duplicated tiles)", () => {
  const seen = [];
  const origUnd = SGLayers.DYNAMIC.undulate;
  const origFactory = SGLayers._tileFactory;
  SGLayers.DYNAMIC.undulate = function (tctx, size, rs, pal, params) {
    seen.push(rs());
    return origUnd(tctx, size, rs, pal, params);
  };
  SGLayers._tileFactory = function () {
    return { width: 256, height: 256, getContext: () => mockCtx() };
  };
  try {
    const dynCfg = SGLayers.LAYER_DECKS.linear.find((c) => c.dynamic);
    const deck = [{ img: null, cfg: dynCfg }];
    const mkR = () => ({
      sStruct: SeedKit.streamFor(H13, "structure"),
      sTone: SeedKit.streamFor(H13, "tone"),
      sAccent: SeedKit.streamFor(H13, "accent-detail"),
    });
    SGLayers.composeLayers(mockCtx(), 256, deck, mkR(), H13, { ink: "#201c16" }, 0, "");
    SGLayers.composeLayers(mockCtx(), 256, deck, mkR(), H13, { ink: "#201c16" }, 0, "triangle");
  } finally {
    SGLayers.DYNAMIC.undulate = origUnd;
    SGLayers._tileFactory = origFactory;
  }
  assert.strictEqual(seen.length, 2, "expected two tile generations, saw " + seen.length);
  assert.notStrictEqual(seen[0], seen[1], "namespaced tile streams collide — tiles would duplicate");
});
ok("whole composition is turned 75° clockwise and drawn at 1.578× zoom", () => {
  const sixth = Math.PI / 6;
  const orient = sixth + Math.PI / 4; // 30° + the extra 45° rotation
  assert(Math.abs(SGArt.ORIENT_CW - orient) < 1e-15, "ORIENT_CW is not exactly 75°");
  assert.strictEqual(SGArt.ZOOM, 1.578, "ZOOM is not 1.578");
  [0, 1, 2].forEach((i) => {
    const want = orient + i * sixth;
    assert(Math.abs(SGArt.LAYER_ANGLES[i] - want) < 1e-15,
      `layer ${i} angle is not ${(want * 180 / Math.PI).toFixed(0)}°`);
  });
  // render() centers the zoom on the canvas before any linework is stroked
  const ctx = mockCtx();
  SGArt.render(ctx, 720, H13, null, 0);
  const calls = ctx._calls;
  const centered = calls.findIndex((c) => c[0] === "translate" && c[1] === 360 && c[2] === 360);
  const scaled = calls.findIndex((c) => c[0] === "scale" && c[1] === SGArt.ZOOM && c[2] === SGArt.ZOOM);
  const firstStroke = calls.findIndex((c) => c[0] === "stroke");
  assert(centered >= 0 && centered < scaled, "zoom is not centered on the canvas");
  assert(scaled >= 0 && scaled < firstStroke, "zoom is not applied before linework");
});

console.log(`\n${passed} fusion tests passed.`);
