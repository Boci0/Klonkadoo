// ============================================================
// EnemyAI — plans where an enemy should MOVE, using the real physics
// (walls, floor, platforms, obstacles, barriers, spring pads, wind).
//
// Bodies don't hurt, so instead of aiming at you the enemy flies every
// candidate launch (both directions, a spread of angles and powers) to
// where it comes to rest, and asks Game how good that spot is: its guns
// in range with a clear line, yours not (Game._scoreSpot). Holding its
// position is a candidate too. Game then spends its actions: move first
// if a better spot exists, then shoot / vent (Game._onEnemyPlan).
//
// Difficulty (0..1) sets how many spots a weaker enemy considers and its
// launch wobble; aggression (from the Risk level) shortens the think delay.
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
    this.aimErrorBonus = 0; // extra radians of aim error
    this.spotScorer = null; // (x, y, rammed, stay) => score, set by Game each turn
    this.world = { barriers: [], platforms: [], obstacles: [], pads: [] };
  }

  get thinkingDelay() {
    // Aggressive enemies act sooner
    return (this.thinkDelayOverride ?? A.thinkDelay) * (1 - 0.35 * this.aggression);
  }

  /** @param {Object} opts { difficulty, thinkDelay, aimErrorBonus, aggression, spotScorer } */
  configure(opts = {}) {
    if (opts.difficulty !== undefined) this.difficulty = opts.difficulty;
    if (opts.thinkDelay !== undefined) this.thinkDelayOverride = opts.thinkDelay;
    if (opts.aimErrorBonus !== undefined) this.aimErrorBonus = opts.aimErrorBonus;
    if (opts.aggression !== undefined) this.aggression = opts.aggression;
    if (opts.spotScorer !== undefined) this.spotScorer = opts.spotScorer;
  }

  /** Arena geometry the simulation collides with (live arrays, read at plan time). */
  setWorld(world) {
    this.world = { barriers: [], platforms: [], obstacles: [], pads: [], ...world };
  }

  startTurn(enemyBall, playerBall) {
    this.thinking = true;
    this.thinkTimer = 0;
    // Plan during the think delay, a few milliseconds per frame, so phones never hitch
    this._planner = this._planSpot(enemyBall, playerBall, this.spotScorer);
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
    // Game decides how to spend the actions (no velocity = hold position)
    const v = plan && !plan.stay ? this._applyError(plan.velocity, plan.lo, plan.hi) : null;
    this.events.emit('enemy-plan', { velocity: v });
    return true;
  }

  /**
   * Fly each candidate to where it stops and score that spot.
   * Weaker (low difficulty) enemies only look at part of the options.
   */
  *_planSpot(shooter, player, scorer) {
    const rects = this._rects();
    // Holding position has to beat moving by a margin, or they'd never reposition
    let best = { stay: true, score: scorer(shooter.x, shooter.y, false, true) + 2 };
    // Its legs set what launches it can make (same rules as yours)
    const legs = shooter.legs;
    if (legs?.anchored) return best;
    const m = legs?.move || {};
    const lo = Math.max(S.minPower, m.min ?? S.minPower + 100);
    const hi = Math.max(lo, m.max ?? S.maxPower);
    // Same low band as yours (CONFIG.move) unless its legs set one
    const a0 = Math.max(2, m.minDeg ?? CONFIG.move.minDeg);
    const a1 = Math.min(88, m.maxDeg ?? CONFIG.move.maxDeg);
    const angles = 10;
    const powers = 9;
    for (const dir of [1, -1]) {
      for (let a = 0; a < angles; a++) {
        for (let p = 0; p < powers; p++) {
          if (Math.random() > 0.45 + 0.55 * this.difficulty) continue; // weaker enemies consider fewer spots
          const angle = -degToRad(lerp(a0, a1, a / (angles - 1)));
          const power = lerp(lo, hi, p / (powers - 1));
          const v = { x: Math.cos(angle) * power * dir, y: Math.sin(angle) * power };
          const end = this._simulateRest(shooter, player, v, rects);
          const score = scorer(end.x, end.y, end.rammed, false);
          if (score > best.score) best = { velocity: v, score, lo, hi };
          yield;
        }
      }
    }
    return best;
  }

  /** Solid geometry as plain copies, so the simulation can't damage real obstacles. */
  _rects() {
    const w = this.world;
    return [...w.barriers, ...w.platforms, ...w.obstacles]
      .filter((r) => r.active !== false)
      .map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
  }

  /** Fly a launch until it comes to rest (or touches the player: a ram). */
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
    };
    const steps = Math.round(SIM_TIME / SIM_DT);
    for (let i = 0; i < steps; i++) {
      stepBall(probe, SIM_DT);
      resolvePads(probe, this.world.pads, SIM_DT);
      resolveBarrierCollisions(probe, rects);
      if (Math.hypot(probe.x - player.x, probe.y - player.y) <= probe.radius + player.radius) {
        return { x: probe.x, y: probe.y, rammed: Math.hypot(probe.vx, probe.vy) >= CONFIG.gear.ramSpeed };
      }
      if (i > 20 && Math.abs(probe.vx) < 25 && Math.abs(probe.vy) < 25) break;
    }
    return { x: probe.x, y: probe.y, rammed: false };
  }

  /** Launch wobble: difficulty 1 = none, 0 = maximum. */
  _applyError(velocity, minPower = S.minPower, maxPower = S.maxPower) {
    const errorScale = 1 - this.difficulty;
    const maxAngleError = degToRad(A.maxErrorDegrees * errorScale) + this.aimErrorBonus;
    const angle = Math.atan2(velocity.y, velocity.x) + (Math.random() * 2 - 1) * maxAngleError;
    const speed = Math.hypot(velocity.x, velocity.y) * (1 + (Math.random() * 2 - 1) * A.maxPowerError * errorScale);
    const s = clamp(speed, minPower, maxPower);
    return { x: Math.cos(angle) * s, y: Math.sin(angle) * s };
  }
}
