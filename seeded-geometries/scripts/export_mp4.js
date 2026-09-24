// export_mp4.js — render a token's seamless animation loop to an MP4 file.
//
// Because every animated quantity in the renderer is periodic in the loop
// phase, frame(1) === frame(0): the MP4 loops with no visible seam.
//
// Rasterization uses the pure-JS "pureimage" canvas (no browser needed).
// One caveat: pureimage ignores blend modes, so PNG texture layers composite
// as source-over in the export (the gallery shows true blending).
//
// Usage:
//   node scripts/export_mp4.js <tokenIndex> [--frames 90] [--fps 30]
//       [--size 720] [--out token-13.mp4] [--layers]
//
// Needs: npm install pureimage   (npm i -g pureimage also works)
//        ffmpeg on PATH
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SeedKit = require("../js/seed.js");
const SGArt = require("../js/artwork.js");
const SGLayers = require("../js/layers.js");

function loadPureImage() {
  const tries = [
    () => require("pureimage"),
    () => require("/tmp/pitest/node_modules/pureimage"),
    () => require(path.join(process.env.HOME || "~", ".npm-global/lib/node_modules/pureimage")),
  ];
  for (const t of tries) {
    try { return t(); } catch (e) { /* next */ }
  }
  console.error("pureimage not found. Install it with: npm install pureimage");
  process.exit(1);
}

function parseArgs(argv) {
  const o = { token: null, frames: 90, fps: 30, size: 720, out: null, layers: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--frames") o.frames = parseInt(argv[++i], 10);
    else if (a === "--fps") o.fps = parseInt(argv[++i], 10);
    else if (a === "--size") o.size = parseInt(argv[++i], 10);
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--layers") o.layers = true;
    else rest.push(a);
  }
  o.token = parseInt(rest[0], 10);
  if (!Number.isFinite(o.token) || o.token < 0) {
    console.error("usage: node scripts/export_mp4.js <tokenIndex> [--frames 90] [--fps 30] [--size 720] [--out out.mp4] [--layers]");
    process.exit(1);
  }
  o.out = o.out || ("token-" + o.token + "-loop.mp4");
  return o;
}

// Build the layer decks the way the gallery does, but with pureimage-decoded
// PNGs instead of browser Images. Dynamic entries pass through untouched.
async function loadDecks(PImage) {
  const decks = {};
  for (const key of Object.keys(SGLayers.LAYER_DECKS)) {
    decks[key] = [];
    for (const cfg of SGLayers.LAYER_DECKS[key]) {
      if (cfg.dynamic) { decks[key].push({ img: null, cfg }); continue; }
      const p = path.join(ROOT, cfg.file);
      try {
        const img = await PImage.decodePNGFromStream(fs.createReadStream(p));
        decks[key].push({ img, cfg });
      } catch (e) {
        console.warn("[export] skipping missing layer: " + cfg.file);
      }
    }
  }
  return decks;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const PImage = loadPureImage();
  const hash = SeedKit.demoMintHash(o.token);
  const traits = require("../js/traits.js").deriveTraits(hash);
  console.log("token #" + o.token, hash.slice(0, 16) + "…");
  console.log("traits:", traits.grid, "/", traits.palette, "/", traits.density, "/", traits.accent, "/", traits.hues.join("+"));

  // Dynamic tiles need a tile factory (browsers use offscreen canvas).
  SGLayers._tileFactory = (size) => PImage.make(size, size);

  const decks = o.layers ? await loadDecks(PImage) : null;
  // Pass the whole collection; SGArt.render() selects layers[sys] per grid
  // system ("fusion" is a composite trait, not a deck key).
  const layers = decks || null;

  const dir = fs.mkdtempSync("/tmp/sg-frames-");
  console.log("rendering " + o.frames + " frames at " + o.size + "px …");
  const t0 = Date.now();
  for (let f = 0; f < o.frames; f++) {
    const phase = f / o.frames; // never quite reaches 1: frame(1) === frame(0)
    const img = PImage.make(o.size, o.size);
    SGArt.render(img.getContext("2d"), o.size, hash, layers, phase);
    const fp = path.join(dir, "f-" + String(f).padStart(4, "0") + ".png");
    await PImage.encodePNGToStream(img, fs.createWriteStream(fp));
    if ((f + 1) % 15 === 0) process.stdout.write("  " + (f + 1) + "/" + o.frames + "\r");
  }
  console.log("\nframes rendered in " + ((Date.now() - t0) / 1000).toFixed(1) + "s");

  console.log("encoding with ffmpeg …");
  const r = spawnSync("ffmpeg", [
    "-y", "-v", "error",
    "-framerate", String(o.fps), "-i", path.join(dir, "f-%04d.png"),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
    "-movflags", "+faststart",
    o.out,
  ], { stdio: "inherit" });
  if (r.status !== 0) { console.error("ffmpeg failed"); process.exit(1); }

  fs.rmSync(dir, { recursive: true, force: true });
  const bytes = fs.statSync(o.out).size;
  console.log("wrote " + o.out + " (" + (bytes / 1024).toFixed(0) + " KB, " +
    o.frames + " frames @ " + o.fps + "fps = " + (o.frames / o.fps).toFixed(1) + "s seamless loop)");
}

main().catch((e) => { console.error(e); process.exit(1); });
