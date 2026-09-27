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

// ---------- Terrain ----------
// Optional per-arena height profile: control points { x, y } joined by
// smooth (cosine) curves, so the ground is flat exactly at each point.
// With no terrain the ground is the flat line W.groundY.

let terrain = null;

/** Set the active height profile (null / empty = flat ground). */
export function setTerrain(points) {
  terrain = points && points.length > 1 ? [...points].sort((a, b) => a.x - b.x) : null;
}

export function getTerrain() {
  return terrain;
}

function segmentAt(x) {
  for (let i = 1; i < terrain.length; i++) {
    if (x <= terrain[i].x) return i;
  }
  return terrain.length - 1;
}

/** Ground surface height (y) at x. */
export function groundAt(x) {
  if (!terrain) return W.groundY;
  if (x <= terrain[0].x) return terrain[0].y;
  if (x >= terrain[terrain.length - 1].x) return terrain[terrain.length - 1].y;
  const i = segmentAt(x);
  const a = terrain[i - 1];
  const b = terrain[i];
  const t = (x - a.x) / (b.x - a.x);
  return a.y + (b.y - a.y) * (1 - Math.cos(Math.PI * t)) / 2;
}

/** Ground slope dy/dx at x (positive = ground drops to the right, since y grows downward). */
export function slopeAt(x) {
  if (!terrain || x <= terrain[0].x || x >= terrain[terrain.length - 1].x) return 0;
  const i = segmentAt(x);
  const a = terrain[i - 1];
  const b = terrain[i];
  const t = (x - a.x) / (b.x - a.x);
  return ((b.y - a.y) * Math.PI * Math.sin(Math.PI * t)) / (2 * (b.x - a.x));
}

// A slow ball stays put on slopes gentler than this (~24°), so turns can settle
const STATIC_SLOPE = 0.45;
// Falling faster than this onto the ground is a landing (it bites into the skid)
const LANDING_SPEED = 80;

/**
 * Apply gravity + air drag to a ball's velocity.
 */
export function applyForces(ball, dt) {
  // Zero-G (Graviton skill): the shot flies dead straight for a moment
  if (ball.zeroG > 0) {
    ball.zeroG -= dt;
    return;
  }
  ball.vy += W.gravity * (ball.gravityMult || 1) * dt;
  // Arena wind pushes airborne balls sideways (W.wind is set per battle)
  if (W.wind && ball.y + (ball.radius || B.radius) < groundAt(ball.x) - 2) ball.vx += W.wind * dt;
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
export function resolveWorldCollisions(ball, dt = 1 / 120) {
  const events = [];
  const r = ball.radius || B.radius;

  // Class bounce scales restitution (Juggernaut thuds, Cluster ricochets)
  const bounce = ball.bounce || 1;
  const groundE = Math.min(0.9, W.groundRestitution * bounce);
  const wallE = Math.min(0.95, W.wallRestitution * bounce);

  // Ground (flat, or the arena's terrain). On flat ground this is exactly the old rule.
  const s = slopeAt(ball.x);
  if (s === 0) {
    const gy = groundAt(ball.x);
    if (ball.y + r > gy) {
      ball.y = gy - r;
      if (ball.vy > 0) {
        if (ball.vy > LANDING_SPEED) ball.vx *= W.groundFriction; // a real landing, not resting contact
        ball.vy = -ball.vy * groundE;
        events.push({ type: 'ground', ball });
      }
      if (Math.abs(ball.vy) < 15) ball.vy = 0;
      ball.vx = skid(ball.vx, dt);
      if (Math.abs(ball.vx) < 15) ball.vx *= 0.8;
      if (Math.abs(ball.vx) < 4) ball.vx = 0;
    }
  } else {
    // Sloped ground: collide along the surface normal
    const len = Math.hypot(1, s);
    const nx = s / len; // upward normal (y grows downward)
    const ny = -1 / len;
    const tx = 1 / len; // tangent, pointing right along the surface
    const ty = s / len;
    const dist = (groundAt(ball.x) - ball.y) / len; // centre-to-surface distance
    if (dist < r) {
      ball.x += nx * (r - dist);
      ball.y += ny * (r - dist);
      let vn = ball.vx * nx + ball.vy * ny;
      let vt = ball.vx * tx + ball.vy * ty;
      if (vn < 0) {
        if (-vn > LANDING_SPEED) vt *= W.groundFriction;
        vn = -vn * groundE;
        events.push({ type: 'ground', ball });
      }
      if (Math.abs(vn) < 15) vn = 0;
      if (vn === 0) vt = skid(vt, dt);
      // Static friction: a slow ball rests on gentle slopes; steep ones keep it rolling
      if (vn === 0 && Math.abs(vt) < 20 && Math.abs(s) < STATIC_SLOPE) vt = 0;
      ball.vx = vn * nx + vt * tx;
      ball.vy = vn * ny + vt * ty;
    }
  }

  // Left wall
  if (ball.x - r < 0) {
    ball.x = r;
    if (ball.vx < 0) {
      ball.vx = -ball.vx * wallE;
      events.push({ type: 'wall', ball });
    }
  }

  // Right wall
  if (ball.x + r > W.width) {
    ball.x = W.width - r;
    if (ball.vx > 0) {
      ball.vx = -ball.vx * wallE;
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

  // Railgun (Striker skill): pass straight through each enemy once, nudging it aside
  const pierce = a.piercing && b.team !== a.team ? a : b.piercing && a.team !== b.team ? b : null;
  if (pierce) {
    const other = pierce === a ? b : a;
    if (!pierce.pierced || pierce.pierced.has(other)) return null;
    pierce.pierced.add(other);
    other.vx += pierce.vx * 0.25;
    other.vy -= 220;
    const sp = pierce === a ? speedAPre : speedBPre;
    return { type: 'ball', a: pierce, b: other, impactSpeed: sp, speedAPre: sp, speedBPre: 0, aVyPre: pierce.vy, bVyPre: other.vy, pierce: true };
  }
  const aVyPre = a.vy;
  const bVyPre = b.vy;

  const overlap = minDist - dist;
  const nx = dx / dist;
  const ny = dy / dist;
  // Heavier balls get pushed less when separating and when trading momentum
  const ma = a.mass || 1;
  const mb = b.mass || 1;
  const shareA = mb / (ma + mb);
  const shareB = ma / (ma + mb);
  a.x -= nx * overlap * shareA;
  a.y -= ny * overlap * shareA;
  b.x += nx * overlap * shareB;
  b.y += ny * overlap * shareB;

  const rvx = b.vx - a.vx;
  const rvy = b.vy - a.vy;
  const velAlongNormal = rvx * nx + rvy * ny;

  if (velAlongNormal > 0) return null;

  const restitution = W.ballRestitution;
  const j = (-(1 + restitution) * velAlongNormal) / (1 / ma + 1 / mb);

  a.vx -= (j * nx) / ma;
  a.vy -= (j * ny) / ma;
  b.vx += (j * nx) / mb;
  b.vy += (j * ny) / mb;

  return {
    type: 'ball',
    a,
    b,
    impactSpeed: Math.abs(velAlongNormal),
    speedAPre,
    speedBPre,
    aVyPre,
    bVyPre,
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

      // Bodies never damage barriers or breakable walls: only gunfire does (Game._shoot)

      const e = Math.min(0.95, W.wallRestitution * (ball.bounce || 1));
      ball.vx -= (1 + e) * velDot * nx;
      ball.vy -= (1 + e) * velDot * ny;

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

/**
 * Spring pads: the plate is a stiff spring. Pressing into it pushes back in
 * proportion to the compression (Hooke's law), a little harder on the way
 * out (a powered spring), so a fast landing flings you high and a gentle
 * one barely bounces. Horizontal momentum is untouched. The housing below
 * the plate is solid: balls rolling into its side bounce off.
 * `live` marks real pads (compression is stored for the renderer).
 */
export const PAD = { rest: 22, maxCompress: 20, k: 4200, kick: 1.45, flash: 0.5 };

export function resolvePads(ball, pads, dt, live = false) {
  const events = [];
  const r = ball.radius || B.radius;
  const top = W.groundY - PAD.rest;
  let contact = false;
  for (const pad of pads) {
    if (pad.type !== 'pad') continue;
    const bottom = ball.y + r;
    if (bottom <= top) continue;

    if (ball.x <= pad.x || ball.x >= pad.x + pad.w) {
      // Side of the housing: a solid edge from the plate down to the ground
      const edge = ball.x <= pad.x ? pad.x : pad.x + pad.w;
      const side = ball.x < edge ? -1 : 1;
      if (Math.abs(ball.x - edge) < r && bottom > top + 8) {
        ball.x = edge + side * r;
        if (ball.vx * side < 0) ball.vx = -ball.vx * W.wallRestitution;
      }
      continue;
    }

    let p = bottom - top;
    if (p > PAD.maxCompress) {
      // Bottomed out: the coil is fully squashed and acts like the floor
      p = PAD.maxCompress;
      ball.y = top + p - r;
      if (ball.vy > 0) ball.vy *= 0.5;
    }
    if (!ball._padContact) {
      // A real landing fires the powered kick once per ball per turn (Game
      // clears _padsFired each turn); after that the plate is a plain, lossy
      // spring, so a ball bouncing in place dies down instead of hopping
      // higher forever. Preview / AI probes are fresh objects, so they
      // predict the same thing.
      const fired = ball._padsFired || (ball._padsFired = new Set());
      ball._padKick = !fired.has(pad) && ball.vy > 250;
      if (ball._padKick) {
        fired.add(pad);
        if (live) pad.cooldown = PAD.flash;
      }
      if (ball.vy > 150) events.push({ type: 'pad', ball, pad, impactSpeed: ball.vy, kick: ball._padKick });
    }
    const k = ball.vy > 0 ? PAD.k : PAD.k * (ball._padKick ? PAD.kick : 0.5);
    ball.vy -= k * p * dt;
    contact = true;
    if (live) pad.compress = Math.max(pad.compress || 0, p);
  }
  ball._padContact = contact;
  return events;
}

/** Ground braking: mechs skid to a stop instead of rolling on. */
function skid(v, dt) {
  const cut = W.rollDecel * dt;
  return Math.abs(v) <= cut ? 0 : v - Math.sign(v) * cut;
}

export function stepBall(ball, dt) {
  applyForces(ball, dt);
  integrate(ball, dt);
  return resolveWorldCollisions(ball, dt);
}

export function stepWorld(balls, dt, barriers = [], platforms = [], obstacles = [], pads = []) {
  const events = [];

  const rects = [...barriers, ...platforms, ...obstacles];

  for (const ball of balls) {
    events.push(...stepBall(ball, dt));
    events.push(...resolvePads(ball, pads, dt, true));
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