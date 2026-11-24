/**
 * Formation registry: generator per chapter, fixed seeds, and a synchronous runner used by the
 * Web Worker (formation.worker.ts) and by scripts/preview-formations.ts.
 */
import { CHAPTERS, type FormationName } from '../../data/chapters.ts';
import type { FormationGenerator } from './types.ts';
import { STRIDE } from './types.ts';
import { createRng } from './utils.ts';
import { generateBigBang } from './bigBang.ts';
import { generateGalaxy } from './galaxy.ts';
import { generateEarth } from './earth.ts';
import { generateDna } from './dna.ts';
import { generateTablet } from './tablet.ts';
import { generateMorse } from './morse.ts';
import { generateMoon } from './moon.ts';
import { generateNetwork } from './network.ts';
import { generateCanvas } from './canvas.ts';

export const GENERATORS: Readonly<Record<FormationName, FormationGenerator>> = {
  bigBang: generateBigBang,
  galaxy: generateGalaxy,
  earth: generateEarth,
  dna: generateDna,
  tablet: generateTablet,
  morse: generateMorse,
  moon: generateMoon,
  network: generateNetwork,
  canvas: generateCanvas,
};

/** Formation names in chapter order (index 0 → chapter 1). */
export const FORMATION_ORDER: readonly FormationName[] = CHAPTERS.map((c) => c.formation);

/** Fixed per-formation seeds → identical output in every worker, every visit. */
export const FORMATION_SEEDS: Readonly<Record<FormationName, number>> = {
  bigBang: 0x13800001,
  galaxy: 0x13500002,
  earth: 0x04540003,
  dna: 0x03700004,
  tablet: 0x32000005,
  morse: 0x18440006,
  moon: 0x19690007,
  network: 0x19910008,
  canvas: 0x20260009,
};

/** Run one generator synchronously. */
export function runFormation(name: FormationName, count: number, report: (f: number) => void = () => {}): Float32Array {
  const out = new Float32Array(count * STRIDE);
  const seed = FORMATION_SEEDS[name];
  GENERATORS[name]({ count, out, rng: createRng(seed), seed, report });
  return out;
}
