"use strict";
const PImage = require("/home/hatch/workspace/seeded-geometries/node_modules/pureimage");
const fs = require("fs");
const SeedKit = require("./js/seed.js");
const SGArt = require("./js/artwork.js");
const SGLayers = require("./js/layers.js");
const demo = JSON.parse(fs.readFileSync("./data/demo_hashes.json","utf8"));
const t = demo.tokens.find(t => t.name === "token 13") || demo.tokens[12];
const S = 1080;
const img = PImage.make(S, S);
const ctx = img.getContext("2d");
const P = SGArt;
const p = P.buildScene({ tokenHash: t.hash, layers: SGLayers.layers, W: S, H: S, S: S, time: 0 });
P.render(ctx, p, 0);
PImage.encodePNGToStream(img, fs.createWriteStream("/tmp/qa13_full.png")).then(()=>{
  // center crop 320px to see the dots closely
  const crop = PImage.make(420,420);
  const cctx = crop.getContext("2d");
  cctx.drawImage(img, S/2-210, S/2-210, 420, 420, 0, 0, 420, 420);
  return PImage.encodePNGToStream(crop, fs.createWriteStream("/tmp/qa13_crop.png"));
}).then(()=>console.log("done"));
