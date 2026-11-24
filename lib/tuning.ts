/**
 * Live-tunable parameters. A plain mutable object: the scene reads it every frame (cheap), and in
 * development the leva panel (components/dev/DevTools.tsx) writes into it. Production uses these
 * defaults as-is. Keep units in comments; keep it serialisable.
 */
export const tuning = {
  physics: {
    /** Spring stiffness toward the target (1/s²). */
    stiffness: 26,
    /** ± fraction of per-particle stiffness variation (organic, wave-like arrival). */
    stiffnessJitter: 0.45,
    /** Velocity damping (1/s). ~2·sqrt(stiffness) is critical. */
    damping: 5.6,
    /** Curl-noise turbulence acceleration at mid-transition (world units/s²). */
    turbulence: 2.6,
    /** Spatial frequency of the curl noise (1/world unit). */
    turbulenceScale: 0.55,
    /** Speed clamp (world units/s). */
    maxSpeed: 14,
    /** Fraction of the transition window used to stagger per-particle start times. */
    delaySpread: 0.62,
    /** Weight of spatial ordering (vs pure random) in the stagger → waves instead of noise. */
    waveOrder: 0.35,
  },
  pointer: {
    /** Push radius around the pointer ray (world units). */
    radius: 0.85,
    /** Push acceleration (world units/s²). */
    strength: 9,
    /** How much pointer velocity drags particles along (0..1). */
    drag: 0.55,
  },
  hold: {
    /** Seconds of stillness before a press becomes a hold. */
    delay: 0.18,
    /** Attraction stiffness toward the pointer at full hold (1/s²). */
    strength: 60,
    /** Tangential swirl around the pointer axis at full hold (world units/s²). */
    swirl: 9,
    /** Radius of the collapsed star (world units). */
    starRadius: 0.07,
    /** Outward impulse on release at full collapse (world units/s). */
    burst: 19.5,
    /** Time constant (s) of the hold ramp-in / release. */
    rampIn: 0.85,
    rampOut: 0.16,
  },
  render: {
    /** Base sprite size in world units at 1M particles (scaled by sqrt(1e6 / activeCount)). */
    size: 0.02,
    /** ± fraction of per-particle size variation. */
    sizeJitter: 0.45,
    /** Global particle brightness. */
    brightness: 1,
    /** Depth-of-field: circle of confusion per world unit away from the focus distance. */
    dofAperture: 0.015,
    /** Max sprite growth from DOF (multiplier). */
    dofMaxBlur: 3,
    /** Idle twinkle amount (0 under reduced motion). */
    twinkle: 0.04,
    /** Extra brightness for fast-moving particles during transitions. */
    speedGlow: 0.35,
    /** Star field brightness. */
    stars: 0.9,
  },
  post: {
    bloomStrength: 0.68,
    bloomRadius: 0.1375,
    bloomThreshold: 0.3,
    /** Chromatic aberration (UV offset at the corners). */
    chromatic: 0.0022,
    vignette: 0.34,
    grain: 0,
    exposure: 1,
  },
  camera: {
    /** Idle orbital drift amplitude (world units). 0 under reduced motion. */
    drift: 0.32,
    /** Idle drift angular speed (rad/s). */
    driftSpeed: 0.07,
    /** Mouse parallax amplitude (world units). 0 under reduced motion. */
    parallax: 0.42,
    /** Lens shift that moves the formation away from the text (fraction of viewport). */
    lensShiftX: 0.16,
    lensShiftY: 0.11,
    /** Exponential smoothing rate for parallax/lens shift (1/s). */
    smoothing: 3.5,
  },
  scroll: {
    /** Lenis lerp (lower = heavier, more inertia). */
    lerp: 0.07,
    wheelMultiplier: 0.85,
    touchMultiplier: 1.35,
    /** Scroll length of one chapter, in viewport heights. */
    chapterLength: 1.5,
  },
};

export type Tuning = typeof tuning;
