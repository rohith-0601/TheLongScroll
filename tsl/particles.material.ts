/**
 * Soft, round, additive sprites: per-chapter two-colour palette crossfaded per particle, per-particle depth
 * of field (size grows and alpha drops away from the focus distance), brightness normalised for the particle
 * count, subtle twinkle, speed glow. One material for every path ('simulate', 'morph', 'crossfade') and both
 * backends (WebGPU, WebGL2).
 *
 * Verified patterns (research/tsl-particles.md §5): Sprite + SpriteNodeMaterial + count + frustumCulled=false,
 * view depth from modelViewMatrix · centre in the vertex stage, vertexStage() for per-particle varyings.
 */
import { SpriteNodeMaterial, Sprite, AdditiveBlending, Vector3, type Node, type UniformNode } from 'three/webgpu';
import {
  uniform,
  float,
  vec2,
  vec4,
  hash,
  instanceIndex,
  mix,
  abs,
  exp,
  sin,
  min,
  max,
  clamp,
  smoothstep,
  select,
  distance,
  length,
  uv,
  modelViewMatrix,
  vertexStage,
} from 'three/tsl';
import { tuning } from '@/lib/tuning';
import type { ChapterUniforms } from './chapters';

export interface MaterialUniforms {
  /** Base sprite size (world units) already normalised for the active particle count. */
  size: UniformNode<'float', number>;
  sizeJitter: UniformNode<'float', number>;
  /** Overall particle brightness (HDR multiplier). */
  intensity: UniformNode<'float', number>;
  focusDistance: UniformNode<'float', number>;
  aperture: UniformNode<'float', number>;
  maxBlur: UniformNode<'float', number>;
  twinkle: UniformNode<'float', number>;
  speedGlow: UniformNode<'float', number>;
  /** 0..1 global intensity (dims under the frontier). */
  fade: UniformNode<'float', number>;
  /** Physical pixels per world unit at distance 1 (drawing-buffer height · P[1][1] / 2). */
  pixelsPerUnit: UniformNode<'float', number>;
  /** Minimum sprite quad size in physical pixels: the gaussian then anti-aliases instead of shimmering. */
  minPixels: UniformNode<'float', number>;
  /** Collapse culling (see createParticleMaterial): hold point, hold amount, star radius, singularity amount. */
  holdPoint: UniformNode<'vec3', Vector3>;
  hold: UniformNode<'float', number>;
  starRadius: UniformNode<'float', number>;
  singular: UniformNode<'float', number>;
}

/** Minimum on-screen quad size (physical px). With the exp(−4.5 d²) disc that is a ≈0.7 px σ gaussian. */
export const MIN_SPRITE_PIXELS = 4;

/** Fraction of particles still drawn inside a fully collapsed star (the rest are culled, light is conserved). */
const COLLAPSED_KEEP = 0.04;

/** Per-particle brightness at 1M particles before the global multiplier (tuned by eye with AgX + bloom). */
export const BASE_INTENSITY = 0.16;

export function createMaterialUniforms(): MaterialUniforms {
  return {
    size: uniform(tuning.render.size),
    sizeJitter: uniform(tuning.render.sizeJitter),
    intensity: uniform(BASE_INTENSITY * tuning.render.brightness),
    focusDistance: uniform(9),
    aperture: uniform(tuning.render.dofAperture),
    maxBlur: uniform(tuning.render.dofMaxBlur),
    twinkle: uniform(tuning.render.twinkle),
    speedGlow: uniform(tuning.render.speedGlow),
    fade: uniform(1),
    pixelsPerUnit: uniform(1000),
    minPixels: uniform(MIN_SPRITE_PIXELS),
    holdPoint: uniform(new Vector3()),
    hold: uniform(0),
    starRadius: uniform(tuning.hold.starRadius),
    singular: uniform(0),
  };
}

/**
 * Count normalisation. Fewer particles must keep the formation's total light (N · size² · intensity), but growing
 * the sprites by the full sqrt(1e6/N) makes low counts look blotchy. Split it: size ∝ (1e6/N)^¼, intensity ∝ (1e6/N)^½.
 */
export function sizeForCount(activeCount: number): number {
  return tuning.render.size * Math.pow(1e6 / Math.max(1, activeCount), 0.25);
}
export function intensityForCount(activeCount: number): number {
  return Math.sqrt(1e6 / Math.max(1, activeCount));
}

export interface ParticleLook {
  /** World-space centre (vertex stage). */
  center: Node<'vec3'>;
  /** Per-particle morph 0..1 between the from and to palettes / point sizes. */
  morph: Node<'float'>;
  /** Decoded brightness (0..1 palette mix; > 1 on pulse heads). */
  brightness: Node<'float'>;
  /** Particle speed (world units/s) for the speed glow. */
  speed: Node<'float'>;
  /** Extra opacity multiplier (crossfade layers). */
  opacity?: Node<'float'>;
}

export function createParticleMaterial(
  look: ParticleLook,
  chapter: Pick<ChapterUniforms, 'from' | 'to' | 'time'>,
  mu: MaterialUniforms,
): SpriteNodeMaterial {
  const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending });
  const centre = look.center;
  material.positionNode = centre;

  const h0 = hash(instanceIndex.add(911));
  const h1 = hash(instanceIndex.add(4111));
  const h2 = hash(instanceIndex.add(7477));

  // Size: base · chapter point size (blended per particle) · jitter, then DOF growth.
  const pointSize = mix(chapter.from.motion.w, chapter.to.motion.w, look.morph);
  const jitter = mix(float(1).sub(mu.sizeJitter), float(1).add(mu.sizeJitter), h0.mul(h0)); // skewed: many small, few big
  const base = mu.size.mul(pointSize).mul(jitter);
  const viewDepth = modelViewMatrix.mul(vec4(centre, 1.0)).z.negate();
  const coc = abs(viewDepth.sub(mu.focusDistance)).mul(mu.aperture);
  const blurred = min(base.add(coc), base.mul(mu.maxBlur));
  // Never smaller than MIN pixels on screen: light is conserved through the energy term, not by shrinking.
  const minWorld = mu.minPixels.mul(max(viewDepth, 0.01)).div(mu.pixelsPerUnit);
  const size = max(blurred, minWorld);
  const energy = base.div(size);

  // Collapse culling: when (nearly) every particle is packed into a few pixels (the opening singularity, or the
  // hold-to-collapse star), additive overdraw on the same pixels serialises the GPU (20 fps at 1M). Particles
  // inside the dense star are thinned to COLLAPSED_KEEP of their number and the survivors carry their light.
  const inStar = mu.hold.mul(float(1).sub(smoothstep(mu.starRadius.mul(1.5), mu.starRadius.mul(6), distance(centre, mu.holdPoint))));
  const inSingularity = mu.singular.mul(float(1).sub(smoothstep(0.06, 0.3, length(centre))));
  const collapse = max(inStar, inSingularity);
  const keep = float(1).sub(collapse.mul(1 - COLLAPSED_KEEP));
  const visible = hash(instanceIndex.add(1237)).lessThan(keep);
  material.scaleNode = vec2(select(visible, size, float(0)), select(visible, size, float(0)));

  // Colour: palette per slot by w, crossfaded by the particle's own morph.
  const wc = clamp(look.brightness, 0, 1);
  const colFrom = mix(chapter.from.secondary, chapter.from.primary, wc);
  const colTo = mix(chapter.to.secondary, chapter.to.primary, wc);
  const colour = mix(colFrom, colTo, look.morph);

  // Brightness: dim secondaries, extra light on pulse heads, twinkle, speed glow, global fade.
  const lum = mix(float(0.2), float(1), wc).add(max(look.brightness.sub(1), 0).mul(1.4));
  // Slow, subtle breathing (periods 14–50 s): never a per-frame flicker.
  const twinkle = float(1).add(mu.twinkle.mul(sin(chapter.time.mul(mix(0.12, 0.45, h1)).add(h2.mul(6.283)))));
  const glow = float(1).add(mu.speedGlow.mul(smoothstep(0.8, 7, look.speed)));
  // Bigger sprites are dimmer (light ∝ jitter^½ instead of jitter²): a smooth density field, not bright speckles.
  const evenness = jitter.pow(-1.5).mul(0.8);
  const light = lum.mul(twinkle).mul(glow).mul(mu.intensity).mul(mu.fade).mul(energy.mul(energy)).mul(evenness).div(keep);

  const rgb = vertexStage(colour.mul(light));
  const alpha = look.opacity ?? float(1);

  // Fragment: soft gaussian disc.
  const d = uv().sub(0.5).length().mul(2.0);
  const falloff = exp(d.mul(d).mul(-4.5)).mul(float(1.0).sub(smoothstep(0.8, 1.0, d)));
  material.colorNode = vec4(rgb, 1.0);
  material.opacityNode = falloff.mul(alpha);
  return material;
}

/** `count` instances of the built-in sprite quad. Change `sprite.count` at runtime (no recompile while > 1). */
export function createParticleSprite(material: SpriteNodeMaterial, count: number): Sprite {
  const sprite = new Sprite(material);
  sprite.count = count;
  sprite.frustumCulled = false; // REQUIRED: a Sprite is culled by a ~0.7-unit sphere at its origin
  sprite.renderOrder = 1;
  return sprite;
}
