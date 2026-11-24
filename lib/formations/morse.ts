/**
 * Chapter 6 — 'morse': "WHAT HATH GOD WROUGHT" (24 May 1844) as embossed marks on a strip of
 * telegraph paper tape caught in a gentle wind.
 *
 * The message comes from lib/morse.ts (International Morse; never re-encoded here): 189 units, dot 1,
 * dash 3, gaps 1 / 3 / 7. At one row that would be ~0.04 world units per unit — unreadable — so the
 * tape is word-wrapped into three centred strips that read left → right, top → bottom:
 *
 *     WHAT HATH      (71 units)
 *        GOD         (33 units)
 *      WROUGHT       (71 units)
 *
 * Each strip carries half a word gap (3.5 units) of blank tape beyond its first and last mark, so the
 * strips laid end to end are exactly the original tape. All three strips ride one smooth "wind" sheet
 * (gentle S-curves in y and z, a small flutter twist, and free ends that curl), so they read as one
 * ribbon in motion. 1 unit = 0.1 world units; strips are 0.4 wide, rows 1.18 apart.
 * Marks are positioned by exact arc length along each strip's centreline (precomputed arc-length →
 * frame tables; twisting never moves the centreline), so dot/dash lengths and every gap are true to
 * the layout. Verified by decoding the particles back (scratchpad spikes/morse-check.ts).
 *
 * Particles (all iid → random order):
 *  - marks  (46%): dots are discs 1 unit across, dashes 3-unit capsules with round ends, embossed
 *                  0.024 toward the viewer (domed), w 0.9–1 (brightest along the centre).
 *  - tape   (45%): uniform over the strip with faint lengthwise paper-fibre streaks, w 0.06–0.24,
 *                  fading out (density and w) over the last 2.6 units of each strip.
 *  - edges   (9%): the two paper edges, w 0.23–0.28, so the ribbon's flow and twist read clearly.
 */
import type { FormationGenerator } from './types.ts';
import { layoutMorse, MORSE_PHRASE, MORSE_UNITS } from '../morse.ts';
import { createRng, smoothstep } from './utils.ts';

/** World units per Morse unit along the tape (dot ≈ 0.1 world units ≈ 12 px at 1440×900). */
const UNIT = 0.1;
const TAPE_WIDTH = 0.4;
/** Half-height of a mark across the tape, in Morse units (round dots: diameter = 1 unit). */
const MARK_R = 0.5;
/** Height of the embossed marks above the paper, world units. */
const EMBOSS = 0.024;
/** Greedy word-wrap width in units: gives [WHAT HATH] [GOD] [WROUGHT]. */
const ROW_MAX_UNITS = 76;
const ROW_SPACING = 1.18;
/** Blank tape beyond the first/last mark of a strip (half a word gap → strips concatenate exactly). */
const MARGIN_UNITS = MORSE_UNITS.wordGap / 2;
/** Strip ends fade out over this many units (density and brightness). */
const FADE_UNITS = 2.6;

const P_MARKS = 0.46;
const P_EDGES = 0.09; // remainder → tape surface

const FINE = 4096; // arc-length integration steps per strip
const FRAMES = 2048; // frame-table entries per strip (uniform in arc length)
const X_RANGE = 4.8; // centreline is parametrised by x ∈ [−X_RANGE, X_RANGE]

// ------------------------------------------------------------------------------------ wind sheet
/** Vertical drift of the sheet the strips ride on. */
const sheetDY = (x: number, y: number): number => 0.075 * Math.sin(0.8 * x + 0.7 * y + 1.3);
/** Depth undulation of the sheet: a long swell plus a shorter ripple, travelling diagonally. */
const sheetDZ = (x: number, y: number): number =>
  0.3 * Math.sin(1.0 * x - 0.55 * y + 0.5) + 0.07 * Math.sin(2.3 * x + 1.1 * y + 2.0);
/** Extra flutter twist about the tape's own axis (radians). */
const flutter = (x: number, y: number): number => 0.16 * Math.sin(1.25 * x + 0.9 * y + 0.7);
/** The free ends of each strip curl a little (opposite senses), like loose tape in a draught. */
const CURL = 0.5;
const CURL_UNITS = 8;

interface Strip {
  /** Message units covered by this strip (including the blank margins). */
  u0: number;
  u1: number;
  /** Frame table: 9 floats per entry (position, width dir W, face normal F), uniform in arc length. */
  frames: Float32Array;
}

/** Build the frame table of one strip whose centreline rides the sheet at height y0. */
function buildStrip(u0: number, u1: number, y0: number): Strip {
  const pos = (x: number, o: Float64Array): void => {
    o[0] = x; o[1] = y0 + sheetDY(x, y0); o[2] = sheetDZ(x, y0);
  };
  // cumulative arc length over x ∈ [−X_RANGE, X_RANGE]
  const xs = new Float64Array(FINE + 1);
  const arc = new Float64Array(FINE + 1);
  const p = new Float64Array(3), q = new Float64Array(3);
  pos(-X_RANGE, p);
  xs[0] = -X_RANGE;
  for (let k = 1; k <= FINE; k++) {
    const x = -X_RANGE + (2 * X_RANGE * k) / FINE;
    pos(x, q);
    arc[k] = arc[k - 1]! + Math.hypot(q[0]! - p[0]!, q[1]! - p[1]!, q[2]! - p[2]!);
    xs[k] = x;
    p.set(q);
  }
  // the strip is centred on x = 0 (in arc length)
  let kMid = 0;
  while (kMid < FINE && xs[kMid + 1]! <= 0) kMid++;
  const aMid = arc[kMid]! + ((0 - xs[kMid]!) / (xs[kMid + 1]! - xs[kMid]!)) * (arc[kMid + 1]! - arc[kMid]!);
  const half = ((u1 - u0) * UNIT) / 2;
  const aStart = aMid - half;

  const frames = new Float32Array(FRAMES * 9);
  const t = new Float64Array(3), wv = new Float64Array(3);
  let k = 0;
  const h = 1e-3;
  for (let j = 0; j < FRAMES; j++) {
    const a = aStart + (2 * half * j) / (FRAMES - 1);
    while (k < FINE - 1 && arc[k + 1]! < a) k++;
    const f = (a - arc[k]!) / (arc[k + 1]! - arc[k]!);
    const x = xs[k]! + f * (xs[k + 1]! - xs[k]!);
    pos(x, p);
    // tangent (central difference)
    pos(x + h, q);
    t[0] = q[0]!; t[1] = q[1]!; t[2] = q[2]!;
    pos(x - h, q);
    t[0] -= q[0]!; t[1] -= q[1]!; t[2] -= q[2]!;
    let n = Math.hypot(t[0]!, t[1]!, t[2]!);
    t[0] /= n; t[1] /= n; t[2] /= n;
    // across-tape direction: up the wind sheet (∂S/∂y), orthogonalised against the tangent
    wv[0] = 0;
    wv[1] = 1 + (sheetDY(x, y0 + h) - sheetDY(x, y0 - h)) / (2 * h);
    wv[2] = (sheetDZ(x, y0 + h) - sheetDZ(x, y0 - h)) / (2 * h);
    const d = wv[0]! * t[0]! + wv[1]! * t[1]! + wv[2]! * t[2]!;
    wv[0] -= d * t[0]!; wv[1] -= d * t[1]!; wv[2] -= d * t[2]!;
    n = Math.hypot(wv[0]!, wv[1]!, wv[2]!);
    wv[0] /= n; wv[1] /= n; wv[2] /= n;
    // face normal F = T × W (points toward +Z, the viewer)
    let fx = t[1]! * wv[2]! - t[2]! * wv[1]!;
    let fy = t[2]! * wv[0]! - t[0]! * wv[2]!;
    let fz = t[0]! * wv[1]! - t[1]! * wv[0]!;
    // flutter + end curl: rotate (W, F) about T (a pure twist never moves the centreline, so the
    // arc-length placement of the marks is unaffected)
    const fromStart = (a - aStart) / UNIT, fromEnd = (aStart + 2 * half - a) / UNIT;
    const curl = CURL * (Math.pow(1 - smoothstep(0, CURL_UNITS, fromStart), 2) - Math.pow(1 - smoothstep(0, CURL_UNITS, fromEnd), 2));
    const tau = flutter(x, y0) + curl;
    const c = Math.cos(tau), s = Math.sin(tau);
    const wx = wv[0]! * c + fx * s, wy = wv[1]! * c + fy * s, wz = wv[2]! * c + fz * s;
    const gx = fx * c - wv[0]! * s, gy = fy * c - wv[1]! * s, gz = fz * c - wv[2]! * s;
    fx = gx; fy = gy; fz = gz;
    const o = j * 9;
    frames[o] = p[0]!; frames[o + 1] = p[1]!; frames[o + 2] = p[2]!;
    frames[o + 3] = wx; frames[o + 4] = wy; frames[o + 5] = wz;
    frames[o + 6] = fx; frames[o + 7] = fy; frames[o + 8] = fz;
  }
  return { u0, u1, frames };
}

export const generateMorse: FormationGenerator = ({ count, out, rng, seed, report }) => {
  const layout = layoutMorse(MORSE_PHRASE);
  const marks = layout.marks;

  // ---- word-wrap into strips (whole words only, so every row break sits in a word gap)
  const words: { start: number; end: number }[] = [];
  for (const m of marks) {
    const wd = words[m.wordIndex] ?? (words[m.wordIndex] = { start: m.start, end: m.start + m.units });
    wd.end = Math.max(wd.end, m.start + m.units);
  }
  const rows: { start: number; end: number }[] = [];
  for (const wd of words) {
    const last = rows[rows.length - 1];
    if (last && wd.end - last.start <= ROW_MAX_UNITS) last.end = wd.end;
    else rows.push({ start: wd.start, end: wd.end });
  }
  const nRows = rows.length;
  const strips = rows.map((r, i) =>
    buildStrip(r.start - MARGIN_UNITS, r.end + MARGIN_UNITS, ((nRows - 1) / 2 - i) * ROW_SPACING),
  );

  // ---- cumulative weights: marks by area, strips by length
  const markRow = new Int32Array(marks.length);
  const markCum = new Float64Array(marks.length);
  let acc = 0;
  marks.forEach((m, i) => {
    markRow[i] = rows.findIndex((r) => m.start >= r.start && m.start < r.end);
    acc += (m.units - 2 * MARK_R) * 2 * MARK_R + Math.PI * MARK_R * MARK_R; // capsule area (units²)
    markCum[i] = acc;
  });
  const stripCum = new Float64Array(nRows);
  acc = 0;
  strips.forEach((s, i) => { acc += s.u1 - s.u0; stripCum[i] = acc; });

  const pick = (cum: Float64Array, u: number): number => {
    const target = u * cum[cum.length - 1]!;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m]! < target) lo = m + 1; else hi = m; }
    return lo;
  };

  let i = 0;
  const reportEvery = Math.max(1, Math.floor(count / 20));
  /** Emit a particle on strip s at message unit u, across-tape offset v and height hgt (world). */
  const emit = (s: Strip, u: number, v: number, hgt: number, w: number): void => {
    const fr = s.frames;
    const g = ((u - s.u0) / (s.u1 - s.u0)) * (FRAMES - 1);
    const k = Math.min(FRAMES - 2, Math.max(0, g | 0));
    const f = g - k;
    const a = k * 9, b = a + 9;
    const o = i * 4;
    for (let c = 0; c < 3; c++) {
      const P = fr[a + c]! + (fr[b + c]! - fr[a + c]!) * f;
      const W = fr[a + 3 + c]! + (fr[b + 3 + c]! - fr[a + 3 + c]!) * f;
      const F = fr[a + 6 + c]! + (fr[b + 6 + c]! - fr[a + 6 + c]!) * f;
      out[o + c] = P + W * v + F * hgt;
    }
    out[o + 3] = w;
  };

  // faint paper-fibre streaks running along the tape (a fixed profile across its width)
  const halfW = TAPE_WIDTH / 2;
  const STREAK_BINS = 128;
  const streak = new Float32Array(STREAK_BINS);
  {
    const sr = createRng(seed ^ 0x7a9e);
    const lines: number[] = [];
    for (let k = 0; k < 9; k++) lines.push((sr() * 2 - 1) * halfW * 0.92, 0.004 + 0.008 * sr(), 0.4 + 0.6 * sr());
    for (let b = 0; b < STREAK_BINS; b++) {
      const v = ((b + 0.5) / STREAK_BINS) * 2 * halfW - halfW;
      let m = 0;
      for (let k = 0; k < lines.length; k += 3) {
        const d = (v - lines[k]!) / lines[k + 1]!;
        m = Math.max(m, lines[k + 2]! * Math.exp(-d * d));
      }
      streak[b] = m;
    }
  }
  for (i = 0; i < count; i++) {
    if (i % reportEvery === 0) report(i / count);
    const r = rng();
    if (r < P_MARKS) {
      // ---- embossed mark: uniform over the capsule (dot = disc), domed toward the viewer
      const mi = pick(markCum, rng());
      const m = marks[mi]!;
      const spine = m.units - 2 * MARK_R; // 0 for a dot, 2 for a dash
      let du = 0, dv = 0, d2 = 0;
      for (;;) {
        du = rng() * m.units;
        dv = (rng() * 2 - 1) * MARK_R;
        const along = du < MARK_R ? du - MARK_R : du > MARK_R + spine ? du - MARK_R - spine : 0;
        d2 = (along * along + dv * dv) / (MARK_R * MARK_R);
        if (d2 <= 1) break;
      }
      const dome = Math.sqrt(1 - d2);
      emit(strips[markRow[mi]!]!, m.start + du, dv * UNIT, EMBOSS * dome, 0.9 + 0.1 * (1 - d2));
    } else {
      // ---- paper tape (surface or edge), soft fade at the strip ends
      const edge = r < P_MARKS + P_EDGES;
      for (;;) {
        const s = strips[pick(stripCum, rng())]!;
        const u = s.u0 + rng() * (s.u1 - s.u0);
        const fade = smoothstep(0, FADE_UNITS, u - s.u0) * smoothstep(0, FADE_UNITS, s.u1 - u);
        if (rng() > fade) continue;
        if (edge) {
          const v = (rng() < 0.5 ? -halfW : halfW) + (rng() - 0.5) * 0.008;
          emit(s, u, v, 0, (0.23 + 0.05 * rng()) * (0.5 + 0.5 * fade));
        } else {
          const v = (rng() * 2 - 1) * halfW;
          const fib = streak[Math.min(STREAK_BINS - 1, ((v + halfW) / (2 * halfW)) * STREAK_BINS) | 0]!;
          emit(s, u, v, (rng() - 0.5) * 0.004, (0.1 + 0.08 * rng() + 0.06 * fib) * (0.6 + 0.4 * fade));
        }
        break;
      }
    }
  }
  report(1);
};
