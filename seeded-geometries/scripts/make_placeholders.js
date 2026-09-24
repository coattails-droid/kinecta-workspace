// make_placeholders.js — generate placeholder PNG texture layers (stdlib only).
//
// Writes 8 transparent 256x256 PNGs into assets/layers/<system>/, one deck of
// two per grid system. These are stand-ins: replace them with real artwork and
// the loader/compositor needs no changes. Hand-rolled PNG writer (8-bit RGBA,
// filter 0, zlib via stdlib) so there are no dependencies.
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const W = 256, H = 256;
const INK = [32, 28, 22]; // dark mark color; alpha set per mark

// --- minimal raster ---------------------------------------------------------
function newCanvas() { return Buffer.alloc(W * H * 4, 0); } // transparent
function px(buf, x, y, a) {
  x |= 0; y |= 0;
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  buf[i] = INK[0]; buf[i + 1] = INK[1]; buf[i + 2] = INK[2];
  buf[i + 3] = Math.max(buf[i + 3], a); // paint over, keep strongest
}
function dot(buf, cx, cy, r, a) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) px(buf, x, y, a);
}
function line(buf, x0, y0, x1, y1, w, a) {
  const dx = x1 - x0, dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
  for (let s = 0; s <= steps; s++)
    dot(buf, x0 + (dx * s) / steps, y0 + (dy * s) / steps, w / 2, a);
}
function circleOutline(buf, cx, cy, r, w, a, a0, a1) {
  a0 = a0 === undefined ? 0 : a0; a1 = a1 === undefined ? Math.PI * 2 : a1;
  const steps = Math.max(24, Math.floor(r * 2));
  for (let s = 0; s <= steps; s++) {
    const t = a0 + ((a1 - a0) * s) / steps;
    dot(buf, cx + Math.cos(t) * r, cy + Math.sin(t) * r, w / 2, a);
  }
}
// fixed-seed LCG so the grain layer is itself deterministic
function lcg(seed) {
  let s = seed >>> 0;
  return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

// --- the eight placeholder patterns ------------------------------------------
const patterns = {
  hatch(buf)      { for (let d = -H; d < W; d += 18) line(buf, d, 0, d + H, H, 2, 150); },
  dots(buf)       { for (let y = 16; y < H; y += 32) for (let x = 16; x < W; x += 32) dot(buf, x, y, 4, 170); },
  arcs(buf)       { for (let y = 0; y <= H; y += 64) for (let x = 0; x <= W; x += 64) circleOutline(buf, x, y, 26, 2, 150, 0, Math.PI / 2); },
  crosshatch(buf) { for (let d = -H; d < W; d += 26) { line(buf, d, 0, d + H, H, 1, 130); line(buf, d + H, 0, d, H, 1, 130); } },
  scales(buf)     { for (let r = 0; r < 8; r++) for (let c = 0; c < 9; c++) circleOutline(buf, c * 32 + (r % 2) * 16, r * 32, 17, 2, 150, Math.PI, 0); },
  grain(buf)      { const R = lcg(12345); for (let i = 0; i < 420; i++) { const x = R() * W, y = R() * H, t = R() * Math.PI; line(buf, x, y, x + Math.cos(t) * 9, y + Math.sin(t) * 9, 1, 110); } },
  rings(buf)      { for (let y = 32; y < H; y += 64) for (let x = 32; x < W; x += 64) for (let k = 1; k <= 3; k++) circleOutline(buf, x, y, k * 8, 1.5, 140); },
  ticks(buf)      { for (let y = 32; y < H; y += 64) for (let x = 32; x < W; x += 64) for (let k = 0; k < 12; k++) { const t = (k / 12) * Math.PI * 2; line(buf, x + Math.cos(t) * 10, y + Math.sin(t) * 10, x + Math.cos(t) * 22, y + Math.sin(t) * 22, 2, 150); } },
};

const decks = {
  linear:     ["hatch", "dots"],
  triangle:   ["arcs", "crosshatch"],
};

// --- PNG encoding -------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function writePNG(file, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0; // filter type 0
    rgba.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
  }
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, png);
}

// --- run -----------------------------------------------------------------------
const root = path.join(__dirname, "..", "assets", "layers");
let n = 0;
for (const [system, names] of Object.entries(decks)) {
  names.forEach((name, i) => {
    const buf = newCanvas();
    patterns[name](buf);
    const file = path.join(root, system, `layer-0${i + 1}-${name}.png`);
    writePNG(file, buf);
    n++;
    console.log("wrote", path.relative(path.join(__dirname, ".."), file));
  });
}
console.log(`${n} placeholder layers written.`);
