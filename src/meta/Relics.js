// ============================================================
// Relics — run-scoped collectibles (bought in shops, dropped by
// elites / mini-bosses, found in encounters and drills).
//
// Every relic here is implemented. Passive stat bonuses are data
// (`stats`, summed by relicStats()); behaviour hooks live where
// they trigger and check `relics.includes(id)`:
//   CollisionSystem  – on-hit damage modifiers & status effects
//   Game             – battle start / turn end / kill / bounce hooks
//   main.js          – gold, rest, encounter and reward hooks
//
// stats keys: atkPct, def, defPct, maxHp, dmgRed, dmgTaken,
//             powerPct, abilityCd
// ============================================================

export const RARITY = {
  common: { label: 'COMMON', color: '#94b0c2', cost: 22, weight: 60 },
  rare: { label: 'RARE', color: '#41a6f6', cost: 32, weight: 30 },
  epic: { label: 'EPIC', color: '#c46fd6', cost: 45, weight: 10 },
};

export const RELICS = [
  // --- Offense ---
  { id: 'rel_echo', name: 'Echo Core', rarity: 'common', icon: '[!]', desc: 'First hit each battle: +15 damage.' },
  { id: 'rel_knight_lance', name: "Paladin's Lance", rarity: 'common', icon: '[/]', desc: 'First hit each battle: +35% damage.' },
  { id: 'rel_gladiator_glove', name: 'Gladiator Glove', rarity: 'common', icon: '[x]', desc: '+25% damage to enemies above 75% HP.' },
  { id: 'rel_waraxe', name: 'Vanguard Waraxe', rarity: 'common', icon: '[x]', desc: '+15% ATK.', stats: { atkPct: 0.15 } },
  { id: 'rel_blood_sample', name: 'Last Stand', rarity: 'rare', icon: '(o)', desc: '+25% damage while below 50% HP.' },
  { id: 'rel_combat_drug', name: 'Berserk Serum', rarity: 'rare', icon: '(o)', desc: '+50% damage while below 30% HP.' },
  { id: 'rel_radiant_crest', name: 'Ricochet Crest', rarity: 'rare', icon: '[*]', desc: 'After a wall bounce, your next hit deals +35% damage.' },
  { id: 'rel_vector_engine', name: 'Full Draw', rarity: 'rare', icon: '[>]', desc: 'Shots fired at 90%+ power deal +25% damage.' },
  { id: 'rel_bear_claw', name: 'Grizzly Claw', rarity: 'rare', icon: '[m]', desc: '+35% ATK, but take 10% more damage.', stats: { atkPct: 0.35, dmgTaken: 0.1 } },
  { id: 'rel_pyro', name: 'Thermal Engine', rarity: 'rare', icon: '(^)', desc: 'Hits burn enemies: 6 damage per turn for 3 turns.' },
  { id: 'rel_artillery_shell', name: 'HE Shell', rarity: 'rare', icon: '(o)', desc: 'Hits deal 10 splash damage to other nearby enemies.' },
  { id: 'rel_graviton', name: 'Singularity Core', rarity: 'rare', icon: '(@)', desc: 'Hits pull nearby enemies toward the target.' },
  { id: 'rel_energy_well', name: 'Energy Well', rarity: 'epic', icon: '[!]', desc: 'Empowers your class skill: Overdrive 2x, Slam 18 dmg, Railgun +50%, Shrapnel 5 bursts, Zero-G 1.2s.' },
  { id: 'rel_syndicate_blade', name: 'Shadow Stiletto', rarity: 'epic', icon: '[/]', desc: 'Hits that leave a non-boss enemy below 15% HP defeat it.' },
  { id: 'rel_chain_lightning', name: 'Chain Reactor', rarity: 'epic', icon: '[Z]', desc: 'Defeating an enemy zaps all other enemies for 25 damage.' },
  { id: 'rel_cluster', name: 'Cluster Splitter', rarity: 'epic', icon: '[::]', desc: 'Your first wall bounce each turn splits your shot into fragments.' },

  // --- Defense ---
  { id: 'rel_titan_plate', name: 'Titanium Plating', rarity: 'common', icon: '[#]', desc: '+4 DEF.', stats: { def: 4 } },
  { id: 'rel_plating', name: 'Reactive Plating', rarity: 'common', icon: '[#]', desc: '+2 DEF, +10% launch power.', stats: { def: 2, powerPct: 0.1 } },
  { id: 'rel_heavy_armor', name: 'Heavy Plating', rarity: 'common', icon: '[#]', desc: '+7 DEF, but -5% launch power.', stats: { def: 7, powerPct: -0.05 } },
  { id: 'rel_cryo', name: 'Cryo Coil', rarity: 'common', icon: '[*]', desc: "Hits freeze enemies: their next shot is 35% slower." },
  { id: 'rel_graviton_lens', name: 'Graviton Lens', rarity: 'common', icon: '[o]', desc: 'Your barriers have double HP.' },
  { id: 'rel_bulwark_core', name: 'Bulwark Core', rarity: 'rare', icon: '[%]', desc: '+25% DEF.', stats: { defPct: 0.25 } },
  { id: 'rel_calcifying_gel', name: 'Calcifying Gel', rarity: 'rare', icon: '(o)', desc: '+3 DEF, take 10% less damage.', stats: { def: 3, dmgRed: 0.1 } },
  { id: 'rel_kinetic_absorber', name: 'Kinetic Absorber', rarity: 'rare', icon: '[-]', desc: 'Take 15% less damage.', stats: { dmgRed: 0.15 } },
  { id: 'rel_thorns', name: 'Thorns Sigil', rarity: 'rare', icon: '[x]', desc: 'Reflect 25% of damage taken back at the attacker.' },
  { id: 'rel_shadow_cloak', name: 'Shadow Cloak', rarity: 'rare', icon: '[#]', desc: 'The first 2 hits you take each battle deal half damage.' },
  { id: 'rel_smoke_bomb', name: 'Smoke Canister', rarity: 'rare', icon: '[~]', desc: 'Enemy shots are much less accurate.' },
  { id: 'rel_silver_shield', name: 'Silver Shield', rarity: 'rare', icon: '[#]', desc: 'Start each battle with a barrier in front of you.' },
  { id: 'rel_stasis_field', name: 'Stasis Field', rarity: 'epic', icon: '[-]', desc: 'Take 25% less damage.', stats: { dmgRed: 0.25 } },

  // --- Sustain ---
  { id: 'rel_medic', name: 'Field Medkit', rarity: 'common', icon: '[+]', desc: 'Heal 6 HP at the end of each of your turns.' },
  { id: 'rel_iron_ration', name: 'Iron Ration', rarity: 'common', icon: '[=]', desc: '+30 max HP.', stats: { maxHp: 30 } },
  { id: 'rel_nanite', name: 'Nanite Injector', rarity: 'common', icon: '(s)', desc: 'Heal 15 HP at the start of each battle.' },
  { id: 'rel_family_feast', name: 'Family Feast', rarity: 'common', icon: '(o)', desc: 'Rest nodes also give +10 max HP.' },
  { id: 'rel_horn_of_war', name: 'Horn of Valor', rarity: 'rare', icon: '[>]', desc: 'Defeating an enemy heals 12 HP.' },
  { id: 'rel_commander_banner', name: "Commander's Banner", rarity: 'rare', icon: '[>]', desc: '+30 max HP, +10% ATK.', stats: { maxHp: 30, atkPct: 0.1 } },
  { id: 'rel_golden_apple', name: 'Golden Apple', rarity: 'epic', icon: '(o)', desc: 'Rest nodes heal you to full HP.' },

  // --- Economy & utility ---
  { id: 'rel_pawn_ticket', name: 'Pawn Ticket', rarity: 'common', icon: '[~]', desc: 'Gain 30 gold now.' },
  { id: 'rel_magnet', name: 'Gold Magnet', rarity: 'common', icon: '[U]', desc: '+6 gold after each battle won.' },
  { id: 'rel_scavenger_pack', name: 'Scavenger Pack', rarity: 'common', icon: '[=]', desc: 'Encounters give +10 gold.' },
  { id: 'rel_lucky_coin', name: 'Lucky Coin', rarity: 'rare', icon: '[$]', desc: '+25% gold from all sources.' },
  { id: 'rel_blackmarket_pass', name: 'Black-Market Pass', rarity: 'rare', icon: '[=]', desc: 'Shop prices -20%.' },
  { id: 'rel_jade_pendant', name: 'Jade Pendant', rarity: 'rare', icon: '(o)', desc: '+1 Tech Point for each elite or boss defeated.' },
  { id: 'rel_overcharge', name: 'Overcharge Cell', rarity: 'epic', icon: '[=]', desc: 'Skill and barrier cooldowns are 1 turn shorter.', stats: { abilityCd: 1 } },
  { id: 'rel_apex_catalyst', name: 'Apex Catalyst', rarity: 'epic', icon: '<*>', desc: '+25% ATK, +40 max HP, +3 DEF.', stats: { atkPct: 0.25, maxHp: 40, def: 3 } },
].map((r) => ({ ...r, cost: RARITY[r.rarity].cost, category: RARITY[r.rarity].label }));

export const getRelic = (id) => RELICS.find((r) => r.id === id);

/** Sum the passive stat bonuses of the given relic ids. */
export function relicStats(ids = []) {
  const total = { atkPct: 0, def: 0, defPct: 0, maxHp: 0, dmgRed: 0, dmgTaken: 0, powerPct: 0, abilityCd: 0 };
  for (const id of ids) {
    const stats = getRelic(id)?.stats;
    if (!stats) continue;
    for (const [k, v] of Object.entries(stats)) total[k] += v;
  }
  return total;
}

/**
 * Pick `count` distinct relics not in `exclude`, weighted by rarity.
 * @param {() => number} rng
 */
export function pickRelics(count, exclude = [], rng = Math.random) {
  const pool = RELICS.filter((r) => !exclude.includes(r.id));
  const picked = [];
  while (picked.length < count && pool.length) {
    const total = pool.reduce((s, r) => s + RARITY[r.rarity].weight, 0);
    let roll = rng() * total;
    const idx = pool.findIndex((r) => (roll -= RARITY[r.rarity].weight) < 0);
    picked.push(pool.splice(idx === -1 ? 0 : idx, 1)[0]);
  }
  return picked;
}
