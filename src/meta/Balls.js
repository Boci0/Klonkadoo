// ============================================================
// Ball — the one playable operator. There are no classes: what
// your ball can do comes from its Rig (frame, guns, drone,
// modules), so every stat here is neutral. The ball only carries
// its look: paints unlocked by playing (see SaveSystem stats).
//
// Risk, mastery and per-ball stats are still keyed by ball id in
// the save; the operator's id ('operator') started them fresh
// when classes were retired.
// ============================================================

export const OPERATOR = {
  id: 'operator',
  name: 'OPERATOR',
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
};

export const BALLS = [OPERATOR];

/** Any old class id (saved runs from before classes were retired) maps to the operator. */
export const getBall = () => OPERATOR;

/**
 * Paints: a palette and a pattern painted onto the ball sprite
 * (see rendering/ballSprite). Unlocks read the operator's stats kept by
 * SaveSystem.getBallStats: wins, kills, hits, bestHit, rams,
 * bestRiskWin (highest Risk won on, -1 = none), masteryLevel.
 */
export const SKINS = {
  operator: [
    { id: 'default', name: 'COBALT', pattern: 'chevron' },
    { id: 'veteran', name: 'VETERAN', color: '#6b8e4e', darkColor: '#2f4a2a', accent: '#c2a36b', pattern: 'camo', unlock: { stat: 'wins', value: 1 }, hint: 'Win a run' },
    { id: 'ironclad', name: 'IRONCLAD', color: '#73eff7', darkColor: '#257179', pattern: 'rivets', unlock: { stat: 'kills', value: 50 }, hint: 'Defeat 50 enemies' },
    { id: 'neon', name: 'NEON', color: '#ff4fa3', darkColor: '#8a1c5a', accent: '#73eff7', pattern: 'stripe', unlock: { stat: 'rams', value: 40 }, hint: 'Expose 40 enemies by ramming' },
    { id: 'magma', name: 'MAGMA CORE', color: '#2c2230', darkColor: '#150f18', accent: '#ff7b2e', pattern: 'lava', unlock: { stat: 'bestHit', value: 70 }, hint: 'Deal 70+ damage in one hit' },
    { id: 'aurora', name: 'AURORA', color: '#38d9b0', darkColor: '#1b5e7a', accent: '#a7f070', pattern: 'wave', unlock: { stat: 'hits', value: 400 }, hint: 'Land 400 hits' },
    { id: 'paladin', name: 'PALADIN', color: '#f4f4f4', darkColor: '#94b0c2', accent: '#ffcd75', pattern: 'cross', unlock: { stat: 'kills', value: 150 }, hint: 'Defeat 150 enemies' },
    { id: 'sovereign', name: 'SOVEREIGN', color: '#7d4ec2', darkColor: '#3a1e6b', accent: '#ffcd75', pattern: 'crown', unlock: { stat: 'bestRiskWin', value: 6 }, hint: 'Win on Risk 6+' },
    { id: 'supernova', name: 'SUPERNOVA', color: '#ff5d73', darkColor: '#6b1530', accent: '#ffcd75', pattern: 'star', unlock: { stat: 'bestRiskWin', value: 9 }, hint: 'Win on Risk 9+' },
    { id: 'master', name: 'MASTER', color: '#ffcd75', darkColor: '#b86f2a', accent: '#f4f4f4', pattern: 'chevron', unlock: { stat: 'masteryLevel', value: 20 }, hint: 'Reach mastery 20' },
    { id: 'grandmaster', name: 'GRANDMASTER', color: '#f4f4f4', darkColor: '#29366f', accent: '#ffcd75', pattern: 'crown', unlock: { stat: 'masteryLevel', value: 50 }, hint: 'Reach mastery 50' },
  ],
};

export const skinsFor = () => SKINS.operator;

export function isSkinUnlocked(skin, stats = {}) {
  if (!skin?.unlock) return true;
  return (stats[skin.unlock.stat] || 0) >= skin.unlock.value;
}

/** Progress toward a locked paint, e.g. "12/30". */
export function skinProgress(skin, stats = {}) {
  if (!skin?.unlock) return '';
  return `${Math.max(0, Math.min(stats[skin.unlock.stat] || 0, skin.unlock.value))}/${skin.unlock.value}`;
}

/** Colours + pattern for the ball with a paint applied. */
export function skinColors(ball, skinId) {
  const list = skinsFor();
  const skin = list.find((s) => s.id === skinId) || list[0];
  return {
    color: skin.color || OPERATOR.color,
    darkColor: skin.darkColor || OPERATOR.darkColor,
    accent: skin.accent || null,
    pattern: skin.pattern || null,
  };
}
