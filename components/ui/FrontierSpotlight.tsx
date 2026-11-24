'use client';
/**
 * Pointer spotlight for the frontier cards: one delegated pointermove listener writes the pointer
 * position into the hovered card's --mx / --my (CSS draws a soft accent glow there). Mouse/pen only.
 */
import { useEffect } from 'react';

export default function FrontierSpotlight() {
  useEffect(() => {
    const grid = document.querySelector<HTMLElement>('[data-spotlight]');
    if (!grid) return;
    const onMove = (e: PointerEvent): void => {
      if (e.pointerType === 'touch') return;
      const card = (e.target as Element | null)?.closest<HTMLElement>('.card');
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${(e.clientX - r.left).toFixed(0)}px`);
      card.style.setProperty('--my', `${(e.clientY - r.top).toFixed(0)}px`);
    };
    grid.addEventListener('pointermove', onMove, { passive: true });
    return () => grid.removeEventListener('pointermove', onMove);
  }, []);
  return null;
}
