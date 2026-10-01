// ============================================================
// Mastery — your pilot level (1-50), earned by playing runs.
//
// Every run gives XP, win or lose: floors reached, fights won, a win
// bonus, Abyss depth, and more on higher Risk. Levels 2-20 add max HP and
// damage to every mech you field; levels 21-50 add a little more each
// (the long road: most of the power is in the first 20). Milestone levels
// unlock a named perk. Everything here is shown to the player as-is
// (MILESTONES labels, masteryPerks lines), so keep the words and the
// numbers in sync. The PILOT screen (UIManager.showPilot) shows it all.
// ============================================================

export const MAX_MASTERY = 50;

/** What every level above 1 gives: levels 2-20 (PER_LEVEL), then LATE_LEVEL from level 21 on. */
export const PER_LEVEL = { hp: 40, dmgPct: 0.02 };
export const LATE_LEVEL = { hp: 10, dmgPct: 0.003, from: 21 };

/** XP needed to go from `level` to `level + 1` (2.10: slower, about 200 strong runs to 50). */
export const xpToNext = (level) => Math.round(100 + 35 * level + 1.2 * level * level);
/** The 2.9 curve (max 20), for moving old saves over at the same level (SaveSystem._migrate). */
export const oldXpToNext = (level) => 60 + 20 * level;
/** Total XP at the start of `level` on the current curve. */
export const xpForLevel = (level) => {
  let xp = 0;
  for (let l = 1; l < Math.min(level, MAX_MASTERY); l++) xp += xpToNext(l);
  return xp;
};

/** { level, into, need } for a total XP amount. */
export function masteryLevel(xp = 0) {
  let level = 1;
  let left = Math.max(0, xp);
  while (level < MAX_MASTERY && left >= xpToNext(level)) {
    left -= xpToNext(level);
    level += 1;
  }
  return { level, into: level >= MAX_MASTERY ? 0 : left, need: level >= MAX_MASTERY ? 0 : xpToNext(level) };
}

/** XP for one run. Abyss depth counts as extra floors. */
export function runXp({ floorsReached = 1, fightsWon = 0, victory = false, risk = 0, abyssDepth = 0 }) {
  const base = floorsReached * 12 + fightsWon * 6 + (victory ? 60 : 0) + abyssDepth * 25;
  return Math.round(base * (1 + 0.1 * risk));
}

// Milestone perks: level -> { name, label, apply(stats) }. They stack.
export const MILESTONES = [
  { level: 3, name: 'STEADY AIM', label: '+4% crit chance', apply: (s) => { s.critChance += 0.04; } },
  { level: 5, name: 'FIELD MEDIC', label: 'Safe Zones repair +10% more of max HP', apply: (s) => { s.restHealPct += 0.1; } },
  { level: 7, name: 'SCAVENGER', label: '+10% scrap from battles', apply: (s) => { s.scrapPct += 0.1; } },
  { level: 10, name: 'HARDENED HULL', label: '+2 DEF against every damage type', apply: (s) => { s.defBonus += 2; } },
  { level: 12, name: 'KEYSMITH', label: '+1 Key from every battle won', apply: (s) => { s.bonusKeys += 1; } },
  { level: 15, name: 'VETERAN', label: 'Take 6% less damage', apply: (s) => { s.damageReduction += 0.06; } },
  { level: 18, name: 'PROSPECTOR', label: '+10% gold', apply: (s) => { s.goldPct += 0.1; } },
  { level: 20, name: 'MASTER', label: 'MASTER paint, and +10% more damage', apply: (s) => { s.atkBonus += 0.1; } },
  // The long road
  { level: 23, name: 'SHARPSHOOTER', label: '+2% crit chance', apply: (s) => { s.critChance += 0.02; } },
  { level: 26, name: 'SALVAGER', label: '+10% scrap from battles', apply: (s) => { s.scrapPct += 0.1; } },
  { level: 30, name: 'IRONCLAD', label: '+1 DEF against every damage type', apply: (s) => { s.defBonus += 1; } },
  { level: 34, name: 'KEYMASTER', label: '+1 Key from every battle won', apply: (s) => { s.bonusKeys += 1; } },
  { level: 38, name: 'FIELD SURGEON', label: 'Safe Zones repair +10% more of max HP', apply: (s) => { s.restHealPct += 0.1; } },
  { level: 42, name: 'HARDENED VETERAN', label: 'Take 3% less damage', apply: (s) => { s.damageReduction += 0.03; } },
  { level: 46, name: 'TYCOON', label: '+10% gold', apply: (s) => { s.goldPct += 0.1; } },
  { level: 50, name: 'GRANDMASTER', label: 'GRANDMASTER paint, and +5% more damage', apply: (s) => { s.atkBonus += 0.05; } },
];

/** Levels that pay PER_LEVEL and LATE_LEVEL at `level`. */
const levelSteps = (level) => ({ early: Math.max(0, Math.min(level, LATE_LEVEL.from - 1) - 1), late: Math.max(0, level - (LATE_LEVEL.from - 1)) });

/** Stat bonuses at a mastery level: PER_LEVEL / LATE_LEVEL for every level above 1, plus the milestones reached. */
export function masteryStats(level) {
  const { early, late } = levelSteps(level);
  const s = { hpBonus: PER_LEVEL.hp * early + LATE_LEVEL.hp * late, atkBonus: PER_LEVEL.dmgPct * early + LATE_LEVEL.dmgPct * late, critChance: 0, defBonus: 0, damageReduction: 0, restHealPct: 0, scrapPct: 0, bonusKeys: 0, goldPct: 0 };
  for (const m of MILESTONES) if (level >= m.level) m.apply(s);
  return s;
}

/** Plain lines for what a level gives in total (the mastery hover card). */
export function masteryPerks(level) {
  const s = masteryStats(level);
  const { early, late } = levelSteps(level);
  return [`+${s.hpBonus} max HP`, `+${Math.round((PER_LEVEL.dmgPct * early + LATE_LEVEL.dmgPct * late) * 1000) / 10}% damage`, ...MILESTONES.filter((m) => level >= m.level).map((m) => `${m.name}: ${m.label}`)];
}

/** Fold the pilot's mastery into the permanent stats for a run. */
export function withMastery(perm, level) {
  const m = masteryStats(level);
  return {
    ...perm,
    hpBonus: (perm.hpBonus || 0) + m.hpBonus,
    atkBonus: (perm.atkBonus || 0) + m.atkBonus,
    critChance: (perm.critChance || 0) + m.critChance,
    defBonus: (perm.defBonus || 0) + m.defBonus,
    kineticDampenerPct: (perm.kineticDampenerPct || 0) + m.damageReduction, // read as "damage taken -X%" (RunState.damageReductionPct)
    restHealPct: (perm.restHealPct || 0) + m.restHealPct,
    scrapPct: (perm.scrapPct || 0) + m.scrapPct,
    bonusKeys: (perm.bonusKeys || 0) + m.bonusKeys,
    gearGoldPct: (perm.gearGoldPct || 0) + m.goldPct,
    masteryLevel: level,
  };
}
