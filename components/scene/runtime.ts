import type { WebGPURenderer } from 'three/webgpu';
import type { Backend } from '@/lib/store';

/**
 * Tiny module-level registry of the running scene, for development tools (stats-gl needs the renderer)
 * and the always-on verification probe (`window.__scene`, see Experience.tsx).
 */
export interface SceneRuntime {
  renderer: WebGPURenderer | null;
  backend: Backend | null;
  /** Called after every rendered frame (dev tools hook in here). */
  afterFrame: (() => void) | null;
}

export const sceneRuntime: SceneRuntime = { renderer: null, backend: null, afterFrame: null };

export interface SceneProbe {
  backend: Backend | null;
  mode: string | null;
  particleCount: number;
  activeCount: number;
  /** Exponential moving average of the frame rate. */
  fps: number;
  qualityLevel: number;
  frames: number;
  dpr: number;
  postLevel: number;
}

declare global {
  interface Window {
    __scene?: SceneProbe;
    __setExperience?: (partial: Record<string, unknown>) => void;
    __qualityLadder?: ReadonlyArray<{ dpr: number; post: number; active: number }>;
    __setQualityLevel?: (level: number) => number;
    /** Development only: values merged over the store each frame (scene testing independent of scroll/input). */
    __sceneOverride?: Partial<import('@/lib/store').ExperienceState>;
  }
}
