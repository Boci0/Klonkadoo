// ============================================================
// Game — one battle on the lane.
//
// The lane is CONFIG.lane.size positions in a row; each side has one
// active mech on it (extra enemies wait in reserve and drop in when the
// active one falls). Turns alternate, two actions each (CONFIG.gear.actions):
//   WALK / JUMP  – move by the legs' rules (Mech.legsRules)
//   FIRE         – a gun at the enemy inside its reach; each gun once per turn
//   DEPLOY       – launch your drone (it then acts at the end of each turn)
//   VENT         – the cooldown: cool 2x your cooling; takes the rest of the turn
// END TURN passes. Heat and energy follow Super Mechs: over your heat cap
// at the start of your turn you lose the turn (cooling once); still over
// after that is a shutdown, and every point of energy drained past zero
// becomes HP damage. Enemies play by exactly the same rules.
//
// Units are Ball objects standing on a position (`pos`), so the Renderer
// draws them, their guns, drones, shots and HP panels as before.
// ============================================================

import { CONFIG } from '../config.js';
import { Events } from './Events.js';
import { setTerrain } from './Physics.js';
import { Ball } from '../entities/Ball.js';
import { CollisionSystem } from '../systems/CollisionSystem.js';
import { TurnSystem, TurnPhase } from '../systems/TurnSystem.js';
import { Renderer } from '../rendering/Renderer.js';
import { soundEngine } from '../utils/SoundEngine.js';
import { saveSystem } from '../meta/SaveSystem.js';
import { haptics } from '../platform/haptics.js';
import { getBall } from '../meta/Balls.js';
import { DEFAULT_LEGS, DTYPES, dtypeOf, resistOf, getPart, legsRules } from '../meta/Mech.js';

/** Runs saved before the lane: guns without a reach and legs without walk/jump get them from the catalog. */
const laneGun = (w) => (w.reach ? w : { ...w, reach: getPart(w.id)?.reach || [1, 3], dtype: w.dtype || getPart(w.id)?.dtype });
const laneLegs = (l) => (!l ? { ...DEFAULT_LEGS } : l.walk !== undefined || l.anchored ? l : legsRules(getPart(l.id)));

const W = CONFIG.world;
const B = CONFIG.ball;
const C = CONFIG.colors;
const G = CONFIG.gear;
const L = CONFIG.lane;

/** How a gun's shot looks in flight (see Renderer._drawProjectiles). */
export function vfxOf(w) {
  if (w.arc) return 'lob';
  if (w.fx?.pull) return 'hook';
  if (w.fx?.push || w.fx?.drain) return 'pulse';
  if (w.fx?.line || w.fx?.chain || w.fx?.pierce || w.fx?.heat) return 'beam';
  if (w.fx?.burn || w.fx?.corrode || w.fx?.freeze) return 'spray';
  return 'bullet';
}

/** World x of the centre of lane position `pos` (1..size). */
export const posX = (pos) => ((pos - 0.5) * W.width) / L.size;
/** Lane position under world x. */
export const posAt = (x) => Math.max(1, Math.min(L.size, Math.floor(x / (W.width / L.size)) + 1));

const DEFAULT_BATTLE = {
  player: { maxHp: 100, atk: 1, def: 0 },
  enemies: [{ maxHp: 100, atk: 1, def: 0, displayName: 'HOSTILE', archetype: 'standard' }],
  nodeType: 'combat',
  floor: 1,
};

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.events = new Events();
    this.renderer = new Renderer(canvas);
    this.turnSystem = new TurnSystem(this.events);
    this.collisionSystem = new CollisionSystem(this.events);

    this.player = null;
    this.enemies = []; // on the lane (the active one, plus the fallen for the report)
    this.enemyReserve = []; // waiting to drop in
    this.particles = [];
    this.projectiles = [];
    this.barriers = [];
    this.platforms = [];
    this.obstacles = [];
    this.hazards = [];
    this.winner = null;
    this.running = false;
    this.abilities = this._freshAbilities();
    this.turnId = 1;

    this._bindEvents();
    this._bindInput();
    this.reset(DEFAULT_BATTLE);
  }

  _freshBattleStats() {
    return {
      turns: 0,
      playerDamageTaken: 0,
      // Totals the run screen saves into ball / lifetime stats
      track: { kills: 0, hits: 0, bestHit: 0, crits: 0, maxCombo: 0, bossKills: 0, rams: 0, shots: 0 },
      // The end-of-battle report
      report: { dealt: 0, shots: 0, rams: 0, vents: 0, byGun: {} },
    };
  }

  /** Barrier returns in stage 3 (cover on the lane); the HUD reads this shape. */
  _freshAbilities() {
    return { barrier: { ready: false, cooldownLeft: 0, baseCooldown: CONFIG.abilities.barrier.cooldown, name: CONFIG.abilities.barrier.name, disabled: true } };
  }

  startBattle(opts = {}) {
    this.reset({
      ...opts,
      player: { ...DEFAULT_BATTLE.player, ...(opts.player || {}) },
      enemies: opts.enemies && opts.enemies.length ? opts.enemies : DEFAULT_BATTLE.enemies,
      nodeType: opts.nodeType || 'combat',
      floor: opts.floor || 1,
    });
    this.running = true;
    this._startPlayerTurn();
  }

  reset(config = DEFAULT_BATTLE) {
    this.battleConfig = config;
    this.battleStats = this._freshBattleStats();
    this.rigStats = config.rigStats || {};
    const mech = this.rigStats.mech || {};

    const ballDef = getBall('operator');
    const r = Math.round(B.radius * ballDef.radiusMult);
    this.player = new Ball({
      x: posX(L.playerStart),
      y: W.groundY - r,
      team: 'player',
      radius: r,
      color: config.skinColors?.color || ballDef.color,
      darkColor: config.skinColors?.darkColor || ballDef.darkColor,
      maxHp: config.player.maxHp || B.maxHp,
      displayName: ballDef.name,
      ballType: 'operator',
    });
    const p = this.player;
    p.pos = L.playerStart;
    p.shieldHp = config.player.shieldHp || 0;
    if (config.player.hp !== undefined) p.hp = Math.max(1, Math.min(p.maxHp, config.player.hp));
    p.legs = laneLegs(mech.legs);
    p.parts = mech.parts || null;
    p.def = config.player.totalDef ?? 0;
    p.res = { phys: 0, heat: 0, energy: 0, ...(config.player.res || {}) };
    p.forcefield = !!mech.startForcefield;
    this._initRig(p, mech.rig || G.baseRig);
    this.playerWeapons = (mech.weapons || []).map((w) => ({ ...laneGun(w), dmg: w.dmg * G.dmgScale, ammoLeft: w.ammo || 0 }));
    // Drones start docked: DEPLOY (an action) launches one for the rest of the battle
    this.playerDrones = (mech.drones || []).map((d) => ({ ...d, dmg: d.dmg ? d.dmg * G.dmgScale : d.dmg, off: true }));

    // One enemy on the lane, the rest in reserve
    const defs = (config.enemies || []).map((e) => ({ ...e }));
    this.enemies = [];
    this.enemyReserve = defs.slice(1);
    if (defs[0]) this.enemies.push(this._makeEnemy(defs[0], L.enemyStart));

    this.collisionSystem.setStats({
      playerAtk: config.player.atk ?? 1,
      playerDef: config.player.def ?? 0,
      playerTotalDef: config.player.totalDef ?? config.player.def ?? 0,
      playerRes: p.res, // same object: Acid hits strip it
      playerDamageReductionPct: config.player.damageReductionPct ?? 0,
      riskPlusDmgTaken: config.riskPlusDmgTaken || 0,
      riskDefPierce: config.riskDefPierce || 0,
      battleStats: this.battleStats,
      riskLevel: config.riskLevel || 0,
      gear: true,
    });

    // Flat lane (cover layouts arrive in stage 3)
    this.arena = { name: 'OPEN FIELD', desc: 'Nothing in the way.' };
    this.platforms = [];
    this.obstacles = [];
    this.hazards = [];
    this.barriers = [];
    W.wind = 0;
    setTerrain(null);
    this.renderer.showArenaIntro?.(this.arena);

    this.particles = [];
    this.projectiles = [];
    this.abilities = this._freshAbilities();
    this.winner = null;
    this.fireTarget = null;
    this.inspected = null;
    this.previewGun = null; // HUD: a hovered gun chip (its reach glows on the lane)
    this.hoverPos = null;
    this.moveMap = new Map(); // pos -> 'walk' | 'jump' for the player, this turn
    this.waitThen = null; // runs once shots and moves have finished
    this.waitTimer = 0;
    this.enemyThink = 0;
    this.hitStop = 0;
    this.aggression = Math.min(1, (config.riskLevel || 0) / 8);
    this.turnSystem.reset();
    this.renderer.resetBattleFx?.();
  }

  _makeEnemy(e, pos) {
    const arch = CONFIG.enemyArchetypes[e.archetype] || CONFIG.enemyArchetypes.standard;
    const b = new Ball({
      x: posX(pos),
      y: W.groundY - (e.radius || B.radius),
      team: 'enemy',
      color: arch.color || C.enemy,
      darkColor: arch.darkColor || C.enemyDark,
      maxHp: e.maxHp || B.maxHp,
      displayName: e.displayName || arch.name,
      archetype: e.archetype || 'standard',
      atk: e.atk,
      def: e.def,
      aiDifficulty: e.aiDifficulty,
      radius: e.radius,
    });
    b.pos = pos;
    b.rank = e.rank || null;
    b.weapons = (e.weapons || []).map((w) => ({ ...laneGun(w), ammoLeft: w.ammo || 0 }));
    b.legs = laneLegs(e.legs);
    b.res = { ...(e.res || {}) };
    b.parts = e.parts || null;
    this._initRig(b, e.rig || G.enemyRig[['elite', 'miniboss', 'boss'].includes(this.battleConfig.nodeType) ? this.battleConfig.nodeType : 'combat']);
    return b;
  }

  addHitStop(seconds) {
    this.hitStop = Math.max(this.hitStop || 0, seconds);
  }

  /** The enemy mech on the lane right now (null between a knock-out and the drop-in). */
  get activeEnemy() {
    return this.enemies.find((e) => e.hp > 0) || null;
  }

  get allEnemiesDead() {
    return !this.activeEnemy && this.enemyReserve.length === 0;
  }

  // ---------- Barrier (stage 3) ----------

  useAbility() {
    return false;
  }

  deployBarrierAt() {
    return false;
  }

  get playerBarrierCount() {
    return 0;
  }

  _barrierHp() {
    return CONFIG.damage.barrierHp;
  }

  _maxBarriers() {
    return CONFIG.abilities.barrier.maxActive;
  }

  // ---------- The lane ----------

  _unitAt(pos) {
    return [this.player, ...this.enemies].find((u) => u && u.hp > 0 && u.pos === pos) || null;
  }

  /**
   * Where a unit can move this turn: Map pos -> 'walk' | 'jump'. Walking goes
   * along the ground and stops at the first mech; jumping lands exactly on
   * a free position within the legs' jump band, over anything. A chill
   * (Cryo) takes 1 off both.
   */
  reachable(unit) {
    const out = new Map();
    const legs = unit.legs || DEFAULT_LEGS;
    if (legs.anchored || unit.actionsLeft <= 0) return out;
    if (legs.moveEn && unit.energy < legs.moveEn) return out;
    const chill = unit.isFrozen ? 1 : 0;
    const walk = Math.max(0, (legs.walk || 0) - chill);
    for (const dir of [-1, 1]) {
      for (let d = 1; d <= walk; d++) {
        const p = unit.pos + dir * d;
        if (p < 1 || p > L.size || this._unitAt(p)) break;
        out.set(p, 'walk');
      }
      if (legs.jump) {
        const hi = legs.jump[1] - chill;
        for (let d = legs.jump[0]; d <= hi; d++) {
          const p = unit.pos + dir * d;
          if (p < 1 || p > L.size || this._unitAt(p) || out.has(p)) continue;
          out.set(p, 'jump');
        }
      }
    }
    return out;
  }

  /** Start walking / jumping `unit` to `pos` (the move animates; the turn waits for it). */
  _moveUnit(unit, pos, how) {
    const legs = unit.legs || DEFAULT_LEGS;
    if (legs.moveEn) unit.energy -= legs.moveEn;
    const free = legs.freeMove && !unit._freeMoveUsed;
    if (free) {
      unit._freeMoveUsed = true;
      this._callout(unit, 'PHASE STEP', '#ff5d73');
    } else unit.actionsLeft -= 1;
    if (unit.isFrozen) unit.isFrozen = false;
    const steps = Math.abs(pos - unit.pos);
    unit.anim = { from: unit.x, to: posX(pos), t: 0, dur: how === 'jump' ? L.jumpTime : Math.max(0.15, steps * L.walkTime), jump: how === 'jump' };
    unit.pos = pos;
    unit.launchedAt = performance.now(); // renderer: legs spring
    soundEngine.playLaunch(how === 'jump' ? 1.1 : 0.5);
    if (unit === this.player) haptics.impact('light');
  }

  _updateAnims(dt) {
    let busy = false;
    for (const u of [this.player, ...this.enemies]) {
      if (!u?.anim) continue;
      const a = u.anim;
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      const e = a.jump ? k : k * k * (3 - 2 * k);
      u.x = a.from + (a.to - a.from) * e;
      u.y = W.groundY - u.radius - (a.jump ? L.jumpHeight * 4 * k * (1 - k) : 0);
      u.vx = Math.sign(a.to - a.from) * 200; // renderer: face the way it's going
      u.vy = a.jump ? (k < 0.5 ? -400 : 400) : 0; // renderer: legs tuck mid-air
      if (k >= 1) {
        u.anim = null;
        u.x = a.to;
        u.y = W.groundY - u.radius;
        u.vx = 0;
        u.vy = 0;
        this._arrive(u);
      } else busy = true;
    }
    return busy;
  }

  /** A unit finished moving onto its position: mines under it go off. */
  _arrive(u) {
    const mine = this.hazards.find((h) => h.type === 'mine' && h.pos === u.pos && h.owner !== u.team);
    if (!mine || u.hp <= 0) return;
    this.hazards.splice(this.hazards.indexOf(mine), 1);
    const raw = mine.dmg || 15;
    const dmg = u.team === 'player' ? this.collisionSystem.calculatePlayerDamage(raw) : Math.max(1, Math.round(raw * (1 - Math.min(15, resistOf(u, 'phys')) * CONFIG.damage.defensePerPoint)));
    const killed = u.takeDamage(dmg);
    this.particles.push({ type: 'shockwave', x: u.x, y: W.groundY, radius: 10, maxRadius: 160, life: 0.35, maxLife: 0.35 });
    this._spawnDefeatParticles(u.x, W.groundY, '#ef7d57');
    soundEngine.playDefeat();
    this.renderer.addScreenShake(14);
    this._callout(u, 'MINE!', '#ef7d57');
    this.events.emit('damage', { attacker: u.team === 'player' ? this.activeEnemy || u : this.player, victim: u, damage: dmg, killed });
  }

  /** Push (+) or pull (-) `unit` along the lane away from / toward `from`. Blocked early = +8 damage. */
  _shove(unit, from, n, color) {
    const dir = Math.sign(unit.pos - from.pos) || 1;
    const step = n > 0 ? dir : -dir;
    let to = unit.pos;
    let blocked = false;
    for (let i = 0; i < Math.abs(n); i++) {
      const next = to + step;
      if (next < 1 || next > L.size || this._unitAt(next)) {
        blocked = true;
        break;
      }
      to = next;
    }
    if (to !== unit.pos) {
      unit.anim = { from: unit.x, to: posX(to), t: 0, dur: 0.25, jump: false };
      unit.pos = to;
    }
    this._callout(unit, n > 0 ? 'KNOCKED BACK' : 'HOOKED', color);
    if (blocked && n > 0 && unit.hp > 0) {
      const slam = unit.team === 'player' ? this.collisionSystem.calculatePlayerDamage(8) : 8;
      const killed = unit.takeDamage(slam);
      this._callout(unit, `SLAMMED ${slam}`, '#f4f4f4');
      this.events.emit('damage', { attacker: from, victim: unit, damage: slam, killed });
    }
  }

  // ---------- Turn flow ----------

  /**
   * Start of a unit's turn: energy regenerates and heat cools. Over the heat
   * cap BEFORE cooling means the turn is lost (overheat); still over after
   * cooling means a shutdown (the next turn is lost too). Returns true if
   * the unit can act.
   */
  _upkeep(u) {
    u.turnNo = (u.turnNo || 0) + 1; // guns remember the turn they fired on
    u.energy = Math.min(u.energyMax, u.energy + u.regen);
    u.actionsLeft = G.actions;
    u._freeMoveUsed = false;
    const over = u.heat > u.heatCap;
    u.heat = Math.max(0, u.heat - u.cool);
    if (!over) return true;
    u.actionsLeft = 0;
    const shut = u.heat > u.heatCap;
    this._callout(u, shut ? 'SHUTDOWN: TURN LOST' : 'OVERHEATED: TURN LOST', '#ff5d73');
    this.addHitStop(0.12);
    soundEngine.play('alarm');
    if (u === this.player) haptics.impact('heavy');
    return false;
  }

  /** Burn damage at the start of a turn; returns false if it killed the unit. */
  _tickBurn(u) {
    if (!(u.burnTicks > 0)) return true;
    const raw = u.burnDmg || 6;
    const dmg = u === this.player ? this.collisionSystem.calculatePlayerDamage(raw, { bypassDef: true }) : raw;
    u.burnTicks -= 1;
    const killed = u.takeDamage(dmg);
    this._spawnHitParticles(u.x, u.y);
    this._callout(u, `BURN ${dmg}`, DTYPES.heat.color);
    const other = u === this.player ? this.activeEnemy || u : this.player;
    this.events.emit('damage', { attacker: other, victim: u, damage: dmg, killed });
    return !killed;
  }

  _startPlayerTurn() {
    if (!this.running) return;
    this.turnId += 1;
    this.turnSystem.startPlayerTurn();
    const p = this.player;
    if (!this._tickBurn(p)) return;
    const canAct = this._upkeep(p);
    this.moveMap = this.reachable(p);
    this.events.emit('player-turn-start');
    if (!canAct) this._afterAction(p, 1.1);
  }

  _startEnemyTurn() {
    if (!this.running) return;
    this.turnId += 1;
    // A knocked-out enemy's replacement drops in on the same position
    if (!this.activeEnemy && this.enemyReserve.length) this._dropIn();
    const e = this.activeEnemy;
    if (!e) return this._startPlayerTurn();
    this.turnSystem.startEnemyTurn(this.enemies.indexOf(e));
    this.moveMap = new Map();
    if (!this._tickBurn(e)) return;
    if (!this._upkeep(e)) return this._afterAction(e, 1.1);
    this.enemyThink = L.thinkTime * (1 - 0.35 * this.aggression);
  }

  _dropIn() {
    const def = this.enemyReserve.shift();
    const fallen = this.enemies.filter((x) => x.hp <= 0).pop();
    let pos = fallen ? fallen.pos : L.enemyStart;
    if (this._unitAt(pos)) pos = [L.enemyStart, L.size, L.size - 1, L.size - 2].find((q) => !this._unitAt(q)) || pos;
    const e = this._makeEnemy(def, pos);
    e.anim = { from: e.x, to: e.x, t: 0, dur: 0.6, jump: true }; // drops in with a hop
    this.enemies.push(e);
    this.renderer.showBanner(`${e.displayName} DROPS IN`, '#ff5d73');
    soundEngine.play('alarm');
    this.renderer.addScreenShake(10);
  }

  /** After an action: wait for moves and shots to finish, then (if no actions are left) pass the turn. */
  _afterAction(u, delay = L.settle) {
    this.turnSystem.phase = u === this.player ? TurnPhase.PLAYER_FLY : TurnPhase.ENEMY_FLY;
    this.moveMap = new Map();
    this.waitTimer = delay;
    this.waitThen = () => {
      if (!this.running) return;
      if (u.hp > 0 && u.actionsLeft > 0) {
        // Phase Striders' free move: act again
        if (u === this.player) {
          this.turnSystem.phase = TurnPhase.PLAYER_AIM;
          this.moveMap = this.reachable(u);
        } else {
          this.turnSystem.phase = TurnPhase.ENEMY_AIM;
          this.enemyThink = L.thinkTime * 0.5;
        }
        return;
      }
      if (u === this.player) this._endPlayerTurn();
      else this._startPlayerTurn();
    };
  }

  /** Your turn is over: deployed drones act, then the enemy goes. */
  _endPlayerTurn() {
    this.battleStats.turns += 1;
    this._gearDrones();
    this.turnSystem.phase = TurnPhase.PLAYER_FLY;
    this.waitTimer = L.settle;
    this.waitThen = () => this._startEnemyTurn();
  }

  // ---------- Player actions ----------

  get canPlayerAct() {
    return this.running && this.turnSystem.phase === TurnPhase.PLAYER_AIM && this.player.actionsLeft > 0;
  }

  get canPlayerMove() {
    return this.canPlayerAct && this.moveMap.size > 0;
  }

  movePlayerTo(pos) {
    if (!this.canPlayerAct) return false;
    const how = this.moveMap.get(pos);
    if (!how) return false;
    this._moveUnit(this.player, pos, how);
    this._afterAction(this.player, 0.15);
    return true;
  }

  firePlayerWeapon(i) {
    if (!this.canPlayerAct) return { ok: false, reason: this.player?.actionsLeft > 0 ? 'WAIT' : 'NO ACTIONS' };
    const w = this.playerWeapons[i];
    const state = this.playerGunState(i);
    if (!state.ok) return state;
    this._payForShot(this.player, w);
    this.battleStats.report.shots += 1;
    this.battleStats.track.shots += 1;
    this._shoot(this.player, w, state.target);
    this._afterAction(this.player);
    return state;
  }

  ventPlayer() {
    if (!this.canPlayerAct) return false;
    this._vent(this.player);
    this.battleStats.report.vents += 1;
    this._afterAction(this.player);
    return true;
  }

  /** Drone chip: DEPLOY costs your action; recalling is free. Returns { ok, reason }. */
  toggleDrone(i) {
    const d = this.playerDrones[i];
    if (!d || !this.running || this.turnSystem.phase !== TurnPhase.PLAYER_AIM) return { ok: false, reason: 'WAIT' };
    if (d.off) {
      if (!this.canPlayerAct) return { ok: false, reason: 'NO ACTIONS' };
      this.player.actionsLeft -= 1;
      d.off = false;
      d.deployedAt = performance.now(); // renderer: drone flies out
      this._callout(this.player, 'DRONE DEPLOYED', d.color || '#a7f070');
      this._afterAction(this.player);
    } else {
      d.off = true;
      d.deployedAt = performance.now(); // renderer: drone docks
    }
    return { ok: true };
  }

  /** END TURN: pass. */
  endPlayerTurn() {
    if (!this.running || this.turnSystem.phase !== TurnPhase.PLAYER_AIM) return false;
    this.player.actionsLeft = 0;
    this._afterAction(this.player, 0.05);
    return true;
  }

  // ---------- Guns ----------

  _initRig(u, rig) {
    u.energyMax = rig.energy;
    u.energy = rig.energy;
    u.regen = rig.regen;
    u.heatCap = rig.heatCap;
    u.heat = 0;
    u.cool = rig.cool;
    u.actionsLeft = G.actions;
  }

  _gunsOf(u) {
    return u === this.player ? this.playerWeapons || [] : u.weapons || [];
  }

  _foesOf(u) {
    if (u === this.player) return this.activeEnemy ? [this.activeEnemy] : [];
    return this.player.hp > 0 ? [this.player] : [];
  }

  distance(a, b) {
    return Math.abs(a.pos - b.pos);
  }

  /** Can this gun fire at this target right now? { ok, reason, overheats } */
  gunStatus(shooter, w, target) {
    if (!(shooter.actionsLeft > 0)) return { ok: false, reason: 'NO ACTIONS' };
    if (w.ammo && w.ammoLeft <= 0) return { ok: false, reason: 'EMPTY' };
    if (w.usedOn === shooter.turnNo) return { ok: false, reason: 'USED' };
    if (shooter.heat > shooter.heatCap) return { ok: false, reason: 'HOT' };
    if (shooter.energy < (w.en || 0)) return { ok: false, reason: 'ENERGY' };
    if (!target) return { ok: false, reason: 'NO TARGET' };
    const d = this.distance(shooter, target);
    if (d < w.reach[0]) return { ok: false, reason: 'TOO CLOSE' };
    if (d > w.reach[1]) return { ok: false, reason: 'RANGE' };
    return { ok: true, reason: '', cover: false, overheats: shooter.heat + (w.heat || 0) > shooter.heatCap };
  }

  _currentTarget() {
    return this.activeEnemy;
  }

  setFireTarget() {}

  /** HUD: what a gun would do right now ({ ok, reason, target, dmg, overheats }). */
  playerGunState(i) {
    const w = this.playerWeapons[i];
    if (!w || !this.player) return { ok: false, reason: '' };
    const target = this.activeEnemy;
    const st = this.gunStatus(this.player, w, target);
    return { ...st, target, dmg: target ? this._previewDamage(w, target) : 0 };
  }

  _previewDamage(w, target) {
    let dmg = w.dmg * (w.fx?.burst || 1) * (this.collisionSystem.stats.playerAtk || 1);
    if (!w.fx?.pierce) dmg *= 1 - Math.min(CONFIG.run.maxDefCap || 15, resistOf(target, dtypeOf(w))) * CONFIG.damage.defensePerPoint;
    return Math.max(1, Math.round(dmg));
  }

  _payForShot(shooter, w) {
    shooter.energy -= w.en || 0;
    shooter.heat += w.heat || 0;
    if (w.ammo) w.ammoLeft -= 1;
    w.usedOn = shooter.turnNo; // each gun once per turn
    shooter.actionsLeft -= 1;
  }

  /** VENT (the cooldown): cool 2x your cooling; it takes the rest of your turn. */
  _vent(u) {
    const cooled = Math.min(u.heat, u.cool * G.vent.coolMult);
    u.heat -= cooled;
    u.actionsLeft = 0;
    for (let i = 0; i < 16; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      const sp = 90 + Math.random() * 160;
      this.particles.push({ x: u.x + (Math.random() - 0.5) * u.radius, y: u.y - u.radius * 0.5, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, float: true, size: 6 + Math.random() * 8, color: i % 3 ? '#dfe6ee' : '#73eff7', life: 0.7, maxLife: 0.7 });
    }
    this.particles.push({ type: 'shockwave', x: u.x, y: u.y, radius: 10, maxRadius: 90, life: 0.35, maxLife: 0.35 });
    soundEngine.playUI(330);
    this._callout(u, `VENT -${Math.round(cooled)} HEAT`, '#73eff7');
  }

  /** One gun firing at one target: queues its projectile(s); hits land on arrival. */
  _shoot(shooter, w, target) {
    const kind = vfxOf(w);
    w.firedAt = performance.now(); // renderer: recoil + muzzle flash
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
    for (let i = 0; i < rounds; i++) {
      this.projectiles.push({
        kind,
        color: w.color || '#f4f4f4',
        x0: from.x,
        y0: from.y,
        target,
        t: -i * 0.09,
        dur,
        last: i === rounds - 1,
        onHit: (last) => this._landShot(shooter, w, target, last),
      });
    }
    soundEngine.playUI(kind === 'lob' ? 180 : kind === 'beam' ? 880 : 520, 0.05);
    if (shooter === this.player) haptics.impact(kind === 'lob' || w.dmg > 60 ? 'medium' : 'light');
  }

  _updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.t += dt;
      if (p.t < p.dur) continue;
      this.projectiles.splice(i, 1);
      if (this.turnSystem.phase !== TurnPhase.GAME_OVER && p.target.hp > 0) p.onHit(p.last);
    }
  }

  /** A projectile arrived: the hit, and on the last round the gun's effects. */
  _landShot(shooter, w, target, last) {
    if (w.fx?.mine) return this._plantMine(shooter, target, w);
    if (target.hp > 0) this._weaponHit(shooter, target, w, w.dmg);
    if (!last || this.turnSystem.phase === TurnPhase.GAME_OVER || target.hp <= 0) return;
    if (w.fx?.push) this._shove(target, shooter, w.fx.push, w.color);
    if (w.fx?.pull) this._shove(target, shooter, -w.fx.pull, w.color);
  }

  /** Mine Launcher: a mine on a free position next to the target (their side of it first). */
  _plantMine(shooter, target, w) {
    const dir = Math.sign(target.pos - shooter.pos) || 1;
    const spot = [target.pos + dir, target.pos - dir].find((q) => q >= 1 && q <= L.size && !this._unitAt(q) && !this.hazards.some((h) => h.type === 'mine' && h.pos === q));
    if (!spot) return this._callout(shooter, 'NO ROOM FOR A MINE', '#94b0c2');
    this.hazards.push({ type: 'mine', pos: spot, x: posX(spot) - 24, w: 48, armed: true, born: performance.now(), owner: shooter.team, dmg: w.dmg });
    this.particles.push({ type: 'shockwave', x: posX(spot), y: W.groundY, radius: 6, maxRadius: 60, life: 0.3, maxLife: 0.3 });
    soundEngine.playUI(300);
    this._callout(shooter, 'MINE PLANTED', '#ef7d57');
  }

  /**
   * One hit on `target`. HP damage goes through resists; Heat guns also add
   * heat (never HP), Energy guns drain energy, and a drain past zero hits HP 1:1.
   */
  _weaponHit(from, target, w, rawDmg, owner = from) {
    soundEngine.playUI(target.team === 'player' ? 220 : 660, 0.04);
    const type = dtypeOf(w);
    const color = DTYPES[type].color;
    if (target.team === 'enemy') {
      const yours = owner === this.player;
      const critChance = (w.fx?.crit || 0) + (yours ? 0.05 + (this.rigStats?.critChance || 0) : 0);
      const crit = critChance > 0 && Math.random() < critChance;
      let dmg = rawDmg * (crit ? 1.75 : 1);
      if (yours) dmg *= this.collisionSystem.stats.playerAtk || 1;
      if (!w.fx?.pierce) dmg *= 1 - Math.min(CONFIG.run.maxDefCap || 15, resistOf(target, type)) * CONFIG.damage.defensePerPoint;
      dmg = Math.max(1, Math.round(dmg)) + this._reactorFx(target, w, rawDmg);
      const killed = target.takeDamage(dmg);
      if (w.fx?.burn) {
        target.burnTicks = Math.max(target.burnTicks || 0, w.fx.burn);
        target.burnDmg = Math.max(target.burnDmg || 0, 6);
      }
      if (w.fx?.freeze) target.isFrozen = true;
      if (w.fx?.corrode) target.res = { ...target.res, phys: Math.max(-(target.def || 0), (target.res?.phys || 0) - w.fx.corrode) };
      if (w.fx?.leech && yours) this.player.hp = Math.min(this.player.maxHp, this.player.hp + Math.round(dmg * w.fx.leech));
      if (yours) this._reportHit(w, dmg);
      this._callout(target, `${dmg}${crit ? '!' : ''}`, color);
      this.events.emit('damage', { attacker: owner, victim: target, damage: dmg, killed, crit });
      return;
    }
    if (this.player.forcefield) {
      this.player.forcefield = false;
      this._callout(this.player, 'BLOCKED', '#a7f070');
      return;
    }
    const dmg = this.collisionSystem.calculatePlayerDamage(rawDmg, { dtype: type, bypassDef: !!w.fx?.pierce }) + this._reactorFx(this.player, w, rawDmg);
    const killed = this.player.takeDamage(dmg);
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
    this._callout(this.player, `${dmg}`, color);
    this.events.emit('damage', { attacker: owner, victim: this.player, damage: dmg, killed });
  }

  /**
   * Heat guns add heat to the target (the gun's own amount, or half the hit);
   * heat never touches HP. Energy guns drain energy the same way; whatever
   * the tank can't cover comes off HP 1:1. Returns that extra HP damage.
   */
  _reactorFx(target, w, dmg) {
    const type = dtypeOf(w);
    let extra = 0;
    if (type === 'heat' || w.fx?.heat) {
      const add = Math.round(w.fx?.heat ?? dmg * G.dtypeLoad);
      target.heat += add;
      this._callout(target, target.heat > target.heatCap ? 'OVERHEATING' : `+${add} HEAT`, DTYPES.heat.color);
    }
    if (type === 'energy' || w.fx?.drain) {
      const want = Math.round(w.fx?.drain ?? dmg * G.dtypeLoad);
      const took = Math.min(target.energy, want);
      target.energy -= took;
      extra = want - took;
      if (took) this._callout(target, `-${took} EN`, DTYPES.energy.color);
      if (extra) this._callout(target, `ENERGY BREAK ${extra}`, '#ff5d73');
    }
    return extra;
  }

  _reportHit(w, dmg) {
    const r = this.battleStats.report;
    r.dealt += dmg;
    r.byGun[w.name] = (r.byGun[w.name] || 0) + dmg;
  }

  // ---------- Drones ----------

  /** Deployed drones act at the end of your turn, paying their energy. */
  _gearDrones() {
    const D = G.drone;
    for (const d of this.playerDrones) {
      if (d.off) continue;
      const en = d.heal ? D.healEn : d.forcefieldEvery ? D.shieldEn : D.dmgEn;
      const heat = d.dmg ? D.dmgHeat : 0;
      if (d.forcefieldEvery && (this.player.forcefield || this.battleStats.turns % d.forcefieldEvery !== 0)) continue;
      if (d.heal && this.player.hp >= this.player.maxHp) continue;
      if (d.dmg && !this.activeEnemy) continue;
      if (this.player.energy < en) {
        this._callout(this.player, 'DRONE: NO POWER', '#94b0c2');
        continue;
      }
      this.player.energy -= en;
      this.player.heat += heat;
      this._droneAct(d);
      if (this.turnSystem.phase === TurnPhase.GAME_OVER) return;
    }
  }

  _droneAct(d) {
    const shooter = this.player;
    if (d.heal) {
      const before = shooter.hp;
      d.firedAt = performance.now();
      shooter.hp = Math.min(shooter.maxHp, shooter.hp + Math.round(d.heal));
      if (shooter.hp > before) this._callout(shooter, `REPAIR +${shooter.hp - before}`, d.color);
      this._spawnHealSparkles(shooter);
    } else if (d.forcefieldEvery) {
      d.firedAt = performance.now();
      shooter.forcefield = true;
      this._callout(shooter, 'DRONE SHIELD', d.color);
    } else if (d.dmg) {
      const target = this.activeEnemy;
      if (!target) return;
      d.firedAt = performance.now();
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

  _spawnHealSparkles(u) {
    for (let i = 0; i < 10; i++) {
      this.particles.push({ x: u.x + (Math.random() - 0.5) * u.radius * 2, y: u.y, vx: 0, vy: -90 - Math.random() * 80, float: true, size: 4, color: '#a7f070', life: 0.6, maxLife: 0.6 });
    }
  }

  // ---------- Enemy (stage 1: simple and fair; the look-ahead search is stage 2) ----------

  _enemyAct(e) {
    if (!this.running || e.hp <= 0) return;
    const gun = this._enemyBestGun(e);
    if (gun) {
      this._payForShot(e, gun);
      this._shoot(e, gun, this.player);
      return this._afterAction(e);
    }
    // Too hot to shoot well next turn: cool down (a whole turn, so only at its start)
    if (e.heat > e.heatCap * 0.7 && e.actionsLeft === G.actions) {
      this._vent(e);
      return this._afterAction(e);
    }
    const moves = this.reachable(e);
    const here = this._scorePos(e, e.pos);
    let best = null;
    for (const [pos, how] of moves) {
      const s = this._scorePos(e, pos) - (how === 'jump' ? 0.5 : 0);
      if (s > here + 1 && (!best || s > best.s)) best = { pos, how, s };
    }
    if (best) {
      this._moveUnit(e, best.pos, best.how);
      return this._afterAction(e, 0.15);
    }
    if (e.heat > e.heatCap * 0.4 && e.actionsLeft === G.actions) this._vent(e);
    else e.actionsLeft = 0;
    this._afterAction(e);
  }

  /** The enemy's shot this turn: its hardest hit that can fire (overheating only to finish you off). */
  _enemyBestGun(e) {
    const p = this.player;
    const lethal = (w) => w.dmg * (w.fx?.burst || 1) >= p.hp;
    const ready = (e.weapons || []).filter((w) => {
      const st = this.gunStatus(e, w, p);
      return st.ok && (!st.overheats || lethal(w));
    });
    if (!ready.length) return null;
    const save = ready.length > 1 && p.hp > p.maxHp * 0.6; // keep ammo guns for later
    const minesDown = this.hazards.filter((h) => h.type === 'mine' && h.owner === 'enemy').length;
    const value = (w) => (w.fx?.mine ? (minesDown < 2 ? 18 : 2) : w.dmg * (w.fx?.burst || 1)) * (w.ammo && save && !w.fx?.mine ? 0.4 : 1);
    return ready.sort((a, b) => value(b) - value(a))[0];
  }

  /** How good standing on `pos` is: its guns in reach of you, yours not in reach of it. */
  _scorePos(e, pos) {
    const d = Math.abs(pos - this.player.pos);
    let score = 0;
    let gap = Infinity;
    for (const w of e.weapons || []) {
      if (w.ammo && w.ammoLeft <= 0) continue;
      if (d >= w.reach[0] && d <= w.reach[1]) score += w.dmg * (w.fx?.burst || 1);
      gap = Math.min(gap, Math.max(0, d - w.reach[1], w.reach[0] - d));
    }
    if (Number.isFinite(gap)) score -= gap * 4;
    let threat = 0;
    for (const w of this.playerWeapons || []) {
      if (w.ammo && w.ammoLeft <= 0) continue;
      if (d >= w.reach[0] && d <= w.reach[1]) threat = Math.max(threat, w.dmg * (w.fx?.burst || 1));
    }
    score -= threat * (0.3 - 0.2 * this.aggression);
    if (this.hazards.some((h) => h.type === 'mine' && h.pos === pos && h.owner !== 'enemy')) score -= 40;
    return score;
  }

  // ---------- Input: tap a lit plate to move, tap a mech to inspect ----------

  _bindInput() {
    let down = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || !this.running) return;
      const w = this.renderer.clientToWorld(e.clientX, e.clientY);
      this.hoverPos = w.y > W.groundY - 220 && w.y < W.groundY + 60 ? posAt(w.x) : null;
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.hoverPos = null;
    });
    this.canvas.addEventListener('pointerup', (e) => {
      if (!down || !this.running) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = performance.now() - down.t < 500;
      down = null;
      if (moved > 12 || !quick) return;
      // HP panels (screen space) first: tapping one inspects that mech
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const panel = (this.renderer.panelHits || []).find((q) => q.ball.hp > 0 && sx >= q.x && sx <= q.x + q.w && sy >= q.y && sy <= q.y + q.h);
      if (panel) {
        this.inspected = this.inspected?.ball === panel.ball ? null : { ball: panel.ball };
        return;
      }
      const w = this.renderer.clientToWorld(e.clientX, e.clientY);
      const onLane = w.y > W.groundY - 260 && w.y < W.groundY + 80;
      const pos = posAt(w.x);
      if (onLane && this.moveMap.has(pos) && this.canPlayerAct) {
        this.inspected = null;
        this.movePlayerTo(pos);
        return;
      }
      const hit = [this.player, ...this.enemies].find((b) => b && b.hp > 0 && Math.abs(b.x - w.x) < W.width / L.size / 2 && onLane);
      this.inspected = hit && this.inspected?.ball !== hit ? { ball: hit } : null;
    });
  }

  inspectWeapon(index) {
    const same = this.inspected?.ball === this.player && this.inspected.weapon === index;
    this.inspected = same ? null : { ball: this.player, weapon: index };
  }

  // ---------- Events, battle end ----------

  _callout(ball, text, color) {
    if (ball) this.renderer.addCallout(ball, text, color);
  }

  _bindEvents() {
    this.events.on('damage', ({ attacker, victim, damage, killed, crit }) => {
      this._spawnHitParticles(victim.x, victim.y);
      if (attacker?.team === 'player' && victim.team === 'enemy') this._trackPlayerHit(victim, damage, killed, { crit });
      soundEngine.playImpact(Math.min(2.0, damage / 20));
      if (victim.team === 'player') {
        soundEngine.play('hurt');
        haptics.impact('heavy');
      } else haptics.impact(damage >= 15 ? 'heavy' : 'medium');
      if (damage >= 15) {
        this.renderer.addScreenShake(Math.min(16, damage * 0.5));
        this.addHitStop(0.05);
      }
      if (killed) {
        this.addHitStop(0.14);
        soundEngine.playDefeat();
        this._spawnDefeatParticles(victim.x, victim.y, victim.color);
        this.renderer.addScreenShake(12);
      }
      if (victim.team === 'enemy') this.events.emit('player-dealt-damage', { victim, damage });
      else {
        this.battleStats.playerDamageTaken += damage;
        this.events.emit('enemy-dealt-damage', { attacker, damage });
      }
      if (killed) this._checkBattleEnd();
    });
  }

  _checkBattleEnd() {
    if (this.turnSystem.phase === TurnPhase.GAME_OVER) return;
    if (this.player.hp <= 0) {
      this.winner = 'enemy';
      soundEngine.play('lose');
      return this._endBattle();
    }
    if (this.allEnemiesDead) {
      this.winner = 'player';
      soundEngine.playVictory();
      this._endBattle();
    }
  }

  _endBattle() {
    this.running = false;
    this.waitThen = null;
    this.moveMap = new Map();
    this.turnSystem.gameOver(this.winner);
    this.events.emit('battle-end', { won: this.winner === 'player', nodeType: this.battleConfig.nodeType });
  }

  /** Stop the battle without a winner (player retreated). Emits no battle-end. */
  abortBattle() {
    this.running = false;
    this.waitThen = null;
    this.turnSystem.gameOver(null);
  }

  // ---------- Frame ----------

  update(dt) {
    dt = Math.min(dt, 0.1);
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      return;
    }
    this._updateParticles(dt);
    for (const u of [this.player, ...this.enemies]) u?.update(dt);
    const moving = this._updateAnims(dt);
    this._updateProjectiles(dt);
    if (!this.running) return;

    // Enemy thinking, then acting
    if (this.turnSystem.phase === TurnPhase.ENEMY_AIM && !moving) {
      this.enemyThink -= dt;
      if (this.enemyThink <= 0) {
        this.turnSystem.phase = TurnPhase.ENEMY_FLY;
        this._enemyAct(this.activeEnemy);
      }
    }
    // An action resolving: wait for moves and shots, then continue
    if (this.waitThen && !moving && !this.projectiles.length) {
      this.waitTimer -= dt;
      if (this.waitTimer <= 0) {
        const next = this.waitThen;
        this.waitThen = null;
        next();
      }
    }
  }

  _updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.vx !== undefined) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.float) {
          p.vx *= 1 - 2 * dt;
          p.vy *= 1 - 1.5 * dt;
        } else p.vy += 400 * dt;
      }
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  _spawnHitParticles(x, y) {
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 80 + Math.random() * 180;
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, size: 2 + Math.random() * 4, color: ['#ffd54f', '#ff8a65', '#ffffff', '#ffecb3'][Math.floor(Math.random() * 4)], life: 0.4 + Math.random() * 0.5, maxLife: 0.9 });
    }
  }

  _spawnDefeatParticles(x, y, color = '#e0655c') {
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 120 + Math.random() * 260;
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 160, size: 3 + Math.random() * 6, color: [color, '#ffffff', '#ff8a65', '#ffd54f'][Math.floor(Math.random() * 4)], life: 0.6 + Math.random() * 0.6, maxLife: 1.2 });
    }
  }

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
    }
  }

  /** Heal in battle (the Risk healing penalty applies). Returns HP gained. */
  _healPlayer(amount) {
    const p = this.player;
    const mult = this.run ? this.run.healMult : saveSystem.getHealingMultiplier();
    const before = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + Math.max(0, Math.round(amount * mult)));
    return p.hp - before;
  }

  render() {
    this.renderer.render({
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
      battleSummary: { kills: this.enemies.filter((e) => e.hp <= 0).length, turns: this.battleStats.turns },
      slingshotInput: null,
      playerWeapons: this.playerWeapons || [],
      playerDrones: this.playerDrones || [],
      projectiles: this.projectiles,
      gear: true,
      showHints: !!this.battleConfig?.showHints,
      fireTarget: this.activeEnemy,
      inspected: this.inspected && this.inspected.ball.hp > 0 ? this.inspected : null,
      lane: {
        size: L.size,
        moves: this.turnSystem.phase === TurnPhase.PLAYER_AIM ? this.moveMap : null,
        hover: this.hoverPos,
        previewGun: this.previewGun,
      },
    });
  }

  destroy() {}
}
