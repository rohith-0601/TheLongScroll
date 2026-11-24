/**
 * Cinematic camera rig: a Theatre.js 0.7.2 sequence (baked in theatre/camera.json) driven by scroll.
 *
 * CONTRACT:
 *  - createCameraRig() loads the Theatre.js project from theatre/camera.json (baked state; @theatre/core
 *    only, no @theatre/r3f) and returns a rig. Sequence position = scroll progress (0..9).
 *  - update(camera, f) sets camera position / look-at / fov / roll from the Theatre pose at f.progress,
 *    adds idle orbital drift (tuning.camera.drift/driftSpeed) and mouse parallax (tuning.camera.parallax),
 *    smoothed with tuning.camera.smoothing, and applies a lens shift via camera.setViewOffset so the
 *    formation sits away from the chapter text: landscape → shifted right by lensShiftX · width,
 *    portrait → shifted up by lensShiftY · height. Drift/parallax are 0 under reduced motion. The lens shift
 *    fades to 0 as f.frontier → 1 (frontier section) and at p < ~0.5 (opening screen: centred).
 *    Updates camera.aspect / projection matrix itself.
 *  - focusDistance(): distance from the camera to the formation centre (world origin) — used by the
 *    particle depth of field.
 *
 * IMPLEMENTATION NOTES
 *  - Theatre project "The Long Scroll" → sheet "Camera" → object "Rig" with props
 *    position{x,y,z}, target{x,y,z}, fov (vertical, degrees, authored for a 16:10 frame), roll (degrees)
 *    and frame (half-width in world units of the subject; narrow viewports dolly back / widen the fov
 *    until it fits). The shot list lives in theatre/path.ts; `node theatre/build-camera-state.ts` bakes it.
 *  - Never throws: a malformed / missing state, a failed import or non-finite values fall back to the coded
 *    path from theatre/path.ts (same shots, smoothstep transitions). `rig.source` says which is live.
 *  - Allocation-free per frame on our side; Theatre itself is only queried when the progress changed (or
 *    Studio edited a value), and then allocates its small value object.
 *  - Client-only: @theatre/core and the JSON are dynamic imports (code-split out of the SSR bundle).
 */
import type { PerspectiveCamera } from 'three';
import { tuning } from './tuning';
import { pathKeys, SEQUENCE_LENGTH, type PathKey, type Pose } from '../theatre/path.ts';

export interface CameraFrame {
  progress: number;
  /** Seconds since start. */
  time: number;
  /** Seconds since last frame (clamped). */
  dt: number;
  /** Smoothed pointer in NDC (-1..1, y up); {0,0} when inactive. */
  pointer: { x: number; y: number };
  /** 0..1 frontier scroll-in (see store.frontier). */
  frontier: number;
  reducedMotion: boolean;
  /** CSS pixels of the canvas. */
  width: number;
  height: number;
}

export interface CameraRig {
  update(camera: PerspectiveCamera, f: CameraFrame): void;
  focusDistance(): number;
  dispose(): void;
  /** Where poses come from: the Theatre sequence, or the coded fallback path. */
  readonly source: 'theatre' | 'fallback';
}

export const THEATRE_PROJECT_ID = 'The Long Scroll';
export const THEATRE_SHEET_ID = 'Camera';
export const THEATRE_OBJECT_KEY = 'Rig';

const DEG = Math.PI / 180;
const PROP_PATHS = [
  '["position","x"]', '["position","y"]', '["position","z"]',
  '["target","x"]', '["target","y"]', '["target","z"]',
  '["fov"]', '["roll"]', '["frame"]',
] as const;

// ------------------------------------------------------------------------------------------- helpers

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function newPose(): Pose {
  return { position: { x: 0, y: 0.4, z: 9 }, target: { x: 0, y: 0, z: 0 }, fov: 40, roll: 0, frame: 3 };
}

function copyPose(out: Pose, src: Pose): void {
  out.position.x = src.position.x; out.position.y = src.position.y; out.position.z = src.position.z;
  out.target.x = src.target.x; out.target.y = src.target.y; out.target.z = src.target.z;
  out.fov = src.fov; out.roll = src.roll; out.frame = src.frame;
}

function poseIsFinite(p: Pose): boolean {
  return Number.isFinite(
    p.position.x + p.position.y + p.position.z + p.target.x + p.target.y + p.target.z + p.fov + p.roll + p.frame,
  );
}

/**
 * Structural check of a Theatre on-disk state before handing it to getProject (which only checks
 * definitionVersion and silently produces garbage for unsorted keyframes or non-numeric values).
 * Returns null when usable, else the reason.
 */
export function validateCameraState(s: unknown): string | null {
  if (!isObj(s)) return 'state is not an object';
  if (s.definitionVersion !== '0.4.0') return `definitionVersion ${String(s.definitionVersion)} ≠ 0.4.0`;
  if (!Array.isArray(s.revisionHistory)) return 'revisionHistory missing';
  if (!isObj(s.sheetsById)) return 'sheetsById missing';
  const sheet = s.sheetsById[THEATRE_SHEET_ID];
  if (!isObj(sheet)) return `sheet "${THEATRE_SHEET_ID}" missing`;
  const seq = sheet.sequence;
  if (!isObj(seq) || seq.type !== 'PositionalSequence' || !isNum(seq.length)) return 'sequence missing';
  const tracks = isObj(seq.tracksByObject) ? seq.tracksByObject[THEATRE_OBJECT_KEY] : undefined;
  if (!isObj(tracks) || !isObj(tracks.trackIdByPropPath) || !isObj(tracks.trackData)) return 'Rig tracks missing';
  let sequenced = 0;
  for (const path of PROP_PATHS) {
    const id = tracks.trackIdByPropPath[path];
    if (id === undefined) continue; // static / default is legal
    const track = typeof id === 'string' ? tracks.trackData[id] : undefined;
    if (!isObj(track) || track.type !== 'BasicKeyframedTrack' || !Array.isArray(track.keyframes)) {
      return `track ${path} malformed`;
    }
    let last = -Infinity;
    for (const kf of track.keyframes as unknown[]) {
      if (!isObj(kf) || !isNum(kf.position) || !isNum(kf.value) || kf.position < last) return `keyframes of ${path} malformed`;
      const h = kf.handles;
      if (!Array.isArray(h) || h.length !== 4 || !h.every(isNum)) return `handles of ${path} malformed`;
      last = kf.position;
    }
    if (track.keyframes.length > 0) sequenced++;
  }
  return sequenced >= 6 ? null : 'too few sequenced camera props';
}

// --------------------------------------------------------------------------------- fallback path

/** Coded path (theatre/path.ts): linear drift inside rest windows, smoothstep-eased transitions. */
function createFallbackPath(): (p: number, out: Pose) => void {
  const keys: PathKey[] = pathKeys();
  return (p, out) => {
    const pc = clamp(p, 0, SEQUENCE_LENGTH);
    let i = 0;
    while (i < keys.length - 2 && keys[i + 1]!.position <= pc) i++;
    const a = keys[i]!;
    const b = keys[i + 1]!;
    let t = clamp((pc - a.position) / (b.position - a.position), 0, 1);
    if (Math.round(a.position) !== Math.round(b.position)) t = t * t * t * (t * (t * 6 - 15) + 10);
    const A = a.pose, B = b.pose;
    out.position.x = A.position.x + (B.position.x - A.position.x) * t;
    out.position.y = A.position.y + (B.position.y - A.position.y) * t;
    out.position.z = A.position.z + (B.position.z - A.position.z) * t;
    out.target.x = A.target.x + (B.target.x - A.target.x) * t;
    out.target.y = A.target.y + (B.target.y - A.target.y) * t;
    out.target.z = A.target.z + (B.target.z - A.target.z) * t;
    out.fov = A.fov + (B.fov - A.fov) * t;
    out.roll = A.roll + (B.roll - A.roll) * t;
    out.frame = A.frame + (B.frame - A.frame) * t;
  };
}

// --------------------------------------------------------------------------------- Theatre source

interface PoseSource {
  /** Writes the pose at p into out; returns false if it could not (caller falls back). */
  read(p: number, out: Pose): boolean;
  dispose(): void;
}

type TheatreCore = typeof import('@theatre/core');

/** Rig sources currently holding the Theatre object. */
let liveRigObjects = 0;

/** The object's props config must be the same object across calls (Theatre deep-compares configs). */
let rigPropsConfig: Record<string, unknown> | null = null;
function rigProps(types: TheatreCore['types']): Record<string, unknown> {
  if (!rigPropsConfig) {
    const vec = (x: number, y: number, z: number) =>
      types.compound({
        x: types.number(x, { nudgeMultiplier: 0.01 }),
        y: types.number(y, { nudgeMultiplier: 0.01 }),
        z: types.number(z, { nudgeMultiplier: 0.01 }),
      });
    rigPropsConfig = {
      position: vec(0, 0.4, 9),
      target: vec(0, 0, 0),
      fov: types.number(40, { range: [10, 90], nudgeMultiplier: 0.1 }),
      roll: types.number(0, { range: [-30, 30], nudgeMultiplier: 0.1 }),
      frame: types.number(3, { range: [0.5, 12], nudgeMultiplier: 0.01 }),
    };
  }
  return rigPropsConfig;
}

async function createTheatreSource(injected?: unknown): Promise<PoseSource> {
  const mod = await import('@theatre/core');
  // CJS interop: bundlers expose named exports; node-mode interop nests them under `default`.
  const core: TheatreCore = typeof mod.getProject === 'function' ? mod : (mod as { default: TheatreCore }).default;
  let state = injected;
  if (state === undefined) {
    const json: unknown = await import('../theatre/camera.json');
    state = (json as { default?: unknown }).default ?? json;
  }
  const problem = validateCameraState(state);
  if (problem) throw new Error(`theatre/camera.json: ${problem}`);

  // getProject throws on a bad definitionVersion, and (in development) if called twice with a different
  // config — e.g. after camera.json hot-reloads. Either way: caught by the caller → fallback path.
  const project = core.getProject(THEATRE_PROJECT_ID, { state: state as never });
  let ready = false;
  void project.ready.then(() => { ready = true; });
  await Promise.race([project.ready, new Promise((r) => setTimeout(r, 1500))]);

  const sheet = project.sheet(THEATRE_SHEET_ID);
  const obj = sheet.object(THEATRE_OBJECT_KEY, rigProps(core.types) as never, { reconfigure: true });
  type RigValue = { position: Pose['position']; target: Pose['target']; fov: number; roll: number; frame: number };
  let dirty = true;
  const unsubscribe = obj.onValuesChange(() => { dirty = true; });
  let lastP = NaN;
  let disposed = false;
  liveRigObjects++;

  const source: PoseSource = {
    read(p, out) {
      if (!ready) return false;
      const pc = clamp(p, 0, SEQUENCE_LENGTH);
      if (pc === lastP && !dirty) return true; // `out` still holds that pose
      if (pc !== lastP) sheet.sequence.position = pc;
      lastP = pc;
      dirty = false;
      const v = obj.value as unknown as RigValue;
      copyPose(out, v);
      if (!poseIsFinite(out)) { lastP = NaN; return false; }
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      // Several rigs may share the object (React StrictMode / HMR overlap): detach with the last one.
      if (--liveRigObjects === 0) {
        try { sheet.detachObject(THEATRE_OBJECT_KEY); } catch { /* already gone */ }
      }
    },
  };

  // Sanity: the baked tracks must actually move the camera (a renamed sheet/object would yield defaults).
  if (ready) {
    const probe = newPose();
    let distinct = 0;
    for (let k = 0; k <= SEQUENCE_LENGTH; k++) {
      if (!source.read(k, probe)) break;
      if (Math.abs(probe.position.z - 9) > 1e-6 || Math.abs(probe.position.x) > 1e-6) distinct++;
    }
    if (distinct < 3) {
      source.dispose();
      throw new Error('camera tracks did not resolve to finite, non-default poses');
    }
    lastP = NaN;
  }
  return source;
}

// ------------------------------------------------------------------------------------------- rig

export interface CameraRigOptions {
  /** Theatre on-disk state to use instead of theatre/camera.json (tests, tooling). */
  state?: unknown;
}

export async function createCameraRig(options: CameraRigOptions = {}): Promise<CameraRig> {
  const fallback = createFallbackPath();
  let theatre: PoseSource | null = null;
  try {
    theatre = await createTheatreSource(options.state);
  } catch (err) {
    console.warn('[camera] Theatre state unavailable, using the coded camera path:', err);
  }

  const pose = newPose(); // raw pose from the source
  const cur = newPose(); // smoothed pose
  let first = true;
  let shiftX = 0, shiftY = 0; // smoothed lens shift (fractions of the viewport)
  let px = 0, py = 0; // smoothed parallax (NDC)
  let driftAmp = 0; // smoothed drift amplitude (world units)
  let dist = 9;

  const rig: CameraRig = {
    get source() {
      return theatre ? 'theatre' : 'fallback';
    },
    update(camera, f) {
      const p = clamp(Number.isFinite(f.progress) ? f.progress : 0, 0, SEQUENCE_LENGTH);
      if (!theatre || !theatre.read(p, pose)) fallback(p, pose);

      const dt = clamp(f.dt, 0, 0.1);
      const k = first ? 1 : 1 - Math.exp(-tuning.camera.smoothing * dt);
      // The pose follows scroll (already smoothed by Lenis) closely; just enough to absorb wheel notches.
      const kp = first ? 1 : 1 - Math.exp(-tuning.camera.smoothing * 2.6 * dt);
      first = false;
      cur.position.x += (pose.position.x - cur.position.x) * kp;
      cur.position.y += (pose.position.y - cur.position.y) * kp;
      cur.position.z += (pose.position.z - cur.position.z) * kp;
      cur.target.x += (pose.target.x - cur.target.x) * kp;
      cur.target.y += (pose.target.y - cur.target.y) * kp;
      cur.target.z += (pose.target.z - cur.target.z) * kp;
      cur.fov += (pose.fov - cur.fov) * kp;
      cur.roll += (pose.roll - cur.roll) * kp;
      cur.frame += (pose.frame - cur.frame) * kp;

      // ---- lens shift: formation away from the text; centred on the opening screen and the frontier.
      const width = Math.max(1, f.width), height = Math.max(1, f.height);
      const aspect = width / height;
      const portrait = aspect < 1;
      const amount = smoothstep(0.2, 0.75, p) * (1 - smoothstep(0, 1, f.frontier));
      shiftX += ((portrait ? 0 : tuning.camera.lensShiftX * amount) - shiftX) * k;
      shiftY += ((portrait ? tuning.camera.lensShiftY * amount : 0) - shiftY) * k;

      // ---- fit: narrow frames dolly back (70%) and widen the fov (30%) until `frame` fits sideways.
      const tx = cur.target.x, ty = cur.target.y, tz = cur.target.z;
      let ox = cur.position.x - tx, oy = cur.position.y - ty, oz = cur.position.z - tz;
      const d = Math.hypot(ox, oy, oz) || 1;
      let tanV = Math.tan(clamp(cur.fov, 5, 120) * 0.5 * DEG);
      const availHalf = portrait ? 0.45 : Math.max(0.2, (0.5 - Math.abs(shiftX)) * 0.94);
      const fit = cur.frame / (2 * d * tanV * aspect * availHalf);
      if (fit > 1) {
        const dolly = Math.pow(fit, 0.7);
        ox *= dolly; oy *= dolly; oz *= dolly;
        tanV *= fit / dolly;
      }

      // ---- camera basis (forward = target − eye), for drift / parallax offsets.
      const dl = Math.hypot(ox, oy, oz) || 1;
      const fx = -ox / dl, fy = -oy / dl, fz = -oz / dl;
      let rx = -fz, rz = fx; // right = forward × worldUp (y-up) = (−fz, 0, fx)
      const rl = Math.hypot(rx, rz) || 1;
      rx /= rl; rz /= rl;
      const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy; // up = right × forward

      const motion = f.reducedMotion ? 0 : 1;
      driftAmp += (tuning.camera.drift * motion - driftAmp) * k * 0.5;
      px += (f.pointer.x * motion - px) * k;
      py += (f.pointer.y * motion - py) * k;
      const ph = f.time * tuning.camera.driftSpeed; // rad/s
      const scale = dl / 12; // offsets are authored for a ~12-unit shot
      const oR = (driftAmp * Math.sin(ph) + tuning.camera.parallax * px) * scale;
      const oU = (driftAmp * 0.55 * Math.sin(ph * 0.77 + 1.3) + tuning.camera.parallax * 0.6 * py) * scale;
      const oF = driftAmp * 0.6 * Math.sin(ph * 0.53 + 0.4) * scale;

      camera.position.set(
        tx + ox + rx * oR + ux * oU + fx * oF,
        ty + oy + uy * oU + fy * oF,
        tz + oz + rz * oR + uz * oU + fz * oF,
      );
      camera.up.set(0, 1, 0);
      camera.lookAt(tx, ty, tz);
      if (cur.roll !== 0) camera.rotateZ(cur.roll * DEG);

      camera.fov = (2 * Math.atan(tanV)) / DEG;
      camera.aspect = aspect;
      if (Math.abs(shiftX) + Math.abs(shiftY) > 1e-5) {
        // A window moved left/down of the full frame shows the scene shifted right/up.
        camera.setViewOffset(width, height, -shiftX * width, shiftY * height, width, height);
      } else if (camera.view?.enabled) {
        camera.clearViewOffset();
      }
      camera.updateProjectionMatrix();
      dist = camera.position.length();
    },
    focusDistance: () => dist,
    dispose() {
      theatre?.dispose();
      theatre = null;
    },
  };
  return rig;
}

// ------------------------------------------------------------------------------------------- studio

let studioOpening: Promise<void> | null = null;

/**
 * Development only: opens Theatre Studio over the page (DevTools calls this when the URL has ?studio).
 * The rig keeps setting sequence.position from scroll, so scroll to a chapter, then edit "Camera › Rig";
 * Studio keys the playhead position. Edits persist in localStorage ("theatre-0.4.persistent") and win over
 * the baked camera.json while their revisionHistory contains the baked revision; if camera.json changed
 * underneath, Studio asks which to keep. Export: Studio › project "The Long Scroll" › Export to JSON →
 * save as theatre/camera.json (or edit theatre/path.ts and run `node theatre/build-camera-state.ts`).
 * Production builds drop the import (dead branch), so @theatre/studio never ships.
 */
export async function openStudio(): Promise<void> {
  if (process.env.NODE_ENV === 'development') {
    if (typeof window === 'undefined') return;
    studioOpening ??= import('@theatre/studio').then((mod) => {
      // CJS interop: webpack/turbopack give exports.default; node-mode interop gives module.exports.
      type Studio = typeof mod.default;
      const d = mod.default as Studio & { default?: Studio };
      const studio = typeof d.initialize === 'function' ? d : d.default!;
      studio.initialize();
      studio.ui.restore();
    });
    return studioOpening;
  }
}
