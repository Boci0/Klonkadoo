// ============================================================
// Custom physics engine.
// Pure functions operating on ball state — usable both for the
// live game and for deterministic AI simulation.
// Supports world bounds, barrier rects, floating platforms, and
// destructible obstacle blocks.
// ============================================================

import { CONFIG } from '../config.js';

const W = CONFIG.world;
const B = CONFIG.ball;

/**
 * Apply gravity + air drag to a ball's velocity.
 */
export function applyForces(ball, dt) {
  ball.vy += W.gravity * dt;
  // Arena wind pushes airborne balls sideways (W.wind is set per battle)
  if (W.wind && ball.y + (ball.radius || B.radius) < W.groundY - 2) ball.vx += W.wind * dt;
  const drag = 1 - W.airDrag * dt;
  ball.vx *= drag;
  ball.vy *= drag;
}

/**
 * Integrate position from velocity.
 */
export function integrate(ball, dt) {
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
}

/**
 * Resolve collisions against the ground and side walls.
 * Returns an array of collision events: { type: 'ground' | 'wall', ball }
 */
export function resolveWorldCollisions(ball) {
  const events = [];
  const r = ball.radius || B.radius;

  // Ground
  if (ball.y + r > W.groundY) {
    ball.y = W.groundY - r;
    if (ball.vy > 0) {
      ball.vy = -ball.vy * W.groundRestitution;
      ball.vx *= W.groundFriction;
      events.push({ type: 'ground', ball });
    }
    if (Math.abs(ball.vy) < 15) ball.vy = 0;
    if (Math.abs(ball.vx) < 15) ball.vx *= 0.8;
    if (Math.abs(ball.vx) < 4) ball.vx = 0;
  }

  // Left wall
  if (ball.x - r < 0) {
    ball.x = r;
    if (ball.vx < 0) {
      ball.vx = -ball.vx * W.wallRestitution;
      events.push({ type: 'wall', ball });
    }
  }

  // Right wall
  if (ball.x + r > W.width) {
    ball.x = W.width - r;
    if (ball.vx > 0) {
      ball.vx = -ball.vx * W.wallRestitution;
      events.push({ type: 'wall', ball });
    }
  }

  return events;
}

/**
 * Resolve collision between two balls.
 * Returns a collision event: { type: 'ball', a, b, impactSpeed } or null.
 */
export function resolveBallCollision(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const rA = a.radius || B.radius;
  const rB = b.radius || B.radius;
  const minDist = rA + rB;

  if (dist >= minDist || dist === 0) return null;

  const speedAPre = Math.hypot(a.vx, a.vy);
  const speedBPre = Math.hypot(b.vx, b.vy);

  const overlap = minDist - dist;
  const nx = dx / dist;
  const ny = dy / dist;
  a.x -= (nx * overlap) / 2;
  a.y -= (ny * overlap) / 2;
  b.x += (nx * overlap) / 2;
  b.y += (ny * overlap) / 2;

  const rvx = b.vx - a.vx;
  const rvy = b.vy - a.vy;
  const velAlongNormal = rvx * nx + rvy * ny;

  if (velAlongNormal > 0) return null;

  const restitution = W.ballRestitution;
  const j = -(1 + restitution) * velAlongNormal;

  a.vx -= (j * nx) / 2;
  a.vy -= (j * ny) / 2;
  b.vx += (j * nx) / 2;
  b.vy += (j * ny) / 2;

  return {
    type: 'ball',
    a,
    b,
    impactSpeed: Math.abs(velAlongNormal),
    speedAPre,
    speedBPre,
  };
}

/**
 * Resolve collisions between a ball and static barrier rectangles or destructible obstacles.
 */
export function resolveBarrierCollisions(ball, barriers) {
  const events = [];
  const r = ball.radius || B.radius;

  for (const barrier of barriers) {
    if (barrier.active === false) continue;

    const cx = Math.max(barrier.x, Math.min(ball.x, barrier.x + barrier.w));
    const cy = Math.max(barrier.y, Math.min(ball.y, barrier.y + barrier.h));
    const dx = ball.x - cx;
    const dy = ball.y - cy;
    const distSq = dx * dx + dy * dy;

    if (distSq >= r * r) continue;

    const dist = Math.sqrt(distSq);
    let nx = 0;
    let ny = 0;
    let overlap = 0;

    if (dist > 0.0001) {
      nx = dx / dist;
      ny = dy / dist;
      overlap = r - dist;
    } else {
      const left = ball.x - barrier.x;
      const right = barrier.x + barrier.w - ball.x;
      const top = ball.y - barrier.y;
      const bottom = barrier.y + barrier.h - ball.y;
      const minSide = Math.min(left, right, top, bottom);
      if (minSide === left) { nx = -1; ny = 0; overlap = r + left; }
      else if (minSide === right) { nx = 1; ny = 0; overlap = r + right; }
      else if (minSide === top) { nx = 0; ny = -1; overlap = r + top; }
      else { nx = 0; ny = 1; overlap = r + bottom; }
    }

    // De-penetrate: push ball position outside barrier rectangle
    ball.x += nx * overlap;
    ball.y += ny * overlap;

    const velDot = ball.vx * nx + ball.vy * ny;
    if (velDot < 0) {
      const impactSpeed = Math.abs(velDot);

      // Only apply destruction logic if structure is destructible (has HP)
      if (barrier.hp !== undefined || barrier.maxHp !== undefined) {
        if (ball.ballType === 'juggernaut' || ball.isShard) {
          barrier.hp = 0;
          barrier.active = false;
        } else if (barrier.maxHp && impactSpeed >= 30) {
          const dmg = Math.round(impactSpeed * 0.15);
          barrier.hp = Math.max(0, (barrier.hp ?? barrier.maxHp) - dmg);
          if (barrier.hp <= 0) barrier.active = false;
        } else if (impactSpeed >= CONFIG.damage.barrierImpactMinSpeed) {
          const dmg = Math.round(impactSpeed * 0.05);
          barrier.hp = Math.max(0, (barrier.hp ?? CONFIG.damage.barrierHp) - dmg);
          if (barrier.hp <= 0) barrier.active = false;
        }
      }

      ball.vx -= (1 + W.wallRestitution) * velDot * nx;
      ball.vy -= (1 + W.wallRestitution) * velDot * ny;

      // Platform top resting & friction
      if (ny < -0.7) {
        if (Math.abs(ball.vy) < 25) ball.vy = 0;
        if (Math.abs(ball.vx) < 15) ball.vx *= 0.8;
      }

      // Only emit bounce event if impact speed is significant to avoid sfx spam
      if (impactSpeed >= 20) {
        events.push({ type: 'barrier', ball, barrier, side: { nx, ny }, impactSpeed });
      }
    }
  }

  return events;
}

export function stepBall(ball, dt) {
  applyForces(ball, dt);
  integrate(ball, dt);
  return resolveWorldCollisions(ball);
}

export function stepWorld(balls, dt, barriers = [], platforms = [], obstacles = []) {
  const events = [];

  const rects = [...barriers, ...platforms, ...obstacles];

  for (const ball of balls) {
    events.push(...stepBall(ball, dt));
    events.push(...resolveBarrierCollisions(ball, rects));
  }

  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      const evt = resolveBallCollision(balls[i], balls[j]);
      if (evt) events.push(evt);
    }
  }

  return events;
}

export function isSettled(ball) {
  return Math.hypot(ball.vx, ball.vy) < W.settleSpeed;
}