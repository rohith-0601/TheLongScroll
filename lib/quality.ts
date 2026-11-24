/**
 * Capability detection, quality profiles and adaptive quality.
 *
 * Browser-only (call from client code).
 *
 * Profiles (spec):
 *  - Desktop WebGPU                      → 1,000,000 particles ('simulate' = GPU compute physics)
 *  - Phone WebGPU                        → 250,000 particles ('simulate')
 *  - WebGL2 fallback (no WebGPU)         → 100,000 particles ('morph' = vertex-shader morph)
 *  - prefers-reduced-motion (any backend)→ 'crossfade' mode (no physics, no turbulence, slow crossfades)
 *  - No WebGL2/WebGPU                    → null profile → static mode
 * Particle count is also capped so 9 formations fit in one storage buffer:
 *   count ≤ floor(min(adapter.limits.maxStorageBufferBindingSize, adapter.limits.maxBufferSize) / (9 * 16)),
 * and `requiredLimits` asks the device for exactly what is needed (≥ 9 * count * 16 bytes), clamped to
 * the adapter (a limit above the adapter's, or an unknown key, makes three silently fall back to WebGL2).
 * Weak GPUs (integrated / software / low memory) start with a lower activeCount and DPR.
 */
import type { Backend, QualityTier } from './store';

export type ParticleMode = 'simulate' | 'morph' | 'crossfade';

export interface Capabilities {
  webgpu: boolean;
  webgl2: boolean;
  /** GPUAdapter info when WebGPU is available. */
  adapter: { vendor: string; architecture: string; description: string } | null;
  /** Relevant GPUAdapter limits when WebGPU is available. */
  limits: { maxStorageBufferBindingSize: number; maxBufferSize: number; maxStorageBuffersPerShaderStage: number } | null;
  /** WebGL UNMASKED_RENDERER string when available (e.g. "ANGLE (Apple, ANGLE Metal Renderer: Apple M2…)"). */
  glRenderer: string | null;
  isMobile: boolean;
  /** Software rasteriser / very weak GPU detected (SwiftShader, llvmpipe, old Mali/Adreno, …). */
  isSoftware: boolean;
  isIntegratedGpu: boolean;
  devicePixelRatio: number;
  hardwareConcurrency: number;
  deviceMemory: number | null;
  reducedMotion: boolean;
}

export interface QualityProfile {
  tier: QualityTier;
  backend: Backend;
  mode: ParticleMode;
  /** Allocated particle count — every formation is generated with exactly this many points. */
  particleCount: number;
  /** Initially drawn/simulated particles (≤ particleCount). Adaptive quality moves it within [minActiveCount, particleCount]. */
  activeCount: number;
  minActiveCount: number;
  /** Device-pixel-ratio range for the canvas. */
  dpr: [min: number, max: number];
  /** Post-processing level: 0 = cheapest (DPR-capped scene pass, quarter-res bloom, no CA), 1 = medium, 2 = full chain. */
  post: 0 | 1 | 2;
  /** Star field size. */
  stars: number;
  /** Passed to `new WebGPURenderer({ requiredLimits })` on the WebGPU backend. */
  requiredLimits?: Record<string, number>;
}

/** Bytes per particle per formation (vec4<f32>). */
export const BYTES_PER_POINT = 16;
const FORMATIONS = 9;
const DEFAULT_MAX_STORAGE_BINDING = 134_217_728; // WebGPU spec default, 128 MiB
const DEFAULT_MAX_BUFFER = 268_435_456; // 256 MiB

const SOFTWARE_RE = /swiftshader|llvmpipe|softpipe|software|basic render|lavapipe|mesa offscreen/i;
const WEAK_MOBILE_RE = /mali-(?:[4t]\d{2}|g(?:31|51|52|57))|adreno \(tm\) (?:[1-5]\d{2}|6[0-1]\d)|powervr/i;
const INTEGRATED_RE = /intel|uhd graphics|iris|hd graphics/i;

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(fallback);
      },
    );
  });
}

function detectMobile(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  if (nav.userAgentData && typeof nav.userAgentData.mobile === 'boolean' && nav.userAgentData.mobile) return true;
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua)) return true;
  // iPadOS 13+ reports itself as a Mac.
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true;
  return false;
}

function probeWebGL(): { webgl2: boolean; renderer: string | null } {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false });
    if (!gl) return { webgl2: false, renderer: null };
    let renderer: string | null = null;
    try {
      const generic = String(gl.getParameter(gl.RENDERER) ?? '');
      renderer = generic;
      // Firefox already returns a (sanitised) real renderer string and warns when the debug extension is used.
      if (!generic || /^webkit webgl$/i.test(generic)) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        if (ext) renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? generic);
      }
    } catch {
      /* renderer string is optional */
    }
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { webgl2: true, renderer };
  } catch {
    return { webgl2: false, renderer: null };
  }
}

async function probeWebGPU(): Promise<{
  adapter: Capabilities['adapter'];
  limits: Capabilities['limits'];
  fallbackAdapter: boolean;
} | null> {
  try {
    if (typeof navigator === 'undefined' || !('gpu' in navigator) || !navigator.gpu) return null;
    const adapter = await withTimeout<GPUAdapter | null>(
      navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }),
      2500,
      null,
    );
    if (!adapter) return null;
    const info = (adapter as GPUAdapter & { info?: GPUAdapterInfo }).info;
    const fallbackAdapter =
      Boolean((adapter as unknown as { isFallbackAdapter?: boolean }).isFallbackAdapter) ||
      Boolean((info as unknown as { isFallbackAdapter?: boolean } | undefined)?.isFallbackAdapter);
    return {
      adapter: {
        vendor: info?.vendor ?? '',
        architecture: info?.architecture ?? '',
        description: info?.description ?? '',
      },
      limits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
        maxStorageBuffersPerShaderStage: adapter.limits.maxStorageBuffersPerShaderStage,
      },
      fallbackAdapter,
    };
  } catch {
    return null;
  }
}

/** Async because it requests a GPUAdapter (never throws; returns webgpu:false on any failure). */
export async function detectCapabilities(): Promise<Capabilities> {
  const reducedMotion =
    typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)').matches : false;
  const [gpu, gl] = await Promise.all([probeWebGPU(), Promise.resolve(probeWebGL())]);
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null;
  const descriptor = `${gpu?.adapter?.vendor ?? ''} ${gpu?.adapter?.architecture ?? ''} ${gpu?.adapter?.description ?? ''} ${gl.renderer ?? ''}`;
  const isMobile = detectMobile();
  const isSoftware =
    (gpu?.fallbackAdapter ?? false) || SOFTWARE_RE.test(descriptor) || (isMobile && WEAK_MOBILE_RE.test(descriptor));
  const isIntegratedGpu = /^intel/i.test(gpu?.adapter?.vendor ?? '') || INTEGRATED_RE.test(gl.renderer ?? '');
  return {
    // A software fallback adapter is only used when WebGL2 is not available either.
    webgpu: gpu !== null && (!gpu.fallbackAdapter || !gl.webgl2),
    webgl2: gl.webgl2,
    adapter: gpu?.adapter ?? null,
    limits: gpu?.limits ?? null,
    glRenderer: gl.renderer,
    isMobile,
    isSoftware,
    isIntegratedGpu,
    devicePixelRatio: typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1,
    hardwareConcurrency: navigator.hardwareConcurrency || 4,
    deviceMemory,
    reducedMotion,
  };
}

/** Largest particle count whose 9 formations fit into ONE storage-buffer binding on this adapter. */
export function maxParticlesForLimits(limits: NonNullable<Capabilities['limits']>): number {
  return Math.floor(Math.min(limits.maxStorageBufferBindingSize, limits.maxBufferSize) / (FORMATIONS * BYTES_PER_POINT));
}

/** Drawing-buffer cap: 3840 × 2160. */
const MAX_CANVAS_PIXELS = 8_300_000;

const round = (n: number, step = 1000): number => Math.max(step, Math.floor(n / step) * step);

/** Returns null when neither WebGPU nor WebGL2 is usable (→ static mode). */
export function chooseProfile(caps: Capabilities): QualityProfile | null {
  const useWebGPU = caps.webgpu && caps.limits !== null;
  if (!useWebGPU && !caps.webgl2) return null;

  const backend: Backend = useWebGPU ? 'webgpu' : 'webgl2';
  const mode: ParticleMode = caps.reducedMotion ? 'crossfade' : useWebGPU ? 'simulate' : 'morph';
  const lowMemory = caps.deviceMemory !== null && caps.deviceMemory <= 4;
  // Native resolution (crisp sprites): up to DPR 3, capped at ~8.3 MP (true 4K) for the whole canvas.
  const cssPixels = typeof window !== 'undefined' ? Math.max(1, window.innerWidth * window.innerHeight) : 1440 * 900;
  const maxDpr = Math.max(1, Math.min(caps.devicePixelRatio, 3, Math.sqrt(MAX_CANVAS_PIXELS / cssPixels)));
  // Phones never go below DPR 2: their cost is per particle, so lower resolution only adds blur.
  const dprFloor = Math.min(maxDpr, caps.isMobile ? 2 : 1);

  let tier: QualityTier;
  let particleCount: number;
  let activeCount: number;
  let dprMax = maxDpr;
  let post: 0 | 1 | 2 = 2;
  let stars = caps.isMobile ? 2500 : 5000;

  if (mode === 'simulate') {
    particleCount = caps.isMobile ? 250_000 : lowMemory ? 500_000 : 1_000_000;
    tier = caps.isMobile ? 'medium' : 'ultra';
  } else if (mode === 'morph') {
    particleCount = 100_000;
    tier = caps.isMobile ? 'low' : 'medium';
  } else {
    // Crossfade: two static layers, drawn only while a transition is under way.
    particleCount = useWebGPU ? (caps.isMobile ? 150_000 : 400_000) : 100_000;
    tier = caps.isMobile ? 'low' : useWebGPU ? 'high' : 'medium';
  }
  activeCount = particleCount;

  if (caps.isIntegratedGpu && !caps.isMobile) {
    tier = tier === 'ultra' ? 'high' : tier;
    activeCount = Math.round(particleCount * 0.6);
  }
  if (caps.isSoftware) {
    tier = 'low';
    particleCount = Math.min(particleCount, 50_000);
    activeCount = Math.min(activeCount, 25_000);
    dprMax = 1;
    post = 0;
    stars = 1500;
  }

  let requiredLimits: Record<string, number> | undefined;
  if (useWebGPU && caps.limits) {
    if (mode === 'simulate') {
      particleCount = Math.min(particleCount, round(maxParticlesForLimits(caps.limits)));
      activeCount = Math.min(activeCount, particleCount);
    }
    const need = mode === 'simulate' ? FORMATIONS * particleCount * BYTES_PER_POINT : 0;
    requiredLimits = {
      maxStorageBufferBindingSize: Math.min(caps.limits.maxStorageBufferBindingSize, Math.max(need, DEFAULT_MAX_STORAGE_BINDING)),
      maxBufferSize: Math.min(caps.limits.maxBufferSize, Math.max(need, DEFAULT_MAX_BUFFER)),
    };
  }

  return {
    tier,
    backend,
    mode,
    particleCount,
    activeCount,
    minActiveCount: Math.min(activeCount, Math.max(20_000, Math.round(particleCount * 0.2))),
    dpr: [Math.min(dprFloor, dprMax), dprMax],
    post,
    stars,
    requiredLimits,
  };
}

export interface AdaptiveHooks {
  setDpr(dpr: number): void;
  setPost(level: 0 | 1 | 2): void;
  setActiveCount(count: number): void;
}

/** Step down below ~54 fps (sustained 1.5 s), back up above ~58.5 fps (sustained ≥ 6 s). */
const SLOW_MS = 1000 / 54;
const FAST_MS = 1000 / 58.5;

interface QualityStep {
  dpr: number;
  post: 0 | 1 | 2;
  active: number;
}

/**
 * Watches frame times and steps quality down (post level → active particle count to ~40% → DPR in
 * half steps → fewer particles still) when the
 * frame rate stays low (EMA frame time > 1000/54 ms for ~1.5 s), and cautiously back up when it
 * stays high for a long time (< 1000/58.5 ms for ~6 s, longer after every reversal). Ignores the
 * first ~2 s after start and any frame after a tab switch (dt > 0.25 s). Hysteresis + cooldown.
 */
export class AdaptiveQuality {
  private readonly steps: QualityStep[];
  private readonly hooks: AdaptiveHooks;
  private index = 0;
  private ema = 1000 / 60;
  private elapsed = 0;
  private slowFor = 0;
  private fastFor = 0;
  private cooldown = 0;
  private upWait = 6;
  private lastDirection: -1 | 0 | 1 = 0;

  constructor(profile: QualityProfile, hooks: AdaptiveHooks) {
    this.hooks = hooks;
    const steps: QualityStep[] = [];
    // Resolution is degraded LAST: crisp native-resolution sprites matter more than anything else here.
    let s: QualityStep = { dpr: profile.dpr[1], post: profile.post, active: profile.activeCount };
    steps.push({ ...s });
    // 1. Post level (chromatic aberration, bloom resolution).
    while (s.post > 0) {
      s = { ...s, post: (s.post - 1) as 0 | 1 };
      steps.push({ ...s });
    }
    // 2. Particle count, down to ~40% of the allocation (crispness beats density; resolution is last).
    const countFloor = Math.max(profile.minActiveCount, Math.round(profile.particleCount * 0.4));
    while (s.active > countFloor) {
      s = { ...s, active: Math.max(countFloor, Math.round((s.active * 0.85) / 1000) * 1000) };
      steps.push({ ...s });
    }
    // 3. Resolution, in half steps (3 → 2.5 → 2 → 1.5 …) down to the profile's floor.
    for (let d = Math.ceil(s.dpr * 2) / 2 - 0.5; d >= profile.dpr[0] - 1e-6; d -= 0.5) {
      if (d < s.dpr) {
        s = { ...s, dpr: d };
        steps.push({ ...s });
      }
    }
    // 4. Last resort: fewer particles still.
    while (s.active > profile.minActiveCount) {
      s = { ...s, active: Math.max(profile.minActiveCount, Math.round((s.active * 0.75) / 1000) * 1000) };
      steps.push({ ...s });
    }
    this.steps = steps;
  }

  /** Call once per rendered frame with the frame delta in seconds. */
  frame(dt: number): void {
    if (!(dt > 0) || dt > 0.25) return; // tab switch / first frame
    this.elapsed += dt;
    const ms = dt * 1000;
    this.ema += (ms - this.ema) * Math.min(1, dt * 4); // ~0.25 s time constant
    if (this.elapsed < 3) return;
    if (this.cooldown > 0) {
      this.cooldown -= dt;
      return;
    }
    if (this.ema > SLOW_MS) {
      this.slowFor += dt;
      this.fastFor = 0;
    } else if (this.ema < FAST_MS) {
      this.fastFor += dt;
      this.slowFor = 0;
    } else {
      this.slowFor = Math.max(0, this.slowFor - dt);
      this.fastFor = Math.max(0, this.fastFor - dt);
    }
    if (this.slowFor > 1.5 && this.index < this.steps.length - 1) {
      if (this.lastDirection === 1) this.upWait = Math.min(60, this.upWait * 2); // reversal → be more cautious
      this.apply(this.index + 1);
      this.lastDirection = -1;
    } else if (this.fastFor > this.upWait && this.index > 0) {
      this.apply(this.index - 1);
      this.lastDirection = 1;
    }
  }

  private apply(next: number): void {
    const a = this.steps[this.index]!;
    const b = this.steps[next]!;
    this.index = next;
    if (a.dpr !== b.dpr) this.hooks.setDpr(b.dpr);
    if (a.post !== b.post) this.hooks.setPost(b.post);
    if (a.active !== b.active) this.hooks.setActiveCount(b.active);
    this.slowFor = 0;
    this.fastFor = 0;
    this.cooldown = 2;
    this.ema = 1000 / 60;
  }

  /** Jump to a level (development measurements); returns the clamped level. */
  setLevel(level: number): number {
    const next = Math.max(0, Math.min(this.steps.length - 1, Math.round(level)));
    if (next !== this.index) this.apply(next);
    return this.index;
  }

  /** The degradation ladder (for diagnostics). */
  get ladder(): ReadonlyArray<Readonly<QualityStep>> {
    return this.steps;
  }

  /** Current degradation level (0 = initial profile). */
  get level(): number {
    return this.index;
  }
}
