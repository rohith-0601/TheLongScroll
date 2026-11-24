'use client';
/**
 * Mounts the fixed, decorative WebGL/WebGPU layer and runs the boot sequence (ARCHITECTURE §3):
 *
 *   html[data-mode] !== 'immersive'           → phase 'static'
 *   detectCapabilities() → chooseProfile()    → null → phase 'static'
 *   phase 'loading': formations in workers (loadProgress 0 → 0.9) ∥ renderer init (R3F gl factory),
 *                    scene build + first frames (0.9 → 1)
 *   phase 'ready'
 *
 * ANY failure (no adapter, init error, worker error, device lost, render error) → html[data-mode] = 'static',
 * phase 'static' with a staticReason, and the canvas is unmounted. Never a blank page, never an uncaught error.
 * The canvas itself (Experience.tsx) is a next/dynamic import with ssr:false — only valid inside this client
 * component (research/next-r3f.md §2.4).
 */
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { setExperience, useExperience } from '@/lib/store';
import { chooseProfile, detectCapabilities, type Capabilities, type QualityProfile } from '@/lib/quality';
import { generateFormations } from '@/lib/formations/client';
import type { ExperienceProps, FormationsHandle } from './Experience';
import DevToolsLoader from '@/components/dev/DevToolsLoader';

const Experience = dynamic<ExperienceProps>(() => import('./Experience'), { ssr: false, loading: () => null });

class SceneErrorBoundary extends Component<{ onError: (reason: string) => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(error: unknown): void {
    this.props.onError(`render-error: ${error instanceof Error ? error.message : String(error)}`);
  }
  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

interface Boot {
  key: number;
  profile: QualityProfile;
  formations: FormationsHandle;
}

/** Monotonic, throttled (~1% steps) loader progress. */
function createProgressWriter(): (f: number) => void {
  let last = -1;
  return (f: number) => {
    const v = Math.min(1, Math.max(0, f));
    if (v >= 1 ? last < 1 : v - last >= 0.01) {
      last = v;
      setExperience({ loadProgress: v });
    }
  };
}

/**
 * DEVELOPMENT ONLY URL overrides for testing every path on one device (never active in production builds):
 *   ?force=webgl2|webgpu   backend      ?motion=reduce   crossfade mode     ?mobile=0|1   device class
 *   ?count=N               particles    ?dpr=X           max canvas DPR
 */
function devParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}
function devCaps(caps: Capabilities): Capabilities {
  const q = devParams();
  const c = { ...caps };
  if (q.get('force') === 'webgl2') Object.assign(c, { webgpu: false, limits: null, adapter: null });
  if (q.get('motion') === 'reduce') c.reducedMotion = true;
  if (q.get('mobile') === '0') c.isMobile = false;
  if (q.get('mobile') === '1') c.isMobile = true;
  return c;
}
function devProfile(p: QualityProfile): QualityProfile {
  const q = devParams();
  const out = { ...p };
  const count = Number(q.get('count'));
  if (count > 0) {
    out.particleCount = out.activeCount = Math.round(count);
    out.minActiveCount = Math.min(out.minActiveCount, out.particleCount);
    if (out.requiredLimits && out.mode === 'simulate') {
      const need = 9 * out.particleCount * 16;
      out.requiredLimits = {
        ...out.requiredLimits,
        maxStorageBufferBindingSize: Math.max(out.requiredLimits.maxStorageBufferBindingSize ?? 0, need),
        maxBufferSize: Math.max(out.requiredLimits.maxBufferSize ?? 0, need),
      };
    }
  }
  const dpr = Number(q.get('dpr'));
  if (dpr > 0) out.dpr = [Math.min(1, dpr), dpr];
  if (q.get('motion') === 'reduce') window.__sceneOverride = { ...(window.__sceneOverride ?? {}), reducedMotion: true };
  return out;
}

export default function SceneRoot() {
  const [boot, setBoot] = useState<Boot | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const capsRef = useRef<Capabilities | null>(null);
  const progressRef = useRef<(f: number) => void>(() => {});
  const failedRef = useRef(false);

  const fail = useCallback((reason: string) => {
    if (failedRef.current) return;
    failedRef.current = true;
    abortRef.current?.abort();
    abortRef.current = null;
    document.documentElement.dataset.mode = 'static';
    setExperience({ phase: 'static', staticReason: reason });
    setBoot(null);
  }, []);

  const start = useCallback(
    (profile: QualityProfile, key: number) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      progressRef.current = createProgressWriter();
      setExperience({
        phase: 'loading',
        loadProgress: 0,
        backend: profile.backend,
        tier: profile.tier,
        particleCount: profile.particleCount,
        staticReason: null,
      });
      const report = progressRef.current;
      const promise = generateFormations(profile.particleCount, {
        signal: ac.signal,
        onProgress: (f) => report(f * 0.9),
      });
      promise.catch((err: unknown) => {
        if (ac.signal.aborted) return;
        fail(`formations: ${err instanceof Error ? err.message : String(err)}`);
      });
      setBoot({ key, profile, formations: { promise } });
    },
    [fail],
  );

  useEffect(() => {
    failedRef.current = false;
    if (document.documentElement.dataset.mode !== 'immersive') {
      setExperience({ phase: 'static', staticReason: 'no-webgl' });
      return;
    }
    if (process.env.NODE_ENV === 'development') {
      // Dev-only hook for testing the scene before the scroll/input modules write the store.
      window.__setExperience = (partial) => setExperience(partial);
    }
    let cancelled = false;
    setExperience({ phase: 'boot' });
    detectCapabilities()
      .then((caps) => {
        if (cancelled) return;
        const c = process.env.NODE_ENV === 'development' ? devCaps(caps) : caps;
        capsRef.current = c;
        const chosen = chooseProfile(c);
        const profile = chosen && process.env.NODE_ENV === 'development' ? devProfile(chosen) : chosen;
        if (!profile) {
          fail(caps.webgpu || caps.webgl2 ? 'no-profile' : 'no-webgl');
          return;
        }
        start(profile, 1);
      })
      .catch((err: unknown) => {
        if (!cancelled) fail(`capabilities: ${err instanceof Error ? err.message : String(err)}`);
      });
    return () => {
      cancelled = true;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [fail, start]);

  const onProgress = useCallback((f: number) => progressRef.current(f), []); // Experience reports 0.9..1
  const onReady = useCallback(() => {
    if (useExperience.getState().phase === 'loading') setExperience({ phase: 'ready', loadProgress: 1 });
  }, []);
  const onBackendMismatch = useCallback(() => {
    // WebGPU device creation failed inside three (it fell back to WebGL2): rebuild with the WebGL2 profile.
    const caps = capsRef.current;
    const profile = caps ? chooseProfile({ ...caps, webgpu: false, limits: null, adapter: null }) : null;
    if (!profile) {
      fail('webgpu-device');
      return;
    }
    setBoot(null);
    setTimeout(() => start(profile, 2), 0);
  }, [fail, start]);

  return (
    <>
      {boot ? (
        <SceneErrorBoundary key={boot.key} onError={fail}>
          <Experience
            profile={boot.profile}
            formations={boot.formations}
            onProgress={onProgress}
            onReady={onReady}
            onFail={fail}
            onBackendMismatch={onBackendMismatch}
          />
        </SceneErrorBoundary>
      ) : null}
      <DevToolsLoader />
    </>
  );
}
