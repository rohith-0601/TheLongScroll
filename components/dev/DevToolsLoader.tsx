'use client';

import dynamic from 'next/dynamic';

/**
 * `process.env.NODE_ENV` is inlined at build time: in production this is `null` and the bundler never follows
 * the import() (no chunk is emitted for leva / stats-gl). Verified pattern (research/next-r3f.md §2.11, §7).
 */
const DevTools =
  process.env.NODE_ENV === 'development' ? dynamic(() => import('./DevTools'), { ssr: false, loading: () => null }) : null;

export default function DevToolsLoader() {
  return DevTools ? <DevTools /> : null;
}
