'use client';
/**
 * Sound toggle (off by default). The AudioContext must start from a user gesture, so enabling calls
 * getAudioEngine().enable() directly inside the click handler, then sets store.soundEnabled; turning
 * off just clears the flag and lib/audio-bridge.ts disables the engine.
 */
import { getAudioEngine } from '@/audio/engine';
import { setExperience, useExperience } from '@/lib/store';

export default function SoundToggle() {
  const on = useExperience((s) => s.soundEnabled);

  const toggle = (): void => {
    if (on) {
      setExperience({ soundEnabled: false });
      return;
    }
    try {
      void Promise.resolve(getAudioEngine().enable()).catch(() => setExperience({ soundEnabled: false }));
      setExperience({ soundEnabled: true });
    } catch {
      setExperience({ soundEnabled: false });
    }
  };

  return (
    <button type="button" className="sound" aria-pressed={on} data-on={on} onClick={toggle}>
      <span className="sound-bars" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className="sound-label">Sound</span>
      <span className="sound-state" aria-hidden="true">
        {on ? 'On' : 'Off'}
      </span>
    </button>
  );
}
