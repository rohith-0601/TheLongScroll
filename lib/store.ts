/**
 * The shared store between the HTML overlay (UI, scroll, input) and the WebGL scene.
 *
 * Two kinds of fields:
 *  - DISCRETE (phase, backend, chapter, restChapter, soundEnabled, reducedMotion, …): change rarely;
 *    React components may subscribe with selectors and re-render.
 *  - TRANSIENT (progress, velocity, frontier, pointer, hold, burst): change every frame. NEVER bind
 *    these to React state. Read them with `useExperience.getState()` inside a frame loop, or
 *    `useExperience.subscribe(selector, listener)` and write to the DOM directly.
 *
 * Writers (single writer per field):
 *  - lib/scroll.ts → progress, velocity, frontier, chapter, restChapter
 *  - lib/input.ts  → pointer, holding, hold, burst
 *  - components/scene/* (boot) → phase, loadProgress, backend, quality, staticReason
 *  - components/ui/SoundToggle → soundEnabled
 *  - app shell (media query listener) → reducedMotion, viewport
 */
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

export type Backend = 'webgpu' | 'webgl2';

/**
 *  boot    → page hydrated, capability detection running
 *  loading → renderer initialised, formations generating / uploading (loader counts up)
 *  ready   → scene running
 *  static  → no WebGL/WebGPU (or init failed): styled static gradient, all text in normal flow
 */
export type Phase = 'boot' | 'loading' | 'ready' | 'static';

export type QualityTier = 'ultra' | 'high' | 'medium' | 'low';

export interface PointerState {
  /** Normalised device coordinates, -1..1 (y up). */
  x: number;
  y: number;
  /** Smoothed pointer velocity in NDC units per second. */
  vx: number;
  vy: number;
  /** True while a pointer is over the page (mouse) or touching (touch/pen). */
  active: boolean;
  type: 'mouse' | 'touch' | 'pen' | null;
}

export interface ExperienceState {
  // ---- lifecycle (discrete)
  phase: Phase;
  /** 0..1 — formation generation + GPU upload progress (throttled to ~1% steps). */
  loadProgress: number;
  backend: Backend | null;
  tier: QualityTier | null;
  /** Allocated particle count (formations generated at this size). */
  particleCount: number;
  /** Why we are in static mode (diagnostics only). */
  staticReason: string | null;

  // ---- scroll (transient, written every tick by lib/scroll.ts)
  /** Smoothed scroll progress 0..9 (see lib/timeline.ts). */
  progress: number;
  /** Progress units per second (signed, smoothed). */
  velocity: number;
  /** 0..1 — how far the frontier section has scrolled in (0 = below the fold, 1 = its top reached the viewport top). */
  frontier: number;
  /** Nearest chapter 0..9 (0 = intro). Discrete. */
  chapter: number;
  /** Chapter whose rest window contains progress (text visible), or null mid-transition. Discrete. */
  restChapter: number | null;

  // ---- input (transient, written by lib/input.ts)
  pointer: PointerState;
  /** True while the user is pressing-and-holding (after the hold delay). */
  holding: boolean;
  /** Eased hold intensity 0..1 (ramps in while holding, springs back on release). */
  hold: number;
  /** Release burst envelope 0..1: set to the collapse strength on release, decays to 0 in ~0.4 s. */
  burst: number;

  // ---- preferences / environment (discrete)
  reducedMotion: boolean;
  soundEnabled: boolean;
  viewport: { width: number; height: number; landscape: boolean };
}

export const initialExperienceState: ExperienceState = {
  phase: 'boot',
  loadProgress: 0,
  backend: null,
  tier: null,
  particleCount: 0,
  staticReason: null,
  progress: 0,
  velocity: 0,
  frontier: 0,
  chapter: 0,
  restChapter: 0,
  pointer: { x: 0, y: 0, vx: 0, vy: 0, active: false, type: null },
  holding: false,
  hold: 0,
  burst: 0,
  reducedMotion: false,
  soundEnabled: false,
  viewport: { width: 1440, height: 900, landscape: true },
};

export const useExperience = create<ExperienceState>()(subscribeWithSelector(() => ({ ...initialExperienceState })));

/** Shorthand for non-React code. */
export const getExperience = (): ExperienceState => useExperience.getState();
export const setExperience = (partial: Partial<ExperienceState>): void => useExperience.setState(partial);
