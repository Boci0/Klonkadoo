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
  // Above Mythic: only reached with Abyss Shards (CONFIG.abyss.ascend), never dropped
  ascended: { name: 'ASCENDED', color: '#fff1b0', scrap: 300, cost: 6 },
};
export const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary', 'mythic', 'ascended'];
const TOP_DROP_TIER = RARITY_ORDER.indexOf('mythic'); // transforms stop here; ASCENDED needs shards
const rIdx = (r) => Math.max(0, RARITY_ORDER.indexOf(r));

/** Damage types. Explosive also heats the target, Electric drains it (Game._reactorFx). */
export const DTYPES = {
  phys: { name: 'PHYSICAL', short: 'PHY', color: '#f4f4f4', icon: 'dmg' },
  heat: { name: 'EXPLOSIVE', short: 'EXP', color: '#ef7d57', icon: 'heat' },
  energy: { name: 'ELECTRIC', short: 'ELEC', color: '#73eff7', icon: 'energy' },
};
export const DTYPE_KEYS = Object.keys(DTYPES);
/**
 * Your gun damage by type, by role (Super Mechs): Physical hits hardest and does
 * nothing else; Electric drains, and past empty the drain comes off HP; Explosive
 * hits softest but overheats the target into forced cooldowns (enemies: ELEMENT_DMG).
 * (Reloaded at Mythic: Explosive and Electric hit ~85% of Physical.)
 */
export const GUN_TYPE_DMG = { phys: 1, energy: 0.9, heat: 0.85 };
/**
 * Your gun damage by how far it reaches (its max reach), by mount: getting close
 * earns the big hits. Reloaded at Mythic: side guns lose ~20-25% from melee to
 * mid / long range, top guns (long range is their job) only ~10%.
 */
export const REACH_DMG = {
  side: [[2, 1.1], [4, 1], [6, 0.9], [Infinity, 0.85]],
  top: [[3, 1.05], [6, 1], [Infinity, 0.95]],
};
export const reachMult = (p) => (REACH_DMG[p.mount === 'top' ? 'top' : 'side'].find(([max]) => (p.reach?.[1] ?? 1) <= max) || [0, 1])[1];
export const dtypeOf = (w) => (DTYPES[w?.dtype] ? w.dtype : 'phys');
/** A ball's resistance to one damage type, in DEF points. */
export const resistOf = (ball, type) => (ball.def || 0) + (ball.res?.[type] || 0);
/** Resist points as the flat damage they take off each round (CONFIG.gear.resScale). */
export const resistFlat = (pts) => pts * CONFIG.gear.resScale;
/**
 * One round after `pts` resist points (SuperMechs: damage minus resist). The resist counts once per
 * shot, so a burst gun's `rounds` share it. Stripped resist below 0 adds damage; at least resFloor of
 * the round always gets through.
 */
export function flatResist(dmg, pts, rounds = 1) {
  if (!(dmg > 0)) return 0;
  return Math.max(dmg * CONFIG.gear.resFloor, dmg - resistFlat(pts) / Math.max(1, rounds), 0.1);
}

// ---------- Catalog ----------
// Weight in kg (CONFIG.gear.loadCap for the whole mech).
// Weapons: mount side / top, reach [min, max] in lane positions (1 = the next position),
// dmg = average per shot (hits roll ±CONFIG.gear.dmgSpread), en / heat per shot,
// ammo = shots per battle, arc = lobbed (only how the shot flies), backfire = HP it costs YOU per shot.
// foeDmg = the dmg an ENEMY carrying it uses (enemyMech), where yours was raised so rarity ranks at best
// form (tools/tier-report.mjs) without making bosses hit harder.
// fx: burn / freeze / corrode / splash / line (beam) / pierce (ignores resists) / crit
//     burst (hits N times) / drain (burns target energy) / heat (adds target heat) / push / pull
//     resDrain { type: n } (strips that resist for the fight) / mine (plants a mine instead)
//     execute (x1.8 damage below that share of the target's HP) / steal (what it drains goes to you). No gun heals: repairs
//     come from drones, frames and modules only
// Frames and some modules set the reactor: energy (pool), regen (refill at the end of each turn), heatCap, cool (per COOLDOWN).
// `unique` modules fit once per mech. `tiers` [lowest, highest] defaults to [rarity, rarity + 3].
export const PARTS = [
  // Frames: the main HP and the reactor
  { id: 'fr_scout', type: 'frame', name: 'SCOUT FRAME', rarity: 'common', weight: 301, hp: 20, energy: 28, regen: 12, heatCap: 30, cool: 11 },
  { id: 'fr_brawler', type: 'frame', name: 'BRAWLER FRAME', rarity: 'rare', weight: 324, hp: 35, energy: 34, regen: 15, heatCap: 40, cool: 14 },
  { id: 'fr_phantom', type: 'frame', name: 'PHANTOM FRAME', rarity: 'epic', weight: 313, hp: 28, freeFirstShot: true, desc: 'The first gun you fire each battle costs no energy.', energy: 52, regen: 21, heatCap: 44, cool: 17 },
  { id: 'fr_titan', type: 'frame', name: 'TITAN FRAME', rarity: 'epic', weight: 347, hp: 50, energy: 42, regen: 19, heatCap: 54, cool: 19 },
  { id: 'fr_colossus', type: 'frame', name: 'COLOSSUS FRAME', rarity: 'legendary', weight: 362, hp: 66, energy: 56, regen: 24, heatCap: 66, cool: 24 },
  // Build frames: bend the reactor toward one damage type (or toward staying alive)
  { id: 'fr_furnace', type: 'frame', name: 'FURNACE FRAME', rarity: 'rare', weight: 328, hp: 30, energy: 26, regen: 11, heatCap: 48, cool: 18, color: '#ef7d57', desc: 'A huge heat cap and fast cooling on a small battery: built for Explosive and hot guns.' },
  { id: 'fr_conduit', type: 'frame', name: 'CONDUIT FRAME', rarity: 'rare', weight: 309, hp: 22, energy: 48, regen: 19, heatCap: 26, cool: 10, color: '#73eff7', desc: 'A big battery that runs hot fast: built for Electric guns.' },
  { id: 'fr_reclaimer', type: 'frame', name: 'RECLAIMER FRAME', rarity: 'legendary', weight: 351, hp: 56, energy: 55, regen: 24, heatCap: 67, cool: 24, killHeal: 0.07, color: '#a7f070', desc: 'Strips every mech it destroys for parts: repairs 7% of max HP per kill.' },
  { id: 'fr_leviathan', type: 'frame', name: 'LEVIATHAN FRAME', rarity: 'mythic', weight: 370, hp: 87, energy: 72, regen: 31, heatCap: 84, cool: 30, color: '#ff5d73' },
  // Experimental frames: lopsided reactors that reward a build built around the flaw
  { id: 'fr_kiln', type: 'frame', name: 'KILN FRAME', rarity: 'epic', weight: 336, hp: 36, energy: 22, regen: 6, heatCap: 96, cool: 6, color: '#ffcd75', desc: 'A huge heat bank that barely cools: fire hot early, and it carries the heat for the whole fight.' },
  { id: 'fr_capacitor', type: 'frame', name: 'CAPACITOR FRAME', rarity: 'epic', weight: 318, hp: 24, energy: 90, regen: 4, heatCap: 28, cool: 12, color: '#41a6f6', desc: 'A huge battery that hardly recharges: a big opening, then you sip.' },
  { id: 'fr_rampart', type: 'frame', name: 'RAMPART FRAME', rarity: 'legendary', weight: 385, hp: 84, energy: 20, regen: 8, heatCap: 34, cool: 12, color: '#94b0c2', desc: 'Enormous HP on a tiny reactor: only cheap guns fit its battery.' },
  { id: 'fr_revenant', type: 'frame', name: 'REVENANT FRAME', rarity: 'mythic', weight: 358, hp: 62, energy: 50, regen: 22, heatCap: 56, cool: 22, killHeal: 0.05, freeFirstShot: true, color: '#c46fd6', desc: 'Repairs a little with every kill and the first gun each battle is free: built to chain fights.' },
  // Field frames: the second wave, each one bends the reactor or the armor a different way
  { id: 'fr_hauler', type: 'frame', name: 'HAULER FRAME', rarity: 'common', weight: 314, hp: 26, energy: 22, regen: 10, heatCap: 28, cool: 10, color: '#c2a56a', desc: 'A cargo rig with a lot of hull and a tired reactor: tough, but only cheap guns keep up.' },
  { id: 'fr_warden', type: 'frame', name: 'WARDEN FRAME', rarity: 'rare', weight: 335, hp: 28, energy: 32, regen: 13, heatCap: 38, cool: 13, res: { phys: 1, heat: 1, energy: 1 }, color: '#41a6f6', desc: 'Shielded plates across the whole hull: +1 resist to every damage type.' },
  { id: 'fr_gunner', type: 'frame', name: 'GUNNER FRAME', rarity: 'epic', weight: 334, hp: 38, energy: 44, regen: 18, heatCap: 46, cool: 17, atkPct: 0.06, color: '#ef7d57', desc: 'A gun platform with its own fire control: +6% damage.' },
  { id: 'fr_zenith', type: 'frame', name: 'ZENITH FRAME', rarity: 'mythic', weight: 364, hp: 66, energy: 66, regen: 28, heatCap: 70, cool: 27, atkPct: 0.1, color: '#ffcd75', desc: 'A flagship chassis tuned for the opening salvo: +10% damage on a deep reactor.' },

  // Legs decide how you move on the lane and how you STOMP (range 1, knocks back 1):
  // walk = up to N positions along the ground (not through mechs);
  // jump = [min, max] positions, landing exactly there, over mechs and hazards;
  // stompType = the stomp's damage type, stompEn / stompHeat = what it costs you;
  // anchored = can't move at all; moveEn = energy per move; freeMove = first move each turn uses no action
  { id: 'lg_strider', type: 'legs', name: 'STRIDER LEGS', rarity: 'common', weight: 121, hp: 8, walk: 2, stomp: 10, desc: 'The all-rounder.' },
  { id: 'lg_hopper', type: 'legs', name: 'HOPPER LEGS', rarity: 'common', weight: 114, hp: 5, walk: 1, jump: [1, 2], stomp: 8, desc: 'Light, short precise hops.' },
  { id: 'lg_treads', type: 'legs', name: 'TANK TREADS', rarity: 'common', weight: 139, hp: 20, res: { phys: 1 }, walk: 3, stomp: 14, stompHeat: 4, desc: "Fast on the ground, but can't jump. Heavy and tough." },
  { id: 'lg_skids', type: 'legs', name: 'SKID RUNNERS', rarity: 'rare', weight: 114, hp: 7, walk: 3, stomp: 8, desc: "Light and fast on the ground, but can't jump." },
  { id: 'lg_catapult', type: 'legs', name: 'CATAPULT LEGS', rarity: 'rare', weight: 123, hp: 8, walk: 0, jump: [3, 4], stomp: 12, stompHeat: 4, desc: 'Long leaps only: no small steps.' },
  { id: 'lg_jumpjets', type: 'legs', name: 'JUMP JETS', rarity: 'rare', weight: 118, hp: 6, walk: 1, jump: [1, 4], stomp: 10, stompType: 'heat', stompHeat: 4, desc: 'Long hops over mechs, spikes and mines. The stomp scorches (Explosive).' },
  { id: 'lg_coil', type: 'legs', name: 'COIL SPRINGS', rarity: 'epic', weight: 119, hp: 8, walk: 2, jump: [1, 2], stomp: 10, stompType: 'energy', stompEn: 4, stompHeat: 1, desc: 'Walk or hop. The stomp shocks (Electric).' },
  { id: 'lg_anchor', type: 'legs', name: 'ANCHOR CLAMPS', rarity: 'epic', weight: 150, hp: 30, def: 4, atkPct: 0.2, anchored: true, desc: "Bolted down: you can't move or stomp. +4 DEF, +20% gun damage." },
  { id: 'lg_bulwark', type: 'legs', name: 'BULWARK LEGS', rarity: 'legendary', weight: 145, hp: 26, walk: 1, jump: [2, 2], stomp: 14, stompHeat: 6, desc: 'Slow and heavy: lots of HP and a hard stomp.' },
  { id: 'lg_thrusters', type: 'legs', name: 'THRUSTERS', rarity: 'legendary', weight: 125, hp: 10, walk: 3, jump: [1, 3], stomp: 10, stompType: 'heat', stompHeat: 4, moveEn: 4, desc: 'Go anywhere, but each move costs energy. The stomp scorches.' },
  { id: 'lg_phase', type: 'legs', name: 'PHASE STRIDERS', rarity: 'mythic', weight: 121, hp: 14, walk: 2, jump: [1, 3], stomp: 12, stompType: 'energy', stompEn: 4, stompHeat: 1, freeMove: true, color: '#ff5d73', desc: 'Your first move each turn uses no action. The stomp shocks.' },
  // Field legs: the second wave
  { id: 'lg_pogo', type: 'legs', name: 'POGO LEGS', rarity: 'common', weight: 112, hp: 4, walk: 0, jump: [1, 3], stomp: 9, desc: "Spring legs: hops only, no walking. Cheap and light." },
  { id: 'lg_quad', type: 'legs', name: 'QUAD WALKER', rarity: 'rare', weight: 132, hp: 16, walk: 2, stomp: 12, desc: 'Four legs, steady footing: a sturdier Strider.' },
  { id: 'lg_greaves', type: 'legs', name: 'GROUNDED GREAVES', rarity: 'rare', weight: 136, hp: 16, res: { heat: 1, energy: 1 }, walk: 2, stomp: 10, desc: 'Insulated boots: +1 EXP and ELEC resist, and you still walk.' },
  { id: 'lg_piston', type: 'legs', name: 'PISTON LEGS', rarity: 'epic', weight: 140, hp: 20, walk: 1, stomp: 22, stompHeat: 6, color: '#ffcd75', desc: 'Hydraulic rams: a slow walker with the hardest stomp in the garage.' },
  { id: 'lg_stalker', type: 'legs', name: 'STALKER LEGS', rarity: 'legendary', weight: 130, hp: 12, walk: 3, jump: [1, 2], stomp: 12, color: '#a7f070', desc: 'Fast on the ground and nimble over mines, with no energy cost to move.' },

  // SIDE guns
  { id: 'wp_blaster', type: 'weapon', name: 'PULSE BLASTER', rarity: 'common', dtype: 'phys', weight: 31, reach: [1, 3], dmg: 12, en: 5, heat: 5, color: '#73eff7' },
  { id: 'wp_scatter', type: 'weapon', name: 'SCATTERGUN', rarity: 'common', dtype: 'phys', weight: 37, reach: [1, 2], dmg: 15, en: 6, heat: 7, color: '#ffcd75' },
  { id: 'wp_acid', type: 'weapon', name: 'ACID SPRAYER', rarity: 'common', dtype: 'heat', weight: 31, reach: [1, 3], dmg: 9, en: 2, heat: 7, fx: { corrode: 1 }, color: '#a7f070', desc: 'Strips 1 PHY resist per hit.' },
  { id: 'wp_smg', type: 'weapon', name: 'AUTO SMG', rarity: 'common', dtype: 'phys', weight: 31, reach: [1, 3], dmg: 5, en: 6, heat: 7, fx: { burst: 3 }, color: '#f4f4f4', desc: 'Runs hot.' },
  { id: 'wp_repulsor', type: 'weapon', name: 'REPULSOR', rarity: 'common', dtype: 'phys', weight: 34, reach: [1, 2], dmg: 9, en: 6, heat: 6, fx: { push: 2 }, color: '#41a6f6' },
  { id: 'wp_rifle', type: 'weapon', name: 'LONG RIFLE', rarity: 'rare', dtype: 'phys', weight: 47, reach: [4, 7], dmg: 15, en: 7, heat: 7, color: '#f4f4f4' },
  { id: 'wp_flamer', type: 'weapon', name: 'FLAMER', rarity: 'rare', dtype: 'heat', weight: 41, reach: [1, 2], dmg: 10, en: 3, heat: 8, fx: { burn: 2 }, color: '#ef7d57', desc: 'Burns for 2 turns.' },
  { id: 'wp_cryo', type: 'weapon', name: 'CRYO CANNON', rarity: 'rare', dtype: 'heat', weight: 47, reach: [2, 4], dmg: 11, en: 3, heat: 9, fx: { freeze: true }, color: '#73eff7', desc: 'Chills: their next move is 1 position shorter.' },
  { id: 'wp_beam', type: 'weapon', name: 'LASER BEAM', rarity: 'rare', dtype: 'energy', weight: 41, reach: [2, 5], dmg: 13, en: 8, heat: 2, fx: { line: true }, color: '#ff5d73', desc: 'A steady mid-range beam.' },
  { id: 'wp_emp', type: 'weapon', name: 'EMP BURST', rarity: 'rare', dtype: 'energy', weight: 37, reach: [1, 3], dmg: 8, en: 9, heat: 3, fx: { drain: 8 }, color: '#c46fd6' },
  { id: 'wp_grapple', type: 'weapon', name: 'GRAPPLE HOOK', rarity: 'rare', dtype: 'phys', weight: 41, reach: [3, 6], dmg: 9, en: 6, heat: 6, fx: { pull: 2, drag: 1 }, color: '#94b0c2', desc: 'Pulls the target toward you, but the cable drags you 1 toward it too.' },
  { id: 'wp_shredder', type: 'weapon', name: 'SHRED CANNON', rarity: 'rare', dtype: 'phys', weight: 41, reach: [1, 3], dmg: 11, en: 6, heat: 6, fx: { resDrain: { phys: 2 } }, color: '#94b0c2', desc: 'Strips 2 PHY resist per hit, for the rest of the fight.' },
  { id: 'wp_tesla', type: 'weapon', name: 'TESLA COIL', rarity: 'epic', dtype: 'energy', weight: 54, reach: [1, 2], dmg: 17, foeDmg: 16, en: 10, heat: 3, fx: { line: true }, color: '#c46fd6', desc: 'A short-range electric arc.' },
  { id: 'wp_heatray', type: 'weapon', name: 'HEAT RAY', rarity: 'epic', dtype: 'heat', weight: 47, reach: [2, 4], dmg: 11, en: 4, heat: 10, fx: { heat: 14 }, color: '#ef7d57' },
  { id: 'wp_scorcher', type: 'weapon', name: 'SCORCH CANNON', rarity: 'epic', dtype: 'heat', weight: 47, reach: [2, 5], dmg: 11, en: 4, heat: 8, fx: { resDrain: { heat: 2 } }, color: '#ffcd75', desc: 'Strips 2 EXP resist per hit, for the rest of the fight.' },
  { id: 'wp_ionizer', type: 'weapon', name: 'ION PROJECTOR', rarity: 'epic', dtype: 'energy', weight: 47, reach: [2, 5], dmg: 11, en: 8, heat: 3, fx: { resDrain: { energy: 2 } }, color: '#73eff7', desc: 'Strips 2 ELEC resist per hit, for the rest of the fight.' },
  { id: 'wp_impact', type: 'weapon', name: 'IMPACT CANNON', rarity: 'epic', dtype: 'phys', weight: 67, reach: [3, 6], dmg: 12, en: 7, heat: 8, fx: { push: 3 }, color: '#f4f4f4', desc: 'Into the edge: the target slams for extra damage.' },
  { id: 'wp_scythe', type: 'weapon', name: 'PLASMA SCYTHE', rarity: 'legendary', dtype: 'energy', weight: 67, reach: [1, 1], dmg: 24, en: 14, heat: 5, backfire: 4, color: '#c46fd6', desc: 'A brutal energy blade: huge damage, right next to the enemy only.' },
  // Finishers and sustain: battles don't heal you any more, so HP won back mid-fight matters
  { id: 'wp_breacher', type: 'weapon', name: 'BREACHER', rarity: 'rare', dtype: 'phys', weight: 44, reach: [1, 3], dmg: 11, en: 6, heat: 7, fx: { execute: 0.35 }, color: '#ff5d73', icon: 'wp_scatter', desc: 'A finisher: x1.8 damage against a target below 35% HP.' },
  { id: 'wp_needler', type: 'weapon', name: 'NEEDLE RIFLE', rarity: 'epic', dtype: 'phys', weight: 41, reach: [2, 5], dmg: 9, en: 8, heat: 5, fx: { pierce: true }, color: '#94b0c2', icon: 'wp_rifle', desc: 'Tungsten needles: ignores resists. The side-mount answer to armored mechs.' },
  { id: 'wp_siphon', type: 'weapon', name: 'SIPHON RAY', rarity: 'epic', dtype: 'energy', weight: 47, reach: [1, 3], dmg: 11, en: 9, heat: 4, fx: { line: true, drain: 6, steal: true }, color: '#a7f070', icon: 'wp_beam', desc: 'What it drains goes into your battery (energy only, never HP).' },
  { id: 'wp_omega', type: 'weapon', name: 'OMEGA REPEATER', rarity: 'mythic', dtype: 'phys', weight: 57, reach: [1, 3], dmg: 7, en: 10, heat: 8, fx: { burst: 4, crit: 0.15 }, color: '#ff5d73', icon: 'wp_smg', desc: 'Every round has +15% crit chance.' },
  { id: 'wp_stinger', type: 'weapon', name: 'STINGER', rarity: 'common', dtype: 'phys', weight: 24, reach: [2, 4], dmg: 11, en: 4, heat: 5, color: '#ffcd75', icon: 'wp_blaster', desc: 'A light mid-range pistol.' },
  { id: 'wp_arcwelder', type: 'weapon', name: 'ARC WELDER', rarity: 'rare', dtype: 'energy', weight: 39, reach: [1, 2], dmg: 12, en: 8, heat: 3, fx: { line: true, drain: 5 }, color: '#73eff7', icon: 'wp_tesla', desc: 'A short arc that drains a little energy.' },
  { id: 'wp_slagger', type: 'weapon', name: 'SLAG GUN', rarity: 'rare', dtype: 'heat', weight: 41, reach: [1, 3], dmg: 9, en: 3, heat: 8, fx: { burn: 1, resDrain: { heat: 1 } }, color: '#ffcd75', icon: 'wp_flamer', desc: 'Molten slag: burns for 1 turn and strips 1 EXP resist per hit.' },
  { id: 'wp_cutter', type: 'weapon', name: 'PLASMA CUTTER', rarity: 'epic', dtype: 'heat', weight: 52, reach: [2, 4], dmg: 14, en: 4, heat: 9, fx: { line: true, burn: 2 }, color: '#ef7d57', icon: 'wp_beam', desc: 'A cutting beam that leaves the target burning for 2 turns.' },
  { id: 'wp_judge', type: 'weapon', name: 'VERDICT PISTOL', rarity: 'legendary', dtype: 'phys', weight: 54, reach: [1, 3], dmg: 19, en: 8, heat: 8, fx: { execute: 0.5 }, color: '#ff5d73', icon: 'wp_breacher', desc: 'A finisher: x1.8 damage against a target below 50% HP.' },
  { id: 'wp_voltarc', type: 'weapon', name: 'VOLT ARC', rarity: 'legendary', dtype: 'energy', weight: 58, reach: [1, 3], dmg: 17, en: 11, heat: 4, fx: { line: true, drain: 12 }, color: '#c46fd6', icon: 'wp_arclash', desc: 'A heavy arc that drains hard as it cuts.' },
  { id: 'wp_helix', type: 'weapon', name: 'HELIX CHAINGUN', rarity: 'mythic', dtype: 'energy', weight: 56, reach: [1, 3], dmg: 8, en: 11, heat: 4, fx: { burst: 3, crit: 0.15, drain: 5 }, color: '#ff5d73', icon: 'wp_omega', desc: 'Three rounds a shot, each draining energy, +15% crit chance on every round.' },
  // Explosive specialists: cook the target until it locks up, then cash the heat in
  { id: 'wp_blowtorch', type: 'weapon', name: 'BLOWTORCH', rarity: 'common', dtype: 'heat', weight: 18, reach: [1, 2], dmg: 5, en: 3, heat: 7, fx: { heat: 16 }, color: '#ef7d57', desc: 'Weak hit, but pumps a lot of heat into the target.' },
  { id: 'wp_dragon', type: 'weapon', name: 'DRAGON SHOTGUN', rarity: 'rare', dtype: 'heat', weight: 41, reach: [1, 2], dmg: 6, en: 4, heat: 7, fx: { burst: 2, burn: 2 }, color: '#ef7d57', icon: 'wp_scatter', desc: 'The target burns for 2 turns.' },
  { id: 'wp_rupturer', type: 'weapon', name: 'COOLANT RUPTURER', rarity: 'epic', dtype: 'heat', weight: 41, reach: [2, 4], dmg: 10, en: 3, heat: 9, fx: { coolDmg: 3 }, color: '#ffcd75', desc: 'Cracks their coolant: less cooling for the rest of the fight (stacks, down to a floor).' },
  { id: 'wp_thermal', type: 'weapon', name: 'THERMAL LANCE', rarity: 'epic', dtype: 'heat', weight: 54, reach: [2, 5], dmg: 14, en: 4, heat: 9, fx: { line: true, hotBonus: true }, color: '#ef7d57', desc: 'Double damage against a target above 75% of its heat cap.' },
  // Electric specialists: starve the target so it can't shoot
  { id: 'wp_spark', type: 'weapon', name: 'SPARK PISTOL', rarity: 'common', dtype: 'energy', weight: 18, reach: [1, 3], dmg: 5, en: 7, heat: 2, fx: { drain: 8 }, color: '#73eff7', desc: 'Weak hit, but drains a lot of energy.' },
  { id: 'wp_leech', type: 'weapon', name: 'LEECH COIL', rarity: 'rare', dtype: 'energy', weight: 37, reach: [1, 3], dmg: 7, en: 10, heat: 3, fx: { drain: 7, steal: true }, color: '#a7f070', desc: 'The energy it drains goes to you (energy only, never HP).' },
  { id: 'wp_gridbreaker', type: 'weapon', name: 'GRID BREAKER', rarity: 'epic', dtype: 'energy', weight: 47, reach: [2, 5], dmg: 10, en: 10, heat: 3, fx: { regenDmg: 4 }, color: '#41a6f6', desc: 'Breaks their generator: less regen for the rest of the fight (stacks, down to a floor).' },
  { id: 'wp_capdump', type: 'weapon', name: 'CAPACITOR DUMP', rarity: 'epic', dtype: 'energy', weight: 41, reach: [1, 3], dmg: 8, en: 7, heat: 2, fx: { dump: true }, color: '#c46fd6', desc: 'Spends ALL your remaining energy: +1 damage for every 2 energy spent.' },
  // Close-range heavies: big hits right next to the enemy
  { id: 'wp_magma', type: 'weapon', name: 'MAGMA FIST', rarity: 'epic', dtype: 'heat', weight: 57, reach: [1, 2], dmg: 17, en: 4, heat: 10, fx: { heat: 13 }, color: '#ef7d57', desc: 'A molten punch: a big hit up close that pumps heat into the target.' },
  { id: 'wp_breaker', type: 'weapon', name: 'BREAKER RAM', rarity: 'legendary', dtype: 'phys', weight: 73, reach: [1, 2], dmg: 24, foeDmg: 22, en: 10, heat: 9, backfire: 3, fx: { push: 2 }, color: '#f4f4f4', desc: 'Into the edge: the target slams for extra damage.' },
  { id: 'wp_phoenix', type: 'weapon', name: 'PHOENIX CLAW', rarity: 'mythic', dtype: 'heat', weight: 67, reach: [1, 2], dmg: 12, en: 4, heat: 12, fx: { burst: 2, heat: 10, hotBonus: true }, color: '#ff5d73', desc: 'Double damage against a target above 75% of its heat cap.' },
  // Self-powered / sealed guns: no energy cost (they run hot) or no heat (they drink energy), but heavy
  { id: 'wp_recoil', type: 'weapon', name: 'RECOIL CANNON', rarity: 'rare', dtype: 'phys', weight: 60, reach: [1, 3], dmg: 12, en: 0, heat: 8, color: '#94b0c2', icon: 'wp_blaster', desc: 'Spring-loaded: costs no energy, but it runs hot. Heavy.' },
  { id: 'wp_gauss', type: 'weapon', name: 'GAUSS RIFLE', rarity: 'epic', dtype: 'phys', weight: 86, reach: [3, 6], dmg: 15, en: 12, heat: 0, color: '#41a6f6', icon: 'wp_rifle', desc: 'Magnetic rails: makes no heat, but it drinks energy. Heavy.' },
  { id: 'wp_chem', type: 'weapon', name: 'CHEM THROWER', rarity: 'rare', dtype: 'heat', weight: 73, reach: [1, 3], dmg: 10, en: 0, heat: 11, fx: { heat: 10 }, color: '#ef7d57', icon: 'wp_flamer', desc: 'Pressure-fed: costs no energy and pumps heat into the target, but it runs hot. Heavy.' },
  // Experimental guns
  { id: 'wp_piledriver', type: 'weapon', name: 'PILEDRIVER', rarity: 'epic', dtype: 'phys', weight: 70, reach: [1, 2], dmg: 19, foeDmg: 16, en: 11, heat: 8, fx: { push: 2 }, color: '#f4f4f4', desc: 'A heavy close-range hammer that shoves the target back.' },
  { id: 'wp_arclash', type: 'weapon', name: 'ARC LASH', rarity: 'epic', dtype: 'energy', weight: 47, reach: [1, 3], dmg: 13, en: 8, heat: 3, fx: { line: true, drain: 14 }, color: '#73eff7', desc: 'A beam that drains as it cuts.' },
  { id: 'wp_singularity', type: 'weapon', name: 'SINGULARITY BEAM', rarity: 'mythic', dtype: 'energy', weight: 62, reach: [1, 4], dmg: 22, foeDmg: 15, en: 14, heat: 5, fx: { line: true, drain: 24, regenDmg: 3 }, color: '#ff5d73', desc: 'A beam that drains as it cuts and breaks their generator: less regen for the rest of the fight (stacks, down to a floor).' },
  { id: 'wp_dynamo', type: 'weapon', name: 'DYNAMO GUN', rarity: 'rare', dtype: 'energy', weight: 54, reach: [1, 3], dmg: 9, en: 0, heat: 11, fx: { drain: 3 }, color: '#73eff7', icon: 'wp_spark', desc: 'Runs on its own dynamo: costs no energy and drains theirs, but it runs hot. Heavy.' },

  // TOP guns: the heavy and lobbed ones
  { id: 'wp_mortar', type: 'weapon', mount: 'top', name: 'MORTAR', rarity: 'rare', dtype: 'phys', weight: 42, reach: [4, 8], dmg: 14, en: 9, heat: 9, arc: true, fx: { splash: 1 }, color: '#ef7d57', desc: 'A lobbed shell that splashes.' },
  { id: 'wp_minelauncher', type: 'weapon', mount: 'top', name: 'MINE LAUNCHER', rarity: 'rare', dtype: 'phys', weight: 19, reach: [2, 6], dmg: 17, en: 5, heat: 5, ammo: 3, arc: true, fx: { mine: true }, color: '#ef7d57', desc: 'Plants a mine next to the target: it blasts whoever steps there.' },
  { id: 'wp_rocket', type: 'weapon', mount: 'top', name: 'ROCKET LAUNCHER', rarity: 'rare', dtype: 'phys', weight: 26, reach: [3, 6], dmg: 19, en: 6, heat: 7, ammo: 2, arc: true, fx: { splash: 1 }, color: '#ffcd75' },
  { id: 'wp_concussion', type: 'weapon', mount: 'top', name: 'CONCUSSION MORTAR', rarity: 'rare', dtype: 'phys', weight: 35, reach: [4, 8], dmg: 9, en: 6, heat: 7, arc: true, fx: { push: 2 }, color: '#94b0c2', desc: 'Into the edge: the target slams for extra damage.' },
  { id: 'wp_napalm', type: 'weapon', mount: 'top', name: 'NAPALM LAUNCHER', rarity: 'rare', dtype: 'heat', weight: 29, reach: [3, 6], dmg: 8, en: 4, heat: 10, arc: true, fx: { heat: 11, napalm: 2 }, color: '#ff5d73', desc: "Sets the target's plate on fire for 2 turns: heat to whoever stands or lands there." },
  { id: 'wp_harpoon', type: 'weapon', mount: 'top', name: 'HARPOON CANNON', rarity: 'rare', dtype: 'phys', weight: 39, reach: [4, 8], dmg: 13, en: 6, heat: 7, fx: { pull: 3 }, color: '#94b0c2', icon: 'wp_grapple', desc: 'Sets up stomps, rams, short guns and mines in its way.' },
  { id: 'wp_arcmortar', type: 'weapon', mount: 'top', name: 'ARC MORTAR', rarity: 'epic', dtype: 'energy', weight: 39, reach: [3, 6], dmg: 11, en: 10, heat: 5, arc: true, fx: { drain: 6 }, color: '#73eff7', icon: 'wp_mortar' },
  { id: 'wp_missiles', type: 'weapon', mount: 'top', name: 'MISSILE POD', rarity: 'epic', dtype: 'phys', weight: 39, reach: [3, 6], dmg: 24, foeDmg: 16, en: 5, heat: 5, ammo: 3, arc: true, color: '#ff5d73' },
  { id: 'wp_rail', type: 'weapon', mount: 'top', name: 'RAIL LANCE', rarity: 'epic', dtype: 'energy', weight: 52, reach: [5, 8], dmg: 20, en: 14, heat: 6, backfire: 3, fx: { pierce: true }, color: '#41a6f6', desc: 'Ignores resists.' },
  { id: 'wp_howitzer', type: 'weapon', mount: 'top', name: 'SIEGE HOWITZER', rarity: 'legendary', dtype: 'phys', weight: 59, reach: [6, 9], dmg: 32, foeDmg: 24, en: 10, heat: 10, ammo: 2, backfire: 5, arc: true, fx: { splash: 1 }, color: '#ffcd75' },
  { id: 'wp_sniper', type: 'weapon', mount: 'top', name: 'SNIPER CANNON', rarity: 'legendary', dtype: 'phys', weight: 42, reach: [7, 10], dmg: 32, foeDmg: 23, en: 8, heat: 8, ammo: 3, color: '#f4f4f4' },
  { id: 'wp_meltdown', type: 'weapon', mount: 'top', name: 'MELTDOWN CANNON', rarity: 'legendary', dtype: 'heat', weight: 52, reach: [3, 6], dmg: 12, en: 4, heat: 9, fx: { meltdown: true }, color: '#ffcd75', desc: 'Against an overheating target: its heat over the cap blasts out as 2x damage, and it drops back to its cap (so it keeps its turn).' },
  { id: 'wp_blackout', type: 'weapon', mount: 'top', name: 'BLACKOUT CANNON', rarity: 'legendary', dtype: 'energy', weight: 52, reach: [3, 6], dmg: 12, en: 14, heat: 6, fx: { drain: 14, regenDmg: 3 }, color: '#29366f', desc: 'Drains hard and breaks their generator: less regen for the rest of the fight (stacks, down to a floor). Starve them and their guns go quiet.' },
  { id: 'wp_cluster', type: 'weapon', mount: 'top', name: 'CLUSTER BOMB', rarity: 'legendary', dtype: 'heat', weight: 42, reach: [4, 8], dmg: 8, en: 4, heat: 9, ammo: 3, arc: true, fx: { burst: 3 }, color: '#ef7d57', icon: 'wp_rocket' },
  { id: 'wp_nova', type: 'weapon', mount: 'top', name: 'NOVA LANCE', rarity: 'mythic', dtype: 'energy', weight: 52, reach: [3, 5], dmg: 34, foeDmg: 24, en: 12, heat: 4, ammo: 2, backfire: 5, fx: { pierce: true }, color: '#ff5d73' },
  // Close-range top guns: a big gun that works right next to the enemy
  { id: 'wp_flak', type: 'weapon', mount: 'top', name: 'FLAK TURRET', rarity: 'rare', dtype: 'phys', weight: 32, reach: [1, 3], dmg: 8, en: 6, heat: 7, fx: { burst: 2 }, color: '#94b0c2' },
  { id: 'wp_arcturret', type: 'weapon', mount: 'top', name: 'ARC TURRET', rarity: 'epic', dtype: 'energy', weight: 42, reach: [1, 2], dmg: 14, en: 9, heat: 4, fx: { drain: 6, lowEnBonus: true }, color: '#73eff7', desc: 'Double damage against a target under 25% of its max energy.' },
  { id: 'wp_inferno', type: 'weapon', mount: 'top', name: 'INFERNO CANNON', rarity: 'legendary', dtype: 'heat', weight: 62, reach: [1, 3], dmg: 14, en: 4, heat: 11, fx: { heat: 10, burn: 3 }, color: '#ff5d73', desc: 'Floods the space in front of you: the target burns for 3 turns.' },
  { id: 'wp_thermite', type: 'weapon', mount: 'top', name: 'THERMITE LAUNCHER', rarity: 'epic', dtype: 'heat', weight: 75, reach: [3, 6], dmg: 12, en: 8, heat: 0, arc: true, fx: { heat: 11 }, color: '#ffcd75', icon: 'wp_napalm', desc: 'Sealed charges: makes no heat for you (the target gets it all), but it drinks energy. Heavy.' },
  { id: 'wp_faultline', type: 'weapon', mount: 'top', name: 'FAULT LINE MORTAR', rarity: 'legendary', dtype: 'phys', weight: 60, reach: [3, 6], dmg: 30, foeDmg: 22, en: 11, heat: 9, ammo: 2, arc: true, fx: { splash: 1, push: 1 }, color: '#ffcd75', desc: 'A shell that cracks the ground: it splashes and shoves the target back.' },
  { id: 'wp_stormcaller', type: 'weapon', mount: 'top', name: 'STORMCALLER', rarity: 'legendary', dtype: 'energy', weight: 55, reach: [3, 6], dmg: 14, foeDmg: 12, en: 10, heat: 5, fx: { drain: 16, pierce: true }, color: '#c46fd6', desc: 'Chain lightning: ignores resists and drains hard.' },
  { id: 'wp_supercon', type: 'weapon', mount: 'top', name: 'SUPERCONDUCTOR', rarity: 'epic', dtype: 'energy', weight: 72, reach: [2, 5], dmg: 15, en: 10, heat: 0, fx: { line: true }, color: '#c46fd6', icon: 'wp_beam', desc: 'Supercooled coil: makes no heat at all, but it drinks energy. Heavy.' },
  // Field top guns: the second wave
  { id: 'wp_slingshot', type: 'weapon', mount: 'top', name: 'SLINGSHOT', rarity: 'common', dtype: 'phys', weight: 24, reach: [3, 6], dmg: 10, en: 5, heat: 6, arc: true, color: '#ffcd75', icon: 'wp_mortar', desc: 'A cheap lobbed shot.' },
  { id: 'wp_chainmortar', type: 'weapon', mount: 'top', name: 'CHAIN MORTAR', rarity: 'rare', dtype: 'phys', weight: 38, reach: [4, 7], dmg: 7, en: 7, heat: 8, arc: true, fx: { burst: 2 }, color: '#ef7d57', icon: 'wp_mortar', desc: 'Two shells a shot.' },
  { id: 'wp_tracer', type: 'weapon', mount: 'top', name: 'TRACER BEAM', rarity: 'rare', dtype: 'energy', weight: 38, reach: [5, 8], dmg: 12, en: 9, heat: 3, fx: { line: true }, color: '#73eff7', icon: 'wp_rail', desc: 'A long, steady energy beam.' },
  { id: 'wp_brimstone', type: 'weapon', mount: 'top', name: 'BRIMSTONE MORTAR', rarity: 'epic', dtype: 'heat', weight: 47, reach: [3, 6], dmg: 10, en: 4, heat: 10, arc: true, fx: { splash: 1, heat: 9 }, color: '#ef7d57', icon: 'wp_cluster', desc: 'A lobbed shell that splashes and pumps heat into the target.' },
  { id: 'wp_gravwell', type: 'weapon', mount: 'top', name: 'GRAVITY WELL', rarity: 'epic', dtype: 'phys', weight: 45, reach: [4, 8], dmg: 12, en: 8, heat: 8, arc: true, fx: { pull: 2, splash: 1 }, color: '#94b0c2', icon: 'wp_harpoon', desc: 'A lobbed shell that splashes and drags the target 2 toward you.' },
  { id: 'wp_orbital', type: 'weapon', mount: 'top', name: 'ORBITAL LANCE', rarity: 'legendary', dtype: 'energy', weight: 46, reach: [5, 9], dmg: 26, foeDmg: 19, en: 12, heat: 5, ammo: 2, backfire: 4, fx: { pierce: true }, color: '#41a6f6', icon: 'wp_nova', desc: 'A long-range strike from above: ignores resists.' },
  { id: 'wp_pyre', type: 'weapon', mount: 'top', name: 'PYRE LAUNCHER', rarity: 'legendary', dtype: 'heat', weight: 50, reach: [4, 8], dmg: 14, en: 5, heat: 11, arc: true, fx: { splash: 1, napalm: 3, heat: 12 }, color: '#ff5d73', icon: 'wp_napalm', desc: 'Sets the target\'s plate on fire for 3 turns and splashes.' },
  { id: 'wp_citadel', type: 'weapon', mount: 'top', name: 'CITADEL BREAKER', rarity: 'mythic', dtype: 'phys', weight: 64, reach: [4, 8], dmg: 42, foeDmg: 28, en: 12, heat: 11, ammo: 2, backfire: 6, arc: true, fx: { splash: 1 }, color: '#ff5d73', icon: 'wp_howitzer', desc: 'A siege shell that levels the lane: splashes, and it hurts you to fire.' },

  // Specials: one slot each (CHARGE / TELEPORT / HOOK), an action each, a few uses per battle
  { id: 'sp_charge', type: 'special', name: 'CHARGE BOOSTER', rarity: 'common', weight: 14, special: 'charge', dist: 4, ram: 10, uses: 2, en: 4, heat: 7, color: '#ffcd75', desc: 'Dash toward the enemy. End next to it and you ram it: Physical damage and a knockback.' },
  { id: 'sp_retro', type: 'special', name: 'RETRO ROCKETS', rarity: 'common', weight: 11, special: 'charge', away: true, dist: 4, uses: 2, en: 4, heat: 6, color: '#73eff7', icon: 'sp_charge', desc: 'Blast AWAY from the enemy. No ram: it makes room for long guns.' },
  { id: 'sp_ram', type: 'special', name: 'RAM BOOSTER', rarity: 'epic', weight: 26, special: 'charge', dist: 5, ram: 18, uses: 2, en: 6, heat: 10, color: '#ef7d57', desc: 'Dash toward the enemy and ram it hard: Physical damage and a knockback.' },
  { id: 'sp_teleport', type: 'special', name: 'TELEPORTER', rarity: 'epic', weight: 19, special: 'teleport', uses: 1, en: 10, heat: 3, color: '#c46fd6', desc: 'Blink to any free position.' },
  { id: 'sp_blink', type: 'special', name: 'BLINK DRIVE', rarity: 'legendary', weight: 24, special: 'teleport', uses: 2, en: 11, heat: 3, color: '#73eff7', icon: 'sp_teleport', desc: 'Blink to any free position.' },
  { id: 'sp_hook', type: 'special', name: 'GRAPPLING HOOK', rarity: 'rare', weight: 14, special: 'hook', range: 6, uses: 2, en: 6, heat: 4, color: '#94b0c2', desc: 'Yanks the enemy right next to you from up to 6 away (a mine in the way stops it there, and goes off). No damage.' },
  { id: 'sp_tether', type: 'special', name: 'MAG TETHER', rarity: 'epic', weight: 21, special: 'hook', range: 7, drain: 7, uses: 2, en: 8, heat: 4, color: '#73eff7', icon: 'sp_hook', desc: 'Yanks the enemy right next to you from up to 7 away and drains its energy (a mine in the way stops it there, and goes off).' },
  { id: 'sp_winch', type: 'special', name: 'HARPOON WINCH', rarity: 'epic', weight: 21, special: 'hook', range: 8, uses: 2, en: 7, heat: 6, color: '#ffcd75', icon: 'sp_hook', desc: 'Yanks the enemy right next to you from up to 8 away (a mine in the way stops it there, and goes off). No damage.' },

  // Drones: act every turn, any range, once deployed
  { id: 'dr_gnat', type: 'drone', name: 'GNAT DRONE', rarity: 'common', dtype: 'phys', weight: 20, upkeep: { en: 3, heat: 1 }, dmg: 7, foeDmg: 4, color: '#94b0c2' },
  { id: 'dr_firefly', type: 'drone', name: 'FIREFLY DRONE', rarity: 'common', dtype: 'heat', weight: 20, upkeep: { en: 3, heat: 1 }, dmg: 5, foeDmg: 3, fx: { heat: 5 }, color: '#ef7d57', icon: 'dr_gnat', desc: 'Small Explosive hits that heat the target every turn.' },
  { id: 'dr_hornet', type: 'drone', name: 'HORNET DRONE', rarity: 'rare', dtype: 'phys', weight: 36, upkeep: { en: 4, heat: 2 }, dmg: 8, foeDmg: 5, color: '#ffcd75' },
  { id: 'dr_medic', type: 'drone', name: 'MEDIC DRONE', rarity: 'rare', weight: 31, upkeep: { en: 6, heat: 0 }, heal: 6, color: '#a7f070', desc: 'Repairs you every turn it is deployed, up to a share of your max HP per battle (grows with level; the Risk heal penalty applies). It never attacks.' },
  { id: 'dr_static', type: 'drone', name: 'STATIC DRONE', rarity: 'rare', dtype: 'energy', weight: 31, upkeep: { en: 3, heat: 2 }, dmg: 6, foeDmg: 4, fx: { drain: 3 }, color: '#73eff7', icon: 'dr_hornet', desc: 'Electric zaps that drain energy every turn.' },
  { id: 'dr_coolant', type: 'drone', name: 'COOLANT DRONE', rarity: 'rare', weight: 31, upkeep: { en: 5, heat: 0 }, chill: 8, color: '#73eff7', icon: 'dr_medic', desc: 'Pulls heat out of you every turn it is deployed (grows with level). It never attacks.' },
  { id: 'dr_guardian', type: 'drone', name: 'GUARDIAN DRONE', rarity: 'epic', weight: 41, upkeep: { en: 7, heat: 0 }, forcefieldEvery: 3, color: '#a7f070', desc: 'Forcefield every 3rd turn.' },
  { id: 'dr_reaper', type: 'drone', name: 'REAPER DRONE', rarity: 'legendary', dtype: 'energy', weight: 52, upkeep: { en: 6, heat: 2 }, dmg: 13, foeDmg: 7, fx: { crit: 0.2 }, color: '#ffcd75', desc: '20% crit chance.' },
  { id: 'dr_seraph', type: 'drone', name: 'SERAPH DRONE', rarity: 'mythic', dtype: 'energy', weight: 57, upkeep: { en: 7, heat: 2 }, dmg: 18, foeDmg: 8, fx: { crit: 0.25 }, color: '#ff5d73', desc: '25% crit chance.' },
  // Field drones: the second wave
  { id: 'dr_patcher', type: 'drone', name: 'PATCHER DRONE', rarity: 'common', weight: 24, upkeep: { en: 4, heat: 0 }, heal: 4, color: '#a7f070', icon: 'dr_medic', desc: 'Repairs you a little every turn it is deployed, up to a share of your max HP per battle. It never attacks.' },
  { id: 'dr_lancer', type: 'drone', name: 'LANCER DRONE', rarity: 'rare', dtype: 'phys', weight: 38, upkeep: { en: 5, heat: 2 }, dmg: 6, foeDmg: 4, fx: { pierce: true }, color: '#94b0c2', icon: 'dr_hornet', desc: 'Tungsten darts: its hits ignore resists.' },
  { id: 'dr_cinder', type: 'drone', name: 'CINDER DRONE', rarity: 'epic', dtype: 'heat', weight: 38, upkeep: { en: 4, heat: 1 }, dmg: 10, foeDmg: 6, fx: { burn: 2, heat: 6 }, color: '#ef7d57', icon: 'dr_firefly', desc: 'Explosive hits that leave the target burning for 2 turns.' },
  { id: 'dr_bastion', type: 'drone', name: 'BASTION DRONE', rarity: 'legendary', weight: 55, upkeep: { en: 9, heat: 0 }, forcefieldEvery: 2, color: '#41a6f6', icon: 'dr_guardian', desc: 'Forcefield every 2nd turn.' },
  { id: 'dr_wraith', type: 'drone', name: 'WRAITH DRONE', rarity: 'mythic', dtype: 'energy', weight: 54, upkeep: { en: 7, heat: 2 }, dmg: 16, foeDmg: 8, fx: { pierce: true, drain: 8 }, color: '#c46fd6', icon: 'dr_reaper', desc: 'Electric hits that ignore resists and drain energy.' },

  // Modules: stat modules stack; `unique` ones fit once per mech
  { id: 'md_plating', type: 'module', name: 'PLATING', rarity: 'common', weight: 26, hp: 10 },
  { id: 'md_physres', type: 'module', name: 'IMPACT DAMPER', rarity: 'common', weight: 24, res: { phys: 2 } },
  { id: 'md_heatres', type: 'module', name: 'BLAST LINER', rarity: 'common', weight: 24, res: { heat: 2 } },
  { id: 'md_elecres', type: 'module', name: 'GROUNDING MESH', rarity: 'common', weight: 24, res: { energy: 2 } },
  { id: 'md_battery', type: 'module', name: 'BATTERY PACK', rarity: 'common', weight: 18, energy: 14, desc: 'A bigger energy pool (grows with level).' },
  { id: 'md_coolant', type: 'module', name: 'COOLANT LOOP', rarity: 'common', weight: 14, cool: 6, desc: 'Each COOLDOWN removes more heat (grows with level).' },
  { id: 'md_target', type: 'module', name: 'TARGETING CPU', rarity: 'common', weight: 16, crit: 0.03, unique: true },
  { id: 'md_servo', type: 'module', name: 'STOMP SERVO', rarity: 'common', weight: 16, stompPct: 0.5, unique: true, desc: '+50% STOMP damage.' },
  { id: 'md_bounty', type: 'module', name: 'BOUNTY CHIP', rarity: 'common', weight: 12, goldPct: 0.15, unique: true },
  { id: 'md_insulated', type: 'module', name: 'INSULATED PLATE', rarity: 'rare', weight: 34, hp: 8, res: { heat: 1.5, energy: 1.5 } },
  { id: 'md_salvage', type: 'module', name: 'SALVAGE CLAW', rarity: 'rare', weight: 20, killHeal: 0.05, unique: true, desc: 'Repairs 5% of max HP each time you destroy an enemy mech.' },
  { id: 'md_governor', type: 'module', name: 'OVERDRIVE GOVERNOR', rarity: 'rare', weight: 18, hotAtk: 0.15, unique: true, desc: '+15% damage while you are above half your heat cap.' },
  { id: 'md_heavyplate', type: 'module', name: 'HEAVY PLATING', rarity: 'rare', weight: 36, hp: 16 },
  { id: 'md_composite', type: 'module', name: 'COMPOSITE PLATE', rarity: 'rare', weight: 34, hp: 8, res: { phys: 1.5, heat: 1.5 } },
  { id: 'md_thermal', type: 'module', name: 'THERMAL CORE', rarity: 'rare', weight: 18, heatCap: 8, cool: 4, desc: 'Heat cap and cooling (grows with level).' },
  { id: 'md_capacitor', type: 'module', name: 'CAPACITOR BANK', rarity: 'rare', weight: 18, energy: 8, regen: 4, desc: 'Energy and regen (grows with level).' },
  { id: 'md_heatsink', type: 'module', name: 'HEAT SINK', rarity: 'rare', weight: 18, heatCap: 14, desc: 'A higher heat cap (grows with level).' },
  { id: 'md_generator', type: 'module', name: 'POWER CORE', rarity: 'rare', weight: 14, regen: 6, desc: 'Refills more energy per turn (grows with level).' },
  // Heat + energy combos: both halves of the reactor in one slot, but heavier than two single modules
  { id: 'md_fluxcell', type: 'module', name: 'FLUX CELL', rarity: 'rare', weight: 30, energy: 10, heatCap: 10, color: '#73eff7', desc: 'A bigger battery and a higher heat cap in one heavy block (grows with level).' },
  { id: 'md_twinloop', type: 'module', name: 'TWIN LOOP', rarity: 'epic', weight: 26, regen: 5, cool: 5, color: '#ef7d57', desc: 'Refills more energy and cools more heat every turn. Heavy (grows with level).' },
  { id: 'md_fusion', type: 'module', name: 'FUSION CORE', rarity: 'legendary', weight: 40, energy: 12, regen: 5, heatCap: 12, cool: 5, color: '#ffcd75', desc: 'Battery, regen, heat cap and cooling all at once. Very heavy (grows with level).' },
  { id: 'md_amp', type: 'module', name: 'DAMAGE AMP', rarity: 'rare', weight: 24, atkPct: 0.08, unique: true },
  { id: 'md_repair', type: 'module', name: 'NANO REPAIR', rarity: 'rare', weight: 24, healAfterWin: 0.05, unique: true, desc: 'Heal after every won battle.' },
  { id: 'md_aegis', type: 'module', name: 'AEGIS EMITTER', rarity: 'epic', weight: 30, res: { phys: 1, energy: 2 }, startForcefield: true, unique: true, desc: 'Start each battle with a Forcefield.' },
  { id: 'md_exchanger', type: 'module', name: 'HEAT EXCHANGER', rarity: 'epic', weight: 22, ventEnergy: 0.6, unique: true, desc: 'COOLDOWN also refills energy: 60% of the heat it cools.' },
  { id: 'md_laststand', type: 'module', name: 'LAST STAND', rarity: 'epic', weight: 18, lowHpAtk: 0.25, unique: true, desc: '+25% damage while you are below 35% HP.' },
  { id: 'md_range', type: 'module', name: 'RANGE EXTENDER', rarity: 'epic', weight: 20, reachBonus: 1, unique: true, desc: '+1 max range on every gun.' },
  { id: 'md_titanplate', type: 'module', name: 'TITAN PLATE', rarity: 'legendary', weight: 46, hp: 28, res: { phys: 2, heat: 2 } },
  { id: 'md_overclock', type: 'module', name: 'OVERCLOCK CORE', rarity: 'legendary', weight: 32, atkPct: 0.1, weaponDmgPct: 0.12, unique: true },
  { id: 'md_voidcore', type: 'module', name: 'VOID CORE', rarity: 'mythic', weight: 52, hp: 37, res: { phys: 2, heat: 2, energy: 2 }, startForcefield: true, unique: true, color: '#ff5d73', desc: 'Start each battle with a Forcefield.' },
  { id: 'md_gunsight', type: 'module', name: 'GUNSIGHT', rarity: 'common', weight: 16, weaponDmgPct: 0.05, unique: true, icon: 'md_target', desc: '+5% gun damage.' },
  { id: 'md_reboundplate', type: 'module', name: 'REBOUND PLATE', rarity: 'rare', weight: 34, hp: 8, res: { phys: 1.5, energy: 1.5 }, icon: 'md_physres' },
  { id: 'md_adrenal', type: 'module', name: 'ADRENAL INJECTOR', rarity: 'epic', weight: 20, lowHpAtk: 0.15, killHeal: 0.03, unique: true, icon: 'md_laststand', desc: '+15% damage below 35% HP, and repairs 3% of max HP per kill.' },
  { id: 'md_pressure', type: 'module', name: 'PRESSURE VALVE', rarity: 'epic', weight: 28, hotAtk: 0.2, heatCap: 16, unique: true, icon: 'md_governor', desc: '+20% damage while above half your heat cap, and a bigger cap (grows with level).' },
  { id: 'md_wardmesh', type: 'module', name: 'WARD MESH', rarity: 'legendary', weight: 50, hp: 28, res: { phys: 1.5, heat: 1.5, energy: 1.5 }, icon: 'md_physres' },
  { id: 'md_rebirth', type: 'module', name: 'REBIRTH CORE', rarity: 'mythic', weight: 46, hp: 32, killHeal: 0.06, healAfterWin: 0.08, unique: true, color: '#ff5d73', icon: 'md_repair', desc: 'Repairs 6% of max HP per kill and heals after every win.' },
  { id: 'md_singularity', type: 'module', name: 'SINGULARITY CHIP', rarity: 'mythic', weight: 32, atkPct: 0.12, weaponDmgPct: 0.15, crit: 0.03, unique: true, color: '#ff5d73' },
];

// Heat and energy (CONFIG.gear.rxScale): the catalog above is written small, so scale every
// reactor number once here (player and enemy parts alike)
{
  const R = CONFIG.gear.rxScale || 1;
  const REACTOR_FIELDS = ['en', 'heat', 'energy', 'regen', 'heatCap', 'cool', 'moveEn', 'stompEn', 'stompHeat', 'chill', 'drain'];
  const cost = CONFIG.gear.gunCost || {};
  const rig = CONFIG.gear.rigScale || {};
  for (const p of PARTS) {
    for (const f of REACTOR_FIELDS) if (typeof p[f] === 'number') p[f] *= R;
    // Gun costs by damage type (Physical runs on heat), reactor rates (regen, cooling)
    if (p.type === 'weapon') for (const f of ['en', 'heat']) if (typeof p[f] === 'number') p[f] = Math.round(p[f] * (cost[p.dtype || 'phys']?.[f] ?? 1));
    if (p.type === 'frame' || p.type === 'module') for (const f of ['regen', 'cool']) if (typeof p[f] === 'number') p[f] = Math.round(p[f] * (rig[f] ?? 1));
    if (p.upkeep) p.upkeep = Object.fromEntries(Object.entries(p.upkeep).map(([k, v]) => [k, v * R]));
    if (p.fx) for (const f of ['heat', 'drain', 'coolDmg', 'regenDmg']) if (typeof p.fx[f] === 'number') p.fx[f] *= R;
  }
}
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
export const DEFAULT_LEGS = { id: 'lg_strider', name: 'NO LEGS', walk: 2, jump: null, stomp: 6, stompType: 'phys', stompEn: 0, stompHeat: CONFIG.gear.stompHeat, anchored: false, moveEn: 0, freeMove: false };

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
  return [p.rarity, RARITY_ORDER[Math.min(TOP_DROP_TIER, lo + 3)]];
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
const SCALING = ['hp', 'def', 'dmg', 'heal', 'chill', 'stomp', 'ram', 'absorb', 'backfire', 'atkPct', 'crit', 'stompPct', 'goldPct', 'healAfterWin', 'weaponDmgPct', 'killHeal', 'hotAtk', 'lowHpAtk', 'ventEnergy'];
const FULL = new Set(['hp', 'dmg', 'heal', 'chill', 'stomp', 'ram', 'absorb', 'backfire']);
// Reactor modules (Battery Pack, Coolant Loop, Heat Sink, Power Core...) grow fully
const REACTOR = ['energy', 'regen', 'heatCap', 'cool'];
// What a part costs to use (guns, specials, stomps, moves, drone upkeep): x tierStep per tier, never per level
const COSTS = ['en', 'heat', 'stompEn', 'stompHeat', 'moveEn'];

/** A part's stats at the owned item's tier and level. `rarity` is the tier it's at now. */
export function partStats(owned) {
  const base = getPart(owned.id);
  if (!base) return null;
  const k = growth(owned);
  const out = { ...base, level: owned.level || 1, uid: owned.uid, baseRarity: base.rarity, rarity: tierOf(owned) };
  for (const f of SCALING) if (typeof base[f] === 'number') out[f] = base[f] * (FULL.has(f) ? k : 1 + (k - 1) * 0.5);
  for (const f of ['hp', 'heal', 'absorb']) if (typeof out[f] === 'number') out[f] *= CONFIG.gear.hpScale; // HP numbers are x10
  if (base.type === 'module') for (const f of REACTOR) if (typeof base[f] === 'number') out[f] = Math.round(base[f] * k);
  // Tiers grow the reactor and what things cost at the same rate (SuperMechs Reloaded), so a build fires
  // as often at every tier; levels only add damage, HP and (frames) capacity
  const perTier = Math.pow(CONFIG.gear.tierStep, rIdx(tierOf(owned)) - rIdx(base.rarity));
  if (base.type === 'frame') {
    for (const f of ['energy', 'heatCap']) if (typeof base[f] === 'number') out[f] = Math.round(base[f] * k);
    for (const f of ['regen', 'cool']) if (typeof base[f] === 'number') out[f] = Math.round(base[f] * perTier);
  } else {
    for (const f of COSTS) if (typeof base[f] === 'number') out[f] = Math.round(base[f] * perTier);
    if (base.upkeep) out.upkeep = Object.fromEntries(Object.entries(base.upkeep).map(([t, v]) => [t, Math.round(v * perTier)]));
  }
  if (base.res) out.res = Object.fromEntries(Object.entries(base.res).map(([t, v]) => [t, v * (1 + (k - 1) * 0.5)]));
  // Heat pumped into the target and energy drained grow like damage (guns and drones)
  if (base.fx && (base.fx.heat || base.fx.drain)) {
    out.fx = { ...base.fx };
    for (const f of ['heat', 'drain']) if (typeof base.fx[f] === 'number') out.fx[f] = Math.round(base.fx[f] * k);
  }
  // Your guns by damage type (GUN_TYPE_DMG) and reach (REACH_DMG). An Explosive gun that heats
  // by its hit keeps the heat of its full hit, an Electric one the drain: they hit softer but
  // lock just as well, and reach only moves damage, never how hard a gun locks
  const mult = base.type === 'weapon' ? (GUN_TYPE_DMG[base.dtype] ?? 1) * reachMult(base) : 1;
  if (mult !== 1 && typeof out.dmg === 'number') {
    const load = Math.round(out.dmg * CONFIG.gear.dmgScale * (CONFIG.gear.dtypeLoad[base.dtype] || 0));
    if (base.dtype === 'heat' && typeof out.fx?.heat !== 'number') out.fx = { ...(out.fx || {}), heat: load };
    if (base.dtype === 'energy' && typeof out.fx?.drain !== 'number') out.fx = { ...(out.fx || {}), drain: load };
    out.dmg *= mult;
  }
  return out;
}

export const rarityColor = (r) => RARITIES[r]?.color || '#94b0c2';
export const rarityName = (r) => RARITIES[r]?.name || '';
export const salvageValue = (owned) => Math.round(RARITIES[tierOf(owned)].scrap * (1 + ((owned.level || 1) - 1) / Math.max(1, maxLevel(owned) - 1)));
export const upgradeCost = (owned) => Math.ceil(owned.level * 2 * RARITIES[tierOf(owned)].cost);

/**
 * What one hit does to the target's reactor, as Game._reactorFx applies it
 * (before the target's resist): its own heat / drain number, else Explosive
 * hits heat and Electric hits drain by dtypeLoad x the hit. `dmg` is the
 * hit in battle numbers. Returns { heat, drain }.
 */
export function reactorHit(w, dmg) {
  const type = dtypeOf(w);
  const load = CONFIG.gear.dtypeLoad;
  const heat = w.fx?.meltdown ? 0 : w.fx?.heat ?? (type === 'heat' ? Math.round(dmg * load.heat) : 0);
  const drain = w.fx?.drain ?? (type === 'energy' ? Math.round(dmg * load.energy) : 0);
  return { heat, drain };
}

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

const pct = (v) => Math.round(v * 100);

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
  if (p.chill) L.push(`COOLS YOU ${Math.round(p.chill)}/turn`);
  if (p.fx?.execute) L.push(`x1.8 BELOW ${pct(p.fx.execute)}% HP`);
  if (p.type === 'special' && p.drain) L.push(`DRAINS ${p.drain} EN`);
  if (p.away) L.push('DASHES AWAY');
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
  if (p.killHeal) L.push(`+${pct(p.killHeal)}% HP/KILL`);
  if (p.hotAtk) L.push(`DMG +${pct(p.hotAtk)}% WHEN HOT`);
  if (p.lowHpAtk) L.push(`DMG +${pct(p.lowHpAtk)}% BELOW 35% HP`);
  if (p.ventEnergy) L.push(`COOLDOWN REFILLS ${pct(p.ventEnergy)}% AS EN`);
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
  add(p.dmg, 'dmg', dmgLabel(battleDmg(p)), `${dt.name} damage per hit`, dt.color);
  add(p.fx?.burst, 'burst', `x${p.fx?.burst}`, 'Hits per shot');
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
  add(p.ammo, 'ammo', `${p.ammo}/FIGHT`, 'Shots per battle');
  add(p.backfire, 'backfire', `-${Math.round((p.backfire || 0) * CONFIG.gear.dmgScale)}`, 'Backfire: HP it costs you per shot', '#ff5d73');
  for (const [t, v] of Object.entries(p.fx?.resDrain || {})) add(true, 'resdrain', `-${v}`, `Strips ${DTYPES[t].name} resist per hit`, DTYPES[t].color);
  add(p.fx?.corrode, 'resdrain', `-${p.fx?.corrode}`, 'Strips PHYSICAL resist per hit', DTYPES.phys.color);
  const rx = p.dmg || p.fx ? reactorHit(p, battleDmg(p)) : { heat: 0, drain: 0 };
  add(rx.drain, 'drain', `${rx.drain}`, `Drains their energy${p.fx?.burst > 1 ? ' per hit' : ''}`, DTYPES.energy.color);
  add(rx.heat, 'heatin', `+${rx.heat}`, `Heat into the target${p.fx?.burst > 1 ? ' per hit' : ''}`, DTYPES.heat.color);
  add(p.fx?.push, 'push', `${p.fx?.push}`, 'Knocks the target back');
  add(p.fx?.pull, 'pull', `${p.fx?.pull}`, 'Pulls the target in');
  add(p.fx?.pierce, 'pierce', '', 'Ignores resists');
  add(p.energy, 'energy', `${p.type === 'frame' ? '' : '+'}${p.energy}`, 'Energy pool', DTYPES.energy.color);
  add(p.regen, 'regen', `+${p.regen}`, 'Energy regen per turn', DTYPES.energy.color);
  add(p.heatCap, 'heat', `${p.type === 'frame' ? '' : '+'}${p.heatCap}`, 'Heat cap', DTYPES.heat.color);
  add(p.cool, 'cool', `-${p.cool}`, 'Cooling per turn', '#73eff7');
  add(p.heal, 'heal', `${Math.round(p.heal)}/T`, 'Repair per turn');
  add(p.heal, 'hp', `MAX ${pct(CONFIG.gear.droneHealCap)}%`, 'Repairs at most this share of your max HP per battle');
  add(p.chill, 'cool', `-${Math.round(p.chill || 0)}/T`, 'Heat it pulls out of you per turn', '#73eff7');
  add(p.fx?.execute, 'skull', `<${pct(p.fx?.execute || 0)}%`, `x1.8 damage against a target below ${pct(p.fx?.execute || 0)}% HP`, '#ff5d73');
  add(p.type === 'special' && p.drain, 'drain', `${p.drain}`, 'Drains their energy', DTYPES.energy.color);
  add(p.away, 'move', 'AWAY', 'Dashes away from the enemy (no ram)');
  add(p.type === 'special', 'ammo', `${p.uses}/FIGHT`, 'Uses per battle');
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
  add(p.killHeal, 'heal', `+${pct(p.killHeal || 0)}%/KILL`, 'Repair (share of max HP) per enemy mech destroyed');
  add(p.hotAtk, 'heat', `+${pct(p.hotAtk || 0)}%`, 'Damage while above half your heat cap', DTYPES.heat.color);
  add(p.lowHpAtk, 'dmg', `+${pct(p.lowHpAtk || 0)}%`, 'Damage while below 35% HP', '#ff5d73');
  add(p.ventEnergy, 'energy', `COOL ${pct(p.ventEnergy || 0)}%`, 'COOLDOWN refills energy: this share of the heat it cools', DTYPES.energy.color);
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

/** Close-quarters weapons: the mech lunges in and swings instead of shooting (Renderer._drawMeleeFx). */
const MELEE = { wp_scythe: 'slash', wp_phoenix: 'rake', wp_magma: 'punch', wp_breaker: 'thrust' };
export const meleeOf = (w) => MELEE[w?.id] || null;

/** Guns with a shot of their own (Renderer._drawProjectiles); the rest look like their kind. */
const SIGNATURE = { wp_missiles: 'salvo', wp_omega: 'spin', wp_rail: 'rail', wp_nova: 'rail', wp_flak: 'flak', wp_cluster: 'cluster' };
export const signatureOf = (w) => SIGNATURE[w?.id] || null;

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
    killHeal: 0, hotAtk: 0, lowHpAtk: 0, ventEnergy: 0,
    weapons: [], drones: [], specials: [],
    // Reactor (gear combat): the frame sets it, modules add to it
    energy: 0, regen: 0, heatCap: 0, cool: 0, hasFrame: false,
    legs: null, // the fitted legs part (movement rules), null = DEFAULT_LEGS
  };
  const seen = new Set();
  const parts = ownedParts.filter(Boolean).map(partStats).filter(Boolean)
    // A `unique` module counts once (older saves may still wear two)
    .filter((p) => !(p.unique && seen.has(p.id)) && (seen.add(p.id), true));
  for (const p of parts) {
    if (p.type === 'frame') t.hasFrame = true;
    for (const f of ['energy', 'regen', 'heatCap', 'cool']) t[f] += p[f] || 0;
    t.weight += p.weight || 0;
    for (const f of ['hp', 'def', 'atkPct', 'crit', 'stompPct', 'goldPct', 'healAfterWin', 'weaponDmgPct', 'reachBonus', 'killHeal', 'hotAtk', 'lowHpAtk', 'ventEnergy']) t[f] += p[f] || 0;
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
      killHeal: t.killHeal,
      hotAtk: t.hotAtk,
      lowHpAtk: t.lowHpAtk,
      ventEnergy: t.ventEnergy,
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
 * Keys (saved as tokens) for winning a fight, before Risk (CONFIG.risk.keysPerLevel,
 * paid out with the fractions carried over in main.js riskKeys).
 */
export const CLEAN_WIN_KEYS = 2; // bonus for a normal fight won without taking damage

export function tokenReward(nodeType) {
  return { combat: 3, elite: 5, miniboss: 5, boss: 8 }[nodeType] || 0;
}

/**
 * How soft enemies are at a Risk level: { hp, atk, ai } multipliers / AI shift,
 * easing from CONFIG.risk.ease at Risk 0 to full strength at ease.fullAt.
 */
/**
 * Base stats for a fight tier on a floor: normal fights, mini-bosses and
 * bosses read CONFIG.enemyTiers; elites are that floor's hostile scaled up
 * (enemyTiers.elite: hpMult, atkMult, +def, +ai).
 */
export function enemyTier(nodeType, floor) {
  const T = CONFIG.enemyTiers;
  const f = String(Math.max(1, Math.min(5, floor)));
  if (nodeType === 'elite') {
    const base = T[f] || T[1];
    const E = T.elite;
    return { hp: base.hp * E.hpMult, atk: base.atk * E.atkMult, def: base.def + E.def, aiDifficulty: base.aiDifficulty + E.ai };
  }
  return T[nodeType === 'boss' || nodeType === 'miniboss' ? nodeType : f] || T[1];
}

/**
 * Enemy multipliers that keep pace with the gear players have at a Risk level (CONFIG.risk.gearComp):
 * HP, ATK, and rx = the heat and drain their guns push (your reactor grows with tiers).
 */
export function gearComp(level = 0) {
  const C = CONFIG.risk.gearComp;
  if (!C) return { hp: 1, atk: 1, rx: 1 };
  const i = Math.max(0, Math.min(C.hp.length - 1, level));
  return { hp: C.hp[i], atk: C.atk[i], rx: C.rx?.[i] ?? 1 };
}

export function riskEase(level = 0) {
  const E = CONFIG.risk.ease;
  const g = gearComp(level);
  const t = Math.max(0, Math.min(1, level / E.fullAt));
  const ai = E.ai * (1 - t);
  // A tuned per-level curve (enemy HP and damage) wins over the straight line. `rx`: the heat and
  // drain their guns push, softened the same way their damage is
  if (E.curve) {
    const k = E.curve[Math.max(0, Math.min(E.curve.length - 1, level))];
    return { hp: k * g.hp, atk: k * g.atk, ai, rx: k * g.rx };
  }
  const k = E.atk + (1 - E.atk) * t;
  return { hp: (E.hp + (1 - E.hp) * t) * g.hp, atk: k * g.atk, ai, rx: k * g.rx };
}

// ---------- Enemy mechs ----------

/**
 * Every enemy is a mech built from catalog parts: no special abilities,
 * just what its gear does. Each one fights with ONE damage type (its
 * element: Physical, Explosive or Electric) and comes in the set for that
 * type: ENEMY_LOADOUTS[role][element]. Explosive sets pile heat on you until
 * you overheat, Electric sets drain your energy, Physical sets hit hard and
 * shove. `guns` is a list of slots, each a pick-one list: normal fights fit
 * the first 2, elites 3, minibosses and bosses all of them. Slots 1 + 2
 * always cover close AND far (no blindspot), and every set walks.
 * `heavy` swaps the last fitted slot for elites / bosses (the big gun).
 * `mods` give the resists (normal fights fit the first: its own type);
 * `drone` flies from elites up. Some roles only come in one type.
 */
export const ENEMY_LOADOUTS = {
  standard: {
    phys: { legs: ['lg_strider', 'lg_hopper'], mods: ['md_physres', 'md_plating'], drone: 'dr_gnat', guns: [['wp_blaster', 'wp_shredder', 'wp_flak'], ['wp_rifle', 'wp_concussion'], ['wp_mortar', 'wp_rocket']] },
    heat: { legs: ['lg_strider', 'lg_jumpjets'], mods: ['md_heatres', 'md_plating'], drone: 'dr_firefly', guns: [['wp_acid'], ['wp_napalm'], ['wp_heatray', 'wp_rupturer']] },
    energy: { legs: ['lg_strider', 'lg_coil'], mods: ['md_elecres', 'md_plating'], drone: 'dr_static', guns: [['wp_spark', 'wp_emp'], ['wp_arcmortar'], ['wp_beam', 'wp_ionizer']] },
  },
  // Shoves you around from a thick hull
  tank: {
    phys: { specials: ['sp_charge'], legs: ['lg_treads'], mods: ['md_composite', 'md_heavyplate'], drone: 'dr_guardian', guns: [['wp_scatter', 'wp_breaker'], ['wp_impact'], ['wp_repulsor', 'wp_flak'], ['wp_concussion']] },
    heat: { specials: ['sp_charge'], legs: ['lg_treads'], mods: ['md_composite', 'md_heavyplate'], drone: 'dr_guardian', guns: [['wp_flamer', 'wp_blowtorch', 'wp_magma'], ['wp_napalm'], ['wp_cryo', 'wp_inferno'], ['wp_meltdown']] },
    energy: { specials: ['sp_charge'], legs: ['lg_treads'], mods: ['md_insulated', 'md_heavyplate'], drone: 'dr_guardian', guns: [['wp_tesla', 'wp_arcturret'], ['wp_arcmortar'], ['wp_capdump'], ['wp_blackout']] },
  },
  // A long gun with a close one for backup
  striker: {
    phys: { specials: ['sp_teleport'], legs: ['lg_catapult', 'lg_strider'], mods: ['md_physres'], drone: 'dr_hornet', guns: [['wp_blaster'], ['wp_rifle'], ['wp_rocket']], heavy: 'wp_sniper' },
    heat: { specials: ['sp_teleport'], legs: ['lg_jumpjets', 'lg_catapult'], mods: ['md_heatres'], drone: 'dr_firefly', guns: [['wp_acid'], ['wp_cluster'], ['wp_thermal']], heavy: 'wp_meltdown' },
    energy: { specials: ['sp_teleport'], legs: ['lg_coil', 'lg_catapult'], mods: ['md_elecres'], drone: 'dr_static', guns: [['wp_emp'], ['wp_arcmortar'], ['wp_beam']], heavy: 'wp_rail' },
  },
  // Hooks you in and heals off the fight
  vampire: {
    phys: { specials: ['sp_hook', 'sp_charge'], legs: ['lg_strider', 'lg_skids'], mods: ['md_aegis'], drone: 'dr_medic', guns: [['wp_breacher', 'wp_shredder'], ['wp_grapple'], ['wp_smg']] },
    heat: { specials: ['sp_hook', 'sp_charge'], legs: ['lg_jumpjets', 'lg_strider'], mods: ['md_composite'], drone: 'dr_medic', guns: [['wp_dragon', 'wp_flamer', 'wp_magma'], ['wp_napalm'], ['wp_acid']] },
    energy: { specials: ['sp_hook', 'sp_charge'], legs: ['lg_coil', 'lg_strider'], mods: ['md_aegis'], drone: 'dr_medic', guns: [['wp_siphon', 'wp_leech'], ['wp_arcmortar'], ['wp_scythe']] },
  },
  // Explosive only: heats you until you lock up, then cashes it in
  pyromancer: {
    heat: { legs: ['lg_treads', 'lg_jumpjets'], mods: ['md_heatres', 'md_composite'], drone: 'dr_firefly', guns: [['wp_blowtorch', 'wp_flamer', 'wp_magma'], ['wp_napalm'], ['wp_thermal', 'wp_rupturer', 'wp_scorcher', 'wp_inferno']], heavy: 'wp_meltdown' },
  },
  // Electric only: drains you until your guns jam
  disruptor: {
    energy: { legs: ['lg_jumpjets', 'lg_coil'], mods: ['md_elecres', 'md_aegis'], drone: 'dr_reaper', guns: [['wp_spark', 'wp_leech', 'wp_arcturret'], ['wp_arcmortar'], ['wp_gridbreaker', 'wp_ionizer']], heavy: 'wp_blackout' },
  },
  tactician: {
    phys: { specials: ['sp_hook'], legs: ['lg_strider', 'lg_coil'], mods: ['md_composite'], drone: 'dr_guardian', guns: [['wp_blaster'], ['wp_missiles'], ['wp_mortar']] },
    heat: { specials: ['sp_hook'], legs: ['lg_strider', 'lg_jumpjets'], mods: ['md_composite'], drone: 'dr_guardian', guns: [['wp_acid'], ['wp_thermal'], ['wp_cluster']] },
    energy: { specials: ['sp_hook'], legs: ['lg_coil', 'lg_strider'], mods: ['md_insulated'], drone: 'dr_guardian', guns: [['wp_tesla'], ['wp_beam'], ['wp_arcmortar']] },
  },
  // Strips your resist to its own type
  corroder: {
    phys: { legs: ['lg_hopper', 'lg_strider'], mods: ['md_physres'], drone: 'dr_gnat', guns: [['wp_shredder'], ['wp_rifle'], ['wp_needler']] },
    heat: { legs: ['lg_hopper', 'lg_jumpjets'], mods: ['md_heatres'], drone: 'dr_firefly', guns: [['wp_acid'], ['wp_scorcher'], ['wp_napalm']] },
    energy: { legs: ['lg_hopper', 'lg_coil'], mods: ['md_elecres'], drone: 'dr_static', guns: [['wp_emp'], ['wp_ionizer'], ['wp_arcmortar']] },
  },
  // Physical only: mines are its thing
  minelayer: {
    phys: { legs: ['lg_treads', 'lg_hopper'], mods: ['md_composite'], drone: 'dr_hornet', guns: [['wp_blaster', 'wp_scatter'], ['wp_minelauncher'], ['wp_mortar']] },
  },
  // The Sector Commander: a heavy walker with a gun for every range
  boss: {
    phys: { specials: ['sp_hook'], frame: 'fr_leviathan', legs: ['lg_bulwark', 'lg_treads'], mods: ['md_voidcore', 'md_titanplate'], drone: 'dr_guardian', guns: [['wp_breaker', 'wp_scatter'], ['wp_howitzer'], ['wp_rifle'], ['wp_missiles', 'wp_flak']] },
    heat: { specials: ['sp_hook'], frame: 'fr_leviathan', legs: ['lg_bulwark', 'lg_treads'], mods: ['md_voidcore', 'md_titanplate'], drone: 'dr_guardian', guns: [['wp_magma', 'wp_flamer'], ['wp_cluster'], ['wp_meltdown', 'wp_inferno'], ['wp_thermal']] },
    energy: { specials: ['sp_hook'], frame: 'fr_leviathan', legs: ['lg_bulwark', 'lg_treads'], mods: ['md_voidcore', 'md_titanplate'], drone: 'dr_guardian', guns: [['wp_tesla', 'wp_arcturret'], ['wp_rail'], ['wp_blackout'], ['wp_beam']] },
  },
  // Abyss 5's true final boss: every type at once, fast, reaches everywhere, and hits hard up close
  final: {
    any: { specials: ['sp_ram', 'sp_teleport'], frame: 'fr_leviathan', legs: ['lg_phase'], mods: ['md_voidcore', 'md_titanplate'], drone: 'dr_seraph', guns: [['wp_nova'], ['wp_scythe'], ['wp_ionizer'], ['wp_missiles']] },
  },
};

/** The damage types a role comes in. */
export const roleElements = (role) => Object.keys(ENEMY_LOADOUTS[role] || ENEMY_LOADOUTS.standard).filter((k) => k !== 'any');

/**
 * Roll an enemy's damage type, leaning toward what you resist least. `lean`
 * 0 = even odds; 1 = your weakest type comes up about 2 fights in 3.
 */
export function pickEnemyElement(playerRes = {}, lean = 0, rnd = Math.random) {
  const res = DTYPE_KEYS.map((t) => playerRes[t] || 0);
  const top = Math.max(...res);
  const gapMax = Math.max(...res.map((v) => top - v));
  const w = res.map((v) => 1 + (gapMax > 0 ? lean * 3 * ((top - v) / gapMax) : 0));
  let r = rnd() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < w.length; i++) if ((r -= w[i]) <= 0) return DTYPE_KEYS[i];
  return DTYPE_KEYS[0];
}

/** How hard enemies lean toward your weak type: more on later floors, elites and bosses, and in the Abyss. */
export function elementLean(nodeType, floor, abyssDepth = 0) {
  const base = { elite: 0.55, miniboss: 0.65, boss: 0.75 }[nodeType] ?? 0.12 * (Math.max(1, Math.min(5, floor)) - 1);
  return Math.min(1, base + 0.1 * abyssDepth);
}

/** The resist shredder each damage type brings (strips that resist from you for the fight). */
const SHREDDER = { phys: 'wp_shredder', heat: 'wp_scorcher', energy: 'wp_ionizer' };

/** How Risk pushes resist shredders (CONFIG.risk.shred): { role: Acid Unit odds multiplier, gun: chance of an extra shredder }. */
export function riskShred(level = 0) {
  const R = CONFIG.risk.shred || {};
  return { role: 1 + (R.roleGrowth || 0) * level, gun: Math.max(0, Math.min(1, (level - (R.gunFrom || 99) + 1) * (R.gunPerLevel || 0))) };
}

/** Frame (for its look and reactor tier) by fight tier; normal fights and elites wear their type. */
const ENEMY_FRAME = { combat: 'fr_scout', elite: 'fr_brawler', miniboss: 'fr_titan', boss: 'fr_colossus' };
const ELEMENT_FRAME = { heat: 'fr_furnace', energy: 'fr_conduit' };
/**
 * Damage by type, by role (Super Mechs): Physical hits hardest and does
 * nothing else; Electric drains, and past empty the drain comes off HP;
 * Explosive hits softest but overheats you into forced cooldowns. Your resists
 * decide the rest.
 */
export const ELEMENT_DMG = { phys: 1, heat: 0.7, energy: 0.75 };
/** Gun slots fitted by fight tier (the rest of the list is left empty). */
const ENEMY_GUNS = { combat: 2, elite: 3, miniboss: 4, boss: 4 };

function legsInfo(id) {
  return legsRules(getPart(id));
}

/**
 * Reactor for one enemy: by fight tier, shaped by its type (Explosive runs
 * hot and cools fast, Electric carries a big battery); Risk XI (gunCdCut)
 * makes them cool faster. It grows +5% per floor and with Risk (`rx`,
 * gearComp.rx: the reactor your tiers bring), like the heat and drain they push.
 */
export function enemyRig(nodeType, { cdCut = 0, element = null, floor = 1, rx = 1 } = {}) {
  const tier = ['elite', 'miniboss', 'boss'].includes(nodeType) ? nodeType : 'combat';
  const grow = (1 + 0.05 * (Math.max(1, Math.min(5, floor)) - 1)) * rx;
  const r = Object.fromEntries(Object.entries(CONFIG.gear.enemyRig[tier]).map(([k, v]) => [k, Math.round(v * grow)]));
  if (element === 'heat') Object.assign(r, { heatCap: Math.round(r.heatCap * 1.35), cool: Math.round(r.cool * 1.35), energy: Math.round(r.energy * 0.9) });
  if (element === 'energy') Object.assign(r, { energy: Math.round(r.energy * 1.35), regen: Math.round(r.regen * 1.35), heatCap: Math.round(r.heatCap * 0.9) });
  return { ...r, cool: r.cool + cdCut * 4 * CONFIG.gear.rxScale };
}

/**
 * One enemy mech: its parts, legs, guns, drone and resists. Enemy guns hit
 * softer than yours (enemyDmgScale); `atkMult` is the same Risk / condition
 * / wave multiplier the enemy's ATK gets. `element` picks the set (a role
 * that doesn't come in it uses its first); it comes back as `element`.
 */
export function enemyMech(nodeType, archetype, floor, rnd = Math.random, { atkMult = 1, boss = false, final = false, element = 'phys', shredChance = 0, rxOut = null, rxMult = 1 } = {}) {
  const f = Math.max(1, Math.min(5, floor));
  const tier = ['elite', 'miniboss', 'boss'].includes(nodeType) ? nodeType : 'combat';
  const role = final ? ENEMY_LOADOUTS.final : boss ? ENEMY_LOADOUTS.boss : ENEMY_LOADOUTS[archetype] || ENEMY_LOADOUTS.standard;
  const el = final ? null : role[element] ? element : Object.keys(role)[0];
  const L = final ? role.any : role[el];
  const pick = (list) => list[Math.floor(rnd() * list.length)];

  const slots = L.guns.slice(0, boss || final ? L.guns.length : ENEMY_GUNS[tier]);
  const gunIds = slots.map(pick);
  if (L.heavy && tier !== 'combat') gunIds[gunIds.length - 1] = L.heavy;
  // High Risk: elites and up may bring a resist shredder of their type on top (riskShred)
  if (tier !== 'combat' && SHREDDER[el] && !gunIds.includes(SHREDDER[el]) && rnd() < shredChance) gunIds.push(SHREDDER[el]);
  const G = CONFIG.gear;
  // Each fight tier's share of a same-level player gun (CONFIG.gear.enemyGunShare): elites come in
  // pairs and bosses with escorts, all with more guns (and a drone), so each gun hits softer
  const spread = CONFIG.gear.enemyGunShare[tier];
  const scale = G.dmgScale * G.enemyDmgScale * spread * (1 + 0.1 * (f - 1)) * (ELEMENT_DMG[el] ?? 1);
  const frac = (v) => Math.round(v * 100) / 100; // enemy numbers stay fractional: Risk and floor % always count
  // Heat pumped in and energy drained come from the gun's FULL numbers (its own, else dtypeLoad x its
  // player-scale hit), not the softer enemy hit: an Explosive enemy heats you like your own gun would.
  // They grow +5% per floor (in the Abyss `rxOut`, main.js, replaces it), with Risk (`rxMult`,
  // gearComp.rx) and by CONFIG.gear.enemyRx
  const fxOf = (base) => {
    const typed = base.dtype === 'heat' || base.dtype === 'energy';
    if (!typed && !(base.fx && (base.fx.heat || base.fx.drain))) return base.fx;
    const fx = { ...(base.fx || {}) };
    if (base.dtype === 'heat' && typeof fx.heat !== 'number' && !fx.meltdown) fx.heat = (base.dmg || 0) * G.dmgScale * G.dtypeLoad.heat;
    if (base.dtype === 'energy' && typeof fx.drain !== 'number') fx.drain = (base.dmg || 0) * G.dmgScale * G.dtypeLoad.energy;
    const grow = (rxOut ?? 1 + 0.05 * (f - 1)) * rxMult;
    if (typeof fx.heat === 'number') fx.heat = Math.round(fx.heat * grow * (G.enemyRx?.heat ?? 1));
    if (typeof fx.drain === 'number') fx.drain = Math.round(fx.drain * grow * (G.enemyRx?.energy ?? 1));
    return fx;
  };
  const weapons = gunIds.map((id) => {
    const base = getPart(id);
    return { ...base, dmg: frac((base.foeDmg ?? base.dmg) * scale * atkMult), backfire: base.backfire ? frac(base.backfire * scale) : 0, fx: fxOf(base), level: 1 };
  }).sort((a, b) => (a.mount === 'top') - (b.mount === 'top'));

  const legsId = pick(L.legs);
  const frameId = L.frame || ((tier === 'combat' || tier === 'elite') && ELEMENT_FRAME[el]) || ENEMY_FRAME[tier];
  // Resists from the modules (normal fights fit the first one) and legs, growing a little with the floor
  const mods = (tier === 'combat' ? (L.mods || []).slice(0, 1) : L.mods || []).map(getPart).filter(Boolean);
  const k = 1 + 0.1 * (f - 1);
  const res = Object.fromEntries(DTYPE_KEYS.map((t) => {
    const sum = mods.reduce((s, m) => s + (m.res?.[t] || 0), 0) + (getPart(legsId)?.res?.[t] || 0);
    return [t, Math.round(sum * k * 10) / 10];
  }));
  // Drone: elites from floor 3, mini-bosses and bosses; it hits like their guns
  const dr = tier !== 'combat' && (tier !== 'elite' || f >= 3) && L.drone ? getPart(L.drone) : null;
  const drones = dr ? [{ ...dr, level: 1, fx: fxOf(dr), dmg: dr.dmg ? frac((dr.foeDmg ?? dr.dmg) * scale * atkMult) : 0, heal: dr.heal ? Math.round(dr.heal * k * G.hpScale) : 0 }] : [];
  return {
    element: el,
    weapons,
    drones,
    legs: legsInfo(legsId),
    res,
    startForcefield: mods.some((m) => m.startForcefield),
    parts: [frameId, legsId, ...gunIds, ...(dr ? [dr.id] : []), ...mods.map((m) => m.id)].filter(Boolean),
    // Specials: elites and up; ram hits like their guns
    specials: (tier === 'combat' ? [] : L.specials || []).map((id) => {
      const sp = getPart(id);
      return { ...sp, level: 1, ram: sp.ram ? frac(sp.ram * scale * atkMult) : 0 };
    }),
  };
}
