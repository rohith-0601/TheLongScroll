'use client';
/**
 * Full-screen loading screen. Server-rendered so it is the very first paint in immersive mode (CSS
 * hides it in static mode and without JS): the title and subtitle — laid out exactly like the opening
 * screen beneath, so the reveal is seamless — and a precise mono counter 0 → 100 % with a hairline
 * progress line, eased toward store.loadProgress on the shared ticker (monotonic; direct DOM writes).
 *
 * While it is up the page is scroll-locked (lib/scroll.ts setScrollLocked) and <main> is aria-busy.
 * When phase becomes 'ready' and the count reaches 100 it fades out (~1.1 s; plain fade under reduced
 * motion), unlocks scrolling and lets the hint appear. phase 'static' (no WebGL / init failure)
 * dismisses it at once; a 30 s failsafe dismisses it if loading stalls.
 */
import { useEffect, useRef } from 'react';
import { SITE } from '@/data/chapters';
import { getExperience, useExperience } from '@/lib/store';
import { onTick } from '@/lib/ticker';
import { setScrollLocked } from '@/lib/scroll';
import { setLoaderDone } from './loading-state';

const EXIT_MS = 1200;
const FAILSAFE_MS = 30000;

export default function Loader() {
  const rootRef = useRef<HTMLDivElement>(null);
  const numRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const main = document.querySelector('main');
    const timers: number[] = [];
    let offTick: (() => void) | null = null;
    let state: 'loading' | 'exiting' | 'done' = 'loading';

    const finish = (): void => {
      state = 'done';
      root.dataset.state = 'done';
      main?.removeAttribute('aria-busy');
      setScrollLocked(false);
      setLoaderDone();
    };

    const exit = (): void => {
      if (state !== 'loading') return;
      state = 'exiting';
      offTick?.();
      offTick = null;
      if (statusRef.current) statusRef.current.textContent = 'Ready';
      root.dataset.state = 'exiting';
      main?.removeAttribute('aria-busy');
      setScrollLocked(false);
      setLoaderDone();
      timers.push(window.setTimeout(finish, EXIT_MS));
    };

    // Static mode (or already static): never block.
    if (document.documentElement.dataset.mode !== 'immersive' || getExperience().phase === 'static') {
      finish();
      return;
    }

    // Locked from first paint (server-rendered class); start at the opening screen.
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);
    setScrollLocked(true);
    main?.setAttribute('aria-busy', 'true');

    let shown = 0;
    let lastPct = -1;
    offTick = onTick((_t, dt) => {
      const s = getExperience();
      if (s.phase === 'static') {
        finish();
        offTick?.();
        offTick = null;
        return;
      }
      const ready = s.phase === 'ready';
      const target = ready ? 1 : Math.min(0.999, s.loadProgress);
      // Tween toward the real progress, never backwards; finish briskly once ready.
      const rate = ready ? 6 : 3.2;
      shown = Math.max(shown, shown + (target - shown) * (1 - Math.exp(-dt * rate)));
      if (ready && 1 - shown < 0.003) shown = 1;
      const pct = Math.floor(shown * 100);
      if (pct !== lastPct) {
        lastPct = pct;
        if (numRef.current) numRef.current.textContent = String(pct).padStart(3, '0');
        meterRef.current?.setAttribute('aria-valuenow', String(pct));
      }
      if (barRef.current) barRef.current.style.transform = `scaleX(${shown.toFixed(4)})`;
      if (shown >= 1) {
        offTick?.();
        offTick = null;
        timers.push(window.setTimeout(exit, 240));
      }
    });

    const offPhase = useExperience.subscribe(
      (s) => s.phase,
      (phase) => {
        if (phase === 'static') finish();
      },
    );
    timers.push(window.setTimeout(exit, FAILSAFE_MS));

    return () => {
      offTick?.();
      offPhase();
      for (const t of timers) clearTimeout(t);
    };
  }, []);

  const words = SITE.title.split(' ');

  return (
    <div ref={rootRef} className="loading-screen" data-state="loading" data-no-hold>
      <div className="loading-stage">
        <div className="intro-inner">
          <p className="intro-title loading-title" aria-hidden="true">
            {words.map((w, i) => (
              <span key={w + i}>
                <span className="intro-word">{i === 1 ? <em>{w}</em> : w}</span>
                {i < words.length - 1 ? ' ' : null}
              </span>
            ))}
          </p>
          <p className="intro-subtitle label" aria-hidden="true">
            <span className="intro-rule" />
            <span>{SITE.subtitle}</span>
            <span className="intro-rule" />
          </p>
        </div>
        <div className="loading-meter-wrap">
          <div className="loading-row label">
            <span role="status" ref={statusRef}>
              Loading
            </span>
            <span className="loading-count" aria-hidden="true">
              <span ref={numRef} className="loading-num">
                000
              </span>
              <span className="loading-pct">%</span>
            </span>
          </div>
          <div
            ref={meterRef}
            className="loading-bar"
            role="progressbar"
            aria-label="Loading the universe"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={0}
          >
            <span ref={barRef} className="loading-fill" />
          </div>
        </div>
      </div>
      <span className="loading-seed" aria-hidden="true" />
    </div>
  );
}
