// export_tile.js — renders a seamless 4096×2160 textile tile PNG.
// Usage: node scripts/export_tile.js [hash] [output.png] [width] [height]
// Defaults: token 13 demo hash, media/token-13-tile-4k.png, 4096×2160.
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
let pureimage;
try {
  pureimage = require("/tmp/pitest/node_modules/pureimage");
} catch (e) {
  pureimage = require(path.join(ROOT, "node_modules", "pureimage"));
}
global.self = global;
global.SeedKit = require("../js/seed.js");
global.SGTraits = require("../js/traits.js");
global.SGLayers = require("../js/layers.js");
const SGArt = require("../js/artwork.js");

const hash = process.argv[2] || SeedKit.demoMintHash(13);
const outPath = process.argv[3] || path.join(__dirname, "../media/token-13-tile-4k.png");
const W = parseInt(process.argv[4] || "4096", 10);
const H = parseInt(process.argv[5] || "2160", 10);

console.log("rendering tile " + W + "x" + H + " for hash " + hash.slice(0, 16) + "...");
const t0 = Date.now();
const img = pureimage.make(W, H);
// layers=null: no texture decks in Node (they need browser Image loading);
// the tile is the pure procedural tessellation.
SGArt.renderTile(img.getContext("2d"), hash, null, { W: W, H: H, phase: 0 });
console.log("render done in " + ((Date.now() - t0) / 1000).toFixed(1) + "s");
const t1 = Date.now();
pureimage.encodePNGToStream(img, fs.createWriteStream(outPath)).then(() => {
  const kb = Math.round(fs.statSync(outPath).size / 1024);
  console.log("saved " + outPath + " (" + kb + " KB) in " + ((Date.now() - t1) / 1000).toFixed(1) + "s");
});
