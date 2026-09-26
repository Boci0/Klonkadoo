// ============================================================
// SLINGSHOT OPS — entry point + App state machine.
// Orchestrates: main menu → tech tree → roguelike run map →
// node events → slingshot battles → run results → meta progression.
// ============================================================

import './styles.css';
import { CONFIG } from './config.js';
import { Game } from './core/Game.js';
import { SaveSystem } from './meta/SaveSystem.js';
import { UpgradeSystem } from './meta/UpgradeSystem.js';
import { TechTree } from './meta/TechTree.js';
import { QuestSystem } from './meta/QuestSystem.js';
import { RunState } from './rogue/RunState.js';
import { RogueMap } from './rogue/RogueMap.js';
import { RogueMapRenderer } from './rendering/RogueMapRenderer.js';
import { Minigame } from './minigame/Minigame.js';
import { UIManager } from './ui/UIManager.js';
import { DevTools } from './dev/DevTools.js';
import { icon } from './ui/icons.js';

// ---------- Core systems ----------

const canvas = document.getElementById('game-canvas');

const saveSystem = new SaveSystem();
const upgradeSystem = new UpgradeSystem(saveSystem);
upgradeSystem.applyUpgrades();

const techTree = new TechTree(saveSystem);
const game = new Game(canvas);
const minigame = new Minigame(canvas);
let mapRenderer = null;
const devTools = new DevTools(() => game, () => run, saveSystem, techTree);

// ---------- Run state ----------

let run = null;
let map = null;
let questSystem = null;
let runSeed = 1;
let currentFloorView = 0;
let pendingBoon = null;
let goldSpentTotal = 0;
let lostAnyCombat = false;
let activeNode = null; // node currently being resolved
let minigameResultShown = false;
let feedEntries = []; // combat feed log for the run map screen

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
}

// ---------- UI callbacks ----------

const ui = new UIManager({
  onPlay: startNewRun,
  onOpenTech: () => {
    setState(State.TECH);
    ui.showTech(techTree, saveSystem);
  },
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
  onNodeProceed: (node, leaveShop) => proceedFromNode(node, leaveShop),
  onBattleReportContinue: continueAfterCombatReport,
  onEncounterChoice: (idx) => resolveEncounterChoice(idx),
  onShopBuy: (item) => buyShopItem(item),
  onRelicBuy: (relic) => buyRelicItem(relic),
  onShopRefresh: () => {
    const node = run.currentNode;
    if (node && node.type === 'shop') {
      ui.showShop(run, node.shopItems, node.refreshesLeft ?? 3, 8);
    }
  },
  onShopDoRefresh: () => {
    const node = run.currentNode;
    if (!node || node.type !== 'shop') return;
    const cost = 8;
    const refreshesLeft = node.refreshesLeft ?? 3;
    if (refreshesLeft > 0 && run.gold >= cost) {
      run.gold -= cost;
      goldSpentTotal += cost;
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

// ---------- Combat feed ----------

function addFeedEntry(html) {
  feedEntries.unshift({ html, time: Date.now() });
  if (feedEntries.length > 30) feedEntries.pop();
  renderFeed();
}

function renderFeed() {
  const container = document.getElementById('combat-feed');
  if (!container) return;
  if (feedEntries.length === 0) {
    container.innerHTML = '<span class="dim-text">No engagements yet</span>';
    return;
  }
  container.innerHTML = feedEntries
    .map((e) => `<div class="feed-entry">${e.html}</div>`)
    .join('');
}

// ---------- Battle ability HUD ----------

function bindAbilityButtons() {
  const btnOverdrive = document.getElementById('btn-overdrive');
  const btnBarrier = document.getElementById('btn-barrier');

  const triggerOverdrive = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (state !== State.BATTLE) return;
    if (game.useAbility('overdrive')) {
      updateAbilityHud();
    }
  };

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

  if (btnOverdrive) {
    btnOverdrive.addEventListener('click', triggerOverdrive);
  }
  if (btnBarrier) {
    btnBarrier.addEventListener('click', triggerBarrier);
  }

  // Keyboard hotkeys [1] and [2]
  window.addEventListener('keydown', (e) => {
    if (state !== State.BATTLE) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.key === '1' || e.code === 'Digit1' || e.code === 'Numpad1') {
      triggerOverdrive(e);
    } else if (e.key === '2' || e.code === 'Digit2' || e.code === 'Numpad2') {
      triggerBarrier(e);
    }
  });
}

function updateAbilityHud() {
  const btnOverdrive = document.getElementById('btn-overdrive');
  const btnBarrier = document.getElementById('btn-barrier');
  const cdOverdrive = document.getElementById('cd-overdrive');
  const cdBarrier = document.getElementById('cd-barrier');

  if (!game.abilities) return;

  const od = game.abilities.overdrive;
  const br = game.abilities.barrier;

  if (btnOverdrive) {
    btnOverdrive.disabled = !od.ready;
    btnOverdrive.classList.toggle('ready', od.ready);
  }
  if (cdOverdrive) {
    const stacks = game.battleStats?.overdriveStacks || 0;
    if (stacks > 0) {
      cdOverdrive.textContent = `x${stacks}`;
    } else {
      cdOverdrive.innerHTML = od.ready ? icon('check', 12) : `${od.cooldownLeft}`;
    }
  }
  if (btnBarrier) {
    btnBarrier.disabled = !br.ready;
    btnBarrier.classList.toggle('ready', br.ready);
  }
  if (cdBarrier) {
    cdBarrier.innerHTML = br.ready ? icon('check', 12) : `${br.cooldownLeft}`;
  }
}

// ---------- Run flow ----------

function startNewRun(ballType = 'vanguard') {
  runSeed = Math.floor(Math.random() * 100000) + 1;
  run = new RunState(techTree.getPermanentStats());
  run.ballType = ballType;
  map = new RogueMap(runSeed);
  questSystem = new QuestSystem(saveSystem, runSeed);
  currentFloorView = 0;
  pendingBoon = null;
  goldSpentTotal = 0;
  lostAnyCombat = false;
  activeNode = null;
  feedEntries = [];
  renderFeed();

  // Enter floor 0
  run.floor = 0;
  run.resetFloorActions();
  const entry = findEntryNode(0);
  run.currentNodeId = entry?.id;
  run.currentNode = entry;

  setState(State.RUN_MAP);
  ui.showRunScreen(run, map, 0);
  buildFloorTabs();
}

function findEntryNode(floorIndex) {
  const f = map.floors[floorIndex];
  if (!f) return null;
  return f.nodes.find((n) => n.type === 'entry') || f.nodes.find((n) => n.row === f.centerRow && n.col === f.centerCol) || f.nodes[0];
}

function buildFloorTabs() {
  const container = document.getElementById('run-floortabs');
  container.innerHTML = '';
  for (let f = 0; f < CONFIG.map.floors; f++) {
    const isCleared = f < run.floor; // floors fully completed
    const isCurrent = f === run.floor; // floor the player is on
    const isLocked = f > run.floor;
    const tab = document.createElement('div');
    tab.className = `floor-tab ${f === currentFloorView ? 'active' : ''} ${isCleared ? 'cleared' : ''} ${isCurrent ? 'current' : ''} ${isLocked ? 'locked' : ''}`;
    tab.textContent = `F${f + 1}`;
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
    const pt = mapRenderer ? mapRenderer.screenToMap(e.clientX, e.clientY) : null;
    if (!pt) return;
    const x = pt.x;
    const y = pt.y;

    const nextOptions = map.getNextOptions(run.floor, run.currentNodeId);
    for (const node of nextOptions) {
      const cardW = 86;
      const cardH = 50;
      const insideCard = Math.abs(x - node.x) <= cardW / 2 + 6 && Math.abs(y - node.y) <= cardH / 2 + 6;
      const insideRadius = Math.hypot(x - node.x, y - node.y) <= (CONFIG.map.nodeRadius || 22) + 12;

      if (insideCard || insideRadius) {
        selectNode(node);
        return;
      }
    }
  };

  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  const btnZoomReset = document.getElementById('btn-zoom-reset');

  if (btnZoomIn) btnZoomIn.onclick = () => mapRenderer?.setScale((mapRenderer.scale || 1) * 1.15);
  if (btnZoomOut) btnZoomOut.onclick = () => mapRenderer?.setScale((mapRenderer.scale || 1) * 0.85);
  if (btnZoomReset) btnZoomReset.onclick = () => mapRenderer?.resetZoom();
}

function selectNode(node) {
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
      ui.showShop(run, node.shopItems, node.refreshesLeft ?? 3, 8);
      break;
    case 'rest':
      ui.showRest(run);
      break;
    case 'minigame':
      ui.showMinigameIntro();
      break;
    default:
      map.visitNode(run.floor, node.id);
      run.spendFloorAction();
      ui.updateRunHud(run);
      if (!advanceFloorIfNeeded()) returnToMap();
  }
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
        addFeedEntry(`<span class="feed-enemy-ability">ACTION POINTS DEPLETED — ENGAGING FLOOR 3 MINI-BOSS!</span>`);
        startCombat(minibossNode);
        return true;
      }
    }

    // Floor 5 (index 4): Depleting action points forces Final Boss battle!
    if (run.floor === 4 && !run.floor5BossCleared) {
      if (node && node.type === 'boss') {
        run.floor5BossCleared = true;
        endRun(true);
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
        addFeedEntry(`<span class="feed-enemy-ability">ACTION POINTS DEPLETED — ENGAGING FINAL SECTOR COMMANDER!</span>`);
        startCombat(bossNode);
        return true;
      }
    }

    // Advance floor after miniboss or for standard floors
    if (run.floor < CONFIG.map.floors - 1) {
      run.floor += 1;
      run.resetFloorActions();
      currentFloorView = run.floor;
      const entry = findEntryNode(run.floor);
      if (entry) {
        run.currentNodeId = entry.id;
        run.currentNode = entry;
      }
      addFeedEntry(`<span class="feed-heal">FLOOR ACTIONS DEPLETED — ADVANCING TO FLOOR ${run.floor + 1}!</span>`);
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
  setState(State.BATTLE);
  ui.showBattleHud(run, node.type);

  // Ensure player HP carries over safely (at least 1 HP)
  if (run.hp <= 0) run.hp = 1;

  const swiftCount = run.getBoonCount('boon_swift');
  const powerCount = run.getBoonCount('boon_power');
  const maxPowerMult = 1 + powerCount * 0.15 + swiftCount * 0.15;
  const thinkDelay = CONFIG.ai.thinkDelay;
  const riskLevel = saveSystem.getDifficultyLevel();
  const riskData = saveSystem.getRiskData();

  const tierKey = node.type === 'boss' ? 'boss' : node.type === 'miniboss' ? 'miniboss' : node.type === 'elite' ? 'elite' : String(run.floor + 1);
  const tier = CONFIG.enemyTiers[tierKey] || CONFIG.enemyTiers[1];

  const hpMult = 1 + riskData.hpPct / 100;
  const atkMult = 1 + riskData.atkPct / 100;
  const defMult = 1 + riskData.defPct / 100;

  const count = (CONFIG.enemyCounts[node.type] || {})[run.floor + 1] || 1;
  const waveScale = count === 3 ? 0.65 : count === 2 ? 0.8 : 1.0;
  const enemies = [];
  const devHp = devTools?.overrides?.enemyHpMult ?? 1.0;
  const devAtk = devTools?.overrides?.enemyAtkMult ?? 1.0;
  const devDef = devTools?.overrides?.enemyDefOffset ?? 0;

  for (let i = 0; i < count; i++) {
    const archetype = pickArchetype(node.type, run.floor + 1, i);
    const arch = CONFIG.enemyArchetypes[archetype];
    const isBoss = node.type === 'boss';

    // Base floor bonus applies at ALL risk levels; risk layer adds on top.
    // Risk 0 floor 5: +30%. Risk 15 floor 5: +90%.
    const currentFloor = run.floor + 1;
    const baseFloor = currentFloor * 0.06;
    const riskFloor = currentFloor * (riskLevel / 15) * 0.12;
    const floorRiskBonus = 1 + baseFloor + riskFloor;

    const finalHp = Math.round(tier.hp * arch.hpMult * hpMult * floorRiskBonus * devHp * waveScale);
    const finalAtk = Math.round((tier.atk * arch.atkMult * atkMult * floorRiskBonus * devAtk * waveScale) * 100) / 100;
    const finalDef = Math.max(0, Math.round((tier.def + arch.defBonus) * defMult * floorRiskBonus) + devDef);

    const xPct = count === 1 ? 0.75 : count === 2 ? 0.66 + i * 0.16 : 0.58 + i * 0.13;

    enemies.push({
      maxHp: finalHp,
      atk: finalAtk,
      def: finalDef,
      displayName: isBoss ? 'SECTOR COMMANDER' : arch.name,
      archetype,
      aiDifficulty: Math.min(0.95, tier.aiDifficulty + arch.aiShift + riskLevel * 0.005),
      thinkDelay: arch.ability === 'aggressive' ? Math.max(0.3, thinkDelay - 0.2) : thinkDelay,
      xPct,
    });
  }

  const battleConfig = {
    player: {
      maxHp: run.maxHp,
      hp: run.hp, // carry current run HP into battle
      atk: run.atk,
      def: run.def,
      totalDef: run.totalDef,
      damageReductionPct: run.damageReductionPct,
    },
    enemies,
    relics: run.relics,
    nodeType: node.type,
    ballType: run.ballType || 'vanguard',
    techStats: techTree.getPermanentStats(),
    riskLevel: riskLevel,
    riskPlusDmgTaken: riskData.plusDmgTaken || 0,
    floor: run.floor + 1,
    maxPowerMult,
  };

  // Wire quest hooks (clear old listeners first so no stacking)
  game.events.off('battle-end');
  game.events.off('player-dealt-damage');
  game.events.off('wall-bounce-hit');
  game.events.off('battle-continue');
  game.events.off('ability-used');
  game.events.off('enemy-ability');
  game.events.off('enemy-dealt-damage');

  game.events.on('player-dealt-damage', ({ damage }) => {
    questSystem.reportCombatEvent('damage_dealt', { amount: damage });
    addFeedEntry(`<span class="feed-dmg">YOU dealt ${damage} DMG</span>`);
  });
  game.events.on('enemy-dealt-damage', ({ attacker, damage }) => {
    const name = (attacker && attacker.displayName) ? attacker.displayName : 'HOSTILE';
    addFeedEntry(`<span class="feed-enemy-dmg">${name} dealt ${damage} DMG</span>`);
  });
  game.events.on('wall-bounce-hit', ({ damage }) => {
    questSystem.reportCombatEvent('wall_bounce_hit', { damageDealt: damage });
    addFeedEntry(`<span class="feed-dmg">WALL-BOUNCE HIT ${damage} DMG</span>`);
  });
  game.events.on('battle-end', ({ won }) => onBattleEnd(won, node));
  game.events.on('battle-continue', () => continueAfterCombatReport());
  game.events.on('ability-used', ({ name }) => {
    addFeedEntry(`<span class="feed-boon">ABILITY: ${name}</span>`);
  });
  game.events.on('enemy-ability', ({ ability, desc }) => {
    addFeedEntry(`<span class="feed-enemy-ability">HOSTILE ABILITY: ${ability} — ${desc}</span>`);
  });

  game.run = run;
  game.startBattle(battleConfig);
}

/** Pick an enemy archetype based on floor weights. */
function pickArchetype(nodeType, floor, index) {
  const weights = CONFIG.archetypeWeights[nodeType === 'elite' ? 'elite' : nodeType === 'boss' ? 'boss' : floor] || CONFIG.archetypeWeights[1];
  // Boss always gets a tank or striker; ensure variety in multi-enemy waves
  if (index > 0 && nodeType !== 'boss') {
    // Second enemy tends to be a striker for pressure
    return 'striker';
  }
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
  const unowned = CONFIG.relics.filter((r) => !run.relics.includes(r.id));
  if (unowned.length === 0) return null;
  const relic = unowned[Math.floor(Math.random() * unowned.length)];
  run.addRelic(relic.id);
  ui.updateRunHud(run);
  ui.renderRelics(run);
  addFeedEntry(`<span class="feed-relic">${sourceName}: + COLLECTIBLE ${relic.name}</span>`);
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
  if (won) run.onCombatWon();
  else {
    run.onCombatLost();
    lostAnyCombat = true;
  }

  // Quest reporting
  questSystem.reportCombatEvent('combat_end', {
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
      gold = run.gainGold(rewards.gold);
      addFeedEntry(`<span class="feed-gold">+${gold} GOLD</span>`);
    }
    if (rewards.tech) {
      const riskBonusPct = 1 + saveSystem.getDifficultyLevel() * 0.05;
      tech = Math.max(1, Math.round(rewards.tech * riskBonusPct));
      saveSystem.addTechPoints(tech);
      addFeedEntry(`<span class="feed-boon">+${tech} TECH PTS</span>`);
    }
    if (rewards.healMax) {
      heal = Math.round(run.maxHp * (rewards.healMax / 100));
      run.healFlat(heal);
      addFeedEntry(`<span class="feed-heal">+${heal} HP RECOVERED</span>`);
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
    ui.showCombatResult(true, { gold, tech, heal, relic: rewardRelic, relics: rewardRelics }, run);
  } else {
    ui.updateRunHud(run);
    ui.showCombatResult(false, null, run);
  }
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
  ui.showEncounterOptions(enc);
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
      rewardRandomCollectible('ENCOUNTER DROP');
    }
    if (choice.gainActions) {
      run.addFloorActions(choice.gainActions);
      addFeedEntry(`<span class="feed-heal">+${choice.gainActions} FLOOR ACTIONS</span>`);
    }
    ui.updateRunHud(run);
  }
  map.visitNode(run.floor, node.id);
  run.spendFloorAction();
  ui.updateRunHud(run);
  if (!advanceFloorIfNeeded()) returnToMap();
}

// ---------- Shop ----------

function buyShopItem(item) {
  const node = activeNode || run.currentNode;
  // One-time purchase per shop node (prevents Smuggler Cache spam exploit)
  if (node && node.purchasedItems && node.purchasedItems.includes(item.id)) {
    return false;
  }

  if (item.requireGold) {
    run.gainGold(item.getGold || 0);
    if (node) {
      node.purchasedItems = node.purchasedItems || [];
      node.purchasedItems.push(item.id);
    }
    ui.updateRunHud(run);
    return true;
  }
  const cost = Math.round(item.cost * (run.shopDiscount || 1) * saveSystem.getShopPriceMultiplier());
  if (run.gold < cost) return false;
  run.gold -= cost;
  goldSpentTotal += cost;
  questSystem.reportCombatEvent('gold_spent', { totalSpent: goldSpentTotal });

  switch (item.type) {
    case 'atk':
      run.atk += item.value;
      break;
    case 'def':
      run.def += item.value;
      break;
    case 'maxhp':
      run.addMaxHp(item.value);
      break;
    case 'heal':
      run.healFlat(item.value);
      break;
    default:
      break;
  }
  if (node) {
    node.purchasedItems = node.purchasedItems || [];
    node.purchasedItems.push(item.id);
  }
  ui.updateRunHud(run);
  return true;
}

function rollShopCollectibles(run, count = 3) {
  if (!run) return [];
  const unowned = CONFIG.relics.filter((r) => !run.relics.includes(r.id));
  const shuffled = [...unowned].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function buyRelicItem(relic) {
  if (!run || !relic) return false;
  if (run.hasRelic(relic.id)) return false;
  const cost = Math.round(relic.cost * (run.shopDiscount || 1) * saveSystem.getShopPriceMultiplier());
  if (run.gold < cost) return false;
  run.gold -= cost;
  goldSpentTotal += cost;
  questSystem.reportCombatEvent('gold_spent', { totalSpent: goldSpentTotal });
  run.addRelic(relic.id);
  ui.updateRunHud(run);
  ui.renderRelics(run);
  addFeedEntry(`<span class="feed-relic">+ COLLECTIBLE: ${relic.name}</span>`);
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

    // Relic collectible: Family Feast (+15 Max HP)
    if (run.hasRelic('rel_family_feast')) {
      maxHpBonus += 15;
    }

    if (maxHpBonus > 0) {
      run.addMaxHp(maxHpBonus);
      addFeedEntry(`<span class="feed-heal">SAFE ZONE BONUS: +${maxHpBonus} MAX HP</span>`);
    }

    run.healFlat(healAmount, run.permanent);
    questSystem.reportCombatEvent('rest', { healed: healAmount });
    addFeedEntry(`<span class="feed-heal">SAFE ZONE: +${healAmount} HP RECOVERED</span>`);
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

    addFeedEntry(`<span class="feed-heal">FLAWLESS DRILL: FULL HP RECOVERY & 2 COLLECTIBLES</span>`);
  } else if (perfects >= 3) {
    gold = run.gainGold(25);
    const effectiveHeal = Math.round(50 * saveSystem.getHealingMultiplier());
    healText = `+${effectiveHeal} HP Healed`;
    run.healFlat(50);

    const r1 = rewardRandomCollectible('PRECISION DRILL');
    if (r1) relicsGained.push(r1);

    addFeedEntry(`<span class="feed-heal">PRECISION DRILL: +${effectiveHeal} HP RECOVERED & 1 COLLECTIBLE</span>`);
  } else if (hits >= 3) {
    gold = run.gainGold(15);
    addFeedEntry(`<span class="feed-gold">DRILL PASSED: +${gold} GOLD</span>`);
  } else {
    gold = run.gainGold(5);
    addFeedEntry(`<span class="feed-gold">DRILL CONSOLATION: +${gold} GOLD</span>`);
  }

  questSystem.reportCombatEvent('minigame', { perfect: isAllPerfect });
  ui.updateRunHud(run);

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

function endRun(victory) {
  run.runOver = true;
  run.runResult = victory ? 'victory' : 'defeat';
  saveSystem.recordRun(victory);
  activeNode = null;
  ui.closeModal();
  setState(State.RESULT);
  ui.showRunResult(run, questSystem.getActiveQuests(), { ...saveSystem.getMeta(), techPoints: saveSystem.data.techPoints });
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
    desc: 'A rogue enemy defector offers secret squad coordinates for a price.',
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
    game.update(dt);
    game.render();
    updateAbilityHud();
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

function setupRiskSlider() {
  const slider = document.getElementById('risk-slider');
  if (!slider) return;
  const current = saveSystem.getDifficultyLevel();
  slider.value = current;
  updateRiskDisplay(current);

  slider.addEventListener('input', (e) => {
    const val = Number(e.target.value);
    saveSystem.setDifficultyLevel(val);
    updateRiskDisplay(val);
  });
}

function updateRiskDisplay(val) {
  const valEl = document.getElementById('risk-level-val');
  const bonusEl = document.getElementById('risk-level-bonus');
  if (valEl) valEl.textContent = val;
  if (bonusEl) {
    const risk = CONFIG.riskTable[val] || CONFIG.riskTable[0];
    const tpBonus = val * 5;

    const badges = [];
    if (risk.hpPct > 0) badges.push(`<span class="risk-badge risk-badge-enemy">+${risk.hpPct}% ENEMY STATS</span>`);
    if (risk.minusHeal > 0) badges.push(`<span class="risk-badge risk-badge-heal">-${risk.minusHeal}% HEAL</span>`);
    if (risk.plusCost > 0) badges.push(`<span class="risk-badge risk-badge-cost">+${risk.plusCost}% SHOP COST</span>`);
    if (risk.minusGold > 0) badges.push(`<span class="risk-badge risk-badge-gold">-${risk.minusGold}% GOLD</span>`);
    if (risk.plusDmgTaken > 0) badges.push(`<span class="risk-badge risk-badge-enemy">+${risk.plusDmgTaken}% DMG TAKEN</span>`);
    badges.push(`<span class="risk-badge risk-badge-tp">+${tpBonus}% TP</span>`);

    bonusEl.innerHTML = badges.join('');
  }
}

function bindResetButton() {
  const btn = document.getElementById('btn-reset-data');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (confirm('Are you sure you want to reset all save data, tech tree upgrades, and stats?')) {
      saveSystem.reset();
      setupRiskSlider();
      ui.showMenu(saveSystem.getProfile(), saveSystem.getMeta());
      alert('Save data reset successfully!');
    }
  });
}

// ---------- Boot ----------

ui.showMenu(saveSystem.getProfile(), saveSystem.getMeta());
setupRiskSlider();
bindMapClicks();
bindAbilityButtons();
bindResetButton();

// Expose for debugging
window.__SLINGSHOT__ = { game, saveSystem, techTree, ui, run, map };