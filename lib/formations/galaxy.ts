/**
 * Chapter 2 — "Gravity learns to draw." A three-armed grand-design spiral galaxy.
 *
 * Canonical frame: disk in the XZ plane, spin axis +Y (data/chapters.ts tilts it). Azimuth φ is
 * measured so that a positive spin about +Y increases it (x = r cos φ, z = −r sin φ), and the
 * arms TRAIL that rotation: φ_arm(r) = φ_k − cot(pitch)·ln(r / R_ARM0).
 *
 *  - nucleus + bulge (15%): warm, bright, flattened cuspy spheroid, w 0.7–1 (warm primary).
 *  - arms (40%): exactly 3 logarithmic arms (pitch 17.5°, ~1 turn each, radius ≈ 3.2) with
 *    gaussian scatter that widens with radius; sharper inner edge carrying a patchy dark dust
 *    lane, more diffuse outer edge; clumpy "star clouds" along each arm; thin young disk
 *    (σy 0.04–0.085). w 0.24–0.57 (brightest on the ridge, bluer outward).
 *  - knots (6%): ~150 star-forming clumps in OB-association groups just outside the lanes, w 0.72–0.96.
 *  - spurs (2.5%): faint trailing feathers leaving the arms' outer edges at ~50–70° pitch.
 *  - disk (31%): dimmer diffuse exponential disk, density-wave modulated (inter-arm ≈ 1/3 of
 *    arm-side density), also carved by the lanes, thicker (σy 0.055–0.12), w 0.04–0.25 (+warm centre).
 *  - halo (5.5%): faint flattened stellar halo plus 26 small globular clusters.
 * The layout (arm wiggles, star clouds, lanes, knots, spurs, globulars) comes from its own seeded
 * generator, so it is identical at every particle count; `ctx.rng` only drives per-particle sampling.
 * Contract: ./types.ts (canonical frame, w semantics, random particle order, seeded rng only).
 */
import type { FormationGenerator } from './types.ts';
import { FORMATION_BOUND } from './types.ts';
import { allocate, createRng, shufflePoints, smoothstep } from './utils.ts';

const TAU = Math.PI * 2;

/** Arm pitch angle (degrees); real grand-design spirals are ~10–30°. */
const PITCH_DEG = 17.5;
const ARMS = 3;
/** Reference radius of the log spirals (where the arms leave the bulge). */
const R_ARM0 = 0.42;
/** Nominal disk radius (the arms fade out by ~3.35, the diffuse disk by ~3.75). */
const R_DISK = 3.2;

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

export const generateGalaxy: FormationGenerator = ({ count, out, rng, seed, report }) => {
  const NT = normalTable();
  const layout = createRng((seed ^ 0x2c1b3c6d) >>> 0); // structure only: count-independent
  const B = FORMATION_BOUND - 0.02;
  const pitch = (PITCH_DEG * Math.PI) / 180;
  const cotP = 1 / Math.tan(pitch), sinP = Math.sin(pitch);
  const nInv = 1 / Math.sqrt(1 + cotP * cotP);

  const [nNucleus, nBulge, nArms, nKnots, nSpurs, nDisk, nHalo, nGlob] = allocate(
    count, [0.02, 0.13, 0.4, 0.06, 0.025, 0.31, 0.047, 0.008],
  ) as [number, number, number, number, number, number, number, number];

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

  // ---- arm centrelines: φ_k(r) tables incl. gentle per-arm wiggles (real arms kink and wander)
  const TAB = 1024, R_TAB = 4.2;
  // plus per-arm "star cloud" density and width variation along the arm (arms are clumpy, not airbrushed)
  const armPhi = new Float64Array(ARMS * (TAB + 1));
  const armDen = new Float64Array(ARMS * (TAB + 1));
  const armWid = new Float64Array(ARMS * (TAB + 1));
  const laneDep = new Float64Array(ARMS * (TAB + 1));
  const phase0 = layout() * TAU;
  for (let k = 0; k < ARMS; k++) {
    const a1 = 0.05 + 0.05 * layout(), f1 = 2.2 + 1.5 * layout(), c1 = layout() * TAU;
    const a2 = 0.03 + 0.03 * layout(), f2 = 4.5 + 3 * layout(), c2 = layout() * TAU;
    const d1 = 5 + 3 * layout(), e1 = layout() * TAU, d2 = 11 + 6 * layout(), e2 = layout() * TAU, d3 = 2 + layout(), e3 = layout() * TAU;
    const g1 = 3 + 2 * layout(), h1 = layout() * TAU;
    const l1 = 4 + 3 * layout(), m1 = layout() * TAU, l2 = 9 + 5 * layout(), m2 = layout() * TAU;
    for (let i = 0; i <= TAB; i++) {
      const r = Math.max(0.05, (i / TAB) * R_TAB);
      const lr = Math.log(r / R_ARM0);
      const o = k * (TAB + 1) + i;
      armPhi[o] = phase0 + (k * TAU) / ARMS - cotP * lr + a1 * Math.sin(f1 * lr + c1) + a2 * Math.sin(f2 * r + c2);
      const v = 0.5 * Math.sin(d1 * r + e1) + 0.3 * Math.sin(d2 * r + e2) + 0.35 * Math.sin(d3 * r + e3);
      armDen[o] = 0.42 + 0.58 * smoothstep(-0.9, 0.9, v);
      armWid[o] = 1 + 0.22 * Math.sin(g1 * r + h1);
      // dust lanes are patchy: depth wanders along the arm, fading out toward the arm tips
      laneDep[o] = (0.62 + 0.24 * Math.sin(l1 * r + m1) + 0.14 * Math.sin(l2 * r + m2)) * (1 - smoothstep(2.6, 3.3, r));
    }
  }
  const tabAt = (tab: Float64Array, k: number, r: number): number => {
    const x = (r / R_TAB) * TAB;
    const i = x >= TAB ? TAB - 1 : x | 0;
    const o = k * (TAB + 1) + i;
    return tab[o]! + (tab[o + 1]! - tab[o]!) * (x - i);
  };
  const armAt = (k: number, r: number): number => tabAt(armPhi, k, r);
  /** Arm half-width (gaussian σ, perpendicular to the arm) — grows with radius. */
  const armSigma = (r: number): number => 0.05 + 0.06 * r;
  /** Survival probability across arm k at radius r: a dark dust lane hugs the inner (concave) edge. */
  const laneKeep = (dn: number, k: number, r: number): number => {
    const t = (dn + 0.95) / 0.27;
    return 1 - tabAt(laneDep, k, r) * Math.exp(-0.5 * t * t);
  };

  // ---------------------------------------------------------------- nucleus
  for (let i = 0; i < nNucleus; i++) {
    const r1 = rng() * 4096, a1 = r1 | 0, r2 = rng() * 4096, a2 = r2 | 0;
    emit(NT[a1]! * 0.035, NT[((r1 - a1) * 4096) | 0]! * 0.025, NT[a2]! * 0.035, 1);
  }

  // ---------------------------------------------------------------- bulge: flattened, cuspy spheroid
  {
    const bulgeM = inverseCdf((m) => m * m * Math.pow(m + 0.02, -1.6) * Math.exp(-Math.pow(m / 0.3, 1.3)), 0, 1.3);
    for (let i = 0; i < nBulge; i++) {
      const m = sampleTable(bulgeM, rng());
      const q = rng() * 65536, qa = q | 0;
      const cz = 2 * ((qa + 0.5) / 65536) - 1, ph = TAU * (q - qa), s = Math.sqrt(1 - cz * cz);
      const w = 1 - 0.3 * Math.min(1, m / 0.75);
      emit(s * Math.cos(ph) * m, cz * m * 0.6, s * Math.sin(ph) * m, w);
    }
  }

  // ---------------------------------------------------------------- arms
  {
    const armR = inverseCdf(
      (r) => r * Math.exp(-r / 1.35) * smoothstep(0.28, 0.7, r) * (1 - smoothstep(2.7, 3.35, r)), 0.28, 3.4,
    );
    const per = allocate(nArms, [1.06, 0.97, 0.97]); // one arm a touch stronger: real spirals are lopsided
    for (let k = 0; k < ARMS; k++) {
      let i = 0;
      while (i < per[k]!) {
        const r = sampleTable(armR, rng());
        const sig = armSigma(r) * tabAt(armWid, k, r);
        const q = rng() * 4096, qa = q | 0;
        const g = NT[qa]!, gy = NT[((q - qa) * 4096) | 0]!;
        // split normal: sharper inner edge (dn < 0), more diffuse outer edge
        const dn = g < 0 ? g * 0.75 : g * 1.25;
        if (dn > 2.7) continue; // reject (never clamp: clamping piles particles onto a visible line)
        const u = rng();
        if (u > laneKeep(dn, k, r) * tabAt(armDen, k, r)) continue;
        const d = dn * sig;
        const phi = armAt(k, r);
        const c = Math.cos(phi), s = Math.sin(phi);
        // in-plane normal to the arm (points outward): (cot·e_r + e_φ)/|…|
        const nx = (cotP * c - s) * nInv, nz = (-cotP * s - c) * nInv;
        const y = gy * (0.04 + 0.014 * r);
        const ridge = Math.exp(-0.75 * dn * dn);
        const w = 0.4 - 0.16 * Math.min(1, r / R_DISK) + 0.17 * ridge;
        emit(r * c + d * nx, y, -r * s + d * nz, w);
        i++;
      }
    }
  }

  // ---------------------------------------------------------------- knots: star-forming clumps along the arms
  {
    const nK = 150;
    const kd = new Float64Array(nK * 4); // x, y, z, size
    const kw: number[] = [];
    const knotR = inverseCdf((r) => r * Math.exp(-r / 1.6) * smoothstep(0.55, 0.9, r) * (1 - smoothstep(2.8, 3.25, r)), 0.55, 3.3);
    let assocR = 1, assocK = 0, left = 0;
    for (let j = 0; j < nK; j++) {
      // OB associations: groups of 1–4 knots close together along an arm
      if (left <= 0) {
        assocK = (j * 7 + (layout() * 3) | 0) % ARMS;
        do assocR = sampleTable(knotR, layout()); while (layout() > tabAt(armDen, assocK, assocR));
        left = 1 + ((layout() * 4) | 0);
      }
      left--;
      const k = assocK;
      const r = Math.min(3.25, assocR + (layout() - 0.5) * 0.22);
      const sig = armSigma(r);
      const dn = 0.3 + 0.45 * (layout() + layout() - 1);
      const phi = armAt(k, r) + (layout() - 0.5) * 0.08;
      const c = Math.cos(phi), s = Math.sin(phi);
      const nx = (cotP * c - s) * nInv, nz = (-cotP * s - c) * nInv;
      const size = Math.pow(layout(), 2);
      kd[j * 4] = r * c + dn * sig * nx; kd[j * 4 + 1] = (layout() - 0.5) * 0.03; kd[j * 4 + 2] = -r * s + dn * sig * nz;
      kd[j * 4 + 3] = 0.012 + 0.04 * size;
      kw.push(0.25 + size);
    }
    const kc = allocate(nKnots, kw);
    for (let j = 0; j < nK; j++) {
      const cx = kd[j * 4]!, cy = kd[j * 4 + 1]!, cz = kd[j * 4 + 2]!, sz = kd[j * 4 + 3]!;
      const n = kc[j]!;
      for (let i = 0; i < n; i++) {
        const q = rng() * 4096, qa = q | 0, q2 = rng() * 4096, q2a = q2 | 0;
        const gx = NT[qa]!, gz = NT[((q - qa) * 4096) | 0]!, gy = NT[q2a]!;
        const core = Math.exp(-0.5 * (gx * gx + gz * gz));
        emit(cx + gx * sz, cy + gy * sz * 0.45, cz + gz * sz, 0.72 + 0.24 * core);
      }
    }
  }

  // ---------------------------------------------------------------- spurs: faint feathers off the arms' outer edges
  {
    const nS = 36;
    const sp = new Float64Array(nS * 6); // start x, z, dir x, dir z, length, width
    const sw: number[] = [];
    for (let j = 0; j < nS; j++) {
      const k = j % ARMS;
      const r = 1.0 + 2.1 * Math.sqrt(layout());
      const phi = armAt(k, r);
      const c = Math.cos(phi), s = Math.sin(phi);
      const nx = (cotP * c - s) * nInv, nz = (-cotP * s - c) * nInv;
      const off = 0.5 * armSigma(r);
      // trailing, steeper than the arm: sin(ψ)·e_r − cos(ψ)·e_φ with e_r = (c, −s), e_φ = (−s, −c)
      const ps = ((48 + 22 * layout()) * Math.PI) / 180;
      const o = j * 6;
      sp[o] = r * c + off * nx; sp[o + 1] = -r * s + off * nz;
      sp[o + 2] = Math.sin(ps) * c + Math.cos(ps) * s; sp[o + 3] = -Math.sin(ps) * s + Math.cos(ps) * c;
      sp[o + 4] = (0.25 + 0.4 * layout()) * (0.6 + 0.4 * r / 3); sp[o + 5] = 0.018 + 0.018 * layout();
      sw.push(sp[o + 4]!);
    }
    const sc = allocate(nSpurs, sw);
    for (let j = 0; j < nS; j++) {
      const o = j * 6;
      const sx = sp[o]!, sz = sp[o + 1]!, dx = sp[o + 2]!, dz = sp[o + 3]!, len = sp[o + 4]!, wid = sp[o + 5]!;
      const n = sc[j]!;
      for (let i = 0; i < n; i++) {
        const f = 1 - Math.sqrt(rng()); // denser at the root
        const t = f * len;
        const q = rng() * 4096, qa = q | 0;
        const lat = NT[qa]! * wid * (1 + f), y = NT[((q - qa) * 4096) | 0]! * 0.028;
        // gentle shear: the feather bends back toward the trailing direction as it grows
        const bend = 0.35 * f * f * len;
        emit(sx + dx * t - dz * (lat + bend), y, sz + dz * t + dx * (lat + bend), 0.3 * (1 - 0.6 * f) + 0.04);
      }
    }
  }

  // ---------------------------------------------------------------- disk: diffuse, density-wave modulated
  {
    const diskR = inverseCdf((r) => r * Math.exp(-r / 1.05) * (1 - smoothstep(3.0, 3.75, r)), 0.05, 3.8);
    let i = 0;
    while (i < nDisk) {
      const r = sampleTable(diskR, rng());
      const phi = rng() * TAU;
      // nearest arm: signed azimuthal offset (Δ > 0 → outer/convex side), → perpendicular distance
      let best = 10, bestK = 0;
      for (let k = 0; k < ARMS; k++) {
        let dlt = phi - armAt(k, r);
        dlt -= TAU * Math.round(dlt / TAU);
        if (Math.abs(dlt) < Math.abs(best)) { best = dlt; bestK = k; }
      }
      const sig = armSigma(r);
      const dn = (best * r * sinP) / sig;
      const prox = Math.exp(-0.5 * (dn / 2.3) * (dn / 2.3));
      const keep = (0.32 + 0.68 * prox) * laneKeep(dn, bestK, r);
      const q = rng() * 4096, qa = q | 0;
      if ((q - qa) > keep) continue;
      const y = NT[qa]! * (0.055 + 0.02 * r);
      const w = 0.17 - 0.13 * Math.min(1, r / 3.4) + 0.08 * prox + 0.35 * Math.max(0, 1 - r / 1.0);
      emit(r * Math.cos(phi), y, -r * Math.sin(phi), w);
      i++;
    }
  }

  // ---------------------------------------------------------------- halo: faint spheroid
  {
    const haloR = inverseCdf((r) => r * r * Math.pow(1 + (r / 0.8) * (r / 0.8), -1.9) * (1 - smoothstep(3.2, 3.9, r)), 0.1, 3.9);
    for (let i = 0; i < nHalo; i++) {
      const r = sampleTable(haloR, rng());
      const q = rng() * 65536, qa = q | 0;
      const cz = 2 * ((qa + 0.5) / 65536) - 1, ph = TAU * (q - qa), s = Math.sqrt(1 - cz * cz);
      emit(s * Math.cos(ph) * r, cz * r * 0.8, s * Math.sin(ph) * r, 0.05 + 0.12 * Math.max(0, 1 - r / 2.5));
    }
  }

  // ---------------------------------------------------------------- globular clusters
  {
    const nG = 26;
    const gd = new Float64Array(nG * 3);
    for (let j = 0; j < nG; j++) {
      const r = 0.7 + 2.5 * Math.pow(layout(), 1.4);
      const cz = 2 * layout() - 1, ph = TAU * layout(), s = Math.sqrt(1 - cz * cz);
      gd[j * 3] = s * Math.cos(ph) * r; gd[j * 3 + 1] = cz * r * 0.85; gd[j * 3 + 2] = s * Math.sin(ph) * r;
    }
    const gc = allocate(nGlob, new Array<number>(nG).fill(1));
    for (let j = 0; j < nG; j++) {
      const n = gc[j]!;
      for (let i = 0; i < n; i++) {
        const q = rng() * 4096, qa = q | 0, q2 = rng() * 4096, q2a = q2 | 0;
        const sz = 0.02;
        emit(gd[j * 3]! + NT[qa]! * sz, gd[j * 3 + 1]! + NT[((q - qa) * 4096) | 0]! * sz, gd[j * 3 + 2]! + NT[q2a]! * sz, 0.34);
      }
    }
  }

  shufflePoints(out, count, rng);
  report(1);
};
