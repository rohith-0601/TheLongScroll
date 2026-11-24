/**
 * Scroll controller: Lenis smooth scroll (inertia) + GSAP ScrollTrigger → ONE progress value 0..9.
 *
 * CONTRACT (implementation owner: "systems" agent). Browser-only; call initScroll() once from
 * components/system/ExperienceController.tsx.
 *
 * DOM contract (markup rendered by app/page.tsx, owned by the UI agent):
 *   <div data-scroll-track>                       tall track (immersive) / normal-flow wrapper (static)
 *     <div data-scroll-stage>                     sticky 100svh layer in immersive mode
 *       <section data-intro>…</section>           opening screen
 *       <article data-chapter="1..9" id={chapter.id}>…</article>  (9 of them, in order)
 *     </div>
 *   </div>
 *   <section data-frontier id="frontier">…</section>
 *
 * Modes (document.documentElement.dataset.mode):
 *  - 'immersive': CSS gives the track height 100svh + 9 · L · 100svh (L = --chapter-length, default
 *    tuning.scroll.chapterLength = 1.5) and pins the stage with position: sticky. Progress:
 *      p = 9 · clamp((scrollY − trackTop) / (trackHeight − innerHeight), 0, 1)
 *    so the stage releases exactly at p = 9 and the frontier scrolls in. Use a ScrollTrigger on the
 *    track (start 'top top', end 'bottom bottom') — measure the DOM, never assume CSS numbers.
 *  - 'static' (no WebGL): everything in normal flow. Progress interpolates between section centres:
 *    p = k + (viewportCentre − centre_k) / (centre_{k+1} − centre_k), with centre_0 = intro.
 *  - frontier = clamp((scrollY − frontierTop + innerHeight) / innerHeight, 0, 1).
 *
 * Writes to the store every tick: progress, velocity (smoothed, progress units/s), frontier, and the
 * discrete chapter / restChapter (only when they change). Uses lib/timeline.ts helpers.
 *
 * Smoothness: Lenis lerp from tuning.scroll (heavy, expensive inertia), driven by the shared GSAP
 * ticker (autoRaf: false; lenis.on('scroll', ScrollTrigger.update); gsap.ticker.lagSmoothing(0)).
 * prefers-reduced-motion: no Lenis smoothing (native scroll) and instant chapter jumps.
 *
 * Keyboard: ArrowDown / PageDown → next chapter, ArrowUp / PageUp → previous chapter, while
 * progress < 9 (or at the boundary into/out of the frontier). Not when focus is in a text input /
 * contenteditable, and not when modifier keys are held. preventDefault only when handled. Space,
 * Home and End keep native behaviour.
 *
 * Chapter rail / keyboard targets: chapterY(k) for k = 0 (top), 1..9 (chapter fully formed, p = k),
 * 10 (the frontier section). scrollToChapter glides with Lenis (duration scaled by distance,
 * ~1.2–2.4 s, easeInOutCubic-like) and lands exactly on the target.
 */
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { getExperience, setExperience, type ExperienceState } from './store';
import { tuning } from './tuning';
import { onTick } from './ticker';
import { PROGRESS_MAX, clamp, nearestChapter, restChapterAt } from './timeline';

export type ScrollMode = 'immersive' | 'static';

export interface ScrollController {
  readonly mode: ScrollMode;
  /** 0 = top (intro), 1..9 = chapter k fully formed, 10 = the frontier section. */
  scrollToChapter(k: number, opts?: { immediate?: boolean }): void;
  /** Document scroll position (px) for target k (see above). */
  chapterY(k: number): number;
  /** Re-measure layout (after fonts load / resize / mode change). */
  refresh(): void;
  destroy(): void;
}

export interface ScrollOptions {
  mode: ScrollMode;
  reducedMotion: boolean;
}

declare global {
  interface Window {
    /** The active Lenis instance (read by the headless test harness for --scroll-steps). */
    __lenis?: Lenis;
  }
}

let current: ScrollController | null = null;

/**
 * Scroll lock (while the loading screen covers the page). html.scroll-locked → overflow: hidden in
 * CSS (html has scrollbar-gutter: stable, so unlocking causes no layout jump); Lenis is stopped and
 * keyboard chapter steps are ignored. The class is also server-rendered on <html> so the page is
 * locked from the first paint; it only has an effect in immersive mode.
 */
let locked = false;
const lockListeners = new Set<(on: boolean) => void>();

export function setScrollLocked(on: boolean): void {
  if (typeof document !== 'undefined') document.documentElement.classList.toggle('scroll-locked', on);
  if (locked === on) return;
  locked = on;
  for (const l of lockListeners) l(on);
}

export function isScrollLocked(): boolean {
  return locked;
}

/** Target index of the frontier section. */
const FRONTIER_TARGET = PROGRESS_MAX + 1;

const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const isEditable = (el: Element | null): boolean => {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file', 'image'].includes(type);
  }
  return false;
};

/** Absolute document top of an element (layout read; only called from measure()). */
const docTop = (el: Element): number => el.getBoundingClientRect().top + window.scrollY;

export function initScroll(opts: ScrollOptions): ScrollController {
  current?.destroy();

  const { mode, reducedMotion } = opts;
  const root = document.documentElement;
  root.style.setProperty('--chapter-length', String(tuning.scroll.chapterLength));

  const track = document.querySelector<HTMLElement>('[data-scroll-track]');
  const intro = document.querySelector<HTMLElement>('[data-intro]');
  const articles = Array.from(document.querySelectorAll<HTMLElement>('article[data-chapter]'));
  const frontierEl = document.querySelector<HTMLElement>('[data-frontier]');

  gsap.registerPlugin(ScrollTrigger);
  gsap.ticker.lagSmoothing(0);

  // ---- Lenis (smooth wheel inertia). Reduced motion → native scroll, no Lenis at all.
  let lenis: Lenis | null = null;
  let offLenisScroll: (() => void) | null = null;
  if (!reducedMotion) {
    lenis = new Lenis({
      autoRaf: false,
      lerp: tuning.scroll.lerp,
      wheelMultiplier: tuning.scroll.wheelMultiplier,
      touchMultiplier: tuning.scroll.touchMultiplier,
      smoothWheel: true,
      anchors: false,
      stopInertiaOnNavigate: true,
    });
    offLenisScroll = lenis.on('scroll', ScrollTrigger.update);
    window.__lenis = lenis;
  }
  const applyLock = (on: boolean): void => {
    if (!lenis) return;
    if (on) lenis.stop();
    else lenis.start();
  };
  locked = document.documentElement.classList.contains('scroll-locked') && mode === 'immersive';
  applyLock(locked);
  lockListeners.add(applyLock);

  // ---- Measurements (layout reads happen only here, never per tick).
  let start = 0; // scroll position where p = 0
  let end = 1; // scroll position where p = 9 (immersive)
  let frontierTop = Number.POSITIVE_INFINITY;
  let centres: number[] = []; // static mode: section centres (document px), index 0 = intro
  let viewportH = window.innerHeight;

  let st: ScrollTrigger | null = null;
  if (mode === 'immersive' && track) {
    st = ScrollTrigger.create({ trigger: track, start: 'top top', end: 'bottom bottom' });
  }

  const measure = (): void => {
    viewportH = window.innerHeight;
    if (st) {
      start = st.start;
      end = Math.max(st.start + 1, st.end);
    } else if (track && mode === 'immersive') {
      start = docTop(track);
      end = Math.max(start + 1, start + track.offsetHeight - viewportH);
    }
    if (mode === 'static') {
      const sections = [intro, ...articles].filter((x): x is HTMLElement => !!x);
      centres = sections.map((el) => {
        const r = el.getBoundingClientRect();
        return r.top + window.scrollY + r.height / 2;
      });
    }
    frontierTop = frontierEl ? docTop(frontierEl) : Number.POSITIVE_INFINITY;
  };

  const maxScroll = (): number => Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

  const chapterY = (k: number): number => {
    const kk = clamp(Math.round(k), 0, FRONTIER_TARGET);
    if (kk === FRONTIER_TARGET) return Math.min(Math.round(frontierTop), maxScroll());
    if (mode === 'immersive') return Math.round(start + ((end - start) * kk) / PROGRESS_MAX);
    const c = centres[kk];
    if (c === undefined) return 0;
    return clamp(Math.round(c - viewportH / 2), 0, maxScroll());
  };

  const scrollY = (): number => (lenis ? lenis.scroll : window.scrollY);

  const progressAt = (y: number): number => {
    if (mode === 'immersive') {
      const span = end - start;
      let p = PROGRESS_MAX * clamp((y - start) / span, 0, 1);
      // Integer scroll positions: snap to the exact chapter when within one pixel of it.
      const k = Math.round(p);
      if (Math.abs(p - k) * (span / PROGRESS_MAX) < 0.75) p = k;
      return p;
    }
    if (centres.length < 2) return 0;
    const vc = y + viewportH / 2;
    if (vc <= centres[0]!) return 0;
    for (let k = 0; k < centres.length - 1; k++) {
      const a = centres[k]!;
      const b = centres[k + 1]!;
      if (vc <= b) {
        const p = k + (vc - a) / Math.max(1, b - a);
        const r = Math.round(p);
        return Math.abs(p - r) * Math.max(1, b - a) < 0.75 ? r : p;
      }
    }
    return PROGRESS_MAX;
  };

  // ---- Per-tick store writer.
  let lastP = Number.NaN;
  let lastF = Number.NaN;
  let velocity = 0;
  let lastChapter = -1;
  let lastRest: number | null | undefined;
  let glideTarget: number | null = null;

  const write = (dt: number): void => {
    const y = scrollY();
    const p = progressAt(y);
    const f = clamp((y - frontierTop + viewportH) / viewportH, 0, 1);

    if (dt > 0 && Number.isFinite(lastP)) {
      const raw = (p - lastP) / dt;
      velocity += (raw - velocity) * (1 - Math.exp(-dt * 10));
      if (Math.abs(velocity) < 1e-4 && raw === 0) velocity = 0;
    }

    const patch: Partial<ExperienceState> = {};
    let dirty = false;
    const s = getExperience();
    if (p !== lastP || p !== s.progress) {
      patch.progress = p;
      dirty = true;
    }
    if (velocity !== s.velocity) {
      patch.velocity = velocity;
      dirty = true;
    }
    if (f !== lastF || f !== s.frontier) {
      patch.frontier = f;
      dirty = true;
    }
    const chapter = nearestChapter(p);
    if (chapter !== lastChapter || chapter !== s.chapter) {
      patch.chapter = chapter;
      lastChapter = chapter;
      dirty = true;
    }
    const rest = restChapterAt(p);
    if (rest !== lastRest || rest !== s.restChapter) {
      patch.restChapter = rest;
      lastRest = rest;
      dirty = true;
    }
    lastP = p;
    lastF = f;
    if (dirty) setExperience(patch);
  };

  // Lenis first, then the store, all on the one shared ticker.
  const offTick = onTick((time, dt) => {
    if (lenis) lenis.raf(time * 1000);
    write(dt);
  });

  // ---- Re-measure on refresh / resize / fonts / layout changes.
  let refreshQueued = 0;
  const refresh = (): void => {
    if (st) ScrollTrigger.refresh();
    measure();
    lenis?.resize();
    write(0);
  };
  const queueRefresh = (): void => {
    if (refreshQueued) return;
    refreshQueued = requestAnimationFrame(() => {
      refreshQueued = 0;
      refresh();
    });
  };
  const onStRefresh = (): void => measure();
  ScrollTrigger.addEventListener('refresh', onStRefresh);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(queueRefresh) : null;
  ro?.observe(document.body);
  window.addEventListener('resize', queueRefresh, { passive: true });
  void document.fonts?.ready.then(() => {
    if (current === controller) queueRefresh();
  });
  measure();
  write(0);

  // ---- Chapter navigation.
  const scrollToChapter = (k: number, o?: { immediate?: boolean }): void => {
    const target = clamp(Math.round(k), 0, FRONTIER_TARGET);
    const y = chapterY(target);
    const immediate = !!o?.immediate || reducedMotion;
    if (lenis) {
      if (immediate) {
        glideTarget = null;
        lenis.scrollTo(y, { immediate: true, force: true });
      } else {
        const from = scrollY();
        const distChapters = Math.abs(y - from) / Math.max(1, (end - start) / PROGRESS_MAX);
        const duration = clamp(1.05 + 0.32 * distChapters, 1.2, 2.4);
        glideTarget = target;
        lenis.scrollTo(y, {
          duration,
          easing: easeInOutCubic,
          force: true,
          onComplete: () => {
            if (glideTarget === target) glideTarget = null;
          },
        });
      }
    } else {
      glideTarget = null;
      window.scrollTo({ top: y, behavior: 'instant' });
    }
    write(0);
  };

  /** Where keyboard navigation starts from: the pending glide target, or the current position. */
  const keyboardBase = (): { pos: number; inFrontier: boolean; atFrontierTop: boolean } => {
    if (glideTarget !== null && lenis?.isScrolling) {
      return { pos: glideTarget, inFrontier: false, atFrontierTop: glideTarget === FRONTIER_TARGET };
    }
    glideTarget = null;
    const y = scrollY();
    const fy = chapterY(FRONTIER_TARGET);
    const p9 = chapterY(PROGRESS_MAX);
    if (y > p9 + 2) {
      // Between p = 9 and deep inside the frontier.
      const atFrontierTop = y <= fy + 4;
      return { pos: atFrontierTop ? FRONTIER_TARGET : PROGRESS_MAX + 0.5, inFrontier: !atFrontierTop, atFrontierTop };
    }
    return { pos: progressAt(y), inFrontier: false, atFrontierTop: false };
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (locked || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const down = e.key === 'ArrowDown' || e.key === 'PageDown';
    const up = e.key === 'ArrowUp' || e.key === 'PageUp';
    if (!down && !up) return;
    if (isEditable(document.activeElement) || isEditable(e.target as Element | null)) return;

    const { pos, inFrontier, atFrontierTop } = keyboardBase();
    if (inFrontier) return; // reading the frontier grid: native scrolling
    let target: number;
    if (down) {
      if (atFrontierTop) return; // continue natively into the grid
      const near = Math.round(pos);
      target = Math.abs(pos - near) < 0.05 ? near + 1 : Math.ceil(pos);
      if (pos > PROGRESS_MAX) target = FRONTIER_TARGET;
    } else {
      const near = Math.round(pos);
      target = Math.abs(pos - near) < 0.05 ? near - 1 : Math.floor(pos);
      if (atFrontierTop) target = PROGRESS_MAX;
    }
    if (target < 0 || target > FRONTIER_TARGET) return;
    e.preventDefault();
    scrollToChapter(target);
  };
  window.addEventListener('keydown', onKeyDown);

  let destroyed = false;
  const controller: ScrollController = {
    mode,
    scrollToChapter,
    chapterY: (k) => chapterY(k),
    refresh,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      offTick();
      lockListeners.delete(applyLock);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', queueRefresh);
      ro?.disconnect();
      if (refreshQueued) cancelAnimationFrame(refreshQueued);
      ScrollTrigger.removeEventListener('refresh', onStRefresh);
      st?.kill();
      offLenisScroll?.();
      if (lenis) {
        lenis.destroy();
        if (window.__lenis === lenis) delete window.__lenis;
      }
      if (current === controller) current = null;
    },
  };
  current = controller;
  return controller;
}

/** The active controller (null before initScroll / after destroy). Used by the chapter rail. */
export function getScroll(): ScrollController | null {
  return current;
}

/** @internal for the implementation */
export function setCurrentScroll(c: ScrollController | null): void {
  current = c;
}
