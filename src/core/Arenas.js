// ============================================================
// Arenas — hazard layouts on the battle lane (positions 1..12, you start
// on 2, the enemy on 11). Each floor has a pool; every battle picks one.
// There are no walls: the lane is always open.
//
//   spikes – positions that hurt whoever walks or lands on them (8 damage)
//   mines  – positions with a mine that hurts anyone (its first visitor)
// ============================================================

const OPEN = { name: 'OPEN FIELD', desc: 'Nothing in the way.' };
const SPIKE_PIT = { name: 'SPIKE PIT', desc: 'Spikes on 6 and 7.', spikes: [6, 7] };
const MINE_FIELD = { name: 'MINE FIELD', desc: 'Mines on 5 and 8 hurt anyone.', mines: [5, 8] };
const TRENCH = { name: 'TRENCH', desc: 'Spikes on 5 and 8.', spikes: [5, 8] };
const GAUNTLET = { name: 'GAUNTLET', desc: 'Spikes on 4 and 9, a mine on 6.', spikes: [4, 9], mines: [6] };
const MINE_ROW = { name: 'MINE ROW', desc: 'Mines on 4, 6 and 9.', mines: [4, 6, 9] };

export const ARENAS = {
  1: [OPEN, OPEN, SPIKE_PIT],
  2: [OPEN, SPIKE_PIT, MINE_FIELD],
  3: [OPEN, SPIKE_PIT, MINE_FIELD, TRENCH],
  4: [SPIKE_PIT, MINE_FIELD, TRENCH, GAUNTLET, MINE_ROW],
  5: [MINE_FIELD, TRENCH, GAUNTLET, MINE_ROW],
};

/** A fresh copy of a random arena for a floor. */
export function pickArena(floor, rng = Math.random) {
  const pool = ARENAS[Math.min(5, Math.max(1, floor))] || ARENAS[1];
  const src = pool[Math.floor(rng() * pool.length)];
  return {
    name: src.name,
    desc: src.desc,
    spikes: [...(src.spikes || [])],
    mines: [...(src.mines || [])],
  };
}
