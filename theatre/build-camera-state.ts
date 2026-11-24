/**
 * Bakes theatre/path.ts (the shot list) into a Theatre.js 0.7.2 on-disk project state (theatre/camera.json),
 * byte-for-byte reproducible:   node theatre/build-camera-state.ts
 *
 * Format (= what Studio's "Export … to JSON" writes; see .resume/research/theatre.md):
 *   { sheetsById: { Camera: { staticOverrides: { byObject: {} },
 *       sequence: { type: 'PositionalSequence', length: 9, subUnitsPerUnit: 50,
 *         tracksByObject: { Rig: { trackIdByPropPath: { '["position","x"]': trackId, … },
 *                                  trackData: { [trackId]: { type: 'BasicKeyframedTrack', keyframes } } } } } } },
 *     definitionVersion: '0.4.0', revisionHistory: [revisionId] }
 *   keyframe = { id, position, value, handles: [inX, inY, outX, outY], connectedRight: true, type: 'bezier' }
 *   Segment a → b eases with cubic-bezier(a.handles[2], a.handles[3], b.handles[0], b.handles[1]) mapping
 *   local time → value fraction, per prop.
 *
 * Handles: each key gets a tangent (the rest-window drift velocity), converted to Bézier handles per segment
 * so the curve is C¹ through the rest window (a steady drift) and transitions ease out of / into that drift
 * (handle x = TRANSITION_EASE; y clamped to [0, 1] so a transition never overshoots or backs up).
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pathKeys, REST_HALF_WIDTH, SEQUENCE_LENGTH, type Pose } from './path.ts';

export const PROJECT_ID = 'The Long Scroll';
export const SHEET_ID = 'Camera';
export const OBJECT_KEY = 'Rig';
/** Snapping grid used by Studio (0.22 = 11/50, so every key sits on the grid). */
const SUB_UNITS = 50;
/** Handle length (fraction of the segment) of the transition ease-in-out. */
const TRANSITION_EASE = 0.46;
const DRIFT_HANDLE = 1 / 3;

type PropPath = readonly [string] | readonly [string, string];
const PROP_PATHS: readonly PropPath[] = [
  ['position', 'x'], ['position', 'y'], ['position', 'z'],
  ['target', 'x'], ['target', 'y'], ['target', 'z'],
  ['fov'], ['roll'], ['frame'],
];

function read(pose: Pose, path: PropPath): number {
  if (path.length === 1) return pose[path[0] as 'fov' | 'roll' | 'frame'];
  const v = pose[path[0] as 'position' | 'target'];
  return v[path[1] as 'x' | 'y' | 'z'];
}

const round = (v: number, d = 5): number => {
  const r = Math.round(v * 10 ** d) / 10 ** d;
  return Object.is(r, -0) ? 0 : r;
};
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Chapter whose rest window contains p (keys are always inside one). */
const windowOf = (p: number): number => Math.round(p);

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, '0');
}

export function buildState(): Record<string, unknown> {
  const keys = pathKeys();
  const tracksByPath: Record<string, string> = {};
  const trackData: Record<string, unknown> = {};

  PROP_PATHS.forEach((path, ti) => {
    const pos = keys.map((k) => k.position);
    const val = keys.map((k) => read(k.pose, path));

    // Tangent at each key = average velocity across its chapter's rest window.
    const tangent = keys.map((k) => {
      const c = windowOf(k.position);
      const lo = Math.max(0, c - REST_HALF_WIDTH);
      const hi = Math.min(SEQUENCE_LENGTH, c + REST_HALF_WIDTH);
      const i0 = pos.findIndex((p) => Math.abs(p - lo) < 1e-9);
      const i1 = pos.findIndex((p) => Math.abs(p - hi) < 1e-9);
      return (val[i1]! - val[i0]!) / (hi - lo);
    });

    const handles = keys.map(() => [0.5, 1, 0.5, 0] as [number, number, number, number]);
    for (let i = 0; i < keys.length - 1; i++) {
      const dp = pos[i + 1]! - pos[i]!;
      const dv = val[i + 1]! - val[i]!;
      const rest = windowOf(pos[i]!) === windowOf(pos[i + 1]!);
      const hx = rest ? DRIFT_HANDLE : TRANSITION_EASE;
      let outY = hx;
      let inY = 1 - hx;
      if (Math.abs(dv) > 1e-6) {
        outY = clamp01((hx * tangent[i]! * dp) / dv);
        inY = clamp01(1 - (hx * tangent[i + 1]! * dp) / dv);
      }
      handles[i]![2] = round(hx, 4);
      handles[i]![3] = round(outY, 4);
      handles[i + 1]![0] = round(1 - hx, 4);
      handles[i + 1]![1] = round(inY, 4);
    }

    const name = path.join('.');
    const trackId = `cam-${name.replace('.', '-')}`;
    tracksByPath[JSON.stringify(path)] = trackId;
    trackData[trackId] = {
      type: 'BasicKeyframedTrack',
      __debugName: `${OBJECT_KEY}:${JSON.stringify(path)}`,
      keyframes: keys.map((k, i) => ({
        id: `k${ti}-${String(Math.round(k.position * SUB_UNITS)).padStart(3, '0')}`,
        position: round(k.position, 4),
        connectedRight: true,
        handles: handles[i],
        type: 'bezier',
        value: round(val[i]!),
      })),
    };
  });

  const sheetsById = {
    [SHEET_ID]: {
      staticOverrides: { byObject: {} },
      sequence: {
        type: 'PositionalSequence',
        length: SEQUENCE_LENGTH,
        subUnitsPerUnit: SUB_UNITS,
        tracksByObject: { [OBJECT_KEY]: { trackIdByPropPath: tracksByPath, trackData } },
      },
    },
  };
  return {
    sheetsById,
    definitionVersion: '0.4.0',
    revisionHistory: [`baked-${fnv1a(JSON.stringify(sheetsById))}`],
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = fileURLToPath(new URL('./camera.json', import.meta.url));
  writeFileSync(out, JSON.stringify(buildState(), null, 2) + '\n');
  console.log(`wrote ${out}`);
}
