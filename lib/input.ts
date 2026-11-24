/**
 * Pointer + hold-to-collapse input.
 *
 * CONTRACT (implementation owner: "systems" agent). Browser-only; call initInput() once from
 * components/system/ExperienceController.tsx. Returns a cleanup function.
 *
 * Pointer (Pointer Events on window, passive listeners):
 *  - mouse/pen move → store.pointer {x, y} in NDC (-1..1, y up), smoothed velocity {vx, vy} (NDC/s),
 *    active = true; pointerleave/blur → active = false. Touch: active while touching.
 * Hold to collapse ("press and hold anywhere", mouse AND touch):
 *  - pointerdown (primary button) starts a timer of tuning.hold.delay s. If the pointer moves more
 *    than ~8 px (or the browser starts scrolling → pointercancel) before that, cancel: it was a
 *    drag/scroll/text selection. Otherwise holding = true until pointerup/pointercancel/blur.
 *  - Ignore presses that start on interactive or opted-out elements: a, button, input, textarea,
 *    select, label, [contenteditable], [data-no-hold] (and their descendants).
 *  - While holding: prevent the context menu and text selection (contextmenu / selectstart
 *    preventDefault), and add html.is-holding (CSS: user-select none, cursor). Do NOT block
 *    scrolling when not holding. Never call preventDefault on pointerdown itself.
 *  - Disabled when holdEnabled is false (static mode).
 * Dynamics on the shared ticker (lib/ticker.ts):
 *  - hold eases toward 1 while holding with time constant tuning.hold.rampIn (ease-in feel: slow
 *    start, accelerating), toward 0 on release with tuning.hold.rampOut.
 *  - On release with hold > 0.02: burst = hold (collapse strength), then burst decays
 *    exponentially to 0 over ~0.4 s.
 *  - Pointer velocity decays toward 0 when the pointer stops.
 */
import { getExperience, setExperience, type ExperienceState, type PointerState } from './store';
import { tuning } from './tuning';
import { onTick } from './ticker';

export interface InputOptions {
  holdEnabled: boolean;
}

const NO_HOLD_SELECTOR = 'a, button, input, textarea, select, label, summary, [contenteditable], [contenteditable=""], [data-no-hold]';
/** Movement (CSS px) that turns a pending press into a drag / scroll / selection. */
const MOVE_CANCEL_PX = 8;
/** Burst time constant (s): exp(-0.4 / 0.13) ≈ 0.05 → gone in ~0.4 s. */
const BURST_TAU = 0.13;

export function initInput(opts: InputOptions): () => void {
  const root = document.documentElement;
  const holdEnabled = opts.holdEnabled;

  // ---- Pointer state (raw, accumulated between ticks).
  let x = 0;
  let y = 0;
  let active = false;
  let type: PointerState['type'] = null;
  let accDx = 0;
  let accDy = 0;
  let vx = 0;
  let vy = 0;
  let hasPos = false;

  const toNdc = (cx: number, cy: number): [number, number] => [
    (cx / Math.max(1, window.innerWidth)) * 2 - 1,
    -((cy / Math.max(1, window.innerHeight)) * 2 - 1),
  ];

  const track = (e: PointerEvent): void => {
    const [nx, ny] = toNdc(e.clientX, e.clientY);
    if (hasPos) {
      accDx += nx - x;
      accDy += ny - y;
    }
    x = nx;
    y = ny;
    hasPos = true;
  };

  // ---- Hold state.
  let pressId: number | null = null;
  let pressX = 0;
  let pressY = 0;
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let holding = false;
  let h = 0; // internal eased ramp (hold = h²: slow start, accelerating)
  let hold = 0;
  let burst = 0;

  const clearTimer = (): void => {
    if (pressTimer !== null) clearTimeout(pressTimer);
    pressTimer = null;
  };

  const setHolding = (v: boolean): void => {
    if (holding === v) return;
    holding = v;
    root.classList.toggle('is-holding', v);
    if (v) {
      // Drop any selection a slow press may have started.
      window.getSelection()?.removeAllRanges();
    } else if (hold > 0.02) {
      burst = Math.max(burst, hold);
    }
    setExperience({ holding: v });
  };

  const endPress = (): void => {
    clearTimer();
    pressId = null;
    setHolding(false);
  };

  // ---- Listeners.
  const onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      if (e.pointerId !== pressId && !e.isPrimary) return;
      if (!active) return; // only while touching
    } else {
      active = true;
    }
    type = (e.pointerType as PointerState['type']) || 'mouse';
    track(e);
    if (pressId === e.pointerId && !holding && pressTimer !== null) {
      const dx = e.clientX - pressX;
      const dy = e.clientY - pressY;
      if (dx * dx + dy * dy > MOVE_CANCEL_PX * MOVE_CANCEL_PX) endPress();
    }
  };

  const onPointerDown = (e: PointerEvent): void => {
    type = (e.pointerType as PointerState['type']) || 'mouse';
    if (e.pointerType === 'touch') {
      if (!e.isPrimary) return;
      hasPos = false; // no velocity spike from the previous touch location
      active = true;
    } else {
      active = true;
    }
    track(e);

    if (!holdEnabled || !e.isPrimary || e.button !== 0) return;
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest(NO_HOLD_SELECTOR)) return;
    clearTimer();
    setHolding(false);
    pressId = e.pointerId;
    pressX = e.clientX;
    pressY = e.clientY;
    pressTimer = setTimeout(() => {
      pressTimer = null;
      if (pressId === e.pointerId) setHolding(true);
    }, tuning.hold.delay * 1000);
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType === 'touch' && e.isPrimary) active = false;
    if (e.pointerId === pressId) endPress();
  };

  const onPointerCancel = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') active = false;
    if (e.pointerId === pressId) endPress();
  };

  const onMouseOut = (e: MouseEvent): void => {
    if (!e.relatedTarget) active = false; // left the window
  };

  const onBlur = (): void => {
    active = false;
    endPress();
  };

  const onVisibility = (): void => {
    if (document.hidden) onBlur();
  };

  const preventWhileHolding = (e: Event): void => {
    if (holding) e.preventDefault();
  };

  // Touch: once a hold has begun, keep the finger from scrolling the page (and so from cancelling
  // the hold). A no-op whenever we are not holding, so scrolling is never blocked otherwise.
  const onTouchMove = (e: TouchEvent): void => {
    if (holding && e.cancelable) e.preventDefault();
  };

  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerdown', onPointerDown, { passive: true });
  window.addEventListener('pointerup', onPointerUp, { passive: true });
  window.addEventListener('pointercancel', onPointerCancel, { passive: true });
  document.addEventListener('mouseout', onMouseOut, { passive: true });
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('contextmenu', preventWhileHolding);
  document.addEventListener('selectstart', preventWhileHolding);
  if (holdEnabled) window.addEventListener('touchmove', onTouchMove, { passive: false });

  // ---- Dynamics on the shared ticker.
  const offTick = onTick((_time, dt) => {
    if (dt <= 0) return;

    // Pointer velocity: instantaneous from the displacement since the last tick, smoothed; decays
    // naturally to 0 once the pointer stops.
    const ivx = accDx / dt;
    const ivy = accDy / dt;
    accDx = 0;
    accDy = 0;
    const kv = 1 - Math.exp(-dt * 12);
    vx += (ivx - vx) * kv;
    vy += (ivy - vy) * kv;
    if (Math.abs(vx) < 1e-4) vx = 0;
    if (Math.abs(vy) < 1e-4) vy = 0;

    // Hold ramp.
    if (holding) h += (1 - h) * (1 - Math.exp(-dt / tuning.hold.rampIn));
    else h -= h * (1 - Math.exp(-dt / tuning.hold.rampOut));
    if (!holding && h < 1e-3) h = 0;
    hold = h * h;

    // Burst envelope.
    if (burst > 0) {
      burst *= Math.exp(-dt / BURST_TAU);
      if (burst < 1e-3) burst = 0;
    }

    const s = getExperience();
    const patch: Partial<ExperienceState> = {};
    let dirty = false;
    const p = s.pointer;
    if (p.x !== x || p.y !== y || p.vx !== vx || p.vy !== vy || p.active !== active || p.type !== type) {
      patch.pointer = { x, y, vx, vy, active, type };
      dirty = true;
    }
    if (s.hold !== hold) {
      patch.hold = hold;
      dirty = true;
    }
    if (s.burst !== burst) {
      patch.burst = burst;
      dirty = true;
    }
    if (dirty) setExperience(patch);
  });

  return () => {
    offTick();
    clearTimer();
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    document.removeEventListener('mouseout', onMouseOut);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('contextmenu', preventWhileHolding);
    document.removeEventListener('selectstart', preventWhileHolding);
    window.removeEventListener('touchmove', onTouchMove);
    root.classList.remove('is-holding');
    setExperience({ holding: false, hold: 0, burst: 0 });
  };
}
