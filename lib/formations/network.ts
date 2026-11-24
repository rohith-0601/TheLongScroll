/**
 * Chapter 8 — the network globe: glowing nodes joined by great-circle arcs that carry travelling
 * light pulses, over a faint dot-matrix globe whose continents echo chapter 3's Earth.
 *
 *  - Surface (≈30%): the shared land mask (same `landValue` + threshold as earth.ts) drawn as a
 *    staggered latitude lattice of small dots on land (w ≈ 0.14–0.2), plus sparse dust everywhere
 *    (w ≈ 0.08–0.11), so it reads as a globe without competing with the network.
 *  - Nodes (≈15%): ~170 cities placed preferentially on land (coasts favoured, some islands, few
 *    at polar latitudes), min-spaced; ~18 hubs. Each node is a dense bright cluster (w ≈ 1) with a
 *    softer halo (w ≈ 0.7).
 *  - Arcs (≈55%): every node to its 2–4 nearest neighbours plus ~20 long-haul hub links (biased to
 *    cross oceans). Great-circle arcs lifted above the surface, apex height h = 0.05 + 0.3·Ω·(1 − 0.18·Ω)
 *    (∝ angle Ω for short hops, flatter for long hauls so they stay inside r ≈ 2.85).
 *    Arc particles are PULSE CARRIERS: w = 2 + phase, phase = normalised arc length from the arc's
 *    start node (random direction per arc), sampled uniformly in arc length so pulses move at a
 *    constant speed along each arc.
 *
 * Every particle is drawn iid from the mixture (random order). Canonical frame as earth.ts (+Y = north).
 */
import type { FormationGenerator } from './types.ts';
import { PULSE_W_OFFSET } from './types.ts';
import { createRng, landValue } from './utils.ts';

/** Same globe as chapter 3 (earth.ts EARTH_RADIUS). */
const R = 2.4;
/** Same land threshold as earth.ts (≈29% land; the shared LAND_THRESHOLD 0.08 gives ≈36%). */
const LAND_LEVEL = 0.139;

const NODE_COUNT = 170;
const HUB_COUNT = 18;
const LONG_HAUL_COUNT = 20;
/** Minimum angular spacing between nodes (rad). */
const NODE_SPACING = 0.085;

const SURFACE_FRACTION = 0.3;
const NODE_FRACTION = 0.15; // arcs: the remaining 0.55
/** Share of the surface budget spent on land dots (the rest is dust everywhere). */
const LAND_DOT_SHARE = 0.72;
/** Lattice spacing of the land dot-matrix (rad) and dot radius (world units). */
const DOT_SPACING = 0.034;
const DOT_SIGMA = 0.0055;

const TAU = 2 * Math.PI;
const TRIG_N = 1 << 14;
const COS_T = new Float64Array(TRIG_N), SIN_T = new Float64Array(TRIG_N);
for (let j = 0; j < TRIG_N; j++) { COS_T[j] = Math.cos((TAU * j) / TRIG_N); SIN_T[j] = Math.sin((TAU * j) / TRIG_N); }

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

const pickAlias = (t: { prob: Float64Array; alias: Int32Array }, u: number): number => {
  const x = u * t.prob.length;
  const i = x | 0;
  return x - i < t.prob[i]! ? i : t.alias[i]!;
};

/** Store an orthonormal tangent basis (east, north) for unit vector p at index k*3. */
function tangentBasis(x: number, y: number, z: number, e: Float64Array, n: Float64Array, k: number): void {
  let ex = z, ez = -x;
  let l = Math.hypot(ex, ez);
  if (l < 1e-9) { ex = 1; ez = 0; l = 1; }
  ex /= l; ez /= l;
  e[k] = ex; e[k + 1] = 0; e[k + 2] = ez;
  // north = p × east
  n[k] = y * ez; n[k + 1] = z * ex - x * ez; n[k + 2] = -y * ex;
}

export const generateNetwork: FormationGenerator = ({ count, out, rng, seed, report }) => {
  const g = createRng(seed ^ 0x9e7a0c); // graph construction (independent of `count`)

  // ------------------------------------------------------------ land dot-matrix (staggered lattice)
  const dots: number[] = [];
  const rows = Math.round(Math.PI / DOT_SPACING);
  for (let r = 0; r < rows; r++) {
    const lat = -Math.PI / 2 + ((r + 0.5) * Math.PI) / rows;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    const n = Math.max(1, Math.round((TAU * cl) / DOT_SPACING));
    const off = (r & 1) * 0.5;
    for (let j = 0; j < n; j++) {
      const lon = (TAU * (j + off)) / n;
      const x = cl * Math.sin(lon), y = sl, z = cl * Math.cos(lon);
      const v = landValue(x, y, z);
      if (v > LAND_LEVEL) dots.push(x, y, z, Math.min(1, (v - LAND_LEVEL) / 0.25));
    }
  }
  const nDots = dots.length / 4;
  const dotP = Float64Array.from(dots);
  const dotE = new Float64Array(nDots * 3), dotN = new Float64Array(nDots * 3);
  for (let d = 0; d < nDots; d++) tangentBasis(dotP[d * 4]!, dotP[d * 4 + 1]!, dotP[d * 4 + 2]!, dotE, dotN, d * 3);

  // ------------------------------------------------------------ nodes (cities)
  const nodeP = new Float64Array(NODE_COUNT * 3);
  let nNodes = 0;
  for (let tries = 0; tries < 60000 && nNodes < NODE_COUNT; tries++) {
    const z = 2 * g() - 1, a = TAU * g(), s = Math.sqrt(1 - z * z);
    const x = s * Math.cos(a), y = s * Math.sin(a);
    // few nodes at polar latitudes
    const ay = Math.abs(y);
    if (ay > 0.93 || g() > 1 - Math.max(0, (ay - 0.8) / 0.13)) continue;
    const v = landValue(x, y, z);
    if (v <= LAND_LEVEL) continue;
    // coasts favoured (ports, cable landings); inland accepted less often
    const coast = v - LAND_LEVEL < 0.05;
    if (!coast && g() > 0.45) continue;
    let ok = true;
    const minDot = Math.cos(NODE_SPACING);
    for (let k = 0; k < nNodes; k++) {
      if (x * nodeP[k * 3]! + y * nodeP[k * 3 + 1]! + z * nodeP[k * 3 + 2]! > minDot) { ok = false; break; }
    }
    if (!ok) continue;
    nodeP[nNodes * 3] = x; nodeP[nNodes * 3 + 1] = y; nodeP[nNodes * 3 + 2] = z;
    nNodes++;
  }
  const nodeE = new Float64Array(nNodes * 3), nodeN = new Float64Array(nNodes * 3);
  for (let k = 0; k < nNodes; k++) tangentBasis(nodeP[k * 3]!, nodeP[k * 3 + 1]!, nodeP[k * 3 + 2]!, nodeE, nodeN, k * 3);
  const nodeDot = (i: number, j: number): number =>
    nodeP[i * 3]! * nodeP[j * 3]! + nodeP[i * 3 + 1]! * nodeP[j * 3 + 1]! + nodeP[i * 3 + 2]! * nodeP[j * 3 + 2]!;

  // ------------------------------------------------------------ edges
  const edgeSet = new Set<number>();
  const edges: number[] = []; // pairs
  const longHaul: number[] = []; // 1 if long-haul
  const addEdge = (i: number, j: number, lh: boolean): boolean => {
    if (i === j) return false;
    const key = i < j ? i * 4096 + j : j * 4096 + i;
    if (edgeSet.has(key)) return false;
    edgeSet.add(key);
    edges.push(i, j);
    longHaul.push(lh ? 1 : 0);
    return true;
  };
  const order = new Int32Array(nNodes);
  const dist = new Float64Array(nNodes);
  for (let i = 0; i < nNodes; i++) {
    for (let j = 0; j < nNodes; j++) { order[j] = j; dist[j] = i === j ? -2 : nodeDot(i, j); }
    const sorted = Array.from(order).sort((p, q) => dist[q]! - dist[p]!);
    const k = 2 + Math.floor(g() * 3); // 2–4 nearest neighbours
    for (let n = 0; n < k; n++) addEdge(i, sorted[n]!, false);
  }
  // hubs: nodes with the most connections (ties broken randomly)
  const degree = new Float64Array(nNodes);
  for (let e = 0; e < edges.length; e += 2) { degree[edges[e]!]!++; degree[edges[e + 1]!]!++; }
  const tie = Float64Array.from({ length: nNodes }, () => g()); // consistent comparator → engine-independent
  const hubOrder = Array.from({ length: nNodes }, (_, i) => i).sort((p, q) => degree[q]! + tie[q]! - (degree[p]! + tie[p]!));
  const isHub = new Uint8Array(nNodes);
  const hubs = hubOrder.slice(0, Math.min(HUB_COUNT, nNodes));
  for (const h of hubs) isHub[h] = 1;
  // long-haul links between hubs, 0.8–2.1 rad apart, preferring ocean crossings
  for (let tries = 0, made = 0; tries < 4000 && made < LONG_HAUL_COUNT; tries++) {
    const i = hubs[Math.floor(g() * hubs.length)]!, j = hubs[Math.floor(g() * hubs.length)]!;
    if (i === j) continue;
    const ang = Math.acos(Math.max(-1, Math.min(1, nodeDot(i, j))));
    if (ang < 0.8 || ang > 2.1) continue;
    const mx = nodeP[i * 3]! + nodeP[j * 3]!, my = nodeP[i * 3 + 1]! + nodeP[j * 3 + 1]!, mz = nodeP[i * 3 + 2]! + nodeP[j * 3 + 2]!;
    const ml = Math.hypot(mx, my, mz);
    if (landValue(mx / ml, my / ml, mz / ml) > LAND_LEVEL && g() > 0.25) continue;
    if (addEdge(i, j, true)) made++;
  }
  const nEdges = edges.length / 2;

  // ------------------------------------------------------------ arc geometry (arc-length tables)
  const SAMPLES = 48, INV = 96;
  const eA = new Int32Array(nEdges), eB = new Int32Array(nEdges);
  const eAng = new Float64Array(nEdges), eInvSin = new Float64Array(nEdges), eH = new Float64Array(nEdges);
  const eLen = new Float64Array(nEdges), eInv = new Float32Array(nEdges * (INV + 1));
  const cum = new Float64Array(SAMPLES + 1);
  const arcPoint = (e: number, t: number, o: Float64Array): void => {
    const a = eA[e]! * 3, b = eB[e]! * 3, ang = eAng[e]!;
    const sa = Math.sin((1 - t) * ang) * eInvSin[e]!, sb = Math.sin(t * ang) * eInvSin[e]!;
    const r = R + eH[e]! * Math.sin(Math.PI * t);
    o[0] = (nodeP[a]! * sa + nodeP[b]! * sb) * r;
    o[1] = (nodeP[a + 1]! * sa + nodeP[b + 1]! * sb) * r;
    o[2] = (nodeP[a + 2]! * sa + nodeP[b + 2]! * sb) * r;
  };
  const pa = new Float64Array(3), pb = new Float64Array(3);
  for (let e = 0; e < nEdges; e++) {
    // random pulse direction per arc: swap endpoints so the arc always starts at its start node
    const flip = g() < 0.5;
    eA[e] = edges[e * 2 + (flip ? 1 : 0)]!;
    eB[e] = edges[e * 2 + (flip ? 0 : 1)]!;
    const ang = Math.acos(Math.max(-1, Math.min(1, nodeDot(eA[e]!, eB[e]!))));
    eAng[e] = ang;
    eInvSin[e] = 1 / Math.sin(ang);
    eH[e] = 0.05 + 0.3 * ang * (1 - 0.18 * ang); // ∝ angle for short hops, flatter for long hauls
    // cumulative arc length at uniform t, then invert to t(s) on a uniform s grid
    arcPoint(e, 0, pa);
    cum[0] = 0;
    for (let k = 1; k <= SAMPLES; k++) {
      arcPoint(e, k / SAMPLES, pb);
      cum[k] = cum[k - 1]! + Math.hypot(pb[0]! - pa[0]!, pb[1]! - pa[1]!, pb[2]! - pa[2]!);
      pa.set(pb);
    }
    const L = cum[SAMPLES]!;
    eLen[e] = L;
    let k = 0;
    for (let q = 0; q <= INV; q++) {
      const s = (q / INV) * L;
      while (k < SAMPLES - 1 && cum[k + 1]! < s) k++;
      const seg = cum[k + 1]! - cum[k]!;
      const f = seg > 0 ? (s - cum[k]!) / seg : 0;
      eInv[e * (INV + 1) + q] = (k + Math.min(1, Math.max(0, f))) / SAMPLES;
    }
  }

  // ------------------------------------------------------------ budgets
  const arcW = new Float64Array(nEdges);
  for (let e = 0; e < nEdges; e++) arcW[e] = eLen[e]! * (longHaul[e] ? 1.15 : 1);
  const arcAlias = buildAlias(arcW);
  const nodeImp = new Float64Array(nNodes);
  const nodeW = new Float64Array(nNodes);
  for (let k = 0; k < nNodes; k++) {
    nodeImp[k] = isHub[k] ? 1 : Math.min(0.6, 0.12 * degree[k]! + 0.25 * g());
    nodeW[k] = 0.5 + 1.5 * nodeImp[k]!;
  }
  const nodeAlias = buildAlias(nodeW);

  // ------------------------------------------------------------ particles
  const tmp = new Float64Array(3);
  const step = Math.max(1, Math.floor(count / 20));
  for (let i = 0; i < count; i++) {
    if (i % step === 0) report(i / count);
    const o = i * 4;
    const pick = rng();
    let x: number, y: number, z: number, w: number;

    if (pick < SURFACE_FRACTION) {
      if (pick < SURFACE_FRACTION * LAND_DOT_SHARE && nDots > 0) {
        // land dot: tight 2D gaussian around a lattice point
        const d = (rng() * nDots) | 0, d3 = d * 3;
        const r2 = rng() * 65536, h = r2 | 0;
        const rad = DOT_SIGMA * Math.sqrt(-2 * Math.log(1 - h / 65536));
        const j = ((r2 - h) * TRIG_N) | 0;
        const ce = rad * COS_T[j]!, cn = rad * SIN_T[j]!;
        x = dotP[d * 4]! * R + dotE[d3]! * ce + dotN[d3]! * cn;
        y = dotP[d * 4 + 1]! * R + dotE[d3 + 1]! * ce + dotN[d3 + 1]! * cn;
        z = dotP[d * 4 + 2]! * R + dotE[d3 + 2]! * ce + dotN[d3 + 2]! * cn;
        w = 0.14 + 0.06 * dotP[d * 4 + 3]!;
      } else {
        // sparse dust everywhere
        const r1 = rng() * 262144;
        const zi = r1 | 0, j = ((r1 - zi) * TRIG_N) | 0;
        const zz = (zi + 0.5) / 131072 - 1, s = Math.sqrt(1 - zz * zz);
        x = s * COS_T[j]! * R; y = s * SIN_T[j]! * R; z = zz * R;
        w = 0.08 + 0.03 * ((pick - SURFACE_FRACTION * LAND_DOT_SHARE) / (SURFACE_FRACTION * (1 - LAND_DOT_SHARE)));
      }
    } else if (pick < SURFACE_FRACTION + NODE_FRACTION) {
      // node: dense core (w ≈ 1) + softer halo (w ≈ 0.7)
      const k = pickAlias(nodeAlias, rng()), k3 = k * 3;
      const imp = nodeImp[k]!;
      const halo = rng() < 0.3;
      const sigma = (0.014 + 0.012 * imp) * (halo ? 2.4 : 1);
      const r2 = rng() * 65536, h = r2 | 0;
      const rad = sigma * Math.sqrt(-2 * Math.log(1 - h / 65536));
      const j = ((r2 - h) * TRIG_N) | 0;
      const ce = rad * COS_T[j]!, cn = rad * SIN_T[j]!;
      const lift = R + 0.012 * rng();
      x = nodeP[k3]! * lift + nodeE[k3]! * ce + nodeN[k3]! * cn;
      y = nodeP[k3 + 1]! * lift + nodeE[k3 + 1]! * ce + nodeN[k3 + 1]! * cn;
      z = nodeP[k3 + 2]! * lift + nodeE[k3 + 2]! * ce + nodeN[k3 + 2]! * cn;
      w = halo ? 0.62 + 0.12 * imp : 0.9 + 0.1 * imp;
    } else {
      // arc: uniform in arc length; phase = normalised distance from the start node
      const e = pickAlias(arcAlias, rng());
      const s = rng();
      const fq = s * INV, q = fq | 0, base = e * (INV + 1);
      const t = eInv[base + q]! + (eInv[base + Math.min(INV, q + 1)]! - eInv[base + q]!) * (fq - q);
      arcPoint(e, t, tmp);
      // thin tube jitter (uniform cube, σ ≈ 0.004) from one draw
      const r3 = rng();
      const ja = (r3 * 1024) | 0, jb = ((r3 * 1048576) | 0) & 1023, jc = ((r3 * 1073741824) | 0) & 1023;
      const amp = 0.0138 / 1024;
      x = tmp[0]! + (ja - 511.5) * amp;
      y = tmp[1]! + (jb - 511.5) * amp;
      z = tmp[2]! + (jc - 511.5) * amp;
      w = PULSE_W_OFFSET + Math.min(0.9999, s);
    }
    out[o] = x; out[o + 1] = y; out[o + 2] = z; out[o + 3] = w;
  }
  report(1);
};
