'use client';
/**
 * One chapter's text block: <article data-chapter id> (DOM contract in lib/scroll.ts).
 *
 * Visibility is two layers:
 *  - scroll-linked: the wrapper's opacity follows chapterTextOpacity(k, progress) (direct DOM writes),
 *    so text is fully gone mid-transition however fast you scroll;
 *  - time-based: when the chapter enters its rest window (store.restChapter === k) the lines enter
 *    with Motion (staggered rise, blur → sharp), and leave the same way as the next transition starts.
 *
 * All copy is server-rendered. Inactive chapters stay in the accessibility tree (each is announced
 * once, in order, like a document), but are transparent, non-interactive and not selectable.
 */
import { useRef, type CSSProperties } from 'react';
import { motion } from 'motion/react';
import { CHAPTERS, CHAPTER_COUNT } from '@/data/chapters';
import { useExperience } from '@/lib/store';
import { lineVariants, usePrefersReducedMotion, useEntryDirection, useScrollFade, type LineCustom } from './motion';
import { splitLastWord } from './split';

const pad2 = (n: number): string => String(n).padStart(2, '0');

export default function ChapterText({ index }: { index: number }) {
  const chapter = CHAPTERS[index]!;
  const k = chapter.number;
  const ref = useRef<HTMLDivElement>(null);
  useScrollFade(ref, k);

  const active = useExperience((s) => s.restChapter === k);
  const reduced = usePrefersReducedMotion();
  const dir = useEntryDirection(active);
  const state = active ? 'shown' : 'hidden';
  const c = (i: number): LineCustom => ({ i, dir, reduced });
  const [head, last] = splitLastWord(chapter.headline);
  const headingId = `${chapter.id}-title`;

  const style = {
    '--c1': chapter.palette.primary,
    '--c2': chapter.palette.secondary,
  } as CSSProperties;

  return (
    <article id={chapter.id} data-chapter={k} className="chapter" aria-labelledby={headingId} style={style}>
      <div ref={ref} className="chapter-inner fade-layer" style={{ opacity: 0 }}>
        <div className="scrim" aria-hidden="true" />
        <motion.p className="m-line chapter-label label" custom={c(0)} variants={lineVariants} initial={false} animate={state}>
          <span className="chapter-num" aria-hidden="true">
            {pad2(k)}
            <span className="chapter-of"> / {pad2(CHAPTER_COUNT)}</span>
          </span>
          <span className="chapter-rule" aria-hidden="true" />
          <span className="sr-only">Chapter {k}: </span>
          <span>{chapter.dateLabel}</span>
        </motion.p>
        <motion.h2 id={headingId} className="m-line headline" custom={c(1)} variants={lineVariants} initial={false} animate={state}>
          {head}
          <em>{last}</em>
        </motion.h2>
        <motion.p className="m-line copy" custom={c(2)} variants={lineVariants} initial={false} animate={state}>
          {chapter.copy}
        </motion.p>
        <p className="sr-only">{chapter.visualDescription}</p>
      </div>
    </article>
  );
}
