// ============================================================
// Native (Capacitor / Android) integration. No-ops in the browser.
// - Hardware back button: closes drawers, leaves sub-screens,
//   backs out of pop-ups, offers retreat in battle, exits from the
//   main menu. Never skips a required choice.
// - App backgrounding: suspends / resumes Web Audio.
// ============================================================

import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { soundEngine } from '../utils/SoundEngine.js';

const isVisible = (id) => {
  const el = document.getElementById(id);
  return !!el && !el.classList.contains('hidden');
};

function handleBack() {
  // 1. An open drawer (Status / Log) closes first
  if (document.querySelector('.run-drawer.open')) {
    document.querySelector('.drawer-scrim')?.click();
    return;
  }
  // 2. Pop-ups: back = their BACK / cancel button if they have one; otherwise it's a required choice
  if (document.getElementById('node-modal')?.classList.contains('open')) {
    document.querySelector('#node-modal [data-act="back"], #node-modal [data-act="cancel"], #node-modal [data-act="close"]')?.click();
    return;
  }

  // 3. In battle: back asks to retreat (when retreating is allowed)
  const retreat = document.getElementById('btn-retreat-battle');
  if (isVisible('battle-hud') && retreat && !retreat.classList.contains('hidden')) {
    retreat.click();
    return;
  }

  // 4. Sub-screens return to the main menu
  if (isVisible('screen-tech')) {
    document.getElementById('btn-tech-back')?.click();
    return;
  }
  // 5. Main menu exits the app; mid-run screens ignore back (use ABANDON RUN)
  if (isVisible('screen-menu')) App.exitApp();
}

if (Capacitor.isNativePlatform()) {
  document.documentElement.classList.add('native');
  App.addListener('backButton', handleBack);
  App.addListener('pause', () => soundEngine.ctx?.suspend?.().catch(() => {}));
  App.addListener('resume', () => {
    if (!soundEngine.muted) soundEngine.ctx?.resume?.().catch(() => {});
  });
}
