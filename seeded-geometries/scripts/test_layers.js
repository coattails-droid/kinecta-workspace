// test_layers.js — Node tests for js/layers.js and its render integration.
// Run: node scripts/test_layers.js
"use strict";
const assert = require("assert");
const SeedKit = require("../js/seed.js");
const SGTraits = require("../js/traits.js");
const SGLayers = require("../js/layers.js");
const SGArt = require("../js/artwork.js");

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log("ok - " + name); }
  catch (e) { console.error("FAIL - " + name + ": " + e.message); process.exitCode = 1; }
}
async function aok(name, fn) {
  try { await fn(); passed++; console.log("ok - " + name); }
  catch (e) { console.error("FAIL - " + name + ": " + e.message); process.exitCode = 1; }
}

// Mock canvas ctx that records every call and property set.
function mockCtx() {
  const calls = [];
  const norm = (a) => {
    if (typeof a === "number") return +a.toFixed(4);
    if (a && typeof a === "object" && a.width) return `[img ${a.width}x${a.height}]`;
    return a;
  };
  const t = { _calls: calls };
  return new Proxy(t, {
    get(tg, prop) {
      if (prop === "_calls") return calls;
      return (...args) => { calls.push([prop, ...args.map(norm)]); };
    },
    set(tg, prop, v) { calls.push(["set:" + String(prop), norm(v)]); return true; },
  });
}

// Fake Image factory; `fail` is a Set of src values that should error.
function fakeImages(fail) {
  return function () {
    const img = { width: 256, height: 256, onload: null, onerror: null };
    Object.defineProperty(img, "src", {
      set(v) {
        if (fail && fail.has(v)) { if (img.onerror) img.onerror(); }
        else if (img.onload) img.onload();
      },
    });
    return img;
  };
}

const HASHES = [SeedKit.demoMintHash(3), SeedKit.demoMintHash(17), SeedKit.demoMintHash(42)];

// Node has no document/canvas: inject a tile factory that records drawing.
SGLayers._tileFactory = function (size) {
  const c = mockCtx();
  return { width: size, height: size, getContext: function () { return c; }, _mock: c };
};

(async () => {
  ok("deck keys match the composite's member systems", () => {
    // Decks are keyed by the composite's member systems: every system the
    // renderer composites a depth deck for needs a deck entry.
    const sysKeys = SGTraits.compositeFor("fusion").sort();
    assert.deepStrictEqual(Object.keys(SGLayers.LAYER_DECKS).sort(), sysKeys);
  });

  ok("deck configs are sane ranges", () => {
    for (const [key, deck] of Object.entries(SGLayers.LAYER_DECKS)) {
      assert.ok(deck.length > 0, key + " deck is empty");
      assert.ok(deck.some((c) => c.dynamic), key + " deck has no dynamic layer");
      deck.forEach((c) => {
        if (c.dynamic) {
          assert.ok(typeof SGLayers.DYNAMIC[c.dynamic] === "function", "unknown dynamic: " + c.dynamic);
          assert.ok(c.params && Array.isArray(c.params.lines)
            && Array.isArray(c.params.amp) && Array.isArray(c.params.waves), "params for " + c.dynamic);
        } else {
          assert.ok(/\.png$/.test(c.file), c.file);
        }
        assert.ok(c.alpha[0] <= c.alpha[1], "alpha range " + (c.file || c.dynamic));
        assert.ok(c.scale[0] <= c.scale[1] && c.scale[0] > 0, "scale range " + (c.file || c.dynamic));
        assert.ok(c.count[0] <= c.count[1] && c.count[0] >= 0, "count range " + (c.file || c.dynamic));
      });
    }
  });

  await aok("loadLayers loads every deck", async () => {
    const decks = await SGLayers.loadLayers(undefined, fakeImages());
    for (const key of Object.keys(SGLayers.LAYER_DECKS)) {
      assert.strictEqual(decks[key].length, SGLayers.LAYER_DECKS[key].length, key);
    }
  });

  await aok("loadLayers survives a missing PNG", async () => {
    const missing = new Set(["assets/layers/linear/layer-01-hatch.png"]);
    const decks = await SGLayers.loadLayers(undefined, fakeImages(missing));
    assert.strictEqual(decks.linear.length, 2); // 1 missing file skipped, dynamic kept
    assert.strictEqual(decks.triangle.length, 3);
  });

  await aok("dynamic entries resolve even when all file loads fail", async () => {
    const failAll = new Set();
    Object.values(SGLayers.LAYER_DECKS).forEach((deck) =>
      deck.forEach((c) => { if (c.file) failAll.add(c.file); }));
    const decks = await SGLayers.loadLayers(undefined, fakeImages(failAll));
    for (const key of Object.keys(SGLayers.LAYER_DECKS)) {
      const expected = SGLayers.LAYER_DECKS[key].filter((c) => c.dynamic).length;
      assert.strictEqual(decks[key].length, expected, key);
      assert.ok(decks[key].every((e) => e.img === null && e.cfg.dynamic), key);
    }
  });

  ok("undulating tile is deterministic per seed", () => {
    const P = { ink: "#201c16" };
    const params = { lines: [36, 70], amp: [0.03, 0.08], waves: [2, 5] };
    const tile = () => {
      const c = mockCtx();
      SGLayers.DYNAMIC.undulate(c, 256, SeedKit.streamFor(HASHES[0], "layer:undulate:0"), P, params);
      return c._calls;
    };
    const other = mockCtx();
    SGLayers.DYNAMIC.undulate(other, 256, SeedKit.streamFor(HASHES[1], "layer:undulate:0"), P, params);
    const a = tile(), b = tile();
    assert.deepStrictEqual(a, b);
    assert.notDeepStrictEqual(a, other._calls);
    assert.ok(a.some((k) => k[0] === "stroke"), "tile should contain stroked contours");
    assert.ok(a.length > 200, "tile should contain many drawing calls, got " + a.length);
  });

  await aok("render with dynamic tiles is deterministic and draws them", async () => {
    const decks = await SGLayers.loadLayers(undefined, fakeImages());
    const run = (h) => {
      const tiles = [];
      SGLayers._tileFactory = function (size) {
        const c = mockCtx();
        const t = { width: size, height: size, getContext: () => c, _mock: c };
        tiles.push(t);
        return t;
      };
      const c = mockCtx();
      SGArt.render(c, 720, h, decks);
      return { calls: c._calls, tiles: tiles };
    };
    const a = run(HASHES[0]);
    const b = run(HASHES[0]);
    assert.deepStrictEqual(a.calls, b.calls);
    assert.ok(a.tiles.length > 0, "no dynamic tiles generated");
    assert.ok(a.tiles.every((t) => t._mock._calls.some((k) => k[0] === "stroke")),
      "every dynamic tile should contain contours");
  });

  await aok("render is deterministic with layers", async () => {
    const decks = await SGLayers.loadLayers(undefined, fakeImages());
    const run = (h) => { const c = mockCtx(); SGArt.render(c, 720, h, decks); return c._calls; };
    assert.deepStrictEqual(run(HASHES[0]), run(HASHES[0]));
    assert.notDeepStrictEqual(run(HASHES[0]), run(HASHES[1]));
  });

  await aok("layers actually composite (drawImage calls present)", async () => {
    const decks = await SGLayers.loadLayers(undefined, fakeImages());
    const c = mockCtx();
    SGArt.render(c, 720, HASHES[2], decks);
    assert.ok(c._calls.some((k) => k[0] === "drawImage"), "no drawImage calls recorded");
  });

  ok("render still works without layers (backwards compatible)", () => {
    const c = mockCtx();
    const t = SGArt.render(c, 720, HASHES[0]);
    assert.ok(t && t.grid && t.palette && t.density && t.accent);
    assert.ok(!c._calls.some((k) => k[0] === "drawImage"));
  });

  await aok("layer composition changes output vs no layers", async () => {
    const decks = await SGLayers.loadLayers(undefined, fakeImages());
    const a = mockCtx(); SGArt.render(a, 720, HASHES[1], decks);
    const b = mockCtx(); SGArt.render(b, 720, HASHES[1]);
    assert.notDeepStrictEqual(a._calls, b._calls);
  });

  ok("uniform pi-phase: rotation-free layers share one harmonic angle", () => {
    const deck = [
      { img: { width: 256, height: 256 }, cfg: { blend: "source-over", alpha: [0.1, 0.1], scale: [1, 1], count: [2, 2], rotate: 0 } },
      { img: { width: 256, height: 256 }, cfg: { blend: "source-over", alpha: [0.1, 0.1], scale: [1, 1], count: [3, 3], rotate: 0 } },
    ];
    const R = {
      sStruct: SeedKit.streamFor(HASHES[2], "structure"),
      sTone: SeedKit.streamFor(HASHES[2], "tone"),
      sAccent: SeedKit.streamFor(HASHES[2], "accent-detail"),
    };
    const c = mockCtx();
    SGLayers.composeLayers(c, 720, deck, R, HASHES[2], { ink: "#000" });
    const rots = c._calls.filter((k) => k[0] === "rotate").map((k) => k[1]);
    assert.strictEqual(rots.length, 5);
    assert.ok(rots.every((r) => Math.abs(r - rots[0]) < 1e-6), "rotations differ: " + rots);
    const eighths = rots[0] / SGLayers.PI_STEP;
    assert.ok(Math.abs(eighths - Math.round(eighths)) < 1e-3, "not on the pi/8 lattice: " + rots[0]);
  });

  await aok("every layer rotation in a full render sits on the pi/8 lattice", async () => {
    const decks = await SGLayers.loadLayers(undefined, fakeImages());
    for (const h of HASHES) {
      const c = mockCtx();
      SGArt.render(c, 720, h, decks);
      const rots = c._calls.filter((k) => k[0] === "rotate").map((k) => k[1]);
      assert.ok(rots.length > 0, "no rotations recorded");
      rots.forEach((r) => {
        const eighths = r / SGLayers.PI_STEP;
        assert.ok(Math.abs(eighths - Math.round(eighths)) < 1e-3, "off-lattice rotation: " + r);
      });
    }
  });

  ok("LAYER_TINT holds three distinct Mardi Gras hex hues", () => {
    const tints = SGArt.LAYER_TINT;
    assert.ok(Array.isArray(tints) && tints.length === 3, "expected 3 layer tints");
    tints.forEach((t) => assert.ok(/^#[0-9a-f]{6}$/i.test(t), "not hex: " + t));
    assert.strictEqual(new Set(tints.map((t) => t.toLowerCase())).size, 3, "tints not distinct");
    const bg = SGArt.PALETTES.ink.bg.toLowerCase();
    tints.forEach((t) => assert.notStrictEqual(t.toLowerCase(), bg, "tint equals background"));
  });

  ok("every rotated layer strokes its shards in its own tint", () => {
    const c = mockCtx();
    SGArt.render(c, 720, HASHES[0]); // static piece, no texture decks
    const strokes = c._calls.filter((k) => k[0] === "set:strokeStyle").map((k) => k[1]);
    for (const tint of SGArt.LAYER_TINT) {
      assert.ok(strokes.includes(tint), "tint never stroked: " + tint);
    }
  });

  ok("inscribed circles fill in their layer's tint", () => {
    const c = mockCtx();
    SGArt.render(c, 720, HASHES[0]);
    const fills = c._calls.filter((k) => k[0] === "set:fillStyle").map((k) => k[1]);
    for (const tint of SGArt.LAYER_TINT) {
      assert.ok(fills.includes(tint), "tint never filled: " + tint);
    }
  });

  ok("circles are centered on grid cells, not inside triangles", () => {
    const S = 720, TOL = 1e-6;
    const p = SGArt._pivot(S);
    for (const h of HASHES) {
      const t = SGTraits.deriveTraits(h);
      const mod = S / SGArt.DENSITY_MODULES[t.density];
      const u = mod / 3;
      for (let layer = 0; layer < 3; layer++) {
        const L = SGArt._layerSoup(h, mod, S, layer);
        assert(L.circles.length > 0, "no circles on layer " + layer);
        const ang = -SGArt.LAYER_ANGLES[layer];
        const ca = Math.cos(ang), sa = Math.sin(ang);
        for (const c of L.circles) {
          // un-rotate about the pivot: must land on a cell center
          const dx = c.x - p.x, dy = c.y - p.y;
          const fu = (p.x + dx * ca - dy * sa) / u - 0.5;
          const fv = (p.y + dx * sa + dy * ca) / u - 0.5;
          assert(Math.abs(fu - Math.round(fu)) < TOL,
            "circle x off cell center on layer " + layer + ": " + fu);
          assert(Math.abs(fv - Math.round(fv)) < TOL,
            "circle y off cell center on layer " + layer + ": " + fv);
        }
      }
    }
  });

  ok("triangle field shares the linear grid's vertex set (TRI_SUBDIV=1)", () => {
    const S = 720, TOL = 1e-6;
    assert(SGArt._triSubdiv() === 1, "shipped TRI_SUBDIV should be 1, got " + SGArt._triSubdiv());
    const p = SGArt._pivot(S);
    for (const h of HASHES) {
      const t = SGTraits.deriveTraits(h);
      const mod = S / SGArt.DENSITY_MODULES[t.density];
      for (let layer = 0; layer < 3; layer++) {
        const L = SGArt._layerSoup(h, mod, S, layer);
        const ang = -SGArt.LAYER_ANGLES[layer];
        const ca = Math.cos(ang), sa = Math.sin(ang);
        let nTri = 0;
        for (const e of L.soup) {
          if (e.kind !== "tri") continue;
          nTri++;
          // no legs at TRI_SUBDIV=1: every tri edge is a module diagonal
          const dx = e.x2 - e.x1, dy = e.y2 - e.y1;
          const len = Math.sqrt(dx * dx + dy * dy);
          assert(Math.abs(len - mod * Math.SQRT2) < 1e-6,
            "tri edge is not a module diagonal on layer " + layer + ": " + len);
          for (const pt of [[e.x1, e.y1], [e.x2, e.y2]]) {
            // un-rotate about the pivot: every triangle vertex must sit
            // exactly on a module-line crossing — the grid's vertices
            const rx = pt[0] - p.x, ry = pt[1] - p.y;
            const fu = (p.x + rx * ca - ry * sa) / mod;
            const fv = (p.y + rx * sa + ry * ca) / mod;
            assert(Math.abs(fu - Math.round(fu)) < TOL,
              "tri vertex x off the grid lattice on layer " + layer + ": " + fu);
            assert(Math.abs(fv - Math.round(fv)) < TOL,
              "tri vertex y off the grid lattice on layer " + layer + ": " + fv);
          }
        }
        assert(nTri > 0, "no triangle edges on layer " + layer);
      }
    }
  });

  ok("each subcell draws two concentric wash rings", () => {
    const S = 720;
    for (const h of HASHES) {
      const c = mockCtx();
      SGArt.render(c, S, h);
      // Wash arcs: fillStyle in a layer tint and alpha well below the 0.9
      // accent-dot marker (baseA2 maxes at 0.28 before dimming).
      const calls = c._calls;
      const wash = [];
      for (let i = 0; i < calls.length; i++) {
        const k = calls[i];
        if (k[0] !== "arc") continue;
        const prev = calls.slice(0, i).reverse();
        const fill = prev.find((p) => p[0] === "set:fillStyle")[1];
        const alpha = prev.find((p) => p[0] === "set:globalAlpha")[1];
        if (SGArt.LAYER_TINT.includes(fill) && alpha < 0.5)
          wash.push({ x: k[1], y: k[2], r: k[3], fill: fill });
      }
      assert(wash.length > 0, "no wash arcs drawn");
      const byCenter = new Map();
      for (const a of wash) {
        const key = a.fill + "@" + a.x.toFixed(1) + "," + a.y.toFixed(1);
        if (!byCenter.has(key)) byCenter.set(key, []);
        byCenter.get(key).push(a.r);
      }
      for (const [key, radii] of byCenter) {
        assert.strictEqual(radii.length, 2,
          "center " + key + " drew " + radii.length + " rings, want 2");
        assert(Math.abs(radii[0] - radii[1]) > 1e-6,
          "concentric rings coincide at " + key);
        // The smaller radius of each pair is plausibly the inner ring:
        // CIRCLE_R2 peaks at 0.20·unit × 1.3 = 0.26·unit, well under the
        // outer ring's 0.494·unit peak.
        const unit = S / SGArt.DENSITY_MODULES[SGTraits.deriveTraits(h).density] / 3;
        assert(Math.min(radii[0], radii[1]) <= 0.30 * unit,
          "inner ring too big at " + key);
      }
    }
  });

  ok("circles are bigger but stay inside their grid cell", () => {    const S = 720;
    for (const h of HASHES) {
      const c = mockCtx();
      SGArt.render(c, S, h);
      // arc(x, y, r, 0, TAU): circle field arcs plus the tiny accent dots
      const radii = c._calls.filter((k) => k[0] === "arc").map((k) => k[3]);
      assert(radii.length > 0, "no arcs drawn");
      const t = SGTraits.deriveTraits(h);
      const unit = (S / SGArt.DENSITY_MODULES[t.density]) / 3;
      let max = 0;
      for (const r of radii) {
        assert(r <= 0.5 * unit + 1e-9, "circle leaves its cell: r=" + r);
        if (r > max) max = r;
      }
      // the field reaches past 0.30·unit (peak breath 0.494·unit)
      assert(max > 0.30 * unit, "circles did not get bigger: max r=" + max);
    }
  });

  console.log(`\n${passed} layer tests passed.`);
})();
