// ============================================================
// EnemyAI — simulates the same physics to find a good shot at
// the player, then adds difficulty-based error. Uses the real
// physics functions for a fair, predictable opponent.
// ============================================================

import { CONFIG } from '../config.js';
import { degToRad, lerp, clamp } from '../utils/math.js';

const A = CONFIG.ai;
const S = CONFIG.slingshot;

export class EnemyAI {
  constructor(events) {
    this.events = events;
    this.thinkTimer = 0;
    this.thinking = false;
    this.pendingVelocity = null;
    this.difficulty = A.difficulty;
    // Per-battle modifiers (from node tier / run boons)
    this.thinkDelayOverride = null;
    this.aimErrorBonus = 0; // extra radians of error (e.g. "erratic" boons)
    // Live references used to recalculate shot at fire time
    this._enemyBall = null;
    this._playerBall = null;
    this._barriers = [];
  }

  get thinkingDelay() {
    return this.thinkDelayOverride ?? A.thinkDelay;
  }

  /**
   * Configure the AI for a specific battle.
   * @param {Object} opts { difficulty, thinkDelay, aimErrorBonus }
   */
  configure(opts = {}) {
    if (opts.difficulty !== undefined) this.difficulty = opts.difficulty;
    if (opts.thinkDelay !== undefined) this.thinkDelayOverride = opts.thinkDelay;
    if (opts.aimErrorBonus !== undefined) this.aimErrorBonus = opts.aimErrorBonus;
  }

  /**
   * Start the AI's turn. Begins a "thinking" delay before firing.
   * @param {Array} barriers - active barrier rectangles to avoid
   */
  startTurn(enemyBall, playerBall, barriers = []) {
    this.thinking = true;
    this.thinkTimer = 0;
    this._enemyBall = enemyBall;
    this._playerBall = playerBall;
    this._barriers = barriers;
    this.pendingVelocity = null; // calculated fresh at fire time
  }

  /**
   * Update the think delay. Returns true when the AI fires.
   */
  update(dt) {
    if (!this.thinking) return false;

    this.thinkTimer += dt;
    if (this.thinkTimer >= this.thinkingDelay) {
      this.thinking = false;
      // Recalculate using the player's current live position so tether pulls
      // and any drift during the think delay don't cause misses.
      const velocity = this._calculateShot(this._enemyBall, this._playerBall, this._barriers);
      this.events.emit('enemy-launch', { velocity });
      return true;
    }
    return false;
  }

  /**
   * Find a launch velocity that (approximately) lands on the player,
   * then apply difficulty-based inaccuracy.
   */
  _calculateShot(enemyBall, playerBall, barriers = []) {
    const best = this._searchForShot(enemyBall, playerBall, barriers);

    if (!best) {
      // Fallback: a reasonable lob toward the player
      const angle = -Math.PI / 4; // 45 degrees up
      const power = S.maxPower * 0.7;
      return {
        x: Math.cos(angle) * power,
        y: Math.sin(angle) * power,
      };
    }

    return this._applyError(best, enemyBall);
  }

  /**
   * Brute-force a search over angles and powers, simulating each shot
   * and scoring by proximity to the player ball along the way.
   */
  _searchForShot(enemyBall, playerBall, barriers = []) {
    const steps = A.simulationSteps;
    const dt = A.simulationDt;

    // Player's current center for proximity scoring
    const targetX = playerBall.x;
    const targetY = playerBall.y;
    const radius = CONFIG.ball.radius;

    let bestScore = Infinity;
    let bestVelocity = null;

    // Try a spread of angles (upward arcs toward the player's side)
    const anglesCount = 18;
    const powersCount = 12;

    for (let a = 0; a < anglesCount; a++) {
      const t = a / (anglesCount - 1);
      // Angles from -10 deg (nearly horizontal) to -80 deg (high lob)
      const angleDeg = lerp(10, 80, t);
      const angle = -degToRad(angleDeg);

      for (let p = 0; p < powersCount; p++) {
        const power = lerp(S.minPower, S.maxPower, p / (powersCount - 1));

        const vx = Math.cos(angle) * power;
        const vy = Math.sin(angle) * power;

        // Ensure the shot is directed toward the player
        const dx = playerBall.x - enemyBall.x;
        const dirSign = dx >= 0 ? 1 : -1;

        const score = this._simulateAndScore(
          enemyBall.x,
          enemyBall.y,
          vx * dirSign,
          vy,
          targetX,
          targetY,
          radius,
          steps,
          dt,
          barriers
        );

        if (score < bestScore) {
          bestScore = score;
          bestVelocity = { x: vx * dirSign, y: vy };
        }
      }
    }

    return bestVelocity;
  }

  /**
   * Simulate a shot forward and score how close it comes to the target.
   */
  _simulateAndScore(x, y, vx, vy, tx, ty, radius, steps, dt, barriers = []) {
    const gravity = CONFIG.world.gravity;
    const airDrag = CONFIG.world.airDrag;
    const groundY = CONFIG.world.groundY;
    const wallWidth = CONFIG.world.width;

    let minDist = Infinity;

    const wind = CONFIG.world.wind || 0;
    for (let i = 0; i < steps; i++) {
      vy += gravity * dt;
      vx += wind * dt;
      const drag = 1 - airDrag * dt;
      vx *= drag;
      vy *= drag;
      x += vx * dt;
      y += vy * dt;

      // Stop if the ball leaves the world or hits the ground
      if (y + radius > groundY) break;
      if (x < 0 || x > wallWidth) break;

      // Barrier check: if the shot would hit a barrier, heavily penalize
      // (the AI should arc over or around it instead)
      for (const barrier of barriers) {
        if (!barrier.active) continue;
        const cx = Math.max(barrier.x, Math.min(x, barrier.x + barrier.w));
        const cy = Math.max(barrier.y, Math.min(y, barrier.y + barrier.h));
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= radius * radius) {
          return minDist + 10000; // blocked — bad shot
        }
      }

      const d = Math.hypot(x - tx, y - ty);
      if (d < minDist) minDist = d;

      // Direct hit — perfect score
      if (d < radius * 2) return 0;
    }

    return minDist;
  }

  /**
   * Add random aim error scaled inversely with difficulty.
   * difficulty 1 = no error, difficulty 0 = max error.
   */
  _applyError(velocity, enemyBall) {
    const skill = this.difficulty;
    const errorScale = 1 - skill;

    // Angle error in radians
    const maxAngleError = degToRad(A.maxErrorDegrees * errorScale) + this.aimErrorBonus;
    const angleError = (Math.random() * 2 - 1) * maxAngleError;

    const speed = Math.hypot(velocity.x, velocity.y);
    const angle = Math.atan2(velocity.y, velocity.x);
    const newAngle = angle + angleError;

    // Power error as a fraction
    const maxPowerError = A.maxPowerError * errorScale;
    const powerError = (Math.random() * 2 - 1) * maxPowerError;
    const newSpeed = clamp(speed * (1 + powerError), S.minPower, S.maxPower);

    return {
      x: Math.cos(newAngle) * newSpeed,
      y: Math.sin(newAngle) * newSpeed,
    };
  }
}