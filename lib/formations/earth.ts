/**
 * Chapter 3 — Earth: a globe of light with brighter, denser continents (glowing coastlines), a dim
 * ocean with brighter continental shelves, noisy polar ice caps, sparse cloud streaks with a few
 * cyclone spirals, and a thin atmosphere shell that glows at the limb.
 *
 * Contract: ./types.ts. Canonical frame: spin axis = +Y (north pole up); the GPU applies the
 * 23.44° axial tilt and the idle spin. Every particle is drawn iid from one mixture distribution
 * (exact rejection sampling), so the particle order is already a uniform random permutation.
 *
 * Speed: the shared `landValue` costs ≈0.5 µs per call, so it is baked into a 128² cube map and
 * only evaluated exactly within ±EXACT_BAND of the coastline. Candidates are drawn per cube texel
 * through a Walker alias table weighted by an upper bound of the target density, so open ocean and
 * inland texels need (almost) no rejection.
 */
import type { FormationGenerator } from './types.ts';
import { createNoise3D, createRng, fbm3, landValue, smoothstep, type Noise3D } from './utils.ts';

/** Globe radius (world units). Chapter 8's network globe uses the same radius and land mask. */
export const EARTH_RADIUS = 2.4;

/**
 * Land threshold for the shared `landValue`. The shared LAND_THRESHOLD (0.08) yields ≈36% land;
 * 0.139 yields Earth's ≈29% (measured over 400k Fibonacci-lattice points). network.ts uses the same.
 */
export const LAND_LEVEL = 0.139;

// ---------------------------------------------------------------------------------------- budget
/** Share of particles in the atmosphere shell (r = 1.03–1.07 R, densest low down, mostly ≥ 1.04 R). */
const ATMO_FRACTION = 0.075;
/** Share of particles in cloud wisps (r ≈ 1.01–1.028 R). The rest (≈87.5%) is the surface. */
const CLOUD_FRACTION = 0.05;
/** Relative density of open ocean (coastal land/ice = 1) → land ≈ 2.2–3× denser than ocean. */
const OCEAN_DENSITY = 0.32;
/** Relative density of inland land; it rises smoothly to 1 at the coastline (≈1.4× denser outline). */
const INLAND_DENSITY = 0.7;
/** Poleward of |y| > ICE_Y the noisy ice-cap test runs (cap edges at |y| ≈ 0.92–0.94). */
const ICE_Y = 0.86;

// ------------------------------------------------------------------------------- cube-map helpers
const LUT_FACE = 128;
/** Max |LUT − exact| measured at 128²: 0.083 → beyond this margin a texel is surely land/ocean. */
const LUT_SAFE = 0.09;
/** Within ±EXACT_BAND of LAND_LEVEL the exact landValue decides (measured: 0.02% misclassified). */
const EXACT_BAND = 0.025;
let landLut: Float32Array | null = null;

/** Unit direction for cube face `f` at gnomonic coordinates (u, v) ∈ [-1, 1]². */
function faceDir(f: number, u: number, v: number, o: Float64Array): void {
  let x: number, y: number, z: number;
  switch (f) {
    case 0: x = 1; y = v; z = -u; break;
    case 1: x = -1; y = v; z = u; break;
    case 2: x = u; y = 1; z = -v; break;
    case 3: x = u; y = -1; z = v; break;
    case 4: x = u; y = v; z = 1; break;
    default: x = -u; y = v; z = -1; break;
  }
  const l = 1 / Math.sqrt(x * x + y * y + z * z);
  o[0] = x * l; o[1] = y * l; o[2] = z * l;
}

/** Sample `fn` on a (F+1)² vertex grid per cube face (bilinear lookup without seams). */
function buildCubeLut(F: number, fn: (x: number, y: number, z: number) => number): Float32Array {
  const S = F + 1;
  const lut = new Float32Array(6 * S * S);
  const d = new Float64Array(3);
  for (let face = 0; face < 6; face++) {
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        faceDir(face, -1 + (2 * i) / F, -1 + (2 * j) / F, d);
        lut[(face * S + j) * S + i] = fn(d[0]!, d[1]!, d[2]!);
      }
    }
  }
  return lut;
}

/** Bilinear lookup of a cube LUT at direction (x, y, z) (need not be normalised). */
function sampleCubeLut(lut: Float32Array, F: number, x: number, y: number, z: number): number {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  let face: number, u: number, v: number;
  if (ax >= ay && ax >= az) {
    const k = 1 / ax;
    if (x > 0) { face = 0; u = -z * k; } else { face = 1; u = z * k; }
    v = y * k;
  } else if (ay >= az) {
    const k = 1 / ay;
    if (y > 0) { face = 2; v = -z * k; } else { face = 3; v = z * k; }
    u = x * k;
  } else {
    const k = 1 / az;
    if (z > 0) { face = 4; u = x * k; } else { face = 5; u = -x * k; }
    v = y * k;
  }
  const S = F + 1, h = 0.5 * F;
  const fx = (u + 1) * h, fy = (v + 1) * h;
  let i = fx | 0, j = fy | 0;
  if (i > F - 1) i = F - 1;
  if (j > F - 1) j = F - 1;
  const tx = fx - i, ty = fy - j;
  const b = (face * S + j) * S + i;
  const a00 = lut[b]!, a10 = lut[b + 1]!, a01 = lut[b + S]!, a11 = lut[b + S + 1]!;
  const top = a00 + (a10 - a00) * tx;
  return top + (a01 + (a11 - a01) * tx - top) * ty;
}

function getLandLut(): Float32Array {
  return landLut ?? (landLut = buildCubeLut(LUT_FACE, landValue));
}

/** Shared-land elevation at a unit direction (exact near the coastline). Land ⇔ value > LAND_LEVEL. */
export function earthLandAt(x: number, y: number, z: number): number {
  const v = sampleCubeLut(getLandLut(), LUT_FACE, x, y, z);
  return v - LAND_LEVEL < EXACT_BAND && LAND_LEVEL - v < EXACT_BAND ? landValue(x, y, z) : v;
}

/**
 * Importance sampler over the texels of a cube map: texel t is picked (Walker alias table) with
 * probability ∝ envelope(t) × area × Jmax(t), then a gnomonic point inside it is accepted with
 * J(u, v)/Jmax(t) (J = solid angle per unit gnomonic area). The result is uniform on the sphere
 * within each texel, scaled by the envelope; callers then accept with density / envelope(t).
 */
interface CubeSampler {
  F: number;
  n: number;
  prob: Float32Array;
  alias: Int32Array;
  /** 1 / max J over each texel. */
  invJmax: Float32Array;
}

function buildCubeSampler(F: number, envelope: Float32Array): CubeSampler {
  const n = 6 * F * F;
  const weight = new Float64Array(n);
  const invJmax = new Float32Array(n);
  let total = 0;
  for (let t = 0; t < n; t++) {
    const rest = t % (F * F);
    const i = rest % F, j = (rest / F) | 0;
    // J = (1 + u² + v²)^(-3/2) is largest at the texel corner nearest the face centre.
    const u0 = -1 + (2 * i) / F, u1 = u0 + 2 / F, v0 = -1 + (2 * j) / F, v1 = v0 + 2 / F;
    const um = u0 > 0 ? u0 : u1 < 0 ? u1 : 0, vm = v0 > 0 ? v0 : v1 < 0 ? v1 : 0;
    const jmax = Math.pow(1 + um * um + vm * vm, -1.5);
    invJmax[t] = 1 / jmax;
    weight[t] = envelope[t]! * jmax;
    total += weight[t]!;
  }
  // Vose's alias method
  const prob = new Float32Array(n);
  const alias = new Int32Array(n);
  const scaled = new Float64Array(n);
  const small = new Int32Array(n), large = new Int32Array(n);
  let ns = 0, nl = 0;
  for (let t = 0; t < n; t++) {
    scaled[t] = (weight[t]! * n) / total;
    if (scaled[t]! < 1) small[ns++] = t; else large[nl++] = t;
  }
  while (ns > 0 && nl > 0) {
    const s = small[--ns]!, l = large[--nl]!;
    prob[s] = scaled[s]!;
    alias[s] = l;
    scaled[l] = scaled[l]! + scaled[s]! - 1;
    if (scaled[l]! < 1) small[ns++] = l; else large[nl++] = l;
  }
  while (nl > 0) { const l = large[--nl]!; prob[l] = 1; alias[l] = l; }
  while (ns > 0) { const s = small[--ns]!; prob[s] = 1; alias[s] = s; }
  return { F, n, prob, alias, invJmax };
}

/** Bilinear interpolation inside a known texel. */
function texelLerp(lut: Float32Array, F: number, face: number, i: number, j: number, tx: number, ty: number): number {
  const S = F + 1;
  const b = (face * S + j) * S + i;
  const a00 = lut[b]!, a10 = lut[b + 1]!, a01 = lut[b + S]!, a11 = lut[b + S + 1]!;
  const top = a00 + (a10 - a00) * tx;
  return top + (a01 + (a11 - a01) * tx - top) * ty;
}

// ------------------------------------------------------------------------------------- generator
/** Rotate p about the unit axis (ax, ay, az) by angle t (Rodrigues), in place. */
function rotateAbout(p: Float64Array, ax: number, ay: number, az: number, t: number): void {
  const c = Math.cos(t), s = Math.sin(t);
  const x = p[0]!, y = p[1]!, z = p[2]!;
  const d = (ax * x + ay * y + az * z) * (1 - c);
  p[0] = x * c + (ay * z - az * y) * s + ax * d;
  p[1] = y * c + (az * x - ax * z) * s + ay * d;
  p[2] = z * c + (ax * y - ay * x) * s + az * d;
}

const TAU = 6.283185307179586;
const TEXEL_FLAG_OCEAN = 1; // surely ocean (all corners far below the level)
const TEXEL_FLAG_LAND = 2; // surely land
const TEXEL_FLAG_POLAR = 4; // may contain ice

export const generateEarth: FormationGenerator = ({ count, out, rng, seed, report }) => {
  const R = EARTH_RADIUS;
  const iceNoise: Noise3D = createNoise3D(createRng(seed ^ 0x1ce1ce));
  const cloudNoise: Noise3D = createNoise3D(createRng(seed ^ 0xc10d5));
  const warpNoise: Noise3D = createNoise3D(createRng(seed ^ 0x3a7f));
  const crng = createRng(seed ^ 0x5a1d);

  // ---- surface sampler: per-texel envelope of the target density
  const lut = getLandLut();
  const F = LUT_FACE, S = F + 1, FF = F * F;
  const flags = new Uint8Array(6 * FF);
  const env = new Float32Array(6 * FF);
  for (let t = 0; t < 6 * FF; t++) {
    const face = (t / FF) | 0, rest = t % FF, i = rest % F, j = (rest / F) | 0;
    const b = (face * S + j) * S + i;
    const c0 = lut[b]!, c1 = lut[b + 1]!, c2 = lut[b + S]!, c3 = lut[b + S + 1]!;
    const hi = Math.max(c0, c1, c2, c3), lo = Math.min(c0, c1, c2, c3);
    let fl = 0;
    if (hi < LAND_LEVEL - LUT_SAFE) fl |= TEXEL_FLAG_OCEAN;
    else if (lo > LAND_LEVEL + LUT_SAFE) fl |= TEXEL_FLAG_LAND;
    if (face === 2 || face === 3) {
      // |y| on a ±Y face is largest at the texel point nearest the face centre
      const u0 = -1 + (2 * i) / F, u1 = u0 + 2 / F, v0 = -1 + (2 * j) / F, v1 = v0 + 2 / F;
      const um = u0 > 0 ? u0 : u1 < 0 ? u1 : 0, vm = v0 > 0 ? v0 : v1 < 0 ? v1 : 0;
      if (1 / Math.sqrt(1 + um * um + vm * vm) > ICE_Y) fl |= TEXEL_FLAG_POLAR;
    }
    flags[t] = fl;
    env[t] = fl & TEXEL_FLAG_POLAR ? 1 : fl & TEXEL_FLAG_OCEAN ? OCEAN_DENSITY : fl & TEXEL_FLAG_LAND ? INLAND_DENSITY : 1;
  }
  const surf = buildCubeSampler(F, env);

  // ---- polar ice-edge noise (only sampled poleward of ICE_Y)
  const ICE_FACE = 64;
  const iceLut = buildCubeLut(ICE_FACE, (x, y, z) =>
    Math.abs(y) < 0.7 ? 0 : fbm3(iceNoise, x * 3.2, y * 3.2, z * 3.2, 4, 2.2, 0.55));

  // ---- clouds: zonal streaks + a few mid-latitude cyclone spirals, weighted by climate belts
  // (ITCZ near the equator, storm tracks near ±48°, clear subtropics).
  const CYCLONES = 7;
  const cyc = new Float64Array(CYCLONES * 5); // axis xyz, angular radius, twist
  for (let k = 0; k < CYCLONES; k++) {
    const north = k % 2 === 0;
    const lat = (north ? 1 : -1) * (0.62 + 0.38 * crng()); // 35°–57°
    const lon = TAU * crng();
    cyc[k * 5] = Math.cos(lat) * Math.sin(lon);
    cyc[k * 5 + 1] = Math.sin(lat);
    cyc[k * 5 + 2] = Math.cos(lat) * Math.cos(lon);
    cyc[k * 5 + 3] = 0.16 + 0.12 * crng();
    // counter-clockwise (seen from above) in the north, clockwise in the south
    cyc[k * 5 + 4] = (north ? 1 : -1) * (3.2 + 1.6 * crng());
  }
  const q = new Float64Array(3);
  const CF = 64, CS = CF + 1, CFF = CF * CF;
  const cloudLut = buildCubeLut(CF, (x, y, z) => {
    q[0] = x; q[1] = y; q[2] = z;
    for (let k = 0; k < CYCLONES; k++) {
      const ax = cyc[k * 5]!, ay = cyc[k * 5 + 1]!, az = cyc[k * 5 + 2]!;
      const cosd = ax * x + ay * y + az * z;
      if (cosd < 0.8) continue;
      const d = Math.acos(Math.min(1, cosd)) / cyc[k * 5 + 3]!;
      rotateAbout(q, ax, ay, az, cyc[k * 5 + 4]! * Math.exp(-d * d));
    }
    const px = q[0]!, py = q[1]!, pz = q[2]!;
    const wx = warpNoise(px * 1.6, py * 1.6, pz * 1.6) * 0.5;
    const wy = warpNoise(px * 1.6 + 9.1, py * 1.6, pz * 1.6) * 0.12;
    const wz = warpNoise(px * 1.6 + 5.2, py * 1.6, pz * 1.6 + 1.3) * 0.5;
    // y stretched → features elongated east–west (zonal winds)
    const n = fbm3(cloudNoise, (px + wx) * 2.6, (py + wy) * 4.2, (pz + wz) * 2.6, 3, 2.1, 0.55);
    const lat = Math.abs(y);
    const belts = 0.6 * Math.exp(-((lat / 0.14) ** 2)) + 0.9 * Math.exp(-(((lat - 0.74) / 0.16) ** 2)) + 0.12;
    return smoothstep(0.1, 0.5, n) * Math.min(1, belts);
  });
  const cloudEnv = new Float32Array(6 * CFF);
  for (let t = 0; t < 6 * CFF; t++) {
    const face = (t / CFF) | 0, rest = t % CFF, i = rest % CF, j = (rest / CF) | 0;
    const b = (face * CS + j) * CS + i;
    cloudEnv[t] = Math.max(cloudLut[b]!, cloudLut[b + 1]!, cloudLut[b + CS]!, cloudLut[b + CS + 1]!);
  }
  const clouds = buildCubeSampler(CF, cloudEnv);

  /**
   * Draw a candidate from `smp`: texel via the alias table, then a uniform gnomonic point in it.
   * Writes cand = [x, y, z, face, i, j, tx, ty, texel] and returns a fresh uniform in [0, 1)
   * (the alias draw's leftover bits) divided by J/Jmax — so `accept ⇔ result × envelope < density`
   * performs the Jacobian correction and the density test with one comparison.
   */
  const cand = new Float64Array(9);
  const candidate = (smp: CubeSampler): number => {
    const r1 = rng() * smp.n;
    let t = r1 | 0;
    let u01 = r1 - t;
    const p = smp.prob[t]!;
    if (u01 < p) u01 /= p; else { u01 = (u01 - p) / (1 - p); t = smp.alias[t]!; }
    const sf = smp.F, sff = sf * sf;
    const face = (t / sff) | 0, rest = t - face * sff, i = rest % sf, j = (rest / sf) | 0;
    const r2 = rng() * 65536;
    const a = r2 | 0;
    const tx = a / 65536 + 1 / 131072, ty = r2 - a;
    const u = -1 + (2 * (i + tx)) / sf, v = -1 + (2 * (j + ty)) / sf;
    const q2 = 1 + u * u + v * v;
    const il = 1 / Math.sqrt(q2);
    let x: number, y: number, z: number;
    switch (face) {
      case 0: x = 1; y = v; z = -u; break;
      case 1: x = -1; y = v; z = u; break;
      case 2: x = u; y = 1; z = -v; break;
      case 3: x = u; y = -1; z = v; break;
      case 4: x = u; y = v; z = 1; break;
      default: x = -u; y = v; z = -1; break;
    }
    cand[0] = x * il; cand[1] = y * il; cand[2] = z * il;
    cand[3] = face; cand[4] = i; cand[5] = j; cand[6] = tx; cand[7] = ty; cand[8] = t;
    // J/Jmax = (1 + u² + v²)^(-3/2) / Jmax
    return (u01 * q2 * Math.sqrt(q2)) / smp.invJmax[t]!;
  };

  const step = Math.max(1, Math.floor(count / 20));
  for (let i = 0; i < count; i++) {
    if (i % step === 0) report(i / count);
    const pick = rng();
    let x = 0, y = 0, z = 0, r = R, w = 0;

    if (pick < ATMO_FRACTION) {
      // Thin atmosphere: truncated-exponential density above 1.03 R (scale height ≈ 0.013 R).
      z = 2 * rng() - 1;
      const a = TAU * rng(), s = Math.sqrt(1 - z * z);
      x = s * Math.cos(a); y = s * Math.sin(a);
      const span = 0.04, hs = 0.013;
      const h = -hs * Math.log(1 - (pick / ATMO_FRACTION) * (1 - Math.exp(-span / hs)));
      r = R * (1.03 + h);
      w = 0.3 - 0.15 * (h / span);
    } else if (pick < ATMO_FRACTION + CLOUD_FRACTION) {
      // Cloud wisps just above the surface, density ∝ coverage.
      let c = 0;
      for (;;) {
        const u = candidate(clouds);
        c = texelLerp(cloudLut, CF, cand[3]!, cand[4]!, cand[5]!, cand[6]!, cand[7]!);
        if (u * cloudEnv[cand[8]!]! < c) break;
      }
      x = cand[0]!; y = cand[1]!; z = cand[2]!;
      r = R * (1.01 + 0.018 * ((pick - ATMO_FRACTION) / CLOUD_FRACTION));
      w = 0.32 + 0.24 * c;
    } else {
      // Surface, relative densities: ice and coastal land 1 → inland land 0.7, open ocean 0.32.
      for (;;) {
        const t = candidate(surf);
        x = cand[0]!; y = cand[1]!; z = cand[2]!;
        const tex = cand[8]!;
        const fl = flags[tex]!;
        const u = t * env[tex]!; // acceptance draw on [0, envelope / (J/Jmax))
        if (fl & TEXEL_FLAG_POLAR) {
          const ay = y < 0 ? -y : y;
          if (ay > ICE_Y) {
            // Polar ice: noisy cap edge (south cap larger, like Antarctica vs Arctic sea ice),
            // dithered so the margin breaks up into floes.
            const edge = y > 0 ? 0.94 : 0.92;
            const ice = (ay - edge) / 0.035 + 1.7 * sampleCubeLut(iceLut, ICE_FACE, x, y, z) + 0.5 * (u - 0.5);
            if (ice > 0) {
              const k = ice > 2 ? 1 : ice * 0.5;
              r = R * (1.003 + 0.004 * k);
              w = 0.84 + 0.14 * k - 0.05 * u;
              break;
            }
          }
        }
        let v = texelLerp(lut, F, cand[3]!, cand[4]!, cand[5]!, cand[6]!, cand[7]!);
        if (!(fl & (TEXEL_FLAG_OCEAN | TEXEL_FLAG_LAND)) && v - LAND_LEVEL < EXACT_BAND && LAND_LEVEL - v < EXACT_BAND) {
          v = landValue(x, y, z);
        }
        if (v > LAND_LEVEL) {
          const above = v - LAND_LEVEL;
          const coast = 1 - smoothstep(0, 0.035, above);
          const c2 = coast * coast;
          const dens = INLAND_DENSITY + (1 - INLAND_DENSITY) * c2;
          if (u >= dens) continue;
          const elev = smoothstep(0.03, 0.42, above);
          r = R * (1.002 + 0.012 * elev);
          // w: 0.74–0.88 inland (higher ground brighter) → 1 at the coastline
          w = 0.76 + 0.24 * c2 + 0.1 * elev + 0.04 * (u / dens - 0.5);
          if (w > 1) w = 1;
          break;
        }
        if (u < OCEAN_DENSITY) {
          const shelf = 1 - smoothstep(0, 0.09, LAND_LEVEL - v);
          r = R;
          w = 0.12 + 0.18 * shelf * shelf + 0.03 * (u / OCEAN_DENSITY - 0.5);
          break;
        }
      }
    }
    const o = i * 4;
    out[o] = x * r; out[o + 1] = y * r; out[o + 2] = z * r; out[o + 3] = w;
  }
  report(1);
};
