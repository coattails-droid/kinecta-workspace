// scripts/generate_collection.js — simulate a mint run and report trait
// frequencies + rarity scores. Run: node scripts/generate_collection.js [count]
//
// Uses the same deterministic demo hashes as the gallery, so the numbers here
// match what index.html shows. Writes collection/traits.json.
const fs = require("fs");
const path = require("path");
const SeedKit = require("../js/seed.js");
const Traits = require("../js/traits.js");

const COUNT = parseInt(process.argv[2] || "24", 10);
const outDir = path.join(__dirname, "..", "collection");

const mints = [];
for (let i = 0; i < COUNT; i++) {
  const hash = SeedKit.demoMintHash(i);
  const traits = Traits.deriveTraits(hash);
  mints.push({ tokenId: i, hash: hash, traits: traits, features: Traits.features(hash) });
}

// Exclusion-rule audit: no exclusion rules are in force (single-composite pool),
// so this is trivially clean. Kept as a seam in case rules return.
const violations = [];

const population = mints.map((m) => m.traits);
mints.forEach((m) => { m.rarity = Traits.scoreRarity(population, m.traits); });
mints.sort((a, b) => b.rarity - a.rarity);

function freq(key) {
  const f = {};
  mints.forEach((m) => { f[m.traits[key]] = (f[m.traits[key]] || 0) + 1; });
  return f;
}

console.log(`\nSeeded Geometries — simulated collection of ${COUNT}\n`);
console.log("Trait frequencies:");
for (const k of ["grid", "palette", "density", "accent", "hue"]) {
  console.log(`  ${k}:`);
  for (const [v, c] of Object.entries(freq(k))) {
    console.log(`    ${v.padEnd(12)} ${c} (${((c / COUNT) * 100).toFixed(1)}%)`);
  }
}
console.log(`\nExclusion-rule violations: ${violations.length}` +
  (violations.length ? "  <-- PROBLEM" : " (clean)"));
console.log("\nTop 8 by rarity:");
mints.slice(0, 8).forEach((m) => {
  const t = m.traits;
  console.log(`  #${m.tokenId}  ${m.rarity.toFixed(2)}  ${t.grid} / ${t.palette} / ${t.density} / ${t.accent} / ${t.hues.join("+")}`);
});

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "traits.json"), JSON.stringify(mints, null, 2));
console.log(`\nWrote collection/traits.json`);
