'use client';
/** Glides back to the opening screen (instant under reduced motion — see lib/scroll.ts). */
import { getScroll } from '@/lib/scroll';

export default function BackToTop() {
  return (
    <button
      type="button"
      className="back-to-top label"
      onClick={() => {
        const sc = getScroll();
        if (sc) sc.scrollToChapter(0);
        else window.scrollTo({ top: 0 });
      }}
    >
      <span>Back to the beginning</span>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
        <path d="M8 13V3.5M4 7.5l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
