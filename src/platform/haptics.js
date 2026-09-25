// ============================================================
// Haptics — short vibrations for game feel. Uses the native
// Capacitor plugin on Android; silently does nothing elsewhere.
// Respects the player's "Vibration" setting.
// ============================================================

import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

const KEY = 'slingshot-haptics';
const native = Capacitor.isNativePlatform();

let enabled = true;
try {
  enabled = localStorage.getItem(KEY) !== 'off';
} catch (_) {}

let lastBuzz = 0;

export const haptics = {
  get enabled() {
    return enabled;
  },

  setEnabled(on) {
    enabled = on;
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off');
    } catch (_) {}
  },

  /** @param {'light'|'medium'|'heavy'} strength */
  impact(strength = 'light') {
    if (!enabled || !native) return;
    // Rapid multi-hits would blur into one long buzz; keep them distinct
    const now = performance.now();
    if (now - lastBuzz < 40) return;
    lastBuzz = now;
    const style = strength === 'heavy' ? ImpactStyle.Heavy : strength === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light;
    Haptics.impact({ style }).catch(() => {});
  },
};
