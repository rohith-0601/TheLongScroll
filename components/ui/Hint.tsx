'use client';
/**
 * The opening hint, revealed once the loading screen lifts. Both sentences are server-rendered; the
 * hold sentence is hidden by CSS outside immersive mode (no hold-to-collapse without the scene).
 */
import { SITE } from '@/data/chapters';
import { useExperience } from '@/lib/store';
import { useLoaderDone } from './loading-state';

const i = SITE.hint.indexOf('. ');
const SCROLL_PART = i < 0 ? SITE.hint : SITE.hint.slice(0, i + 1);
const HOLD_PART = i < 0 ? '' : SITE.hint.slice(i + 1);

export default function Hint() {
  const done = useLoaderDone();
  const isStatic = useExperience((s) => s.phase === 'static');
  return (
    <div className="hint" data-show={done || isStatic}>
      <p className="hint-text label">
        {SCROLL_PART}
        {HOLD_PART ? <span className="hint-hold">{HOLD_PART}</span> : null}
      </p>
      <span className="scroll-cue" aria-hidden="true" />
    </div>
  );
}
