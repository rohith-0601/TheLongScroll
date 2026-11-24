'use client';

/**
 * The R3F canvas (client-only; loaded by SceneRoot through next/dynamic with ssr:false).
 *
 * Renderer: async `gl` factory → three's WebGPURenderer (WebGPU, or the WebGL2 backend forced up front when the
 * profile says so — no fallback warning). R3F's own render is skipped by the priority-1 useFrame, which runs the
 * whole frame (ARCHITECTURE §5): store → camera rig → pointer ray / hold point → particles (compute) → stars →
 * post → adaptive quality → probe.
 */
import './three-console'; // first: installs the three console filter before R3F creates its store
import { useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PCFShadowMap, Plane, Raycaster, Vector2, Vector3, WebGPURenderer, type PerspectiveCamera, type Scene } from 'three/webgpu';
import { useExperience, type Backend } from '@/lib/store';
import { AdaptiveQuality, type QualityProfile } from '@/lib/quality';
import type { FormationSet } from '@/lib/formations/client';
import { createCameraRig, type CameraRig } from '@/lib/camera';
import { tuning } from '@/lib/tuning';
import { createParticleSystem, type ParticleFrame, type ParticleSystem } from '@/tsl/particles';
import { createStarField, type StarField } from '@/tsl/stars';
import { createPost, type PostChain } from '@/tsl/post';
import { chapterBlend } from '@/tsl/chapters';
import { sceneRuntime } from './runtime';

export interface FormationsHandle {
  /** Cleared by the consumer once awaited, so the (large) CPU copy can be garbage-collected. */
  promise: Promise<FormationSet> | null;
}

export interface ExperienceProps {
  profile: QualityProfile;
  formations: FormationsHandle;
  onProgress(fraction: number): void;
  onReady(): void;
  onFail(reason: string): void;
  /** WebGPU was expected but the renderer ended up on WebGL2 (device creation failed). */
  onBackendMismatch(): void;
}

/** No-op R3F event layer: no DOM listeners, no raycasting (input comes from lib/input.ts via the store). */
const noEvents = () => ({ enabled: false, priority: 0 });
const never = <T,>(): Promise<T> => new Promise<T>(() => {});

function backendOf(renderer: WebGPURenderer): Backend {
  return (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true ? 'webgpu' : 'webgl2';
}

/** Used only if lib/camera.ts fails to create its rig (keeps the scene alive). */
function fallbackRig(): CameraRig {
  return {
    update(camera, f) {
      camera.aspect = f.width / Math.max(1, f.height);
      camera.fov = 40;
      camera.position.set(0, 0.4, 9.5);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
    },
    focusDistance: () => 9.5,
    dispose() {},
    source: 'fallback',
  } as CameraRig;
}

interface Runtime {
  particles: ParticleSystem;
  stars: StarField;
  post: PostChain;
  rig: CameraRig;
  adaptive: AdaptiveQuality;
  postLevel: 0 | 1 | 2;
  dpr: number;
}

const smooth01 = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function SceneContent(props: ExperienceProps) {
  const gl = useThree((s) => s.gl) as unknown as WebGPURenderer;
  const scene = useThree((s) => s.scene) as unknown as Scene;
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const setDpr = useThree((s) => s.setDpr);
  const size = useThree((s) => s.size);
  const rt = useRef<Runtime | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  // Per-frame scratch state (never React state).
  const st = useRef({
    time: 0,
    frames: 0,
    fps: 60,
    probeAt: 0,
    ready: false,
    ndc: new Vector2(),
    raycaster: new Raycaster(),
    plane: new Plane(),
    normal: new Vector3(),
    holdPoint: new Vector3(),
    hit: new Vector3(),
    pointerVel: new Vector3(),
    right: new Vector3(),
    up: new Vector3(),
    frame: null as ParticleFrame | null,
    buffer: new Vector2(),
    /** `?noadapt` disables adaptive quality (raw FPS measurements). */
    noAdapt: typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('noadapt'),
  });

  useEffect(() => {
    let disposed = false;
    let local: Runtime | null = null;
    const { profile } = propsRef.current;
    (async () => {
      try {
        const handle = propsRef.current.formations;
        const pending = handle.promise;
        if (!pending) throw new Error('formations missing');
        const [set, rig] = await Promise.all([pending, createCameraRig().catch(() => fallbackRig())]);
        handle.promise = null;
        if (disposed) return;
        propsRef.current.onProgress(0.93);

        camera.near = 0.05;
        camera.far = 400;
        camera.updateProjectionMatrix();
        scene.background = null; // the post chain draws a display-referred background

        const backend = backendOf(gl);
        const particles = createParticleSystem({ renderer: gl, backend, mode: profile.mode, formations: set });
        particles.setActiveCount(profile.activeCount);
        scene.add(particles.object);
        const stars = createStarField({ count: profile.stars });
        scene.add(stars.object);
        const reduced = useExperience.getState().reducedMotion;
        const post = createPost(gl, scene, camera, {
          ...tuning.post,
          quality: profile.post,
          grainAnimated: !reduced,
          background: 0x020308,
          backgroundCenter: 0x03040b,
        });
        const runtime: Runtime = {
          particles,
          stars,
          post,
          rig,
          postLevel: profile.post,
          dpr: Math.min(profile.dpr[1], window.devicePixelRatio || 1),
          adaptive: new AdaptiveQuality(profile, {
            setDpr: (d) => {
              runtime.dpr = d;
              setDpr(d);
            },
            setPost: (l) => {
              runtime.postLevel = l;
              post.setQuality(l);
            },
            setActiveCount: (n) => particles.setActiveCount(n),
          }),
        };
        local = runtime;
        rt.current = runtime;
        if (process.env.NODE_ENV === 'development') {
          // Dev-only: force an adaptive level for measurements (adaptive stepping stops while forced).
          window.__qualityLadder = runtime.adaptive.ladder;
          window.__setQualityLevel = (n: number) => {
            st.current.noAdapt = true;
            return runtime.adaptive.setLevel(n);
          };
        }
        sceneRuntime.renderer = gl;
        sceneRuntime.backend = backend;
        propsRef.current.onProgress(0.97);
      } catch (err) {
        if (!disposed) propsRef.current.onFail(`scene-init: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
    return () => {
      disposed = true;
      rt.current = null;
      if (local) {
        local.particles.dispose();
        local.stars.dispose();
        local.post.dispose();
        local.rig.dispose();
        scene.remove(local.stars.object);
      }
      sceneRuntime.renderer = null;
      sceneRuntime.backend = null;
    };
  }, [gl, scene, camera, setDpr]);

  useFrame((_state, delta) => {
    const r = rt.current;
    if (!r) return;
    const s = st.current;
    let x = useExperience.getState();
    if (process.env.NODE_ENV === 'development' && window.__sceneOverride) x = { ...x, ...window.__sceneOverride };

    // dt: skip the first frame after a tab switch; clamp the simulation step.
    const skipped = delta > 0.25;
    const dt = skipped ? 0 : Math.min(delta, 1 / 20);
    s.time += dt;

    // 1. camera
    const p = x.pointer;
    r.rig.update(camera, {
      progress: x.progress,
      time: s.time,
      dt,
      pointer: p.active ? { x: p.x, y: p.y } : { x: 0, y: 0 },
      frontier: x.frontier,
      reducedMotion: x.reducedMotion,
      width: size.width,
      height: size.height,
    });
    camera.updateMatrixWorld();
    const focus = r.rig.focusDistance();

    // 2. pointer ray → world; hold point = ray ∩ plane through the formation centre facing the camera
    s.ndc.set(p.x, p.y);
    s.raycaster.setFromCamera(s.ndc, camera);
    const ray = s.raycaster.ray;
    s.normal.copy(camera.position).normalize();
    if (s.normal.lengthSq() < 1e-6) s.normal.set(0, 0, 1);
    s.plane.setFromNormalAndCoplanarPoint(s.normal, new Vector3(0, 0, 0));
    const following = x.holding || (x.hold < 0.01 && x.burst < 0.01);
    if (following) {
      if (p.active && ray.intersectPlane(s.plane, s.hit)) s.holdPoint.copy(s.hit);
      else if (!p.active) s.holdPoint.set(0, 0, 0);
    }
    // pointer velocity NDC/s → world units/s at the focus plane
    const halfH = focus * Math.tan(((camera.fov * Math.PI) / 180) * 0.5);
    s.right.setFromMatrixColumn(camera.matrixWorld, 0);
    s.up.setFromMatrixColumn(camera.matrixWorld, 1);
    s.pointerVel
      .copy(s.right)
      .multiplyScalar(p.vx * halfH * camera.aspect)
      .addScaledVector(s.up, p.vy * halfH);
    if (!p.active) s.pointerVel.set(0, 0, 0);

    // 3. frontier: chapter 9 settles flat, particles dim slightly under the frontier
    const settle = smooth01(0.05, 0.9, x.frontier);
    const fade = 1 - 0.4 * smooth01(0.1, 1, x.frontier);

    const f: ParticleFrame = s.frame ?? {
      time: 0,
      dt: 0,
      progress: 0,
      hold: 0,
      burst: 0,
      pointerRay: { origin: new Vector3(), direction: new Vector3(0, 0, -1), active: false },
      pointerVelocity: new Vector3(),
      holdPoint: new Vector3(),
      cameraPosition: new Vector3(),
      focusDistance: 9,
      settle: 0,
      fade: 1,
      reducedMotion: false,
      velocity: 0,
    };
    s.frame = f;
    f.time = s.time;
    f.dt = dt;
    f.progress = x.progress;
    f.hold = x.hold;
    f.burst = x.burst;
    f.pointerRay.origin.copy(ray.origin);
    f.pointerRay.direction.copy(ray.direction);
    f.pointerRay.active = p.active && !x.reducedMotion;
    f.pointerVelocity.copy(s.pointerVel);
    f.holdPoint.copy(s.holdPoint);
    f.cameraPosition.copy(camera.position);
    f.focusDistance = focus;
    f.settle = settle;
    f.fade = fade;
    f.reducedMotion = x.reducedMotion;
    f.velocity = x.velocity;
    gl.getDrawingBufferSize(s.buffer);
    f.pixelsPerUnit = (s.buffer.y * camera.projectionMatrix.elements[5]!) / 2;

    // 4. particles (compute on WebGPU), 5. stars + post
    r.particles.update(f);
    r.stars.update(s.time, x.reducedMotion, fade, f.pixelsPerUnit);
    r.stars.object.rotation.y = x.progress * 0.035;
    const blend = chapterBlend(x.progress);
    r.post.update({ time: s.time, bloom: blend.bloom, reducedMotion: x.reducedMotion, fade });
    r.post.render();
    sceneRuntime.afterFrame?.();

    // 6. adaptive quality + probe
    if (!skipped) {
      if (!s.noAdapt) r.adaptive.frame(delta);
      if (delta > 0) s.fps += (1 / delta - s.fps) * Math.min(1, delta * 2);
    }
    s.frames++;
    const now = performance.now();
    if (now - s.probeAt > 500) {
      s.probeAt = now;
      window.__scene = {
        backend: sceneRuntime.backend,
        mode: r.particles.mode,
        particleCount: r.particles.count,
        activeCount: r.particles.activeCount,
        fps: Math.round(s.fps * 10) / 10,
        qualityLevel: r.adaptive.level,
        frames: s.frames,
        dpr: r.dpr,
        postLevel: r.postLevel,
      };
    }
    if (!s.ready && s.frames >= 3) {
      s.ready = true;
      propsRef.current.onProgress(1);
      propsRef.current.onReady();
    }
  }, 1);

  return null;
}

export default function Experience(props: ExperienceProps) {
  const { profile } = props;
  const propsRef = useRef(props);
  propsRef.current = props;

  return (
    <Canvas
      gl={async (defaults) => {
        const wantWebGPU = profile.backend === 'webgpu';
        let renderer: WebGPURenderer | null = null;
        try {
          renderer = new WebGPURenderer({
            canvas: defaults.canvas as HTMLCanvasElement,
            antialias: false,
            alpha: false,
            powerPreference: 'high-performance',
            forceWebGL: !wantWebGPU,
            requiredLimits: wantWebGPU ? profile.requiredLimits : undefined,
          });
          await renderer.init(); // backend is only final after init (fallback happens inside init)
        } catch (err) {
          propsRef.current.onFail(`renderer-init: ${err instanceof Error ? err.message : String(err)}`);
          return never<WebGPURenderer>();
        }
        if (wantWebGPU && backendOf(renderer) !== 'webgpu') {
          void renderer.dispose();
          propsRef.current.onBackendMismatch();
          return never<WebGPURenderer>();
        }
        renderer.onDeviceLost = (info) => {
          if ((info as { reason?: string }).reason === 'destroyed') return;
          propsRef.current.onFail('device-lost');
        };
        renderer.setClearColor(0x000000, 1);
        return renderer;
      }}
      flat // NoToneMapping on the renderer: the post chain tone maps itself (renderOutput mid-chain)
      shadows={{ enabled: false, type: PCFShadowMap }}
      dpr={profile.dpr}
      frameloop="always"
      events={noEvents}
      resize={{ scroll: false, debounce: { scroll: 0, resize: 100 } }}
      camera={{ position: [0, 0.4, 9], fov: 40, near: 0.05, far: 400 }}
      style={{ pointerEvents: 'none', width: '100%', height: '100%' }}
      aria-hidden="true"
    >
      <SceneContent {...props} />
    </Canvas>
  );
}
