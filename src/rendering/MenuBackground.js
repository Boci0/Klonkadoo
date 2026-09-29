// ============================================================
// MenuBackground — animated pixel backdrop behind the main menu:
// two parallax skyline layers drifting sideways, twinkling stars,
// and a slingshot ball arcing across every few seconds.
// Only animates while its canvas is visible. The skylines are drawn once
// onto offscreen canvases; the browser may drop those after a long session
// or a GPU reset, so they're rebuilt whenever the menu comes back into view.
// ============================================================

const PIX = 3; // CSS px per art pixel

export class MenuBackground {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.t = 0;
    this.shot = null;
    this.nextShot = 1.5;
    this._layers = null;
    this._last = performance.now();
    const tick = (now) => {
      requestAnimationFrame(tick);
      if (this.canvas.offsetParent === null) {
        this._last = now;
        this._layers = null; // rebuild the skylines when the menu shows again
        return; // hidden: skip work
      }
      const dt = Math.min(0.05, (now - this._last) / 1000);
      this._last = now;
      this._frame(dt);
    };
    requestAnimationFrame(tick);
  }

  _buildLayers(pw, ph) {
    let seed = 1234;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const layer = (color, windowCol, minH, maxH) => {
      const c = document.createElement('canvas');
      c.addEventListener('contextrestored', () => (this._layers = null)); // its pixels are gone: redraw it
      c.width = pw; // tiled twice while scrolling
      c.height = ph;
      const g = c.getContext('2d');
      let x = 0;
      while (x < c.width) {
        const bw = 6 + Math.floor(rng() * 12);
        const bh = minH + Math.floor(rng() * (maxH - minH));
        g.fillStyle = color;
        g.fillRect(x, ph - bh, bw, bh);
        if (windowCol) {
          for (let wy = ph - bh + 2; wy < ph - 2; wy += 3) {
            for (let wx = x + 1; wx < x + bw - 1; wx += 2) {
              if (rng() > 0.8) {
                g.fillStyle = windowCol;
                g.fillRect(wx, wy, 1, 1);
              }
            }
          }
        }
        x += bw + Math.floor(rng() * 3);
      }
      return c;
    };
    const stars = Array.from({ length: Math.floor(pw * 0.4) }, () => ({ x: rng() * pw, y: rng() * ph * 0.6, p: rng() * 6 }));
    this._layers = {
      pw,
      ph,
      far: layer('#1a2140', null, Math.round(ph * 0.2), Math.round(ph * 0.45)),
      near: layer('#0b0c14', '#ffcd75', Math.round(ph * 0.1), Math.round(ph * 0.28)),
      stars,
    };
  }

  _frame(dt) {
    const rect = this.canvas.getBoundingClientRect();
    const pw = Math.max(1, Math.ceil(rect.width / PIX));
    const ph = Math.max(1, Math.ceil(rect.height / PIX));
    if (this.canvas.width !== pw || this.canvas.height !== ph || !this._layers) {
      this.canvas.width = pw;
      this.canvas.height = ph;
      this._buildLayers(pw, ph);
    }
    this.t += dt;
    const g = this.ctx;
    const { far, near, stars } = this._layers;

    // Sky bands
    const bands = ['#0b0c14', '#10111c', '#1a1c2c', '#29366f', '#3b1f3b'];
    for (let i = 0; i < bands.length; i++) {
      g.fillStyle = bands[i];
      g.fillRect(0, Math.floor((i * ph) / bands.length), pw, Math.ceil(ph / bands.length) + 1);
    }
    for (const s of stars) {
      g.fillStyle = Math.sin(this.t * 2 + s.p) > 0.6 ? '#f4f4f4' : '#566c86';
      g.fillRect(Math.floor(s.x), Math.floor(s.y), 1, 1);
    }

    // Parallax skylines
    const drawLayer = (img, speed) => {
      const off = Math.floor((this.t * speed) % pw);
      g.drawImage(img, -off, 0);
      g.drawImage(img, pw - off, 0);
    };
    drawLayer(far, 3);
    drawLayer(near, 8);

    // A slingshot ball arcs across now and then
    this.nextShot -= dt;
    if (!this.shot && this.nextShot <= 0) {
      const fromLeft = Math.random() < 0.5;
      this.shot = { x: fromLeft ? -4 : pw + 4, y: ph * 0.8, vx: (fromLeft ? 1 : -1) * pw * 0.45, vy: -ph * 1.25, trail: [], col: ['#41a6f6', '#ef7d57', '#a7f070', '#c46fd6'][Math.floor(Math.random() * 4)] };
    }
    if (this.shot) {
      const s = this.shot;
      s.vy += ph * 1.6 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.trail.push([s.x, s.y]);
      if (s.trail.length > 14) s.trail.shift();
      s.trail.forEach(([x, y], i) => {
        g.fillStyle = i % 2 ? '#73eff7' : s.col;
        g.globalAlpha = i / s.trail.length;
        g.fillRect(Math.round(x), Math.round(y), 1, 1);
      });
      g.globalAlpha = 1;
      g.fillStyle = s.col;
      g.fillRect(Math.round(s.x) - 1, Math.round(s.y) - 1, 3, 3);
      if (s.y > ph + 5 || s.x < -10 || s.x > pw + 10) {
        this.shot = null;
        this.nextShot = 2 + Math.random() * 3;
      }
    }
  }
}
