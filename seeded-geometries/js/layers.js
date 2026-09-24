// layers.js — PNG + dynamic layer decks composited beneath the procedural systems.
//
// Each grid system owns a deck of layers. Two kinds:
//
//   file layers    — static PNGs from assets/layers/<system>/; loaded once.
//   dynamic layers — procedural tiles generated at render time by a function
//                    in DYNAMIC (e.g. "undulate"); no asset files needed.
//
// The assets are static; everything about how they land on the piece (which
// instances, position, rotation, scale, opacity, blend) is drawn from the
// Method 3 seeded streams, so the composition stays fully deterministic per
// hash. Dynamic tiles get their own domain-separated stream
// ("layer:<name>:<index>"), so generating a tile never shifts the base
// detail streams.
//
// To use your own artwork: drop PNGs into assets/layers/<system>/ (transparent
// background works best), add an entry to LAYER_DECKS below, and push. No
// other code changes needed.
//
// Determinism note: a deck is loaded once, then render() consumes the seeded
// streams in fixed order (layers first, systems second). A missing PNG is
// skipped with a console warning; the gallery still renders.
(function (global) {
  "use strict";

  const SeedKit = typeof require !== "undefined" ? require("./seed.js") : global.SeedKit;

  function lerp(range, t) { return range[0] + t * (range[1] - range[0]); }

  // Dynamic (procedural) layer generators. Unlike file decks, these draw
  // their tile at render time on an offscreen canvas. The tile's internal
  // structure comes from its own domain-separated stream ("layer:<name>:<n>"),
  // so generating a tile never shifts the base detail streams.
  //
  //   tctx   — 2d context of a square tile canvas
  //   size   — tile size in px (256)
  //   rs     — () => [0,1) seeded stream for this tile
  //   P      — active palette ({ ink, ... })
  //   params — ranges from the deck entry
  const DYNAMIC = {
    // Undulating flow field: horizontal contour lines displaced by a sum of
    // seeded sine waves — refined structures that undulate in complexity.
    // Uniformity via π: wave phases are multiples of π/4, all offset by the
    // token's shared π-phase, and the cycle count across the tile is a
    // multiple of π (cycles = π·w/2 for the seeded w in params.waves).
    undulate: function (tctx, size, rs, P, params) {
      params = params || {};
      const TAU = Math.PI * 2;
      const phase = params.phase || 0;
      const lines = Math.floor(lerp(params.lines || [36, 70], rs()));
      const nWaves = 2 + Math.floor(rs() * 2); // 2-3 sine components
      const piPhase = params.piPhase || 0;
      // Loop-phase drift: 0 at phase 0 and phase 1, so the tile (and the
      // whole piece) closes seamlessly. Pinned exactly at the endpoints:
      // sin(TAU) is ~1e-16, not 0, in floats.
      const driftArg = (phase === 0 || phase === 1) ? 0 : Math.sin(TAU * phase);
      const drift = (params.drift == null ? 0.7 : params.drift) * driftArg;
      const waves = [];
      for (let k = 0; k < nWaves; k++) {
        waves.push({
          amp: lerp(params.amp || [0.03, 0.08], rs()) * size, // as fraction of tile
          len: size / (Math.PI * lerp(params.waves || [1, 2.5], rs()) / 2),
          ph: piPhase + Math.floor(rs() * 8) * Math.PI / 4 + drift,
        });
      }
      tctx.strokeStyle = P.ink;
      tctx.lineWidth = Math.max(0.5, size / 640);
      tctx.lineCap = "round";
      for (let i = 0; i < lines; i++) {
        const baseY = ((i + 0.5) / lines) * size;
        tctx.globalAlpha = 0.22 + rs() * 0.4;
        tctx.beginPath();
        for (let x = -8; x <= size + 8; x += 4) {
          let y = baseY;
          for (const w of waves) y += Math.sin((x / w.len) * Math.PI * 2 + w.ph) * w.amp;
          if (x === -8) tctx.moveTo(x, y);
          else tctx.lineTo(x, y);
        }
        tctx.stroke();
      }
      tctx.globalAlpha = 1;
    },
  };

  // Tile factory for dynamic layers; override in Node tests via
  // SGLayers._tileFactory (browsers use an offscreen canvas).
  function defaultTileFactory(size) {
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    return c;
  }

  // Deck registry, keyed by grid-system key from traits.js.
  //
  //   file    — path to the PNG, relative to the repo root (file layers)
  //   dynamic — name of a DYNAMIC generator; tile drawn at render time (dynamic layers)
  //   params  — generator-specific ranges, e.g. { lines, amp, waves } for "undulate"
  //   blend   — canvas globalCompositeOperation ("source-over", "multiply", ...)
  //   alpha  — [min, max] opacity range; the seeded tone stream picks within it
  //   scale  — [min, max] layer size as a fraction of the piece size
  //   count  — [min, max] instances of this layer per piece
  //   rotate — max rotation in radians (0 = axis-aligned)
  const LAYER_DECKS = {
    linear: [
      { file: "assets/layers/linear/layer-01-hatch.png", blend: "multiply",    alpha: [0.10, 0.22], scale: [0.9, 1.5], count: [2, 4], rotate: 0 },
      { file: "assets/layers/linear/layer-02-dots.png",  blend: "source-over", alpha: [0.08, 0.18], scale: [0.5, 1.0], count: [1, 3], rotate: 0 },
      { dynamic: "undulate", blend: "multiply", alpha: [0.07, 0.15], scale: [0.9, 1.4], count: [1, 2], rotate: 0.5,
        params: { lines: [36, 70], amp: [0.03, 0.08], waves: [2, 5] } },
    ],
    triangle: [
      { file: "assets/layers/triangle/layer-01-arcs.png",       blend: "multiply",    alpha: [0.10, 0.20], scale: [0.9, 1.5], count: [2, 4], rotate: 0 },
      { file: "assets/layers/triangle/layer-02-crosshatch.png", blend: "source-over", alpha: [0.06, 0.14], scale: [0.6, 1.1], count: [1, 2], rotate: 0 },
      { dynamic: "undulate", blend: "multiply", alpha: [0.06, 0.14], scale: [0.9, 1.4], count: [1, 2], rotate: 0.5,
        params: { lines: [44, 80], amp: [0.02, 0.06], waves: [3, 6] } },
    ],
  };

  // Load every deck. Returns a Promise of { systemKey: [{ img, cfg }, ...] }.
  // Dynamic entries need no loading — their tiles are generated at render.
  // makeImage is injectable for tests; in the browser it defaults to Image.
  function loadLayers(decks, makeImage) {
    decks = decks || LAYER_DECKS;
    const make = makeImage || function () { return new Image(); };
    const keys = Object.keys(decks);
    const out = {};
    const jobs = [];
    keys.forEach(function (key) {
      out[key] = [];
      decks[key].forEach(function (cfg) {
        if (cfg.dynamic) {
          if (typeof DYNAMIC[cfg.dynamic] !== "function" && typeof console !== "undefined")
            console.warn("[layers] unknown dynamic layer: " + cfg.dynamic);
          out[key].push({ img: null, cfg: cfg });
          return;
        }
        jobs.push(new Promise(function (resolve) {
          const img = make();
          img.onload = function () { out[key].push({ img: img, cfg: cfg }); resolve(); };
          img.onerror = function () {
            if (typeof console !== "undefined") console.warn("[layers] missing: " + cfg.file);
            resolve(); // skip missing layers, keep the gallery alive
          };
          img.src = cfg.file;
        }));
      });
    });
    return Promise.all(jobs).then(function () { return out; });
  }

  // Composite a loaded deck under the procedural linework. All layout values
  // come from the seeded streams: same hash + same assets => same composition.
  // R: { sStruct, sTone, sAccent } stream functions from SeedKit.streamFor.
  // tokenHash + P feed dynamic tile generation (own sub-stream, palette ink).
  // ns: optional namespace for dynamic tile streams, so two decks composited
  // into one piece never generate identical tiles ("", the default, keeps the
  // legacy stream labels).
  // Simulation: consumes all layer streams, generates dynamic tiles, and
  // returns placements {img, dw, dh, x, y, rot, a, blend}. W and H are the
  // canvas size (square: S×S; tile: W×H). Placements are in the same space
  // (the tile path scales by min(W,H)/256 and bleeds over W/H).
  function planLayers(W, H, deck, R, tokenHash, P, phase, ns) {
    if (!deck || !deck.length) return [];
    phase = phase || 0;
    // Uniform π-phase: one harmonic angle per token, shared by every layer
    // in the piece. All rotations are quantized to eighths of π around it,
    // so the layers sit on a common harmonic lattice instead of drifting on
    // independent random angles.
    const PI_STEP = Math.PI / 8;
    const piPhase = Math.floor(R.sStruct() * 8) * (Math.PI / 4);
    const makeTile = SGLayers._tileFactory || defaultTileFactory;
    const SU = Math.min(W, H);
    const out = [];
    deck.forEach(function (entry, di) {
      const cfg = entry.cfg;
      let img = entry.img;
      if (cfg.dynamic) {
        const gen = DYNAMIC[cfg.dynamic];
        if (typeof gen !== "function") return; // warned at load time
        const tile = makeTile(256);
        const rs = SeedKit.streamFor(tokenHash, "layer:" + (ns ? ns + ":" : "") + cfg.dynamic + ":" + di);
        const genParams = Object.assign({}, cfg.params, { piPhase: piPhase, phase: phase });
        gen(tile.getContext("2d"), 256, rs, P || { ink: "#201c16" }, genParams);
        img = tile;
      }
      if (!img) return;
      const n = cfg.count[0] + Math.floor(R.sStruct() * (cfg.count[1] - cfg.count[0] + 1));
      for (let i = 0; i < n; i++) {
        const sc = (cfg.scale[0] + R.sStruct() * (cfg.scale[1] - cfg.scale[0])) * (SU / 256);
        const dw = img.width * sc, dh = img.height * sc;
        // allow bleed past the edges so layers never sit in a neat inset box
        const x = R.sStruct() * (W + dw) - dw / 2;
        const y = R.sStruct() * (H + dh) - dh / 2;
        // Harmonic rotation: jitter around the shared π-phase, snapped to π/8.
        const rawRot = (R.sStruct() - 0.5) * 2 * (cfg.rotate || 0);
        const rot = Math.round((piPhase + rawRot) / PI_STEP) * PI_STEP;
        const a = cfg.alpha[0] + R.sTone() * (cfg.alpha[1] - cfg.alpha[0]);
        out.push({ img: img, dw: dw, dh: dh, x: x, y: y, rot: rot, a: a,
                   blend: cfg.blend || "source-over" });
      }
    });
    return out;
  }

  // Raster: draws placements. wrap ({W,H}) draws each placement at the
  // toroidal 9 shifts (culling the invisible ones) for the textile tile.
  function drawPlacements(ctx, placements, wrap) {
    placements.forEach(function (pl) {
      function drawAt(ox, oy) {
        ctx.save();
        ctx.globalCompositeOperation = pl.blend;
        ctx.globalAlpha = pl.a;
        ctx.translate(pl.x + pl.dw / 2 + ox, pl.y + pl.dh / 2 + oy);
        ctx.rotate(pl.rot);
        ctx.drawImage(pl.img, -pl.dw / 2, -pl.dh / 2, pl.dw, pl.dh);
        ctx.restore();
      }
      if (!wrap) { drawAt(0, 0); return; }
      // Cull: the placement's bounding circle must intersect the tile.
      const cx = pl.x + pl.dw / 2, cy = pl.y + pl.dh / 2;
      const rr = Math.hypot(pl.dw, pl.dh) / 2;
      for (let sj = -1; sj <= 1; sj++) for (let si = -1; si <= 1; si++) {
        const x = cx + si * wrap.W, y = cy + sj * wrap.H;
        if (x < -rr || x > wrap.W + rr || y < -rr || y > wrap.H + rr) continue;
        drawAt(si * wrap.W, sj * wrap.H);
      }
    });
  }

  function composeLayers(ctx, S, deck, R, tokenHash, P, phase, ns) {
    drawPlacements(ctx, planLayers(S, S, deck, R, tokenHash, P, phase, ns), null);
  }

  const SGLayers = {
    LAYER_DECKS: LAYER_DECKS,
    DYNAMIC: DYNAMIC,
    PI_STEP: Math.PI / 8, // harmonic lattice every layer rotation snaps to
    _tileFactory: null, // override in Node tests; browsers use offscreen canvas
    loadLayers: loadLayers,
    composeLayers: composeLayers,
    planLayers: planLayers,
    drawPlacements: drawPlacements,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = SGLayers;
  else global.SGLayers = SGLayers;
})(typeof self !== "undefined" ? self : this);
