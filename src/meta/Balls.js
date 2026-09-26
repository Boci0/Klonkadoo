// ============================================================
// Balls — the playable characters, picked at the start of a run.
// Classes differ in three ways:
//   stats   – hpBonus, defBonus, atkPct, powerPct (launch power),
//             dmgTakenPct (extra damage taken)
//   physics – radiusMult (size), mass (who shoves whom in a collision),
//             bounce (restitution vs walls/floor), gravityMult
//   kit     – one passive trait + one signature skill (button 1)
// Traits are implemented in battle code by checking `ballType`:
//   juggernaut – Physics (smashes barriers), CollisionSystem (+40% dmg)
//   striker    – CollisionSystem (+10% crit chance)
//   cluster    – Game (fragments on first wall bounce each turn)
//   graviton   – Physics (ignores wind), CollisionSystem (dive bonus)
// `rating` (1-5) only drives the stat bars on the select screen.
// ============================================================

export const BALLS = [
  {
    id: 'vanguard',
    name: 'VANGUARD',
    role: 'Balanced',
    trait: 'No weaknesses, no tricks. Its skill recharges 1 turn faster than other classes.',
    feel: 'Standard weight and bounce.',
    skill: 'overdrive',
    color: '#41a6f6',
    darkColor: '#29366f',
    radiusMult: 1,
    hpBonus: 0,
    defBonus: 0,
    atkPct: 0,
    powerPct: 0,
    dmgTakenPct: 0,
    mass: 1,
    bounce: 1,
    gravityMult: 1,
    rating: { hp: 3, atk: 3, power: 3 },
  },
  {
    id: 'juggernaut',
    name: 'JUGGERNAUT',
    role: 'Tank',
    trait: 'Hits deal +40% damage and smash barriers. Huge target, short range.',
    feel: 'Very heavy: shoves enemies far, barely bounces (no bank shots).',
    skill: 'quake',
    color: '#73eff7',
    darkColor: '#257179',
    radiusMult: 1.45,
    hpBonus: 60,
    defBonus: 4,
    atkPct: 0,
    powerPct: -0.25,
    dmgTakenPct: 0,
    mass: 2.4,
    bounce: 0.5,
    gravityMult: 1,
    rating: { hp: 5, atk: 4, power: 1 },
  },
  {
    id: 'striker',
    name: 'STRIKER',
    role: 'Glass cannon',
    trait: 'Tiny and fast: +10% crit chance, hard to hit, but every hit on it hurts 25% more.',
    feel: 'Light: gets knocked around by anything it hits.',
    skill: 'railshot',
    color: '#ef7d57',
    darkColor: '#b13e53',
    radiusMult: 0.75,
    hpBonus: -40,
    defBonus: 0,
    atkPct: 0.35,
    powerPct: 0.2,
    dmgTakenPct: 0.25,
    mass: 0.6,
    bounce: 1.1,
    gravityMult: 1,
    rating: { hp: 1, atk: 5, power: 5 },
  },
  {
    id: 'cluster',
    name: 'CLUSTER',
    role: 'Ricochet',
    trait: 'First wall bounce each turn splits off 2 homing fragments (12 dmg). Direct hits are weak.',
    feel: 'Super bouncy: keeps its speed off every wall.',
    skill: 'shrapnel',
    color: '#ffcd75',
    darkColor: '#ef7d57',
    radiusMult: 1,
    hpBonus: -15,
    defBonus: 0,
    atkPct: -0.25,
    powerPct: 0.05,
    dmgTakenPct: 0,
    mass: 0.9,
    bounce: 1.3,
    gravityMult: 1,
    rating: { hp: 2, atk: 2, power: 3 },
  },
  {
    id: 'graviton',
    name: 'GRAVITON',
    role: 'Precision',
    trait: 'Ignores wind; hits while falling deal +30% damage. Lobs drop short.',
    feel: 'Dense: falls 30% faster than anything else.',
    skill: 'zerog',
    color: '#c46fd6',
    darkColor: '#5d275d',
    radiusMult: 1,
    hpBonus: -10,
    defBonus: 1,
    atkPct: 0,
    powerPct: 0.15,
    dmgTakenPct: 0,
    mass: 1.5,
    bounce: 0.75,
    gravityMult: 1.3,
    rating: { hp: 2, atk: 3, power: 4 },
  },
];

export const getBall = (id) => BALLS.find((b) => b.id === id) || BALLS[0];

/**
 * Signature skills (one per class, button 1 in battle).
 * `armed` skills change your next shot; the others fire instantly.
 * Energy Well (relic) empowers every skill: see Game.useAbility.
 */
export const SKILLS = {
  overdrive: {
    name: 'OVERDRIVE',
    short: 'OVERDRIVE',
    desc: 'Next hit deals 1.5x damage. Stacks if used again before firing.',
    cooldown: 3,
    color: '#ffcd75',
  },
  quake: {
    name: 'SEISMIC SLAM',
    short: 'SLAM',
    desc: 'Instant: every enemy on the ground takes 12 damage, is thrown into the air and loses its shield.',
    cooldown: 4,
    color: '#73eff7',
  },
  railshot: {
    name: 'RAILGUN',
    short: 'RAILGUN',
    desc: 'Next shot pierces straight through enemies, hitting every one it touches for +25% damage.',
    cooldown: 3,
    color: '#ef7d57',
    armed: true,
  },
  shrapnel: {
    name: 'SHRAPNEL',
    short: 'SHRAPNEL',
    desc: 'Next shot bursts into homing fragments on each of its next 3 bounces (walls, floor or barriers).',
    cooldown: 3,
    color: '#ffcd75',
    armed: true,
  },
  zerog: {
    name: 'ZERO-G',
    short: 'ZERO-G',
    desc: 'Next shot flies dead straight for 0.8s, ignoring gravity, and hits for +20% damage.',
    cooldown: 3,
    color: '#c46fd6',
    armed: true,
  },
};

export const getSkill = (ballType) => SKILLS[getBall(ballType).skill] || SKILLS.overdrive;

/**
 * Cosmetic skins, unique per class. Each has its own palette and a
 * pattern painted onto the ball sprite (see Renderer._ballSprite).
 * Unlocks read per-ball stats kept by SaveSystem.getBallStats:
 *   bestFloor, wins, kills, hits, bestHit, shardHits, diveHits,
 *   skillUses, pierceHits, bestRiskWin (highest Risk won on, -1 = none)
 */
export const SKINS = {
  vanguard: [
    { id: 'default', name: 'COBALT', pattern: 'chevron' },
    { id: 'veteran', name: 'VETERAN', color: '#6b8e4e', darkColor: '#2f4a2a', accent: '#c2a36b', pattern: 'camo', unlock: { stat: 'wins', value: 1 }, hint: 'Win a run' },
    { id: 'paladin', name: 'PALADIN', color: '#f4f4f4', darkColor: '#94b0c2', accent: '#ffcd75', pattern: 'cross', unlock: { stat: 'kills', value: 150 }, hint: 'Defeat 150 enemies' },
    { id: 'sovereign', name: 'SOVEREIGN', color: '#7d4ec2', darkColor: '#3a1e6b', accent: '#ffcd75', pattern: 'crown', unlock: { stat: 'bestRiskWin', value: 6 }, hint: 'Win on Risk 6+' },
  ],
  juggernaut: [
    { id: 'default', name: 'IRONCLAD', pattern: 'rivets' },
    { id: 'boulder', name: 'BOULDER', color: '#8b8d98', darkColor: '#4a4c57', accent: '#2c2e38', pattern: 'cracks', unlock: { stat: 'wins', value: 1 }, hint: 'Win a run' },
    { id: 'magma', name: 'MAGMA CORE', color: '#2c2230', darkColor: '#150f18', accent: '#ff7b2e', pattern: 'lava', unlock: { stat: 'bestHit', value: 70 }, hint: 'Deal 70+ damage in one hit' },
    { id: 'obsidian', name: 'OBSIDIAN KING', color: '#241a33', darkColor: '#0d0914', accent: '#c46fd6', pattern: 'crown', unlock: { stat: 'bestRiskWin', value: 6 }, hint: 'Win on Risk 6+' },
  ],
  striker: [
    { id: 'default', name: 'EMBER', pattern: 'bolt' },
    { id: 'neon', name: 'NEON', color: '#ff4fa3', darkColor: '#8a1c5a', accent: '#73eff7', pattern: 'stripe', unlock: { stat: 'wins', value: 1 }, hint: 'Win a run' },
    { id: 'viper', name: 'VIPER', color: '#38b764', darkColor: '#14502c', accent: '#1a1c2c', pattern: 'scales', unlock: { stat: 'pierceHits', value: 60 }, hint: 'Pierce 60 enemies with Railgun' },
    { id: 'comet', name: 'COMET', color: '#e8f6ff', darkColor: '#6d9dc5', accent: '#41a6f6', pattern: 'streak', unlock: { stat: 'bestRiskWin', value: 6 }, hint: 'Win on Risk 6+' },
  ],
  cluster: [
    { id: 'default', name: 'SUNBURST', pattern: 'dots' },
    { id: 'confetti', name: 'CONFETTI', color: '#f4f4f4', darkColor: '#94b0c2', accent: '#ff5d73', pattern: 'confetti', unlock: { stat: 'wins', value: 1 }, hint: 'Win a run' },
    { id: 'honeycomb', name: 'HONEYCOMB', color: '#f0a830', darkColor: '#8a4d10', accent: '#5a3008', pattern: 'checker', unlock: { stat: 'shardHits', value: 150 }, hint: 'Land 150 fragment hits' },
    { id: 'supernova', name: 'SUPERNOVA', color: '#ff5d73', darkColor: '#6b1530', accent: '#ffcd75', pattern: 'star', unlock: { stat: 'bestRiskWin', value: 6 }, hint: 'Win on Risk 6+' },
  ],
  graviton: [
    { id: 'default', name: 'NEBULA', pattern: 'orbit' },
    { id: 'horizon', name: 'EVENT HORIZON', color: '#14121f', darkColor: '#050409', accent: '#ffcd75', pattern: 'ring', unlock: { stat: 'wins', value: 1 }, hint: 'Win a run' },
    { id: 'aurora', name: 'AURORA', color: '#38d9b0', darkColor: '#1b5e7a', accent: '#a7f070', pattern: 'wave', unlock: { stat: 'diveHits', value: 80 }, hint: 'Land 80 diving hits' },
    { id: 'quasar', name: 'QUASAR', color: '#f4f4f4', darkColor: '#7d4ec2', accent: '#c46fd6', pattern: 'star', unlock: { stat: 'bestRiskWin', value: 6 }, hint: 'Win on Risk 6+' },
  ],
};

export const skinsFor = (ballId) => SKINS[ballId] || SKINS.vanguard;

export function isSkinUnlocked(skin, stats = {}) {
  if (!skin?.unlock) return true;
  return (stats[skin.unlock.stat] || 0) >= skin.unlock.value;
}

/** Progress toward a locked skin, e.g. "12/30". */
export function skinProgress(skin, stats = {}) {
  if (!skin?.unlock) return '';
  return `${Math.max(0, Math.min(stats[skin.unlock.stat] || 0, skin.unlock.value))}/${skin.unlock.value}`;
}

/** Colours + pattern for a ball with a skin applied. */
export function skinColors(ball, skinId) {
  const list = skinsFor(ball.id);
  const skin = list.find((s) => s.id === skinId) || list[0];
  return {
    color: skin.color || ball.color,
    darkColor: skin.darkColor || ball.darkColor,
    accent: skin.accent || null,
    pattern: skin.pattern || null,
  };
}
