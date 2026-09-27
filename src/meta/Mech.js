// ============================================================
// Rig — the gear your mech carries into a run.
//
// Slots: Frame, Legs, 4 SIDE guns, 2 TOP guns (heavy / lobbed), Drone,
// the three specials (CHARGE, TELEPORT, HOOK) and 8 modules. Every part
// weighs something (kg) and every mech has the same load cap
// (CONFIG.gear.loadCap): a few kg over costs HP, more than that and you
// can't deploy. The Frame is the main HP and the reactor; Legs add HP,
// decide how you MOVE (walk / jump / anchored) and STOMP with their own
// damage type. Modules are where resists come from.
//
// Parts come from supply pods opened with Keys earned in runs (never real
// money; odds are shown). (Code and save data still use the old names:
// mech, crate, tokens.) Duplicates salvage into scrap, scrap levels parts
// up, and a part at its tier's max level TRANSFORMS into the next tier by
// melting down a few other parts of its tier (CONFIG.gear.transform).
//
// In battle you fire each gun yourself (one action per shot) at a target
// inside its range band; every shot costs energy and adds heat, the
// strongest guns carry limited ammo, some hurt you too (backfire).
// Drones, once deployed, act at the end of every turn at any range.
// Enemies are built from these same parts and obey the same rules.
//
// Every gun deals one damage type: Physical, Explosive (heat) or Electric
// (energy) (DTYPES). Resists are per type; DEF resists all three.
// ============================================================

import { CONFIG } from '../config.js';

export const SLOTS = [
  { id: 'frame', type: 'frame', name: 'FRAME' },
  { id: 'legs', type: 'legs', name: 'LEGS' },
  { id: 'side1', type: 'weapon', mount: 'side', name: 'SIDE 1' },
  { id: 'side2', type: 'weapon', mount: 'side', name: 'SIDE 2' },
  { id: 'side3', type: 'weapon', mount: 'side', name: 'SIDE 3' },
  { id: 'side4', type: 'weapon', mount: 'side', name: 'SIDE 4' },
  { id: 'top1', type: 'weapon', mount: 'top', name: 'TOP 1' },
  { id: 'top2', type: 'weapon', mount: 'top', name: 'TOP 2' },
  { id: 'drone', type: 'drone', name: 'DRONE' },
  { id: 'charge', type: 'special', kind: 'charge', name: 'CHARGE' },
  { id: 'teleport', type: 'special', kind: 'teleport', name: 'TELEPORT' },
  { id: 'hook', type: 'special', kind: 'hook', name: 'HOOK' },
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ id: `module${i}`, type: 'module', name: `MOD ${i}` })),
];

export const RARITIES = {
  common: { name: 'COMMON', color: '#94b0c2', scrap: 3, cost: 1 },
  rare: { name: 'RARE', color: '#41a6f6', scrap: 8, cost: 1.5 },
  epic: { name: 'EPIC', color: '#c46fd6', scrap: 20, cost: 2 },
  legendary: { name: 'LEGENDARY', color: '#ffcd75', scrap: 50, cost: 3 },
  mythic: { name: 'MYTHIC', color: '#ff5d73', scrap: 120, cost: 4 },
};
export const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary', 'mythic'];
const rIdx = (r) => Math.max(0, RARITY_ORDER.indexOf(r));

/** Damage types. Explosive also heats the target, Electric drains it (Game._reactorFx). */
export const DTYPES = {
  phys: { name: 'PHYSICAL', short: 'PHY', color: '#f4f4f4', icon: 'dmg' },
  heat: { name: 'EXPLOSIVE', short: 'EXP', color: '#ef7d57', icon: 'heat' },
  energy: { name: 'ELECTRIC', short: 'ELEC', color: '#73eff7', icon: 'energy' },
};
export const DTYPE_KEYS = Object.keys(DTYPES);
export const dtypeOf = (w) => (DTYPES[w?.dtype] ? w.dtype : 'phys');
/** A ball's resistance to one damage type, in DEF points. */
export const resistOf = (ball, type) => (ball.def || 0) + (ball.res?.[type] || 0);

// ---------- Catalog ----------
// Weight in kg (CONFIG.gear.loadCap for the whole mech).
// Weapons: mount side / top, reach [min, max] in lane positions (1 = the next position),
// dmg = average per shot (hits roll ±CONFIG.gear.dmgSpread), en / heat per shot,
// ammo = shots per battle, arc = lobbed (over cover), backfire = HP it costs YOU per shot.
// fx: burn / freeze / corrode / splash / line (beam) / pierce (ignores resists) / crit
//     burst (hits N times) / drain (burns target energy) / heat (adds target heat) / push / pull
//     resDrain { type: n } (strips that resist for the fight) / mine (plants a mine instead)
// Frames and some modules set the reactor: energy (pool), regen (per turn), heatCap, cool (per turn).
// `unique` modules fit once per mech. `tiers` [lowest, highest] defaults to [rarity, rarity + 3].
export const PARTS = [
  // Frames: the main HP and the reactor
  { id: 'fr_scout', type: 'frame', name: 'SCOUT FRAME', rarity: 'common', weight: 170, hp: 20, energy: 30, regen: 14, heatCap: 30, cool: 12 },
  { id: 'fr_brawler', type: 'frame', name: 'BRAWLER FRAME', rarity: 'rare', weight: 200, hp: 35, energy: 32, regen: 14, heatCap: 40, cool: 13 },
  { id: 'fr_phantom', type: 'frame', name: 'PHANTOM FRAME', rarity: 'epic', weight: 185, hp: 28, freeFirstShot: true, desc: 'The first gun you fire each battle costs no energy.', energy: 40, regen: 19, heatCap: 34, cool: 14 },
  { id: 'fr_titan', type: 'frame', name: 'TITAN FRAME', rarity: 'epic', weight: 230, hp: 50, energy: 34, regen: 15, heatCap: 50, cool: 15 },
  { id: 'fr_colossus', type: 'frame', name: 'COLOSSUS FRAME', rarity: 'legendary', weight: 250, hp: 62, energy: 44, regen: 19, heatCap: 56, cool: 17 },
  { id: 'fr_leviathan', type: 'frame', name: 'LEVIATHAN FRAME', rarity: 'mythic', weight: 260, hp: 72, energy: 50, regen: 21, heatCap: 62, cool: 19, color: '#ff5d73' },

  // Legs decide how you move on the lane and how you STOMP (range 1, knocks back 1):
  // walk = up to N positions along the ground (not through mechs);
  // jump = [min, max] positions, landing exactly there, over mechs and hazards;
  // stompType = the stomp's damage type, stompEn / stompHeat = what it costs you;
  // anchored = can't move at all; moveEn = energy per move; freeMove = first move each turn uses no action
  { id: 'lg_strider', type: 'legs', name: 'STRIDER LEGS', rarity: 'common', weight: 120, hp: 8, walk: 2, stomp: 10, desc: 'The all-rounder.' },
  { id: 'lg_hopper', type: 'legs', name: 'HOPPER LEGS', rarity: 'common', weight: 100, hp: 5, walk: 1, jump: [1, 2], stomp: 8, desc: 'Light, short precise hops.' },
  { id: 'lg_treads', type: 'legs', name: 'TANK TREADS', rarity: 'common', weight: 170, hp: 20, res: { phys: 1 }, walk: 3, stomp: 14, stompHeat: 5, desc: "Fast on the ground, but can't jump. Heavy and tough." },
  { id: 'lg_catapult', type: 'legs', name: 'CATAPULT LEGS', rarity: 'rare', weight: 125, hp: 8, walk: 0, jump: [3, 4], stomp: 12, stompHeat: 5, desc: 'Long leaps only: no small steps.' },
  { id: 'lg_jumpjets', type: 'legs', name: 'JUMP JETS', rarity: 'rare', weight: 110, hp: 6, walk: 1, jump: [1, 4], stomp: 10, stompType: 'heat', stompHeat: 6, desc: 'Long hops over mechs, spikes and mines. The stomp scorches (Explosive).' },
  { id: 'lg_coil', type: 'legs', name: 'COIL SPRINGS', rarity: 'epic', weight: 115, hp: 8, walk: 2, jump: [1, 2], stomp: 10, stompType: 'energy', stompEn: 6, stompHeat: 2, desc: 'Walk or hop. The stomp shocks (Electric).' },
  { id: 'lg_anchor', type: 'legs', name: 'ANCHOR CLAMPS', rarity: 'epic', weight: 200, hp: 30, def: 4, atkPct: 0.2, anchored: true, desc: "Bolted down: you can't move or stomp. +4 DEF, +20% gun damage." },
  { id: 'lg_thrusters', type: 'legs', name: 'THRUSTERS', rarity: 'legendary', weight: 130, hp: 10, walk: 3, jump: [1, 3], stomp: 10, stompType: 'heat', stompHeat: 6, moveEn: 6, desc: 'Go anywhere, but each move costs 6 energy. The stomp scorches.' },
  { id: 'lg_phase', type: 'legs', name: 'PHASE STRIDERS', rarity: 'mythic', weight: 120, hp: 14, walk: 2, jump: [1, 3], stomp: 12, stompType: 'energy', stompEn: 6, stompHeat: 2, freeMove: true, color: '#ff5d73', desc: 'Your first move each turn uses no action. The stomp shocks.' },

  // SIDE guns
  { id: 'wp_blaster', type: 'weapon', name: 'PULSE BLASTER', rarity: 'common', dtype: 'phys', weight: 55, reach: [1, 4], dmg: 12, en: 6, heat: 9, color: '#73eff7' },
  { id: 'wp_scatter', type: 'weapon', name: 'SCATTERGUN', rarity: 'common', dtype: 'phys', weight: 65, reach: [1, 2], dmg: 15, en: 8, heat: 12, color: '#ffcd75' },
  { id: 'wp_acid', type: 'weapon', name: 'ACID SPRAYER', rarity: 'common', dtype: 'heat', weight: 55, reach: [1, 3], dmg: 9, en: 3, heat: 15, fx: { corrode: 1 }, color: '#a7f070', desc: 'Strips 1 PHY resist per hit.' },
  { id: 'wp_smg', type: 'weapon', name: 'AUTO SMG', rarity: 'common', dtype: 'phys', weight: 55, reach: [1, 3], dmg: 5, en: 8, heat: 12, fx: { burst: 3 }, color: '#f4f4f4', desc: 'Fires 3 rounds. Runs hot.' },
  { id: 'wp_repulsor', type: 'weapon', name: 'REPULSOR', rarity: 'common', dtype: 'phys', weight: 45, reach: [1, 2], dmg: 9, en: 7, heat: 10, fx: { push: 2 }, color: '#41a6f6', desc: 'Pushes the target back 2 positions.' },
  { id: 'wp_rifle', type: 'weapon', name: 'LONG RIFLE', rarity: 'rare', dtype: 'phys', weight: 80, reach: [4, 8], dmg: 15, en: 9, heat: 13, color: '#f4f4f4' },
  { id: 'wp_flamer', type: 'weapon', name: 'FLAMER', rarity: 'rare', dtype: 'heat', weight: 70, reach: [1, 2], dmg: 10, en: 4, heat: 18, fx: { burn: 2 }, color: '#ef7d57', desc: 'Burns for 2 turns.' },
  { id: 'wp_cryo', type: 'weapon', name: 'CRYO CANNON', rarity: 'rare', dtype: 'heat', weight: 80, reach: [2, 4], dmg: 11, en: 4, heat: 20, fx: { freeze: true }, color: '#73eff7', desc: 'Chills: their next move is 1 position shorter.' },
  { id: 'wp_beam', type: 'weapon', name: 'LASER BEAM', rarity: 'rare', dtype: 'energy', weight: 70, reach: [2, 5], dmg: 13, en: 15, heat: 3, fx: { line: true }, color: '#ff5d73', desc: 'A steady mid-range beam.' },
  { id: 'wp_emp', type: 'weapon', name: 'EMP BURST', rarity: 'rare', dtype: 'energy', weight: 65, reach: [1, 3], dmg: 8, en: 18, heat: 4, fx: { drain: 14 }, color: '#c46fd6', desc: 'Drains 14 of their energy.' },
  { id: 'wp_grapple', type: 'weapon', name: 'GRAPPLE HOOK', rarity: 'rare', dtype: 'phys', weight: 55, reach: [3, 6], dmg: 9, en: 7, heat: 10, fx: { pull: 2, drag: 1 }, color: '#94b0c2', desc: 'Pulls the target 2 toward you, but the cable drags you 1 toward it too.' },
  { id: 'wp_shredder', type: 'weapon', name: 'SHRED CANNON', rarity: 'rare', dtype: 'phys', weight: 70, reach: [1, 4], dmg: 11, en: 7, heat: 10, fx: { resDrain: { phys: 2 } }, color: '#94b0c2', desc: 'Strips 2 PHY resist per hit, for the rest of the fight.' },
  { id: 'wp_tesla', type: 'weapon', name: 'TESLA COIL', rarity: 'epic', dtype: 'energy', weight: 90, reach: [1, 2], dmg: 16, en: 19, heat: 4, fx: { line: true }, color: '#c46fd6', desc: 'A short-range electric arc.' },
  { id: 'wp_heatray', type: 'weapon', name: 'HEAT RAY', rarity: 'epic', dtype: 'heat', weight: 80, reach: [2, 4], dmg: 11, en: 5, heat: 22, fx: { heat: 16 }, color: '#ef7d57', desc: 'Pumps 16 heat into the target.' },
  { id: 'wp_scorcher', type: 'weapon', name: 'SCORCH CANNON', rarity: 'epic', dtype: 'heat', weight: 80, reach: [2, 5], dmg: 11, en: 5, heat: 18, fx: { resDrain: { heat: 2 } }, color: '#ffcd75', desc: 'Strips 2 EXP resist per hit, for the rest of the fight.' },
  { id: 'wp_ionizer', type: 'weapon', name: 'ION PROJECTOR', rarity: 'epic', dtype: 'energy', weight: 80, reach: [2, 5], dmg: 11, en: 16, heat: 4, fx: { resDrain: { energy: 2 } }, color: '#73eff7', desc: 'Strips 2 ELEC resist per hit, for the rest of the fight.' },
  { id: 'wp_impact', type: 'weapon', name: 'IMPACT CANNON', rarity: 'epic', dtype: 'phys', weight: 110, reach: [3, 7], dmg: 12, en: 9, heat: 14, fx: { push: 3 }, color: '#f4f4f4', desc: 'A slug that knocks the target back 3 (into the edge: it slams).' },
  { id: 'wp_scythe', type: 'weapon', name: 'PLASMA SCYTHE', rarity: 'legendary', dtype: 'energy', weight: 110, reach: [1, 1], dmg: 24, en: 28, heat: 6, backfire: 4, color: '#c46fd6', desc: 'A brutal energy blade: huge damage, right next to the enemy only.' },
  // Explosive specialists: cook the target until it locks up, then cash the heat in
  { id: 'wp_blowtorch', type: 'weapon', name: 'BLOWTORCH', rarity: 'common', dtype: 'heat', weight: 45, reach: [1, 2], dmg: 5, en: 4, heat: 16, fx: { heat: 18 }, color: '#ef7d57', desc: 'Weak hit, but pumps 18 heat into the target.' },
  { id: 'wp_rupturer', type: 'weapon', name: 'COOLANT RUPTURER', rarity: 'epic', dtype: 'heat', weight: 70, reach: [2, 4], dmg: 10, en: 4, heat: 19, fx: { coolDmg: 3 }, color: '#ffcd75', desc: 'Cracks their coolant: -3 cooling for the rest of the fight (stacks, never below 2).' },
  { id: 'wp_thermal', type: 'weapon', name: 'THERMAL LANCE', rarity: 'epic', dtype: 'heat', weight: 90, reach: [2, 6], dmg: 14, en: 5, heat: 21, fx: { line: true, hotBonus: true }, color: '#ef7d57', desc: 'Double damage against a target above 75% of its heat cap.' },
  // Electric specialists: starve the target so it can't shoot
  { id: 'wp_spark', type: 'weapon', name: 'SPARK PISTOL', rarity: 'common', dtype: 'energy', weight: 35, reach: [1, 3], dmg: 5, en: 14, heat: 3, fx: { drain: 14 }, color: '#73eff7', desc: 'Weak hit, but drains 14 energy.' },
  { id: 'wp_leech', type: 'weapon', name: 'LEECH COIL', rarity: 'rare', dtype: 'energy', weight: 65, reach: [1, 3], dmg: 7, en: 20, heat: 4, fx: { drain: 12, steal: true }, color: '#a7f070', desc: 'Drains 12 energy and gives it to you (energy only, never HP).' },
  { id: 'wp_gridbreaker', type: 'weapon', name: 'GRID BREAKER', rarity: 'epic', dtype: 'energy', weight: 80, reach: [2, 5], dmg: 10, en: 19, heat: 4, fx: { regenDmg: 4 }, color: '#41a6f6', desc: 'Breaks their generator: -4 regen for the rest of the fight (stacks, never below 3).' },
  { id: 'wp_capdump', type: 'weapon', name: 'CAPACITOR DUMP', rarity: 'epic', dtype: 'energy', weight: 70, reach: [1, 4], dmg: 8, en: 13, heat: 3, fx: { dump: true }, color: '#c46fd6', desc: 'Spends ALL your remaining energy: +1 damage for every 2 energy spent.' },

  // TOP guns: the heavy and lobbed ones
  { id: 'wp_mortar', type: 'weapon', mount: 'top', name: 'MORTAR', rarity: 'rare', dtype: 'phys', weight: 100, reach: [4, 9], dmg: 14, en: 11, heat: 16, arc: true, fx: { splash: 1 }, color: '#ef7d57', desc: 'A lobbed shell that splashes.' },
  { id: 'wp_minelauncher', type: 'weapon', mount: 'top', name: 'MINE LAUNCHER', rarity: 'rare', dtype: 'phys', weight: 70, reach: [2, 6], dmg: 17, en: 6, heat: 9, ammo: 3, arc: true, fx: { mine: true }, color: '#ef7d57', desc: 'Plants a mine next to the target: it blasts whoever steps there. 3 mines.' },
  { id: 'wp_rocket', type: 'weapon', mount: 'top', name: 'ROCKET LAUNCHER', rarity: 'rare', dtype: 'phys', weight: 90, reach: [3, 7], dmg: 19, en: 8, heat: 13, ammo: 2, arc: true, fx: { splash: 1 }, color: '#ffcd75', desc: 'Lobbed. 2 rockets per battle.' },
  { id: 'wp_concussion', type: 'weapon', mount: 'top', name: 'CONCUSSION MORTAR', rarity: 'rare', dtype: 'phys', weight: 90, reach: [4, 8], dmg: 9, en: 8, heat: 12, arc: true, fx: { push: 2 }, color: '#94b0c2', desc: 'A lobbed blast that knocks the target back 2 (into the edge: it slams).' },
  { id: 'wp_napalm', type: 'weapon', mount: 'top', name: 'NAPALM LAUNCHER', rarity: 'rare', dtype: 'heat', weight: 80, reach: [3, 6], dmg: 8, en: 5, heat: 22, arc: true, fx: { heat: 12, napalm: 2 }, color: '#ff5d73', desc: "+12 heat, and sets the target's plate on fire for 2 turns: +8 heat to whoever stands or lands there." },
  { id: 'wp_missiles', type: 'weapon', mount: 'top', name: 'MISSILE POD', rarity: 'epic', dtype: 'phys', weight: 110, reach: [3, 6], dmg: 16, en: 6, heat: 9, ammo: 3, arc: true, color: '#ff5d73', desc: 'A mid-range salvo. 3 salvos.' },
  { id: 'wp_rail', type: 'weapon', mount: 'top', name: 'RAIL LANCE', rarity: 'epic', dtype: 'energy', weight: 115, reach: [5, 8], dmg: 20, en: 28, heat: 7, backfire: 3, fx: { pierce: true }, color: '#41a6f6', desc: 'Ignores resists.' },
  { id: 'wp_howitzer', type: 'weapon', mount: 'top', name: 'SIEGE HOWITZER', rarity: 'legendary', dtype: 'phys', weight: 155, reach: [6, 9], dmg: 24, en: 12, heat: 18, ammo: 2, backfire: 5, arc: true, fx: { splash: 1 }, color: '#ffcd75', desc: 'Lobbed. 2 shells per battle.' },
  { id: 'wp_sniper', type: 'weapon', mount: 'top', name: 'SNIPER CANNON', rarity: 'legendary', dtype: 'phys', weight: 115, reach: [7, 10], dmg: 23, en: 10, heat: 14, ammo: 3, color: '#f4f4f4', desc: 'Huge hit at long range. 3 shots.' },
  { id: 'wp_meltdown', type: 'weapon', mount: 'top', name: 'MELTDOWN CANNON', rarity: 'legendary', dtype: 'heat', weight: 115, reach: [3, 7], dmg: 12, en: 5, heat: 21, fx: { meltdown: true }, color: '#ffcd75', desc: 'Against an overheating target: its heat over the cap blasts out as 2x damage, and it drops back to its cap (so it keeps its turn).' },
  { id: 'wp_blackout', type: 'weapon', mount: 'top', name: 'BLACKOUT CANNON', rarity: 'legendary', dtype: 'energy', weight: 115, reach: [3, 7], dmg: 12, en: 28, heat: 7, fx: { drain: 20, jam: true }, color: '#29366f', desc: "Drains 20. If that leaves them at 0 energy, their guns jam next turn (they can still move, stomp and vent)." },
  { id: 'wp_nova', type: 'weapon', mount: 'top', name: 'NOVA LANCE', rarity: 'mythic', dtype: 'energy', weight: 135, reach: [3, 5], dmg: 24, en: 24, heat: 5, ammo: 2, backfire: 5, fx: { pierce: true }, color: '#ff5d73', desc: 'A mid-range lance that ignores resists. 2 shots.' },

  // Specials: one slot each (CHARGE / TELEPORT / HOOK), an action each, a few uses per battle
  { id: 'sp_charge', type: 'special', name: 'CHARGE BOOSTER', rarity: 'common', weight: 32, special: 'charge', dist: 4, ram: 10, uses: 2, en: 6, heat: 10, color: '#ffcd75', desc: 'Dash up to 4 toward the enemy. End next to it and you ram it: Physical damage and a knockback.' },
  { id: 'sp_ram', type: 'special', name: 'RAM BOOSTER', rarity: 'epic', weight: 48, special: 'charge', dist: 5, ram: 18, uses: 2, en: 8, heat: 14, color: '#ef7d57', desc: 'Dash up to 5 toward the enemy and ram it hard: Physical damage and a knockback.' },
  { id: 'sp_teleport', type: 'special', name: 'TELEPORTER', rarity: 'epic', weight: 40, special: 'teleport', uses: 1, en: 14, heat: 4, color: '#c46fd6', desc: 'Blink to any free position.' },
  { id: 'sp_blink', type: 'special', name: 'BLINK DRIVE', rarity: 'legendary', weight: 48, special: 'teleport', uses: 2, en: 16, heat: 4, color: '#73eff7', icon: 'sp_teleport', desc: 'Blink to any free position. 2 uses.' },
  { id: 'sp_hook', type: 'special', name: 'GRAPPLING HOOK', rarity: 'rare', weight: 32, special: 'hook', range: 6, uses: 2, en: 8, heat: 6, color: '#94b0c2', desc: 'Yanks the enemy right next to you from up to 6 away. No damage.' },
  { id: 'sp_winch', type: 'special', name: 'HARPOON WINCH', rarity: 'epic', weight: 40, special: 'hook', range: 8, uses: 2, en: 10, heat: 8, color: '#ffcd75', icon: 'sp_hook', desc: 'Yanks the enemy right next to you from up to 8 away. No damage.' },

  // Drones: act every turn, any range, once deployed
  { id: 'dr_gnat', type: 'drone', name: 'GNAT DRONE', rarity: 'common', dtype: 'phys', weight: 30, upkeep: { en: 3, heat: 1 }, dmg: 4, color: '#94b0c2' },
  { id: 'dr_hornet', type: 'drone', name: 'HORNET DRONE', rarity: 'rare', dtype: 'phys', weight: 45, upkeep: { en: 4, heat: 2 }, dmg: 5, color: '#ffcd75' },
  { id: 'dr_medic', type: 'drone', name: 'MEDIC DRONE', rarity: 'rare', weight: 40, upkeep: { en: 6, heat: 0 }, heal: 5, color: '#a7f070', desc: 'Repairs you every turn it is deployed (grows with its level only). It never attacks.' },
  { id: 'dr_guardian', type: 'drone', name: 'GUARDIAN DRONE', rarity: 'epic', weight: 50, upkeep: { en: 7, heat: 0 }, forcefieldEvery: 3, color: '#a7f070', desc: 'Forcefield every 3rd turn.' },
  { id: 'dr_reaper', type: 'drone', name: 'REAPER DRONE', rarity: 'legendary', dtype: 'energy', weight: 60, upkeep: { en: 6, heat: 2 }, dmg: 7, fx: { crit: 0.2 }, color: '#ffcd75', desc: '20% crit chance.' },
  { id: 'dr_seraph', type: 'drone', name: 'SERAPH DRONE', rarity: 'mythic', dtype: 'energy', weight: 65, upkeep: { en: 7, heat: 2 }, dmg: 8, fx: { crit: 0.25 }, color: '#ff5d73', desc: '25% crit chance.' },

  // Modules: stat modules stack; `unique` ones fit once per mech
  { id: 'md_plating', type: 'module', name: 'PLATING', rarity: 'common', weight: 20, hp: 10 },
  { id: 'md_physres', type: 'module', name: 'IMPACT DAMPER', rarity: 'common', weight: 16, res: { phys: 2 } },
  { id: 'md_heatres', type: 'module', name: 'BLAST LINER', rarity: 'common', weight: 16, res: { heat: 2 } },
  { id: 'md_elecres', type: 'module', name: 'GROUNDING MESH', rarity: 'common', weight: 16, res: { energy: 2 } },
  { id: 'md_battery', type: 'module', name: 'BATTERY PACK', rarity: 'common', weight: 20, energy: 14, desc: 'A bigger energy pool (grows with level).' },
  { id: 'md_coolant', type: 'module', name: 'COOLANT LOOP', rarity: 'common', weight: 20, cool: 6, desc: 'Cools more heat per turn (grows with level).' },
  { id: 'md_target', type: 'module', name: 'TARGETING CPU', rarity: 'common', weight: 16, crit: 0.03, unique: true },
  { id: 'md_servo', type: 'module', name: 'STOMP SERVO', rarity: 'common', weight: 16, stompPct: 0.5, unique: true, desc: '+50% STOMP damage.' },
  { id: 'md_bounty', type: 'module', name: 'BOUNTY CHIP', rarity: 'common', weight: 12, goldPct: 0.15, unique: true },
  { id: 'md_heavyplate', type: 'module', name: 'HEAVY PLATING', rarity: 'rare', weight: 28, hp: 16 },
  { id: 'md_composite', type: 'module', name: 'COMPOSITE PLATE', rarity: 'rare', weight: 24, hp: 8, res: { phys: 1.5, heat: 1.5 } },
  { id: 'md_thermal', type: 'module', name: 'THERMAL CORE', rarity: 'rare', weight: 22, heatCap: 8, cool: 4, desc: 'Heat cap and cooling (grows with level).' },
  { id: 'md_capacitor', type: 'module', name: 'CAPACITOR BANK', rarity: 'rare', weight: 22, energy: 8, regen: 4, desc: 'Energy and regen (grows with level).' },
  { id: 'md_heatsink', type: 'module', name: 'HEAT SINK', rarity: 'rare', weight: 20, heatCap: 14, desc: 'A higher heat cap (grows with level).' },
  { id: 'md_generator', type: 'module', name: 'POWER CORE', rarity: 'rare', weight: 24, regen: 6, desc: 'Refills more energy per turn (grows with level).' },
  { id: 'md_amp', type: 'module', name: 'DAMAGE AMP', rarity: 'rare', weight: 24, atkPct: 0.08, unique: true },
  { id: 'md_repair', type: 'module', name: 'NANO REPAIR', rarity: 'rare', weight: 24, healAfterWin: 0.05, unique: true, desc: 'Heal after every won battle.' },
  { id: 'md_aegis', type: 'module', name: 'AEGIS EMITTER', rarity: 'epic', weight: 24, res: { phys: 1, energy: 2 }, startForcefield: true, unique: true, desc: 'Start each battle with a Forcefield.' },
  { id: 'md_range', type: 'module', name: 'RANGE EXTENDER', rarity: 'epic', weight: 20, reachBonus: 1, unique: true, desc: '+1 max range on every gun.' },
  { id: 'md_titanplate', type: 'module', name: 'TITAN PLATE', rarity: 'legendary', weight: 30, hp: 22, res: { phys: 2, heat: 2 } },
  { id: 'md_overclock', type: 'module', name: 'OVERCLOCK CORE', rarity: 'legendary', weight: 32, atkPct: 0.1, weaponDmgPct: 0.12, unique: true },
  { id: 'md_voidcore', type: 'module', name: 'VOID CORE', rarity: 'mythic', weight: 30, hp: 24, res: { phys: 2, heat: 2, energy: 2 }, startForcefield: true, unique: true, color: '#ff5d73', desc: 'Start each battle with a Forcefield.' },
  { id: 'md_singularity', type: 'module', name: 'SINGULARITY CHIP', rarity: 'mythic', weight: 32, atkPct: 0.12, weaponDmgPct: 0.15, crit: 0.03, unique: true, color: '#ff5d73' },
];
for (const p of PARTS) if (p.type === 'weapon' && !p.mount) p.mount = 'side';

/** Retired parts (older saves): armor became modules, shields left the special slots. */
export const RETIRED = {
  ar_scrap: 'md_plating', ar_kevlar: 'md_physres', ar_reactive: 'md_composite',
  ar_aegis: 'md_aegis', ar_titanium: 'md_titanplate', ar_void: 'md_voidcore',
  sp_shield: null, sp_aegis: null,
};
/** What a retired part with no replacement pays back: Keys and scrap by its old rarity. */
export const RETIRED_REFUND = { sp_shield: { keys: 4, scrap: 16 }, sp_aegis: { keys: 12, scrap: 60 } };

const PART_BY_ID = Object.fromEntries(PARTS.map((p) => [p.id, p]));
export const getPart = (id) => PART_BY_ID[id];

export const STARTER_PARTS = ['fr_scout', 'lg_strider', 'wp_blaster', 'wp_scatter', 'dr_gnat', 'md_plating'];
export const STARTER_LOADOUT = { frame: 'fr_scout', legs: 'lg_strider', side1: 'wp_blaster', side2: 'wp_scatter', drone: 'dr_gnat', module1: 'md_plating' };
/** Positions on the battle lane (1..LANE_SIZE). */
export const LANE_SIZE = 12;

/** Can this part go in this slot? (type, gun mount, special kind) */
export function slotAccepts(slot, part) {
  if (!slot || !part || slot.type !== part.type) return false;
  if (slot.mount && (part.mount || 'side') !== slot.mount) return false;
  if (slot.kind && part.special !== slot.kind) return false;
  return true;
}

/** Movement with no legs fitted. */
export const DEFAULT_LEGS = { id: 'lg_strider', name: 'NO LEGS', walk: 2, jump: null, stomp: 6, stompType: 'phys', stompEn: 0, stompHeat: 4, anchored: false, moveEn: 0, freeMove: false };

/** The movement and stomp rules a battle needs from a legs part (level-scaled stomp included). */
export function legsRules(p) {
  if (!p) return { ...DEFAULT_LEGS };
  return {
    id: p.id, name: p.name, walk: p.walk || 0, jump: p.jump || null, stomp: Math.round(p.stomp || 0),
    stompType: DTYPES[p.stompType] ? p.stompType : 'phys', stompEn: p.stompEn || 0, stompHeat: p.stompHeat ?? CONFIG.gear.stompHeat,
    anchored: !!p.anchored, moveEn: p.moveEn || 0, freeMove: !!p.freeMove,
  };
}

export const INVENTORY_CAP = 80;

// ---------- Tiers and levels ----------

/** A part's lowest and highest tier. */
export function tierRange(p) {
  if (p.tiers) return p.tiers;
  const lo = rIdx(p.rarity);
  return [p.rarity, RARITY_ORDER[Math.min(RARITY_ORDER.length - 1, lo + 3)]];
}
/** The tier an owned part is at now. */
export const tierOf = (owned) => owned.tier || getPart(owned.id)?.rarity || 'common';
/** Max level at the owned part's tier. */
export const maxLevel = (owned) => CONFIG.gear.tierLevelCap[rIdx(tierOf(owned))];
/** Tier steps above the part's lowest tier, and progress to max level (0..1). */
function growth(owned) {
  const base = getPart(owned.id);
  const steps = rIdx(tierOf(owned)) - rIdx(base.rarity);
  const cap = maxLevel(owned);
  const within = cap > 1 ? (Math.min(cap, owned.level || 1) - 1) / (cap - 1) : 0;
  const G = CONFIG.gear;
  // Each tier is one step; max level adds most of one more, so a transform never loses stats
  return Math.pow(G.tierStep, steps) * (1 + (G.tierStep - 1) * within);
}

/** What transforming this part needs: { to, parts, scrap } or null at its highest tier. */
export function transformInfo(owned) {
  const base = getPart(owned.id);
  if (!base) return null;
  const t = rIdx(tierOf(owned));
  if (t >= rIdx(tierRange(base)[1])) return null;
  const T = CONFIG.gear.transform;
  return { to: RARITY_ORDER[t + 1], parts: T.parts[t], scrap: T.scrap[t] };
}

// Numeric fields that scale with tier and level
const SCALING = ['hp', 'def', 'dmg', 'heal', 'stomp', 'ram', 'absorb', 'backfire', 'atkPct', 'crit', 'stompPct', 'goldPct', 'healAfterWin', 'weaponDmgPct'];
const FULL = new Set(['hp', 'dmg', 'heal', 'stomp', 'ram', 'absorb', 'backfire']);
// Reactor modules (Battery Pack, Coolant Loop, Heat Sink, Power Core...) grow fully; frames' reactors don't
const REACTOR = ['energy', 'regen', 'heatCap', 'cool'];

/** A part's stats at the owned item's tier and level. `rarity` is the tier it's at now. */
export function partStats(owned) {
  const base = getPart(owned.id);
  if (!base) return null;
  const k = growth(owned);
  const out = { ...base, level: owned.level || 1, uid: owned.uid, baseRarity: base.rarity, rarity: tierOf(owned) };
  for (const f of SCALING) if (typeof base[f] === 'number') out[f] = base[f] * (FULL.has(f) ? k : 1 + (k - 1) * 0.5);
  if (base.type === 'module') for (const f of REACTOR) if (typeof base[f] === 'number') out[f] = Math.round(base[f] * k);
  if (base.res) out.res = Object.fromEntries(Object.entries(base.res).map(([t, v]) => [t, v * (1 + (k - 1) * 0.5)]));
  return out;
}

export const rarityColor = (r) => RARITIES[r]?.color || '#94b0c2';
export const rarityName = (r) => RARITIES[r]?.name || '';
export const salvageValue = (owned) => Math.round(RARITIES[tierOf(owned)].scrap * (1 + ((owned.level || 1) - 1) / Math.max(1, maxLevel(owned) - 1)));
export const upgradeCost = (owned) => Math.ceil(owned.level * 2 * RARITIES[tierOf(owned)].cost);

/** A gun's or drone's average damage per hit as battles deal it (CONFIG.gear.dmgScale), before ATK and resists. */
export const battleDmg = (p) => Math.round((p.dmg || 0) * CONFIG.gear.dmgScale);
/** The low and high end of a hit's roll. */
export function dmgRange(mean) {
  const s = CONFIG.gear.dmgSpread;
  return [Math.max(1, Math.round(mean * (1 - s))), Math.max(1, Math.round(mean * (1 + s)))];
}
export const dmgLabel = (mean) => {
  const [lo, hi] = dmgRange(mean);
  return lo === hi ? `${lo}` : `${lo}-${hi}`;
};

/** Short stat lines for cards (words; the icon version is partChips). */
export function describePart(owned) {
  const p = partStats(owned);
  const L = [];
  if (p.weight) L.push(`${p.weight} KG`);
  if (p.type === 'weapon') L.push(p.mount === 'top' ? 'TOP MOUNT' : 'SIDE MOUNT');
  if (p.hp) L.push(`HP +${Math.round(p.hp)}`);
  if (p.def) L.push(`DEF +${p.def.toFixed(1)} (ALL)`);
  for (const t of DTYPE_KEYS) if (p.res?.[t]) L.push(`${DTYPES[t].short} RES +${p.res[t].toFixed(1)}`);
  if (p.dmg) L.push(`DMG ${dmgLabel(battleDmg(p))} ${DTYPES[dtypeOf(p)].name}`);
  if (p.reach) L.push(`RANGE ${reachLabel(p.reach)}`);
  if (p.type === 'legs' && !p.anchored) L.push(`MOVE ${legsLabel(p)}`);
  if (p.stomp) L.push(`STOMP ${dmgLabel(Math.round(p.stomp))} ${DTYPES[legsRules(p).stompType].name}`);
  if (p.anchored) L.push('CAN\'T MOVE');
  if (p.en) L.push(`EN ${p.en}`);
  if (p.heat) L.push(`HEAT ${p.heat}`);
  if (p.ammo) L.push(`AMMO ${p.ammo}`);
  if (p.backfire) L.push(`BACKFIRE ${Math.round(p.backfire)} HP`);
  for (const [t, v] of Object.entries(p.fx?.resDrain || {})) L.push(`-${v} ${DTYPES[t].short} RES / HIT`);
  if (p.energy) L.push(`ENERGY ${p.type === 'frame' ? '' : '+'}${p.energy}`);
  if (p.regen) L.push(`REGEN ${p.type === 'frame' ? '' : '+'}${p.regen}/turn`);
  if (p.heatCap) L.push(`HEAT CAP ${p.type === 'frame' ? '' : '+'}${p.heatCap}`);
  if (p.cool) L.push(`COOL ${p.type === 'frame' ? '' : '+'}${p.cool}/turn`);
  if (p.heal) L.push(`HEAL ${Math.round(p.heal)}/turn`);
  if (p.type === 'special') L.push(`${p.uses} USE${p.uses > 1 ? 'S' : ''} PER BATTLE`);
  if (p.ram) L.push(`RAM ${Math.round(p.ram * CONFIG.gear.dmgScale)} PHYSICAL`);
  if (p.absorb) L.push(`SOAKS ${Math.round(p.absorb)} DMG`);
  if (p.special === 'hook') L.push(`RANGE 2-${p.range}`);
  if (p.special === 'charge') L.push(`DASH ${p.dist}`);
  if (p.type === 'drone') L.push(`UPKEEP ${droneUpkeep(p).en} EN${droneUpkeep(p).heat ? ` +${droneUpkeep(p).heat} HEAT` : ''}/turn`);
  if (p.atkPct) L.push(`DMG +${Math.round(p.atkPct * 100)}%`);
  if (p.weaponDmgPct) L.push(`GUNS +${Math.round(p.weaponDmgPct * 100)}%`);
  if (p.crit) L.push(`CRIT +${(p.crit * 100).toFixed(1)}%`);
  if (p.stompPct) L.push(`STOMP +${Math.round(p.stompPct * 100)}%`);
  if (p.goldPct) L.push(`GOLD +${Math.round(p.goldPct * 100)}%`);
  if (p.reachBonus) L.push(`RANGE +${p.reachBonus}`);
  if (p.healAfterWin) L.push(`+${Math.round(p.healAfterWin * 100)}% HP/win`);
  if (p.unique) L.push('ONE PER MECH');
  if (p.desc) L.push(p.desc);
  return L;
}

/**
 * Stat chips: { icon, text, color?, tip } with icons from rendering/pixelIcons.
 * Used everywhere a part is shown (rig, pods, hover cards in battle).
 */
export function partChips(owned) {
  const p = partStats(owned);
  const C = [];
  const add = (cond, icon, text, tip, color) => { if (cond) C.push({ icon, text, tip, color }); };
  const dt = DTYPES[dtypeOf(p)];
  add(p.type === 'weapon', p.mount === 'top' ? 'top' : 'side', p.mount === 'top' ? 'TOP' : 'SIDE', p.mount === 'top' ? 'Top mount' : 'Side mount');
  add(p.hp, 'hp', `+${Math.round(p.hp)}`, 'HP');
  add(p.def, 'def', `+${p.def?.toFixed(1)}`, 'DEF (all types)');
  for (const t of DTYPE_KEYS) add(p.res?.[t], 'def', `+${p.res?.[t]?.toFixed(1)}`, `${DTYPES[t].name} resist`, DTYPES[t].color);
  add(p.dmg, dt.icon, dmgLabel(battleDmg(p)), `${dt.name} damage per hit`, dt.color);
  add(p.fx?.burst, 'ammo', `x${p.fx?.burst}`, 'Hits per shot');
  add(p.type === 'legs' && !p.anchored, 'move', legsLabel(p), 'Movement');
  if (p.stomp) {
    const st = DTYPES[legsRules(p).stompType];
    add(true, 'stomp', dmgLabel(Math.round(p.stomp * CONFIG.gear.dmgScale)), `STOMP: ${st.name} damage at range 1, knocks back 1`, st.color);
  }
  add(p.reach, 'range', p.reach ? reachLabel(p.reach) : '', 'Range (positions)');
  add(p.anchored, 'lock', 'ANCHOR', "Can't move");
  add(p.moveEn, 'energy', `${p.moveEn}/MOVE`, 'Energy per move');
  add(p.en, 'energy', `${p.en}`, 'Energy per use', DTYPES.energy.color);
  add(p.heat, 'heat', `${p.heat}`, 'Heat per use', DTYPES.heat.color);
  add(p.ammo, 'ammo', `x${p.ammo}`, 'Shots per battle');
  add(p.backfire, 'backfire', `-${Math.round(p.backfire || 0)}`, 'Backfire: HP it costs you per shot', '#ff5d73');
  for (const [t, v] of Object.entries(p.fx?.resDrain || {})) add(true, 'resdrain', `-${v}`, `Strips ${DTYPES[t].name} resist per hit`, DTYPES[t].color);
  add(p.fx?.corrode, 'resdrain', `-${p.fx?.corrode}`, 'Strips PHYSICAL resist per hit', DTYPES.phys.color);
  add(p.fx?.drain, 'drain', `${p.fx?.drain}`, 'Drains their energy', DTYPES.energy.color);
  add(p.fx?.heat, 'heat', `+${p.fx?.heat}`, 'Heat into the target', DTYPES.heat.color);
  add(p.fx?.push, 'push', `${p.fx?.push}`, 'Knocks the target back');
  add(p.fx?.pull, 'pull', `${p.fx?.pull}`, 'Pulls the target in');
  add(p.fx?.pierce, 'pierce', '', 'Ignores resists');
  add(p.arc, 'arc', '', 'Lobbed: flies over cover');
  add(p.energy, 'energy', `${p.type === 'frame' ? '' : '+'}${p.energy}`, 'Energy pool', DTYPES.energy.color);
  add(p.regen, 'regen', `+${p.regen}`, 'Energy regen per turn', DTYPES.energy.color);
  add(p.heatCap, 'heat', `${p.type === 'frame' ? '' : '+'}${p.heatCap}`, 'Heat cap', DTYPES.heat.color);
  add(p.cool, 'cool', `-${p.cool}`, 'Cooling per turn', '#73eff7');
  add(p.heal, 'heal', `${Math.round(p.heal)}/T`, 'Repair per turn');
  add(p.type === 'special', 'ammo', `x${p.uses}`, 'Uses per battle');
  add(p.ram, 'dmg', `${Math.round((p.ram || 0) * CONFIG.gear.dmgScale)}`, 'Ram damage (Physical)');
  add(p.absorb, 'def', `${Math.round(p.absorb || 0)}`, 'Soaks damage');
  add(p.special === 'hook', 'range', `2-${p.range}`, 'Hook range');
  add(p.special === 'charge', 'move', `${p.dist}`, 'Dash distance');
  add(p.type === 'drone', 'energy', `${droneUpkeep(p).en}/T`, 'Energy per turn while deployed', DTYPES.energy.color);
  add(p.type === 'drone' && droneUpkeep(p).heat, 'heat', `+${droneUpkeep(p).heat}/T`, 'Heat per turn while deployed', DTYPES.heat.color);
  add(p.atkPct, 'dmg', `+${Math.round(p.atkPct * 100)}%`, 'All damage');
  add(p.weaponDmgPct, 'gun', `+${Math.round(p.weaponDmgPct * 100)}%`, 'Gun damage');
  add(p.crit, 'star', `+${(p.crit * 100).toFixed(1)}%`, 'Crit chance');
  add(p.stompPct, 'stomp', `+${Math.round(p.stompPct * 100)}%`, 'Stomp damage');
  add(p.freeFirstShot, 'energy', '1ST FREE', 'First gun each battle costs no energy');
  add(p.goldPct, 'gold', `+${Math.round(p.goldPct * 100)}%`, 'Gold');
  add(p.reachBonus, 'range', `+${p.reachBonus}`, 'Max range on every gun');
  add(p.healAfterWin, 'heal', `+${Math.round(p.healAfterWin * 100)}%/WIN`, 'Heal after each win');
  add(p.startForcefield, 'def', 'FIELD', 'Start each battle with a Forcefield');
  add(p.unique, 'lock', '1x', 'One per mech');
  return C;
}

/** Short words for how legs move: 'WALK 2 · JUMP 1-4'. */
export function legsLabel(p) {
  if (p.anchored) return "CAN'T MOVE";
  const parts = [];
  if (p.walk) parts.push(`WALK ${p.walk}`);
  if (p.jump) parts.push(`JUMP ${p.jump[0] === p.jump[1] ? p.jump[0] : `${p.jump[0]}-${p.jump[1]}`}`);
  return parts.join(' · ') || 'NONE';
}

/** A gun's reach in positions: '3-7', or '1' for melee. */
export const reachLabel = (r) => (r[0] === r[1] ? `${r[0]}` : `${r[0]}-${r[1]}`);

/** Energy and heat a deployed drone costs at the end of each of your turns. */
export const droneUpkeep = (d) => ({ en: d?.upkeep?.en ?? 4, heat: d?.upkeep?.heat ?? 0 });

/** One-line effect text for a part (fx and special rules only). */
export function partNote(p) {
  if (p.desc) return p.desc;
  if (p.type === 'drone') return 'DEPLOY it (1 action): then it acts at the end of every turn, any range.';
  return '';
}

export const TYPE_LABEL = { frame: 'FRAME', legs: 'LEGS', weapon: 'GUN', drone: 'DRONE', module: 'MOD', special: 'SPECIAL' };

// ---------- Loadout ----------

/** Totals for a loadout (array of owned parts, nulls allowed). */
export function loadoutTotals(ownedParts) {
  const G = CONFIG.gear;
  const t = {
    capacity: G.loadCap, weight: 0, hp: 0, def: 0, res: { phys: 0, heat: 0, energy: 0 }, atkPct: 0, crit: 0, stompPct: 0, freeFirstShot: false, goldPct: 0,
    healAfterWin: 0, weaponDmgPct: 0, reachBonus: 0, startForcefield: false,
    weapons: [], drones: [], specials: [],
    // Reactor (gear combat): the frame sets it, modules add to it
    energy: 0, regen: 0, heatCap: 0, cool: 0, hasFrame: false,
    legs: null, // the fitted legs part (movement rules), null = DEFAULT_LEGS
  };
  const parts = ownedParts.filter(Boolean).map(partStats).filter(Boolean);
  for (const p of parts) {
    if (p.type === 'frame') t.hasFrame = true;
    for (const f of ['energy', 'regen', 'heatCap', 'cool']) t[f] += p[f] || 0;
    t.weight += p.weight || 0;
    for (const f of ['hp', 'def', 'atkPct', 'crit', 'stompPct', 'goldPct', 'healAfterWin', 'weaponDmgPct', 'reachBonus']) t[f] += p[f] || 0;
    if (p.freeFirstShot) t.freeFirstShot = true;
    if (p.startForcefield) t.startForcefield = true;
    for (const k of DTYPE_KEYS) t.res[k] += p.res?.[k] || 0;
    if (p.type === 'weapon') t.weapons.push(p);
    if (p.type === 'drone') t.drones.push(p);
    if (p.type === 'special') t.specials.push(p);
    if (p.type === 'legs') t.legs = p;
  }
  // Side guns first, then top (the order of the battle bar)
  t.weapons.sort((a, b) => (a.mount === 'top') - (b.mount === 'top'));
  // Module effects apply to the guns
  t.weapons = t.weapons.map((w) => ({
    ...w,
    dmg: w.dmg * (1 + t.weaponDmgPct),
    reach: [w.reach[0], Math.min(LANE_SIZE - 1, w.reach[1] + t.reachBonus)],
  }));
  if (!t.hasFrame) {
    // No frame: a bare-bones reactor, plus whatever modules add
    const base = G.baseRig;
    for (const f of ['energy', 'regen', 'heatCap', 'cool']) t[f] += base[f];
  }
  // Overweight: a few kg over costs HP per kg; past overweightMax you can't deploy
  t.overKg = Math.max(0, t.weight - t.capacity);
  t.overHp = Math.min(t.overKg, G.overweightMax) * G.overweightHp;
  t.hp -= t.overHp;
  t.overweight = t.overKg > G.overweightMax;
  return t;
}

/** A run's fixed stats from the equipped loadout (plus `base`, e.g. mastery). */
export function withMech(base, ownedParts) {
  const t = loadoutTotals(ownedParts);
  return {
    ...base,
    atkBonus: (base.atkBonus || 0) + t.atkPct,
    critChance: (base.critChance || 0) + t.crit,
    hpBonus: (base.hpBonus || 0) + Math.round(t.hp),
    defBonus: (base.defBonus || 0) + t.def,
    res: t.res,
    gearGoldPct: t.goldPct,
    mech: {
      parts: ownedParts.filter(Boolean).map((o) => o.id), // for the sprite
      weapons: t.weapons,
      drones: t.drones,
      specials: t.specials,
      healAfterWin: t.healAfterWin,
      startForcefield: t.startForcefield,
      freeFirstShot: t.freeFirstShot,
      rig: { energy: t.energy, regen: t.regen, heatCap: t.heatCap, cool: t.cool },
      legs: (() => {
        const l = legsRules(t.legs);
        l.stomp = Math.round(l.stomp * (1 + t.stompPct)); // Stomp Servo
        return l;
      })(),
    },
  };
}

// ---------- Crates ----------

// Mythic drops from every pod, but only the Abyss pod (Risk 7+) makes it realistic
export const CRATES = [
  { id: 'standard', name: 'SUPPLY POD', color: '#41a6f6', cost: 8, odds: { common: 62, rare: 28, epic: 9, legendary: 0.98, mythic: 0.02 } },
  { id: 'elite', name: 'ELITE POD', color: '#c46fd6', cost: 24, odds: { common: 15, rare: 45, epic: 30, legendary: 9.9, mythic: 0.1 } },
  { id: 'abyss', name: 'ABYSS POD', color: '#ff5d73', cost: 36, minRisk: 7, odds: { common: 5, rare: 35, epic: 40, legendary: 17, mythic: 3 } },
];
/** A pack of pods: PACK_SIZE bought and opened at once (same price per pod). */
export const PACK_SIZE = 5;
export const packCost = (crate) => crate.cost * PACK_SIZE;

/** Roll one part from a crate. Odds are shown to the player in the UI. */
export function openCrate(crateId, rnd = Math.random) {
  const crate = CRATES.find((c) => c.id === crateId) || CRATES[0];
  let r = rnd() * 100;
  let rarity = 'common';
  for (const k of RARITY_ORDER) {
    r -= crate.odds[k] || 0;
    if (r <= 0) {
      rarity = k;
      break;
    }
  }
  const pool = PARTS.filter((p) => p.rarity === rarity);
  const part = pool[Math.floor(rnd() * pool.length)];
  return { uid: newUid(rnd), id: part.id, level: 1, tier: rarity };
}

export const newUid = (rnd = Math.random) => `m${Date.now().toString(36)}${Math.floor(rnd() * 1e6).toString(36)}`;

/**
 * Keys (saved as tokens) for winning a fight; Risk adds 10% per level.
 */
export const CLEAN_WIN_KEYS = 2; // bonus for a normal fight won without taking damage

export function tokenReward(nodeType, risk = 0) {
  const base = { combat: 3, elite: 5, miniboss: 5, boss: 8 }[nodeType] || 0;
  return Math.round(base * (1 + 0.1 * risk));
}

// ---------- Enemy mechs ----------

/**
 * Every enemy is a mech built from catalog parts: no special abilities,
 * just what its gear does. `guns` is a list of slots, each a pick-one list:
 * normal fights fit the first 2, elites 3, minibosses and bosses all of them.
 * `heavy` swaps slot 1 for elites / bosses (a sniper brings the big gun).
 * `mods` give the resists; `drone` flies from elites up.
 */
export const ENEMY_LOADOUTS = {
  standard: { legs: ['lg_strider', 'lg_hopper'], mods: ['md_plating', 'md_physres'], drone: 'dr_gnat', guns: [['wp_blaster', 'wp_scatter', 'wp_smg'], ['wp_rifle', 'wp_acid'], ['wp_mortar', 'wp_rocket']] },
  tank: { specials: ['sp_charge'], legs: ['lg_treads'], mods: ['md_titanplate', 'md_heavyplate'], drone: 'dr_guardian', guns: [['wp_scatter'], ['wp_repulsor'], ['wp_shredder'], ['wp_concussion']] },
  striker: { specials: ['sp_teleport'], legs: ['lg_catapult', 'lg_strider'], mods: ['md_physres'], drone: 'dr_hornet', guns: [['wp_rifle'], ['wp_blaster'], ['wp_rocket']], heavy: 'wp_sniper' },
  vampire: { specials: ['sp_hook', 'sp_charge'], legs: ['lg_coil', 'lg_strider'], mods: ['md_aegis'], drone: 'dr_medic', guns: [['wp_scythe'], ['wp_smg'], ['wp_grapple']] },
  pyromancer: { legs: ['lg_treads', 'lg_jumpjets'], mods: ['md_composite', 'md_heatres'], drone: 'dr_hornet', guns: [['wp_blowtorch', 'wp_flamer'], ['wp_thermal', 'wp_rupturer', 'wp_scorcher'], ['wp_napalm']], heavy: 'wp_meltdown' },
  disruptor: { legs: ['lg_jumpjets', 'lg_coil'], mods: ['md_aegis', 'md_elecres'], drone: 'dr_reaper', guns: [['wp_spark', 'wp_leech'], ['wp_gridbreaker', 'wp_ionizer'], ['wp_grapple']], heavy: 'wp_blackout' },
  tactician: { specials: ['sp_hook'], legs: ['lg_strider', 'lg_coil'], mods: ['md_composite'], drone: 'dr_guardian', guns: [['wp_tesla'], ['wp_missiles'], ['wp_beam']] },
  corroder: { legs: ['lg_hopper', 'lg_coil'], mods: ['md_physres'], drone: 'dr_gnat', guns: [['wp_acid'], ['wp_emp'], ['wp_shredder']] },
  minelayer: { legs: ['lg_treads', 'lg_hopper'], mods: ['md_composite'], drone: 'dr_hornet', guns: [['wp_minelauncher'], ['wp_blaster', 'wp_scatter'], ['wp_mortar']] },
  // The Sector Commander: bolted down with long guns (get in close: they can't hit you there)
  boss: { specials: ['sp_hook'], frame: 'fr_leviathan', legs: ['lg_anchor'], mods: ['md_voidcore', 'md_titanplate'], drone: 'dr_guardian', guns: [['wp_howitzer'], ['wp_rail'], ['wp_rifle'], ['wp_impact']] },
  // Abyss 5's true final boss: fast, reaches everywhere, and hits hard up close
  final: { specials: ['sp_ram', 'sp_teleport'], frame: 'fr_leviathan', legs: ['lg_phase'], mods: ['md_voidcore', 'md_titanplate'], drone: 'dr_seraph', guns: [['wp_nova'], ['wp_scythe'], ['wp_ionizer'], ['wp_missiles']] },
};

/** Frame (for its look and reactor tier) by fight tier. */
const ENEMY_FRAME = { combat: 'fr_scout', elite: 'fr_brawler', miniboss: 'fr_titan', boss: 'fr_colossus' };
/** Gun slots fitted by fight tier (the rest of the list is left empty). */
const ENEMY_GUNS = { combat: 2, elite: 3, miniboss: 4, boss: 4 };

function legsInfo(id) {
  return legsRules(getPart(id));
}

/** Reactor for one enemy: by fight tier; Risk XI (gunCdCut) makes them cool faster. */
export function enemyRig(nodeType, { cdCut = 0 } = {}) {
  const tier = ['elite', 'miniboss', 'boss'].includes(nodeType) ? nodeType : 'combat';
  const r = CONFIG.gear.enemyRig[tier];
  return { ...r, cool: r.cool + cdCut * 4 };
}

/**
 * One enemy mech: its parts, legs, guns, drone and resists. Enemy guns hit
 * softer than yours (enemyDmgScale); `atkMult` is the same Risk / condition
 * / wave multiplier the enemy's ATK gets.
 */
export function enemyMech(nodeType, archetype, floor, rnd = Math.random, { atkMult = 1, boss = false, final = false } = {}) {
  const f = Math.max(1, Math.min(5, floor));
  const tier = ['elite', 'miniboss', 'boss'].includes(nodeType) ? nodeType : 'combat';
  const L = final ? ENEMY_LOADOUTS.final : boss ? ENEMY_LOADOUTS.boss : ENEMY_LOADOUTS[archetype] || ENEMY_LOADOUTS.standard;
  const pick = (list) => list[Math.floor(rnd() * list.length)];

  const slots = L.guns.slice(0, boss || final ? L.guns.length : ENEMY_GUNS[tier]);
  const gunIds = slots.map(pick);
  if (L.heavy && tier !== 'combat') gunIds[0] = L.heavy;
  const G = CONFIG.gear;
  // More guns than in 2.0 (and a drone): each hits a little softer, so the
  // total stays close while the enemy covers more ranges
  const spread = final || boss ? 0.5 : { combat: 0.5, elite: 0.48, miniboss: 0.52, boss: 0.5 }[tier];
  const scale = G.dmgScale * G.enemyDmgScale * spread * (1 + 0.1 * (f - 1));
  const weapons = gunIds.map((id) => {
    const base = getPart(id);
    return { ...base, dmg: Math.max(2, Math.round(base.dmg * scale * atkMult)), backfire: base.backfire ? Math.round(base.backfire * scale) : 0, level: 1 };
  }).sort((a, b) => (a.mount === 'top') - (b.mount === 'top'));

  const legsId = pick(L.legs);
  const frameId = L.frame || ENEMY_FRAME[tier];
  // Resists from the modules (normal fights fit the first one) and legs, growing a little with the floor
  const mods = (tier === 'combat' ? (L.mods || []).slice(0, 1) : L.mods || []).map(getPart).filter(Boolean);
  const k = 1 + 0.1 * (f - 1);
  const res = Object.fromEntries(DTYPE_KEYS.map((t) => {
    const sum = mods.reduce((s, m) => s + (m.res?.[t] || 0), 0) + (getPart(legsId)?.res?.[t] || 0);
    return [t, Math.round(sum * k * 10) / 10];
  }));
  // Drone: elites from floor 3, mini-bosses and bosses; it hits like their guns
  const dr = tier !== 'combat' && (tier !== 'elite' || f >= 3) && L.drone ? getPart(L.drone) : null;
  const drones = dr ? [{ ...dr, level: 1, dmg: dr.dmg ? Math.max(1, Math.round(dr.dmg * scale * atkMult)) : 0, heal: dr.heal ? Math.round(dr.heal * k) : 0 }] : [];
  return {
    weapons,
    drones,
    legs: legsInfo(legsId),
    res,
    startForcefield: mods.some((m) => m.startForcefield),
    parts: [frameId, legsId, ...gunIds, ...(dr ? [dr.id] : []), ...mods.map((m) => m.id)].filter(Boolean),
    // Specials: elites and up; ram hits like their guns
    specials: (tier === 'combat' ? [] : L.specials || []).map((id) => {
      const sp = getPart(id);
      return { ...sp, level: 1, ram: sp.ram ? Math.round(sp.ram * scale * atkMult) : 0 };
    }),
  };
}
