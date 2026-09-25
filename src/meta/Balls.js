// ============================================================
// Balls — the playable characters, picked at the start of a run.
// Each has run-long stat modifiers plus one signature trait that
// is implemented in battle code by checking `ballType`:
//   juggernaut – Physics (smashes barriers), CollisionSystem (+40% dmg)
//   cluster    – Game (fragments on first wall bounce each turn)
//   graviton   – Game (pulls enemies while flying)
// `rating` (1-5) only drives the stat bars on the select screen.
// ============================================================

export const BALLS = [
  {
    id: 'vanguard',
    name: 'VANGUARD',
    role: 'Balanced',
    trait: 'No weaknesses. A reliable all-rounder.',
    color: '#41a6f6',
    darkColor: '#29366f',
    radiusMult: 1,
    hpBonus: 0,
    atkPct: 0,
    powerPct: 0,
    rating: { hp: 3, atk: 3, power: 3 },
  },
  {
    id: 'juggernaut',
    name: 'JUGGERNAUT',
    role: 'Tank',
    trait: 'Big and heavy: hits deal +40% damage and smash barriers. Easier to hit.',
    color: '#73eff7',
    darkColor: '#257179',
    radiusMult: 1.45,
    hpBonus: 40,
    atkPct: 0,
    powerPct: -0.1,
    rating: { hp: 5, atk: 4, power: 2 },
  },
  {
    id: 'striker',
    name: 'STRIKER',
    role: 'Glass cannon',
    trait: 'Small and fast. Hard to hit, hits hard.',
    color: '#ef7d57',
    darkColor: '#b13e53',
    radiusMult: 0.8,
    hpBonus: -25,
    atkPct: 0.3,
    powerPct: 0.15,
    rating: { hp: 1, atk: 5, power: 5 },
  },
  {
    id: 'cluster',
    name: 'CLUSTER',
    role: 'Ricochet',
    trait: 'First wall bounce each turn splits off 2 fragments that deal 12 damage each.',
    color: '#ffcd75',
    darkColor: '#ef7d57',
    radiusMult: 1,
    hpBonus: -10,
    atkPct: 0,
    powerPct: 0,
    rating: { hp: 2, atk: 3, power: 3 },
  },
  {
    id: 'graviton',
    name: 'GRAVITON',
    role: 'Control',
    trait: 'Drags nearby enemies toward itself while flying.',
    color: '#c46fd6',
    darkColor: '#5d275d',
    radiusMult: 1,
    hpBonus: -5,
    atkPct: 0,
    powerPct: 0.1,
    rating: { hp: 3, atk: 2, power: 4 },
  },
];

export const getBall = (id) => BALLS.find((b) => b.id === id) || BALLS[0];

/**
 * Cosmetic skins, unlocked per ball:
 *   GOLD   – win a run with this ball
 *   SHADOW – reach floor 3 with this ball
 */
export const SKINS = [
  { id: 'default', name: 'STANDARD', unlock: null },
  { id: 'gold', name: 'GOLD', color: '#ffcd75', darkColor: '#ef7d57', unlock: { wins: 1 }, hint: 'Win a run with this ball' },
  { id: 'shadow', name: 'SHADOW', color: '#566c86', darkColor: '#1a1c2c', unlock: { floor: 3 }, hint: 'Reach floor 3 with this ball' },
];

export function isSkinUnlocked(skin, stats = {}) {
  if (!skin.unlock) return true;
  if (skin.unlock.wins) return (stats.wins || 0) >= skin.unlock.wins;
  if (skin.unlock.floor) return (stats.bestFloor || 0) >= skin.unlock.floor;
  return false;
}

/** Colours for a ball with a skin applied. */
export function skinColors(ball, skinId) {
  const skin = SKINS.find((s) => s.id === skinId);
  return skin && skin.color ? { color: skin.color, darkColor: skin.darkColor } : { color: ball.color, darkColor: ball.darkColor };
}
