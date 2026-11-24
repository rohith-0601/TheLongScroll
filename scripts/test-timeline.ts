/**
 * Accuracy tests for the timeline (year counter + morph mapping) and the Morse layout.
 * Run: node scripts/test-timeline.ts
 */
import assert from 'node:assert/strict';
import { layoutMorse, MORSE_PHRASE } from '../lib/morse.ts';
import {
  HOLD, PROGRESS_MAX, morphAt, restChapterAt, yearsAgoAt, yearDisplayAt, chapterYearText, chapterTextOpacity,
} from '../lib/timeline.ts';
import { CHAPTERS } from '../data/chapters.ts';
import { FRONTIER_SITES, displayDomain } from '../data/frontier.ts';

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; } catch (e) { console.error(`FAIL ${name}\n`, e); process.exitCode = 1; }
};

// ---------------------------------------------------------------- Morse
test('morse phrase code (International Morse)', () => {
  const m = layoutMorse(MORSE_PHRASE);
  assert.equal(m.code, '.-- .... .- - / .... .- - .... / --. --- -.. / .-- .-. --- ..- --. .... -');
  assert.equal(m.marks.length, 50);
  assert.equal(m.marks.filter((x) => x.kind === 'dash').length, 22);
  assert.equal(m.marks.filter((x) => x.kind === 'dot').length, 28);
  assert.equal(m.totalUnits, 189);
  // No overlaps and correct gaps
  for (let i = 1; i < m.marks.length; i++) {
    const a = m.marks[i - 1]!, b = m.marks[i]!;
    const gap = b.start - (a.start + a.units);
    const expected = a.wordIndex !== b.wordIndex ? 7 : a.letterIndex !== b.letterIndex ? 3 : 1;
    assert.equal(gap, expected, `gap before mark ${i}`);
  }
});

// ---------------------------------------------------------------- Year counter
const NOW = 2026;
const expected = [
  '13,800,000,000 years ago', '13,500,000,000 years ago', '4,540,000,000 years ago', '3,700,000,000 years ago',
  '3200 BCE', '1844', '1969', '1991', 'Now',
];
test('counter shows the exact date for every chapter (p = k)', () => {
  for (let k = 1; k <= 9; k++) assert.equal(chapterYearText(k, NOW), expected[k - 1], `chapter ${k}`);
});
test('counter is exact throughout each rest window', () => {
  for (let k = 1; k <= 9; k++) {
    for (const off of [-HOLD * 0.999, -HOLD / 2, 0, HOLD / 2, HOLD * 0.999]) {
      const p = k + off;
      if (p > PROGRESS_MAX) continue;
      const d = yearDisplayAt(p, NOW);
      const text = d.suffix ? `${d.text} ${d.suffix}` : d.text;
      if (k === 8 && off < 0) {
        const y = Number(d.text);
        assert.ok(d.mode === 'ce' && y >= 1969 && y <= 1991, `chapter 8 range at ${p}: ${text}`);
      } else {
        assert.equal(text, expected[k - 1], `chapter ${k} at p=${p}`);
      }
    }
  }
  assert.equal(yearDisplayAt(8 - HOLD, NOW).text, '1969');
});
test('intro shows the beginning', () => {
  assert.equal(chapterYearText(0, NOW), '13,800,000,000 years ago');
});
test('years-ago is monotonically non-increasing across the whole scroll', () => {
  let prev = Infinity;
  for (let i = 0; i <= 20000; i++) {
    const p = (i / 20000) * PROGRESS_MAX;
    const y = yearsAgoAt(p, NOW);
    assert.ok(Number.isFinite(y) && y >= 0, `finite at ${p}`);
    assert.ok(y <= prev + 1e-6 * Math.max(1, prev), `monotonic at p=${p}: ${y} > ${prev}`);
    prev = y;
  }
});
test('display modes progress ago → bce → ce → now', () => {
  const order = { ago: 0, bce: 1, ce: 2, now: 3 } as const;
  let prev = 0;
  for (let i = 0; i <= 20000; i++) {
    const d = yearDisplayAt((i / 20000) * PROGRESS_MAX, NOW);
    assert.ok(order[d.mode] >= prev, `mode regressed at ${i}`);
    prev = order[d.mode];
  }
});
test('works for other "now" years', () => {
  for (const y of [2025, 2030, 2100]) {
    assert.equal(chapterYearText(5, y), '3200 BCE');
    assert.equal(chapterYearText(6, y), '1844');
    assert.equal(chapterYearText(9, y), 'Now');
  }
});

// ---------------------------------------------------------------- Morph mapping
test('morph mapping: rest at integer progress, continuous across boundaries', () => {
  assert.deepEqual(morphAt(0), { from: 0, to: 1, t: 0 });
  assert.deepEqual(morphAt(9), { from: 8, to: 9, t: 1 });
  for (let k = 1; k <= 8; k++) {
    const a = morphAt(k - 1e-9), b = morphAt(k);
    const fa = a.t >= 1 ? a.to : a.from, fb = b.t <= 0 ? b.from : b.to;
    assert.equal(fa, k); assert.equal(fb, k);
    assert.equal(restChapterAt(k), k);
    assert.equal(restChapterAt(k + 0.5), null);
  }
});
test('text opacity: visible at rest, hidden mid-transition', () => {
  for (let k = 1; k <= 9; k++) {
    assert.equal(chapterTextOpacity(k, k), 1);
    if (k < 9) assert.equal(chapterTextOpacity(k, k + 0.5), 0);
  }
});

// ---------------------------------------------------------------- Content
test('9 chapters with all fields', () => {
  assert.equal(CHAPTERS.length, 9);
  CHAPTERS.forEach((c, i) => {
    assert.equal(c.number, i + 1);
    assert.ok(c.headline && c.copy && c.dateLabel && c.visualDescription);
  });
});
test('22 frontier links, all https and unique', () => {
  assert.equal(FRONTIER_SITES.length, 22);
  const urls = new Set(FRONTIER_SITES.map((s) => s.url));
  assert.equal(urls.size, 22);
  for (const s of FRONTIER_SITES) { assert.ok(s.url.startsWith('https://')); assert.ok(displayDomain(s.url).length > 3); }
});

console.log(`${passed} test groups passed${process.exitCode ? ' (with failures above)' : ''}`);
