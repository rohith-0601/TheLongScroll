/**
 * Chapter 5 — 'tablet': a Sumerian clay tablet (c. 3200 BCE) whose wedge writing glows from within.
 *
 * Canonical frame: portrait slab, inscribed face (obverse) toward +Z, 3.6 wide × 4.44 tall × 0.76
 * thick (0.56 at the edges). The body is a rounded "soap bar": a rounded-rectangle face that swells
 * into a pillow (convex faces), wrapped by a semi-elliptical rim, then gently warped (bend + outline
 * wobble from low-frequency noise) so it looks hand-made rather than machined.
 *
 * Particles (all iid from a fixed mixture → random order by construction):
 *  - wedges  (49%) w 0.85–1    146 wedge impressions forming 61 signs (1–5 wedges each) in 8 ruled
 *                              registers. A nail wedge is a triangular head (pressed deepest at its
 *                              incentre, w → 1) plus a tapering tail with a crisp centre groove;
 *                              Winkelhaken (corner wedges) are '<' chevrons. Signs come from a fixed
 *                              vocabulary (20 signs, Zipf-weighted) plus numerals (tens sign of 1–3
 *                              Winkelhaken + units sign of 1–5 verticals), so signs recur like a real
 *                              script. Full lines are justified; one middle line and the last end
 *                              early. Pressed 0.02–0.045 into the clay.
 *  - rulings  (6%) w 0.55–0.7  seven incised, slightly wavy lines separating the registers.
 *  - face    (24%) w 0.08–0.4  obverse clay: fBm mottling, a brighter lip at the edge, and a soft
 *                              "glow from within" around the writing (blurred coverage map of the wedges).
 *  - rim     (14%) w 0.2–0.45  rounded edges, brightest at the silhouette and the face lip → crisp outline.
 *  - back     (7%) w 0.05–0.13 reverse face, sparse and dim so it does not muddy the writing
 *                              (everything is additive, so the back shows through the front).
 *
 * The inscription, noise fields and glow map use their own rngs derived from the seed, so the tablet
 * is identical at every particle count; only the sampling density changes.
 */
import type { FormationGenerator } from './types.ts';
import { createNoise3D, createRng, fbm3, type Noise3D } from './utils.ts';

// ------------------------------------------------------------------------------------ body
const AX = 1.6; // face half-width (inside the rim)
const AY = 2.02; // face half-height
const RC = 0.38; // face outline corner radius
const RIM = 0.2; // rim reach beyond the face outline
const ZT = 0.28; // half-thickness at the face edge
const BULGE = 0.1; // extra half-thickness at the centre (pillow)
const BULGE_D = 1.2; // distance in from the edge over which the bulge rises

// ------------------------------------------------------------------------------------ inscription
const REGISTERS = 8;
const TEXT_X0 = -AX + 0.13;
const TEXT_X1 = AX - 0.13;
const TEXT_TOP = AY - 0.13;
const TEXT_BOTTOM = -AY + 0.13;
const REG_H = (TEXT_TOP - TEXT_BOTTOM) / REGISTERS;
const SIGN_H = 0.31; // sign box height (box units → world)
// wedge proportions in sign-box units
const HEAD_W = 0.33;
const HEAD_L = 0.29;
const TAIL_W = 0.085;
const NOTCH = 0.46; // Winkelhaken: fraction of the chevron that is solid before the arms split
const D_HEAD = 0.045; // impression depth at the head's deepest point (world)
const D_TAIL = 0.022;
const D_RULE = 0.012;
/** Glow map: grid cell (world), splat samples per wedge, box-blur radius (cells). */
const GLOW_CELL = 0.012;
const GLOW_SPLATS = 160;
const GLOW_BLUR = 2;
/** How much the writing's glow warms the surrounding clay (added to the face's w). */
const GLOW_W = 0.16;

// ------------------------------------------------------------------------------------ budget
const P_WEDGE = 0.49;
const P_RULE = 0.06;
const P_FACE = 0.24;
const P_RIM = 0.14; // remainder (0.07) → back face

// wedge kinds
const H = 0; // horizontal: head left, tail →
const V = 1; // vertical: head top, tail ↓
const D = 2; // diagonal: head upper-left, tail ↘
const U = 3; // diagonal: head lower-left, tail ↗
const K = 4; // Winkelhaken '<' (apex left), len = apex-to-mouth distance

type WedgeDef = readonly [kind: number, x: number, y: number, len: number];
interface SignDef {
  /** advance width in box units */
  readonly w: number;
  readonly wedges: readonly WedgeDef[];
}

/**
 * Sign vocabulary (box: x ≥ 0 rightward, y ∈ [−0.5, 0.5]); simplified Old-Babylonian-style shapes.
 * Wedge x,y = head-base centre (nails) or apex (Winkelhaken).
 */
const SIGNS: readonly SignDef[] = [
  { w: 0.96, wedges: [[H, 0.02, 0, 0.92]] }, // AŠ
  { w: 0.92, wedges: [[H, 0.02, 0.2, 0.88], [H, 0.02, -0.2, 0.88]] }, // TAB
  { w: 0.94, wedges: [[H, 0.02, 0, 0.6], [V, 0.76, 0.48, 0.96]] }, // BE
  { w: 1.0, wedges: [[H, 0.02, 0.04, 0.96], [V, 0.52, 0.48, 0.96]] }, // NA (cross)
  { w: 1.02, wedges: [[H, 0.02, 0, 0.98], [V, 0.51, 0.49, 0.98], [D, 0.12, 0.38, 0.4], [U, 0.12, -0.38, 0.4]] }, // DINGIR (AN)
  { w: 0.98, wedges: [[H, 0.02, 0.21, 0.6], [H, 0.02, -0.19, 0.6], [V, 0.78, 0.48, 0.96]] }, // ŠA
  { w: 1.12, wedges: [[H, 0.02, 0.21, 0.5], [H, 0.02, -0.19, 0.5], [V, 0.68, 0.48, 0.96], [V, 0.96, 0.48, 0.96]] }, // LA
  { w: 1.0, wedges: [[H, 0.02, 0.3, 0.96], [K, 0.2, -0.15, 0.32], [K, 0.6, -0.15, 0.32]] }, // MA
  { w: 0.86, wedges: [[K, 0.04, 0.03, 0.42], [V, 0.68, 0.48, 0.96]] }, // U₂
  { w: 0.84, wedges: [[K, 0.04, 0, 0.36], [K, 0.44, 0.23, 0.36], [K, 0.44, -0.23, 0.36]] }, // KUR
  { w: 1.1, wedges: [[K, 0.04, 0, 0.4], [H, 0.52, 0.2, 0.56], [H, 0.52, -0.2, 0.56]] }, // IGI
  { w: 0.94, wedges: [[K, 0.06, 0.25, 0.32], [H, 0.1, -0.18, 0.82]] }, // DI
  { w: 0.98, wedges: [[V, 0.18, 0.48, 0.96], [D, 0.38, 0.44, 0.6], [H, 0.44, -0.26, 0.52]] }, // RU
  { w: 0.94, wedges: [[U, 0.06, -0.38, 0.62], [H, 0.34, 0.14, 0.58]] }, // TI
  { w: 0.92, wedges: [[H, 0.02, 0.26, 0.88], [D, 0.12, 0.02, 0.62]] }, // GIŠ
  { w: 0.8, wedges: [[K, 0.04, 0.23, 0.3], [K, 0.44, 0.23, 0.3], [K, 0.04, -0.23, 0.3], [K, 0.44, -0.23, 0.3]] }, // ZA
  { w: 0.78, wedges: [[V, 0.18, 0.48, 0.96], [H, 0.32, 0.04, 0.44]] }, // ME
  { w: 1.04, wedges: [[K, 0.04, 0.22, 0.32], [K, 0.04, -0.22, 0.32], [H, 0.44, -0.08, 0.58], [V, 0.68, 0.48, 0.96]] }, // KI
  { w: 0.98, wedges: [[V, 0.18, 0.48, 0.44], [V, 0.18, -0.02, 0.44], [H, 0.36, 0.04, 0.6]] }, // ŠE
  { w: 1.06, wedges: [[V, 0.18, 0.48, 0.96], [V, 0.5, 0.48, 0.96], [K, 0.66, 0.02, 0.36]] }, // A
];

/** Numeral tens sign: 1–3 Winkelhaken (10, 20, 30). */
function tensSign(tens: number): SignDef {
  if (tens === 1) return { w: 0.5, wedges: [[K, 0.04, 0, 0.42]] };
  if (tens === 2) return { w: 0.46, wedges: [[K, 0.04, 0.23, 0.38], [K, 0.04, -0.23, 0.38]] };
  return { w: 0.86, wedges: [[K, 0.04, 0.23, 0.38], [K, 0.04, -0.23, 0.38], [K, 0.44, 0, 0.38]] };
}

/** Numeral units sign: 1–5 vertical wedges (1–3 full height in a row; 4 and 5 in two tiers). */
function unitsSign(units: number): SignDef {
  const wedges: WedgeDef[] = [];
  const step = 0.35;
  if (units <= 3) {
    for (let k = 0; k < units; k++) wedges.push([V, 0.15 + k * step, 0.48, 0.96]);
    return { w: units * step + 0.02, wedges };
  }
  const top = units === 4 ? 2 : 3;
  for (let k = 0; k < top; k++) wedges.push([V, 0.15 + k * step, 0.48, 0.45]);
  const off = units === 4 ? 0 : step / 2;
  for (let k = 0; k < units - top; k++) wedges.push([V, 0.15 + off + k * step, -0.03, 0.45]);
  return { w: top * step + 0.02, wedges };
}

const TENS = [1, 2, 3].map(tensSign);
const UNITS = [1, 2, 3, 4, 5].map(unitsSign);

// ------------------------------------------------------------------------------------ helpers
/** Signed distance to the face outline (rounded rectangle), negative inside. */
function sdFace(x: number, y: number): number {
  const qx = Math.abs(x) - (AX - RC), qy = Math.abs(y) - (AY - RC);
  const ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0;
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - RC;
}

/** Height of the (front) face above z = 0 at a point inside the outline: pillowy dome. */
function faceZ(sd: number): number {
  const t = Math.min(1, -sd / BULGE_D);
  return ZT + BULGE * t * (2 - t);
}

/** A scalar field sampled on a regular grid over the tablet's xy footprint, bilinear lookups. */
const GRID_X0 = -1.95, GRID_Y0 = -2.4, GRID_W = 3.9, GRID_H = 4.8;
interface Grid { nx: number; ny: number; v: Float32Array }
function makeGrid(nx: number, ny: number, fn: (x: number, y: number) => number): Grid {
  const v = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) v[j * nx + i] = fn(GRID_X0 + (GRID_W * i) / (nx - 1), GRID_Y0 + (GRID_H * j) / (ny - 1));
  }
  return { nx, ny, v };
}
function sampleGrid(g: Grid, x: number, y: number): number {
  let fx = ((x - GRID_X0) / GRID_W) * (g.nx - 1);
  let fy = ((y - GRID_Y0) / GRID_H) * (g.ny - 1);
  fx = fx < 0 ? 0 : fx > g.nx - 1.001 ? g.nx - 1.001 : fx;
  fy = fy < 0 ? 0 : fy > g.ny - 1.001 ? g.ny - 1.001 : fy;
  const i = fx | 0, j = fy | 0;
  const tx = fx - i, ty = fy - j;
  const a = j * g.nx + i;
  const v = g.v;
  const top = v[a]! + (v[a + 1]! - v[a]!) * tx;
  const bot = v[a + g.nx]! + (v[a + g.nx + 1]! - v[a + g.nx]!) * tx;
  return top + (bot - top) * ty;
}

// ------------------------------------------------------------------------------------ generator
export const generateTablet: FormationGenerator = ({ count, out, rng, seed, report }) => {
  // ---- fields: clay mottling (0..1) and a gentle hand-made warp (bend + slight outline wobble)
  const noise: Noise3D = createNoise3D(createRng(seed ^ 0x0c1a7));
  const clay = makeGrid(132, 164, (x, y) => 0.5 + 0.5 * fbm3(noise, x * 3.1, y * 3.1, 0.37, 4, 2.1, 0.55));
  const warpZ = makeGrid(24, 30, (x, y) => noise(x * 0.38 + 17.1, y * 0.38, 4.2));
  const warpX = makeGrid(24, 30, (x, y) => noise(x * 0.55, y * 0.55 + 9.3, 11.7));
  const warpY = makeGrid(24, 30, (x, y) => noise(x * 0.55 + 5.1, y * 0.55, 23.9));

  // ---- inscription layout (own rng → identical tablet at every count)
  const lr = createRng(seed ^ 0x51a7e);
  const order = SIGNS.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(lr() * (i + 1));
    const t = order[i]!; order[i] = order[j]!; order[j] = t;
  }
  const zipf = order.map((_, rank) => 1 / Math.pow(rank + 1.6, 0.95));
  const zipfSum = zipf.reduce((a, b) => a + b, 0);
  const pickSign = (): SignDef => {
    let u = lr() * zipfSum;
    for (let r = 0; r < zipf.length; r++) { u -= zipf[r]!; if (u <= 0) return SIGNS[order[r]!]!; }
    return SIGNS[order[0]!]!;
  };

  // wedges, flat: ox oy dx dy L hw hl tw kind headP  (10 floats)
  const WF = 10;
  const wedgeData: number[] = [];
  const wedgeWeight: number[] = [];
  const addSign = (def: SignDef, x0: number, yc: number, sc: number, rot: number): void => {
    const s = SIGN_H * sc;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    for (const [kind, bx, by, blen] of def.wedges) {
      const lx = bx * s, ly = by * s;
      const ox = x0 + lx * cr - ly * sr, oy = yc + lx * sr + ly * cr;
      let ang = kind === H || kind === K ? 0 : kind === V ? -Math.PI / 2 : kind === D ? -Math.PI / 4 : Math.PI / 4;
      ang += rot + (lr() - 0.5) * 0.07;
      const L = blen * s * (0.94 + 0.12 * lr());
      const hw = HEAD_W * s * (0.93 + 0.14 * lr());
      const hl = HEAD_L * s * (0.93 + 0.14 * lr());
      const tw = TAIL_W * s;
      let weight: number, headP: number;
      if (kind === K) {
        weight = 0.62 * L * L * NOTCH * 1.15; // chevron area, slightly favoured
        headP = 1;
      } else {
        const aHead = (hw * hl) / 2 * 1.3; // heads a bit denser than their area share
        const aTail = (tw * (L - 0.55 * hl)) / 2;
        weight = aHead + aTail;
        headP = aHead / weight;
      }
      wedgeData.push(ox, oy, Math.cos(ang), Math.sin(ang), L, hw, hl, tw, kind, headP);
      wedgeWeight.push(weight);
    }
  };

  // Registers: entries of [numeral] + signs. Full lines are justified to the right margin (leftover
  // space spread over the gaps, as scribes spaced their signs); one middle line and the last line
  // end early, like real text.
  const rulingY: number[] = [];
  const shortLine = 1 + Math.floor(lr() * (REGISTERS - 2));
  const line: { def: SignDef; sc: number; gap: number; dy: number; rot: number }[] = [];
  for (let r = 0; r < REGISTERS; r++) {
    const yc = TEXT_TOP - (r + 0.5) * REG_H + (lr() - 0.5) * 0.02;
    if (r > 0) rulingY.push(TEXT_TOP - r * REG_H);
    const full = r !== REGISTERS - 1 && r !== shortLine;
    const xStart = TEXT_X0 + lr() * 0.02;
    const xEnd = r === REGISTERS - 1
      ? TEXT_X0 + (TEXT_X1 - TEXT_X0) * (0.4 + 0.16 * lr())
      : full ? TEXT_X1 : TEXT_X0 + (TEXT_X1 - TEXT_X0) * (0.64 + 0.16 * lr());
    line.length = 0;
    let x = xStart;
    let entryStart = true;
    let misses = 0;
    for (let guard = 0; guard < 96 && misses < 8; guard++) {
      // an entry may open with a number: [tens sign] + units sign, set tight like one numeral
      const tens = entryStart && lr() < 0.55 ? Math.floor(lr() * 4) : -1;
      const first = tens > 0 ? TENS[tens - 1]! : null;
      const def = tens >= 0 ? UNITS[Math.floor(lr() * 5)]! : pickSign();
      const sc = 0.94 + 0.12 * lr();
      const tight = 0.025;
      const width = ((first ? first.w : 0) + def.w) * SIGN_H * sc + (first ? tight : 0);
      if (x + width > xEnd) { misses++; continue; } // try a narrower sign before ending the line
      const dy = (lr() - 0.5) * 0.016, rot = (lr() - 0.5) * 0.06;
      if (first) line.push({ def: first, sc, gap: tight, dy, rot });
      entryStart = lr() < 0.28;
      const gap = 0.045 + 0.03 * lr() + (entryStart ? 0.07 : 0);
      line.push({ def, sc, gap, dy, rot });
      x += width + gap;
    }
    // justify: the last sign's trailing gap is not needed; spread the slack over the inner gaps
    let used = 0; // signs + inner gaps
    for (const s of line) used += s.def.w * SIGN_H * s.sc + s.gap;
    const last = line[line.length - 1];
    if (last) used -= last.gap;
    const slack = full && line.length > 1 ? Math.max(0, xEnd - xStart - used) : 0;
    let gapSum = 0;
    for (let k = 0; k < line.length - 1; k++) gapSum += line[k]!.gap;
    x = xStart;
    for (const s of line) {
      addSign(s.def, x, yc + s.dy, s.sc, s.rot);
      x += s.def.w * SIGN_H * s.sc + s.gap * (1 + (gapSum > 0 ? slack / gapSum : 0));
    }
  }

  const nW = wedgeWeight.length;
  const wd = Float32Array.from(wedgeData);
  const wCum = new Float64Array(nW);
  let acc = 0;
  for (let k = 0; k < nW; k++) { acc += wedgeWeight[k]!; wCum[k] = acc; }
  const pickWedge = (u: number): number => {
    const target = u * acc;
    let lo = 0, hi = nW - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (wCum[m]! < target) lo = m + 1; else hi = m; }
    return lo;
  };
  /** Sample one point of wedge `idx` with random source `r`: o ← [x, y, depth below the face, w]. */
  const res = new Float64Array(4);
  const sampleWedge = (idx: number, r: () => number, o: Float64Array): void => {
    const k = idx * WF;
    const ox = wd[k]!, oy = wd[k + 1]!, dx = wd[k + 2]!, dy = wd[k + 3]!;
    const L = wd[k + 4]!, hw = wd[k + 5]!, hl = wd[k + 6]!, tw = wd[k + 7]!, kind = wd[k + 8]!;
    let u = 0, v = 0, depth = 0, w = 0;
    if (kind === K) {
      // chevron '<': triangle apex (0,0), mouth corners (L, ±0.62L), minus the notch
      for (;;) {
        let r1 = r(), r2 = r();
        if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
        u = (r1 + r2) * L;
        v = (r1 - r2) * 0.62 * L;
        if (u - NOTCH * L < Math.abs(v) * ((1 - NOTCH) / 0.62)) break;
      }
      const du = u - 0.2 * L;
      const df = Math.max(0, 1 - Math.sqrt(du * du + v * v) / (0.6 * L));
      depth = D_HEAD * df;
      w = 0.9 + 0.1 * df;
    } else if (r() < wd[k + 9]!) {
      // triangular head: base (0, ±hw/2), point (hl, 0); pyramid-deep at the incentre
      let r1 = r(), r2 = r();
      if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
      u = r2 * hl;
      v = (r1 - 0.5) * hw + r2 * 0.5 * hw;
      const e = Math.sqrt(hl * hl + 0.25 * hw * hw);
      const per = hw + 2 * e;
      const lA = 1 - r1 - r2;
      const df = Math.min(Math.min(lA, r1) * (per / e), r2 * (per / hw), 1);
      depth = D_HEAD * df;
      w = 0.93 + 0.07 * df;
    } else {
      // tapering tail from u0 (width tw) to the tip at L
      const u0 = 0.55 * hl;
      let frac: number, groove: number;
      if (r() < 0.3) {
        frac = 1 - Math.sqrt(r()); // crisp centre line, density following the taper
        v = (r() - 0.5) * 0.003;
        groove = 1;
      } else {
        let r1 = r(), r2 = r();
        if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
        frac = r2;
        const halfAt = 0.5 * tw * (1 - frac);
        v = (r1 - 0.5) * tw + r2 * 0.5 * tw;
        groove = halfAt > 1e-6 ? Math.max(0, 1 - Math.abs(v) / halfAt) : 1;
      }
      u = u0 + frac * (L - u0);
      depth = D_TAIL * groove * (1 - 0.6 * frac);
      w = 0.85 + 0.08 * (1 - frac) + 0.05 * groove;
    }
    o[0] = ox + u * dx - v * dy;
    o[1] = oy + u * dy + v * dx;
    o[2] = depth;
    o[3] = w;
  };

  // ---- glow map: light from the impressions warms the clay right around the writing. Binary
  // coverage of the wedges on a fine grid, box-blurred ×3 (≈ Gaussian σ ≈ 0.03), own rng.
  const GN_X = Math.ceil((2 * AX) / GLOW_CELL) + 1, GN_Y = Math.ceil((2 * AY) / GLOW_CELL) + 1;
  const glow = new Float32Array(GN_X * GN_Y);
  {
    const gr = createRng(seed ^ 0x9105);
    for (let k = 0; k < nW; k++) {
      for (let n = 0; n < GLOW_SPLATS; n++) {
        sampleWedge(k, gr, res);
        const gx = Math.round((res[0]! + AX) / GLOW_CELL), gy = Math.round((res[1]! + AY) / GLOW_CELL);
        if (gx >= 0 && gy >= 0 && gx < GN_X && gy < GN_Y) glow[gy * GN_X + gx] = 1;
      }
    }
    const tmp = new Float32Array(GN_X * GN_Y);
    const R = GLOW_BLUR, norm = 1 / (2 * R + 1);
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 0; y < GN_Y; y++) {
        let acc = 0;
        for (let x = -R; x <= R; x++) acc += x >= 0 && x < GN_X ? glow[y * GN_X + x]! : 0;
        for (let x = 0; x < GN_X; x++) {
          tmp[y * GN_X + x] = acc * norm;
          const xa = x + R + 1, xr = x - R;
          if (xa < GN_X) acc += glow[y * GN_X + xa]!;
          if (xr >= 0) acc -= glow[y * GN_X + xr]!;
        }
      }
      for (let x = 0; x < GN_X; x++) {
        let acc = 0;
        for (let y = -R; y <= R; y++) acc += y >= 0 && y < GN_Y ? tmp[y * GN_X + x]! : 0;
        for (let y = 0; y < GN_Y; y++) {
          glow[y * GN_X + x] = acc * norm;
          const ya = y + R + 1, yr = y - R;
          if (ya < GN_Y) acc += tmp[ya * GN_X + x]!;
          if (yr >= 0) acc -= tmp[yr * GN_X + x]!;
        }
      }
    }
  }
  const sampleGlow = (x: number, y: number): number => {
    const fx = (x + AX) / GLOW_CELL, fy = (y + AY) / GLOW_CELL;
    const i = Math.min(GN_X - 2, Math.max(0, fx | 0)), j = Math.min(GN_Y - 2, Math.max(0, fy | 0));
    const tx = Math.min(1, Math.max(0, fx - i)), ty = Math.min(1, Math.max(0, fy - j));
    const a = j * GN_X + i;
    const top = glow[a]! + (glow[a + 1]! - glow[a]!) * tx;
    const bot = glow[a + GN_X]! + (glow[a + GN_X + 1]! - glow[a + GN_X]!) * tx;
    return top + (bot - top) * ty;
  };
  const nRule = rulingY.length;
  const ruleX0 = -AX + 0.05, ruleX1 = AX - 0.05;

  // ---- rim parametrisation: 4 straight edges + 4 corners (corners use the outer arc length and are
  // thinned by rejection so the surface density is uniform)
  const sx = AX - RC, sy = AY - RC;
  const lenTop = 2 * sx, lenSide = 2 * sy, lenCorner = (Math.PI / 2) * (RC + RIM);
  const rimTotal = 2 * lenTop + 2 * lenSide + 4 * lenCorner;
  const maxSpeed = Math.max(RIM, ZT);

  const reportEvery = Math.max(1, Math.floor(count / 20));
  for (let i = 0; i < count; i++) {
    if (i % reportEvery === 0) report(i / count);
    let x = 0, y = 0, z = 0, w = 0;
    const pick = rng();

    if (pick < P_WEDGE) {
      // ------------------------------------------------ wedge impression
      sampleWedge(pickWedge(rng()), rng, res);
      x = res[0]!; y = res[1]!; w = res[3]!;
      const sd = sdFace(x, y);
      z = faceZ(sd < 0 ? sd : 0) - res[2]!;
    } else if (pick < P_WEDGE + P_RULE) {
      // ------------------------------------------------ incised ruling between registers
      const j = Math.min(nRule - 1, Math.floor(rng() * nRule));
      x = ruleX0 + rng() * (ruleX1 - ruleX0);
      const across = (rng() - 0.5) * 2; // −1..1 across the groove
      y = rulingY[j]! + 0.009 * Math.sin(x * 2.3 + j * 1.9) + 0.005 * Math.sin(x * 6.1 + j) + across * 0.0075;
      const groove = 1 - Math.abs(across);
      const sd = sdFace(x, y);
      z = faceZ(sd < 0 ? sd : 0) - D_RULE * groove;
      // fade out where the ruling runs onto the rounded edge
      const edgeFade = Math.min(1, (-sd) / 0.12);
      w = (0.55 + 0.15 * groove) * (0.6 + 0.4 * Math.max(0, edgeFade));
    } else if (pick >= P_WEDGE + P_RULE + P_FACE && pick < P_WEDGE + P_RULE + P_FACE + P_RIM) {
      // ------------------------------------------------ rim (rounded edges all round)
      let nx = 0, ny = 0, phi = 0, bx = 0, by = 0;
      for (;;) {
        let s = rng() * rimTotal;
        phi = rng() * Math.PI;
        const sp = Math.sin(phi), cp = Math.cos(phi);
        const speed = Math.sqrt(RIM * RIM * cp * cp + ZT * ZT * sp * sp) / maxSpeed;
        let accept = speed;
        if (s < lenTop) { bx = -sx + s; by = AY; nx = 0; ny = 1; }
        else if ((s -= lenTop) < lenTop) { bx = sx - s; by = -AY; nx = 0; ny = -1; }
        else if ((s -= lenTop) < lenSide) { bx = AX; by = sy - s; nx = 1; ny = 0; }
        else if ((s -= lenSide) < lenSide) { bx = -AX; by = -sy + s; nx = -1; ny = 0; }
        else {
          s -= lenSide;
          const c = Math.min(3, Math.floor(s / lenCorner)); // 0 TR, 1 TL, 2 BL, 3 BR
          const a = ((s - c * lenCorner) / lenCorner) * (Math.PI / 2) + c * (Math.PI / 2);
          nx = Math.cos(a); ny = Math.sin(a);
          bx = (c === 0 || c === 3 ? sx : -sx) + RC * nx;
          by = (c <= 1 ? sy : -sy) + RC * ny;
          accept *= (RC + RIM * sp) / (RC + RIM);
        }
        if (rng() < accept) break;
      }
      const sp = Math.sin(phi);
      x = bx + nx * RIM * sp;
      y = by + ny * RIM * sp;
      z = ZT * Math.cos(phi);
      const tex = sampleGrid(clay, x + 0.31 * z, y - 0.27 * z);
      const lip = Math.exp(-(phi * phi) / 0.12); // bright line where the rim meets the inscribed face
      w = 0.21 + 0.12 * sp + 0.1 * lip + 0.06 * tex + 0.02 * (rng() - 0.5);
    } else {
      // ------------------------------------------------ face clay (front, or the sparse back)
      const front = pick < P_WEDGE + P_RULE + P_FACE;
      let sd = 0;
      for (;;) {
        x = (rng() * 2 - 1) * AX;
        y = (rng() * 2 - 1) * AY;
        sd = sdFace(x, y);
        if (sd <= 0) break;
      }
      const tex = sampleGrid(clay, x + (front ? 0 : 0.53), y);
      const zf = faceZ(sd) + (tex - 0.5) * 0.014 + (rng() - 0.5) * 0.006;
      z = front ? zf : -zf;
      if (front) {
        const lip = Math.max(0, 1 + sd / 0.1); // brighter just inside the face edge
        const g = sampleGlow(x, y);
        w = 0.08 + 0.15 * tex * tex + 0.07 * lip + GLOW_W * Math.min(1, 1.6 * g) + 0.02 * (rng() - 0.5);
      } else {
        w = 0.05 + 0.08 * tex;
      }
    }

    // ---- hand-made warp: a gentle bend plus a slight wobble of the outline
    const wz = sampleGrid(warpZ, x, y);
    const wx = sampleGrid(warpX, x, y);
    const wy = sampleGrid(warpY, x, y);
    const o = i * 4;
    out[o] = x + 0.03 * wx;
    out[o + 1] = y + 0.03 * wy;
    out[o + 2] = z + 0.05 * wz;
    out[o + 3] = w < 0 ? 0 : w > 1 ? 1 : w;
  }
  report(1);
};
