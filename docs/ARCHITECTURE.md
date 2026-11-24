# The Long Scroll — architecture & design spec

13.8 billion years in one scroll. One field of up to 1,000,000 GPU-simulated particles physically
re-forms into each chapter's shape. Everything is drawn live: no images, no video.

This document is the contract between modules. Data lives in `data/`, pure logic in `lib/`, shaders in
`tsl/`, React in `components/`. Read the JSDoc at the top of each stub file — it is the spec.

---

## 1. Stack (pinned)

| Concern | Choice |
| --- | --- |
| App | Next.js 16.4.6 App Router, `output: 'export'` (static), React 19.3.1, TypeScript 7.0.2 strict |
| Rendering | three 0.187.0 `WebGPURenderer` (`three/webgpu`) + TSL (`three/tsl`) for every shader; automatic WebGL2 backend fallback |
| Scene graph | @react-three/fiber 9.8.2 (async `gl` factory → WebGPURenderer) + @react-three/drei 10.7.9 |
| Simulation | TSL compute shaders over storage buffers (positions, velocities, 9 formations) |
| Camera | Theatre.js 0.7.2 core (baked JSON in `theatre/`), Studio in development only |
| Scroll | Lenis 1.3.27 + GSAP 3.15.1 ScrollTrigger → one progress value 0–9 |
| UI | Tailwind CSS 4.3.5, Motion 14 (`motion/react`), `next/font/google`, Zustand 5.1 store |
| Workers | Formation generation in module Web Workers |
| Audio | Generative Web Audio (`audio/engine.ts`), off by default |
| Dev only | leva (tuning), stats-gl (GPU timing), Theatre Studio — stripped from production |

## 2. Directory map & ownership

```
app/                 layout.tsx (fonts, metadata, <html data-mode> boot script), page.tsx, globals.css, icon.svg
components/ui/       Loader, YearCounter, ChapterRail, ChapterText, SoundToggle, Frontier, Footer, Intro, Chrome
components/scene/    SceneRoot (boot), Experience (R3F Canvas), Particles, StarField, CameraRig, Effects
components/system/   ExperienceController (scroll/input/audio/media-query wiring)
components/dev/      DevTools (leva + stats-gl), dev-only
tsl/                 noise.ts, particles.compute.ts, particles.material.ts, particles.ts (factory), post.ts, stars.ts
lib/                 store, timeline, tuning, ticker, scroll, input, quality, audio-bridge, camera, morse
lib/formations/      types, utils, index, 9 generators, formation.worker.ts, client.ts
audio/engine.ts      generative sound
theatre/camera.json  baked Theatre state (camera keyframes)
data/                chapters.ts, frontier.ts — single source of truth for content
scripts/             test-timeline.ts, preview-formations.ts (run with `node`)
```

## 3. Runtime flow

1. **Before first paint** an inline script in `<head>` sets `html[data-mode]`:
   `immersive` if `'gpu' in navigator` or a WebGL2 context can be created, else `static`.
   (No JS → no attribute → CSS renders the static layout.)
2. **SceneRoot** (client) — `phase: 'boot'`: `detectCapabilities()` → `chooseProfile()`.
   No profile → `phase: 'static'`, `html[data-mode=static]`.
3. `phase: 'loading'`: in parallel, `generateFormations(profile.particleCount)` in workers (progress →
   `loadProgress`, the loader counts up) and renderer init (`new WebGPURenderer({ requiredLimits })`,
   `await renderer.init()`). Any failure → static mode (never a blank page).
4. `phase: 'ready'`: particles start as the **singularity** (formation 0 = chapter 1 × 0.012) at the
   centre of the opening screen. The loader becomes the hint.

## 4. The scroll timeline

`p ∈ [0, 9]` (see `lib/timeline.ts`, fully tested by `scripts/test-timeline.ts`):

- `p = 0` opening screen (singularity), `p = k` chapter k fully formed.
- Rest window `[k − 0.22, k + 0.22]`: formation at rest, text visible, counter exact.
- Between windows: transition. `morphAt(p) → { from, to, t }` (formation indices, 0 = singularity).
- Year counter: `yearDisplayAt(p, nowYear)` — exact in rest windows, log-scale roll between,
  "13,800,000,000 years ago" → "3200 BCE" → "1844" → "1969" → "1969…1991" → "Now".

**Layout (immersive):** `[data-scroll-track]` is `100svh + 9 × 1.5 × 100svh` tall and contains a
`position: sticky` full-viewport `[data-scroll-stage]` holding the intro and the 9 chapter articles,
stacked; their visibility is driven by `restChapter`. The canvas is `position: fixed` behind
everything. At `p = 9` the stage releases and **The frontier** scrolls in over the living scene.

**Layout (static):** identical DOM, normal flow, each chapter a ≥100svh section over a per-chapter
gradient; counter and rail still work (progress from section centres).

## 5. Frame orchestration

- Shared GSAP ticker (`lib/ticker.ts`): Lenis → ScrollTrigger → store `progress/velocity/frontier`;
  input dynamics (`hold`, `burst`); year counter DOM writes; audio updates.
- R3F frame loop (priority 1 `useFrame`, renders manually):
  1. read store (transient values via `getState()`),
  2. `cameraRig.update()` → Theatre pose at `progress` + idle drift + mouse parallax + lens shift,
  3. pointer ray → world space; hold point = ray ∩ plane through the formation centre facing the camera,
  4. `particles.update(frame)` → uniforms + `renderer.compute()` (WebGPU),
  5. `stars.update()`, `post.update()`, `post.render()`,
  6. adaptive quality sample.
- `dt` is clamped to ≤ 1/20 s for the simulation; first frame after a tab switch is skipped.

## 6. Scene modules (APIs)

```ts
// tsl/particles.ts
export type ParticleMode = 'simulate' | 'morph' | 'crossfade';
export interface ParticleSystemOptions {
  renderer: WebGPURenderer; backend: Backend; mode: ParticleMode;
  formations: FormationSet;            // lib/formations/client.ts (packed 9 × N × vec4)
  activeCount?: number;
}
export interface ParticleFrame {
  time: number; dt: number; progress: number;
  hold: number; burst: number;
  pointerRay: { origin: Vector3; direction: Vector3; active: boolean };
  pointerVelocity: Vector3;            // world units/s at the focus plane
  holdPoint: Vector3;                  // where the universe collapses to
  cameraPosition: Vector3; focusDistance: number;
  settle: number;                      // 0..1 chapter-9 grid settles near the frontier
  fade: number;                        // 0..1 global particle intensity (dims under the frontier)
  reducedMotion: boolean;
}
export interface ParticleSystem {
  readonly object: Object3D; readonly count: number; activeCount: number;
  update(frame: ParticleFrame): void; setActiveCount(n: number): void; dispose(): void;
}
export function createParticleSystem(opts: ParticleSystemOptions): ParticleSystem;

// tsl/post.ts
export interface PostChain { update(f: { time: number; bloom: number; reducedMotion: boolean; fade: number }): void;
  render(): void; setQuality(level: 0 | 1 | 2): void; dispose(): void; }
export function createPost(renderer, scene, camera, opts: { quality: 0 | 1 | 2 }): PostChain;

// tsl/stars.ts
export function createStarField(opts: { count: number }): { object: Object3D;
  update(time: number, reducedMotion: boolean, fade: number): void; dispose(): void };

// lib/camera.ts
export interface CameraRig { update(camera: PerspectiveCamera, f: CameraFrame): void; focusDistance(): number; dispose(): void }
export function createCameraRig(): Promise<CameraRig>;   // Theatre project from theatre/camera.json
```

### Particle behaviour (the signature look)

- **Formations**: precomputed `vec4` (xyz + w). `w ∈ [0,1]` brightness/palette mix; `w ∈ [2,3)` pulse
  carrier (network arcs) with phase `w − 2`. Canonical frame; the GPU applies per-chapter
  `scene.tilt`, idle `spin` (with `spinDifferential`), `sway`, `wave` and `scale` from `data/chapters.ts`.
- **Target** = `mix(T_from, T_to, m_i)`, `m_i` = per-particle eased transition with a stagger that
  mixes random delay and spatial order (waves). Formation 0 = chapter 1 scaled by `SINGULARITY_SCALE`.
- **Simulate (WebGPU)**: velocity + spring–damper toward the target; curl-noise turbulence ∝ `sin(π m_i)`
  (peaks mid-transition, zero at rest); pointer push from the pointer ray (falloff, plus drag along the
  pointer's motion); hold → targets collapse into a tiny dense star at `holdPoint` with stronger
  stiffness and a swirl; release → outward burst impulse; springs bring everything back. Interruptions
  are natural because state is velocity-based.
- **Morph (WebGL2)**: same look computed analytically in the vertex shader from two instanced
  attributes `aFrom`/`aTo` (formation data copied in when the scroll crosses a boundary).
- **Crossfade (reduced motion)**: no turbulence, no idle motion, no drift; two static layers (from/to)
  crossfaded by a slowly-eased `t`.
- **Look**: soft round additive sprites, per-chapter two-colour palette crossfaded per particle,
  per-particle depth of field (size grows and alpha drops with distance from the focus plane),
  brightness normalised for particle count, subtle twinkle, speed glow during transitions.
- **Post**: bloom, very subtle chromatic aberration, vignette, film grain (static under reduced motion),
  tone mapping. Far static star field behind everything.

## 7. Visual design system

- **Mood**: deep space, cinematic, quiet luxury. Huge serif, tiny mono labels, hairline chrome.
- **Colours**: `--bg #020308`, `--fg #ECEAF4`, `--fg-muted rgb(236 234 244 / 0.64)`,
  `--fg-faint rgb(236 234 244 / 0.38)`, `--line rgb(236 234 244 / 0.14)`; `--accent` /
  `--accent-2` = current chapter palette (set on `<html>`, transitioned via `@property`).
- **Type**: display = Instrument Serif (headlines, title; italics for emphasis);
  mono = Geist Mono (labels, year counter, rail, domains; `tabular-nums`); body = Geist.
  - Headline `clamp(2.5rem, 1.6rem + 4.2vw, 6.75rem)`, line-height 0.98, tracking −0.015em, `text-wrap: balance`.
  - Label: mono 0.72rem uppercase, tracking 0.16em, `--fg-muted`.
  - Copy: `clamp(1rem, 0.92rem + 0.35vw, 1.25rem)`, line-height 1.5, `--fg-muted`, max 34ch.
  - Year counter: mono `clamp(1.75rem, 1rem + 3.2vw, 4.5rem)`, weight 300–400, suffix as a small label.
- **Layout (desktop, landscape)**: chapter text in a left column (left `clamp(1.5rem, 7vw, 8rem)`,
  vertically centred, max `min(38rem, 44vw)`); the camera lens-shifts the formation right by
  `tuning.camera.lensShiftX`. Wordmark top-left, sound toggle top-right, chapter rail right edge,
  year counter bottom-left.
- **Layout (phone, portrait)**: formation lens-shifted up (`lensShiftY`), chapter text at the bottom
  (above the safe area), counter top-left under the wordmark, slim rail on the right.
- **Legibility**: a soft radial darkening behind each text block (blurred gradient, never a box) plus
  a faint text-shadow.
- **Motion**: text enters as the formation completes (opacity, 16–24px rise, slight blur → sharp,
  staggered lines) and leaves as the next transition starts. Reduced motion → opacity only.

## 8. Accessibility & resilience

- All copy is server-rendered HTML in DOM order: h1 title, one `<article>` + h2 per chapter, h2 frontier,
  links. The canvas is `aria-hidden`. Each chapter has a screen-reader description of its visual.
- Every link/button is keyboard-focusable with a visible `:focus-visible` ring. Skip link to the frontier.
- Arrow keys / Page Up / Page Down move between chapters; the rail's ticks are buttons.
- `prefers-reduced-motion`: no turbulence, idle motion, camera drift, smooth-scroll inertia or animated
  grain; crossfades between formations.
- No WebGL/WebGPU (or init failure): static gradient mode, everything readable and scrollable.
- No horizontal scroll at any width (360px → 4K). `overflow-x: clip` on the root as a safety net.

## 9. Performance

- Desktop WebGPU: 1,000,000 particles, compute + draw ≤ ~6 ms GPU on a mid-range laptop.
- Phones: 250,000 (WebGPU) / 100,000 (WebGL2), DPR ≤ 1.5.
- Adaptive quality: DPR → post level → active particle count, with hysteresis.
- First load: HTML/text is static; the scene bundle is code-split (dynamic import, `ssr: false`).
