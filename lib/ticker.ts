/**
 * One shared animation clock (the GSAP ticker, which also drives Lenis) for everything outside the
 * WebGL frame loop: scroll smoothing, input dynamics (hold easing, burst decay), the year counter,
 * and audio updates. The R3F scene renders in its own requestAnimationFrame and reads the store.
 */
import { gsap } from 'gsap';

export type TickCallback = (time: number, dt: number) => void;

/** Register a per-frame callback. `time` in seconds, `dt` in seconds (clamped to 0.1). Returns unsubscribe. */
export function onTick(cb: TickCallback): () => void {
  const fn = (time: number, deltaTimeMs: number): void => cb(time, Math.min(deltaTimeMs / 1000, 0.1));
  gsap.ticker.add(fn);
  return () => gsap.ticker.remove(fn);
}
