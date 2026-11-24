/**
 * Morse code layout for chapter 6.
 *
 * Uses International Morse code (ITU-R M.1677-1), the standard most readers will decode with.
 * Standard timing: dot = 1 unit, dash = 3 units, gap inside a letter = 1 unit,
 * gap between letters = 3 units, gap between words = 7 units.
 *
 * Historical note: Morse's 1844 line used the original American ("railroad") Morse code,
 * which differs from International Morse in two letters of this phrase: O (· ·) and R (· ··).
 * Every other letter of "WHAT HATH GOD WROUGHT" is identical in both codes.
 */

export const INTERNATIONAL_MORSE: Readonly<Record<string, string>> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---',
  K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-',
  U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-',
  '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
};

export const MORSE_PHRASE = 'WHAT HATH GOD WROUGHT';

export const MORSE_UNITS = { dot: 1, dash: 3, intraLetterGap: 1, letterGap: 3, wordGap: 7 } as const;

export interface MorseMark {
  kind: 'dot' | 'dash';
  /** Start position along the message, in units. */
  start: number;
  /** Length in units (1 for a dot, 3 for a dash). */
  units: number;
  letter: string;
  /** Index of the letter within the whole phrase (spaces excluded). */
  letterIndex: number;
  wordIndex: number;
}

export interface MorseLayout {
  phrase: string;
  marks: MorseMark[];
  /** Total length of the message in units (no trailing gap). */
  totalUnits: number;
  /** Human-readable code, letters separated by spaces and words by " / ". */
  code: string;
}

export function layoutMorse(phrase: string = MORSE_PHRASE): MorseLayout {
  const words = phrase.trim().toUpperCase().split(/\s+/);
  const marks: MorseMark[] = [];
  const codeWords: string[] = [];
  let cursor = 0;
  let letterIndex = 0;
  words.forEach((word, wordIndex) => {
    if (wordIndex > 0) cursor += MORSE_UNITS.wordGap;
    const codeLetters: string[] = [];
    [...word].forEach((letter, li) => {
      const code = INTERNATIONAL_MORSE[letter];
      if (!code) throw new Error(`No Morse code for "${letter}"`);
      if (li > 0) cursor += MORSE_UNITS.letterGap;
      [...code].forEach((sym, si) => {
        if (si > 0) cursor += MORSE_UNITS.intraLetterGap;
        const kind = sym === '.' ? 'dot' : 'dash';
        const units = kind === 'dot' ? MORSE_UNITS.dot : MORSE_UNITS.dash;
        marks.push({ kind, start: cursor, units, letter, letterIndex, wordIndex });
        cursor += units;
      });
      codeLetters.push(code);
      letterIndex++;
    });
    codeWords.push(codeLetters.join(' '));
  });
  return { phrase: words.join(' '), marks, totalUnits: cursor, code: codeWords.join(' / ') };
}

/** Pretty code with typographic dots/dashes for display or screen readers: "·−− ···· ·− −  / …". */
export function prettyMorse(code: string): string {
  return code.replace(/\./g, '·').replace(/-/g, '−');
}
