/**
 * Chapter 1 — "Everything started smaller than a point."
 *
 * A white-hot point caught an instant after it began to explode (canonical frame, centred on the
 * origin, roughly isotropic so the chapter tilt/spin only add life):
 *  - nucleus + core (34%): a very dense, cuspy, gently "boiling" ball (r ≲ 0.35), w ≈ 0.8–1.
 *    Scaled by 0.012 for the opening singularity it collapses to a single tiny star.
 *  - fireball (12%): a billowing warm cloud around the core, cooling (w falling) outward.
 *  - jets (38%): ~400 radial streaks in a hierarchy — 14 bright major jets (evenly but irregularly
 *    spread), 80 medium and 300 faint minor ones. Density and w fall with distance; each is a
 *    thin cone that widens outward.
 *  - halo (8%): sparse, lopsided diffuse ejecta fading out by ~3.8.
 *  - ejecta (5.5%): bright fragments flung outward, each trailing a short streak back toward the
 *    centre (trail length ∝ radius, like a free expansion).
 *  - sparks (2.5%): isolated bright embers.
 * The layout (jets, fragments) comes from its own seeded generator, so it is identical at every
 * particle count; `ctx.rng` only drives per-particle sampling.
 * Contract: ./types.ts (canonical frame, w semantics, random particle order, seeded rng only).
 */
import type { FormationGenerator } from './types.ts';
import { FORMATION_BOUND } from './types.ts';
import { allocate, createNoise3D, createRng, shufflePoints } from './utils.ts';

const TAU = Math.PI * 2;

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

/** Inverse-CDF table for an arbitrary 1-D density on [lo, hi] (sample with linear interpolation). */
function inverseCdf(pdf: (x: number) => number, lo: number, hi: number, n = 2048): Float64Array {
  const fine = n * 8;
  const cum = new Float64Array(fine + 1);
  const h = (hi - lo) / fine;
  for (let i = 0; i < fine; i++) cum[i + 1] = cum[i]! + Math.max(0, pdf(lo + (i + 0.5) * h)) * h;
  const total = cum[fine]!;
  const t = new Float64Array(n + 1);
  let j = 0;
  for (let k = 0; k <= n; k++) {
    const target = (k / n) * total;
    while (j < fine - 1 && cum[j + 1]! < target) j++;
    const seg = cum[j + 1]! - cum[j]!;
    t[k] = lo + (j + (seg > 0 ? (target - cum[j]!) / seg : 0)) * h;
  }
  return t;
}

/** Sample an inverse-CDF table with a full-precision uniform (no banding). */
function sampleTable(t: Float64Array, u: number): number {
  const x = u * (t.length - 1), k = x | 0;
  return t[k]! + (t[k + 1]! - t[k]!) * (x - k);
}

// --------------------------------------------------------------------------------- generator

export const generateBigBang: FormationGenerator = ({ count, out, rng, seed, report }) => {
  const NT = normalTable();
  const noise = createNoise3D(createRng((seed ^ 0x51a7b1) >>> 0));
  const layout = createRng((seed ^ 0x7f4a7c15) >>> 0); // structure only: count-independent
  const B = FORMATION_BOUND - 0.02;

  const [nNucleus, nCore, nFire, nJets, nHalo, nEjecta, nSparks] = allocate(
    count, [0.09, 0.25, 0.12, 0.38, 0.08, 0.055, 0.025],
  ) as [number, number, number, number, number, number, number];

  let p = 0; // write cursor
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

  /** Low-frequency anisotropy on the sphere of directions, ≈ [-1, 1]. */
  const lopsided = (dx: number, dy: number, dz: number): number =>
    0.7 * noise(dx * 0.9 + 3.1, dy * 0.9 - 1.7, dz * 0.9 + 0.4) + 0.3 * noise(dx * 2.1 - 4.2, dy * 2.1, dz * 2.1 + 2.6);

  /** Uniform random direction into `dir` (one draw → two 16-bit uniforms). */
  const dir = new Float64Array(3);
  const randomDir = (g: () => number): void => {
    const q = g() * 65536, qa = q | 0;
    const cz = 2 * ((qa + 0.5) / 65536) - 1, ph = TAU * (q - qa), s = Math.sqrt(1 - cz * cz);
    dir[0] = s * Math.cos(ph); dir[1] = s * Math.sin(ph); dir[2] = cz;
  };

  // ---------------------------------------------------------------- nucleus: 3-D gaussian point, w = 1
  for (let i = 0; i < nNucleus; i++) {
    const r1 = rng() * 4096, a1 = r1 | 0, r2 = rng() * 4096, a2 = r2 | 0;
    const s = 0.03;
    emit(NT[a1]! * s, NT[((r1 - a1) * 4096) | 0]! * s, NT[a2]! * s, 1);
  }

  // ---------------------------------------------------------------- core: cuspy, softly truncated, boiling
  {
    const coreR = inverseCdf((r) => r * r * Math.pow(r + 0.012, -2.35) * Math.exp(-Math.pow(r / 0.27, 2.2)), 0, 0.55);
    for (let i = 0; i < nCore; i++) {
      let r = sampleTable(coreR, rng());
      randomDir(rng);
      const dx = dir[0]!, dy = dir[1]!, dz = dir[2]!;
      // granulation: lumpy radius so the ball looks like boiling plasma, not a smooth sphere
      r *= 1 + 0.22 * noise(dx * 2.6 + 9.1, dy * 2.6, dz * 2.6 - 3.3) * Math.min(1, r / 0.12);
      emit(dx * r, dy * r, dz * r, 1 - 0.2 * Math.min(1, Math.max(0, (r - 0.12) / 0.3)));
    }
  }

  // ---------------------------------------------------------------- fireball: billowing warm cloud
  {
    const fireR = inverseCdf((r) => Math.pow(r, 0.1) * Math.exp(-Math.pow(r / 1.15, 2.2)), 0.2, 2.2);
    let i = 0;
    while (i < nFire) {
      const r = sampleTable(fireR, rng());
      randomDir(rng);
      const x = dir[0]! * r, y = dir[1]! * r, z = dir[2]! * r;
      const b = Math.abs(noise(x * 1.9 + 7.7, y * 1.9, z * 1.9 + 1.9)); // billow: puffy cells
      if (rng() > Math.min(1, 0.15 + b * 1.6)) continue;
      emit(x, y, z, 0.72 - 0.5 * Math.min(1, (r - 0.2) / 1.4) + 0.15 * (b - 0.4));
      i++;
    }
  }

  // ---------------------------------------------------------------- jets
  {
    const nMajor = 14, nMedium = 80, nMinor = 300, nJ = nMajor + nMedium + nMinor;
    const jd = new Float64Array(nJ * 9); // dir(3), e1(3), e2(3)
    const jL = new Float64Array(nJ), jR0 = new Float64Array(nJ), jSpread = new Float64Array(nJ);
    const jBase = new Float64Array(nJ), jW0 = new Float64Array(nJ), jW1 = new Float64Array(nJ), jFall = new Float64Array(nJ);
    const weights: number[] = new Array<number>(nJ);
    for (let j = 0; j < nJ; j++) {
      // majors: dart-throwing with a minimum separation (~31°) → even but irregular; others iid
      let dx = 0, dy = 0, dz = 1;
      for (let attempt = 0; attempt < 60; attempt++) {
        randomDir(layout);
        dx = dir[0]!; dy = dir[1]!; dz = dir[2]!;
        if (j >= nMajor) break;
        let ok = true;
        for (let m = 0; m < j && ok; m++) if (dx * jd[m * 9]! + dy * jd[m * 9 + 1]! + dz * jd[m * 9 + 2]! > 0.86) ok = false;
        if (ok) break;
      }
      // orthonormal frame around the jet direction
      const hx = Math.abs(dx) > 0.8 ? 0 : 1, hy = Math.abs(dx) > 0.8 ? 1 : 0;
      let e1x = -dz * hy, e1y = dz * hx, e1z = dx * hy - dy * hx;
      const e1l = Math.hypot(e1x, e1y, e1z); e1x /= e1l; e1y /= e1l; e1z /= e1l;
      const e2x = dy * e1z - dz * e1y, e2y = dz * e1x - dx * e1z, e2z = dx * e1y - dy * e1x;
      const o = j * 9;
      jd[o] = dx; jd[o + 1] = dy; jd[o + 2] = dz;
      jd[o + 3] = e1x; jd[o + 4] = e1y; jd[o + 5] = e1z;
      jd[o + 6] = e2x; jd[o + 7] = e2y; jd[o + 8] = e2z;

      const an = 1 + 0.24 * lopsided(dx, dy, dz);
      const u = layout(), v = layout();
      if (j < nMajor) {
        jL[j] = (0.52 + 0.48 * u) * 3.85 * an; jR0[j] = 0.06; jSpread[j] = 0.006 + 0.005 * v; jBase[j] = 0.006;
        jW0[j] = 1; jW1[j] = 0.34; jFall[j] = 0.6; weights[j] = 8 * jL[j]!;
      } else if (j < nMajor + nMedium) {
        jL[j] = (0.32 + 0.58 * u) * 3.85 * an; jR0[j] = 0.1; jSpread[j] = 0.008 + 0.008 * v; jBase[j] = 0.006;
        jW0[j] = 0.85; jW1[j] = 0.16; jFall[j] = 0.9; weights[j] = 2.5 * jL[j]!;
      } else {
        jL[j] = (0.1 + 0.62 * Math.pow(u, 1.5)) * 3.85 * an; jR0[j] = 0.14; jSpread[j] = 0.01 + 0.015 * v; jBase[j] = 0.005;
        jW0[j] = 0.6; jW1[j] = 0.05; jFall[j] = 1.2; weights[j] = 1 * jL[j]!;
      }
      jL[j] = Math.min(jL[j]!, 3.95 - jR0[j]!);
    }
    const jc = allocate(nJets, weights);
    for (let j = 0; j < nJ; j++) {
      const o = j * 9;
      const dx = jd[o]!, dy = jd[o + 1]!, dz = jd[o + 2]!;
      const e1x = jd[o + 3]!, e1y = jd[o + 4]!, e1z = jd[o + 5]!, e2x = jd[o + 6]!, e2y = jd[o + 7]!, e2z = jd[o + 8]!;
      const L = jL[j]!, r0 = jR0[j]!, spread = jSpread[j]!, base = jBase[j]!, w0 = jW0[j]!, w1 = jW1[j]!;
      const invA = 1 / (jFall[j]! + 1);
      const n = jc[j]!;
      for (let i = 0; i < n; i++) {
        const s = 1 - Math.pow(rng(), invA); // density ∝ (1 − s)^fall along the jet
        const t = r0 + L * s;
        const q = rng() * 4096, qa = q | 0;
        const sig = base + spread * t; // cone: widens with distance
        const a = NT[qa]! * sig, b = NT[((q - qa) * 4096) | 0]! * sig;
        const fade = 1 - s;
        emit(dx * t + e1x * a + e2x * b, dy * t + e1y * a + e2y * b, dz * t + e1z * a + e2z * b, w1 + (w0 - w1) * fade * fade);
      }
    }
  }

  // ---------------------------------------------------------------- halo: lopsided diffuse ejecta
  {
    const haloR = inverseCdf((r) => Math.pow(r, -0.9) * Math.exp(-Math.pow(r / 2.2, 2)), 0.3, 3.9);
    let i = 0;
    while (i < nHalo) {
      const r = sampleTable(haloR, rng());
      randomDir(rng);
      const x = dir[0]! * r, y = dir[1]! * r, z = dir[2]! * r;
      const nv = noise(x * 0.5 + 1.3, y * 0.5, z * 0.5 - 2.1);
      if (rng() > 0.12 + 0.88 * Math.max(0, Math.min(1, 0.4 + 1.2 * nv))) continue;
      emit(x, y, z, 0.03 + 0.3 * Math.pow(1 - r / 3.9, 2) + 0.08 * Math.max(0, nv));
      i++;
    }
  }

  // ---------------------------------------------------------------- ejecta: fragments with motion trails
  {
    const nFrag = 150;
    const fr = new Float64Array(nFrag * 6); // dir(3), rHead, headSigma, trail
    const fw: number[] = [];
    const headR = inverseCdf((r) => r * Math.exp(-Math.pow(r / 3.3, 6)), 1.3, 3.85);
    for (let f = 0; f < nFrag; f++) {
      randomDir(layout);
      const rh = sampleTable(headR, layout()) * (1 + 0.1 * lopsided(dir[0]!, dir[1]!, dir[2]!));
      const size = Math.pow(layout(), 2.2); // many small, few large
      const o = f * 6;
      fr[o] = dir[0]!; fr[o + 1] = dir[1]!; fr[o + 2] = dir[2]!;
      fr[o + 3] = Math.min(rh, 3.85); fr[o + 4] = 0.009 + 0.024 * size; fr[o + 5] = (0.12 + 0.22 * layout()) * rh;
      fw.push(0.35 + size);
    }
    const fc = allocate(nEjecta, fw);
    for (let f = 0; f < nFrag; f++) {
      const o = f * 6;
      const dx = fr[o]!, dy = fr[o + 1]!, dz = fr[o + 2]!, rh = fr[o + 3]!, hs = fr[o + 4]!, trail = fr[o + 5]!;
      const wHead = 0.58 + 0.32 * Math.min(1, hs / 0.033);
      const n = fc[f]!;
      for (let i = 0; i < n; i++) {
        const q = rng() * 4096, qa = q | 0, q2 = rng() * 4096, q2a = q2 | 0;
        const g1 = NT[qa]!, g2 = NT[((q - qa) * 4096) | 0]!, g3 = NT[q2a]!;
        const v = q2 - q2a; // uniform in [0, 1)
        if (v < 0.38) {
          emit(dx * rh + g1 * hs, dy * rh + g2 * hs, dz * rh + g3 * hs, wHead); // head
        } else {
          // trail: density and brightness fade toward the centre; slight widening
          const s = 1 - Math.sqrt((v - 0.38) / 0.62); // 0 at head … 1 at trail end
          const d = rh - s * trail;
          const sig = hs * (0.55 + 0.6 * s);
          emit(dx * d + g1 * sig, dy * d + g2 * sig, dz * d + g3 * sig, 0.08 + (wHead - 0.25) * (1 - s) * (1 - s));
        }
      }
    }
  }

  // ---------------------------------------------------------------- sparks: isolated bright embers
  {
    const sparkR = inverseCdf((r) => Math.pow(r, 0.3) * Math.exp(-Math.pow(r / 2.7, 3)), 0.4, 3.9);
    for (let i = 0; i < nSparks; i++) {
      const r = sampleTable(sparkR, rng());
      randomDir(rng);
      emit(dir[0]! * r, dir[1]! * r, dir[2]! * r, 0.55 + 0.45 * rng());
    }
  }

  shufflePoints(out, count, rng);
  report(1);
};
