// test_token_page.js — end-to-end test of the GENERATED token.html.
//
// Loads token.html's scripts in a stub DOM backed by pureimage (a real raster
// canvas), drives requestAnimationFrame manually, and asserts:
//   1. ?hash= resolves to the requested token
//   2. PNG decks build from the inlined data URIs
//   3. frames render non-blank and the loop closes (t0 vs t0+8000)
//   4. the Art Blocks `tokenData` injection path works
//   5. a garbage ?hash= falls back to the demo token
//
// Node: node scripts/test_token_page.js   (needs pureimage for raster check)
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
let PImage;
try {
  PImage = require("/tmp/pitest/node_modules/pureimage");
} catch (e) {
  PImage = require(path.join(ROOT, "node_modules", "pureimage"));
}

const H13 = "4bfaf4e6d08331e5d8a46ad81a001d7afb9cb23940f3fb21cae570cdffedc226";
const H07 = require("../js/seed.js").demoMintHash(7);

let passed = 0;
function ok(name, fn) { return Promise.resolve().then(fn).then(() => { passed++; console.log("ok - " + name); }); }

// --- stub DOM ---------------------------------------------------------------
function makeHarness(opts) {
  opts = opts || {};
  let rafCb = null;
  let canvasImg = null;
  const canvasStub = {
    width: 0, height: 0,
    getContext: function () {
      const w = Math.max(1, canvasStub.width), h = Math.max(1, canvasStub.height);
      if (!canvasImg || canvasImg.width !== w || canvasImg.height !== h) {
        canvasImg = PImage.make(w, h);
      }
      const real = canvasImg.getContext("2d");
      // pureimage's drawImage needs a real Bitmap; unwrap StubImage wrappers.
      return new Proxy(real, {
        get: function (t, p) {
          if (p === "drawImage") {
            return function (img) {
              const args = [img && img._img ? img._img : img]
                .concat(Array.prototype.slice.call(arguments, 1));
              return t.drawImage.apply(t, args);
            };
          }
          const v = t[p];
          return typeof v === "function" ? v.bind(t) : v;
        },
        set: function (t, p, v) { t[p] = v; return true; },
      });
    },
    _shot: function () { return canvasImg; },
  };

  class StubImage {
    set src(v) {
      const m = /^data:image\/png;base64,(.*)$/.exec(v || "");
      if (!m) { setImmediate(() => this.onerror && this.onerror()); return; }
      const buf = Buffer.from(m[1], "base64");
      const s = require("stream");
      const rs = new s.Readable();
      rs.push(buf); rs.push(null);
      PImage.decodePNGFromStream(rs).then((img) => {
        this.width = img.width; this.height = img.height;
        this.naturalWidth = img.width;
        this.complete = true;
        this._img = img;
        setImmediate(() => this.onload && this.onload());
      }).catch(() => setImmediate(() => this.onerror && this.onerror()));
    }
  }

  const sandbox = {
    console: console,
    document: {
      getElementById: (id) => (id === "stage" ? canvasStub : null),
      // offscreen canvas for SGLayers' dynamic tile factory
      createElement: function (tag) {
        if (tag !== "canvas") throw new Error("stub: no such element " + tag);
        const tile = { width: 0, height: 0, _img: null };
        tile.getContext = function () {
          const w = Math.max(1, tile.width), h = Math.max(1, tile.height);
          if (!tile._img || tile._img.width !== w || tile._img.height !== h) {
            tile._img = PImage.make(w, h);
          }
          return tile._img.getContext("2d");
        };
        return tile;
      },
    },
    Image: StubImage,
    location: { search: opts.search || "" },
    requestAnimationFrame: (cb) => { rafCb = cb; return 1; },
    setImmediate: setImmediate,
    Promise: Promise,
    window: {
      innerWidth: 600, innerHeight: 600,
      addEventListener: function () {},
    },
  };
  if (opts.tokenData) sandbox.tokenData = opts.tokenData;
  vm.createContext(sandbox);

  const html = fs.readFileSync(path.join(ROOT, "token.html"), "utf8");
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (blocks.length !== 5) throw new Error("expected 5 script blocks, got " + blocks.length);
  for (const b of blocks) vm.runInContext(b, sandbox, { filename: "token.html" });

  return {
    // wait until the boot path has loaded its layers and registered rAF
    ready: async function () {
      for (let i = 0; i < 500 && !rafCb; i++) {
        await new Promise((r) => setImmediate(r));
      }
      if (!rafCb) throw new Error("token page never started its animation loop");
    },
    // drive frames; resolves with pixel snapshots keyed by timestamp
    frames: async function (times) {
      const out = {};
      for (const t of times) {
        const cb = rafCb; rafCb = null;
        cb(t);
        await new Promise((r) => setImmediate(r));
        // snapshot: the canvas reuses one bitmap, so copy the pixels now
        out[t] = {
          width: canvasImg.width, height: canvasImg.height,
          data: Buffer.from(canvasImg.data),
        };
      }
      return out;
    },
    rafPending: () => !!rafCb,
  };
}

function meanAbsDiff(a, b) {
  const da = a.data, db = b.data;
  let sum = 0;
  for (let i = 0; i < da.length; i += 4) {
    sum += Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
  }
  return sum / (da.length / 4);
}
function meanBrightness(img) {
  const d = img.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
  return sum / (d.length / 4);
}
function variance(img) {
  const d = img.data, m = meanBrightness(img);
  let v = 0;
  for (let i = 0; i < d.length; i += 4) {
    const b = (d[i] + d[i + 1] + d[i + 2]) / 3;
    v += (b - m) * (b - m);
  }
  return v / (d.length / 4);
}

async function main() {
  await ok("?hash= renders the requested token, non-blank, loop closes", async () => {
    const h = makeHarness({ search: "?hash=" + H13 });
    await h.ready();
    const fr = await h.frames([0, 4000, 8000]);
    if (!fr[0]) throw new Error("no frame rendered");
    if (variance(fr[0]) < 50) throw new Error("frame looks blank");
    const close = meanAbsDiff(fr[0], fr[8000]);
    if (close > 2) throw new Error("loop does not close: mean px diff " + close.toFixed(2));
    const mid = meanAbsDiff(fr[0], fr[4000]);
    if (mid < 5) throw new Error("no motion mid-loop: diff " + mid.toFixed(2));
    console.log("    loop-close diff " + close.toFixed(3) + "/255, mid-loop diff " + mid.toFixed(1) + "/255");
  });

  await ok("Art Blocks tokenData.hash injection path renders a different token", async () => {
    const h = makeHarness({ tokenData: { hash: "0x" + H07, tokenId: "7" } });
    await h.ready();
    const fr = await h.frames([0]);
    const h13 = makeHarness({ search: "?hash=" + H13 });
    await h13.ready();
    const fr13 = await h13.frames([0]);
    const d = meanAbsDiff(fr[0], fr13[0]);
    if (d < 5) throw new Error("tokenData hash did not change the piece (diff " + d.toFixed(2) + ")");
  });

  await ok("garbage ?hash= falls back to the demo token", async () => {
    const h = makeHarness({ search: "?hash=zzz" });
    await h.ready();
    const fr = await h.frames([0]);
    const h13 = makeHarness({ search: "?hash=" + H13 });
    await h13.ready();
    const fr13 = await h13.frames([0]);
    const d = meanAbsDiff(fr[0], fr13[0]);
    if (d > 2) throw new Error("fallback did not render the demo token (diff " + d.toFixed(2) + ")");
  });

  console.log("\n" + passed + " token-page tests passed.");
}

main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
