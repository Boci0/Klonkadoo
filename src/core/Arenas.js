// ============================================================
// Arenas — battle layouts. Each floor has a pool; every battle
// picks one at random.
//
// World is 1280×750, ground at y=620. The player starts at x≈320
// and enemies at x≥740, so hazards live in the middle (x 420–700).
//
//   platforms  – solid ledges; `move: { amp, speed }` slides them on x
//   obstacles  – destructible blocks (hp)
//   hazards    – { type: 'spikes' | 'pad', x, w }
//   wind       – sideways acceleration (world units/s²) on airborne
//                balls; the sign is randomised per battle
// ============================================================

export const ARENAS = {
  1: [
    { name: 'OPEN FIELD', desc: 'Nothing in the way.' },
    { name: 'LOW WALL', desc: 'A breakable wall splits the field.', obstacles: [{ x: 560, y: 530, w: 40, h: 90, hp: 60 }] },
    { name: 'SPRING YARD', desc: 'Bounce pads launch balls skyward.', hazards: [{ type: 'pad', x: 470, w: 100 }] },
  ],
  2: [
    { name: 'ROOFTOP GAP', desc: 'A ledge over a breakable pillar.', platforms: [{ x: 540, y: 380, w: 200, h: 20 }], obstacles: [{ x: 620, y: 480, w: 40, h: 140, hp: 60 }] },
    { name: 'WINDY RIDGE', desc: 'Wind bends every shot.', wind: 170 },
    { name: 'SPIKE PIT', desc: 'Spikes hurt anything that lands on them.', hazards: [{ type: 'spikes', x: 470, w: 230 }] },
  ],
  3: [
    { name: 'TWIN LEDGES', desc: 'Two ledges guard a breakable pillar.', platforms: [{ x: 420, y: 340, w: 160, h: 20 }, { x: 700, y: 340, w: 160, h: 20 }], obstacles: [{ x: 620, y: 470, w: 40, h: 150, hp: 90 }] },
    { name: 'LIFT SHAFT', desc: 'A moving platform sweeps the middle.', platforms: [{ x: 560, y: 360, w: 170, h: 20, move: { amp: 150, speed: 1.1 } }] },
    { name: 'STORM FRONT', desc: 'Strong wind and a high ledge.', wind: 220, platforms: [{ x: 560, y: 300, w: 170, h: 20 }] },
  ],
  4: [
    { name: 'BUNKER LINE', desc: 'Two breakable pillars under ledges.', platforms: [{ x: 380, y: 320, w: 140, h: 20 }, { x: 760, y: 320, w: 140, h: 20 }], obstacles: [{ x: 520, y: 440, w: 35, h: 180, hp: 120 }, { x: 720, y: 440, w: 35, h: 180, hp: 120 }] },
    { name: 'SPRING TRAP', desc: 'Pads fling balls; spikes wait below.', hazards: [{ type: 'pad', x: 440, w: 80 }, { type: 'spikes', x: 540, w: 160 }] },
    { name: 'GALE BRIDGE', desc: 'Wind plus a drifting platform.', wind: 200, platforms: [{ x: 560, y: 380, w: 180, h: 20, move: { amp: 120, speed: 0.8 } }] },
  ],
  5: [
    { name: 'CITADEL WALL', desc: 'A tall wall between you and them.', platforms: [{ x: 340, y: 280, w: 180, h: 20 }, { x: 760, y: 280, w: 180, h: 20 }], obstacles: [{ x: 615, y: 380, w: 50, h: 240, hp: 200 }] },
    { name: 'KILL ZONE', desc: 'Spikes below, two moving platforms above.', hazards: [{ type: 'spikes', x: 450, w: 260 }], platforms: [{ x: 460, y: 330, w: 130, h: 20, move: { amp: 90, speed: 1.3 } }, { x: 640, y: 250, w: 130, h: 20, move: { amp: 90, speed: -1.0 } }] },
    { name: 'HURRICANE', desc: 'Violent wind and a breakable wall.', wind: 260, obstacles: [{ x: 600, y: 470, w: 40, h: 150, hp: 120 }] },
  ],
};

/** Deep-copied random arena for a floor, with wind direction rolled. */
export function pickArena(floor, rng = Math.random) {
  const pool = ARENAS[Math.min(5, Math.max(1, floor))] || ARENAS[1];
  const src = pool[Math.floor(rng() * pool.length)];
  const arena = JSON.parse(JSON.stringify(src));
  arena.platforms = (arena.platforms || []).map((p) => ({ ...p, baseX: p.x, active: true }));
  arena.obstacles = (arena.obstacles || []).map((o) => ({ ...o, maxHp: o.hp, active: true }));
  arena.hazards = arena.hazards || [];
  arena.wind = (arena.wind || 0) * (rng() < 0.5 ? -1 : 1);
  return arena;
}
