// ============================================================
// Raid — the weekly raid boss (CONFIG.raid).
//
// One giant mech a week (Monday 00:00 UTC to the next Monday), rolled from
// the week number: its damage type rotates Physical → Explosive → Electric,
// its resists are lopsided (one near max, one bare) and its reactor is
// huge, so overheating or draining it is possible but hard. Its HP pool
// carries over between attempts; your weekly damage is ranked against a
// simulated field of players (the game is offline) into 5 reward tiers.
// Rewards: Keys, scrap and copies of the week's special effect (a cosmetic
// with its own slot on each garage mech).
// ============================================================

import { CONFIG } from '../config.js';
import { enemyMech, enemyRig, enemyTier, DTYPE_KEYS, DTYPES } from './Mech.js';

const WEEK_MS = 7 * 24 * 3600 * 1000;
const EPOCH = Date.UTC(1970, 0, 5); // a Monday

/** Week number (weeks since a Monday, UTC). */
export function weekIndex(date = new Date()) {
  return Math.floor((date.getTime() - EPOCH) / WEEK_MS);
}

/** When a week ends (ms since epoch). */
export function weekEnds(week) {
  return EPOCH + (week + 1) * WEEK_MS;
}

/** The boss's damage type: rotates every week. */
export function weekElement(week) {
  return DTYPE_KEYS[((week % 3) + 3) % 3];
}

// ---------- Special effects (cosmetic, one slot per garage mech) ----------

export const EFFECTS = {
  fx_glint: { id: 'fx_glint', name: 'STEEL GLINT', element: 'phys', color: '#f4f4f4', desc: 'Bright glints flash across your mech.' },
  fx_ember: { id: 'fx_ember', name: 'EMBER AURA', element: 'heat', color: '#ef7d57', desc: 'Embers drift up off your mech.' },
  fx_static: { id: 'fx_static', name: 'STATIC CROWN', element: 'energy', color: '#73eff7', desc: 'Sparks crackle around your mech.' },
};
export const effectFor = (element) => Object.values(EFFECTS).find((e) => e.element === element);

// ---------- The boss ----------

function mulberry(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = {
  phys: [['IRON', 'GRANITE', 'BULWARK'], ['COLOSSUS', 'BEHEMOTH', 'JUGGERNAUT']],
  heat: [['MAGMA', 'CINDER', 'SOLAR'], ['TITAN', 'FORGE', 'INFERNO']],
  energy: [['STORM', 'VOLT', 'ION'], ['LEVIATHAN', 'TYRANT', 'SERAPH']],
};
const LOOK = {
  phys: { color: '#94b0c2', darkColor: '#333c57' },
  heat: { color: '#ef7d57', darkColor: '#b13e53' },
  energy: { color: '#41a6f6', darkColor: '#29366f' },
};

/**
 * The week's boss as a battle enemy (the shape main.js startCombat builds),
 * plus `week`, `element`, `effect` and a short `desc`. Same week, same boss.
 */
export function raidBoss(week) {
  const R = CONFIG.raid;
  const rnd = mulberry(week * 7919 + 17);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const element = weekElement(week);
  const tier = enemyTier('boss', 5);
  const mech = enemyMech('boss', 'boss', 5, rnd, { atkMult: R.atk, boss: true, element });

  // Lopsided resists: one type near the cap, one bare, one in between
  // (Fisher-Yates: a random sort comparator would roll differently per JS engine)
  const order = [...DTYPE_KEYS];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const res = { [order[0]]: 12, [order[1]]: 5, [order[2]]: 0 };

  // A huge reactor: overheating or draining it takes a dedicated team
  const rig = enemyRig('boss', { element });
  const H = R.rigMult.heat;
  const E = R.rigMult.energy;
  Object.assign(rig, { heatCap: rig.heatCap * H, cool: rig.cool * H, energy: rig.energy * E, regen: rig.regen * E });

  // One signature gun hits twice as hard
  const sig = Math.floor(rnd() * mech.weapons.length);
  // A giant reaches further: +reach on every gun, so it can't be kited forever
  const weapons = mech.weapons.map((w, i) => ({
    ...w,
    reach: [w.reach[0], Math.min(CONFIG.lane.size - 1, w.reach[1] + R.reach)],
    ...(i === sig ? { dmg: w.dmg * 2, signature: true } : {}),
  }));

  return {
    week,
    element,
    effect: effectFor(element),
    strong: order[0],
    weak: order[2],
    signature: weapons[sig]?.name,
    desc: `${DTYPES[element].name} guns, ${DTYPES[order[0]].name} armor, bare against ${DTYPES[order[2]].name}. Its reactor barely heats or drains.`,
    maxHp: R.pool,
    atk: Math.round(tier.atk * R.atk * 100) / 100,
    def: tier.def,
    displayName: `${pick(NAMES[element][0])} ${pick(NAMES[element][1])}`,
    rank: 'boss',
    archetype: 'standard',
    ...LOOK[element],
    giant: true,
    aiDifficulty: 0.9,
    thinkDelay: CONFIG.ai.thinkDelay,
    weapons,
    rig,
    element,
    legs: mech.legs,
    res,
    parts: mech.parts,
    specials: mech.specials,
    drones: mech.drones,
    startForcefield: false,
  };
}

// ---------- Ranking ----------

/**
 * Your rank in the simulated field, as "top X%" (0.1 best .. 100), from your
 * weekly damage. A smooth curve (log scale) through CONFIG.raid.field points.
 */
export function fieldTop(damage, pool = CONFIG.raid.pool) {
  const f = damage / pool;
  if (!(f > 0)) return 100;
  const pts = CONFIG.raid.field; // [top %, pool fraction], best first
  if (f >= pts[0][1]) return Math.max(0.1, pts[0][0] * (pts[0][1] / f));
  for (let i = 0; i < pts.length - 1; i++) {
    const [t0, f0] = pts[i];
    const [t1, f1] = pts[i + 1];
    if (f <= f0 && f >= f1) {
      if (f1 <= 0) return t0 + (t1 - t0) * (1 - f / f0); // last stretch: linear down to nothing
      const k = Math.log(f0 / f) / Math.log(f0 / f1);
      return Math.exp(Math.log(t0) + k * (Math.log(t1) - Math.log(t0)));
    }
  }
  return 100;
}

/** Reward tier for a rank: { tier: 1..5, keys, scrap, effects } (tier 1 is the best). */
export function raidTier(top) {
  const tiers = CONFIG.raid.tiers;
  const i = Math.max(0, tiers.findIndex((t) => top <= t.top));
  return { tier: i + 1, ...tiers[i] };
}
