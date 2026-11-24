/**
 * Chapter 4 — "Matter starts copying itself." A right-handed B-DNA double helix.
 *
 * Canonical frame: helix axis +Y, y ∈ [−3, 3] (data/chapters.ts tilts it diagonally and spins it
 * about +Y). Right-handed: strand angle t increases with y and x = R·sin t, z = R·cos t, so the
 * front strands run "/" when viewed from +Z (a left-handed helix is the classic stock-art error).
 *
 *  - B-DNA-like: 10.5 bp per turn; the second backbone is offset by 140° (not 180°), giving a
 *    narrow minor groove and a wide major groove; ~3.5 turns. Radius 0.8 (outer tube edge 0.88):
 *    with 3–4 turns in 6 units, R = 1 reads as a coil spring; pitch/radius ≈ 2.3 (real B-DNA ≈ 3.4)
 *    keeps it unmistakably DNA. In projection the strand crossings alternate ±0.34 R off-axis —
 *    the groove signature that survives additive blending.
 *  - backbones: dense glowing tubes (r ≈ 0.08) with slight beading at each phosphate, w 0.85–1.
 *  - rungs: one base pair every 1/10.5 turn, horizontal, split into two bases that meet with a
 *    tiny hydrogen-bond gap; purines (A, G) are longer than pyrimidines (T, C); w by base:
 *    G 0.70, C 0.62, A 0.52, T 0.45 (G·C pairs read brighter than A·T). The gap is bridged by
 *    2 (A·T) or 3 (G·C) hydrogen-bond sparks.
 *  - sequence: the Drew–Dickerson dodecamer CGCGAATTCGCG (the first B-DNA crystal structure,
 *    1980), repeated.
 *  - halo: a faint sparse sheath + mist (w ≤ 0.14) for atmosphere; the helix ends dissolve softly.
 * Contract: ./types.ts (canonical frame, w semantics, random particle order, seeded rng only).
 */
import type { FormationGenerator } from './types.ts';
import { FORMATION_BOUND } from './types.ts';
import { allocate, shufflePoints, smoothstep } from './utils.ts';

const TAU = Math.PI * 2;

const N_BASE_PAIRS = 34;
const SEQUENCE = 'CGCGAATTCGCG'.repeat(3).slice(0, N_BASE_PAIRS);
const BP_PER_TURN = 10.5;
/** Helix radius (backbone centreline) and rise per base pair (world units). */
const R = 0.8;
const RISE = 0.172;
const PITCH = BP_PER_TURN * RISE;
/** Angular offset of the second backbone: 140° → minor groove (140°) / major groove (220°). */
const GROOVE = (140 * Math.PI) / 180;
const TUBE = 0.08;
/** Backbone half-length (a little past the last base pair); the helix dissolves over FADE. */
const Y_END = ((N_BASE_PAIRS - 1) / 2) * RISE + 0.3;
const FADE = 0.62;

const BASE_W: Record<string, number> = { G: 0.7, C: 0.62, A: 0.52, T: 0.45 };
const COMPLEMENT: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' };
const isPurine = (b: string): boolean => b === 'A' || b === 'G';

// --------------------------------------------------------------------------------- local helpers

let normalTableCache: Float32Array | null = null;
/**
 * 4096-entry standard-normal quantile table. One rng() call yields two independent 12-bit
 * indices, i.e. two normal deviates for ~1/3 the cost of Box–Muller (tails clipped at ±3.67σ).
 */
function normalTable(): Float32Array {
  if (normalTableCache) return normalTableCache;
  const n = 4096, steps = 1 << 15, lo = -6, hi = 6, h = (hi - lo) / steps;
  const t = new Float32Array(n);
  const c0 = 1 / Math.sqrt(TAU);
  let cdf = 0, x = lo, k = 0, prev = Math.exp(-0.5 * lo * lo) * c0;
  for (let s = 0; s < steps && k < n; s++) {
    const x1 = x + h, pdf1 = Math.exp(-0.5 * x1 * x1) * c0, c1 = cdf + 0.5 * (prev + pdf1) * h;
    while (k < n && c1 >= (k + 0.5) / n) { t[k] = x + (((k + 0.5) / n - cdf) / (c1 - cdf)) * h; k++; }
    cdf = c1; x = x1; prev = pdf1;
  }
  while (k < n) t[k++] = hi;
  normalTableCache = t;
  return t;
}

// --------------------------------------------------------------------------------- generator

export const generateDna: FormationGenerator = ({ count, out, rng, report }) => {
  const NT = normalTable();
  const B = FORMATION_BOUND - 0.02;
  const N_BP = SEQUENCE.length;
  const K = TAU / PITCH; // dθ/dy
  const y0 = -((N_BP - 1) / 2) * RISE; // first base pair height
  const theta0 = 0.35; // phase: a pleasant groove orientation toward the default camera
  const L = Math.sqrt(1 + R * R * K * K);
  const ta = (R * K) / L, tb = 1 / L; // unit tangent = (ta·cosθ, tb, −ta·sinθ)

  const [nBack, nBeads, nRungs, nBonds, nHalo] = allocate(count, [0.47, 0.13, 0.32, 0.012, 0.068]) as [
    number, number, number, number, number,
  ];

  let p = 0;
  const reportStep = Math.max(1, Math.floor(count / 20));
  let nextReport = reportStep;
  const emit = (x: number, y: number, z: number, w: number): void => {
    const o = p * 4;
    out[o] = x > B ? B : x < -B ? -B : x;
    out[o + 1] = y > B ? B : y < -B ? -B : y;
    out[o + 2] = z > B ? B : z < -B ? -B : z;
    out[o + 3] = w < 0 ? 0 : w > 1 ? 1 : w;
    p++;
    if (p >= nextReport) { report(0.92 * (p / count)); nextReport += reportStep; }
  };

  /** Soft dissolve of the helix ends (1 inside, → 0 at ±Y_END). */
  const endFade = (y: number): number => 1 - smoothstep(Y_END - FADE, Y_END, Math.abs(y));

  // ---------------------------------------------------------------- backbones: glowing, gently beaded tubes
  {
    const phosK = TAU / RISE, phos0 = y0 + 0.5 * RISE; // phosphates sit between base pairs
    let i = 0;
    while (i < nBack) {
      const y = (rng() * 2 - 1) * Y_END;
      const q = rng() * 65536, qa = q | 0;
      const fade = endFade(y);
      const cb = 0.5 + 0.5 * Math.cos(phosK * (y - phos0));
      const bead = cb * cb; // 1 at each phosphate, 0 halfway between
      if ((qa + 0.5) / 65536 > fade * (0.75 + 0.25 * bead)) continue;
      const strand = (q - qa) < 0.5 ? 0 : 1;
      const th = K * y + theta0 + strand * GROOVE;
      const s = Math.sin(th), c = Math.cos(th);
      // cross-section: half on a soft shell (reads as a lit tube), half filled
      const q2 = rng() * 65536, q2a = q2 | 0;
      const alpha = TAU * ((q2a + 0.5) / 65536);
      const v = q2 - q2a;
      const tube = TUBE * (0.88 + 0.26 * bead);
      const rho = v < 0.5 ? tube * (0.86 + 0.28 * v) : tube * Math.sqrt((v - 0.5) * 2);
      const ca = Math.cos(alpha) * rho, sa = Math.sin(alpha) * rho;
      // offset = ca·e_ρ + sa·b, e_ρ = (s, 0, c), b = (tb·c, −ta, −tb·s)
      const x = R * s + ca * s + sa * tb * c;
      const yy = y - sa * ta;
      const z = R * c + ca * c - sa * tb * s;
      emit(x, yy, z, (0.84 + 0.06 * (1 - rho / tube) + 0.06 * bead) * (0.55 + 0.45 * fade));
      i++;
    }
  }

  // ---------------------------------------------------------------- phosphate beads (between base pairs)
  {
    const beadY: number[] = [];
    for (let k = -1; k < N_BP; k++) beadY.push(y0 + (k + 0.5) * RISE);
    const nB = beadY.length * 2;
    let i = 0;
    while (i < nBeads) {
      const u = rng() * nB, b = u | 0;
      const strand = b & 1;
      const yb = beadY[b >> 1]!;
      const q = rng() * 4096, qa = q | 0, q2 = rng() * 4096, q2a = q2 | 0;
      const sig = 0.06;
      const ox = NT[qa]! * sig, oy = NT[((q - qa) * 4096) | 0]! * sig, oz = NT[q2a]! * sig;
      const y = yb + oy;
      const fade = endFade(y);
      if ((q2 - q2a) > fade) continue;
      const th = K * yb + theta0 + strand * GROOVE;
      emit(R * Math.sin(th) + ox, y, R * Math.cos(th) + oz, 0.55 + 0.45 * fade);
      i++;
    }
  }

  // ---------------------------------------------------------------- rungs: base pairs
  // Precompute every half-rung: start (at the backbone), end (at the H-bond gap), lateral unit, w.
  const halves = new Float64Array(N_BP * 2 * 9);
  const bonds = new Float64Array(N_BP * 8); // per bp: gap start (x,y,z), gap vector (x,z), lateral unit (x,z), #H-bonds
  const nBondLines: number[] = [];
  {
    const gap = 0.05, rIn = R - 0.03;
    for (let k = 0; k < N_BP; k++) {
      const y = y0 + k * RISE;
      const t1 = K * y + theta0, t2 = t1 + GROOVE;
      const p1x = rIn * Math.sin(t1), p1z = rIn * Math.cos(t1);
      const p2x = rIn * Math.sin(t2), p2z = rIn * Math.cos(t2);
      const dx = p2x - p1x, dz = p2z - p1z, len = Math.hypot(dx, dz);
      const ux = dx / len, uz = dz / len;
      const b1 = SEQUENCE[k]!, b2 = COMPLEMENT[b1]!;
      const f = isPurine(b1) ? 0.56 : 0.44; // purines are the longer half
      const jx = p1x + dx * f, jz = p1z + dz * f;
      const lx = -uz, lz = ux; // horizontal lateral unit (perpendicular to the rung)
      const o1 = k * 18;
      // half 1: strand-1 base, from p1 to the junction minus half the gap
      halves[o1] = p1x; halves[o1 + 1] = y; halves[o1 + 2] = p1z;
      halves[o1 + 3] = jx - ux * gap * 0.5; halves[o1 + 4] = y; halves[o1 + 5] = jz - uz * gap * 0.5;
      halves[o1 + 6] = lx; halves[o1 + 7] = lz; halves[o1 + 8] = BASE_W[b1]!;
      // half 2: strand-2 base, from p2 back to the junction plus half the gap
      halves[o1 + 9] = p2x; halves[o1 + 10] = y; halves[o1 + 11] = p2z;
      halves[o1 + 12] = jx + ux * gap * 0.5; halves[o1 + 13] = y; halves[o1 + 14] = jz + uz * gap * 0.5;
      halves[o1 + 15] = lx; halves[o1 + 16] = lz; halves[o1 + 17] = BASE_W[b2]!;
      const ob = k * 8;
      bonds[ob] = jx - ux * gap * 0.5; bonds[ob + 1] = y; bonds[ob + 2] = jz - uz * gap * 0.5;
      bonds[ob + 3] = ux * gap; bonds[ob + 4] = uz * gap; bonds[ob + 5] = lx; bonds[ob + 6] = lz;
      bonds[ob + 7] = b1 === 'G' || b1 === 'C' ? 3 : 2;
      nBondLines.push(bonds[ob + 7]! * smoothstep(0.75, 1, endFade(y))); // only where the rung reaches the gap
    }
    // Particles ∝ base length (purines longer); at the dissolving ends rungs get sparser and only
    // reach part-way in from the backbone.
    const nH = N_BP * 2;
    const hw: number[] = [];
    for (let h = 0; h < nH; h++) {
      const base = h & 1 ? COMPLEMENT[SEQUENCE[h >> 1]!]! : SEQUENCE[h >> 1]!;
      hw.push((isPurine(base) ? 0.56 : 0.44) * (0.2 + 0.8 * endFade(halves[h * 9 + 1]!)));
    }
    const hc = allocate(nRungs, hw);
    for (let h = 0; h < nH; h++) {
      const o = h * 9;
      const sx = halves[o]!, sy = halves[o + 1]!, sz = halves[o + 2]!;
      const ex = halves[o + 3]!, ez = halves[o + 5]!;
      const lx = halves[o + 6]!, lz = halves[o + 7]!, w = halves[o + 8]!;
      const n = hc[h]!;
      const fade = endFade(sy);
      const reach = 0.3 + 0.7 * fade;
      for (let i = 0; i < n; i++) {
        const t = rng() * reach;
        const q = rng() * 4096, qa = q | 0;
        // a flat plank: thin along the axis, a little wider sideways
        const lat = NT[qa]! * 0.026, vy = NT[((q - qa) * 4096) | 0]! * 0.011;
        emit(sx + (ex - sx) * t + lx * lat, sy + vy, sz + (ez - sz) * t + lz * lat, (w + 0.035 * (1 - t)) * (0.5 + 0.5 * fade));
      }
    }
  }

  // ---------------------------------------------------------------- hydrogen bonds: 2 (A·T) or 3 (G·C) sparks across the gap
  {
    const bc = allocate(nBonds, nBondLines);
    for (let k = 0; k < N_BP; k++) {
      const ob = k * 8;
      const gx = bonds[ob]!, gy = bonds[ob + 1]!, gz = bonds[ob + 2]!, vx = bonds[ob + 3]!, vz = bonds[ob + 4]!;
      const lx = bonds[ob + 5]!, lz = bonds[ob + 6]!, lines = bonds[ob + 7]!;
      const n = bc[k]!;
      for (let i = 0; i < n; i++) {
        const line = i % lines;
        const off = (line - (lines - 1) / 2) * 0.03;
        const t = rng();
        emit(gx + vx * t + lx * off, gy, gz + vz * t + lz * off, 0.82);
      }
    }
  }

  // ---------------------------------------------------------------- halo: faint atmosphere
  // 70%: a soft sheath hugging the helix surface (a gaussian-blurred cylinder); 30%: a wider mist
  // around the axis. Both are 2-D gaussians in x/z, so there is no density spike on the axis.
  {
    const nSheath = Math.round(nHalo * 0.7);
    let i = 0;
    while (i < nHalo) {
      const y = (rng() * 2 - 1) * 3.7;
      const fade = 1 - smoothstep(2.3, 3.7, Math.abs(y));
      const q2 = rng() * 65536, q2a = q2 | 0;
      if (q2 - q2a > fade) continue;
      const q = rng() * 4096, qa = q | 0;
      const g1 = NT[qa]!, g2 = NT[((q - qa) * 4096) | 0]!;
      let x: number, z: number;
      if (i < nSheath) {
        const ang = TAU * ((q2a + 0.5) / 65536);
        x = R * Math.sin(ang) + 0.42 * g1; z = R * Math.cos(ang) + 0.42 * g2;
      } else {
        x = 1.05 * g1; z = 1.05 * g2;
      }
      const rr = Math.hypot(x, z);
      if (rr > 2.7) continue; // keep the mist well inside the bounds (never rely on the clamp)
      emit(x, y, z, 0.02 + 0.12 * Math.exp(-Math.abs(rr - R) * 2) * fade);
      i++;
    }
  }

  shufflePoints(out, count, rng);
  report(1);
};
