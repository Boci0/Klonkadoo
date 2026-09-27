// ============================================================
// Arenas — cover layouts on the battle lane (positions 1..12, you start
// on 2, the enemy on 11). Each floor has a pool; every battle picks one.
//
//   walls  – { at, hp, tall? }: a wall standing between position `at` and
//            `at + 1`. Direct fire into it hits the wall; lobbed shots and
//            jumps go over; walking can't pass until it breaks. Tall walls
//            only look taller (jumps still clear them) and have more HP.
//   spikes – positions that hurt whoever walks or lands on them (8 damage)
//   mines  – positions with a mine that hurts anyone (its first visitor)
// ============================================================

const OPEN = { name: 'OPEN FIELD', desc: 'Nothing in the way.' };
const LOW_WALL = { name: 'LOW WALL', desc: 'A breakable wall in the middle.', walls: [{ at: 6, hp: 60 }] };
const SPIKE_PIT = { name: 'SPIKE PIT', desc: 'Spikes on 6 and 7.', spikes: [6, 7] };
const BUNKER = { name: 'BUNKER LINE', desc: 'Two walls: dig in behind yours.', walls: [{ at: 4, hp: 70 }, { at: 8, hp: 70 }] };
const MINE_FIELD = { name: 'MINE FIELD', desc: 'Mines on 5 and 8 hurt anyone.', mines: [5, 8] };
const CITADEL = { name: 'CITADEL', desc: 'A tall wall: jump it or lob over it.', walls: [{ at: 6, hp: 160, tall: true }] };
const TRENCH = { name: 'TRENCH', desc: 'Walls and spikes between you.', walls: [{ at: 5, hp: 70 }], spikes: [8] };
const GAUNTLET = { name: 'GAUNTLET', desc: 'Two walls and a mine.', walls: [{ at: 4, hp: 90 }, { at: 8, hp: 90 }], mines: [6] };

export const ARENAS = {
  1: [OPEN, OPEN, LOW_WALL, SPIKE_PIT],
  2: [OPEN, LOW_WALL, BUNKER, MINE_FIELD, SPIKE_PIT],
  3: [OPEN, LOW_WALL, BUNKER, MINE_FIELD, CITADEL, TRENCH],
  4: [LOW_WALL, BUNKER, MINE_FIELD, CITADEL, TRENCH, GAUNTLET],
  5: [BUNKER, MINE_FIELD, CITADEL, TRENCH, GAUNTLET],
};

/** A fresh copy of a random arena for a floor. */
export function pickArena(floor, rng = Math.random) {
  const pool = ARENAS[Math.min(5, Math.max(1, floor))] || ARENAS[1];
  const src = pool[Math.floor(rng() * pool.length)];
  return {
    name: src.name,
    desc: src.desc,
    walls: (src.walls || []).map((w) => ({ ...w })),
    spikes: [...(src.spikes || [])],
    mines: [...(src.mines || [])],
  };
}
