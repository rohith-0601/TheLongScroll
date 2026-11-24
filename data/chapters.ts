/**
 * Single source of truth for chapter content, dates, palettes and per-chapter scene tuning.
 *
 * This module is dependency-free (no imports) so it can be consumed by the Next.js app,
 * Web Workers and plain Node scripts (`node scripts/*.ts`) alike.
 *
 * Accuracy notes (checked; do not "improve" these without a source):
 *  1. Age of the universe: 13.787 ± 0.020 Gyr (Planck 2018) → "13.8 billion years ago".
 *  2. First stars/galaxies within a few hundred million years of the Big Bang; JWST confirms
 *     galaxies ~290 Myr after it (JADES-GS-z14-0) → "~13.5 billion years ago".
 *  3. Age of the Earth: 4.54 ± 0.05 Gyr (radiometric dating of meteorites).
 *  4. Earliest (debated) evidence of life ~3.7 Gyr (Isua, Greenland) → "~3.7 billion years ago".
 *  5. Proto-cuneiform tablets from Uruk (Uruk IV period), c. 3200 BCE.
 *  6. 24 May 1844: Morse's "What hath God wrought" from the U.S. Capitol, Washington, to
 *     Mount Clare station, Baltimore.
 *  7. Apollo 11 landed 20 July 1969 (20:17 UTC). Twelve people walked on the Moon in total
 *     (Apollo 11, 12, 14, 15, 16, 17; 1969–1972).
 *  8. 29 Oct 1969: UCLA → SRI, "LOGIN" crashed after "LO". info.cern.ch went public in 1991.
 *  9. WebGL ships in every major browser; WebGPU ships in Chrome, Edge, Firefox and Safari.
 */

export type FormationName =
  | 'bigBang'
  | 'galaxy'
  | 'earth'
  | 'dna'
  | 'tablet'
  | 'morse'
  | 'moon'
  | 'network'
  | 'canvas';

/** How a chapter's moment is expressed on the year counter. */
export type ChapterTime =
  | { kind: 'ago'; years: number }
  | { kind: 'bce'; year: number }
  | { kind: 'ce'; year: number }
  | { kind: 'ce-range'; from: number; to: number }
  | { kind: 'now' };

export interface ChapterPalette {
  /** Bright / primary colour (formation w → 1). */
  primary: string;
  /** Dim / secondary colour (formation w → 0). */
  secondary: string;
}

/** Per-chapter scene tuning consumed by the particle simulation and renderer. */
export interface ChapterScene {
  /** Idle spin about the formation's local +Y axis, radians per second (0 = none). Off under reduced motion. */
  spin: number;
  /** 0 = rigid rotation, 1 = differential rotation (inner parts turn faster, galaxy-like). */
  spinDifferential: number;
  /** Fixed orientation applied after the idle spin: Euler XYZ, radians. */
  tilt: readonly [number, number, number];
  /** Amplitude (radians) of a slow rocking rotation about local Y. Off under reduced motion. */
  sway: number;
  /** Idle travelling wave added to local Y: y += amp * sin(freq * x - speed * t) * cos(0.7 * freq * z). */
  wave: { readonly amp: number; readonly freq: number; readonly speed: number };
  /** Uniform scale applied to the formation (world units). */
  scale: number;
  /** Relative particle sprite size multiplier. */
  pointSize: number;
  /** Relative bloom strength multiplier. */
  bloom: number;
}

export interface Chapter {
  /** 1-based chapter number; also the scroll progress value at which the chapter is fully formed. */
  number: number;
  /** URL-safe id, used for anchors (#earth) and keys. */
  id: string;
  dateLabel: string;
  headline: string;
  copy: string;
  formation: FormationName;
  /** Screen-reader description of what the particles form (the canvas itself is decorative). */
  visualDescription: string;
  time: ChapterTime;
  palette: ChapterPalette;
  scene: ChapterScene;
}

const NO_WAVE = { amp: 0, freq: 0, speed: 0 } as const;

export const CHAPTERS: readonly Chapter[] = [
  {
    number: 1,
    id: 'big-bang',
    dateLabel: '13.8 billion years ago',
    headline: 'Everything started smaller than a point.',
    copy: 'The universe begins.',
    formation: 'bigBang',
    visualDescription: 'A dense, white-hot core of light with bursts streaking outward in every direction.',
    time: { kind: 'ago', years: 13_800_000_000 },
    palette: { primary: '#FFF3DC', secondary: '#FF5A1F' },
    scene: { spin: 0.04, spinDifferential: 0, tilt: [0.18, 0, 0.12], sway: 0, wave: NO_WAVE, scale: 1, pointSize: 1, bloom: 1.25 },
  },
  {
    number: 2,
    id: 'first-galaxies',
    dateLabel: '~13.5 billion years ago',
    headline: 'Gravity learns to draw.',
    copy: 'Gas collapses into stars, and stars into galaxies.',
    formation: 'galaxy',
    visualDescription: 'A tilted three-armed spiral galaxy with a warm, bright core.',
    time: { kind: 'ago', years: 13_500_000_000 },
    palette: { primary: '#FFD6A0', secondary: '#5C7CFF' },
    scene: { spin: 0.14, spinDifferential: 1, tilt: [-1.02, 0, 0.32], sway: 0, wave: NO_WAVE, scale: 1, pointSize: 0.95, bloom: 1.1 },
  },
  {
    number: 3,
    id: 'earth',
    dateLabel: '4.54 billion years ago',
    headline: 'A rock at the right distance.',
    copy: 'Earth forms where water can stay liquid.',
    formation: 'earth',
    visualDescription: 'A globe of light with brighter continents and a thin glowing atmosphere.',
    time: { kind: 'ago', years: 4_540_000_000 },
    palette: { primary: '#B8F5D0', secondary: '#2F6BFF' },
    // Axial tilt 23.44° (0.409 rad) about Z.
    scene: { spin: 0.07, spinDifferential: 0, tilt: [0.12, 0, 0.409], sway: 0, wave: NO_WAVE, scale: 1, pointSize: 0.85, bloom: 0.9 },
  },
  {
    number: 4,
    id: 'life',
    dateLabel: '~3.7 billion years ago',
    headline: 'Matter starts copying itself.',
    copy: 'Life begins; its instructions end up written in DNA.',
    formation: 'dna',
    visualDescription: 'A rotating double helix joined by base-pair rungs.',
    time: { kind: 'ago', years: 3_700_000_000 },
    palette: { primary: '#6DF4FF', secondary: '#B66DFF' },
    scene: { spin: 0.45, spinDifferential: 0, tilt: [0, 0, -0.62], sway: 0, wave: NO_WAVE, scale: 1, pointSize: 0.9, bloom: 1 },
  },
  {
    number: 5,
    id: 'writing',
    dateLabel: 'c. 3200 BCE',
    headline: 'Thoughts outlive their thinkers.',
    copy: 'In Sumer, marks pressed into clay become writing.',
    formation: 'tablet',
    visualDescription: 'A clay tablet whose rows of wedge-shaped marks glow from within.',
    time: { kind: 'bce', year: 3200 },
    palette: { primary: '#FFB15C', secondary: '#7A4A2E' },
    scene: { spin: 0, spinDifferential: 0, tilt: [-0.42, 0.38, 0.05], sway: 0.1, wave: NO_WAVE, scale: 1, pointSize: 0.85, bloom: 0.95 },
  },
  {
    number: 6,
    id: 'telegraph',
    dateLabel: '1844',
    headline: 'Words outrun horses.',
    copy: 'Samuel Morse sends “What hath God wrought” from Washington to Baltimore.',
    formation: 'morse',
    visualDescription:
      'A flowing ribbon of light carrying the phrase “What hath God wrought” in Morse code dots and dashes.',
    time: { kind: 'ce', year: 1844 },
    palette: { primary: '#FFE6A6', secondary: '#3FA9F5' },
    scene: { spin: 0, spinDifferential: 0, tilt: [0.22, -0.28, 0.04], sway: 0, wave: { amp: 0.14, freq: 1.1, speed: 0.9 }, scale: 1, pointSize: 0.9, bloom: 1 },
  },
  {
    number: 7,
    id: 'moon',
    dateLabel: '1969',
    headline: 'Twelve people walk on another world.',
    copy: 'Apollo 11 lands on July 20, 1969.',
    formation: 'moon',
    visualDescription: 'A cratered Moon whose crater rims catch the light.',
    time: { kind: 'ce', year: 1969 },
    palette: { primary: '#F4F4FA', secondary: '#6E7891' },
    scene: { spin: 0.035, spinDifferential: 0, tilt: [0.1, 0, 0.12], sway: 0, wave: NO_WAVE, scale: 1, pointSize: 0.85, bloom: 0.85 },
  },
  {
    number: 8,
    id: 'internet',
    dateLabel: '1969 to 1991',
    headline: 'The machines start talking.',
    copy: 'ARPANET’s first message, “LO”, crashes after two letters. In 1991, the first website goes live at CERN.',
    formation: 'network',
    visualDescription: 'A globe of glowing nodes joined by arcs, with pulses of light travelling between them.',
    time: { kind: 'ce-range', from: 1969, to: 1991 },
    palette: { primary: '#8CFFE6', secondary: '#3D6DFF' },
    scene: { spin: 0.09, spinDifferential: 0, tilt: [0.32, 0, 0.1], sway: 0, wave: NO_WAVE, scale: 1, pointSize: 0.9, bloom: 1.05 },
  },
  {
    number: 9,
    id: 'now',
    dateLabel: 'Now',
    headline: 'The web learns depth.',
    copy: 'Real-time 3D now runs in every browser.',
    formation: 'canvas',
    visualDescription: 'A waving grid of light, the web as a canvas, that settles as you reach the end.',
    time: { kind: 'now' },
    palette: { primary: '#FFFFFF', secondary: '#8B7BFF' },
    scene: { spin: 0, spinDifferential: 0, tilt: [0, 0, 0], sway: 0, wave: { amp: 0.42, freq: 0.85, speed: 0.95 }, scale: 1, pointSize: 0.9, bloom: 1 },
  },
] as const;

export const CHAPTER_COUNT = CHAPTERS.length; // 9

export const SITE = {
  title: 'The Long Scroll',
  subtitle: '13.8 billion years. One scroll.',
  hint: 'Scroll to begin. Hold anywhere to collapse the universe.',
  description:
    '13.8 billion years of breakthroughs in one scroll: a single field of glowing particles re-forms into each moment, live in your browser.',
  frontierTitle: 'The frontier',
  frontierIntro: 'Twenty-two sites pushing real-time 3D on the web right now.',
  footer: 'Every particle on this page is the same particle you started with.',
} as const;
