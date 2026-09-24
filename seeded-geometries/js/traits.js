// traits.js — Method 1 coarse trait derivation, exclusion rules, and rarity.
//
// Four traits are read from fixed slices of the token hash:
//
//   byte 0 (chars 0-1)  -> grid system
//   byte 1 (chars 2-3)  -> palette
//   byte 2 (chars 4-5)  -> density
//   byte 3 (chars 6-7)  -> accent
//   byte 4 (chars 8-9)  -> first accent hue (rarity-weighted); bold pieces
//                           extend it to a set of 2-3 via the "traits:hues"
//                           domain stream below
//
// Each byte is mapped through rarity weights (weightedPick). Exclusion rules
// re-roll disallowed combinations using later slices as fresh entropy, so the
// re-roll stays deterministic per token.
(function (global) {
  "use strict";

  const SeedKit = typeof require !== "undefined" ? require("./seed.js") : global.SeedKit;

  // Grid systems may be composites: every mint renders each listed system in
  // draw order (first entry = bottom layer), so both fields combine in each
  // piece. The inverted fusion swaps the stack: the triangle field strokes
  // over the linear grid instead of under it.
  const GRIDS = [
    { key: "fusion", label: "Linear Grid \u2295 Triangle Field", weight: 70,
      systems: ["triangle", "linear"] },
    { key: "fusion-inv", label: "Triangle Field \u2295 Linear Grid", weight: 30,
      systems: ["linear", "triangle"] },
  ];

  const PALETTES = [
    { key: "ink",   label: "Ink / Bone",  weight: 100 },
  ];

  const DENSITIES = [
    { key: "sparse",   label: "Sparse",   weight: 25 },
    { key: "standard", label: "Standard", weight: 50 },
    { key: "dense",    label: "Dense",    weight: 25 },
  ];

  const ACCENTS = [
    { key: "classic",    label: "Classic",    weight: 30 },
    { key: "restrained", label: "Restrained", weight: 45 },
    { key: "bold",       label: "Bold",       weight: 25 },
  ];

  // Accent colors: the two palette colors plus Mardi Gras brights. Every
  // piece carries the same 12-dot accent ring; the accent trait only sets
  // the color treatment — classic is the monochrome ink anchor, restrained
  // carries one hue, bold carries two or three distinct hues.
  const ACCENT_HUES = [
    { key: "ink",       label: "Ink",       weight: 30 },
    { key: "magenta",   label: "Magenta",   weight: 30 },
    { key: "gold",      label: "Gold",      weight: 20 },
    { key: "turquoise", label: "Turquoise", weight: 20 },
  ];

  const TABLES = { grid: GRIDS, palette: PALETTES, density: DENSITIES, accent: ACCENTS, hue: ACCENT_HUES };

  // No exclusion rules: the pool is the single fusion composite, so no
  // combination can collide. (The old concentric×dense and shingle×bold rules
  // retired with their systems.)

  // The accent-color set: classic pieces get the monochrome ink anchor,
  // restrained pieces get one hue, bold pieces get two or three distinct
  // hues. Deterministic per hash.
  function deriveHueSet(tokenHash, accent) {
    if (accent === "classic") return ["ink"];
    const first = SeedKit.weightedPick(SeedKit.sliceByte(tokenHash, 4), ACCENT_HUES);
    if (accent === "restrained") return [first];
    const rng = SeedKit.streamFor(tokenHash, "traits:hues");
    const want = 2 + Math.floor(rng() * 2); // bold carries 2–3 distinct hues
    const set = [first];
    let pool = ACCENT_HUES.filter(function (h) { return h.key !== first; });
    while (set.length < want && pool.length) {
      const pick = SeedKit.weightedPick(Math.floor(rng() * 256), pool);
      set.push(pick);
      pool = pool.filter(function (h) { return h.key !== pick; });
    }
    return set;
  }

  function deriveTraits(tokenHash) {
    const grid = SeedKit.weightedPick(SeedKit.sliceByte(tokenHash, 0), GRIDS);
    const palette = SeedKit.weightedPick(SeedKit.sliceByte(tokenHash, 1), PALETTES);
    const density = SeedKit.weightedPick(SeedKit.sliceByte(tokenHash, 2), DENSITIES);
    const accent = SeedKit.weightedPick(SeedKit.sliceByte(tokenHash, 3), ACCENTS);
    const hues = deriveHueSet(tokenHash, accent);
    return { grid: grid, palette: palette, density: density, accent: accent, hues: hues };
  }

  function labelFor(table, key) {
    const e = table.find(function (x) { return x.key === key; });
    return e ? e.label : key;
  }

  // Marketplace-style trait metadata: [{ trait_type, value }].
  // Pure function of the hash, so traits can be verified without rendering.
  function features(tokenHash) {
    const t = deriveTraits(tokenHash);
    return [
      { trait_type: "Grid System", value: labelFor(GRIDS, t.grid) },
      { trait_type: "Palette", value: labelFor(PALETTES, t.palette) },
      { trait_type: "Density", value: labelFor(DENSITIES, t.density) },
      { trait_type: "Accent", value: labelFor(ACCENTS, t.accent) },
      { trait_type: "Accent Hues", value: t.hues.length
        ? t.hues.map(function (k) { return labelFor(ACCENT_HUES, k); }).join(" + ")
        : "None" },
    ];
  }

  // Order-insensitive comparison so hue sets compare as sets.
  function traitEq(a, b) {
    const ka = Array.isArray(a) ? a.slice().sort().join("+") : a;
    const kb = Array.isArray(b) ? b.slice().sort().join("+") : b;
    return ka === kb;
  }

  // Classic PFP rarity score: sum over traits of (population / trait count).
  // Higher = rarer.
  function scoreRarity(populationTraits, traits) {
    const n = populationTraits.length;
    let score = 0;
    ["grid", "palette", "density", "accent", "hues"].forEach(function (k) {
      const count = populationTraits.filter(function (p) { return traitEq(p[k], traits[k]); }).length;
      score += n / Math.max(1, count);
    });
    return score;
  }

  // Resolve a grid trait key to its ordered list of renderer systems
  // (bottom layer first). Solo keys resolve to themselves.
  function compositeFor(gridKey) {
    const entry = GRIDS.find(function (g) { return g.key === gridKey; });
    if (entry && Array.isArray(entry.systems) && entry.systems.length) return entry.systems.slice();
    return [gridKey];
  }

  const SGTraits = {
    GRIDS: GRIDS,
    PALETTES: PALETTES,
    DENSITIES: DENSITIES,
    ACCENTS: ACCENTS,
    ACCENT_HUES: ACCENT_HUES,
    deriveTraits: deriveTraits,
    compositeFor: compositeFor,
    features: features,
    scoreRarity: scoreRarity,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = SGTraits;
  else global.SGTraits = SGTraits;
})(typeof self !== "undefined" ? self : this);
