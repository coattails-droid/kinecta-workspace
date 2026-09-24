// test_tessellation.js — textile tile mode: 4096×2160 seamless repeat.
const assert = require("assert");
const path = require("path");
let pureimage;
try {
  pureimage = require("/tmp/pitest/node_modules/pureimage");
} catch (e) {
  pureimage = require(path.join(__dirname, "..", "node_modules", "pureimage"));
}
global.self = global;
global.SeedKit = require("../js/seed.js");
global.SGTraits = require("../js/traits.js");
global.SGLayers = require("../js/layers.js");
const SGArt = require("../js/artwork.js");

let passed = 0;
function ok(name, fn) {
  try { fn(); console.log("ok - " + name); passed++; }
  catch (e) { console.error("FAIL - " + name + ": " + e.message); process.exitCode = 1; }
}

const hash = SeedKit.demoMintHash(13);

function renderTile(W, H, phase) {
  const img = pureimage.make(W, H);
  SGArt.renderTile(img.getContext("2d"), hash, null, { W: W, H: H, phase: phase || 0 });
  return img;
}

function getPx(img, x, y) {
  const d = img.getContext("2d").getImageData(x, y, 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
}

ok("renderTile produces the exact requested dimensions", () => {
  const img = renderTile(4096, 2160, 0);
  assert.strictEqual(img.width, 4096);
  assert.strictEqual(img.height, 2160);
});

ok("renderTile is deterministic", () => {
  const a = renderTile(256, 136, 0);
  const b = renderTile(256, 136, 0);
  for (let y = 0; y < 136; y += 13) for (let x = 0; x < 256; x += 17) {
    assert.deepStrictEqual(getPx(a, x, y), getPx(b, x, y), "pixel differs at " + x + "," + y);
  }
});

// Seam test: tile the output 2×2 and verify no discontinuity across the
// internal boundaries. We do this by rendering a wide canvas (2W×H) via two
// side-by-side tiles and checking the pixel columns just left and right of
// the join match the pattern's own continuity (i.e., the join is invisible).
// A stronger direct test: the leftmost column of the tile must equal the
// pattern that the rightmost column implies — verified by checking that a
// 2×1 horizontal strip (two tiles) has no vertical seam artifact: we compare
// the strip against a single tile rendered at 2W width is NOT valid (different
// modules), so instead we verify C1 continuity across the seam by sampling.
ok("horizontal seam is continuous (no visible join)", () => {
  const W = 512, H = 270;
  const tile = renderTile(W, H, 0);
  // Build a 2-wide strip by copying the tile twice.
  const strip = pureimage.make(W * 2, H);
  const sctx = strip.getContext("2d");
  sctx.drawImage(tile, 0, 0);
  sctx.drawImage(tile, W, 0);
  // For a seamless tile, the pixel transition across x=W must be smooth.
  // We verify by checking that the left edge of the tile matches what the
  // right edge implies: specifically, sample a horizontal line and ensure
  // there's no abrupt change in the local variance at the seam vs elsewhere.
  const y = 135;
  function localVar(img, cx) {
    const vals = [];
    for (let dx = -8; dx <= 8; dx++) {
      const p = getPx(img, cx + dx, y);
      vals.push(p[0] + p[1] + p[2]); // luminance proxy
    }
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    return vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / vals.length;
  }
  const varAtSeam = localVar(strip, W);
  const varElsewhere1 = localVar(strip, W / 2);
  const varElsewhere2 = localVar(strip, W + W / 2);
  const avgElsewhere = (varElsewhere1 + varElsewhere2) / 2;
  // The seam variance should be within 3× of the typical variance
  // (a hard discontinuity would spike it by 10× or more).
  assert.ok(varAtSeam < avgElsewhere * 3 + 100,
    "seam variance " + varAtSeam.toFixed(1) + " vs typical " + avgElsewhere.toFixed(1));
});

ok("vertical seam is continuous (no visible join)", () => {
  const W = 512, H = 270;
  const tile = renderTile(W, H, 0);
  const strip = pureimage.make(W, H * 2);
  const sctx = strip.getContext("2d");
  sctx.drawImage(tile, 0, 0);
  sctx.drawImage(tile, 0, H);
  const x = 256;
  function localVar(img, cy) {
    const vals = [];
    for (let dy = -8; dy <= 8; dy++) {
      const p = getPx(img, x, cy + dy);
      vals.push(p[0] + p[1] + p[2]);
    }
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    return vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / vals.length;
  }
  const varAtSeam = localVar(strip, H);
  const avgElsewhere = (localVar(strip, H / 2) + localVar(strip, H + H / 2)) / 2;
  assert.ok(varAtSeam < avgElsewhere * 3 + 100,
    "seam variance " + varAtSeam.toFixed(1) + " vs typical " + avgElsewhere.toFixed(1));
});

// Direct periodicity test for the base layer: render the tile, then verify
// that shifting by (W,0) leaves the base-layer-only render unchanged.
// (We can't easily isolate layers in the full render, so we test the mask:
// at the tile boundary, the rotated layers must contribute zero.)
ok("rotated layers fade to zero at the tile boundary (mask)", () => {
  const W = 400, H = 300;
  // tileMask must be 0 on the boundary and 1 in the interior.
  assert.strictEqual(SGArt.tileMask(W, H, 0, H / 2), 0);
  assert.strictEqual(SGArt.tileMask(W, H, W, H / 2), 0);
  assert.strictEqual(SGArt.tileMask(W, H, W / 2, 0), 0);
  assert.strictEqual(SGArt.tileMask(W, H, W / 2, H), 0);
  assert.strictEqual(SGArt.tileMask(W, H, W / 2, H / 2), 1);
  // monotonic increase from edge to interior
  let prev = 0;
  for (let d = 1; d < 50; d++) {
    const m = SGArt.tileMask(W, H, d, H / 2);
    assert.ok(m >= prev, "mask not monotonic at d=" + d);
    prev = m;
  }
});

ok("fusedGraphTile builds a periodic base (module lines at 0 and W)", () => {
  const W = 512, H = 270;
  const t = SGTraits.deriveTraits(hash);
  const baseMods = SGArt.DENSITY_MODULES[t.density] || SGArt.DENSITY_MODULES.standard;
  const nRows = baseMods * 2, nCols = Math.max(2, Math.round(nRows * W / H));
  const G = SGArt.fusedGraphTile(hash, W, H, W / nCols, H / nRows, nCols, nRows);
  assert.ok(G.verts.length > 100, "too few vertices: " + G.verts.length);
  assert.ok(G.edges.length > 100, "too few edges: " + G.edges.length);
  // Base layer (layer 0) vertices should include points on x=0 and x=W
  // (the periodic module lines).
  let onLeft = 0, onRight = 0;
  for (let i = 0; i < G.verts.length; i++) {
    if (G.vertLayer[i] !== 0) continue;
    const v = G.verts[i];
    if (Math.abs(v.x) < 1 && v.y >= 0 && v.y <= H) onLeft++;
    if (Math.abs(v.x - W) < 1 && v.y >= 0 && v.y <= H) onRight++;
  }
  assert.ok(onLeft > 0 && onRight > 0, "base layer missing boundary vertices");
});

console.log("\n" + passed + " tessellation tests passed.");
