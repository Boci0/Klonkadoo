// ============================================================
// Viewport — full-bleed canvas sizing shared by the battle
// renderer and the minigame.
//
// The canvas fills its box at device resolution. The fixed-size
// world (1280×750) is scaled up as far as the width allows (optionally
// cropping empty sky off the top) and centred, with its ground pinned
// to the bottom edge; leftover space is decorative background.
// ============================================================

// Cap the backing-store resolution: 3x phones gain nothing visible
// for pixel art, and 2x halves the fill cost.
const MAX_DPR = 2;

/**
 * @param {number} [cropTop=0] world units of sky that may be cropped off the
 *   top on wide screens so the action can be drawn larger.
 */
export function fitCanvas(canvas, worldW, worldH, cropTop = 0) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
  const cssW = Math.max(1, rect.width);
  const cssH = Math.max(1, rect.height);
  const w = Math.round(cssW * dpr);
  const h = Math.round(cssH * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const k = Math.min(w / worldW, h / (worldH - cropTop));
  return {
    w,
    h,
    dpr,
    cssW,
    cssH,
    k, // device px per world unit
    ox: (w - worldW * k) / 2,
    oy: h - worldH * k, // extra height (tall screens) becomes sky above the world
    rect,
  };
}

/** Client (viewport) coordinates → world coordinates for a fitted view. */
export function clientToWorld(view, clientX, clientY) {
  const px = (clientX - view.rect.left) * view.dpr;
  const py = (clientY - view.rect.top) * view.dpr;
  return { x: (px - view.ox) / view.k, y: (py - view.oy) / view.k };
}
