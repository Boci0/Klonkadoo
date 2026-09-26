// ============================================================
// RogueMapRenderer — draws the tactical run map in a pixel-art
// style: floor graph with node tiles, connections, lock states,
// and the player's current position.
//
// The canvas fills its container at device resolution. The floor
// is auto-fitted to the available space; the player can then pan
// (drag), zoom (pinch / wheel / buttons) on top of that fit.
// ============================================================

import { CONFIG } from '../config.js';

// Node type → label + icon + color + subtitle
export const NODE_STYLE = {
  entry: { label: 'ENTRY POINT', tag: 'Start Sector', short: 'START', icon: 'S', color: '#41a6f6' },
  combat: { label: 'COMBAT ZONE', tag: 'Normal Sector', short: 'FIGHT', icon: 'X', color: '#e0556d' },
  elite: { label: 'ELITE HOSTILE', tag: 'High Risk Area', short: 'ELITE', icon: 'E', color: '#ef7d57' },
  miniboss: { label: 'MINI-BOSS', tag: 'Commander', short: 'BOSS', icon: 'M', color: '#ef7d57' },
  boss: { label: 'FINAL SECTOR', tag: 'Target Area', short: 'BOSS', icon: 'B', color: '#ef7d57' },
  encounter: { label: 'UNKNOWN FOG', tag: 'Dense Fog', short: '???', icon: '?', color: '#c46fd6' },
  shop: { label: 'SUPPLY DEPOT', tag: 'Trading Post', short: 'SHOP', icon: '$', color: '#ffcd75' },
  rest: { label: 'SAFE ZONE', tag: 'Outpost', short: 'REST', icon: '+', color: '#a7f070' },
  minigame: { label: 'DRILL ZONE', tag: 'Calibration', short: 'DRILL', icon: '*', color: '#73eff7' },
  treasure: { label: 'TREASURE', tag: 'Free Relic', short: 'LOOT', icon: '#', color: '#ffcd75' },
  gamble: { label: 'GAMBLE', tag: 'Risky Bet', short: 'BET', icon: '%', color: '#f4f4f4' },
  shrine: { label: 'CURSE SHRINE', tag: 'Dark Bargain', short: 'CURSE', icon: '!', color: '#ff5d73' },
};

// Node tile size in map units (also used for tap hit-testing)
export const NODE_TILE = { w: 136, h: 104 };

// 9×9 pixel icons ('X' = lit pixel)
const ICONS = {
  combat: [
    '........X', '.......XX', '......XX.', '.....XX..', 'X...XX...',
    '.X.XX....', '..XX.....', '.X.X.....', 'X...X....',
  ],
  elite: [
    '..XXXXX..', '.XXXXXXX.', 'XXXXXXXXX', 'XX..X..XX', 'XX..X..XX',
    'XXXXXXXXX', '.XXX.XXX.', '..X.X.X..', '..XXXXX..',
  ],
  encounter: [
    '..XXXXX..', '.XX...XX.', '.XX...XX.', '......XX.', '....XXX..',
    '....XX...', '.........', '....XX...', '....XX...',
  ],
  shop: [
    '....X....', '..XXXXX..', '.XX.X....', '.XX.X....', '..XXXXX..',
    '....X.XX.', '....X.XX.', '..XXXXX..', '....X....',
  ],
  rest: [
    '.........', '.XX...XX.', 'XXXX.XXXX', 'XXXXXXXXX', 'XXXXXXXXX',
    '.XXXXXXX.', '..XXXXX..', '...XXX...', '....X....',
  ],
  minigame: [
    '...XXX...', '.XX...XX.', '.X.....X.', 'X...X...X', 'X..XXX..X',
    'X...X...X', '.X.....X.', '.XX...XX.', '...XXX...',
  ],
  entry: [
    '.X.......', '.XXXXX...', '.XXXXXXX.', '.XXXXX...', '.X.......',
    '.X.......', '.X.......', '.X.......', 'XXX......',
  ],
  cleared: [
    '.........', '........X', '.......XX', '......XX.', 'X....XX..',
    'XX..XX...', '.XXXX....', '..XX.....', '.........',
  ],
};
ICONS.treasure = [
  '.........', '.XXXXXXX.', 'X.......X', 'XXXXXXXXX', 'X...X...X',
  'X..XXX..X', 'X...X...X', 'XXXXXXXXX', '.........',
];
ICONS.gamble = [
  'XXXXXXXXX', 'X.......X', 'X.X...X.X', 'X.......X', 'X...X...X',
  'X.......X', 'X.X...X.X', 'X.......X', 'XXXXXXXXX',
];
ICONS.shrine = [
  '.........', '...XXX...', '.XX...XX.', 'X...X...X', 'X..XXX..X',
  'X...X...X', '.XX...XX.', '...XXX...', '.........',
];
ICONS.miniboss = ICONS.elite;
ICONS.boss = ICONS.elite;

const PAL = {
  bg: '#10111c',
  grid: 'rgba(115, 239, 247, 0.06)',
  tile: '#1a1c2c',
  tileLocked: '#151724',
  edge: '#333c57',
  edgeOpen: '#ffcd75',
  edgeCleared: '#38b764',
  current: '#f4f4f4',
  cleared: '#a7f070',
  text: '#f4f4f4',
  dim: '#566c86',
  shadow: '#000000',
};

const FONT = '"Pixel Digits", "Pixelify Sans", "Courier New", monospace';

export class RogueMapRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.max(1, window.devicePixelRatio || 1);

    this.scale = 1.0; // user zoom on top of the auto-fit
    this.offsetX = 0; // pan, in CSS px
    this.offsetY = 0;
    this.didDrag = false;
    this.lastFloor = null;
    this.lastOpts = null;
    this._view = { k: 1, bx: 0, by: 0, cx: 0, cy: 0 };
    this._pointers = new Map();
    this._blinkOn = true;

    this._initZoomAndPan();

    // Re-fit whenever the canvas box changes (rotation, drawers, resize)
    if (window.ResizeObserver) {
      new ResizeObserver(() => this._rerender()).observe(this.canvas);
    }
    window.addEventListener('resize', () => this._rerender());
    // Canvas text needs the web font to be loaded first
    document.fonts?.ready?.then(() => this._rerender());

    // Blink selectable nodes (only redraws while the map is on screen)
    setInterval(() => {
      if (!this.lastOpts?.canSelect?.size || this.canvas.offsetParent === null) return;
      this._blinkOn = !this._blinkOn;
      this._rerender();
    }, 450);
  }

  _rerender() {
    if (this.lastFloor) this.render(this.lastFloor, this.lastOpts);
  }

  // ---------- Input: drag to pan, pinch / wheel to zoom ----------

  _initZoomAndPan() {
    const c = this.canvas;

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      this._zoomAt(this.scale * (e.deltaY < 0 ? 1.12 : 0.88), e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });

    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture?.(e.pointerId);
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._pointers.size === 1) {
        this.didDrag = false;
        this._dragDist = 0;
      }
      this._pinch = null;
    });

    c.addEventListener('pointermove', (e) => {
      const prev = this._pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };

      if (this._pointers.size >= 2) {
        this._pointers.set(e.pointerId, cur);
        const [p1, p2] = [...this._pointers.values()];
        const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const rect = c.getBoundingClientRect();
        const mx = (p1.x + p2.x) / 2 - rect.left;
        const my = (p1.y + p2.y) / 2 - rect.top;
        if (this._pinch) {
          this.offsetX += mx - this._pinch.mx;
          this.offsetY += my - this._pinch.my;
          this._zoomAt(this.scale * (dist / this._pinch.dist), mx, my);
        }
        this._pinch = { dist, mx, my };
        this.didDrag = true;
        return;
      }

      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      this._pointers.set(e.pointerId, cur);
      this._dragDist += Math.hypot(dx, dy);
      if (this._dragDist > 8) this.didDrag = true;
      if (this.didDrag) {
        this.offsetX += dx;
        this.offsetY += dy;
        this._rerender();
      }
    });

    const end = (e) => {
      this._pointers.delete(e.pointerId);
      this._pinch = null;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  /** Zoom so the map point under (sx, sy) (canvas CSS px) stays put. */
  _zoomAt(newScale, sx, sy) {
    const before = this.screenToMapLocal(sx, sy);
    this.setScale(newScale, false);
    this._computeView();
    const after = this._mapToLocal(before.x, before.y);
    this.offsetX += sx - after.x;
    this.offsetY += sy - after.y;
    this._rerender();
  }

  setScale(newScale, redraw = true) {
    this.scale = Math.max(0.6, Math.min(3.0, newScale));
    const label = document.getElementById('zoom-level');
    if (label) label.textContent = `${Math.round(this.scale * 100)}%`;
    if (redraw) this._rerender();
  }

  resetZoom() {
    this.offsetX = 0;
    this.offsetY = 0;
    this.setScale(1.0);
  }

  // ---------- View transform ----------

  _computeView() {
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width || 1;
    const h = rect.height || 1;
    const nodes = this.lastFloor?.nodes || [];

    let minX = 0, maxX = CONFIG.map.floorWidth, minY = 0, maxY = CONFIG.map.floorHeight;
    if (nodes.length) {
      minX = Math.min(...nodes.map((n) => n.x)) - NODE_TILE.w / 2;
      maxX = Math.max(...nodes.map((n) => n.x)) + NODE_TILE.w / 2;
      minY = Math.min(...nodes.map((n) => n.y)) - NODE_TILE.h / 2;
      maxY = Math.max(...nodes.map((n) => n.y)) + NODE_TILE.h / 2;
    }
    // Horizontal padding leaves room for the zoom controls on the right edge
    const padX = 64;
    const padY = 12;
    const fit = Math.min((w - padX * 2) / (maxX - minX), (h - padY * 2) / (maxY - minY));
    this._view = {
      k: fit * this.scale,
      bx: (minX + maxX) / 2,
      by: (minY + maxY) / 2,
      cx: w / 2 + this.offsetX,
      cy: h / 2 + this.offsetY,
      w,
      h,
    };
  }

  _mapToLocal(mx, my) {
    const v = this._view;
    return { x: (mx - v.bx) * v.k + v.cx, y: (my - v.by) * v.k + v.cy };
  }

  screenToMapLocal(sx, sy) {
    const v = this._view;
    return { x: (sx - v.cx) / v.k + v.bx, y: (sy - v.cy) / v.k + v.by };
  }

  /** Viewport (client) pixel → map space */
  screenToMap(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    this._computeView();
    return this.screenToMapLocal(clientX - rect.left, clientY - rect.top);
  }

  /** Returns the node whose tile contains the given client point, if any. */
  hitNode(clientX, clientY, nodes) {
    const pt = this.screenToMap(clientX, clientY);
    return nodes.find((n) => Math.abs(pt.x - n.x) <= NODE_TILE.w / 2 && Math.abs(pt.y - n.y) <= NODE_TILE.h / 2) || null;
  }

  // ---------- Drawing ----------

  /**
   * @param {Object} floor - floor data from RogueMap
   * @param {Object} opts { currentNodeId, canSelect: Set of selectable ids }
   */
  render(floor, opts = {}) {
    this.lastFloor = floor;
    this.lastOpts = opts;

    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return; // hidden
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    const targetW = Math.round(rect.width * this.dpr);
    const targetH = Math.round(rect.height * this.dpr);
    if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
      this.canvas.width = targetW;
      this.canvas.height = targetH;
    }
    this._computeView();

    const { ctx } = this;
    const { currentNodeId, canSelect = new Set() } = opts;
    const v = this._view;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    this._drawBackground(ctx, v);

    ctx.save();
    ctx.translate(v.cx, v.cy);
    ctx.scale(v.k, v.k);
    ctx.translate(-v.bx, -v.by);

    this._drawEdges(ctx, floor, canSelect, currentNodeId);
    for (const node of floor.nodes) this._drawNode(ctx, node, currentNodeId, canSelect);

    ctx.restore();
  }

  _drawBackground(ctx, v) {
    // Each floor has its own tint, matching its battle backdrop
    const themes = [
      ['#141a2e', 'rgba(239, 125, 87, 0.10)'],
      ['#0d0e18', 'rgba(115, 239, 247, 0.08)'],
      ['#1a0f1c', 'rgba(177, 62, 83, 0.14)'],
      ['#0c1719', 'rgba(167, 240, 112, 0.10)'],
      ['#12080e', 'rgba(255, 93, 115, 0.12)'],
    ];
    const [bg, dots] = themes[this.lastFloor?.index ?? 0] || themes[0];
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, v.w, v.h);
    // Pixel dot grid that pans with the map
    const step = 24;
    const ox = ((v.cx % step) + step) % step;
    const oy = ((v.cy % step) + step) % step;
    ctx.fillStyle = dots;
    for (let x = ox; x < v.w; x += step) {
      for (let y = oy; y < v.h; y += step) ctx.fillRect(Math.round(x), Math.round(y), 2, 2);
    }
  }

  _drawEdges(ctx, floor, canSelect, currentNodeId) {
    for (const e of floor.edges) {
      const a = floor.nodes.find((n) => n.id === e.from);
      const b = floor.nodes.find((n) => n.id === e.to);
      if (!a || !b) continue;

      const open =
        (a.id === currentNodeId && canSelect.has(b.id)) ||
        (b.id === currentNodeId && canSelect.has(a.id));
      const cleared = a.cleared && b.cleared;

      ctx.save();
      if (open) {
        ctx.strokeStyle = PAL.edgeOpen;
        ctx.lineWidth = 8;
      } else if (cleared) {
        ctx.strokeStyle = PAL.edgeCleared;
        ctx.lineWidth = 6;
      } else {
        ctx.strokeStyle = PAL.edge;
        ctx.lineWidth = 5;
        ctx.setLineDash([10, 10]);
      }
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Filled rectangle with 1-step notched (pixel) corners. */
  _notchRect(ctx, x, y, w, h, n) {
    ctx.fillRect(x + n, y, w - n * 2, h);
    ctx.fillRect(x, y + n, w, h - n * 2);
  }

  _drawIcon(ctx, rows, cx, cy, px, color) {
    const size = rows.length * px;
    const x0 = Math.round(cx - size / 2);
    const y0 = Math.round(cy - size / 2);
    // Drop shadow first, then the lit pixels
    for (const [col, dx] of [[PAL.shadow, px / 2], [color, 0]]) {
      ctx.fillStyle = col;
      rows.forEach((row, r) => {
        for (let c = 0; c < row.length; c++) {
          if (row[c] === 'X') ctx.fillRect(x0 + c * px + dx, y0 + r * px + dx, px, px);
        }
      });
    }
  }

  _drawNode(ctx, node, currentNodeId, canSelect) {
    if (node.type === 'miniboss' || node.type === 'boss') {
      node.type = 'elite';
    }
    const style = NODE_STYLE[node.type] || NODE_STYLE.combat;
    const isCurrent = node.id === currentNodeId;
    const selectable = canSelect.has(node.id);
    const locked = node.locked && !isCurrent && !selectable && !node.cleared;

    const { w, h } = NODE_TILE;
    const x = Math.round(node.x - w / 2);
    const y = Math.round(node.y - h / 2);
    const n = 6; // notch / border thickness

    // Hard drop shadow
    ctx.fillStyle = PAL.shadow;
    this._notchRect(ctx, x + 6, y + 6, w, h, n);

    // Frame colour
    let frame = locked ? '#262b44' : '#333c57';
    if (node.cleared) frame = PAL.edgeCleared;
    if (selectable) frame = this._blinkOn ? style.color : PAL.edgeOpen;
    if (isCurrent) frame = PAL.current;
    ctx.fillStyle = frame;
    this._notchRect(ctx, x, y, w, h, n);

    // Inner tile
    ctx.fillStyle = locked ? PAL.tileLocked : PAL.tile;
    this._notchRect(ctx, x + n, y + n, w - n * 2, h - n * 2, n / 2);

    // Icon
    const iconColor = node.cleared && !isCurrent ? PAL.cleared : locked ? PAL.dim : style.color;
    const icon = node.cleared && node.type !== 'entry' ? ICONS.cleared : ICONS[node.type] || ICONS.combat;
    this._drawIcon(ctx, icon, node.x, node.y - 12, 5, iconColor);

    // Label ("YOU" marks where the player currently stands)
    ctx.font = `700 22px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let label = node.cleared && node.type !== 'entry' ? 'CLEAR' : style.short;
    if (isCurrent) label = '> YOU <';
    ctx.fillStyle = PAL.shadow;
    ctx.fillText(label, node.x + 2, y + h - 22 + 2);
    ctx.fillStyle = isCurrent ? PAL.edgeOpen : locked ? PAL.dim : PAL.text;
    ctx.fillText(label, node.x, y + h - 22);
  }
}
