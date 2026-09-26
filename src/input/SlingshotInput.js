// ============================================================
// SlingshotInput — click-drag-back slingshot mechanic.
// Click and hold on the player ball, drag backward (opposite of
// launch direction), see the predicted trajectory, release to fire.
// ============================================================

import { CONFIG } from '../config.js';
import { clamp, length, normalize } from '../utils/math.js';
import { applyForces, integrate, resolveWorldCollisions } from '../core/Physics.js';

const S = CONFIG.slingshot;

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
    this.ballRadius = CONFIG.ball.radius;

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
    this.placementPos = { x: CONFIG.world.width * 0.5, y: CONFIG.world.groundY - 50 };
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
    if (radius) this.ballRadius = radius;
  }

  _getMousePos(e) {
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
    if (!this.active) return;
    try {
      e.target?.setPointerCapture?.(e.pointerId);
    } catch (_) {}
    this.dragging = true;
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
    if (!this.dragging) return;
    this.dragCurrent = pos;
    this._updateAim();
  }

  _onPointerUp(e) {
    if (!this.dragging) return;
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

  _onPointerCancel() {
    this.dragging = false;
    this.launchVelocity = null;
    this.trajectory = [];
  }

  _updateAim() {
    // Drag vector = current - start. Launch direction is the opposite.
    const dx = this.dragStart.x - this.dragCurrent.x;
    const dy = this.dragStart.y - this.dragCurrent.y;
    const dist = length(dx, dy);

    if (dist < 5) {
      this.launchVelocity = null;
      this.trajectory = [];
      return;
    }

    const dir = normalize(dx, dy);
    const clampedDist = clamp(dist, 0, S.maxDragDistance);
    const power = clamp(clampedDist * S.powerScale, S.minPower, S.maxPower);

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
      radius: this.ballRadius,
    };

    const points = [];
    const dt = S.trajectoryStep;
    const groundY = CONFIG.world.groundY;

    for (let i = 0; i < S.trajectoryPoints; i++) {
      const airborne = ball.y + ball.radius < groundY - 1;
      applyForces(ball, dt);
      integrate(ball, dt);
      const events = resolveWorldCollisions(ball);

      points.push({ x: ball.x, y: ball.y });

      // Stop at a wall hit or once the ball lands after being in the air.
      // Sliding along the ground from a resting launch keeps the preview going.
      if (events.some((ev) => ev.type === 'wall' || (ev.type === 'ground' && airborne))) break;
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
      const by = Math.max(50, Math.min(CONFIG.world.groundY - bh, this.placementPos.y - bh / 2));

      ctx.save();
      ctx.fillStyle = 'rgba(122, 162, 255, 0.25)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = '#7aa2ff';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(bx, by, bw, bh);
      ctx.setLineDash([]);

      ctx.fillStyle = '#7aa2ff';
      ctx.font = '600 12px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('CLICK / RELEASE TO PLACE BARRIER', this.placementPos.x, by - 12);
      ctx.restore();
      return;
    }

    if (!this.active || !this.dragging) return;

    if (this.ballX !== undefined && this.dragStart && this.dragCurrent) {
      const dx = this.dragStart.x - this.dragCurrent.x;
      const dy = this.dragStart.y - this.dragCurrent.y;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(this.ballX, this.ballY);
      ctx.lineTo(this.ballX - dx, this.ballY - dy);
      ctx.stroke();
    }

    if (this.trajectory.length > 0) {
      ctx.fillStyle = CONFIG.colors.trajectory;
      for (const p of this.trajectory) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  destroy() {
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerCancel);
  }
}