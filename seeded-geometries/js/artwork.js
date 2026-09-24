// artwork.js — generative geometric systems rendered from a token hash.
//
// Coarse structure comes from Method 1 traits (grid / palette / density /
// accent). All micro-detail comes from Method 3 domain-separated streams, so
// each detail domain ("structure", "tone", "accent-detail") is an independent
// deterministic random stream. Same hash -> same piece, forever, anywhere.
//
// The grid system is ONE welded graph drawn in three layers on a unified
// 3x3 square lattice: the base Linear Grid ⊕ Triangle Field composite plus
// two duplicate layers rotated +30° and +60° about the piece center. The
// linear grid is true squares on the module lines; the triangle field
// puts one seeded diagonal per module square, sharing the grid's vertex
// set exactly. Every source layer is
// built on the same 3x3 module and mod/3 ratio system before rotation; the
// rotated duplicates occupy rotated copies of that lattice, and cross-layer
// welds introduce vertices off the original axis-aligned grid. Every crossing or touch between
// any two edges — within a layer or across layers — is a welded vertex, so
// no line ever crosses another without joining it.
//
// Render entry: SGArt.render(ctx, sizePx, tokenHash, layers, phase).
(function (global) {
  "use strict";

  const SeedKit = typeof require !== "undefined" ? require("./seed.js") : global.SeedKit;
  const Traits = typeof require !== "undefined" ? require("./traits.js") : global.SGTraits;
  const Layers = typeof require !== "undefined"
    ? (function () { try { return require("./layers.js"); } catch (e) { return null; } })()
    : global.SGLayers;

  const PALETTES = {
    ink:  { bg: "#14161f", ink: "#e9e3d3", wash: "rgba(233,227,211,0.08)", accent: "#c9a227" },
  };

  const DENSITY_MODULES = { sparse: 3, standard: 4, dense: 5 };
  // The accent rings: every piece carries two fixed rings of accent dots on
  // the linear grid's square-grid vertices — an inner ring of ACCENT_DOTS on
  // the vertices nearest the piece center, and an outer ring of up to
  // ACCENT_DOTS_OUTER on the grid's outer vertices, nearest the frame edge.
  // The outer ring claims only vertices the inner ring did not: tiers whose
  // visible region holds fewer than 24 grid vertices (sparse holds 12)
  // field a smaller outer ring rather than reaching off the linear grid.
  // No grid, no count variation by trait. The accent trait only sets the
  // color treatment. Both rings share one size, one hue logic, and one wave
  // flight: a single architecture, inner and outer.
  const ACCENT_DOTS = 12;
  const ACCENT_DOTS_OUTER = 12;
  // Every accent dot draws at one smaller size: this fraction of the base dot
  // radius. No size tiers, no pulse variation — the dots are uniform.
  const DOT_SIZE = 0.6;
  // Only ink accent dots carry a smaller center dot: this fraction of the
  // accent dot's radius. The center is bone — the one color that reads
  // against the dark ink knockout — so the ink dots stay visible against
  // the linework. Colored dots (magenta, gold, turquoise) draw without a
  // center; they already read on their own.
  const DOT_CENTER = 0.42;
  const BONE = PALETTES.ink.ink; // "#e9e3d3", the bone knockout tone
  const CENTER_ALPHA = 0.55;
  // Outward flight: while the shards shatter outward from the epicenter,
  // each accent dot rides the same envelope and radial delay, flying outward
  // from the epicenter with the lattice. At peak envelope a dot has traveled
  // a seeded fraction of its radial distance outward, between
  // DOT_OUTWARD[0] and DOT_OUTWARD[1].
  const DOT_OUTWARD = [0.15, 0.60];

  // Frame hold: the shatter's motion amplitude damps to zero at the visible
  // frame's edge, over a band EDGE_HOLD·S wide just inside it. Linework that
  // crosses the frame keeps crossing it at every phase — the piece stays
  // anchored to the frame while the interior obliterates. Weighting is by
  // shard centroid, so long grid lines stay wild in the interior even as
  // their ends hold the frame. The band (0.10·S) stays wider than the
  // farthest a shard can fly, so the pinned/moving transition never shows
  // a seam. Tile mode passes no hold box (its 9-shift wrap already keeps
  // the repeat seamless mid-motion).
  const EDGE_HOLD = 0.10;

  // Accent colors, keyed by the ACCENT_HUES trait keys in traits.js.
  // Ink stays as the monochrome anchor — ink dots read as knockouts punched
  // through the linework — joined by Mardi Gras brights: magenta, gold (the
  // same gold as the +60° layer tint), and turquoise.
  // Standard 6-digit HTML hex; every entry must match /^#[0-9a-f]{6}$/i.
  const HUE_COLORS = {
    ink:       "#14161f",
    magenta:   "#ff3cac",
    gold:      "#ffbe0b",
    turquoise: "#00e5cc",
  };

  function line(ctx, w) {
    ctx.lineWidth = w;
  }

  const TAU = Math.PI * 2;

  // Loop-phase oscillator: exactly 0 at phase 0 and phase 1, smooth and
  // periodic between. k = integer cycles per loop, phi = per-element phase
  // offset. Because every oscillator-driven quantity is built from osc(),
  // frame(1) is identical to frame(0): the loop always closes seamlessly.
  function osc(k, phi, phase) {
    // Exact zeros at the loop endpoints: sin() of large arguments never
    // cancels exactly in floats, so pin the endpoints explicitly. Every
    // oscillator-driven quantity derives from osc, so phase 1 === phase 0
    // bit-for-bit and the 8s loop closes seamlessly.
    if (phase === 0 || phase === 1) return 0;
    return Math.sin(TAU * (k * phase + phi)) - Math.sin(TAU * phi);
  }

  // Deterministic per-element phase from a seeded value plus indices.
  function ephi(seed, i, j) {
    const x = Math.sin(seed + i * 12.9898 + j * 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  function frac(x) { return x - Math.floor(x); }

  function sstep(a, b, x) {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  // Shatter envelope: each shard runs its own local clock x = frac(mu -
  // delay), periodic in the motion window. The shard obliterates (explodes
  // outward) over x in [0, 0.20), then reverses instantly at the peak and
  // reconfigures back into place over the long [0.20, 0.80) return — the
  // loop's main motion. The only true rest is the forced [0.80, 1) zero
  // zone: at mu = 0 every shard's local clock reads 1 - delay, so the
  // envelope must vanish on [1 - maxDelay, 1] to open the window on the
  // intact piece. The smoothstep joints give zero velocity at the peak, so
  // the shards whip around with no pause and no kink.
  //
  // Choreography: the 8s loop holds 2s of rest, plays the whole envelope
  // over a 4s motion window, then rests 2s more. motionMu maps loop phase
  // to motion progress mu in [0, 1] over phase [0.25, 0.75), and returns
  // -1 (at rest) outside it. The envelope shape is unchanged — it simply
  // runs 2x faster than a full-loop motion, and the radial wave sweeps
  // with it, so the travel time stays proportional.
  function shatterEnv(x) {
    if (x < 0.20) return sstep(0, 0.20, x);         // obliterate
    if (x < 0.80) return 1 - sstep(0.20, 0.80, x);  // reconfigure (instant reversal at peak)
    return 0;                                      // rest: intact (forced)
  }

  // Shard spin: peak twist of the out-and-back turn, in seeded direction.
  // 0.335 turns ≈ 120° — a third slower than the old half-turn. The twist
  // follows spinTwist: it rises to SPIN_TURNS at SPIN_WINDOW / 2 and
  // unwinds to exactly 0 before the radial wave finishes, so the shard
  // slides back into its original orientation with no snap. (The old code
  // let the spin accumulate to 180° and then cut to 0 in one frame when
  // the envelope closed — a visible pop on every asymmetric shard.)
  const SPIN_TURNS = 0.335;

  // Shard spin window: the twist resolves over the first SPIN_WINDOW of
  // the shard's local clock — well before the radial wave (translation +
  // stretch, driven by the envelope out to x = 0.80) finishes. So each
  // shard untwists first, then glides home straight: no twisting while
  // landing. The twist peaks at SPIN_WINDOW / 2, just past full
  // obliteration, when the shard is at max fling.
  const SPIN_WINDOW = 0.55;

  // The twist profile: 0 at flight start, 1 at mid-window, exactly 0 from
  // SPIN_WINDOW on — the shard unwinds to its original orientation and
  // sits untwisted while the radial wave carries it home. Clamped to
  // exact 0 past the window (Math.sin(Math.PI) is float dust, not zero).
  function spinTwist(x) {
    if (x <= 0 || x >= SPIN_WINDOW) return 0;
    return Math.sin(Math.PI * sstep(0, SPIN_WINDOW, x));
  }

  // Motion window for the 8s loop: 2s rest, 4s shatter/reconfigure, 2s
  // rest. Returns motion progress mu in [0, 1], or -1 when the piece is at
  // rest. LOOP_S must match LOOP_MS in scripts/token.template.html.
  const LOOP_S = 8, REST_S = 2;
  function motionMu(phase) {
    const a = REST_S / LOOP_S, b = 1 - REST_S / LOOP_S;
    if (phase < a || phase >= b) return -1;
    return (phase - a) / (b - a);
  }

  // The obliteration's epicenter: one seeded point per token. The shatter
  // delay radiates outward from here, so the lattice breaks apart as an
  // expanding wave and reassembles in the same order. Own domain stream, so
  // existing stream positions never shift.
  function shatterEpicenter(tokenHash, SU) {
    const s = SeedKit.streamFor(tokenHash, "motion:shatter-epicenter");
    return { x: SU * (0.3 + 0.4 * s()), y: SU * (0.3 + 0.4 * s()) };
  }

  // The shatter field: epicenter plus the normalization distance. Delays
  // are normalized by the farthest corner of the *visible region* from the
  // epicenter, so the full [0, SHATTER_DMAX] delay range always spans what
  // the viewer sees — the wave genuinely sweeps edge to edge instead of
  // clustering near the epicenter. Square mode passes the zoomed window;
  // tile mode (no zoom) passes null for the whole tile.
  function shatterField(tokenHash, SU, region) {
    const epi = shatterEpicenter(tokenHash, SU);
    const r = region || [0, 0, SU, SU];
    let maxD = 0.001;
    [[r[0], r[1]], [r[2], r[1]], [r[0], r[3]], [r[2], r[3]]].forEach(function (c) {
      const dx = c[0] - epi.x, dy = c[1] - epi.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > maxD) maxD = d;
    });
    return { x: epi.x, y: epi.y, maxD: maxD };
  }

  // Maximum radial delay, in motion-window units: the wavefront crosses the
  // visible piece in 0.20/1.12 of the 4s motion window — 12% faster than a fifth.
  const SHATTER_DMAX = 0.20 / 1.12;

  // One shard's delay from the field: 0 at the epicenter, SHATTER_DMAX at
  // the farthest visible corner, plus a small seeded jitter. The radial
  // profile is a quarter sine — π/2 of spatial phase across the piece —
  // so the wavefront punches out fast near the epicenter and decelerates
  // toward the far edge, lingering there before the return.
  function shatterDelay(f, x, y, SU, ju) {
    const dx = x - f.x, dy = y - f.y;
    const r = Math.min(1, Math.sqrt(dx * dx + dy * dy) / f.maxD);
    const d = SHATTER_DMAX * Math.sin(r * Math.PI / 2) + 0.06 * (ju - 0.5);
    return Math.min(SHATTER_DMAX, Math.max(0, d));
  }

  // --- The 3x3 unified lattice ------------------------------------------------
  // One square module, subdivided 3x3, shared by every layer and every
  // trait. The linear grid draws true squares on the module lines; the
  // triangle field puts one seeded diagonal per module square, so both
  // systems share one vertex set exactly — every triangle vertex is a
  // grid vertex and vice versa. Within a layer,
  // every vertex is a multiple of u = mod/3 — the same proportional system —
  // so the linear grids are perfect squares. The rotated duplicates occupy
  // rotated copies of that lattice, and cross-layer welds land off the
  // original axis-aligned grid. Layer 0 covers the canvas; layers 1 and 2 are exact duplicates
  // rotated +30° and +60° about the piece center, generated on a
  // pre-rotation patch with margin m = 0.22S (pre-image half-extent
  // (S/2)(cos60° + sin60°) ≈ 0.683S). Rotation angles are exact fractions
  // of pi — never arbitrary — in the spirit of the pi-uniformity invariant.
  //
  // Diagonal direction and circle placement are pure functions of the
  // subcell indices via ephi(), seeded by fixed hash bytes — never stream
  // draws — so the rotated duplicates stay exact rotations of the base.
  //
  // LAYER_DIM sets each layer's alpha multiplier. All layers render at equal
  // transparency (no depth dimming) so the three rotated grids read as one
  // unified field rather than a foreground/background stack — at 66% alpha.
  // The whole composition is turned 30° clockwise on screen (positive angle
  // reads clockwise in canvas y-down coordinates); the duplicates stay at
  // exactly +30°/+60° relative to the base layer.
  //
  // LAYER_TINT gives each rotated grid its own hue — Mardi Gras primaries:
  // purple on the base layer, green on the +30° duplicate, gold on the +60°.
  // The soft cell-centered circles take their layer's tint too, at wash alpha.
  // Accent dots, texture deck, and background are untouched.
  // Tuning knobs: DENSITY_MODULES, LAYER_DIM, LAYER_TINT, ORIENT_CW, ZOOM,
  // CIRCLE_R, TRI_SUBDIV, the stroke width divisors in drawWelded / drawAccentDots (S/1240,
  // size/640 in the wave-tile deck), and the shatter
  // system in weldedSim (shard flight magnitude, spin, envelope timing,
  // radial delay spread).
  // Whole-composition orientation: 30° clockwise plus Calvin's extra 45°
  // rotation, so the base layer sits at 75° absolute and the duplicates at
  // +30°/+60° relative (105°/135° absolute).
  const ORIENT_CW = Math.PI / 6 + Math.PI / 4;
  const LAYER_ANGLES = [ORIENT_CW, ORIENT_CW + Math.PI / 6, ORIENT_CW + Math.PI / 3];
  const LAYER_DIM = [0.66, 0.66, 0.66];
  const LAYER_TINT = ["#9d4edd", "#06d6a0", "#ffbe0b"];
  // Zoom: the composition is drawn ZOOM× about the canvas center and cropped
  // by the frame — fewer, larger modules on screen, and every motion reads
  // larger too. Tuned so the lattice vertices land on the frame's edge
  // midpoints: the closest a 75°/105°/135° rotated square lattice can get
  // (exact alignment is impossible — the tangents are irrational).
  const ZOOM = 1.578;
  // The one locked pivot: every layer rotates about this point, and the
  // frame zoom is centered on it. All rotation centers and the zoom
  // translate read from here, so the layers can never drift apart.
  function pivot(S) { return { x: S / 2, y: S / 2 }; }
  // Circle field: one breathing circle per grid cell, centered on the cell
  // (not tucked into a triangle). Radius range as a fraction of the subcell
  // unit, seeded per circle — large enough to overlap the triangle field
  // at wash alpha, small enough to stay inside the cell at breathing peak
  // (0.38 × 1.3 ≈ 0.494 < 0.5). The field breathes slowly (half the layer's
  // oscillator rate, rounded up) and rides the radial wave outward with the
  // shards at full visibility — no dissolve.
  // Two concentric wash rings per subcell: the seeded outer ring and a
  // smaller inner ring sharing its center, tint, and wave flight.
  const CIRCLE_R = [0.24, 0.38];
  const CIRCLE_R2 = [0.10, 0.20];
  // Outward flight: at peak envelope a circle has traveled a seeded fraction
  // of its radial distance outward, between CIRCLE_FLY[0] and CIRCLE_FLY[1].
  const CIRCLE_FLY = [0.15, 0.60];
  // Triangle field subdivision: the triangle field is built on its own
  // cells of tu = mod / TRI_SUBDIV, independent of the linear grid's
  // module lines. 1 = one triangle per module, so the triangle field
  // shares the linear grid's vertex set exactly: every triangle vertex is
  // a grid vertex and vice versa (shipped). 3 = the classic third-subcell
  // field (legs on the interior third-lines, one diagonal per subcell —
  // the triangle vertices form a 3x-finer lattice nesting the grid's).
  let TRI_SUBDIV = 1;
  const KIND_ORD = { h: 0, v: 1, tri: 2 };      // stream-consumption order
  const KIND_DRAW = { tri: 0, h: 1, v: 2 };     // stroke order (field under grid)
  const KIND_DRAW_INV = { h: 0, v: 1, tri: 2 }; // stroke order (grid under field)

  // Stroke order for a grid trait key: the inverted fusion stacks the
  // triangle field over the linear grid. Consumption order never changes,
  // so the geometry and motion streams are identical either way — only the
  // paint order flips.
  function kindDrawFor(gridKey) {
    return gridKey === "fusion-inv" ? KIND_DRAW_INV : KIND_DRAW;
  }

  // Subcell index range covering [-m, S+m] at pitch u = mod/3.
  function gridPatch(mod, S, m) {
    const u = mod / 3;
    return { u: u, i0: Math.floor(-m / u) - 1, i1: Math.ceil((S + m) / u) + 1 };
  }

  // Point-soup edges for one layer: {x1,y1,x2,y2,kind,pi} with kind 'h'|'v'|
  // 'tri' and pi the parent index within (layer, kind), in generation order.
  // 'h'/'v' are the true-square linear grid on the module lines; 'tri' is
  // the triangle field — interior lines at the triangle pitch plus one
  // diagonal per triangle cell. Module lines are every TRI_SUBDIV-th
  // triangle line, so the linear grid never duplicates a leg: each
  // geometric edge is generated once.
  //
  // Rectangular support (textile tile mode): a rect patch carries
  // ux/uy/ix0/ix1/iy0/iy1/modX/modY instead of u/i0/i1, and the caller may
  // pass an explicit rotation center (cx, cy) and angle table (angles).
  // A square patch called without cx/cy/angles behaves exactly as before.
  function layerSoup(tokenHash, mod, S, layer, patch, cx, cy, angles) {
    const ux = patch.ux !== undefined ? patch.ux : patch.u;
    const uy = patch.uy !== undefined ? patch.uy : patch.u;
    const ix0 = patch.ix0 !== undefined ? patch.ix0 : patch.i0;
    const ix1 = patch.ix1 !== undefined ? patch.ix1 : patch.i1;
    const iy0 = patch.iy0 !== undefined ? patch.iy0 : patch.i0;
    const iy1 = patch.iy1 !== undefined ? patch.iy1 : patch.i1;
    const modX = patch.modX !== undefined ? patch.modX : mod;
    const modY = patch.modY !== undefined ? patch.modY : mod;
    const soup = [];
    const circles = [];
    const ang = angles ? angles[layer] : LAYER_ANGLES[layer];
    const cosA = Math.cos(ang), sinA = Math.sin(ang);
    const pv = pivot(S);
    cx = (cx !== undefined) ? cx : pv.x;
    cy = (cy !== undefined) ? cy : pv.y;
    function rot(x, y) {
      if (ang === 0) return [x, y];
      const dx = x - cx, dy = y - cy;
      return [cx + dx * cosA - dy * sinA, cy + dx * sinA + dy * cosA];
    }
    function edge(x1, y1, x2, y2, kind, pi) {
      const a = rot(x1, y1), b = rot(x2, y2);
      soup.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1], kind: kind, pi: pi });
    }
    const x0 = ix0 * ux, x1 = ix1 * ux;
    const y0 = iy0 * uy, y1 = iy1 * uy;
    // Module-line ranges for the linear grid. Square patches derive them
    // from the index range; a tile base patch pins them to exclude the far
    // boundary module line (so the 9-shift wrap never double-draws it).
    const hm0 = patch.hm0 !== undefined ? patch.hm0 : Math.ceil(iy0 / 3);
    const hm1 = patch.hm1 !== undefined ? patch.hm1 : Math.floor(iy1 / 3);
    const vm0 = patch.vm0 !== undefined ? patch.vm0 : Math.ceil(ix0 / 3);
    const vm1 = patch.vm1 !== undefined ? patch.vm1 : Math.floor(ix1 / 3);
    // linear grid: true squares on the module lines (every 3rd subcell line)
    let hi = 0;
    for (let m = hm0; m <= hm1; m++, hi++)
      edge(x0, m * modY, x1, m * modY, "h", hi);
    let vi = 0;
    for (let m = vm0; m <= vm1; m++, vi++)
      edge(m * modX, y0, m * modX, y1, "v", vi);
    // triangle field legs: interior lines at the triangle pitch
    // (k % TRI_SUBDIV !== 0 skips the module lines, which belong to the
    // linear grid). The triangle cells are indexed independently of the
    // subcell patch: jx0..jx1 covers the patch at pitch tu.
    const tux = modX / TRI_SUBDIV, tuy = modY / TRI_SUBDIV;
    const jx0 = Math.ceil(ix0 * ux / tux), jx1 = Math.floor(ix1 * ux / tux);
    const jy0 = Math.ceil(iy0 * uy / tuy), jy1 = Math.floor(iy1 * uy / tuy);
    const tx0 = jx0 * tux, tx1 = jx1 * tux, ty0 = jy0 * tuy, ty1 = jy1 * tuy;
    let ti = 0;
    for (let k = jy0; k <= jy1; k++) {
      if (k % TRI_SUBDIV === 0) continue;
      edge(tx0, k * tuy, tx1, k * tuy, "tri", ti++);
    }
    for (let k = jx0; k <= jx1; k++) {
      if (k % TRI_SUBDIV === 0) continue;
      edge(k * tux, ty0, k * tux, ty1, "tri", ti++);
    }
    // triangle field diagonals: one per triangle cell, direction from hash
    // byte 5. The diagonal meets the cell boundary only at its endpoints,
    // so it never needs a mid-span weld within its own layer.
    const dSeed = SeedKit.sliceByte(tokenHash, 5);
    for (let sj = jy0; sj < jy1; sj++) {
      for (let si = jx0; si < jx1; si++) {
        const ax = si * tux, ay = sj * tuy, bx = ax + tux, by = ay + tuy;
        const backslash = ephi(dSeed, si, sj) < 0.5; // \ vs / diagonal
        if (backslash) edge(ax, ay, bx, by, "tri", ti);
        else edge(bx, ay, ax, by, "tri", ti);
        ti++;
      }
    }
    // Breathing circles: one center per subcell — the sim draws two
    // concentric rings on each. The circle field keeps the subcell lattice
    // whatever TRI_SUBDIV is, so unifying the triangle linework never
    // rescales the circle wash.
    for (let sj = iy0; sj < iy1; sj++) {
      for (let si = ix0; si < ix1; si++) {
        const cc = rot(si * ux + ux / 2, sj * uy + uy / 2);
        circles.push({ x: cc[0], y: cc[1] });
      }
    }
    return { soup: soup, circles: circles };
  }

  // Vertex quantization for welding: absorbs float dust from rotated
  // coordinates (1e-6 px is far below any visible threshold).
  const WELD_EPS = 1e-6;

  // Returns null (no touch), {t, u, x, y} (single crossing/touch point),
  // or {collinear:true, t3, t4, u1, u2} for a collinear overlap: e2's
  // endpoints project onto e1 at t3, t4; e1's endpoints onto e2 at u1, u2.
  // Collinearity matters: a rotated triangle edge can lie exactly on a
  // rotated horizontal (the base triangle's horizontal edges coincide with
  // linear spans), so overlap endpoints must weld too.
  function segIntersect(e1, e2, verts) {
    const p1 = verts[e1.a], p2 = verts[e1.b];
    const p3 = verts[e2.a], p4 = verts[e2.b];
    const dx1 = p2.x - p1.x, dy1 = p2.y - p1.y;
    const dx2 = p4.x - p3.x, dy2 = p4.y - p3.y;
    const den = dx1 * dy2 - dy1 * dx2;
    const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1) || 1;
    // Parallel test must be relative: rotated edges on the same lattice line
    // differ by float noise (~1e-13 in den for |d|~30), far above any
    // absolute epsilon. Real crossings here are >= 30° apart (sinθ >= 0.5),
    // so sinθ < 1e-9 unambiguously means "same line".
    if (den * den < 1e-18 * (dx1 * dx1 + dy1 * dy1) * (dx2 * dx2 + dy2 * dy2)) {
      // Parallel: weld only if collinear (same line within 1e-9 px).
      const c3 = (p3.x - p1.x) * dy1 - (p3.y - p1.y) * dx1;
      const c4 = (p4.x - p1.x) * dy1 - (p4.y - p1.y) * dx1;
      if (Math.abs(c3) > 1e-9 * len1 || Math.abs(c4) > 1e-9 * len1) return null;
      const len12 = dx1 * dx1 + dy1 * dy1;
      const t3 = ((p3.x - p1.x) * dx1 + (p3.y - p1.y) * dy1) / len12;
      const t4 = ((p4.x - p1.x) * dx1 + (p4.y - p1.y) * dy1) / len12;
      const len22 = dx2 * dx2 + dy2 * dy2;
      const u1 = ((p1.x - p3.x) * dx2 + (p1.y - p3.y) * dy2) / len22;
      const u2 = ((p2.x - p3.x) * dx2 + (p2.y - p3.y) * dy2) / len22;
      const lo = Math.max(0, Math.min(t3, t4)), hi = Math.min(1, Math.max(t3, t4));
      if (hi - lo < 1e-12) return null; // touch at endpoints at most: already joined
      return { collinear: true, t3: t3, t4: t4, u1: u1, u2: u2,
               x1: p1.x, y1: p1.y, dx1: dx1, dy1: dy1,
               x2: p3.x, y2: p3.y, dx2: dx2, dy2: dy2 };
    }
    const t = ((p3.x - p1.x) * dy2 - (p3.y - p1.y) * dx2) / den;
    const u = ((p3.x - p1.x) * dy1 - (p3.y - p1.y) * dx1) / den;
    const e = 1e-9;
    if (t < -e || t > 1 + e || u < -e || u > 1 + e) return null;
    const tc = Math.min(1, Math.max(0, t));
    const uc = Math.min(1, Math.max(0, u));
    return { t: tc, u: uc, x: p1.x + tc * dx1, y: p1.y + tc * dy1 };
  }

  // Merge every layer's point-soup edges into one welded graph. Every
  // crossing or touch between any two edges — within a layer (e.g. a
  // down-triangle apex landing on a horizontal) or across layers — becomes a
  // shared vertex, and edges are split there. Sub-edges fully outside the
  // canvas (plus a flex margin) are dropped: max flex is 0.026·S, so they can
  // never enter the frame. Returns:
  //   { verts, edges, parents, byParent, drawOrder, consOrder,
  //     circles, baseVertCount }
  // edges: {a, b, par, sub, len}; parents: {layer, kind, pi}; circles:
  // per-layer [{x, y}] in vertex generation order.
  // Weld with explicit clip bounds. weldEdges(soups, mod, S) is the square
  // wrapper (canvas + 0.06·S flex margin); the tile path passes its own.
  function weldEdgesBounds(soups, mod, x0, y0, x1, y1, clip, kindDraw) {
    const KD = kindDraw || KIND_DRAW;
    const inClip = function (v) {
      return v.x > x0 - clip && v.x < x1 + clip && v.y > y0 - clip && v.y < y1 + clip;
    };
    const vmap = new Map();
    const verts = [];
    function vid(x, y) {
      const k = Math.round(x / WELD_EPS) + "," + Math.round(y / WELD_EPS);
      let i = vmap.get(k);
      if (i === undefined) { i = verts.length; verts.push({ x: x, y: y }); vmap.set(k, i); }
      return i;
    }
    const edges = [];
    soups.forEach(function (s, layer) {
      s.soup.forEach(function (e) {
        const a = vid(e.x1, e.y1), b = vid(e.x2, e.y2);
        if (a === b) return;
        edges.push({ a: a, b: b, layer: layer, kind: e.kind, pi: e.pi });
      });
    });

    // Spatial hash: only nearby edge pairs are ever tested.
    const B = mod;
    const buckets = new Map();
    edges.forEach(function (e, i) {
      const A = verts[e.a], P = verts[e.b];
      const x0 = Math.floor(Math.min(A.x, P.x) / B), x1 = Math.floor(Math.max(A.x, P.x) / B);
      const y0 = Math.floor(Math.min(A.y, P.y) / B), y1 = Math.floor(Math.max(A.y, P.y) / B);
      for (let bx = x0; bx <= x1; bx++) for (let by = y0; by <= y1; by++) {
        const k = bx + "," + by;
        let arr = buckets.get(k);
        if (!arr) { arr = []; buckets.set(k, arr); }
        arr.push(i);
      }
    });
    const splits = edges.map(function () { return []; });
    function addSplit(i, t, x, y) { splits[i].push({ t: t, x: x, y: y }); }
    const seenPair = new Set();
    const iEps = 1e-9;
    buckets.forEach(function (arr) {
      for (let n = 0; n < arr.length; n++) {
        for (let m = n + 1; m < arr.length; m++) {
          const i = arr[n], j = arr[m];
          const pk = i < j ? i * 1e7 + j : j * 1e7 + i;
          if (seenPair.has(pk)) continue;
          seenPair.add(pk);
          const e1 = edges[i], e2 = edges[j];
          if (e1.a === e2.a || e1.a === e2.b || e1.b === e2.a || e1.b === e2.b) continue; // already joined
          const sameGeom = (e1.a === e2.a && e1.b === e2.b) || (e1.a === e2.b && e1.b === e2.a);
          if (sameGeom) continue; // identical duplicates (shared triangle edges): split identically via others
          const r = segIntersect(e1, e2, verts);
          if (!r) continue;
          if (r.collinear) {
            // weld the overlap endpoints that fall strictly inside an edge
            for (const tt of [r.t3, r.t4]) {
              if (tt > iEps && tt < 1 - iEps)
                addSplit(i, tt, r.x1 + tt * r.dx1, r.y1 + tt * r.dy1);
            }
            for (const uu of [r.u1, r.u2]) {
              if (uu > iEps && uu < 1 - iEps)
                addSplit(j, uu, r.x2 + uu * r.dx2, r.y2 + uu * r.dy2);
            }
            continue;
          }
          const tIn = r.t > iEps && r.t < 1 - iEps;
          const uIn = r.u > iEps && r.u < 1 - iEps;
          if (tIn && uIn) { addSplit(i, r.t, r.x, r.y); addSplit(j, r.u, r.x, r.y); }
          else if (tIn) addSplit(i, r.t, r.x, r.y); // e2's endpoint touches e1
          else if (uIn) addSplit(j, r.u, r.x, r.y); // e1's endpoint touches e2
          // endpoint-endpoint: already the same vertex via vid()
        }
      }
    });

    // Split every edge at its collected points, in order along the edge.
    // Sub-edges fully outside the clip bounds are dropped.
    const sub = [];
    edges.forEach(function (e, i) {
      const sp = splits[i];
      if (!sp.length) {
        const A0 = verts[e.a], B0 = verts[e.b];
        if (inClip(A0) || inClip(B0)) {
          const dx0 = B0.x - A0.x, dy0 = B0.y - A0.y;
          sub.push({ a: e.a, b: e.b, layer: e.layer, kind: e.kind, pi: e.pi, sub: 0,
                     len: Math.sqrt(dx0 * dx0 + dy0 * dy0) });
        }
        return;
      }
      sp.sort(function (p, q) { return p.t - q.t; });
      const pts = [{ t: 0, v: e.a }];
      sp.forEach(function (s) {
        const last = pts[pts.length - 1];
        if (Math.abs(s.t - last.t) < 1e-9) return;
        const v = vid(s.x, s.y);
        if (v === last.v) return;
        pts.push({ t: s.t, v: v });
      });
      const last = pts[pts.length - 1];
      if (last.v !== e.b && Math.abs(1 - last.t) >= 1e-9) pts.push({ t: 1, v: e.b });
      else if (last.v !== e.b) last.t = 1;
      for (let k = 0; k < pts.length - 1; k++) {
        if (pts[k].v === pts[k + 1].v) continue;
        const A = verts[pts[k].v], B = verts[pts[k + 1].v];
        if (!inClip(A) && !inClip(B)) continue;
        const dx = B.x - A.x, dy = B.y - A.y;
        sub.push({ a: pts[k].v, b: pts[k + 1].v, layer: e.layer, kind: e.kind,
                   pi: e.pi, sub: k, len: Math.sqrt(dx * dx + dy * dy) });
      }
    });

    // Deterministic vertex order: sort by (y, x), remap, then sort edges.
    const order = verts.map(function (v, i) { return i; })
      .sort(function (a, b) { return verts[a].y - verts[b].y || verts[a].x - verts[b].x; });
    const remap = new Array(verts.length);
    const sverts = order.map(function (old, ni) { remap[old] = ni; return verts[old]; });
    sub.forEach(function (e) { e.a = remap[e.a]; e.b = remap[e.b]; });
    sub.sort(function (p, q) {
      return p.layer - q.layer || p.a - q.a || p.b - q.b || p.sub - q.sub;
    });

    // Parents in first-appearance order; consumption/draw orders derived.
    const pmap = new Map();
    const parents = [];
    sub.forEach(function (e) {
      const k = e.layer + ":" + e.kind + ":" + e.pi;
      let pi = pmap.get(k);
      if (pi === undefined) { pi = parents.length; parents.push({ layer: e.layer, kind: e.kind, pi: e.pi }); pmap.set(k, pi); }
      e.par = pi;
    });
    const byParent = parents.map(function () { return []; });
    sub.forEach(function (e, i) { byParent[e.par].push(i); });
    byParent.forEach(function (list) {
      list.sort(function (a, b) { return sub[a].sub - sub[b].sub; });
    });
    // Parent centroids (mean of sub-edge midpoints, in graph coordinates):
    // the motion wave keys each parent's wobble phase to its position, so
    // the lattice undulates coherently instead of shimmering at random.
    parents.forEach(function (par, pi) {
      const list = byParent[pi];
      let sx = 0, sy = 0;
      for (let li = 0; li < list.length; li++) {
        const e = sub[list[li]];
        const A = sverts[e.a], B = sverts[e.b];
        sx += (A.x + B.x) * 0.5; sy += (A.y + B.y) * 0.5;
      }
      par.cx = list.length ? sx / list.length : 0;
      par.cy = list.length ? sy / list.length : 0;
    });
    const consOrder = parents.map(function (p, i) { return i; }).sort(function (a, b) {
      const A = parents[a], B = parents[b];
      return A.layer - B.layer || KIND_ORD[A.kind] - KIND_ORD[B.kind] || A.pi - B.pi;
    });
    const drawOrder = parents.map(function (p, i) { return i; }).sort(function (a, b) {
      const A = parents[a], B = parents[b];
      return B.layer - A.layer || KD[A.kind] - KD[B.kind] || A.pi - B.pi;
    });
    return { verts: sverts, edges: sub, parents: parents, byParent: byParent,
             drawOrder: drawOrder, consOrder: consOrder,
             circles: soups.map(function (s) { return s.circles; }) };
  }

  function weldEdges(soups, mod, S, kindDraw) {
    const clip = S * 0.06;
    return weldEdgesBounds(soups, mod, -clip, -clip, S + clip, S + clip, 0, kindDraw);
  }

  // Per-parent edge alpha. Every layer breathes gently (±16%) around a
  // 0.45–0.85 tone base — floor 0.378 on the base layer — so no stroke ever
  // dips near invisibility while sweeping through its motion (the token-13
  // pop fix, extended here to the triangle outlines too). LAYER_DIM is
  // currently [0.66,0.66,0.66]: all linework renders at 66% alpha.
  function edgeAlpha(kind, layer, toneVal, m, pidx, phase) {
    const base = (0.45 + toneVal * 0.40) * (1 + 0.08 * osc(m.k, ephi(m.seed, pidx, kind === "tri" ? 3 : 7), phase));
    return base * LAYER_DIM[layer];
  }

  const graphCache = new Map();

  function fusedGraph(tokenHash, S, mod, gridKey) {
    gridKey = gridKey || "fusion";
    const key = tokenHash + "|" + S + "|tri" + TRI_SUBDIV + "|" + gridKey;
    let G = graphCache.get(key);
    if (G) return G;
    const m = S * 0.22;
    const soups = [
      layerSoup(tokenHash, mod, S, 0, gridPatch(mod, S, 0)),
      layerSoup(tokenHash, mod, S, 1, gridPatch(mod, S, m)),
      layerSoup(tokenHash, mod, S, 2, gridPatch(mod, S, m)),
    ];
    G = weldEdges(soups, mod, S, kindDrawFor(gridKey));
    // base lattice vertex count, for scaling the accent-dot density
    const bp = gridPatch(mod, S, 0);
    let n = 0;
    for (let i = bp.i0; i <= bp.i1; i++) {
      const x = i * bp.u;
      if (x < 0 || x > S) continue;
      for (let j = bp.i0; j <= bp.i1; j++) {
        const y = j * bp.u;
        if (y >= 0 && y <= S) n++;
      }
    }
    G.baseVertCount = n;
    G.parBBox = parentBBoxes(G);
    if (graphCache.size > 48) graphCache.clear(); // bound memory: the gallery holds many tokens
    graphCache.set(key, G);
    return G;
  }

  // Textile tile mode: absolute layer angles (the base layer sits at 0° so
  // its module grid is exactly periodic with the tile; the duplicates keep
  // their +30°/+60° relative offsets and are edge-masked at draw time).
  const TILE_ANGLES = [0, Math.PI / 6, Math.PI / 3];
  // Fraction of the tile's short side over which the rotated duplicates fade
  // to zero alpha at the tile edges (seam guarantee for non-periodic layers).
  const TILE_MASK_FADE = 0.08;

  // Rectangular module patch covering [x0,x1]×[y0,y1] in unrotated coords.
  function tilePatch(modX, modY, x0, x1, y0, y1) {
    const ux = modX / 3, uy = modY / 3;
    return { ux: ux, uy: uy, modX: modX, modY: modY,
             ix0: Math.floor(x0 / ux), ix1: Math.ceil(x1 / ux),
             iy0: Math.floor(y0 / uy), iy1: Math.ceil(y1 / uy) };
  }

  // Smooth rectangular edge mask: 0 at the tile boundary, 1 once fadeW
  // inside. Used for the rotated duplicate layers, which are not periodic
  // and therefore cannot wrap.
  function tileMask(W, H, x, y) {
    const fw = TILE_MASK_FADE * Math.min(W, H);
    const d = Math.min(x, W - x, y, H - y);
    if (d <= 0) return 0;
    if (d >= fw) return 1;
    const t = d / fw;
    return t * t * (3 - 2 * t);
  }

  // Per-parent bounding boxes, in graph coords. Used for 9-shift wrap
  // culling (tile) and for sizing shard rotation (both modes).
  function parentBBoxes(G) {
    return G.parents.map(function (par, pi) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const verts = G.verts, list = G.byParent[pi];
      for (let i = 0; i < list.length; i++) {
        const se = G.edges[list[i]];
        const A = verts[se.a], B = verts[se.b];
        if (A.x < x0) x0 = A.x; if (B.x < x0) x0 = B.x;
        if (A.y < y0) y0 = A.y; if (B.y < y0) y0 = B.y;
        if (A.x > x1) x1 = A.x; if (B.x > x1) x1 = B.x;
        if (A.y > y1) y1 = A.y; if (B.y > y1) y1 = B.y;
      }
      return [x0, y0, x1, y1];
    });
  }

  // Fused graph for a W×H textile tile. Layer 0 is generated at 0° over
  // exactly [0,W]×[0,H] with nCols×nRows modules (modX = W/nCols exactly, so
  // the grid is periodic with the tile); layers 1–2 are generated over the
  // unrotated pre-image of the tile and rotated about the tile center.
  // Cached separately from the square graph.
  function fusedGraphTile(tokenHash, W, H, modX, modY, nCols, nRows, gridKey) {
    gridKey = gridKey || "fusion";
    const key = tokenHash + "|tile|" + W + "x" + H + "|tri" + TRI_SUBDIV + "|" + gridKey;
    let G = graphCache.get(key);
    if (G) return G;
    const cx = W / 2, cy = H / 2;
    const soups = [];
    // Base: exact tile, far boundary module lines excluded so the 9-shift
    // wrap draws every toroidal line exactly once.
    soups.push(layerSoup(tokenHash, modX, 0, 0,
      { ux: modX / 3, uy: modY / 3, modX: modX, modY: modY,
        ix0: 0, ix1: 3 * nCols, iy0: 0, iy1: 3 * nRows,
        hm0: 0, hm1: nRows - 1, vm0: 0, vm1: nCols - 1 },
      cx, cy, TILE_ANGLES));
    // Rotated duplicates: patch covers the unrotated pre-image of the tile
    // plus one module of margin (bow overhang).
    for (let layer = 1; layer < 3; layer++) {
      const th = TILE_ANGLES[layer];
      const c = Math.abs(Math.cos(th)), s = Math.abs(Math.sin(th));
      const ex = (W / 2) * c + (H / 2) * s + modX;
      const ey = (W / 2) * s + (H / 2) * c + modY;
      const rp = tilePatch(modX, modY, cx - ex, cx + ex, cy - ey, cy + ey);
      soups.push(layerSoup(tokenHash, modX, 0, layer, rp, cx, cy, TILE_ANGLES));
    }
    G = weldEdgesBounds(soups, Math.min(modX, modY), -W, -H, 2 * W, 2 * H, 0, kindDrawFor(gridKey));
    G.baseVertCount = (nCols + 1) * (nRows + 1);
    G.tile = { W: W, H: H, modX: modX, modY: modY, nCols: nCols, nRows: nRows };
    // Per-parent bounding boxes (tile coords) for 9-shift wrap culling.
    G.parBBox = parentBBoxes(G);
    // Per-vertex minimum incident layer (for masking accent dots by layer).
    const vlayer = new Array(G.verts.length).fill(3);
    G.edges.forEach(function (se) {
      if (se.layer < vlayer[se.a]) vlayer[se.a] = se.layer;
      if (se.layer < vlayer[se.b]) vlayer[se.b] = se.layer;
    });
    G.vertLayer = vlayer;
    if (graphCache.size > 48) graphCache.clear();
    graphCache.set(key, G);
    return G;
  }

  // Motion parameters drawn from their OWN domain stream ("motion"), so
  // adding animation never shifts the structure/tone/accent streams. Drawn in
  // a fixed order; legacy entries that no longer drive geometry (shingle,
  // concentric) are still drawn so the stream positions that follow can never
  // shift under existing pieces.
  // These drive the gentle ±8% alpha breathing and the cell-centered circle
  // pulse. The lattice's big motion is the shatter system below, on its own
  // "motion:shatter*" streams. Stream consumption is unchanged.
  function drawSys(s, ampMul) {
    return { k: 1 + Math.floor(s() * 3), amp: (0.005 + s() * 0.008) * (ampMul || 1), seed: s() * 100 };
  }

  // Builds one parent's path as a shard (used by rasterWelded for every
  // mode). Each parent is one shard: when its shatter envelope is 0 the
  // path is drawn exactly in place (straight edges, identical to the static
  // piece); mid-envelope the whole shard is rotated about its own centroid,
  // stretched outward from it (k >= 1, seeded per shard), and translated
  // outward, so the lattice obliterates into flying, extending pieces and
  // reconfigures back into place. Because every shard's envelope is
  // periodic in the loop phase, the animation loops seamlessly.
  function buildShardPath(ctx, G, par, list, shardXf, parIdx) {
    const verts = G.verts, edges = G.edges;
    const tr = shardXf[parIdx];
    if (!tr) {
      for (let li = 0; li < list.length; li++) {
        const e = edges[list[li]];
        const A = verts[e.a], B = verts[e.b];
        ctx.moveTo(A.x, A.y);
        ctx.lineTo(B.x, B.y);
      }
      return;
    }
    const cx = par.cx, cy = par.cy;
    const cos = tr.c, sin = tr.s, dx = tr.dx, dy = tr.dy, k = tr.k;
    for (let li = 0; li < list.length; li++) {
      const e = edges[list[li]];
      const A = verts[e.a], B = verts[e.b];
      const ax = (A.x - cx) * k, ay = (A.y - cy) * k;
      const bx = (B.x - cx) * k, by = (B.y - cy) * k;
      ctx.moveTo(cx + ax * cos - ay * sin + dx, cy + ax * sin + ay * cos + dy);
      ctx.lineTo(cx + bx * cos - by * sin + dx, cy + bx * sin + by * cos + dy);
    }
  }

  // Simulation: consumes all motion/tone/structure streams and computes the
  // per-frame values that do not depend on canvas state. cullBox ({x0,y0,x1,
  // x2} in canvas coords) skips off-canvas circles WITHOUT consuming their
  // streams (preserves the square path's exact stream alignment); pass null
  // to keep every circle (tile mode culls per shift at raster time).
  // holdBox is the visible window [x0,y0,x1,y1] (square path) or null (tile
  // mode): the shatter's amplitude damps to zero at the frame's edge, so
  // linework crossing the frame keeps crossing it at every phase.
  function weldedSim(G, P, t, tokenHash, SU, unit, phase, cullBox, fieldRegion, holdBox) {
    const mots = [];
    const sM = SeedKit.streamFor(tokenHash, "motion");
    const mLin = drawSys(sM, 2); drawSys(sM); drawSys(sM); drawSys(sM); // + shingle, concentric (legacy order)
    const sMT = SeedKit.streamFor(tokenHash, "motion:overlay");
    drawSys(sMT); const mTri = drawSys(sMT, 1.5); drawSys(sMT); drawSys(sMT);
    mots.push({ lin: mLin, tri: mTri });
    ["dup30", "dup60"].forEach(function (tag) {
      const s = SeedKit.streamFor(tokenHash, "motion:" + tag);
      mots.push({ lin: drawSys(s, 2), tri: drawSys(s, 1.5) });
    });

    // Per-parent alpha, consumed in a fixed order per layer.
    const toneStreams = [
      SeedKit.streamFor(tokenHash, "tone"),
      SeedKit.streamFor(tokenHash, "tone:dup30"),
      SeedKit.streamFor(tokenHash, "tone:dup60"),
    ];
    const alpha = new Float64Array(G.parents.length);
    G.consOrder.forEach(function (parIdx, ci) {
      const par = G.parents[parIdx];
      const m = par.kind === "tri" ? mots[par.layer].tri : mots[par.layer].lin;
      alpha[parIdx] = edgeAlpha(par.kind, par.layer, toneStreams[par.layer](), m, ci, phase);
    });

    // Shatter system: one shard per parent. Params come from their own
    // domain streams ("motion:shatter*"), drawn in the same fixed consOrder,
    // so legacy stream positions never shift. Each shard flies outward from
    // the epicenter (with a seeded direction jitter), twists out and back
    // about its own centroid (seeded direction, max ~120°, unwound before
    // the radial wave finishes so it glides home straight with no snap), stretches outward
    // from that centroid (seeded amount, scaled by the envelope, so the
    // lines protrude and extend mid-flight), and waits its turn on a radial
    // delay — the obliteration radiates outward and reassembles in the
    // same order.
    const field = shatterField(tokenHash, SU, fieldRegion);
    const shatterStreams = [
      SeedKit.streamFor(tokenHash, "motion:shatter"),
      SeedKit.streamFor(tokenHash, "motion:shatter:dup30"),
      SeedKit.streamFor(tokenHash, "motion:shatter:dup60"),
    ];
    const shardXf = new Array(G.parents.length);
    const mu = motionMu(phase); // -1 at rest: every shard transform is null
    G.consOrder.forEach(function (parIdx) {
      const par = G.parents[parIdx];
      const sS = shatterStreams[par.layer];
      const u1 = sS(), u2 = sS(), u3 = sS(), u4 = sS(), u5 = sS();
      const dx0 = par.cx - field.x, dy0 = par.cy - field.y;
      const ang = Math.atan2(dy0, dx0) + (u2 - 0.5) * 1.4;
      const mag = SU * (0.02 + 0.11 * u1) * 0.67; // flight cut 33%: 0.0134–0.0871·SU
      const dir = u3 < 0.5 ? -1 : 1; // seeded spin direction (u3 still consumed: stream order unchanged)
      const stretch = 0.15 + 0.45 * u5; // shard grows 1.15–1.60x at envelope peak
      // Radial delay, bounded by SHATTER_DMAX (0.20/1.12) so delay + envelope
      // active zone (0.80) <= 1: every shard finishes reconfiguring exactly
      // as the motion window closes, and at rest all local clocks sit in
      // the forced rest zone (static piece intact).
      const delay = shatterDelay(field, par.cx, par.cy, SU, u4);
      const x = mu < 0 ? 0 : frac(mu - delay); // the shard's local clock
      const e = mu < 0 ? 0 : shatterEnv(x);
      // Frame hold: the envelope is scaled by the shard's hold weight, so
      // shards near the frame's edge stay pinned to their rest geometry and
      // the linework keeps bleeding past the frame at every phase. The
      // shard stays rigid — the whole transform simply shrinks toward rest.
      const holdW = holdWeight(par.cx, par.cy, holdBox, SU);
      const we = e * holdW;
      // Slow out-and-back twist: rises to SPIN_TURNS seeded-direction turns
      // at mid-flight, then unwinds — scaled by the hold weight so
      // edge-pinned shards stay pinned. The twist reaches exactly 0 as the
      // envelope closes, so the shard slides back into place with no snap.
      const spin = dir * TAU * SPIN_TURNS * spinTwist(x) * holdW;
      shardXf[parIdx] = we === 0 ? null : {
        c: Math.cos(spin), s: Math.sin(spin),
        dx: Math.cos(ang) * mag * we, dy: Math.sin(ang) * mag * we,
        k: 1 + stretch * we,
      };
    });

    // Inscribed circle field per layer. Streams are consumed per layer in
    // circle generation order (layer 2, 1, 0). Circles ride the same radial
    // wave as the shards, flying outward from the epicenter at full
    // visibility — no dissolve. unit is the subcell (mod/3): the circle
    // field always keeps the subcell lattice, independent of TRI_SUBDIV.
    const circles = [[], [], []];
    for (let layer = 2; layer >= 0; layer--) {
      const sS = SeedKit.streamFor(tokenHash, layer === 0 ? "structure:overlay" : "structure:dup" + (layer === 1 ? "30" : "60"));
      const sT = SeedKit.streamFor(tokenHash, layer === 0 ? "tone:overlay" : "tone:dup" + (layer === 1 ? "30" : "60"));
      const m = mots[layer].tri;
      const cl = G.circles[layer] || [];
      for (let ci = 0; ci < cl.length; ci++) {
        if (cullBox && (cl[ci].x < cullBox.x0 || cl[ci].x > cullBox.x1 ||
                        cl[ci].y < cullBox.y0 || cl[ci].y > cullBox.y1)) continue;
        const dly = shatterDelay(field, cl[ci].x, cl[ci].y, SU, ephi(m.seed, ci, 11));
        // Outward flight on the radial wave: seeded per-circle fraction of
        // the radial distance, drawn from a pure function (no stream), so no
        // stream positions shift.
        const e = mu < 0 ? 0 : shatterEnv(frac(mu - dly));
        const uf = ephi(m.seed, ci, 17);
        const outFrac = (CIRCLE_FLY[0] + (CIRCLE_FLY[1] - CIRCLE_FLY[0]) * uf) * e;
        circles[layer].push({
          x: cl[ci].x + (cl[ci].x - field.x) * outFrac,
          y: cl[ci].y + (cl[ci].y - field.y) * outFrac,
          ci: ci,
          baseR: unit * (CIRCLE_R[0] + sS() * (CIRCLE_R[1] - CIRCLE_R[0])),
          baseA: (0.14 + sT() * 0.26) * LAYER_DIM[layer],
          baseR2: unit * (CIRCLE_R2[0] + sS() * (CIRCLE_R2[1] - CIRCLE_R2[0])),
          baseA2: (0.10 + sT() * 0.18) * LAYER_DIM[layer],
        });
      }
    }
    return { mots: mots, alpha: alpha, circles: circles, shardXf: shardXf };
  }

  // Raster: draws the welded linework + circle field.
  // opts.wrap: null (square) or {W,H} — 9-shift toroidal wrap for the
  //   periodic base layer (tile mode).
  // opts.layer: null (all layers) or a single layer index (tile mode).
  // opts.mask: null or function(x, y) -> 0..1 — edge fade for the rotated
  //   duplicate layers (tile mode). Masked strokes are grouped into
  //   MASK_LEVELS quantized alpha buckets per parent.
  function rasterWelded(ctx, sim, G, P, SU, unit, strokeW, phase, opts) {
    opts = opts || {};
    const wrap = opts.wrap || null;
    const layerFilter = (opts.layer === undefined || opts.layer === null) ? null : opts.layer;
    const maskFn = opts.mask || null;
    const MASK_LEVELS = 24;
    const mots = sim.mots, alpha = sim.alpha, circles = sim.circles;
    const shardXf = sim.shardXf;
    const verts = G.verts, edges = G.edges, parents = G.parents;
    const drawOrder = G.drawOrder, byParent = G.byParent;
    line(ctx, Math.max(0.5, strokeW));

    // Visible 9-shift offsets for a parent bbox (tile coords == canvas
    // coords in tile mode: no zoom). Expanded by the max shard flight so a
    // shattered parent near the tile edge still draws its wrapped copies.
    function shiftsFor(bb) {
      const mg = 0.20 * SU;
      const x0 = bb[0] - mg, y0 = bb[1] - mg, x1 = bb[2] + mg, y1 = bb[3] + mg;
      const out = [];
      for (let sj = -1; sj <= 1; sj++) for (let si = -1; si <= 1; si++) {
        if (x0 + si * wrap.W < wrap.W && x1 + si * wrap.W > 0 &&
            y0 + sj * wrap.H < wrap.H && y1 + sj * wrap.H > 0) out.push([si, sj]);
      }
      return out;
    }

    // Stroke every parent's sub-edges. Dim layers first, base layer last;
    // within each layer the stroke order follows the grid trait — triangle
    // field under the linear grid, or inverted (field over grid).
    //
    // Hot path: plain for-loops; each shard's transform is computed once
    // per parent in the sim, so the raster is just rotate+translate math.
    for (let di = 0; di < drawOrder.length; di++) {
      const parIdx = drawOrder[di];
      const par = parents[parIdx];
      if (layerFilter !== null && par.layer !== layerFilter) continue;
      const list = byParent[parIdx];
      if (!list.length) continue;
      if (wrap && !maskFn) {
        const shifts = shiftsFor(G.parBBox[parIdx]);
        for (let s = 0; s < shifts.length; s++) {
          ctx.save();
          ctx.translate(shifts[s][0] * wrap.W, shifts[s][1] * wrap.H);
          ctx.strokeStyle = LAYER_TINT[par.layer];
          ctx.globalAlpha = alpha[parIdx];
          ctx.beginPath();
          buildShardPath(ctx, G, par, list, shardXf, parIdx);
          ctx.stroke();
          ctx.restore();
        }
      } else if (maskFn) {
        const buckets = new Map();
        for (let li = 0; li < list.length; li++) {
          const e = edges[list[li]];
          const A = verts[e.a], B = verts[e.b];
          if ((A.x < 0 && B.x < 0) || (A.x > wrap.W && B.x > wrap.W) ||
              (A.y < 0 && B.y < 0) || (A.y > wrap.H && B.y > wrap.H)) continue;
          const mk = maskFn((A.x + B.x) / 2, (A.y + B.y) / 2);
          if (mk < 0.02) continue;
          const lv = Math.min(MASK_LEVELS - 1, Math.floor(mk * MASK_LEVELS));
          let arr = buckets.get(lv);
          if (!arr) { arr = []; buckets.set(lv, arr); }
          arr.push(list[li]);
        }
        if (!buckets.size) continue;
        const lvs = Array.from(buckets.keys()).sort(function (a, b) { return a - b; });
        for (let vi = 0; vi < lvs.length; vi++) {
          const lv = lvs[vi];
          ctx.strokeStyle = LAYER_TINT[par.layer];
          ctx.globalAlpha = alpha[parIdx] * (lv + 0.5) / MASK_LEVELS;
          ctx.beginPath();
          buildShardPath(ctx, G, par, buckets.get(lv), shardXf, parIdx);
          ctx.stroke();
        }
      } else {
        ctx.strokeStyle = LAYER_TINT[par.layer];
        ctx.globalAlpha = alpha[parIdx];
        ctx.beginPath();
        buildShardPath(ctx, G, par, list, shardXf, parIdx);
        ctx.stroke();
      }
    }

    // Inscribed circle field: the cross-section layer. Two concentric
    // breathing rings per grid cell, centered on the cell, in the layer's
    // tint.
    const circleLayers = layerFilter !== null ? [layerFilter] : [2, 1, 0];
    for (let li = 0; li < circleLayers.length; li++) {
      const layer = circleLayers[li];
      const m = mots[layer].tri;
      // Slower breathing: half the layer's oscillator rate (rounded up), so
      // the wash breathes at 1–2 cycles per loop instead of 1–3.
      const ck = Math.max(1, Math.ceil(m.k / 2));
      const cl = circles[layer];
      // Draws one wash ring in the layer's tint; the wrap/mask branches are
      // shared by both concentric rings of each subcell.
      function ring(x, y, rad, a) {
        if (wrap && !maskFn) {
          for (let sj = -1; sj <= 1; sj++) for (let si = -1; si <= 1; si++) {
            const wx = x + si * wrap.W, wy = y + sj * wrap.H;
            if (wx < -rad || wx > wrap.W + rad || wy < -rad || wy > wrap.H + rad) continue;
            ctx.fillStyle = LAYER_TINT[layer];
            ctx.globalAlpha = a;
            ctx.beginPath();
            ctx.arc(wx, wy, rad, 0, TAU);
            ctx.fill();
          }
        } else if (maskFn) {
          if (x < -rad || x > wrap.W + rad || y < -rad || y > wrap.H + rad) return;
          const mk = maskFn(x, y);
          if (mk < 0.02) return;
          ctx.fillStyle = LAYER_TINT[layer];
          ctx.globalAlpha = a * mk;
          ctx.beginPath();
          ctx.arc(x, y, rad, 0, TAU);
          ctx.fill();
        } else {
          ctx.fillStyle = LAYER_TINT[layer];
          ctx.globalAlpha = a;
          ctx.beginPath();
          ctx.arc(x, y, rad, 0, TAU);
          ctx.fill();
        }
      }
      for (let ci = 0; ci < cl.length; ci++) {
        const c = cl[ci];
        // cell-centered: the radius peaks at 0.38·unit × 1.3 ≈ 0.494·unit,
        // inside the half-unit cell, overlapping the triangle field.
        const rad = c.baseR * (1 + 0.3 * osc(ck, ephi(m.seed, c.ci, 9), phase));
        // Inner ring: smaller, slightly fainter, breathing on its own seeded
        // phase so the pair reads as two rings, not one doubled stroke.
        const rad2 = c.baseR2 * (1 + 0.3 * osc(ck, ephi(m.seed, c.ci, 21), phase));
        ring(c.x, c.y, rad, c.baseA);
        ring(c.x, c.y, rad2, c.baseA2);
      }
    }
    ctx.globalAlpha = 1;
  }

  // The visible window in composition coords: the zoom is a ctx transform,
  // so the shatter wave normalizes to what the viewer actually sees.
  function visibleRegion(S) {
    const r = S / (2 * ZOOM);
    return [S / 2 - r, S / 2 - r, S / 2 + r, S / 2 + r];
  }

  // Frame-hold weight for one point (a shard centroid or circle center)
  // against the visible window box (or null: no hold, weight 1). 0 at the
  // frame's edge — linework anchored there keeps bleeding past the frame at
  // every phase — ramping smoothly to 1 over EDGE_HOLD·S inside, so there
  // is no visible pinned/moving seam. Shards are weighted by centroid, not
  // bbox: a long grid line stays wild in the interior even while its far
  // end holds the frame.
  function holdWeight(x, y, box, S) {
    if (!box) return 1;
    if (x < box[0] || x > box[2] || y < box[1] || y > box[3]) return 0;
    const d = Math.min(x - box[0], box[2] - x, y - box[1], box[3] - y);
    if (d <= 0) return 0;
    const f = EDGE_HOLD * S;
    return d >= f ? 1 : sstep(0, f, d);
  }

  function drawWelded(ctx, S, G, unit, P, t, tokenHash, phase) {
    const cr = unit; // max circle radius < 0.3·unit; cull provably off-canvas
    const sim = weldedSim(G, P, t, tokenHash, S, unit, phase,
      { x0: -cr, y0: -cr, x1: S + cr, y1: S + cr }, visibleRegion(S), visibleRegion(S));
    rasterWelded(ctx, sim, G, P, S, unit, S / 1240, phase, null);
  }

  // --- Accent layer: the inner and outer dot rings --------------------------
  // Every piece carries an inner ring of ACCENT_DOTS dots plus an outer
  // ring of up to ACCENT_DOTS_OUTER dots, all on the square-grid vertices
  // of the linear grid — the inner ring on the vertices nearest the piece
  // center, the outer ring on the grid's outer vertices nearest the frame
  // edge (claiming only what the inner ring left; sparse fields 12+0,
  // standard and dense field 12+12). Each dot sits exactly on a linear-grid
  // intersection — never on a diagonal crossing. Every dot draws at the
  // same smaller size; colors come from the piece's hue set. Dots are
  // pinned to vertices at a constant radius. As the lattice shatters, each
  // dot rides the same radial wave as the shards around it — flying
  // outward from the epicenter with the lattice (a seeded fraction of
  // their radial distance, so they never overshoot). The accent layer
  // keeps full visibility through the whole motion — the dots fly without
  // dissolving, and settle back as the lattice reconfigures.
  // Square-grid vertices of the linear grid: a welded vertex qualifies when
  // some layer has two perpendicular axis-aligned incident edges, measured
  // in that layer's own rotated frame. Diagonals sit at 45 degrees and never
  // qualify, so the set is exactly the square grid's intersections — never a
  // diagonal crossing. Needs only the per-layer angles, so it works for the
  // square path (LAYER_ANGLES) and the tile path (TILE_ANGLES) alike.
  function squareGridVertSet(G, angles) {
    const set = new Set();
    const n = G.verts.length;
    const bits = new Uint8Array(n * 3); // per vertex per layer: 1 = axis-u, 2 = axis-v
    const cosA = angles.map(function (a) { return Math.cos(a); });
    const sinA = angles.map(function (a) { return Math.sin(a); });
    for (let ei = 0; ei < G.edges.length; ei++) {
      const e = G.edges[ei];
      const L = e.layer;
      const A = G.verts[e.a], B = G.verts[e.b];
      const dx = B.x - A.x, dy = B.y - A.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) continue;
      const au = Math.abs((dx * cosA[L] + dy * sinA[L]) / len);
      const av = Math.abs((-dx * sinA[L] + dy * cosA[L]) / len);
      let bit = 0;
      if (au > 0.99999) bit = 1;
      else if (av > 0.99999) bit = 2;
      if (bit) { bits[e.a * 3 + L] |= bit; bits[e.b * 3 + L] |= bit; }
    }
    for (let i = 0; i < n; i++)
      for (let L = 0; L < 3; L++)
        if ((bits[i * 3 + L] & 3) === 3) { set.add(i); break; }
    return set;
  }

  // Simulation: consumes the accent-dot streams and computes per-dot
  // placement, color, and wave flight (the accent layer keeps full
  // visibility through the motion). gridRegion is [x0, y0, x1, y1]: the
  // square path passes the visible window, tile mode passes the whole
  // tile; its center anchors the ring and a dot-radius margin keeps every
  // dot on-canvas. angles is the path's per-layer rotation table
  // (LAYER_ANGLES for the square piece, TILE_ANGLES for tiles). The inner
  // ring is the ACCENT_DOTS square-grid vertices nearest the region center
  // and the outer ring is the ACCENT_DOTS_OUTER square-grid vertices
  // farthest from it (see squareGridVertSet), so every dot sits exactly on
  // a linear-grid intersection — never on a diagonal crossing. For the
  // tile, vertLayer (minimum incident layer per vertex) lets the raster
  // wrap only base-layer dots and mask the rotated-layer ones.
  function dotsSim(G, P, t, tokenHash, SU, unit, phase, gridRegion, fieldRegion, angles) {
    if (!P.accents.length) return null;
    const sColor = SeedKit.streamFor(tokenHash, "accent-dots:color");
    const sM = SeedKit.streamFor(tokenHash, "motion:accent-dots");
    const k = 1 + Math.floor(sM() * 2), seed = sM() * 100;
    const field = shatterField(tokenHash, SU, fieldRegion);
    const mu = motionMu(phase); // -1 at rest: no flight, dots on their vertices
    const verts = G.verts;
    const gridVerts = squareGridVertSet(G, angles || LAYER_ANGLES);
    const cx = (gridRegion[0] + gridRegion[2]) / 2, cy = (gridRegion[1] + gridRegion[3]) / 2;
    const margin = unit; // dots may kiss the region edge
    const rx0 = gridRegion[0] - margin, ry0 = gridRegion[1] - margin;
    const rx1 = gridRegion[2] + margin, ry1 = gridRegion[3] + margin;
    const cand = [];
    for (let i = 0; i < verts.length; i++) {
      if (!gridVerts.has(i)) continue;
      const vx = verts[i].x, vy = verts[i].y;
      if (vx < rx0 || vx > rx1 || vy < ry0 || vy > ry1) continue;
      const dx = vx - cx, dy = vy - cy;
      cand.push({ i: i, d2: dx * dx + dy * dy });
    }
    // The rings: nearest-to-center first, vertex index breaking ties so the
    // selection is deterministic down to float-identical distances. The
    // inner ring takes the ACCENT_DOTS nearest candidates; the outer ring
    // takes the ACCENT_DOTS_OUTER farthest, skipping vertices the inner
    // ring already claimed so the two rings never share a dot.
    cand.sort(function (a, b) { return a.d2 - b.d2 || a.i - b.i; });
    const dots = [];
    const used = new Set();
    function pushDot(bi) {
      const v = verts[bi];
      const uf = sM(); // per-dot outward-flight jitter
      const color = P.accents[Math.floor(sColor() * P.accents.length) % P.accents.length];
      const dly = shatterDelay(field, v.x, v.y, SU, ephi(seed, bi, 13));
      const e = mu < 0 ? 0 : shatterEnv(frac(mu - dly));
      // Outward wave: the same radial wave as the shards — the dot flies
      // outward from the epicenter with the lattice.
      const outFrac = (DOT_OUTWARD[0] + (DOT_OUTWARD[1] - DOT_OUTWARD[0]) * uf) * e;
      // Full visibility: no dissolve — the accent layer stays at full
      // alpha through the whole motion sequence.
      dots.push({
        x: v.x + (v.x - field.x) * outFrac, y: v.y + (v.y - field.y) * outFrac,
        color: color,
        layer: G.vertLayer ? G.vertLayer[bi] : 0,
      });
      used.add(bi);
    }
    const n = Math.min(ACCENT_DOTS, cand.length);
    for (let m = 0; m < n; m++) pushDot(cand[m].i);
    // Outer ring: farthest-from-center first, same deterministic tie-break.
    // Stream draws happen after the inner ring's, so the inner ring's
    // colors and flight are byte-identical to the single-ring pieces.
    cand.sort(function (a, b) { return b.d2 - a.d2 || a.i - b.i; });
    let outer = 0;
    for (let m = 0; m < cand.length && outer < ACCENT_DOTS_OUTER; m++) {
      if (used.has(cand[m].i)) continue;
      pushDot(cand[m].i);
      outer++;
    }
    return { dots: dots, k: k, seed: seed };
  }

  // Raster: draws the accent dots. opts.wrap / opts.mask behave like
  // rasterWelded: the periodic base layer wraps toroidally, rotated layers
  // fade at the tile edges. Dots are pinned to vertices and keep full
  // visibility through the motion. Ink dots carry a smaller bone center at
  // the same center and CENTER_ALPHA times the parent's alpha, so the dark
  // knockout stays visible against the linework; colored dots draw plain.
  function rasterDots(ctx, sim, G, dotUnit, strokeW, phase, opts) {
    if (!sim) return;
    opts = opts || {};
    const wrap = opts.wrap || null;
    const maskFn = opts.mask || null;
    line(ctx, Math.max(0.5, strokeW));
    const r0 = dotUnit * 0.12;
    const rad = r0 * DOT_SIZE;
    const radC = rad * DOT_CENTER;
    function paintDot(x, y, color, alpha) {
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, TAU);
      ctx.fill();
      // Bone-on-ink: only ink dots get the smaller bone center, so the
      // dark knockout reads against the linework.
      if (color === HUE_COLORS.ink) {
        ctx.fillStyle = BONE;
        ctx.globalAlpha = alpha * CENTER_ALPHA;
        ctx.beginPath();
        ctx.arc(x, y, radC, 0, TAU);
        ctx.fill();
      }
    }
    for (let i = 0; i < sim.dots.length; i++) {
      const d = sim.dots[i];
      if (wrap && !maskFn) {
        // wrap only the periodic base layer; rotated layers are masked.
        if (d.layer !== 0) continue;
        for (let sj = -1; sj <= 1; sj++) for (let si = -1; si <= 1; si++) {
          const x = d.x + si * wrap.W, y = d.y + sj * wrap.H;
          if (x < -rad || x > wrap.W + rad || y < -rad || y > wrap.H + rad) continue;
          paintDot(x, y, d.color, 0.9);
        }
      } else if (maskFn) {
        if (d.layer === 0) continue;
        if (d.x < -rad || d.x > wrap.W + rad || d.y < -rad || d.y > wrap.H + rad) continue;
        const mk = maskFn(d.x, d.y);
        if (mk < 0.02) continue;
        paintDot(d.x, d.y, d.color, 0.9 * mk);
      } else {
        paintDot(d.x, d.y, d.color, 0.9);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawAccentDots(ctx, S, G, unit, P, t, tokenHash, phase) {
    if (!P.accents.length) return;
    const region = visibleRegion(S); // the ring centers on what the viewer sees
    const sim = dotsSim(G, P, t, tokenHash, S, unit, phase, region, region, LAYER_ANGLES);
    rasterDots(ctx, sim, G, unit, S / 1240, phase, null);
  }

  // layers: optional preloaded decks from SGLayers.loadLayers(), keyed by
  // grid-system key. Composited beneath the procedural linework as depth
  // fields, so the seeded geometry stays legible on top of the textures.
  // phase: loop phase in [0, 1). All motion is periodic in phase, so
  // frame(1) === frame(0) and the animation loops seamlessly. Defaults to 0,
  // which renders the static piece.
  function streamsFor(tokenHash, sys) {
    const sfx = sys === "linear" ? "" : ":overlay";
    return {
      sStruct: SeedKit.streamFor(tokenHash, "structure" + sfx),
      sTone: SeedKit.streamFor(tokenHash, "tone" + sfx),
      sAccent: SeedKit.streamFor(tokenHash, "accent-detail" + sfx),
      sMotion: SeedKit.streamFor(tokenHash, "motion" + sfx),
    };
  }

  function render(ctx, S, tokenHash, layers, phase) {
    phase = phase || 0;
    const t = Traits.deriveTraits(tokenHash);
    // Palette supplies bg/ink/wash; the Accent Hues trait supplies the dot
    // grid's color set as HTML hex, overriding the palette default.
    const P = Object.assign({}, PALETTES[t.palette] || PALETTES.ink);
    P.accents = t.hues.map(function (k) { return HUE_COLORS[k]; }).filter(Boolean);
    const systems = Traits.compositeFor(t.grid);

    ctx.save();
    ctx.fillStyle = P.bg;
    ctx.fillRect(0, 0, S, S);
    // Zoom the whole composition about the locked pivot (the frame center);
    // the frame crops it.
    const pv = pivot(S);
    ctx.translate(pv.x, pv.y);
    ctx.scale(ZOOM, ZOOM);
    ctx.translate(-pv.x, -pv.y);
    // One shared lattice module per layer: source geometry is built on
    // the same module system before rotation, so the linear grids are
    // perfect squares in every layer. The triangle field shares the linear
    // grid's vertices exactly (one seeded diagonal per module square), and
    // the circle wash sits on the finer 3x3 subcell centers within.
    const mods = DENSITY_MODULES[t.density] || DENSITY_MODULES.standard;
    const mod = S / mods;
    for (const sys of systems) {
      const R = streamsFor(tokenHash, sys);
      // Each system's depth field sits beneath the linework. The linear
      // deck keeps its legacy tile streams; other systems are namespaced so
      // their tiles never collide with the base deck's.
      if (Layers && layers) Layers.composeLayers(ctx, S, layers[sys], R, tokenHash, P, phase, sys === "linear" ? "" : sys);
    }
    // The welded tri-layer lattice, then the accent dot grid above it.
    const G = fusedGraph(tokenHash, S, mod, t.grid);
    drawWelded(ctx, S, G, mod / 3, P, t, tokenHash, phase);
    drawAccentDots(ctx, S, G, mod / 3, P, t, tokenHash, phase);
    ctx.restore();
    // No border: the welded linework bleeds uninterrupted to the canvas edge.
    return t;
  }

  // Textile tile mode: renders a W×H seamless repeat unit (default
  // 4096×2160). The base layer is exactly periodic (0°) and wraps
  // toroidally; the rotated duplicates fade to zero at the tile edges via
  // tileMask, so the tile joins seamlessly with copies of itself. No zoom
  // and no border — both would break the repeat. opts: {W, H, phase}.
  function renderTile(ctx, tokenHash, layers, opts) {
    opts = opts || {};
    const W = opts.W || 4096, H = opts.H || 2160;
    const phase = opts.phase || 0;
    const t = Traits.deriveTraits(tokenHash);
    const P = Object.assign({}, PALETTES[t.palette] || PALETTES.ink);
    P.accents = t.hues.map(function (k) { return HUE_COLORS[k]; }).filter(Boolean);
    const systems = Traits.compositeFor(t.grid);
    const SU = Math.min(W, H);

    // Module counts from the density trait, scaled so the visual density
    // matches the square piece.
    const baseMods = DENSITY_MODULES[t.density] || DENSITY_MODULES.standard;
    const nRows = baseMods * 2;
    const nCols = Math.max(2, Math.round(nRows * W / H));
    const modX = W / nCols, modY = H / nRows;
    const unit = Math.min(modX, modY) / 3;
    const strokeW = SU / 1240;
    const wrap = { W: W, H: H };
    const maskFn = function (x, y) { return tileMask(W, H, x, y); };

    ctx.save();
    ctx.fillStyle = P.bg;
    ctx.fillRect(0, 0, W, H);
    // Depth fields, toroidally wrapped.
    for (const sys of systems) {
      const R = streamsFor(tokenHash, sys);
      if (Layers && layers) {
        const placements = Layers.planLayers(W, H, layers[sys], R, tokenHash, P, phase,
          sys === "linear" ? "" : sys);
        Layers.drawPlacements(ctx, placements, wrap);
      }
    }
    // The welded lattice: base layer wraps, duplicates are edge-masked.
    // Draw dim layers first, base last (matches the square drawOrder).
    // No frame hold in tile mode: the 9-shift wrap keeps the repeat
    // seamless mid-motion on its own.
    const G = fusedGraphTile(tokenHash, W, H, modX, modY, nCols, nRows, t.grid);
    const sim = weldedSim(G, P, t, tokenHash, SU, unit, phase, null, [0, 0, W, H], null);
    rasterWelded(ctx, sim, G, P, SU, unit, strokeW, phase, { wrap: wrap, layer: 2, mask: maskFn });
    rasterWelded(ctx, sim, G, P, SU, unit, strokeW, phase, { wrap: wrap, layer: 1, mask: maskFn });
    rasterWelded(ctx, sim, G, P, SU, unit, strokeW, phase, { wrap: wrap, layer: 0 });
    // Accent dots: base layer wraps, rotated layers are masked.
    const dsim = dotsSim(G, P, t, tokenHash, SU, unit, phase, [0, 0, W, H], [0, 0, W, H], TILE_ANGLES);
    rasterDots(ctx, dsim, G, unit, strokeW, phase, { wrap: wrap });
    rasterDots(ctx, dsim, G, unit, strokeW, phase, { wrap: wrap, mask: maskFn });
    ctx.restore();
    return t;
  }

  const SGArt = { PALETTES: PALETTES, HUE_COLORS: HUE_COLORS, render: render,
    renderTile: renderTile, fusedGraphTile: fusedGraphTile, tileMask: tileMask,
    gridPatch: gridPatch, DENSITY_MODULES: DENSITY_MODULES,
    ACCENT_DOTS: ACCENT_DOTS, ACCENT_DOTS_OUTER: ACCENT_DOTS_OUTER, DOT_SIZE: DOT_SIZE, DOT_CENTER: DOT_CENTER,
    CIRCLE_R: CIRCLE_R, CIRCLE_R2: CIRCLE_R2, CIRCLE_FLY: CIRCLE_FLY, DOT_OUTWARD: DOT_OUTWARD, EDGE_HOLD: EDGE_HOLD,
    BONE: BONE,
    CENTER_ALPHA: CENTER_ALPHA, _setTriSubdiv: function (n) { TRI_SUBDIV = n; },
    _triSubdiv: function () { return TRI_SUBDIV; },
    LAYER_ANGLES: LAYER_ANGLES, LAYER_DIM: LAYER_DIM, LAYER_TINT: LAYER_TINT,
    ORIENT_CW: ORIENT_CW, _pivot: pivot,
    ZOOM: ZOOM, SHATTER_DMAX: SHATTER_DMAX,
    fusedGraph: fusedGraph, _weldEdges: weldEdges, _edgeAlpha: edgeAlpha,
    _shatterEnv: shatterEnv, _shatterEpicenter: shatterEpicenter,
    _shatterField: shatterField, _shatterDelay: shatterDelay,
    _motionMu: motionMu, _dotsSim: dotsSim, _squareGridVertSet: squareGridVertSet, _weldedSim: weldedSim,
    _holdWeight: holdWeight, _spinTwist: spinTwist, SPIN_TURNS: SPIN_TURNS, SPIN_WINDOW: SPIN_WINDOW,
    _layerSoup: function (tokenHash, mod, S, layer) {
      const m = S * 0.22;
      return layerSoup(tokenHash, mod, S, layer, gridPatch(mod, S, layer === 0 ? 0 : m));
    } };

  if (typeof module !== "undefined" && module.exports) module.exports = SGArt;
  else global.SGArt = SGArt;
})(typeof self !== "undefined" ? self : this);
