// ============================================================
// Game — orchestrates the full game loop: turn flow, physics
// stepping, collisions, gunfire, AI, input, sound effects, and rendering.
// Combat is gear-driven: bodies only move and ram (EXPOSE); every point of
// damage comes from guns and drones, paid for with actions, energy and
// heat. Multi-enemy battles, arena obstacles and screen shake.
// ============================================================

import { CONFIG } from '../config.js';
import { Events } from './Events.js';
import { stepWorld, setTerrain, groundAt } from './Physics.js';
import { Ball } from '../entities/Ball.js';
import { CollisionSystem } from '../systems/CollisionSystem.js';
import { TurnSystem, TurnPhase } from '../systems/TurnSystem.js';
import { SlingshotInput } from '../input/SlingshotInput.js';
import { EnemyAI } from '../ai/EnemyAI.js';
import { Renderer } from '../rendering/Renderer.js';
import { soundEngine } from '../utils/SoundEngine.js';
import { saveSystem } from '../meta/SaveSystem.js';
import { haptics } from '../platform/haptics.js';
import { getBall } from '../meta/Balls.js';
import { DEFAULT_MOVE, DTYPES, dtypeOf, resistOf } from '../meta/Mech.js';
import { pickArena } from './Arenas.js';

const W = CONFIG.world;
const B = CONFIG.ball;
const C = CONFIG.colors;

const FIXED_DT = 1 / 120;
const G = CONFIG.gear;

/** How a gun's shot looks in flight (see Game._shoot and Renderer._drawProjectiles). */
export function vfxOf(w) {
  if (w.arc) return 'lob';
  if (w.fx?.pull) return 'hook';
  if (w.fx?.push || w.fx?.drain) return 'pulse';
  if (w.fx?.line || w.fx?.chain || w.fx?.pierce || w.fx?.heat) return 'beam';
  if (w.fx?.burn || w.fx?.corrode || w.fx?.freeze) return 'spray';
  return 'bullet';
}

/** Where segment (x1,y1)-(x2,y2) first enters rectangle r, as 0..1 along it (null = misses). */
function segmentEnterT(x1, y1, x2, y2, r) {
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const edges = [[-dx, x1 - r.x], [dx, r.x + r.w - x1], [-dy, y1 - r.y], [dy, r.y + r.h - y1]];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  return t0;
}

/** Does segment (x1,y1)-(x2,y2) cross rectangle r? (Liang-Barsky clip) */
function segmentHitsRect(x1, y1, x2, y2, r) {
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const edges = [[-dx, x1 - r.x], [dx, r.x + r.w - x1], [-dy, y1 - r.y], [dy, r.y + r.h - y1]];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

const DEFAULT_BATTLE = {
  player: { maxHp: 100, atk: 1, def: 0, abilities: {} },
  enemies: [
    { maxHp: 100, atk: 1, def: 0, displayName: 'HOSTILE', archetype: 'standard', xPct: 0.75 },
  ],
  nodeType: 'combat',
  ballType: 'operator',
  floor: 1,
};

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.events = new Events();
    this.renderer = new Renderer(canvas);
    this.turnSystem = new TurnSystem(this.events);
    this.collisionSystem = new CollisionSystem(this.events);
    this.slingshotInput = new SlingshotInput(canvas, this.events);
    this.slingshotInput.setCoordinateMapper((x, y) => this.renderer.clientToWorld(x, y));
    this.enemyAI = new EnemyAI(this.events);

    this.player = null;
    this.enemies = [];
    this.particles = [];
    this.barriers = [];
    this.platforms = [];
    this.obstacles = [];
    this.winner = null;
    this.battleConfig = null;
    this.battleStats = this._freshBattleStats();
    this.accumulator = 0;
    this.running = false;
    this.abilities = this._freshAbilities();
    this.turnId = 1; // never reset: hazard hit tracking compares against it

    this._bindEvents();
    this._bindKeys();
    this._bindInspect();

    this.reset(DEFAULT_BATTLE);
  }

  _freshBattleStats() {
    return {
      turns: 0,
      playerDamageTaken: 0,
      wallBounced: false,
      bouncedThisTurn: false, // Ricochet Crest
      fullDrawThisTurn: false, // Full Draw
      echoUsed: false,
      clusteredThisTurn: false,
      // Totals the run screen saves into ball / lifetime stats
      track: { kills: 0, hits: 0, bestHit: 0, crits: 0, maxCombo: 0, bossKills: 0, rams: 0, shots: 0 },
      // The end-of-battle report
      report: { dealt: 0, shots: 0, rams: 0, vents: 0, byGun: {} },
    };
  }

  _freshAbilities() {
    return {
      barrier: { ready: true, cooldownLeft: 0, baseCooldown: CONFIG.abilities.barrier.cooldown, name: CONFIG.abilities.barrier.name },
    };
  }

  startBattle(opts = {}) {
    const merged = {
      ...opts,
      player: { ...DEFAULT_BATTLE.player, ...(opts.player || {}) },
      enemies: (opts.enemies && opts.enemies.length ? opts.enemies : DEFAULT_BATTLE.enemies),
      nodeType: opts.nodeType || 'combat',
      ballType: 'operator',
      floor: opts.floor || 1,
    };
    this.reset(merged);
    this.running = true;
  }

  reset(config = DEFAULT_BATTLE) {
    this.battleConfig = config;
    this.battleStats = this._freshBattleStats();

    const ballType = 'operator';
    const ballDef = getBall(ballType);
    const pRadius = Math.round(B.radius * ballDef.radiusMult);
    const pColor = config.skinColors?.color || ballDef.color;
    const pDark = config.skinColors?.darkColor || ballDef.darkColor;
    const pName = ballDef.name;

    const groundY = W.groundY - pRadius;

    this.player = new Ball({
      x: W.width * 0.25,
      y: groundY,
      team: 'player',
      radius: pRadius,
      color: pColor,
      darkColor: pDark,
      maxHp: config.player.maxHp || B.maxHp,
      displayName: pName,
      ballType,
    });
    this.player.mass = ballDef.mass || 1;
    this.player.bounce = ballDef.bounce || 1;
    this.player.gravityMult = ballDef.gravityMult || 1;
    this.player.shieldHp = config.player.shieldHp || 0;
    this.player.pattern = config.skinColors?.pattern || null;
    this.player.accent = config.skinColors?.accent || null;
    if (config.player.hp !== undefined) {
      this.player.hp = Math.max(1, Math.min(this.player.maxHp, config.player.hp));
    }

    this.enemies = (config.enemies || []).map((e, i) => {
      const xPct = e.xPct ?? 0.7 + i * 0.12;
      const archDef = CONFIG.enemyArchetypes[e.archetype] || CONFIG.enemyArchetypes.standard;
      return new Ball({
        x: W.width * xPct,
        y: groundY,
        team: 'enemy',
        color: archDef.color || C.enemy,
        darkColor: archDef.darkColor || C.enemyDark,
        maxHp: e.maxHp || B.maxHp,
        displayName: e.displayName || archDef.name,
        archetype: e.archetype || 'standard',
        atk: e.atk,
        def: e.def,
        aiDifficulty: e.aiDifficulty,
        thinkDelay: e.thinkDelay,
        radius: e.radius,
      });
    });
    // Guns are the only damage, fired by hand, paid for in actions, energy + heat
    this.gear = true;
    this.projectiles = []; // shots in flight (damage lands on arrival)
    this.enemies.forEach((b, i) => {
      b.rank = config.enemies[i]?.rank || null;
      b.weapons = (config.enemies[i]?.weapons || []).map((w) => ({ ...w, ammoLeft: w.ammo || 0 }));
      b.legs = config.enemies[i]?.legs || null; // how it can move (Mech.enemyMech)
      b.res = { ...(config.enemies[i]?.res || {}) }; // armor resists per damage type
      b.parts = config.enemies[i]?.parts || null; // for the sprite
      this._initRig(b, config.enemies[i]?.rig || G.enemyRig[['elite', 'miniboss', 'boss'].includes(config.nodeType) ? config.nodeType : 'combat']);
    });

    this.rigStats = config.rigStats || {};
    // Rig weapons (classic: auto-fire after your shot settles; gear: fired by hand) and drones (every turn)
    const gunScale = G.dmgScale;
    this.playerWeapons = (this.rigStats.mech?.weapons || []).map((w) => ({ ...w, dmg: w.dmg * gunScale, ammoLeft: w.ammo || 0 }));
    // Drones start docked (OFF): switching one ON deploys it for the rest of the battle
    this.playerDrones = (this.rigStats.mech?.drones || []).map((d) => ({ ...d, dmg: d.dmg ? d.dmg * gunScale : d.dmg, off: true })); // copies: the renderer tags them
    this._initRig(this.player, this.rigStats.mech?.rig || G.baseRig);
    // Legs: how you move (launch power band / angle), or anchored = no moving
    this.player.legs = this.rigStats.mech?.legs || null;
    this.player.parts = this.rigStats.mech?.parts || null;
    this.fireTarget = null; // gear: the enemy you tapped to aim your guns at
    this.enemyFire = null; // gear: an enemy working through its shots
    this.autoEnd = 0; // gear: seconds until a fire phase with nothing left to do ends itself
    this.inspected = null; // { ball, weapon? } shown by the renderer
    // Higher Risk = bolder enemies: they favour hard hits, fire sooner, use abilities more
    this.aggression = Math.min(1, (config.riskLevel || 0) / 8);
    this.player.forcefield = !!this.rigStats.mech?.startForcefield;
    this.player.def = config.player.totalDef ?? 0; // shown on the inspect panel with the resists
    this.player.res = { phys: 0, heat: 0, energy: 0, ...(config.player.res || {}) };
    this._enemyShotHit = false;

    // Random arena for this floor: platforms, obstacles, hazards, wind
    this.arena = config.arena || pickArena(config.floor || 1);
    this.platforms = this.arena.platforms;
    this.obstacles = this.arena.obstacles;
    this.hazards = this.arena.hazards;
    W.wind = this.arena.wind;
    // Uneven ground: set the height profile and seat every ball on it
    setTerrain(this.arena.terrain);
    for (const b of [this.player, ...this.enemies]) b.y = groundAt(b.x) - b.radius;
    this.arenaTime = 0;
    this.renderer.showArenaIntro?.(this.arena);

    this.collisionSystem.setStats({
      playerAtk: config.player.atk ?? 1,
      playerDef: config.player.def ?? 0,
      playerTotalDef: config.player.totalDef ?? config.player.def ?? 0,
      playerRes: this.player.res, // same object: Acid hits strip it
      playerDamageReductionPct: config.player.damageReductionPct ?? 0,
      riskPlusDmgTaken: config.riskPlusDmgTaken || 0,
      riskDefPierce: config.riskDefPierce || 0,
      battleStats: this.battleStats,
      riskLevel: config.riskLevel || 0,
      gear: this.gear,
    });

    this.particles = [];
    this.barriers = [];
    this.abilities = this._freshAbilities();
    this.winner = null;
    this.turnSystem.reset();
    this.turnSystem.enemyIndex = 0;
    this.slingshotInput.setActive(this.canPlayerMove);
    this.slingshotInput.setAnchor(this.player.x, this.player.y, this.player.radius);
    this.slingshotInput.powerMult = config.maxPowerMult || 1;
    this.slingshotInput.move = this.player.legs?.move || DEFAULT_MOVE;
    this.slingshotInput.zeroGTime = 0;
    this.slingshotInput.ignoreWind = false;
    this.slingshotInput.gravityMult = ballDef.gravityMult || 1;
    this.slingshotInput.pads = this.hazards.filter((h) => h.type === 'pad');
    this.hitStop = 0;

    this.renderer.resetBattleFx?.();
  }

  /** Freeze the simulation briefly so big hits land with weight. */
  addHitStop(seconds) {
    this.hitStop = Math.max(this.hitStop || 0, seconds);
  }

  get activeEnemy() {
    return this.enemies[this.turnSystem.enemyIndex] || null;
  }

  get allEnemiesDead() {
    return this.enemies.every((e) => e.hp <= 0);
  }

  useAbility(id) {
    if (!this.running) return false;
    const ab = this.abilities[id];
    if (!ab || !ab.ready) return false;

    if (id === 'barrier') {
      if (this.playerBarrierCount >= this._maxBarriers() || !this.canPlayerAct) return false;

      this.slingshotInput.startBarrierPlacement();
      return true;
    }

    return false;
  }

  /** Your active barriers (enemy walls don't count toward your cap). */
  get playerBarrierCount() {
    return this.barriers.filter((b) => b.active && b.owner !== 'enemy').length;
  }

  /** Point the AI's physics simulation at the current arena. */
  _syncAiWorld() {
    this.enemyAI.setWorld({
      barriers: this.barriers,
      platforms: this.platforms,
      obstacles: this.obstacles,
      pads: this.hazards.filter((h) => h.type === 'pad'),
    });
  }

  _barrierHp() {
    return CONFIG.damage.barrierHp;
  }

  /** Your barrier cap. */
  _maxBarriers() {
    return CONFIG.abilities.barrier.maxActive;
  }

  deployBarrierAt(x, y) {
    const ab = this.abilities.barrier;
    if (!ab || !ab.ready || !this.canPlayerAct) return false; // one of your actions, on your turn
    if (this.playerBarrierCount >= this._maxBarriers()) return false;

    const bw = 14;
    const bh = 90;
    const bx = Math.max(50, Math.min(CONFIG.world.width - 50, x)) - bw / 2;
    const clampedY = Math.max(50, Math.min(groundAt(bx + bw / 2) - bh, y - bh / 2));

    this.barriers.push({
      x: bx,
      y: clampedY,
      w: bw,
      h: bh,
      active: true,
      hp: this._barrierHp(),
      maxHp: this._barrierHp(),
    });
    ab.ready = false;
    ab.cooldownLeft = ab.baseCooldown;
    this.player.actionsLeft -= 1;
    this._afterPlayerAction();
    soundEngine.playAbility('barrier');
    this.events.emit('ability-used', { id: 'barrier', name: CONFIG.abilities.barrier.name });
    return true;
  }

  startBarrierPlacement() {
    this.useAbility('barrier');
  }

  _tickAbilities() {
    for (const e of this.enemies) e.spiked = false; // Spiked Wall hits once per round
    for (const key of Object.keys(this.abilities)) {
      const ab = this.abilities[key];
      if (!ab.ready) {
        ab.cooldownLeft -= 1;
        if (ab.cooldownLeft <= 0) ab.ready = true;
      }
    }
  }

  /** Spring pad kicks are once per ball per turn (Physics.resolvePads). */
  _rechargePads() {
    for (const ball of [this.player, ...this.enemies]) if (ball) ball._padsFired = null;
  }

  _startPlayerTurn() {
    this.turnId = (this.turnId || 0) + 1;
    if (this.player) {
      this._tickRig(this.player);
      this.player.exposed = false; // a ram only exposes you until your own turn
      this.autoEnd = 0;
      this.battleStats.freeMoveUsed = false;
    }
    this._rechargePads();
    this._clearShotEffects();
    this.battleStats.clusteredThisTurn = false;
    this.turnSystem.startPlayerTurn();
    this.slingshotInput.cancelPlacement();
    this.slingshotInput.setActive(this.canPlayerMove);
    if (this.player) {
      this.slingshotInput.setAnchor(this.player.x, this.player.y, this.player.radius);
    }

    // Tick player burn (Flamer hits)
    if (this.player && this.player.burnTicks > 0) {
      const rawBurnDmg = this.player.burnDmg || 8;
      const burnDmg = this.collisionSystem.calculatePlayerDamage(rawBurnDmg, { bypassDef: true });
      this.player.takeDamage(burnDmg);
      this.player.burnTicks -= 1;
      this._spawnHitParticles(this.player.x, this.player.y);
      this.battleStats.playerDamageTaken += burnDmg;
      this.events.emit('enemy-dealt-damage', { attacker: null, damage: burnDmg });
      this.events.emit('enemy-ability', {
        enemy: null,
        ability: 'Thermal Burn',
        desc: `You take ${burnDmg} burn damage! (${this.player.burnTicks} turns left)`,
      });
      if (this.player.hp <= 0) {
        this._checkBattleEnd(this.player);
        return;
      }
    }

    // Still over the heat cap after cooling: VENT is forced (maybe the whole turn)
    if (this.player && this._forcedVent(this.player) && this.player.actionsLeft <= 0) {
      this.slingshotInput.setActive(false);
      this.autoEnd = 1.4; // long enough to see why
    }

    this.events.emit('player-turn-start');
  }

  stop() {
    this.running = false;
    this.slingshotInput.setActive(false);
  }

  _startEnemyTurnAtIndex(index) {
    this.turnId = (this.turnId || 0) + 1;
    this._rechargePads();
    this.turnSystem.startEnemyTurn(index);
    const enemy = this.enemies[index];
    // A dead enemy's turn must still be passed on, or the battle freezes
    if (!enemy || enemy.hp <= 0) return this._passEnemyTurn();
    this._tickRig(enemy);
    enemy.exposed = false;

    if (enemy.burnTicks > 0) {
      const burnDmg = enemy.burnDmg || 6;
      enemy.hp = Math.max(0, enemy.hp - burnDmg);
      enemy.burnTicks -= 1;
      this._spawnHitParticles(enemy.x, enemy.y);
      this.events.emit('player-dealt-damage', { victim: enemy, damage: burnDmg });
      if (enemy.hp <= 0) {
        this._spawnDefeatParticles(enemy.x, enemy.y, enemy.color);
        this._checkBattleEnd(enemy);
        return this._passEnemyTurn(); // burned to death: next enemy (or you) goes
      }
    }

    // Same heat rule as yours: overheated means forced vents first
    if (this._forcedVent(enemy) && enemy.actionsLeft <= 0) {
      this.turnSystem.startFire();
      this.enemyFire = { shooter: enemy, index, timer: G.shotGap * 3 }; // nothing left: the turn passes
      return;
    }

    // Enemies learn: every miss in a row tightens their aim
    let aiDifficulty = Math.min(0.95, (enemy.aiDifficulty ?? 0.5) + 0.07 * (enemy.missStreak || 0));
    if ((enemy.missStreak || 0) >= 2) this._callout(enemy, 'LOCKING ON', '#ff5d73');
    this._enemyShotHit = false;
    if (enemy.isFrozen) {
      aiDifficulty = Math.max(0.2, aiDifficulty - 0.3);
    }

    this.enemyAI.configure({
      difficulty: aiDifficulty,
      thinkDelay: enemy.thinkDelay ?? CONFIG.ai.thinkDelay,
      aggression: this.aggression,
      // Gear combat: pick a landing spot with its guns in range and yours not
      // Pick a landing spot with its guns in range and yours not
      spotScorer: (x, y, rammed, stay) => this._scoreSpot(enemy, x, y, rammed, stay),
    });
    this._syncAiWorld();
    this.enemyAI.startTurn(enemy, this.player);
  }

  /** Spawned enemies play by the same rules: a weaker copy of the parent's gun, legs and a reactor. */
  _armMinion(ball, parent, dmgMult) {
    const gun = parent.weapons?.[0];
    ball.weapons = gun ? [{ ...gun, dmg: Math.max(2, Math.round(gun.dmg * dmgMult)), ammoLeft: gun.ammo || 0 }] : [];
    ball.legs = parent.legs?.anchored ? null : parent.legs || null;
    this._initRig(ball, G.enemyRig.combat);
  }

  /** Bosses at half HP: +25% ATK and a minion joins the fight. */
  _enterPhaseTwo(boss) {
    boss.phase2 = true;
    boss.atk = Math.round(boss.atk * 1.25 * 100) / 100;
    const minion = new Ball({
      x: Math.min(W.width - 40, boss.x + 90),
      y: boss.y - 40,
      team: 'enemy',
      color: CONFIG.enemyArchetypes.standard.color,
      darkColor: CONFIG.enemyArchetypes.standard.darkColor,
      maxHp: Math.round(boss.maxHp * 0.25),
      displayName: 'REINFORCEMENT',
      archetype: 'standard',
      atk: Math.round(boss.atk * 0.5 * 100) / 100,
      def: 0,
      aiDifficulty: Math.max(0.3, boss.aiDifficulty - 0.15),
      thinkDelay: boss.thinkDelay,
      radius: 20,
    });
    minion.vy = -500;
    this._armMinion(minion, boss, 0.5);
    this.enemies.push(minion);
    this.renderer.showBanner('PHASE 2', '#ff5d73');
    this._callout(boss, 'ENRAGED: +25% ATK', '#ff5d73');
    this.renderer.addScreenShake(16);
    soundEngine.play('alarm');
    haptics.impact('heavy');
  }

  /** Spikes and mines (bounce pads are real springs: see Physics.resolvePads). */
  _applyHazards(balls) {
    for (const ball of balls) {
      if (ball.hp <= 0) continue;
      const onGround = ball.y + ball.radius >= groundAt(ball.x) - 3;
      let touching = null;
      for (const h of this.hazards) {
        if (h.type !== 'pad' && onGround && ball.x > h.x && ball.x < h.x + h.w) touching = h;
      }
      const entered = touching && ball._hazard !== touching;
      ball._hazard = touching;
      if (!entered) continue;
      // Spikes and mines hurt a ball once per turn at most: a bouncing ball
      // used to take spike damage on every landing, and mine blasts chained
      const hurtThisTurn = ball._hazardHurtTurn === this.turnId;

      if (touching.type === 'mine') {
        if (ball.team === (touching.owner || 'enemy')) continue; // a side steps over its own mines
        if (hurtThisTurn) continue; // stays armed for later
        ball._hazardHurtTurn = this.turnId;
        this.hazards.splice(this.hazards.indexOf(touching), 1);
        const raw = touching.dmg || 15;
        const dmg = ball.team === 'player' ? this.collisionSystem.calculatePlayerDamage(raw) : Math.max(1, Math.round(raw * (1 - Math.min(15, ball.def || 0) * CONFIG.damage.defensePerPoint)));
        const killed = ball.takeDamage(dmg);
        ball.vy = -600;
        if (ball.team === 'player') this.battleStats.playerDamageTaken += dmg;
        else {
          this.events.emit('damage', { attacker: this.player, victim: ball, damage: dmg, killed });
          this.battleStats.report.dealt += dmg;
        }
        this.particles.push({ type: 'shockwave', x: ball.x, y: groundAt(ball.x), radius: 10, maxRadius: 160, life: 0.35, maxLife: 0.35 });
        this._spawnDefeatParticles(ball.x, groundAt(ball.x), '#ef7d57');
        soundEngine.playDefeat();
        this.renderer.addScreenShake(14);
        haptics.impact('heavy');
        this._callout(ball, 'MINE!', '#ef7d57');
        if (this.player.hp <= 0 || killed) this._checkBattleEnd(ball);
        continue;
      }

      if (touching.type === 'spikes') {
        ball.vy = -420;
        if (hurtThisTurn) continue;
        ball._hazardHurtTurn = this.turnId;
        const raw = 8;
        const dmg = ball.team === 'player' ? this.collisionSystem.calculatePlayerDamage(raw, { bypassDef: true }) : raw;
        const killed = ball.takeDamage(dmg);
        ball.vy = -420;
        this._spawnHitParticles(ball.x, groundAt(ball.x));
        soundEngine.play('hurt');
        this._callout(ball, 'SPIKES', '#ff5d73');
        if (ball.team === 'player') {
          this.battleStats.playerDamageTaken += dmg;
          haptics.impact('heavy');
        }
        if (killed || this.player.hp <= 0) this._checkBattleEnd(ball);
      }
    }
  }

  /** Move a ball sideways by dx, staying inside the arena walls. */
  _slide(ball, dx) {
    ball.x = Math.max(ball.radius, Math.min(W.width - ball.radius, ball.x + dx));
  }


  // ---------- Rig weapons ----------

  /** Quick tap (not a drag) on a ball inspects its weapons; tap it again or empty ground to close. */
  _bindInspect() {
    let down = null;
    this.canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    this.canvas.addEventListener('pointerup', (e) => {
      if (!down || !this.running) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = performance.now() - down.t < 400;
      down = null;
      if (moved > 10 || !quick || !this.renderer.clientToWorld) return;
      // HP panels (screen space) first: tapping one inspects that ball
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const panel = (this.renderer.panelHits || []).find((p) => p.ball.hp > 0 && sx >= p.x && sx <= p.x + p.w && sy >= p.y && sy <= p.y + p.h);
      if (panel) {
        this.inspected = this.inspected?.ball === panel.ball && this.inspected.weapon === undefined ? null : { ball: panel.ball };
        if (this.gear && panel.ball.team === 'enemy') this.setFireTarget(panel.ball); // gear: tap an enemy to aim at it
        return;
      }
      const pos = this.renderer.clientToWorld(e.clientX, e.clientY);
      const hit = [this.player, ...this.enemies].find((b) => b && b.hp > 0 && Math.hypot(b.x - pos.x, b.y - pos.y) <= b.radius + 16);
      this.inspected = hit && this.inspected?.ball !== hit ? { ball: hit } : null;
      if (this.gear && hit?.team === 'enemy') this.setFireTarget(hit);
    });
  }

  /** HUD weapon chip tapped: show that gun's range around you. */
  inspectWeapon(index) {
    const same = this.inspected?.ball === this.player && this.inspected.weapon === index;
    this.inspected = same ? null : { ball: this.player, weapon: index };
  }

  // ---------- Shots: every gun fires a visible projectile ----------
  //
  // Damage lands when the projectile arrives, so turns wait for shots in
  // flight. Each gun has a look (vfxOf): bullets fly straight, lobbed
  // weapons arc, beams flash across, sprayers cone out, the grapple line
  // reels, pulse guns send a shock ring.

  /** One gun firing at one target: queues its projectile(s); hits land on arrival. */
  _shoot(shooter, w, target) {
    const kind = vfxOf(w);
    const now = performance.now();
    w.firedAt = now; // renderer: recoil + muzzle flash, gun turns to the target
    w.aimAt = target;
    const from = w._muzzle ? { ...w._muzzle } : { x: shooter.x, y: shooter.y };
    const dist = Math.hypot(target.x - from.x, target.y - from.y);
    const dur = {
      bullet: Math.max(0.08, Math.min(0.4, dist / 1700)),
      lob: 0.55 + Math.min(0.45, dist / 2400),
      beam: 0.14,
      spray: 0.3,
      hook: Math.max(0.14, Math.min(0.42, dist / 1500)),
      pulse: Math.max(0.12, Math.min(0.45, dist / 1100)),
    }[kind];
    const rounds = w.fx?.burst || 1;
    // A wall on the way stops the shot there (and takes the damage)
    const block = this._coverOnPath(shooter.team, from, target, kind);
    for (let i = 0; i < rounds; i++) {
      this.projectiles.push({
        kind,
        color: w.color || '#f4f4f4',
        x0: from.x,
        y0: from.y,
        target,
        block,
        t: -i * 0.09, // burst rounds follow each other
        dur: block ? Math.max(0.06, dur * block.k) : dur,
        last: i === rounds - 1,
        onHit: (last) => (block ? this._hitCover(block, w.dmg) : this._landShot(shooter, w, target, last)),
      });
    }
    soundEngine.playUI(kind === 'lob' ? 180 : kind === 'beam' ? 880 : 520, 0.05);
    if (shooter === this.player) haptics.impact(kind === 'lob' || w.dmg > 60 ? 'medium' : 'light');
  }

  /** Advance projectiles; a projectile's hit lands when it arrives. */
  _updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.t += dt;
      if (p.t < p.dur) continue;
      this.projectiles.splice(i, 1);
      if (this.turnSystem.phase !== TurnPhase.GAME_OVER && (p.block || p.target.hp > 0)) p.onHit(p.last);
    }
  }

  /** A projectile arrived: one hit, and on the last round the gun's area / status effects. */
  _landShot(shooter, w, target, last) {
    const isPlayer = shooter === this.player;
    const foes = () => (isPlayer ? this.enemies.filter((e) => e.hp > 0) : this.player.hp > 0 ? [this.player] : []);
    const over = () => this.turnSystem.phase === TurnPhase.GAME_OVER;
    // Mine Launcher: plant a mine near the target instead of hitting it
    if (w.fx?.mine) return this._plantMine(shooter, target, w);
    // Laser: every foe along the beam, out to the gun's reach
    let victims = [target];
    if (w.fx?.line) {
      const d = Math.hypot(target.x - shooter.x, target.y - shooter.y) || 1;
      const ux = (target.x - shooter.x) / d;
      const uy = (target.y - shooter.y) / d;
      victims = foes().filter((f) => {
        const along = (f.x - shooter.x) * ux + (f.y - shooter.y) * uy;
        const off = Math.abs((f.x - shooter.x) * uy - (f.y - shooter.y) * ux);
        return along > 0 && along <= w.range[1] && off <= f.radius + 10;
      });
      if (!victims.includes(target)) victims.push(target);
    }
    for (const v of victims) {
      if (v.hp > 0 && !over()) this._weaponHit(shooter, v, w, w.dmg);
    }
    if (isPlayer && victims.length > 1) this._trackCombo(victims.length);
    if (!last || over()) return;
    if (w.fx?.chain) {
      const next = foes().find((f) => f !== target && Math.hypot(f.x - target.x, f.y - target.y) <= w.fx.chain);
      if (next) {
        this.particles.push({ type: 'bolt', x1: target.x, y1: target.y, x2: next.x, y2: next.y, life: 0.3, maxLife: 0.3, seed: Math.random() });
        this._weaponHit(target, next, w, w.dmg * 0.6, shooter);
        if (isPlayer) this._trackCombo(2);
      }
    }
    if (w.fx?.splash) {
      let hitCount = 1;
      for (const f of foes()) {
        if (f !== target && Math.hypot(f.x - target.x, f.y - target.y) <= w.fx.splash) {
          this._weaponHit(target, f, w, w.dmg * 0.5, shooter);
          hitCount++;
        }
      }
      if (isPlayer && hitCount > 1) this._trackCombo(hitCount);
      this.particles.push({ type: 'shockwave', x: target.x, y: target.y, radius: 10, maxRadius: w.fx.splash, life: 0.3, maxLife: 0.3 });
      this.renderer.addScreenShake(8);
    }
    // Knockback guns: shove the target away, or reel it in
    if (target.hp > 0 && (w.fx?.push || w.fx?.pull)) {
      const d = Math.hypot(target.x - shooter.x, target.y - shooter.y) || 1;
      const k = w.fx.push || -w.fx.pull;
      target.vx += ((target.x - shooter.x) / d) * k;
      target.vy += -Math.abs(k) * 0.45;
      this._callout(target, w.fx.push ? 'KNOCKED BACK' : 'HOOKED', w.color);
    }
  }

  /**
   * A mine lands 80-150px beside the target (never right under it, never on
   * another mine) and arms. Whoever of the other side steps on it takes the blast.
   */
  _plantMine(shooter, target, w) {
    const mines = this.hazards.filter((h) => h.type === 'mine');
    for (let tries = 0; tries < 10; tries++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const x = Math.max(60, Math.min(W.width - 60, target.x + side * (80 + Math.random() * 70)));
      if (mines.some((m) => Math.abs(m.x + m.w / 2 - x) < 110)) continue;
      this.hazards.push({ type: 'mine', x: x - 24, w: 48, armed: true, born: performance.now(), owner: shooter.team, dmg: w.dmg });
      this.particles.push({ type: 'shockwave', x, y: groundAt(x), radius: 6, maxRadius: 60, life: 0.3, maxLife: 0.3 });
      soundEngine.playUI(300);
      this._callout(shooter, 'MINE PLANTED', '#ef7d57');
      return;
    }
    this._callout(shooter, 'NO ROOM FOR A MINE', '#94b0c2');
  }

  /** One shot hitting several enemies (laser, splash, chain). */
  _trackCombo(n) {
    const t = this.battleStats.track;
    if (n <= (t.maxCombo || 0) && n < 3) return;
    t.maxCombo = Math.max(t.maxCombo || 0, n);
    if (n >= 2) this._callout(this.player, n >= 3 ? `TRIPLE HIT` : 'DOUBLE HIT', n >= 3 ? '#ff5d73' : '#ffcd75');
  }

  /** One drone's action: repair, shield, or a shot at your target (any range). */
  _droneAct(d) {
    const shooter = this.player;
    if (d.heal) {
      const before = shooter.hp;
      d.firedAt = performance.now();
      shooter.hp = Math.min(shooter.maxHp, shooter.hp + Math.round(d.heal));
      if (shooter.hp > before) this._callout(shooter, `REPAIR +${shooter.hp - before}`, d.color);
      this._spawnHealSparkles(shooter);
    } else if (d.forcefieldEvery) {
      if (this.battleStats.turns % d.forcefieldEvery === 0 && !shooter.forcefield) {
        d.firedAt = performance.now();
        shooter.forcefield = true;
        this._callout(shooter, 'DRONE SHIELD', d.color);
      }
    } else if (d.dmg) {
      const target = this._currentTarget() || this.enemies.filter((e) => e.hp > 0).sort(this._byDistance(shooter))[0];
      if (target) {
        d.firedAt = performance.now();
        this._callout(shooter, 'DRONE', d.color || '#ffcd75'); // end-of-turn drone shot, not one of your actions
        const from = d._muzzle || { x: shooter.x, y: shooter.y - shooter.radius * 2 };
        this.projectiles.push({
          kind: 'bullet',
          color: d.color || '#ffcd75',
          x0: from.x,
          y0: from.y,
          target,
          t: 0,
          dur: Math.max(0.1, Math.min(0.4, Math.hypot(target.x - from.x, target.y - from.y) / 1600)),
          last: true,
          onHit: () => this._weaponHit(shooter, target, d, d.dmg),
        });
      }
    }
  }

  _spawnHealSparkles(ball) {
    for (let i = 0; i < 10; i++) {
      this.particles.push({ x: ball.x + (Math.random() - 0.5) * ball.radius * 2, y: ball.y, vx: 0, vy: -90 - Math.random() * 80, float: true, size: 4, color: '#a7f070', life: 0.6, maxLife: 0.6 });
    }
  }

  // ---------- Gear combat: reactor, line of sight, actions ----------
  //
  // Each turn a ball gets CONFIG.gear.actions actions, spent in any order:
  //   MOVE  – one slingshot launch
  //   FIRE  – one gun at one target (energy + heat, ammo on strong guns)
  //   VENT  – dump heat and win back some energy
  // END TURN skips whatever is left. Drones switched ON act at the end of
  // your turn and pay their own energy. Enemies follow the same rules.

  _initRig(ball, rig) {
    ball.energyMax = rig.energy;
    ball.energy = rig.energy;
    ball.regen = rig.regen;
    ball.heatCap = rig.heatCap;
    ball.heat = 0;
    ball.cool = rig.cool;
    ball.actionsLeft = G.actions;
  }

  /** Start of a ball's turn: the reactor refills, the guns cool, actions reset. */
  _tickRig(ball) {
    ball.energy = Math.min(ball.energyMax, ball.energy + ball.regen);
    ball.heat = Math.max(0, ball.heat - ball.cool);
    ball.actionsLeft = G.actions;
  }

  /**
   * Overheating: a ball still over its heat cap when its turn starts (after
   * the normal cooling) must VENT, one action per vent, until it's back
   * under the cap or out of actions (two vents = the whole turn lost).
   * Returns how many vents were forced.
   */
  _forcedVent(ball) {
    let n = 0;
    while (ball.heat > ball.heatCap && ball.actionsLeft > 0) {
      this._vent(ball);
      n += 1;
    }
    if (n) {
      this._callout(ball, ball.actionsLeft > 0 ? 'OVERHEATED: FORCED VENT' : 'OVERHEATED: TURN LOST', '#ff5d73');
      this.addHitStop(0.12);
      soundEngine.play('alarm');
      if (ball === this.player) haptics.impact('heavy');
    }
    return n;
  }

  _gunsOf(ball) {
    return ball === this.player ? this.playerWeapons || [] : ball.weapons || [];
  }

  _foesOf(ball) {
    return ball === this.player ? this.enemies.filter((e) => e.hp > 0) : this.player.hp > 0 ? [this.player] : [];
  }

  /**
   * Clear shot from a to b? Platforms (solid) always block. With `cover`,
   * breakable walls and the other side's barriers count too: shots CAN be
   * fired into those, but they stop there and chip the wall instead.
   */
  _lineClear(a, b, shooterTeam, cover = true) {
    for (const r of this.platforms) if (segmentHitsRect(a.x, a.y, b.x, b.y, r)) return false;
    if (!cover) return true;
    return !this._coverRects(shooterTeam).some((r) => segmentHitsRect(a.x, a.y, b.x, b.y, r));
  }

  /** Walls that stop this side's shots: breakable walls, and the other side's barriers. */
  _coverRects(shooterTeam) {
    const out = this.obstacles.filter((r) => r.active !== false);
    for (const r of this.barriers) {
      if (!r.active) continue;
      const mine = shooterTeam === 'player' ? r.owner !== 'enemy' : r.owner === 'enemy';
      if (!mine) out.push(r);
    }
    return out;
  }

  /**
   * First wall a shot from `from` to `target` runs into: { x, y, rect, k }
   * with k = how far along the flight (0..1), or null. Lobbed shots follow
   * their arc (the same one the renderer draws), so they clear low cover.
   */
  _coverOnPath(shooterTeam, from, target, kind) {
    const rects = this._coverRects(shooterTeam);
    if (!rects.length) return null;
    const dx = target.x - from.x;
    const dy = target.y - from.y;
    if (kind === 'lob') {
      const arcH = 110 + Math.hypot(dx, dy) * 0.28;
      const at = (k) => ({ x: from.x + dx * k, y: from.y + dy * k - arcH * 4 * k * (1 - k) });
      for (let i = 1; i <= 40; i++) {
        const k = i / 40;
        const q = at(k);
        const rect = rects.find((r) => q.x >= r.x && q.x <= r.x + r.w && q.y >= r.y && q.y <= r.y + r.h);
        if (rect) return { ...q, rect, k };
      }
      return null;
    }
    let best = null;
    for (const rect of rects) {
      const k = segmentEnterT(from.x, from.y, target.x, target.y, rect);
      if (k !== null && (!best || k < best.k)) best = { x: from.x + dx * k, y: from.y + dy * k, rect, k };
    }
    return best;
  }

  /** A shot that hit a wall: the wall soaks the damage and may break. */
  _hitCover(block, dmg) {
    const r = block.rect;
    if (!r.active && r.active !== undefined) return;
    const hp = Math.max(0, (r.hp ?? r.maxHp ?? CONFIG.damage.barrierHp) - Math.round(dmg));
    r.hp = hp;
    this._spawnHitParticles(block.x, block.y);
    this.renderer.addFloatingText(block.x, block.y - 20, `-${Math.round(dmg)}`, '#94b0c2');
    soundEngine.playUI(180, 0.05);
    if (hp <= 0) {
      r.active = false;
      this.particles.push({ type: 'shockwave', x: r.x + r.w / 2, y: r.y + r.h / 2, radius: 10, maxRadius: 120, life: 0.35, maxLife: 0.35 });
      this.renderer.addFloatingText(r.x + r.w / 2, r.y - 10, 'WALL DOWN', '#ffcd75', true);
      this.renderer.addScreenShake(10);
    }
  }

  /**
   * Can this gun fire at this target right now? { ok, reason }, with reasons
   * in the order the player would fix them.
   */
  gunStatus(shooter, w, target) {
    if (!(shooter.actionsLeft > 0)) return { ok: false, reason: 'NO ACTIONS' };
    if (w.ammo && w.ammoLeft <= 0) return { ok: false, reason: 'EMPTY' };
    // Under the cap you may fire, even a shot that takes you over it (overheating: next turn starts with forced vents)
    if (shooter.heat >= shooter.heatCap) return { ok: false, reason: 'HOT' };
    if (shooter.energy < (w.en || 0)) return { ok: false, reason: 'ENERGY' };
    if (!target) return { ok: false, reason: 'NO TARGET' };
    const d = Math.hypot(target.x - shooter.x, target.y - shooter.y);
    if (d < w.range[0] || d > w.range[1]) return { ok: false, reason: d < w.range[0] ? 'TOO CLOSE' : 'RANGE' };
    if (!w.arc && !this._lineClear(shooter, target, shooter.team, false)) return { ok: false, reason: 'BLOCKED' };
    // Walls in the way: you can still fire, the wall takes the hit (see _coverOnPath)
    const from = w._muzzle || shooter;
    const cover = !!this._coverOnPath(shooter.team, from, target, vfxOf(w));
    return { ok: true, reason: '', cover, overheats: shooter.heat + (w.heat || 0) > shooter.heatCap };
  }

  _byDistance(from) {
    return (a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y);
  }

  /** Best target for a gun: your tapped enemy if it can be hit, else the nearest that can. */
  _targetFor(shooter, w) {
    if (shooter === this.player && this.fireTarget?.hp > 0 && this.gunStatus(shooter, w, this.fireTarget).ok) return this.fireTarget;
    return this._foesOf(shooter).filter((f) => this.gunStatus(shooter, w, f).ok).sort(this._byDistance(shooter))[0] || null;
  }

  /** The enemy you tapped to aim at (for the reticle), if it's still alive. */
  _currentTarget() {
    if (this.fireTarget && this.fireTarget.hp <= 0) this.fireTarget = null;
    return this.fireTarget;
  }

  /** Tap an enemy to aim your guns at it (tap it again to go back to nearest). */
  setFireTarget(enemy) {
    this.fireTarget = enemy && enemy.hp > 0 && enemy !== this.fireTarget ? enemy : null;
  }

  /** HUD: what a gun would do right now ({ ok, reason, target, dmg }). */
  playerGunState(i) {
    const w = this.playerWeapons[i];
    if (!w || !this.player) return { ok: false, reason: '' };
    const target = this._targetFor(this.player, w);
    if (target) {
      const st = this.gunStatus(this.player, w, target);
      return { ok: true, reason: '', target, cover: st.cover, overheats: st.overheats, dmg: this._previewDamage(w, target) };
    }
    const probe = this._currentTarget() || this._foesOf(this.player).sort(this._byDistance(this.player))[0];
    const st = this.gunStatus(this.player, w, probe);
    return { ...st, dmg: probe ? this._previewDamage(w, probe) : 0 };
  }

  /** Damage one use of your gun would deal to this target (before crits), for planning. */
  _previewDamage(w, target) {
    let dmg = w.dmg * (w.fx?.burst || 1) * (this.collisionSystem.stats.playerAtk || 1);
    if (target.exposed) dmg *= G.exposedMult;
    if (!(w.fx?.pierce || this.player.piercing)) dmg *= 1 - Math.min(CONFIG.run.maxDefCap || 15, resistOf(target, dtypeOf(w))) * CONFIG.damage.defensePerPoint;
    return Math.max(1, Math.round(dmg));
  }

  /** Can you launch right now? (anchored legs never can; Thrusters need energy) */
  get canPlayerMove() {
    const legs = this.player?.legs;
    if (legs?.anchored) return false;
    if (legs?.moveEn && this.player.energy < legs.moveEn) return false;
    return !!this.player && this.player.actionsLeft > 0;
  }

  /** Your actions can be spent while aiming (before or after a move). */
  get canPlayerAct() {
    return this.running && this.turnSystem.phase === TurnPhase.PLAYER_AIM && this.player.actionsLeft > 0 && !this.slingshotInput.dragging;
  }

  /** Spend the shot's energy, heat, ammo and one action. */
  _payForShot(shooter, w) {
    shooter.energy -= w.en || 0;
    shooter.heat += w.heat || 0;
    if (w.ammo) w.ammoLeft -= 1;
    shooter.actionsLeft -= 1;
  }

  /** VENT: dump heat, win back some energy (costs one action). */
  _vent(ball) {
    const cooled = Math.min(ball.heat, ball.cool * G.vent.coolMult);
    ball.heat -= cooled;
    const before = ball.energy;
    ball.energy = Math.min(ball.energyMax, ball.energy + Math.round(ball.regen * G.vent.energyPct));
    ball.actionsLeft -= 1;
    // Steam blasts out of the vents
    for (let i = 0; i < 16; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      const sp = 90 + Math.random() * 160;
      this.particles.push({ x: ball.x + (Math.random() - 0.5) * ball.radius, y: ball.y - ball.radius * 0.5, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, float: true, size: 6 + Math.random() * 8, color: i % 3 ? '#dfe6ee' : '#73eff7', life: 0.7, maxLife: 0.7 });
    }
    this.particles.push({ type: 'shockwave', x: ball.x, y: ball.y, radius: 10, maxRadius: 90, life: 0.35, maxLife: 0.35 });
    soundEngine.playUI(330);
    this._callout(ball, `VENT -${Math.round(cooled)} HEAT +${Math.round(ball.energy - before)} EN`, '#73eff7');
  }

  /** Player taps a gun: fire it. Returns the gun state (reason says why not). */
  firePlayerWeapon(i) {
    if (!this.canPlayerAct) return { ok: false, reason: this.player?.actionsLeft > 0 ? 'WAIT' : 'NO ACTIONS' };
    const w = this.playerWeapons[i];
    const state = this.playerGunState(i);
    if (!state.ok) return state;
    const bs = this.battleStats;
    this._payForShot(this.player, w);
    bs.firstShotDone = true;
    bs.report.shots += 1;
    bs.track.shots += 1;
    this._shoot(this.player, w, state.target);
    this._afterPlayerAction();
    return state;
  }

  ventPlayer() {
    if (!this.canPlayerAct) return false;
    this._vent(this.player);
    this.battleStats.report.vents += 1;
    this._afterPlayerAction();
    return true;
  }

  /** Drones are switched ON/OFF by the player; ON drones act at the end of the turn. */
  /**
   * Drone chip: DEPLOY costs one action (it then acts at the end of every
   * turn); recalling it is free. Returns { ok, reason }.
   */
  toggleDrone(i) {
    const d = this.playerDrones[i];
    if (!d || !this.running || this.turnSystem.phase !== TurnPhase.PLAYER_AIM) return { ok: false, reason: 'WAIT' };
    if (d.off) {
      if (!this.canPlayerAct) return { ok: false, reason: 'NO ACTIONS' };
      this.player.actionsLeft -= 1;
      d.off = false;
      d.deployedAt = performance.now(); // renderer: drone flies out
      this._callout(this.player, 'DRONE DEPLOYED', d.color || '#a7f070');
      this.autoEnd = 0;
      this._afterPlayerAction();
    } else {
      d.off = true;
      d.deployedAt = performance.now(); // renderer: drone docks
    }
    return { ok: true };
  }

  /** Out of actions: a moment to watch the result, then the turn ends itself. */
  _afterPlayerAction() {
    if (this.turnSystem.phase === TurnPhase.GAME_OVER) return;
    if (this.player.actionsLeft <= 0) {
      this.slingshotInput.setActive(false);
      this.autoEnd = 0.8;
    }
  }

  /** END TURN: skip whatever actions are left. */
  endPlayerTurn() {
    if (!this.running || this.turnSystem.phase !== TurnPhase.PLAYER_AIM) return false;
    if (this.slingshotInput.dragging) return false;
    this.slingshotInput.setActive(false);
    if (this.projectiles.length) {
      this.autoEnd = 0.05; // let the shots in flight land first
      return true;
    }
    this.autoEnd = 0;
    this._finishPlayerTurn();
    return true;
  }

  /** Landed after a MOVE: back to aiming if actions remain (fire, vent, or move again). */
  _afterPlayerMove() {
    this.turnSystem.phase = TurnPhase.PLAYER_AIM;
    this.turnSystem.turnTime = 0;
    this._rechargePads();
    if (this.player.actionsLeft > 0) {
      this.slingshotInput.setActive(this.canPlayerMove);
      this.slingshotInput.setAnchor(this.player.x, this.player.y, this.player.radius);
    } else {
      this._afterPlayerAction();
    }
  }

  /** Drones switched ON act now, paying their energy (gear combat). */
  _gearDrones() {
    const D = G.drone;
    for (const d of this.playerDrones) {
      if (d.off) continue;
      const en = d.heal ? D.healEn : d.forcefieldEvery ? D.shieldEn : D.dmgEn;
      const heat = d.dmg ? D.dmgHeat : 0;
      if (d.forcefieldEvery && (this.player.forcefield || this.battleStats.turns % d.forcefieldEvery !== 0)) continue; // nothing to do yet: free
      if (d.heal && this.player.hp >= this.player.maxHp) continue;
      if (this.player.energy < en || this.player.heat + heat > this.player.heatCap) {
        this._callout(this.player, 'DRONE: NO POWER', '#94b0c2');
        continue;
      }
      this.player.energy -= en;
      this.player.heat += heat;
      this._droneAct(d);
      if (this.turnSystem.phase === TurnPhase.GAME_OVER) return;
    }
  }

  /** Everything after your actions: drones, turn upkeep, then the enemies. */
  _finishPlayerTurn() {
    this.battleStats.turns += 1;
    this._gearDrones();
    if (this.turnSystem.phase === TurnPhase.GAME_OVER) return;
    this._tickAbilities();
    this.collisionSystem.stats.playerDef = this.battleConfig?.player?.def || 0;

    const firstIdx = this.enemies.findIndex((e) => e.hp > 0);
    if (firstIdx === -1) {
      this._startPlayerTurn();
    } else {
      this._startEnemyTurnAtIndex(firstIdx);
    }
  }

  /** Hand over from enemy `currentIdx` to the next living enemy, or back to you. */
  _afterEnemyTurn(currentIdx) {
    const shooter = this.enemies[currentIdx];
    if (shooter) {
      shooter.missStreak = this._enemyShotHit ? 0 : (shooter.missStreak || 0) + 1;
    }
    let nextIdx = -1;
    for (let i = currentIdx + 1; i < this.enemies.length; i++) {
      if (this.enemies[i].hp > 0) {
        nextIdx = i;
        break;
      }
    }
    if (nextIdx !== -1) {
      this._startEnemyTurnAtIndex(nextIdx);
    } else {
      this._startPlayerTurn();
    }
  }

  /**
   * Enemy planned its move (gear): if its best spot is where it stands, it
   * spends both actions shooting (or venting); otherwise it moves first,
   * then acts with what's left.
   */
  _onEnemyPlan({ velocity }) {
    const idx = this.turnSystem.enemyIndex;
    const enemy = this.enemies[idx];
    if (!enemy || enemy.hp <= 0 || this.turnSystem.phase !== TurnPhase.ENEMY_AIM) return;
    const legs = enemy.legs;
    const canMove = !legs?.anchored && (!legs?.moveEn || enemy.energy >= legs.moveEn);
    if (velocity && enemy.actionsLeft > 0 && canMove) {
      if (legs?.moveEn) enemy.energy -= legs.moveEn;
      if (!legs?.freeMove) enemy.actionsLeft -= 1;
      enemy.launchedAt = performance.now();
      this.events.emit('enemy-launch', { velocity, enemyIndex: idx });
      return;
    }
    this._callout(enemy, 'HOLDING', '#94b0c2');
    this.turnSystem.startFire();
    this.enemyFire = { shooter: enemy, index: idx, timer: G.shotGap };
  }

  /** Per frame (gear): auto-end your spent turn, and pace enemy actions. */
  _updateGearTurn(dt) {
    if (this.projectiles.length) return; // wait for shots in flight to land
    if (this.turnSystem.phase === TurnPhase.PLAYER_AIM && this.autoEnd > 0) {
      this.autoEnd -= dt;
      if (this.autoEnd <= 0) this.endPlayerTurn();
      return;
    }
    const ef = this.enemyFire;
    if (!ef || this.turnSystem.phase !== TurnPhase.ENEMY_FIRE) return;
    ef.timer -= dt;
    if (ef.timer > 0) return;
    const e = ef.shooter;
    const w = e.hp > 0 && e.actionsLeft > 0 ? this._enemyBestGun(e) : null;
    if (w) {
      this._payForShot(e, w);
      this._shoot(e, w, this.player);
    } else if (e.hp > 0 && e.actionsLeft > 0 && (e.heat > e.heatCap * 0.5 || e.energy < e.energyMax * 0.4)) {
      this._vent(e); // nothing worth shooting: get ready for next turn
    } else {
      this.enemyFire = null;
      this._afterEnemyTurn(ef.index);
      return;
    }
    ef.timer = G.shotGap;
    if (this.turnSystem.phase === TurnPhase.GAME_OVER) this.enemyFire = null;
  }

  /** The enemy's next shot: its hardest-hitting gun that can fire now (null when none). */
  _enemyBestGun(enemy) {
    // Overheating costs next turn: only worth it for a finishing blow
    const lethal = (w) => w.dmg * (w.fx?.burst || 1) >= this.player.hp;
    const ready = (enemy.weapons || []).filter((w) => {
      const st = this.gunStatus(enemy, w, this.player);
      return st.ok && (!st.overheats || lethal(w));
    });
    if (!ready.length) return null;
    // Ammo guns are saved for when you're below 60% HP, unless nothing else can fire
    const save = ready.length > 1 && this.player.hp > this.player.maxHp * 0.6;
    const minesDown = this.hazards.filter((h) => h.type === 'mine' && (h.owner || 'enemy') === 'enemy').length;
    const value = (w) => (w.fx?.mine ? (minesDown < 2 ? 18 : 2) : w.dmg * (w.fx?.burst || 1)) * (w.ammo && save && !w.fx?.mine ? 0.4 : 1);
    return ready.sort((a, b) => value(b) - value(a))[0];
  }

  /**
   * AI (gear): how good is landing at (x, y)? Damage its guns could deal from
   * there with the actions it would have left, minus what your guns could
   * deal back, minus hazards underfoot.
   */
  _scoreSpot(enemy, x, y, rammed, stay = false) {
    const spot = { x, y };
    const p = this.player;
    const d = Math.hypot(p.x - x, p.y - y);
    let shots = stay ? enemy.actionsLeft : enemy.actionsLeft - 1; // moving costs an action
    let score = 0;
    let energy = enemy.energy;
    let heat = enemy.heat;
    const guns = [...(enemy.weapons || [])].sort((a, b) => b.dmg - a.dmg);
    for (let round = 0; round < 2 && shots > 0; round++) {
      for (const w of guns) {
        if (shots <= 0) break;
        if (w.ammo && w.ammoLeft <= 0) continue;
        if (energy < (w.en || 0) || heat + (w.heat || 0) > enemy.heatCap) continue;
        if (d < w.range[0] || d > w.range[1]) continue;
        if (!w.arc && !this._lineClear(spot, p, 'enemy')) continue;
        score += w.dmg * (w.fx?.burst || 1) * (rammed ? G.exposedMult : 1);
        energy -= w.en || 0;
        heat += w.heat || 0;
        shots -= 1;
      }
    }
    // Out of reach: close the gap to its nearest gun band (a short-range gun must advance)
    let gap = Infinity;
    for (const w of enemy.weapons || []) {
      if (w.ammo && w.ammoLeft <= 0) continue;
      gap = Math.min(gap, Math.max(0, d - w.range[1], w.range[0] - d));
    }
    if (Number.isFinite(gap)) score -= gap * 0.04;
    // What your hardest gun could hit it with from where you stand: a mild
    // caution only, so enemies still come for you
    let threat = 0;
    for (const w of this.playerWeapons || []) {
      if (w.ammo && w.ammoLeft <= 0) continue;
      if (d < w.range[0] || d > w.range[1]) continue;
      if (!w.arc && !this._lineClear(p, spot, 'player')) continue;
      threat = Math.max(threat, w.dmg * (w.fx?.burst || 1));
    }
    score -= threat * (0.25 - 0.15 * this.aggression);
    for (const h of this.hazards) {
      if (h.type !== 'pad' && x > h.x - 10 && x < h.x + h.w + 10) score -= 30;
    }
    return score;
  }

  /** One weapon hit landing on `target`. `owner` fired it (chains/splash hop from `from`). */
  _weaponHit(from, target, w, rawDmg, owner = from) {
    soundEngine.playUI(target.team === 'player' ? 220 : 660, 0.04);
    // A rammed target takes extra gun damage
    if (target.exposed) rawDmg *= G.exposedMult;
    const type = dtypeOf(w);
    if (target.team === 'enemy') {
      // Your guns carry your ATK and crit chance
      const yours = owner === this.player;
      const critChance = (w.fx?.crit || 0) + (yours ? 0.05 + (this.rigStats?.critChance || 0) : 0);
      const crit = critChance > 0 && Math.random() < critChance;
      let dmg = rawDmg * (crit ? 1.75 : 1);
      if (yours) dmg *= this.collisionSystem.stats.playerAtk || 1;
      // Heat / Energy hits also load the reactor; past its limits, the rest spills into HP
      dmg += this._reactorFx(target, w, dmg);
      if (!w.fx?.pierce) dmg *= 1 - Math.min(CONFIG.run.maxDefCap || 15, resistOf(target, type)) * CONFIG.damage.defensePerPoint;
      dmg = Math.max(1, Math.round(dmg));
      const killed = target.takeDamage(dmg);
      target.flashTimer = 0.15;
      if (w.fx?.burn) {
        target.burnTicks = Math.max(target.burnTicks || 0, w.fx.burn);
        target.burnDmg = Math.max(target.burnDmg || 0, 6);
      }
      if (w.fx?.freeze) target.isFrozen = true;
      if (w.fx?.corrode) target.res = { ...target.res, phys: Math.max(-(target.def || 0), (target.res?.phys || 0) - w.fx.corrode) };
      if (w.fx?.leech && yours) this.player.hp = Math.min(this.player.maxHp, this.player.hp + Math.round(dmg * w.fx.leech));
      if (yours) this._reportHit(w, dmg);
      this._callout(target, `${dmg}${crit ? '!' : ''}`, DTYPES[type].color);
      this.events.emit('damage', { attacker: owner, victim: target, damage: dmg, killed, crit });
      if (killed) this._checkBattleEnd(target);
      return;
    }
    // Enemy gun hitting you: Forcefield blocks it, resists and damage reduction apply
    if (this.player.forcefield) {
      this.player.forcefield = false;
      this._callout(this.player, 'BLOCKED', '#a7f070');
      return;
    }
    const spill = this._reactorFx(this.player, w, rawDmg);
    const dmg = this.collisionSystem.calculatePlayerDamage(rawDmg + spill, { dtype: type, bypassDef: !!w.fx?.pierce });
    const killed = this.player.takeDamage(dmg);
    this.player.flashTimer = 0.15;
    if (w.fx?.leech && owner.hp > 0) owner.hp = Math.min(owner.maxHp, owner.hp + Math.round(dmg * w.fx.leech));
    if (w.fx?.burn) {
      this.player.burnTicks = Math.max(this.player.burnTicks || 0, w.fx.burn);
      this.player.burnDmg = Math.max(this.player.burnDmg || 0, 6);
    }
    if (w.fx?.freeze) this.player.isFrozen = true;
    if (w.fx?.corrode) {
      const r = this.player.res;
      r.phys = Math.max(-(this.collisionSystem.stats.playerTotalDef || 0), (r.phys || 0) - w.fx.corrode);
    }
    this._callout(this.player, `${dmg}`, DTYPES[type].color);
    // (the 'damage' handler counts it as damage taken and tells the run)
    this.events.emit('damage', { attacker: owner, victim: this.player, damage: dmg, killed });
    if (killed) this._checkBattleEnd(this.player);
  }

  /** Battle report: damage per gun, best hit. */
  _reportHit(w, dmg) {
    const r = this.battleStats.report;
    r.dealt += dmg;
    r.byGun[w.name] = (r.byGun[w.name] || 0) + dmg;
  }

  /**
   * Heat guns pump heat into the target, Energy guns drain its energy (half
   * the hit, or the gun's own fx amount). Heat past the cap, or a drain
   * deeper than the tank holds, spills over: returns the extra HP damage.
   */
  _reactorFx(target, w, dmg) {
    const type = dtypeOf(w);
    let spill = 0;
    if (target.energy !== undefined && (type === 'energy' || w.fx?.drain)) {
      const want = Math.round(w.fx?.drain ?? dmg * G.dtypeLoad);
      const before = target.energy;
      target.energy = Math.max(0, target.energy - want);
      spill += (want - (before - target.energy)) * G.dtypeSpill;
      if (before > target.energy) this._callout(target, `-${before - target.energy} EN`, DTYPES.energy.color);
    }
    if (target.heat !== undefined && (type === 'heat' || w.fx?.heat)) {
      const add = Math.round(w.fx?.heat ?? dmg * G.dtypeLoad);
      const over = Math.max(0, target.heat + add - target.heatCap) - Math.max(0, target.heat - target.heatCap);
      target.heat += add;
      spill += over * G.dtypeSpill;
      this._callout(target, target.heat > target.heatCap ? 'OVERHEATED' : `+${add} HEAT`, DTYPES.heat.color);
    }
    return spill;
  }

  _callout(ball, text, color) {
    if (ball) this.renderer.addCallout(ball, text, color);
  }

  /** End the current enemy's turn without it shooting (no-op once the battle is over). */
  _passEnemyTurn() {
    if (this.turnSystem.phase === TurnPhase.GAME_OVER || !this.running) return;
    this.events.emit('turn-end', { playerTurn: false });
  }

  _bindEvents() {
    this.events.on('proc', ({ ball, text, color, implode }) => {
      this._callout(ball, text, color);
      if (implode) this.particles.push({ type: 'implode', x: ball.x, y: ball.y, radius: 360, life: 0.4, maxLife: 0.4 });
    });

    this.events.on('enemy-plan', (plan) => this._onEnemyPlan(plan));

    // A ram EXPOSED someone (CollisionSystem): count yours for the report and medals
    this.events.on('ram', ({ attacker }) => {
      if (attacker !== this.player) return;
      this.battleStats.report.rams += 1;
      this.battleStats.track.rams += 1;
      this.renderer.addScreenShake(8);
      haptics.impact('medium');
    });

    this.events.on('place-barrier', ({ x, y }) => {
      if (!this.running) return;
      this.deployBarrierAt(x, y);
    });

    this.events.on('player-launch', ({ velocity }) => {
      if (!this.running) return;
      if (this.turnSystem.phase !== TurnPhase.PLAYER_AIM) return;
      if (!this.canPlayerMove) return;
      const legs = this.player.legs;
      if (legs?.moveEn) this.player.energy -= legs.moveEn; // Thrusters
      if (legs?.freeMove && !this.battleStats.freeMoveUsed) {
        this.battleStats.freeMoveUsed = true; // Phase Striders: first move each turn is free
        this._callout(this.player, 'PHASE STEP', '#ff5d73');
      } else {
        this.player.actionsLeft -= 1; // MOVE is one action
      }
      this.player.launchedAt = performance.now(); // renderer: legs spring
      this.autoEnd = 0;
      // Frozen by an enemy Cryo Cannon: this launch is weaker
      const chill = this.player.isFrozen ? 0.65 : 1;
      if (this.player.isFrozen) {
        this.player.isFrozen = false;
        this._callout(this.player, 'FROZEN SHOT', '#73eff7');
      }
      this.player.vx = velocity.x * chill;
      this.player.vy = velocity.y * chill;
      this.slingshotInput.setActive(false);
      this._armShot();
      const speed = Math.hypot(velocity.x, velocity.y);
      this.battleStats.lastLaunchPct = speed / (CONFIG.slingshot.maxPower * this.slingshotInput.powerMult);
      if (this.battleStats.lastLaunchPct >= 0.9) this.battleStats.fullDrawThisTurn = true;
      soundEngine.playLaunch(speed / 900);
      haptics.impact(speed > 1100 ? 'medium' : 'light');
      this.turnSystem.launch();
    });

    this.events.on('enemy-launch', ({ velocity, enemyIndex }) => {
      if (!this.running) return;
      if (this.turnSystem.phase !== TurnPhase.ENEMY_AIM) return;
      const enemy = this.enemies[enemyIndex ?? this.turnSystem.enemyIndex];
      if (!enemy || enemy.hp <= 0) return;

      if (enemy.isFrozen) {
        velocity.x *= 0.65;
        velocity.y *= 0.65;
        enemy.isFrozen = false;
        this._callout(enemy, 'FROZEN SHOT', '#73eff7');
      }

      enemy.vx = velocity.x;
      enemy.vy = velocity.y;
      const speed = Math.hypot(velocity.x, velocity.y);
      soundEngine.playLaunch(speed / 900);
      this.turnSystem.launch();
    });

    this.events.on('turn-end', ({ playerTurn }) => {
      if (!this.running) return;
      if (this.turnSystem.phase === TurnPhase.GAME_OVER) return;

      if (playerTurn) {
        // A MOVE was one action; spend the rest from where you landed
        if (this.turnSystem.phase === TurnPhase.PLAYER_FLY) return this._afterPlayerMove();
        this._finishPlayerTurn();
      } else {
        const currentIdx = this.turnSystem.enemyIndex;
        const shooter = this.enemies[currentIdx];
        if (this.turnSystem.phase === TurnPhase.ENEMY_FLY && shooter?.hp > 0 && shooter.actionsLeft > 0) {
          // Gear combat: the enemy spends its remaining actions (update() paces them)
          this.turnSystem.startFire();
          this.enemyFire = { shooter, index: currentIdx, timer: G.shotGap };
          return;
        }
        if (this.turnSystem.phase === TurnPhase.GAME_OVER) return;
        this._afterEnemyTurn(currentIdx);
      }
    });

    this.events.on('damage', ({ attacker, victim, damage, killed, crit }) => {
      this._spawnHitParticles(victim.x, victim.y);
      if (attacker.team === 'player' && victim.team === 'enemy') {
        this._trackPlayerHit(victim, damage, killed, { crit });
      } else if (victim.team === 'player' && attacker === this.activeEnemy) {
        this._enemyShotHit = true;
      }
      const forceScale = Math.min(2.0, damage / 20);
      soundEngine.playImpact(forceScale);
      if (victim.team === 'player') {
        soundEngine.play('hurt');
        haptics.impact('heavy');
      } else {
        haptics.impact(damage >= 15 ? 'heavy' : 'medium');
      }
      if (damage >= 15) {
        this.renderer.addScreenShake(Math.min(16, damage * 0.5));
        this.addHitStop(0.05);
      }

      if (killed) {
        this.addHitStop(0.14);
        haptics.impact('heavy');
        soundEngine.playDefeat();
        this._spawnDefeatParticles(victim.x, victim.y, victim.color);
        this.renderer.addScreenShake(12);
      }

      if (attacker.team === 'player') {
        this.events.emit('player-dealt-damage', { victim, damage });
      } else {
        this.battleStats.playerDamageTaken += damage;
        this.events.emit('enemy-dealt-damage', { attacker, damage });
      }

      if (victim.team === 'enemy' && victim.rank && !victim.phase2 && victim.hp > 0 && victim.hp <= victim.maxHp * 0.5) {
        this._enterPhaseTwo(victim);
      }
      if (killed) {
        this._checkBattleEnd(victim);
      }
    });

    this.events.on('wall-bounce', () => soundEngine.playWallBounce());
  }

  _checkBattleEnd(victim) {
    if (this.turnSystem.phase === TurnPhase.GAME_OVER) return;

    if (this.player.hp <= 0) {
      this.winner = 'enemy';
      soundEngine.play('lose');
      this._endBattle();
      return;
    }

    // Killing the boss / mini-boss wins the fight; its reinforcements retreat
    const bosses = this.enemies.filter((e) => e.rank);
    const bossDown = bosses.length > 0 && bosses.every((e) => e.hp <= 0);
    if (this.allEnemiesDead || bossDown) {
      this.winner = 'player';
      this.events.emit('player-turn-start');
      soundEngine.playVictory();
      this._endBattle();
    }
  }

  _endBattle() {
    this.running = false;
    this.slingshotInput.setActive(false);
    this.turnSystem.gameOver(this.winner);
    this.events.emit('battle-end', {
      won: this.winner === 'player',
      nodeType: this.battleConfig.nodeType,
    });
  }

  /** Stop the battle without a winner (player retreated). Emits no battle-end. */
  abortBattle() {
    this.running = false;
    this.slingshotInput.setActive(false);
    this.turnSystem.gameOver(null);
  }

  // After a battle the result pop-up's CONTINUE button moves on. (A global
  // Enter/R hotkey used to do the same, which could skip a second move or
  // fire while typing a save code.)
  _bindKeys() {}

  update(dt) {
    dt = Math.min(dt, 0.1);
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      return;
    }

    // Watchdog: if the enemy whose turn it is died mid-turn (spikes, mines,
    // reflected damage...), hand the turn on instead of waiting forever.
    if (this.running && this.turnSystem.phase === TurnPhase.ENEMY_AIM) {
      const active = this.enemies[this.turnSystem.enemyIndex];
      if (!active || active.hp <= 0) {
        this.enemyAI.thinking = false;
        this._passEnemyTurn();
      }
    }

    this.accumulator += dt;
    while (this.accumulator >= FIXED_DT) {
      this._stepPhysics(FIXED_DT);
      this.accumulator -= FIXED_DT;
    }

    this._updateParticles(dt);

    if (this.player) this.player.update(dt);
    for (const enemy of this.enemies) enemy.update(dt);

    // Timed pulls (Singularity Core, Graviton Weaver tether)
    for (const ball of [this.player, ...this.enemies]) {
      if (!ball?.pullTo || ball.hp <= 0) continue;
      ball.pullTo.time -= dt;
      const dx = ball.pullTo.x - ball.x;
      const step = Math.sign(dx) * Math.min(Math.abs(dx), ball.pullTo.speed * dt);
      this._slide(ball, step);
      if (Math.abs(dx) < 2 || ball.pullTo.time <= 0) ball.pullTo = null;
    }

    if (!this.running) return;

    if (this.turnSystem.isPlayerTurn && this.turnSystem.isAiming && this.player) {
      this.slingshotInput.setAnchor(this.player.x, this.player.y, this.player.radius);
    }

    if (this.turnSystem.isEnemyTurn && this.turnSystem.isAiming) {
      this.enemyAI.update(dt);
    }

    this._updateProjectiles(dt);
    this._updateGearTurn(dt);

    if (this.turnSystem.isFlying) {
      const livingEnemies = this.enemies.filter((e) => e.hp > 0);
      this.turnSystem.update(dt, [this.player, ...livingEnemies]);
    }
  }

  _stepPhysics(dt) {
    const livingEnemies = this.enemies.filter((e) => e.hp > 0);
    const balls = [this.player, ...livingEnemies];

    // Moving platforms slide along x
    this.arenaTime += dt;
    for (const p of this.platforms) {
      if (p.move) p.x = p.baseX + Math.sin(this.arenaTime * p.move.speed) * p.move.amp;
    }

    // Pad plates spring back to rest; contact below squashes them again
    for (const h of this.hazards) {
      if (h.type !== 'pad') continue;
      h.compress = (h.compress || 0) * 0.8;
      h.cooldown = Math.max(0, (h.cooldown || 0) - dt);
    }
    const events = stepWorld(balls, dt, this.barriers, this.platforms, this.obstacles, this.hazards);
    this._applyHazards(balls);
    for (const evt of events) {
      if (evt.type === 'pad') {
        soundEngine.playUI(260 + Math.min(500, evt.impactSpeed / 2));
        if (evt.impactSpeed > 400) this.particles.push({ type: 'shockwave', x: evt.ball.x, y: W.groundY - 22, radius: 10, maxRadius: 60 + evt.impactSpeed / 12, life: 0.25, maxLife: 0.25 });
      }
      if (evt.type === 'wall' || evt.type === 'barrier') {
        soundEngine.playWallBounce();
        this.events.emit('wall-bounce', { ball: evt.ball });
      }
    }
    this.collisionSystem.process(events, balls);
  }

  _updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.shard) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      } else if (p.vx !== undefined) {
        // Moving particles fall under light gravity; fx (tether, bolt, rings) stay put
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.float) {
          p.vx *= 1 - 2 * dt; // steam / sparkles drift up and slow down
          p.vy *= 1 - 1.5 * dt;
        } else p.vy += 400 * dt;
      }
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  _spawnHitParticles(x, y) {
    for (let i = 0; i < 18; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 180;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 120,
        size: 2 + Math.random() * 4,
        color: ['#ffd54f', '#ff8a65', '#ffffff', '#ffecb3'][Math.floor(Math.random() * 4)],
        life: 0.4 + Math.random() * 0.5,
        maxLife: 0.9,
      });
    }
  }

  _spawnDefeatParticles(x, y, color = '#e0655c') {
    for (let i = 0; i < 30; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 120 + Math.random() * 260;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 160,
        size: 3 + Math.random() * 6,
        color: [color, '#ffffff', '#ff8a65', '#ffd54f'][Math.floor(Math.random() * 4)],
        life: 0.6 + Math.random() * 0.6,
        maxLife: 1.2,
      });
    }
  }

  // ---------- Moves and hit tracking ----------

  /** Launch: a fresh move (wall-bounce tracking for Ricochet Crest). */
  _armShot() {
    this.battleStats.wallBounced = false;
    this.slingshotInput.zeroGTime = 0;
  }

  _clearShotEffects() {
    if (!this.player) return;
    this.player.piercing = false;
    this.player.shotMult = 0;
    this.player.zeroG = 0;
  }

  /** Feedback + stats for every hit you land on an enemy. */
  _trackPlayerHit(victim, damage, killed, { crit }) {
    const t = this.battleStats.track;
    t.hits += 1;
    t.bestHit = Math.max(t.bestHit, damage);
    if (killed) {
      t.kills += 1;
      if (victim.rank) t.bossKills += 1;
    }
    if (crit) {
      t.crits += 1;
      this._callout(victim, 'CRITICAL!', '#ff5d73');
      this.renderer.addScreenShake(18);
      this.addHitStop(0.1);
      haptics.impact('heavy');
    }
  }

  /**
   * Heal the ball in battle (the Risk healing penalty applies). Returns HP gained.
   */
  _healPlayer(amount) {
    const p = this.player;
    const mult = this.run ? this.run.healMult : saveSystem.getHealingMultiplier();
    const eff = Math.max(0, Math.round(amount * mult));
    const before = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + eff);
    return p.hp - before;
  }

  render() {
    const world = {
      player: this.player,
      enemies: this.enemies,
      turnSystem: this.turnSystem,
      particles: this.particles,
      barriers: this.barriers,
      platforms: this.platforms,
      obstacles: this.obstacles,
      hazards: this.hazards,
      battleStats: this.battleStats,
      abilities: this.abilities,
      winner: this.winner,
      battleSummary: {
        kills: this.enemies.filter((e) => e.hp <= 0).length,
        turns: this.battleStats.turns,
      },
      slingshotInput: this.slingshotInput,
      playerWeapons: this.playerWeapons || [],
      playerDrones: this.playerDrones || [],
      projectiles: this.projectiles || [],
      gear: true,
      showHints: !!this.battleConfig?.showHints,
      fireTarget: this._currentTarget(),
      inspected: this.inspected && this.inspected.ball.hp > 0 ? this.inspected : null,
    };
    this.renderer.render(world);
  }

  destroy() {
    this.slingshotInput.destroy();
  }
}