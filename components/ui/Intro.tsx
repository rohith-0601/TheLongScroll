'use client';
/**
 * The opening screen (section[data-intro], progress 0): title, subtitle and the hint. Server-rendered
 * in its visible state (the full-screen Loader covers it until the scene is ready, then lifts to reveal
 * it); leaves and re-enters with the same scroll-linked fade + Motion lines as the chapters.
 */
import { useRef } from 'react';
import { motion } from 'motion/react';
import { SITE } from '@/data/chapters';
import { useExperience } from '@/lib/store';
import { lineVariants, usePrefersReducedMotion, useEntryDirection, useScrollFade, type LineCustom } from './motion';
import Hint from './Hint';

export default function Intro() {
  const ref = useRef<HTMLDivElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  useScrollFade(ref, 0);
  useScrollFade(footRef, 0);
  const active = useExperience((s) => s.restChapter === 0);
  const reduced = usePrefersReducedMotion();
  const dir = useEntryDirection(active);
  const state = active ? 'shown' : 'hidden';
  const c = (i: number, delay = 0): LineCustom => ({ i, dir, reduced, delay });
  const words = SITE.title.split(' ');

  return (
    <section data-intro className="intro" aria-labelledby="site-title">
      <div ref={ref} className="intro-inner fade-layer">
        <div className="scrim scrim-intro" aria-hidden="true" />
        <h1 id="site-title" className="intro-title">
          {words.map((w, i) => (
            <span key={w + i}>
              <motion.span
                className="m-line intro-word"
                custom={c(i, 0.25)}
                variants={lineVariants}
                initial={false}
                animate={state}
              >
                {i === 1 ? <em>{w}</em> : w}
              </motion.span>
              {i < words.length - 1 ? ' ' : null}
            </span>
          ))}
        </h1>
        <motion.p className="m-line intro-subtitle label" custom={c(words.length + 1, 0.3)} variants={lineVariants} initial={false} animate={state}>
          <span className="intro-rule" aria-hidden="true" />
          <span>{SITE.subtitle}</span>
          <span className="intro-rule" aria-hidden="true" />
        </motion.p>
      </div>
      <div ref={footRef} className="intro-foot fade-layer">
        <Hint />
      </div>
    </section>
  );
}
