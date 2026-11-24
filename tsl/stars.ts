/**
 * Far static star field: a shell of tiny additive sprites (constant-ish pixel size, temperature-tinted,
 * power-law brightness), with a faint band of denser stars, slow twinkle (static under reduced motion).
 * Same Sprite + SpriteNodeMaterial pattern as the particles (works on WebGPU and WebGL2).
 */
import { InstancedBufferAttribute, Sprite, SpriteNodeMaterial, AdditiveBlending, type Object3D } from 'three/webgpu';
import {
  instancedBufferAttribute,
  instanceIndex,
  uniform,
  hash,
  float,
  vec2,
  vec3,
  vec4,
  mix,
  sin,
  exp,
  smoothstep,
  uv,
  length,
  max,
  vertexStage,
} from 'three/tsl';
import { tuning } from '@/lib/tuning';

export interface StarField {
  object: Object3D;
  update(time: number, reducedMotion: boolean, fade: number, pixelsPerUnit?: number): void;
  dispose(): void;
}

/** mulberry32: deterministic star placement. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createStarField({ count }: { count: number }): StarField {
  const data = new Float32Array(count * 4);
  const r = rng(0x5ea7);
  // Band normal (a tilted "galactic plane").
  const nx = 0.25, ny = 0.92, nz = 0.3;
  const nl = Math.hypot(nx, ny, nz);
  for (let i = 0; i < count; i++) {
    let x = 0, y = 0, z = 0;
    // 35% of the stars concentrate near the band.
    const inBand = r() < 0.35;
    for (let tries = 0; tries < 8; tries++) {
      const u = 2 * r() - 1;
      const a = 2 * Math.PI * r();
      const s = Math.sqrt(1 - u * u);
      x = s * Math.cos(a); y = u; z = s * Math.sin(a);
      if (!inBand) break;
      const d = Math.abs((x * nx + y * ny + z * nz) / nl);
      if (d < 0.18 * r()) break;
    }
    const radius = 60 + 70 * r();
    data[i * 4] = x * radius;
    data[i * 4 + 1] = y * radius;
    data[i * 4 + 2] = z * radius;
    data[i * 4 + 3] = Math.pow(r(), 5); // power law: few bright stars
  }
  const attr = new InstancedBufferAttribute(data, 4);
  const a = instancedBufferAttribute<'vec4'>(attr);

  const uTime = uniform(0);
  const uTwinkle = uniform(1);
  const uIntensity = uniform(tuning.render.stars);
  /** World size per unit distance of a 4-physical-pixel quad (set from the frame's pixels-per-unit). */
  const uMinPx = uniform(0);

  const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending });
  material.positionNode = a.xyz;
  const dist = length(a.xyz);
  // ≈ 2–5 px at fov 40 / 900 px tall, independent of distance.
  const px = max(dist.mul(0.0024).mul(mix(0.8, 2.6, a.w)), dist.mul(uMinPx));
  material.scaleNode = vec2(px, px);
  const h = hash(instanceIndex.add(31));
  const tint = mix(vec3(0.62, 0.74, 1.0), vec3(1.0, 0.86, 0.7), h.mul(h)); // blue-white → warm
  const tw = float(1).add(uTwinkle.mul(0.12).mul(sin(uTime.mul(mix(0.15, 0.6, hash(instanceIndex.add(97)))).add(h.mul(40)))));
  const light = mix(0.05, 1.3, a.w).mul(tw).mul(uIntensity);
  const rgb = vertexStage(tint.mul(light));
  const d = uv().sub(0.5).length().mul(2.0);
  const falloff = exp(d.mul(d).mul(-7.0)).mul(float(1).sub(smoothstep(0.7, 1, d)));
  material.colorNode = vec4(rgb, 1);
  material.opacityNode = falloff;

  const sprite = new Sprite(material);
  sprite.count = count;
  sprite.frustumCulled = false;
  sprite.renderOrder = 0;

  return {
    object: sprite,
    update(time: number, reducedMotion: boolean, fade: number, pixelsPerUnit?: number) {
      if (pixelsPerUnit) uMinPx.value = 4 / pixelsPerUnit;
      uTime.value = reducedMotion ? 0 : time;
      uTwinkle.value = reducedMotion ? 0 : 1;
      uIntensity.value = tuning.render.stars * (0.55 + 0.45 * fade);
    },
    dispose() {
      material.dispose();
    },
  };
}
