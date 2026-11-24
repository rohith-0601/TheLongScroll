/**
 * No-compute particle paths (research/tsl-particles.md §7, verified on WebGL2 and WebGPU):
 *
 *  - 'morph' (WebGL2 fallback, 100K): the vertex shader morphs between two instanced vec4 attributes
 *    `aFrom` / `aTo` (canonical formation data, refilled IN PLACE when the scroll crosses a boundary), applies
 *    both chapter transforms, the staggered per-particle morph, curl-noise displacement ∝ sin(π m), and
 *    analytic approximations of the pointer push, hold-to-collapse (swirl + collapse into a star) and burst.
 *  - 'crossfade' (prefers-reduced-motion): static layers (one attribute each, no turbulence, no idle motion)
 *    with their own chapter slot, crossfaded by opacity.
 *
 * MUST use InstancedBufferAttribute: instancedBufferAttribute(new BufferAttribute(...)) is per-VERTEX in r187.
 */
import { InstancedBufferAttribute, type Sprite, type UniformNode } from 'three/webgpu';
import {
  instancedBufferAttribute,
  instanceIndex,
  uniform,
  hash,
  float,
  vec3,
  mix,
  sin,
  cos,
  dot,
  cross,
  length,
  normalize,
  max,
  smoothstep,
  PI,
} from 'three/tsl';
import { curlNoise } from './noise';
import {
  chapterTransform,
  decodeBrightness,
  randomDirection,
  staggeredMorph,
  type ChapterUniforms,
  type SlotUniforms,
} from './chapters';
import { createParticleMaterial, createParticleSprite, type MaterialUniforms } from './particles.material';
import type { SimUniforms } from './particles.compute';

export interface MorphParticles {
  sprite: Sprite;
  /** Displacement amplitude of the curl noise at mid-transition (world units). */
  turbulence: UniformNode<'float', number>;
  /** Proxy for particle speed (speed glow): scroll speed, set per frame. */
  speedProxy: UniformNode<'float', number>;
  setFormations(from: Float32Array, to: Float32Array): void;
  dispose(): void;
}

export function createMorphParticles(
  count: number,
  chapter: ChapterUniforms,
  mu: MaterialUniforms,
  u: SimUniforms,
): MorphParticles {
  const fromAttr = new InstancedBufferAttribute(new Float32Array(count * 4), 4);
  const toAttr = new InstancedBufferAttribute(new Float32Array(count * 4), 4);
  const aFrom = instancedBufferAttribute<'vec4'>(fromAttr);
  const aTo = instancedBufferAttribute<'vec4'>(toAttr);
  const turbulence = uniform(0.32);
  const speedProxy = uniform(0);

  const h1 = hash(instanceIndex);
  const h3 = hash(instanceIndex.add(104729));
  const hs = hash(instanceIndex.add(55511));

  const m = staggeredMorph(chapter, aTo.xyz, h1);
  const ta = chapterTransform(aFrom.xyz, chapter.from);
  const tb = chapterTransform(aTo.xyz, chapter.to);
  const base = mix(ta, tb, m);
  // NOTE: the vertex shader runs 4× per sprite (quad corners) → noise cost is 4× per particle here.
  const flow = curlNoise(base.mul(0.55).add(vec3(0, chapter.time.mul(0.12), chapter.time.mul(0.07))));
  let pos = base.add(flow.mul(turbulence.mul(sin(m.mul(PI))).mul(1 / 8.6)));

  // Pointer push (displacement away from the pointer ray) + drag along the pointer's motion.
  const q = pos.sub(u.rayOrigin);
  const along = dot(q, u.rayDir);
  const perp = q.sub(u.rayDir.mul(along));
  const dist = length(perp);
  const f0 = float(1).sub(smoothstep(0, u.pointerRadius, dist));
  const fall = f0.mul(f0).mul(u.pointerActive).mul(smoothstep(0, 0.5, along));
  pos = pos
    .add(perp.div(max(dist, 1e-4)).mul(u.pointerRadius.mul(0.5).mul(fall).mul(mix(0.6, 1.4, h1))))
    .add(u.pointerVel.mul(u.pointerDrag.mul(0.07).mul(fall)));

  // Hold: swirl about the hold axis while collapsing into a tiny star.
  const hl = smoothstep(h3.mul(0.5), h3.mul(0.5).add(0.5), u.hold);
  const rel = pos.sub(u.holdPoint);
  const theta = hl.mul(2.6).mul(mix(0.7, 1.3, h3));
  const c = cos(theta);
  const s = sin(theta);
  const axis = u.holdAxis;
  const swirled = rel.mul(c).add(cross(axis, rel).mul(s)).add(axis.mul(dot(axis, rel).mul(float(1).sub(c))));
  const star = randomDirection(31337).mul(u.starRadius.mul(hs.mul(hs).add(0.04)));
  const collapsed = u.holdPoint.add(mix(swirled, star, hl.mul(hl).mul(float(3).sub(hl.mul(2)))));

  // Burst: outward displacement that decays with the burst envelope (springs back).
  const outward = normalize(collapsed.sub(u.holdPoint).add(randomDirection(4242).mul(0.03)));
  const center = collapsed.add(outward.mul(u.burst.mul(mix(0.6, 2.2, h3))));

  const brightness = mix(decodeBrightness(aFrom.w, chapter.time), decodeBrightness(aTo.w, chapter.time), m);
  const speed = speedProxy.mul(sin(m.mul(PI))).add(u.burst.mul(9)).add(hl.mul(4));
  const material = createParticleMaterial({ center, morph: m, brightness, speed }, chapter, mu);
  const sprite = createParticleSprite(material, count);

  return {
    sprite,
    turbulence,
    speedProxy,
    setFormations(from: Float32Array, to: Float32Array) {
      fromAttr.array.set(from);
      fromAttr.needsUpdate = true; // same attribute objects → re-uploaded on the next render, no new buffers
      toAttr.array.set(to);
      toAttr.needsUpdate = true;
    },
    dispose() {
      material.dispose();
    },
  };
}

export interface StaticLayer {
  sprite: Sprite;
  slot: SlotUniforms;
  opacity: UniformNode<'float', number>;
  /** Formation index (0..9) currently loaded, or -1. */
  formation: number;
  /** Eased display weight 0..1. */
  weight: number;
  load(data: Float32Array, formation: number): void;
  dispose(): void;
}

export function createStaticLayer(
  count: number,
  slot: SlotUniforms,
  time: UniformNode<'float', number>,
  mu: MaterialUniforms,
): StaticLayer {
  const attr = new InstancedBufferAttribute(new Float32Array(count * 4), 4);
  const a = instancedBufferAttribute<'vec4'>(attr);
  const opacity = uniform(0);
  const center = chapterTransform(a.xyz, slot);
  const brightness = decodeBrightness(a.w, time);
  const material = createParticleMaterial(
    { center, morph: float(0), brightness, speed: float(0), opacity },
    { from: slot, to: slot, time },
    mu,
  );
  const sprite = createParticleSprite(material, count);
  sprite.visible = false;
  const layer: StaticLayer = {
    sprite,
    slot,
    opacity,
    formation: -1,
    weight: 0,
    load(data: Float32Array, formation: number) {
      attr.array.set(data);
      attr.needsUpdate = true;
      layer.formation = formation;
    },
    dispose() {
      material.dispose();
    },
  };
  return layer;
}
