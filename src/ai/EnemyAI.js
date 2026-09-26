// ============================================================
// EnemyAI — plans shots by running the real physics (walls, floor,
// platforms, obstacles, barriers, spring pads, wind) for a spread of
// angles and powers, in both directions so bank shots off the side walls
// count. Among the shots that connect it prefers ones that still connect
// when its aim wobbles (robust), hit hard, and don't plough into allies.
//
// Aggression (from the Risk level, 0..1) shifts that choice toward raw
// impact speed, shortens the think delay and is read by Game for ability
// use. Difficulty still sets the random aim error applied afterwards.
//
// Gear combat (a spotScorer is configured): bodies don't hurt, so the
// enemy instead flies every candidate to where it comes to rest and asks
// Game how good that spot is (its guns in range with a clear line, yours
// not). Staying put is a candidate too.
// ============================================================

import { CONFIG } from '../config.js';
import { degToRad, lerp, clamp } from '../utils/math.js';
import { stepBall, resolveBarrierCollisions, resolvePads } from '../core/Physics.js';

const A = CONFIG.ai;
const S = CONFIG.slingshot;
const SIM_DT = 1 / 60;
const SIM_TIME = 3.2; // seconds of flight simulated per candidate

export class EnemyAI {
  constructor(events) {
    this.events = events;
    this.thinkTimer = 0;
    this.thinking = false;
    this.difficulty = A.difficulty;
    this.aggression = 0;
    this.thinkDelayOverride = null;
    this.spotScorer = null; // gear combat: (x, y, rammed) => score
    this.aimErrorBonus = 0; // extra radians of error (e.g. Smoke Bomb relic)
    this.world = { barriers: [], platforms: [], obstacles: [], pads: [] };
    this.allies = [];
    this._enemyBall = null;
    this._playerBall = null;
  }

  get thinkingDelay() {
    // Aggressive enemies fire sooner
    return (this.thinkDelayOverride ?? A.thinkDelay) * (1 - 0.35 * this.aggression);
  }

  /** @param {Object} opts { difficulty, thinkDelay, aimErrorBonus, aggression } */
  configure(opts = {}) {
    if (opts.difficulty !== undefined) this.difficulty = opts.difficulty;
    if (opts.thinkDelay !== undefined) this.thinkDelayOverride = opts.thinkDelay;
    if (opts.aimErrorBonus !== undefined) this.aimErrorBonus = opts.aimErrorBonus;
    if (opts.aggression !== undefined) this.aggression = opts.aggression;
    if (opts.spotScorer !== undefined) this.spotScorer = opts.spotScorer;
  }

  /** Arena geometry the simulation collides with (live arrays, read at fire time). */
  setWorld(world) {
    this.world = { barriers: [], platforms: [], obstacles: [], pads: [], ...world };
  }

  startTurn(enemyBall, playerBall, allies = []) {
    this.thinking = true;
    this.thinkTimer = 0;
    this._enemyBall = enemyBall;
    this._playerBall = playerBall;
    this.allies = allies;
    // Inaccuracy = misjudging where you are: the enemy plans a perfect shot at
    // a spot offset along the ground (less offset the more skilled it is),
    // then adds a small launch wobble. Unlike pure angle error, this still
    // misses at point-blank range, where most fights happen.
    const offset = (Math.random() * 2 - 1) * (A.aimOffsetPx || 0) * (1 - this.difficulty);
    const aimAt = { x: playerBall.x + offset, y: playerBall.y, radius: playerBall.radius };
    // Plan during the think delay, a few milliseconds per frame, so phones never hitch
    this._planner = this.spotScorer ? this._planSpot(enemyBall, playerBall, this.spotScorer) : this._plan(enemyBall, aimAt, { allies });
    this._planned = undefined;
  }

  /** Advance the planner until `budgetMs` is used up; true when finished. */
  _advancePlan(budgetMs) {
    if (!this._planner) return true;
    const end = performance.now() + budgetMs;
    while (performance.now() < end) {
      const step = this._planner.next();
      if (step.done) {
        this._planned = step.value;
        this._planner = null;
        return true;
      }
    }
    return false;
  }

  update(dt) {
    if (!this.thinking) return false;
    this.thinkTimer += dt;
    this._advancePlan(4);
    if (this.thinkTimer < this.thinkingDelay) return false;
    this.thinking = false;
    this._advancePlan(Infinity); // finish whatever is left
    const plan = this._planned;
    if (this.spotScorer) {
      // Gear combat: Game decides how to spend the actions (hold = no move)
      const v = plan && !plan.stay ? this._applyError(plan.velocity, S.maxPower) : null;
      this.events.emit('enemy-plan', { velocity: v });
      return true;
    }
    // A charged Sniper shot is sped up 1.35x on launch (Game): plan for the
    // final speed, then hand over the pre-charge velocity
    const charge = this._enemyBall.isOvercharged ? 1.35 : 1;
    let velocity = plan ? this._applyError(plan.velocity, S.maxPower * charge) : this._fallback(this._enemyBall, this._playerBall);
    if (plan) velocity = { x: velocity.x / charge, y: velocity.y / charge };
    this.events.emit('enemy-launch', { velocity });
    return true;
  }

  _fallback(from, to) {
    const dir = to.x >= from.x ? 1 : -1;
    const power = S.maxPower * 0.7;
    return { x: Math.cos(-Math.PI / 4) * power * dir, y: Math.sin(-Math.PI / 4) * power };
  }

  /**
   * Best shot from `shooter` at `target`.
   * @param {Object} opts { allies: balls to avoid, maxPower, aggression }
   * @returns {{ velocity, hit, impactSpeed, path } | null}
   */
  findBestShot(shooter, target, opts = {}) {
    const it = this._plan(shooter, target, opts);
    let step = it.next();
    while (!step.done) step = it.next();
    return step.value;
  }

  /** Generator version of findBestShot: yields between candidates. */
  *_plan(shooter, target, opts = {}) {
    const allies = opts.allies || [];
    const maxPower = opts.maxPower || S.maxPower * (shooter.isOvercharged ? 1.35 : 1);
    const aggression = opts.aggression ?? this.aggression;
    const rects = this._rects();

    const candidates = [];
    let closest = null;
    const angles = 20;
    const powers = 12;
    for (const dir of [1, -1]) {
      // Shooting away from the target only makes sense as a wall bank: fewer tries
      const toward = Math.sign(target.x - shooter.x || 1) === dir;
      for (let a = 0; a < angles; a += toward ? 1 : 2) {
        const angle = -degToRad(lerp(4, 84, a / (angles - 1)));
        for (let p = 0; p < powers; p++) {
          const power = lerp(S.minPower + 150, maxPower, p / (powers - 1));
          const v = { x: Math.cos(angle) * power * dir, y: Math.sin(angle) * power };
          const r = this._simulate(shooter, target, v, rects, allies);
          if (r.hit) candidates.push({ velocity: v, ...r });
          else if (!closest || r.minDist < closest.minDist) closest = { velocity: v, ...r };
          yield;
        }
      }
    }

    if (!candidates.length) return closest ? { ...closest, hit: false } : null;

    // Aggression sets how hard the enemy swings: cautious enemies (low Risk)
    // take controlled ~700 px/s shots, aggressive ones go for full speed.
    // Impact speed is what damage scales with (CollisionSystem).
    const wantSpeed = lerp(700, 1400, aggression);
    const fit = (c) => 1 - Math.min(1, Math.abs(c.impactSpeed - wantSpeed) / 700);
    // Shortlist the best-fitting shots, then test how well each survives wobble
    candidates.sort((a, b) => fit(b) - fit(a) - (b.friendly - a.friendly) * 2);
    const shortlist = candidates.slice(0, 10);
    let best = null;
    for (const c of shortlist) {
      const robust = this._robustness(shooter, target, c.velocity, rects, allies, maxPower);
      yield;
      const score = robust * 0.6 + fit(c) * 0.6 - (c.friendly ? 0.8 : 0) - c.time * 0.05;
      if (!best || score > best.score) best = { ...c, score, robust };
    }
    return best;
  }

  /**
   * Gear combat: fly each candidate to where it stops and score that spot.
   * Weaker (low difficulty) enemies only look at part of the options.
   */
  *_planSpot(shooter, player, scorer) {
    const maxPower = S.maxPower * (shooter.isOvercharged ? 1.35 : 1);
    const rects = this._rects();
    // Holding position has to beat moving by a margin, or they'd never reposition
    let best = { stay: true, score: scorer(shooter.x, shooter.y, false, true) + 2 };
    const angles = 16;
    const powers = 9;
    for (const dir of [1, -1]) {
      for (let a = 0; a < angles; a++) {
        for (let p = 0; p < powers; p++) {
          if (Math.random() > 0.45 + 0.55 * this.difficulty) continue; // weaker enemies consider fewer spots
          const angle = -degToRad(lerp(6, 84, a / (angles - 1)));
          const power = lerp(S.minPower + 100, maxPower, p / (powers - 1));
          const v = { x: Math.cos(angle) * power * dir, y: Math.sin(angle) * power };
          const end = this._simulateRest(shooter, player, v, rects);
          const score = scorer(end.x, end.y, end.rammed);
          if (score > best.score) best = { velocity: v, score };
          yield;
        }
      }
    }
    return best;
  }

  /** Fly a shot until it comes to rest (or touches the player: a ram). */
  _simulateRest(shooter, player, v, rects) {
    const probe = {
      x: shooter.x,
      y: shooter.y,
      vx: v.x,
      vy: v.y,
      radius: shooter.radius,
      mass: shooter.mass || 1,
      bounce: shooter.bounce || 1,
      gravityMult: shooter.gravityMult || 1,
      ballType: shooter.ballType || null,
    };
    const steps = Math.round(SIM_TIME / SIM_DT);
    for (let i = 0; i < steps; i++) {
      stepBall(probe, SIM_DT);
      resolvePads(probe, this.world.pads, SIM_DT);
      resolveBarrierCollisions(probe, rects);
      if (Math.hypot(probe.x - player.x, probe.y - player.y) <= probe.radius + player.radius) {
        const rammed = Math.hypot(probe.vx, probe.vy) >= CONFIG.gear.ramSpeed;
        return { x: probe.x, y: probe.y, rammed };
      }
      if (i > 20 && Math.abs(probe.vx) < 25 && Math.abs(probe.vy) < 25) break;
    }
    return { x: probe.x, y: probe.y, rammed: false };
  }

  /** Fraction of small aim/power perturbations that still hit. */
  _robustness(shooter, target, v, rects, allies, maxPower) {
    const speed = Math.hypot(v.x, v.y);
    const angle = Math.atan2(v.y, v.x);
    let hits = 0;
    let tries = 0;
    for (const da of [-2.5, 2.5, -5, 5]) {
      for (const dp of [0.96, 1.04]) {
        const s = clamp(speed * dp, S.minPower, maxPower);
        const a = angle + degToRad(da);
        if (this._simulate(shooter, target, { x: Math.cos(a) * s, y: Math.sin(a) * s }, rects, allies).hit) hits++;
        tries++;
      }
    }
    return hits / tries;
  }

  /** Solid geometry as plain copies, so the simulation can't damage real obstacles. */
  _rects() {
    const w = this.world;
    return [...w.barriers, ...w.platforms, ...w.obstacles]
      .filter((r) => r.active !== false)
      .map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
  }

  /**
   * Fly one shot with the game's own physics.
   * @returns {{ hit, impactSpeed, time, friendly, minDist, path }}
   */
  _simulate(shooter, target, v, rects, allies) {
    const probe = {
      x: shooter.x,
      y: shooter.y,
      vx: v.x,
      vy: v.y,
      radius: shooter.radius,
      mass: shooter.mass || 1,
      bounce: shooter.bounce || 1,
      gravityMult: shooter.gravityMult || 1,
      ballType: shooter.ballType || null,
    };
    const hitDist = shooter.radius + target.radius;
    const steps = Math.round(SIM_TIME / SIM_DT);
    const path = [];
    let minDist = Infinity;
    let friendly = 0;
    for (let i = 0; i < steps; i++) {
      stepBall(probe, SIM_DT);
      resolvePads(probe, this.world.pads, SIM_DT);
      resolveBarrierCollisions(probe, rects);
      if (i % 3 === 0) path.push({ x: probe.x, y: probe.y });

      const d = Math.hypot(probe.x - target.x, probe.y - target.y);
      if (d < minDist) minDist = d;
      if (d <= hitDist) {
        return { hit: true, impactSpeed: Math.hypot(probe.vx, probe.vy), time: i * SIM_DT, friendly, minDist: 0, path };
      }
      for (const ally of allies) {
        if (ally !== shooter && ally.hp > 0 && Math.hypot(probe.x - ally.x, probe.y - ally.y) <= probe.radius + ally.radius) friendly = 1;
      }
      // Rolled to a stop: the shot is over
      if (i > 20 && Math.abs(probe.vx) < 25 && Math.abs(probe.vy) < 25) break;
    }
    return { hit: false, impactSpeed: 0, time: SIM_TIME, friendly, minDist, path };
  }

  /** Random aim error: difficulty 1 = none, 0 = maximum. */
  _applyError(velocity, maxPower = S.maxPower) {
    const errorScale = 1 - this.difficulty;
    const maxAngleError = degToRad(A.maxErrorDegrees * errorScale) + this.aimErrorBonus;
    const angle = Math.atan2(velocity.y, velocity.x) + (Math.random() * 2 - 1) * maxAngleError;
    const speed = Math.hypot(velocity.x, velocity.y) * (1 + (Math.random() * 2 - 1) * A.maxPowerError * errorScale);
    const s = clamp(speed, S.minPower, maxPower);
    return { x: Math.cos(angle) * s, y: Math.sin(angle) * s };
  }
}
