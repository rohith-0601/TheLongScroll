/**
 * The scroll timeline: one progress value p ∈ [0, 9] drives everything.
 *
 *   p = 0            opening screen: the particles sit in a singularity ("formation 0")
 *   p = k (1..9)     chapter k is fully formed (centre of its rest window)
 *   [k-HOLD, k+HOLD] rest window of chapter k: formation at rest, text visible, counter exact
 *   between windows  transition: particles re-form, counter rolls on a log scale
 *
 * Formation indices: 0 = singularity (chapter-1 formation scaled by SINGULARITY_SCALE),
 * 1..9 = chapters. Pure, dependency-free module (usable from Node scripts and the app).
 */
import { CHAPTERS, CHAPTER_COUNT, type ChapterTime } from '../data/chapters.ts';

export { CHAPTER_COUNT };
export const PROGRESS_MAX = CHAPTER_COUNT; // 9
/** Half-width of each chapter's rest window, in progress units. */
export const HOLD = 0.22;
/** The opening "singularity" is the Big Bang formation scaled down to this factor. */
export const SINGULARITY_SCALE = 0.012;
/** Calendar years older than this (astronomical year) are shown as "N years ago". */
const OLDEST_CALENDAR_YEAR = -9998; // = 9999 BCE

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const smoothstep01 = (t: number): number => t * t * (3 - 2 * t);

export interface MorphState {
  /** Formation index the particles are leaving (0..8). */
  from: number;
  /** Formation index the particles are heading to (1..9). */
  to: number;
  /** Linear transition progress 0..1 (0 = at `from`, 1 = at `to`). */
  t: number;
}

/** Which two formations are blended at progress p, and how far along the transition is. */
export function morphAt(p: number): MorphState {
  const pc = clamp(p, 0, PROGRESS_MAX);
  const u = Math.min(Math.floor(pc), PROGRESS_MAX - 1);
  const s = pc - u;
  const t = clamp((s - HOLD) / (1 - 2 * HOLD), 0, 1);
  return { from: u, to: u + 1, t };
}

/** Chapter (0 = intro, 1..9) whose rest window contains p, or null while transitioning. */
export function restChapterAt(p: number): number | null {
  const pc = clamp(p, 0, PROGRESS_MAX);
  const k = Math.round(pc);
  return Math.abs(pc - k) <= HOLD + 1e-9 ? k : null;
}

/** Nearest chapter (0 = intro, 1..9) to p. */
export function nearestChapter(p: number): number {
  return clamp(Math.round(p), 0, PROGRESS_MAX);
}

/**
 * Text visibility for chapter k at progress p (0..1). Fades in over the last part of the
 * incoming transition (as the formation completes) and out as the outgoing transition begins.
 */
export function chapterTextOpacity(k: number, p: number, fade = 0.1): number {
  const d = Math.abs(p - k);
  if (k === PROGRESS_MAX && p >= k) return 1;
  return 1 - smoothstep01(clamp((d - (HOLD - fade * 0.5)) / fade, 0, 1));
}

// ---------------------------------------------------------------------------------------------
// Year counter
// ---------------------------------------------------------------------------------------------

/** Astronomical year (1 BCE = 0, 3200 BCE = -3199). */
function astronomicalYear(time: Exclude<ChapterTime, { kind: 'ago' } | { kind: 'now' }>, end: 'from' | 'to'): number {
  if (time.kind === 'bce') return 1 - time.year;
  if (time.kind === 'ce') return time.year;
  return end === 'from' ? time.from : time.to;
}

/** Years before `nowYear` for a chapter's moment; for ranges, `end` picks which end. */
function yearsAgoOf(time: ChapterTime, nowYear: number, end: 'from' | 'to'): number {
  switch (time.kind) {
    case 'ago':
      return time.years;
    case 'now':
      return 0;
    default:
      return nowYear - astronomicalYear(time, end);
  }
}

/**
 * Continuous "years before present" at progress p.
 * Exact chapter values inside rest windows; log-scale interpolation (on years+1) in between.
 */
export function yearsAgoAt(p: number, nowYear: number): number {
  const pc = clamp(p, 0, PROGRESS_MAX);
  const first = CHAPTERS[0]!.time;
  if (pc <= 1 + HOLD) return yearsAgoOf(first, nowYear, 'from');

  const k = Math.round(pc);
  if (Math.abs(pc - k) <= HOLD) {
    const time = CHAPTERS[k - 1]!.time;
    if (time.kind === 'ce-range') {
      // Roll through the range over the first half of the rest window, then hold the end year
      // (so the fully formed chapter, p = k, reads e.g. "1991" for "1969 to 1991").
      const local = clamp((pc - (k - HOLD)) / HOLD, 0, 1);
      return nowYear - (time.from + (time.to - time.from) * local);
    }
    return yearsAgoOf(time, nowYear, 'from');
  }

  // Transition between chapter a's rest window and chapter a+1's.
  const a = Math.floor(pc);
  const t = clamp((pc - (a + HOLD)) / (1 - 2 * HOLD), 0, 1);
  const y0 = yearsAgoOf(CHAPTERS[a - 1]!.time, nowYear, 'to');
  const y1 = yearsAgoOf(CHAPTERS[a]!.time, nowYear, 'from');
  const l0 = Math.log10(y0 + 1);
  const l1 = Math.log10(y1 + 1);
  const e = smoothstep01(t);
  return Math.max(0, Math.pow(10, l0 + (l1 - l0) * e) - 1);
}

export type YearMode = 'ago' | 'bce' | 'ce' | 'now';

export interface YearDisplay {
  mode: YearMode;
  /** Continuous non-negative display number (for odometer-style rolling). 0 when mode = 'now'. */
  value: number;
  /** Exact rounded text of the number ("13,800,000,000", "3200", "1844") or "Now". */
  text: string;
  /** "years ago", "BCE", "" (CE) or "" (now). */
  suffix: string;
}

/** Group digits with commas: 13800000000 → "13,800,000,000". Deterministic (no Intl). */
export function groupDigits(n: number): string {
  const s = String(Math.round(Math.abs(n)));
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ',';
    out += s[i];
  }
  return out;
}

export function formatYearsAgo(yearsAgo: number, nowYear: number): YearDisplay {
  if (yearsAgo < 0.5) return { mode: 'now', value: 0, text: 'Now', suffix: '' };
  const year = nowYear - yearsAgo; // continuous astronomical year
  if (year >= 0.5) {
    return { mode: 'ce', value: year, text: String(Math.round(year)), suffix: '' };
  }
  if (year >= OLDEST_CALENDAR_YEAR - 0.5) {
    const bce = 1 - year;
    return { mode: 'bce', value: bce, text: String(Math.round(bce)), suffix: 'BCE' };
  }
  return { mode: 'ago', value: yearsAgo, text: groupDigits(yearsAgo), suffix: 'years ago' };
}

/** The year counter's content at progress p. */
export function yearDisplayAt(p: number, nowYear: number): YearDisplay {
  return formatYearsAgo(yearsAgoAt(p, nowYear), nowYear);
}

/** What the counter shows when chapter k (1..9) is fully formed — used by tests and the rail. */
export function chapterYearText(k: number, nowYear: number): string {
  const d = yearDisplayAt(k, nowYear);
  return d.suffix ? `${d.text} ${d.suffix}` : d.text;
}
