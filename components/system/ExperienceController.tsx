'use client';
/**
 * Wires the browser to the shared store (renders nothing):
 *  - reads the mode from document.documentElement.dataset.mode ('immersive' | 'static'),
 *  - keeps store.reducedMotion (matchMedia) and store.viewport (resize) up to date,
 *  - initScroll({ mode, reducedMotion }), initInput({ holdEnabled: mode === 'immersive' }),
 *    initAudioBridge(); cleans everything up on unmount,
 *  - re-initialises scroll in 'static' mode if store.phase becomes 'static' at runtime
 *    (renderer init failure) after setting dataset.mode = 'static'.
 *  - development only: exposes window.__store / window.__scroll for the test harness.
 */
import { useEffect } from 'react';
import { getExperience, setExperience, useExperience } from '@/lib/store';
import { getScroll, initScroll, type ScrollMode } from '@/lib/scroll';
import { initInput } from '@/lib/input';
import { initAudioBridge } from '@/lib/audio-bridge';

declare global {
  interface Window {
    __store?: typeof useExperience;
    __scroll?: typeof getScroll;
  }
}

const readMode = (): ScrollMode => (document.documentElement.dataset.mode === 'immersive' ? 'immersive' : 'static');

export default function ExperienceController() {
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');

    let mode: ScrollMode = readMode();
    if (getExperience().phase === 'static' && mode !== 'static') {
      root.dataset.mode = 'static';
      mode = 'static';
    }
    let reduced = mq.matches;
    let stopInput: (() => void) | null = null;

    const viewport = (): void => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const v = getExperience().viewport;
      if (v.width !== width || v.height !== height) setExperience({ viewport: { width, height, landscape: width >= height } });
    };

    const start = (): void => {
      initScroll({ mode, reducedMotion: reduced });
      stopInput?.();
      stopInput = initInput({ holdEnabled: mode === 'immersive' });
    };

    setExperience({ reducedMotion: reduced });
    viewport();
    start();
    const stopAudio = initAudioBridge();

    const onMotion = (e: MediaQueryListEvent): void => {
      reduced = e.matches;
      setExperience({ reducedMotion: reduced });
      initScroll({ mode, reducedMotion: reduced }); // Lenis on/off
    };
    mq.addEventListener('change', onMotion);
    window.addEventListener('resize', viewport, { passive: true });

    // Runtime fallback: the renderer failed after boot → static layout, re-measured.
    const unsubPhase = useExperience.subscribe(
      (s) => s.phase,
      (phase) => {
        if (phase !== 'static' || mode === 'static') return;
        root.dataset.mode = 'static';
        mode = 'static';
        const k = getExperience().chapter;
        start();
        requestAnimationFrame(() => getScroll()?.scrollToChapter(k, { immediate: true }));
      },
    );

    if (process.env.NODE_ENV === 'development') {
      window.__store = useExperience;
      window.__scroll = getScroll;
    }

    return () => {
      unsubPhase();
      mq.removeEventListener('change', onMotion);
      window.removeEventListener('resize', viewport);
      stopAudio();
      stopInput?.();
      getScroll()?.destroy();
    };
  }, []);

  return null;
}
