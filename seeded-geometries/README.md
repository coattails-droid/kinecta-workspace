# Seeded Geometries

A working prototype of **hash-driven generative art** — the seed architecture behind
Art Blocks-style NFTs, built around real geometric pattern systems.

Each piece is rendered from a single 64-character token hash. The prototype blends
two methods for structuring seed generation:

## The blend

**Method 1 — hash segmentation (coarse traits).**
Fixed slices of the token hash choose the high-level traits, so every trait maps to
a legible, verifiable slice:

| Hash slice | Trait | Options (rarity-weighted) |
|---|---|---|
| byte 0 (chars 0–1) | Grid system | Linear Grid ⊕ Triangle Field 70% — triangle field first, linear grid over it · Triangle Field ⊕ Linear Grid 30% — inverted stack, field over grid; both systems render in every mint on one shared lattice module |
| byte 1 (chars 2–3) | Palette | Ink 100% (Ink ground `#14161f`, Bone linework `#e9e3d3`) |
| byte 2 (chars 4–5) | Density | Sparse 25% · Standard 50% · Dense 25% |
| byte 3 (chars 6–7) | Accent | Classic 30% · Restrained 45% · Bold 25% |
| byte 4 (chars 8–9) | Accent Hue | Ink 30% · Magenta 30% · Gold 20% · Turquoise 20% |

**Method 3 — domain-separated sub-seeds (micro-detail).**
The *full* token hash plus a label (`"structure"`, `"tone"`, `"accent-detail"`) is
mixed through `cyrb53` to seed an independent `sfc32` stream per detail domain.
Line weights, offsets, circle radii, rotation jitter, accent placement — thousands
of micro-decisions, each from its own inexhaustible stream. Tweaking one domain
never shifts another, and two tokens sharing a coarse trait still render different
detail (sub-seeds derive from the full hash, never the slice alone).

The mixer is deliberately non-cryptographic: the entropy lives in the token hash;
the mixer only separates domains.

## Accent colors

Accent *color* is its own trait, read from byte 4. Ink `#14161f` is the
monochrome anchor, joined by Mardi Gras brights — Magenta `#ff3cac`, Gold
`#ffbe0b` (the same gold as the +60° layer tint), and Turquoise `#00e5cc`
— rarity-weighted in `js/traits.js` (`ACCENT_HUES`): Ink 30 · Magenta 30 ·
Gold 20 · Turquoise 20. Ink dots read as knockouts punched through the
linework. Classic pieces draw the ring in monochrome ink; restrained
pieces carry one hue; bold pieces carry two or three
distinct hues. The colors override the palette's default accent color at
render time, appear as "Accent Hue" in `features()` metadata, and count
toward the rarity score. To recolor: change a hex entry in `HUE_COLORS` — keys must
match `ACCENT_HUES` exactly.

## Rarity

Classic PFP scoring: per trait, `population / trait count`, summed across traits.
Higher = rarer. `node scripts/generate_collection.js` prints frequencies and a
rarity table; the gallery scores each piece live against a 48-mint reference
population.

## Animation & MP4 loops

`SGArt.render(ctx, S, tokenHash, layers, phase)` takes an optional loop phase in
`[0, 1)`. Every animated quantity is built from `osc()`, which is exactly 0 at
phase 0 and phase 1 — so frame(1) === frame(0) and the loop always closes with
no visible seam (verified at the pixel level: mean diff ≈ 0.007/255).

- **Linear Grid** — true squares on the module lines of the 3×3 lattice. Each parent chain between welds acts as one shard: on every 8-second loop the lattice obliterates into sharded pieces along a seeded radial wave and reconfigures back into place (see below). Accent dots sit on the shared vertices and ride the radial wave outward with the shards — flying away from the epicenter on the same envelope and delay — at full visibility through the whole motion.
- **Triangle / Circle Field** — each module square of the lattice carries one seeded diagonal (two right-isosceles triangles), sharing the linear grid's vertex set exactly — every triangle vertex is a grid vertex and vice versa; two concentric breathing wash rings per subcell, centered on the grid cell, riding the radial wave outward with the shards at full visibility. It lays the field — and the vertex set — beneath the linear grid.
- In the fusion composite, the triangle field's circles fly the wave outward with the lattice while the linear grid shatters and reassembles — all motions share the same 8-second loop and close seamlessly.
- **Undulating layers** — wave phases drift with the loop phase.

**Shatter / reconfigure.** Each parent path is one shard. A seeded epicenter
(`"motion:shatter-epicenter"` stream) sets a radial delay field normalized to
the visible window, so the obliteration sweeps edge to edge: shards translate
outward, twist out and back about their own centroids (seeded
direction, max ~120° — a third slower than the old half-turn — unwound
before the radial wave finishes, so each shard glides home straight with
no snap), and stretch outward from their own centroids (seeded
1.15–1.60x at the peak, so the lines protrude and extend mid-flight) (own
`"motion:shatter"` streams per layer), hit full
shatter, reverse instantly at the peak, then fly home in the same order over
a long reconfigure. Choreography: the 8-second loop holds 2 seconds of rest,
plays the full shatter over a 4-second motion window (loop phase
[0.25, 0.75)), then rests 2 seconds more — the envelope runs 2x faster than
a full-loop motion, so the travel time stays proportional. **Frame hold:**
each shard's motion amplitude is scaled by its centroid's distance to the
visible frame (`EDGE_HOLD = 0.10`, ramping to zero at the edge), so linework
that crosses the frame keeps crossing it at every phase — the piece stays
anchored to the frame while the interior obliterates. Long grid lines stay
wild in the interior (they are weighted by centroid, not bbox). The delay's radial profile is a quarter sine
(π/2 of spatial phase across the piece), so the wavefront punches out fast
near the epicenter and decelerates toward the far edge. The envelope is
exactly 0 outside the motion window — phase 0 and phase 1 render the intact static
piece identically. The cell-centered circles ride the wave outward with the
shards (a seeded fraction of their radial distance, `CIRCLE_FLY = [0.15, 0.60]`)
at full visibility — no dissolve. The accent dots ride the wave outward with the
shards: each dot flies away from the epicenter on the same envelope and
radial delay (a seeded fraction of its radial distance,
`DOT_OUTWARD = [0.15, 0.60]`) at full visibility.

Motion parameters come from their own `"motion"` domain stream, so animation
never shifts the static streams: phase 0 renders exactly what the piece looked
like before animation existed. The gallery has an **Animate** toggle (8s loop,
golden-ratio phase offsets so pieces don't pulse in lockstep).

`node scripts/export_mp4.js <tokenIndex> [--frames 90] [--fps 30] [--size 720]
[--out file.mp4] [--layers]` rasterizes the loop with the pure-JS `pureimage`
canvas (needs `npm install pureimage`) and encodes a seamless H.264 MP4 with
ffmpeg — e.g. `media/token-13-loop.mp4` (token #13, 720px, 90 frames @ 30fps).
One export caveat: pureimage ignores blend modes, so PNG layers composite as
source-over in the MP4 (the gallery shows true blending).

`scripts/test_motion.js` locks the invariants: phase defaults to 0, phase 1 ≡
phase 0 for the fusion composite, motion is present mid-loop, undulate tiles close
the loop too.

## Token page (Art Blocks-style)

`token.html` is the single-file live token renderer, generated by
`node scripts/build_token_page.js` from `scripts/token.template.html`. It inlines
`js/seed.js`, `js/traits.js`, `js/layers.js`, and `js/artwork.js` byte-for-byte
(single source of truth — the tested sources) plus all PNG layer decks as base64
data URIs. The result is 100% self-contained (~61 KB, no network, no external
assets):

- reads the Art Blocks-injected `tokenData.hash` (token ID + hash, injected ahead
  of the project script by the on-chain generator), falling back to `?hash=` and
  then to a deterministic demo hash, so the page never renders blank;
- renders the token fullscreen on its 8-second seamless animation loop;
- each gallery piece links to its live view (`token.html?hash=<64 hex chars>`).

`scripts/test_token_page.js` executes the *generated* `token.html` in a stub DOM
backed by a real raster canvas and asserts the hash-resolution chain, deck
loading, non-blank frames, loop closure (t0 vs t0+8000), and mid-loop motion.

Regenerate `token.html` after any change to the JS sources or layer decks, then
push — it is a build artifact committed to the repo.

## Composite grid systems: the welded 3×3 lattice

A grid trait entry may list several `systems`; every mint renders each one in
draw order (first = bottom layer). All layers and traits share one 3×3 square
lattice module (`SGArt.gridPatch`): the linear grid draws true squares on the
module lines, and the triangle field puts one seeded diagonal per module
square — every source layer shares the same 3×3 module and mod/3
ratio system before rotation, and both line systems share one vertex set.

The composite is then rendered **three times** as one welded graph
(`SGArt.fusedGraph`): the base composite turned 75° clockwise, plus exact
duplicates at +30° and +60° relative to it (so 75°/105°/135° absolute), all at
equal alpha (`LAYER_DIM = [0.66,0.66,0.66]`). All three layers rotate about one
locked pivot — the exact frame center (`SGArt._pivot`) — and the 1.578× zoom is
centered on that same point, so the layers can never drift apart. Each rotated layer carries its
own tint (`LAYER_TINT`): purple `#9d4edd` on the base layer, green `#06d6a0`
on the +30° duplicate, gold `#ffbe0b` on the +60° — Mardi Gras primaries.
The soft cell-centered circles (`CIRCLE_R` = 0.24–0.38 of the subcell unit, seeded per circle) take their layer's tint too, at wash alpha, breathing slowly at half the layer's oscillator rate; accent
dots draw from the Accent Hue trait, and texture deck and background stay in Bone/Ink. The linework bleeds uninterrupted to the canvas edge — no border. The whole composition is drawn at 1.578× zoom
about the canvas center and cropped by the frame (`SGArt.ZOOM`), tuned so the lattice vertices land on the frame's edge midpoints — slightly more of
the composition is visible than at the old 2× zoom, so the modules read a touch smaller.
Every true crossing — within a layer or across layers — becomes a shared
vertex: edges are spatially hashed, every intersecting/touching pair is found
(including collinear overlaps, which need a relative parallel test since
rotated edges on one lattice line differ by float noise), and both edges are
split there. The result is a single continuous graph (~0.9k vertices /
~1.4k subedges at 720px for a dense piece — the unified vertex set keeps the
weld far smaller than the old third-subcell field), deterministic and cached
per (hash, size, tri-subdiv).

Motion flexes each sub-edge perpendicular to its direction, pinned to zero at
every welded endpoint via `sin(πu)`, so joins never tear; short weld fragments
shimmer (quadratic length falloff) while full module-spans breathe. The linear
grid's flex amplitude runs 2× the triangle field's so its motion reads through
the weld field. Accent dots are pinned to the welded vertices across all
three layers. Every piece carries two fixed accent rings on the
square-grid vertices of the linear grid — an inner ring of 12 dots on the
vertices nearest the piece center and an outer ring of up to 12 dots on the
grid's outer vertices, nearest the frame edge (the outer ring claims only
vertices the inner ring left: sparse pieces, whose visible grid holds just
12 vertices, field the inner ring alone) — never a variable grid,
all at one smaller size (`DOT_SIZE` = 0.6).
Classic pieces draw the ring in monochrome ink; restrained pieces in one
hue, bold pieces in two or three. Ink accent
dots carry a smaller bone center dot — only on the ink hue, where the dark
knockout needs it to stay visible — drawn at the same position with reduced
transparency so the pair reads as one mark. Each cell
snaps to its nearest shared vertex inside the frame (one dot per vertex —
cells whose nearest vertex is taken or off-frame are skipped), so every dot
is visible and sits exactly on a grid/triangle vertex. Both systems draw
from domain-separated streams (the overlay uses the `:overlay` suffix, the
duplicates `dup30`/`dup60`) and can never shift each other's detail streams.
Each system's PNG/dynamic depth deck composites directly beneath its own
linework, and dynamic tile streams are namespaced per system so two decks
never generate identical tiles.

`scripts/test_fusion.js` locks the composite invariants (draw order: dim
duplicates first, triangle under linear; exact +30°/+60° rotation; cross-layer
welds exist; stream separation; per-system decks).
`scripts/test_lattice_stability.js` locks the weld itself (per-layer alpha
floors, constant stroke count, no vertex strictly inside another edge, base
vertices preserved, center-band horizontals always stroked).

## Files

```
index.html                  gallery: 12 demo mints + trait readouts + "simulate mint" + Animate toggle
js/seed.js                  the seed architecture (browser + Node)
js/traits.js                trait derivation, features metadata, rarity
js/layers.js                PNG layer decks: registry, preloading, seeded composition (+ phase drift)
js/artwork.js               the welded tri-layer lattice rendered on canvas (+ layer composite + loop-phase motion)
scripts/generate_collection.js   Node: simulate a mint run, rank rarity
scripts/make_placeholders.js     Node: regenerate the placeholder PNG layer sets
scripts/test_traits.js           Node: trait derivation, exclusion rules, accent dot grid tests
scripts/test_layers.js           Node: layer determinism + integration tests
scripts/test_motion.js           Node: seamless-loop animation invariants
scripts/test_fusion.js           Node: tri-layer weld + composite draw-order invariants
scripts/test_lattice_stability.js  Node: weld correctness (no floating vertices) + stroke-count stability
scripts/test_pivot.js            Node: all three layers pivot exactly on the frame center; zoom centered on it
scripts/export_mp4.js            Node: render a token's loop to a seamless H.264 MP4 (needs pureimage + ffmpeg)
scripts/build_token_page.js      Node: generate the self-contained token.html from the tested sources
scripts/token.template.html      template for the Art Blocks-style single-file token page
scripts/test_token_page.js       Node: end-to-end test of the generated token.html (stub DOM + real raster)
assets/layers/<system>/     PNG texture layers, one deck per grid system
media/token-13-loop.mp4     sample: token #13's 3-second seamless loop (720px)
collection/traits.json      generated output (gitignored sample of a run)
```

## PNG texture layers

Each grid system owns a **deck** of PNG texture layers (`js/layers.js`, `LAYER_DECKS`).
The PNGs are static assets composited *beneath* the procedural linework as depth
fields; every compositional decision — which instances, position, rotation, scale,
opacity, blend mode — comes from the seeded Method 3 streams, so the result is
still fully deterministic per hash. The gallery preloads the decks, then renders.

**Using your own artwork** (no code changes beyond the registry):

1. Drop transparent-background PNGs into `assets/layers/<system>/`
   (`linear`, `triangle`).
2. Add an entry to `LAYER_DECKS` in `js/layers.js`:
   `{ file, blend, alpha: [min,max], scale: [min,max], count: [min,max], rotate }`.
3. Push. A missing PNG logs a warning and is skipped; the gallery keeps rendering.

**Live preview without committing:** the gallery has a dropzone — drag PNGs onto it
and every piece re-renders with your layers immediately. Preview-only; commit the
files to `assets/layers/<system>/` to keep them.

**Dynamic (procedural) layers.** A deck entry can name a generator instead of a
file: `{ dynamic: "undulate", params: {...}, ... }`. The tile is drawn at render
time on an offscreen canvas — no asset files needed. `"undulate"` renders a flow
field of horizontal contour lines displaced by a sum of seeded sine waves
(wavelength, amplitude, phase, and line count all seeded). Each dynamic tile gets
its own domain-separated stream (`"layer:<name>:<index>"`), so tile internals
never shift the base detail streams, and the tile is drawn in the active
palette's ink. To add your own generator, add a function to `DYNAMIC` in
`js/layers.js` with the signature `(tctx, size, rs, palette, params)` and
reference it by name from a deck entry.

## π uniformity

Every piece derives one **π-phase** — a harmonic angle (a multiple of π/4)
drawn from the token's structure stream — shared by all layers in the piece.
Each layer instance's rotation is quantized to eighths of π around that phase,
so the whole composition sits on a common harmonic lattice instead of drifting
on independent random angles. The `"undulate"` generator goes further: its wave
phases are multiples of π/4 offset by the shared phase, and the cycle count
across each tile is a multiple of π (`π·w/2` for the seeded `w`). One constant,
one reference angle, everything aligned to it.

## Run it

- Gallery: open `index.html`, or `python3 -m http.server` and visit it.
  (Will also be served via GitHub Pages.)
- Collection report: `node scripts/generate_collection.js 24`

## Prototype vs production

- **Demo hashes** (`SeedKit.demoMintHash`) are deterministic stand-ins so the
  prototype renders identically everywhere. Production feeds the chain-derived
  token hash (mint blockhash) in at the same seam — `render(ctx, size, tokenHash)`
  never changes.
- No smart contracts here: this is the generative + metadata layer. The natural
  next step is an ERC-721 whose `tokenURI` serves `features()` output and whose
  artwork page runs this script against the on-chain hash.
- Rendering is vanilla canvas (no dependencies); the seed module ports directly
  into a p5.js / Art Blocks project script.
