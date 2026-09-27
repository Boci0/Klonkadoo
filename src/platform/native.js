// ============================================================
// Native (Capacitor / Android) integration.
// - Hardware back button: closes drawers, leaves sub-screens,
//   backs out of pop-ups, offers retreat in battle, exits from the
//   main menu. Never skips a required choice.
// - Backgrounding (app pause, or a hidden browser tab): silences
//   Web Audio and stops the music clock until the game is back.
// ============================================================

import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { soundEngine } from '../utils/SoundEngine.js';

const isVisible = (id) => {
  const el = document.getElementById(id);
  return !!el && !el.classList.contains('hidden');
};
const click = (id) => document.getElementById(id)?.click();

function handleBack() {
  // 1. An open drawer (Status) closes first
  if (document.querySelector('.run-drawer.open')) {
    document.querySelector('.drawer-scrim')?.click();
    return;
  }
  // 2. Boss warning card: back just dismisses it (the fight is mandatory)
  const boss = document.getElementById('boss-intro');
  if (boss && !boss.classList.contains('hidden') && !boss.classList.contains('out')) {
    boss.dispatchEvent(new PointerEvent('pointerdown'));
    return;
  }
  // 3. Pop-ups: back = their BACK / cancel button if they have one; otherwise it's a required choice
  if (document.getElementById('node-modal')?.classList.contains('open')) {
    document.querySelector('#node-modal [data-act="back"], #node-modal [data-act="cancel"], #node-modal [data-act="close"]')?.click();
    return;
  }

  // 4. In battle: back asks to retreat (when retreating is allowed)
  const retreat = document.getElementById('btn-retreat-battle');
  if (isVisible('battle-hud') && retreat && !retreat.classList.contains('hidden')) {
    retreat.click();
    return;
  }

  // 5. Sub-screens return to the main menu
  if (isVisible('screen-rig')) return click('btn-rig-back');
  if (isVisible('screen-result')) return click('btn-run-end');
  // 6. Main menu exits the app; mid-run screens ignore back (use ABANDON RUN).
  //    The run is saved, so leaving the app any other way is safe too.
  if (isVisible('screen-menu')) App.exitApp();
}

let away = false;
function goAway() {
  if (away) return;
  away = true;
  soundEngine.suspend();
}
function comeBack() {
  if (!away) return;
  away = false;
  soundEngine.resume();
}

document.addEventListener('visibilitychange', () => (document.hidden ? goAway() : comeBack()));

if (Capacitor.isNativePlatform()) {
  document.documentElement.classList.add('native');
  App.addListener('backButton', handleBack);
  App.addListener('pause', goAway);
  App.addListener('resume', comeBack);
}
