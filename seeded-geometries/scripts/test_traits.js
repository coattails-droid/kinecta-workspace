// test_traits.js — Node tests for the Accent Hue trait.
// Run: node scripts/test_traits.js
"use strict";
const assert = require("assert");
const SeedKit = require("../js/seed.js");
const SGTraits = require("../js/traits.js");
const SGArt = require("../js/artwork.js");

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

const HEX = /^#[0-9a-f]{6}$/i;

ok("hue keys match between traits table and color definitions", () => {
  const traitKeys = SGTraits.ACCENT_HUES.map((h) => h.key).sort();
  assert.deepStrictEqual(Object.keys(SGArt.HUE_COLORS).sort(), traitKeys);
});

ok("every hue color is a valid 6-digit HTML hex code", () => {
  for (const [key, hex] of Object.entries(SGArt.HUE_COLORS)) {
    assert.ok(HEX.test(hex), key + " has invalid hex: " + hex);
  }
});

ok("hue set is deterministic per hash and all hues appear across mints", () => {
  const h0 = SeedKit.demoMintHash(7);
  assert.deepStrictEqual(SGTraits.deriveTraits(h0).hues, SGTraits.deriveTraits(h0).hues);
  const seen = new Set();
  let multi = 0;
  for (let i = 0; i < 300; i++) {
    const hues = SGTraits.deriveTraits(SeedKit.demoMintHash(i)).hues;
    hues.forEach((h) => seen.add(h));
    if (hues.length > 1) multi++;
  }
  assert.deepStrictEqual([...seen].sort(), ["gold", "ink", "magenta", "turquoise"]);
  assert.ok(multi > 0, "no multi-hue piece in first 300 mints");
});

ok("features() exposes Accent Hues as marketplace metadata", () => {
  const feats = SGTraits.features(SeedKit.demoMintHash(11));
  assert.strictEqual(feats.length, 5);
  const hueFeat = feats.find((f) => f.trait_type === "Accent Hues");
  assert.ok(hueFeat, "no Accent Hues entry");
  const labels = SGTraits.ACCENT_HUES.map((h) => h.label);
  assert.notStrictEqual(hueFeat.value, "None", "every mint now carries accent hues");
  hueFeat.value.split(" + ").forEach((lab) => {
    assert.ok(labels.includes(lab), "unknown hue label: " + lab);
  });
});

ok("only the surviving palette and hue sets ever appear (2000-mint fuzz)", () => {
  const pool = SGTraits.ACCENT_HUES.map((h) => h.key);
  for (let i = 0; i < 2000; i++) {
    const t = SGTraits.deriveTraits(SeedKit.demoMintHash(i));
    assert.strictEqual(t.palette, "ink", "stray palette: " + t.palette);
    assert.ok(Array.isArray(t.hues), "hues is not an array");
    t.hues.forEach((h) => assert.ok(pool.includes(h), "stray hue: " + h));
    assert.strictEqual(new Set(t.hues).size, t.hues.length, "duplicate hue in set");
    const want = t.accent === "bold" ? [2, 3] : [1];
    assert.ok(want.includes(t.hues.length), "hue count vs accent mismatch: " + t.hues.length);
  }
});

ok("render paints exactly 24 accent dots in the piece's hue colors, on lattice vertices", () => {
  const hash = SeedKit.demoMintHash(13);
  const traits = SGTraits.deriveTraits(hash);
  assert.ok(traits.hues.length > 1, "token 13 is not multi-hue");
  const c = mockCtx();
  SGArt.render(c, 720, hash, null);
  const fills = c._calls.filter((k) => k[0] === "set:fillStyle").map((k) => k[1]);
  const expected = traits.hues.map((h) => SGArt.HUE_COLORS[h]);
  expected.forEach((hex) => assert.ok(fills.includes(hex),
    `expected dot color ${hex} among fillStyles`));
  // every dot center lies on a lattice vertex
  // Accent dots are the arcs drawn at globalAlpha 0.9; the triangle field's
  // inscribed circles share the bone fill color but are drawn at much lower
  // alpha, so the alpha marker disambiguates them.
  const arcs = [];
  for (let i = 0; i < c._calls.length; i++) {
    const k = c._calls[i];
    if (k[0] === "arc") {
      const prev = c._calls.slice(0, i).reverse();
      arcs.push({ x: k[1], y: k[2],
        fill: prev.find((p) => p[0] === "set:fillStyle")[1],
        alpha: prev.find((p) => p[0] === "set:globalAlpha")[1] });
    }
  }
  const dots = arcs.filter((a) => expected.includes(a.fill) && a.alpha === 0.9);
  assert.strictEqual(dots.length, SGArt.ACCENT_DOTS + SGArt.ACCENT_DOTS_OUTER,
    `expected ${SGArt.ACCENT_DOTS + SGArt.ACCENT_DOTS_OUTER} accent dots, drew ${dots.length}`);
  // Dots are pinned to the welded graph's vertices: the base lattice plus
  // both rotated duplicates and every cross-layer weld point.
  const mod = 720 / SGArt.DENSITY_MODULES[traits.density];
  const G = SGArt.fusedGraph(hash, 720, mod);
  const verts = new Set();
  G.verts.forEach((v) => verts.add(v.x.toFixed(4) + "," + v.y.toFixed(4)));
  dots.forEach((d) => assert.ok(verts.has(d.x.toFixed(4) + "," + d.y.toFixed(4)),
    `dot at ${d.x},${d.y} is not on a lattice vertex`));
});

ok("classic accent mints draw the same inner and outer rings in ink", () => {
  // find a classic mint (the old "none"): it must still draw the ring
  let hash = null, traits = null;
  for (let i = 0; i < 300 && !hash; i++) {
    const h = SeedKit.demoMintHash(i);
    const t = SGTraits.deriveTraits(h);
    if (t.accent === "classic") { hash = h; traits = t; }
  }
  assert.ok(hash, "no classic mint in first 300");
  assert.deepStrictEqual(traits.hues, ["ink"], "classic hue set is not ink-only");
  const S = 720;
  // expected dot count follows the architecture: the inner ring takes the
  // 12 nearest grid vertices, the outer ring the 12 farthest of the rest —
  // so a tier with fewer than 24 visible grid vertices fields fewer dots.
  const mod = S / SGArt.DENSITY_MODULES[traits.density];
  const unit = mod / 3;
  const G = SGArt.fusedGraph(hash, S, mod);
  const set = SGArt._squareGridVertSet(G, SGArt.LAYER_ANGLES);
  const vr = 1 / (2 * SGArt.ZOOM);
  const gr0 = S * (0.5 - vr), gr1 = S * (0.5 + vr);
  let cand = 0;
  G.verts.forEach((v, i) => {
    if (!set.has(i)) return;
    if (v.x < gr0 - unit || v.x > gr1 + unit || v.y < gr0 - unit || v.y > gr1 + unit) return;
    cand++;
  });
  const wantDots = Math.min(SGArt.ACCENT_DOTS, cand) +
    Math.min(SGArt.ACCENT_DOTS_OUTER, Math.max(0, cand - SGArt.ACCENT_DOTS));
  const c = mockCtx();
  SGArt.render(c, S, hash, null);
  const ink = SGArt.HUE_COLORS.ink;
  const wantR = unit * 0.12 * SGArt.DOT_SIZE;
  let parents = 0, other = 0;
  for (let i = 0; i < c._calls.length; i++) {
    const k = c._calls[i];
    if (k[0] !== "arc" || Math.abs(k[3] - wantR) > 1e-3) continue;
    const prev = c._calls.slice(0, i).reverse();
    const fill = prev.find((p) => p[0] === "set:fillStyle")[1];
    const alpha = prev.find((p) => p[0] === "set:globalAlpha")[1];
    if (alpha !== 0.9) continue;
    if (fill === ink) parents++;
    else other++;
  }
  assert.strictEqual(parents, wantDots,
    `classic mint drew ${parents} ink dots, expected ${wantDots} (${traits.density}, ${cand} candidates)`);
  assert.strictEqual(other, 0, `classic mint drew ${other} non-ink accent dots`);
});

ok("accent dots form inner and outer rings on linear-grid vertices", () => {
  // Token 13 (bold, multi-hue): with the unified vertex set (TRI_SUBDIV=1)
  // the inner ring is the 12 square-grid vertices nearest the center and
  // the outer ring is the 12 square-grid vertices farthest from it.
  const S = 720;
  const hash = SeedKit.demoMintHash(13);
  const traits = SGTraits.deriveTraits(hash);
  const c = mockCtx();
  SGArt.render(c, S, hash, null);
  const expected = traits.hues.map((hh) => SGArt.HUE_COLORS[hh]);
  // parent dots only: skip the smaller ink/bone center dots drawn on top
  const wantR = (S / SGArt.DENSITY_MODULES[traits.density] / 3) * 0.12 * SGArt.DOT_SIZE;
  const dots = [];
  for (let j = 0; j < c._calls.length; j++) {
    const k = c._calls[j];
    if (k[0] !== "arc") continue;
    if (Math.abs(k[3] - wantR) > 1e-3) continue;
    const prev = c._calls.slice(0, j).reverse();
    const a = { x: k[1], y: k[2],
      fill: prev.find((p) => p[0] === "set:fillStyle")[1],
      alpha: prev.find((p) => p[0] === "set:globalAlpha")[1] };
    if (expected.includes(a.fill) && a.alpha === 0.9) dots.push(a);
  }
  assert.strictEqual(dots.length, SGArt.ACCENT_DOTS + SGArt.ACCENT_DOTS_OUTER,
    `expected ${SGArt.ACCENT_DOTS + SGArt.ACCENT_DOTS_OUTER} ring dots, found ${dots.length}`);
  // every dot sits on a square-grid vertex: unrotate into each layer's frame
  // and require the position to be on the module lattice (not just the
  // subcell thirds). Diagonal crossings never satisfy this, so the check
  // locks the alignment.
  const mod = S / SGArt.DENSITY_MODULES[traits.density];
  dots.forEach((d) => {
    let onGrid = false;
    for (let L = 0; L < 3 && !onGrid; L++) {
      const a = -SGArt.LAYER_ANGLES[L];
      const ca = Math.cos(a), sa = Math.sin(a);
      const dx = d.x - S / 2, dy = d.y - S / 2;
      const lx = dx * ca - dy * sa + S / 2, ly = dx * sa + dy * ca + S / 2;
      if (Math.abs(lx / mod - Math.round(lx / mod)) < 0.002 &&
          Math.abs(ly / mod - Math.round(ly / mod)) < 0.002) onGrid = true;
    }
    assert.ok(onGrid, `dot at ${d.x},${d.y} is not on a linear-grid vertex`);
  });
  // ...and the rings sit where they should: the inner ring hugs the center
  // (every dot within half the piece of the pivot, far tighter than the old
  // full-window grid — dense token 13 sits within a module or two; the bound
  // stays generous for sparse), the outer ring hugs the frame edge, and the
  // two never interleave: every inner dot is nearer the center than every
  // outer dot.
  const byR = dots.slice().sort((a, b) =>
    Math.hypot(a.x - S / 2, a.y - S / 2) - Math.hypot(b.x - S / 2, b.y - S / 2));
  const inner = byR.slice(0, SGArt.ACCENT_DOTS);
  const outer = byR.slice(SGArt.ACCENT_DOTS);
  assert.strictEqual(outer.length, SGArt.ACCENT_DOTS_OUTER, "outer ring is not 12 dots");
  inner.forEach((d) => {
    const r = Math.hypot(d.x - S / 2, d.y - S / 2);
    assert.ok(r <= 0.5 * S, `inner dot at ${d.x},${d.y} is ${r.toFixed(1)}px from center`);
  });
  const innerMax = Math.max(...inner.map((d) => Math.hypot(d.x - S / 2, d.y - S / 2)));
  outer.forEach((d) => {
    const r = Math.hypot(d.x - S / 2, d.y - S / 2);
    assert.ok(r >= innerMax, `outer dot at ${d.x},${d.y} interleaves with the inner ring`);
  });
  // the rings are deterministic: a second render lands the same 24 vertices
  function ringKeys(ctx) {
    const out = [];
    for (let j = 0; j < ctx._calls.length; j++) {
      const k = ctx._calls[j];
      if (k[0] !== "arc" || Math.abs(k[3] - wantR) > 1e-3) continue;
      const prev = ctx._calls.slice(0, j).reverse();
      const fill = prev.find((p) => p[0] === "set:fillStyle")[1];
      const alpha = prev.find((p) => p[0] === "set:globalAlpha")[1];
      if (expected.includes(fill) && alpha === 0.9)
        out.push(k[1].toFixed(4) + "," + k[2].toFixed(4));
    }
    return out.sort();
  }
  const c2 = mockCtx();
  SGArt.render(c2, S, hash, null);
  assert.deepStrictEqual(ringKeys(c2), ringKeys(c),
    "ring moved between renders");
  const seen = new Set(ringKeys(c));
  assert.strictEqual(seen.size, SGArt.ACCENT_DOTS + SGArt.ACCENT_DOTS_OUTER, "ring dots are not all distinct");
});

ok("outer ring is exactly the farthest square-grid vertices from the center", () => {
  // White-box check against the real selection: rebuild the candidate set
  // the way dotsSim does (square-grid vertices inside the visible region
  // plus a dot-radius margin), then require the rendered dots to sit on
  // exactly the 12 nearest (inner) and 12 farthest (outer) candidates.
  const S = 720;
  const hash = SeedKit.demoMintHash(13);
  const traits = SGTraits.deriveTraits(hash);
  const mod = S / SGArt.DENSITY_MODULES[traits.density];
  const unit = mod / 3;
  const G = SGArt.fusedGraph(hash, S, mod);
  const vr = 1 / (2 * SGArt.ZOOM);
  const region = [S * (0.5 - vr), S * (0.5 - vr), S * (0.5 + vr), S * (0.5 + vr)];
  const set = SGArt._squareGridVertSet(G, SGArt.LAYER_ANGLES);
  const cx = S / 2, cy = S / 2;
  const cand = [];
  G.verts.forEach((v, i) => {
    if (!set.has(i)) return;
    if (v.x < region[0] - unit || v.x > region[2] + unit) return;
    if (v.y < region[1] - unit || v.y > region[3] + unit) return;
    cand.push({ i: i, d2: (v.x - cx) * (v.x - cx) + (v.y - cy) * (v.y - cy) });
  });
  assert.ok(cand.length >= SGArt.ACCENT_DOTS + SGArt.ACCENT_DOTS_OUTER,
    `only ${cand.length} candidate vertices for two full rings`);
  cand.sort((a, b) => a.d2 - b.d2 || a.i - b.i);
  const used = new Set(cand.slice(0, SGArt.ACCENT_DOTS).map((c) => c.i));
  const outer = cand.filter((c) => !used.has(c.i))
    .sort((a, b) => b.d2 - a.d2 || a.i - b.i)
    .slice(0, SGArt.ACCENT_DOTS_OUTER);
  const want = new Set(
    [...used, ...outer.map((c) => c.i)]
      .map((i) => G.verts[i].x.toFixed(4) + "," + G.verts[i].y.toFixed(4)));
  // at rest (phase 0) every dot sits exactly on its vertex
  const c = mockCtx();
  SGArt.render(c, S, hash, null);
  const expected = traits.hues.map((hh) => SGArt.HUE_COLORS[hh]);
  const wantR = unit * 0.12 * SGArt.DOT_SIZE;
  const dots = [];
  for (let j = 0; j < c._calls.length; j++) {
    const k = c._calls[j];
    if (k[0] !== "arc" || Math.abs(k[3] - wantR) > 1e-3) continue;
    const prev = c._calls.slice(0, j).reverse();
    const fill = prev.find((p) => p[0] === "set:fillStyle")[1];
    const alpha = prev.find((p) => p[0] === "set:globalAlpha")[1];
    if (expected.includes(fill) && alpha === 0.9)
      dots.push(k[1].toFixed(4) + "," + k[2].toFixed(4));
  }
  assert.strictEqual(dots.length, SGArt.ACCENT_DOTS + SGArt.ACCENT_DOTS_OUTER,
    `expected ${SGArt.ACCENT_DOTS + SGArt.ACCENT_DOTS_OUTER} ring dots, found ${dots.length}`);
  dots.forEach((key) => assert.ok(want.has(key),
    `dot at ${key} is not one of the 12 nearest / 12 farthest grid vertices`));
  assert.deepStrictEqual(new Set(dots), want, "rendered rings do not match the expected vertex sets");
});

ok("all accent dots share one smaller size", () => {
  // same bold multi-hue mint shape as the vertex test
  const S = 720;
  let hash = null, traits = null;
  for (let i = 0; i < 300 && !hash; i++) {
    const h = SeedKit.demoMintHash(i);
    const t = SGTraits.deriveTraits(h);
    if (t.accent === "bold" && t.hues.length > 1) { hash = h; traits = t; }
  }
  assert.ok(hash, "no bold multi-hue mint in first 300");
  const c = mockCtx();
  SGArt.render(c, S, hash, null);
  const expected = traits.hues.map((h) => SGArt.HUE_COLORS[h]);
  const r0 = (S / SGArt.DENSITY_MODULES[traits.density] / 3) * 0.12; // base dot radius
  const want = r0 * SGArt.DOT_SIZE;
  assert.ok(want < r0, "DOT_SIZE is not smaller than the base radius");
  const radii = [];
  for (let i = 0; i < c._calls.length; i++) {
    const k = c._calls[i];
    if (k[0] !== "arc") continue;
    if (Math.abs(k[3] - want) > 1e-3) continue; // parents only, not center dots
    const prev = c._calls.slice(0, i).reverse();
    const fill = prev.find((p) => p[0] === "set:fillStyle")[1];
    const alpha = prev.find((p) => p[0] === "set:globalAlpha")[1];
    if (expected.includes(fill) && alpha === 0.9) radii.push(k[3]);
  }
  assert.ok(radii.length > 0, "no accent dots drawn");
  radii.forEach((r) => assert.ok(Math.abs(r - want) < 1e-3,
    `dot radius ${r.toFixed(4)} differs from the uniform size ${want.toFixed(4)}`));
});

ok("only ink accent dots carry a smaller, dimmer bone center", () => {
  // same bold multi-hue mint shape as the size test
  const S = 720;
  let hash = null, traits = null;
  for (let i = 0; i < 300 && !hash; i++) {
    const h = SeedKit.demoMintHash(i);
    const t = SGTraits.deriveTraits(h);
    if (t.accent === "bold" && t.hues.length > 1 && t.hues.includes("ink")) { hash = h; traits = t; }
  }
  assert.ok(hash, "no bold multi-hue mint including ink in first 300");
  const c = mockCtx();
  SGArt.render(c, S, hash, null);
  const expected = traits.hues.map((h) => SGArt.HUE_COLORS[h]);
  const ink = SGArt.HUE_COLORS.ink;
  const bone = SGArt.BONE;
  const r0 = (S / SGArt.DENSITY_MODULES[traits.density] / 3) * 0.12;
  const want = r0 * SGArt.DOT_SIZE, wantC = want * SGArt.DOT_CENTER;
  assert.ok(wantC < want, "DOT_CENTER is not smaller than the accent dot");
  const parents = [], inkParents = [], centers = [];
  for (let i = 0; i < c._calls.length; i++) {
    const k = c._calls[i];
    if (k[0] !== "arc") continue;
    const prev = c._calls.slice(0, i).reverse();
    const fill = prev.find((p) => p[0] === "set:fillStyle")[1];
    const alpha = prev.find((p) => p[0] === "set:globalAlpha")[1];
    const a = { x: k[1], y: k[2], fill: fill, alpha: alpha };
    if (expected.includes(fill) && alpha === 0.9 && Math.abs(k[3] - want) < 1e-3) {
      parents.push(a);
      if (fill === ink) inkParents.push(a);
    } else if (Math.abs(alpha - 0.9 * SGArt.CENTER_ALPHA) < 1e-3 &&
               Math.abs(k[3] - wantC) < 1e-3 &&
               fill === bone) {
      centers.push(a);
    }
  }
  assert.ok(parents.length > 0, "no accent dots drawn");
  assert.ok(inkParents.length > 0, "no ink accent dots drawn");
  assert.strictEqual(centers.length, inkParents.length,
    `bone center count ${centers.length} != ink parent count ${inkParents.length}`);
  // every ink parent has exactly one bone center at its center, at
  // CENTER_ALPHA times the parent's alpha; colored parents have none;
  // no orphan centers.
  const key = (a) => a.x.toFixed(4) + "," + a.y.toFixed(4);
  const centerMap = new Map();
  centers.forEach((a) => centerMap.set(key(a), a));
  parents.forEach((p) => {
    const cc = centerMap.get(key(p));
    if (p.fill === ink) {
      assert.ok(cc, `no bone center on ink dot at ${p.x},${p.y}`);
      assert.strictEqual(cc.fill, bone,
        `center fill ${cc.fill} should be bone on an ink dot`);
      assert.ok(Math.abs(cc.alpha - p.alpha * SGArt.CENTER_ALPHA) < 1e-6,
        `center alpha ${cc.alpha} should be parent alpha * CENTER_ALPHA`);
      assert.ok(cc.alpha < p.alpha, "center is not more transparent than its parent");
    } else {
      assert.ok(!cc, `bone center on colored (${p.fill}) dot at ${p.x},${p.y}`);
    }
  });
  const parentKeys = new Set(parents.map(key));
  centers.forEach((a) =>
    assert.ok(parentKeys.has(key(a)), `orphan center dot at ${a.x},${a.y}`));
});

ok("line widths are halved: no stroke exceeds S/1200", () => {
  const S = 720;
  const c = mockCtx();
  SGArt.render(c, S, SeedKit.demoMintHash(13), null);
  const widths = c._calls.filter((k) => k[0] === "set:lineWidth").map((k) => k[1]);
  assert.ok(widths.length > 0, "no lineWidth sets recorded");
  const maxW = Math.max(...widths);
  assert.ok(maxW <= S / 1200 + 1e-4,
    `stroke wider than halved maximum: ${maxW} (budget ${S / 1200})`);
});

ok("rarity scoring accounts for the hue set", () => {
  const pop = [];
  for (let i = 0; i < 60; i++) pop.push(SGTraits.deriveTraits(SeedKit.demoMintHash(i)));
  const a = pop[0];
  const b = Object.assign({}, a, { hues: a.hues.includes("ink") ? ["magenta"] : ["ink"] });
  assert.notStrictEqual(
    SGTraits.scoreRarity(pop, a), SGTraits.scoreRarity(pop, b),
    "hue-set change did not move the rarity score");
});

ok("inverted grid trait flips stroke order without changing geometry", () => {
  const S = 720;
  // distribution: both options appear, roughly 70/30
  let inv = 0; const N = 300;
  for (let i = 0; i < N; i++) {
    if (SGTraits.deriveTraits(SeedKit.demoMintHash(i)).grid === "fusion-inv") inv++;
  }
  assert.ok(inv > 0, "inverted grid never rolled");
  const frac = inv / N;
  assert.ok(frac > 0.15 && frac < 0.45, `inverted grid fraction ${frac} far from 0.30`);

  // composite systems order is inverted too
  assert.deepStrictEqual(SGTraits.compositeFor("fusion"), ["triangle", "linear"]);
  assert.deepStrictEqual(SGTraits.compositeFor("fusion-inv"), ["linear", "triangle"]);

  // same hash: identical geometry and stream order, flipped paint order
  const h = SeedKit.demoMintHash(13);
  const t = SGTraits.deriveTraits(h);
  const mod = S / SGArt.DENSITY_MODULES[t.density];
  const A = SGArt.fusedGraph(h, S, mod, "fusion");
  const B = SGArt.fusedGraph(h, S, mod, "fusion-inv");
  assert.strictEqual(SGArt.fusedGraph(h, S, mod), A, "default gridKey is not fusion");
  assert.strictEqual(A.verts.length, B.verts.length, "vertex count changed");
  assert.strictEqual(A.parents.length, B.parents.length, "parent count changed");
  assert.deepStrictEqual(A.consOrder, B.consOrder, "stream consumption order changed");
  assert.notDeepStrictEqual(A.drawOrder, B.drawOrder, "draw order did not flip");

  // within a layer: fusion strokes tri before h/v (field under grid);
  // inverted strokes tri after h/v (field over grid)
  const layerKindPositions = (G, layer) => {
    const pos = { tri: [], hv: [] };
    G.drawOrder.forEach((pi, di) => {
      const p = G.parents[pi];
      if (p.layer !== layer) return;
      (p.kind === "tri" ? pos.tri : pos.hv).push(di);
    });
    return pos;
  };
  const pA = layerKindPositions(A, 0), pB = layerKindPositions(B, 0);
  assert.ok(pA.tri.length && pA.hv.length && pB.tri.length && pB.hv.length,
    "layer 0 missing tri or grid parents");
  assert.ok(Math.max(...pA.tri) < Math.min(...pA.hv), "fusion: tri not under grid");
  assert.ok(Math.min(...pB.tri) > Math.max(...pB.hv), "inverted: tri not over grid");

  // the trait surfaces in marketplace metadata
  const gf = SGTraits.features(h).find((f) => f.trait_type === "Grid System");
  assert.ok(gf && /Linear Grid|Triangle Field/.test(gf.value),
    "Grid System missing from features: " + JSON.stringify(gf));
});

console.log(`\n${passed} trait tests passed.`);
