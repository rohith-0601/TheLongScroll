'use client';
/**
 * "Skip to the frontier": the first focusable element. Jumps straight to the frontier section (no
 * 13-viewport glide) and moves focus there.
 */
import type { MouseEvent } from 'react';
import { getScroll } from '@/lib/scroll';

export default function SkipLink() {
  const onClick = (e: MouseEvent<HTMLAnchorElement>): void => {
    const sc = getScroll();
    const target = document.getElementById('frontier');
    if (!sc || !target) return; // native anchor jump
    e.preventDefault();
    sc.scrollToChapter(10, { immediate: true });
    target.focus({ preventScroll: true });
  };
  return (
    <a href="#frontier" className="skip-link" onClick={onClick}>
      Skip to the frontier
    </a>
  );
}
