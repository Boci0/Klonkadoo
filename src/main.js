// ============================================================
// SLINGSHOT OPS — entry point + App state machine.
// Orchestrates: main menu → tech tree → roguelike run map →
// node events → slingshot battles → run results → meta progression.
// ============================================================

import './styles.css';
import { CONFIG } from './config.js';
import { Game } from './core/Game.js';
import { saveSystem } from './meta/SaveSystem.js';
import { UpgradeSystem } from './meta/UpgradeSystem.js';
import { TechTree } from './meta/TechTree.js';
import { QuestSystem } from './meta/QuestSystem.js';
import { RunState } from './rogue/RunState.js';
import { RogueMap } from './rogue/RogueMap.js';
import { RogueMapRenderer } from './rendering/RogueMapRenderer.js';
import { Minigame } from './minigame/Minigame.js';
import { UIManager } from './ui/UIManager.js';
import { pickRelics } from './meta/Relics.js';
import { pickArena } from './core/Arenas.js';
import { OPERATOR, skinColors } from './meta/Balls.js';
import { MenuBackground } from './rendering/MenuBackground.js';
import { soundEngine } from './utils/SoundEngine.js';
import { haptics } from './platform/haptics.js';
import { DevTools } from './dev/DevTools.js';
import { checkMedals } from './meta/Medals.js';
import './platform/native.js';
import './platform/desktop.js';
import { withMech, tokenReward, enemyWeapons, enemyRig, enemyLegs, CLEAN_WIN_KEYS } from './meta/Mech.js';
import { partIcon } from './rendering/pixelIcons.js';
import { ballDataUrl, CLASS_PATTERN } from './rendering/ballSprite.js';
import { withMastery, masteryLevel, runXp } from './meta/Mastery.js';
import { writeRun, readRun, clearRun, hasSavedRun, savedRunInfo, patchRunQuests } from './rogue/RunSave.js';

// Canvas text only uses a web font once it's loaded: fetch the digit face up front
document.fonts?.load('16px "Pixel Digits"', '0123456789').catch(() => {});

// ---------- Core systems ----------

const canvas = document.getElementById('game-canvas');

// One shared save instance for the whole app (UI, run state and battle all read it)
const upgradeSystem = new UpgradeSystem(saveSystem);
upgradeSystem.applyUpgrades();

const techTree = new TechTree(saveSystem);
const game = new Game(canvas);
const minigame = new Minigame(canvas);
let mapRenderer = null;
// Dev panel only exists on the Vite dev server, never in release builds
const devTools = import.meta.env.DEV ? new DevTools(() => game, () => run, saveSystem, techTree) : null;

// ---------- Run state ----------

let run = null;
let map = null;
let questSystem = null;
let runSeed = 1;
let currentFloorView = 0;
let pendingBoon = null;
let lostAnyCombat = false;
let activeNode = null; // node currently being resolved
const BASE_GRAVITY = CONFIG.world.gravity; // operation conditions scale this per run
let prevPosition = null; // where the player stood before selecting activeNode (for BACK / RETREAT)
let battlePaused = false; // battle simulation frozen (e.g. retreat confirmation open)
let minigameResultShown = false;

// ---------- App state machine ----------

const State = {
  MENU: 'MENU',
  TECH: 'TECH',
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
  onOpenTech: () => {
    setState(State.TECH);
    ui.showTech(techTree, saveSystem);
  },
  onBallChanged: () => updateRiskDisplay(saveSystem.getDifficultyLevel()),
  onBackToMenu: () => {
    setState(State.MENU);
    ui.showMenu(saveSystem.getProfile(), saveSystem.getMeta());
  },
  onRetreat: () => endRun(false),
  onRunEndConfirm: () => {
    setState(State.MENU);
    ui.showMenu(saveSystem.getProfile(), saveSystem.getMeta());
  },
  onTechPurchase: (nodeId) => {
    if (techTree.purchase(nodeId)) {
      ui.showTech(techTree, saveSystem);
    }
  },
  getTechPoints: () => saveSystem.data.techPoints,
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
  onRelicBuy: (relic) => buyRelicItem(relic),
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
      node.shopItems = rollShopCollectibles(run, 3);
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

/** Shop reroll price (Merchant Network perk discounts it). */
function rerollCost() {
  return Math.max(1, Math.round(8 * (1 - (run?.permanent?.rerollDiscountBonus || 0))));
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
  const btnBarrier = document.getElementById('btn-barrier');

  const triggerBarrier = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (state !== State.BATTLE) return;
    if (game.useAbility('barrier')) {
      updateAbilityHud();
    }
  };

  document.getElementById('btn-retreat-battle')?.addEventListener('click', () => {
    if (!canRetreatFromBattle()) return;
    soundEngine.playUI();
    battlePaused = true;
    ui.showRetreatConfirm(retreatCost(), {
      onConfirm: retreatFromBattle,
      onCancel: () => { battlePaused = false; },
    });
  });
  if (btnBarrier) bindBarrierDrag(btnBarrier);

  // Gear combat: END TURN (skip the actions you have left) and VENT (1 action)
  document.getElementById('btn-end-turn')?.addEventListener('click', () => {
    if (state !== State.BATTLE || battlePaused) return;
    if (game.endPlayerTurn()) soundEngine.playUI();
    else soundEngine.play('error');
  });
  document.getElementById('btn-vent')?.addEventListener('click', () => {
    if (state !== State.BATTLE || battlePaused) return;
    if (!game.ventPlayer()) soundEngine.play('error');
  });

  // Keyboard hotkeys: [Q] [E] guns, [2] / [B] barrier, [V] vent, [Space] end turn
  window.addEventListener('keydown', (e) => {
    if (state !== State.BATTLE || battlePaused) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.key === '2' || e.code === 'Digit2' || e.code === 'Numpad2' || e.code === 'KeyB') {
      triggerBarrier(e);
    } else if (e.code === 'KeyQ' || e.code === 'KeyE') {
      fireGun(e.code === 'KeyQ' ? 0 : 1);
    } else if (e.code === 'Space') {
      e.preventDefault();
      if (game.endPlayerTurn()) soundEngine.playUI();
    } else if (e.code === 'KeyV') {
      if (!game.ventPlayer()) soundEngine.play('error');
    }
  });
}

/**
 * BARRIER is drag-and-drop: press the button, drag onto the arena and release
 * to place it. Dragging back onto the button (or releasing without moving)
 * cancels. The ghost wall follows the finger.
 */
function bindBarrierDrag(btn) {
  let drag = null;
  const input = game.slingshotInput;
  const overButton = (e) => {
    const r = btn.getBoundingClientRect();
    const m = 10; // generous cancel zone
    return e.clientX >= r.left - m && e.clientX <= r.right + m && e.clientY >= r.top - m && e.clientY <= r.bottom + m;
  };
  const end = (e, cancelled) => {
    if (!drag || e.pointerId !== drag.id) return;
    const moved = drag.moved;
    drag = null;
    btn.classList.remove('dragging');
    game.renderer.barrierCancelHover = false;
    input.placementCancel = false;
    input.cancelPlacement();
    if (cancelled || !moved || overButton(e)) {
      soundEngine.playUI(440);
      if (!moved) game.renderer.showBanner('DRAG ONTO THE ARENA', '#73eff7');
      return;
    }
    const pos = game.renderer.clientToWorld(e.clientX, e.clientY);
    if (game.deployBarrierAt(pos.x, pos.y)) {
      haptics.impact('medium');
      updateAbilityHud();
    }
  };

  btn.addEventListener('pointerdown', (e) => {
    if (state !== State.BATTLE || drag) return;
    const ab = game.abilities?.barrier;
    // Placing a barrier is one of your actions, on your turn only
    if (!game.canPlayerAct || battlePaused || !ab?.ready || game.playerBarrierCount >= game._maxBarriers()) {
      soundEngine.play('error');
      return;
    }
    e.preventDefault();
    btn.setPointerCapture?.(e.pointerId);
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    btn.classList.add('dragging');
    input.placementMode = 'barrier';
    input.placementPos = game.renderer.clientToWorld(e.clientX, e.clientY);
    haptics.impact('light');
    soundEngine.playUI(660);
  });
  btn.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 12) drag.moved = true;
    input.placementPos = game.renderer.clientToWorld(e.clientX, e.clientY);
    const cancel = overButton(e);
    input.placementCancel = cancel;
    game.renderer.barrierCancelHover = cancel;
    btn.classList.toggle('cancel-hover', cancel && drag.moved);
  });
  btn.addEventListener('pointerup', (e) => {
    btn.classList.remove('cancel-hover');
    end(e, false);
  });
  btn.addEventListener('pointercancel', (e) => {
    btn.classList.remove('cancel-hover');
    end(e, true);
  });
  // Keyboard [2] keeps the old tap-to-place flow on desktop
  btn.addEventListener('click', (e) => e.preventDefault());
}

// ---------- Rig weapon chips ----------
// Classic: tap one to see its range. Gear combat: tap to fire it; each chip
// shows its energy / heat cost, ammo and why it can't fire right now.

const GUN_BLOCK_LABEL = { EMPTY: 'EMPTY', HOT: 'TOO HOT', ENERGY: 'NO ENERGY', RANGE: 'OUT OF RANGE', 'TOO CLOSE': 'TOO CLOSE', BLOCKED: 'NO LINE', 'NO TARGET': 'NO TARGET', 'NO ACTIONS': 'NO ACTIONS', WAIT: '' };

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

let mechHudSig = '';
function updateMechHud() {
  const el = document.getElementById('mech-hud');
  if (el) updateGearHud(el, document.getElementById('btn-end-turn'), document.getElementById('btn-vent'));
}

function updateGearHud(el, endBtn, ventBtn) {
  const hud = document.getElementById('battle-hud');
  hud?.classList.add('gear');
  // The Status drawer covers the bottom-left: tuck the gun chips away while it's open
  hud?.classList.toggle('drawer-open', !!document.querySelector('.run-drawer.open'));
  const guns = game.playerWeapons || [];
  const drones = game.playerDrones || [];
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
  const sig = `${live}|${left}|` + guns.map((w, i) => `${w.ammoLeft}:${states[i].ok}:${states[i].reason}:${states[i].dmg}:${states[i].cover}`).join(',') + '|' + drones.map((d) => d.off).join(',');
  if (sig === mechHudSig) return;
  mechHudSig = sig;
  const D = CONFIG.gear.drone;
  el.innerHTML = guns.map((w, i) => {
    const st = states[i];
    const ready = live && st.ok;
    const why = !st.ok ? GUN_BLOCK_LABEL[st.reason] || '' : '';
    const ammo = w.ammo ? `<b class="gun-ammo">${w.ammoLeft}/${w.ammo}</b>` : '';
    return `<button class="mech-chip gear-gun ${ready ? 'ready' : 'cooling'}" data-gun="${i}" style="--c:${w.color}" title="[${i ? 'E' : 'Q'}] ${w.name}">
      <img src="${partIcon(w.id)}" alt="">${ammo}
      <span class="gun-dmg">${w.fx?.mine ? 'MINE' : st.dmg ? `~${st.dmg}` : ''}</span>
      <span class="gun-cost"><i class="c-en">${w.en || 0}</i><i class="c-heat">${w.heat || 0}</i></span>
      <span class="gun-why">${ready ? (st.cover ? 'COVER' : 'FIRE') : why}</span></button>`;
  }).join('') + drones.map((d, i) => {
    const en = d.heal ? D.healEn : d.forcefieldEvery ? D.shieldEn : D.dmgEn;
    return `<button class="mech-chip drone gear-drone ${d.off ? 'off' : 'on'}" data-drone="${i}" style="--c:${d.color}" title="${d.name}: tap to switch ON/OFF. ON = acts at the end of your turn for ${en} energy.">
      <img src="${partIcon(d.id)}" alt=""><span class="gun-cost"><i class="c-en">${en}</i></span><span class="gun-why">${d.off ? 'OFF' : 'ON'}</span></button>`;
  }).join('');
  el.querySelectorAll('[data-gun]').forEach((b) => b.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    if (battlePaused) return;
    fireGun(Number(b.dataset.gun));
  }));
  el.querySelectorAll('[data-drone]').forEach((b) => b.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    if (battlePaused) return;
    game.toggleDrone(Number(b.dataset.drone));
    soundEngine.playUI();
  }));
}

function updateAbilityHud() {
  const btnBarrier = document.getElementById('btn-barrier');
  const cdBarrier = document.getElementById('cd-barrier');
  const br = game.abilities?.barrier;
  if (!br) return;
  const usable = br.ready && game.canPlayerAct;
  if (btnBarrier) {
    btnBarrier.disabled = !usable;
    btnBarrier.classList.toggle('ready', usable);
  }
  if (cdBarrier) {
    const text = br.ready ? 'READY' : `${br.cooldownLeft}T`;
    if (cdBarrier.textContent !== text) cdBarrier.textContent = text;
  }
}

// ---------- Run flow ----------

function applyConditionGravity(condId) {
  CONFIG.world.gravity = BASE_GRAVITY * (condId === 'heavy_gravity' ? 1.2 : condId === 'low_gravity' ? 0.8 : 1);
}

/** Report a quest event; newly completed quests are written into the saved run at once (their TP is already paid). */
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
  const perm = withMastery(withMech(techTree.getPermanentStats(), saveSystem.getLoadoutParts()), masteryLevel(saveSystem.getMasteryXp(ballType)).level);
  run = new RunState(perm, ballType);
  run.skin = skin;
  run.risk = saveSystem.getDifficultyLevel(); // locked for the run (restored on resume)
  // One random operation condition per run
  const cond = CONFIG.runConditions[Math.floor(Math.random() * CONFIG.runConditions.length)];
  run.condition = cond.id;
  applyConditionGravity(cond.id);
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
  buildFloorTabs();
  if (cond.id === 'supplied') rewardRandomCollectible('SUPPLIES');
  // Supply Drop (tech capstone): free relics at the start of every run
  for (let i = 0; i < (run.permanent?.supplyDropRelics || 0); i++) rewardRandomCollectible('SUPPLY DROP');
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
    setupRiskSlider();
    return;
  }
  run = s.run;
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
  applyConditionGravity(run.condition);
  pendingBoon = null;
  activeNode = null;
  prevPosition = null;
  mapRenderer?.resetZoom?.();

  setState(State.RUN_MAP);
  ui.showRunScreen(run, map, run.floor);
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
    if (node) selectNode(node);
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
        run.applyShopDiscount();
        node.refreshesLeft = 3;
        node.shopItems = rollShopCollectibles(run, 3);
      }
      ui.showShop(run, node.shopItems, node.refreshesLeft ?? 3, rerollCost());
      break;
    case 'rest':
      ui.showRest(run);
      break;
    case 'minigame':
      ui.showMinigameIntro();
      break;
    case 'treasure': {
      const offer = pickRelics(2, run.relics);
      ui.showTreasure(offer, (id) => {
        if (id) {
          run.addRelic(id);
          soundEngine.play('coin');
          addFeedEntry(`<span class="feed-relic">+ RELIC: ${CONFIG.relics.find((r) => r.id === id).name}</span>`);
        }
        finishNode(node);
      });
      break;
    }
    case 'gamble':
      ui.showGamble(run, 15, () => {
        run.gold -= 15;
        if (Math.random() < 0.5) {
          soundEngine.play('confirm');
          if (Math.random() < 0.5) {
            const relic = rewardRandomCollectible('GAMBLE');
            if (relic) return { won: true, text: `The dealer slides over a relic: <strong>${relic.name}</strong>.` };
          }
          const g = run.gainGold(45);
          return { won: true, text: `The coin lands your way: +${g} gold.` };
        }
        soundEngine.play('error');
        return { won: false, text: 'The coin lands wrong. Your 15 gold is gone.' };
      }, () => finishNode(node));
      break;
    case 'shrine': {
      const curse = CONFIG.curses[Math.floor(Math.random() * CONFIG.curses.length)];
      const epic = pickRelics(1, run.relics.concat(CONFIG.relics.filter((r) => r.rarity !== 'epic').map((r) => r.id)))[0];
      if (!epic) {
        finishNode(node);
        break;
      }
      ui.showShrine(curse, epic, () => {
        run.addCurse(curse.id);
        run.addRelic(epic.id);
        soundEngine.play('alarm');
        addFeedEntry(`<span class="feed-enemy-ability">CURSED: ${curse.name}</span> · <span class="feed-relic">+ ${epic.name}</span>`);
        finishNode(node);
      }, () => finishNode(node));
      break;
    }
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

/** Can the player flee the current battle? Bosses must be fought. */
function canRetreatFromBattle() {
  const type = activeNode?.type;
  return state === State.BATTLE && type !== 'miniboss' && type !== 'boss' && !!prevPosition;
}

function retreatCost() {
  return Math.max(5, Math.round(run.maxHp * 0.15));
}

/**
 * RETREAT mid-battle: pay HP + 1 move, fall back to the previous tile.
 * The hostile tile stays uncleared so it can be retried later.
 */
function retreatFromBattle() {
  if (!canRetreatFromBattle()) return;
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

    // Abyss floors: out of moves, the floor's warden attacks
    if (run.floor >= CONFIG.map.floors) {
      const bossNode = { id: `abyss-${run.floor}-boss`, floor: run.floor, type: 'boss', displayName: 'ABYSS WARDEN' };
      run.currentNode = bossNode;
      run.currentNodeId = bossNode.id;
      addFeedEntry('<span class="feed-enemy-ability">OUT OF MOVES — THE ABYSS WARDEN ATTACKS!</span>');
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
  ui.closeModal();
  // Closing the app mid-fight restarts this fight from the top on resume
  persistRun('battle', { node, prevId: prevPosition?.id ?? null });
  if (node.type === 'combat') run.normalFights += 1;
  setState(State.BATTLE);
  ui.showBattleHud(run, node.type);

  // Ensure player HP carries over safely (at least 1 HP)
  if (run.hp <= 0) run.hp = 1;

  if (run.hasRelic('rel_nanite')) run.healFlat(15);
  const maxPowerMult = run.launchPowerMult;
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
  const condAtk = (cond === 'glass_war' ? 1.3 : 1) * (cond === 'blood_moon' ? 1.15 : 1) * (1 + 0.1 * run.curseCount('curse_hunted'));
  // Abyss: +8% HP and +5% ATK per depth, on top of the normal per-floor scaling
  const hpMult = (1 + (riskData.hpPct + (isEliteTier ? riskData.eliteHpPct : 0)) / 100) * condHp * (1 + ABYSS_HP_PER_DEPTH * abyssDepth);
  const atkMult = (1 + (riskData.atkPct + (isEliteTier ? riskData.eliteAtkPct : 0)) / 100) * condAtk * (1 + ABYSS_ATK_PER_DEPTH * abyssDepth);
  const defMult = 1 + riskData.defPct / 100;
  // Visible floor scaling: +X% HP / +Y% ATK per floor above the first
  const floorsAbove = Math.min(run.floor, CONFIG.map.floors - 1); // capped at floor 5: the Abyss scales by depth instead
  const floorHp = 1 + CONFIG.floorScaling.hpPerFloor * floorsAbove;
  const floorAtk = 1 + CONFIG.floorScaling.atkPerFloor * floorsAbove;

  const count = (CONFIG.enemyCounts[node.type] || {})[floorKey] || 1;
  // Every enemy fires each round, so multi-enemy waves trim ATK harder than HP.
  const waveHpScale = count === 3 ? 0.65 : count === 2 ? 0.8 : 1.0;
  const waveAtkScale = count === 3 ? 0.55 : count === 2 ? 0.7 : 1.0;
  const enemies = [];
  const devHp = devTools?.overrides?.enemyHpMult ?? 1.0;
  const devAtk = devTools?.overrides?.enemyAtkMult ?? 1.0;
  const devDef = devTools?.overrides?.enemyDefOffset ?? 0;

  for (let i = 0; i < count; i++) {
    const archetype = pickArchetype(node.type, floorKey, i);
    const arch = CONFIG.enemyArchetypes[archetype];
    const isBoss = node.type === 'boss';

    const finalHp = Math.round(tier.hp * arch.hpMult * hpMult * floorHp * devHp * waveHpScale);
    const finalAtk = Math.round((tier.atk * arch.atkMult * atkMult * floorAtk * devAtk * waveAtkScale) * 100) / 100;
    const finalDef = Math.max(0, Math.round((tier.def + arch.defBonus) * defMult) + devDef);

    const xPct = count === 1 ? 0.75 : count === 2 ? 0.66 + i * 0.16 : 0.58 + i * 0.13;

    enemies.push({
      maxHp: finalHp,
      atk: finalAtk,
      def: finalDef,
      displayName: isBoss ? (abyssDepth ? `ABYSS WARDEN ${abyssDepth}` : 'SECTOR COMMANDER') : arch.name,
      rank: node.type === 'boss' || node.type === 'miniboss' ? node.type : null,
      archetype,
      aiDifficulty: Math.min(0.95, tier.aiDifficulty + arch.aiShift + riskData.aiBonus),
      thinkDelay: arch.ability === 'aggressive' ? Math.max(0.3, thinkDelay - 0.2) : thinkDelay,
      xPct,
      weapons: enemyWeapons(node.type, run.floor + 1, Math.random, { atkMult: atkMult * waveAtkScale, archetype }),
      rig: enemyRig(node.type, { cdCut: riskData.gunCdCut || 0 }),
      legs: enemyLegs(node.type, archetype),
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
      damageReductionPct: run.damageReductionPct,
    },
    enemies,
    relics: run.relics,
    nodeType: node.type,
    ballType: OPERATOR.id,
    skinColors: skinColors(OPERATOR, run.skin),
    techStats: run.permanent, // tech tree + equipped gear, fixed for the run
    riskLevel: riskLevel,
    riskPlusDmgTaken: riskData.plusDmgTaken || 0,
    riskDefPierce: riskData.defPierce || 0,
    floor: run.floor + 1,
    maxPowerMult,
  };

  // Wire quest hooks (clear old listeners first so no stacking)
  game.events.off('battle-end');
  game.events.off('player-dealt-damage');
  game.events.off('wall-bounce-hit');
  game.events.off('ability-used');
  game.events.off('enemy-ability');
  game.events.off('enemy-dealt-damage');

  // (Mid-battle events have no toast: damage already shows as floating numbers)
  game.events.on('player-dealt-damage', ({ damage }) => reportQuest('damage_dealt', { amount: damage }));
  game.events.on('wall-bounce-hit', ({ damage }) => reportQuest('wall_bounce_hit', { damageDealt: damage }));
  game.events.on('battle-end', ({ won }) => onBattleEnd(won, node));
  game.events.on('ability-used', ({ id, name }) => {
    game.renderer.addCallout(game.player, id === 'barrier' ? 'BARRIER UP' : name, id === 'barrier' ? '#41a6f6' : '#ffcd75');
  });
  // Enemy abilities: short label over whoever it affects (the caster, or you for status ticks)
  const ABILITY_LABELS = {
    'Overdrive Charge': ['CHARGING SHOT', '#ef7d57'],
    'Fortify Shield': ['FORTIFY +3 DEF', '#41a6f6'],
    'Graviton Tether Pull': ['TETHER PULL', '#c46fd6'],
    'Graviton Tether (Blocked)': ['TETHER BLOCKED', '#94b0c2'],
    'War Command': ['WAR COMMAND: ALLIES +20% ATK', '#ffcd75'],
    'Corrosive Acid Splash': ['ACID: -4 DEF', '#a7f070'],
    'Shockwave Pulse': ['SHOCKWAVE', '#ef7d57'],
    'Thermal Burn': ['BURNING', '#ef7d57'],
    'Corrosion Tick': ['CORRODED: -DEF', '#a7f070'],
    'Siphon Drain': ['SIPHON: STEALS HP', '#ff5d73'],
    'Thermal Flare Ignition': ['IGNITED!', '#ef7d57', 'player'],
    'Corrosive Impact': ['CORRODED!', '#a7f070', 'player'],
    'Vampiric Vitality': ['LIFESTEAL', '#a7f070'],
  };
  game.events.on('enemy-ability', ({ enemy, ability }) => {
    const [text, color, target] = ABILITY_LABELS[ability] || [ability.toUpperCase(), '#ff5d73'];
    game.renderer.addCallout(target === 'player' || !enemy ? game.player : enemy, text, color);
  });

  game.run = run;
  if (run.condition === 'calm') {
    battleConfig.arena = pickArena(run.floor + 1);
    battleConfig.arena.wind = 0;
  }
  game.startBattle(battleConfig);

  // Bosses get an intro card; the fight is frozen until it is dismissed
  if (node.type === 'miniboss' || node.type === 'boss') {
    const boss = enemies[0];
    const arch = CONFIG.enemyArchetypes[boss.archetype];
    battlePaused = true;
    ui.showBossIntro({
      title: node.type === 'boss' ? (run.floor >= CONFIG.map.floors ? `ABYSS ${run.floor - CONFIG.map.floors + 1}` : 'FINAL BOSS') : `FLOOR ${run.floor + 1} MINI-BOSS`,
      name: boss.displayName,
      desc: node.type === 'boss' ? `Sends out a shockwave every turn. ${arch?.abilityDesc || ''}` : arch?.abilityDesc || '',
      color: arch?.color,
    }, () => {
      battlePaused = false;
      game.renderer.showBanner('FIGHT!', '#ff5d73');
    });
  }
}

/** Pick an enemy archetype based on floor weights. */
function pickArchetype(nodeType, floor, index) {
  const weights = CONFIG.archetypeWeights[nodeType === 'elite' ? 'elite' : nodeType === 'boss' ? 'boss' : floor] || CONFIG.archetypeWeights[1];
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

function rewardRandomCollectible(sourceName = 'REWARD') {
  if (!run) return null;
  const [relic] = pickRelics(1, run.relics);
  if (!relic) return null;
  run.addRelic(relic.id);
  ui.updateRunHud(run);
  ui.renderRelics(run);
  addFeedEntry(`<span class="feed-relic">${sourceName}: + RELIC ${relic.name}</span>`);
  return relic;
}

function onBattleEnd(won, node) {
  // If player HP dropped to 0 or below, force won to false (permadeath check)
  if (game.player.hp <= 0) {
    won = false;
  }

  const damageTaken = game.battleStats.playerDamageTaken;
  pendingBoon = null;

  // Write battle HP back into the run (roguelike persistence)
  run.hp = Math.max(0, Math.min(run.maxHp, game.player.hp));
  run.shieldHp = Math.max(0, Math.round(game.player.shieldHp || 0));

  // Per-class + lifetime stats (skins, medals)
  saveSystem.addBattleStats(run.ballType, game.battleStats.track);
  saveSystem.bumpLifetime('maxRelics', run.relics.length);
  ui.celebrateMedals(checkMedals(saveSystem));
  if (won) run.onCombatWon();
  else {
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
    let tech = 0;
    let heal = 0;

    if (rewards.gold) {
      gold = run.gainGold(rewards.gold + (run.hasRelic('rel_magnet') ? 6 : 0));
      addFeedEntry(`<span class="feed-gold">+${gold} GOLD</span>`);
    }
    if (rewards.tech) {
      const riskBonusPct = saveSystem.getTpMultiplier() * (run.condition === 'blood_moon' ? 1.5 : 1);
      tech = Math.max(1, Math.round(rewards.tech * riskBonusPct * (1 + (run.permanent?.tpBonusPct || 0))));
      if (run.hasRelic('rel_jade_pendant') && ['elite', 'miniboss', 'boss'].includes(node.type)) tech += 1;
      saveSystem.addTechPoints(tech);
      addFeedEntry(`<span class="feed-boon">+${tech} TECH PTS</span>`);
    }
    if (rewards.healMax) {
      heal = Math.round(run.maxHp * (rewards.healMax / 100));
      run.healFlat(heal);
      addFeedEntry(`<span class="feed-heal">+${heal} HP RECOVERED</span>`);
    }
    const medic = run.permanent?.mech?.healAfterWin || 0;
    if (medic > 0) {
      const extra = Math.round(run.maxHp * medic);
      run.healFlat(extra);
      heal += extra;
    }

    // Keys (saved as `tokens`) open supply pods on the Rig screen; saved at once, so they're kept even if the run is lost
    // Normal fights won without a scratch: bonus Keys and gold
    const clean = node.type === 'combat' && damageTaken === 0;
    const tokens = tokenReward(node.type, saveSystem.getDifficultyLevel()) + (clean ? CLEAN_WIN_KEYS : 0) + (run.permanent?.keyBonus || 0);
    if (clean) {
      gold += run.gainGold(8);
      addFeedEntry('<span class="feed-gold">CLEAN WIN</span>');
    }
    if (tokens > 0) {
      saveSystem.addTokens(tokens);
      run.tokensEarned = (run.tokensEarned || 0) + tokens;
      addFeedEntry(`<span class="feed-gold">+${tokens} KEYS</span>`);
    }

    // Elite nodes reward 1 collectible; mini-boss rewards 2; boss gives none
    let rewardRelic = null;
    let rewardRelics = null;
    if (node.type === 'elite') {
      rewardRelic = rewardRandomCollectible('ELITE DROP');
    } else if (node.type === 'miniboss') {
      const r1 = rewardRandomCollectible('MINI-BOSS DROP 1');
      const r2 = rewardRandomCollectible('MINI-BOSS DROP 2');
      rewardRelics = [r1, r2].filter(Boolean);
      rewardRelic = rewardRelics[0] || null;
    }

    // Chance for a boon drop on combat wins only
    pendingBoon = rollBoon(node.type);
    if (pendingBoon) {
      addFeedEntry(`<span class="feed-boon">BOON DROP: ${pendingBoon.name}</span>`);
    }

    ui.updateRunHud(run);
    // Final boss: let the VICTORY splash land, then go straight to the run summary
    if (node.type === 'boss') {
      run.floor5BossCleared = true;
      pendingBoon = null;
      persistRun('sector');
      setTimeout(() => sectorCleared(), 1400);
      return;
    }
    // Rewards are paid: a reload must continue from here, not replay the fight
    persistRun('combat', { pendingBoonId: pendingBoon?.id });
    // Let the finishing blow and the VICTORY splash land, then the report
    const rewardsWon = { gold, tech, heal, relic: rewardRelic, relics: rewardRelics, tokens, clean };
    setTimeout(() => ui.showCombatResult(true, rewardsWon, run, battleReport(node, damageTaken)), 900);
  } else {
    ui.updateRunHud(run);
    persistRun('combat');
    setTimeout(() => ui.showCombatResult(false, null, run, battleReport(node, damageTaken)), 900);
  }
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
  // Roguelike permadeath: losing a battle with 0 HP ends the run
  if (run.hp <= 0) {
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
    if (choice.gainTech) {
      saveSystem.addTechPoints(choice.gainTech);
      addFeedEntry(`<span class="feed-boon">+${choice.gainTech} TECH PTS</span>`);
    }
    if (choice.gainRelic) {
      rewardRandomCollectible('ENCOUNTER');
    }
    if (choice.gainActions) {
      run.addFloorActions(choice.gainActions);
      addFeedEntry(`<span class="feed-heal">+${choice.gainActions} MOVE${choice.gainActions > 1 ? 'S' : ''}</span>`);
    }
    if (run.hasRelic('rel_scavenger_pack')) {
      const g = run.gainGold(10);
      addFeedEntry(`<span class="feed-gold">SCAVENGER PACK: +${g} GOLD</span>`);
    }
    ui.updateRunHud(run);
  }
  map.visitNode(run.floor, node.id);
  run.spendFloorAction();
  ui.updateRunHud(run);
  if (!advanceFloorIfNeeded()) returnToMap();
}

// ---------- Shop ----------

function rollShopCollectibles(run, count = 3) {
  if (!run) return [];
  return pickRelics(count, run.relics);
}

function buyRelicItem(relic) {
  if (!run || !relic) return false;
  if (run.hasRelic(relic.id)) return false;
  const cost = run.relicPrice(relic);
  if (!run.spendGold(cost)) return false;
  reportQuest('gold_spent', { totalSpent: run.totalGoldSpent });
  run.addRelic(relic.id);
  soundEngine.play('coin');
  ui.updateRunHud(run);
  ui.renderRelics(run);
  addFeedEntry(`<span class="feed-relic">+ RELIC: ${relic.name}</span>`);
  return true;
}

// ---------- Rest ----------

function resolveRest(choice) {
  if (choice === 'heal') {
    let healAmount = CONFIG.run.hpRegenPerRest || 30;
    let maxHpBonus = 0;

    // Tech tree node: Titan Core
    if (run.permanent?.titanCoreHealBonusPct > 0) {
      healAmount = Math.round(healAmount * (1 + run.permanent.titanCoreHealBonusPct));
      maxHpBonus += (run.permanent.titanCoreMaxHpBonus || 0);
    }

    if (run.hasRelic('rel_family_feast')) maxHpBonus += 10;

    if (maxHpBonus > 0) {
      run.addMaxHp(maxHpBonus);
      addFeedEntry(`<span class="feed-heal">SAFE ZONE BONUS: +${maxHpBonus} MAX HP</span>`);
    }

    if (run.hasRelic('rel_golden_apple')) healAmount = run.maxHp; // heal to full
    const healed = run.healFlat(healAmount, run.permanent);
    soundEngine.play('heal');
    // Recovery quest counts every Safe Zone heal across the run
    run.maxRestHealed = (run.maxRestHealed || 0) + healed;
    reportQuest('rest', { healed: run.maxRestHealed });
    addFeedEntry(`<span class="feed-heal">SAFE ZONE: +${healed} HP RECOVERED</span>`);
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
  const relicsGained = [];

  if (isAllPerfect) {
    gold = run.gainGold(40);
    healText = 'Full HP Recovery';
    run.hp = run.maxHp;

    const r1 = rewardRandomCollectible('FLAWLESS DRILL 1');
    const r2 = rewardRandomCollectible('FLAWLESS DRILL 2');
    if (r1) relicsGained.push(r1);
    if (r2) relicsGained.push(r2);

    addFeedEntry(`<span class="feed-heal">FLAWLESS DRILL: FULL HP & 2 RELICS</span>`);
  } else if (perfects >= 3) {
    gold = run.gainGold(25);
    const effectiveHeal = Math.round(50 * saveSystem.getHealingMultiplier());
    healText = `+${effectiveHeal} HP Healed`;
    run.healFlat(50);

    const r1 = rewardRandomCollectible('PRECISION DRILL');
    if (r1) relicsGained.push(r1);

    addFeedEntry(`<span class="feed-heal">PRECISION DRILL: +${effectiveHeal} HP & 1 RELIC</span>`);
  } else if (hits >= 3) {
    gold = run.gainGold(15);
    addFeedEntry(`<span class="feed-gold">DRILL PASSED: +${gold} GOLD</span>`);
  } else {
    gold = run.gainGold(5);
    addFeedEntry(`<span class="feed-gold">DRILL CONSOLATION: +${gold} GOLD</span>`);
  }

  reportQuest('minigame', { perfect: isAllPerfect });
  ui.updateRunHud(run);
  persistRun('minigame'); // rewards paid: a reload finishes the tile instead of replaying it

  return {
    gold,
    healText,
    relics: relicsGained,
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

// Endless Abyss: extra enemy scaling per floor below floor 5
const ABYSS_HP_PER_DEPTH = 0.08;
const ABYSS_ATK_PER_DEPTH = 0.05;

/**
 * A boss is down. The first time (floor 5) the run counts as won right
 * away; after that each Abyss warden pays Keys and TP. Either way the
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
    const keys = 3 + depth * 2;
    const tp = Math.round((2 + depth) * saveSystem.getTpMultiplier());
    saveSystem.addTokens(keys);
    saveSystem.addTechPoints(tp);
    rewards = { keys, tp };
  }
  ui.updateRunHud(run);
  persistRun('descend', { descend: { depth, next: depth + 1 } });
  ui.showDescend({ depth, next: depth + 1, rewards, hp: run.hp, maxHp: run.maxHp }, descend, () => endRun(true));
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
  ui.showRunResult(run, questSystem.getActiveQuests(), { ...saveSystem.getMeta(), techPoints: saveSystem.data.techPoints });
  ui.showMasteryResult(run.ball, xp, levels, saveSystem.getMasteryXp(run.ballType));

  if (run.riskUnlocked) {
    ui.showRiskUnlocked(run.riskUnlocked, CONFIG.risk.levels[run.riskUnlocked - 1]);
  }
  if (run.secretResult) ui.showSecretRisk(run.secretResult.unlocked, run.secretResult.fights);
  setupRiskSlider();
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
      { label: 'Purchase Coordinates', loseGold: 12, gainTech: 2 },
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
      { label: 'Enter Arena Ring', loseHp: 14, gainGold: 28, gainTech: 2 },
      { label: 'Decline and Watch', heal: 12 },
    ],
  },
  {
    title: 'SECTOR RADAR ARRAY',
    desc: 'A radar dish sweeps the sector. Overcharging it can locate map paths or burn out power.',
    choices: [
      { label: 'Overcharge Transmitter Core', loseHp: 20, gainActions: 1, gainGold: 10 },
      { label: 'Collect Sector Telemetry', gainTech: 2 },
    ],
  },
  {
    title: 'RELIC VAULT CACHE',
    desc: 'A sealed ancient chest pulsates with noble heraldry.',
    choices: [
      { label: 'Decipher Ancient Seal', loseHp: 12, gainRelic: true },
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
      { label: 'Salvage the Cargo', loseHp: 8, gainRelic: true },
      { label: 'Siphon its Battery', heal: 20 },
    ],
  },
  {
    title: 'THE OLD SNIPER',
    desc: 'A retired marksman squints at your slingshot and offers to share a trick.',
    choices: [
      { label: 'Pay for the Lesson', loseGold: 10, gainBoon: 'boon_power' },
      { label: 'Trade War Stories', gainTech: 1 },
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
      { label: 'Explore Deeper', loseHp: 14, gainRelic: true },
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
      { label: 'Escort them Personally', loseHp: 5, gainTech: 2 },
      { label: 'Point the Way', gainGold: 6 },
    ],
  },
  {
    title: 'SYNDICATE TRADE DELEGATE',
    desc: 'A high-ranking trade official offers a high-yield investment.',
    choices: [
      { label: 'Invest Capital in Syndicate', loseGold: 15, gainTech: 3 },
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
    if (!battlePaused) game.update(dt);
    game.render();
    updateAbilityHud();
    updateMechHud();
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

/** Risk stepper: − / + buttons, one-line summary, full rule list in a pop-up. */
function setupRiskSlider() {
  const down = document.getElementById('risk-down');
  const up = document.getElementById('risk-up');
  const rulesBtn = document.getElementById('risk-rules');
  if (!down || !up) return;
  const change = (delta) => {
    // A suspended run keeps the Risk it started on
    if (hasSavedRun()) {
      soundEngine.play('error');
      return;
    }
    const next = saveSystem.getDifficultyLevel() + delta;
    const levels = CONFIG.risk.levels.length;
    // Past Risk 10 with the secret still sealed: a glitch and a clue
    if (next === levels + 1 && !saveSystem.hasSecretRisk() && saveSystem.getMaxRiskUnlocked() >= levels) {
      soundEngine.play('error');
      haptics.impact('heavy');
      ui.glitchRiskHint(CONFIG.risk.secret.hint);
      return;
    }
    if (next < 0 || next > saveSystem.getMaxRiskUnlocked()) {
      soundEngine.play('error');
      return;
    }
    saveSystem.setDifficultyLevel(next);
    soundEngine.playUI(delta > 0 ? 700 : 500);
    haptics.impact('light');
    updateRiskDisplay(next);
  };
  down.onclick = () => change(-1);
  up.onclick = () => change(1);
  rulesBtn.onclick = () => {
    soundEngine.playUI();
    ui.showRiskRules(saveSystem.getDifficultyLevel(), saveSystem.getMaxRiskUnlocked());
  };
  updateRiskDisplay(saveSystem.getDifficultyLevel());
}

/** Compact Risk panel for the selected ball: level, TP bonus, newest rule (the rest are in RULES). */
function updateRiskDisplay(val) {
  const max = saveSystem.getMaxRiskUnlocked();
  const ball = OPERATOR;
  const title = document.querySelector('.risk-title');
  if (title) {
    const look = skinColors(ball, 'default');
    title.innerHTML = `<img class="risk-ball" src="${ballDataUrl({ ...look, pattern: look.pattern || CLASS_PATTERN[ball.id] }, ball.radiusMult)}" alt="" title="${ball.name}">RISK`;
  }
  const levels = CONFIG.risk.levels;
  const valEl = document.getElementById('risk-level-val');
  const summary = document.getElementById('risk-level-bonus');
  const secretOpen = saveSystem.hasSecretRisk();
  if (valEl) {
    valEl.textContent = max === 0 ? 'LOCKED' : val > levels.length ? 'XI' : `${val}/${levels.length}`;
    valEl.classList.toggle('secret', val > levels.length);
  }
  const locked = hasSavedRun(); // a run in progress keeps its Risk
  document.getElementById('risk-down').disabled = val <= 0 || locked;
  // At 10/10 the + stays live while the secret is sealed (it glitches and hints)
  const sealed = !secretOpen && max >= levels.length;
  const up = document.getElementById('risk-up');
  up.disabled = (val >= max && !sealed) || locked;
  up.classList.toggle('risk-sealed', sealed && val >= max && !locked);
  document.querySelector('.difficulty-panel')?.classList.toggle('abyss', val > levels.length);
  if (!summary) return;
  if (locked) {
    summary.innerHTML = '<span class="dim-text">Locked while a run is in progress</span>';
  } else if (max === 0) {
    summary.innerHTML = `<span class="dim-text">Win a run with ${ball.name} to unlock</span>`;
  } else if (val === 0) {
    summary.innerHTML = '<span class="dim-text">No extra rules</span>';
  } else {
    // Newest rule name only; RULES lists them all
    const rule = saveSystem.riskLevels()[val - 1];
    const more = val > 1 ? ` <span class="dim-text">+${val - 1}</span>` : '';
    summary.innerHTML = `<span class="risk-tp-inline">+${val * CONFIG.risk.tpPerLevel}% TP</span> <b class="${rule.allElite ? 'abyss-text' : ''}" title="${rule.desc}">${rule.name}</b>${more}`;
  }
}

// ---------- Boot ----------

ui.showMenu(saveSystem.getProfile(), saveSystem.getMeta());
soundEngine.playMusic('menu'); // begins after the first tap
new MenuBackground(document.getElementById('menu-bg'));
setupRiskSlider();
bindMapClicks();
bindAbilityButtons();
// GitHub builds: offer a newer release once the menu is up (no-op on the web)
setTimeout(() => ui.checkUpdates(), 1500);

// Expose for debugging
// Debug handle for the dev server only; release builds don't expose game state
if (import.meta.env.DEV) window.__SLINGSHOT__ = { game, saveSystem, techTree, ui, get run() { return run; }, get map() { return map; }, sectorCleared, descend, endRun };