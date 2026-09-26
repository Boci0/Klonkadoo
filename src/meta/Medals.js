// ============================================================
// Medals — permanent achievements with Tech Point rewards.
// Each medal reads a lifetime counter (SaveSystem.getLifetime) or,
// with `custom`, anything in the save. checkMedals() awards every
// newly reached medal and returns them so the UI can celebrate.
// ============================================================

import { BALLS } from './Balls.js';

export const MEDALS = [
  // Combat
  { id: 'm_first_blood', name: 'FIRST BLOOD', desc: 'Defeat an enemy.', stat: 'kills', value: 1, tp: 2 },
  { id: 'm_kills_50', name: 'EXTERMINATOR', desc: 'Defeat 50 enemies.', stat: 'kills', value: 50, tp: 6 },
  { id: 'm_kills_250', name: 'ANNIHILATOR', desc: 'Defeat 250 enemies.', stat: 'kills', value: 250, tp: 15 },
  { id: 'm_boss_1', name: 'GIANT SLAYER', desc: 'Defeat a mini-boss or boss.', stat: 'bossKills', value: 1, tp: 5 },
  { id: 'm_boss_10', name: 'BOSS HUNTER', desc: 'Defeat 10 mini-bosses or bosses.', stat: 'bossKills', value: 10, tp: 15 },
  { id: 'm_hit_40', name: 'HEAVY HITTER', desc: 'Deal 40+ damage in one hit.', stat: 'bestHit', value: 40, tp: 4 },
  { id: 'm_hit_75', name: 'DEVASTATOR', desc: 'Deal 75+ damage in one hit.', stat: 'bestHit', value: 75, tp: 10 },
  { id: 'm_crit_25', name: 'LUCKY STRIKE', desc: 'Land 25 critical hits.', stat: 'crits', value: 25, tp: 5 },
  { id: 'm_combo_3', name: 'PINBALL WIZARD', desc: 'Hit 3 enemies with a single shot.', stat: 'maxCombo', value: 3, tp: 6 },
  { id: 'm_trick_10', name: 'SHOWBOAT', desc: 'Pull off 10 trick shots.', stat: 'trickShots', value: 10, tp: 4 },
  { id: 'm_trick_100', name: 'TRICK MASTER', desc: 'Pull off 100 trick shots.', stat: 'trickShots', value: 100, tp: 12 },

  // Runs
  { id: 'm_floor_3', name: 'DEEP STRIKE', desc: 'Reach floor 3.', stat: 'bestFloor', value: 3, tp: 3 },
  { id: 'm_floor_5', name: 'FINAL APPROACH', desc: 'Reach floor 5.', stat: 'bestFloor', value: 5, tp: 6 },
  { id: 'm_win', name: 'OPERATION COMPLETE', desc: 'Win a run.', stat: 'wins', value: 1, tp: 10 },
  { id: 'm_win_5', name: 'DECORATED', desc: 'Win 5 runs.', stat: 'wins', value: 5, tp: 20 },
  { id: 'm_risk_3', name: 'RISK TAKER', desc: 'Win a run on Risk 3 or higher.', stat: 'bestRiskWin', value: 3, tp: 15 },
  { id: 'm_relics_8', name: 'HOARDER', desc: 'Hold 8 relics in one run.', stat: 'maxRelics', value: 8, tp: 6 },
  { id: 'm_runs_25', name: 'VETERAN OPERATOR', desc: 'Play 25 runs.', stat: 'runs', value: 25, tp: 10 },
  {
    id: 'm_all_classes',
    name: 'ALL-ROUNDER',
    desc: 'Win a run with every class.',
    tp: 30,
    custom: (save) => {
      const done = BALLS.filter((b) => save.getBallStats(b.id).wins > 0).length;
      return [done, BALLS.length];
    },
  },
  { id: 'm_streak_7', name: 'ON DUTY', desc: 'Claim the daily supply drop 7 days in a row.', stat: 'bestStreak', value: 7, tp: 10 },
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
    if (cur >= max && save.awardMedal(medal.id, medal.tp)) earned.push(medal);
  }
  return earned;
}
