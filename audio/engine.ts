/**
 * Generative ambient sound for The Long Scroll. Web Audio only, no samples: every sound is
 * synthesised live from oscillators and three small procedurally generated buffers.
 *
 * Signal flow (built once, on the first enable(), ~37 nodes, all persistent):
 *
 *   DRONE   two voice banks (A = even formations, B = odd), each: triangle sub + 2 detuned saws
 *           tri ─► triGain[b] ─┐
 *           saw ×2 ─► sawGain[b] ─► droneFilter (lowpass) ─► mix
 *           Adjacent formations always live on different banks, so a scroll transition is an
 *           equal-power crossfade between two chords (never a pitch glide); a bank is retuned
 *           only while it is silent (inside a rest window).
 *   TEXTURE noise ─► texBP ─► texGain ─► texPan ─► mix      (LFO → texGain.gain, texBP.frequency, texPan.pan)
 *           dust (grain buffer) ─► dustGain ─► texPan            (ticks / crackle / glitter via playbackRate)
 *           morse (telegraph clicks of "WHAT HATH GOD WROUGHT") ─► morseGain ─► mix
 *   GESTURE noise ─► breathBP ─► breathGain ─► mix               (velocity "air" + hold whoosh)
 *           riser sine ─► riserGain ─► mix                       (hold pitch riser)
 *           boom sine ─► boomGain ─► mix; noise ─► burstBP ─► burstGain ─► mix;
 *           noise ─► shimmerBP ─► shimmerGain ─► convolver        (burst)
 *   SPACE   mix ─► compressor ─► master ─► destination;  mix ─► convolver ─► wet ─► compressor
 *
 * Every audible parameter moves with setTargetAtTime / ramps; nothing jumps via `.value` once
 * sound is running. update() is allocation-free and only schedules a param when its target
 * moves meaningfully. Nothing here touches `window` at import time (SSR-safe).
 */
import { HOLD, PROGRESS_MAX } from '../lib/timeline.ts';
import { layoutMorse } from '../lib/morse.ts';

export interface AudioFrame {
  /** 0..9 smoothed scroll progress. */
  progress: number;
  /** Progress units per second (signed). */
  velocity: number;
  /** 0..1 hold-to-collapse intensity. */
  hold: number;
}

/** Optional test hook: render the engine into any BaseAudioContext (e.g. an OfflineAudioContext). */
export interface AudioEngineOptions {
  createContext?: () => BaseAudioContext;
}

// ---------------------------------------------------------------------------------------------
// Sound design table: formation 0 (singularity) + chapters 1..9
// ---------------------------------------------------------------------------------------------

interface Scene {
  /** MIDI note of the triangle sub voice. */
  root: number;
  /** Saw pair, semitones above root + 12. */
  saws: readonly [number, number];
  tri: number;
  saw: number;
  /** ± cents between the two saws. */
  detune: number;
  cutoff: number;
  q: number;
  /** Band-passed noise layer. */
  noise: number;
  bp: number;
  bpQ: number;
  /** LFO rate (Hz), amplitude swell (0..0.95 of noise level), band-pass wobble (Hz). */
  lfo: number;
  swell: number;
  wobble: number;
  /** Grain buffer level and playback rate (rate scales both density and pitch). */
  dust: number;
  dustRate: number;
  morse: number;
  /** Reverb return. */
  wet: number;
  /** Loudness trim on the saws + texture (measured offline so chapters sit within ~1.5 dB). */
  trim: number;
}

/* Modal path in D: D5 → D5 → Fmaj7 → B♭add9 → G9sus → Am → Em7 → Gm(add9) → A7sus4 → D (resolves). */
const SCENES: readonly Scene[] = [
  // 0 singularity: a held breath — dark unison hum, faint low rumble
  { root: 26, saws: [0, 7], tri: 0.11, saw: 0.05, detune: 4, cutoff: 190, q: 0.7, noise: 0.05, bp: 160, bpQ: 0.8, lfo: 0.05, swell: 0.5, wobble: 0, dust: 0, dustRate: 1, morse: 0, wet: 0.5, trim: 1.41 },
  // 1 Big Bang: open fifth, cosmic hiss
  { root: 26, saws: [0, 7], tri: 0.094, saw: 0.06, detune: 7, cutoff: 820, q: 1.1, noise: 0.03, bp: 3800, bpQ: 0.5, lfo: 0.07, swell: 0.35, wobble: 0, dust: 0, dustRate: 1, morse: 0, wet: 0.55, trim: 1.26 },
  // 2 First galaxies: Fmaj7, airy breathing band, a little filter resonance
  { root: 29, saws: [4, 11], tri: 0.083, saw: 0.055, detune: 6, cutoff: 1100, q: 2.2, noise: 0.05, bp: 1900, bpQ: 0.8, lfo: 0.11, swell: 0.45, wobble: 600, dust: 0, dustRate: 1, morse: 0, wet: 0.6, trim: 1.06 },
  // 3 Earth: B♭add9, warm, slow oceanic swells (~11 s)
  { root: 34, saws: [4, 14], tri: 0.072, saw: 0.06, detune: 5, cutoff: 520, q: 0.8, noise: 0.13, bp: 480, bpQ: 0.6, lfo: 0.09, swell: 0.9, wobble: 220, dust: 0, dustRate: 1, morse: 0, wet: 0.5, trim: 0.85 },
  // 4 Life / DNA: G9sus, liquid resonance, granular ticks
  { root: 31, saws: [2, 10], tri: 0.077, saw: 0.05, detune: 6, cutoff: 700, q: 3, noise: 0.02, bp: 900, bpQ: 1.5, lfo: 0.2, swell: 0.3, wobble: 150, dust: 0.11, dustRate: 1.3, morse: 0, wet: 0.45, trim: 1.12 },
  // 5 Writing: Am, dry and close, clay crackle
  { root: 33, saws: [3, 7], tri: 0.083, saw: 0.06, detune: 4, cutoff: 430, q: 0.7, noise: 0.012, bp: 1400, bpQ: 1, lfo: 0.13, swell: 0.3, wobble: 0, dust: 0.15, dustRate: 0.55, morse: 0, wet: 0.22, trim: 1.0 },
  // 6 Telegraph 1844: Em7, sounder clicks spelling "What hath God wrought", faint line hiss
  { root: 28, saws: [3, 10], tri: 0.083, saw: 0.05, detune: 5, cutoff: 600, q: 1, noise: 0.012, bp: 2600, bpQ: 0.7, lfo: 0.1, swell: 0.3, wobble: 0, dust: 0, dustRate: 1, morse: 0.2, wet: 0.35, trim: 1.3 },
  // 7 Moon: Gm(add9), thin, far away, whistling lunar wind
  { root: 31, saws: [3, 14], tri: 0.077, saw: 0.035, detune: 8, cutoff: 380, q: 1.2, noise: 0.075, bp: 1100, bpQ: 7, lfo: 0.06, swell: 0.6, wobble: 450, dust: 0, dustRate: 1, morse: 0, wet: 0.75, trim: 1.2 },
  // 8 Network: A7sus4 (pending dominant), bright resonant pad, digital shimmer + glitter
  { root: 33, saws: [5, 10], tri: 0.066, saw: 0.045, detune: 9, cutoff: 1500, q: 4, noise: 0.03, bp: 6500, bpQ: 4, lfo: 0.35, swell: 0.5, wobble: 900, dust: 0.04, dustRate: 2.2, morse: 0, wet: 0.6, trim: 1.03 },
  // 9 Now: D major — the resolution; calm clean pad
  { root: 26, saws: [4, 12], tri: 0.094, saw: 0.05, detune: 3, cutoff: 820, q: 0.5, noise: 0.012, bp: 2000, bpQ: 0.5, lfo: 0.08, swell: 0.3, wobble: 0, dust: 0, dustRate: 1, morse: 0, wet: 0.6, trim: 1.41 },
];

/** Master gain after the compressor (calibrated for ≈ −18 dBFS RMS). */
const MASTER = 0.95;
/** Peak amplitude of the LFO's PeriodicWave (normalisation disabled; 0.45 + 0.1 + 0.05). */
const LFO_AMP = 0.6;
const FADE_IN_TAU = 0.45; // ≈ 1.5 s to −10 dB of target… fully settled by ~2 s
const FADE_OUT_TAU = 0.13; // ≈ 0.6 s to −40 dB
const FADE_OUT_MS = 650;

const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const glerp = (a: number, b: number, t: number): number => a * Math.pow(b / a, t);

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------
// Procedural buffers
// ---------------------------------------------------------------------------------------------

/** Looping stereo pink-ish noise (decorrelated channels). */
function makeNoise(ctx: BaseAudioContext): AudioBuffer {
  const len = 1 << 17;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  const rnd = mulberry32(0x5eed);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = rnd() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
    // Short crossfade at the loop seam.
    const xf = 256;
    for (let i = 0; i < xf; i++) {
      const g = i / xf;
      d[i] = d[i]! * g + d[len - xf + i]! * (1 - g);
    }
  }
  return buf;
}

/** Sparse stereo grains: tiny decaying sine ticks, mostly soft, randomly panned. */
function makeDust(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 5);
  const buf = ctx.createBuffer(2, len, sr);
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  const rnd = mulberry32(0xd057);
  let t = 0;
  for (;;) {
    t += -Math.log(1 - rnd()) / 26; // Poisson, ~26 grains/s at rate 1
    const start = Math.floor(t * sr);
    if (start > len - sr * 0.03) break;
    const f = 1800 + rnd() * 3400;
    const tau = 0.0006 + rnd() * 0.0019;
    const amp = 0.15 + 0.85 * Math.pow(rnd(), 3);
    const pan = rnd();
    const gl = Math.cos(pan * Math.PI * 0.5) * amp;
    const gr = Math.sin(pan * Math.PI * 0.5) * amp;
    const n = Math.floor(tau * 7 * sr);
    for (let i = 0; i < n; i++) {
      const s = i / sr;
      const v = Math.sin(2 * Math.PI * f * s) * Math.exp(-s / tau) * (1 - Math.exp(-s / 0.00015));
      L[start + i] = L[start + i]! + v * gl;
      R[start + i] = R[start + i]! + v * gr;
    }
  }
  return buf;
}

/** Telegraph sounder: a woody click on key-down and a softer clack on key-up, Morse timing. */
function makeMorse(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const unit = 0.085;
  const layout = layoutMorse();
  const totalUnits = layout.totalUnits + 16; // breath before the phrase repeats
  const len = Math.floor(totalUnits * unit * sr);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const click = (at: number, amp: number, f1: number, f2: number, tau: number): void => {
    const start = Math.floor(at * sr);
    const n = Math.floor(tau * 8 * sr);
    for (let i = 0; i < n && start + i < len; i++) {
      const s = i / sr;
      const env = Math.exp(-s / tau) * (1 - Math.exp(-s / 0.0003));
      d[start + i] = d[start + i]! + amp * env * (0.6 * Math.sin(2 * Math.PI * f1 * s) + 0.4 * Math.sin(2 * Math.PI * f2 * s));
    }
  };
  for (const m of layout.marks) {
    const t0 = (m.start + 4) * unit;
    click(t0, 1, 1150, 520, 0.004);
    click(t0 + m.units * unit, 0.5, 1500, 760, 0.003);
  }
  return buf;
}

/** Synthesised stereo room: exponentially decaying noise, darker as it decays. */
function makeImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const pre = Math.floor(0.018 * sr);
  const len = Math.floor(seconds * sr);
  const buf = ctx.createBuffer(2, len, sr);
  const k = Math.log(1000) / seconds; // −60 dB at `seconds`
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    const rnd = mulberry32(c === 0 ? 0x1eff : 0x7e11);
    let y = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      const a = 0.85 * Math.exp(-t * 1.6) + 0.08; // one-pole lowpass closes over time
      y += a * (rnd() * 2 - 1 - y);
      const fadeIn = 1 - Math.exp(-t / 0.006);
      d[i] = y * Math.exp(-k * t) * fadeIn;
    }
  }
  return buf;
}

// ---------------------------------------------------------------------------------------------
// Param smoothing with change thresholds (allocation-free per frame)
// ---------------------------------------------------------------------------------------------

class Smooth {
  private last = Number.NaN;
  constructor(
    private readonly param: AudioParam,
    private readonly tau: number,
    /** Minimum change to schedule: relative (fraction) when rel, else absolute. */
    private readonly eps: number,
    private readonly rel: boolean,
  ) {}
  set(v: number, now: number, tau = this.tau): void {
    if (!(v === v)) return; // NaN guard
    const last = this.last;
    const d = v > last ? v - last : last - v;
    if (d <= (this.rel ? this.eps * (last < 0 ? -last : last) : this.eps)) return;
    this.last = v;
    this.param.setTargetAtTime(v, now, tau);
  }
  /** Initial value before anything is audible. */
  init(v: number): void {
    this.last = v;
    this.param.value = v;
  }
}

function holdParam(p: AudioParam, now: number): void {
  const withHold = p as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
  if (typeof withHold.cancelAndHoldAtTime === 'function') {
    withHold.cancelAndHoldAtTime(now);
  } else {
    const v = p.value;
    p.cancelScheduledValues(now);
    p.setValueAtTime(v, now);
  }
}

// ---------------------------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------------------------

interface Bank {
  tri: OscillatorNode;
  sawA: OscillatorNode;
  sawB: OscillatorNode;
  triGain: GainNode;
  sawGain: GainNode;
  sTriF: Smooth;
  sSawAF: Smooth;
  sSawBF: Smooth;
  sSawADet: Smooth;
  sSawBDet: Smooth;
  sTriG: Smooth;
  sSawG: Smooth;
  formation: number;
}

interface Graph {
  ctx: BaseAudioContext;
  banks: readonly [Bank, Bank];
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  master: GainNode;
  boom: OscillatorNode;
  boomGain: GainNode;
  burstBP: BiquadFilterNode;
  burstGain: GainNode;
  shimmerBP: BiquadFilterNode;
  shimmerGain: GainNode;
  sCutoff: Smooth;
  sQ: Smooth;
  sBpF: Smooth;
  sBpQ: Smooth;
  sNoise: Smooth;
  sSwell: Smooth;
  sWobble: Smooth;
  sLfo: Smooth;
  sDust: Smooth;
  sDustRate: Smooth;
  sMorse: Smooth;
  sWet: Smooth;
  sBreathF: Smooth;
  sBreathQ: Smooth;
  sBreathG: Smooth;
  sRiserF: Smooth;
  sRiserG: Smooth;
}

function buildGraph(ctx: BaseAudioContext): Graph {
  const nodes: AudioNode[] = [];
  const sources: AudioScheduledSourceNode[] = [];
  const track = <T extends AudioNode>(n: T): T => {
    nodes.push(n);
    return n;
  };
  const gain = (v: number): GainNode => {
    const g = track(ctx.createGain());
    g.gain.value = v;
    return g;
  };
  const biquad = (type: BiquadFilterType, f: number, q: number): BiquadFilterNode => {
    const b = track(ctx.createBiquadFilter());
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  };
  const osc = (type: OscillatorType, f: number): OscillatorNode => {
    const o = track(ctx.createOscillator());
    o.type = type;
    o.frequency.value = f;
    sources.push(o);
    return o;
  };
  const loop = (buffer: AudioBuffer): AudioBufferSourceNode => {
    const s = track(ctx.createBufferSource());
    s.buffer = buffer;
    s.loop = true;
    sources.push(s);
    return s;
  };

  // Space + master
  const master = gain(0);
  const comp = track(ctx.createDynamicsCompressor());
  comp.threshold.value = -20;
  comp.knee.value = 12;
  comp.ratio.value = 3;
  comp.attack.value = 0.008;
  comp.release.value = 0.35;
  const mix = gain(1);
  const convolver = track(ctx.createConvolver());
  convolver.buffer = makeImpulse(ctx, 3.6);
  const wet = gain(0.5);
  mix.connect(comp);
  mix.connect(convolver);
  convolver.connect(wet);
  wet.connect(comp);
  comp.connect(master);
  master.connect(ctx.destination);

  // Drone banks → shared lowpass
  const droneFilter = biquad('lowpass', 400, 0.7);
  droneFilter.connect(mix);
  const makeBank = (): Bank => {
    const tri = osc('triangle', 60);
    const sawA = osc('sawtooth', 120);
    const sawB = osc('sawtooth', 120);
    const triGain = gain(0);
    const sawGain = gain(0);
    tri.connect(triGain);
    sawA.connect(sawGain);
    sawB.connect(sawGain);
    triGain.connect(droneFilter);
    sawGain.connect(droneFilter);
    return {
      tri, sawA, sawB, triGain, sawGain,
      sTriF: new Smooth(tri.frequency, 0.08, 0.001, true),
      sSawAF: new Smooth(sawA.frequency, 0.08, 0.001, true),
      sSawBF: new Smooth(sawB.frequency, 0.08, 0.001, true),
      sSawADet: new Smooth(sawA.detune, 0.3, 0.2, false),
      sSawBDet: new Smooth(sawB.detune, 0.3, 0.2, false),
      sTriG: new Smooth(triGain.gain, 0.12, 0.0004, false),
      sSawG: new Smooth(sawGain.gain, 0.12, 0.0002, false),
      formation: -1,
    };
  };
  const banks: [Bank, Bank] = [makeBank(), makeBank()];

  // Shared noise
  const noiseBuf = makeNoise(ctx);
  const noise = loop(noiseBuf);

  // Texture: band-passed noise with a slow, slightly irregular LFO (amp swell, band wobble, pan drift)
  const texBP = biquad('bandpass', 1000, 1);
  const texGain = gain(0);
  const texPan = track(ctx.createStereoPanner());
  noise.connect(texBP);
  texBP.connect(texGain);
  texGain.connect(texPan);
  texPan.connect(mix);
  const lfo = osc('sine', 0.1);
  const re = new Float32Array([0, 0, 0, 0.05]);
  const im = new Float32Array([0, 0.45, 0.1, 0]);
  lfo.setPeriodicWave(ctx.createPeriodicWave(re, im, { disableNormalization: true }));
  const swellDepth = gain(0);
  const wobbleDepth = gain(0);
  lfo.connect(swellDepth);
  swellDepth.connect(texGain.gain);
  lfo.connect(wobbleDepth);
  wobbleDepth.connect(texBP.frequency);
  lfo.connect(texPan.pan);

  const dust = loop(makeDust(ctx));
  const dustGain = gain(0);
  dust.connect(dustGain);
  dustGain.connect(texPan);

  const morse = loop(makeMorse(ctx));
  const morseGain = gain(0);
  morse.connect(morseGain);
  morseGain.connect(mix);

  // Gesture: velocity air + hold whoosh share one sweeping band-pass; riser sine
  const breathBP = biquad('bandpass', 500, 1);
  const breathGain = gain(0);
  noise.connect(breathBP);
  breathBP.connect(breathGain);
  breathGain.connect(mix);
  const riser = osc('sine', 150);
  const riserGain = gain(0);
  riser.connect(riserGain);
  riserGain.connect(mix);

  // Burst: sub boom, noise thump, shimmering tail (reverb only)
  const boom = osc('sine', 60);
  const boomGain = gain(0);
  boom.connect(boomGain);
  boomGain.connect(mix);
  const burstBP = biquad('lowpass', 2000, 0.9);
  const burstGain = gain(0);
  noise.connect(burstBP);
  burstBP.connect(burstGain);
  burstGain.connect(mix);
  const shimmerBP = biquad('bandpass', 6000, 9);
  const shimmerGain = gain(0);
  noise.connect(shimmerBP);
  shimmerBP.connect(shimmerGain);
  shimmerGain.connect(convolver);

  const t0 = ctx.currentTime;
  for (const s of sources) s.start(t0);

  return {
    ctx, banks, sources, nodes, master, boom, boomGain, burstBP, burstGain, shimmerBP, shimmerGain,
    sCutoff: new Smooth(droneFilter.frequency, 0.15, 0.004, true),
    sQ: new Smooth(droneFilter.Q, 0.2, 0.02, false),
    sBpF: new Smooth(texBP.frequency, 0.2, 0.004, true),
    sBpQ: new Smooth(texBP.Q, 0.2, 0.02, false),
    sNoise: new Smooth(texGain.gain, 0.15, 0.0002, false),
    sSwell: new Smooth(swellDepth.gain, 0.15, 0.0002, false),
    sWobble: new Smooth(wobbleDepth.gain, 0.2, 2, false),
    sLfo: new Smooth(lfo.frequency, 0.3, 0.003, false),
    sDust: new Smooth(dustGain.gain, 0.12, 0.0003, false),
    sDustRate: new Smooth(dust.playbackRate, 0.2, 0.004, true),
    sMorse: new Smooth(morseGain.gain, 0.12, 0.0003, false),
    sWet: new Smooth(wet.gain, 0.3, 0.005, false),
    sBreathF: new Smooth(breathBP.frequency, 0.06, 0.004, true),
    sBreathQ: new Smooth(breathBP.Q, 0.08, 0.02, false),
    sBreathG: new Smooth(breathGain.gain, 0.07, 0.0002, false),
    sRiserF: new Smooth(riser.frequency, 0.06, 0.002, true),
    sRiserG: new Smooth(riserGain.gain, 0.06, 0.0002, false),
  };
}

// ---------------------------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------------------------

const disposedEngines = new WeakSet<AudioEngine>();

type CtxCtor = new (opts?: AudioContextOptions) => AudioContext;

function realtimeCtor(): CtxCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: CtxCtor; webkitAudioContext?: CtxCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function isRealtime(ctx: BaseAudioContext): ctx is AudioContext {
  return !('startRendering' in ctx) && typeof (ctx as AudioContext).suspend === 'function';
}

export class AudioEngine {
  private on = false;
  private disposed = false;
  private ctx: BaseAudioContext | null = null;
  private g: Graph | null = null;
  private readonly createContext: (() => BaseAudioContext) | null;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingDisable: (() => void) | null = null;
  private listening = false;
  private needsUnlock = false;
  private hidden = false;
  // Last frame (kept for re-applying after visibility changes / first enable).
  private progress = 0;
  private velocity = 0;
  private hold = 0;

  constructor(options?: AudioEngineOptions) {
    this.createContext = options?.createContext ?? null;
  }

  get enabled(): boolean {
    return this.on;
  }

  async enable(): Promise<void> {
    if (this.disposed) return;
    try {
      if (!this.ctx) {
        if (this.createContext) {
          this.ctx = this.createContext();
        } else {
          const Ctor = realtimeCtor();
          if (!Ctor) return;
          this.ctx = new Ctor({ latencyHint: 'balanced' });
        }
      }
      const ctx = this.ctx;
      // resume() must be called synchronously inside the user gesture (iOS / Safari).
      const resumed = isRealtime(ctx) ? ctx.resume() : Promise.resolve();
      if (!this.g) {
        this.g = buildGraph(ctx);
        this.apply(true);
      }
      this.on = true;
      this.clearSuspendTimer();
      this.addListeners();
      this.hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      this.fadeMaster(this.hidden ? 0 : MASTER, FADE_IN_TAU);
      await resumed.catch(() => {
        this.needsUnlock = true;
      });
    } catch {
      // Unsupported or blocked: stay silent, never throw into UI code.
    }
  }

  async disable(): Promise<void> {
    this.on = false;
    const ctx = this.ctx;
    if (!ctx || !this.g || this.disposed) return;
    this.fadeMaster(0, FADE_OUT_TAU);
    this.clearSuspendTimer();
    if (!isRealtime(ctx)) return;
    await new Promise<void>((resolve) => {
      this.pendingDisable = resolve;
      this.suspendTimer = setTimeout(() => {
        this.suspendTimer = null;
        this.pendingDisable = null;
        if (!this.on && ctx.state === 'running') ctx.suspend().then(resolve, resolve);
        else resolve();
      }, FADE_OUT_MS);
    });
  }

  update(frame: AudioFrame): void {
    if (!this.on || !this.g) return;
    const p = frame.progress;
    const v = frame.velocity;
    const h = frame.hold;
    if (p === p && p !== Infinity && p !== -Infinity) this.progress = p;
    this.velocity = v === v && v !== Infinity && v !== -Infinity ? v : 0;
    this.hold = h === h ? clamp01(h) : 0;
    if (this.hidden) return;
    this.apply(false);
  }

  burst(strength: number): void {
    const g = this.g;
    if (!this.on || !g || this.hidden || this.disposed) return;
    const s = strength === strength ? clamp01(strength) : 0;
    if (s <= 0.001) return;
    try {
      const now = g.ctx.currentTime;
      // Sub boom: sine falling ~1.5 octaves, fast attack, ~1.6 s decay
      const f = g.boom.frequency;
      f.cancelScheduledValues(now);
      f.setValueAtTime(92, now);
      f.exponentialRampToValueAtTime(31, now + 1.1);
      const bg = g.boomGain.gain;
      holdParam(bg, now);
      bg.linearRampToValueAtTime(0.34 * s, now + 0.015);
      bg.setTargetAtTime(0, now + 0.03, 0.5);
      // Noise thump: lowpass sweeping down, fast decay
      const bf = g.burstBP.frequency;
      bf.cancelScheduledValues(now);
      bf.setValueAtTime(1800 + 2400 * s, now);
      bf.exponentialRampToValueAtTime(140, now + 0.7);
      const ng = g.burstGain.gain;
      holdParam(ng, now);
      ng.linearRampToValueAtTime(0.45 * s, now + 0.006);
      ng.setTargetAtTime(0, now + 0.01, 0.11);
      // Shimmering tail: narrow high band drifting down, swelling into the reverb
      const sf = g.shimmerBP.frequency;
      sf.cancelScheduledValues(now);
      sf.setValueAtTime(7200, now);
      sf.exponentialRampToValueAtTime(3200, now + 3.5);
      const sg = g.shimmerGain.gain;
      holdParam(sg, now);
      sg.linearRampToValueAtTime(1.6 * s, now + 0.3);
      sg.setTargetAtTime(0, now + 0.32, 0.9);
    } catch {
      /* never throw from burst */
    }
  }

  dispose(): void {
    this.on = false;
    this.disposed = true;
    disposedEngines.add(this);
    this.clearSuspendTimer();
    this.removeListeners();
    const g = this.g;
    const ctx = this.ctx;
    this.g = null;
    this.ctx = null;
    if (g) {
      for (const s of g.sources) {
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
      }
      for (const n of g.nodes) n.disconnect();
    }
    if (ctx && isRealtime(ctx) && ctx.state !== 'closed') ctx.close().catch(() => {});
  }

  // -------------------------------------------------------------------------------------------

  /** Map the current frame onto the graph. `init` writes values directly (before anything is audible). */
  private apply(init: boolean): void {
    const g = this.g;
    if (!g) return;
    const now = g.ctx.currentTime;

    // Same rest/transition shape as morphAt() (inlined to stay allocation-free).
    const pc = this.progress < 0 ? 0 : this.progress > PROGRESS_MAX ? PROGRESS_MAX : this.progress;
    const from = Math.min(Math.floor(pc), PROGRESS_MAX - 1);
    const to = from + 1;
    const t = clamp01((pc - from - HOLD) / (1 - 2 * HOLD));
    const e = t * t * (3 - 2 * t);
    const A = SCENES[from]!;
    const B = SCENES[to]!;

    const v = this.velocity < 0 ? -this.velocity : this.velocity;
    const air = 1 - Math.exp(-v / 1.5);
    const h = this.hold;
    const duck = 1 - 0.35 * h;

    // Drone: equal-power crossfade between the two banks
    const wFrom = Math.cos(e * Math.PI * 0.5);
    const wTo = Math.sin(e * Math.PI * 0.5);
    this.voice(g.banks[from & 1], from, wFrom * duck, now, init);
    this.voice(g.banks[to & 1], to, wTo * duck, now, init);

    const cutoff = glerp(A.cutoff, B.cutoff, e) * (1 + 0.8 * air + 0.7 * h);
    this.put(g.sCutoff, now, init, cutoff);
    this.put(g.sQ, now, init, lerp(A.q, B.q, e));

    // Texture
    const trim = lerp(A.trim, B.trim, e);
    const n = lerp(A.noise, B.noise, e) * trim * (1 + 0.6 * air) * duck;
    const bp = glerp(A.bp, B.bp, e);
    this.put(g.sBpF, now, init, bp);
    this.put(g.sBpQ, now, init, lerp(A.bpQ, B.bpQ, e));
    this.put(g.sNoise, now, init, n);
    this.put(g.sSwell, now, init, (lerp(A.swell, B.swell, e) * n) / LFO_AMP);
    this.put(g.sWobble, now, init, Math.min(lerp(A.wobble, B.wobble, e), bp * 0.8) / LFO_AMP);
    this.put(g.sLfo, now, init, lerp(A.lfo, B.lfo, e));
    this.put(g.sDust, now, init, lerp(A.dust, B.dust, e) * trim * duck);
    this.put(g.sDustRate, now, init, glerp(A.dustRate, B.dustRate, e));
    this.put(g.sMorse, now, init, lerp(A.morse, B.morse, e) * trim * duck);
    this.put(g.sWet, now, init, lerp(A.wet, B.wet, e));

    // Gesture: air (velocity) + whoosh (hold) through one sweeping band-pass, riser sine
    this.put(g.sBreathF, now, init, (450 + 1000 * air) * Math.pow(2, 3.4 * h));
    this.put(g.sBreathQ, now, init, 0.9 + 3.5 * h);
    this.put(g.sBreathG, now, init, 0.13 * air + 0.55 * Math.pow(h, 1.6));
    const root = e < 0.5 ? A.root : B.root;
    this.put(g.sRiserF, now, init, mtof(root + 31) * Math.pow(2, 2 * h));
    this.put(g.sRiserG, now, init, 0.07 * h * h);
  }

  private put(s: Smooth, now: number, init: boolean, val: number): void {
    if (init) s.init(val);
    else s.set(val, now);
  }

  private voice(bank: Bank, f: number, w: number, now: number, init: boolean): void {
    const sc = SCENES[f]!;
    if (bank.formation !== f) {
      bank.formation = f;
      const triF = mtof(sc.root);
      const aF = mtof(sc.root + 12 + sc.saws[0]);
      const bF = mtof(sc.root + 12 + sc.saws[1]);
      if (init) {
        bank.sTriF.init(triF);
        bank.sSawAF.init(aF);
        bank.sSawBF.init(bF);
        bank.sSawADet.init(sc.detune);
        bank.sSawBDet.init(-sc.detune);
      } else {
        bank.sTriF.set(triF, now);
        bank.sSawAF.set(aF, now);
        bank.sSawBF.set(bF, now);
        bank.sSawADet.set(sc.detune, now);
        bank.sSawBDet.set(-sc.detune, now);
      }
    }
    if (init) {
      bank.sTriG.init(sc.tri * w);
      bank.sSawG.init(sc.saw * sc.trim * w);
    } else {
      bank.sTriG.set(sc.tri * w, now);
      bank.sSawG.set(sc.saw * sc.trim * w, now);
    }
  }

  private fadeMaster(target: number, tau: number): void {
    const g = this.g;
    if (!g) return;
    const now = g.ctx.currentTime;
    const p = g.master.gain;
    holdParam(p, now);
    p.setTargetAtTime(target, now, tau);
  }

  private clearSuspendTimer(): void {
    if (this.suspendTimer !== null) {
      clearTimeout(this.suspendTimer);
      this.suspendTimer = null;
    }
    if (this.pendingDisable) {
      const r = this.pendingDisable;
      this.pendingDisable = null;
      r();
    }
  }

  private readonly onVisibility = (): void => {
    const ctx = this.ctx;
    if (!ctx || !isRealtime(ctx) || typeof document === 'undefined') return;
    this.hidden = document.visibilityState === 'hidden';
    if (!this.on) return;
    if (this.hidden) {
      this.fadeMaster(0, 0.08);
      if (this.suspendTimer === null) {
        this.suspendTimer = setTimeout(() => {
          this.suspendTimer = null;
          if (this.hidden && ctx.state === 'running') ctx.suspend().catch(() => {});
        }, 300);
      }
    } else {
      this.clearSuspendTimer();
      ctx.resume().then(
        () => {
          if (this.on && !this.hidden) {
            this.apply(false);
            this.fadeMaster(MASTER, 0.35);
          }
        },
        () => {
          this.needsUnlock = true;
        },
      );
    }
  };

  /** iOS 'interrupted' (calls, Siri) or an externally suspended context: resume when possible. */
  private readonly onStateChange = (): void => {
    const ctx = this.ctx;
    if (!ctx || !isRealtime(ctx) || !this.on || this.hidden) return;
    const st = ctx.state as string;
    if (st === 'suspended' || st === 'interrupted') {
      ctx.resume().catch(() => {
        this.needsUnlock = true;
      });
    }
  };

  /** Any later gesture can unlock a context the browser refused to resume. */
  private readonly onGesture = (): void => {
    const ctx = this.ctx;
    if (!ctx || !isRealtime(ctx) || !this.on || this.hidden) return;
    if (this.needsUnlock || (ctx.state as string) !== 'running') {
      this.needsUnlock = false;
      ctx.resume().catch(() => {
        this.needsUnlock = true;
      });
    }
  };

  private addListeners(): void {
    const ctx = this.ctx;
    if (this.listening || !ctx || !isRealtime(ctx) || typeof document === 'undefined') return;
    this.listening = true;
    document.addEventListener('visibilitychange', this.onVisibility);
    ctx.addEventListener('statechange', this.onStateChange);
    window.addEventListener('pointerdown', this.onGesture, true);
    window.addEventListener('keydown', this.onGesture, true);
    window.addEventListener('touchend', this.onGesture, true);
  }

  private removeListeners(): void {
    if (!this.listening) return;
    this.listening = false;
    const ctx = this.ctx;
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (ctx) ctx.removeEventListener('statechange', this.onStateChange);
    window.removeEventListener('pointerdown', this.onGesture, true);
    window.removeEventListener('keydown', this.onGesture, true);
    window.removeEventListener('touchend', this.onGesture, true);
  }
}

let instance: AudioEngine | null = null;
/** Lazy singleton (no AudioContext until enable()). A disposed instance is replaced on next call. */
export function getAudioEngine(): AudioEngine {
  if (!instance || disposedEngines.has(instance)) instance = new AudioEngine();
  return instance;
}
