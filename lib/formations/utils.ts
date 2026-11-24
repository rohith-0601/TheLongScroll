/**
 * Shared, dependency-free math for formation generators (runs in Web Workers and Node).
 */

// ------------------------------------------------------------------------------------ random

/** splitmix32 → seeds sfc32. Returns a fast, high-quality seeded PRNG producing [0, 1). */
export function createRng(seed: number): () => number {
  let s = seed >>> 0;
  const split = (): number => {
    s = (s + 0x9e3779b9) | 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
  let a = split(), b = split(), c = split(), d = split();
  const next = (): number => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  return next;
}

/** Standard normal sample (Box–Muller). */
export function gaussian(rng: () => number): number {
  let u = 0;
  while (u === 0) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function randRange(rng: () => number, lo: number, hi: number): number {
  return lo + (hi - lo) * rng();
}

export type Vec3 = [number, number, number];

/** Uniformly distributed unit vector. */
export function randomUnitVector(rng: () => number, out: Vec3 = [0, 0, 0]): Vec3 {
  const z = 2 * rng() - 1;
  const a = 2 * Math.PI * rng();
  const r = Math.sqrt(1 - z * z);
  out[0] = r * Math.cos(a); out[1] = r * Math.sin(a); out[2] = z;
  return out;
}

/** Uniform point inside the unit ball. */
export function randomInBall(rng: () => number, out: Vec3 = [0, 0, 0]): Vec3 {
  randomUnitVector(rng, out);
  const r = Math.cbrt(rng());
  out[0] *= r; out[1] *= r; out[2] *= r;
  return out;
}

/** i-th of n points of a Fibonacci (golden-angle) lattice on the unit sphere — near-uniform. */
export function fibonacciSphere(i: number, n: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const y = 1 - (2 * (i + 0.5)) / n;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = i * 2.399963229728653; // golden angle
  out[0] = r * Math.cos(theta); out[1] = y; out[2] = r * Math.sin(theta);
  return out;
}

/** In-place seeded Fisher–Yates shuffle of `count` points of `stride` floats each. */
export function shufflePoints(buf: Float32Array, count: number, rng: () => number, stride = 4): void {
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    if (j === i) continue;
    const a = i * stride, b = j * stride;
    for (let k = 0; k < stride; k++) {
      const t = buf[a + k]!; buf[a + k] = buf[b + k]!; buf[b + k] = t;
    }
  }
}

/**
 * Split `total` into integer parts proportional to `weights` (largest-remainder), summing exactly
 * to `total`. Useful for allocating particle budgets between sub-structures.
 */
export function allocate(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (w / sum) * total);
  const out = raw.map(Math.floor);
  let rem = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rem > 0; k = (k + 1) % order.length, rem--) out[order[k]![1]]!++;
  return out;
}

// ------------------------------------------------------------------------------------ scalar helpers

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

// ------------------------------------------------------------------------------------ simplex noise

const GRAD3 = new Float32Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

export type Noise3D = (x: number, y: number, z: number) => number;

/** Seeded 3D simplex noise (Gustavson), output ≈ [-1, 1]. */
export function createNoise3D(rng: () => number): Noise3D {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const r = Math.floor(rng() * (i + 1));
    const t = p[i]!; p[i] = p[r]!; p[r] = t;
  }
  const perm = new Uint8Array(512);
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]!; permMod12[i] = perm[i]! % 12; }
  const F3 = 1 / 3, G3 = 1 / 6;

  return (x: number, y: number, z: number): number => {
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const x0 = x - (i - t), y0 = y - (j - t), z0 = z - (k - t);
    let i1: number, j1: number, k1: number, i2: number, j2: number, k2: number;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let n = 0;
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 > 0) {
      const g = permMod12[ii + perm[jj + perm[kk]!]!]! * 3; t0 *= t0;
      n += t0 * t0 * (GRAD3[g]! * x0 + GRAD3[g + 1]! * y0 + GRAD3[g + 2]! * z0);
    }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 > 0) {
      const g = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]!]!]! * 3; t1 *= t1;
      n += t1 * t1 * (GRAD3[g]! * x1 + GRAD3[g + 1]! * y1 + GRAD3[g + 2]! * z1);
    }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 > 0) {
      const g = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]!]!]! * 3; t2 *= t2;
      n += t2 * t2 * (GRAD3[g]! * x2 + GRAD3[g + 1]! * y2 + GRAD3[g + 2]! * z2);
    }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 > 0) {
      const g = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]!]!]! * 3; t3 *= t3;
      n += t3 * t3 * (GRAD3[g]! * x3 + GRAD3[g + 1]! * y3 + GRAD3[g + 2]! * z3);
    }
    return 32 * n;
  };
}

/** Fractal Brownian motion over a Noise3D. Output roughly [-1, 1]. */
export function fbm3(noise: Noise3D, x: number, y: number, z: number, octaves = 5, lacunarity = 2, gain = 0.5): number {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * freq, y * freq, z * freq);
    norm += amp; amp *= gain; freq *= lacunarity;
  }
  return sum / norm;
}

// ------------------------------------------------------------------------------------ shared Earth land mask

/** Fixed seed so Earth (chapter 3) and the network globe (chapter 8) share the same continents. */
const LAND_SEED = 0x5eed_ea27;
let landNoise: Noise3D | null = null;
let landWarp: Noise3D | null = null;

/**
 * Continuous "elevation" for a point on the unit sphere; land where landValue > LAND_THRESHOLD.
 * Domain-warped fBm gives organic, continent-like shapes. Deterministic across workers.
 */
export function landValue(x: number, y: number, z: number): number {
  if (!landNoise || !landWarp) {
    landNoise = createNoise3D(createRng(LAND_SEED));
    landWarp = createNoise3D(createRng(LAND_SEED ^ 0x9e37));
  }
  const f = 1.35;
  const wx = landWarp(x * 1.1 + 11.3, y * 1.1, z * 1.1) * 0.35;
  const wy = landWarp(x * 1.1, y * 1.1 + 7.7, z * 1.1) * 0.35;
  const wz = landWarp(x * 1.1, y * 1.1, z * 1.1 + 3.1) * 0.35;
  return fbm3(landNoise, (x + wx) * f, (y + wy) * f, (z + wz) * f, 6, 2.05, 0.5);
}

/**
 * Threshold giving roughly Earth's ~29% land fraction for `landValue` (calibrate with
 * scripts/preview-formations.ts → earth stats if the noise changes).
 */
export const LAND_THRESHOLD = 0.08;
