// ============================================================
// Renderer — pixel-art battle presentation.
//
// Three layers per frame:
//   1. Backdrop  — cached low-res pixel art (sky, skyline, ground)
//                  filling the whole screen, themed per floor.
//   2. World     — the 1280×750 arena (mechs, hazards,
//                  particles, aim line), scaled to fit and centred.
//   3. HUD       — screen-space UI in CSS px: HP panels pinned to
//                  the corners, floating damage/heal numbers, turn
//                  banners, power meter, victory/defeat overlay.
// ============================================================

import { CONFIG } from '../config.js';
import { getTerrain, groundAt } from '../core/Terrain.js';
import { fitCanvas, clientToWorld } from './viewport.js';
import { partCanvas, iconCanvas, iconSize } from './pixelIcons.js';
import { showTip, hideTip, battlePartHtml } from '../ui/partCard.js';
import { DTYPES, DTYPE_KEYS, dtypeOf, resistOf, legsLabel, reachLabel, LANE_SIZE, dmgLabel, meleeOf, signatureOf } from '../meta/Mech.js';
import { mechLook, torsoCanvas, legsCanvas } from './mechSprite.js';
import { drawEffect } from './fxDraw.js';

// Boss crown (k outline, y gold, o gold shade, w glint, r / c gems), drawn in the mech's sprite pixels
const CROWN = [
  '.k...k...k.',
  'kwk.kyk.kyk',
  'kyykyyykyyk',
  'kyyyyyyyyyk',
  'kyrywycyryk',
  'kyyyyyyyyyk',
  'koooooooook',
  'kkkkkkkkkkk',
];

const C = CONFIG.colors;
const W = CONFIG.world;

// ---------- Melee (Game hits at 200 ms, mid-lunge) ----------
const MELEE_MS = 460;
const smooth = (t) => t * t * (3 - 2 * t);
/** Piecewise curve through [t, v] keys, eased between them. */
const curve = (pts, t) => {
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i][0]) {
      const [t0, v0] = pts[i - 1];
      const [t1, v1] = pts[i];
      return v0 + (v1 - v0) * smooth((t - t0) / (t1 - t0));
    }
  }
  return pts[pts.length - 1][1];
};
/**
 * How the weapon moves on the mech during a swing (t 0..1): `dx` pushes it
 * out along its aim (negative pulls it back), `ang` tips it (negative lifts the tip).
 *   slash  – lift the blade high, then carve down through the target
 *   rake   – cock back, then drag the talons through with a twist
 *   punch  – pull the fist in, then drive it straight out
 *   thrust – draw the ram far back, then slam it forward
 */
function meleeSwing(style, t) {
  switch (style) {
    case 'slash':
      return { dx: curve([[0, 0], [0.3, -4], [0.5, 14], [1, 0]], t), ang: curve([[0, 0], [0.3, -1.6], [0.52, 1.5], [0.75, 1.1], [1, 0]], t) };
    case 'rake':
      return { dx: curve([[0, 0], [0.28, -10], [0.46, 26], [1, 0]], t), ang: curve([[0, 0], [0.28, -0.6], [0.5, 0.7], [1, 0]], t) };
    case 'punch':
      return { dx: curve([[0, 0], [0.3, -16], [0.44, 36], [0.7, 30], [1, 0]], t), ang: 0 };
    default: // thrust
      return { dx: curve([[0, 0], [0.34, -24], [0.46, 44], [0.72, 38], [1, 0]], t), ang: 0 };
  }
}

const FONT = '"Pixel Digits", "Pixelify Sans", monospace'; // clear digits: see styles.css
const DISPLAY = '"Press Start 2P", monospace';
const BG_PIXEL = 3; // CSS px per backdrop pixel
const SKY_CROP = 200; // world units of empty sky that wide phones may crop to draw the action bigger
// Battle camera: frames the fighters and zooms in as they close in
const CAM = {
  margin: 140, // world units kept on each side of the outermost fighters
  minWidth: 700, // never zoom in further than this much arena (about 1.8x on the lane)
  floorShown: 70, // world units of floor under the ground line once zoomed in
  headroom: 170, // sky kept above the highest fighter
  ease: 3, // how quickly the camera catches up (per second)
};

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
    // A long time in the background can blank the cached canvases: rebuild them on return
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this._bgCache = null;
    });
    this._floaters = []; // floating damage / heal numbers
    this._callouts = []; // short labels above balls (hits, status)
    this._ambient = []; // status-effect particles (flames, frost, acid)
    this._hpSeen = new Map(); // ball → last seen hp
    this._banner = null; // { text, color, t }
    this._arenaIntro = null; // { name, desc, wind, t }
    this._wind = []; // wind streak particles (screen space)
    this._weather = []; // per-floor weather particles (screen space)
    this._lastPhase = null;

    // Tooltip overlay for status tags
    this._hoverZones = [];
    this._tooltip = document.createElement('div');
    this._tooltip.className = 'status-tooltip';
    this._tooltip.style.display = 'none';
    document.body.appendChild(this._tooltip);

    this._onMouseMove = (e) => this._handleTooltipMove(e);
    this._onMouseLeave = () => {
      this._tooltip.style.display = 'none';
      if (this._gearTip) {
        this._gearTip = null;
        hideTip();
      }
    };
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

  /** Start HP tracking over for a ball (a swapped-in mech isn't damage or healing). */
  forgetHp(ball) {
    this._hpSeen.set(ball, ball.hp);
  }

  /** Label that follows a ball for a moment: hits, status changes. */
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
    this._cam = null; // snap to the new arena
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

    const base = fitCanvas(this.canvas, W.width, W.height, SKY_CROP);
    this.worldRef = world;
    const { ctx } = this;
    const { player, enemies, turnSystem, particles } = world || {};
    const enemyList = enemies || [];
    const livingEnemies = enemyList.filter((e) => e && e.hp > 0);
    const view = this._camera(base, [player, ...livingEnemies], world, dt);
    this._view = view;
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
    // The backdrop is painted for the whole-arena view; draw it through the camera
    const bz = view.k / base.k;
    ctx.drawImage(this._backdrop(base, floor), Math.round(view.ox - base.ox * bz + shakeX * 0.5), Math.round(view.oy - base.oy * bz + shakeY * 0.5), Math.round(base.w * bz), Math.round(base.h * bz));

    // 2. World
    ctx.setTransform(view.k, 0, 0, view.k, view.ox + shakeX, view.oy + shakeY);
    if (world.lane) this._drawLane(ctx, world, now);
    this._drawHazards(ctx, world.hazards || [], now);
    this._drawPlatformsAndObstacles(ctx, world.platforms || [], world.obstacles || []);
    this._drawParticles(ctx, particles || []);
    this._updateAmbient(dt, [player, ...livingEnemies]);
    this._drawAmbient(ctx);
    for (const ball of [player, ...livingEnemies]) {
      if (ball && ball.hp > 0) this._drawBallShadow(ctx, ball);
    }
    // A melee swing lunges the whole mech in and back: shift it just for drawing
    const lunging = [player, ...livingEnemies].filter(Boolean).map((b) => [b, this._lunge(b, now)]).filter(([, d]) => d);
    for (const [b, d] of lunging) b.x += d;
    // Legs first, so the ball sits on top of them
    for (const ball of [player, ...livingEnemies]) if (ball?.hp > 0) this._drawLegs(ctx, world, ball, now);
    // The gun on the far shoulder goes behind the torso, the near one in front
    this._drawGear(ctx, world, player, livingEnemies, 'back');
    if (player && player.hp > 0) this._drawBall(ctx, player, world, now);
    for (const enemy of livingEnemies) this._drawBall(ctx, enemy, world, now);
    this._drawGear(ctx, world, player, livingEnemies, 'front');
    for (const [b, d] of lunging) b.x -= d;
    this._drawProjectiles(ctx, world, now);
    this._drawMeleeFx(ctx, world, player, livingEnemies, now);
    this._drawMineMarkers(ctx, world.hazards || [], now);
    this._drawMechRanges(ctx, world);
    this._drawInspectCard(ctx, world);

    // 3. HUD (CSS px)
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    this._drawWeather(ctx, view, dt, floor);
    this._hoverZones = [];
    this._gearZones = [];
    this._drawHpPanels(ctx, view, player, livingEnemies);
    this._drawOffscreenMarkers(ctx, view, [player, ...livingEnemies]);
    this._drawIntent(ctx, view, world);
    this._drawCallouts(ctx, view, dt);
    this._drawFloaters(ctx, view, dt);
    this._drawTurnHint(ctx, view, turnSystem, world);
    this._drawWind(ctx, view, dt, W.wind || 0);
    this._drawArenaIntro(ctx, view, dt);
    this._drawBanner(ctx, view, dt);
    if (turnSystem?.phase === 'GAME_OVER' && world.winner) {
      this._drawGameOver(ctx, view, world.winner, world.battleSummary);
    }
  }

  /**
   * Battle camera: starts from `base` (the whole arena) and zooms in on the
   * fighters, keeping CAM.margin around them, the ground near the bottom and
   * headroom over anyone in the air. Eased, and frozen while you drag (so the
   * slingshot doesn't slide under your finger).
   */
  _camera(base, balls, world, dt) {
    const fighters = balls.filter((b) => b && b.hp > 0);
    if (fighters.length) {
      const xs = fighters.map((b) => b.x);
      // On the lane: the plates you can move to stay in view too (a teleport pick shows the whole lane)
      const lane = world?.lane;
      if (lane?.moves) {
        for (const pos of lane.moves.keys()) {
          const p = this._plate(pos, lane.size);
          xs.push(p.x + p.w * 0.1, p.x + p.w * 0.9);
        }
      }
      const minX = Math.min(...xs) - CAM.margin;
      const maxX = Math.max(...xs) + CAM.margin;
      const topY = Math.min(...fighters.map((b) => b.y - b.radius)) - CAM.headroom;
      const visW = Math.min(W.width, Math.max(CAM.minWidth, maxX - minX));
      let k = Math.max(base.k, base.w / visW);
      // Zooming in drops the floor below the ground line out of view
      const zin = Math.min(1, (k / base.k - 1) / 0.4);
      const bottomY = W.height - zin * (W.height - (W.groundY + CAM.floorShown));
      k = Math.max(base.k, Math.min(k, base.h / Math.max(1, bottomY - topY)));
      const vw = base.w / k;
      const cx = (minX + maxX) / 2;
      const left = vw >= W.width ? (W.width - vw) / 2 : Math.max(0, Math.min(W.width - vw, cx - vw / 2));
      const target = { k, left, bottomY };
      if (!this._cam) this._cam = target;
      else {
        const a = 1 - Math.exp(-CAM.ease * dt);
        for (const key of Object.keys(target)) this._cam[key] += (target[key] - this._cam[key]) * a;
      }
    }
    const cam = this._cam;
    if (!cam) return base;
    // Same fields as fitCanvas, so everything that maps world <-> screen follows the camera
    // (fully zoomed out this gives exactly `base`: arena centred, world bottom on the screen bottom)
    const k = Math.max(base.k, cam.k);
    return { ...base, k, ox: -cam.left * k, oy: base.h - cam.bottomY * k };
  }

  // ---------- Change tracking → feedback ----------

  _trackHp(balls) {
    for (const ball of balls) {
      if (!ball) continue;
      const prev = this._hpSeen.get(ball);
      if (prev === undefined) {
        this._hpSeen.set(ball, ball.hp);
        continue;
      }
      // Damage is fractional: small hits add up until there's a whole number to show
      const diff = Math.round(ball.hp - prev);
      if (diff === 0) continue;
      this._hpSeen.set(ball, ball.hp);
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

  // ---------- World: blocks, particles ----------

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

  /**
   * Shots in flight (Game.projectiles). Each gun's look comes from vfxOf:
   *   bullet – a bright slug with a short streak
   *   lob    – a shell on a high arc with a smoke trail
   *   beam   – a flash of light that thins out
   *   spray  – a cone of flame / acid / frost droplets
   *   hook   – a line that reels out to the target
   *   pulse  – a shock ring travelling to the target
   */
  _drawProjectiles(ctx, world, now) {
    for (const p of world.projectiles || []) {
      if (p.t < 0) continue; // a burst round still waiting its turn
      const k = Math.min(1, p.t / p.dur);
      const tx = p.target.x;
      const ty = p.target.y;
      const dx = tx - p.x0;
      const dy = ty - p.y0;
      const dist = Math.hypot(dx, dy) || 1;
      const ang = Math.atan2(dy, dx);
      ctx.save();
      switch (p.kind) {
        case 'bullet': {
          const x = p.x0 + dx * k;
          const y = p.y0 + dy * k;
          ctx.strokeStyle = p.color;
          ctx.globalAlpha = 0.5;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(x - Math.cos(ang) * 34, y - Math.sin(ang) * 34);
          ctx.lineTo(x, y);
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.translate(x, y);
          ctx.rotate(ang);
          ctx.fillStyle = '#fff';
          ctx.fillRect(-8, -3, 14, 6);
          ctx.fillStyle = p.color;
          ctx.fillRect(-12, -2, 6, 4);
          break;
        }
        case 'lob': {
          const arcH = 110 + dist * 0.28;
          const at = (kk) => {
            return { x: p.x0 + dx * kk, y: p.y0 + dy * kk - arcH * 4 * kk * (1 - kk) };
          };
          // Smoke trail: fading puffs behind the shell
          for (let i = 1; i <= 6; i++) {
            const kk = k - i * 0.035;
            if (kk <= 0) break;
            const q = at(kk);
            ctx.globalAlpha = 0.45 * (1 - i / 7);
            ctx.fillStyle = '#94b0c2';
            const s = 6 + i * 2;
            ctx.fillRect(Math.round(q.x - s / 2), Math.round(q.y - s / 2), s, s);
          }
          ctx.globalAlpha = 1;
          const q = at(k);
          const q2 = at(Math.min(1, k + 0.02));
          ctx.translate(q.x, q.y);
          ctx.rotate(Math.atan2(q2.y - q.y, q2.x - q.x));
          ctx.fillStyle = '#1a1c2c';
          ctx.fillRect(-10, -6, 20, 12);
          ctx.fillStyle = p.color;
          ctx.fillRect(-8, -4, 16, 8);
          ctx.fillStyle = '#fff';
          ctx.fillRect(4, -2, 4, 4);
          break;
        }
        case 'beam': {
          const fade = 1 - k;
          ctx.globalAlpha = 0.35 + 0.65 * fade;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 14 * fade + 4;
          ctx.beginPath();
          ctx.moveTo(p.x0, p.y0);
          ctx.lineTo(tx, ty);
          ctx.stroke();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 4 * fade + 1;
          ctx.stroke();
          // Flash where it lands
          ctx.globalAlpha = fade;
          ctx.fillStyle = '#fff';
          ctx.fillRect(Math.round(tx - 12), Math.round(ty - 12), 24, 24);
          break;
        }
        case 'spray': {
          // Droplets fanning out along the cone, reaching the target as k -> 1
          const n = 14;
          for (let i = 0; i < n; i++) {
            const f = ((i * 37) % n) / n; // stable spread per droplet
            const reach = Math.min(1, k * 1.3 - f * 0.3);
            if (reach <= 0) continue;
            const spread = (f - 0.5) * 0.5;
            const r = dist * reach;
            const x = p.x0 + Math.cos(ang + spread) * r;
            const y = p.y0 + Math.sin(ang + spread) * r;
            ctx.globalAlpha = 0.9 - reach * 0.4;
            ctx.fillStyle = i % 3 ? p.color : '#fff';
            const s = 5 + reach * 8;
            ctx.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), s, s);
          }
          break;
        }
        case 'hook': {
          const x = p.x0 + dx * k;
          const y = p.y0 + dy * k;
          ctx.strokeStyle = '#94b0c2';
          ctx.lineWidth = 3;
          ctx.setLineDash([8, 5]);
          ctx.beginPath();
          ctx.moveTo(p.x0, p.y0);
          ctx.lineTo(x, y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.translate(x, y);
          ctx.rotate(ang);
          ctx.fillStyle = '#f4f4f4';
          ctx.fillRect(-4, -8, 8, 16);
          ctx.fillRect(4, -8, 6, 4);
          ctx.fillRect(4, 4, 6, 4);
          break;
        }
        case 'salvo': {
          // Five mini missiles pop up out of the pod, then curve down on the target one after another
          const dir = Math.sign(dx) || 1;
          for (let m = 0; m < 5; m++) {
            const kk = Math.max(0, Math.min(1, (k - m * 0.07) / 0.72));
            if (kk <= 0) continue;
            const ex = tx + (m - 2) * 9;
            const pt = (u) => {
              const a = (1 - u) ** 3, b = 3 * (1 - u) ** 2 * u, c = 3 * (1 - u) * u * u, d = u ** 3;
              const c1x = p.x0 + dir * (10 + m * 14), c1y = p.y0 - 170 - m * 18;
              const c2x = ex - dir * 60, c2y = ty - 190;
              return { x: a * p.x0 + b * c1x + c * c2x + d * ex, y: a * p.y0 + b * c1y + c * c2y + d * ty };
            };
            if (kk >= 1) {
              // It's in: a small burst that fades while the rest land
              const f = Math.min(1, (k - (m * 0.07 + 0.72)) / 0.2);
              ctx.globalAlpha = 1 - f;
              ctx.fillStyle = m % 2 ? '#ffcd75' : '#ef7d57';
              const s = 16 + f * 22;
              ctx.fillRect(Math.round(ex - s / 2), Math.round(ty - s / 2), s, s);
              ctx.globalAlpha = 1;
              continue;
            }
            for (let j = 1; j <= 5; j++) {
              const q = pt(Math.max(0, kk - j * 0.04));
              ctx.globalAlpha = 0.4 * (1 - j / 6);
              ctx.fillStyle = '#94b0c2';
              const s = 4 + j * 2;
              ctx.fillRect(Math.round(q.x - s / 2), Math.round(q.y - s / 2), s, s);
            }
            ctx.globalAlpha = 1;
            const q = pt(kk);
            const q2 = pt(Math.min(1, kk + 0.02));
            ctx.save();
            ctx.translate(q.x, q.y);
            ctx.rotate(Math.atan2(q2.y - q.y, q2.x - q.x));
            ctx.fillStyle = '#1a1c2c';
            ctx.fillRect(-9, -4, 16, 8);
            ctx.fillStyle = p.color;
            ctx.fillRect(-7, -2, 12, 4);
            ctx.fillStyle = '#fff';
            ctx.fillRect(3, -2, 3, 4);
            ctx.fillStyle = '#ffcd75';
            ctx.fillRect(-11, -1, 3, 2);
            ctx.restore();
          }
          break;
        }
        case 'spin': {
          // Repeater round: a long thin tracer
          const x = p.x0 + dx * k;
          const y = p.y0 + dy * k;
          ctx.strokeStyle = '#ffcd75';
          ctx.globalAlpha = 0.7;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(x - Math.cos(ang) * 60, y - Math.sin(ang) * 60);
          ctx.lineTo(x, y);
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.translate(x, y);
          ctx.rotate(ang);
          ctx.fillStyle = '#fff';
          ctx.fillRect(-6, -2, 10, 4);
          break;
        }
        case 'rail': {
          const charge = 0.26 / 0.42;
          if (k < charge) {
            // Energy gathers at the muzzle: sparks spiral in, the core swells
            const c = k / charge;
            for (let s = 0; s < 8; s++) {
              const a = (s / 8) * Math.PI * 2 + c * 5;
              const r = (1 - c) * 46 + 4;
              ctx.fillStyle = s % 2 ? '#fff' : p.color;
              ctx.fillRect(Math.round(p.x0 + Math.cos(a) * r - 3), Math.round(p.y0 + Math.sin(a) * r - 3), 6, 6);
            }
            const core = 4 + c * 14;
            ctx.fillStyle = p.color;
            ctx.fillRect(Math.round(p.x0 - core / 2), Math.round(p.y0 - core / 2), core, core);
            ctx.fillStyle = '#fff';
            ctx.fillRect(Math.round(p.x0 - core / 4), Math.round(p.y0 - core / 4), core / 2, core / 2);
          } else {
            // The slug: a thick beam that punches through and past the target, then thins out
            const b = (k - charge) / (1 - charge);
            const ex = p.x0 + Math.cos(ang) * dist * 1.6;
            const ey = p.y0 + Math.sin(ang) * dist * 1.6;
            ctx.globalAlpha = 1 - b * 0.6;
            for (const [lw, c] of [[26 * (1 - b) + 4, p.color], [9 * (1 - b) + 2, '#fff']]) {
              ctx.strokeStyle = c;
              ctx.lineWidth = lw;
              ctx.beginPath();
              ctx.moveTo(p.x0, p.y0);
              ctx.lineTo(ex, ey);
              ctx.stroke();
            }
            // Rings along the beam
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            for (let r = 1; r <= 3; r++) {
              const f = r / 4;
              ctx.beginPath();
              ctx.ellipse(p.x0 + dx * f, p.y0 + dy * f, 6 + b * 10, 18 + b * 16, ang, 0, Math.PI * 2);
              ctx.stroke();
            }
          }
          break;
        }
        case 'flak': {
          // A shell to just short of the target, then an air burst around it
          const bx = tx + (p.i ? 26 : -22);
          const by = ty - (p.i ? 16 : 34);
          if (k < 0.7) {
            const kk = k / 0.7;
            ctx.fillStyle = '#fff';
            ctx.fillRect(Math.round(p.x0 + (bx - p.x0) * kk - 4), Math.round(p.y0 + (by - p.y0) * kk - 4), 8, 8);
          } else {
            const f = (k - 0.7) / 0.3;
            ctx.fillStyle = '#ffcd75';
            const c = 18 * (1 - f) + 4;
            ctx.fillRect(Math.round(bx - c / 2), Math.round(by - c / 2), c, c);
            for (let s = 0; s < 7; s++) {
              const a = (s / 7) * Math.PI * 2;
              const r = 10 + f * 30;
              ctx.globalAlpha = 1 - f * 0.7;
              ctx.fillStyle = s % 2 ? '#94b0c2' : '#566c86';
              const sz = 10 + f * 8;
              ctx.fillRect(Math.round(bx + Math.cos(a) * r - sz / 2), Math.round(by + Math.sin(a) * r - sz / 2), sz, sz);
            }
          }
          break;
        }
        case 'cluster': {
          // One shell up the arc; at the top it splits and the bomblets fan out onto the target
          const arcH = 120 + dist * 0.28;
          const at = (kk) => ({ x: p.x0 + dx * kk, y: p.y0 + dy * kk - arcH * 4 * kk * (1 - kk) });
          if (k < 0.5) {
            if (p.i) break; // the others ride inside the first shell
            const q = at(k);
            const q2 = at(k + 0.02);
            ctx.translate(q.x, q.y);
            ctx.rotate(Math.atan2(q2.y - q.y, q2.x - q.x));
            ctx.fillStyle = '#1a1c2c';
            ctx.fillRect(-12, -7, 24, 14);
            ctx.fillStyle = p.color;
            ctx.fillRect(-10, -5, 20, 10);
            ctx.fillStyle = '#fff';
            ctx.fillRect(5, -3, 4, 6);
          } else {
            const s = (k - 0.5) / 0.5;
            const a = at(0.5);
            const ex = tx + ((p.i || 0) - 1) * 34;
            const x = a.x + (ex - a.x) * s;
            const y = a.y + (ty - a.y) * s * s;
            if (s < 0.08 && !p.i) {
              ctx.fillStyle = '#fff';
              ctx.fillRect(Math.round(a.x - 14), Math.round(a.y - 14), 28, 28);
            }
            ctx.fillStyle = '#1a1c2c';
            ctx.fillRect(Math.round(x - 6), Math.round(y - 6), 12, 12);
            ctx.fillStyle = s * 10 % 2 < 1 ? '#ffcd75' : p.color; // blinking fuse
            ctx.fillRect(Math.round(x - 4), Math.round(y - 4), 8, 8);
          }
          break;
        }
        case 'pulse': {
          const x = p.x0 + dx * k;
          const y = p.y0 + dy * k;
          const r = 12 + 10 * Math.sin(k * Math.PI);
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 5;
          ctx.globalAlpha = 0.9;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 0.4;
          ctx.beginPath();
          ctx.arc(x, y, r + 10, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        default:
          break;
      }
      ctx.restore();
    }
  }

  /**
   * Equipped gear on the balls: guns hover on the flanks and turn toward the
   * nearest target (recoil + muzzle flash when they fire), drones orbit
   * above. Stowed (faded out) while the ball is flying. Each part's muzzle
   * position is stored so Game can start the shot there.
   */
  /** `layer`: 'back' draws guns on the shoulder facing away, 'front' the rest plus drones. */
  _drawGear(ctx, world, player, enemies, layer = 'front') {
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
      if (!ball || ball.hp <= 0) return;
      const speed = Math.hypot(ball.vx || 0, ball.vy || 0);
      const alpha = Math.max(0, Math.min(1, 1 - (speed - 60) / 220));
      const r = ball.radius;
      if (!guns.length && !drones.length) return;
      const nearest = foes.filter((f) => f && f.hp > 0).sort((a, b) => Math.hypot(a.x - ball.x, a.y - ball.y) - Math.hypot(b.x - ball.x, b.y - ball.y))[0];
      // Guns sit on the torso's shoulders (bigger frames, wider stance)
      const pose = this._mechPose(ball, world, now);
      const { frame, armor } = mechLook(ball);
      const t = torsoCanvas(frame, armor, ball.color, ball.darkColor);
      const half = (t.width * pose.P) / 2;
      const shoulder = pose.torsoBottom - t.height * pose.P * 0.6;
      const k = ball.giant || 1; // the raid boss carries guns to match its size
      guns.forEach((g, i) => {
        const side = guns.length === 1 ? (nearest && nearest.x < ball.x ? -1 : 1) : i % 2 === 0 ? -1 : 1;
        if ((side === pose.face) !== (layer === 'front')) return;
        const mx = ball.x + side * (half - 2 * k);
        const my = shoulder - Math.floor(i / 2) * 22 * k;
        const since = now - (g.firedAt || -1e9);
        const tgt = since < 700 && g.aimAt?.hp > 0 ? g.aimAt : nearest;
        const want = tgt ? Math.atan2(tgt.y - my, tgt.x - mx) : side < 0 ? Math.PI : 0;
        g._ang = g._ang === undefined ? want : turn(g._ang, want, since < 700 ? 0.5 : 0.12);
        const ic = partCanvas(g.id);
        const { w: iw, h: ih } = iconSize(ic);
        const w = iw * S * k;
        const h = ih * S * k;
        const swing = meleeOf(g) && since < MELEE_MS ? meleeSwing(meleeOf(g), since / MELEE_MS) : null;
        const sig = signatureOf(g);
        // Repeater: shakes while it spins up (200 ms), then kicks with every round; rail: kicks when the slug leaves
        const spinning = sig === 'spin' && since < 480;
        const pulse = spinning && since > 200 && (since - 200) % 60 < 25;
        const kick = sig === 'rail' ? (since > 260 && since < 440 ? (1 - (since - 260) / 180) * 14 : 0) : spinning ? (pulse ? 7 : 0) : since < 180 ? (1 - since / 180) * 10 : 0;
        const recoil = swing ? -swing.dx * k : kick * k;
        const shake = spinning && since < 200 ? (Math.random() - 0.5) * 3 * k : 0;
        ctx.save();
        ctx.translate(Math.round(mx), Math.round(my + shake));
        ctx.rotate(g._ang);
        if (Math.cos(g._ang) < 0) ctx.scale(1, -1); // keep the sprite upright
        if (swing) ctx.rotate(swing.ang);
        ctx.globalAlpha = alpha * (g.ammo && g.ammoLeft <= 0 ? 0.6 : 1);
        ctx.drawImage(ic, Math.round(-6 * k - recoil), Math.round(-h / 2), w, h);
        const hot = ball.heatCap ? ball.heat / ball.heatCap : 0;
        if (hot > 0.75) {
          // Running hot: the muzzle glows (steam puffs are drawn after, upright)
          const glow = Math.min(1, (hot - 0.75) * 4);
          ctx.globalAlpha = alpha * glow * 0.9;
          ctx.fillStyle = hot > 1 ? '#ff5d73' : '#ef7d57';
          ctx.fillRect(Math.round(w - 10 - recoil), Math.round(-3), 4, 6);
        }
        ctx.globalAlpha = alpha;
        const flashing = sig === 'spin' ? pulse : sig === 'rail' ? since > 260 && since < 340 : since < 110 && !meleeOf(g);
        if (flashing) flash(w - 2 - recoil, 0, g.color || '#ffcd75');
        ctx.restore();
        g._muzzle = { x: mx + Math.cos(g._ang) * (w - 6), y: my + Math.sin(g._ang) * (w - 6) };
        if (hot > 0.75) {
          // Steam rising off the barrel: a few pixel puffs, thicker the hotter it runs
          const glow = Math.min(1, (hot - 0.75) * 4);
          for (let j = 0; j < 3; j++) {
            const ph = (now / 900 + j / 3 + i * 0.17) % 1;
            const size = Math.round(4 + ph * 6);
            ctx.globalAlpha = alpha * glow * (1 - ph) * 0.55;
            ctx.fillStyle = '#dfe6ee';
            ctx.fillRect(Math.round(g._muzzle.x + Math.sin(ph * 6 + j) * 4 - size / 2), Math.round(g._muzzle.y - 6 - ph * 26), size, size);
          }
          ctx.globalAlpha = 1;
        }
      });
      if (layer !== 'front') drones = [];
      drones.forEach((d, i) => {
        // Switched OFF: docked inside the ball (drawn only while it flies back in)
        const toggled = now - (d.deployedAt || -1e9);
        const out = d.off ? Math.max(0, 1 - toggled / 300) : Math.min(1, toggled / 350);
        if (out <= 0) return;
        const ease = out * out * (3 - 2 * out);
        const t = now / 1000 + i * Math.PI;
        const since = now - (d.firedAt || -1e9);
        const ox = Math.cos(t * 1.3) * r * 1.5;
        const oy = -r * 2.4 + Math.sin(t * 2.6) * 5 - (since < 150 ? 4 : 0);
        const dx = ball.x + ox * ease;
        const dy = ball.y + oy * ease;
        const ic = partCanvas(d.id);
        const { w: iw, h: ih } = iconSize(ic);
        const w = iw * S * (0.4 + 0.6 * ease);
        const h = ih * S * (0.4 + 0.6 * ease);
        ctx.globalAlpha = alpha * (0.3 + 0.7 * ease);
        ctx.drawImage(ic, Math.round(dx - w / 2), Math.round(dy - h / 2), w, h);
        if (since < 120) flash(dx, dy + h / 2, d.color || '#ffcd75');
        ctx.globalAlpha = 1;
        d._muzzle = { x: dx, y: dy + h / 2 };
      });
      ctx.globalAlpha = 1;
    };
    // Whoever is mid-swing goes last, so the weapon cuts across the target's own guns
    const mounts = [[player, world.playerWeapons || [], enemies, world.playerDrones || []], ...enemies.map((e) => [e, e.weapons || [], player ? [player] : [], e.drones || []])];
    const swinging = (b) => (b && now - (b.lungeAt || -1e9) < MELEE_MS ? 1 : 0);
    for (const m of mounts.sort((a, b) => swinging(a[0]) - swinging(b[0]))) mount(...m);
  }

  /** How far a meleeing mech is drawn from its spot: a short wind-back, then a lunge at the target. */
  _lunge(ball, now) {
    const since = now - (ball.lungeAt || -1e9);
    if (!ball.lungeTo || since < 0 || since > MELEE_MS || ball.hp <= 0) return 0;
    const gap = ball.lungeTo.x - ball.x;
    const reach = Math.min(90, Math.abs(gap) * 0.4);
    return Math.sign(gap || 1) * reach * curve([[0, 0], [0.3, -0.15], [0.44, 1], [0.7, 0.85], [1, 0]], since / MELEE_MS);
  }

  /**
   * The hit of a melee swing, drawn on the target as it connects:
   *   slash – a crescent carved through it   rake  – three burning claw marks
   *   punch – a molten starburst             thrust – a shockwave ring and speed lines
   */
  _drawMeleeFx(ctx, world, player, enemies, now) {
    const sets = [[player, world.playerWeapons || []], ...enemies.map((e) => [e, e.weapons || []])];
    for (const [ball, guns] of sets) {
      if (!ball) continue;
      for (const g of guns) {
        const style = meleeOf(g);
        const tgt = g.aimAt;
        const since = now - (g.firedAt || -1e9);
        if (!style || !tgt || since < MELEE_MS * 0.38 || since > MELEE_MS) continue;
        const p = (since / MELEE_MS - 0.38) / 0.62; // 0 at contact, 1 when it's gone
        const r = tgt.radius || 32;
        const col = g.color || '#f4f4f4';
        ctx.save();
        ctx.translate(Math.round(tgt.x), Math.round(tgt.y));
        ctx.scale(tgt.x < ball.x ? -1 : 1, 1); // strike from the attacker's side
        ctx.globalAlpha = 1 - p * p;
        ctx.lineCap = 'square';
        if (style === 'slash') {
          const a0 = -2.3;
          const a1 = a0 + 3 * Math.min(1, p * 3);
          for (const [lw, c] of [[16 * (1 - p) + 4, col], [5 * (1 - p) + 1, '#fff']]) {
            ctx.strokeStyle = c;
            ctx.lineWidth = lw;
            ctx.beginPath();
            ctx.arc(-r * 0.3, 0, r * 1.35, a0, a1);
            ctx.stroke();
          }
        } else if (style === 'rake') {
          const reach = Math.min(1, p * 3);
          for (let i = -1; i <= 1; i++) {
            const y0 = -r * 0.9 + i * 14;
            for (const [lw, c] of [[9 * (1 - p) + 3, '#ef7d57'], [3, '#ffcd75']]) {
              ctx.strokeStyle = c;
              ctx.lineWidth = lw;
              ctx.beginPath();
              ctx.moveTo(-r * 0.9, y0);
              ctx.lineTo(-r * 0.9 + r * 1.8 * reach, y0 + r * 1.4 * reach);
              ctx.stroke();
            }
          }
        } else if (style === 'punch') {
          const len = r * (0.5 + 1.1 * p);
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2 + 0.3;
            ctx.fillStyle = i % 2 ? '#ffcd75' : '#ef7d57';
            const s = 12 * (1 - p) + 4;
            ctx.fillRect(Math.round(Math.cos(a) * len - s / 2), Math.round(Math.sin(a) * len - s / 2), s, s);
          }
          ctx.fillStyle = '#fff';
          const c = 26 * (1 - p);
          ctx.fillRect(Math.round(-c / 2), Math.round(-c / 2), c, c);
        } else {
          ctx.strokeStyle = '#f4f4f4';
          ctx.lineWidth = 8 * (1 - p) + 2;
          ctx.beginPath();
          ctx.arc(0, 0, r * (0.7 + 1.4 * p), 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = '#94b0c2';
          for (let i = -1; i <= 1; i++) ctx.fillRect(Math.round(r * (0.9 + p * 1.5)), Math.round(i * 16 - 2), Math.round(40 * (1 - p) + 8), 4);
        }
        ctx.restore();
      }
    }
  }

  /**
   * Where a mech's parts sit this frame. The ball is the hitbox; the mech is
   * drawn on it: legs stand on the ball's bottom line (the ground) and the
   * torso sits on the legs. `P` is one sprite pixel in world px, so bigger
   * frames draw bigger mechs. Legs crouch while you pull back to aim, spring
   * out on launch and tuck in mid-air.
   */
  _mechPose(ball, world, now) {
    const r = ball.radius;
    const P = r / 8;
    const onGround = ball.y + r >= groundAt(ball.x) - 6;
    let squash = onGround ? 1 : 0.75;
    const since = now - (ball.launchedAt || -1e9);
    if (since < 260) squash = 1.3 - (since / 260) * 0.3; // spring
    const legsTop = ball.y + r - 10 * P * squash;
    return { P, onGround, squash, legsTop, torsoBottom: legsTop + 2 * P, face: this._faceOf(ball, world) };
  }

  /** Which way a mech looks: where it's moving, else at its foe. */
  _faceOf(ball, world) {
    if (Math.abs(ball.vx || 0) > 60) return Math.sign(ball.vx);
    const foe = ball === world.player ? world.fireTarget || world.enemies?.find((e) => e.hp > 0) : world.player;
    return foe && foe.x < ball.x ? -1 : 1;
  }

  _drawLegs(ctx, world, ball, now) {
    const legs = ball.legs || { id: 'lg_strider' };
    const pose = this._mechPose(ball, world, now);
    const flame = !pose.onGround && (legs.id === 'lg_jumpjets' || legs.id === 'lg_thrusters');
    const ic = legsCanvas(legs.id, ball.color, ball.darkColor, flame);
    const w = ic.width * pose.P;
    const h = ic.height * pose.P * pose.squash;
    ctx.save();
    ctx.translate(Math.round(ball.x), 0);
    ctx.scale(pose.face, 1);
    ctx.drawImage(ic, Math.round(-w / 2), Math.round(pose.legsTop), Math.round(w), Math.round(h));
    ctx.restore();
    if (legs.anchored && pose.onGround) {
      // Clamps dug into the floor
      ctx.fillStyle = '#566c86';
      ctx.fillRect(Math.round(ball.x - w / 2 - 4), Math.round(ball.y + ball.radius - 2), 8, 8);
      ctx.fillRect(Math.round(ball.x + w / 2 - 4), Math.round(ball.y + ball.radius - 2), 8, 8);
    }
  }

  // ---------- The lane: floor plates, moves, gun reach ----------

  /** Plate `pos` (1..size): its left edge and width in world px. */
  _plate(pos, size) {
    const pw = W.width / size;
    return { x: (pos - 1) * pw, w: pw };
  }

  /**
   * The floor plates, numbered. On your turn the plates you can move to
   * light up: green = walk there, blue = jump there (brighter under the mouse).
   */
  _drawLane(ctx, world, now) {
    const lane = world.lane;
    const y = W.groundY;
    for (let pos = 1; pos <= lane.size; pos++) {
      const { x, w } = this._plate(pos, lane.size);
      ctx.fillStyle = pos % 2 ? 'rgba(148, 176, 194, 0.10)' : 'rgba(148, 176, 194, 0.04)';
      ctx.fillRect(Math.round(x + 3), y + 4, Math.round(w - 6), 14);
      ctx.fillStyle = 'rgba(26, 28, 44, 0.8)';
      ctx.fillRect(Math.round(x), y, 3, 22);
      ctx.fillStyle = '#566c86';
      ctx.font = `700 13px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(pos), x + w / 2, y + 34);
    }
    const moves = lane.moves;
    if (!moves || !moves.size) return;
    const pulse = 0.55 + 0.25 * Math.sin(now / 180);
    for (const [pos, how] of moves) {
      const { x, w } = this._plate(pos, lane.size);
      const col = how === 'teleport' ? '196, 111, 214' : how === 'jump' ? '65, 166, 246' : '167, 240, 112';
      const hot = lane.hover === pos;
      ctx.fillStyle = `rgba(${col}, ${hot ? 0.55 : 0.28 * pulse})`;
      ctx.fillRect(Math.round(x + 4), y - 6, Math.round(w - 8), 24);
      ctx.fillStyle = `rgba(${col}, ${hot ? 1 : 0.8})`;
      ctx.fillRect(Math.round(x + 4), y - 6, Math.round(w - 8), 4);
      // A chevron over the plate: where you'd stand
      const cx = Math.round(x + w / 2);
      const cy = Math.round(y - 70 - (hot ? 6 : 0) + Math.sin(now / 250 + pos) * 3);
      ctx.fillStyle = `rgba(${col}, ${hot ? 1 : 0.7})`;
      ctx.fillRect(cx - 12, cy, 24, 5);
      ctx.fillRect(cx - 8, cy + 5, 16, 5);
      ctx.fillRect(cx - 4, cy + 10, 8, 5);
      if (hot) {
        ctx.font = `700 14px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(how === 'teleport' ? 'BLINK' : how === 'jump' ? 'JUMP' : 'WALK', cx, cy - 12);
      }
    }
  }

  /** Lane reach of guns: the plates each gun can hit from where its mech stands. */
  _drawMechRanges(ctx, world) {
    const now = performance.now();
    const lane = world.lane;
    const p = world.player;
    const ph = world.turnSystem?.phase;
    if (lane && p?.hp > 0) {
      // Show: a hovered gun chip, else an inspected mech's guns
      let from = null;
      let guns = [];
      if (lane.previewGun != null && world.playerWeapons?.[lane.previewGun]) {
        from = p;
        guns = [world.playerWeapons[lane.previewGun]];
      } else if (world.inspected) {
        const ins = world.inspected;
        from = ins.ball;
        const all = ins.ball === p ? world.playerWeapons || [] : ins.ball.weapons || [];
        guns = ins.weapon === undefined ? all : all.filter((_, i) => i === ins.weapon);
      }
      guns.forEach((w, gi) => {
        if (!w.reach || (w.ammo && w.ammoLeft <= 0)) return;
        for (let pos = 1; pos <= lane.size; pos++) {
          const d = Math.abs(pos - from.pos);
          if (d < w.reach[0] || d > w.reach[1]) continue;
          const { x, w: pw } = this._plate(pos, lane.size);
          ctx.globalAlpha = 0.28;
          ctx.fillStyle = w.color || '#f4f4f4';
          ctx.fillRect(Math.round(x + 6), W.groundY - 150 + gi * 10, Math.round(pw - 12), 150 - gi * 10);
          ctx.globalAlpha = 0.9;
          ctx.fillRect(Math.round(x + 6), W.groundY - 150 + gi * 10, Math.round(pw - 12), 4);
        }
      });
      ctx.globalAlpha = 1;
    }
    if (world.gear && p?.hp > 0 && ph === 'PLAYER_AIM') {
      const t = world.fireTarget;
      if (t && t.hp > 0) this._reticle(ctx, t, now);
    }
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
   * Card above an inspected mech, kept simple and big: its name, then HP /
   * heat / energy, then one row per gun with damage and range (ammo if it
   * has any). How it moves and its resists sit small under the name; gun
   * costs live in the hover tips.
   */
  _drawInspectCard(ctx, world) {
    const ins = world.inspected;
    if (!ins) return;
    const ball = ins.ball;
    const isPlayer = ball === world.player;
    let guns = isPlayer ? world.playerWeapons || [] : ball.weapons || [];
    if (ins.weapon !== undefined) guns = guns.filter((_, i) => i === ins.weapon);
    if (ins.weapon === undefined) guns = [...guns, ...((isPlayer ? world.playerDrones : ball.drones) || []).map((d) => ({ ...d, drone: true }))];
    if (ins.weapon === undefined) guns = [...guns, ...((isPlayer ? world.playerSpecials : ball.specials) || []).map((sp) => ({ ...sp, specialRow: true }))];

    // Laid out at full size, then drawn at K: a compact card beside the mech
    const K = 0.58;
    const head = 142; // name, small line, big stats
    // Rows shrink so a full mech (6 guns, drone, specials) still fits the screen
    const rowH = Math.max(40, Math.min(72, Math.floor((W.height / K - head - 60) / Math.max(1, guns.length))));
    const S = rowH >= 64 ? 5 : rowH >= 50 ? 4 : 3; // gun icon scale
    const big = Math.round(rowH * 0.42); // row font size
    const w = 600;
    const h = head + Math.max(1, guns.length) * rowH + 8;
    const cw = w * K;
    const ch = h * K;
    const px = Math.round(Math.max(8, Math.min(W.width - cw - 8, ball.x - cw / 2)));
    const above = ball.y - ball.radius - 20 - ch;
    const py = Math.round(above > 40 ? above : Math.max(8, Math.min(W.height - ch - 8, ball.y + ball.radius + 20)));
    ctx.save();
    ctx.translate(px, py);
    ctx.scale(K, K);
    const x = 0;
    const y = 0;
    ctx.fillStyle = '#000';
    ctx.fillRect(x + 5, y + 5, w, h);
    ctx.fillStyle = 'rgba(26, 28, 44, 0.97)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#566c86';
    ctx.lineWidth = 4;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = isPlayer ? '#41a6f6' : '#ff5d73';
    ctx.fillRect(x, y, w, 6);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    // Name
    ctx.font = `700 30px ${FONT}`;
    ctx.fillStyle = '#ffcd75';
    ctx.fillText(fitText(ctx, isPlayer ? ball.displayName || 'YOUR MECH' : ball.displayName || 'ENEMY', w - 32), x + 16, y + 32);

    // Small line: how it moves, then resists that aren't zero
    const small = [];
    if (ball.legs) small.push(ball.legs.anchored ? 'CAN\'T MOVE' : legsLabel(ball.legs));
    const res = DTYPE_KEYS.map((t) => [t, Math.round(resistOf(ball, t) * 10) / 10]).filter(([, v]) => v);
    ctx.font = `700 16px ${FONT}`;
    let sx = x + 16;
    // An enemy's damage type leads the line, in its color
    const el = !isPlayer && DTYPES[ball.element];
    if (el) {
      ctx.fillStyle = el.color;
      ctx.fillText(el.name, sx, y + 62);
      sx += ctx.measureText(el.name).width + 24;
    }
    ctx.fillStyle = '#94b0c2';
    if (small.length) {
      ctx.fillText(small.join(''), sx, y + 62);
      sx += ctx.measureText(small.join('')).width + 24;
    }
    if (res.length) {
      ctx.fillText('RESIST', sx, y + 62);
      sx += ctx.measureText('RESIST').width + 12;
      for (const [t, v] of res) {
        const label = `${DTYPES[t].short} ${v}`;
        ctx.fillStyle = DTYPES[t].color;
        ctx.fillText(label, sx, y + 62);
        sx += ctx.measureText(label).width + 16;
      }
    }

    // Reactor damage, in red: it lasts the rest of the fight
    const hurt = [
      ball.coolLost ? `COOLING -${ball.coolLost}` : '',
      ball.regenLost ? `REGEN -${ball.regenLost}` : '',
    ].filter(Boolean);
    if (hurt.length) {
      ctx.fillStyle = '#ff5d73';
      ctx.fillText(hurt.join('  '), sx + 8, y + 62);
    }

    const icon = (name, ix, iy, k = 4) => {
      const c = iconCanvas(name);
      ctx.drawImage(c, ix, Math.round(iy - (c.height * k) / 2), c.width * k, c.height * k);
      return c.width * k;
    };
    // Big stats: HP, heat, energy (current / max)
    const stats = [
      ['hp', `${Math.max(0, Math.ceil(ball.hp))}/${Math.round(ball.maxHp)}`, ball.hp / ball.maxHp > 0.3 ? '#a7f070' : '#ff5d73'],
      ['heat', `${Math.ceil(ball.heat || 0)}/${Math.round(ball.heatCap || 0)}`, (ball.heat || 0) > (ball.heatCap || 0) ? '#ff5d73' : '#ef7d57'],
      ['energy', `${Math.floor(ball.energy || 0)}/${Math.round(ball.energyMax || 0)}`, '#73eff7'],
    ];
    ctx.font = `700 28px ${FONT}`;
    const sy = y + 106;
    stats.forEach(([name, text, color], i) => {
      const cx = x + 16 + i * ((w - 32) / 3);
      const iw = icon(name, cx, sy);
      ctx.fillStyle = color;
      ctx.fillText(text, cx + iw + 10, sy);
    });

    ctx.fillStyle = '#2a3048';
    ctx.fillRect(x + 10, y + head - 4, w - 20, 3);
    if (!guns.length) {
      ctx.font = `700 26px ${FONT}`;
      ctx.fillStyle = '#94b0c2';
      ctx.fillText('UNARMED', x + 16, y + head + rowH / 2);
    }
    guns.forEach((g, i) => {
      const ry = y + head + i * rowH;
      const cy = ry + rowH / 2;
      if (i) {
        ctx.fillStyle = '#2a3048';
        ctx.fillRect(x + 10, ry, w - 20, 2);
      }
      const ic = partCanvas(g.id);
      const { w: iw, h: ih } = iconSize(ic);
      const spent = g.ammo && g.ammoLeft <= 0;
      ctx.globalAlpha = spent ? 0.4 : 1;
      ctx.drawImage(ic, x + 16, Math.round(cy - (ih * S) / 2), iw * S, ih * S);
      let cx = x + 100;
      ctx.font = `700 ${big}px ${FONT}`;
      if (g.specialRow) {
        ctx.fillStyle = '#f4f4f4';
        ctx.font = `700 24px ${FONT}`;
        ctx.fillText(g.name, cx, cy);
        icon('ammo', cx + 330, cy);
        ctx.font = `700 ${big}px ${FONT}`;
        ctx.fillStyle = g.usesLeft > 0 ? '#ffcd75' : '#566c86';
        ctx.fillText(`${g.usesLeft}/${g.uses}`, cx + 370, cy);
        ctx.globalAlpha = 1;
        return;
      }
      if (g.drone) {
        ctx.fillStyle = g.heal ? '#a7f070' : '#f4f4f4';
        ctx.fillText(g.heal ? `+${Math.round(g.heal)} HP` : `${Math.round(g.dmg || 0)}`, cx, cy);
        ctx.font = `700 18px ${FONT}`;
        ctx.fillStyle = '#94b0c2';
        ctx.fillText(g.off ? 'DRONE · DOCKED' : 'DRONE · EVERY TURN', cx + 150, cy);
        ctx.globalAlpha = 1;
        return;
      }
      // Damage in its type's colour
      ctx.fillStyle = DTYPES[dtypeOf(g)].color;
      const dmg = dmgLabel(g.dmg * (g.fx?.burst || 1));
      ctx.fillText(dmg, cx, cy);
      const dw = ctx.measureText(dmg).width;
      ctx.font = `700 16px ${FONT}`;
      ctx.fillText(DTYPES[dtypeOf(g)].short, cx + dw + 8, cy + 4);
      // Range: big numbers
      cx += 190;
      icon('range', cx, cy);
      ctx.font = `700 ${big}px ${FONT}`;
      ctx.fillStyle = '#f4f4f4';
      ctx.fillText(g.reach ? reachLabel(g.reach) : '-', cx + 40, cy);
      // Ammo only when the gun has a limit
      if (g.mount === 'top') icon('top', x + 16 + iw * S + 4, cy - rowH / 4, 2);
      if (g.backfire) {
        icon('backfire', cx + 110, cy);
        ctx.fillStyle = '#ff5d73';
        ctx.fillText(`${Math.round(g.backfire)}`, cx + 146, cy);
      }
      if (g.ammo) {
        cx += 190;
        icon('ammo', cx, cy);
        ctx.fillStyle = g.ammoLeft > 0 ? '#ffcd75' : '#566c86';
        ctx.fillText(`${g.ammoLeft}/${g.ammo}`, cx + 40, cy);
      }
      ctx.globalAlpha = 1;
    });
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  /** The mech's torso (frame + armor, in its paint) standing on its legs. */
  _drawBall(ctx, ball, world, now) {
    const r = ball.radius;
    const isFlashing = ball.flashTimer > 0;
    const pose = this._mechPose(ball, world, now);
    const { frame, armor } = mechLook(ball);
    const visor = ball.team === 'enemy' ? '#ff5d73' : null;
    const torso = (flash) => torsoCanvas(frame, armor, ball.color, ball.darkColor, flash, visor);
    const tw = torso(false).width * pose.P;
    const th = torso(false).height * pose.P;

    // Motion trail: fading copies of the torso
    const speed = Math.hypot(ball.vx || 0, ball.vy || 0);
    if (speed > 150) {
      const trail = Math.min(4, Math.floor(speed / 250));
      for (let i = trail; i >= 1; i--) {
        ctx.globalAlpha = 0.18 * (1 - i / (trail + 1)) + 0.05;
        const tx = ball.x - ball.vx * 0.012 * i;
        const ty = pose.torsoBottom - ball.vy * 0.012 * i;
        ctx.drawImage(torso(false), Math.round(tx - tw / 2), Math.round(ty - th), Math.round(tw), Math.round(th));
      }
      ctx.globalAlpha = 1;
    }

    // Status rings (no blur: chunky pixel rings)
    const rings = [];
    if (ball.forcefield) rings.push('#a7f070');
    if (ball.bubble > 0) rings.push('#41a6f6');
    if (ball.burnTicks > 0) rings.push('#ef7d57');
    if (ball.isFrozen) rings.push('#73eff7');
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

    // Alive: resting mechs breathe, and landings / hits squash the torso (anchored at its base)
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
    const dw = Math.round(tw * sx);
    const dh = Math.round(th * sy);
    const top = Math.round(pose.torsoBottom - dh);
    ctx.save();
    ctx.translate(Math.round(ball.x), 0);
    ctx.scale(pose.face, 1);
    ctx.drawImage(torso(isFlashing), Math.round(-dw / 2), top, dw, dh);
    ctx.restore();
    if (ball.fx) drawEffect(ctx, ball.fx, ball.x, top, dw, dh, pose.P, now); // special effect (cosmetic)
    if (ball.rank) {
      // A pixel crown floats over mini-bosses and bosses (red once enraged). One crown
      // pixel = one sprite pixel of this mech, so it grows with the frame (and the raid giant).
      const px = Math.max(2, Math.round(pose.P));
      const gold = ball.phase2 ? '#ff5d73' : '#ffcd75';
      const shade = ball.phase2 ? '#b13e53' : '#ef7d57';
      const pal = { k: '#1a1c2c', y: gold, o: shade, w: '#f4f4f4', r: ball.phase2 ? '#ffcd75' : '#ff5d73', c: '#73eff7' };
      const bob = Math.round(Math.sin(now / 420) * px * 0.8);
      const x0 = Math.round(ball.x - (CROWN[0].length * px) / 2);
      const y0 = Math.round(top - (CROWN.length + 3) * px + bob);
      CROWN.forEach((row, yy) => {
        for (let xx = 0; xx < row.length; xx++) {
          const c = pal[row[xx]];
          if (!c) continue;
          ctx.fillStyle = c;
          ctx.fillRect(x0 + xx * px, y0 + yy * px, px, px);
        }
      });
    }
    if (ball.isFrozen) {
      // Icy tint: checkerboard of pale-blue pixels over the torso
      ctx.fillStyle = 'rgba(115, 239, 247, 0.55)';
      const px = pose.P;
      const cols = Math.floor(dw / px);
      const rows = Math.floor(dh / px);
      for (let yy = 1; yy < rows - 1; yy++) {
        for (let xx = 1 + (yy % 2); xx < cols - 1; xx += 2) ctx.fillRect(ball.x - dw / 2 + xx * px, top + yy * px, px, px);
      }
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
      } else if (h.type === 'fire') {
        // Napalm: flickering pixel flames across the plate
        const n = Math.max(3, Math.floor(h.w / 18));
        for (let i = 0; i < n; i++) {
          const fx = h.x + (i + 0.5) * (h.w / n);
          const flick = Math.floor(now / 90 + i * 3) % 3;
          const fh = 16 + ((i * 7 + flick * 5) % 14);
          ctx.fillStyle = '#b13e53';
          ctx.fillRect(Math.round(fx - 7), gy - fh, 14, fh);
          ctx.fillStyle = '#ef7d57';
          ctx.fillRect(Math.round(fx - 5), gy - fh + 6, 10, fh - 6);
          ctx.fillStyle = '#ffcd75';
          ctx.fillRect(Math.round(fx - 2), gy - Math.round(fh * 0.5), 4, Math.round(fh * 0.5));
        }
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
        // Spring: the plate rides on its coil and squashes under a ball
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
      ctx.fillRect(bx, y, half, 8);
      ctx.fillStyle = color;
      ctx.fillRect(bx, y, Math.round(half * Math.max(0, Math.min(1, frac))), 8);
    };
    bar(x, ball.energy / (ball.energyMax || 1), '#73eff7');
    bar(x + half + 4, ball.heat / (ball.heatCap || 1), ball.heat > ball.heatCap * 0.8 ? '#ff5d73' : '#ef7d57');
    ctx.font = `700 12px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#73eff7';
    ctx.fillText(`EN ${Math.floor(ball.energy)}`, x, y + 21);
    ctx.fillStyle = ball.heat > ball.heatCap ? '#ff5d73' : '#ef7d57';
    ctx.fillText(`HEAT ${Math.ceil(ball.heat)}/${ball.heatCap}`, x + half + 4, y + 21);
  }

  _drawHpPanels(ctx, view, player, enemies) {
    const pad = 8;
    const panelW = Math.min(250, Math.max(190, view.cssW * 0.26));
    const gear = !!this.worldRef?.gear;
    const panelH = gear ? 74 : 48;
    // Screen-space tap targets: tapping a panel inspects that ball's weapons
    this.panelHits = [];

    if (player) {
      const x = pad;
      const y = pad;
      this._panel(ctx, x, y, panelW, panelH);
      ctx.textAlign = 'left';
      ctx.font = `700 15px ${FONT}`;
      ctx.fillStyle = '#73eff7';
      const pHp = `${Math.ceil(player.hp)}/${player.maxHp}${(player.shieldHp || 0) > 0 ? ` +${Math.ceil(player.shieldHp)}` : ''}`;
      fitName(ctx, player.displayName || 'YOU', x + 8, y + 16, panelW - 24 - ctx.measureText(pHp).width);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#f4f4f4';
      const shieldHp = player.shieldHp || 0;
      ctx.fillText(`${Math.ceil(player.hp)}/${player.maxHp}${shieldHp > 0 ? ` +${Math.ceil(shieldHp)}` : ''}`, x + panelW - 8, y + 16);
      this._hpBar(ctx, x + 8, y + 25, panelW - 16, 14, player, '#41a6f6');
      if (gear) this._reactorBars(ctx, x + 8, y + 45, panelW - 16, player);
      this._drawStatusTags(ctx, player, x, y + panelH + 6, panelW, false);
      this.panelHits.push({ x, y, w: panelW, h: panelH, ball: player });
    }

    enemies.forEach((enemy, i) => {
      const x = view.cssW - pad - panelW;
      const y = pad + i * (panelH + 16);
      this._panel(ctx, x, y, panelW, panelH);
      const arch = CONFIG.enemyArchetypes[enemy.archetype];
      ctx.font = `700 15px ${FONT}`;
      ctx.textAlign = 'left';
      // Name in its damage type's color: white Physical, orange Explosive, cyan Electric
      ctx.fillStyle = DTYPES[enemy.element]?.color || arch?.color || '#ff5d73';
      const eHp = `${Math.ceil(enemy.hp)}/${enemy.maxHp}`;
      fitName(ctx, enemy.displayName || 'HOSTILE', x + 8, y + 16, panelW - 24 - ctx.measureText(eHp).width);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#f4f4f4';
      ctx.fillText(eHp, x + panelW - 8, y + 16);
      this._hpBar(ctx, x + 8, y + 25, panelW - 16, 14, enemy, '#ef7d57');
      if (gear) this._reactorBars(ctx, x + 8, y + 45, panelW - 16, enemy);
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
    // Its whole kit, like the HUD shows yours: guns, drone, specials (hover one for its numbers)
    const guns = [...(enemy.weapons || []), ...(enemy.drones || []), ...(enemy.specials || [])];
    const inspected = this.worldRef?.inspected?.ball === enemy;
    const size = guns.length > 6 ? 30 : 38;
    const s = size / 38;
    guns.forEach((g, i) => {
      const bx = panelX - (i + 1) * (size + 3);
      ctx.fillStyle = 'rgba(26, 28, 44, 0.92)';
      ctx.fillRect(bx, panelY + 5, size, size);
      ctx.fillStyle = inspected ? '#ffcd75' : g.color || '#566c86';
      ctx.fillRect(bx, panelY + 5 + size - 3, size, 3);
      const ic = partCanvas(g.id);
      const { w: iw, h: ih } = iconSize(ic);
      const gear = !!this.worldRef?.gear;
      const spent = g.ammo && g.ammoLeft <= 0;
      ctx.globalAlpha = spent ? 0.45 : 1;
      const k = 2.5 * s;
      ctx.drawImage(ic, Math.round(bx + (size - iw * k) / 2), Math.round(panelY + 5 + (size - 3 - ih * k) / 2), iw * k, ih * k);
      ctx.globalAlpha = 1;
      const left = g.ammo ? g.ammoLeft : g.uses ? g.usesLeft : null;
      if (left != null) {
        ctx.font = `700 13px ${FONT}`;
        ctx.textAlign = 'right';
        ctx.fillStyle = left > 0 ? '#ffcd75' : '#566c86';
        ctx.fillText(`${left}`, bx + size - 3, panelY + 18);
      }
      this._gearZones.push({ x: bx, y: panelY + 5, w: size, h: size, part: g, ball: enemy });
    });
    return guns.length ? guns.length * (size + 3) : 0;
  }

  _drawStatusTags(ctx, ball, panelX, tagY, panelW, alignRight) {
    const tags = [];
    // Abyss insanity (Game._tickInsanity): how much harder enemies hit by now
    const ins = ball.team === 'enemy' ? this.worldRef?.insanity || 0 : 0;
    if (ins > 0) {
      const hp = Math.round((this.worldRef?.insanityHp || 0.01) * 100);
      tags.push({ label: `INSANE +${Math.round(ins * 100)}%`, color: '#c46fd6', desc: `Abyss insanity: hits ${Math.round(ins * 100)}% harder, climbing every turn (yours and theirs), and loses ${hp}% of its max HP each turn.` });
    }
    if (ball.burnTicks > 0)
      tags.push({ label: `BURN ${ball.burnTicks}`, color: '#ef7d57', desc: `Burning! Takes ${Math.round(ball.burnDmg || 6 * CONFIG.gear.hpScale)} damage at the start of each turn. ${ball.burnTicks} turn(s) remaining.` });
    if (ball.isFrozen)
      tags.push({ label: 'CHILLED', color: '#73eff7', desc: 'Chilled: its next move is 1 position shorter.' });
    if (ball.exposed)
      tags.push({ label: 'EXPOSED', color: '#ffcd75', desc: 'Rammed! Takes +25% gun damage until its next turn.' });
    if (ball.heatCap && ball.heat > ball.heatCap) {
      const shut = ball.heat - ball.heatCap > ball.cool * (1 - (ball.heatLock || ball.lockNow || 0));
      tags.push(shut
        ? { label: 'SHUTDOWN', color: '#ff5d73', desc: 'Over its heat cap by more than its cooling: its next turn is a double cooldown, and it loses the whole turn.' }
        : { label: 'OVERHEATED', color: '#ff5d73', desc: 'Over its heat cap: its next turn opens with a forced cooldown, which uses one of its two actions.' });
    }
    if (ball.coolLost)
      tags.push({ label: `COOL -${Math.round(ball.coolLost)}`, color: '#ff5d73', desc: `Coolant cracked: cools ${Math.round(ball.coolLost)} less heat per turn for the rest of the fight.` });
    if (ball.regenLost)
      tags.push({ label: `REGEN -${Math.round(ball.regenLost)}`, color: '#ff5d73', desc: `Generator broken: refills ${Math.round(ball.regenLost)} less energy per turn for the rest of the fight.` });
    for (const [t, v] of Object.entries(ball.resLost || {}))
      if (v > 0) tags.push({ label: `-${Math.round(v * 10) / 10} ${DTYPES[t].short}`, color: DTYPES[t].color, desc: `${DTYPES[t].name} resist stripped by ${Math.round(v * 10) / 10} for the rest of the fight.` });
    if (ball.forcefield) tags.push({ label: 'FORCEFIELD', color: '#a7f070', desc: 'Forcefield: blocks the next incoming hit.' });
    if (ball.bubble > 0) tags.push({ label: `SHIELD ${Math.round(ball.bubble)}`, color: '#a7f070', desc: `Shield: soaks the next ${Math.round(ball.bubble)} damage until its next turn.` });
    if (tags.length === 0) return;

    const rect = this.canvas.getBoundingClientRect();
    ctx.font = `700 12px ${FONT}`;
    const tagH = 18;
    const gap = 3;
    const widths = tags.map((t) => Math.ceil(ctx.measureText(t.label).width) + 10);
    // Rows as wide as the panel (both sides wrap; the enemy's rows hug the right edge)
    const rows = [[]];
    let rowW = 0;
    tags.forEach((tag, i) => {
      if (rows[rows.length - 1].length && rowW + gap + widths[i] > panelW) {
        rows.push([]);
        rowW = 0;
      }
      rowW += (rows[rows.length - 1].length ? gap : 0) + widths[i];
      rows[rows.length - 1].push(i);
    });
    rows.forEach((row, r) => {
      const rw = row.reduce((a, i) => a + widths[i], 0) + gap * (row.length - 1);
      let tx = alignRight ? panelX + panelW - rw : panelX;
      const ty = tagY + r * (tagH + gap);
      for (const i of row) {
      const tag = tags[i];
      const tw = widths[i];
      ctx.fillStyle = 'rgba(16, 17, 28, 0.9)';
      ctx.fillRect(tx, ty, tw, tagH);
      ctx.fillStyle = tag.color;
      ctx.fillRect(tx, ty, tw, 2);
      ctx.fillRect(tx, ty + tagH - 2, tw, 2);
      ctx.textAlign = 'left';
      ctx.fillText(tag.label, tx + 5, ty + 11);
      this._hoverZones.push({ x: rect.left + tx, y: rect.top + ty, w: tw, h: tagH, desc: tag.desc, color: tag.color });
      tx += tw + gap;
      }
    });
  }

  _handleTooltipMove(e) {
    // Enemy gear badges: the part's card with its battle numbers
    const rect = this.canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const gz = (this._gearZones || []).find((z) => cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h);
    if (gz) {
      if (this._gearTip !== gz.part) {
        this._gearTip = gz.part;
        showTip(battlePartHtml(gz.part), e.clientX, e.clientY);
      } else showTip(null, e.clientX, e.clientY);
      this._tooltip.style.display = 'none';
      return;
    }
    if (this._gearTip) {
      this._gearTip = null;
      hideTip();
    }
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

  /**
   * INTENT (Game.intent): the enemy's forecast next turn as a row of icons over
   * its head (moves, the guns it fires, stomp, vent, drones) and the damage it
   * would deal you, red when it would knock you out. Hover / tap for the words.
   */
  _drawIntent(ctx, view, world) {
    const it = world.intent;
    const e = world.fireTarget;
    if (!it || !e || e.hp <= 0) return;
    const ICON = { move: 'move', stomp: 'stomp', vent: 'cool' };
    const cell = 30;
    const pad = 5;
    ctx.font = `700 13px ${FONT}`;
    const color = it.lost ? '#a7f070' : it.lethal ? '#ff5d73' : DTYPES[e.element]?.color || '#ff5d73';
    const label = it.lost ? `${it.lost}: TURN LOST` : it.dmg > 0 ? `${it.dmg}` : '';
    const icons = it.lost ? [iconCanvas('lock')] : it.steps.map((st) => (st.part ? partCanvas(st.part.id) : iconCanvas(ICON[st.kind] || 'star')));
    if (!it.lost && !icons.length) icons.push(iconCanvas('cd')); // holding
    if (it.lethal) icons.push(iconCanvas('skull'));
    const textW = label ? Math.ceil(ctx.measureText(label).width) + 6 : 0;
    const w = pad * 2 + icons.length * cell + textW;
    const h = cell;
    const head = this._worldToCss(view, e.x, e.y - e.radius);
    const x = Math.round(Math.max(4, Math.min(view.cssW - w - 4, head.x - w / 2)));
    let y = head.y - 34 - h; // over its top guns
    // Team fights: the enemy roster (an HTML bar over the canvas) sits above it; stay under the bar
    const bar = document.getElementById('enemy-team-bar');
    const cr = this.canvas.getBoundingClientRect();
    const br = bar && bar.offsetParent ? bar.getBoundingClientRect() : null;
    if (br && br.height && x + w > br.left - cr.left && x < br.right - cr.left && y < br.bottom - cr.top + 4) y = Math.min(br.bottom - cr.top + 4, head.y - h - 6);
    y = Math.round(Math.max(4, y));
    ctx.fillStyle = '#000';
    ctx.fillRect(x + 2, y + 2, w, h);
    ctx.fillStyle = 'rgba(16, 17, 28, 0.94)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, 2);
    // A notch pointing down at the mech
    ctx.fillRect(Math.round(head.x) - 3, y + h, 6, 3);
    icons.forEach((ic, i) => {
      const { w: iw, h: ih } = iconSize(ic);
      const k = Math.max(1, Math.min((cell - 4) / iw, (cell - 8) / ih)); // fill the cell (wide guns too)
      ctx.drawImage(ic, Math.round(x + pad + i * cell + (cell - iw * k) / 2), Math.round(y + 1 + (h - ih * k) / 2), Math.round(iw * k), Math.round(ih * k));
    });
    if (label) {
      ctx.textAlign = 'left';
      ctx.fillStyle = color;
      ctx.fillText(label, x + pad + icons.length * cell + 3, y + h / 2 + 5);
    }
    const rect = this.canvas.getBoundingClientRect();
    this._hoverZones.push({ x: rect.left + x, y: rect.top + y, w, h, desc: it.desc, color });
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

  _drawTurnHint(ctx, view, turnSystem, world) {
    // Teach the controls on the first turns of a new player's first run only
    if (!world.showHints || (world.battleStats?.turns || 0) > 1) return;
    if (turnSystem?.phase !== 'PLAYER_AIM') return;
    if (world.gear && !(world.player?.actionsLeft > 0)) return;
    this._centerNotice(ctx, view, 'TAP A LIT PLATE TO MOVE, TAP A GUN TO FIRE, OR COOL DOWN', '#f4f4f4', view.cssH * 0.66);
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

/** A panel name: shrinks from 15px to 11px to fit, then cuts with "…"; restores the 15px font. */
function fitName(ctx, text, x, y, maxW) {
  let size = 15;
  for (; size > 11; size--) {
    ctx.font = `700 ${size}px ${FONT}`;
    if (ctx.measureText(text).width <= maxW) break;
  }
  ctx.font = `700 ${size}px ${FONT}`;
  ctx.fillText(fitText(ctx, text, maxW), x, y);
  ctx.font = `700 15px ${FONT}`;
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
