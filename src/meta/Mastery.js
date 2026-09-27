// ============================================================
// Mastery — per-ball levels (1-20) earned by playing that ball.
//
// Every run gives XP (floors reached, fights won, a win bonus, more
// on higher Risk), win or lose. Levels carry raw stats on top of
// gear: HP and damage every level, plus milestones.
// ============================================================

export const MAX_MASTERY = 20;

/** XP needed to go from `level` to `level + 1`. */
export const xpToNext = (level) => 60 + 20 * level;

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

// Milestones: level -> { label, apply(stats) }
export const MILESTONES = [
  { level: 5, label: '+5% crit chance', apply: (s) => { s.critChance += 0.05; } },
  { level: 10, label: 'Skill cooldown -1', apply: (s) => { s.skillCdCut += 1; } },
  { level: 15, label: '+3 DEF, take 8% less damage', apply: (s) => { s.defBonus += 3; s.damageReduction += 0.08; } },
  { level: 20, label: 'MASTER skin', apply: () => {} },
];

/** Stat bonuses at a mastery level: +5 HP and +2.5% damage per level above 1. */
export function masteryStats(level) {
  const s = { hpBonus: 5 * (level - 1), atkBonus: 0.025 * (level - 1), critChance: 0, skillCdCut: 0, defBonus: 0, damageReduction: 0 };
  for (const m of MILESTONES) if (level >= m.level) m.apply(s);
  return s;
}

/** Fold a ball's mastery into the permanent stats for a run. */
export function withMastery(perm, level) {
  const m = masteryStats(level);
  return {
    ...perm,
    hpBonus: (perm.hpBonus || 0) + m.hpBonus,
    atkBonus: (perm.atkBonus || 0) + m.atkBonus,
    critChance: (perm.critChance || 0) + m.critChance,
    skillCdCut: (perm.skillCdCut || 0) + m.skillCdCut,
    defBonus: (perm.defBonus || 0) + m.defBonus,
    kineticDampenerPct: (perm.kineticDampenerPct || 0) + m.damageReduction, // read as "damage taken -X%"
    masteryLevel: level,
  };
}
