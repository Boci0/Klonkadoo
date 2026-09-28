// ============================================================
// fxDraw — special effects (meta/Raid.js EFFECTS): pixel particles around a
// mech's torso. No state: every particle is a function of time, so the
// battle Renderer and the Rig bay canvas both just call drawEffect.
// ============================================================

import { EFFECTS } from '../meta/Raid.js';

/**
 * Draw effect `id` around a torso box: centre `cx`, top `top`, size `w` x `h`,
 * `px` = one sprite pixel, `now` in ms.
 */
export function drawEffect(ctx, id, cx, top, w, h, px, now) {
  const fx = EFFECTS[id];
  if (!fx) return;
  const t = now / 1000;
  const sq = (x, y, s, c, a = 1) => {
    ctx.globalAlpha = Math.max(0, Math.min(1, a));
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(s)), Math.max(1, Math.round(s)));
  };
  ctx.save();
  if (id === 'fx_ember') {
    // Embers rise off the torso and fade
    for (let i = 0; i < 8; i++) {
      const k = (t * 0.6 + i / 8) % 1;
      const x = cx + Math.sin(i * 2.3 + t * 1.5) * w * 0.45;
      const y = top + h - k * (h + 6 * px);
      sq(x, y, px * (k < 0.5 ? 1.5 : 1), k < 0.4 ? '#ffcd75' : '#ef7d57', 1 - k);
    }
  } else if (id === 'fx_static') {
    // Short zigzag sparks flicker around the torso
    const col = fx.color;
    for (let i = 0; i < 4; i++) {
      if (Math.floor(t * 9 + i * 3) % 3 === 0) continue;
      const a = i * (Math.PI / 2) + Math.floor(t * 4) * 0.9;
      let x = cx + Math.cos(a) * w * 0.6;
      let y = top + h / 2 + Math.sin(a) * h * 0.6;
      for (let s = 0; s < 4; s++) {
        sq(x, y, px, s % 2 ? '#f4f4f4' : col, 0.9);
        x += px * (s % 2 ? 1 : -1);
        y -= px;
      }
    }
  } else if (id === 'fx_glint') {
    // Plus-shaped glints blink across the torso
    for (let i = 0; i < 3; i++) {
      const k = (t * 0.8 + i / 3) % 1;
      if (k > 0.35) continue;
      const a = 1 - Math.abs(k - 0.17) / 0.17;
      const x = cx + (((i * 37) % 10) / 10 - 0.5) * w * 0.8;
      const y = top + (((i * 53) % 10) / 10) * h * 0.8;
      const arm = Math.round(px * (1 + a * 1.5));
      sq(x - px / 2, y - arm, px, fx.color, a);
      sq(x - px / 2, y + px, px, fx.color, a);
      sq(x - arm - px / 2, y, arm, fx.color, a);
      sq(x + px / 2, y, arm, fx.color, a);
      sq(x - px / 2, y, px, '#ffcd75', a);
    }
  }
  ctx.restore();
}
