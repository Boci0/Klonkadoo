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
import { Ball } from '../entities/Ball.js';
import { CollisionSystem } from '../systems/CollisionSystem.js';
import { TurnSystem, TurnPhase } from '../systems/TurnSystem.js';
import { Renderer } from '../rendering/Renderer.js';
import { planTurn } from '../ai/LaneAI.js';
import { soundEngine } from '../utils/SoundEngine.js';
import { saveSystem } from '../meta/SaveSystem.js';
import { haptics } from '../platform/haptics.js';
import { getBall } from '../meta/Balls.js';
import { DEFAULT_LEGS, DTYPES, dtypeOf, resistOf, getPart, legsRules, droneUpkeep } from '../meta/Mech.js';
import { pickArena } from './Arenas.js';

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

/** A Charge Booster ram as a hit: Physical. */
const RAM_GUN = { id: 'ram', name: 'RAM', dtype: 'phys', fx: {} };
const EXECUTE_MULT = 1.8; // Breacher: damage x this against a target under its execute line

/** STOMP as a hit: Physical, from the legs. */
const STOMP_GUN = { id: 'stomp', name: 'STOMP', dtype: 'phys', fx: {} };
const stompGun = (legs) => ({ ...STOMP_GUN, dtype: legs?.stompType || 'phys' });

/** On-screen size by frame: heavier frames stand bigger on the lane. */
const MECH_R = 32;
const FRAME_SIZE = { fr_scout: 0.9, fr_phantom: 0.95, fr_conduit: 0.95, fr_brawler: 1, fr_furnace: 1.05, fr_titan: 1.1, fr_reclaimer: 1.15, fr_colossus: 1.2, fr_leviathan: 1.28 };
export const mechRadius = (parts) => Math.round(MECH_R * (FRAME_SIZE[(parts || []).find((id) => FRAME_SIZE[id])] || 1));

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

  /** No special abilities: everything a mech does comes from its parts (BARRIER was removed in 2.0.1). */
  _freshAbilities() {
    return {};
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

    // The team: mech 1 plus up to 2 more from the garage (config.team). One
    // fights at a time; SWAP (the whole turn) or a knock-out brings in another.
    this.team = [
      this._memberFrom({ ...config.player, rigStats: this.rigStats }, 0),
      ...(config.team || []).map((t, i) => this._memberFrom(t, i + 1)),
    ];
    this.teamIndex = -1;
    // Knocked-out mechs sit the fight out: the first one standing starts
    this._loadMember(Math.max(0, this.team.findIndex((m) => m.hp > 0)));

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

    // The arena: spike plates and neutral mines (core/Arenas.js); no walls
    this.arena = config.arena || pickArena(config.floor || 1);
    this.platforms = [];
    this.obstacles = [];
    this.hazards = [
      ...this.arena.spikes.map((pos) => ({ type: 'spikes', pos, x: posX(pos) - W.width / L.size / 2 + 6, w: W.width / L.size - 12 })),
      ...this.arena.mines.map((pos) => ({ type: 'mine', pos, x: posX(pos) - 24, w: 48, armed: true, born: 0, owner: 'arena', dmg: 30 })),
    ];
    W.wind = 0;
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
      y: W.groundY - mechRadius(e.parts),
      team: 'enemy',
      color: arch.color || C.enemy,
      darkColor: arch.darkColor || C.enemyDark,
      maxHp: e.maxHp || B.maxHp,
      displayName: e.displayName || arch.name,
      archetype: e.archetype || 'standard',
      atk: e.atk,
      def: e.def,
      aiDifficulty: e.aiDifficulty,
      radius: mechRadius(e.parts),
    });
    b.pos = pos;
    b.rank = e.rank || null;
    b.element = e.element || null; // its damage type (Mech.ENEMY_LOADOUTS)
    b.weapons = (e.weapons || []).map((w) => ({ ...laneGun(w), ammoLeft: w.ammo || 0 }));
    b.specials = (e.specials || []).map((sp) => ({ ...sp, usesLeft: sp.uses }));
    // Enemy drones launch on their first turn (it costs them an action, like yours)
    b.drones = (e.drones || []).map((d) => ({ ...d, off: !e.droneOut }));
    b.forcefield = !!e.startForcefield;
    b.legs = laneLegs(e.legs);
    const floor = Math.max(1, Math.min(5, this.battleConfig.floor || 1));
    // (a bit softer than yours: the planner stomps every time it's next to you)
    b.stompDmg = (b.legs.stomp || 0) * G.dmgScale * G.enemyDmgScale * 0.75 * (1 + 0.1 * (floor - 1));
    b.res = { ...(e.res || {}) };
    b.parts = e.parts || null;
    this._initRig(b, e.rig || G.enemyRig[['elite', 'miniboss', 'boss'].includes(this.battleConfig.nodeType) ? this.battleConfig.nodeType : 'combat']);
    // Operation conditions hit every mech
    if (this.battleConfig.condition === 'overcharged') b.regen += 5;
    if (this.battleConfig.condition === 'heatwave') b.cool = Math.max(1, b.cool - 5);
    return b;
  }

  // ---------- The player's team ----------

  /** One team mech's battle record from its run stats ({ rigStats, hp, maxHp, atk, def, totalDef, res }). */
  _memberFrom(src, index) {
    const mech = src.rigStats?.mech || {};
    const maxHp = src.maxHp || B.maxHp;
    const cfg = this.battleConfig;
    const legs = { ...laneLegs(mech.legs) };
    if (!legs.anchored && cfg.walkBonus) legs.walk = (legs.walk || 0) + cfg.walkBonus; // Swift Loader
    const rig = { ...(mech.rig || G.baseRig) };
    if (cfg.condition === 'overcharged') rig.regen += 5;
    if (cfg.condition === 'heatwave') rig.cool = Math.max(1, rig.cool - 5);
    const reachUp = cfg.reachBonus || 0; // Long Barrel
    return {
      index,
      name: `MECH ${index + 1}`,
      rigStats: src.rigStats || {},
      maxHp,
      hp: src.hp !== undefined ? Math.max(0, Math.min(maxHp, src.hp)) : maxHp,
      atk: src.atk ?? 1,
      def: src.def ?? 0,
      totalDef: src.totalDef ?? src.def ?? 0,
      res: { phys: 0, heat: 0, energy: 0, ...(src.res || {}) },
      legs,
      stompDmg: (legs.stomp || 0) * G.dmgScale,
      parts: mech.parts || null,
      forcefield: !!mech.startForcefield,
      energyMax: rig.energy,
      energy: rig.energy,
      regen: rig.regen,
      heatCap: rig.heatCap,
      heat: 0,
      cool: rig.cool,
      weapons: (mech.weapons || []).map((w) => {
        const g = laneGun(w);
        return { ...g, reach: [g.reach[0], Math.min(L.size - 1, g.reach[1] + reachUp)], dmg: w.dmg * G.dmgScale, backfire: (w.backfire || 0) * G.dmgScale, ammoLeft: w.ammo || 0 };
      }),
      freeShot: !!mech.freeFirstShot, // Phantom frame: the first gun fired costs no energy
      // Drones start docked: DEPLOY (an action) launches one for the rest of the battle
      drones: (mech.drones || []).map((d) => ({ ...d, dmg: d.dmg ? d.dmg * G.dmgScale : d.dmg, off: true })),
      specials: (mech.specials || []).map((sp) => ({ ...sp, ram: (sp.ram || 0) * G.dmgScale, usesLeft: sp.uses })),
      burnTicks: 0,
      burnDmg: 0,
      isFrozen: false,
    };
  }

  static MEMBER_FIELDS = ['maxHp', 'hp', 'def', 'res', 'legs', 'stompDmg', 'parts', 'forcefield', 'energyMax', 'energy', 'regen', 'heatCap', 'heat', 'cool', 'burnTicks', 'burnDmg', 'isFrozen', 'coolLost', 'regenLost', 'jamNext', 'jammed'];

  /** Put the active mech's state back into its team record. */
  _saveMember() {
    const m = this.team[this.teamIndex];
    if (!m) return;
    for (const f of Game.MEMBER_FIELDS) m[f] = this.player[f];
    m.def = this.player.def;
  }

  /** Make team mech `i` the one on the lane (same Ball, same position). */
  _loadMember(i) {
    this._saveMember();
    const m = this.team[i];
    const p = this.player;
    this.teamIndex = i;
    for (const f of Game.MEMBER_FIELDS) p[f] = m[f];
    p.def = m.totalDef;
    p.displayName = m.name;
    p.radius = mechRadius(m.parts);
    p.y = W.groundY - p.radius;
    p.actionsLeft = 0;
    this.rigStats = m.rigStats;
    this.playerWeapons = m.weapons;
    this.playerDrones = m.drones;
    this.playerSpecials = m.specials || [];
    this.teleportPick = null;
    if (this.collisionSystem.stats) {
      this.collisionSystem.stats.playerAtk = m.atk;
      this.collisionSystem.stats.playerDef = m.def;
      this.collisionSystem.stats.playerTotalDef = m.totalDef;
      this.collisionSystem.stats.playerRes = p.res; // same object: Acid hits strip it
    }
  }

  /** Team mechs that could come in now. */
  get benchReady() {
    return this.team.filter((m, i) => i !== this.teamIndex && m.hp > 0);
  }

  /** HP of every team mech (by team index) for the run to keep. */
  teamHp() {
    this._saveMember();
    return this.team.map((m) => (m.hp > 0 ? Math.ceil(m.hp) : 0)); // a sliver of HP still counts as standing
  }

  /** A team mech drops onto the active one's position (after a SWAP or a knock-out). */
  _playerDropIn(i, why) {
    this._loadMember(i);
    const p = this.player;
    p.x = posX(p.pos);
    p.anim = { from: p.x, to: p.x, t: 0, dur: 0.6, jump: true };
    this.projectiles = this.projectiles.filter((pr) => pr.target !== p); // shots at the old mech are gone
    this.renderer.forgetHp(p); // a different mech: its HP isn't damage or healing
    this.renderer.showBanner(`${p.displayName} ${why}`, '#41a6f6');
    soundEngine.playDropIn();
    this.renderer.addScreenShake(8);
  }

  /** SWAP: another team mech takes over. It costs the whole turn. */
  swapPlayer(i) {
    const m = this.team[i];
    if (!this.canPlayerAct || this.player.actionsLeft < G.actions || !m || i === this.teamIndex || m.hp <= 0) return false;
    this._playerDropIn(i, 'SWAPS IN');
    this.player.actionsLeft = 0;
    this._afterAction(this.player, 0.7);
    return true;
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
        // Walking stops at a mech; jumping goes over it
        if (p < 1 || p > L.size || this._unitAt(p)) break;
        out.set(p, 'walk');
        // ...and at a mine that isn't yours: walking onto it sets it off (_mineStop)
        if (this.hazards.some((h) => h.type === 'mine' && h.pos === p && h.owner !== unit.team)) break;
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
    if (how === 'walk') pos = this._mineStop(unit, unit.pos, pos); // jumps fly over mines
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
    soundEngine.playMove(how, steps);
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

  /**
   * Ground movement from `from` toward `to` stops on the first live mine it
   * crosses (the mine goes off when it gets there, in _arrive). Jumps and
   * teleports skip this: they only land. Your own mines are safe to walk
   * over, but a mech that's `forced` (pushed, pulled, hooked, dragged) sets
   * off any mine, its own too.
   */
  _mineStop(u, from, to, forced = false) {
    const dir = Math.sign(to - from);
    if (!dir) return to;
    for (let q = from + dir; q !== to + dir; q += dir) {
      if (this.hazards.some((h) => h.type === 'mine' && h.pos === q && (forced || h.owner !== u.team))) return q;
    }
    return to;
  }

  /** Forced ground movement: stop on the first mine in the way, and let it hit this mech even if it's theirs. */
  _throw(u, to) {
    const stop = this._mineStop(u, u.pos, to, true);
    if (stop !== u.pos) u._thrown = true;
    return stop;
  }

  /** A unit finished moving onto its position: spikes bite, mines go off. */
  _arrive(u) {
    const thrown = !!u._thrown;
    u._thrown = false;
    if (u.hp <= 0) return;
    if (this.hazards.some((h) => h.type === 'fire' && h.pos === u.pos)) this._burnPlate(u);
    if (this.hazards.some((h) => h.type === 'spikes' && h.pos === u.pos)) {
      const dmg = u.team === 'player' ? this.collisionSystem.calculatePlayerDamage(8, { bypassDef: true }) : 8;
      const killed = u.takeDamage(dmg);
      this._spawnHitParticles(u.x, W.groundY);
      this._callout(u, 'SPIKES', '#ff5d73');
      this.events.emit('damage', { attacker: u.team === 'player' ? this.activeEnemy || u : this.player, victim: u, damage: dmg, killed });
      if (killed) return;
    }
    const mine = this.hazards.find((h) => h.type === 'mine' && h.pos === u.pos && (thrown || h.owner !== u.team));
    if (!mine) return;
    this.hazards.splice(this.hazards.indexOf(mine), 1);
    const raw = mine.dmg || 15;
    const dmg = u.team === 'player' ? this.collisionSystem.calculatePlayerDamage(raw) : Math.max(1, Math.round(raw * (1 - Math.min(15, resistOf(u, 'phys')) * CONFIG.damage.defensePerPoint)));
    const killed = u.takeDamage(dmg);
    this.particles.push({ type: 'shockwave', x: u.x, y: W.groundY, radius: 10, maxRadius: 160, life: 0.35, maxLife: 0.35 });
    this._spawnDefeatParticles(u.x, W.groundY, '#ef7d57');
    soundEngine.playExplosion();
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
    const stop = this._throw(unit, to);
    if (stop !== to) blocked = false; // it stopped on a mine, not against a wall
    to = stop;
    if (to !== unit.pos) {
      unit.anim = { from: unit.x, to: posX(to), t: 0, dur: 0.25, jump: false };
      unit.pos = to;
    }
    this._callout(unit, n > 0 ? 'KNOCKED BACK' : 'HOOKED', color);
    if (blocked && n > 0 && unit.hp > 0) {
      const slam = unit.team === 'player' ? this.collisionSystem.calculatePlayerDamage(8) : 8;
      const killed = unit.takeDamage(slam);
      this._callout(unit, 'SLAMMED', '#f4f4f4');
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
    u.bubble = 0; // a SHIELD lasts until your next turn
    u.jammed = !!u.jamNext; // Blackout Cannon: guns jam for this turn
    u.jamNext = false;
    if (u.jammed) this._callout(u, 'GUNS JAMMED', DTYPES.energy.color);
    const over = u.heat > u.heatCap;
    u.heat = Math.max(0, u.heat - u.cool);
    if (this.hazards.some((h) => h.type === 'fire' && h.pos === u.pos)) this._burnPlate(u);
    if (!over) return true;
    u.actionsLeft = 0;
    const shut = u.heat > u.heatCap;
    this._callout(u, shut ? 'SHUTDOWN: TURN LOST' : 'OVERHEATED: TURN LOST', '#ff5d73');
    this.addHitStop(0.12);
    soundEngine.playOverheat();
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
    this._callout(u, 'BURN', DTYPES.heat.color);
    const other = u === this.player ? this.activeEnemy || u : this.player;
    this.events.emit('damage', { attacker: other, victim: u, damage: dmg, killed });
    return !killed;
  }

  _startPlayerTurn() {
    if (!this.running) return;
    this.turnId += 1;
    this.turnSystem.startPlayerTurn();
    const p = this.player;
    for (const x of this.enemies) x.jammed = false; // a jam lasts one turn
    // Napalm fires burn out after their turns
    for (const h of this.hazards) if (h.type === 'fire') h.turns -= 1;
    this.hazards = this.hazards.filter((h) => h.type !== 'fire' || h.turns > 0);
    if (!this._tickBurn(p)) return;
    const canAct = this._upkeep(p);
    this.moveMap = this.reachable(p);
    this.events.emit('player-turn-start');
    if (canAct) soundEngine.playTurn(true);
    else this._afterAction(p, 1.1);
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
    this.player.jammed = false; // a jam lasts one turn
    for (const d of e.drones || []) {
      if (!d.off || e.actionsLeft <= 0) continue;
      d.off = false;
      e.actionsLeft -= 1;
      d.deployedAt = performance.now();
      this._callout(e, 'DRONE DEPLOYED', d.color || '#ff5d73');
    }
    this.enemyThink = L.thinkTime * (1 - 0.35 * this.aggression);
    soundEngine.playTurn(false);
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
    soundEngine.playDropIn();
    this.renderer.addScreenShake(10);
  }

  /** After an action: wait for moves and shots to finish, then (if no actions are left) pass the turn. */
  _afterAction(u, delay = L.settle) {
    if (!this.running || this.turnSystem.phase === TurnPhase.GAME_OVER) return; // that action ended the battle
    this.teleportPick = null;
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
      else if (u.hp > 0 && (u.drones || []).some((d) => !d.off)) {
        // Their deployed drones act, then your turn
        this._gearDrones(u);
        if (this.turnSystem.phase === TurnPhase.GAME_OVER) return;
        this.turnSystem.phase = TurnPhase.ENEMY_FLY;
        this.waitTimer = L.settle;
        this.waitThen = () => this._startPlayerTurn();
      } else this._startPlayerTurn();
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
    if (how === 'teleport') {
      const sp = this.playerSpecials[this.teleportPick];
      this.teleportPick = null;
      this._useSpecial(this.player, sp, this.activeEnemy, pos);
      this._afterAction(this.player, 0.35);
      return true;
    }
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
      soundEngine.playDrone();
      this._afterAction(this.player);
    } else {
      d.off = true;
      d.deployedAt = performance.now(); // renderer: drone docks
    }
    return { ok: true };
  }

  /** STOMP (an action, once per turn): kick the enemy right next to you. */
  stompPlayer() {
    if (!this.canPlayerAct || !this.stompStatus(this.player, this.activeEnemy).ok) return false;
    this._stomp(this.player, this.activeEnemy);
    this._afterAction(this.player);
    return true;
  }

  /** Can `u` stomp `target` now? { ok, reason, dmg } */
  stompStatus(u, target) {
    if (!u || !(u.stompDmg > 0)) return { ok: false, reason: 'NO STOMP' };
    if (!(u.actionsLeft > 0)) return { ok: false, reason: 'NO ACTIONS' };
    if (u.stompedOn === u.turnNo) return { ok: false, reason: 'USED' };
    if (u.heat > u.heatCap) return { ok: false, reason: 'HOT' };
    if ((u.legs?.stompEn || 0) > u.energy) return { ok: false, reason: 'ENERGY' };
    if (!target || this.distance(u, target) !== 1) return { ok: false, reason: 'NOT ADJACENT' };
    return { ok: true, reason: '', dmg: Math.round(u.stompDmg) };
  }

  _stomp(u, target) {
    u.stompedOn = u.turnNo;
    u.actionsLeft -= 1;
    u.heat += u.legs?.stompHeat ?? G.stompHeat;
    u.energy -= u.legs?.stompEn || 0;
    u.launchedAt = performance.now(); // renderer: legs spring
    this.renderer.addScreenShake(12);
    this.particles.push({ type: 'shockwave', x: target.x, y: W.groundY, radius: 10, maxRadius: 80, life: 0.3, maxLife: 0.3 });
    soundEngine.playStomp();
    this._weaponHit(u, target, stompGun(u.legs), u.stompDmg);
    if (target.hp > 0 && this.turnSystem.phase !== TurnPhase.GAME_OVER) this._shove(target, u, 1, '#f4f4f4');
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
    if (shooter.jammed) return { ok: false, reason: 'JAMMED' };
    if (shooter.heat > shooter.heatCap) return { ok: false, reason: 'HOT' };
    if (shooter.energy < (w.en || 0) && !this._freeShot(shooter)) return { ok: false, reason: 'ENERGY' };
    if (!target) return { ok: false, reason: 'NO TARGET' };
    const d = this.distance(shooter, target);
    if (d < w.reach[0]) return { ok: false, reason: 'TOO CLOSE' };
    if (d > w.reach[1]) return { ok: false, reason: 'RANGE' };
    return { ok: true, reason: '', overheats: shooter.heat + (w.heat || 0) > shooter.heatCap };
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
    let dmg = w.dmg * (w.fx?.burst || 1) * (this.collisionSystem.stats.playerAtk || 1) * this._condAtkMult();
    if (w.fx?.execute && target.hp < target.maxHp * w.fx.execute) dmg *= EXECUTE_MULT;
    if (!w.fx?.pierce) dmg *= 1 - Math.min(CONFIG.run.maxDefCap || 15, resistOf(target, dtypeOf(w))) * CONFIG.damage.defensePerPoint;
    return Math.max(1, Math.round(dmg));
  }

  /** Overdrive Governor (hot) and Last Stand (low HP): extra damage from the active mech right now. */
  _condAtkMult() {
    const m = this.rigStats?.mech || {};
    const p = this.player;
    let k = 1;
    if (!p) return k;
    if (m.hotAtk && p.heat > p.heatCap * 0.5) k += m.hotAtk;
    if (m.lowHpAtk && p.hp < p.maxHp * 0.35) k += m.lowHpAtk;
    return k;
  }

  /** Phantom frame: the active mech's first shot this battle is free. */
  _freeShot(shooter) {
    return shooter === this.player && !!this.team?.[this.teamIndex]?.freeShot;
  }

  _payForShot(shooter, w) {
    if (this._freeShot(shooter)) this.team[this.teamIndex].freeShot = false;
    else shooter.energy -= w.en || 0;
    shooter.heat += w.heat || 0;
    if (w.ammo) w.ammoLeft -= 1;
    w.usedOn = shooter.turnNo; // each gun once per turn
    shooter.actionsLeft -= 1;
    // Backfire: the gun hurts its shooter too (never below 1 HP)
    const bf = Math.min(Math.round(w.backfire || 0), Math.max(0, Math.ceil(shooter.hp) - 1));
    if (bf > 0) {
      shooter.takeDamage(bf);
      this._callout(shooter, `BACKFIRE -${bf}`, '#ff5d73');
    }
    if (w.fx?.dump) {
      // Capacitor Dump: everything left goes into this shot
      const spent = Math.max(0, Math.floor(shooter.energy));
      shooter.energy = 0;
      w._dumpBonus = Math.round((spent / 2) * G.dmgScale);
    }
  }

  /** VENT (the cooldown): cool 2x your cooling; it takes the rest of your turn. */
  _vent(u) {
    const cooled = Math.min(u.heat, u.cool * G.vent.coolMult);
    u.heat -= cooled;
    u.actionsLeft = 0;
    const exch = u === this.player ? this.rigStats?.mech?.ventEnergy || 0 : 0;
    if (exch && cooled > 0) {
      const got = Math.min(u.energyMax - u.energy, Math.round(cooled * exch));
      if (got > 0) {
        u.energy += got;
        this._callout(u, `EXCHANGER +${got} EN`, DTYPES.energy.color);
      }
    }
    for (let i = 0; i < 16; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      const sp = 90 + Math.random() * 160;
      this.particles.push({ x: u.x + (Math.random() - 0.5) * u.radius, y: u.y - u.radius * 0.5, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, float: true, size: 6 + Math.random() * 8, color: i % 3 ? '#dfe6ee' : '#73eff7', life: 0.7, maxLife: 0.7 });
    }
    this.particles.push({ type: 'shockwave', x: u.x, y: u.y, radius: 10, maxRadius: 90, life: 0.35, maxLife: 0.35 });
    soundEngine.playVent();
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
    soundEngine.playShot(kind, dtypeOf(w));
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
    if (target.hp > 0) this._weaponHit(shooter, target, w, this._shotDamage(w, target));
    if (!last || this.turnSystem.phase === TurnPhase.GAME_OVER || target.hp <= 0) return;
    if (w.fx?.napalm) this._ignite(target.pos, w.fx.napalm);
    if (w.fx?.push) this._shove(target, shooter, w.fx.push, w.color);
    if (w.fx?.pull) this._shove(target, shooter, -w.fx.pull, w.color);
    if (w.fx?.drag && shooter.hp > 0) this._dragToward(shooter, target, w.fx.drag);
  }

  /** Grapple Hook's cable: the shooter slides `n` toward the target (stops at a mech). */
  _dragToward(u, target, n) {
    const dir = Math.sign(target.pos - u.pos) || 1;
    let to = u.pos;
    for (let i = 0; i < n; i++) {
      const next = to + dir;
      if (next < 1 || next > L.size || this._unitAt(next)) break;
      to = next;
    }
    to = this._throw(u, to);
    if (to === u.pos) return;
    u.anim = { from: u.x, to: posX(to), t: 0, dur: 0.25, jump: false };
    u.pos = to; // _updateAnims calls _arrive when the slide ends
  }

  // ---------- Specials (SPECIAL A / B slots) ----------

  /** Can `u` use special `sp` on `target` now? { ok, reason } */
  specialStatus(u, sp, target) {
    if (!sp) return { ok: false, reason: '' };
    if (!(u.actionsLeft > 0)) return { ok: false, reason: 'NO ACTIONS' };
    if (!(sp.usesLeft > 0)) return { ok: false, reason: 'EMPTY' };
    if (u.heat > u.heatCap) return { ok: false, reason: 'HOT' };
    if (u.energy < (sp.en || 0)) return { ok: false, reason: 'ENERGY' };
    const d = target ? this.distance(u, target) : 99;
    if (sp.special === 'hook') {
      if (!target) return { ok: false, reason: 'NO TARGET' };
      if (d < 2) return { ok: false, reason: 'TOO CLOSE' };
      if (d > sp.range) return { ok: false, reason: 'RANGE' };
    }
    if (sp.special === 'charge') {
      if (!target) return { ok: false, reason: 'NO TARGET' };
      if (u.legs?.anchored) return { ok: false, reason: 'ANCHORED' };
      if (d < 2 && !sp.away) return { ok: false, reason: 'TOO CLOSE' };
    }
    if (sp.special === 'shield' && u.bubble > 0) return { ok: false, reason: 'ACTIVE' };
    return { ok: true, reason: '' };
  }

  /** Use a special (the action and its cost are paid here). `pos` is the Teleporter's destination. */
  _useSpecial(u, sp, target, pos) {
    u.energy -= sp.en || 0;
    u.heat += sp.heat || 0;
    sp.usesLeft -= 1;
    u.actionsLeft -= 1;
    const dir = target ? Math.sign(target.pos - u.pos) || 1 : 1;
    if (sp.special === 'hook') {
      const spot = this._throw(target, u.pos + dir); // a mine on the way stops the yank there
      target.anim = { from: target.x, to: posX(spot), t: 0, dur: 0.3, jump: false };
      target.pos = spot; // _updateAnims calls _arrive when the yank ends
      soundEngine.playShot('hook');
      this._callout(target, 'HOOKED', sp.color);
      // Mag Tether: the cable drains them too
      if (sp.drain && target.hp > 0) this._reactorFx(target, { dtype: 'energy', fx: { drain: sp.drain } }, 0, u);
    } else if (sp.special === 'charge') {
      // Retro Rockets fly the other way and never ram
      const step = sp.away ? -dir : dir;
      let to = u.pos;
      for (let i = 0; i < sp.dist; i++) {
        const next = to + step;
        if (next < 1 || next > L.size || this._unitAt(next)) break;
        to = next;
      }
      to = this._mineStop(u, u.pos, to); // dashing along the ground: an enemy mine stops it
      u.anim = { from: u.x, to: posX(to), t: 0, dur: 0.22, jump: false };
      u.pos = to; // _updateAnims calls _arrive when the dash ends
      soundEngine.playMove('jump');
      this._callout(u, sp.away ? 'RETRO!' : 'CHARGE!', sp.color);
      if (!sp.away && u.hp > 0 && target.hp > 0 && this.distance(u, target) === 1) {
        this.renderer.addScreenShake(12);
        soundEngine.playStomp();
        this._weaponHit(u, target, RAM_GUN, sp.ram);
        if (target.hp > 0 && this.turnSystem.phase !== TurnPhase.GAME_OVER) this._shove(target, u, 1, sp.color);
      }
    } else if (sp.special === 'teleport') {
      for (const at of [u.x, posX(pos)]) this.particles.push({ type: 'shockwave', x: at, y: u.y, radius: 6, maxRadius: 90, life: 0.3, maxLife: 0.3 });
      u.pos = pos;
      u.x = posX(pos);
      u.anim = null;
      soundEngine.playTeleport();
      this._arrive(u);
    } else if (sp.special === 'shield') {
      u.bubble = sp.absorb;
      soundEngine.playShield();
      this._callout(u, `SHIELD ${Math.round(sp.absorb)}`, sp.color);
    }
  }

  /** HUD: tap a special. The Teleporter first asks for a plate (tap it again to cancel). */
  usePlayerSpecial(i) {
    const sp = this.playerSpecials?.[i];
    if (!this.canPlayerAct || !sp) return { ok: false, reason: this.player?.actionsLeft > 0 ? 'WAIT' : 'NO ACTIONS' };
    if (this.teleportPick === i) {
      this.teleportPick = null;
      this.moveMap = this.reachable(this.player);
      return { ok: true, cancelled: true };
    }
    const st = this.specialStatus(this.player, sp, this.activeEnemy);
    if (!st.ok) return st;
    if (sp.special === 'teleport') {
      this.teleportPick = i;
      this.moveMap = new Map();
      for (let q = 1; q <= L.size; q++) if (!this._unitAt(q)) this.moveMap.set(q, 'teleport');
      return { ok: true, pick: true };
    }
    this._useSpecial(this.player, sp, this.activeEnemy);
    this._afterAction(this.player, 0.35);
    return { ok: true };
  }

  /** This round's damage before resists: Thermal Lance, Arc Turret, Meltdown Cannon and Capacitor Dump change it. */
  _shotDamage(w, target) {
    let dmg = w.dmg;
    if (w.fx?.hotBonus && target.heat > target.heatCap * 0.75) {
      dmg *= 2;
      this._callout(target, 'SEARED x2', DTYPES.heat.color);
    }
    if (w.fx?.lowEnBonus && target.energy < (target.energyMax || 0) * 0.25) {
      dmg *= 2;
      this._callout(target, 'SHORTED x2', DTYPES.energy.color);
    }
    if (w.fx?.meltdown && target.heat > target.heatCap) {
      const excess = target.heat - target.heatCap;
      dmg += excess * 2;
      target.heat = target.heatCap;
      this._callout(target, 'MELTDOWN', '#ff5d73');
      this.renderer.addScreenShake(12);
    }
    if (w.fx?.execute && target.hp < target.maxHp * w.fx.execute) {
      dmg *= EXECUTE_MULT;
      this._callout(target, 'EXECUTE', '#ff5d73');
    }
    if (w._dumpBonus) {
      dmg += w._dumpBonus;
      w._dumpBonus = 0;
    }
    return dmg;
  }

  /** Napalm: the plate burns for `turns` rounds. */
  _ignite(pos, turns) {
    this.hazards = this.hazards.filter((h) => !(h.type === 'fire' && h.pos === pos));
    this.hazards.push({ type: 'fire', pos, turns, x: posX(pos) - W.width / L.size / 2 + 6, w: W.width / L.size - 12, born: performance.now() });
    this.particles.push({ type: 'shockwave', x: posX(pos), y: W.groundY, radius: 8, maxRadius: 70, life: 0.3, maxLife: 0.3 });
  }

  /** Standing or landing on a burning plate: +8 heat (resists soften it). */
  _burnPlate(u) {
    const add = Math.max(1, Math.round(8 * this._reactorKeep(u, 'heat')));
    u.heat += add;
    this._callout(u, `ON FIRE +${add} HEAT`, DTYPES.heat.color);
  }

  /** How much of a heat / drain effect gets through the target's resist. */
  _reactorKeep(target, type) {
    return 1 - Math.min(CONFIG.run.maxDefCap || 15, resistOf(target, type)) * CONFIG.damage.defensePerPoint;
  }

  /** Mine Launcher: a mine on a free position next to the target (their side of it first). */
  _plantMine(shooter, target, w) {
    const dir = Math.sign(target.pos - shooter.pos) || 1;
    const spot = [target.pos + dir, target.pos - dir].find((q) => q >= 1 && q <= L.size && !this._unitAt(q) && !this.hazards.some((h) => h.type === 'mine' && h.pos === q));
    if (!spot) return this._callout(shooter, 'NO ROOM FOR A MINE', '#94b0c2');
    this.hazards.push({ type: 'mine', pos: spot, x: posX(spot) - 24, w: 48, armed: true, born: performance.now(), owner: shooter.team, dmg: w.dmg });
    this.particles.push({ type: 'shockwave', x: posX(spot), y: W.groundY, radius: 6, maxRadius: 60, life: 0.3, maxLife: 0.3 });
    soundEngine.playShot('lob', 'phys', true);
    this._callout(shooter, 'MINE PLANTED', '#ef7d57');
  }

  /**
   * One hit on `target`. HP damage goes through resists; Heat guns also add
   * heat (never HP), Energy guns drain energy, and a drain past zero hits HP 1:1.
   */
  _weaponHit(from, target, w, rawDmg, owner = from) {
    const type = dtypeOf(w);
    rawDmg *= 1 + (Math.random() * 2 - 1) * G.dmgSpread; // every hit rolls
    const strip = { ...(w.fx?.resDrain || {}) };
    if (w.fx?.corrode) strip.phys = (strip.phys || 0) + w.fx.corrode;
    if (target.team === 'enemy') {
      if (target.forcefield) {
        target.forcefield = false;
        this._callout(target, 'BLOCKED', '#a7f070');
        return;
      }
      const yours = owner === this.player;
      const critChance = (w.fx?.crit || 0) + (yours ? 0.05 + (this.rigStats?.critChance || 0) : 0);
      const crit = critChance > 0 && Math.random() < critChance;
      let dmg = rawDmg * (crit ? 1.75 : 1);
      if (yours) dmg *= (this.collisionSystem.stats.playerAtk || 1) * this._condAtkMult();
      if (!w.fx?.pierce) dmg *= 1 - Math.min(CONFIG.run.maxDefCap || 15, resistOf(target, type)) * CONFIG.damage.defensePerPoint;
      dmg = Math.max(1, Math.round(dmg)) + this._reactorFx(target, w, w.dmg ?? rawDmg, owner); // heat / drain from the base hit, not specialist bonuses
      const killed = target.takeDamage(dmg);
      // Siphon Ray: part of the damage comes back as repairs
      if (w.fx?.lifesteal && yours && this.player.hp > 0) {
        const got = this._healPlayer(dmg * w.fx.lifesteal);
        if (got > 0) this._callout(this.player, `SIPHON +${got}`, '#a7f070');
      }
      if (w.fx?.burn) {
        target.burnTicks = Math.max(target.burnTicks || 0, w.fx.burn);
        target.burnDmg = Math.max(target.burnDmg || 0, 6);
      }
      if (w.fx?.freeze) target.isFrozen = true;
      for (const [t, n] of Object.entries(strip)) {
        target.res = { ...target.res, [t]: Math.max(-(target.def || 0), (target.res?.[t] || 0) - n) };
        this._callout(target, `-${n} ${DTYPES[t].short} RES`, DTYPES[t].color);
      }
      if (yours) this._reportHit(w, dmg);
      if (crit) this._callout(target, 'CRIT!', '#ffcd75');
      this.events.emit('damage', { attacker: owner, victim: target, damage: dmg, killed, crit });
      return;
    }
    if (this.player.forcefield) {
      this.player.forcefield = false;
      this._callout(this.player, 'BLOCKED', '#a7f070');
      return;
    }
    const dmg = this.collisionSystem.calculatePlayerDamage(rawDmg, { dtype: type, bypassDef: !!w.fx?.pierce }) + this._reactorFx(this.player, w, w.dmg ?? rawDmg, owner);
    const killed = this.player.takeDamage(dmg);
    if (w.fx?.burn) {
      this.player.burnTicks = Math.max(this.player.burnTicks || 0, w.fx.burn);
      this.player.burnDmg = Math.max(this.player.burnDmg || 0, 6);
    }
    if (w.fx?.freeze) this.player.isFrozen = true;
    for (const [t, n] of Object.entries(strip)) {
      const r = this.player.res;
      r[t] = Math.max(-(this.collisionSystem.stats.playerTotalDef || 0), (r[t] || 0) - n);
      this._callout(this.player, `-${n} ${DTYPES[t].short} RES`, DTYPES[t].color);
    }
    this.events.emit('damage', { attacker: owner, victim: this.player, damage: dmg, killed });
  }

  /**
   * Heat guns add heat to the target (the gun's own amount, or half the hit);
   * heat never touches HP. Energy guns drain energy the same way; whatever
   * the tank can't cover comes off HP 1:1. Returns that extra HP damage.
   */
  _reactorFx(target, w, dmg, owner = null) {
    const type = dtypeOf(w);
    let extra = 0;
    // (Meltdown vents the target instead of heating it)
    if ((type === 'heat' || w.fx?.heat) && !w.fx?.meltdown) {
      const add = Math.round((w.fx?.heat ?? dmg * G.dtypeLoad) * this._reactorKeep(target, 'heat'));
      target.heat += add;
      this._callout(target, target.heat > target.heatCap ? 'OVERHEATING' : `+${add} HEAT`, DTYPES.heat.color);
    }
    if (type === 'energy' || w.fx?.drain) {
      const want = Math.round((w.fx?.drain ?? dmg * G.dtypeLoad) * this._reactorKeep(target, 'energy'));
      const took = Math.min(target.energy, want);
      target.energy -= took;
      extra = want - took;
      if (took) this._callout(target, `-${took} EN`, DTYPES.energy.color);
      if (extra) this._callout(target, 'ENERGY BREAK', '#ff5d73');
      // Leech Coil: what it drains, you get
      if (w.fx?.steal && took && owner && owner.hp > 0) {
        owner.energy = Math.min(owner.energyMax, owner.energy + took);
        this._callout(owner, `+${took} EN`, DTYPES.energy.color);
      }
    }
    // Reactor damage lasts the rest of the fight
    if (w.fx?.coolDmg) {
      const cut = Math.min(w.fx.coolDmg, Math.max(0, target.cool - 2));
      if (cut) {
        target.cool -= cut;
        target.coolLost = (target.coolLost || 0) + cut;
        this._callout(target, `COOLING -${cut}`, '#ff5d73');
      }
    }
    if (w.fx?.regenDmg) {
      const cut = Math.min(w.fx.regenDmg, Math.max(0, target.regen - 3));
      if (cut) {
        target.regen -= cut;
        target.regenLost = (target.regenLost || 0) + cut;
        this._callout(target, `REGEN -${cut}`, '#ff5d73');
      }
    }
    if (w.fx?.jam && target.energy <= 0 && !target.jamNext) {
      target.jamNext = true;
      this._callout(target, 'BLACKOUT: GUNS JAM', DTYPES.energy.color);
    }
    return extra;
  }

  _reportHit(w, dmg) {
    const r = this.battleStats.report;
    r.dealt += dmg;
    r.byGun[w.name] = (r.byGun[w.name] || 0) + dmg;
  }

  // ---------- Drones ----------

  /** Deployed drones act at the end of their owner's turn, paying their energy. */
  _gearDrones(owner = this.player) {
    const drones = owner === this.player ? this.playerDrones : owner.drones || [];
    const foe = owner === this.player ? this.activeEnemy : this.player;
    for (const d of drones) {
      if (d.off) continue;
      const { en, heat } = droneUpkeep(d);
      if (d.forcefieldEvery && (owner.forcefield || this.battleStats.turns % d.forcefieldEvery !== 0)) continue;
      if (d.heal && (owner.hp >= owner.maxHp || (d.healed || 0) >= owner.maxHp * G.droneHealCap)) continue; // full, or spent for this battle
      if (d.chill && owner.heat <= 0) continue;
      if (d.dmg && !foe) continue;
      if (owner.energy < en) {
        this._callout(owner, 'DRONE: NO POWER', '#94b0c2');
        continue;
      }
      owner.energy -= en;
      owner.heat += heat;
      this._droneAct(d, owner, foe);
      if (this.turnSystem.phase === TurnPhase.GAME_OVER) return;
    }
  }

  _droneAct(d, shooter = this.player, foe = this.activeEnemy) {
    if (d.heal) {
      const before = shooter.hp;
      d.firedAt = performance.now();
      // The Risk heal penalty applies to your drone, and it runs dry at droneHealCap of max HP per battle
      const mult = shooter === this.player ? (this.run ? this.run.healMult : saveSystem.getHealingMultiplier()) : 1;
      const room = shooter.maxHp * G.droneHealCap - (d.healed || 0);
      shooter.hp = Math.min(shooter.maxHp, shooter.hp + Math.max(0, Math.min(room, Math.round(d.heal * mult))));
      d.healed = (d.healed || 0) + (shooter.hp - before);
      if (shooter.hp > before) this._callout(shooter, (d.healed >= shooter.maxHp * G.droneHealCap - 0.5) ? `REPAIR +${Math.round(shooter.hp - before)} · SPENT` : `REPAIR +${Math.round(shooter.hp - before)}`, d.color);
      this._spawnHealSparkles(shooter);
    } else if (d.chill) {
      d.firedAt = performance.now();
      const cooled = Math.min(shooter.heat, Math.round(d.chill));
      shooter.heat -= cooled;
      if (cooled > 0) this._callout(shooter, `COOLANT -${cooled} HEAT`, d.color);
    } else if (d.forcefieldEvery) {
      d.firedAt = performance.now();
      shooter.forcefield = true;
      this._callout(shooter, 'DRONE SHIELD', d.color);
    } else if (d.dmg) {
      const target = foe;
      if (!target) return;
      d.firedAt = performance.now();
      soundEngine.playShot('bullet', dtypeOf(d), true);
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

  // ---------- Enemy: plans its turn with LaneAI, one action at a time ----------

  /** A plain copy of one mech for the planner. */
  _aiUnit(u, guns) {
    return {
      team: u.team,
      pos: u.pos,
      hp: u.hp,
      maxHp: u.maxHp,
      heat: u.heat,
      heatCap: u.heatCap,
      cool: u.cool,
      energy: u.energy,
      energyMax: u.energyMax,
      regen: u.regen,
      actions: u.actionsLeft,
      maxActions: G.actions,
      freeUsed: !!u._freeMoveUsed,
      frozen: !!u.isFrozen,
      jammed: !!u.jammed,
      jamNext: !!u.jamNext,
      bubble: u.bubble || 0,
      specials: (u === this.player ? this.playerSpecials || [] : u.specials || []).map((sp) => ({ kind: sp.special, uses: sp.usesLeft, en: sp.en || 0, heat: sp.heat || 0, range: sp.range || 0, dist: sp.dist || 0, ram: sp.ram || 0, absorb: sp.absorb || 0, away: !!sp.away, drain: sp.drain || 0 })),
      shield: !!u.forcefield,
      legs: u.legs || DEFAULT_LEGS,
      def: u.def || 0,
      res: { ...(u.res || {}) },
      stompDmg: u.stompDmg || 0,
      stomped: u.stompedOn === u.turnNo,
      guns: guns.map((w) => ({
        dmg: w.dmg,
        burst: w.fx?.burst || 1,
        en: w.en || 0,
        heat: w.heat || 0,
        reach: w.reach,
        ammo: w.ammo || 0,
        ammoLeft: w.ammoLeft,
        used: w.usedOn === u.turnNo,
        dtype: dtypeOf(w),
        pierce: !!w.fx?.pierce,
        heatFx: w.fx?.heat,
        drain: w.fx?.drain,
        push: w.fx?.push || 0,
        pull: w.fx?.pull || 0,
        drag: w.fx?.drag || 0,
        freeze: !!w.fx?.freeze,
        mine: !!w.fx?.mine,
        hotBonus: !!w.fx?.hotBonus,
        lowEnBonus: !!w.fx?.lowEnBonus,
        execute: w.fx?.execute || 0,
        meltdown: !!w.fx?.meltdown,
        steal: !!w.fx?.steal,
        jam: !!w.fx?.jam,
        coolDmg: w.fx?.coolDmg || 0,
        regenDmg: w.fx?.regenDmg || 0,
        dump: !!w.fx?.dump,
        dumpScale: G.dmgScale,
        backfire: Math.round(w.backfire || 0),
        resDrain: { ...(w.fx?.resDrain || {}), ...(w.fx?.corrode ? { phys: w.fx.corrode } : {}) },
      })),
    };
  }

  /** Plan the rest of the enemy's turn and take its first action (it re-plans after each). */
  _enemyAct(e) {
    if (!this.running || !e || e.hp <= 0) return;
    const p = this.player;
    const plan = planTurn(
      {
        size: L.size,
        me: this._aiUnit(e, e.weapons || []),
        foe: this._aiUnit(p, this.playerWeapons || []),
        mines: this.hazards.filter((h) => h.type === 'mine').map((h) => ({ pos: h.pos, owner: h.owner, dmg: h.dmg })),
        stompHeat: G.stompHeat,
      },
      { difficulty: Math.min(0.95, e.aiDifficulty ?? 0.5), aggression: this.aggression },
    );
    const a = plan[0] || { type: 'end' };
    if (a.type === 'fire') {
      const w = e.weapons[a.gun];
      this._payForShot(e, w);
      this._shoot(e, w, p);
      return this._afterAction(e);
    }
    if (a.type === 'move') {
      this._moveUnit(e, a.pos, a.how);
      return this._afterAction(e, 0.15);
    }
    if (a.type === 'special') {
      const sp = e.specials?.[a.i];
      if (sp && this.specialStatus(e, sp, p).ok) {
        this._useSpecial(e, sp, p, a.pos);
        return this._afterAction(e, 0.35);
      }
    }
    if (a.type === 'stomp' && this.stompStatus(e, p).ok) {
      this._stomp(e, p);
      return this._afterAction(e);
    }
    if (a.type === 'vent') {
      this._vent(e);
      return this._afterAction(e);
    }
    if (e.actionsLeft === G.actions) this._callout(e, 'HOLDING', '#94b0c2'); // only a whole turn spent waiting
    e.actionsLeft = 0;
    this._afterAction(e, 0.1);
  }

  /**
   * AUTO: the same planner the enemies use plays your turn, always taking
   * its best line. Docked drones launch first (while there's energy to run
   * them). One action at a time; it re-plans after each.
   */
  _autoAct() {
    const p = this.player;
    const e = this.activeEnemy;
    if (!this.canPlayerAct) return;
    if (!e) return this.endPlayerTurn(); // the next enemy drops in on their turn
    const docked = (this.playerDrones || []).findIndex((d) => d.off && p.energy >= droneUpkeep(d).en * 2);
    if (docked >= 0 && this.toggleDrone(docked).ok) return;
    const plan = planTurn(
      {
        size: L.size,
        me: this._aiUnit(p, this.playerWeapons || []),
        foe: this._aiUnit(e, e.weapons || []),
        mines: this.hazards.filter((h) => h.type === 'mine').map((h) => ({ pos: h.pos, owner: h.owner, dmg: h.dmg })),
        stompHeat: G.stompHeat,
      },
      { difficulty: 1, aggression: this.aggression },
    );
    const a = plan[0] || { type: 'end' };
    let ok = false;
    if (a.type === 'fire') ok = this.firePlayerWeapon(a.gun).ok;
    else if (a.type === 'move') ok = this.moveMap.has(a.pos) && this.movePlayerTo(a.pos);
    else if (a.type === 'special') {
      const sp = this.playerSpecials?.[a.i];
      if (sp && this.specialStatus(p, sp, e).ok) {
        this._useSpecial(p, sp, e, a.pos);
        this._afterAction(p, 0.35);
        ok = true;
      }
    } else if (a.type === 'stomp') ok = this.stompPlayer();
    else if (a.type === 'vent') ok = this.ventPlayer();
    if (!ok) this.endPlayerTurn();
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
        soundEngine.playExplosion();
        this._spawnDefeatParticles(victim.x, victim.y, victim.color);
        this.renderer.addScreenShake(12);
      }
      if (victim.team === 'enemy') this.events.emit('player-dealt-damage', { victim, damage });
      else {
        this.battleStats.playerDamageTaken += damage;
        this.events.emit('enemy-dealt-damage', { attacker, damage });
      }
      // Reclaimer frame / Salvage Claw: a kill patches you up
      if (killed && victim.team === 'enemy' && this.player?.hp > 0) {
        const kh = this.rigStats?.mech?.killHeal || 0;
        const got = kh ? this._healPlayer(this.player.maxHp * kh) : 0;
        if (got > 0) {
          this._callout(this.player, `SALVAGED +${got}`, '#a7f070');
          this._spawnHealSparkles(this.player);
        }
      }
      if (killed) this._checkBattleEnd();
    });
  }

  _checkBattleEnd() {
    if (this.turnSystem.phase === TurnPhase.GAME_OVER) return;
    if (this.player.hp <= 0 && this.benchReady.length) {
      // Knocked out: the next team mech drops in on the same position
      const next = this.team.findIndex((m, i) => i !== this.teamIndex && m.hp > 0);
      this.player.hp = 0;
      this.waitTimer = Math.max(this.waitTimer || 0, 0.5);
      return this._playerDropIn(next, 'DROPS IN');
    }
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

    // AUTO: your mech thinks a moment, then acts
    if (this.autoPlayer && this.turnSystem.phase === TurnPhase.PLAYER_AIM && !moving && !this.waitThen) {
      this.autoThink = (this.autoThink ?? 0.5) - dt;
      if (this.autoThink <= 0) {
        this.autoThink = 0.25; // a short beat between AUTO's actions
        this._autoAct();
      }
    } else if (this.turnSystem.phase !== TurnPhase.PLAYER_AIM) this.autoThink = 0.5;
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
      platforms: this.platforms,
      obstacles: this.obstacles,
      hazards: this.hazards,
      battleStats: this.battleStats,
      abilities: this.abilities,
      winner: this.winner,
      battleSummary: { kills: this.enemies.filter((e) => e.hp <= 0).length, turns: this.battleStats.turns },
      playerWeapons: this.playerWeapons || [],
      playerDrones: this.playerDrones || [],
      playerSpecials: this.playerSpecials || [],
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
