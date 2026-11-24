/**
 * Per-chapter GPU state shared by every particle path (compute 'simulate', vertex 'morph', 'crossfade').
 *
 * Formations are stored in their canonical frame (lib/formations/types.ts). The GPU applies each
 * chapter's `scene` parameters from data/chapters.ts: idle travelling wave (local Y), idle spin about
 * local +Y (optionally differential: inner parts lead), slow sway, uniform scale, then the fixed tilt.
 *
 * Two "slots" of uniforms exist — the formation the particles are leaving (`from`) and the one they are
 * heading to (`to`). Formation index f ∈ 0..9: 0 = singularity = chapter 1's data × SINGULARITY_SCALE,
 * k = chapter k. The CPU fills both slots every frame from the timeline (`updateChapterUniforms`).
 */
import { Color, Matrix3, Matrix4, Euler, Vector3, Vector4, type UniformNode, type Node } from 'three/webgpu';
import { uniform, float, vec3, length, sin, cos, clamp, mix, smoothstep, fract, exp, select, hash, dot, sqrt, instanceIndex } from 'three/tsl';
import { CHAPTERS } from '@/data/chapters';
import { SINGULARITY_SCALE, morphAt, type MorphState } from '@/lib/timeline';
import { FORMATION_RADIUS, PULSE_BASE_BRIGHTNESS } from '@/lib/formations/types';

export interface SlotUniforms {
  /** Fixed tilt (Euler XYZ) as a rotation matrix. */
  tilt: UniformNode<'mat3', Matrix3>;
  /** x = rigid idle angle (rad), y = differential angle amount (rad), z = scale, w = point size multiplier. */
  motion: UniformNode<'vec4', Vector4>;
  /** x = wave amplitude, y = wave frequency, z = wave phase (speed · t). */
  wave: UniformNode<'vec4', Vector4>;
  /** Palette (linear RGB): primary (w → 1) and secondary (w → 0). */
  primary: UniformNode<'color', Color>;
  secondary: UniformNode<'color', Color>;
}

export interface ChapterUniforms {
  from: SlotUniforms;
  to: SlotUniforms;
  /** Formation DATA index (0..8) of each slot: max(f − 1, 0). */
  dataFrom: UniformNode<'int', number>;
  dataTo: UniformNode<'int', number>;
  /** Linear transition progress 0..1 (morphAt(p).t). */
  t: UniformNode<'float', number>;
  /** Stagger ordering: xyz = sweep direction (canonical frame), w = weight of radial ordering vs sweep. */
  order: UniformNode<'vec4', Vector4>;
  /** Seconds; frozen under reduced motion. */
  time: UniformNode<'float', number>;
  /** Fraction of the transition used to stagger start times, and random-vs-spatial mix. */
  delaySpread: UniformNode<'float', number>;
  waveOrder: UniformNode<'float', number>;
}

export function createSlot(): SlotUniforms {
  return {
    tilt: uniform(new Matrix3()),
    motion: uniform(new Vector4(0, 0, 1, 1)),
    wave: uniform(new Vector4(0, 0, 0, 0)),
    primary: uniform(new Color(1, 1, 1)),
    secondary: uniform(new Color(0.5, 0.5, 0.5)),
  };
}

export function createChapterUniforms(): ChapterUniforms {
  return {
    from: createSlot(),
    to: createSlot(),
    dataFrom: uniform(0, 'int'),
    dataTo: uniform(0, 'int'),
    t: uniform(0),
    order: uniform(new Vector4(0, 1, 0, 1)),
    time: uniform(0),
    delaySpread: uniform(0.62),
    waveOrder: uniform(0.35),
  };
}

// ------------------------------------------------------------------------------------------------
// TSL building blocks
// ------------------------------------------------------------------------------------------------

/** Canonical formation point → world, for one slot. Inlined (called twice per particle). */
export function chapterTransform(p: Node<'vec3'>, slot: SlotUniforms): Node<'vec3'> {
  const x = p.x;
  const z = p.z;
  // 1. travelling wave on local Y: y += amp · sin(freq · x − phase) · cos(0.7 · freq · z)
  const y = p.y.add(slot.wave.x.mul(sin(slot.wave.y.mul(x).sub(slot.wave.z))).mul(cos(slot.wave.y.mul(0.7).mul(z))));
  // 2. idle spin about local +Y; differential part leads in the centre (galaxy-like), bounded on the CPU.
  const r = length(p.xz);
  const k = clamp(float(1.35).div(r.mul(0.45).add(0.35)), 0.5, 2.5).sub(1);
  const angle = slot.motion.x.add(slot.motion.y.mul(k));
  const c = cos(angle);
  const s = sin(angle);
  const rotated = vec3(x.mul(c).add(z.mul(s)), y, z.mul(c).sub(x.mul(s)));
  // 3. scale, 4. fixed tilt
  return slot.tilt.mul(rotated.mul(slot.motion.z));
}

/**
 * Formation w → brightness / palette mix. w ∈ [0,1] is used as-is; w ∈ [2,3) is a pulse carrier
 * (network arcs): base brightness plus a comet-like pulse travelling along the arc (phase = w − 2).
 * Returns values above 1 on pulse heads (extra brightness); clamp for the palette mix.
 */
export function decodeBrightness(w: Node<'float'>, time: Node<'float'>): Node<'float'> {
  const phase = w.sub(2);
  const s1 = fract(phase.sub(time.mul(0.23)));
  const s2 = fract(phase.mul(2).sub(time.mul(0.31)).add(0.37));
  const pulse = exp(float(1).sub(s1).mul(-16)).add(exp(float(1).sub(s2).mul(-22)).mul(0.6));
  const carrier = float(PULSE_BASE_BRIGHTNESS).add(pulse.mul(2.4));
  return select(w.greaterThanEqual(1.5), carrier, w);
}

/**
 * Per-particle eased morph m_i ∈ [0,1] from the linear transition t: a start delay that mixes a
 * random value with spatial order (sweep along `order.xyz` or radially), so shapes dissolve and
 * re-form in waves. Uses the destination point (canonical) for the ordering.
 */
export function staggeredMorph(u: ChapterUniforms, dest: Node<'vec3'>, random: Node<'float'>): Node<'float'> {
  const sweep = clamp(dot(dest, u.order.xyz).mul(1 / (2 * FORMATION_RADIUS)).add(0.5), 0, 1);
  const radial = clamp(length(dest).mul(1 / (FORMATION_RADIUS * 1.25)), 0, 1);
  const spatial = mix(sweep, radial, u.order.w);
  const delay = mix(random, spatial, u.waveOrder).mul(u.delaySpread);
  const local = clamp(u.t.sub(delay).div(float(1).sub(u.delaySpread)), 0, 1);
  return smoothstep(0, 1, local);
}

/** Uniformly distributed random unit vector per particle (seeded by instanceIndex + salt). */
export function randomDirection(salt: number): Node<'vec3'> {
  const z = hash(instanceIndex.add(salt)).mul(2).sub(1);
  const a = hash(instanceIndex.add(salt + 7717)).mul(Math.PI * 2);
  const rr = sqrt(float(1).sub(z.mul(z)).max(0));
  return vec3(rr.mul(cos(a)), rr.mul(sin(a)), z);
}

// ------------------------------------------------------------------------------------------------
// CPU side
// ------------------------------------------------------------------------------------------------

const TILTS: Matrix3[] = CHAPTERS.map((c) => {
  const m4 = new Matrix4().makeRotationFromEuler(new Euler(c.scene.tilt[0], c.scene.tilt[1], c.scene.tilt[2], 'XYZ'));
  return new Matrix3().setFromMatrix4(m4);
});
const PRIMARY: Color[] = CHAPTERS.map((c) => new Color(c.palette.primary));
const SECONDARY: Color[] = CHAPTERS.map((c) => new Color(c.palette.secondary));

/** Sweep directions per transition (canonical frame) — varied so every chapter dissolves differently. */
const ORDER: Vector4[] = [
  new Vector4(0, 1, 0, 1), // 0 → 1  singularity → big bang: radial (inner first) — an expanding front
  new Vector4(0, 0, 0, 1), // 1 → 2  big bang → galaxy: radial
  new Vector4(-0.8, 0.2, 0.55, 0), // 2 → 3  galaxy → earth
  new Vector4(0, 1, 0, 0), // 3 → 4  earth → dna: bottom → top along the helix
  new Vector4(1, 0.15, 0, 0), // 4 → 5  dna → tablet: left → right like reading
  new Vector4(1, 0, 0.1, 0), // 5 → 6  tablet → morse: along the ribbon
  new Vector4(-0.3, -0.9, 0.3, 0.4), // 6 → 7  morse → moon
  new Vector4(0, 0, 0, 1), // 7 → 8  moon → network: centre out
  new Vector4(0, 0, 1, 0.35), // 8 → 9  network → canvas: front to back
].map((v) => {
  const d = new Vector3(v.x, v.y, v.z);
  if (d.lengthSq() > 0) d.normalize();
  return new Vector4(d.x, d.y, d.z, v.w);
});

export interface ChapterFrameOptions {
  /** Seconds (unfrozen). */
  time: number;
  reducedMotion: boolean;
  /** 0..1: chapter 9's wave settles flat near the frontier. */
  settle: number;
}

/** Writes the uniforms of one slot for formation index f (0..9) at the given time. */
export function writeSlot(slot: SlotUniforms, f: number, o: ChapterFrameOptions): void {
  const c = CHAPTERS[Math.max(0, f - 1)]!;
  const sc = c.scene;
  const t = o.reducedMotion ? 0 : o.time;
  const rigid = sc.spin * t + sc.sway * Math.sin(t * 0.35);
  // Differential rotation: inner parts lead, then fall back — bounded shear so spiral arms never wind up.
  const differential = sc.spinDifferential * sc.spin * 5.5 * Math.sin(t / 5.5);
  const scale = f === 0 ? sc.scale * SINGULARITY_SCALE : sc.scale;
  slot.motion.value.set(rigid, differential, scale, sc.pointSize);
  let amp = sc.wave.amp;
  if (f === CHAPTERS.length) amp *= 1 - o.settle;
  slot.wave.value.set(amp, sc.wave.freq, sc.wave.speed * t, 0);
  slot.tilt.value.copy(TILTS[Math.max(0, f - 1)]!);
  slot.primary.value.copy(PRIMARY[Math.max(0, f - 1)]!);
  slot.secondary.value.copy(SECONDARY[Math.max(0, f - 1)]!);
}

/** Fills both slots from the scroll progress. Returns the morph state. */
export function updateChapterUniforms(u: ChapterUniforms, progress: number, o: ChapterFrameOptions): MorphState {
  const ms = morphAt(progress);
  writeSlot(u.from, ms.from, o);
  writeSlot(u.to, ms.to, o);
  u.dataFrom.value = Math.max(0, ms.from - 1);
  u.dataTo.value = Math.max(0, ms.to - 1);
  u.t.value = ms.t;
  u.order.value.copy(ORDER[ms.from]!);
  u.time.value = o.reducedMotion ? 0 : o.time;
  return ms;
}

/** Chapter scene multipliers blended across the transition (bloom, point size) for CPU consumers. */
export function chapterBlend(progress: number): { bloom: number; pointSize: number } {
  const ms = morphAt(progress);
  const a = CHAPTERS[Math.max(0, ms.from - 1)]!.scene;
  const b = CHAPTERS[Math.max(0, ms.to - 1)]!.scene;
  const e = ms.t * ms.t * (3 - 2 * ms.t);
  return { bloom: a.bloom + (b.bloom - a.bloom) * e, pointSize: a.pointSize + (b.pointSize - a.pointSize) * e };
}
