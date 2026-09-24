# Generative NFT Architecture: Seed/Hash → Traits → Render

**Audience:** coattails-droid / kinecta-workspace research  
**Focus:** Art Blocks–style and related systems (Art Blocks, Chromie Squiggle, Autoglyphs, Fxhash)  
**Date:** 2026-09-24 (America/New_York)  
**Purpose:** Concrete mechanisms for on-chain/off-chain contracts, trait exposure, and hash-driven display — with notes for Seeded Geometries (hash slices + domain-separated sub-seeds).

---

## 1. Overview of generative NFT architecture

Long-form generative NFTs invert the usual “upload a PNG” model: the **artwork is an algorithm**. A collector’s mint produces (or binds) a unique seed; a deterministic script consumes that seed and always re-renders the same piece.

### Canonical pipeline

```
Artist publishes project script (+ optional library deps)
        │
        ▼
Mint (ERC-721 / GENTK) assigns tokenId + irreversible seed/hash
        │
        ▼
Renderer injects seed into script (tokenData.hash / $fx.hash / Solidity draw)
        │
        ├──► PRNG / hash-byte reads  →  structural decisions
        ├──► features() / $features  →  marketplace traits + rarity
        └──► canvas / SVG / ASCII    →  visual output (+ optional preview capture)
```

### Platform variants (same idea, different storage)

| System | Where the “generator” lives | Where the seed lives | Render path |
| --- | --- | --- | --- |
| **Art Blocks** | Project JS script on core contract (BytecodeStorage segments); libs via Dependency Registry (some fully on-chain) | Per-token hash on core; injected as `tokenData.hash` | Off-chain generator service **or** on-chain Generator (`getTokenHtml`) assembling HTML via scripty.sol |
| **Chromie Squiggle** | Art Blocks Project #0 script on early core (`0x059edd72…`) | On-chain token hash | Same Art Blocks generator; community docs also describe hex-pair reads from the seed string |
| **Autoglyphs** | Solidity `draw()` inside ERC-721 | Per-token seed (`idToSeed`) + symbol scheme | On-chain string (ASCII); off-chain SVG/plotter from instructions |
| **Fxhash** | Project files on IPFS or ONCHFS; Generative Token NFT points at them | Iteration seed derived from mint tx (via Randomizer); passed as URL/`$fx.hash` | Browser runs project; preview image pinned to IPFS at “signing” |

**Shared invariants**

1. **Determinism:** same seed ⇒ same sequence of PRNG draws ⇒ same art (and same traits).  
2. **No `Math.random()` / `Date.now()`** for identity-defining decisions.  
3. **The mint transaction is the curator** — the artist ships a distribution; the chain picks a point in that space.

---

## 2. How traits / attributes are defined and exposed

Traits are **not** usually stored as a full attribute map in the ERC-721 at mint. They are **derived** from the same seed the renderer uses, then indexed by platform tooling / marketplaces.

### Art Blocks — `window.$features` (current)

In the art script, assign a plain object synchronously:

```javascript
window.$features = {
  Palette: palette,
  Density: density,
  Animated: animated,
};
```

Rules from Art Blocks docs:

- Values must be deterministic given `tokenData.hash` (and any PostParams).  
- Numeric traits should use consistent decimal precision.  
- Art Blocks reads `$features` to index traits for the token.

**Legacy:** `calculateFeatures(tokenData)` returned an object; server-side infra called it with a **fresh PRNG re-seeded from the same hash and the same call order** so traits matched the visual script. New projects should migrate to `$features`.

### Fxhash — `$fx.features(object)`

```javascript
$fx.features({
  Intensity: getFeatureString($fx.rand()), // "low" | "medium" | "high"
  Palette: ...,
});
```

- Call **once** after page load (not inside a delayed timeout).  
- Values: `string` | `number` | `boolean`.  
- Platform rarity = frequency of exact equality across the collection — so avoid continuous floats as trait values; bucket them into labels.  
- Helpers: `$fx.getFeature(name)`, `$fx.getFeatures()`.

### Chromie Squiggle (Art Blocks #0)

Official / community metadata surfaces discrete traits such as **Type** (Normal, Slinky, Fuzzy, Ribbed, Bold, Pipe + Hyper variants), **Spectrum**, **Steps**, **Segments**, **Color Spread**, start/end hues. Community-discovered traits (Perfect/Full Spectrum, Day Zero, Harmonics, etc.) show that **indexed traits are a curated projection** of a richer algorithmic space — many “hidden” parameters never become marketplace traits.

### Subscapes (mattdesl on Art Blocks)

Example of intentional trait design: ~11 OpenSea/Art Blocks traits (Style, Palette, Brushed, Landscape variants, Patchwork, …) vs dozens of unindexed “hidden” parameters. Lesson: expose traits that collectors can reason about; keep micro-variation off the trait sheet.

### On-chain vs off-chain trait storage

| Approach | Mechanism | Pros / cons |
| --- | --- | --- |
| **Derive at read time** (Art Blocks / Fxhash default) | Script computes traits from hash; indexer caches | Single source of truth with art; indexer can drift if feature API changes |
| **Enumerate in metadata JSON** | `attributes: [{trait_type, value}]` on IPFS/HTTP `tokenURI` | Marketplace-native; must stay in sync with live script |
| **On-chain generative output** (Autoglyphs) | Art string emitted/generated in contract | Maximum permanence; limited visual richness / gas |
| **Post-mint params** (Art Blocks PostParams) | Owner/artist set on-chain knobs after mint | Evolving works; traits must include param state for identity |

**Rarity:** platforms count frequencies over the minted population. Artists weight PRNG branches (or hash-byte thresholds) to shape supply; rarity is emergent, not usually written into the contract as a score.

---

## 3. How the token hash / seed is derived and consumed

### Art Blocks V3 — mint → randomizer → stored seed → display hash

From `GenArt721CoreV3.sol` (Art Blocks contracts):

1. Minter calls `mint_Ecf(to, projectId, by)`.  
2. `tokenId = projectId * 1_000_000 + invocationsBefore`.  
3. `_mint`, then `randomizerContract.assignTokenHash(tokenId)`.  
4. Randomizer calls `setTokenHash_8PT(tokenId, hashSeed)` — stores **`bytes12` hash seed** (non-zero, once).  
5. Public hash for artists/scripts:

```solidity
function tokenIdToHash(uint256 _tokenId) external view returns (bytes32) {
    bytes12 _hashSeed = _ownersAndHashSeeds[_tokenId].hashSeed;
    if (_hashSeed == 0) return 0;
    return keccak256(abi.encode(_hashSeed));
}
```

So: **entropy is a 12-byte seed; the 32-byte `tokenData.hash` is `keccak256(abi.encode(seed))`.** Docs also expose `showTokenHashes` / `tokenIdToHashSeed` for integrators. Older cores (Squiggle’s V0) used an earlier hash-assignment path but the artist-facing idea is the same: a fixed hex hash per token.

**Injection into the script** (Generator HTML):

```javascript
let tokenData = {
  hash: "0x" + /* 64 hex chars */,
  tokenId: "42000001" // projectId * 1e6 + invocation
};
```

**Consumption pattern (Art Blocks recommended PRNG):** split hash hex into four 32-bit words → seed a small counter PRNG (sfc32-class), then `random_dec` / `random_choice` / etc. Never use `Math.random()`.

### Chromie Squiggle — hex pairs as direct parameters

Community documentation (chromie-squiggles.com) describes reading the seed as hex: each character 0–15, each pair 0–255, driving y-coordinates, start color, gradient rate, point count, and rarity-linked surprises. That is a **hash-segmentation** style (fixed slices → parameters), complementary to a single streaming PRNG.

### Autoglyphs — Solidity seed → `draw(id)`

```solidity
function draw(uint id) public view returns (string) {
    uint a = uint(uint160(keccak256(abi.encodePacked(idToSeed[id]))));
    // ... ASCII grid from a, mod, and idToSymbolScheme[id]
}
```

Mint binds a unique seed (manual seed allowed but not reusable). Art is regenerated on demand from on-chain state; SVG/plotter are off-chain projections of the same instructions (Sol LeWitt–style).

### Fxhash — tx hash → Randomizer → `$fx.hash` → SFC32

1. Collect triggers a chain transaction → transaction hash.  
2. Fxhash **Randomizer** transforms that hash (security / bias considerations — docs advise not using raw tx hash alone).  
3. Seed is injected (URL param / snippet) as `$fx.hash`.  
4. `$fx.rand()` is SFC32 seeded from that hash; `$fx.rand.reset()` restores the stream.  
5. Optional `$fx.randminter()` seeds from minter address; open-form APIs add lineage hashes (`$fx.randAt(depth)`).  
6. Preview: run generator → IPFS image; GENTK metadata records seed + pointers (“signing”).

### Domain-separated sub-seeds (best practice beyond a single stream)

A single global PRNG is fragile: one extra `rand()` shifts every later decision (traits vs layout vs motion). Guidance from 256ART / fxhash:

```javascript
const layoutRandom  = createPRNG(deriveSeed(hash, "layout"));
const paletteRandom = createPRNG(deriveSeed(hash, "palette"));
const motionRandom  = createPRNG(deriveSeed(hash, "motion"));
```

Derive structural **parameter objects first**, then render; keep call counts independent of viewport size.

---

## 4. Common contract patterns

### ERC-721 + project factory (Art Blocks)

- **Core:** multi-project ERC-721 (`GenArt721CoreV3` / Engine / Engine Flex).  
- **tokenId packing:** `projectId * 1_000_000 + invocation`.  
- **Script storage:** `addProjectScript` → BytecodeStorage addresses; `projectScriptByIndex` for reads; scripts >24KB split into segments.  
- **Hash storage:** packed with ownership (`ERC721_PackedHashSeed`); randomizer-only setter.  
- **Minter suite:** separate contracts for pricing / Dutch auction / allowlists; core only accepts `minterContract`.  
- **tokenURI:** typically `projectBaseURI + tokenId` → Art Blocks metadata API (features resolved by running/indexing the script), not a giant on-chain JSON blob.  
- **Engine Flex:** IPFS/Arweave/BytecodeStorage external assets via `tokenData.externalAssetDependencies`.  
- **On-chain Generator:** `getTokenHtml(core, tokenId)` / base64 data URI — reconstruct without Art Blocks servers.

### Fully on-chain generative ERC-721 (Autoglyphs)

- Generator + ownership in one contract.  
- Edition hard-capped in code (512).  
- Output as on-chain string; optional off-chain rich media.

### Two-tier NFT (Fxhash)

- **Generative Token** NFT = authorship + pointer to code (IPFS/ONCHFS).  
- **GENTK** NFT = collector edition with seed + preview CID + link to parent.  
- Optional **fx(params):** collector-chosen parameters serialized on-chain; mint ticket → final GENTK after param lock-in.

### Storage spectrum (practical)

| Layer | Typical choice |
| --- | --- |
| Ownership | Always on-chain ERC-721 (or chain-native NFT) |
| Seed / hash | On-chain (Art Blocks, Autoglyphs) or in GENTK metadata (Fxhash) |
| Generative code | On-chain JS (Art Blocks) · IPFS/ONCHFS bundle (Fxhash) · Solidity (Autoglyphs) |
| Libraries | On-chain registry / CDN hash (Art Blocks) · bundled in project (Fxhash) |
| Preview thumbnails | Off-chain capture (Puppeteer / fx capture) → IPFS or CDN; live view re-runs script |

---

## 5. Relevance notes for Seeded Geometries

Seeded Geometries already implements an Art Blocks–class pipeline: **64-char token hash → traits + render**, with an explicit blend of two industry patterns:

### Alignments with platforms above

| Seeded Geometries | Platform analogue |
| --- | --- |
| Fixed byte slices (bytes 0–4) → Grid / Palette / Density / Accent / Hue via `weightedPick` | Squiggle-style **hash segmentation**; transparent, auditable trait → slice map |
| `features(tokenHash)` → `{trait_type, value}[]` | Art Blocks `$features` / Fxhash `$fx.features` / OpenSea attributes |
| `cyrb53(hash + "::" + label)` → independent `sfc32` streams (`structure`, `tone`, `motion`, …) | 256ART / fxhash **domain-separated streams**; avoids global call-order coupling |
| Demo hashes via `demoMintHash(i)` until chain mint | Same role as local `?hash=` testing on Art Blocks / fx(lens) |
| Phase-0 animation = static render (motion on its own domain) | Determinism rule: presentation extras must not shift identity PRNG |

### Contract / product implications

1. **Mint contract should store (or deterministically bind) a 32-byte hash per `tokenId`.** Art Blocks’ `bytes12` seed + `keccak256(abi.encode(seed))` is one battle-tested pattern; a full `bytes32` from a VRF/commit-reveal randomizer is also fine if the JS side always receives the same hex string.  
2. **Do not put the full trait JSON on-chain** unless gas/product requires it — expose `features(hash)` from the same JS used to render (or a shared pure module), and let `tokenURI` metadata / an indexer call it. Matches Art Blocks and Fxhash.  
3. **Keep slice map + domain labels stable after mint.** Changing byte assignments or `::label` strings reshuffles the collection. Lock script like Art Blocks project lock.  
4. **Rarity:** SG’s `population / count` scoring matches classic PFP practice; marketplace rarity will instead be frequency of `features()` values — ensure buckets (Sparse/Standard/Dense) not continuous floats.  
5. **Optional Flex path:** if assets grow, Art Blocks Engine Flex / Fxhash IPFS patterns apply; core identity should remain hash + script.  
6. **Live view:** host a generator page that injects `tokenData = { hash, tokenId }` (Art Blocks shape) or `$fx.hash` (Fxhash shape); SG’s `SeedKit` already assumes a hex hash without requiring a specific wrapper.  
7. **Verification story:** “byte 0 → grid” is collector-legible in a way a pure streaming PRNG is not — keep that documentation next to the contract; Squiggle’s community lore shows slice-legibility drives secondary culture.

### Suggested production wiring (minimal)

```
ERC-721 mint → assign bytes32 tokenHash[tokenId]
tokenURI → metadata JSON with attributes = features(tokenHash)
token page / generator → load script + inject hash → SeedKit + SGArt.render
```

Preview MP4/PNG can be pre-rendered at mint (Fxhash signing style) while remaining regenerable from hash + script.

---

## 6. Numbered sources

Only sources actually searched or fetched for this brief:

1. Art Blocks Protocol Overview — https://docs.artblocks.io/protocol/overview/  
2. Art Blocks — Building Your Project (`tokenData`, PRNG, `window.$features`) — https://docs.artblocks.io/creator-onboarding/artists/1-building-your-project/  
3. Art Blocks — On-Chain Generator (`tokenData` HTML assembly, Flex deps) — https://docs.artblocks.io/protocol/on-chain-generator/  
4. Art Blocks — Core Contract V3 — https://docs.artblocks.io/developer/core-contract/  
5. Art Blocks — Legacy Features Script (`calculateFeatures`) — https://docs.artblocks.io/legacy/features-script/  
6. Art Blocks docs home — https://docs.artblocks.io/  
7. GenArt721CoreV3.sol (mint, `setTokenHash_8PT`, `tokenIdToHash`) — https://github.com/ArtBlocks/artblocks-contracts/blob/fa51cae3db543b9475a186f981b488e18feecb61/packages/contracts/contracts/GenArt721CoreV3.sol  
8. Art Blocks contracts V3 architecture notes — https://github.com/ArtBlocks/artblocks-contracts/blob/main/packages/contracts/V3_ARCHITECTURE.md  
9. Art Blocks article — Inside the Algorithm: Chromie Squiggle metadata — https://www.artblocks.io/articles/chromie-squiggle-algorithm-guide  
10. Chromie Squiggles Explorer (seed / hex-pair explanation; fetch timed out on one attempt, content also summarized via search) — https://chromie-squiggles.com/  
11. Larva Labs — Autoglyphs (on-chain generative ERC-721, `draw` snippet) — https://www.larvalabs.com/autoglyphs/index  
12. Larva Labs / Autoglyphs overview — https://www.larvalabs.com/autoglyphs  
13. Artnome — Autoglyphs interview (seed, regenerate-on-read) — https://www.artnome.com/news/2019/4/08/autoglyphs-generative-art-born-on-the-blockchain  
14. Fxhash — Genart on the Blockchain (seed from tx, Randomizer, GENTK signing, IPFS/ONCHFS) — https://docs.fxhash.xyz/knowledge-base/quickstart/genart-on-the-blockchain  
15. Fxhash — API Reference (`$fx.hash`, `$fx.rand`, `$fx.features`) — https://docs.fxhash.xyz/creating-on-fxhash/fxhash-api/api-reference  
16. Fxhash — Deterministic randomness — https://docs.fxhash.xyz/creating-on-fxhash/genart-in-the-browser/deterministic-randomness  
17. Fxhash — Parameter definition specs (fxparams) — https://docs.fxhash.xyz/creating-on-fxhash/fxhash-api/parameter-definition-specs  
18. Fxhash — fx(params) & ticketing — https://docs.fxhash.xyz/collecting-on-fxhash/platform-overview/fx-params-and-the-ticketing-system  
19. 256ART — Designing Deterministic Generative Art (domain-separated streams, call-order traps) — https://256.art/learn/deterministic-generative-art  
20. mattdesl — Subscapes Part 2 – Traits — https://mattdesl.substack.com/p/subscapes-part-2-traits  
21. Seeded Geometries local prototype (`js/seed.js`, `js/traits.js`, `README.md`) — `/workspace/seeded-geometries/` (workspace reference for §5, not a public URL)

---

## Quick reference cheatsheet

| Concern | Art Blocks | Fxhash | Autoglyphs | Seeded Geometries (target) |
| --- | --- | --- | --- | --- |
| Seed API | `tokenData.hash` | `$fx.hash` | `idToSeed[id]` | hex string → `SeedKit` |
| Traits API | `window.$features` | `$fx.features` | implicit in draw | `features(hash)` |
| PRNG | custom / sfc32 from hash words | `$fx.rand` (SFC32) | keccak in Solidity | slice + `sfc32` per domain |
| Code storage | on-chain JS | IPFS / ONCHFS | on-chain Solidity | ship JS; store hash on mint |
| Preview | Puppeteer / `$renderPreview` | `$fx.preview` + IPFS | ASCII / SVG off-chain | optional MP4; live canvas |

