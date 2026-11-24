/**
 * Connects the store to the audio engine (audio/engine.ts).
 *
 * CONTRACT (implementation owner: "systems" agent). Browser-only. Returns a cleanup function.
 *  - On every shared tick (lib/ticker.ts) while store.soundEnabled: engine.update({ progress, velocity, hold }).
 *  - When store.burst rises (a release happened): engine.burst(burst) once.
 *  - When store.soundEnabled flips: engine.enable() / engine.disable() (enable must originate from the
 *    toggle's click handler — the SoundToggle calls engine.enable() directly inside its onClick and then
 *    sets soundEnabled; the bridge only reacts to `false` and keeps things in sync).
 *  - No work at all while sound is off.
 */
import { getAudioEngine } from '@/audio/engine';
import { getExperience, useExperience } from './store';
import { onTick } from './ticker';

export function initAudioBridge(): () => void {
  const engine = getAudioEngine();
  let offTick: (() => void) | null = null;
  let lastBurst = 0;

  const start = (): void => {
    if (offTick) return;
    lastBurst = getExperience().burst;
    offTick = onTick(() => {
      const s = getExperience();
      engine.update({ progress: s.progress, velocity: s.velocity, hold: s.hold });
      if (s.burst > lastBurst + 1e-3) engine.burst(s.burst);
      lastBurst = s.burst;
    });
  };

  const stop = (): void => {
    offTick?.();
    offTick = null;
  };

  const sync = (on: boolean, wasOn: boolean): void => {
    if (on) {
      start();
    } else {
      stop();
      if (wasOn) void Promise.resolve(engine.disable()).catch(() => {});
    }
  };

  if (getExperience().soundEnabled) start();
  const unsub = useExperience.subscribe((s) => s.soundEnabled, sync);

  return () => {
    unsub();
    stop();
  };
}
