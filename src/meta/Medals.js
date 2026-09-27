// ============================================================
// Medals — permanent achievements that pay Keys.
// Each medal reads a lifetime counter (SaveSystem.getLifetime) or,
// with `custom`, anything in the save. checkMedals() awards every
// newly reached medal and returns them so the UI can celebrate.
// ============================================================


export const MEDALS = [
  // Combat
  { id: 'm_first_blood', name: 'FIRST BLOOD', desc: 'Defeat an enemy.', stat: 'kills', value: 1, keys: 1 },
  { id: 'm_kills_50', name: 'EXTERMINATOR', desc: 'Defeat 50 enemies.', stat: 'kills', value: 50, keys: 3 },
  { id: 'm_kills_250', name: 'ANNIHILATOR', desc: 'Defeat 250 enemies.', stat: 'kills', value: 250, keys: 8 },
  { id: 'm_boss_1', name: 'GIANT SLAYER', desc: 'Defeat a mini-boss or boss.', stat: 'bossKills', value: 1, keys: 3 },
  { id: 'm_boss_10', name: 'BOSS HUNTER', desc: 'Defeat 10 mini-bosses or bosses.', stat: 'bossKills', value: 10, keys: 8 },
  { id: 'm_hit_40', name: 'HEAVY HITTER', desc: 'Deal 40+ damage in one hit.', stat: 'bestHit', value: 40, keys: 2 },
  { id: 'm_hit_75', name: 'DEVASTATOR', desc: 'Deal 75+ damage in one hit.', stat: 'bestHit', value: 75, keys: 5 },
  { id: 'm_crit_25', name: 'LUCKY STRIKE', desc: 'Land 25 critical hits.', stat: 'crits', value: 25, keys: 3 },
  { id: 'm_combo_3', name: 'CROSSFIRE', desc: 'Hit 3 enemies with a single shot.', stat: 'maxCombo', value: 3, keys: 3 },
  { id: 'm_ram_10', name: 'BATTERING RAM', desc: 'Expose 10 enemies by ramming them.', stat: 'rams', value: 10, keys: 2 },
  { id: 'm_ram_100', name: 'WRECKING BALL', desc: 'Expose 100 enemies by ramming them.', stat: 'rams', value: 100, keys: 6 },

  // Runs
  { id: 'm_floor_3', name: 'DEEP STRIKE', desc: 'Reach floor 3.', stat: 'bestFloor', value: 3, keys: 2 },
  { id: 'm_floor_5', name: 'FINAL APPROACH', desc: 'Reach floor 5.', stat: 'bestFloor', value: 5, keys: 3 },
  { id: 'm_win', name: 'OPERATION COMPLETE', desc: 'Win a run.', stat: 'wins', value: 1, keys: 5 },
  { id: 'm_win_5', name: 'DECORATED', desc: 'Win 5 runs.', stat: 'wins', value: 5, keys: 10 },
  { id: 'm_risk_3', name: 'RISK TAKER', desc: 'Win a run on Risk 3 or higher.', stat: 'bestRiskWin', value: 3, keys: 8 },
  { id: 'm_runs_25', name: 'VETERAN OPERATOR', desc: 'Play 25 runs.', stat: 'runs', value: 25, keys: 5 },
  {
    id: 'm_arsenal',
    name: 'ARSENAL',
    desc: 'Own 20 different parts.',
    keys: 15,
    custom: (save) => {
      const kinds = new Set((save.data.mech?.owned || []).map((p) => p.id)).size;
      return [Math.min(20, kinds), 20];
    },
  },
  { id: 'm_streak_7', name: 'ON DUTY', desc: 'Claim the daily supply drop 7 days in a row.', stat: 'bestStreak', value: 7, keys: 5 },
];

/** [current, target] progress for a medal. */
export function medalProgress(medal, save) {
  if (medal.custom) return medal.custom(save);
  const life = save.getLifetime();
  return [Math.max(0, life[medal.stat] || 0), medal.value];
}

/** Award every newly reached medal; returns the ones just earned. */
export function checkMedals(save) {
  const earned = [];
  for (const medal of MEDALS) {
    if (save.hasMedal(medal.id)) continue;
    const [cur, max] = medalProgress(medal, save);
    if (cur >= max && save.awardMedal(medal.id, medal.keys)) earned.push(medal);
  }
  return earned;
}
