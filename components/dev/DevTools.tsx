'use client';

/**
 * Development-only tooling (only reachable through DevToolsLoader's NODE_ENV-guarded import()):
 *  - leva panel writing straight into lib/tuning.ts (the scene reads it every frame, no re-render),
 *  - stats-gl (FPS/CPU; GPU timing on the WebGPU backend only — timestamp queries on the WebGL2 backend
 *    collide with the RenderPipeline's nested passes, research/tsl-post.md §10),
 *  - `?studio` → Theatre.js Studio via lib/camera.ts `openStudio()` when that export exists.
 * `?clean` hides the panels (clean screenshots in development).
 */
import { useEffect } from 'react';
import { Leva, useControls } from 'leva';
import { TimestampQuery } from 'three/webgpu';
import { tuning } from '@/lib/tuning';
import { sceneRuntime } from '@/components/scene/runtime';

type Section = keyof typeof tuning;
const SECTIONS: Section[] = ['physics', 'pointer', 'hold', 'render', 'post', 'camera'];

function schemaFor(section: Section): Record<string, { value: number; min: number; max: number; step: number; onChange: (v: number) => void }> {
  const group = tuning[section] as Record<string, number>;
  const out: Record<string, { value: number; min: number; max: number; step: number; onChange: (v: number) => void }> = {};
  for (const [key, value] of Object.entries(group)) {
    if (typeof value !== 'number') continue;
    const max = value === 0 ? 1 : Math.abs(value) * 4;
    out[key] = {
      value,
      min: value < 0 ? -max : 0,
      max,
      step: max / 400,
      onChange: (v: number) => {
        group[key] = v;
      },
    };
  }
  return out;
}

function Panel({ section }: { section: Section }) {
  useControls(section, schemaFor(section), { collapsed: true });
  return null;
}

const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
const clean = params.has('clean');

export default function DevTools() {
  // stats-gl, attached once the renderer exists.
  useEffect(() => {
    if (clean) return undefined;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    const attach = async () => {
      while (!disposed && !sceneRuntime.renderer) await new Promise((r) => setTimeout(r, 250));
      const renderer = sceneRuntime.renderer;
      if (disposed || !renderer) return;
      const { default: Stats } = await import('stats-gl');
      if (disposed) return;
      const gpu = sceneRuntime.backend === 'webgpu';
      const stats = new Stats({ trackGPU: gpu, trackCPT: gpu, horizontal: true });
      stats.dom.setAttribute('data-devtool', 'stats-gl');
      stats.dom.style.cssText += ';position:fixed;left:0;bottom:0;top:auto;z-index:9999;pointer-events:none;';
      document.body.appendChild(stats.dom);
      if (gpu) await stats.init(renderer);
      sceneRuntime.afterFrame = () => {
        if (gpu) {
          void renderer.resolveTimestampsAsync(TimestampQuery.RENDER);
          void renderer.resolveTimestampsAsync(TimestampQuery.COMPUTE);
        }
        stats.update();
      };
      cleanup = () => {
        sceneRuntime.afterFrame = null;
        stats.dom.remove();
      };
    };
    void attach();
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  // Theatre.js Studio (camera agent's lib/camera.ts) — guarded so this compiles whether or not it exists.
  useEffect(() => {
    if (!params.has('studio')) return;
    void import('@/lib/camera').then((m) => {
      const mod = m as Record<string, unknown>;
      if ('openStudio' in mod && typeof mod.openStudio === 'function') void (mod.openStudio as () => unknown)();
    });
  }, []);

  return (
    <>
      <Leva hidden={clean} collapsed titleBar={{ title: 'tuning' }} />
      {SECTIONS.map((s) => (
        <Panel key={s} section={s} />
      ))}
    </>
  );
}
