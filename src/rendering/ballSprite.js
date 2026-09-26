// ============================================================
// ballSprite — paints the 16×16 pixel ball used both in battle
// (Renderer) and on the class / skin select screen (UIManager),
// so a skin always looks the same everywhere.
// ============================================================

const INK = '#1a1c2c';
const N = 16;
const MID = (N - 1) / 2;

function lighten(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s) => Math.min(255, Math.round(((n >> s) & 255) + (255 - ((n >> s) & 255)) * amt));
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

/**
 * Pixel patterns painted over the ball body. `px(x, y, color)` only paints
 * inside the ball, so patterns can be drawn without worrying about edges.
 */
const PATTERNS = {
  chevron(px, a) {
    [[7, 5], [8, 5], [6, 6], [9, 6], [5, 7], [10, 7], [5, 8], [10, 8]].forEach(([x, y]) => px(x, y, a));
    [[7, 8], [8, 8], [6, 9], [9, 9]].forEach(([x, y]) => px(x, y, a));
  },
  camo(px, a, dark) {
    [[4, 6], [5, 6], [5, 7], [9, 4], [10, 4], [10, 5], [7, 10], [8, 10], [8, 11], [11, 9], [3, 9]].forEach(([x, y]) => px(x, y, a));
    [[6, 3], [7, 3], [11, 7], [12, 7], [4, 11], [5, 11], [9, 8]].forEach(([x, y]) => px(x, y, dark));
  },
  cross(px, a) {
    for (let i = 4; i <= 11; i++) { px(7, i, a); px(8, i, a); }
    for (let i = 5; i <= 10; i++) { px(i, 6, a); px(i, 7, a); }
  },
  crown(px, a) {
    [[4, 6], [7, 5], [8, 5], [11, 6]].forEach(([x, y]) => px(x, y, a));
    for (let x = 4; x <= 11; x++) { px(x, 8, a); px(x, 9, a); }
    [[4, 7], [6, 7], [7, 6], [8, 6], [9, 7], [11, 7]].forEach(([x, y]) => px(x, y, a));
  },
  rivets(px, a) {
    for (let i = 4; i <= 11; i++) { px(i, 4, a); px(i, 11, a); px(4, i, a); px(11, i, a); }
    [[6, 6], [9, 6], [6, 9], [9, 9]].forEach(([x, y]) => px(x, y, a));
  },
  cracks(px, a) {
    [[3, 5], [4, 6], [5, 6], [6, 7], [7, 7], [8, 8], [9, 8], [10, 9], [11, 10], [8, 9], [8, 10], [7, 11], [9, 4], [9, 5], [10, 3]].forEach(([x, y]) => px(x, y, a));
  },
  lava(px, a) {
    const hot = '#ffcd75';
    [[3, 7], [4, 7], [5, 8], [6, 8], [7, 9], [8, 9], [9, 8], [10, 8], [11, 7], [12, 7], [7, 10], [7, 11], [6, 12], [9, 7], [9, 6], [10, 5], [10, 4], [5, 5], [4, 4]].forEach(([x, y]) => px(x, y, a));
    [[7, 9], [8, 9], [9, 7], [5, 8]].forEach(([x, y]) => px(x, y, hot));
  },
  bolt(px, a) {
    [[9, 3], [8, 4], [8, 5], [7, 6], [6, 7], [7, 7], [8, 7], [9, 7], [8, 8], [7, 9], [7, 10], [6, 11], [6, 12]].forEach(([x, y]) => px(x, y, a));
  },
  stripe(px, a) {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (x + y >= 13 && x + y <= 16) px(x, y, a);
  },
  scales(px, a) {
    for (let y = 2; y < N; y += 3) for (let x = (y % 2) + 2; x < N; x += 4) { px(x, y, a); px(x + 1, y, a); }
  },
  streak(px, a) {
    [[9, 9], [10, 10], [11, 11], [12, 12], [7, 10], [8, 11], [9, 12], [10, 9], [11, 8], [12, 9]].forEach(([x, y]) => px(x, y, a));
    px(5, 5, '#ffffff'); px(6, 6, '#ffffff');
  },
  dots(px, a) {
    [[5, 6], [6, 6], [5, 7], [6, 7], [9, 5], [10, 5], [9, 6], [10, 6], [8, 9], [9, 9], [8, 10], [9, 10], [4, 10]].forEach(([x, y]) => px(x, y, a));
  },
  confetti(px) {
    const cols = ['#ff5d73', '#41a6f6', '#a7f070', '#ffcd75', '#c46fd6'];
    [[4, 5], [7, 3], [10, 5], [12, 8], [5, 9], [8, 7], [10, 11], [6, 12], [3, 8], [9, 9], [11, 3]].forEach(([x, y], i) => px(x, y, cols[i % cols.length]));
  },
  checker(px, a) {
    for (let y = 1; y < N; y++) for (let x = 1; x < N; x++) if ((Math.floor(x / 2) + Math.floor(y / 2)) % 2 === 0 && (x + y) % 2 === 0) px(x, y, a);
  },
  star(px, a) {
    [[7, 3], [8, 3], [7, 4], [8, 4], [7, 5], [8, 5]].forEach(([x, y]) => px(x, y, a));
    for (let x = 3; x <= 12; x++) px(x, 6, a);
    for (let x = 5; x <= 10; x++) px(x, 7, a);
    for (let x = 6; x <= 9; x++) px(x, 8, a);
    [[5, 9], [6, 9], [9, 9], [10, 9], [4, 10], [5, 10], [10, 10], [11, 10]].forEach(([x, y]) => px(x, y, a));
  },
  orbit(px, a) {
    for (let t = 0; t < 64; t++) {
      const ang = (t / 64) * Math.PI * 2;
      px(Math.round(MID + Math.cos(ang) * 6), Math.round(MID + Math.sin(ang) * 2.2), a);
    }
    [[7, 7], [8, 7], [7, 8], [8, 8]].forEach(([x, y]) => px(x, y, a));
  },
  ring(px, a) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const d = Math.hypot(x - MID, y - MID);
        if (d > 3.6 && d < 4.8) px(x, y, a);
      }
    }
  },
  wave(px, a) {
    for (let x = 0; x < N; x++) {
      const y = Math.round(MID + Math.sin(x / 2.2) * 2);
      px(x, y, a); px(x, y + 1, a);
      px(x, y - 4, a);
    }
  },
};

/**
 * Paint a ball into a 16×16 2D context.
 * @param {object} o { color, darkColor, accent, pattern, radius (≤7.6), flash, enemyEmblem }
 */
export function paintBall(g, o) {
  const r = o.radius ?? 7.6;
  const base = o.flash ? '#f4f4f4' : o.color;
  const light = o.flash ? '#ffffff' : lighten(o.color, 0.28);
  const dark = o.flash ? '#c2c3c7' : o.darkColor;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = x - MID;
      const dy = y - MID;
      const d = Math.hypot(dx, dy);
      if (d > r) continue;
      let col = base;
      if (d > r - 1) col = INK; // outline
      else {
        const shade = (dx + dy) / r; // light from top-left
        if (shade < -0.55) col = light;
        else if (shade > 0.45) col = dark;
      }
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    }
  }

  if (!o.flash && o.pattern && PATTERNS[o.pattern]) {
    const inner = r - 1.2;
    const px = (x, y, c) => {
      if (Math.hypot(x - MID, y - MID) > inner) return;
      g.fillStyle = c;
      g.fillRect(x, y, 1, 1);
    };
    PATTERNS[o.pattern](px, o.accent || 'rgba(26, 28, 44, 0.75)', dark);
  }

  // Specular highlight
  if (r > 6) {
    g.fillStyle = '#ffffff';
    g.fillRect(4, 4, 2, 1);
    g.fillRect(4, 5, 1, 1);
  }
}

/** Default pattern for a class when the skin has none. */
export const CLASS_PATTERN = {
  vanguard: 'chevron',
  juggernaut: 'rivets',
  striker: 'bolt',
  cluster: 'dots',
  graviton: 'orbit',
};

/** Data-URL sprite for DOM <img> (select screens). */
export function ballDataUrl(look, radiusMult = 1) {
  const c = document.createElement('canvas');
  c.width = N;
  c.height = N;
  paintBall(c.getContext('2d'), { ...look, radius: 7.6 * Math.min(1, 0.72 + radiusMult * 0.28) });
  return c.toDataURL();
}
