// ============================================================
// Icons — one shared line-icon set (24x24 SVG path data).
// Used as inline SVG in the DOM and as Path2D on canvases so the
// map, HUD and menus all speak the same visual language.
// ============================================================

export const ICON_PATHS = {
  swords: 'M14.5 17.5 3 6V3h3l11.5 11.5 M13 19l6-6 M16 16l4 4 M19 21l2-2 M14.5 6.5 18 3h3v3l-3.5 3.5 M5 14l4 4 M7 17l-3 3 M3 19l2 2',
  sword: 'M14.5 17.5 3 6V3h3l11.5 11.5 M13 19l6-6 M16 16l4 4 M19 21l2-2',
  skull: 'M12 3a8 8 0 0 0-8 8c0 2.4 1 4.4 2.5 5.8V21h11v-4.2A8 8 0 0 0 12 3z M9 11a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3z M15 11a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3z M10 21v-3 M14 21v-3',
  crown: 'M3 18h18 M3 18 2 7l5 4 5-7 5 7 5-4-1 11',
  question: 'M12 22a10 10 0 1 0 0-20a10 10 0 1 0 0 20z M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3 M12 17h.01',
  bag: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z M3 6h18 M16 10a4 4 0 0 1-8 0',
  tent: 'M3.5 21 12 4l8.5 17 M12 13l-4 8 M12 13l4 8 M2 21h20',
  target: 'M12 22a10 10 0 1 0 0-20a10 10 0 1 0 0 20z M12 18a6 6 0 1 0 0-12a6 6 0 1 0 0 12z M12 14a2 2 0 1 0 0-4a2 2 0 1 0 0 4z',
  flag: 'M4 22V3 M4 4h14l-3 4.5 3 4.5H4',
  check: 'M20 6 9 17l-5-5',
  heart: 'M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z',
  bolt: 'M13 2 3 14h9l-1 8 10-12h-9l1-8z',
  coin: 'M12 22a10 10 0 1 0 0-20a10 10 0 1 0 0 20z M15 9.5c0-1.4-1.3-2.5-3-2.5s-3 1.1-3 2.5 1.3 2 3 2.5 3 1.1 3 2.5-1.3 2.5-3 2.5-3-1.1-3-2.5 M12 5.5v13',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  shieldHalf: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z M12 2v20',
  layers: 'M12 2 2 7l10 5 10-5-10-5z M2 17l10 5 10-5 M2 12l10 5 10-5',
  soundOn: 'M11 5 6 9H2v6h4l5 4V5z M15.5 8.5a5 5 0 0 1 0 7 M19 5a10 10 0 0 1 0 14',
  soundOff: 'M11 5 6 9H2v6h4l5 4V5z M22 9l-6 6 M16 9l6 6',
  flame: 'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4.2 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3.3.5 1.2 1.4 2.3 2.5 2.8z',
  wall: 'M3 4h18v16H3z M3 12h18 M9 4v8 M15 12v8',
  trophy: 'M6 9H4.5a2.5 2.5 0 0 1 0-5H6 M18 9h1.5a2.5 2.5 0 0 0 0-5H18 M4 22h16 M10 14.7V17c0 .6-.5 1-1 1.2C7.9 18.8 7 20.2 7 22 M14 14.7V17c0 .6.5 1 1 1.2 1.1.6 2 2 2 3.8 M18 2H6v7a6 6 0 0 0 12 0V2z',
  play: 'M6 3l14 9-14 9V3z',
  chip: 'M6 6h12v12H6z M10 10h4v4h-4z M9 2v4 M15 2v4 M9 18v4 M15 18v4 M2 9h4 M2 15h4 M18 9h4 M18 15h4',
  lock: 'M5 11h14v11H5z M7 11V7a5 5 0 0 1 10 0v4',
  gem: 'M6 3h12l4 6-10 13L2 9z M11 3 8 9l4 13 4-13-3-6 M2 9h20',
  clipboard: 'M9 2h6v4H9z M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2 M8 12h8 M8 16h5',
  map: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z M9 3v15 M15 6v15',
  sparkle: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z M19 3v4 M17 5h4',
  retreat: 'M9 14 4 9l5-5 M4 9h11a5 5 0 0 1 0 10h-3',
};

/** Inline SVG markup for DOM use. Inherits color via currentColor. */
export function icon(name, size = 16, extraClass = '') {
  const d = ICON_PATHS[name];
  if (!d) return '';
  return `<svg class="ico ${extraClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
}

const pathCache = new Map();

/** Stroke an icon on a canvas, centered at (cx, cy); size and lineWidth are in pixels. */
export function drawIcon(ctx, name, cx, cy, size, color, lineWidth = 2) {
  const d = ICON_PATHS[name];
  if (!d) return;
  let p = pathCache.get(name);
  if (!p) {
    p = new Path2D(d);
    pathCache.set(name, p);
  }
  const s = size / 24;
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(s, s);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth / s;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(p);
  ctx.restore();
}
