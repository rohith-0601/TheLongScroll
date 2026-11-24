/**
 * GPU particle simulation ('simulate' mode, WebGPU backend). Real physics, not tweens: every particle has a
 * velocity and is pulled toward its target by a spring–damper, plus curl-noise turbulence that peaks
 * mid-transition, the pointer push (with drag along the pointer's motion), hold-to-collapse into a tiny dense
 * star with a swirl, and the release burst. Interruptions are natural because the state is velocity-based.
 *
 * Buffers (research/tsl-particles.md §2): positions/velocities = instancedArray(N, vec4); ONE read-only
 * storage buffer of the 9 formations (formation-major, 9·N·vec4). Formation 0 (singularity) is chapter 1's
 * data scaled in the shader (chapters.ts → slot.motion.z), never stored.
 *   positions.w  = per-particle morph m_i (drives the palette / point-size crossfade in the material)
 *   velocities.w = decoded brightness (0..1 palette mix; > 1 on network pulse heads)
 */
import { Vector3, type StorageBufferAttribute, type StorageBufferNode, type ComputeNode, type UniformNode } from 'three/webgpu';
import {
  Fn,
  instanceIndex,
  instancedArray,
  attributeArray,
  uniform,
  uint,
  float,
  vec3,
  vec4,
  hash,
  mix,
  sin,
  sqrt,
  min,
  max,
  dot,
  cross,
  length,
  normalize,
  smoothstep,
  PI,
} from 'three/tsl';
import { curlNoise } from './noise';
import { chapterTransform, decodeBrightness, randomDirection, staggeredMorph, type ChapterUniforms } from './chapters';
import { SINGULARITY_SCALE } from '@/lib/timeline';

export interface SimUniforms {
  dt: UniformNode<'float', number>;
  stiffness: UniformNode<'float', number>;
  stiffnessJitter: UniformNode<'float', number>;
  damping: UniformNode<'float', number>;
  /** Curl-noise acceleration at mid-transition (already includes the noise RMS normalisation). */
  turbulence: UniformNode<'float', number>;
  noiseScale: UniformNode<'float', number>;
  maxSpeed: UniformNode<'float', number>;
  rayOrigin: UniformNode<'vec3', Vector3>;
  rayDir: UniformNode<'vec3', Vector3>;
  pointerActive: UniformNode<'float', number>;
  pointerRadius: UniformNode<'float', number>;
  pointerStrength: UniformNode<'float', number>;
  pointerVel: UniformNode<'vec3', Vector3>;
  pointerDrag: UniformNode<'float', number>;
  holdPoint: UniformNode<'vec3', Vector3>;
  /** Unit vector from the hold point toward the camera (swirl axis). */
  holdAxis: UniformNode<'vec3', Vector3>;
  hold: UniformNode<'float', number>;
  holdStrength: UniformNode<'float', number>;
  swirl: UniformNode<'float', number>;
  starRadius: UniformNode<'float', number>;
  burst: UniformNode<'float', number>;
  burstStrength: UniformNode<'float', number>;
}

export function createSimUniforms(): SimUniforms {
  return {
    dt: uniform(1 / 60),
    stiffness: uniform(26),
    stiffnessJitter: uniform(0.45),
    damping: uniform(5.6),
    turbulence: uniform(2),
    noiseScale: uniform(0.55),
    maxSpeed: uniform(14),
    rayOrigin: uniform(new Vector3(0, 0, 10)),
    rayDir: uniform(new Vector3(0, 0, -1)),
    pointerActive: uniform(0),
    pointerRadius: uniform(0.85),
    pointerStrength: uniform(30),
    pointerVel: uniform(new Vector3()),
    pointerDrag: uniform(0.55),
    holdPoint: uniform(new Vector3()),
    holdAxis: uniform(new Vector3(0, 0, 1)),
    hold: uniform(0),
    holdStrength: uniform(60),
    swirl: uniform(9),
    starRadius: uniform(0.07),
    burst: uniform(0),
    burstStrength: uniform(13),
  };
}

export interface ParticleSim {
  count: number;
  positions: StorageBufferNode<'vec4'>;
  velocities: StorageBufferNode<'vec4'>;
  uniforms: SimUniforms;
  init: ComputeNode;
  update: ComputeNode;
  setActiveCount(n: number): void;
  /** Drop the JS copy of the formations once they are on the GPU (frees ~144 MB at 1M). */
  releaseCpuCopy(): void;
}

/** Workgroup 64: valid everywhere (compat devices cap invocations per workgroup at 128). */
const WG = 64;

export function createParticleSim(count: number, packed: Float32Array, chapter: ChapterUniforms): ParticleSim {
  const positions = instancedArray(count, 'vec4').setName('particlePositions');
  const velocities = instancedArray(count, 'vec4').setName('particleVelocities');
  const formations = attributeArray(packed, 'vec4').setName('particleFormations').toReadOnly();
  const formationAttribute = formations.value as StorageBufferAttribute;
  const u = createSimUniforms();
  const N = uint(count);

  // Start as the singularity: chapter 1's formation × SINGULARITY_SCALE, at rest.
  const init = Fn(() => {
    const a = formations.element(instanceIndex);
    positions.element(instanceIndex).assign(vec4(a.xyz.mul(SINGULARITY_SCALE), 0.0));
    velocities.element(instanceIndex).assign(vec4(0, 0, 0, 1));
  })().compute(count, [WG]).setName('particlesInit');

  const update = Fn(() => {
    const i = instanceIndex;
    const posEl = positions.element(i);
    const velEl = velocities.element(i);
    const p = posEl.xyz.toVar(); // read before writing
    const v = velEl.xyz.toVar();

    const h1 = hash(i);
    const h2 = hash(i.add(7919));
    const h3 = hash(i.add(104729));

    // ---- target: both formations through their chapter transforms, mixed by the staggered morph m_i
    const a = formations.element(uint(chapter.dataFrom).mul(N).add(i)).toVar();
    const b = formations.element(uint(chapter.dataTo).mul(N).add(i)).toVar();
    const m = staggeredMorph(chapter, b.xyz, h1).toVar();
    const ta = chapterTransform(a.xyz, chapter.from);
    const tb = chapterTransform(b.xyz, chapter.to);
    const target = mix(ta, tb, m).toVar();
    const brightness = mix(decodeBrightness(a.w, chapter.time), decodeBrightness(b.w, chapter.time), m);

    // ---- hold to collapse: targets fall into a tiny dense star (progressively, per particle)
    const hl = smoothstep(h3.mul(0.5), h3.mul(0.5).add(0.5), u.hold).toVar();
    const hs = hash(i.add(55511));
    const starOffset = randomDirection(31337).mul(u.starRadius.mul(hs.mul(hs).add(0.04))); // dense core, soft rim
    target.assign(mix(target, u.holdPoint.add(starOffset), hl));

    // ---- spring–damper (per-particle stiffness jitter → organic, wave-like arrival)
    const k = u.stiffness.mul(float(1).add(u.stiffnessJitter.mul(h2.mul(2).sub(1))));
    const kk = mix(k, u.holdStrength, hl);
    const damping = mix(u.damping, sqrt(kk).mul(1.1), hl);
    const force = target.sub(p).mul(kk).sub(v.mul(damping)).toVar();

    // ---- curl-noise turbulence ∝ sin(π m): zero at rest, peaks mid-transition
    const flow = curlNoise(p.mul(u.noiseScale).add(vec3(0.0, chapter.time.mul(0.12), chapter.time.mul(0.07))));
    force.addAssign(flow.mul(u.turbulence.mul(sin(m.mul(PI)))));

    // ---- swirl around the hold axis while collapsing
    const rel = p.sub(u.holdPoint).toVar();
    const relLen = length(rel);
    const tangent = cross(u.holdAxis, rel);
    force.addAssign(normalize(tangent.add(vec3(1e-5, 0, 0))).mul(u.swirl.mul(hl).mul(min(relLen.mul(2.5), 1))));

    // ---- pointer: push away from the pointer ray, drag along the pointer's motion
    const q = p.sub(u.rayOrigin);
    const along = dot(q, u.rayDir);
    const perp = q.sub(u.rayDir.mul(along));
    const dist = length(perp);
    const fall = float(1).sub(smoothstep(0, u.pointerRadius, dist)).toVar();
    fall.assign(fall.mul(fall).mul(u.pointerActive).mul(smoothstep(0, 0.5, along)).mul(float(1).sub(hl)));
    force.addAssign(perp.div(max(dist, 1e-4)).mul(u.pointerStrength.mul(fall).mul(mix(0.6, 1.4, h1))));
    force.addAssign(u.pointerVel.sub(v).mul(u.pointerDrag.mul(fall).mul(4)));

    // ---- release burst: outward impulse from the hold point
    const outward = rel.add(randomDirection(4242).mul(0.03));
    force.addAssign(normalize(outward).mul(u.burst.mul(u.burstStrength).mul(mix(4, 11, h3))));

    // ---- integrate (semi-implicit Euler), clamp speed
    v.addAssign(force.mul(u.dt));
    const speed = length(v);
    v.mulAssign(min(float(1), u.maxSpeed.div(max(speed, 1e-5))));
    p.addAssign(v.mul(u.dt));
    posEl.assign(vec4(p, m));
    velEl.assign(vec4(v, brightness));
  })().compute(count, [WG]).setName('particlesUpdate');

  return {
    count,
    positions,
    velocities,
    uniforms: u,
    init,
    update,
    setActiveCount(n: number) {
      // NOTE: ComputeNode.setCount() is typed in @types/three but missing at runtime in r187.
      update.count = Math.max(1, Math.min(count, Math.round(n)));
    },
    releaseCpuCopy() {
      formationAttribute.array = new Float32Array(4);
    },
  };
}
