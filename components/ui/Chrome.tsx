'use client';
/**
 * Fixed overlay chrome: wordmark, sound toggle, year counter, chapter rail and the hold ring, plus the
 * small store → DOM effects that tie the overlay together:
 *  - per-chapter accent colours on <html> (--accent / --accent-2, transitioned via @property),
 *  - counter + rail fade out (and go inert) as the frontier scrolls in,
 *  - text recedes while the universe is held collapsed.
 * Every per-frame value is written straight to the DOM; React re-renders only on discrete changes.
 */
import { useEffect, useRef } from 'react';
import { CHAPTERS, SITE } from '@/data/chapters';
import { getExperience, useExperience } from '@/lib/store';
import SoundToggle from './SoundToggle';
import YearCounter from './YearCounter';
import ChapterRail from './ChapterRail';

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function useAccent(): void {
  useEffect(() => {
    const root = document.documentElement;
    const apply = (chapter: number): void => {
      const c = CHAPTERS[Math.min(CHAPTERS.length, Math.max(1, chapter)) - 1]!;
      root.style.setProperty('--accent', c.palette.primary);
      root.style.setProperty('--accent-2', c.palette.secondary);
    };
    apply(getExperience().chapter);
    return useExperience.subscribe((s) => s.chapter, apply);
  }, []);
}

/** Counter + rail fade with the frontier; hold dims the text layers. One combined writer. */
function useOverlayFades(): void {
  useEffect(() => {
    const fadeEls = Array.from(document.querySelectorAll<HTMLElement>('[data-frontier-fade]'));
    const showEls = Array.from(document.querySelectorAll<HTMLElement>('[data-frontier-show]'));
    const dimEls = Array.from(document.querySelectorAll<HTMLElement>('[data-hold-dim]'));
    let lastF = -1;
    let lastH = -1;
    const apply = (frontier: number, hold: number): void => {
      const f = Math.round((1 - smooth(0.08, 0.6, frontier)) * 1000) / 1000;
      const h = Math.round((1 - 0.72 * smooth(0, 0.85, hold)) * 1000) / 1000;
      if (f === lastF && h === lastH) return;
      const fChanged = f !== lastF;
      lastF = f;
      lastH = h;
      for (const el of dimEls) {
        const isFade = el.hasAttribute('data-frontier-fade');
        el.style.opacity = String(isFade ? f * h : h);
      }
      if (fChanged) {
        for (const el of showEls) el.style.opacity = String(Math.round((1 - f) * 1000) / 1000);
        for (const el of fadeEls) {
          if (!el.hasAttribute('data-hold-dim')) el.style.opacity = String(f);
          const off = f < 0.04;
          if (el.inert !== off) el.inert = off;
          el.style.visibility = off ? 'hidden' : '';
        }
      }
    };
    const s = getExperience();
    apply(s.frontier, s.hold);
    return useExperience.subscribe(
      (st) => [st.frontier, st.hold] as const,
      ([f, h]) => apply(f, h),
      { equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] },
    );
  }, []);
}

/** A hairline ring at the pointer that contracts as the universe collapses and flares on release. */
function HoldRing() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let visible = false;
    return useExperience.subscribe((s) => {
      const strength = Math.max(s.hold, s.burst);
      if (strength < 0.004) {
        if (visible) {
          visible = false;
          el.style.opacity = '0';
        }
        return;
      }
      visible = true;
      const x = ((s.pointer.x + 1) / 2) * window.innerWidth;
      const y = ((1 - s.pointer.y) / 2) * window.innerHeight;
      const scale = s.burst > s.hold ? 1 + (1 - s.burst) * 1.6 : 1.5 - 1.15 * s.hold;
      const opacity = s.burst > s.hold ? s.burst * 0.9 : Math.min(1, s.hold * 3) * 0.85;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
      el.style.opacity = opacity.toFixed(3);
    });
  }, []);
  return <div ref={ref} className="hold-ring" aria-hidden="true" />;
}

export default function Chrome() {
  useAccent();
  useOverlayFades();
  const [head, last] = (() => {
    const i = SITE.title.lastIndexOf(' ');
    return [SITE.title.slice(0, i + 1), SITE.title.slice(i + 1)];
  })();

  return (
    <>
      <div className="static-scrim static-scrim-top" aria-hidden="true" />
      <div className="static-scrim static-scrim-bottom" aria-hidden="true" />
      <div className="top-scrim" data-frontier-show aria-hidden="true" />
      <header className="chrome-header" data-no-hold>
        <p className="wordmark" aria-hidden="true">
          {head}
          <em>{last}</em>
        </p>
        <SoundToggle />
      </header>
      <YearCounter />
      <ChapterRail />
      <HoldRing />
    </>
  );
}
