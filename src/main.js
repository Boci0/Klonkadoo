// ============================================================
// KLONKADOO: Mech Roguelike — entry point + App state machine.
// Orchestrates: main menu → rig → roguelike run map →
// node events → slingshot battles → run results → meta progression.
// ============================================================

import './styles.css';
import { CONFIG } from './config.js';
import { Game } from './core/Game.js';
import { saveSystem } from './meta/SaveSystem.js';
import { QuestSystem } from './meta/QuestSystem.js';
import { RunState } from './rogue/RunState.js';
import { RogueMap } from './rogue/RogueMap.js';
import { RogueMapRenderer } from './rendering/RogueMapRenderer.js';
import { Minigame } from './minigame/Minigame.js';
import { UIManager } from './ui/UIManager.js';
import { BattleTips } from './ui/battleTips.js';
import { rollSupplies, grantSupply, getSupply } from './rogue/Supplies.js';
import { pickArena } from './core/Arenas.js';
import { OPERATOR, skinColors } from './meta/Balls.js';
import { MenuBackground } from './rendering/MenuBackground.js';
import { soundEngine } from './utils/SoundEngine.js';
import { haptics } from './platform/haptics.js';
import { DevTools } from './dev/DevTools.js';
import { checkMedals } from './meta/Medals.js';
import './platform/native.js';
import './platform/desktop.js';
import { withMech, tokenReward, riskEase, CRATES, enemyMech, enemyRig, CLEAN_WIN_KEYS, DTYPES, dtypeOf, droneUpkeep } from './meta/Mech.js';
import { partIcon, ico } from './rendering/pixelIcons.js';
import { pickNode, pickChoice, pickBuys, supplyValue } from './rogue/AutoRun.js';
import { withMastery, masteryLevel, runXp } from './meta/Mastery.js';
import { writeRun, readRun, clearRun, hasSavedRun, savedRunInfo, patchRunQuests } from './rogue/RunSave.js';

// Canvas text only uses a web font once it's loaded: fetch the digit face up front
document.fonts?.load('16px "Pixel Digits"', '0123456789').catch(() => {});

// ---------- Core systems ----------

const canvas = document.getElementById('game-canvas');

const game = new Game(canvas);
const battleTips = new BattleTips(game, document.getElementById('battle-hud'));
const minigame = new Minigame(canvas);
let mapRenderer = null;
// Dev panel only exists on the Vite dev server, never in release builds
const devTools = import.meta.env.DEV ? new DevTools(() => game, () => run, saveSystem) : null;

// ---------- Run state ----------

let run = null;
let map = null;
let questSystem = null;
let runSeed = 1;
let currentFloorView = 0;
let pendingBoon = null;
let lostAnyCombat = false;
let activeNode = null; // node currently being resolved
let battleNode = null; // the node of the fight on screen (bosses a floor forces on you too)
let prevPosition = null; // where the player stood before selecting activeNode (for BACK / RETREAT)
let battlePaused = false; // battle simulation frozen (e.g. retreat confirmation open)
let minigameResultShown = false;

// ---------- App state machine ----------

const State = {
  MENU: 'MENU',
  RUN_MAP: 'RUN_MAP',
  BATTLE: 'BATTLE',
  MINIGAME: 'MINIGAME',
  RESULT: 'RESULT',
};

let state = State.MENU;

function setState(next) {
  state = next;
  // Show the game canvas only during active gameplay screens
  const showCanvas = next === State.BATTLE || next === State.MINIGAME;
  canvas.classList.toggle('hidden', !showCanvas);

  // Background music follows the screen
  if (next === State.BATTLE) {
    const t = activeNode?.type || run?.currentNode?.type;
    soundEngine.playMusic(t === 'miniboss' || t === 'boss' || t === 'elite' ? 'boss' : 'battle');
  } else if (next === State.RUN_MAP || next === State.MINIGAME) {
    soundEngine.playMusic('map');
  } else if (next === State.RESULT) {
    soundEngine.playMusic(null);
  } else {
    soundEngine.playMusic('menu');
  }
}

// Settings > REDUCE MOTION (off unless you turn it on, whatever the OS says)
try {
  document.body.classList.toggle('reduce-motion', localStorage.getItem('slingshot-reduce-motion') === '1');
} catch (_) {}

// Audio can only start after a user gesture; also give every button a click sound
window.addEventListener('pointerdown', () => soundEngine.unlock(), { capture: true });

// ---------- UI callbacks ----------

const ui = new UIManager({
  onPlay: () => {
    if (hasSavedRun()) resumeSavedRun();
    else ui.showBallSelect((_ball, skin) => startNewRun(skin));
  },
  savedRun: savedRunInfo,
  onDataReset: clearRun,
  onBackToMenu: () => {
    setState(State.MENU);
    ui.showMenu(saveSystem.getProfile(), saveSystem.getMeta());
  },
  onRetreat: () => endRun(false),
  onRunEndConfirm: () => {
    setState(State.MENU);
    ui.showMenu(saveSystem.getProfile(), saveSystem.getMeta());
  },
  onRenderMap: (mapCanvas, floorIndex) => {
    if (!mapRenderer) mapRenderer = new RogueMapRenderer(mapCanvas);
    map?.sanitizeGridNodes?.();
    const floor = map.floors[floorIndex];
    const nextOptions = map.getNextOptions(run.floor, run.currentNodeId);
    const canSelect = new Set(nextOptions.map((n) => n.id));
    mapRenderer.render(floor, {
      currentNodeId: run.currentNodeId,
      canSelect,
    });
  },
  onNodeFight: (node) => startCombat(node),
  onNodeRetreat: (node) => skipNode(node),
  onNodeBack: () => cancelNodeSelection(),
  onNodeProceed: (node, leaveShop) => proceedFromNode(node, leaveShop),
  onBattleReportContinue: continueAfterCombatReport,
  onEncounterChoice: (idx) => resolveEncounterChoice(idx),
  onSupplyBuy: (i) => buySupply(i),
  onShopRefresh: () => {
    const node = run.currentNode;
    if (node && node.type === 'shop') {
      ui.showShop(run, node.shopItems, node.refreshesLeft ?? 3, rerollCost());
    }
  },
  onShopDoRefresh: () => {
    const node = run.currentNode;
    if (!node || node.type !== 'shop') return;
    const cost = rerollCost();
    const refreshesLeft = node.refreshesLeft ?? 3;
    if (refreshesLeft > 0 && run.spendGold(cost)) {
      reportQuest('gold_spent', { totalSpent: run.totalGoldSpent });
      node.refreshesLeft = refreshesLeft - 1;
      node.shopItems = rollShopItems();
      ui.showShop(run, node.shopItems, node.refreshesLeft, cost);
      ui.updateRunHud(run);
    }
  },
  getActiveNode: () => activeNode || run?.currentNode || null,
  onRestOption: (choice) => resolveRest(choice),
  onBoonAccepted: (boonId) => {
    run.applyBoon(boonId);
    ui.updateRunHud(run);
    ui.closeModal();
    continueAfterCombatReport();
  },
  onMinigameStart: startMinigame,
  onMinigameDone: finishMinigame,
});

/** Shop reroll price. */
function rerollCost() {
  return 15;
}

// ---------- Run event toasts ----------

/**
 * Surface a run event. Outside battle it shows as a short toast; in battle,
 * damage/heal already appears as floating numbers, so events are skipped.
 */
function addFeedEntry(html) {
  if (state === State.BATTLE && game.running) return; // live combat → floating numbers instead
  ui.toast(html);
}

// ---------- Battle ability HUD ----------

function bindAbilityButtons() {
  const triggerStomp = () => {
    if (state !== State.BATTLE || battlePaused) return;
    if (game.stompPlayer()) return haptics.impact('medium');
    soundEngine.play('error');
    const why = game.stompStatus(game.player, game.activeEnemy).reason;
    if (why && why !== 'NO STOMP') game.renderer.addCallout(game.player, why, '#94b0c2');
  };
  document.getElementById('btn-stomp')?.addEventListener('click', triggerStomp);
  document.getElementById('team-bar')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-swap]');
    if (!b || state !== State.BATTLE || battlePaused) return;
    if (game.swapPlayer(Number(b.dataset.swap))) haptics.impact('medium');
    else soundEngine.play('error');
  });

  document.getElementById('btn-retreat-battle')?.addEventListener('click', () => {
    if (!canRetreatFromBattle()) return;
    soundEngine.playUI();
    battlePaused = true;
    takeControl();
    // Bosses and mini-bosses: you can leave, but it's a lost fight (the run ends)
    if (isBossFight()) {
      ui.showConfirm({
        title: 'LEAVE THE BOSS FIGHT?',
        text: 'Leaving a boss fight counts as a <strong class="accent">loss</strong>: the run ends here.',
        confirmLabel: 'LEAVE (LOSS)',
        cancelLabel: 'KEEP FIGHTING',
        danger: true,
        onConfirm: forfeitBossFight,
        onCancel: () => { battlePaused = false; },
      });
      return;
    }
    ui.showRetreatConfirm(retreatCost(), {
      onConfirm: retreatFromBattle,
      onCancel: () => { battlePaused = false; },
    });
  });

  // Gear combat: END TURN (skip the actions you have left) and VENT (1 action)
  document.getElementById('btn-end-turn')?.addEventListener('click', () => {
    if (state !== State.BATTLE || battlePaused) return;
    takeControl();
    if (game.endPlayerTurn()) soundEngine.playUI();
    else soundEngine.play('error');
  });
  document.getElementById('btn-vent')?.addEventListener('click', () => {
    if (state !== State.BATTLE || battlePaused) return;
    takeControl();
    if (!game.ventPlayer()) soundEngine.play('error');
  });

  // AUTO: the planner plays your turns. Tap: on / off (your own actions switch it off).
  // Hold: LOCKED on, until you tap it off (your own actions don't stop it).
  const autoBtn = document.getElementById('btn-auto');
  let holdTimer = null;
  let held = false;
  const holdStart = () => {
    if (state !== State.BATTLE || battlePaused || autoRun) return;
    held = false;
    clearTimeout(holdTimer);
    showAutoHold(true);
    holdTimer = setTimeout(() => {
      held = true;
      showAutoHold(false);
      lockAutoBattle();
    }, AUTO_HOLD_MS);
  };
  const holdCancel = () => {
    clearTimeout(holdTimer);
    showAutoHold(false);
  };
  autoBtn?.addEventListener('pointerdown', holdStart);
  autoBtn?.addEventListener('pointerup', holdCancel);
  autoBtn?.addEventListener('pointerleave', holdCancel);
  autoBtn?.addEventListener('pointercancel', holdCancel);
  autoBtn?.addEventListener('contextmenu', (e) => e.preventDefault()); // a long press on touch
  autoBtn?.addEventListener('click', () => {
    if (held) {
      held = false; // the hold already locked it
      return;
    }
    if (state !== State.BATTLE || battlePaused || autoRun) return;
    setAutoBattle(!autoBattle);
    soundEngine.playUI();
  });
  // [A]: tap toggles, hold locks
  let keyTimer = null;
  let keyHeld = false;
  window.addEventListener('keyup', (e) => {
    if (e.code !== 'KeyA' || !keyTimer) return;
    clearTimeout(keyTimer);
    keyTimer = null;
    showAutoHold(false);
    if (keyHeld || state !== State.BATTLE || battlePaused || autoRun) return;
    setAutoBattle(!autoBattle);
  });

  // Keyboard hotkeys: [1-6] (or [Q] [E]) guns, [Z] [X] [C] specials, [F] stomp, [V] vent, [Space] end turn, [A] auto
  window.addEventListener('keydown', (e) => {
    if (state !== State.BATTLE || battlePaused) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const digit = /^Digit([1-6])$/.exec(e.code);
    if (e.code === 'KeyA') {
      if (!autoRun && !e.repeat && !keyTimer) {
        keyHeld = false;
        showAutoHold(true);
        keyTimer = setTimeout(() => {
          keyHeld = true;
          showAutoHold(false);
          lockAutoBattle();
        }, AUTO_HOLD_MS);
      }
      return;
    }
    if (digit || ['KeyQ', 'KeyE', 'Space', 'KeyV', 'KeyZ', 'KeyX', 'KeyC', 'KeyF'].includes(e.code)) takeControl();
    if (digit) {
      fireGun(Number(digit[1]) - 1);
    } else if (e.code === 'KeyQ' || e.code === 'KeyE') {
      fireGun(e.code === 'KeyQ' ? 0 : 1);
    } else if (e.code === 'Space') {
      e.preventDefault();
      if (game.endPlayerTurn()) soundEngine.playUI();
    } else if (e.code === 'KeyV') {
      if (!game.ventPlayer()) soundEngine.play('error');
    } else if (e.code === 'KeyZ' || e.code === 'KeyX' || e.code === 'KeyC') {
      useSpecial({ KeyZ: 0, KeyX: 1, KeyC: 2 }[e.code]);
    } else if (e.code === 'KeyF') {
      triggerStomp();
    }
  });
}

// ---------- Rig weapon chips ----------
// Classic: tap one to see its range. Gear combat: tap to fire it; each chip
// shows its energy / heat cost, ammo and why it can't fire right now.

const GUN_BLOCK_LABEL = { ACTIVE: 'ACTIVE', ANCHORED: 'ANCHORED', JAMMED: 'JAMMED', USED: 'USED', EMPTY: 'EMPTY', HOT: 'TOO HOT', ENERGY: 'NO ENERGY', RANGE: 'OUT OF RANGE', 'TOO CLOSE': 'TOO CLOSE', BLOCKED: 'NO LINE', 'NO TARGET': 'NO TARGET', 'NO ACTIONS': 'NO ACTIONS', WAIT: '' };

function useSpecial(i) {
  const res = game.usePlayerSpecial(i);
  if (res.ok) {
    haptics.impact(res.pick || res.cancelled ? 'light' : 'medium');
    if (res.pick) game.renderer.addCallout(game.player, 'PICK A PLATE', '#c46fd6');
    return;
  }
  soundEngine.play('error');
  const label = GUN_BLOCK_LABEL[res.reason];
  if (label) game.renderer.addCallout(game.player, label, '#94b0c2');
}

function fireGun(i) {
  const res = game.firePlayerWeapon(i);
  if (res.ok) {
    haptics.impact('light');
    return;
  }
  soundEngine.play('error');
  const label = GUN_BLOCK_LABEL[res.reason];
  if (label) game.renderer.addCallout(game.player, label, '#94b0c2');
}

// AUTO battle: the planner plays your turns. It stays on between fights until
// you switch it off (or act yourself); AUTO RUN keeps it on for the whole run.
// Held down, it LOCKS: on in every battle (even after a restart) until you tap
// it off, and acting yourself doesn't stop it.
const AUTO_HOLD_MS = 550;
const AUTO_LOCK_KEY = 'slingshot-auto-lock';
let autoLocked = false;
try {
  autoLocked = localStorage.getItem(AUTO_LOCK_KEY) === '1';
} catch (_) {}
let autoBattle = autoLocked;
let autoRun = false;
function setAutoBattle(on) {
  autoBattle = !!on;
  if (!autoBattle && autoLocked) {
    autoLocked = false; // tapping it off unlocks it too
    saveAutoLock();
  }
  game.autoPlayer = autoBattle;
  const btn = document.getElementById('btn-auto');
  btn?.classList.toggle('on', autoBattle);
  btn?.classList.toggle('locked', autoLocked);
  const cd = document.getElementById('cd-auto');
  if (cd) cd.textContent = autoLocked ? 'LOCK' : autoBattle ? 'ON' : 'OFF';
}
function saveAutoLock() {
  try {
    if (autoLocked) localStorage.setItem(AUTO_LOCK_KEY, '1');
    else localStorage.removeItem(AUTO_LOCK_KEY);
  } catch (_) {}
}
/** The hold bar on the AUTO button (so a tap shows there's a hold too). */
function showAutoHold(on) {
  const btn = document.getElementById('btn-auto');
  if (!btn) return;
  btn.style.setProperty('--hold-ms', `${AUTO_HOLD_MS}ms`);
  btn.classList.remove('holding');
  if (on && !autoLocked) {
    void btn.offsetWidth; // restart the fill
    btn.classList.add('holding');
  }
}

/** Hold AUTO (button or [A]): on and locked. */
function lockAutoBattle() {
  if (state !== State.BATTLE || battlePaused || autoRun) return;
  autoLocked = true;
  saveAutoLock();
  setAutoBattle(true);
  soundEngine.play('confirm');
  haptics.impact('medium');
  game.renderer?.addCallout(game.player, 'AUTO LOCKED', '#ffcd75');
}
/** A manual action: you take over (AUTO battle and AUTO RUN both stop; a locked AUTO keeps going). */
function takeControl() {
  if (autoRun) stopAutoRun('YOU TOOK OVER');
  else if (autoBattle && !autoLocked) setAutoBattle(false);
}

// ---------- AUTO RUN ----------
// Farms a Risk you've already beaten: picks the next map node, fights on
// AUTO, takes the best reward / event choice / shop buys. It stops at the
// Abyss (or when the run ends, or when you act yourself).

let autoRunTimer = 0;
let autoPending = null; // the node AUTO RUN just stepped into: { type, node }

/** Can AUTO RUN farm this run? The Risk must be won once already, and not in the Abyss. */
function autoRunAllowed() {
  if (!run || run.runOver) return { ok: false, why: '' };
  if (run.floor >= CONFIG.map.floors) return { ok: false, why: 'Not in the Abyss' };
  const best = saveSystem.getBallStats(run.ballType).bestRiskWin ?? -1;
  if (best < (run.risk ?? 0)) return { ok: false, why: 'Win a run on this Risk first' };
  return { ok: true, why: '' };
}

function updateAutoRunBtn() {
  const b = document.getElementById('btn-auto-run');
  if (!b) return;
  const can = autoRunAllowed();
  b.disabled = !can.ok && !autoRun;
  b.title = can.ok ? 'AUTO RUN: moves, fights and picks rewards for you until the Abyss' : can.why;
  b.classList.toggle('btn-accent', autoRun);
  b.classList.toggle('btn-outline', !autoRun);
  b.innerHTML = `${ico(can.ok || autoRun ? 'auto' : 'lock')}${autoRun ? 'AUTO ON' : 'AUTO RUN'}`;
}

function startAutoRun() {
  if (!autoRunAllowed().ok) return false;
  autoRun = true;
  autoPending = null;
  setAutoBattle(true);
  updateAutoRunBtn();
  clearTimeout(autoRunTimer);
  autoRunTimer = setTimeout(autoRunTick, 400);
  return true;
}

function stopAutoRun(reason = '') {
  if (!autoRun) return;
  autoRun = false;
  autoPending = null;
  clearTimeout(autoRunTimer);
  setAutoBattle(autoLocked); // a locked AUTO battle outlives AUTO RUN
  updateAutoRunBtn();
  if (reason) ui.toast(`<span class="feed-boon">${ico('auto')} AUTO RUN STOPPED: ${reason}</span>`);
}

/** One step of AUTO RUN; it reschedules itself. */
function autoRunTick() {
  if (!autoRun) return;
  autoRunTimer = setTimeout(autoRunTick, 650);
  if (battlePaused || !run) return;
  if (run.runOver) return stopAutoRun();
  // End-of-battle report: continue
  const report = document.getElementById('battle-report');
  if (report) {
    report.querySelector('button')?.click();
    return;
  }
  if (ui.nodeModal.classList.contains('open')) return autoModal();
  if (state === State.BATTLE) return; // AUTO battle plays it
  if (state === State.MINIGAME) return stopAutoRun('MINI-GAME');
  if (state !== State.RUN_MAP) return;
  // On the map: step to the best next node
  const node = pickNode(map.getNextOptions(run.floor, run.currentNodeId), run, run.gold);
  if (!node) return stopAutoRun('NOWHERE TO GO');
  selectNode(node);
  autoPending = { type: node.type, node };
  if (['combat', 'elite', 'miniboss', 'boss'].includes(node.type)) {
    autoPending = null;
    startCombat(node);
  } else if (node.type === 'minigame') {
    autoPending = null;
    ui.closeModal();
    skipNode(node); // a skill game: AUTO passes it by
  } else proceedFromNode(node);
}

/** A pop-up is open during AUTO RUN: make the call it asks for. */
function autoModal() {
  const pend = autoPending;
  const node = pend?.node;
  if (pend?.type === 'encounter' && node?.encounter) {
    autoPending = null;
    resolveEncounterChoice(pickChoice(node.encounter, run));
    return;
  }
  if (pend?.type === 'shop') {
    autoPending = null;
    for (const i of pickBuys(node.shopItems || [], run, (sup) => run.price(sup.cost))) buySupply(i);
    ui.closeModal();
    proceedFromNode(null);
    return;
  }
  if (pend?.type === 'rest') {
    autoPending = null;
    ui.closeModal();
    resolveRest(run.teamHurt ? 'heal' : 'leave');
    return;
  }
  // Anything else (a boon, a result card, a notice): take its main button
  const btn = ui.modalActions.querySelector('.btn-primary:not(:disabled), .btn-accent:not(:disabled)') || ui.modalActions.querySelector('button:not(:disabled)');
  btn?.click();
}

let mechHudSig = '';
function updateMechHud() {
  const el = document.getElementById('mech-hud');
  if (el) updateGearHud(el, document.getElementById('btn-end-turn'), document.getElementById('btn-vent'));
}

function updateGearHud(el, endBtn, ventBtn) {
  const hud = document.getElementById('battle-hud');
  hud?.classList.add('gear');
  const guns = game.playerWeapons || [];
  const drones = game.playerDrones || [];
  const specials = game.playerSpecials || [];
  const p = game.player;
  const myTurn = game.running && game.turnSystem.phase === 'PLAYER_AIM';
  const live = game.canPlayerAct;
  const states = guns.map((_, i) => game.playerGunState(i));
  const left = p?.actionsLeft || 0;
  if (endBtn) {
    endBtn.classList.toggle('hidden', !myTurn);
    endBtn.classList.toggle('pulse', myTurn && left > 0 && !states.some((st) => st.ok));
    const pips = '\u25A0'.repeat(Math.max(0, left)) + '\u25A1'.repeat(Math.max(0, CONFIG.gear.actions - left));
    const pipEl = endBtn.querySelector('.action-pips');
    if (pipEl && pipEl.textContent !== pips) pipEl.textContent = pips;
  }
  if (ventBtn) {
    ventBtn.classList.toggle('hidden', !myTurn);
    ventBtn.disabled = !live;
    const heatTxt = p ? `${Math.ceil(p.heat)}/${p.heatCap}` : '';
    const cd = ventBtn.querySelector('.ability-cd');
    if (cd && cd.textContent !== heatTxt) cd.textContent = heatTxt;
  }
  const sig = `${live}|${left}|` + guns.map((w, i) => `${w.ammoLeft}:${states[i].ok}:${states[i].reason}:${states[i].dmg}:${states[i].cover}:${states[i].overheats}`).join(',') + '|' + drones.map((d) => d.off).join(',') + '|' + specials.map((sp) => `${sp.usesLeft}:${game.specialStatus(p, sp, game.activeEnemy).reason}`).join(',') + `|${game.teleportPick}`;
  if (sig === mechHudSig) return;
  mechHudSig = sig;
  el.innerHTML = guns.map((w, i) => {
    const st = states[i];
    const ready = live && st.ok;
    const why = !st.ok ? GUN_BLOCK_LABEL[st.reason] || '' : '';
    const ammo = w.ammo ? `<b class="gun-ammo">${w.ammoLeft}/${w.ammo}</b>` : '';
    // A shot that takes you over the heat cap is allowed, but flagged: next turn starts with a forced vent
    const hot = ready && st.overheats;
    return `<button class="mech-chip gear-gun ${ready ? 'ready' : 'cooling'} ${hot ? 'overheat' : ''}" data-gun="${i}" style="--c:${w.color}" aria-label="${w.name}">
      <img src="${partIcon(w.id)}" alt="">${ammo}
      <span class="gun-dmg" style="color:${DTYPES[dtypeOf(w)].color}">${w.fx?.mine ? 'MINE' : st.dmg ? `${ico(DTYPES[dtypeOf(w)].icon)}${st.dmg}` : ''}</span>
      <span class="gun-cost"><i class="c-en">${w.en || 0}</i><i class="c-heat">${w.heat || 0}</i></span>
      <span class="gun-why">${ready ? (hot ? 'OVERHEAT' : 'FIRE') : why}</span></button>`;
  }).join('') + drones.map((d, i) => {
    const { en, heat } = droneUpkeep(d);
    // Docked: a bright DEPLOY button while you have an action for it; out: ON (tap to recall, free)
    const state = !d.off ? 'on' : live ? 'ready' : 'off';
    const label = !d.off ? 'ON' : live ? 'DEPLOY' : 'NO ACTIONS';
    return `<button class="mech-chip drone gear-drone ${state}" data-drone="${i}" style="--c:${d.color}" aria-label="${d.name}">
      <img src="${partIcon(d.id)}" alt=""><span class="gun-cost"><i class="c-en">${en}</i>${heat ? `<i class="c-heat">${heat}</i>` : ''}</span><span class="gun-why">${label}</span></button>`;
  }).join('') + specials.map((sp, i) => {
    // Specials: an action each, limited uses; the Teleporter waits for a plate
    const st = game.specialStatus(p, sp, game.activeEnemy);
    const picking = game.teleportPick === i;
    const ready = live && (st.ok || picking);
    const label = picking ? 'PICK A PLATE' : ready ? 'USE' : GUN_BLOCK_LABEL[st.reason] || '';
    return `<button class="mech-chip gear-gun gear-special ${ready ? 'ready' : 'cooling'} ${picking ? 'picking' : ''}" data-special="${i}" style="--c:${sp.color}" aria-label="${sp.name}">
      <img src="${partIcon(sp.id)}" alt=""><b class="gun-ammo">${sp.usesLeft}/${sp.uses}</b>
      <span class="gun-cost"><i class="c-en">${sp.en || 0}</i><i class="c-heat">${sp.heat || 0}</i></span>
      <span class="gun-why">${label}</span></button>`;
  }).join('');
  el.querySelectorAll('[data-gun]').forEach((b) => b.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    if (battlePaused) return;
    takeControl();
    fireGun(Number(b.dataset.gun));
  }));
  el.querySelectorAll('[data-special]').forEach((b) => b.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    if (battlePaused) return;
    takeControl();
    useSpecial(Number(b.dataset.special));
  }));
  el.querySelectorAll('[data-drone]').forEach((b) => b.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    if (battlePaused) return;
    takeControl();
    const res = game.toggleDrone(Number(b.dataset.drone));
    if (res.ok) {
      soundEngine.playUI();
      haptics.impact('light');
    } else {
      soundEngine.play('error');
      if (res.reason === 'NO ACTIONS') game.renderer.addCallout(game.player, 'NO ACTIONS', '#94b0c2');
    }
  }));
}

/** Team bar: every team mech with its HP; tap a benched one to SWAP (the whole turn). */
let teamBarSig = '';
function updateTeamBar() {
  const el = document.getElementById('team-bar');
  if (!el) return;
  const team = game.team || [];
  el.classList.toggle('hidden', team.length < 2);
  if (team.length < 2) return;
  const full = game.canPlayerAct && game.player.actionsLeft >= CONFIG.gear.actions;
  const rows = team.map((m, i) => {
    const active = i === game.teamIndex;
    const hp = active ? game.player.hp : m.hp;
    const max = active ? game.player.maxHp : m.maxHp;
    const state = active ? 'on' : hp <= 0 ? 'ko' : full ? 'ready' : '';
    return { i, state, hp: Math.max(0, Math.round(hp)), pct: Math.max(0, Math.min(100, (hp / max) * 100)), name: m.name };
  });
  const sig = JSON.stringify(rows);
  if (sig === teamBarSig) return;
  teamBarSig = sig;
  el.innerHTML = rows.map((r) => `<button class="team-chip ${r.state}" data-swap="${r.i}" ${r.state === 'ready' ? '' : 'disabled'}>
    <b>${r.name}</b><span>${r.state === 'on' ? 'FIGHTING' : r.state === 'ko' ? 'KNOCKED OUT' : r.state === 'ready' ? 'SWAP' : 'BENCH'}</span>
    <i><em style="width:${r.pct}%"></em></i><small>${r.hp}</small>
  </button>`).join('');
}

function updateAbilityHud() {
  updateTeamBar();
  // STOMP: lit when the enemy is right next to you
  const btnStomp = document.getElementById('btn-stomp');
  const cdStomp = document.getElementById('cd-stomp');
  const st = game.player ? game.stompStatus(game.player, game.activeEnemy) : { ok: false, reason: 'NO STOMP' };
  btnStomp?.classList.toggle('hidden', st.reason === 'NO STOMP');
  const canStomp = st.ok && game.canPlayerAct;
  if (btnStomp) {
    btnStomp.disabled = !canStomp;
    btnStomp.classList.toggle('ready', canStomp);
  }
  if (cdStomp) {
    const text = canStomp ? `${st.dmg} DMG` : st.reason === 'NOT ADJACENT' ? 'RANGE 1' : st.reason === 'NO ACTIONS' ? '' : st.reason;
    if (cdStomp.textContent !== text) cdStomp.textContent = text;
  }
}

// ---------- Run flow ----------

/** Report a quest event; newly completed quests are written into the saved run at once (their scrap is already paid). */
function reportQuest(type, data) {
  if (!questSystem) return;
  const newly = questSystem.reportCombatEvent(type, data);
  if (newly.length) patchRunQuests(questSystem.quests);
}

/**
 * Save the run so it survives the app being closed. `resume` says what
 * happens on reload: 'map' (default), 'battle' (restart that fight),
 * 'combat' (fight won/lost: pay out and continue), 'minigame', 'sector',
 * 'descend'.
 */
function persistRun(resume = 'map', extra = {}) {
  if (!run || run.runOver || !map) return;
  writeRun({
    run,
    map,
    quests: questSystem?.quests || [],
    runSeed,
    currentFloorView,
    lostAnyCombat,
    resume,
    ...extra,
  });
}

function startNewRun(skin = 'default') {
  const ballType = OPERATOR.id;
  runSeed = Math.floor(Math.random() * 100000) + 1;
  saveSystem.setSelectedBall(ballType); // Risk is per ball
  const mastery = masteryLevel(saveSystem.getMasteryXp(ballType)).level;
  const [lead, ...rest] = saveSystem.getTeamLoadouts();
  const perm = withMastery(withMech({}, lead), mastery);
  run = new RunState(perm, ballType);
  run.v2 = true; // 2.0 rules (see resumeSavedRun)
  // Garage mechs 2 and 3 join the team, each with its own HP for the run
  run.team = rest.map((parts) => ({ perm: withMastery(withMech({}, parts), mastery), hp: 0 }));
  run.team.forEach((m, i) => (m.hp = run.member(i + 1).maxHp));
  run.skin = skin;
  run.risk = saveSystem.getDifficultyLevel(); // locked for the run (restored on resume)
  // One random operation condition per run
  const cond = CONFIG.runConditions[Math.floor(Math.random() * CONFIG.runConditions.length)];
  run.condition = cond.id;
  map = new RogueMap(runSeed);
  // Risk 11 (ABYSS): every common hostile on the map becomes an elite
  if (saveSystem.getRiskData().allElite) {
    for (const f of map.floors) for (const n of f.nodes || []) if (n.type === 'combat') n.type = 'elite';
  }
  run.normalFights = 0; // the secret Risk unlock needs a run with none
  questSystem = new QuestSystem(saveSystem, runSeed);
  run.questSystem = questSystem; // the Status drawer lists these
  currentFloorView = 0;
  pendingBoon = null;
  lostAnyCombat = false;
  activeNode = null;
  prevPosition = null;

  // Enter floor 0
  run.floor = 0;
  run.resetFloorActions();
  const entry = findEntryNode(0);
  run.currentNodeId = entry?.id;
  run.currentNode = entry;

  setState(State.RUN_MAP);
  ui.showRunScreen(run, map, 0);
  updateAutoRunBtn();
  buildFloorTabs();
  if (cond.id === 'supplied') {
    const boon = CONFIG.boons[Math.floor(Math.random() * CONFIG.boons.length)];
    run.applyBoon(boon.id);
    addFeedEntry(`<span class="feed-boon">SUPPLIES: ${boon.name}</span>`);
  }
  ui.updateRunHud(run);
  ui.showCondition(cond);
  persistRun();
}

/** Pick the saved run back up exactly where it was left (see persistRun). */
function resumeSavedRun() {
  let s = null;
  try {
    s = readRun();
  } catch (e) {
    console.warn('Saved run unreadable:', e);
  }
  if (!s) {
    clearRun();
    soundEngine.play('error');
    ui.toast('<span class="feed-enemy-ability">SAVED RUN WAS DAMAGED AND COULD NOT BE LOADED</span>');
    ui.showMenu(saveSystem.getProfile(), saveSystem.getMeta());
    return;
  }
  run = s.run;
  // Runs started before 2.0 carry the old gun numbers: rebuild the rig from
  // the garage and today's catalog (HP keeps its share of the new max)
  if (!run.v2) {
    const mastery = masteryLevel(saveSystem.getMasteryXp(run.ballType)).level;
    const oldBonus = run.permanent?.hpBonus || 0;
    const pct = run.maxHp > 0 ? run.hp / run.maxHp : 1;
    run.permanent = withMastery(withMech({}, saveSystem.getLoadoutParts(0)), mastery);
    run.maxHp += (run.permanent.hpBonus || 0) - oldBonus + (CONFIG.run.maxHpBase - 100);
    run.hp = Math.max(1, Math.round(run.maxHp * pct));
    run.team = [];
    run.v2 = true;
  }
  map = s.map;
  runSeed = s.runSeed;
  currentFloorView = s.currentFloorView;
  lostAnyCombat = s.lostAnyCombat;
  questSystem = new QuestSystem(saveSystem, runSeed);
  questSystem.quests = s.quests;
  questSystem.completed = new Set(s.quests.filter((q) => q.completed).map((q) => q.id));
  run.questSystem = questSystem;
  saveSystem.setSelectedBall(run.ballType);
  saveSystem.setDifficultyLevel(run.risk || 0, run.ballType);
  pendingBoon = null;
  activeNode = null;
  prevPosition = null;
  mapRenderer?.resetZoom?.();

  setState(State.RUN_MAP);
  ui.showRunScreen(run, map, run.floor);
  updateAutoRunBtn();
  buildFloorTabs();
  soundEngine.play('confirm');

  switch (s.resume) {
    case 'battle':
      if (!s.node) break;
      prevPosition = s.prevId ? { id: s.prevId, node: s.prevNode } : null;
      activeNode = s.node;
      run.currentNodeId = s.node.id;
      run.currentNode = s.node;
      startCombat(s.node);
      return;
    case 'combat':
      pendingBoon = CONFIG.boons.find((b) => b.id === s.pendingBoonId) || null;
      continueAfterCombatReport();
      return;
    case 'minigame':
      finishMinigame();
      return;
    case 'sector':
      sectorCleared();
      return;
    case 'descend':
      if (s.descend) {
        ui.showDescend({ ...s.descend, rewards: null, hp: run.hp, maxHp: run.maxHp }, descend, () => endRun(true));
        return;
      }
      break;
    default:
      break;
  }
  returnToMap();
}

function findEntryNode(floorIndex) {
  const f = map.floors[floorIndex];
  if (!f) return null;
  return f.nodes.find((n) => n.type === 'entry') || f.nodes.find((n) => n.row === f.centerRow && n.col === f.centerCol) || f.nodes[0];
}

function buildFloorTabs() {
  const container = document.getElementById('run-floortabs');
  container.innerHTML = '';
  const last = Math.max(run.floor, CONFIG.map.floors - 1);
  for (let f = Math.max(0, last - 4); f <= last; f++) {
    const isCleared = f < run.floor; // floors fully completed
    const isCurrent = f === run.floor; // floor the player is on
    const isLocked = f > run.floor;
    const tab = document.createElement('div');
    tab.className = `floor-tab ${f === currentFloorView ? 'active' : ''} ${isCleared ? 'cleared' : ''} ${isCurrent ? 'current' : ''} ${isLocked ? 'locked' : ''}`;
    tab.textContent = f >= CONFIG.map.floors ? `A${f - CONFIG.map.floors + 1}` : `F${f + 1}`;
    tab.classList.toggle('abyss', f >= CONFIG.map.floors);
    if (!isLocked) {
      tab.addEventListener('click', () => {
        currentFloorView = f;
        buildFloorTabs();
        ui.renderMap(run, map, f);
      });
    }
    container.appendChild(tab);
  }
}

function bindMapClicks() {
  const mapCanvas = document.getElementById('map-canvas');
  mapCanvas.onclick = (e) => {
    if (state !== State.RUN_MAP) return;
    if (mapRenderer && mapRenderer.didDrag) {
      mapRenderer.didDrag = false;
      return;
    }
    if (!mapRenderer) return;
    const nextOptions = map.getNextOptions(run.floor, run.currentNodeId);
    const node = mapRenderer.hitNode(e.clientX, e.clientY, nextOptions);
    if (node) {
      takeControl();
      selectNode(node);
    }
  };

  const btnAuto = document.getElementById('btn-auto-run');
  if (btnAuto) btnAuto.onclick = () => {
    soundEngine.playUI();
    if (autoRun) stopAutoRun();
    else if (!startAutoRun()) soundEngine.play('error');
  };

  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  const btnZoomReset = document.getElementById('btn-zoom-reset');

  if (btnZoomIn) btnZoomIn.onclick = () => mapRenderer?.setScale((mapRenderer.scale || 1) * 1.15);
  if (btnZoomOut) btnZoomOut.onclick = () => mapRenderer?.setScale((mapRenderer.scale || 1) * 0.85);
  if (btnZoomReset) btnZoomReset.onclick = () => mapRenderer?.resetZoom();
}

function selectNode(node) {
  prevPosition = { id: run.currentNodeId, node: run.currentNode };
  activeNode = node;
  run.currentNodeId = node.id;
  run.currentNode = node;
  ui.updateRunHud(run);
  ui.renderMap(run, map, run.floor);
  ui.showNodeIntro(node, run);
}

// ---------- Node resolution ----------

function proceedFromNode(node, leaveShop) {
  if (!node) {
    // Leaving a shop without a node ref: mark it cleared and continue
    if (activeNode && activeNode.type === 'shop') {
      map.visitNode(run.floor, activeNode.id);
      run.spendFloorAction();
      ui.updateRunHud(run);
      if (!advanceFloorIfNeeded()) returnToMap();
    }
    return;
  }
  void leaveShop;

  switch (node.type) {
    case 'entry':
      map.visitNode(run.floor, node.id);
      returnToMap();
      break;
    case 'combat':
    case 'elite':
    case 'boss':
      // The ENGAGE button path handles these via onNodeFight
      break;
    case 'encounter':
      startEncounter(node);
      break;
    case 'shop':
      if (!node.shopOpened) {
        node.shopOpened = true;
        node.refreshesLeft = 3;
        node.shopItems = rollShopItems();
      }
      // Runs saved before relics were retired: restock the shelves
      if (!(node.shopItems || []).every((it) => getSupply(it.id))) node.shopItems = rollShopItems();
      ui.showShop(run, node.shopItems, node.refreshesLeft ?? 3, rerollCost());
      break;
    case 'rest':
      ui.showRest(run);
      break;
    case 'minigame':
      ui.showMinigameIntro();
      break;
    case 'treasure': {
      const offer = rollSupplies(2);
      if (autoRun) {
        // AUTO RUN: take the one worth more right now
        const best = [...offer].sort((a, b) => supplyValue(b, run) - supplyValue(a, run))[0];
        autoPending = null;
        soundEngine.play('coin');
        addFeedEntry(`<span class="feed-boon">CACHE: ${grantSupply(best, run)}</span>`);
        finishNode(node);
        break;
      }
      ui.showTreasure(offer, (id) => {
        const s = getSupply(id);
        if (s) {
          soundEngine.play('coin');
          addFeedEntry(`<span class="feed-boon">CACHE: ${grantSupply(s, run)}</span>`);
        }
        finishNode(node);
      });
      break;
    }
    case 'gamble':
      if (autoRun) {
        // AUTO RUN: the bet is worth it (keys) when there's gold for it
        autoPending = null;
        if (run.gold >= 15) {
          run.gold -= 15;
          if (Math.random() < 0.5) {
            if (Math.random() < 0.5) {
              run.earnKeys(3);
              addFeedEntry('<span class="feed-gold">GAMBLE: +3 KEYS</span>');
            } else addFeedEntry(`<span class="feed-gold">GAMBLE: +${run.gainGold(45)} GOLD</span>`);
          } else addFeedEntry('<span class="feed-dmg">GAMBLE: LOST 15 GOLD</span>');
        }
        finishNode(node);
        break;
      }
      ui.showGamble(run, 15, () => {
        run.gold -= 15;
        if (Math.random() < 0.5) {
          soundEngine.play('confirm');
          if (Math.random() < 0.5) {
            run.earnKeys(3);
            return { won: true, text: 'The dealer slides over a key ring: <strong>+3 KEYS</strong>.' };
          }
          const g = run.gainGold(45);
          return { won: true, text: `The coin lands your way: +${g} gold.` };
        }
        soundEngine.play('error');
        return { won: false, text: 'The coin lands wrong. Your 15 gold is gone.' };
      }, () => finishNode(node));
      break;
    default:
      map.visitNode(run.floor, node.id);
      run.spendFloorAction();
      ui.updateRunHud(run);
      if (!advanceFloorIfNeeded()) returnToMap();
  }
}

/** BACK from a node pop-up: nothing happens, you stay where you were. */
function cancelNodeSelection() {
  if (prevPosition) {
    run.currentNodeId = prevPosition.id;
    run.currentNode = prevPosition.node;
  }
  activeNode = null;
  prevPosition = null;
  ui.updateRunHud(run);
  ui.renderMap(run, map, run.floor);
}

/** A boss or mini-boss fight (including the ones a floor forces on you). */
function isBossFight() {
  const type = battleNode?.type;
  return state === State.BATTLE && (type === 'miniboss' || type === 'boss');
}

/** Can the player leave the current battle? Bosses can be left too, as a loss. */
function canRetreatFromBattle() {
  // A normal retreat steps back to the tile you came from: only for fights you walked into
  return state === State.BATTLE && (isBossFight() || (!!prevPosition && activeNode === battleNode));
}

/** Leave a boss / mini-boss fight: it counts as a lost fight, so the run ends. */
function forfeitBossFight() {
  game.abortBattle();
  battlePaused = false;
  run.hp = 0;
  run.onCombatLost();
  lostAnyCombat = true;
  addFeedEntry('<span class="feed-enemy-ability">LEFT THE BOSS FIGHT: RUN LOST</span>');
  soundEngine.play('retreat');
  ui.updateRunHud(run);
  endRun(false);
}

function retreatCost() {
  return Math.max(5, Math.round(run.maxHp * 0.15));
}

/**
 * RETREAT mid-battle: pay HP + 1 move, fall back to the previous tile.
 * The hostile tile stays uncleared so it can be retried later.
 */
function retreatFromBattle() {
  if (!canRetreatFromBattle() || isBossFight()) return;
  const cost = retreatCost();
  game.abortBattle();
  battlePaused = false;
  run.hp = Math.max(1, Math.min(run.maxHp, game.player.hp) - cost);
  run.currentNodeId = prevPosition.id;
  run.currentNode = prevPosition.node;
  activeNode = null;
  prevPosition = null;
  run.spendFloorAction();
  addFeedEntry(`<span class="feed-enemy-ability">RETREATED — lost ${cost} HP. The hostile holds its position.</span>`);
  soundEngine.play('retreat');
  ui.updateRunHud(run);
  if (!advanceFloorIfNeeded()) returnToMap();
}

/** Mark a non-combat node done: spend the move and return to the map. */
function finishNode(node) {
  map.visitNode(run.floor, node.id);
  run.spendFloorAction();
  ui.updateRunHud(run);
  if (!advanceFloorIfNeeded()) returnToMap();
}

function skipNode(node) {
  // Retreat: lose a little HP, mark node cleared, spend action, continue
  run.hp = Math.max(1, run.hp - 10);
  map.visitNode(run.floor, node.id);
  run.spendFloorAction();
  ui.updateRunHud(run);
  if (!advanceFloorIfNeeded()) returnToMap();
}

function returnToMap() {
  setState(State.RUN_MAP);
  ui.showRunScreen(run, map, run.floor);
  ui.closeModal();
  buildFloorTabs();
  updateAutoRunBtn();
  persistRun();
}

function advanceFloorIfNeeded() {
  const node = run.currentNode;

  if (run.floorActions <= 0) {
    // Floor 3 (index 2): Depleting action points forces Mini-Boss battle!
    if (run.floor === 2 && !run.floor3MinibossCleared) {
      if (node && node.type === 'miniboss') {
        run.floor3MinibossCleared = true;
      } else {
        const minibossNode = {
          id: 'floor3-miniboss',
          floor: 2,
          type: 'miniboss',
          displayName: 'FLOOR 3 COMMANDER',
        };
        run.currentNode = minibossNode;
        run.currentNodeId = minibossNode.id;
        addFeedEntry(`<span class="feed-enemy-ability">OUT OF MOVES — THE FLOOR 3 MINI-BOSS ATTACKS!</span>`);
        startCombat(minibossNode);
        return true;
      }
    }

    // Floor 5 (index 4): Depleting action points forces Final Boss battle!
    if (run.floor === 4 && !run.floor5BossCleared) {
      if (node && node.type === 'boss') {
        run.floor5BossCleared = true;
        sectorCleared();
        return true;
      } else {
        const bossNode = {
          id: 'floor5-boss',
          floor: 4,
          type: 'boss',
          displayName: 'SECTOR COMMANDER',
        };
        run.currentNode = bossNode;
        run.currentNodeId = bossNode.id;
        addFeedEntry(`<span class="feed-enemy-ability">OUT OF MOVES — THE FINAL BOSS ATTACKS!</span>`);
        startCombat(bossNode);
        return true;
      }
    }

    // Abyss floors: out of moves, the floor's keeper attacks (a Guardian or a Warden, see abyssKeeper)
    if (run.floor >= CONFIG.map.floors) {
      const keeper = abyssKeeper(run.floor - CONFIG.map.floors + 1);
      const bossNode = { id: `abyss-${run.floor}-boss`, floor: run.floor, type: keeper.type, displayName: keeper.name, abyss: true };
      run.currentNode = bossNode;
      run.currentNodeId = bossNode.id;
      addFeedEntry(`<span class="feed-enemy-ability">OUT OF MOVES — THE ${keeper.name} ATTACKS!</span>`);
      startCombat(bossNode);
      return true;
    }

    // Advance floor after miniboss or for standard floors
    if (run.floor < CONFIG.map.floors - 1) {
      run.floor += 1;
      run.resetFloorActions();
      currentFloorView = run.floor;
      reportQuest('floor_reached', { floor: run.floor, lostAnyCombat });
      const entry = findEntryNode(run.floor);
      if (entry) {
        run.currentNodeId = entry.id;
        run.currentNode = entry;
      }
      addFeedEntry(`<span class="feed-heal">FLOOR ${run.floor + 1} — enemies +${Math.round(CONFIG.floorScaling.hpPerFloor * run.floor * 100)}% HP, +${Math.round(CONFIG.floorScaling.atkPerFloor * run.floor * 100)}% ATK</span>`);
      returnToMap();
      return true;
    } else {
      endRun(true);
      return true;
    }
  }

  return false;
}

// ---------- Combat ----------

function startCombat(node) {
  battleNode = node;
  ui.closeModal();
  // Closing the app mid-fight restarts this fight from the top on resume
  persistRun('battle', { node, prevId: prevPosition?.id ?? null });
  if (node.type === 'combat') run.normalFights += 1;
  setState(State.BATTLE);
  ui.showBattleHud(run, node.type);

  // Knocked-out mechs sit fights out; with nobody standing (never expected) mech 1 limps in
  if (!run.teamAlive) run.hp = 1;

  const thinkDelay = CONFIG.ai.thinkDelay;
  const riskLevel = saveSystem.getDifficultyLevel();
  const riskData = saveSystem.getRiskData();

  const floorKey = Math.min(CONFIG.map.floors, run.floor + 1); // Abyss floors reuse floor 5's tables
  const abyssDepth = Math.max(0, run.floor - CONFIG.map.floors + 1);
  const tierKey = node.type === 'boss' ? 'boss' : node.type === 'miniboss' ? 'miniboss' : node.type === 'elite' ? 'elite' : String(floorKey);
  const tier = CONFIG.enemyTiers[tierKey] || CONFIG.enemyTiers[1];

  // Risk rules (elite/boss rules only hit elites, mini-bosses and bosses)
  const isEliteTier = ['elite', 'miniboss', 'boss'].includes(node.type);
  const cond = run.condition;
  const condHp = cond === 'gold_rush' ? 1.1 : 1;
  const condAtk = (cond === 'glass_war' ? 1.3 : 1) * (cond === 'blood_moon' ? 1.15 : 1);
  // Abyss: +8% HP and +5% ATK per depth, on top of the normal per-floor scaling
  // Low Risk softens every enemy; the Abyss is always full strength
  const ease = abyssDepth ? { hp: 1, atk: 1, ai: 0 } : riskEase(riskLevel);
  const hpMult = (1 + (riskData.hpPct + (isEliteTier ? riskData.eliteHpPct : 0)) / 100) * condHp * (1 + ABYSS_HP_PER_DEPTH * abyssDepth) * ease.hp;
  const atkMult = (1 + (riskData.atkPct + (isEliteTier ? riskData.eliteAtkPct : 0)) / 100) * condAtk * (1 + ABYSS_ATK_PER_DEPTH * abyssDepth) * ease.atk;
  const defMult = 1 + riskData.defPct / 100;
  // Visible floor scaling: +X% HP / +Y% ATK per floor above the first
  const floorsAbove = Math.min(run.floor, CONFIG.map.floors - 1); // capped at floor 5: the Abyss scales by depth instead
  const floorHp = 1 + CONFIG.floorScaling.hpPerFloor * floorsAbove;
  const floorAtk = 1 + CONFIG.floorScaling.atkPerFloor * floorsAbove;

  const count = (CONFIG.enemyCounts[node.type] || {})[floorKey] || 1;
  // One mech fights at a time, so a team only trims each mech's HP a little
  const waveHpScale = count === 3 ? 0.75 : count === 2 ? 0.85 : 1.0;
  const waveAtkScale = 1.0;
  const enemies = [];
  const devHp = devTools?.overrides?.enemyHpMult ?? 1.0;
  const devAtk = devTools?.overrides?.enemyAtkMult ?? 1.0;
  const devDef = devTools?.overrides?.enemyDefOffset ?? 0;

  for (let i = 0; i < count; i++) {
    const archetype = pickArchetype(node.type, floorKey, i);
    const arch = CONFIG.enemyArchetypes[archetype];
    const isBoss = node.type === 'boss' && i === 0;
    const isFinal = isBoss && abyssDepth === ABYSS_FINAL_DEPTH; // the true final boss
    const mech = enemyMech(node.type, archetype, run.floor + 1, Math.random, { atkMult: atkMult * waveAtkScale, boss: isBoss, final: isFinal });

    const finalHp = Math.round(tier.hp * CONFIG.gear.enemyHpScale * arch.hpMult * hpMult * floorHp * devHp * waveHpScale * (isFinal ? 1.5 : 1) * (node.type === 'boss' && i > 0 ? 0.55 : 1)); // boss escorts are lighter
    const finalAtk = Math.round((tier.atk * arch.atkMult * atkMult * floorAtk * devAtk * waveAtkScale) * 100) / 100;
    const finalDef = Math.max(0, Math.round((tier.def + arch.defBonus) * defMult) + devDef);

    const xPct = count === 1 ? 0.75 : count === 2 ? 0.66 + i * 0.16 : 0.58 + i * 0.13;

    enemies.push({
      maxHp: finalHp,
      atk: finalAtk,
      def: finalDef,
      displayName: isFinal ? 'KLONKADOO PRIME' : isBoss ? (abyssDepth ? `ABYSS WARDEN ${abyssDepth}` : 'SECTOR COMMANDER') : arch.name,
      rank: node.type === 'boss' || node.type === 'miniboss' ? node.type : null,
      archetype,
      aiDifficulty: Math.max(0.1, Math.min(0.95, tier.aiDifficulty + arch.aiShift + riskData.aiBonus + ease.ai)),
      thinkDelay,
      xPct,
      // Risk: RANGEFINDERS
      weapons: mech.weapons.map((w) => (riskData.enemyReach ? { ...w, reach: [w.reach[0], Math.min(CONFIG.lane.size - 1, w.reach[1] + riskData.enemyReach)] } : w)),
      droneOut: !!riskData.droneOut, // Risk: NIGHTMARE
      rig: enemyRig(node.type, { cdCut: riskData.gunCdCut || 0 }),
      legs: mech.legs,
      res: mech.res,
      parts: mech.parts,
      specials: mech.specials,
      drones: mech.drones,
      startForcefield: mech.startForcefield,
    });
  }

  const battleConfig = {
    player: {
      maxHp: run.maxHp,
      hp: run.hp, // carry current run HP into battle
      shieldHp: run.shieldHp || 0,
      atk: run.atk * (run.condition === 'glass_war' ? 1.3 : 1),
      def: run.def,
      totalDef: run.totalDef,
      res: run.res,
      damageReductionPct: run.damageReductionPct,
    },
    // Garage mechs 2 and 3 (SWAP in, or drop in after a knock-out)
    team: (run.team || []).map((_, i) => {
      const s = run.member(i + 1);
      return { rigStats: s.perm, hp: s.hp, maxHp: s.maxHp, atk: s.atk * (run.condition === 'glass_war' ? 1.3 : 1), def: s.def, totalDef: s.totalDef, res: { ...(s.perm.res || {}) }, damageReductionPct: run.damageReductionPct };
    }),
    enemies,
    nodeType: node.type,
    ballType: OPERATOR.id,
    skinColors: skinColors(OPERATOR, run.skin),
    rigStats: run.permanent, // equipped gear + mastery, fixed for the run
    showHints: saveSystem.getLifetime().runs === 0, // control tips: first run only
    riskLevel: riskLevel,
    riskPlusDmgTaken: riskData.plusDmgTaken || 0,
    riskDefPierce: riskData.defPierce || 0,
    floor: run.floor + 1,
    walkBonus: run.walkBonus,
    reachBonus: run.reachBonus,
    condition: run.condition,
  };

  // Wire quest hooks (clear old listeners first so no stacking)
  game.events.off('battle-end');
  game.events.off('player-dealt-damage');
  game.events.off('ability-used');
  game.events.off('enemy-ability');
  game.events.off('enemy-dealt-damage');

  // (Mid-battle events have no toast: damage already shows as floating numbers)
  game.events.on('player-dealt-damage', ({ damage }) => reportQuest('damage_dealt', { amount: damage }));
  game.events.on('battle-end', ({ won }) => onBattleEnd(won, node));
  game.events.on('ability-used', ({ id, name }) => {
    game.renderer.addCallout(game.player, name, '#ffcd75');
  });
  // Status ticks (burn): a short label over whoever it affects
  const STATUS_LABELS = { 'Thermal Burn': ['BURNING', '#ef7d57'] };
  game.events.on('enemy-ability', ({ enemy, ability }) => {
    const [text, color] = STATUS_LABELS[ability] || [ability.toUpperCase(), '#ff5d73'];
    game.renderer.addCallout(enemy || game.player, text, color);
  });

  game.run = run;
  battleConfig.arena = run.condition === 'calm' ? pickArena(0, () => 0) : pickArena(run.floor + 1);
  game.startBattle(battleConfig);
  setAutoBattle(autoBattle || autoRun); // AUTO carries over between fights

  // Bosses get an intro card; the fight is frozen until it is dismissed
  if (node.type === 'miniboss' || node.type === 'boss') {
    const boss = enemies[0];
    const arch = CONFIG.enemyArchetypes[boss.archetype];
    battlePaused = true;
    ui.showBossIntro({
      title: node.type === 'boss' ? (run.floor - CONFIG.map.floors + 1 === ABYSS_FINAL_DEPTH ? 'TRUE FINAL BOSS' : run.floor >= CONFIG.map.floors ? `ABYSS ${run.floor - CONFIG.map.floors + 1}` : 'FINAL BOSS')
        : run.floor >= CONFIG.map.floors ? `ABYSS ${run.floor - CONFIG.map.floors + 1} GUARDIAN` : `FLOOR ${run.floor + 1} MINI-BOSS`,
      name: boss.displayName,
      desc: boss.weapons.map((w) => w.name).join(' + ') + (node.type !== 'boss' ? `. ${arch?.desc || ''}`
        : run.floor - CONFIG.map.floors + 1 === ABYSS_FINAL_DEPTH ? '. Phase legs, reaches everywhere, and a blade for anyone who comes close.'
          : '. Bolted down with long guns: they can\'t hit you up close.'),
      color: arch?.color,
    }, () => {
      battlePaused = false;
      game.renderer.showBanner('FIGHT!', '#ff5d73');
    });
  }
}

/** Pick an enemy archetype based on floor weights. */
function pickArchetype(nodeType, floor, index) {
  const weights = CONFIG.archetypeWeights[['elite', 'miniboss', 'boss'].includes(nodeType) ? nodeType : floor] || CONFIG.archetypeWeights[1];
  // Waves roll each enemy from the same weights; escorts in a boss / elite
  // wave skip the heavy hitters so fights stay readable
  if (index > 0 && (nodeType === 'boss' || nodeType === 'miniboss')) return Math.random() < 0.5 ? 'standard' : 'striker';
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (const [key, w] of Object.entries(weights)) {
    roll -= w;
    if (roll <= 0) return key;
  }
  return 'standard';
}

function onBattleEnd(won, node) {
  // If player HP dropped to 0 or below, force won to false (permadeath check)
  if (game.player.hp <= 0) {
    won = false;
  }

  const damageTaken = game.battleStats.playerDamageTaken;
  pendingBoon = null;

  // Write battle HP back into the run (roguelike persistence): every team
  // mech keeps its own, and a knocked-out one stays down until a Safe Zone
  const teamHp = game.teamHp();
  run.hp = Math.max(0, Math.min(run.maxHp, teamHp[0]));
  (run.team || []).forEach((m, i) => (m.hp = teamHp[i + 1] ?? m.hp));
  run.shieldHp = Math.max(0, Math.round(game.player.shieldHp || 0));

  // Per-class + lifetime stats (skins, medals)
  saveSystem.addBattleStats(run.ballType, game.battleStats.track);
  ui.celebrateMedals(checkMedals(saveSystem));
  if (won) {
    run.onCombatWon();
    // Garage slots: mech 2 after the first floor 5 boss, mech 3 after the first Abyss boss
    if (node.type === 'boss') {
      const slot = run.floor >= CONFIG.map.floors ? 3 : run.floor === CONFIG.map.floors - 1 ? 2 : 0;
      if (slot && saveSystem.unlockGarageSlot(slot)) {
        addFeedEntry(`<span class="feed-boon">GARAGE: MECH ${slot} UNLOCKED</span>`);
        game.renderer.showBanner(`MECH ${slot} UNLOCKED`, '#ffcd75');
      }
    }
  } else {
    run.onCombatLost();
    lostAnyCombat = true;
  }

  // Quest reporting
  reportQuest('combat_end', {
    won,
    turns: game.battleStats.turns,
    damageTaken,
    playerHpLeft: run.hp,
    nodeType: node.type,
    lostAnyCombat,
  });

  if (won) {
    const rewards = CONFIG.nodes.rewards[node.type] || CONFIG.nodes.rewards.combat;
    let gold = 0;
    let scrap = 0;
    let heal = 0;

    if (rewards.gold) {
      gold = run.gainGold(rewards.gold);
    }
    // Scrap upgrades parts: saved at once, kept even if the run is lost
    if (rewards.scrap) {
      scrap = Math.max(1, Math.round(rewards.scrap * scrapMult() * (run.condition === 'blood_moon' ? 1.5 : 1)));
      run.earnScrap(scrap);
    }
    // Winning doesn't repair you: HP carries into the next fight (Safe Zones, repairs, Nano Repair).
    // No toasts for these: the battle report lists every reward.
    const medic = run.permanent?.mech?.healAfterWin || 0;
    if (medic > 0) {
      const extra = Math.round(run.maxHp * medic);
      heal = run.healFlat(extra);
    }

    // Keys (saved as `tokens`) open supply pods on the Rig screen; saved at once, so they're kept even if the run is lost
    // Normal fights won without a scratch: bonus Keys and gold
    const clean = node.type === 'combat' && damageTaken === 0;
    const tokens = riskKeys(tokenReward(node.type) + (clean ? CLEAN_WIN_KEYS : 0)) + (run.permanent?.bonusKeys || 0);
    if (clean) {
      gold += run.gainGold(8);
    }
    if (tokens > 0) {
      run.earnKeys(tokens);
    }

    // Chance for a boon drop on combat wins only
    pendingBoon = rollBoon(node.type);
    if (pendingBoon) {
      addFeedEntry(`<span class="feed-boon">BOON DROP: ${pendingBoon.name}</span>`);
    }

    ui.updateRunHud(run);
    // Final boss (or an Abyss keeper): let the VICTORY splash land, then the descend choice
    if (node.type === 'boss' || (node.type === 'miniboss' && run.floor >= CONFIG.map.floors)) {
      run.floor5BossCleared = true;
      pendingBoon = null;
      persistRun('sector');
      setTimeout(() => sectorCleared(), 1400);
      return;
    }
    // Rewards are paid: a reload must continue from here, not replay the fight
    persistRun('combat', { pendingBoonId: pendingBoon?.id });
    // Let the finishing blow and the VICTORY splash land, then the report
    const rewardsWon = { gold, scrap, heal, tokens, clean };
    setTimeout(() => ui.showCombatResult(true, rewardsWon, run, battleReport(node, damageTaken)), 900);
  } else {
    ui.updateRunHud(run);
    persistRun('combat');
    setTimeout(() => ui.showCombatResult(false, null, run, battleReport(node, damageTaken)), 900);
  }
}

/** Keys with the Risk bonus; the fraction left over carries to the next payout so every % counts. */
function riskKeys(base) {
  const raw = base * saveSystem.getKeyMultiplier() + (run.keyCarry || 0);
  const n = Math.floor(raw + 1e-9);
  run.keyCarry = raw - n;
  return n;
}

/** Scrap multiplier: Risk plus mastery SCAVENGER. */
function scrapMult() {
  return saveSystem.getScrapMultiplier() + (run.permanent?.scrapPct || 0);
}

/** Numbers for the end-of-battle report (Game.battleStats). */
function battleReport(node, damageTaken) {
  const bs = game.battleStats;
  const label = { boss: 'BOSS', miniboss: 'MINI-BOSS', elite: 'ELITE' }[node.type] || 'COMBAT';
  const where = run.floor >= CONFIG.map.floors ? `ABYSS ${run.floor - CONFIG.map.floors + 1}` : `FLOOR ${run.floor + 1}`;
  return {
    ...bs.report,
    taken: damageTaken,
    bestHit: bs.track.bestHit,
    kills: bs.track.kills,
    turns: bs.turns,
    nodeLabel: `${where} · ${label}`,
  };
}

function continueAfterCombatReport() {
  // Roguelike permadeath: the run ends when every mech is knocked out
  if (!run.teamAlive) {
    map.visitNode(run.floor, run.currentNodeId);
    ui.closeModal();
    endRun(false);
    return;
  }

  // Mark node cleared & spend floor action
  map.visitNode(run.floor, run.currentNodeId);
  run.spendFloorAction();
  ui.updateRunHud(run);

  if (pendingBoon) {
    const boon = pendingBoon;
    pendingBoon = null;
    ui.showBoon(boon);
    return;
  }

  if (!advanceFloorIfNeeded()) {
    returnToMap();
  }
}

function rollBoon(nodeType) {
  const chance = nodeType === 'boss' ? 0.6 : nodeType === 'elite' ? 0.35 : 0.18;
  if (Math.random() > chance) return null;
  const available = CONFIG.boons.filter((b) => !run.boons.includes(b.id));
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}

// ---------- Encounter ----------

function startEncounter(node) {
  const encounters = ENCOUNTERS;
  const enc = encounters[Math.floor(Math.random() * encounters.length)];
  node.encounter = enc;
  ui.showEncounterOptions(enc, run);
}

function resolveEncounterChoice(idx) {
  const node = run.currentNode;
  const enc = node?.encounter;
  if (!enc) return;
  const choice = enc.choices[idx];
  if (choice) {
    if (choice.loseHp) {
      run.hp = Math.max(1, run.hp - choice.loseHp);
      addFeedEntry(`<span class="feed-dmg">-${choice.loseHp} HP SACRIFICED</span>`);
    }
    if (choice.loseGold) {
      run.gold = Math.max(0, run.gold - choice.loseGold);
      addFeedEntry(`<span class="feed-gold">-${choice.loseGold} GOLD SPENT</span>`);
    }
    if (choice.gainGold) {
      run.gainGold(choice.gainGold);
      addFeedEntry(`<span class="feed-gold">+${choice.gainGold} GOLD</span>`);
    }
    if (choice.loseMaxHp) {
      run.maxHp = Math.max(20, run.maxHp - choice.loseMaxHp);
      run.hp = Math.min(run.hp, run.maxHp);
    }
    if (choice.gambleGold) {
      if (Math.random() < 0.5) {
        const g = run.gainGold(choice.gambleGold);
        addFeedEntry(`<span class="feed-gold">JACKPOT: +${g} GOLD</span>`);
      } else {
        addFeedEntry(`<span class="feed-dmg">NO LUCK THIS TIME</span>`);
      }
    }
    if (choice.gainBoon) run.applyBoon(choice.gainBoon);
    if (choice.gainMaxHp) run.addMaxHp(choice.gainMaxHp);
    if (choice.heal) {
      run.healFlat(choice.heal);
      addFeedEntry(`<span class="feed-heal">+${choice.heal} HP RECOVERED</span>`);
    }
    if (choice.gainScrap) {
      run.earnScrap(choice.gainScrap);
      addFeedEntry(`<span class="feed-boon">+${choice.gainScrap} SCRAP</span>`);
    }
    if (choice.gainKeys) {
      run.earnKeys(choice.gainKeys);
      addFeedEntry(`<span class="feed-gold">+${choice.gainKeys} KEYS</span>`);
    }
    if (choice.gainActions) {
      run.addFloorActions(choice.gainActions);
      addFeedEntry(`<span class="feed-heal">+${choice.gainActions} MOVE${choice.gainActions > 1 ? 'S' : ''}</span>`);
    }
    ui.updateRunHud(run);
  }
  map.visitNode(run.floor, node.id);
  run.spendFloorAction();
  ui.updateRunHud(run);
  if (!advanceFloorIfNeeded()) returnToMap();
}

// ---------- Shop ----------

/** Three shelf slots: { id, sold } (the supply is looked up by id, so saves stay small). */
function rollShopItems() {
  return rollSupplies(3).map((s) => ({ id: s.id, sold: false }));
}

/** Buy shelf slot `i` of the current shop. */
function buySupply(i) {
  const item = run?.currentNode?.shopItems?.[i];
  const s = item && !item.sold ? getSupply(item.id) : null;
  if (!s || !run.spendGold(run.price(s.cost))) return false;
  item.sold = true;
  reportQuest('gold_spent', { totalSpent: run.totalGoldSpent });
  soundEngine.play('coin');
  addFeedEntry(`<span class="feed-boon">BOUGHT: ${grantSupply(s, run)}</span>`);
  ui.updateRunHud(run);
  return true;
}

// ---------- Rest ----------

function resolveRest(choice) {
  if (choice === 'heal') {
    const revived = run.knockedOut;
    const healed = run.healFlat(run.restHeal, { revive: true }); // the one place knocked-out mechs come back
    soundEngine.play('heal');
    // Recovery quest counts every Safe Zone heal across the run
    run.maxRestHealed = (run.maxRestHealed || 0) + healed;
    reportQuest('rest', { healed: run.maxRestHealed });
    addFeedEntry(`<span class="feed-heal">SAFE ZONE: +${healed} HP RECOVERED${revived ? ` · ${revived} MECH${revived > 1 ? 'S' : ''} BACK ONLINE` : ''}</span>`);
  }
  map.visitNode(run.floor, run.currentNodeId);
  run.spendFloorAction();
  ui.updateRunHud(run);
  if (!advanceFloorIfNeeded()) returnToMap();
}

// ---------- Minigame ----------

function startMinigame() {
  setState(State.MINIGAME);
  ui.closeModal();
  ui.showMinigameView();
  minigameResultShown = false;
  minigame.start();
}

function calculateAndApplyMinigameRewards(result) {
  if (!result) return null;

  const hits = result.hits || 0;
  const perfects = result.perfects || 0;
  const totalAttempts = result.totalAttempts || 5;
  const isAllPerfect = hits === totalAttempts && perfects === totalAttempts;

  let gold = 0;
  let healText = '';
  let keys = 0;

  if (isAllPerfect) {
    gold = run.gainGold(40);
    healText = 'Full HP Recovery';
    run.healFull();

    keys = 3;
    addFeedEntry(`<span class="feed-heal">FLAWLESS DRILL: FULL HP & ${keys} KEYS</span>`);
  } else if (perfects >= 3) {
    gold = run.gainGold(25);
    const effectiveHeal = Math.round(50 * saveSystem.getHealingMultiplier());
    healText = `+${effectiveHeal} HP Healed`;
    run.healFlat(50);

    keys = 1;
    addFeedEntry(`<span class="feed-heal">PRECISION DRILL: +${effectiveHeal} HP & 1 KEY</span>`);
  } else if (hits >= 3) {
    gold = run.gainGold(15);
    addFeedEntry(`<span class="feed-gold">DRILL PASSED: +${gold} GOLD</span>`);
  } else {
    gold = run.gainGold(5);
    addFeedEntry(`<span class="feed-gold">DRILL CONSOLATION: +${gold} GOLD</span>`);
  }

  if (keys) {
    run.earnKeys(keys);
  }
  reportQuest('minigame', { perfect: isAllPerfect });
  ui.updateRunHud(run);
  persistRun('minigame'); // rewards paid: a reload finishes the tile instead of replaying it

  return {
    gold,
    healText,
    keys,
    hits,
    perfects,
    isAllPerfect,
  };
}

function finishMinigame() {
  minigame.dismissResult();
  map.visitNode(run.floor, run.currentNodeId);
  run.spendFloorAction();
  ui.updateRunHud(run);
  if (!advanceFloorIfNeeded()) returnToMap();
}

// ---------- Run end ----------

// Endless Abyss: extra enemy scaling per floor below floor 5 (HP and ATK
// alike). Each floor ends in a keeper: a Guardian (mini-boss) on odd depths,
// a Warden (boss) on even ones; Abyss 5's is the true final boss. Every
// keeper pays Keys, scrap and a free pod (Abyss Pod from Risk 7, else Elite).
const ABYSS_FINAL_DEPTH = 5;
const ABYSS_HP_PER_DEPTH = 0.08;
const ABYSS_ATK_PER_DEPTH = 0.08;

/** Who ends Abyss floor `depth`. */
function abyssKeeper(depth) {
  if (depth === ABYSS_FINAL_DEPTH || depth % 2 === 0) return { type: 'boss', name: 'ABYSS WARDEN' };
  return { type: 'miniboss', name: 'ABYSS GUARDIAN' };
}

/** The pod an Abyss keeper drops: the Abyss Pod once the run's Risk allows it, else the best below. */
function abyssPodFor(risk) {
  const open = CRATES.filter((c) => !c.minRisk || risk >= c.minRisk);
  return open[open.length - 1];
}

/**
 * A boss is down. The first time (floor 5) the run counts as won right
 * away; after that each Abyss warden pays Keys and scrap. Either way the
 * player chooses: extract with the win, or descend one floor deeper.
 */
function sectorCleared() {
  const depth = Math.max(0, run.floor - CONFIG.map.floors + 1);
  let rewards = null;
  if (!run.victoryRecorded) {
    recordVictory();
  } else {
    run.abyssDepth = depth;
    saveSystem.recordAbyssDepth(run.ballType, depth);
    const final = depth === ABYSS_FINAL_DEPTH;
    const keys = riskKeys(5 + depth * 3 + (final ? 20 : 0));
    const scrap = Math.round((20 + depth * 8 + (final ? 80 : 0)) * scrapMult());
    run.earnKeys(keys);
    run.earnScrap(scrap);
    const pod = abyssPodFor(run.risk ?? saveSystem.getDifficultyLevel());
    const pods = saveSystem.getRewardMultiplier(); // Risk XI: two pods
    saveSystem.addPodCredit(pod.id, pods);
    run.podsEarned = (run.podsEarned || 0) + pods;
    rewards = { keys, scrap, final, pod, pods };
    if (final) {
      saveSystem.bumpLifetime('trueFinalClears', 1, 'add');
      addFeedEntry('<span class="feed-boon">KLONKADOO PRIME IS DOWN: THE ABYSS GOES ON FOREVER</span>');
    }
  }
  ui.updateRunHud(run);
  stopAutoRun('SECTOR CLEARED'); // the Abyss is yours to choose
  persistRun('descend', { descend: { depth, next: depth + 1 } });
  const next = depth + 1;
  ui.showDescend({ depth, next, rewards, hp: run.hp, maxHp: run.maxHp, keeper: abyssKeeper(next).name, scaling: { hp: next * ABYSS_HP_PER_DEPTH, atk: next * ABYSS_ATK_PER_DEPTH }, nextKeys: 5 + next * 3 }, descend, () => endRun(true));
}

/** Endless Abyss: a new floor laid out like floor 5, deeper and harder. */
function descend() {
  ui.closeModal();
  const idx = map.addAbyssFloor();
  // Risk XI: common hostiles become elites here too
  if (saveSystem.getRiskData().allElite) for (const n of map.floors[idx].nodes) if (n.type === 'combat') n.type = 'elite';
  run.floor = idx;
  run.resetFloorActions();
  currentFloorView = idx;
  const entry = findEntryNode(idx);
  run.currentNodeId = entry?.id;
  run.currentNode = entry;
  const depth = idx - CONFIG.map.floors + 1;
  addFeedEntry(`<span class="feed-enemy-ability">ABYSS ${depth}: enemies +${Math.round(depth * ABYSS_HP_PER_DEPTH * 100)}% HP, +${Math.round(depth * ABYSS_ATK_PER_DEPTH * 100)}% ATK</span>`);
  returnToMap();
}

/** Win bookkeeping, done once per run (when the floor 5 boss falls). */
function recordVictory() {
  run.victoryRecorded = true;
  const lvl = saveSystem.getDifficultyLevel();
  saveSystem.recordRun(true);
  saveSystem.recordBallRun(run.ballType, true, CONFIG.map.floors, lvl);
  saveSystem.bumpLifetime('bestRiskWin', lvl);
  ui.celebrateMedals(checkMedals(saveSystem));
  // Risk progression: a win on the ball's highest unlocked level unlocks its next
  run.riskUnlocked = saveSystem.recordRiskWin(lvl, run.ballType);
  // Secret Risk XI: a Risk 10 win that skipped every common hostile
  if (lvl === CONFIG.risk.levels.length && !saveSystem.data.secretRisk) {
    run.secretResult = run.normalFights === 0 && saveSystem.unlockSecretRisk() ? { unlocked: true } : { unlocked: false, fights: run.normalFights };
  }
}

function endRun(victory) {
  stopAutoRun();
  // Dying in the Abyss after clearing the sector still counts as a win
  const won = victory || !!run.victoryRecorded;
  run.runOver = true;
  clearRun();
  run.runResult = won ? 'victory' : 'defeat';
  if (!run.victoryRecorded) {
    if (won) recordVictory();
    else {
      saveSystem.recordRun(false);
      saveSystem.recordBallRun(run.ballType, false, run.floor + 1, saveSystem.getDifficultyLevel());
      ui.celebrateMedals(checkMedals(saveSystem));
    }
  }
  // Mastery XP for the ball, win or lose
  const xp = runXp({
    floorsReached: Math.min(CONFIG.map.floors, run.floor + 1),
    fightsWon: run.combatsWon,
    victory: won,
    risk: saveSystem.getDifficultyLevel(),
    abyssDepth: run.abyssDepth || 0,
  });
  const levels = saveSystem.addMasteryXp(run.ballType, xp);

  activeNode = null;
  ui.closeModal();
  setState(State.RESULT);
  ui.showRunResult(run, questSystem.getActiveQuests(), saveSystem.getMeta());
  ui.showMasteryResult(run.ball, xp, levels, saveSystem.getMasteryXp(run.ballType));

  if (run.riskUnlocked) {
    ui.showRiskUnlocked(run.riskUnlocked, CONFIG.risk.levels[run.riskUnlocked - 1]);
  }
  if (run.secretResult) ui.showSecretRisk(run.secretResult.unlocked, run.secretResult.fights);
}

// ---------- Encounters (small pool, can expand) ----------

const ENCOUNTERS = [
  {
    title: 'BEACON OVERCLOCK',
    desc: 'A tactical terminal can override local map relays to gain extra operational time.',
    choices: [
      { label: 'Force Overclock Relay', loseHp: 15, gainActions: 1 },
      { label: 'Standard Data Extraction', gainGold: 12 },
    ],
  },
  {
    title: 'VANGUARD SIGNAL DISPATCH',
    desc: 'An emergency beacon picks up a supply frequency from frontline logistics.',
    choices: [
      { label: 'Request Medical Care Package', heal: 30 },
      { label: 'Request Overcharge Ammunition', gainBoon: 'boon_atk' },
    ],
  },
  {
    title: 'DEFECTOR INTEL',
    desc: 'A rogue enemy defector offers secret patrol coordinates for a price.',
    choices: [
      { label: 'Purchase Coordinates', loseGold: 12, gainScrap: 12 },
      { label: 'Interrogate Defector', loseHp: 8, gainGold: 18 },
    ],
  },
  {
    title: 'SINGULARITY CRYSTAL NODE',
    desc: 'A pulsating shard of crystal energy embeds itself in the terrain.',
    choices: [
      { label: 'Extract High-Purity Shard', loseHp: 12, gainBoon: 'boon_power' },
      { label: 'Siphon Ground Resonance', gainMaxHp: 10 },
    ],
  },
  {
    title: 'ABANDONED SUPPLY DEPOT',
    desc: 'A blast door seals a forgotten supply vault. Heavy power required to force it.',
    choices: [
      { label: 'Breach Reinforced Vault', loseHp: 10, gainGold: 22 },
      { label: 'Scavenge Exterior Crates', heal: 15, gainGold: 8 },
    ],
  },
  {
    title: 'BLACK-MARKET BROKER',
    desc: 'A shadowy smuggler offers forbidden tech upgrades in exchange for cash or blood.',
    choices: [
      { label: 'Pay Bribe for Tactical Map', loseGold: 18, gainActions: 1 },
      { label: 'Trade Combat Records', gainGold: 20 },
    ],
  },
  {
    title: 'FIELD TRIAGE STATION',
    desc: 'An automated medical pod remains powered in the ruins.',
    choices: [
      { label: 'Perform Intensive Surgery', heal: 45 },
      { label: 'Install Vitality Booster', gainMaxHp: 15, loseHp: 8 },
    ],
  },
  {
    title: 'WANDERING MERCENARY',
    desc: 'A veteran frontline mercenary offers tactical instruction.',
    choices: [
      { label: 'Hire Vanguard Drill Master', loseGold: 15, gainBoon: 'boon_atk' },
      { label: 'Spar with Mercenary', loseHp: 10, gainBoon: 'boon_def' },
    ],
  },
  {
    title: 'GLADIATOR DUEL ARENA',
    desc: 'An underground arena pit challenges passing operators.',
    choices: [
      { label: 'Enter Arena Ring', loseHp: 14, gainGold: 28, gainScrap: 12 },
      { label: 'Decline and Watch', heal: 12 },
    ],
  },
  {
    title: 'SECTOR RADAR ARRAY',
    desc: 'A radar dish sweeps the sector. Overcharging it can locate map paths or burn out power.',
    choices: [
      { label: 'Overcharge Transmitter Core', loseHp: 20, gainActions: 1, gainGold: 10 },
      { label: 'Collect Sector Telemetry', gainScrap: 12 },
    ],
  },
  {
    title: 'SEALED VAULT',
    desc: 'A sealed supply vault, its lock still humming.',
    choices: [
      { label: 'Crack the Lock', loseHp: 12, gainKeys: 2 },
      { label: 'Salvage Gold Trim', gainGold: 16 },
    ],
  },
  {
    title: 'SMUGGLER CONTRABAND',
    desc: 'A crate marked with syndicate seals sits in an alleyway.',
    choices: [
      { label: 'Purchase Contraband Pack', loseGold: 14, gainBoon: 'boon_greed' },
      { label: 'Inspect Contents Safely', gainGold: 10 },
    ],
  },
  {
    title: 'STRATEGIC EMERGENCY',
    desc: 'Hazardous weather approaches. Speeding through requires emergency thrusters.',
    choices: [
      { label: 'Burn Emergency Thrusters', loseHp: 16, gainActions: 1 },
      { label: 'Hunker Down and Recover', heal: 22 },
    ],
  },
  {
    title: 'ANOMALOUS ENERGY WELL',
    desc: 'A glowing energy rift swirls in the center of the sector.',
    choices: [
      { label: 'Channel Raw Energy', loseHp: 18, gainMaxHp: 20 },
      { label: 'Stabilize Energy Rift', heal: 25 },
    ],
  },
  {
    title: 'UNKNOWING FOG',
    desc: 'A dense, impenetrable mist shrouds the forward path. Navigating blindly is risky but yields extra action time.',
    choices: [
      { label: 'Push Through Dense Mist', loseHp: 14, gainActions: 1 },
      { label: 'Scavenge Fog Margins', gainGold: 14 },
    ],
  },
  {
    title: 'CRASHED SUPPLY DRONE',
    desc: 'A courier drone lies sparking in the rubble, its cargo bay half open.',
    choices: [
      { label: 'Salvage the Cargo', loseHp: 8, gainKeys: 2 },
      { label: 'Siphon its Battery', heal: 20 },
    ],
  },
  {
    title: 'THE OLD SNIPER',
    desc: 'A retired marksman squints at your slingshot and offers to share a trick.',
    choices: [
      { label: 'Pay for the Lesson', loseGold: 10, gainBoon: 'boon_power' },
      { label: 'Trade War Stories', gainScrap: 6 },
    ],
  },
  {
    title: 'ABANDONED ARMORY',
    desc: 'Racks of dusty plating line the walls. Most of it has rusted through.',
    choices: [
      { label: 'Strap on the Heavy Plate', loseHp: 6, gainBoon: 'boon_def' },
      { label: 'Sell the Scrap', gainGold: 18 },
    ],
  },
  {
    title: 'BLOOD CONTRACT',
    desc: 'A hooded broker offers raw power. The ink looks suspiciously red.',
    choices: [
      { label: 'Sign the Contract', loseMaxHp: 10, gainBoon: 'boon_atk' },
      { label: 'Refuse and Walk Away', heal: 5 },
    ],
  },
  {
    title: 'RUSTED SLOT MACHINE',
    desc: 'It still takes coins. It might even pay out, if the gears remember how.',
    choices: [
      { label: 'Pull the Lever', loseGold: 10, gambleGold: 30 },
      { label: 'Kick it for Loose Change', gainGold: 5 },
    ],
  },
  {
    title: 'ECHOING CAVE',
    desc: 'Something in the dark repeats your footsteps, a half-second too late.',
    choices: [
      { label: 'Explore Deeper', loseHp: 14, gainKeys: 2 },
      { label: 'Leave Quietly', heal: 10 },
    ],
  },
  {
    title: 'FIELD KITCHEN',
    desc: 'A mobile kitchen still smells of stew. Nobody is around to stop you.',
    choices: [
      { label: 'Eat a Full Meal', heal: 35 },
      { label: 'Pack Rations for Later', gainMaxHp: 8 },
    ],
  },
  {
    title: 'LOST RECRUIT',
    desc: 'A lost recruit begs for directions back to base.',
    choices: [
      { label: 'Escort them Personally', loseHp: 5, gainScrap: 12 },
      { label: 'Point the Way', gainGold: 6 },
    ],
  },
  {
    title: 'SYNDICATE TRADE DELEGATE',
    desc: 'A high-ranking trade official offers a high-yield investment.',
    choices: [
      { label: 'Invest Capital in Syndicate', loseGold: 15, gainScrap: 18 },
      { label: 'Accept Courtesy Stipend', gainGold: 12 },
    ],
  },
];

// ---------- Main loop ----------

let lastTime = performance.now();

function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  if (state === State.BATTLE) {
    // AUTO plays faster: 2x in AUTO battle, 3x on AUTO RUN (same steps, just more per frame)
    const steps = autoRun ? 3 : autoBattle ? 2 : 1;
    if (!battlePaused) for (let i = 0; i < steps; i++) game.update(dt);
    game.render();
    updateAbilityHud();
    updateMechHud();
    battleTips.refresh();
  } else if (state === State.MINIGAME) {
    minigame.update(dt);
    minigame.render();
    // When the minigame transitions to result, show the modal once
    if (minigame.mode === 'result' && !minigameResultShown) {
      minigameResultShown = true;
      const rewards = calculateAndApplyMinigameRewards(minigame.result);
      ui.showMinigameResult(minigame.result, rewards);
    }
  }

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

// ---------- Boot ----------

ui.showMenu(saveSystem.getProfile(), saveSystem.getMeta());
soundEngine.playMusic('menu'); // begins after the first tap
new MenuBackground(document.getElementById('menu-bg'));
bindMapClicks();
bindAbilityButtons();
// GitHub builds: offer a newer release once the menu is up (no-op on the web)
setTimeout(() => ui.checkUpdates(), 1500);

// Expose for debugging
// Debug handle for the dev server only; release builds don't expose game state
if (import.meta.env.DEV) window.__SLINGSHOT__ = { game, saveSystem, ui, get run() { return run; }, get map() { return map; }, sectorCleared, descend, endRun, startCombat, startNewRun };