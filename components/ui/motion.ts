'use client';
/**
 * Shared overlay motion helpers.
 *  - useScrollFade: scroll-linked visibility of a text block (chapterTextOpacity), written straight to
 *    the DOM from a store subscription — never React state per frame.
 *  - lineVariants: Motion entrance/exit for staggered text lines (rise + blur → sharp; opacity only
 *    under reduced motion). Direction-aware: text rises in the scroll direction and leaves the same way.
 */
import { useEffect, useRef, useSyncExternalStore, type RefObject } from 'react';
import type { Variants } from 'motion/react';
import { getExperience, useExperience } from '@/lib/store';
import { chapterTextOpacity } from '@/lib/timeline';

export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];
export const EASE_IN: [number, number, number, number] = [0.55, 0, 0.75, 0.2];

export interface LineCustom {
  /** Line index (stagger order). */
  i: number;
  /** +1 scrolling forward (text rises from below), -1 backward. */
  dir: number;
  reduced: boolean;
  /** Extra delay before the first line (s). */
  delay?: number;
}

// Reduced motion: opacity only — transform/blur snap to rest (duration 0) so nothing is left offset.
const SNAP = { duration: 0 } as const;

export const lineVariants: Variants = {
  hidden: ({ dir, reduced }: LineCustom) =>
    reduced
      ? { opacity: 0, y: 0, filter: 'blur(0px)', transition: { duration: 0.6, ease: 'easeOut', y: SNAP, filter: SNAP } }
      : { opacity: 0, y: -12 * dir, filter: 'blur(6px)', transition: { duration: 0.42, ease: EASE_IN } },
  shown: ({ i, dir, reduced, delay = 0 }: LineCustom) =>
    reduced
      ? { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.9, delay: delay + i * 0.06, ease: 'easeOut', y: SNAP, filter: SNAP } }
      : {
          opacity: [0, 1],
          y: [22 * dir, 0],
          filter: ['blur(10px)', 'blur(0px)'],
          transition: {
            duration: 1.25,
            delay: delay + 0.04 + i * 0.11,
            ease: EASE_OUT,
            opacity: { duration: 0.9, delay: delay + 0.04 + i * 0.11, ease: 'easeOut' },
          },
        },
};

/**
 * Writes chapterTextOpacity(k, progress) to `ref` (opacity only; the element keeps its place in
 * the accessibility tree) and toggles `data-active` for pointer-events / selection.
 */
export function useScrollFade(ref: RefObject<HTMLElement | null>, k: number): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let last = -1;
    const apply = (p: number): void => {
      const o = Math.round(chapterTextOpacity(k, p) * 1000) / 1000;
      if (o === last) return;
      last = o;
      el.style.opacity = String(o);
      const on = o > 0.01;
      if ((el.dataset.active === 'true') !== on) el.dataset.active = String(on);
    };
    apply(getExperience().progress);
    return useExperience.subscribe((s) => s.progress, apply);
  }, [ref, k]);
}

/** Scroll direction (+1 / -1) captured whenever `active` flips — read during render. */
export function useEntryDirection(active: boolean): number {
  const dir = useRef(1);
  const prev = useRef(active);
  if (prev.current !== active) {
    prev.current = active;
    const v = getExperience().velocity;
    dir.current = v < -0.02 ? -1 : 1;
  }
  return dir.current;
}

// ---- prefers-reduced-motion, hydration-safe: the server snapshot (false) is also used for the
// hydration render, so server and client markup match; the real value applies right after.
const RM_QUERY = '(prefers-reduced-motion: reduce)';
const subscribeRM = (cb: () => void): (() => void) => {
  const mq = window.matchMedia(RM_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeRM,
    () => window.matchMedia(RM_QUERY).matches,
    () => false,
  );
}
