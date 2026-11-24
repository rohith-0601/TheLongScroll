/**
 * The camera path, authored as a cinematographer's shot list (source of truth for the baked Theatre
 * state in ./camera.json and for the coded fallback path in lib/camera.ts).
 *
 * Every chapter k (0 = opening singularity, 1..9 = chapters) is one shot: an orbit around `target`
 * (azimuth 0° = on +Z looking at the formation, positive = camera swings toward +X; elevation positive =
 * above), a distance, a vertical fov (degrees, authored for a 1440×900 landscape frame) and a subtle
 * roll (degrees). During the chapter's rest window [k − 0.22, k + 0.22] the camera drifts slowly by
 * `drift` (spread evenly across the window, centred on the shot), so a formation at rest still breathes.
 *
 * `frame` is the half-width (world units) of the subject as seen from the camera. lib/camera.ts uses it
 * to pull back (dolly + a little fov) on narrow viewports so the subject is never cropped sideways.
 *
 * Regenerate the Theatre state after editing:  node theatre/build-camera-state.ts
 */

export type Vec3 = readonly [number, number, number];

export interface Shot {
  /** Formation centre the camera orbits / looks at (world units). */
  target: Vec3;
  /** Degrees; 0 = +Z, positive toward +X. */
  azimuth: number;
  /** Degrees above the target's horizontal plane. */
  elevation: number;
  /** Distance camera → target (world units). */
  distance: number;
  /** Vertical field of view (degrees) at the 16:10 reference frame. */
  fov: number;
  /** Camera roll (degrees, positive = counter-clockwise on screen). */
  roll: number;
  /** Half-width of the subject that must stay inside the frame (world units). */
  frame: number;
  /** Total change across the rest window (pre → post). */
  drift: { azimuth?: number; elevation?: number; distance?: number; roll?: number };
  /** For humans: what the shot is. */
  note: string;
}

/** Plain camera pose (what a Theatre keyframe holds). */
export interface Pose {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  fov: number;
  roll: number;
  frame: number;
}

/** Half-width of each rest window in progress units (= lib/timeline.ts HOLD). */
export const REST_HALF_WIDTH = 0.22;
export const SEQUENCE_LENGTH = 9;

/** Shots for p = 0 (opening) … 9. */
export const SHOTS: readonly Shot[] = [
  {
    note: 'Opening — close on the singularity, dead centre, almost no angle. A slow push-in.',
    target: [0, 0, 0], azimuth: 0, elevation: 2.5, distance: 6.2, fov: 34, roll: 0, frame: 2.2,
    drift: { distance: -0.35 },
  },
  {
    note: 'Big Bang — pulled far back as the explosion fills space; slightly off-axis, a hair of roll.',
    target: [0, 0, 0], azimuth: -11, elevation: 6, distance: 14.6, fov: 37, roll: -1.2, frame: 3.6,
    drift: { azimuth: 3, distance: -0.6 },
  },
  {
    note: 'First galaxies — raised three-quarter view of the tilted disk (≈ 50° off face-on).',
    target: [0, 0, 0], azimuth: -8, elevation: 15, distance: 12.8, fov: 36, roll: 1.2, frame: 3.4,
    drift: { azimuth: 4, elevation: -1 },
  },
  {
    note: 'Earth — swung right of the globe, a touch above the equator; the limb wraps into shadow.',
    target: [0, 0, 0], azimuth: 22, elevation: 9, distance: 12.6, fov: 34, roll: 0, frame: 2.7,
    drift: { azimuth: -3.5, distance: -0.3 },
  },
  {
    note: 'Life — low, looking up at the diagonal helix (heroic), a little roll with its lean.',
    target: [0, 0.1, 0], azimuth: 14, elevation: -7, distance: 13.6, fov: 36, roll: 1.5, frame: 3.3,
    drift: { azimuth: -3, elevation: 1.5 },
  },
  {
    note: 'Writing — from the left, ≈ 35° off the inscribed face so the slab shows its depth; slow push-in.',
    target: [0, 0.05, 0], azimuth: -5, elevation: 6, distance: 11.0, fov: 36, roll: -0.8, frame: 2.2,
    drift: { azimuth: 2.5, distance: -0.45 },
  },
  {
    note: 'Telegraph — from the right so the tape runs left → right toward the lens; wide and level.',
    target: [0, 0, 0], azimuth: 21, elevation: 5, distance: 14.2, fov: 36, roll: 0, frame: 3.7,
    drift: { azimuth: -3.5, elevation: -0.5 },
  },
  {
    note: 'Moon — a lower angle, looking up at it as from the ground; still and reverent.',
    target: [0, 0.1, 0], azimuth: -5, elevation: -8, distance: 12.9, fov: 33, roll: -1.2, frame: 2.6,
    drift: { azimuth: 3, distance: -0.3 },
  },
  {
    note: 'Internet — higher orbit, swung around the globe; arcs read against the black.',
    target: [0, 0, 0], azimuth: 23, elevation: 14, distance: 13.4, fov: 35, roll: 1, frame: 3.0,
    drift: { azimuth: -4 },
  },
  {
    note: 'Now — low grazing angle over the waving grid; the plane runs off to a soft horizon.',
    target: [0, -0.3, -0.8], azimuth: 9, elevation: 15, distance: 12.4, fov: 42, roll: -1.2, frame: 3.0,
    drift: { azimuth: -3, elevation: 0.8 },
  },
];

const DEG = Math.PI / 180;

/** Pose of shot k at a fraction u ∈ [−0.5, 0.5] through its rest-window drift (0 = the shot itself). */
export function shotPose(shot: Shot, u: number): Pose {
  const az = (shot.azimuth + (shot.drift.azimuth ?? 0) * u) * DEG;
  const el = (shot.elevation + (shot.drift.elevation ?? 0) * u) * DEG;
  const d = shot.distance + (shot.drift.distance ?? 0) * u;
  const [tx, ty, tz] = shot.target;
  return {
    position: {
      x: tx + d * Math.cos(el) * Math.sin(az),
      y: ty + d * Math.sin(el),
      z: tz + d * Math.cos(el) * Math.cos(az),
    },
    target: { x: tx, y: ty, z: tz },
    fov: shot.fov,
    roll: shot.roll + (shot.drift.roll ?? 0) * u,
    frame: shot.frame,
  };
}

export interface PathKey {
  position: number;
  pose: Pose;
}

/** Keyframe positions/poses: k − 0.22 (except k = 0), k, k + 0.22 (except k = 9). */
export function pathKeys(): PathKey[] {
  const keys: PathKey[] = [];
  SHOTS.forEach((shot, k) => {
    if (k > 0) keys.push({ position: k - REST_HALF_WIDTH, pose: shotPose(shot, -0.5) });
    keys.push({ position: k, pose: shotPose(shot, 0) });
    if (k < SHOTS.length - 1) keys.push({ position: k + REST_HALF_WIDTH, pose: shotPose(shot, 0.5) });
  });
  return keys;
}
