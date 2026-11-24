/**
 * Chapter 7 — the Moon: a cratered sphere whose crater rims catch the light.
 *
 * The familiar near side faces +Z (the default camera). The real maria (Imbrium, Serenitatis,
 * Tranquillitatis — where Apollo 11 landed —, Crisium, Procellarum…) sit at their selenographic
 * coordinates as dark, sparse, low-albedo basins with low-frequency-noise shores; a few dozen real
 * named craters (Tycho, Copernicus and Kepler with bright ejecta rays; Clavius, Plato, Grimaldi,
 * Theophilus, the rings of Orientale…) sit among a random crater population with a lunar-like
 * size–frequency distribution (N(>D) ∝ D⁻²: many small, few large). Pre-mare craters are buried
 * where the lava flooded; younger craters overprint older ones.
 *
 * Each crater: a depressed, darker bowl (radius pushed in), a raised bright rim (pushed out,
 * w ≈ 0.62–1 by freshness), a bright ejecta blanket when fresh, a central peak when large. Rims and
 * rays get their own particle budgets, so rims are the brightest, densest features and read as
 * rings even at 250k particles.
 *
 * Mixture (iid per particle → random order):
 *   65% surface (uniform, thinned in maria and bowls) · 30.5% crater rims + central peaks · 4.4% rays
 *   · 0.08% six tiny glints at the Apollo landing sites (6 landings × 2 moonwalkers = the chapter's
 *   "twelve people"; Apollo 11 at Tranquility Base slightly brighter).
 * Crater lookups use an equal-area latitude-band × longitude grid with per-cell crater lists in age
 * order, so a particle tests only the ~2–3 craters that can reach it.
 *
 * Canonical frame: lunar north = +Y, near-side centre (0°, 0°) = +Z, east (+longitude) = +X.
 */
import type { FormationGenerator } from './types.ts';
import { createNoise3D, createRng, fbm3, gaussian, smoothstep, type Noise3D } from './utils.ts';

const R = 2.4;
const KM = 1 / 1737.4; // kilometres on the lunar surface → radians
const DEG = Math.PI / 180;
const TAU = 2 * Math.PI;
/** Crater radii are exaggerated a little so the population reads at screen scale. */
const SIZE_EXAG = 1.3;

const SURFACE_FRACTION = 0.65;
const RIM_FRACTION = 0.305;
/** Six faint glints at the Apollo landing sites (rays get the remaining ≈4.4%). */
const APOLLO_FRACTION = 0.0008;

/** Mare basins: [lat°, lon°, radius km, darkness 0..1]. Irregular maria use several blobs. */
const MARIA: readonly (readonly [number, number, number, number])[] = [
  [32.8, -15.6, 560, 0.92], // Imbrium
  [28.0, 17.5, 345, 0.85], // Serenitatis
  [8.5, 31.4, 330, 1.0], // Tranquillitatis
  [14.5, 25.0, 200, 1.0],
  [2.0, 38.0, 220, 0.95],
  [17.0, 59.1, 250, 0.95], // Crisium
  [-7.8, 51.3, 260, 0.85], // Fecunditatis
  [-2.0, 53.0, 200, 0.85],
  [-15.2, 35.5, 160, 0.85], // Nectaris
  [-21.3, -16.6, 330, 0.75], // Nubium
  [-24.4, -38.6, 190, 0.88], // Humorum
  [-10.0, -23.1, 180, 0.72], // Cognitum
  [7.5, -30.9, 250, 0.72], // Insularum
  [13.3, 3.6, 120, 0.78], // Vaporum
  [2.4, 1.7, 140, 0.55], // Sinus Medii
  [10.9, -8.8, 140, 0.7], // Sinus Aestuum
  [44.1, -31.5, 120, 0.8], // Sinus Iridum
  [57.0, -35.0, 110, 0.7], // Frigoris (a thin east–west band)
  [56.0, -15.0, 120, 0.72],
  [56.5, 5.0, 120, 0.72],
  [57.0, 25.0, 110, 0.7],
  [59.0, 42.0, 90, 0.62],
  [40.0, -48.0, 300, 0.9], // Oceanus Procellarum
  [26.0, -57.0, 360, 0.95],
  [12.0, -56.0, 380, 0.95],
  [0.0, -50.0, 320, 0.9],
  [-8.0, -43.0, 230, 0.85],
  [20.0, -40.0, 230, 0.9],
  [1.3, 87.5, 180, 0.6], // Smythii
  [13.3, 86.1, 200, 0.6], // Marginis
  [6.8, 68.4, 110, 0.6], // Undarum
  [-38.9, 93.0, 280, 0.45], // Australe
  [-19.4, -92.8, 150, 0.75], // Orientale (central mare)
  [56.8, 81.5, 130, 0.6], // Humboldtianum
  [27.3, 147.9, 135, 0.8], // Moscoviense (far side)
  [-33.7, 163.5, 150, 0.45], // Ingenii (far side)
  [-53.0, -169.0, 1200, 0.22], // South Pole–Aitken basin (subtle)
];

const KIND_OLD = 0, KIND_FRESH = 1, KIND_DARK = 2, KIND_RING = 3, KIND_BASIN = 4;
type NamedCrater = readonly [lat: number, lon: number, radiusKm: number, kind: number, freshness: number];
/** Named craters older than most random ones, oldest first. */
const NAMED_OLD: readonly NamedCrater[] = [
  [-19.4, -92.8, 465, KIND_RING, 0.3], // Orientale: Montes Cordillera
  [-19.4, -92.8, 310, KIND_RING, 0.3], // Orientale: outer Rook ring
  [-19.4, -92.8, 240, KIND_RING, 0.3], // Orientale: inner Rook ring
  // far-side basins: old and heavily degraded (soft, faint rims)
  [-36.1, -151.8, 270, KIND_BASIN, 0], // Apollo
  [2.6, -128.7, 268, KIND_BASIN, 0], // Hertzsprung
  [-4.0, -157.4, 218, KIND_BASIN, 0], // Korolev
  [5.4, 140.9, 156, KIND_BASIN, 0.05], // Mendeleev
  [58.7, -146.1, 165, KIND_BASIN, 0.05], // Birkhoff
  [-75.0, 132.4, 158, KIND_OLD, 0.15], // Schrödinger
  [-20.2, 149.2, 131, KIND_OLD, 0.1], // Gagarin
  [-66.5, -69.1, 150, KIND_OLD, 0.12], // Bailly
  [-58.4, -14.4, 115, KIND_OLD, 0.3], // Clavius
  [-50.5, -6.3, 97, KIND_OLD, 0.2], // Maginus
  [-44.3, -54.6, 103, KIND_DARK, 0.2], // Schickard
  [-9.3, -1.9, 77, KIND_DARK, 0.25], // Ptolemaeus (flooded floor)
  [-11.2, 4.0, 68, KIND_OLD, 0.25], // Albategnius
  [-5.1, 5.2, 69, KIND_OLD, 0.2], // Hipparchus
  [-13.4, -3.2, 55, KIND_OLD, 0.35], // Alphonsus
  [-18.2, -1.9, 48, KIND_OLD, 0.5], // Arzachel
  [-49.6, -21.7, 72, KIND_OLD, 0.3], // Longomontanus
  [-5.2, -68.6, 86, KIND_DARK, 0.4], // Grimaldi
  [51.6, -9.3, 50, KIND_DARK, 0.5], // Plato
  [53.6, 57.0, 62, KIND_DARK, 0.4], // Endymion
  [31.8, 29.9, 48, KIND_OLD, 0.35], // Posidonius
  [-13.2, 24.0, 49, KIND_OLD, 0.35], // Cyrillus
  [-18.1, 23.6, 50, KIND_OLD, 0.35], // Catharina
  [-25.3, 60.4, 88, KIND_FRESH, 0.6], // Petavius
  [-8.9, 61.0, 66, KIND_FRESH, 0.65], // Langrenus
  [-11.4, 26.4, 50, KIND_FRESH, 0.7], // Theophilus
  [29.7, -4.0, 41, KIND_DARK, 0.6], // Archimedes
  [-20.4, 129.1, 92, KIND_DARK, 0.6], // Tsiolkovskiy (far side)
];
/** Named young craters, added after every random crater (youngest last). */
const NAMED_YOUNG: readonly NamedCrater[] = [
  [14.5, -11.3, 29, KIND_FRESH, 0.75], // Eratosthenes
  [16.1, 46.8, 14, KIND_FRESH, 1.0], // Proclus
  [8.1, -38.0, 16, KIND_FRESH, 1.0], // Kepler (rayed)
  [23.7, -47.4, 20, KIND_FRESH, 1.0], // Aristarchus (the brightest spot on the Moon)
  [9.6, -20.1, 47, KIND_FRESH, 1.0], // Copernicus (rayed)
  [-43.3, -11.2, 43, KIND_FRESH, 1.0], // Tycho (rayed)
];

/** Apollo landing sites: [lat°, lon°, relative weight] (11, 12, 14, 15, 16, 17). */
const APOLLO_SITES: readonly (readonly [number, number, number])[] = [
  [0.674, 23.473, 1.8], // Apollo 11 — Tranquility Base, 20 July 1969
  [-3.012, -23.422, 1], // Apollo 12 — Oceanus Procellarum
  [-3.645, -17.471, 1], // Apollo 14 — Fra Mauro
  [26.132, 3.634, 1], // Apollo 15 — Hadley–Apennine
  [-8.973, 15.5, 1], // Apollo 16 — Descartes Highlands
  [20.191, 30.772, 1], // Apollo 17 — Taurus–Littrow
];

/**
 * Ray systems: [index into NAMED_YOUNG, ray count, longest ray (rad), avoidance-wedge azimuth,
 * wedge half-width]. Azimuth 0 = west, π/2 = south. Tycho's rays (up to ~1500 km) leave a
 * ray-free wedge to the west — the signature of an oblique impact.
 */
const RAY_SYSTEMS: readonly (readonly [number, number, number, number, number])[] = [
  [5, 24, 0.9, 0.15, 0.5], // Tycho
  [4, 18, 0.46, 0, 0], // Copernicus
  [2, 12, 0.24, 0, 0], // Kepler
];

// ------------------------------------------------------------------------------- cube-map LUT
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

/** Two-channel cube LUT on a (F+1)² vertex grid per face; fn writes channel values into `v`. */
function buildCubeLut2(F: number, fn: (x: number, y: number, z: number, v: Float64Array) => void): Float32Array {
  const S = F + 1;
  const lut = new Float32Array(6 * S * S * 2);
  const d = new Float64Array(3), v = new Float64Array(2);
  for (let face = 0; face < 6; face++) {
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        faceDir(face, -1 + (2 * i) / F, -1 + (2 * j) / F, d);
        fn(d[0]!, d[1]!, d[2]!, v);
        const b = ((face * S + j) * S + i) * 2;
        lut[b] = v[0]!; lut[b + 1] = v[1]!;
      }
    }
  }
  return lut;
}

/** Bilinear two-channel lookup at direction (x, y, z) into `o`. */
function sampleCubeLut2(lut: Float32Array, F: number, x: number, y: number, z: number, o: Float64Array): void {
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
  const b = ((face * S + j) * S + i) * 2, bs = b + 2 * S;
  const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
  o[0] = lut[b]! * w00 + lut[b + 2]! * w10 + lut[bs]! * w01 + lut[bs + 2]! * w11;
  o[1] = lut[b + 1]! * w00 + lut[b + 3]! * w10 + lut[bs + 1]! * w01 + lut[bs + 3]! * w11;
}

// ------------------------------------------------------------------------------------ helpers
/** cos/sin of 2π·j/16384: azimuths drawn with 14 bits (meridian spacing ≪ particle spacing at 1M). */
const TRIG_BITS = 14, TRIG_N = 1 << TRIG_BITS;
const COS_T = new Float64Array(TRIG_N), SIN_T = new Float64Array(TRIG_N);
for (let j = 0; j < TRIG_N; j++) { COS_T[j] = Math.cos((TAU * j) / TRIG_N); SIN_T[j] = Math.sin((TAU * j) / TRIG_N); }

/** atan2 approximation (max error ≈ 1e-5 rad), used only to pick a grid cell. */
function fastAtan2(y: number, x: number): number {
  const ax = x < 0 ? -x : x, ay = y < 0 ? -y : y;
  const a = (ax < ay ? ax : ay) / ((ax > ay ? ax : ay) + 1e-300);
  const s = a * a;
  let r = ((-0.0464964749 * s + 0.15931422) * s - 0.327622764) * s * a + a;
  if (ay > ax) r = 1.5707963267948966 - r;
  if (x < 0) r = 3.141592653589793 - r;
  return y < 0 ? -r : r;
}

const dirFromLatLon = (lat: number, lon: number, o: Float64Array, k: number): void => {
  o[k] = Math.cos(lat) * Math.sin(lon);
  o[k + 1] = Math.sin(lat);
  o[k + 2] = Math.cos(lat) * Math.cos(lon);
};

/** Walker alias table over non-negative weights. */
function buildAlias(weights: Float64Array): { prob: Float64Array; alias: Int32Array } {
  const n = weights.length;
  let total = 0;
  for (let i = 0; i < n; i++) total += weights[i]!;
  const prob = new Float64Array(n), alias = new Int32Array(n), scaled = new Float64Array(n);
  const small = new Int32Array(n), large = new Int32Array(n);
  let ns = 0, nl = 0;
  for (let i = 0; i < n; i++) {
    scaled[i] = (weights[i]! * n) / total;
    if (scaled[i]! < 1) small[ns++] = i; else large[nl++] = i;
  }
  while (ns > 0 && nl > 0) {
    const s = small[--ns]!, l = large[--nl]!;
    prob[s] = scaled[s]!; alias[s] = l;
    scaled[l] = scaled[l]! + scaled[s]! - 1;
    if (scaled[l]! < 1) small[ns++] = l; else large[nl++] = l;
  }
  while (nl > 0) { const l = large[--nl]!; prob[l] = 1; alias[l] = l; }
  while (ns > 0) { const s = small[--ns]!; prob[s] = 1; alias[s] = s; }
  return { prob, alias };
}

// ------------------------------------------------------------------------------------ generator
export const generateMoon: FormationGenerator = ({ count, out, rng, seed, report }) => {
  const crng = createRng(seed ^ 0x7c0de);
  const edgeNoise: Noise3D = createNoise3D(createRng(seed ^ 0x3a1e));
  const mottleNoise: Noise3D = createNoise3D(createRng(seed ^ 0x6b0b));
  const rayRng = createRng(seed ^ 0x7a75);

  // ---------------------------------------------------------------- maria + mottling (baked)
  const NM = MARIA.length;
  const mDir = new Float64Array(NM * 3), mInvA = new Float64Array(NM), mCos = new Float64Array(NM), mDark = new Float64Array(NM);
  for (let k = 0; k < NM; k++) {
    const [lat, lon, rkm, dark] = MARIA[k]!;
    dirFromLatLon(lat * DEG, lon * DEG, mDir, k * 3);
    const a = rkm * KM;
    mInvA[k] = 1 / a;
    mCos[k] = Math.cos(Math.min(Math.PI, a * 1.35));
    mDark[k] = dark;
  }
  const LF = 80;
  // channel 0: mare coverage 0..1 · channel 1: albedo mottling ≈ [-1, 1]
  const lut = buildCubeLut2(LF, (x, y, z, v) => {
    const n = fbm3(edgeNoise, x * 2.3, y * 2.3, z * 2.3, 3, 2.1, 0.5);
    let m = 0;
    for (let k = 0; k < NM; k++) {
      const dot = x * mDir[k * 3]! + y * mDir[k * 3 + 1]! + z * mDir[k * 3 + 2]!;
      if (dot < mCos[k]!) continue;
      const d = Math.acos(Math.min(1, dot)) * mInvA[k]! + 0.24 * n;
      const c = mDark[k]! * (1 - smoothstep(0.8, 1.04, d));
      if (c > m) m = c;
    }
    v[0] = m;
    v[1] = fbm3(mottleNoise, x * 4, y * 4, z * 4, 3, 2.2, 0.5);
  });
  const lv = new Float64Array(2);

  // ---------------------------------------------------------------- craters (age order)
  const N_RANDOM = 1900;
  const MAXK = N_RANDOM + NAMED_OLD.length + NAMED_YOUNG.length;
  const cDir = new Float64Array(MAXK * 3), cE1 = new Float64Array(MAXK * 3), cE2 = new Float64Array(MAXK * 3);
  const cA = new Float64Array(MAXK), cInvChord = new Float64Array(MAXK), cCosReach = new Float64Array(MAXK);
  const cReach = new Float64Array(MAXK), cSig = new Float64Array(MAXK), cRimW = new Float64Array(MAXK);
  const cDepth = new Float64Array(MAXK), cRimH = new Float64Array(MAXK), cFresh = new Float64Array(MAXK);
  const cKind = new Uint8Array(MAXK), cPeak = new Uint8Array(MAXK);
  let K = 0;
  const tmp = new Float64Array(3);
  const addCrater = (x: number, y: number, z: number, radiusKm: number, kind: number, fresh: number): number => {
    const k = K++;
    cDir[k * 3] = x; cDir[k * 3 + 1] = y; cDir[k * 3 + 2] = z;
    // tangent basis: e1 = c × up (west), e2 = c × e1 (south); poles fall back to +X
    let ex = -z, ez = x;
    let l = Math.hypot(ex, ez);
    if (l < 1e-6) { ex = 1; ez = 0; l = 1; }
    ex /= l; ez /= l;
    cE1[k * 3] = ex; cE1[k * 3 + 1] = 0; cE1[k * 3 + 2] = ez;
    cE2[k * 3] = y * ez; cE2[k * 3 + 1] = z * ex - x * ez; cE2[k * 3 + 2] = -y * ex;
    const ring = kind === KIND_RING;
    const a = radiusKm * KM * (ring ? 1 : SIZE_EXAG);
    cA[k] = a;
    cInvChord[k] = 1 / (2 * Math.sin(a / 2));
    const reach = ring ? 1.25 : 1.35 + 0.85 * fresh;
    cReach[k] = reach;
    cCosReach[k] = Math.cos(Math.min(Math.PI, reach * a));
    const basin = kind === KIND_BASIN;
    cSig[k] = ring ? 0.06 : basin ? 0.17 : 0.065 + 0.075 * (1 - fresh);
    // degraded old rims ≈0.75–0.85, fresh ≈0.85–1; giant degraded basins and rings fainter
    cRimW[k] = ring ? 0.7 : basin ? 0.64 : 0.72 + 0.28 * fresh;
    const rw = a * R;
    cDepth[k] = ring ? 0 : (0.07 + 0.11 * fresh) * rw;
    cRimH[k] = (ring ? 0.012 : 0.025 + 0.045 * fresh) * rw;
    cFresh[k] = fresh;
    cKind[k] = kind;
    cPeak[k] = !ring && !basin && rw > 0.085 ? 1 : 0;
    return k;
  };

  // Random population, N(>r) ∝ r⁻² between rMin and rMax (km). 72% are pre-mare (degraded,
  // buried inside maria); the rest are younger and sparser on the maria (younger surfaces).
  const rMin = 16, rMax = 150;
  const q2 = (rMin / rMax) ** 2;
  const randomCrater = (young: boolean): void => {
    for (let tries = 0; tries < 50; tries++) {
      const z = 2 * crng() - 1, ang = TAU * crng(), s = Math.sqrt(1 - z * z);
      const x = s * Math.cos(ang), y = s * Math.sin(ang);
      const rkm = rMin / Math.sqrt(1 - crng() * (1 - q2));
      sampleCubeLut2(lut, LF, x, y, z, lv);
      const keep = crng();
      if (!young) {
        if (lv[0]! > 0.3) continue;
        addCrater(x, y, z, rkm, KIND_OLD, 0.08 + 0.35 * crng());
      } else {
        if (lv[0]! > 0.3 && keep > 0.3) continue;
        addCrater(x, y, z, rkm, KIND_FRESH, 0.45 + 0.55 * crng() ** 1.5);
      }
      return;
    }
  };
  const N_OLD = Math.round(N_RANDOM * 0.72);
  for (let k = 0; k < N_OLD; k++) randomCrater(false);
  for (const [lat, lon, rkm, kind, fresh] of NAMED_OLD) {
    dirFromLatLon(lat * DEG, lon * DEG, tmp, 0);
    addCrater(tmp[0]!, tmp[1]!, tmp[2]!, rkm, kind, fresh);
  }
  for (let k = N_OLD; k < N_RANDOM; k++) randomCrater(true);
  const namedYoung = NAMED_YOUNG.map(([lat, lon, rkm, kind, fresh]) => {
    dirFromLatLon(lat * DEG, lon * DEG, tmp, 0);
    return addCrater(tmp[0]!, tmp[1]!, tmp[2]!, rkm, kind, fresh);
  });

  // ---------------------------------------------------------------- spatial grid (equal-area bands × longitude)
  const NB = 96, NL = 192;
  const cellStart = new Int32Array(NB * NL + 1);
  const forEachCell = (k: number, fn: (cell: number) => void): void => {
    const x = cDir[k * 3]!, y = cDir[k * 3 + 1]!, z = cDir[k * 3 + 2]!;
    const rho = cReach[k]! * cA[k]! + 1e-4;
    const lat0 = Math.asin(Math.max(-1, Math.min(1, y)));
    const latLo = lat0 - rho, latHi = lat0 + rho;
    const b0 = Math.max(0, Math.floor(((Math.sin(Math.max(-Math.PI / 2, latLo)) + 1) / 2) * NB));
    const b1 = Math.min(NB - 1, Math.floor(((Math.sin(Math.min(Math.PI / 2, latHi)) + 1) / 2) * NB));
    let l0 = 0, l1 = NL - 1;
    if (latHi < Math.PI / 2 && latLo > -Math.PI / 2) {
      const lon0 = Math.atan2(x, z);
      const dl = Math.asin(Math.min(1, Math.sin(rho) / Math.cos(lat0)));
      l0 = Math.floor(((lon0 - dl) / TAU + 0.5) * NL);
      l1 = Math.floor(((lon0 + dl) / TAU + 0.5) * NL);
      if (l1 - l0 >= NL - 1) { l0 = 0; l1 = NL - 1; }
    }
    for (let b = b0; b <= b1; b++) {
      for (let l = l0; l <= l1; l++) fn(b * NL + (((l % NL) + NL) % NL));
    }
  };
  for (let k = 0; k < K; k++) forEachCell(k, (c) => { cellStart[c + 1]!++; });
  for (let c = 0; c < NB * NL; c++) cellStart[c + 1]! += cellStart[c]!;
  const cellItems = new Int32Array(cellStart[NB * NL]!);
  const fill = Int32Array.from(cellStart);
  for (let k = 0; k < K; k++) forEachCell(k, (c) => { cellItems[fill[c]!++] = k; }); // keeps age order

  // ---------------------------------------------------------------- the surface field
  /** fo = [w, radial offset, density factor (≤ 1), visibility 0..1 of the target crater's rim] */
  const fo = new Float64Array(4);
  const field = (x: number, y: number, z: number, target: number): void => {
    sampleCubeLut2(lut, LF, x, y, z, lv);
    const m = lv[0]!, n = lv[1]!;
    const high = 0.5 + 0.1 * n;
    let w = high + (0.15 + 0.05 * n - high) * m;
    let dens = 1 - 0.5 * m;
    let h = 0, keep = 0;
    let b = ((y + 1) * 0.5 * NB) | 0;
    if (b > NB - 1) b = NB - 1; else if (b < 0) b = 0;
    let l = Math.floor((fastAtan2(x, z) / TAU + 0.5) * NL);
    if (l >= NL) l -= NL; else if (l < 0) l += NL;
    const cell = b * NL + l;
    for (let p = cellStart[cell]!, e = cellStart[cell + 1]!; p < e; p++) {
      const k = cellItems[p]!;
      const k3 = k * 3;
      const dot = x * cDir[k3]! + y * cDir[k3 + 1]! + z * cDir[k3 + 2]!;
      if (dot < cCosReach[k]!) continue;
      const c2 = 2 - 2 * dot;
      const d = (c2 > 0 ? Math.sqrt(c2) : 0) * cInvChord[k]!;
      const kind = cKind[k]!;
      if (kind !== KIND_RING) {
        if (d < 1) {
          // bowl: overwrite what was there (younger overprints older)
          let t = 1;
          if (d > 0.78) { const s = (d - 0.78) / 0.22; t = 1 - s * s * (3 - 2 * s); }
          const floorW = kind === KIND_DARK ? 0.12 + 0.04 * n : w * (kind === KIND_BASIN ? 0.85 : 0.6 + 0.3 * cFresh[k]!);
          w += (floorW - w) * t;
          h += (-cDepth[k]! * (1 - d * d) - h) * t;
          dens *= 1 - 0.2 * t; // bowls a little sparser than their surroundings
          keep *= 1 - t; // a younger bowl erases older rims
          if (cPeak[k]! && d < 0.3) {
            const pk = Math.exp(-(d * d) * 100);
            w += (0.84 - w) * pk;
            h += cDepth[k]! * 0.55 * pk;
          }
        } else if (cFresh[k]! > 0.45) {
          // bright ejecta blanket of fresh craters, fading to the reach radius
          const reach = cReach[k]!;
          const fade = d > reach * 0.75 ? 1 - smoothstep(reach * 0.75, reach, d) : 1;
          const id3 = 1 / (d * d * d);
          w += (1 - w) * cFresh[k]! * 0.2 * id3 * fade;
          h += cRimH[k]! * 0.6 * id3 * fade;
        }
      }
      const tr = (d - 1) / cSig[k]!;
      if (tr > -2.2 && tr < 2.2) {
        const g = Math.exp(-tr * tr);
        if (cRimW[k]! > w) w += (cRimW[k]! - w) * g;
        h += cRimH[k]! * g;
        if (k === target) keep = 1; // the target's rim exists here; only younger bowls can erase it
      }
    }
    fo[0] = w > 1 ? 1 : w < 0 ? 0 : w;
    fo[1] = h;
    fo[2] = dens;
    fo[3] = keep;
  };

  // ---------------------------------------------------------------- rim sampler
  // Rim budget ∝ a^1.6 × brightness³ (big, fresh rims read first; small ones are texture), growing
  // only with circumference beyond a ≈ 0.12 rad so the giant degraded basins stay subtle.
  const A_CAP = 0.12;
  const rimWeights = new Float64Array(K);
  for (let k = 0; k < K; k++) {
    const a = cA[k]!, size = a < A_CAP ? a ** 1.6 : A_CAP ** 1.6 * (a / A_CAP);
    rimWeights[k] = size * cRimW[k]! ** 3 * (cKind[k] === KIND_RING || cKind[k] === KIND_BASIN ? 0.5 : 1);
  }
  const rimAlias = buildAlias(rimWeights);

  // ---------------------------------------------------------------- ray systems (explicit streaks)
  const rays: number[] = []; // per ray: crater, azimuth, length, half-width, brightness, phase1, phase2
  for (const [named, nRays, maxLen, avoidAz, avoidHalf] of RAY_SYSTEMS) {
    const k = namedYoung[named]!;
    const span = TAU - 2 * avoidHalf;
    for (let r = 0; r < nRays; r++) {
      const az = avoidAz + avoidHalf + span * ((r + 0.5 + 0.8 * (rayRng() - 0.5)) / nRays);
      const len = maxLen * (0.3 + 0.7 * rayRng() ** 0.8);
      const halfW = 0.0045 + 0.0075 * rayRng();
      const bright = 0.55 + 0.45 * rayRng();
      rays.push(k, az, len, halfW, bright, TAU * rayRng(), TAU * rayRng());
    }
  }
  const RS = 7;
  const nRay = rays.length / RS;
  const rayData = Float64Array.from(rays);
  const rayWeights = new Float64Array(nRay);
  for (let r = 0; r < nRay; r++) rayWeights[r] = rayData[r * RS + 2]! * rayData[r * RS + 4]!;
  const rayAlias = buildAlias(rayWeights);

  const pickAlias = (t: { prob: Float64Array; alias: Int32Array }, u: number): number => {
    const x = u * t.prob.length;
    const i = x | 0;
    return x - i < t.prob[i]! ? i : t.alias[i]!;
  };

  // ---------------------------------------------------------------- Apollo landing-site glints
  const NA = APOLLO_SITES.length;
  const aDir = new Float64Array(NA * 3), aE1 = new Float64Array(NA * 3), aE2 = new Float64Array(NA * 3);
  const aCdf = new Float64Array(NA);
  let aTot = 0;
  for (let s = 0; s < NA; s++) {
    const [lat, lon, wgt] = APOLLO_SITES[s]!;
    dirFromLatLon(lat * DEG, lon * DEG, aDir, s * 3);
    const x = aDir[s * 3]!, y = aDir[s * 3 + 1]!, z = aDir[s * 3 + 2]!;
    const l = Math.hypot(z, x);
    const ex = -z / l, ez = x / l;
    aE1[s * 3] = ex; aE1[s * 3 + 2] = ez;
    aE2[s * 3] = y * ez; aE2[s * 3 + 1] = z * ex - x * ez; aE2[s * 3 + 2] = -y * ex;
    aTot += wgt;
    aCdf[s] = aTot;
  }

  // ---------------------------------------------------------------- particles
  const step = Math.max(1, Math.floor(count / 20));
  for (let i = 0; i < count; i++) {
    if (i % step === 0) report(i / count);
    const pick = rng();
    let x = 0, y = 0, z = 0;
    if (pick < SURFACE_FRACTION) {
      let u = pick / SURFACE_FRACTION; // fresh uniform for the first acceptance test
      for (;;) {
        // one draw → 18 bits for z, 14 bits for the azimuth (finer than the 1M-particle spacing)
        const r1 = rng() * 262144;
        const zi = r1 | 0, j = ((r1 - zi) * TRIG_N) | 0;
        z = (zi + 0.5) / 131072 - 1;
        const s = Math.sqrt(1 - z * z);
        x = s * COS_T[j]!; y = s * SIN_T[j]!;
        field(x, y, z, -1);
        if (u < fo[2]!) break;
        u = rng();
      }
    } else if (pick < SURFACE_FRACTION + RIM_FRACTION) {
      for (;;) {
        const k = pickAlias(rimAlias, rng());
        let d: number, isPeak = false;
        // triangular jitter (sum of two 16-bit uniforms, σ ≈ 0.41) from a single draw
        const r2 = rng() * 65536, h16 = r2 | 0;
        const tri = h16 / 65536 + (r2 - h16) - 1;
        if (cPeak[k]! && rng() < 0.16) { d = Math.abs(tri) * 0.18; isPeak = true; }
        else d = 1 + cSig[k]! * tri;
        const th = d * cA[k]!, j = (rng() * TRIG_N) | 0;
        const ct = Math.cos(th), st = Math.sin(th), cp = COS_T[j]! * st, sp = SIN_T[j]! * st;
        const k3 = k * 3;
        x = cDir[k3]! * ct + cE1[k3]! * cp + cE2[k3]! * sp;
        y = cDir[k3 + 1]! * ct + cE1[k3 + 1]! * cp + cE2[k3 + 1]! * sp;
        z = cDir[k3 + 2]! * ct + cE1[k3 + 2]! * cp + cE2[k3 + 2]! * sp;
        field(x, y, z, k);
        if (isPeak || fo[3]! > 0.5) break; // rim erased by a younger crater → resample
      }
    } else if (pick < SURFACE_FRACTION + RIM_FRACTION + APOLLO_FRACTION) {
      // Apollo landing site: a tiny tight glint (σ ≈ 0.006 world units)
      const ua = ((pick - SURFACE_FRACTION - RIM_FRACTION) / APOLLO_FRACTION) * aTot;
      let sIdx = 0;
      while (sIdx < NA - 1 && aCdf[sIdx]! < ua) sIdx++;
      const s3 = sIdx * 3;
      const r2 = rng() * 65536, h16 = r2 | 0;
      const rad = 0.0025 * Math.sqrt(-2 * Math.log(1 - h16 / 65536));
      const j = ((r2 - h16) * TRIG_N) | 0;
      const cp = rad * COS_T[j]!, sp = rad * SIN_T[j]!;
      x = aDir[s3]! + aE1[s3]! * cp + aE2[s3]! * sp;
      y = aDir[s3 + 1]! + aE1[s3 + 1]! * cp + aE2[s3 + 1]! * sp;
      z = aDir[s3 + 2]! + aE1[s3 + 2]! * cp + aE2[s3 + 2]! * sp;
      const il = 1 / Math.sqrt(x * x + y * y + z * z);
      x *= il; y *= il; z *= il;
      field(x, y, z, -1);
      fo[0] = 1;
      fo[1] = fo[1]! + 0.004;
    } else {
      // Ray streak: a long thin band of bright ejecta, clumpy (chains of secondary craters).
      for (;;) {
        const r = pickAlias(rayAlias, rng()), o = r * RS;
        const k = rayData[o]!, len = rayData[o + 2]!, k3 = k * 3;
        const th0 = 1.5 * cA[k]!;
        const th = th0 + rng() * (len - th0); // uniform along the ray; brightness fades via w
        const along = th / len;
        const clump = 0.5 + 0.5 * Math.sin(th * 47 + rayData[o + 5]!) * Math.sin(th * 19 + rayData[o + 6]!);
        if (rng() > 0.35 + 0.65 * clump) continue;
        const hw = rayData[o + 3]! * (0.7 + 0.9 * along);
        const ph = rayData[o + 1]! + (gaussian(rng) * hw) / Math.sin(th);
        const ct = Math.cos(th), st = Math.sin(th), cp = Math.cos(ph) * st, sp = Math.sin(ph) * st;
        x = cDir[k3]! * ct + cE1[k3]! * cp + cE2[k3]! * sp;
        y = cDir[k3 + 1]! * ct + cE1[k3 + 1]! * cp + cE2[k3 + 1]! * sp;
        z = cDir[k3 + 2]! * ct + cE1[k3 + 2]! * cp + cE2[k3 + 2]! * sp;
        field(x, y, z, -1);
        const I = rayData[o + 4]! * (1 - 0.7 * along);
        fo[0] = fo[0]! + (0.86 - fo[0]!) * I;
        break;
      }
    }
    const r = R + fo[1]!;
    const o = i * 4;
    out[o] = x * r; out[o + 1] = y * r; out[o + 2] = z * r; out[o + 3] = fo[0]!;
  }
  report(1);
};
