// ============================================================
// SlingshotInput — click-drag-back slingshot mechanic.
// Click and hold on the player ball, drag backward (opposite of
// launch direction), see the predicted trajectory, release to fire.
// ============================================================

import { CONFIG } from '../config.js';
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

    this.powerMult = 1; // launch power bonus from boons / relics
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

  setAnchor(x, y) {
    this.ballX = x;
    this.ballY = y;
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
    if (!this.active) return;
    try {
      e.target?.setPointerCapture?.(e.pointerId);
    } catch (_) {}
    this.dragging = true;
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

    // Dragging back to where you started cancels the shot
    if (dist > CANCEL_RADIUS * 1.5) this.cancelArmed = true;
    this.inCancelZone = dist < CANCEL_RADIUS;
    if (this.inCancelZone) {
      this.launchVelocity = null;
      this.trajectory = [];
      return;
    }

    const dir = normalize(dx, dy);
    const clampedDist = clamp(dist, 0, S.maxDragDistance);
    const maxPower = S.maxPower * this.powerMult;
    const power = clamp(clampedDist * S.powerScale * this.powerMult, S.minPower, maxPower);

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
    const groundY = CONFIG.world.groundY;
    const radius = CONFIG.ball.radius;

    for (let i = 0; i < S.trajectoryPoints; i++) {
      ball.vy += gravity * dt;
      ball.vx += (CONFIG.world.wind || 0) * dt; // preview bends with the wind
      const drag = 1 - airDrag * dt;
      ball.vx *= drag;
      ball.vy *= drag;
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;

      if (ball.y + radius > groundY) break;
      if (ball.x < 0 || ball.x > CONFIG.world.width) break;

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
      const by = Math.max(50, Math.min(CONFIG.world.groundY - bh, this.placementPos.y - bh / 2));

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