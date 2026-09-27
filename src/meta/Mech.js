// ============================================================
// Rig — the gear your ball carries into a run.
//
// Slots: Frame, Legs, Armor, Gun x2, Drone, Mod x2. The Frame sets base
// HP and the load capacity; every other part has a load cost, so
// heavy guns squeeze out armor. Legs decide how you MOVE: the band of
// launch power you can use (short hops, mid jumps, long leaps only),
// sometimes the launch angle, or no moving at all. Parts come from supply pods opened
// with Keys earned in runs (never real money; odds are shown).
// (Code and save data still use the old names: mech, crate, tokens.)
// Duplicates salvage into scrap, scrap upgrades parts (level 1-10).
//
// In battle you fire each gun yourself (one action per shot) at a target
// inside its range band (distance between ball centres); every shot costs
// energy and adds heat (the frame's reactor limits both) and the strongest
// guns carry limited ammo. Drones, switched ON, act at the end of your
// turn at any range. Enemies are built from these same parts and obey
// the same rules (ENEMY_LOADOUTS below).
//
// Every gun deals one damage type: Physical, Heat or Energy (DTYPES).
// Armor resists each type separately; DEF on other parts resists all three.
// ============================================================

import { CONFIG } from '../config.js';

export const SLOTS = [
  { id: 'frame', type: 'frame', name: 'FRAME' },
  { id: 'legs', type: 'legs', name: 'LEGS' },
  { id: 'armor', type: 'armor', name: 'ARMOR' },
  { id: 'weapon1', type: 'weapon', name: 'GUN A' },
  { id: 'weapon2', type: 'weapon', name: 'GUN B' },
  { id: 'drone', type: 'drone', name: 'DRONE' },
  { id: 'module1', type: 'module', name: 'MOD A' },
  { id: 'module2', type: 'module', name: 'MOD B' },
];

export const RARITIES = {
  common: { name: 'COMMON', color: '#94b0c2', scrap: 3, cost: 1 },
  rare: { name: 'RARE', color: '#41a6f6', scrap: 8, cost: 1.5 },
  epic: { name: 'EPIC', color: '#c46fd6', scrap: 20, cost: 2 },
  legendary: { name: 'LEGENDARY', color: '#ffcd75', scrap: 50, cost: 3 },
  mythic: { name: 'MYTHIC', color: '#ff5d73', scrap: 120, cost: 4 },
};
const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary', 'mythic'];

/** Damage types. Heat also heats the target, Energy drains it (Game._reactorFx). */
export const DTYPES = {
  phys: { name: 'PHYSICAL', short: 'PHY', color: '#f4f4f4', icon: 'dmg' },
  heat: { name: 'HEAT', short: 'HEAT', color: '#ef7d57', icon: 'heat' },
  energy: { name: 'ENERGY', short: 'EN', color: '#73eff7', icon: 'energy' },
};
export const DTYPE_KEYS = Object.keys(DTYPES);
export const dtypeOf = (w) => (DTYPES[w?.dtype] ? w.dtype : 'phys');
/** A ball's resistance to one damage type, in DEF points. */
export const resistOf = (ball, type) => (ball.def || 0) + (ball.res?.[type] || 0);

// ---------- Catalog (51 parts) ----------
// Weapons: reach [min, max] in lane positions (1 = the next position), dmg per shot, en = energy per shot, heat = heat per shot,
// ammo = shots per battle (strong guns only), arc = lobbed over cover
// (everything else needs a clear line to the target).
// fx: burn / freeze / corrode / splash / chain / pierce (ignores DEF) / crit
//     burst (hits N times) / line (hits every enemy along the shot)
//     drain (burns target energy) / heat (adds target heat) / push / pull (px)
//     mine (the shot plants a mine near the target instead of hitting it)
// Frames and some modules set the reactor: energy (pool), regen (per turn),
// heatCap and cool (per turn).
export const PARTS = [
  // Frames: base HP + weight capacity (frames weigh nothing) + reactor
  { id: 'fr_scout', type: 'frame', name: 'SCOUT FRAME', rarity: 'common', hp: 0, capacity: 60, energy: 30, regen: 14, heatCap: 30, cool: 12 },
  { id: 'fr_brawler', type: 'frame', name: 'BRAWLER FRAME', rarity: 'rare', hp: 15, capacity: 72, energy: 32, regen: 14, heatCap: 40, cool: 13 },
  { id: 'fr_phantom', type: 'frame', name: 'PHANTOM FRAME', rarity: 'epic', hp: 5, capacity: 80, powerPct: 0.1, energy: 40, regen: 19, heatCap: 34, cool: 14 },
  { id: 'fr_titan', type: 'frame', name: 'TITAN FRAME', rarity: 'epic', hp: 30, capacity: 88, energy: 34, regen: 15, heatCap: 50, cool: 15 },
  { id: 'fr_colossus', type: 'frame', name: 'COLOSSUS FRAME', rarity: 'legendary', hp: 40, capacity: 104, energy: 44, regen: 19, heatCap: 56, cool: 17 },
  { id: 'fr_leviathan', type: 'frame', name: 'LEVIATHAN FRAME', rarity: 'mythic', hp: 46, capacity: 112, powerPct: 0.05, energy: 50, regen: 21, heatCap: 62, cool: 19, color: '#ff5d73' },

  // Legs (weightless, like frames) decide how you move on the lane:
  // walk = up to N positions along the ground (not through mechs or cover);
  // jump = [min, max] positions, landing exactly there, over mechs and cover;
  // stomp = damage to a mech on the next position; anchored = can't move at all;
  // moveEn = energy per move; freeMove = first move each turn uses no action
  { id: 'lg_strider', type: 'legs', name: 'STRIDER LEGS', rarity: 'common', walk: 2, stomp: 10, desc: 'The all-rounder.' },
  { id: 'lg_hopper', type: 'legs', name: 'HOPPER LEGS', rarity: 'common', walk: 1, jump: [1, 2], stomp: 8, desc: 'Short, precise hops.' },
  { id: 'lg_treads', type: 'legs', name: 'TANK TREADS', rarity: 'common', hp: 12, walk: 3, stomp: 14, desc: "Fast on the ground, can't clear cover. +12 HP." },
  { id: 'lg_catapult', type: 'legs', name: 'CATAPULT LEGS', rarity: 'rare', walk: 0, jump: [3, 4], stomp: 12, desc: 'Long leaps only: no small steps.' },
  { id: 'lg_jumpjets', type: 'legs', name: 'JUMP JETS', rarity: 'rare', walk: 1, jump: [1, 4], stomp: 10, desc: 'Best over cover.' },
  { id: 'lg_coil', type: 'legs', name: 'COIL SPRINGS', rarity: 'epic', walk: 2, jump: [1, 2], stomp: 10, desc: 'Walk or hop.' },
  { id: 'lg_anchor', type: 'legs', name: 'ANCHOR CLAMPS', rarity: 'epic', hp: 30, def: 4, atkPct: 0.2, anchored: true, desc: "Bolted down: you can't move. +30 HP, +4 DEF, +20% gun damage." },
  { id: 'lg_thrusters', type: 'legs', name: 'THRUSTERS', rarity: 'legendary', walk: 3, jump: [1, 3], stomp: 10, moveEn: 6, desc: 'Go anywhere, but each move costs 6 energy.' },
  { id: 'lg_phase', type: 'legs', name: 'PHASE STRIDERS', rarity: 'mythic', walk: 2, jump: [1, 3], stomp: 12, freeMove: true, color: '#ff5d73', desc: 'Your first move each turn uses no action.' },

  // Armor
  { id: 'ar_scrap', type: 'armor', name: 'SCRAP PLATES', rarity: 'common', weight: 10, hp: 15 },
  { id: 'ar_kevlar', type: 'armor', name: 'KEVLAR WEAVE', rarity: 'common', weight: 8, res: { phys: 2 } },
  { id: 'ar_reactive', type: 'armor', name: 'REACTIVE ARMOR', rarity: 'rare', weight: 16, hp: 16, res: { phys: 2, heat: 2 } },
  { id: 'ar_aegis', type: 'armor', name: 'AEGIS SHELL', rarity: 'epic', weight: 22, hp: 22, res: { phys: 1, energy: 3 }, startForcefield: true, desc: 'Start each battle with a Forcefield.' },
  { id: 'ar_titanium', type: 'armor', name: 'TITANIUM HULL', rarity: 'legendary', weight: 28, hp: 30, res: { phys: 3, heat: 3 } },
  { id: 'ar_void', type: 'armor', name: 'VOID CARAPACE', rarity: 'mythic', weight: 28, hp: 34, res: { phys: 3, heat: 3, energy: 3 }, startForcefield: true, color: '#ff5d73', desc: 'Start each battle with a Forcefield.' },

  // Weapons
  { id: 'wp_blaster', type: 'weapon', name: 'PULSE BLASTER', rarity: 'common', dtype: 'phys', weight: 12, reach: [1, 3], dmg: 8, en: 8, heat: 6, color: '#73eff7' },
  { id: 'wp_scatter', type: 'weapon', name: 'SCATTERGUN', rarity: 'common', dtype: 'phys', weight: 14, reach: [1, 2], dmg: 14, en: 10, heat: 10, color: '#ffcd75' },
  { id: 'wp_acid', type: 'weapon', name: 'ACID SPRAYER', rarity: 'common', dtype: 'heat', weight: 12, reach: [1, 2], dmg: 5, en: 6, heat: 4, fx: { corrode: 1 }, color: '#a7f070', desc: 'Strips 1 DEF per hit.' },
  { id: 'wp_smg', type: 'weapon', name: 'AUTO SMG', rarity: 'common', dtype: 'phys', weight: 12, reach: [1, 2], dmg: 3, en: 6, heat: 12, fx: { burst: 3 }, color: '#f4f4f4', desc: 'Fires 3 rounds. Runs hot.' },
  { id: 'wp_repulsor', type: 'weapon', name: 'REPULSOR', rarity: 'common', dtype: 'phys', weight: 10, reach: [1, 2], dmg: 4, en: 8, heat: 6, fx: { push: 2 }, color: '#41a6f6', desc: 'Pushes the target back 2 positions.' },
  { id: 'wp_rifle', type: 'weapon', name: 'LONG RIFLE', rarity: 'rare', dtype: 'phys', weight: 18, reach: [3, 7], dmg: 14, en: 10, heat: 12, color: '#f4f4f4' },
  { id: 'wp_flamer', type: 'weapon', name: 'FLAMER', rarity: 'rare', dtype: 'heat', weight: 16, reach: [1, 2], dmg: 6, en: 6, heat: 14, fx: { burn: 2 }, color: '#ef7d57', desc: 'Burns for 2 turns.' },
  { id: 'wp_mortar', type: 'weapon', name: 'MORTAR', rarity: 'rare', dtype: 'phys', weight: 22, reach: [3, 9], dmg: 15, en: 14, heat: 10, arc: true, fx: { splash: 1 }, color: '#ef7d57', desc: 'Lobbed over cover.' },
  { id: 'wp_cryo', type: 'weapon', name: 'CRYO CANNON', rarity: 'rare', dtype: 'heat', weight: 18, reach: [2, 4], dmg: 8, en: 12, heat: 2, fx: { freeze: true }, color: '#73eff7', desc: 'Chills: their next move is 1 position shorter.' },
  { id: 'wp_beam', type: 'weapon', name: 'LASER BEAM', rarity: 'rare', dtype: 'energy', weight: 16, reach: [1, 5], dmg: 7, en: 12, heat: 14, fx: { line: true }, color: '#ff5d73', desc: 'Burns through cover.' },
  { id: 'wp_emp', type: 'weapon', name: 'EMP BURST', rarity: 'rare', dtype: 'energy', weight: 14, reach: [1, 3], dmg: 4, en: 10, heat: 6, fx: { drain: 14 }, color: '#c46fd6', desc: 'Drains 14 of their energy.' },
  { id: 'wp_grapple', type: 'weapon', name: 'GRAPPLE HOOK', rarity: 'rare', dtype: 'phys', weight: 12, reach: [2, 6], dmg: 4, en: 8, heat: 4, fx: { pull: 2 }, color: '#94b0c2', desc: 'Pulls the target 2 positions toward you.' },
  { id: 'wp_minelauncher', type: 'weapon', name: 'MINE LAUNCHER', rarity: 'rare', dtype: 'phys', weight: 16, reach: [2, 8], dmg: 16, en: 8, heat: 6, ammo: 3, arc: true, fx: { mine: true }, color: '#ef7d57', desc: 'Plants a mine next to the target: it blasts whoever steps there. 3 mines.' },
  { id: 'wp_rocket', type: 'weapon', name: 'ROCKET LAUNCHER', rarity: 'rare', dtype: 'phys', weight: 20, reach: [2, 8], dmg: 20, en: 10, heat: 10, ammo: 2, arc: true, fx: { splash: 1 }, color: '#ffcd75', desc: 'Lobbed. 2 rockets per battle.' },
  { id: 'wp_tesla', type: 'weapon', name: 'TESLA COIL', rarity: 'epic', dtype: 'energy', weight: 20, reach: [1, 3], dmg: 11, en: 16, heat: 12, fx: { chain: 2 }, color: '#c46fd6', desc: 'Arcs to an enemy within 2 positions.' },
  { id: 'wp_missiles', type: 'weapon', name: 'MISSILE POD', rarity: 'epic', dtype: 'phys', weight: 24, reach: [1, 11], dmg: 12, en: 12, heat: 8, ammo: 3, arc: true, color: '#ff5d73', desc: 'Any range, over cover. 3 salvos.' },
  { id: 'wp_rail', type: 'weapon', name: 'RAIL LANCE', rarity: 'epic', dtype: 'energy', weight: 26, reach: [4, 11], dmg: 22, en: 20, heat: 18, fx: { pierce: true }, color: '#41a6f6', desc: 'Ignores DEF.' },
  { id: 'wp_heatray', type: 'weapon', name: 'HEAT RAY', rarity: 'epic', dtype: 'heat', weight: 18, reach: [1, 4], dmg: 6, en: 10, heat: 8, fx: { heat: 16 }, color: '#ef7d57', desc: 'Pumps 16 heat into the target.' },
  { id: 'wp_howitzer', type: 'weapon', name: 'SIEGE HOWITZER', rarity: 'legendary', dtype: 'phys', weight: 34, reach: [5, 11], dmg: 32, en: 24, heat: 16, ammo: 2, arc: true, fx: { splash: 1 }, color: '#ffcd75', desc: 'Lobbed. 2 shells per battle.' },
  { id: 'wp_scythe', type: 'weapon', name: 'PLASMA SCYTHE', rarity: 'legendary', dtype: 'energy', weight: 24, reach: [1, 1], dmg: 34, en: 12, heat: 16, color: '#c46fd6', desc: 'A brutal energy blade: huge damage, right next to the enemy only.' },
  { id: 'wp_sniper', type: 'weapon', name: 'SNIPER CANNON', rarity: 'legendary', dtype: 'phys', weight: 26, reach: [6, 11], dmg: 38, en: 20, heat: 24, ammo: 3, color: '#f4f4f4', desc: 'Huge hit at long range. 3 shots.' },
  { id: 'wp_nova', type: 'weapon', name: 'NOVA LANCE', rarity: 'mythic', dtype: 'energy', weight: 30, reach: [1, 11], dmg: 28, en: 26, heat: 20, ammo: 2, fx: { pierce: true }, color: '#ff5d73', desc: 'Any range. Ignores resists. 2 shots.' },

  // Drones: act every turn, any range, free to run
  { id: 'dr_gnat', type: 'drone', name: 'GNAT DRONE', rarity: 'common', dtype: 'phys', weight: 6, dmg: 3, color: '#94b0c2' },
  { id: 'dr_hornet', type: 'drone', name: 'HORNET DRONE', rarity: 'rare', dtype: 'phys', weight: 9, dmg: 5, color: '#ffcd75' },
  { id: 'dr_medic', type: 'drone', name: 'MEDIC DRONE', rarity: 'rare', weight: 8, heal: 5, color: '#a7f070', desc: 'Repairs you every turn it is deployed (grows with its level only). It never attacks.' },
  { id: 'dr_guardian', type: 'drone', name: 'GUARDIAN DRONE', rarity: 'epic', weight: 10, forcefieldEvery: 3, color: '#a7f070', desc: 'Forcefield every 3rd turn.' },
  { id: 'dr_reaper', type: 'drone', name: 'REAPER DRONE', rarity: 'legendary', dtype: 'energy', weight: 12, dmg: 9, fx: { crit: 0.2 }, color: '#ffcd75', desc: '20% crit chance.' },
  { id: 'dr_seraph', type: 'drone', name: 'SERAPH DRONE', rarity: 'mythic', dtype: 'energy', weight: 13, dmg: 11, fx: { crit: 0.25 }, color: '#ff5d73', desc: '25% crit chance.' },

  // Modules: passive bonuses
  { id: 'md_target', type: 'module', name: 'TARGETING CPU', rarity: 'common', weight: 4, crit: 0.03 },
  { id: 'md_servo', type: 'module', name: 'SERVO BOOST', rarity: 'common', weight: 4, powerPct: 0.05 },
  { id: 'md_bounty', type: 'module', name: 'BOUNTY CHIP', rarity: 'common', weight: 3, goldPct: 0.15 },
  { id: 'md_battery', type: 'module', name: 'BATTERY PACK', rarity: 'common', weight: 5, energy: 12, desc: '+12 energy pool.' },
  { id: 'md_coolant', type: 'module', name: 'COOLANT LOOP', rarity: 'common', weight: 5, cool: 5, desc: 'Cools 5 more heat per turn.' },
  { id: 'md_amp', type: 'module', name: 'DAMAGE AMP', rarity: 'rare', weight: 6, atkPct: 0.08 },
  { id: 'md_repair', type: 'module', name: 'NANO REPAIR', rarity: 'rare', weight: 6, healAfterWin: 0.05, desc: 'Heal after every won battle.' },
  { id: 'md_heatsink', type: 'module', name: 'HEAT SINK', rarity: 'rare', weight: 5, heatCap: 12, desc: '+12 heat capacity.' },
  { id: 'md_generator', type: 'module', name: 'POWER CORE', rarity: 'rare', weight: 6, regen: 5, desc: 'Refills 5 more energy per turn.' },
  { id: 'md_range', type: 'module', name: 'RANGE EXTENDER', rarity: 'epic', weight: 5, reachBonus: 1, desc: '+1 max range on every gun.' },
  { id: 'md_overclock', type: 'module', name: 'OVERCLOCK CORE', rarity: 'legendary', weight: 8, atkPct: 0.1, weaponDmgPct: 0.12 },
  { id: 'md_singularity', type: 'module', name: 'SINGULARITY CHIP', rarity: 'mythic', weight: 8, atkPct: 0.12, weaponDmgPct: 0.15, crit: 0.03, color: '#ff5d73' },
];

const PART_BY_ID = Object.fromEntries(PARTS.map((p) => [p.id, p]));
export const getPart = (id) => PART_BY_ID[id];

export const STARTER_PARTS = ['fr_scout', 'lg_strider', 'ar_scrap', 'wp_blaster', 'dr_gnat'];
export const STARTER_LOADOUT = { frame: 'fr_scout', legs: 'lg_strider', armor: 'ar_scrap', weapon1: 'wp_blaster', drone: 'dr_gnat' };
/** Positions on the battle lane (1..LANE_SIZE). */
export const LANE_SIZE = 12;

/** Movement with no legs fitted. */
export const DEFAULT_LEGS = { id: 'lg_strider', name: 'NO LEGS', walk: 2, jump: null, stomp: 6, anchored: false, moveEn: 0, freeMove: false };

/** The movement rules a battle needs from a legs part (level-scaled stomp included). */
export function legsRules(p) {
  if (!p) return { ...DEFAULT_LEGS };
  return { id: p.id, name: p.name, walk: p.walk || 0, jump: p.jump || null, stomp: Math.round(p.stomp || 0), anchored: !!p.anchored, moveEn: p.moveEn || 0, freeMove: !!p.freeMove };
}

export const MAX_LEVEL = 10;
export const INVENTORY_CAP = 60;

/** Stats grow 5% per level (LV 10 = x1.45); weight, reach and movement don't. */
export const levelMult = (lvl) => 1 + 0.05 * (lvl - 1);

// Numeric fields that scale with level
const SCALING = ['hp', 'def', 'dmg', 'heal', 'stomp', 'atkPct', 'crit', 'powerPct', 'goldPct', 'healAfterWin', 'weaponDmgPct'];

/** A part's stats at the owned item's level. */
export function partStats(owned) {
  const base = getPart(owned.id);
  if (!base) return null;
  const k = levelMult(owned.level || 1);
  const out = { ...base, level: owned.level || 1, uid: owned.uid };
  for (const f of SCALING) if (typeof base[f] === 'number') out[f] = base[f] * (f === 'hp' || f === 'dmg' || f === 'heal' || f === 'stomp' ? k : 1 + (k - 1) * 0.5);
  if (base.res) out.res = Object.fromEntries(Object.entries(base.res).map(([t, v]) => [t, v * (1 + (k - 1) * 0.5)]));
  return out;
}

export const rarityColor = (r) => RARITIES[r]?.color || '#94b0c2';
export const rarityName = (r) => RARITIES[r]?.name || '';
export const salvageValue = (owned) => Math.round(RARITIES[getPart(owned.id).rarity].scrap * (1 + (owned.level - 1) * 0.3));
export const upgradeCost = (owned) => Math.ceil(owned.level * 5 * RARITIES[getPart(owned.id).rarity].cost);

/** Short stat lines for cards. */
export function describePart(owned) {
  const p = partStats(owned);
  const L = [];
  if (p.type === 'frame') L.push(`CAP ${p.capacity}`);
  if (p.weight) L.push(`LOAD ${p.weight}`);
  if (p.hp) L.push(`HP +${Math.round(p.hp)}`);
  if (p.def) L.push(`DEF +${p.def.toFixed(1)} (ALL)`);
  for (const t of DTYPE_KEYS) if (p.res?.[t]) L.push(`${DTYPES[t].short} RES +${p.res[t].toFixed(1)}`);
  if (p.dmg) L.push(`DMG ${battleDmg(p)} ${DTYPES[dtypeOf(p)].name}`);
  if (p.reach) L.push(`RANGE ${reachLabel(p.reach)}`);
  if (p.type === 'legs' && !p.anchored) L.push(`MOVE ${legsLabel(p)}`);
  if (p.stomp) L.push(`STOMP ${Math.round(p.stomp)}`);
  if (p.anchored) L.push('CAN\'T MOVE');
  if (p.en) L.push(`EN ${p.en}`);
  if (p.heat) L.push(`HEAT ${p.heat}`);
  if (p.ammo) L.push(`AMMO ${p.ammo}`);
  if (p.energy) L.push(`ENERGY ${p.type === 'frame' ? '' : '+'}${p.energy}`);
  if (p.regen) L.push(`REGEN ${p.type === 'frame' ? '' : '+'}${p.regen}/turn`);
  if (p.heatCap) L.push(`HEAT CAP ${p.type === 'frame' ? '' : '+'}${p.heatCap}`);
  if (p.cool) L.push(`COOL ${p.type === 'frame' ? '' : '+'}${p.cool}/turn`);
  if (p.heal) L.push(`HEAL ${Math.round(p.heal)}/turn`);
  if (p.atkPct) L.push(`DMG +${Math.round(p.atkPct * 100)}%`);
  if (p.weaponDmgPct) L.push(`GUNS +${Math.round(p.weaponDmgPct * 100)}%`);
  if (p.crit) L.push(`CRIT +${(p.crit * 100).toFixed(1)}%`);
  if (p.powerPct) L.push(`POWER +${Math.round(p.powerPct * 100)}%`);
  if (p.goldPct) L.push(`GOLD +${Math.round(p.goldPct * 100)}%`);
  if (p.reachBonus) L.push(`RANGE +${p.reachBonus}`);
  if (p.healAfterWin) L.push(`+${Math.round(p.healAfterWin * 100)}% HP/win`);
  if (p.desc) L.push(p.desc);
  return L;
}

/**
 * Stat chips for the rig screen: { icon, text } with icons from
 * rendering/pixelIcons (the load cost is shown separately).
 */
export function partChips(owned) {
  const p = partStats(owned);
  const C = [];
  const add = (cond, icon, text) => { if (cond) C.push({ icon, text }); };
  add(p.type === 'frame', 'load', `CAP ${p.capacity}`);
  add(p.hp, 'hp', `+${Math.round(p.hp)}`);
  add(p.def, 'def', `+${p.def?.toFixed(1)}`);
  for (const t of DTYPE_KEYS) add(p.res?.[t], 'def', `${DTYPES[t].short} +${p.res?.[t]?.toFixed(1)}`);
  add(p.dmg, DTYPES[dtypeOf(p)].icon, `${battleDmg(p)} ${DTYPES[dtypeOf(p)].short}`);
  add(p.type === 'legs' && !p.anchored, 'move', legsLabel(p));
  add(p.stomp, 'dmg', `STOMP ${Math.round(p.stomp || 0)}`);
  add(p.reach, 'range', p.reach ? reachLabel(p.reach) : '');
  add(p.anchored, 'lock', 'ANCHORED');
  add(p.moveEn, 'energy', `${p.moveEn}/MOVE`);
  add(p.en, 'energy', `${p.en}`);
  add(p.heat, 'heat', `${p.heat}`);
  add(p.ammo, 'ammo', `x${p.ammo}`);
  add(p.energy, 'energy', `${p.type === 'frame' ? '' : '+'}${p.energy}`);
  add(p.regen, 'energy', `+${p.regen}/T`);
  add(p.heatCap, 'heat', `${p.type === 'frame' ? '' : '+'}${p.heatCap}`);
  add(p.cool, 'heat', `-${p.cool}/T`);
  add(p.heal, 'heal', `${Math.round(p.heal)}/T`);
  add(p.atkPct, 'dmg', `+${Math.round(p.atkPct * 100)}%`);
  add(p.weaponDmgPct, 'gun', `+${Math.round(p.weaponDmgPct * 100)}%`);
  add(p.crit, 'star', `+${(p.crit * 100).toFixed(1)}%`);
  add(p.powerPct, 'move', `+${Math.round(p.powerPct * 100)}%`);
  add(p.goldPct, 'gold', `+${Math.round(p.goldPct * 100)}%`);
  add(p.reachBonus, 'range', `+${p.reachBonus}`);
  add(p.healAfterWin, 'heal', `+${Math.round(p.healAfterWin * 100)}%/WIN`);
  return C;
}

/** A gun's or drone's damage per hit as battles deal it (CONFIG.gear.dmgScale), before ATK and resists. */
export const battleDmg = (p) => Math.round((p.dmg || 0) * CONFIG.gear.dmgScale);

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

/** One-line effect text for a part (fx and special rules only). */
export function partNote(p) {
  if (p.desc) return p.desc;
  if (p.type === 'drone') return 'Switch ON: acts at the end of your turn, any range.';
  if (p.type === 'weapon') return p.arc ? 'Lobbed over cover.' : 'Needs a clear line to the target.';
  return '';
}

export const TYPE_LABEL = { frame: 'FRAME', legs: 'LEGS', armor: 'ARMOR', weapon: 'GUN', drone: 'DRONE', module: 'MOD' };

// ---------- Loadout ----------

/** Totals for a loadout (array of owned parts, nulls allowed). */
export function loadoutTotals(ownedParts) {
  const t = {
    capacity: 0, weight: 0, hp: 0, def: 0, res: { phys: 0, heat: 0, energy: 0 }, atkPct: 0, crit: 0, powerPct: 0, goldPct: 0,
    healAfterWin: 0, weaponDmgPct: 0, reachBonus: 0, startForcefield: false,
    weapons: [], drones: [],
    // Reactor (gear combat): the frame sets it, modules add to it
    energy: 0, regen: 0, heatCap: 0, cool: 0, hasFrame: false,
    legs: null, // the fitted legs part (movement rules), null = DEFAULT_LEGS
  };
  const parts = ownedParts.filter(Boolean).map(partStats).filter(Boolean);
  for (const p of parts) {
    if (p.type === 'frame') {
      t.capacity += p.capacity;
      t.hasFrame = true;
    }
    for (const f of ['energy', 'regen', 'heatCap', 'cool']) t[f] += p[f] || 0;
    t.weight += p.weight || 0;
    for (const f of ['hp', 'def', 'atkPct', 'crit', 'powerPct', 'goldPct', 'healAfterWin', 'weaponDmgPct', 'reachBonus']) t[f] += p[f] || 0;
    if (p.startForcefield) t.startForcefield = true;
    for (const k of DTYPE_KEYS) t.res[k] += p.res?.[k] || 0;
    if (p.type === 'weapon') t.weapons.push(p);
    if (p.type === 'drone') t.drones.push(p);
    if (p.type === 'legs') t.legs = p;
  }
  // Module effects apply to the guns
  t.weapons = t.weapons.map((w) => ({
    ...w,
    dmg: w.dmg * (1 + t.weaponDmgPct),
    reach: [w.reach[0], Math.min(LANE_SIZE - 1, w.reach[1] + t.reachBonus)],
  }));
  if (!t.hasFrame) {
    // No frame: a bare-bones reactor, plus whatever modules add
    const base = CONFIG.gear.baseRig;
    for (const f of ['energy', 'regen', 'heatCap', 'cool']) t[f] += base[f];
  }
  t.overweight = t.weight > t.capacity;
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
    gearPowerPct: t.powerPct,
    gearGoldPct: t.goldPct,
    mech: {
      parts: ownedParts.filter(Boolean).map((o) => o.id), // for the sprite
      weapons: t.weapons,
      drones: t.drones,
      healAfterWin: t.healAfterWin,
      startForcefield: t.startForcefield,
      rig: { energy: t.energy, regen: t.regen, heatCap: t.heatCap, cool: t.cool },
      legs: legsRules(t.legs),
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
  return { uid: newUid(rnd), id: part.id, level: 1 };
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
 * just what its gear does. `guns` is a list of slots, each a pick-one list;
 * normal fights fit the first slot only, elites and bosses fit both.
 * `heavy` swaps slot 1 for elites / bosses (a sniper brings the big gun).
 */
export const ENEMY_LOADOUTS = {
  standard: { legs: ['lg_strider', 'lg_hopper'], armor: 'ar_scrap', guns: [['wp_blaster', 'wp_scatter', 'wp_smg'], ['wp_rifle', 'wp_acid']] },
  tank: { legs: ['lg_treads', 'lg_anchor'], armor: 'ar_titanium', guns: [['wp_scatter'], ['wp_repulsor']] },
  striker: { legs: ['lg_catapult', 'lg_strider'], armor: 'ar_kevlar', guns: [['wp_rifle'], ['wp_blaster']], heavy: 'wp_sniper' },
  vampire: { legs: ['lg_coil', 'lg_strider'], armor: 'ar_aegis', guns: [['wp_scythe'], ['wp_smg']] },
  pyromancer: { legs: ['lg_treads', 'lg_strider'], armor: 'ar_reactive', guns: [['wp_flamer'], ['wp_mortar']] },
  disruptor: { legs: ['lg_jumpjets', 'lg_coil'], armor: 'ar_aegis', guns: [['wp_grapple'], ['wp_cryo']] },
  tactician: { legs: ['lg_strider', 'lg_coil'], armor: 'ar_reactive', guns: [['wp_tesla'], ['wp_missiles']] },
  corroder: { legs: ['lg_hopper', 'lg_coil'], armor: 'ar_kevlar', guns: [['wp_acid'], ['wp_emp']] },
  minelayer: { legs: ['lg_treads', 'lg_hopper'], armor: 'ar_reactive', guns: [['wp_minelauncher'], ['wp_blaster', 'wp_scatter']] },
  // The Sector Commander: bolted down, shells you from anywhere
  boss: { frame: 'fr_leviathan', legs: ['lg_anchor'], armor: 'ar_void', guns: [['wp_howitzer'], ['wp_rail']] },
};

/** Frame (for its look and reactor tier) by fight tier. */
const ENEMY_FRAME = { combat: 'fr_scout', elite: 'fr_brawler', miniboss: 'fr_titan', boss: 'fr_colossus' };

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
 * One enemy mech: its parts, legs, guns and resists. Enemy guns hit softer
 * than yours (enemyDmgScale); `atkMult` is the same Risk / condition / wave
 * multiplier the enemy's ATK gets.
 */
export function enemyMech(nodeType, archetype, floor, rnd = Math.random, { atkMult = 1, boss = false } = {}) {
  const f = Math.max(1, Math.min(5, floor));
  const tier = ['elite', 'miniboss', 'boss'].includes(nodeType) ? nodeType : 'combat';
  const L = boss ? ENEMY_LOADOUTS.boss : ENEMY_LOADOUTS[archetype] || ENEMY_LOADOUTS.standard;
  const pick = (list) => list[Math.floor(rnd() * list.length)];

  const slots = tier === 'combat' ? L.guns.slice(0, 1) : L.guns;
  const gunIds = slots.map(pick);
  if (L.heavy && tier !== 'combat') gunIds[0] = L.heavy;
  const G = CONFIG.gear;
  const scale = G.dmgScale * G.enemyDmgScale * (1 + 0.1 * (f - 1)) * (nodeType === 'boss' ? 1.2 : 1);
  const weapons = gunIds.map((id) => {
    const base = getPart(id);
    return { ...base, dmg: Math.max(2, Math.round(base.dmg * scale * atkMult)), level: 1 };
  });

  const legsId = pick(L.legs);
  const armor = getPart(L.armor);
  const frameId = L.frame || ENEMY_FRAME[tier];
  // Armor resists grow a little with the floor, like the rest of the enemy
  const k = 1 + 0.1 * (f - 1);
  const res = Object.fromEntries(DTYPE_KEYS.map((t) => [t, Math.round((armor?.res?.[t] || 0) * k * 10) / 10]));
  return {
    weapons,
    legs: legsInfo(legsId),
    res,
    parts: [frameId, legsId, armor?.id, ...gunIds].filter(Boolean),
  };
}
