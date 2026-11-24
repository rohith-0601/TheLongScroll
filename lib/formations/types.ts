/**
 * Formation contract. Every chapter formation is a precomputed Float32Array of `count * 4`
 * floats: x, y, z, w per particle. Generators run in Web Workers (and in Node for previews),
 * so this module and everything a generator imports must stay DOM-free and dependency-free.
 *
 * Coordinate conventions (canonical, untransformed frame):
 *  - World units; +Y up; the formation faces +Z (default camera sits on +Z looking at the origin).
 *  - Centred on the origin. The visual mass should roughly fill a sphere of FORMATION_RADIUS.
 *  - |x|, |y|, |z| must stay ≤ FORMATION_BOUND (the 'canvas' grid may extend to CANVAS_EXTENT in x/z).
 *  - Any spin/tilt/wave is applied later on the GPU from data/chapters.ts → `scene`; generate the
 *    shape in its natural frame (e.g. galaxy disk in the XZ plane, helix / spin axis along +Y).
 *
 * The 4th component `w`:
 *  - w ∈ [0, 1]  brightness / palette mix: 1 = bright primary colour, 0 = dim secondary colour.
 *  - w ∈ [2, 3)  "pulse carrier": a particle on a path along which light pulses travel.
 *                phase = w − 2 ∈ [0, 1) is the normalised position along its path; the shader adds
 *                travelling pulses on top of a base brightness of PULSE_BASE_BRIGHTNESS.
 *
 * Ordering: particle order MUST be a uniform random permutation (iid sampling or a seeded shuffle),
 * so any prefix of the array is an unbiased subsample. Adaptive quality draws only the first M
 * particles, and the morph pairs particle i of one formation with particle i of the next.
 *
 * Determinism: use only `ctx.rng` (seeded) for randomness — never Math.random().
 */

export const STRIDE = 4;
export const FORMATION_COUNT = 9;
export const FORMATION_RADIUS = 3;
export const FORMATION_BOUND = 4.2;
export const CANVAS_EXTENT = 7;
export const PULSE_W_OFFSET = 2;
export const PULSE_BASE_BRIGHTNESS = 0.3;

export interface FormationContext {
  /** Number of particles to generate. */
  count: number;
  /** Output buffer, length count * 4 (x, y, z, w). Pre-zeroed. */
  out: Float32Array;
  /** Seeded uniform random in [0, 1). */
  rng: () => number;
  /** The seed `rng` was created from (for deriving secondary seeded generators). */
  seed: number;
  /** Optional progress callback, fraction 0..1. Cheap; call every ~5–10% at most. */
  report: (fraction: number) => void;
}

export type FormationGenerator = (ctx: FormationContext) => void;
