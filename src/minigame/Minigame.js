// ============================================================
// Minigame — a timing challenge played at MINIGAME map nodes.
// A moving indicator sweeps across a bar; the player clicks to
// stop it. Landing in the center band = hit (perfect if
// dead-center). Rewards scale with accuracy and are always
// granted (even a failed drill gives a small consolation).
// ============================================================

import { fitCanvas } from '../rendering/viewport.js';
import { soundEngine } from '../utils/SoundEngine.js';
import { haptics } from '../platform/haptics.js';

const FONT = '"Pixelify Sans", monospace';
const DISPLAY = '"Press Start 2P", monospace';

const MODES = {
  IDLE: 'idle',
  RUNNING: 'running',
  RESULT: 'result',
};

export class Minigame {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mode = MODES.IDLE;
    this.progress = 0; // 0..1 sweep position
    this.direction = 1;
    this.speed = 0.55; // sweeps per second
    this.totalAttempts = 5;
    this.hits = 0;
    this.perfects = 0;
    this.attemptsLeft = this.totalAttempts;
    this.perfect = false;
    this.result = null;
    this.lastFeedback = null; // { text, color, timer }
    this.feedbackTimer = 0;

    this._onClick = this._onClick.bind(this);
    // pointerdown (not click) so taps register instantly on touch screens
    this.canvas.addEventListener('pointerdown', this._onClick);
  }

  start() {
    this.mode = MODES.RUNNING;
    this.progress = 0;
    this.direction = 1;
    this.hits = 0;
    this.perfects = 0;
    this.attemptsLeft = this.totalAttempts;
    this.perfect = true;
    this.result = null;
    this.lastFeedback = null;
    this.feedbackTimer = 0;
    this._hitLog = [];
  }

  get isActive() {
    return this.mode !== MODES.IDLE;
  }

  update(dt) {
    if (this.mode !== MODES.RUNNING) return;

    this.progress += this.direction * this.speed * dt;
    if (this.progress > 1) {
      this.progress = 1;
      this.direction = -1;
    } else if (this.progress < 0) {
      this.progress = 0;
      this.direction = 1;
    }

    if (this.feedbackTimer > 0) this.feedbackTimer -= dt;
  }

  _onClick() {
    if (this.mode !== MODES.RUNNING) return;

    const distFromCenter = Math.abs(this.progress - 0.5);
    const isHit = distFromCenter <= 0.08;
    const isPerfect = distFromCenter <= 0.02;

    if (isPerfect) {
      this.perfects += 1;
      this.hits += 1;
      this._setFeedback('PERFECT!', '#a7f070');
      soundEngine.play('confirm');
      haptics.impact('heavy');
    } else if (isHit) {
      this.hits += 1;
      this._setFeedback('HIT', '#73eff7');
      soundEngine.play('select');
      haptics.impact('medium');
    } else {
      this.perfect = false;
      this._setFeedback('MISS', '#ff5d73');
      soundEngine.play('error');
      haptics.impact('light');
    }

    if (!isPerfect) this.perfect = false;
    this._hitLog.push(isHit);
    this.attemptsLeft -= 1;

    if (this.attemptsLeft <= 0) {
      this.mode = MODES.RESULT;
      const success = this.hits >= 3; // 3 of 5 hits to pass
      this.result = {
        success,
        perfect: success && this.perfect && this.hits === this.totalAttempts,
        hits: this.hits,
        perfects: this.perfects,
        totalAttempts: this.totalAttempts,
      };
    }
  }

  _setFeedback(text, color) {
    this.lastFeedback = { text, color };
    this.feedbackTimer = 0.6;
  }

  render() {
    const { ctx } = this;
    // Full-bleed canvas; everything below is laid out in CSS px
    const view = fitCanvas(this.canvas, 1280, 750);
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const w = view.cssW;
    const h = view.cssH;

    // Backdrop: dark panel grid
    ctx.fillStyle = '#10111c';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(115, 239, 247, 0.06)';
    for (let x = 0; x < w; x += 24) for (let y = 0; y < h; y += 24) ctx.fillRect(x, y, 2, 2);

    ctx.textAlign = 'center';
    ctx.font = `400 ${Math.min(18, w / 34)}px ${DISPLAY}`;
    ctx.fillStyle = '#000';
    ctx.fillText('PRECISION DRILL', w / 2 + 3, h * 0.17 + 3);
    ctx.fillStyle = '#ffcd75';
    ctx.fillText('PRECISION DRILL', w / 2, h * 0.17);
    ctx.font = `700 14px ${FONT}`;
    ctx.fillStyle = '#94b0c2';
    ctx.fillText('TAP ANYWHERE WHEN THE MARKER IS IN THE GREEN ZONE', w / 2, h * 0.17 + 24);

    // Bar
    const barW = Math.min(620, w * 0.78);
    const barX = Math.round(w / 2 - barW / 2);
    const barH = 36;
    const barY = Math.round(h * 0.5 - barH / 2);
    ctx.fillStyle = '#000';
    ctx.fillRect(barX - 4, barY - 4, barW + 12, barH + 12);
    ctx.fillStyle = '#333c57';
    ctx.fillRect(barX - 4, barY - 4, barW + 8, barH + 8);
    ctx.fillStyle = '#1a1c2c';
    ctx.fillRect(barX, barY, barW, barH);

    const bandW = Math.round(0.16 * barW);
    ctx.fillStyle = '#257179';
    ctx.fillRect(Math.round(barX + barW / 2 - bandW / 2), barY, bandW, barH);
    const perfectW = Math.max(6, Math.round(0.04 * barW));
    ctx.fillStyle = '#a7f070';
    ctx.fillRect(Math.round(barX + barW / 2 - perfectW / 2), barY, perfectW, barH);
    // Tick marks
    ctx.fillStyle = '#333c57';
    for (let i = 1; i < 10; i++) ctx.fillRect(Math.round(barX + (barW * i) / 10), barY + barH - 6, 2, 6);

    // Marker
    if (this.mode === MODES.RUNNING) {
      const ix = Math.round(barX + this.progress * barW);
      ctx.fillStyle = '#000';
      ctx.fillRect(ix - 3, barY - 14, 10, barH + 28);
      ctx.fillStyle = '#ffcd75';
      ctx.fillRect(ix - 4, barY - 16, 8, barH + 28);
      ctx.fillStyle = '#f4f4f4';
      ctx.fillRect(ix - 4, barY - 16, 8, 4);
    }

    // Attempt pips
    const pip = 14;
    const gap = 8;
    const total = this.totalAttempts * pip + (this.totalAttempts - 1) * gap;
    const used = this.totalAttempts - this.attemptsLeft;
    for (let i = 0; i < this.totalAttempts; i++) {
      const px = Math.round(w / 2 - total / 2 + i * (pip + gap));
      const py = barY + barH + 26;
      ctx.fillStyle = '#000';
      ctx.fillRect(px + 2, py + 2, pip, pip);
      ctx.fillStyle = i < used ? (i < this._hitLog?.length && this._hitLog[i] ? '#a7f070' : '#ff5d73') : '#333c57';
      ctx.fillRect(px, py, pip, pip);
    }
    ctx.font = `700 14px ${FONT}`;
    ctx.fillStyle = '#f4f4f4';
    ctx.fillText(`HITS ${this.hits}/${this.totalAttempts}  ·  NEED 3 TO PASS`, w / 2, barY + barH + 66);

    // Per-tap feedback
    if (this.lastFeedback && this.feedbackTimer > 0) {
      const pop = 1 + Math.max(0, this.feedbackTimer - 0.45) * 2;
      ctx.font = `400 ${Math.round(20 * pop)}px ${DISPLAY}`;
      ctx.fillStyle = '#000';
      ctx.fillText(this.lastFeedback.text, w / 2 + 3, barY - 30 + 3);
      ctx.fillStyle = this.lastFeedback.color;
      ctx.fillText(this.lastFeedback.text, w / 2, barY - 30);
    }

    // Result overlay
    if (this.mode === MODES.RESULT && this.result) {
      ctx.fillStyle = 'rgba(8, 9, 16, 0.85)';
      ctx.fillRect(0, 0, w, h);
      ctx.font = `400 ${Math.min(26, w / 22)}px ${DISPLAY}`;
      ctx.fillStyle = this.result.success ? '#a7f070' : '#ff5d73';
      ctx.fillText(this.result.perfect ? 'PERFECT!' : this.result.success ? 'SUCCESS' : 'DRILL FAILED', w / 2, h / 2 - 10);
      ctx.font = `700 16px ${FONT}`;
      ctx.fillStyle = '#dfe6ee';
      ctx.fillText(`Hits ${this.result.hits}/${this.result.totalAttempts}  ·  Perfects ${this.result.perfects}`, w / 2, h / 2 + 24);
    }
  }

  /** Consume a click after result shown: returns result and resets. */
  dismissResult() {
    if (this.mode !== MODES.RESULT) return null;
    const res = this.result;
    this.mode = MODES.IDLE;
    this.result = null;
    if (this.ctx && this.canvas) {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    return res;
  }

  destroy() {
    this.canvas.removeEventListener('pointerdown', this._onClick);
  }
}