// seed.js — hash-driven randomness architecture.
//
// Blends two methods for structuring seed generation:
//
//   Method 1 (segmentation): fixed slices of the 64-char token hash choose
//     coarse traits (grid system, palette, density, accent). Transparent and
//     legible: each trait maps to a fixed slice of the hash.
//
//   Method 3 (domain-separated sub-seeds): the full token hash plus a label
//     ("structure", "tone", "accent-detail") is mixed through cyrb53 to seed
//     an independent sfc32 stream per detail domain. Inexhaustible and
//     iteration-safe: tweaking one domain never shifts another.
//
// The entropy always comes from the token hash. The mixer (cyrb53) is
// deliberately non-cryptographic: it only separates domains, so it just needs
// to be deterministic and well-distributed, not one-way.
//
// Works in browsers (window.SeedKit) and Node (module.exports).
(function (global) {
  "use strict";

  // cyrb53: tiny non-cryptographic string hash -> 53-bit integer.
  function cyrb53(str, seed) {
    let h1 = 0xdeadbeef ^ (seed || 0);
    let h2 = 0x41c6ce57 ^ (seed || 0);
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }

  // sfc32: small, fast, seedable PRNG. Returns a function yielding [0, 1).
  // The Art Blocks ecosystem's standard choice for hash-seeded rendering.
  function sfc32(a, b, c, d) {
    return function () {
      a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
      let t = ((a + b) | 0) + d | 0;
      d = (d + 1) | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = (c << 21) | (c >>> 11);
      c = (c + t) | 0;
      return (t >>> 0) / 4294967296;
    };
  }

  function intToSeeds(n) {
    const x = Math.floor(n);
    return [
      x & 0xffffffff,
      Math.floor(x / 4294967296) & 0xffffffff,
      (x * 7) & 0xffffffff,
      (x * 13 + 101) & 0xffffffff,
    ].map(function (v) { return v >>> 0; });
  }

  function streamFromInt(n) {
    const s = intToSeeds(n);
    return sfc32(s[0], s[1], s[2], s[3]);
  }

  // Method 3: domain-separated sub-seed from the FULL token hash + label.
  // Always seed from the full hash (never a slice alone), so two tokens that
  // share a coarse trait still render different micro-detail.
  function subSeed(tokenHash, label) {
    return cyrb53(tokenHash + "::" + label);
  }

  function streamFor(tokenHash, label) {
    return streamFromInt(subSeed(tokenHash, label));
  }

  // Method 1: fixed-slice reads.
  function sliceInt(tokenHash, startChar, charLen) {
    return parseInt(tokenHash.slice(startChar, startChar + charLen), 16);
  }

  function sliceByte(tokenHash, byteIndex) {
    return sliceInt(tokenHash, byteIndex * 2, 2);
  }

  // Rarity-weighted pick: map a byte (0-255) onto entries whose weights sum to 100.
  function weightedPick(byteVal, entries) {
    const roll = (byteVal / 256) * 100;
    let acc = 0;
    for (const e of entries) {
      acc += e.weight;
      if (roll < acc) return e.key;
    }
    return entries[entries.length - 1].key;
  }

  // Deterministic demo mint hashes. NOT blockhash-derived: reproducible
  // stand-ins so the prototype renders identically everywhere. A production
  // deployment would feed the chain-derived token hash in here instead.
  //
  // Bytes are extracted arithmetically (not from hex-string prefixes) so every
  // byte is full-range uniform — slicing hex text would bias the top byte,
  // since a 53-bit value's leading hex digit only carries 5 bits.
  function demoMintHash(i) {
    const bytes = [];
    let n = 0;
    while (bytes.length < 32) {
      let x = cyrb53("seeded-geometries::mint::" + i + ":" + n++);
      for (let b = 0; b < 6 && bytes.length < 32; b++) {
        bytes.push(x % 256);
        x = Math.floor(x / 256);
      }
    }
    return bytes
      .map(function (byte) { return byte.toString(16).padStart(2, "0"); })
      .join("");
  }

  const SeedKit = {
    cyrb53: cyrb53,
    sfc32: sfc32,
    streamFromInt: streamFromInt,
    subSeed: subSeed,
    streamFor: streamFor,
    sliceInt: sliceInt,
    sliceByte: sliceByte,
    weightedPick: weightedPick,
    demoMintHash: demoMintHash,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = SeedKit;
  else global.SeedKit = SeedKit;
})(typeof self !== "undefined" ? self : this);
