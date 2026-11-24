/**
 * Particle system factory — one API for the three paths (ARCHITECTURE §6):
 *  - 'simulate'  WebGPU compute physics (tsl/particles.compute.ts), up to 1M particles
 *  - 'morph'     WebGL2 vertex-shader morph (tsl/particles.morph.ts), 100K
 *  - 'crossfade' prefers-reduced-motion: static layers crossfaded by a slowly-eased weight
 * All share the chapter uniforms (tsl/chapters.ts) and the sprite material (tsl/particles.material.ts).
 */
import { Group, Vector3, type Object3D, type WebGPURenderer, type Sprite } from 'three/webgpu';
import type { Backend } from '@/lib/store';
import type { FormationSet } from '@/lib/formations/client';
import { tuning } from '@/lib/tuning';
import { createChapterUniforms, createSlot, updateChapterUniforms, writeSlot, type ChapterFrameOptions } from './chapters';
import { BASE_INTENSITY, createMaterialUniforms, createParticleMaterial, createParticleSprite, intensityForCount, sizeForCount } from './particles.material';
import { createParticleSim, createSimUniforms, type ParticleSim, type SimUniforms } from './particles.compute';
import { createMorphParticles, createStaticLayer, type MorphParticles, type StaticLayer } from './particles.morph';

export type ParticleMode = 'simulate' | 'morph' | 'crossfade';

export interface ParticleSystemOptions {
  renderer: WebGPURenderer;
  backend: Backend;
  mode: ParticleMode;
  /** lib/formations/client.ts (packed 9 × N × vec4). */
  formations: FormationSet;
  activeCount?: number;
}

export interface ParticleFrame {
  time: number;
  dt: number;
  progress: number;
  hold: number;
  burst: number;
  pointerRay: { origin: Vector3; direction: Vector3; active: boolean };
  /** World units/s at the focus plane. */
  pointerVelocity: Vector3;
  /** Where the universe collapses to. */
  holdPoint: Vector3;
  cameraPosition: Vector3;
  focusDistance: number;
  /** 0..1 chapter-9 grid settles near the frontier. */
  settle: number;
  /** 0..1 global particle intensity (dims under the frontier). */
  fade: number;
  reducedMotion: boolean;
  /** Physical pixels per world unit at distance 1 (drawing-buffer height · P[1][1] / 2): minimum sprite size. */
  pixelsPerUnit?: number;
  /** Optional: scroll velocity (progress units/s), used as the speed-glow proxy in 'morph' mode. */
  velocity?: number;
}

export interface ParticleSystem {
  readonly object: Object3D;
  readonly count: number;
  activeCount: number;
  readonly mode: ParticleMode;
  update(frame: ParticleFrame): void;
  setActiveCount(n: number): void;
  dispose(): void;
}

/** Curl noise RMS ≈ 8.6 (research §4): tuning.physics.turbulence × this = acceleration scale. */
const TURBULENCE_GAIN = 1.15;
/** Burst envelope (decays in ~0.4 s) → impulse; tuned so a full collapse throws particles ~2–3 units. */
const BURST_GAIN = 1; // folded into tuning.hold.burst
/** The cursor should part the dust gently (a hand through dust), not punch a clean hole. */
const POINTER_GAIN = 1; // folded into tuning.pointer.strength
/** Crossfade easing time constant (s). */
const CROSSFADE_TAU = 0.55;

/** Particle brightness multiplier while everything sits in the singularity. */
const SINGULARITY_DIM = 0.12;

const _axis = new Vector3();
const smoothstepJs = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function applyPhysicsTuning(u: SimUniforms): void {
  const ph = tuning.physics;
  u.stiffness.value = ph.stiffness;
  u.stiffnessJitter.value = ph.stiffnessJitter;
  u.damping.value = ph.damping;
  u.turbulence.value = ph.turbulence * TURBULENCE_GAIN;
  u.noiseScale.value = ph.turbulenceScale;
  u.maxSpeed.value = ph.maxSpeed;
  u.pointerRadius.value = tuning.pointer.radius;
  u.pointerStrength.value = tuning.pointer.strength * POINTER_GAIN;
  u.pointerDrag.value = tuning.pointer.drag;
  u.holdStrength.value = tuning.hold.strength;
  u.swirl.value = tuning.hold.swirl;
  u.starRadius.value = tuning.hold.starRadius;
  u.burstStrength.value = tuning.hold.burst * BURST_GAIN;
}

export function createParticleSystem(opts: ParticleSystemOptions): ParticleSystem {
  const { renderer, mode, formations } = opts;
  const count = formations.count;
  const chapter = createChapterUniforms();
  const mu = createMaterialUniforms();
  const group = new Group();
  group.name = 'particles';

  let sim: ParticleSim | null = null;
  let morph: MorphParticles | null = null;
  let layers: StaticLayer[] = [];
  let simU: SimUniforms;
  const sprites: Sprite[] = [];
  let loadedPair = '';
  let pointerActive = 0;

  if (mode === 'simulate') {
    sim = createParticleSim(count, formations.packed, chapter);
    simU = sim.uniforms;
    const pos4 = sim.positions.toAttribute(); // instanced vertex attribute (works in WebGPU compat mode too)
    const vel4 = sim.velocities.toAttribute();
    const material = createParticleMaterial(
      { center: pos4.xyz, morph: pos4.w, brightness: vel4.w, speed: vel4.xyz.length() },
      chapter,
      mu,
    );
    const sprite = createParticleSprite(material, count);
    sprites.push(sprite);
    group.add(sprite);
    renderer.compute(sim.init); // creates the GPU buffers and uploads the formations (one time)
  } else if (mode === 'morph') {
    simU = createSimUniforms();
    morph = createMorphParticles(count, chapter, mu, simU);
    sprites.push(morph.sprite);
    group.add(morph.sprite);
  } else {
    simU = createSimUniforms();
    const slots = [createSlot(), createSlot()];
    layers = slots.map((slot) => createStaticLayer(count, slot, chapter.time, mu));
    for (const l of layers) {
      sprites.push(l.sprite);
      group.add(l.sprite);
    }
  }

  const system: ParticleSystem = {
    object: group,
    count,
    activeCount: count,
    mode,
    update(f: ParticleFrame) {
      const dt = Math.min(Math.max(f.dt, 0), 1 / 20);
      const chapterOpts: ChapterFrameOptions = { time: f.time, reducedMotion: f.reducedMotion, settle: f.settle };
      const ms = updateChapterUniforms(chapter, f.progress, chapterOpts);
      chapter.delaySpread.value = tuning.physics.delaySpread;
      chapter.waveOrder.value = tuning.physics.waveOrder;

      // Material
      const r = tuning.render;
      mu.size.value = sizeForCount(system.activeCount);
      mu.sizeJitter.value = r.sizeJitter;
      // The singularity packs every particle into a few pixels: dim it so it reads as a point, not a haze.
      const singular = ms.from === 0 ? 1 - smoothstepJs(0, 0.6, ms.t) : 0;
      mu.intensity.value =
        BASE_INTENSITY * r.brightness * intensityForCount(system.activeCount) * (1 - (1 - SINGULARITY_DIM) * singular);
      if (f.pixelsPerUnit) mu.pixelsPerUnit.value = f.pixelsPerUnit;
      mu.focusDistance.value = f.focusDistance;
      mu.aperture.value = r.dofAperture;
      mu.maxBlur.value = r.dofMaxBlur;
      mu.twinkle.value = f.reducedMotion ? 0 : r.twinkle;
      mu.speedGlow.value = r.speedGlow;
      mu.fade.value = f.fade;
      mu.singular.value = ms.from === 0 ? 1 - smoothstepJs(0, 0.5, ms.t) : 0;
      mu.starRadius.value = tuning.hold.starRadius;
      mu.holdPoint.value.copy(f.holdPoint);

      // Interaction
      applyPhysicsTuning(simU);
      simU.dt.value = dt;
      const interactive = mode !== 'crossfade';
      pointerActive += ((f.pointerRay.active && interactive ? 1 : 0) - pointerActive) * Math.min(1, dt * 8);
      simU.pointerActive.value = pointerActive;
      simU.rayOrigin.value.copy(f.pointerRay.origin);
      simU.rayDir.value.copy(f.pointerRay.direction);
      simU.pointerVel.value.copy(f.pointerVelocity);
      simU.holdPoint.value.copy(f.holdPoint);
      _axis.copy(f.cameraPosition).sub(f.holdPoint);
      if (_axis.lengthSq() < 1e-8) _axis.set(0, 0, 1);
      simU.holdAxis.value.copy(_axis.normalize());
      simU.hold.value = interactive ? f.hold : 0;
      mu.hold.value = simU.hold.value;
      simU.burst.value = interactive ? f.burst : 0;

      if (sim) {
        if (dt > 0) renderer.compute(sim.update);
      } else if (morph) {
        const pair = `${chapter.dataFrom.value}:${chapter.dataTo.value}`;
        if (pair !== loadedPair) {
          morph.setFormations(formations.at(chapter.dataFrom.value), formations.at(chapter.dataTo.value));
          loadedPair = pair;
        }
        morph.turbulence.value = f.reducedMotion ? 0 : tuning.physics.turbulence * 0.42;
        morph.speedProxy.value = Math.min(8, Math.abs(f.velocity ?? 0) * 6);
        simU.burst.value = interactive ? f.burst * tuning.hold.burst * (0.16 / 1.5) : 0;
      } else {
        updateCrossfade(ms.from, ms.to, ms.t, f.dt, chapterOpts);
      }
    },
    setActiveCount(n: number) {
      const c = Math.max(1, Math.min(count, Math.round(n)));
      system.activeCount = c;
      sim?.setActiveCount(c);
      for (const s of sprites) s.count = c;
    },
    dispose() {
      group.removeFromParent();
      morph?.dispose();
      for (const l of layers) l.dispose();
      for (const s of sprites) (s.material as { dispose(): void }).dispose();
    },
  };

  function updateCrossfade(from: number, to: number, t: number, rawDt: number, o: ChapterFrameOptions): void {
    const target = (fi: number): number => (fi === from ? 1 - t : 0) + (fi === to ? t : 0);
    const k = 1 - Math.exp(-Math.min(rawDt, 0.1) / CROSSFADE_TAU);
    for (const l of layers) {
      if (l.formation >= 0) l.weight += (target(l.formation) - l.weight) * k;
    }
    // Load the formations the target needs (dominant first) into layers that are invisible and unneeded.
    const wanted = t < 0.5 ? [from, to] : [to, from];
    for (const fi of wanted) {
      if (layers.some((l) => l.formation === fi)) continue;
      const free = layers.find((l) => l.weight < 0.004 && (l.formation < 0 || target(l.formation) === 0));
      if (!free) break;
      free.load(formations.at(Math.max(0, fi - 1)), fi);
      free.weight = 0;
    }
    for (const l of layers) {
      if (l.formation >= 0) writeSlot(l.slot, l.formation, o);
      const w = Math.min(1, Math.max(0, l.weight));
      const e = w * w * (3 - 2 * w);
      l.opacity.value = e;
      l.sprite.visible = e > 0.002;
    }
  }

  return system;
}
