// ============================================================
// SlingshotInput — click-drag-back slingshot mechanic.
// Click and hold on the player ball, drag backward (opposite of
// launch direction), see the predicted trajectory, release to fire.
// ============================================================

import { CONFIG } from '../config.js';
import { resolvePads, groundAt, slopeAt } from '../core/Physics.js';
import { clamp, length, normalize } from '../utils/math.js';

const S = CONFIG.slingshot;
const CANCEL_RADIUS = 55; // world units around the drag start that cancel the shot

export class SlingshotInput {
  constructor(canvas, events) {
    this.canvas = canvas;
    this.events = events;
    this.active = false;

    this.dragging = false;
    this.dragStart = { x: 0, y: 0 };
    this.dragCurrent = { x: 0, y: 0 };
    this.launchVelocity = null;
    this.trajectory = [];
    this.ballX = 0;
    this.ballY = 0;

    this.powerMult = 1; // launch power bonus from boons / gear
    // Your legs: the launch speed band you can use, optional elevation limits (degrees)
    this.move = { min: S.minPower, max: S.maxPower };
    this.placementMode = null; // null | 'barrier'
    this.placementPos = { x: 0, y: 0 };

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onPointerCancel = this._onPointerCancel.bind(this);

    canvas.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerCancel);
  }

  startBarrierPlacement() {
    this.placementMode = 'barrier';
    this.placementPos = { x: CONFIG.world.width * 0.5, y: groundAt(CONFIG.world.width * 0.5) - 50 };
  }

  cancelPlacement() {
    this.placementMode = null;
  }

  setActive(active) {
    this.active = active;
    if (!active) {
      this.dragging = false;
      this.launchVelocity = null;
      this.trajectory = [];
      this.placementMode = null;
    }
  }

  setAnchor(x, y, radius) {
    this.ballX = x;
    this.ballY = y;
    if (radius) this.ballRadius = radius; // ball classes scale the size
  }

  /** The renderer supplies the screen→world mapping for the full-bleed canvas. */
  setCoordinateMapper(fn) {
    this._toWorld = fn;
  }

  _getMousePos(e) {
    if (this._toWorld) return this._toWorld(e.clientX, e.clientY);
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = (this.canvas.width || CONFIG.world.width) / (rect.width || 1);
    const scaleY = (this.canvas.height || CONFIG.world.height) / (rect.height || 1);
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  _onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const pos = this._getMousePos(e);
    if (this.placementMode === 'barrier') {
      this.events.emit('place-barrier', { x: pos.x, y: pos.y });
      this.placementMode = null;
      return;
    }
    if (!this.active || this.dragging) return; // a second finger never restarts the aim
    try {
      e.target?.setPointerCapture?.(e.pointerId);
    } catch (_) {}
    this.dragging = true;
    this.dragPointer = e.pointerId;
    this.cancelArmed = false;
    this.inCancelZone = true;
    this.dragStart = pos;
    this.dragCurrent = pos;
    this.launchVelocity = null;
    this.trajectory = [];
  }

  _onPointerMove(e) {
    const pos = this._getMousePos(e);
    if (this.placementMode === 'barrier') {
      this.placementPos = pos;
      return;
    }
    if (!this.dragging || e.pointerId !== this.dragPointer) return;
    this.dragCurrent = pos;
    this._updateAim();
  }

  _onPointerUp(e) {
    // Only the finger that started the aim can fire it
    if (!this.dragging || (e?.pointerId !== undefined && e.pointerId !== this.dragPointer)) return;
    this.dragging = false;
    try {
      if (e && e.pointerId !== undefined) {
        e.target?.releasePointerCapture?.(e.pointerId);
      }
    } catch (_) {}

    if (this.launchVelocity) {
      const speed = length(this.launchVelocity.x, this.launchVelocity.y);
      if (speed >= S.minPower) {
        this.events.emit('player-launch', { velocity: this.launchVelocity });
      }
    }

    this.launchVelocity = null;
    this.trajectory = [];
  }

  _onPointerCancel(e) {
    if (e?.pointerId !== undefined && this.dragging && e.pointerId !== this.dragPointer) return;
    this.dragging = false;
    this.launchVelocity = null;
    this.trajectory = [];
  }

  _updateAim() {
    // Drag vector = current - start. Launch direction is the opposite.
    const dx = this.dragStart.x - this.dragCurrent.x;
    const dy = this.dragStart.y - this.dragCurrent.y;
    const dist = length(dx, dy);

    // Dragging back to where you started cancels the shot
    if (dist > CANCEL_RADIUS * 1.5) this.cancelArmed = true;
    this.inCancelZone = dist < CANCEL_RADIUS;
    if (this.inCancelZone) {
      this.launchVelocity = null;
      this.trajectory = [];
      return;
    }

    let dir = normalize(dx, dy);
    // Legs set the power band: the full drag always spans exactly what they can do
    const m = this.move;
    const lo = Math.max(S.minPower, m.min);
    const hi = Math.max(lo, m.max * this.powerMult);
    const pull = clamp(dist / S.maxDragDistance, 0, 1);
    const power = lo + (hi - lo) * pull;
    // ...and some legs only launch low (treads) or high (jump jets)
    if (m.minDeg !== undefined || m.maxDeg !== undefined) {
      const side = dir.x < 0 ? -1 : 1;
      const elev = clamp((Math.atan2(-dir.y, Math.abs(dir.x)) * 180) / Math.PI, m.minDeg ?? -90, m.maxDeg ?? 90);
      const r = (elev * Math.PI) / 180;
      dir = { x: Math.cos(r) * side, y: -Math.sin(r) };
    }

    this.launchVelocity = {
      x: dir.x * power,
      y: dir.y * power,
    };

    this._computeTrajectory();
  }

  /**
   * Simulate the trajectory using the same physics as the live game.
   */
  _computeTrajectory() {
    if (!this.launchVelocity) return;

    const ball = {
      x: this.ballX,
      y: this.ballY,
      vx: this.launchVelocity.x,
      vy: this.launchVelocity.y,
    };

    const points = [];
    const dt = S.trajectoryStep;
    const gravity = CONFIG.world.gravity;
    const airDrag = CONFIG.world.airDrag;
    const radius = this.ballRadius || CONFIG.ball.radius;

    let zeroG = this.zeroGTime || 0; // Graviton skill: straight flight first
    ball.radius = radius;
    const pads = this.pads || [];
    const sub = 6; // pad springs are stiff: integrate in small steps like the live game
    const h = dt / sub;
    let airborne = ball.y + radius < groundAt(ball.x) - 1;
    outer: for (let i = 0; i < S.trajectoryPoints; i++) {
      for (let j = 0; j < sub; j++) {
        if (zeroG > 0) {
          zeroG -= h;
        } else {
          ball.vy += gravity * (this.gravityMult || 1) * h;
          if (!this.ignoreWind) ball.vx += (CONFIG.world.wind || 0) * h; // preview bends with the wind
          const drag = 1 - airDrag * h;
          ball.vx *= drag;
          ball.vy *= drag;
        }
        ball.x += ball.vx * h;
        ball.y += ball.vy * h;
        if (pads.length) resolvePads(ball, pads, h);
        if (ball._padContact) continue; // bouncing off a pad: the preview follows it
        const gy = groundAt(ball.x);
        if (ball.y + radius > gy) {
          // A real landing ends the preview; a launch from rest slides along the ground.
          if (airborne) break outer;
          ball.y = gy - radius;
          const s = slopeAt(ball.x);
          if (ball.vy > s * ball.vx) ball.vy = s * ball.vx; // follow the surface, don't dig in
        } else if (ball.y + radius < gy - 1) {
          airborne = true;
        }
        if (ball.y < -600) break outer;
        if (ball.x < 0 || ball.x > CONFIG.world.width) break outer;
      }
      points.push({ x: ball.x, y: ball.y });
    }

    this.trajectory = points;
  }

  /**
   * Draw the slingshot band + trajectory preview.
   */
  draw(ctx) {
    if (this.placementMode === 'barrier') {
      const bw = 14;
      const bh = 90;
      const bx = this.placementPos.x - bw / 2;
      const by = Math.max(50, Math.min(groundAt(this.placementPos.x) - bh, this.placementPos.y - bh / 2));

      // Ghost wall (red while hovering the cancel zone); the hint text is drawn by the HUD
      const col = this.placementCancel ? '255, 93, 115' : '115, 239, 247';
      ctx.save();
      ctx.fillStyle = `rgba(${col}, 0.3)`;
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = `rgb(${col})`;
      ctx.lineWidth = 4;
      ctx.setLineDash([10, 8]);
      ctx.strokeRect(bx, by, bw, bh);
      ctx.restore();
      return;
    }

    if (!this.active || !this.dragging) return;

    // Cancel zone at the drag start: shown once you have pulled away from it
    if (this.cancelArmed) {
      const hot = this.inCancelZone;
      ctx.save();
      ctx.strokeStyle = hot ? '#ff5d73' : 'rgba(244, 244, 244, 0.5)';
      ctx.fillStyle = hot ? 'rgba(255, 93, 115, 0.25)' : 'rgba(16, 17, 28, 0.35)';
      ctx.lineWidth = 5;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.arc(this.dragStart.x, this.dragStart.y, CANCEL_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = hot ? '#ff5d73' : 'rgba(244, 244, 244, 0.7)';
      ctx.font = '700 20px "Pixelify Sans", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(hot ? 'RELEASE TO CANCEL' : 'CANCEL', this.dragStart.x, this.dragStart.y + 7);
      ctx.restore();
    }

    if (this.ballX !== undefined && this.dragStart && this.dragCurrent) {
      const dx = this.dragStart.x - this.dragCurrent.x;
      const dy = this.dragStart.y - this.dragCurrent.y;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 6;
      ctx.setLineDash([12, 8]);
      ctx.beginPath();
      ctx.moveTo(this.ballX, this.ballY);
      ctx.lineTo(this.ballX - dx, this.ballY - dy);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Square pixel dots, sized to stay visible when the arena is scaled down on phones
    if (this.trajectory.length > 0) {
      const n = this.trajectory.length;
      this.trajectory.forEach((p, i) => {
        const size = Math.round(10 - (i / n) * 4);
        ctx.fillStyle = '#000';
        ctx.fillRect(p.x - size / 2 + 2, p.y - size / 2 + 2, size, size);
        ctx.fillStyle = i % 2 ? '#41a6f6' : '#73eff7';
        ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
      });
    }
  }

  destroy() {
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerCancel);
  }
}