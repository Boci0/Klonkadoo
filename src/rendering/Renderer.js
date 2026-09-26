// ============================================================
// Renderer — pixel-art battle presentation.
//
// Three layers per frame:
//   1. Backdrop  — cached low-res pixel art (sky, skyline, ground)
//                  filling the whole screen, themed per floor.
//   2. World     — the 1280×750 arena (balls, barriers, blocks,
//                  particles, aim line), scaled to fit and centred.
//   3. HUD       — screen-space UI in CSS px: HP panels pinned to
//                  the corners, floating damage/heal numbers, turn
//                  banners, power meter, victory/defeat overlay.
// ============================================================

import { CONFIG } from '../config.js';
import { getTerrain, groundAt } from '../core/Physics.js';
import { fitCanvas, clientToWorld } from './viewport.js';
import { paintBall, CLASS_PATTERN } from './ballSprite.js';
import { partCanvas, iconCanvas } from './pixelIcons.js';

const C = CONFIG.colors;
const W = CONFIG.world;
const S = CONFIG.slingshot;

const FONT = '"Pixel Digits", "Pixelify Sans", monospace'; // clear digits: see styles.css
const DISPLAY = '"Press Start 2P", monospace';
const BG_PIXEL = 3; // CSS px per backdrop pixel
const SKY_CROP = 200; // world units of empty sky that wide phones may crop to draw the action bigger

// Per-floor backdrop palettes (Sweetie 16 based)
const THEMES = {
  1: { name: 'DUSK OUTSKIRTS', sky: ['#1a1c2c', '#29366f', '#3b5dc9', '#5d275d', '#ef7d57'], far: '#29366f', near: '#1a1c2c', window: '#ffcd75', ground: ['#566c86', '#333c57', '#262b44'], sun: '#ffcd75', stars: false },
  2: { name: 'NIGHT DISTRICT', sky: ['#0b0c14', '#10111c', '#1a1c2c', '#29366f', '#3b5dc9'], far: '#1a1c2c', near: '#0b0c14', window: '#73eff7', ground: ['#333c57', '#262b44', '#1a1c2c'], sun: '#f4f4f4', stars: true },
  3: { name: 'RED SECTOR', sky: ['#10111c', '#1a1c2c', '#5d275d', '#b13e53', '#ef7d57'], far: '#5d275d', near: '#1a1c2c', window: '#ef7d57', ground: ['#5d275d', '#3b1f3b', '#1a1c2c'], sun: '#ffcd75', stars: true },
  4: { name: 'TOXIC WORKS', sky: ['#0b0c14', '#10111c', '#1a3a3f', '#257179', '#38b764'], far: '#1a3a3f', near: '#0b0c14', window: '#a7f070', ground: ['#257179', '#1a3a3f', '#10111c'], sun: '#a7f070', stars: false },
  5: { name: 'COMMAND CORE', sky: ['#000000', '#10111c', '#3b1f3b', '#5d275d', '#b13e53'], far: '#3b1f3b', near: '#000000', window: '#b13e53', ground: ['#333c57', '#1a1c2c', '#000000'], sun: '#b13e53', stars: true },
};

const INK = '#1a1c2c';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    this.shakeTime = 0;
    this.shakeIntensity = 0;
    this._lastFrame = performance.now();
    this._view = null;
    this._bgCache = null;
    this._sprites = new Map();
    this._floaters = []; // floating damage / heal numbers
    this._callouts = []; // ability / relic labels above balls
    this._ambient = []; // status-effect particles (flames, frost, acid)
    this._hpSeen = new Map(); // ball → last seen hp
    this._banner = null; // { text, color, t }
    this._arenaIntro = null; // { name, desc, wind, t }
    this._wind = []; // wind streak particles (screen space)
    this._weather = []; // per-floor weather particles (screen space)
    this._lastPhase = null;
    this.barrierCancelHover = false;

    // Tooltip overlay for status tags
    this._hoverZones = [];
    this._tooltip = document.createElement('div');
    this._tooltip.className = 'status-tooltip';
    this._tooltip.style.display = 'none';
    document.body.appendChild(this._tooltip);

    this._onMouseMove = (e) => this._handleTooltipMove(e);
    this._onMouseLeave = () => { this._tooltip.style.display = 'none'; };
    canvas.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('mouseleave', this._onMouseLeave);
    // Touch has no hover: tapping a status tag shows its description briefly
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      this._handleTooltipMove(e);
      clearTimeout(this._tooltipTimer);
      this._tooltipTimer = setTimeout(() => { this._tooltip.style.display = 'none'; }, 2500);
    });
  }

  // ---------- Public helpers ----------

  addScreenShake(intensity = 10) {
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
    this.shakeTime = 0.3;
  }

  /** Client (viewport) coordinates → world coordinates. */
  clientToWorld(clientX, clientY) {
    const view = this._view || fitCanvas(this.canvas, W.width, W.height, SKY_CROP);
    return clientToWorld(view, clientX, clientY);
  }

  /** Floating number anchored in world space (drawn crisp in the HUD layer). */
  addFloatingText(x, y, text, color, big = false) {
    // Stack numbers that land on the same spot instead of overlapping them
    const stack = this._floaters.filter((f) => Math.abs(f.x - x) < 60 && f.t < 0.45).length;
    this._floaters.push({ x, y, text, color, big, t: 0, life: big ? 1.2 : 1.0, stack });
  }

  /** Label that follows a ball for a moment: ability names, relic triggers. */
  addCallout(ball, text, color = '#f4f4f4') {
    const stack = this._callouts.filter((c) => c.ball === ball).length;
    this._callouts.push({ ball, text, color, t: 0, life: 1.4, stack });
  }

  showBanner(text, color) {
    this._banner = { text, color, t: 0 };
  }

  /** Arena name + rule, shown for a moment when a battle starts. */
  showArenaIntro(arena) {
    this._arenaIntro = { name: arena.name, desc: arena.desc, wind: arena.wind, t: 0 };
    this._wind = [];
    this._weather = [];
  }

  /** Forget per-battle state (hp tracking, floaters) when a new battle starts. */
  resetBattleFx() {
    this._floaters = [];
    this._callouts = [];
    this._ambient = [];
    this._hpSeen = new Map();
    this._banner = null;
    this._lastPhase = null;
  }

  // ---------- Frame ----------

  render(world) {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this._lastFrame) / 1000);
    this._lastFrame = now;

    const view = fitCanvas(this.canvas, W.width, W.height, SKY_CROP);
    this._view = view;
    this.worldRef = world;
    const { ctx } = this;
    const { player, enemies, turnSystem, particles } = world || {};
    const enemyList = enemies || [];
    const livingEnemies = enemyList.filter((e) => e && e.hp > 0);
    const floor = Math.min(5, Math.max(1, world?.battleConfig?.floor || 1));

    this._trackHp([player, ...enemyList]);
    this._trackPhase(turnSystem);

    // Screen shake (time-based so it feels the same at 60 and 120 Hz)
    let shakeX = 0;
    let shakeY = 0;
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      shakeX = Math.round((Math.random() * 2 - 1) * this.shakeIntensity * view.k);
      shakeY = Math.round((Math.random() * 2 - 1) * this.shakeIntensity * view.k);
      this.shakeIntensity *= Math.pow(0.001, dt);
      if (this.shakeTime <= 0) this.shakeIntensity = 0;
    }

    // 1. Backdrop (screen space, cached)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this._backdrop(view, floor), shakeX * 0.5, shakeY * 0.5, view.w, view.h);

    // 2. World
    ctx.setTransform(view.k, 0, 0, view.k, view.ox + shakeX, view.oy + shakeY);
    this._drawHazards(ctx, world.hazards || [], now);
    this._drawPlatformsAndObstacles(ctx, world.platforms || [], world.obstacles || []);
    this._drawBarriers(ctx, world.barriers || [], now);
    this._drawParticles(ctx, particles || []);
    this._drawSkillAura(ctx, world, now);
    this._updateAmbient(dt, [player, ...livingEnemies]);
    this._drawAmbient(ctx);
    for (const ball of [player, ...livingEnemies]) {
      if (ball && ball.hp > 0) this._drawBallShadow(ctx, ball);
    }
    if (player && player.hp > 0) this._drawBall(ctx, player);
    for (const enemy of livingEnemies) this._drawBall(ctx, enemy);
    this._drawGear(ctx, world, player, livingEnemies);
    this._drawMineMarkers(ctx, world.hazards || [], now);
    this._drawMechRanges(ctx, world);
    if (world.slingshotInput) world.slingshotInput.draw(ctx);
    this._drawInspectCard(ctx, world);

    // 3. HUD (CSS px)
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    this._drawWeather(ctx, view, dt, floor);
    this._hoverZones = [];
    this._drawHpPanels(ctx, view, player, livingEnemies);
    this._drawOffscreenMarkers(ctx, view, [player, ...livingEnemies]);
    this._drawCallouts(ctx, view, dt);
    this._drawFloaters(ctx, view, dt);
    this._drawPowerMeter(ctx, view, world);
    this._drawBarrierHint(ctx, view, world);
    this._drawTurnHint(ctx, view, turnSystem, world);
    this._drawWind(ctx, view, dt, W.wind || 0);
    this._drawArenaIntro(ctx, view, dt);
    this._drawBanner(ctx, view, dt);
    if (turnSystem?.phase === 'GAME_OVER' && world.winner) {
      this._drawGameOver(ctx, view, world.winner, world.battleSummary);
    }
  }

  // ---------- Change tracking → feedback ----------

  _trackHp(balls) {
    for (const ball of balls) {
      if (!ball) continue;
      const prev = this._hpSeen.get(ball);
      this._hpSeen.set(ball, ball.hp);
      if (prev === undefined) continue;
      const diff = Math.round(ball.hp - prev);
      if (diff === 0) continue;
      const y = ball.y - ball.radius - 10;
      if (diff < 0) {
        const big = -diff >= 20;
        this.addFloatingText(ball.x, y, `-${-diff}`, ball.team === 'player' ? '#ff5d73' : '#ffcd75', big);
      } else {
        this.addFloatingText(ball.x, y, `+${diff}`, '#a7f070');
      }
    }
  }

  _trackPhase(turnSystem) {
    const phase = turnSystem?.phase;
    if (phase === this._lastPhase) return;
    const prev = this._lastPhase;
    this._lastPhase = phase;
    if (phase === 'PLAYER_AIM' && prev !== 'PLAYER_AIM' && prev !== 'PLAYER_FLY') this.showBanner('YOUR TURN', '#73eff7');
    else if (phase === 'ENEMY_AIM' && prev !== 'ENEMY_AIM' && prev !== 'ENEMY_FLY' && prev !== 'ENEMY_FIRE') this.showBanner('ENEMY TURN', '#ff5d73');
  }

  // ---------- Backdrop ----------

  _backdrop(view, floor) {
    const terrain = getTerrain();
    const key = `${view.w}x${view.h}@${floor}@${terrain ? terrain.map((p) => `${p.x},${p.y}`).join(';') : ''}`;
    if (this._bgCache?.key === key) return this._bgCache.canvas;

    const theme = THEMES[floor] || THEMES[1];
    const pw = Math.ceil(view.cssW / BG_PIXEL);
    const ph = Math.ceil(view.cssH / BG_PIXEL);
    const c = document.createElement('canvas');
    c.width = pw;
    c.height = ph;
    const g = c.getContext('2d');

    // Ground line in backdrop pixels
    const groundPx = Math.round((view.oy + W.groundY * view.k) / view.dpr / BG_PIXEL);
    const rng = mulberry32(floor * 9973);

    // Sky: 5 colour bands with 2-row checker dithering between them
    const bands = theme.sky;
    const bandH = groundPx / bands.length;
    for (let y = 0; y < groundPx; y++) {
      const bi = Math.min(bands.length - 1, Math.floor(y / bandH));
      const inBand = y - bi * bandH;
      for (let x = 0; x < pw; x++) {
        let col = bands[bi];
        if (bi < bands.length - 1 && inBand > bandH - 3 && (x + y) % 2 === 0) col = bands[bi + 1];
        g.fillStyle = col;
        g.fillRect(x, y, 1, 1);
      }
    }

    // Stars
    if (theme.stars) {
      for (let i = 0; i < pw * 0.35; i++) {
        const x = Math.floor(rng() * pw);
        const y = Math.floor(rng() * groundPx * 0.55);
        g.fillStyle = rng() > 0.85 ? '#f4f4f4' : '#94b0c2';
        g.fillRect(x, y, 1, 1);
      }
    }

    // Sun / moon
    const sunR = Math.max(6, Math.round(ph * 0.07));
    const sunX = Math.round(pw * 0.72);
    const sunY = Math.round(groundPx * 0.32);
    g.fillStyle = theme.sun;
    for (let dy = -sunR; dy <= sunR; dy++) {
      const half = Math.round(Math.sqrt(sunR * sunR - dy * dy));
      g.fillRect(sunX - half, sunY + dy, half * 2, 1);
    }

    // Skylines: far (tall, lighter) and near (shorter, darker, lit windows)
    const skyline = (baseY, minH, maxH, color, windows) => {
      let x = 0;
      while (x < pw) {
        const bw = 6 + Math.floor(rng() * 12);
        const bh = minH + Math.floor(rng() * (maxH - minH));
        g.fillStyle = color;
        g.fillRect(x, baseY - bh, bw, bh);
        if (rng() > 0.6) g.fillRect(x + Math.floor(bw / 2), baseY - bh - 3, 1, 3); // antenna
        if (windows) {
          for (let wy = baseY - bh + 2; wy < baseY - 2; wy += 3) {
            for (let wx = x + 1; wx < x + bw - 1; wx += 2) {
              if (rng() > 0.82) {
                g.fillStyle = windows;
                g.fillRect(wx, wy, 1, 1);
              }
            }
          }
        }
        x += bw + Math.floor(rng() * 3);
      }
    };
    skyline(groundPx, Math.round(groundPx * 0.18), Math.round(groundPx * 0.42), theme.far, null);
    skyline(groundPx, Math.round(groundPx * 0.08), Math.round(groundPx * 0.24), theme.near, theme.window);

    // Ground: bright lip, then brick courses
    const [lip, mid, deep] = theme.ground;
    g.fillStyle = lip;
    g.fillRect(0, groundPx, pw, 2);
    for (let y = groundPx + 2; y < ph; y++) {
      const row = y - groundPx - 2;
      g.fillStyle = row < 6 ? mid : deep;
      g.fillRect(0, y, pw, 1);
      if (row % 4 === 3) {
        g.fillStyle = INK;
        g.fillRect(0, y, pw, 1);
      } else {
        const offset = Math.floor(row / 4) % 2 ? 4 : 0;
        g.fillStyle = INK;
        for (let x = offset; x < pw; x += 8) g.fillRect(x, y, 1, 1);
      }
    }

    // Hills: painted in the same backdrop pixels and brick courses as the
    // flat ground, so a slope reads as the ground itself rising
    if (terrain) {
      const worldX = (i) => ((i + 0.5) * BG_PIXEL * view.dpr - view.ox) / view.k;
      const mod = (n, m) => ((n % m) + m) % m;
      for (let i = 0; i < pw; i++) {
        const top = Math.round((view.oy + groundAt(worldX(i)) * view.k) / view.dpr / BG_PIXEL);
        if (top >= groundPx) continue;
        for (let y = top; y < ph; y++) {
          const depth = y - top;
          const row = y - groundPx - 2; // brick course, continued above the ground line
          let col = depth < 2 ? lip : depth < 8 ? mid : deep;
          if (depth >= 2 && (mod(row, 4) === 3 || mod(i - (mod(Math.floor(row / 4), 2) ? 4 : 0), 8) === 0)) col = INK;
          g.fillStyle = col;
          g.fillRect(i, y, 1, 1);
        }
      }
    }

    this._bgCache = { key, canvas: c };
    return c;
  }

  // ---------- World: blocks, barriers, particles ----------

  _pixelBox(ctx, x, y, w, h, fill, light, dark, edge = 4) {
    ctx.fillStyle = INK;
    ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = light;
    ctx.fillRect(x, y, w, edge);
    ctx.fillStyle = dark;
    ctx.fillRect(x, y + h - edge, w, edge);
  }

  _drawPlatformsAndObstacles(ctx, platforms, obstacles) {
    for (const p of platforms) {
      this._pixelBox(ctx, p.x, p.y, p.w, p.h, '#333c57', '#94b0c2', '#1a1c2c');
      ctx.fillStyle = '#566c86';
      for (let x = p.x + 10; x < p.x + p.w - 6; x += 24) ctx.fillRect(x, p.y + 8, 8, 4);
    }

    for (const ob of obstacles) {
      if (!ob.active) continue;
      const pct = Math.max(0, ob.hp / ob.maxHp);
      this._pixelBox(ctx, ob.x, ob.y, ob.w, ob.h, '#b13e53', '#ef7d57', '#5d275d');
      // Brick pattern
      ctx.fillStyle = '#5d275d';
      for (let y = ob.y + 16; y < ob.y + ob.h - 4; y += 16) {
        ctx.fillRect(ob.x, y, ob.w, 3);
        const off = ((y - ob.y) / 16) % 2 ? ob.w / 2 : 0;
        ctx.fillRect(ob.x + off, y - 13, 3, 13);
      }
      // Cracks as it weakens
      if (pct < 0.66) {
        ctx.fillStyle = INK;
        ctx.fillRect(ob.x + ob.w * 0.3, ob.y + ob.h * 0.2, 4, ob.h * 0.25);
        ctx.fillRect(ob.x + ob.w * 0.3, ob.y + ob.h * 0.45, ob.w * 0.35, 4);
      }
      if (pct < 0.33) {
        ctx.fillRect(ob.x + ob.w * 0.6, ob.y + ob.h * 0.5, 4, ob.h * 0.3);
      }
      // HP pips
      ctx.fillStyle = INK;
      ctx.fillRect(ob.x - 3, ob.y - 16, ob.w + 6, 10);
      ctx.fillStyle = pct > 0.33 ? '#a7f070' : '#ff5d73';
      ctx.fillRect(ob.x, ob.y - 13, Math.round(ob.w * pct), 4);
    }
  }

  _drawBarriers(ctx, barriers, now) {
    for (const barrier of barriers) {
      if (!barrier.active) continue;
      const { x, y, w, h } = barrier;
      const hostile = barrier.owner === 'enemy';
      ctx.fillStyle = hostile ? 'rgba(255, 93, 115, 0.35)' : 'rgba(65, 166, 246, 0.35)';
      ctx.fillRect(x, y, w, h);
      // Scrolling energy scanlines
      const scroll = Math.floor(now / 60) % 8;
      ctx.fillStyle = hostile ? 'rgba(255, 150, 160, 0.8)' : 'rgba(115, 239, 247, 0.8)';
      for (let yy = y + scroll; yy < y + h; yy += 8) ctx.fillRect(x, yy, w, 2);
      ctx.fillStyle = hostile ? '#ff5d73' : '#73eff7';
      ctx.fillRect(x - 3, y, 3, h);
      ctx.fillRect(x + w, y, 3, h);

      const maxHp = barrier.maxHp || CONFIG.damage.barrierHp;
      const pct = Math.max(0, (barrier.hp ?? maxHp) / maxHp);
      ctx.fillStyle = INK;
      ctx.fillRect(x - 6, y - 14, w + 12, 8);
      ctx.fillStyle = pct > 0.3 ? '#a7f070' : '#ff5d73';
      ctx.fillRect(x - 4, y - 12, Math.round((w + 8) * pct), 4);
    }
  }

  _drawParticles(ctx, particles) {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.maxLife));
      if (p.type === 'tracer') {
        // Gun shot: a bolt flies from the muzzle (first 45%), then an impact burst
        const t = 1 - p.life / p.maxLife;
        const fly = Math.min(1, t / 0.45);
        const hx = p.x1 + (p.x2 - p.x1) * fly;
        const hy = p.y1 + (p.y2 - p.y1) * fly;
        const tail = Math.max(0, fly - 0.35);
        const tx = p.x1 + (p.x2 - p.x1) * tail;
        const ty = p.y1 + (p.y2 - p.y1) * tail;
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 11;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(hx, hy);
        ctx.stroke();
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 6;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.fillRect(Math.round(hx - 5), Math.round(hy - 5), 10, 10);
        if (fly >= 1) {
          const k = (t - 0.45) / 0.55;
          const f = Math.round(10 + 30 * k);
          ctx.globalAlpha = 1 - k;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 5;
          ctx.strokeRect(Math.round(p.x2 - f / 2), Math.round(p.y2 - f / 2), f, f);
          ctx.fillStyle = '#fff';
          const c = Math.round(14 * (1 - k)) + 2;
          ctx.fillRect(Math.round(p.x2 - c / 2), Math.round(p.y2 - c / 2), c, c);
        }
      } else if (p.type === 'shockwave') {
        const radius = p.radius + (p.maxRadius - p.radius) * (1 - p.life / p.maxLife);
        ctx.strokeStyle = '#ef7d57';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.type === 'implode') {
        // Ring collapsing inward: Singularity Core
        const k = p.life / p.maxLife;
        ctx.strokeStyle = '#c46fd6';
        ctx.lineWidth = 8;
        ctx.setLineDash([14, 10]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(8, p.radius * k), 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (p.type === 'tether') {
        // Graviton Weaver pulling the player
        this._zigzag(ctx, p.from.x, p.from.y, p.to.x, p.to.y, '#c46fd6', 6, 18, performance.now() / 40);
      } else if (p.type === 'bolt') {
        this._zigzag(ctx, p.x1, p.y1, p.x2, p.y2, '#73eff7', 6, 34, p.seed * 100 + Math.floor(performance.now() / 50));
      } else {
        const s = Math.max(4, Math.round(p.size * 1.6));
        ctx.fillStyle = p.color;
        ctx.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------- World: balls ----------

  _drawBallShadow(ctx, ball) {
    const gy = groundAt(ball.x);
    const heightAbove = Math.max(0, gy - (ball.y + ball.radius));
    const shrink = Math.max(0.35, 1 - heightAbove / 500);
    const sw = Math.round(ball.radius * 1.8 * shrink);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(Math.round(ball.x - sw / 2), Math.round(gy) - 2, sw, 6);
  }

  // ---------- Mech weapons: range rings and the inspect card ----------

  _rangeRing(ctx, x, y, w, alpha, now) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = w.color || '#f4f4f4';
    ctx.lineWidth = 4;
    ctx.setLineDash([14, 10]);
    ctx.lineDashOffset = -now / 40;
    ctx.beginPath();
    ctx.arc(x, y, Math.min(w.range[1], 1500), 0, Math.PI * 2);
    ctx.stroke();
    if (w.range[0] > 0) {
      ctx.globalAlpha = alpha * 0.6;
      ctx.setLineDash([4, 10]);
      ctx.beginPath();
      ctx.arc(x, y, w.range[0], 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Equipped gear on the balls: guns hover on the flanks and turn toward the
   * nearest target (recoil + muzzle flash when they fire), drones orbit
   * above. Stowed (faded out) while the ball is flying. Each part's muzzle
   * position is stored so Game can start the shot there.
   */
  _drawGear(ctx, world, player, enemies) {
    const now = performance.now();
    const S = 4;
    const turn = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
    const flash = (x, y, color) => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(Math.round(x - 7), Math.round(y - 7), 14, 14);
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(x - 4), Math.round(y - 4), 8, 8);
    };
    const mount = (ball, guns, foes, drones = []) => {
      if (!ball || ball.hp <= 0 || (!guns.length && !drones.length)) return;
      const speed = Math.hypot(ball.vx || 0, ball.vy || 0);
      const alpha = Math.max(0, Math.min(1, 1 - (speed - 60) / 220));
      const r = ball.radius;
      const nearest = foes.filter((f) => f && f.hp > 0).sort((a, b) => Math.hypot(a.x - ball.x, a.y - ball.y) - Math.hypot(b.x - ball.x, b.y - ball.y))[0];
      guns.forEach((g, i) => {
        const side = guns.length === 1 ? (nearest && nearest.x < ball.x ? -1 : 1) : i % 2 === 0 ? -1 : 1;
        const mx = ball.x + side * (r + 2);
        const my = ball.y - r * 0.45 - Math.floor(i / 2) * 22;
        const since = now - (g.firedAt || -1e9);
        const tgt = since < 700 && g.aimAt?.hp > 0 ? g.aimAt : nearest;
        const want = tgt ? Math.atan2(tgt.y - my, tgt.x - mx) : side < 0 ? Math.PI : 0;
        g._ang = g._ang === undefined ? want : turn(g._ang, want, since < 700 ? 0.5 : 0.12);
        const ic = partCanvas(g.id);
        const w = ic.width * S;
        const h = ic.height * S;
        const recoil = since < 180 ? (1 - since / 180) * 10 : 0;
        ctx.save();
        ctx.translate(Math.round(mx), Math.round(my));
        ctx.rotate(g._ang);
        if (Math.cos(g._ang) < 0) ctx.scale(1, -1); // keep the sprite upright
        ctx.globalAlpha = alpha * (g.cdLeft > 0 || (g.ammo && g.ammoLeft <= 0) ? 0.6 : 1);
        ctx.drawImage(ic, Math.round(-6 - recoil), Math.round(-h / 2), w, h);
        ctx.globalAlpha = alpha;
        if (since < 110) flash(w - 2 - recoil, 0, g.color || '#ffcd75');
        ctx.restore();
        g._muzzle = { x: mx + Math.cos(g._ang) * (w - 6), y: my + Math.sin(g._ang) * (w - 6) };
      });
      drones.forEach((d, i) => {
        const t = now / 1000 + i * Math.PI;
        const since = now - (d.firedAt || -1e9);
        const dx = ball.x + Math.cos(t * 1.3) * r * 1.5;
        const dy = ball.y - r * 1.9 + Math.sin(t * 2.6) * 5 - (since < 150 ? 4 : 0);
        const ic = partCanvas(d.id);
        const w = ic.width * S;
        const h = ic.height * S;
        ctx.globalAlpha = alpha;
        ctx.drawImage(ic, Math.round(dx - w / 2), Math.round(dy - h / 2), w, h);
        if (since < 120) flash(dx, dy + h / 2, d.color || '#ffcd75');
        ctx.globalAlpha = 1;
        d._muzzle = { x: dx, y: dy + h / 2 };
      });
      ctx.globalAlpha = 1;
    };
    mount(player, world.playerWeapons || [], enemies, world.playerDrones || []);
    for (const e of enemies) mount(e, e.weapons || [], player ? [player] : []);
  }

  _drawMechRanges(ctx, world) {
    const now = performance.now();
    const usable = (w) => (world.gear ? !(w.ammo && w.ammoLeft <= 0) : w.cdLeft === 0) && w.range[1] < 1400;
    // While aiming: where your ready guns will reach from the predicted landing spot
    const traj = world.slingshotInput?.dragging ? world.slingshotInput.trajectory : null;
    if (traj && traj.length) {
      const land = traj[traj.length - 1];
      for (const w of world.playerWeapons || []) {
        if (usable(w)) this._rangeRing(ctx, land.x, land.y, w, 0.45, now);
      }
    }
    // Gear combat, your fire phase: your reach from where you stand, and the aimed-at enemy
    const ph = world.turnSystem?.phase;
    if (world.gear && world.player?.hp > 0 && ph === 'PLAYER_AIM' && !traj) {
      if (world.player.actionsLeft > 0) for (const w of world.playerWeapons || []) if (usable(w)) this._rangeRing(ctx, world.player.x, world.player.y, w, 0.22, now);
      const t = world.fireTarget;
      if (t && t.hp > 0) this._reticle(ctx, t, now);
    }
    const ins = world.inspected;
    if (!ins) return;
    const guns = ins.ball === world.player ? world.playerWeapons || [] : ins.ball.weapons || [];
    guns.forEach((w, i) => {
      if (ins.weapon === undefined || ins.weapon === i) this._rangeRing(ctx, ins.ball.x, ins.ball.y, w, 0.8, now);
    });
  }

  /** Brackets around the enemy your guns are aimed at (gear combat). */
  _reticle(ctx, ball, now) {
    const r = ball.radius + 12 + Math.sin(now / 160) * 3;
    const L = 12;
    ctx.save();
    ctx.strokeStyle = '#ffcd75';
    ctx.lineWidth = 4;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const cx = ball.x + sx * r;
      const cy = ball.y + sy * r;
      ctx.beginPath();
      ctx.moveTo(cx, cy - sy * L);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx - sx * L, cy);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Weapon card above an inspected ball: one row per gun with its icon,
   * damage, a range strip (the band it can hit), cooldown and effect.
   */
  _drawInspectCard(ctx, world) {
    const ins = world.inspected;
    if (!ins) return;
    const ball = ins.ball;
    const isPlayer = ball === world.player;
    let guns = isPlayer ? world.playerWeapons || [] : ball.weapons || [];
    if (ins.weapon !== undefined) guns = guns.filter((_, i) => i === ins.weapon);
    if (isPlayer && ins.weapon === undefined) guns = [...guns, ...(world.playerDrones || []).map((d) => ({ ...d, drone: true }))];

    // Sized for phones: the world is drawn at roughly 0.6x on a small screen
    const S = 4; // icon scale
    const rowH = 56;
    const w = 640;
    const h = 52 + Math.max(1, guns.length) * rowH;
    const x = Math.round(Math.max(8, Math.min(W.width - w - 8, ball.x - w / 2)));
    const above = ball.y - ball.radius - 30 - h;
    const y = Math.round(above > 60 ? above : Math.min(W.height - h - 8, ball.y + ball.radius + 30));
    ctx.fillStyle = '#000';
    ctx.fillRect(x + 5, y + 5, w, h);
    ctx.fillStyle = 'rgba(26, 28, 44, 0.96)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#566c86';
    ctx.lineWidth = 4;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = isPlayer ? '#41a6f6' : '#ff5d73';
    ctx.fillRect(x, y, w, 6);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `700 22px ${FONT}`;
    ctx.fillStyle = '#ffcd75';
    ctx.fillText(isPlayer ? 'YOUR RIG' : fitText(ctx, ball.displayName || 'ENEMY', w - 40), x + 16, y + 30);
    if (!guns.length) {
      ctx.fillStyle = '#94b0c2';
      ctx.fillText('UNARMED', x + 16, y + 52 + rowH / 2);
    }
    const icon = (name, ix, iy) => {
      const c = iconCanvas(name);
      ctx.drawImage(c, ix, Math.round(iy - c.height * 1.5), c.width * 3, c.height * 3);
    };
    guns.forEach((g, i) => {
      const ry = y + 52 + i * rowH;
      const cy = ry + rowH / 2;
      if (i) {
        ctx.fillStyle = '#2a3048';
        ctx.fillRect(x + 10, ry, w - 20, 2);
      }
      const ic = partCanvas(g.id);
      const spent = world.gear ? g.ammo && g.ammoLeft <= 0 : g.cdLeft > 0;
      ctx.globalAlpha = spent ? 0.5 : 1;
      ctx.drawImage(ic, x + 16, Math.round(cy - (ic.height * S) / 2), ic.width * S, ic.height * S);
      ctx.globalAlpha = 1;
      let cx = x + 80;
      ctx.font = `700 20px ${FONT}`;
      if (g.drone) {
        icon(g.heal ? 'heal' : 'dmg', cx, cy);
        ctx.fillStyle = '#f4f4f4';
        ctx.fillText(g.heal ? `${Math.round(g.heal)}/T` : `${Math.round(g.dmg || 0)}`, cx + 30, cy);
        ctx.fillStyle = '#94b0c2';
        ctx.fillText('DRONE · EVERY TURN', cx + 110, cy);
        return;
      }
      icon('dmg', cx, cy);
      ctx.fillStyle = '#f4f4f4';
      ctx.fillText(`${Math.round(g.dmg)}`, cx + 30, cy);
      cx += 86;
      // Range strip: 0 .. 1400 world px, the hittable band in the gun's colour
      icon('range', cx, cy);
      const bx = cx + 32;
      const bw = 170;
      ctx.fillStyle = '#10111c';
      ctx.fillRect(bx, cy - 8, bw, 16);
      ctx.fillStyle = g.color || '#f4f4f4';
      const r0 = Math.min(1, g.range[0] / 1400);
      const r1 = Math.min(1, g.range[1] / 1400);
      ctx.fillRect(Math.round(bx + r0 * bw), cy - 5, Math.max(4, Math.round((r1 - r0) * bw)), 10);
      cx = bx + bw + 16;
      if (world.gear) {
        // Energy and heat per shot, then ammo left (strong guns only)
        icon('energy', cx, cy);
        ctx.fillStyle = '#73eff7';
        ctx.fillText(`${g.en || 0}`, cx + 28, cy);
        cx += 62;
        icon('heat', cx, cy);
        ctx.fillStyle = '#ef7d57';
        ctx.fillText(`${g.heat || 0}`, cx + 28, cy);
        cx += 62;
        if (g.ammo) {
          icon('ammo', cx, cy);
          ctx.fillStyle = g.ammoLeft > 0 ? '#ffcd75' : '#566c86';
          ctx.fillText(`${g.ammoLeft}/${g.ammo}`, cx + 28, cy);
        } else {
          ctx.fillStyle = '#566c86';
          ctx.fillText(g.arc ? 'LOB' : '', cx, cy);
        }
        return;
      }
      icon('cd', cx, cy);
      ctx.fillStyle = g.cdLeft > 0 ? '#94b0c2' : '#a7f070';
      ctx.fillText(g.cdLeft > 0 ? `${g.cdLeft}T` : 'READY', cx + 30, cy);
      cx += 120;
      const fx = g.fx ? Object.keys(g.fx)[0] : '';
      if (fx) {
        ctx.fillStyle = g.color || '#f4f4f4';
        ctx.fillText(fx.toUpperCase(), cx, cy);
      }
    });
    ctx.textBaseline = 'alphabetic';
  }

  /** 16×16 pixel sprite for a ball, cached per look. */
  _ballSprite(ball, flash) {
    const emblem = ball.team === 'player' ? 'player' : ball.archetype || 'standard';
    const pattern = ball.pattern || CLASS_PATTERN[ball.ballType] || 'chevron';
    const key = `${ball.color}|${ball.darkColor}|${emblem}|${pattern}|${ball.accent}|${flash ? 1 : 0}`;
    let sprite = this._sprites.get(key);
    if (sprite) return sprite;

    if (emblem === 'player') {
      sprite = document.createElement('canvas');
      sprite.width = 16;
      sprite.height = 16;
      paintBall(sprite.getContext('2d'), { color: ball.color, darkColor: ball.darkColor, accent: ball.accent, pattern, flash });
      this._sprites.set(key, sprite);
      return sprite;
    }

    const N = 16;
    sprite = document.createElement('canvas');
    sprite.width = N;
    sprite.height = N;
    const g = sprite.getContext('2d');
    const base = flash ? '#f4f4f4' : ball.color;
    const light = flash ? '#ffffff' : lighten(ball.color, 0.28);
    const dark = flash ? '#c2c3c7' : ball.darkColor;
    const c = (N - 1) / 2;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dx = x - c;
        const dy = y - c;
        const d = Math.hypot(dx, dy);
        if (d > 7.6) continue;
        let col = base;
        if (d > 6.6) col = INK; // outline
        else {
          const shade = (dx + dy) / 7; // light from top-left
          if (shade < -0.55) col = light;
          else if (shade > 0.45) col = dark;
        }
        g.fillStyle = col;
        g.fillRect(x, y, 1, 1);
      }
    }
    // Specular highlight
    g.fillStyle = '#ffffff';
    g.fillRect(4, 4, 2, 1);
    g.fillRect(4, 5, 1, 1);

    // Emblems
    g.fillStyle = 'rgba(26, 28, 44, 0.75)';
    const px = (xx, yy) => g.fillRect(xx, yy, 1, 1);
    if (emblem === 'player') {
      [[7, 5], [8, 5], [6, 6], [9, 6], [5, 7], [10, 7], [5, 8], [10, 8]].forEach(([a, b]) => px(a, b));
      [[7, 8], [8, 8], [6, 9], [9, 9]].forEach(([a, b]) => px(a, b));
    } else if (emblem === 'tank') {
      g.fillRect(5, 5, 6, 1); g.fillRect(5, 10, 6, 1); g.fillRect(5, 5, 1, 6); g.fillRect(10, 5, 1, 6);
    } else if (emblem === 'striker') {
      g.fillRect(6, 5, 1, 6); g.fillRect(9, 5, 1, 6);
    } else if (emblem === 'medic') {
      g.fillStyle = '#b13e53';
      g.fillRect(7, 4, 2, 8); g.fillRect(4, 7, 8, 2);
    } else if (emblem === 'splitter') {
      g.fillRect(5, 6, 2, 2); g.fillRect(9, 8, 2, 2); g.fillRect(7, 7, 2, 1);
    } else if (emblem === 'shielder') {
      g.fillRect(7, 4, 2, 1); g.fillRect(5, 5, 6, 1); g.fillRect(5, 6, 1, 3); g.fillRect(10, 6, 1, 3); g.fillRect(6, 9, 4, 1); g.fillRect(7, 10, 2, 1);
    } else if (emblem === 'minelayer') {
      g.fillRect(5, 5, 1, 1); g.fillRect(6, 6, 1, 1); g.fillRect(7, 7, 2, 2); g.fillRect(9, 9, 1, 1); g.fillRect(10, 10, 1, 1);
      g.fillRect(10, 5, 1, 1); g.fillRect(9, 6, 1, 1); g.fillRect(6, 9, 1, 1); g.fillRect(5, 10, 1, 1);
    } else {
      // Down-pointing triangle
      g.fillRect(5, 6, 6, 1); g.fillRect(6, 7, 4, 1); g.fillRect(7, 8, 2, 1);
      if (emblem !== 'standard') px(7, 10), px(8, 10);
    }

    this._sprites.set(key, sprite);
    return sprite;
  }

  _drawBall(ctx, ball) {
    const r = ball.radius;
    const isFlashing = ball.flashTimer > 0;
    const size = r * 2;

    // Motion trail: fading copies of the sprite
    const speed = Math.hypot(ball.vx || 0, ball.vy || 0);
    if (speed > 150) {
      const sprite = this._ballSprite(ball, false);
      const trail = Math.min(4, Math.floor(speed / 250));
      for (let i = trail; i >= 1; i--) {
        ctx.globalAlpha = 0.18 * (1 - i / (trail + 1)) + 0.05;
        const tx = ball.x - ball.vx * 0.012 * i;
        const ty = ball.y - ball.vy * 0.012 * i;
        ctx.drawImage(sprite, Math.round(tx - r), Math.round(ty - r), size, size);
      }
      ctx.globalAlpha = 1;
    }

    // Status rings (no blur: chunky pixel rings)
    const rings = [];
    if (ball.forcefield) rings.push('#a7f070');
    const odStacks = ball.team === 'player' ? (this.worldRef?.battleStats?.overdriveStacks || 0) : 0;
    if (odStacks > 0) rings.push('#ffcd75');
    if (ball.burnTicks > 0) rings.push('#ef7d57');
    if (ball.isFrozen) rings.push('#73eff7');
    if (ball.corrodeTicks > 0) rings.push('#a7f070');
    if (ball.isOvercharged) rings.push('#ef7d57');
    if (ball.hasFortified) rings.push('#41a6f6');
    rings.forEach((col, i) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = 5;
      ctx.setLineDash([8, 6]);
      ctx.lineDashOffset = (performance.now() / 30) * (i % 2 ? -1 : 1);
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, r + 9 + i * 8, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.setLineDash([]);

    // Alive: resting balls breathe, and landings / hits squash the sprite (anchored at its base)
    const now = performance.now();
    if ((ball._pvy || 0) > 260 && (ball.vy || 0) <= 0) ball._squashAt = now; // just bounced off something below
    ball._pvy = ball.vy || 0;
    let sx = 1;
    let sy = 1;
    const squashAge = now - (ball._squashAt || -1e9);
    if (isFlashing || squashAge < 140) {
      const k = isFlashing ? 1 : 1 - squashAge / 140;
      sx += 0.16 * k;
      sy -= 0.16 * k;
    } else if (speed < 30) {
      const b = Math.sin(now / 420 + (ball.team === 'player' ? 0 : ball.x * 0.013)) * 0.035;
      sx += b;
      sy -= b;
    }
    const dw = Math.round(size * sx);
    const dh = Math.round(size * sy);
    ctx.drawImage(this._ballSprite(ball, isFlashing), Math.round(ball.x - dw / 2), Math.round(ball.y + r - dh), dw, dh);
    if (ball.shieldCharges > 0) {
      ctx.strokeStyle = '#41a6f6';
      ctx.fillStyle = 'rgba(65, 166, 246, 0.2)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + performance.now() / 900;
        const px = ball.x + Math.cos(a) * (r + 12);
        const py = ball.y + Math.sin(a) * (r + 12);
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    if (ball.rank) {
      // Pixel crown marks mini-bosses and bosses (red once enraged)
      const cx = Math.round(ball.x);
      const cy = Math.round(ball.y - r - 18);
      ctx.fillStyle = '#000';
      ctx.fillRect(cx - 17, cy - 1, 34, 16);
      ctx.fillStyle = ball.phase2 ? '#ff5d73' : '#ffcd75';
      ctx.fillRect(cx - 15, cy + 5, 30, 8);
      ctx.fillRect(cx - 15, cy - 3, 6, 8);
      ctx.fillRect(cx - 3, cy - 7, 6, 12);
      ctx.fillRect(cx + 9, cy - 3, 6, 8);
    }
    if (ball.isFrozen) {
      // Icy tint: checkerboard of pale-blue pixels over the ball
      ctx.fillStyle = 'rgba(115, 239, 247, 0.55)';
      const px = size / 16;
      for (let yy = 0; yy < 16; yy++) {
        for (let xx = (yy % 2); xx < 16; xx += 2) {
          if (Math.hypot(xx - 7.5, yy - 7.5) < 6.5) ctx.fillRect(ball.x - r + xx * px, ball.y - r + yy * px, px, px);
        }
      }
    }

    if (odStacks > 0) {
      ctx.font = `700 24px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = INK;
      ctx.fillText(`OVERDRIVE x${odStacks}`, ball.x + 2, ball.y - r - 20);
      ctx.fillStyle = '#ffcd75';
      ctx.fillText(`OVERDRIVE x${odStacks}`, ball.x, ball.y - r - 22);
    }
  }

  // ---------- World: arena hazards ----------

  _drawHazards(ctx, hazards, now) {
    for (const h of hazards) {
      const gy = Math.round(groundAt(h.x + h.w / 2)); // mines can sit on hills
      if (h.type === 'spikes') {
        // Row of pixel spikes with a red warning base
        ctx.fillStyle = '#5d275d';
        ctx.fillRect(h.x, gy - 6, h.w, 6);
        const n = Math.max(2, Math.floor(h.w / 24));
        const sw = h.w / n;
        for (let i = 0; i < n; i++) {
          const x = h.x + i * sw;
          for (let row = 0; row < 6; row++) {
            const inset = (row * sw) / 12;
            ctx.fillStyle = row < 2 ? '#f4f4f4' : '#94b0c2';
            ctx.fillRect(Math.round(x + inset), gy - 30 + row * 4, Math.max(2, Math.round(sw - inset * 2)), 4);
          }
        }
        ctx.fillStyle = '#b13e53';
        for (let x = h.x; x < h.x + h.w; x += 16) ctx.fillRect(x, gy - 4, 8, 4);
      } else if (h.type === 'mine') {
        // Landmine: hazard-striped casing, blinking light, pulsing danger zone
        const cx = Math.round(h.x + h.w / 2);
        const blink = Math.floor(now / 250) % 2 === 0;
        const pulse = (now % 900) / 900;
        ctx.globalAlpha = 0.35 * (1 - pulse);
        ctx.fillStyle = '#ff5d73';
        const zw = 40 + pulse * 50;
        ctx.fillRect(cx - zw, gy - 4, zw * 2, 4);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#1a1c2c';
        ctx.fillRect(cx - 28, gy - 20, 56, 20);
        for (let i = 0; i < 6; i++) {
          ctx.fillStyle = i % 2 ? '#1a1c2c' : '#ffcd75';
          ctx.fillRect(cx - 25 + i * 8.5, gy - 17, 8.5, 14);
        }
        ctx.fillStyle = '#1a1c2c';
        ctx.fillRect(cx - 10, gy - 30, 20, 12);
        ctx.fillStyle = blink ? '#ff5d73' : '#b13e53';
        ctx.fillRect(cx - 7, gy - 28, 14, 9);
        if (blink) {
          ctx.globalAlpha = 0.3;
          ctx.fillRect(cx - 14, gy - 34, 28, 18);
          ctx.globalAlpha = 1;
        }
      } else if (h.type === 'pad') {
        // Spring: the plate rides on its coil and squashes under a ball (Physics.resolvePads)
        const squash = Math.round(h.compress || 0);
        const plateY = gy - 24 + squash;
        ctx.fillStyle = '#333c57';
        ctx.fillRect(h.x, gy - 4, h.w, 4); // housing base
        ctx.fillStyle = '#566c86';
        const coilH = gy - 4 - (plateY + 10);
        for (let k = 0; k < 4; k++) ctx.fillRect(h.x + 12, Math.round(plateY + 10 + (coilH * k) / 4), h.w - 24, 3);
        // Recharging (kick spent) plates are dimmed
        const charged = !(h.cooldown > 0);
        this._pixelBox(ctx, h.x, plateY, h.w, 10, charged ? '#ffcd75' : '#94b0c2', charged ? '#f4f4f4' : '#c2c3c7', charged ? '#ef7d57' : '#566c86', 3);
        if (squash < 2 && charged) {
          ctx.fillStyle = '#1a1c2c';
          ctx.font = `700 18px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.fillText('^^', h.x + h.w / 2, plateY - 6);
        }
      }
    }
  }

  /** Bobbing "!" over each mine, drawn above the balls so it's never hidden. */
  _drawMineMarkers(ctx, hazards, now) {
    for (const h of hazards) {
      const gy = Math.round(groundAt(h.x + h.w / 2)); // mines can sit on hills
      if (h.type !== 'mine') continue;
      const cx = Math.round(h.x + h.w / 2);
      const y = gy - 72 + Math.round(Math.sin(now / 200) * 4);
      this._pixelBox(ctx, cx - 12, y, 24, 26, '#ff5d73', '#ffcd75', '#b13e53', 3);
      ctx.fillStyle = '#1a1c2c';
      ctx.fillRect(cx - 2, y + 5, 5, 10);
      ctx.fillRect(cx - 2, y + 18, 5, 4);
    }
  }

  // ---------- World: special-effect visuals ----------

  /** Jagged energy line between two points (lightning, tethers). */
  _zigzag(ctx, x1, y1, x2, y2, color, width, amp, seed) {
    const segs = 9;
    const nx = -(y2 - y1);
    const ny = x2 - x1;
    const len = Math.hypot(nx, ny) || 1;
    const pts = [[x1, y1]];
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      const off = Math.sin(seed * 12.9898 + i * 78.233) * amp;
      pts.push([x1 + (x2 - x1) * t + (nx / len) * off, y1 + (y2 - y1) * t + (ny / len) * off]);
    }
    pts.push([x2, y2]);
    for (const [col, w] of [['#000', width + 6], [color, width], ['#f4f4f4', Math.max(2, width / 3)]]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.stroke();
    }
  }

  /** Armed skill: a pulsing ring in the skill's colour around your ball. */
  _drawSkillAura(ctx, world, now) {
    const player = world.player;
    const armed = world.battleStats?.skillArmed;
    if (!player || player.hp <= 0 || !armed) return;
    const pulse = (now / 500) % 1;
    ctx.strokeStyle = armed.color;
    ctx.lineWidth = 4;
    ctx.globalAlpha = 0.9 * (1 - pulse);
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.radius + 8 + pulse * 26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** Spawn and move status particles: flames (burn), frost (frozen), acid drips (corrode). */
  _updateAmbient(dt, balls) {
    for (const ball of balls) {
      if (!ball || ball.hp <= 0) continue;
      const r = ball.radius;
      const spawn = (color, vy, size) => {
        this._ambient.push({ x: ball.x + (Math.random() - 0.5) * r * 1.6, y: ball.y + (Math.random() - 0.5) * r, vy, color, size, life: 0.6, max: 0.6 });
      };
      if (ball.burnTicks > 0 && Math.random() < dt * 30) spawn(Math.random() < 0.5 ? '#ef7d57' : '#ffcd75', -140, 8);
      if (ball.isFrozen && Math.random() < dt * 10) spawn('#f4f4f4', 30, 6);
      if (ball.corrodeTicks > 0 && Math.random() < dt * 10) spawn('#a7f070', 120, 7);
    }
    this._ambient = this._ambient.filter((p) => {
      p.life -= dt;
      p.y += p.vy * dt;
      return p.life > 0;
    });
  }

  _drawAmbient(ctx) {
    for (const p of this._ambient) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      const s = Math.round(p.size * (0.5 + p.life / p.max / 2));
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- HUD ----------

  _panel(ctx, x, y, w, h) {
    ctx.fillStyle = '#000';
    ctx.fillRect(x + 3, y + 3, w, h);
    ctx.fillStyle = 'rgba(26, 28, 44, 0.92)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#333c57';
    ctx.fillRect(x, y, w, 2);
    ctx.fillRect(x, y + h - 2, w, 2);
    ctx.fillRect(x, y, 2, h);
    ctx.fillRect(x + w - 2, y, 2, h);
  }

  _hpBar(ctx, x, y, w, h, ball, fillColor) {
    const pct = Math.max(0, ball.hp / ball.maxHp);
    ctx.fillStyle = '#10111c';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = pct > 0.3 ? fillColor : '#ff5d73';
    ctx.fillRect(x, y, Math.round(w * pct), h);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(x, y, Math.round(w * pct), 2);

    const shieldHp = ball.team === 'player' ? (ball.shieldHp || 0) : 0;
    if (shieldHp > 0) {
      ctx.fillStyle = 'rgba(115, 239, 247, 0.8)';
      ctx.fillRect(x, y + h - 3, Math.round(w * Math.min(1, shieldHp / ball.maxHp)), 3);
    }
  }

  /** Gear combat: thin energy (cyan) and heat (orange, red when too hot) bars under HP. */
  _reactorBars(ctx, x, y, w, ball) {
    const half = Math.floor((w - 4) / 2);
    const bar = (bx, frac, color) => {
      ctx.fillStyle = '#10111c';
      ctx.fillRect(bx, y, half, 6);
      ctx.fillStyle = color;
      ctx.fillRect(bx, y, Math.round(half * Math.max(0, Math.min(1, frac))), 6);
    };
    bar(x, ball.energy / (ball.energyMax || 1), '#73eff7');
    bar(x + half + 4, ball.heat / (ball.heatCap || 1), ball.heat > ball.heatCap * 0.8 ? '#ff5d73' : '#ef7d57');
    ctx.font = `700 9px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#73eff7';
    ctx.fillText(`EN ${Math.floor(ball.energy)}`, x, y + 16);
    ctx.fillStyle = ball.heat > ball.heatCap ? '#ff5d73' : '#ef7d57';
    ctx.fillText(`HEAT ${Math.ceil(ball.heat)}/${ball.heatCap}`, x + half + 4, y + 16);
  }

  _drawHpPanels(ctx, view, player, enemies) {
    const pad = 8;
    const panelW = Math.min(200, Math.max(150, view.cssW * 0.22));
    const gear = !!this.worldRef?.gear;
    const panelH = gear ? 58 : 40;
    // Screen-space tap targets: tapping a panel inspects that ball's weapons
    this.panelHits = [];

    if (player) {
      const x = pad;
      const y = pad;
      this._panel(ctx, x, y, panelW, panelH);
      ctx.textAlign = 'left';
      ctx.font = `700 12px ${FONT}`;
      ctx.fillStyle = '#73eff7';
      ctx.fillText('YOU', x + 8, y + 14);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#f4f4f4';
      const shieldHp = player.shieldHp || 0;
      ctx.fillText(`${Math.ceil(player.hp)}/${player.maxHp}${shieldHp > 0 ? ` +${Math.ceil(shieldHp)}` : ''}`, x + panelW - 8, y + 14);
      this._hpBar(ctx, x + 8, y + 20, panelW - 16, 12, player, '#41a6f6');
      if (gear) this._reactorBars(ctx, x + 8, y + 36, panelW - 16, player);
      this._drawStatusTags(ctx, player, x, y + panelH + 6, panelW, false);
      this.panelHits.push({ x, y, w: panelW, h: panelH, ball: player });
    }

    enemies.forEach((enemy, i) => {
      const x = view.cssW - pad - panelW;
      const y = pad + i * (panelH + 16);
      this._panel(ctx, x, y, panelW, panelH);
      const arch = CONFIG.enemyArchetypes[enemy.archetype];
      ctx.font = `700 11px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.fillStyle = arch?.color || '#ff5d73';
      ctx.fillText(fitText(ctx, enemy.displayName || 'HOSTILE', panelW - 70), x + 8, y + 14);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#f4f4f4';
      ctx.fillText(`${Math.ceil(enemy.hp)}/${enemy.maxHp}`, x + panelW - 8, y + 14);
      this._hpBar(ctx, x + 8, y + 20, panelW - 16, 12, enemy, '#ef7d57');
      if (gear) this._reactorBars(ctx, x + 8, y + 36, panelW - 16, enemy);
      this._drawStatusTags(ctx, enemy, x, y + panelH + 4, panelW, true);
      const bw = this._drawGunBadges(ctx, enemy, x, y);
      this.panelHits.push({ x: x - bw, y, w: panelW + bw, h: panelH, ball: enemy });
    });
  }

  /**
   * Small weapon icons to the left of an enemy's HP panel, so you can see
   * who is armed at a glance (tap to inspect). Returns the width used.
   */
  _drawGunBadges(ctx, enemy, panelX, panelY) {
    const guns = enemy.weapons || [];
    const inspected = this.worldRef?.inspected?.ball === enemy;
    const size = 30;
    guns.forEach((g, i) => {
      const bx = panelX - (i + 1) * (size + 3);
      ctx.fillStyle = 'rgba(26, 28, 44, 0.92)';
      ctx.fillRect(bx, panelY + 5, size, size);
      ctx.fillStyle = inspected ? '#ffcd75' : g.color || '#566c86';
      ctx.fillRect(bx, panelY + 5 + size - 3, size, 3);
      const ic = partCanvas(g.id);
      const gear = !!this.worldRef?.gear;
      const spent = gear ? g.ammo && g.ammoLeft <= 0 : g.cdLeft > 0;
      ctx.globalAlpha = spent ? 0.45 : 1;
      ctx.drawImage(ic, Math.round(bx + (size - ic.width * 2) / 2), Math.round(panelY + 5 + (size - 3 - ic.height * 2) / 2), ic.width * 2, ic.height * 2);
      ctx.globalAlpha = 1;
      if (gear && g.ammo) {
        ctx.font = `700 10px ${FONT}`;
        ctx.textAlign = 'right';
        ctx.fillStyle = g.ammoLeft > 0 ? '#ffcd75' : '#566c86';
        ctx.fillText(`${g.ammoLeft}`, bx + size - 3, panelY + 16);
      } else if (!gear && g.cdLeft > 0) {
        ctx.font = `700 10px ${FONT}`;
        ctx.textAlign = 'right';
        ctx.fillStyle = '#f4f4f4';
        ctx.fillText(`${g.cdLeft}`, bx + size - 3, panelY + 16);
      }
    });
    return guns.length ? guns.length * (size + 3) : 0;
  }

  _drawStatusTags(ctx, ball, panelX, tagY, panelW, alignRight) {
    const tags = [];
    if (ball.burnTicks > 0)
      tags.push({ label: `BURN ${ball.burnTicks}`, color: '#ef7d57', desc: `Burning! Takes ${ball.burnDmg || 8} damage at the start of each turn. ${ball.burnTicks} turn(s) remaining.` });
    if (ball.isFrozen)
      tags.push({ label: 'FROZEN', color: '#73eff7', desc: 'Frozen! Next launch speed reduced by 35%.' });
    if (ball.corrodeTicks > 0)
      tags.push({ label: `ACID ${ball.corrodeTicks}`, color: '#a7f070', desc: `Corroded! Loses ${ball.corrodeDefDrain || 1} DEF at the start of each turn. ${ball.corrodeTicks} turn(s) remaining.` });
    if (ball.isRallied)
      tags.push({ label: 'RALLIED', color: '#ffcd75', desc: 'Rallied by Field Commander: +20% ATK and +3 DEF.' });
    if (ball.isOvercharged)
      tags.push({ label: 'CHARGED', color: '#ef7d57', desc: 'Sniper Overcharged! Next shot launch velocity increased by +35%.' });
    if (ball.hasFortified)
      tags.push({ label: 'FORTIFIED', color: '#41a6f6', desc: 'Fortified Shield! Defense increased by +3.' });
    if (ball.exposed)
      tags.push({ label: 'EXPOSED', color: '#ffcd75', desc: 'Rammed! Takes +25% gun damage until its next turn.' });
    if (ball.heatCap && ball.heat > ball.heatCap)
      tags.push({ label: 'OVERHEATED', color: '#ff5d73', desc: 'Too hot to fire until it cools down.' });

    if (ball.team === 'player') {
      const bs = this.worldRef?.battleStats;
      const odStacks = bs?.overdriveStacks || (bs?.overdriveActive ? 1 : 0);
      if (odStacks > 0) tags.push({ label: `OVERDRIVE${odStacks > 1 ? ` x${odStacks}` : ''}`, color: '#ffcd75', desc: `Overdrive Active! Next shot deals increased damage. (${odStacks} stack(s))` });
      const armed = bs?.skillArmed;
      if (armed) tags.push({ label: armed.label, color: armed.color, desc: armed.desc });
      if (ball.forcefield) tags.push({ label: 'FORCEFIELD', color: '#a7f070', desc: 'Forcefield Barrier Active! Blocks 1 incoming attack.' });
    }
    if (tags.length === 0) return;

    const rect = this.canvas.getBoundingClientRect();
    ctx.font = `700 10px ${FONT}`;
    const tagH = 15;
    const gap = 3;
    const widths = tags.map((t) => Math.ceil(ctx.measureText(t.label).width) + 10);
    const total = widths.reduce((a, b) => a + b, 0) + gap * (tags.length - 1);
    let tx = alignRight ? panelX + panelW - Math.min(total, panelW) : panelX;
    let ty = tagY;
    tags.forEach((tag, i) => {
      const tw = widths[i];
      if (alignRight ? false : tx + tw > panelX + panelW) {
        tx = panelX;
        ty += tagH + gap;
      }
      ctx.fillStyle = 'rgba(16, 17, 28, 0.9)';
      ctx.fillRect(tx, ty, tw, tagH);
      ctx.fillStyle = tag.color;
      ctx.fillRect(tx, ty, tw, 2);
      ctx.fillRect(tx, ty + tagH - 2, tw, 2);
      ctx.textAlign = 'left';
      ctx.fillText(tag.label, tx + 5, ty + 11);
      this._hoverZones.push({ x: rect.left + tx, y: rect.top + ty, w: tw, h: tagH, desc: tag.desc, color: tag.color });
      tx += tw + gap;
    });
  }

  _handleTooltipMove(e) {
    for (const zone of this._hoverZones) {
      if (e.clientX >= zone.x && e.clientX <= zone.x + zone.w &&
          e.clientY >= zone.y && e.clientY <= zone.y + zone.h) {
        this._tooltip.textContent = zone.desc;
        this._tooltip.style.display = 'block';
        this._tooltip.style.left = Math.min(window.innerWidth - 250, e.clientX + 12) + 'px';
        this._tooltip.style.top = (e.clientY + 14) + 'px';
        this._tooltip.style.borderColor = zone.color;
        return;
      }
    }
    this._tooltip.style.display = 'none';
  }

  _worldToCss(view, x, y) {
    return { x: (view.ox + x * view.k) / view.dpr, y: (view.oy + y * view.k) / view.dpr };
  }

  /** Text with a thick black outline + drop shadow: readable over any background. */
  _outlinedText(ctx, text, x, y, color, stroke = 5) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = stroke;
    ctx.strokeStyle = '#000';
    ctx.strokeText(text, x + 2, y + 2);
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  /**
   * Damage / heal numbers drawn on a solid tag (dark fill, coloured border) so
   * they stay readable over any backdrop, weather or effect.
   */
  _drawFloaters(ctx, view, dt) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    this._floaters = this._floaters.filter((f) => {
      f.t += dt;
      if (f.t >= f.life) return false;
      const p = this._worldToCss(view, f.x, f.y);
      const rise = 26 * easeOut(Math.min(1, f.t / 0.5)) + f.stack * 30;
      const pop = f.t < 0.1 ? 1.3 - f.t * 3 : 1;
      const size = Math.round((f.big ? 22 : 17) * pop);
      ctx.font = `400 ${size}px ${DISPLAY}`;
      const w = Math.ceil(ctx.measureText(f.text).width) + 14;
      const h = size + 12;
      const x = Math.round(p.x - w / 2);
      const y = Math.round(p.y - rise - h / 2);
      ctx.globalAlpha = f.t > f.life - 0.25 ? (f.life - f.t) / 0.25 : 1;
      ctx.fillStyle = '#000';
      ctx.fillRect(x + 3, y + 3, w, h);
      ctx.fillStyle = f.color;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#10111c';
      ctx.fillRect(x + 3, y + 3, w - 6, h - 6);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, p.x + 1, y + h / 2 + 1);
      return true;
    });
    ctx.globalAlpha = 1;
    ctx.textBaseline = 'alphabetic';
  }

  _drawCallouts(ctx, view, dt) {
    ctx.textAlign = 'center';
    ctx.font = `700 14px ${FONT}`;
    this._callouts = this._callouts.filter((c) => {
      c.t += dt;
      if (c.t >= c.life || !c.ball) return false;
      const p = this._worldToCss(view, c.ball.x, c.ball.y - c.ball.radius);
      const y = p.y - 82 - c.stack * 24 - 10 * easeOut(Math.min(1, c.t / 0.2)); // above the damage numbers
      const w = Math.ceil(ctx.measureText(c.text).width) + 14;
      ctx.globalAlpha = c.t > c.life - 0.25 ? (c.life - c.t) / 0.25 : Math.min(1, c.t / 0.08);
      ctx.fillStyle = '#000';
      ctx.fillRect(Math.round(p.x - w / 2) + 2, Math.round(y - 15) + 2, w, 21);
      ctx.fillStyle = 'rgba(16, 17, 28, 0.95)';
      ctx.fillRect(Math.round(p.x - w / 2), Math.round(y - 15), w, 21);
      ctx.fillStyle = c.color;
      ctx.fillRect(Math.round(p.x - w / 2), Math.round(y - 15), w, 3);
      ctx.fillText(c.text, p.x, y + 1);
      return true;
    });
    ctx.globalAlpha = 1;
  }

  /** Arrows on the top edge for balls that flew above the visible area. */
  _drawOffscreenMarkers(ctx, view, balls) {
    for (const ball of balls) {
      if (!ball || ball.hp <= 0) continue;
      const p = this._worldToCss(view, ball.x, ball.y + ball.radius);
      if (p.y > 0) continue;
      const x = Math.round(Math.max(12, Math.min(view.cssW - 12, p.x)));
      const y = 56;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.moveTo(x, y - 12 + 2);
      ctx.lineTo(x - 10, y + 4);
      ctx.lineTo(x + 10, y + 4);
      ctx.fill();
      ctx.fillStyle = ball.team === 'player' ? '#73eff7' : '#ff5d73';
      ctx.beginPath();
      ctx.moveTo(x, y - 12);
      ctx.lineTo(x - 9, y + 2);
      ctx.lineTo(x + 9, y + 2);
      ctx.fill();
    }
  }

  _drawPowerMeter(ctx, view, world) {
    const input = world.slingshotInput;
    if (!input?.dragging || !input.launchVelocity || !world.player) return;
    const speed = Math.hypot(input.launchVelocity.x, input.launchVelocity.y);
    const maxPower = S.maxPower * (input.powerMult || 1);
    const pct = Math.max(0, Math.min(1, (speed - S.minPower) / (maxPower - S.minPower)));
    const p = this._worldToCss(view, world.player.x, world.player.y);
    const bw = 10;
    const bh = 56;
    const x = Math.round(p.x - world.player.radius * view.k / view.dpr - 22);
    const y = Math.round(p.y - bh / 2 - 10);
    ctx.fillStyle = '#000';
    ctx.fillRect(x - 2, y - 2, bw + 4, bh + 4);
    ctx.fillStyle = '#10111c';
    ctx.fillRect(x, y, bw, bh);
    const fh = Math.round(bh * pct);
    ctx.fillStyle = pct > 0.85 ? '#ff5d73' : pct > 0.5 ? '#ffcd75' : '#a7f070';
    ctx.fillRect(x, y + bh - fh, bw, fh);
    ctx.font = `700 11px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f4f4f4';
    ctx.fillText(`${Math.round(pct * 100)}%`, x + bw / 2, y - 6);
  }

  _drawBarrierHint(ctx, view, world) {
    const input = world.slingshotInput;
    if (input?.placementMode !== 'barrier') return;
    const text = this.barrierCancelHover ? 'RELEASE TO CANCEL' : 'RELEASE TO PLACE · DRAG BACK TO CANCEL';
    this._centerNotice(ctx, view, text, this.barrierCancelHover ? '#ff5d73' : '#73eff7', view.cssH * 0.5);
  }

  _drawTurnHint(ctx, view, turnSystem, world) {
    if ((world.battleStats?.turns || 0) > 1) return; // teach the controls on the first turns only
    if (turnSystem?.phase !== 'PLAYER_AIM' || world.slingshotInput?.dragging || world.slingshotInput?.placementMode) return;
    if (world.gear && !(world.player?.actionsLeft > 0)) return;
    this._centerNotice(ctx, view, world.gear ? '2 ACTIONS: DRAG TO MOVE, TAP A GUN TO FIRE, OR VENT' : 'DRAG ANYWHERE, PULL BACK & RELEASE TO FIRE', '#f4f4f4', view.cssH * 0.66);
  }

  /**
   * Floor weather: 1 dust motes, 2 rain, 3 rising embers, 4 toxic spores, 5 falling ash.
   * Drifts with the arena wind.
   */
  _drawWeather(ctx, view, dt, floor) {
    const kinds = {
      1: { rate: 8, color: 'rgba(255, 205, 117, 0.5)', vy: 12, size: 2, len: 1 },
      2: { rate: 70, color: 'rgba(148, 176, 194, 0.55)', vy: 520, size: 2, len: 12 },
      3: { rate: 14, color: 'rgba(239, 125, 87, 0.8)', vy: -45, size: 3, len: 1 },
      4: { rate: 12, color: 'rgba(167, 240, 112, 0.5)', vy: 18, size: 3, len: 1 },
      5: { rate: 20, color: 'rgba(148, 176, 194, 0.5)', vy: 45, size: 2, len: 1 },
    };
    const k = kinds[floor] || kinds[1];
    const drift = (W.wind || 0) * 0.15;
    if (this._weather.length < 140 && Math.random() < dt * k.rate) {
      const count = floor === 2 ? 3 : 1;
      for (let i = 0; i < count; i++) {
        this._weather.push({ x: Math.random() * view.cssW, y: k.vy >= 0 ? -10 : view.cssH + 10, wob: Math.random() * 6 });
      }
    }
    ctx.fillStyle = k.color;
    this._weather = this._weather.filter((p) => {
      p.y += k.vy * dt;
      p.x += (drift + Math.sin(p.y / 40 + p.wob) * (floor === 2 ? 0 : 12)) * dt;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), k.size, k.size * k.len);
      return p.y > -20 && p.y < view.cssH + 20;
    });
  }

  /** Wind: drifting streaks across the screen + an arrow under the top label. */
  _drawWind(ctx, view, dt, wind) {
    if (!wind) return;
    const dir = Math.sign(wind);
    const strength = Math.min(1, Math.abs(wind) / 360);
    if (Math.random() < dt * (10 + 30 * strength)) {
      this._wind.push({ x: dir > 0 ? -40 : view.cssW + 40, y: 60 + Math.random() * (view.cssH - 140), len: 20 + Math.random() * 40, v: 250 + 400 * strength });
    }
    ctx.fillStyle = 'rgba(244, 244, 244, 0.35)';
    this._wind = this._wind.filter((s) => {
      s.x += dir * s.v * dt;
      ctx.fillRect(Math.round(s.x), Math.round(s.y), Math.round(s.len), 2);
      return s.x > -80 && s.x < view.cssW + 80;
    });
    // Indicator
    const arrows = Math.max(1, Math.round(strength * 3));
    const label = `WIND ${dir > 0 ? '>'.repeat(arrows) : '<'.repeat(arrows)}`;
    ctx.font = `700 12px ${FONT}`;
    ctx.textAlign = 'center';
    const w = ctx.measureText(label).width + 16;
    ctx.fillStyle = 'rgba(16, 17, 28, 0.85)';
    ctx.fillRect(view.cssW / 2 - w / 2, 40, w, 18);
    ctx.fillStyle = '#73eff7';
    ctx.fillText(label, view.cssW / 2, 53);
  }

  _drawArenaIntro(ctx, view, dt) {
    const a = this._arenaIntro;
    if (!a) return;
    a.t += dt;
    if (a.t > 3) {
      this._arenaIntro = null;
      return;
    }
    ctx.globalAlpha = a.t > 2.6 ? (3 - a.t) / 0.4 : Math.min(1, a.t / 0.2);
    const y = view.cssH * 0.3 + 44;
    ctx.textAlign = 'center';
    ctx.font = `400 12px ${DISPLAY}`;
    const w = Math.max(ctx.measureText(a.name).width, 200) + 40;
    ctx.fillStyle = 'rgba(16, 17, 28, 0.88)';
    ctx.fillRect(view.cssW / 2 - w / 2, y - 16, w, 44);
    this._outlinedText(ctx, a.name, view.cssW / 2, y, '#ffcd75', 4);
    ctx.font = `700 13px ${FONT}`;
    ctx.fillStyle = '#dfe6ee';
    ctx.fillText(a.desc, view.cssW / 2, y + 20);
    ctx.globalAlpha = 1;
  }

  _centerNotice(ctx, view, text, color, y) {
    ctx.font = `700 13px ${FONT}`;
    ctx.textAlign = 'center';
    const w = Math.ceil(ctx.measureText(text).width) + 20;
    const x = Math.round(view.cssW / 2 - w / 2);
    ctx.fillStyle = 'rgba(16, 17, 28, 0.85)';
    ctx.fillRect(x, y - 16, w, 24);
    ctx.fillStyle = color;
    ctx.fillRect(x, y - 16, w, 2);
    ctx.fillText(text, view.cssW / 2, y);
  }

  _drawBanner(ctx, view, dt) {
    const b = this._banner;
    if (!b) return;
    b.t += dt;
    const life = 0.9;
    if (b.t >= life) {
      this._banner = null;
      return;
    }
    // Slide in, hold, slide out
    const inT = Math.min(1, b.t / 0.15);
    const outT = Math.max(0, (b.t - (life - 0.2)) / 0.2);
    const offset = (1 - easeOut(inT)) * -view.cssW * 0.5 + easeIn(outT) * view.cssW * 0.5;
    const y = Math.round(view.cssH * 0.3);
    ctx.fillStyle = 'rgba(16, 17, 28, 0.85)';
    ctx.fillRect(0, y - 26, view.cssW, 40);
    ctx.fillStyle = b.color;
    ctx.fillRect(0, y - 26, view.cssW, 3);
    ctx.fillRect(0, y + 11, view.cssW, 3);
    ctx.font = `400 20px ${DISPLAY}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#000';
    ctx.fillText(b.text, view.cssW / 2 + offset + 3, y + 3);
    ctx.fillStyle = b.color;
    ctx.fillText(b.text, view.cssW / 2 + offset, y);
  }

  _drawGameOver(ctx, view, winner, summary) {
    ctx.fillStyle = 'rgba(8, 9, 16, 0.78)';
    ctx.fillRect(0, 0, view.cssW, view.cssH);
    const won = winner === 'player';
    const cy = view.cssH / 2;
    ctx.textAlign = 'center';
    ctx.font = `400 ${Math.min(34, view.cssW / 14)}px ${DISPLAY}`;
    ctx.fillStyle = '#000';
    ctx.fillText(won ? 'VICTORY' : 'DEFEATED', view.cssW / 2 + 4, cy - 14 + 4);
    ctx.fillStyle = won ? '#a7f070' : '#ff5d73';
    ctx.fillText(won ? 'VICTORY' : 'DEFEATED', view.cssW / 2, cy - 14);
    ctx.font = `700 15px ${FONT}`;
    ctx.fillStyle = '#94b0c2';
    if (summary) ctx.fillText(`${summary.kills} eliminations · ${summary.turns} turns`, view.cssW / 2, cy + 18);
    if (Math.floor(performance.now() / 500) % 2 === 0) {
      ctx.fillStyle = '#f4f4f4';
      ctx.fillText('TAP TO CONTINUE', view.cssW / 2, cy + 48);
    }
  }
}

// ---------- helpers ----------

function lighten(hex, amount) {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.min(255, (num >> 16) + Math.round(255 * amount));
  const g = Math.min(255, ((num >> 8) & 0xff) + Math.round(255 * amount));
  const b = Math.min(255, (num & 0xff) + Math.round(255 * amount));
  return `rgb(${r}, ${g}, ${b})`;
}

function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

function easeOut(t) {
  return 1 - Math.pow(1 - t, 3);
}

function easeIn(t) {
  return t * t * t;
}

/** Small deterministic PRNG so each floor's skyline is stable. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
