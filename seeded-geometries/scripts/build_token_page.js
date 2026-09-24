// build_token_page.js — generate the single-file Art Blocks-style token page.
//
// Inlines js/seed.js, js/traits.js, js/layers.js, js/artwork.js byte-for-byte
// (single source of truth: the tested sources) plus the PNG layer decks as
// base64 data URIs, into scripts/token.template.html -> token.html.
//
// The result is 100% self-contained: no network, no external assets. It reads
// the Art Blocks-injected `tokenData.hash`, falls back to `?hash=`, and plays
// the piece's seamless animation loop fullscreen.
//
// Node: node scripts/build_token_page.js
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SGLayers = require("../js/layers.js");

function read(p) { return fs.readFileSync(path.join(ROOT, p), "utf8"); }

// Strip only the cfg fields the renderer needs; drop the file path (the PNG
// bytes travel as a data URI instead).
function cleanCfg(cfg) {
  const o = {};
  for (const k of ["blend", "alpha", "scale", "count", "rotate", "params", "dynamic"]) {
    if (cfg[k] !== undefined) o[k] = cfg[k];
  }
  return o;
}

function buildTokenLayers() {
  const out = {};
  for (const key of Object.keys(SGLayers.LAYER_DECKS)) {
    out[key] = SGLayers.LAYER_DECKS[key].map(function (cfg) {
      if (cfg.dynamic) return { dynamic: cfg.dynamic, cfg: cleanCfg(cfg) };
      const bytes = fs.readFileSync(path.join(ROOT, cfg.file));
      return {
        data: "data:image/png;base64," + bytes.toString("base64"),
        cfg: cleanCfg(cfg),
      };
    });
  }
  return out;
}

function main() {
  let html = read("scripts/token.template.html");
  const layersJs = "var TOKEN_LAYERS = " + JSON.stringify(buildTokenLayers()) + ";";
  const subs = {
    "/*__SEED_JS__*/": () => read("js/seed.js"),
    "/*__TRAITS_JS__*/": () => read("js/traits.js"),
    "/*__LAYERS_JS__*/": () => read("js/layers.js"),
    "/*__ARTWORK_JS__*/": () => read("js/artwork.js"),
    "/*__TOKEN_LAYERS__*/": () => layersJs,
  };
  for (const [marker, get] of Object.entries(subs)) {
    if (!html.includes(marker)) { console.error("marker missing: " + marker); process.exit(1); }
    html = html.split(marker).join(get());
  }
  if (/<\/script/i.test(read("js/seed.js") + read("js/traits.js") + read("js/layers.js") + read("js/artwork.js"))) {
    console.error("inlined JS contains </script — refusing to emit a broken page");
    process.exit(1);
  }
  const outPath = path.join(ROOT, "token.html");
  fs.writeFileSync(outPath, html);
  const kb = (fs.statSync(outPath).size / 1024).toFixed(0);
  console.log("wrote token.html (" + kb + " KB, self-contained)");
}

main();
