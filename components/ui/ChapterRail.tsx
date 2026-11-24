'use client';
/**
 * Chapter rail (right edge): a hairline progress line with one tick button per chapter. The fill
 * follows progress by direct transform writes; the active tick (nearest chapter) re-renders only when
 * the chapter changes. Click → getScroll().scrollToChapter(k), a smooth glide that lands exactly on
 * p = k. Arrow keys / Page Up / Page Down are handled globally in lib/scroll.ts.
 */
import { useEffect, useRef } from 'react';
import { CHAPTERS, CHAPTER_COUNT } from '@/data/chapters';
import { getExperience, useExperience } from '@/lib/store';
import { getScroll } from '@/lib/scroll';
import { PROGRESS_MAX } from '@/lib/timeline';

const pad2 = (n: number): string => String(n).padStart(2, '0');

export default function ChapterRail() {
  const active = useExperience((s) => s.chapter);
  const fillRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const fill = fillRef.current;
    if (!fill) return;
    let last = -1;
    const apply = (p: number): void => {
      const v = Math.round((p / PROGRESS_MAX) * 10000) / 10000;
      if (v === last) return;
      last = v;
      fill.style.transform = `scaleY(${v})`;
    };
    apply(getExperience().progress);
    return useExperience.subscribe((s) => s.progress, apply);
  }, []);

  const go = (k: number): void => {
    const sc = getScroll();
    if (sc) sc.scrollToChapter(k);
    else document.getElementById(CHAPTERS[k - 1]!.id)?.scrollIntoView();
  };

  return (
    <nav className="rail" aria-label="Chapters" data-no-hold data-frontier-fade data-hold-dim>
      <span className="rail-line" aria-hidden="true">
        <span ref={fillRef} className="rail-fill" />
      </span>
      <ol className="rail-list">
        {CHAPTERS.map((c) => {
          const on = active === c.number;
          return (
            <li key={c.id} className="rail-item" style={{ top: `${(c.number / CHAPTER_COUNT) * 100}%` }}>
              <button
                type="button"
                className="rail-tick"
                data-on={on}
                aria-current={on ? 'step' : undefined}
                aria-label={`Chapter ${pad2(c.number)}, ${c.dateLabel}: ${c.headline}`}
                onClick={() => go(c.number)}
              >
                <span className="rail-tip label" aria-hidden="true">
                  {c.dateLabel}
                </span>
                <span className="rail-num" aria-hidden="true">
                  {pad2(c.number)}
                </span>
                <span className="rail-dot" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
