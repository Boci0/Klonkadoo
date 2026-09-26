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
// turn at any range. Enemies carry weapons too and obey the same rules.
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

// ---------- Catalog (51 parts) ----------
// Weapons: range [min, max] in world px, dmg per shot, en = energy per shot, heat = heat per shot,
// ammo = shots per battle (strong guns only), arc = lobbed over cover
// (everything else needs a clear line to the target).
// fx: burn / freeze / corrode / splash / chain / pierce (ignores DEF) / leech / crit
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

  // Legs (weightless, like frames): move = { min, max } launch speed (px/s) you can use, optional
  // minDeg / maxDeg launch elevation; anchored = can't move at all;
  // moveEn = energy per move; freeMove = first move each turn uses no action
  { id: 'lg_strider', type: 'legs', name: 'STRIDER LEGS', rarity: 'common', move: { min: 380, max: 1000 }, desc: 'Medium jumps.' },
  { id: 'lg_hopper', type: 'legs', name: 'HOPPER LEGS', rarity: 'common', move: { min: 150, max: 650 }, desc: 'Short, precise hops. Can\'t go far.' },
  { id: 'lg_treads', type: 'legs', name: 'TANK TREADS', rarity: 'common', hp: 12, move: { min: 250, max: 1150, minDeg: -10, maxDeg: 25 }, desc: 'Low, skimming launches only. +12 HP.' },
  { id: 'lg_catapult', type: 'legs', name: 'CATAPULT LEGS', rarity: 'rare', move: { min: 900, max: 1400 }, desc: 'Long leaps only: no small steps.' },
  { id: 'lg_jumpjets', type: 'legs', name: 'JUMP JETS', rarity: 'rare', move: { min: 350, max: 1250, minDeg: 50, maxDeg: 88 }, desc: 'Steep arcs only: hop over cover.' },
  { id: 'lg_coil', type: 'legs', name: 'COIL SPRINGS', rarity: 'epic', move: { min: 150, max: 1150 }, desc: 'Short to long range.' },
  { id: 'lg_anchor', type: 'legs', name: 'ANCHOR CLAMPS', rarity: 'epic', hp: 30, def: 4, atkPct: 0.2, anchored: true, desc: 'Bolted down: you can\'t move. +30 HP, +4 DEF, +20% gun damage.' },
  { id: 'lg_thrusters', type: 'legs', name: 'THRUSTERS', rarity: 'legendary', move: { min: 150, max: 1400 }, moveEn: 6, desc: 'Any range, but each move costs 6 energy.' },
  { id: 'lg_phase', type: 'legs', name: 'PHASE STRIDERS', rarity: 'mythic', move: { min: 150, max: 1300 }, freeMove: true, color: '#ff5d73', desc: 'Your first move each turn uses no action.' },

  // Armor
  { id: 'ar_scrap', type: 'armor', name: 'SCRAP PLATES', rarity: 'common', weight: 10, hp: 15 },
  { id: 'ar_kevlar', type: 'armor', name: 'KEVLAR WEAVE', rarity: 'common', weight: 8, def: 1.5 },
  { id: 'ar_reactive', type: 'armor', name: 'REACTIVE ARMOR', rarity: 'rare', weight: 16, hp: 16, def: 2 },
  { id: 'ar_aegis', type: 'armor', name: 'AEGIS SHELL', rarity: 'epic', weight: 22, hp: 22, def: 2.5, startForcefield: true, desc: 'Start each battle with a Forcefield.' },
  { id: 'ar_titanium', type: 'armor', name: 'TITANIUM HULL', rarity: 'legendary', weight: 28, hp: 30, def: 3 },
  { id: 'ar_void', type: 'armor', name: 'VOID CARAPACE', rarity: 'mythic', weight: 28, hp: 34, def: 3.5, startForcefield: true, color: '#ff5d73', desc: 'Start each battle with a Forcefield.' },

  // Weapons
  { id: 'wp_blaster', type: 'weapon', name: 'PULSE BLASTER', rarity: 'common', weight: 12, range: [0, 340], dmg: 8, en: 8, heat: 6, color: '#73eff7' },
  { id: 'wp_scatter', type: 'weapon', name: 'SCATTERGUN', rarity: 'common', weight: 14, range: [0, 210], dmg: 14, en: 10, heat: 10, color: '#ffcd75' },
  { id: 'wp_acid', type: 'weapon', name: 'ACID SPRAYER', rarity: 'common', weight: 12, range: [0, 270], dmg: 5, en: 6, heat: 4, fx: { corrode: 1 }, color: '#a7f070', desc: 'Strips 1 DEF per hit.' },
  { id: 'wp_smg', type: 'weapon', name: 'AUTO SMG', rarity: 'common', weight: 12, range: [0, 300], dmg: 3, en: 6, heat: 12, fx: { burst: 3 }, color: '#f4f4f4', desc: 'Fires 3 rounds. Runs hot.' },
  { id: 'wp_repulsor', type: 'weapon', name: 'REPULSOR', rarity: 'common', weight: 10, range: [0, 260], dmg: 4, en: 8, heat: 6, fx: { push: 620 }, color: '#41a6f6', desc: 'Blasts the target away.' },
  { id: 'wp_rifle', type: 'weapon', name: 'LONG RIFLE', rarity: 'rare', weight: 18, range: [320, 780], dmg: 14, en: 10, heat: 12, color: '#f4f4f4' },
  { id: 'wp_flamer', type: 'weapon', name: 'FLAMER', rarity: 'rare', weight: 16, range: [0, 190], dmg: 6, en: 6, heat: 14, fx: { burn: 2 }, color: '#ef7d57', desc: 'Burns for 2 turns.' },
  { id: 'wp_mortar', type: 'weapon', name: 'MORTAR', rarity: 'rare', weight: 22, range: [360, 1000], dmg: 15, en: 14, heat: 10, arc: true, fx: { splash: 110 }, color: '#ef7d57', desc: 'Lobbed. Splashes enemies near the target.' },
  { id: 'wp_cryo', type: 'weapon', name: 'CRYO CANNON', rarity: 'rare', weight: 18, range: [150, 520], dmg: 8, en: 12, heat: 2, fx: { freeze: true }, color: '#73eff7', desc: 'Freezes: their next launch is weaker.' },
  { id: 'wp_beam', type: 'weapon', name: 'LASER BEAM', rarity: 'rare', weight: 16, range: [0, 620], dmg: 7, en: 12, heat: 14, fx: { line: true }, color: '#ff5d73', desc: 'Hits every enemy along the beam.' },
  { id: 'wp_emp', type: 'weapon', name: 'EMP BURST', rarity: 'rare', weight: 14, range: [0, 380], dmg: 4, en: 10, heat: 6, fx: { drain: 14 }, color: '#c46fd6', desc: 'Drains 14 of their energy.' },
  { id: 'wp_grapple', type: 'weapon', name: 'GRAPPLE HOOK', rarity: 'rare', weight: 12, range: [180, 720], dmg: 4, en: 8, heat: 4, fx: { pull: 620 }, color: '#94b0c2', desc: 'Drags the target toward you.' },
  { id: 'wp_minelauncher', type: 'weapon', name: 'MINE LAUNCHER', rarity: 'rare', weight: 16, range: [150, 900], dmg: 16, en: 8, heat: 6, ammo: 3, arc: true, fx: { mine: true }, color: '#ef7d57', desc: 'Lobs a mine near the target: it blasts whoever steps on it. 3 mines.' },
  { id: 'wp_rocket', type: 'weapon', name: 'ROCKET LAUNCHER', rarity: 'rare', weight: 20, range: [220, 950], dmg: 20, en: 10, heat: 10, ammo: 2, arc: true, fx: { splash: 90 }, color: '#ffcd75', desc: 'Lobbed. 2 rockets per battle.' },
  { id: 'wp_tesla', type: 'weapon', name: 'TESLA COIL', rarity: 'epic', weight: 20, range: [0, 400], dmg: 11, en: 16, heat: 12, fx: { chain: 260 }, color: '#c46fd6', desc: 'Arcs to a second enemy.' },
  { id: 'wp_missiles', type: 'weapon', name: 'MISSILE POD', rarity: 'epic', weight: 24, range: [0, 1400], dmg: 12, en: 12, heat: 8, ammo: 3, arc: true, color: '#ff5d73', desc: 'Any range, over cover. 3 salvos.' },
  { id: 'wp_rail', type: 'weapon', name: 'RAIL LANCE', rarity: 'epic', weight: 26, range: [450, 1150], dmg: 22, en: 20, heat: 18, fx: { pierce: true }, color: '#41a6f6', desc: 'Ignores DEF.' },
  { id: 'wp_heatray', type: 'weapon', name: 'HEAT RAY', rarity: 'epic', weight: 18, range: [0, 480], dmg: 6, en: 10, heat: 8, fx: { heat: 16 }, color: '#ef7d57', desc: 'Pumps 16 heat into the target.' },
  { id: 'wp_howitzer', type: 'weapon', name: 'SIEGE HOWITZER', rarity: 'legendary', weight: 34, range: [520, 1400], dmg: 32, en: 24, heat: 16, ammo: 2, arc: true, fx: { splash: 140 }, color: '#ffcd75', desc: 'Lobbed. 2 shells per battle.' },
  { id: 'wp_scythe', type: 'weapon', name: 'PLASMA SCYTHE', rarity: 'legendary', weight: 24, range: [0, 230], dmg: 26, en: 12, heat: 16, fx: { leech: 0.25 }, color: '#c46fd6', desc: 'Heals you for 25% of damage.' },
  { id: 'wp_sniper', type: 'weapon', name: 'SNIPER CANNON', rarity: 'legendary', weight: 26, range: [620, 1400], dmg: 38, en: 20, heat: 24, ammo: 3, color: '#f4f4f4', desc: 'Huge hit at long range. 3 shots.' },
  { id: 'wp_nova', type: 'weapon', name: 'NOVA LANCE', rarity: 'mythic', weight: 30, range: [0, 1400], dmg: 28, en: 26, heat: 20, ammo: 2, fx: { pierce: true }, color: '#ff5d73', desc: 'Any range. Ignores DEF. 2 shots.' },

  // Drones: act every turn, any range, free to run
  { id: 'dr_gnat', type: 'drone', name: 'GNAT DRONE', rarity: 'common', weight: 6, dmg: 3, color: '#94b0c2' },
  { id: 'dr_hornet', type: 'drone', name: 'HORNET DRONE', rarity: 'rare', weight: 9, dmg: 5, color: '#ffcd75' },
  { id: 'dr_medic', type: 'drone', name: 'MEDIC DRONE', rarity: 'rare', weight: 8, heal: 4, color: '#a7f070', desc: 'Repairs you every turn.' },
  { id: 'dr_guardian', type: 'drone', name: 'GUARDIAN DRONE', rarity: 'epic', weight: 10, forcefieldEvery: 3, color: '#a7f070', desc: 'Forcefield every 3rd turn.' },
  { id: 'dr_reaper', type: 'drone', name: 'REAPER DRONE', rarity: 'legendary', weight: 12, dmg: 9, fx: { crit: 0.2 }, color: '#ffcd75', desc: '20% crit chance.' },
  { id: 'dr_seraph', type: 'drone', name: 'SERAPH DRONE', rarity: 'mythic', weight: 13, dmg: 11, fx: { crit: 0.25 }, color: '#ff5d73', desc: '25% crit chance.' },

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
  { id: 'md_range', type: 'module', name: 'RANGE EXTENDER', rarity: 'epic', weight: 5, rangePct: 0.15 },
  { id: 'md_overclock', type: 'module', name: 'OVERCLOCK CORE', rarity: 'legendary', weight: 8, atkPct: 0.1, weaponDmgPct: 0.12 },
  { id: 'md_singularity', type: 'module', name: 'SINGULARITY CHIP', rarity: 'mythic', weight: 8, atkPct: 0.12, weaponDmgPct: 0.15, crit: 0.03, color: '#ff5d73' },
];

const PART_BY_ID = Object.fromEntries(PARTS.map((p) => [p.id, p]));
export const getPart = (id) => PART_BY_ID[id];

export const STARTER_PARTS = ['fr_scout', 'lg_strider', 'ar_scrap', 'wp_blaster', 'dr_gnat'];
export const STARTER_LOADOUT = { frame: 'fr_scout', legs: 'lg_strider', armor: 'ar_scrap', weapon1: 'wp_blaster', drone: 'dr_gnat' };
/** Movement with no legs fitted (or before legs existed). */
export const DEFAULT_MOVE = { min: 380, max: 1000 };

export const MAX_LEVEL = 10;
export const INVENTORY_CAP = 60;

/** Stats grow 5% per level (LV 10 = x1.45); weight and range don't. */
export const levelMult = (lvl) => 1 + 0.05 * (lvl - 1);

// Numeric fields that scale with level
const SCALING = ['hp', 'def', 'dmg', 'heal', 'atkPct', 'crit', 'powerPct', 'goldPct', 'healAfterWin', 'weaponDmgPct', 'rangePct'];

/** A part's stats at the owned item's level. */
export function partStats(owned) {
  const base = getPart(owned.id);
  if (!base) return null;
  const k = levelMult(owned.level || 1);
  const out = { ...base, level: owned.level || 1, uid: owned.uid };
  for (const f of SCALING) if (typeof base[f] === 'number') out[f] = base[f] * (f === 'hp' || f === 'dmg' || f === 'heal' ? k : 1 + (k - 1) * 0.5);
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
  if (p.def) L.push(`DEF +${p.def.toFixed(1)}`);
  if (p.dmg) L.push(`DMG ${Math.round(p.dmg)}`);
  if (p.range) L.push(`RNG ${p.range[0]}-${p.range[1]}`);
  if (p.move) L.push(`MOVE ${moveLabel(p)}`);
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
  if (p.rangePct) L.push(`RANGE +${Math.round(p.rangePct * 100)}%`);
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
  add(p.dmg, 'dmg', `${Math.round(p.dmg)}`);
  add(p.move, 'move', moveLabel(p));
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
  add(p.rangePct, 'range', `+${Math.round(p.rangePct * 100)}%`);
  add(p.healAfterWin, 'heal', `+${Math.round(p.healAfterWin * 100)}%/WIN`);
  return C;
}

/** Short words for a legs' move band. */
export function moveLabel(p) {
  const m = p.move || DEFAULT_MOVE;
  const reach = m.max <= 700 ? 'SHORT' : m.min >= 850 ? 'LONG' : m.min <= 200 && m.max >= 1100 ? 'ANY' : 'MID';
  const arc = m.minDeg >= 40 ? ' HIGH' : m.maxDeg !== undefined && m.maxDeg <= 30 ? ' LOW' : '';
  return reach + arc;
}

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
    capacity: 0, weight: 0, hp: 0, def: 0, atkPct: 0, crit: 0, powerPct: 0, goldPct: 0,
    healAfterWin: 0, weaponDmgPct: 0, rangePct: 0, startForcefield: false,
    weapons: [], drones: [],
    // Reactor (gear combat): the frame sets it, modules add to it
    energy: 0, regen: 0, heatCap: 0, cool: 0, hasFrame: false,
    legs: null, // the fitted legs (movement rules), null = DEFAULT_MOVE
  };
  const parts = ownedParts.filter(Boolean).map(partStats).filter(Boolean);
  for (const p of parts) {
    if (p.type === 'frame') {
      t.capacity += p.capacity;
      t.hasFrame = true;
    }
    for (const f of ['energy', 'regen', 'heatCap', 'cool']) t[f] += p[f] || 0;
    t.weight += p.weight || 0;
    for (const f of ['hp', 'def', 'atkPct', 'crit', 'powerPct', 'goldPct', 'healAfterWin', 'weaponDmgPct', 'rangePct']) t[f] += p[f] || 0;
    if (p.startForcefield) t.startForcefield = true;
    if (p.type === 'weapon') t.weapons.push(p);
    if (p.type === 'drone') t.drones.push(p);
    if (p.type === 'legs') t.legs = p;
  }
  // Module effects apply to the guns
  t.weapons = t.weapons.map((w) => ({
    ...w,
    dmg: w.dmg * (1 + t.weaponDmgPct),
    range: [w.range[0], Math.round(w.range[1] * (1 + t.rangePct))],
  }));
  if (!t.hasFrame) {
    // No frame: a bare-bones reactor, plus whatever modules add
    const base = CONFIG.gear.baseRig;
    for (const f of ['energy', 'regen', 'heatCap', 'cool']) t[f] += base[f];
  }
  t.overweight = t.weight > t.capacity;
  return t;
}

/** Fold the loadout into the tech tree's permanent stats for a run. */
export function withMech(perm, ownedParts) {
  const t = loadoutTotals(ownedParts);
  return {
    ...perm,
    atkBonus: (perm.atkBonus || 0) + t.atkPct,
    critChance: (perm.critChance || 0) + t.crit,
    hpBonus: (perm.hpBonus || 0) + Math.round(t.hp),
    defBonus: (perm.defBonus || 0) + t.def,
    gearPowerPct: t.powerPct,
    gearGoldPct: t.goldPct,
    mech: {
      weapons: t.weapons,
      drones: t.drones,
      healAfterWin: t.healAfterWin,
      startForcefield: t.startForcefield,
      rig: { energy: t.energy, regen: t.regen, heatCap: t.heatCap, cool: t.cool },
      legs: t.legs ? { id: t.legs.id, name: t.legs.name, move: t.legs.move || null, anchored: !!t.legs.anchored, moveEn: t.legs.moveEn || 0, freeMove: !!t.legs.freeMove } : null,
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
 * Normal fights are the main Key source: elites pay in relics instead.
 */
export const CLEAN_WIN_KEYS = 2; // bonus for a normal fight won without taking damage

export function tokenReward(nodeType, risk = 0) {
  const base = { combat: 3, elite: 2, miniboss: 4, boss: 6 }[nodeType] || 0;
  return Math.round(base * (1 + 0.1 * risk));
}

// ---------- Enemy weapons ----------

// Which guns enemies carry, by floor (every enemy gets at least one)
const ENEMY_POOL = {
  1: ['wp_blaster', 'wp_scatter', 'wp_smg'],
  2: ['wp_blaster', 'wp_scatter', 'wp_acid', 'wp_rifle', 'wp_smg', 'wp_repulsor'],
  3: ['wp_scatter', 'wp_rifle', 'wp_flamer', 'wp_cryo', 'wp_beam', 'wp_grapple', 'wp_emp'],
  4: ['wp_rifle', 'wp_flamer', 'wp_mortar', 'wp_tesla', 'wp_beam', 'wp_rocket', 'wp_heatray'],
  5: ['wp_rifle', 'wp_mortar', 'wp_tesla', 'wp_missiles', 'wp_rail', 'wp_rocket', 'wp_heatray'],
};

/**
 * Legs for one enemy: they move by the same rules. Tanky wall units and
 * snipers favour the extremes (anchored / long leaps), grunts get the basics.
 */
const ENEMY_LEGS = {
  combat: ['lg_strider', 'lg_hopper', 'lg_treads'],
  elite: ['lg_strider', 'lg_coil', 'lg_jumpjets', 'lg_catapult', 'lg_treads'],
  miniboss: ['lg_coil', 'lg_jumpjets', 'lg_catapult', 'lg_thrusters'],
  boss: ['lg_coil', 'lg_thrusters', 'lg_jumpjets'],
};

export function enemyLegs(nodeType, archetype, rnd = Math.random) {
  if (archetype === 'tank' && rnd() < 0.5) return legsInfo('lg_anchor');
  const pool = ENEMY_LEGS[['elite', 'miniboss', 'boss'].includes(nodeType) ? nodeType : 'combat'];
  return legsInfo(pool[Math.floor(rnd() * pool.length)]);
}

function legsInfo(id) {
  const p = getPart(id);
  return { id: p.id, name: p.name, move: p.move || null, anchored: !!p.anchored, moveEn: p.moveEn || 0, freeMove: !!p.freeMove };
}

/** Reactor for one enemy: by fight tier; Risk XI (gunCdCut) makes them cool faster. */
export function enemyRig(nodeType, { cdCut = 0 } = {}) {
  const tier = ['elite', 'miniboss', 'boss'].includes(nodeType) ? nodeType : 'combat';
  const r = CONFIG.gear.enemyRig[tier];
  return { ...r, cool: r.cool + cdCut * 4 };
}

/**
 * Weapons for one enemy. Enemy guns hit softer than yours; elites and
 * bosses carry two. `atkMult` is the same Risk / condition / wave
 * multiplier the enemy's own ATK gets.
 */
export function enemyWeapons(nodeType, floor, rnd = Math.random, { atkMult = 1, archetype = null } = {}) {
  const f = Math.max(1, Math.min(5, floor));
  const count = nodeType === 'combat' ? 1 : 2;
  const pool = [...ENEMY_POOL[f]];
  // Minelayers carry a Mine Launcher (plus their usual gun on elite fights)
  if (archetype === 'minelayer') pool.unshift('wp_minelauncher');
  // Guns are their only damage, so they hit at the gear scale
  const G = CONFIG.gear;
  const scale = G.dmgScale * G.enemyDmgScale * (1 + 0.1 * (f - 1)) * (nodeType === 'boss' ? 1.2 : 1);
  const out = [];
  for (let i = 0; i < count && pool.length; i++) {
    const pick = archetype === 'minelayer' && i === 0 ? 0 : Math.floor(rnd() * pool.length);
    const base = getPart(pool.splice(pick, 1)[0]);
    out.push({ ...base, dmg: Math.max(2, Math.round(base.dmg * scale * atkMult)), level: 1 });
  }
  return out;
}
