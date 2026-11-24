'use client';
/**
 * The year counter: a huge monospaced number pinned to a corner. Updated on every progress change
 * (i.e. every scroll tick) by direct DOM writes via yearDisplayAt(progress, nowYear) — never React
 * state. Exact in every rest window ("13,800,000,000 years ago" … "3200 BCE" … "1844" … "Now"), log-scale
 * roll between. Decorative for assistive tech: each chapter states its date in text.
 */
import { useEffect, useRef } from 'react';
import { getExperience, useExperience } from '@/lib/store';
import { yearDisplayAt } from '@/lib/timeline';

export default function YearCounter() {
  const rootRef = useRef<HTMLDivElement>(null);
  const numRef = useRef<HTMLSpanElement>(null);
  const sufRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const num = numRef.current;
    const suf = sufRef.current;
    if (!root || !num || !suf) return;
    const nowYear = new Date().getFullYear();
    let lastText = '';
    let lastSuffix = '\u0000';
    let lastMode = '';

    const render = (p: number): void => {
      const d = yearDisplayAt(p, nowYear);
      if (d.text !== lastText) {
        lastText = d.text;
        num.textContent = d.text;
      }
      if (d.suffix !== lastSuffix) {
        lastSuffix = d.suffix;
        suf.textContent = d.suffix;
      }
      if (d.mode !== lastMode) {
        lastMode = d.mode;
        root.dataset.yearMode = d.mode;
      }
    };
    const rest = (r: number | null): void => {
      root.dataset.rest = String(r !== null);
    };

    render(getExperience().progress);
    rest(getExperience().restChapter);
    const offP = useExperience.subscribe((s) => s.progress, render);
    const offR = useExperience.subscribe((s) => s.restChapter, rest);
    return () => {
      offP();
      offR();
    };
  }, []);

  return (
    <div ref={rootRef} className="year" aria-hidden="true" data-frontier-fade data-hold-dim data-year-mode="ago" data-rest="true">
      <span ref={numRef} className="year-num">
        13,800,000,000
      </span>
      <span ref={sufRef} className="year-suffix">
        years ago
      </span>
    </div>
  );
}
