/**
 * Chapter 9 — 'canvas': the web as a canvas. A flat grid of light in the XZ plane (y = 0) that the
 * GPU waves (scene.wave) and lets settle at the very end of the page. Generated perfectly flat.
 *
 * Structure (canonical frame):
 *  - Grid lines every 0.5 units across x, z ∈ [−6.5, 6.5] (27 + 27 lines): thin, crisp, w 0.6–0.9,
 *    a touch brighter on the major lines (every 2 units) and swelling toward each crossing.
 *  - A tight glowing knot at every crossing (w → 1): the brightest points of the plane.
 *  - Sparse dim dust in the cells (w 0.04–0.12) so the plane reads as a surface, not just wires.
 *  - Density AND brightness fall off radially (flat core, smooth shoulder), so the square grid
 *    dissolves into darkness as a soft disc instead of ending at a hard edge.
 *
 * Every particle is sampled iid from that mixture, so particle order is random by construction and
 * any prefix is an unbiased subsample. Densities follow the falloff exactly via small inverse-CDF
 * tables (no rejection loops): ~170–230 ms per million particles in Node on an M2.
 *
 * Budget: lines 66% (major lines ×1.45 density), crossing knots 12%, cell dust 22%.
 */
import type { FormationGenerator } from './types.ts';
import { smoothstep } from './utils.ts';

const EXTENT = 6.5;
const SPACING = 0.5;
const LINES = Math.round((2 * EXTENT) / SPACING) + 1; // 27 per direction (0 included)
const MID = (LINES - 1) / 2; // index of the line through the origin
/** Major lines every 4 cells: x (or z) = 0, ±2, ±4, ±6. */
const MAJOR_EVERY = 4;
const MAJOR_DENSITY = 1.45;

/** Radial falloff: flat core out to R_IN, smooth shoulder to zero at R_OUT. */
const R_IN = 2.0;
const R_OUT = 6.8;

/** Particle budget split (probabilities per particle, so exact counts vary slightly). */
const P_LINES = 0.66;
const P_NODES = 0.12; // remainder (0.22) → cell dust

const LINE_JITTER = 0.0055; // σ of the perpendicular scatter of line particles
const NODE_SIGMA = 0.024; // σ of the knot at each crossing
const CROSS_GLOW = 0.075; // half-width of the brightness swell around each crossing (along a line)

const TABLE = 1024; // inverse-CDF resolution
const FINE = 4096; // integration steps when building a table

/** Density/brightness falloff with radius; 1 in the core, 0 beyond R_OUT. */
function falloff(r: number): number {
  const f = 1 - smoothstep(R_IN, R_OUT, r);
  return f * (0.65 + 0.35 * f * (3 - 2 * f)); // slightly softer toe than a plain smoothstep
}

/**
 * Inverse CDF of a 1D density on [lo, hi] as a lookup table: u ∈ [0, 1] → x. Returns the table and
 * the density's integral (used as the sampling weight of the whole segment).
 */
function inverseCdf(density: (x: number) => number, lo: number, hi: number): { table: Float32Array; mass: number } {
  const cdf = new Float64Array(FINE + 1);
  const dx = (hi - lo) / FINE;
  let acc = 0;
  let prev = density(lo);
  for (let k = 1; k <= FINE; k++) {
    const cur = density(lo + k * dx);
    acc += 0.5 * (prev + cur) * dx;
    cdf[k] = acc;
    prev = cur;
  }
  const table = new Float32Array(TABLE + 1);
  let k = 0;
  for (let j = 0; j <= TABLE; j++) {
    if (j === 0) {
      // start at the beginning of the support (skip a leading zero-density stretch)
      while (k < FINE && cdf[k + 1]! <= 0) k++;
      table[0] = lo + k * dx;
      continue;
    }
    const target = (j / TABLE) * acc;
    while (k < FINE && cdf[k + 1]! < target) k++;
    const c0 = cdf[k]!, c1 = cdf[Math.min(FINE, k + 1)]!;
    const f = c1 > c0 ? (target - c0) / (c1 - c0) : 0;
    table[j] = lo + (k + Math.min(1, Math.max(0, f))) * dx;
  }
  return { table, mass: acc };
}

const lookup = (table: Float32Array, u: number): number => {
  const p = u * TABLE;
  const k = Math.min(TABLE - 1, p | 0);
  const f = p - k;
  return table[k]! + (table[k + 1]! - table[k]!) * f;
};

/** Index of the first cumulative entry ≥ u·total (binary search). */
function pickCumulative(cum: Float64Array, u: number): number {
  const target = u * cum[cum.length - 1]!;
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (cum[m]! < target) lo = m + 1; else hi = m;
  }
  return lo;
}

export const generateCanvas: FormationGenerator = ({ count, out, rng, report }) => {
  const reportEvery = Math.max(1, Math.floor(count / 20));
  const lineCoord = (i: number): number => (i - MID) * SPACING;
  const isMajor = (i: number): boolean => Math.abs(i - MID) % MAJOR_EVERY === 0;
  /** Cheap ~N(0,1) (Irwin–Hall, 3 uniforms) — plenty for sub-pixel jitter. */
  const nrm = (): number => (rng() + rng() + rng() - 1.5) * 2;

  // ---- per-line inverse CDFs along the line (by symmetry the same for both directions)
  const lineTables: Float32Array[] = [];
  const lineCum = new Float64Array(LINES);
  let accLines = 0;
  for (let i = 0; i < LINES; i++) {
    const c = lineCoord(i);
    const { table, mass } = inverseCdf((t) => falloff(Math.sqrt(t * t + c * c)), -EXTENT, EXTENT);
    lineTables.push(table);
    accLines += mass * (isMajor(i) ? MAJOR_DENSITY : 1);
    lineCum[i] = accLines;
  }

  // ---- crossing knots weighted by the falloff at the crossing
  const nodeCum = new Float64Array(LINES * LINES);
  let accNodes = 0;
  for (let a = 0; a < LINES; a++) {
    for (let b = 0; b < LINES; b++) {
      const x = lineCoord(a), z = lineCoord(b);
      accNodes += falloff(Math.sqrt(x * x + z * z));
      nodeCum[a * LINES + b] = accNodes;
    }
  }

  // ---- dust: radial inverse CDF of r · falloff(r) (area-uniform × falloff), angle uniform
  const dust = inverseCdf((r) => r * falloff(r), 0, R_OUT).table;

  for (let i = 0; i < count; i++) {
    if (i % reportEvery === 0) report(i / count);
    let x = 0;
    let z = 0;
    let w = 0;
    const pick = rng();

    if (pick < P_LINES) {
      // ---- grid line
      const li = pickCumulative(lineCum, rng());
      const t = lookup(lineTables[li]!, rng());
      const c = lineCoord(li) + nrm() * LINE_JITTER;
      if (rng() < 0.5) { x = t; z = c; } else { x = c; z = t; }
      const f = falloff(Math.sqrt(x * x + z * z));
      const dt = Math.abs(t - Math.round(t / SPACING) * SPACING);
      const swell = Math.exp(-(dt * dt) / (CROSS_GLOW * CROSS_GLOW));
      const base = (isMajor(li) ? 0.72 : 0.6) + 0.2 * swell;
      w = base * (0.42 + 0.58 * f) + 0.04 * (rng() - 0.5);
    } else if (pick < P_LINES + P_NODES) {
      // ---- crossing knot
      const k = pickCumulative(nodeCum, rng());
      const cx = lineCoord((k / LINES) | 0), cz = lineCoord(k % LINES);
      const dx = nrm() * NODE_SIGMA, dz = nrm() * NODE_SIGMA;
      x = cx + dx;
      z = cz + dz;
      const f = falloff(Math.sqrt(cx * cx + cz * cz));
      const d2 = (dx * dx + dz * dz) / (NODE_SIGMA * NODE_SIGMA);
      w = (0.9 + 0.1 * Math.exp(-0.5 * d2)) * (0.5 + 0.5 * f);
    } else {
      // ---- cell dust (resample the rare point that lands outside the square)
      do {
        const r = lookup(dust, rng());
        const a = rng() * Math.PI * 2;
        x = r * Math.cos(a);
        z = r * Math.sin(a);
      } while (x > EXTENT || x < -EXTENT || z > EXTENT || z < -EXTENT);
      w = 0.04 + 0.08 * falloff(Math.sqrt(x * x + z * z)) * rng();
    }

    // keep inside the plane extent (jitter can nudge the outermost lines a hair past it)
    if (x > EXTENT) x = EXTENT; else if (x < -EXTENT) x = -EXTENT;
    if (z > EXTENT) z = EXTENT; else if (z < -EXTENT) z = -EXTENT;
    if (w < 0) w = 0; else if (w > 1) w = 1;

    const o = i * 4;
    out[o] = x;
    out[o + 1] = 0;
    out[o + 2] = z;
    out[o + 3] = w;
  }
  report(1);
};
