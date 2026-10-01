// ============================================================
// balance-sim — headless runs for balance checks (no browser, no renderer).
//
//   node tools/balance-sim.mjs [runs=400] [--skill=0.3] [--risk=0] [--gear=starter|mid] [--team=1-3] [--gearLvl=max] [--tierUp=N] [--abyss=N]
//
// Both sides are played by the game's own planner (ai/LaneAI.js) with its own
// action rules; enemies are built by Mech.enemyMech with main.js's HP formula.
// Skipped: burn ticks, crits beyond the flat 5%, drones' deploy action
// (they switch on from turn 2), cover and arena hazards. So treat the output
// as a comparison between rule sets, not as exact win rates.
//
// Each rule set runs the same seeds, so differences come from the rules.
// ============================================================

import { CONFIG } from '../src/config.js';
import { planTurn, applyAction } from '../src/ai/LaneAI.js';
import { PARTS, gearComp, enemyMech, enemyRig, enemyTier, pickEnemyElement, elementLean, roleElements, riskShred, withMech, getPart, legsRules, riskEase, tierRange, maxLevel, RARITY_ORDER, ELEMENT_DMG, GUN_TYPE_DMG } from '../src/meta/Mech.js';
import { withMastery } from '../src/meta/Mastery.js';
import { raidBoss } from '../src/meta/Raid.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => (a.startsWith('--') ? a.slice(2).split('=') : ['runs', a])));
const RUNS = Number(args.runs || 400);
const SKILL = Number(args.skill ?? 0.3); // 0 = sloppy new player, 1 = AUTO at its best
const RISK = Number(args.risk || 0);
const MASTERY = Number(args.mastery || 1);
const G = CONFIG.gear;
// Try other easing without editing config: --easeHp=0.55 --easeAtk=0.55 --easeAi=-0.15
for (const k of ['Hp', 'Atk', 'Ai']) if (args[`ease${k}`] != null) CONFIG.risk.ease[k.toLowerCase()] = Number(args[`ease${k}`]);
// ...and enemy HP / damage overall: --enemyHp=0.8 --enemyDmg=0.5
if (args.enemyHp != null) G.enemyHpScale = Number(args.enemyHp);
if (args.easeFull != null) CONFIG.risk.ease.fullAt = Number(args.easeFull);
// --curve=0.5,0.7,... : enemy HP/damage multiplier per Risk level (CONFIG.risk.ease.curve)
if (args.curve) CONFIG.risk.ease.curve = args.curve.split(',').map(Number);
if (args.enemyDmg != null) G.enemyDmgScale = Number(args.enemyDmg);
// --abyssHp=1.3 --abyssAtk=1.3: Abyss enemy strength (CONFIG.abyss.strength)
if (args.abyssHp != null || args.abyssAtk != null) CONFIG.abyss.strength = { hp: Number(args.abyssHp ?? CONFIG.abyss.strength.hp), atk: Number(args.abyssAtk ?? CONFIG.abyss.strength.atk) };
// --heatLoad=0.2 --drainLoad=0.1: heat / drain per point of damage (CONFIG.gear.dtypeLoad);
// --fxHeat=1.5 --fxDrain=1: every part's own heat-in / drain x this
if (args.heatLoad != null) G.dtypeLoad.heat = Number(args.heatLoad);
if (args.gunDmg) for (const kv of args.gunDmg.split(',')) { const [k, v] = kv.split(':'); GUN_TYPE_DMG[k] = Number(v); } // --gunDmg=energy:1.0: player gun damage by type
if (args.stagger != null) G.stagger.frac = Number(args.stagger); // --stagger=0.3: share of max HP in physical damage that staggers (9 = off)
if (args.blackoutAll != null) G.blackoutAll = args.blackoutAll === "1"; // --blackoutAll=1: every energy hit that empties the target jams it
if (args.breakHp != null) G.breakHp = Number(args.breakHp); // --breakHp=2.5: HP per point of drain an empty battery can't cover
if (args.drainLoad != null) G.dtypeLoad.energy = Number(args.drainLoad);
for (const [flag, k] of [['fxHeat', 'heat'], ['fxDrain', 'drain']]) if (args[flag] != null) for (const p of PARTS) if (typeof p.fx?.[k] === 'number') p.fx[k] = Math.round(p.fx[k] * Number(args[flag]));
if (args.rx) CONFIG.risk.gearComp.rx = CONFIG.risk.gearComp.rx.map(() => Number(args.rx)); // --rx=1.4: one enemy heat / drain multiplier at every Risk
// --elemDmg=phys:1.3,energy:0.6 : enemy damage by type (Mech.ELEMENT_DMG)
if (args.elemDmg) for (const kv of args.elemDmg.split(',')) { const [k, v] = kv.split(':'); ELEMENT_DMG[k] = Number(v); }
const SIZE = CONFIG.lane?.size || 12;

// ---------- Loadouts ----------
const LOADOUTS = {
  starter: ['fr_scout', 'lg_strider', 'wp_blaster', 'wp_scatter', 'dr_gnat', 'md_plating'],
  // A few runs in: a rare frame, a real top gun, some armor
  mid: ['fr_brawler', 'lg_strider', 'wp_blaster', 'wp_scatter', 'wp_rifle', 'wp_mortar', 'dr_hornet', 'md_plating', 'md_physres', 'md_heavyplate'],
  // Sustain kit from this update
  sustain: ['fr_reclaimer', 'lg_strider', 'wp_blaster', 'wp_siphon', 'wp_breacher', 'wp_mortar', 'dr_medic', 'md_plating', 'md_salvage'],
  // Late game: epic / legendary kit (level 1, so a floor for what veterans bring)
  late: ['fr_colossus', 'lg_coil', 'wp_tesla', 'wp_beam', 'wp_rifle', 'wp_scatter', 'wp_missiles', 'wp_rail', 'dr_reaper', 'md_titanplate', 'md_overclock', 'md_composite', 'md_amp'],
  lateMedic: ['fr_colossus', 'lg_coil', 'wp_tesla', 'wp_beam', 'wp_rifle', 'wp_scatter', 'wp_missiles', 'wp_rail', 'dr_medic', 'md_titanplate', 'md_overclock', 'md_composite', 'md_amp'],
  // Endgame tank + heal (what players actually bring to Risk 10-XI): max HP, resists, every heal
  tankHeal: ['fr_reclaimer', 'lg_bulwark', 'wp_siphon', 'wp_omega', 'wp_needler', 'wp_tesla', 'wp_cluster', 'wp_nova', 'dr_medic', 'md_voidcore', 'md_titanplate', 'md_titanplate', 'md_heavyplate', 'md_composite', 'md_salvage', 'md_overclock', 'md_insulated'],
  // mid with one sustain piece each, to see what each is worth
  midMedic: ['fr_brawler', 'lg_strider', 'wp_blaster', 'wp_scatter', 'wp_rifle', 'wp_mortar', 'dr_medic', 'md_plating', 'md_physres', 'md_heavyplate'],
  midSiphon: ['fr_brawler', 'lg_strider', 'wp_blaster', 'wp_siphon', 'wp_rifle', 'wp_mortar', 'dr_hornet', 'md_plating', 'md_physres', 'md_heavyplate'],
  midSalvage: ['fr_reclaimer', 'lg_strider', 'wp_blaster', 'wp_scatter', 'wp_rifle', 'wp_mortar', 'dr_hornet', 'md_plating', 'md_physres', 'md_salvage'],
  // Counter check (Super Mechs' "one stat maxed" builds): the same mid kit with all 8 modules on one defense,
  // against --element=phys|heat|energy enemies. A counter should win its matchup, not every matchup.
  ...Object.fromEntries(Object.entries({ resPhys: 'md_physres', resHeat: 'md_heatres', resElec: 'md_elecres', hpStack: 'md_heavyplate' })
    .map(([k, md]) => [k, ['fr_brawler', 'lg_strider', 'wp_blaster', 'wp_scatter', 'wp_rifle', 'wp_mortar', 'dr_hornet', ...Array(8).fill(md)]])),
  resMixed: ['fr_brawler', 'lg_strider', 'wp_blaster', 'wp_scatter', 'wp_rifle', 'wp_mortar', 'dr_hornet', 'md_physres', 'md_physres', 'md_heatres', 'md_heatres', 'md_elecres', 'md_elecres', 'md_plating', 'md_plating'],
  // ...and one damage type on offense (mixed defense), to see which guns carry and which get walled
  gunsHeat: ['fr_brawler', 'lg_strider', 'wp_flamer', 'wp_heatray', 'wp_scorcher', 'wp_napalm', 'dr_hornet', 'md_physres', 'md_physres', 'md_heatres', 'md_heatres', 'md_elecres', 'md_elecres', 'md_plating', 'md_plating'],
  gunsPhys: ['fr_brawler', 'lg_strider', 'wp_gauss', 'wp_rifle', 'wp_missiles', 'wp_rocket', 'dr_hornet', 'md_physres', 'md_physres', 'md_heatres', 'md_heatres', 'md_elecres', 'md_elecres', 'md_plating', 'md_plating'],
  newKit: ['fr_rampart', 'lg_strider', 'wp_piledriver', 'wp_arclash', 'wp_faultline', 'wp_stormcaller', 'dr_hornet', 'md_physres', 'md_physres', 'md_heatres', 'md_elecres', 'md_plating', 'md_plating'],
  gunsElec: ['fr_brawler', 'lg_strider', 'wp_emp', 'wp_beam', 'wp_ionizer', 'wp_arcmortar', 'dr_hornet', 'md_physres', 'md_physres', 'md_heatres', 'md_heatres', 'md_elecres', 'md_elecres', 'md_plating', 'md_plating'],
};
// --kit=file.json: a real loadout ([{ id, tier, level }], e.g. decoded from a save export) as gear "kit"
import { readFileSync } from 'node:fs';
// --kit=a.json,b.json: one file per garage mech (the team plays them in order)
const KITS = args.kit ? args.kit.split(',').map((file) => JSON.parse(readFileSync(file, 'utf8'))) : null;
const KIT = KITS?.[0] || null;
if (KIT) LOADOUTS.kit = KIT.map((o) => o.id);
const gear = (args.gear || (KIT ? 'kit' : 'starter')).split(',');

// ---------- RNG (seeded, so rule sets see the same runs) ----------
function mulberry(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Units ----------
function playerUnit(perm, hp, maxHp) {
  const m = perm.mech;
  const atk = 1 + (perm.atkBonus || 0);
  const legs = legsRules(getPart(m.legs?.id) || null);
  legs.stomp = m.legs.stomp;
  return {
    team: 'player', pos: 3, hp, maxHp,
    heat: 0, heatCap: m.rig.heatCap, cool: m.rig.cool, energy: m.rig.energy, energyMax: m.rig.energy, regen: m.rig.regen,
    actions: G.actions, maxActions: G.actions, legs,
    def: (perm.defBonus || 0) * (1 - riskData().defPierce), res: Object.fromEntries(Object.entries({ phys: 0, heat: 0, energy: 0, ...(perm.res || {}) }).map(([k, v]) => [k, v * (1 - riskData().defPierce)])),
    stompDmg: (legs.stomp || 0) * G.dmgScale * atk,
    shield: !!m.startForcefield, specials: m.specials.map((sp) => ({ kind: sp.special, uses: sp.uses, en: sp.en || 0, heat: sp.heat || 0, range: sp.range || 0, dist: sp.dist || 0, ram: (sp.ram || 0) * G.dmgScale * atk, away: !!sp.away, drain: sp.drain || 0 })),
    guns: m.weapons.map((w) => gunOf(w, w.dmg * G.dmgScale * atk * 1.0375)), // +5% crit x1.75
    drones: m.drones.map((d) => ({ dmg: (d.dmg || 0) * G.dmgScale * atk, heal: d.heal || 0, chill: d.chill || 0, en: d.upkeep?.en ?? 4, dtype: d.dtype || 'phys' })),
    killHeal: m.killHeal || 0,
  };
}

function gunOf(w, dmg) {
  return {
    dmg, burst: w.fx?.burst || 1, en: w.en || 0, heat: w.heat || 0, reach: w.reach, ammo: w.ammo || 0, ammoLeft: w.ammo || 0, used: false,
    dtype: w.dtype || 'phys', pierce: !!w.fx?.pierce, heatFx: w.fx?.heat, drain: w.fx?.drain, push: w.fx?.push || 0, pull: w.fx?.pull || 0,
    drag: w.fx?.drag || 0, freeze: !!w.fx?.freeze, mine: !!w.fx?.mine, hotBonus: !!w.fx?.hotBonus, lowEnBonus: !!w.fx?.lowEnBonus, execute: w.fx?.execute || 0,
    meltdown: !!w.fx?.meltdown, steal: !!w.fx?.steal, jam: !!w.fx?.jam, coolDmg: w.fx?.coolDmg || 0, regenDmg: w.fx?.regenDmg || 0,
    dump: !!w.fx?.dump, load: w.fx?.load || 1, dumpScale: G.dmgScale / G.rxScale, backfire: Math.round((w.backfire || 0) * G.dmgScale),
    resDrain: { ...(w.fx?.resDrain || {}), ...(w.fx?.corrode ? { phys: w.fx.corrode } : {}) },
  };
}

const ARCH_KEYS = (floor) => Object.entries(CONFIG.archetypeWeights[Math.min(5, floor)] || CONFIG.archetypeWeights[1]);
function pickArch(floor, rnd, element) {
  if (args.arch) return args.arch; // --arch=tank: every enemy is this archetype
  // Only roles that come in the enemy's damage type (main.js pickArchetype)
  const list = ARCH_KEYS(floor).filter(([k]) => roleElements(k).includes(element)).map(([k, w]) => [k, k === 'corroder' ? w * riskShred(RISK).role : w]);
  let r = rnd() * list.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of list) if ((r -= w) <= 0) return k;
  return list[0][0];
}

// ---------- Abyss (main.js: enemy scaling per depth below floor 5, abyssKeeper, sectorCleared) ----------
const ABYSS_FINAL_DEPTH = 5;
const ABYSS_HP_PER_DEPTH = 0.08;
const ABYSS_ATK_PER_DEPTH = 0.08;
/** Who ends Abyss floor `depth`: a Warden (boss) on even floors and the final one, else a Guardian (mini-boss). */
const abyssKeeper = (depth) => (depth === ABYSS_FINAL_DEPTH || depth % 2 === 0 ? 'boss' : 'miniboss');

/** One enemy team; `depth` > 0 = an Abyss floor (floor 5's tables, always full strength, deeper = harder). */
function enemyTeam(type, floor, rnd, playerRes = {}, depth = 0) {
  const count = CONFIG.enemyCounts[type]?.[floor] || 1;
  const tier = enemyTier(type, floor);
  const risk = riskData();
  const elite = type !== 'combat';
  // The Abyss skips the Risk curve: gear compensation only (main.js)
  const S = CONFIG.abyss.strength || { hp: 1, atk: 1 };
  const ease = depth ? { hp: gearComp(RISK).hp * S.hp, atk: gearComp(RISK).atk * S.atk, ai: 0 } : riskEase(RISK);
  const hpMult = (1 + (risk.hpPct + (elite ? risk.eliteHpPct : 0)) / 100) * ease.hp * (1 + ABYSS_HP_PER_DEPTH * depth);
  const atkMult = (1 + (risk.atkPct + (elite ? risk.eliteAtkPct : 0)) / 100) * ease.atk * (1 + ABYSS_ATK_PER_DEPTH * depth);
  // Their reactors ramp with depth: heat cap and battery, and the heat / drain their guns push
  const rxCap = 1 + CONFIG.abyss.reactorPerDepth * depth;
  const rxOut = depth ? (1 + 0.05 * (CONFIG.map.floors - 1)) * (1 + ABYSS_ATK_PER_DEPTH * depth) : null;
  const floorHp = 1 + CONFIG.floorScaling.hpPerFloor * (floor - 1);
  const waveHp = count === 3 ? 0.75 : count === 2 ? 0.85 : 1;
  const out = [];
  for (let i = 0; i < count; i++) {
    // --element=heat forces one damage type; otherwise it leans toward your weakest resist
    const element = args.element || pickEnemyElement(playerRes, elementLean(type, floor, depth) * Number(args.lean ?? 1), rnd); // --lean=0: even odds
    const archetype = type === 'boss' && i === 0 ? 'standard' : pickArch(floor, rnd, element);
    const arch = CONFIG.enemyArchetypes[archetype];
    const boss = type === 'boss' && i === 0;
    const final = boss && depth === ABYSS_FINAL_DEPTH; // Klonkadoo Prime
    const mech = enemyMech(type, archetype, floor, rnd, { atkMult, boss, final, element, shredChance: riskShred(RISK).gun, rxOut, rxMult: gearComp(RISK).rx });
    const rig = { ...enemyRig(type, { cdCut: risk.gunCdCut || 0, element: mech.element }) };
    for (const k of ['heatCap', 'energy']) rig[k] = Math.round(rig[k] * rxCap);
    // --rxCap=1.24 --rxRate=1.24: try Abyss-style reactor growth (capacity: heat cap + battery; rate: cooling + regen)
    if (args.rxCap) for (const k of ['heatCap', 'energy']) rig[k] = Math.round(rig[k] * Number(args.rxCap));
    if (args.rxRate) for (const k of ['cool', 'regen']) rig[k] = Math.round(rig[k] * Number(args.rxRate));
    const maxHp = Math.round(tier.hp * G.enemyHpScale * arch.hpMult * hpMult * floorHp * waveHp * (final ? 1.5 : 1) * (type === 'boss' && i > 0 ? 0.55 : 1));
    out.push({
      team: 'enemy', pos: 9, hp: maxHp, maxHp, heat: 0, heatCap: rig.heatCap, cool: rig.cool, energy: rig.energy, energyMax: rig.energy, regen: rig.regen,
      actions: G.actions, maxActions: G.actions, legs: mech.legs,
      def: tier.def + arch.defBonus, res: { ...mech.res },
      stompDmg: Math.round((mech.legs.stomp || 0) * G.dmgScale * G.enemyDmgScale * 0.75 * (1 + 0.1 * (floor - 1))),
      shield: !!mech.startForcefield,
      specials: mech.specials.map((sp) => ({ kind: sp.special, uses: sp.uses, en: sp.en || 0, heat: sp.heat || 0, range: sp.range || 0, dist: sp.dist || 0, ram: sp.ram || 0 })),
      guns: mech.weapons.map((w) => ({ ...gunOf(w, w.dmg), backfire: w.backfire || 0 })),
      drones: mech.drones.map((d) => ({ dmg: d.dmg || 0, heal: d.heal || 0, en: d.upkeep?.en ?? 4, dtype: d.dtype || 'phys' })),
      difficulty: Math.max(0.1, Math.min(0.95, tier.aiDifficulty + arch.aiShift + (risk.aiBonus || 0) + ease.ai)),
      droneOn: !!risk.droneOut,
    });
  }
  if (type === 'boss' && out.length > 1) out.push(out.shift()); // escorts fight first, the boss last (as in main.js)
  return out;
}

function riskData() {
  const t = { hpPct: 0, atkPct: 0, eliteHpPct: 0, eliteAtkPct: 0, minusHeal: 0, plusDmgTaken: 0, aiBonus: 0, defPierce: 0, gunCdCut: 0, allElite: false };
  // Risk 11 = the secret OBLIVION on top of all ten
  const rules = [...CONFIG.risk.levels.slice(0, RISK), ...(RISK > CONFIG.risk.levels.length ? [CONFIG.risk.secret] : [])];
  for (const r of rules) for (const k of Object.keys(t)) t[k] = typeof t[k] === 'boolean' ? t[k] || !!r[k] : t[k] + (r[k] || 0);
  // OBLIVION: the numbered rules before it count double (SaveSystem.getRiskData)
  if (rules.some((r) => r.doubleRules)) for (const k of ['hpPct', 'atkPct', 'eliteHpPct', 'eliteAtkPct', 'minusHeal', 'plusDmgTaken', 'aiBonus']) t[k] *= 2;
  return t;
}

/** An owned part: --gearLvl=max levels it to its tier cap, --tierUp=N transforms it N tiers (as far as it goes). */
function ownedPart(id) {
  const real = KIT?.find((o) => o.id === id);
  if (real && !args.tierUp && !args.gearLvl) return { id, tier: real.tier, level: real.level };
  const base = getPart(id);
  const top = RARITY_ORDER.indexOf(tierRange(base)[1]);
  const tier = RARITY_ORDER[Math.min(top, RARITY_ORDER.indexOf(base.rarity) + Number(args.tierUp || 0))];
  const o = { id, level: 1, tier };
  if (args.gearLvl === 'max') o.level = maxLevel(o);
  return o;
}

// ---------- One battle ----------
const DEF_PER_POINT = 0.04;

/** Start of a unit's turn (Game._upkeep). Returns false when the turn is lost. */
function upkeep(u) {
  u.energy = Math.min(u.energyMax, u.energy + u.regen);
  u.actions = u.maxActions;
  u.freeUsed = false;
  u.stomped = false;
  u.jammed = !!u.jamNext;
  u.jamNext = false;
  for (const g of u.guns) g.used = false;
  u.stagger = (u.stagger || 0) * (1 - G.stagger.decay);
  if (u.staggered) {
    u.staggered = false;
    u.heat = Math.max(0, u.heat - u.cool);
    return false;
  }
  const over = u.heat > u.heatCap;
  u.heat = Math.max(0, u.heat - u.cool);
  return !over;
}

/** End of a unit's turn: its drones act (from its second turn on). */
function drones(me, foe, turn, heal) {
  if (turn < 2 && !me.droneOn) return;
  for (const d of me.drones) {
    if (me.energy < d.en) continue;
    if (d.heal) {
      if (me.hp >= me.maxHp || (d.healed || 0) >= me.maxHp * G.droneHealCap) continue;
      const before = me.hp;
      me.hp = Math.min(me.maxHp, me.hp + Math.min(me.maxHp * G.droneHealCap - (d.healed || 0), d.heal * (me.team === 'player' ? heal : 1)));
      d.healed = (d.healed || 0) + me.hp - before;
    } else if (d.chill) {
      if (me.heat <= 0) continue;
      me.heat = Math.max(0, me.heat - d.chill);
    } else if (d.dmg && foe.hp > 0) {
      const resist = Math.min(15, (foe.def || 0) + (foe.res?.[d.dtype] || 0));
      foe.hp -= Math.max(1, Math.round(d.dmg * (1 - resist * DEF_PER_POINT)));
    } else continue;
    me.energy -= d.en;
  }
}

/** Plays one side's turn with the planner, one action at a time (it re-plans after each, like Game). */
function playTurn(me, foe, mines, difficulty, rnd) {
  const hp0 = foe.hp;
  me.idle = (me.idle || 0) + 1;
  for (let guard = 0; guard < 8 && me.actions > 0 && me.hp > 0 && foe.hp > 0; guard++) {
    const s = { size: SIZE, me, foe, mines, stompHeat: G.stompHeat };
    const plan = planTurn(s, { difficulty, rnd, stall: me.idle || 0 });
    const a = plan[0] || { type: 'end' };
    const st = { size: SIZE, me, foe, mines, stompHeat: G.stompHeat, dealt: 0 };
    if (!applyAction(st, a)) break;
    if (args.trace) (me.trace ||= []).push(a.type === 'fire' ? `fire${a.gun}` : a.type === 'move' ? `move${a.pos}` : a.type);
    if (a.type === 'end') break;
  }
  if (foe.hp < hp0) me.idle = 0;
}

/** A player hit through Game.calculatePlayerDamage: flat DEF instead of the planner's %. */
function fixPlayerHit(p, before) {
  // The planner already took HP off at 4%/DEF point; for the starter (0 DEF) the two agree.
  return before;
}

/**
 * One fight against an enemy team with your team ([{ perm, hp, maxHp }]; HP is
 * written back). When a mech is knocked out, the next one drops in on the same
 * spot; knocked-out mechs stay down until a Safe Zone (main.js).
 * Returns { won, turns }.
 */
function battle(team, type, floor, rnd, rules, depth = 0) {
  const heal = rules.healMult;
  const foes = enemyTeam(type, floor, rnd, team[0].perm.res, depth);
  // Abyss INSANITY (Game._tickInsanity): every turn, yours and theirs, enemies hit +1% harder
  // for the rest of the battle and the one on the lane loses 1% of its max HP
  const I = depth ? CONFIG.abyss.insanity : null;
  let insanity = 0;
  const tickInsanity = (e) => {
    if (!I) return;
    insanity += I.dmgPerTurn;
    for (const f of foes) f.enrage = 1 + insanity;
    e.hp -= Math.max(1, Math.round(e.maxHp * I.hpPerTurn));
  };
  let idx = team.findIndex((m) => m.hp > 0);
  if (idx < 0) return { won: false, turns: 0 };
  let p = playerUnit(team[idx].perm, team[idx].hp, team[idx].maxHp);
  const writeBack = () => (team[idx].hp = Math.max(0, p.hp));
  let turns = 0;
  // --fights: what each side did per turn (the numbers rework's ratios)
  const stat = { yourTurns: 0, foeTurns: 0, youLost: 0, foeLost: 0, dealt: 0, taken: 0, foeHp: 0 };
  for (const e of foes) {
    stat.foeHp += e.hp;
    const mines = [];
    p.pos = 3;
    e.pos = Math.min(SIZE, p.pos + 6);
    let pt = 0;
    let et = 0;
    let first = true;
    while (e.hp > 0 && turns < (depth ? 400 : 60)) { // Abyss insanity ends any fight in time: no cap there
      turns += 1;
      const eHp0 = e.hp;
      stat.yourTurns += 1;
      tickInsanity(e);
      if (e.hp <= 0) break;
      if (first || upkeep(p)) playTurn(p, e, mines, SKILL, rnd);
      else stat.youLost += 1;
      first = false;
      pt += 1;
      drones(p, e, pt, heal);
      stat.dealt += eHp0 - Math.max(0, e.hp);
      if (e.hp <= 0) break;
      const pHp0 = p.hp;
      stat.foeTurns += 1;
      tickInsanity(e);
      if (e.hp <= 0) break;
      if (upkeep(e)) playTurn(e, p, mines, e.difficulty, rnd);
      else stat.foeLost += 1;
      // --trace: what both sides did, for fights that drag on (loops)
      if (args.trace && turns > 40 && turns <= 46) console.log(`T${turns} you@${p.pos} hp${Math.round(p.hp)} heat${Math.round(p.heat)}/${p.heatCap} en${Math.round(p.energy)} [${(p.trace || []).join(' ')}] | foe@${e.pos} hp${Math.round(e.hp)} heat${Math.round(e.heat)}/${e.heatCap} en${Math.round(e.energy)} [${(e.trace || []).join(' ')}] guns ${e.guns.map((g) => g.reach.join('-')).join(',')}`);
      p.trace = []; e.trace = [];
      et += 1;
      drones(e, p, et, 1);
      stat.taken += pHp0 - Math.max(0, p.hp);
      if (p.hp <= 0) {
        // Knocked out: the next team mech drops in on the same spot
        writeBack();
        const next = team.findIndex((m) => m.hp > 0);
        if (next < 0) return { won: false, turns, stat };
        const pos = p.pos;
        idx = next;
        p = playerUnit(team[idx].perm, team[idx].hp, team[idx].maxHp);
        p.pos = pos;
        first = true;
        pt = 0;
      }
    }
    if (e.hp > 0) {
      writeBack();
      return { won: false, turns, timeout: true, stat };
    }
    if (p.killHeal) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * p.killHeal * heal);
  }
  writeBack();
  // Knocked-out mechs stay down until a Safe Zone (--limp=1: the old rule, they limp on at 1 HP)
  if (args.limp) for (const m of team) m.hp = Math.max(1, m.hp);
  return { won: true, turns, stat };
}

/** The weekly raid boss (meta/Raid.js raidBoss) as a sim unit, at full pool. */
function raidUnit(b) {
  return {
    team: 'enemy', pos: 9, hp: b.maxHp, maxHp: b.maxHp, heat: 0, heatCap: b.rig.heatCap, cool: b.rig.cool, energy: b.rig.energy, energyMax: b.rig.energy, regen: b.rig.regen,
    actions: G.actions, maxActions: G.actions, legs: b.legs, def: b.def, res: { ...b.res },
    stompDmg: Math.round((b.legs.stomp || 0) * G.dmgScale * G.enemyDmgScale * 0.75 * 1.4),
    shield: false,
    specials: b.specials.map((sp) => ({ kind: sp.special, uses: sp.uses, en: sp.en || 0, heat: sp.heat || 0, range: sp.range || 0, dist: sp.dist || 0, ram: sp.ram || 0 })),
    guns: b.weapons.map((w) => ({ ...gunOf(w, w.dmg), backfire: w.backfire || 0 })),
    drones: b.drones.map((d) => ({ dmg: d.dmg || 0, heal: d.heal || 0, en: d.upkeep?.en ?? 4, dtype: d.dtype || 'phys' })),
    difficulty: b.aiDifficulty,
  };
}

/**
 * One raid attempt: your team (full HP) vs the enraging boss until the team is down. Returns { dealt, turns, locked (boss turns lost to heat), broke (boss hit empty) }.
 */
function raidAttempt(team, boss, rnd) {
  const e = raidUnit(boss);
  const start = e.hp;
  let idx = 0;
  let p = playerUnit(team[idx].perm, team[idx].hp, team[idx].maxHp);
  const mines = [];
  p.pos = 3;
  e.pos = Math.min(SIZE, p.pos + 6);
  let turns = 0;
  let locked = 0;
  let broke = 0;
  let pt = 0;
  let first = true;
  while (e.hp > 0 && turns < 300) {
    turns += 1;
    e.enrage = (1 + CONFIG.raid.enragePerTurn) ** (turns - 1); // Game._startEnemyTurn
    if (first || upkeep(p)) playTurn(p, e, mines, SKILL, rnd);
    first = false;
    drones(p, e, ++pt, 1);
    if (e.energy <= 0) broke += 1;
    if (e.hp <= 0) break;
    if (upkeep(e)) playTurn(e, p, mines, e.difficulty, rnd);
    else locked += 1;
    drones(e, p, turns, 1);
    // --trace: the raid turn by turn (every 5th)
    if (args.trace && turns % 5 === 0) console.log(`T${turns} mech${idx + 1}@${p.pos} hp${Math.round(p.hp)} en${Math.round(p.energy)} heat${Math.round(p.heat)} [${(p.trace || []).join(' ')}] | boss@${e.pos} x${e.enrage.toFixed(1)} en${Math.round(e.energy)} heat${Math.round(e.heat)}/${e.heatCap} [${(e.trace || []).join(' ')}] guns ${e.guns.map((g) => `${g.reach.join('-')}:${Math.round(g.dmg)}/${g.en}en`).join(' ')}`);
    p.trace = []; e.trace = [];
    if (p.hp <= 0) {
      team[idx].hp = 0;
      idx = team.findIndex((m) => m.hp > 0);
      if (idx < 0) break;
      const pos = p.pos;
      p = playerUnit(team[idx].perm, team[idx].hp, team[idx].maxHp);
      p.pos = pos;
      first = true;
      pt = 0;
    }
  }
  return { dealt: start - Math.max(0, e.hp), turns, locked, broke };
}

/** Your team for a run: --team=N copies of the loadout (garage mechs 2 and 3), each with its own HP. */
// --boons=def,atk,hp,swift,power,regen: run boons (RunState.applyBoon; one of each counts)
const BOONS = (args.boons || '').split(',').filter(Boolean);
function withBoons(perm) {
  const p = { ...perm, mech: { ...perm.mech } };
  for (const b of new Set(BOONS)) {
    if (b === 'atk') p.atkBonus = (p.atkBonus || 0) + 0.1;
    else if (b === 'swift') p.atkBonus = (p.atkBonus || 0) + 0.08; // (+1 walk not modelled)
    else if (b === 'def') p.defBonus = (p.defBonus || 0) + 2;
    else if (b === 'hp') p.hpBonus = (p.hpBonus || 0) + 400;
    else if (b === 'power') p.mech.weapons = p.mech.weapons.map((w) => ({ ...w, reach: [w.reach[0], Math.min(SIZE - 1, w.reach[1] + 1)] }));
    else if (b === 'regen') p.boonRegen = (p.boonRegen || 0) + 0.06;
    else throw new Error('unknown boon ' + b);
  }
  return p;
}

function makeTeam(parts) {
  // A real kit as saved (duplicates at their own levels), one per garage mech
  const asSaved = KITS && parts === LOADOUTS.kit && !args.tierUp && !args.gearLvl;
  const size = Math.max(1, Math.min(3, Number(args.team || (asSaved ? KITS.length : 1))));
  return Array.from({ length: size }, (_, i) => {
    const owned = asSaved ? KITS[i % KITS.length].map((o) => ({ id: o.id, tier: o.tier, level: o.level })) : parts.map(ownedPart);
    const perm = withBoons(withMastery(withMech({}, owned), MASTERY));
    // GLASS ARMOR as less HP; mastery's VETERAN (damage taken -X%) as more
    const maxHp = Math.round((CONFIG.run.maxHpBase + (perm.hpBonus || 0)) / (1 + riskData().plusDmgTaken / 100) / (1 - (perm.kineticDampenerPct || 0)));
    return { perm, hp: maxHp, maxHp };
  });
}

// ---------- One run ----------
const PATH_TYPES = ['combat', 'encounter', 'shop', 'rest', 'elite', 'treasure', 'gamble'];

function pickNode(floor, rnd, hpPct, gold) {
  const w = CONFIG.nodes.floorWeights[floor];
  // The player sees ~3 options per step and takes what fits their HP
  const draw = () => {
    let r = rnd() * PATH_TYPES.reduce((s, t) => s + (w[t] || 0), 0);
    for (const t of PATH_TYPES) if ((r -= w[t] || 0) <= 0) return t;
    return 'combat';
  };
  const opts = [draw(), draw(), draw()];
  const want = hpPct < 0.55
    ? ['rest', gold >= 28 ? 'shop' : 'x', 'encounter', 'treasure', 'combat', 'gamble', 'elite']
    : ['combat', 'elite', 'encounter', 'treasure', 'shop', 'rest', 'gamble'];
  for (const t of want) if (opts.includes(t)) return t;
  return opts[0];
}

function simRun(seed, rules, parts) {
  const rnd = mulberry(seed);
  const team = makeTeam(parts);
  const heal = rules.healMult;
  const hpPct = () => team.reduce((s, m) => s + m.hp, 0) / team.reduce((s, m) => s + m.maxHp, 0);
  // Heals repair every standing mech (RunState.healFlat); only Safe Zones (`revive`) bring knocked-out ones back
  const healAll = (amount, revive = !!args.limp) => team.forEach((m) => (m.hp > 0 || revive) && (m.hp = Math.min(m.maxHp, m.hp + amount(m.maxHp) * heal)));
  let gold = CONFIG.currency.startGold;
  const log = { fights: 0, died: null, hpAtBoss: null, rests: 0, lowest: 1, depth: 0, abyssDied: null };
  // --abyss=N: after the floor 5 boss, keep descending up to N Abyss floors (laid out like floor 5,
  // HP carries over, each ends with its keeper). Dying down there still counts as a win.
  const lastFloor = 5 + Number(args.abyss || 0);
  for (let f = 1; f <= lastFloor; f++) {
    const depth = Math.max(0, f - 5);
    const floor = Math.min(5, f); // Abyss floors reuse floor 5's tables
    if (f > 1 && rules.floorHeal) healAll((max) => max * rules.floorHeal);
    const steps = CONFIG.map.baseFloorActions;
    for (let i = 0; i <= steps; i++) {
      let type;
      if (i === steps) {
        if (depth) type = abyssKeeper(depth);
        else if (floor === 3) type = 'miniboss';
        else if (floor === 5) type = 'boss';
        else break;
      } else type = pickNode(floor, rnd, hpPct(), gold);
      if (type === 'combat' && riskData().allElite) type = 'elite';
      if (type === 'boss' && !depth) log.hpAtBoss = hpPct();
      if (['combat', 'elite', 'miniboss', 'boss'].includes(type)) {
        const r = battle(team, type, floor, rnd, rules, depth);
        log.fights += 1;
        if (!r.won) {
          if (depth) log.abyssDied = { depth, type: i === steps ? 'keeper' : type };
          else log.died = { floor, type };
          return log;
        }
        // Nano Repair: a share of max HP after every won battle (main.js)
        const nano = team[0].perm.mech.healAfterWin || 0;
        if (nano) healAll((max) => max * nano);
        log.lowest = Math.min(log.lowest, hpPct());
        gold += (CONFIG.nodes.rewards[type] || {}).gold || 0;
        const regen = team[0].perm.boonRegen || 0;
        if (regen) healAll((max) => max * regen);
        const postHeal = rules.postWinHeal[type] || 0;
        if (postHeal) healAll((max) => max * postHeal);
        if (depth && i === steps) log.depth = depth; // this Abyss floor is cleared
      } else if (type === 'rest') {
        log.rests += 1;
        healAll(rules.rest, true);
      } else if (type === 'shop') {
        if (hpPct() < 0.7 && gold >= 28 && rnd() < 0.75) {
          gold -= 28;
          healAll((max) => max * 0.2); // FIELD REPAIR
        }
      } else if (type === 'encounter') {
        // A pick-one event: heal when hurt, gold otherwise; some cost HP
        if (hpPct() < 0.6) healAll(() => 20 * G.hpScale);
        else if (rnd() < 0.35) team[0].hp = Math.max(1, team[0].hp - (5 + rnd() * 9) * G.hpScale);
        else gold += 8;
      }
    }
  }
  return log;
}

// ---------- Rule sets ----------
const OLD = {
  name: 'OLD (heal after wins, rest 35 HP)',
  postWinHeal: { combat: 0.2, elite: 0.3, miniboss: 0.3, boss: 0.5 },
  rest: () => 35,
  healMult: 1,
};
const NEW = {
  name: 'CURRENT (no heal after wins, rest 50%)',
  postWinHeal: {},
  rest: (maxHp) => maxHp * (CONFIG.run.hpRegenRestPct || 0.5),
  healMult: 1,
};
const sets = args.compare ? [OLD, NEW] : [NEW]; // --compare=1 also plays the old heal-after-win rules
if (args.extra) {
  // Candidate middle grounds
  sets.push({ ...NEW, name: 'NEW + 10% patch after wins', postWinHeal: { combat: 0.1, elite: 0.1, miniboss: 0.1, boss: 0.1 } });
  sets.push({ ...NEW, name: 'NEW + 35% repair on each new floor', floorHeal: 0.35 });
  sets.push({ ...NEW, name: 'NEW + rest 65%', rest: (maxHp) => maxHp * 0.65 });
}
for (const s of sets) s.healMult = Math.max(0.2, 1 - riskData().minusHeal / 100);

// --raid: weekly raid attempts against each element's boss (size CONFIG.raid.pool: ~100 maxed attempts)
if (args.raid) {
  if (args.rigMult) CONFIG.raid.rigMult = { heat: Number(args.rigMult), energy: Number(args.rigMult) }; // --rigMult=2.5
  for (const g of gear) {
    console.log(`\n=== raid, gear: ${g}, skill ${SKILL}, team ${args.team || 1}, pool ${CONFIG.raid.pool} ===`);
    for (const week of [0, 1, 2].map((k) => 3000 + k)) { // one week of each element
      const boss = raidBoss(week);
      const rnd = mulberry(11);
      let dealt = 0, turns = 0, locked = 0, broke = 0, capped = 0;
      for (let i = 0; i < RUNS; i++) {
        const r = raidAttempt(makeTeam(LOADOUTS[g]), boss, rnd);
        dealt += r.dealt; turns += r.turns; locked += r.locked; broke += r.broke;
        if (r.turns >= 300) capped += 1;
      }
      const avg = dealt / RUNS;
      console.log(`${boss.element.padEnd(6)} ${boss.displayName.padEnd(18)} armor ${boss.strong}, bare ${boss.weak} | dmg/attempt ${Math.round(avg)} (${((avg / CONFIG.raid.pool) * 100).toFixed(2)}% of pool) | turns ${(turns / RUNS).toFixed(1)} (${Math.round((capped / RUNS) * 100)}% hit the cap) | boss turns lost to heat ${(locked / RUNS).toFixed(2)} | boss drained ${(broke / RUNS).toFixed(2)} turns`);
    }
  }
  process.exit(0);
}

// --fights: single fights from full HP, to calibrate against play ("a sloppy fight costs 40-60% HP")
if (args.fights) {
  for (const g of gear) {
    const maxHp = makeTeam(LOADOUTS[g])[0].maxHp;
    console.log(`\n=== single fights, gear: ${g}, skill ${SKILL}, team ${args.team || 1}, full HP ${maxHp} each ===`);
    const FIGHTS = args.depth ? [['elite', 5], ['miniboss', 5], ['boss', 5]] : [['combat', 1], ['combat', 2], ['elite', 2], ['combat', 3], ['elite', 3], ['miniboss', 3], ['combat', 5], ['elite', 5], ['boss', 5]];
    for (const [type, floor] of FIGHTS) {
      const rnd = mulberry(7);
      let won = 0, lost = 0, turns = 0, timeouts = 0;
      const S = { yourTurns: 0, foeTurns: 0, youLost: 0, foeLost: 0, dealt: 0, taken: 0, foeHp: 0 };
      for (let i = 0; i < RUNS; i++) {
        const team = makeTeam(LOADOUTS[g]);
        const r = battle(team, type, floor, rnd, NEW, Number(args.depth || 0)); // --depth=N: an Abyss floor
        if (r.won) { won += 1; lost += team.reduce((a, m) => a + (m.maxHp - m.hp), 0) / team.reduce((a, m) => a + m.maxHp, 0); }
        if (r.timeout) timeouts += 1;
        turns += r.turns;
        for (const k in S) S[k] += r.stat?.[k] || 0;
      }
      const per = (a, b) => (b ? Math.round(a / b) : 0);
      // --brief: one line per fight (win, HP it cost, your turns, turns lost to heat, team HP vs yours)
      if (args.brief) {
        console.log(`F${floor} ${type.padEnd(8)} win ${String(Math.round((won / RUNS) * 100)).padStart(3)}% | HP lost ${String(won ? Math.round((lost / won) * 100) : '-').padStart(3)}% | your turns ${(S.yourTurns / RUNS).toFixed(1).padStart(4)} (heat-lost ${String(Math.round((S.youLost / Math.max(1, S.yourTurns)) * 100)).padStart(2)}%, foe ${String(Math.round((S.foeLost / Math.max(1, S.foeTurns)) * 100)).padStart(2)}%) | you ${String(per(S.dealt, S.yourTurns)).padStart(4)}/t, foe ${String(per(S.taken, S.foeTurns)).padStart(4)}/t | foe HP ${(per(S.foeHp, RUNS) / maxHp).toFixed(2)}x yours${timeouts ? ` | timeouts ${timeouts}` : ''}`);
        continue;
      }
      console.log(`F${floor} ${type.padEnd(8)} win ${String(Math.round((won / RUNS) * 100)).padStart(3)}% | HP lost when won ${won ? Math.round((lost / won) * 100) : '-'}% | turns ${(turns / RUNS).toFixed(1)}${timeouts ? ` | timeouts ${timeouts}` : ''}`);
      console.log(`           you ${per(S.dealt, S.yourTurns)} dmg/turn, lost ${Math.round((S.youLost / Math.max(1, S.yourTurns)) * 100)}% of turns to heat | foe HP ${per(S.foeHp, RUNS)}, ${per(S.taken, S.foeTurns)} dmg/turn, lost ${Math.round((S.foeLost / Math.max(1, S.foeTurns)) * 100)}% of turns | your HP ${maxHp}: ${per(maxHp, per(S.taken, S.foeTurns))} of its turns to kill you, ${per(per(S.foeHp, RUNS), per(S.dealt, S.yourTurns))} of yours to kill it`);
    }
  }
  process.exit(0);
}

for (const g of gear) {
  const parts = LOADOUTS[g];
  console.log(`\n=== gear: ${g}  runs: ${RUNS}  skill: ${SKILL}  risk: ${RISK}  mastery: ${MASTERY} ===`);
  for (const rules of sets) {
    let wins = 0;
    let fights = 0;
    let bossHp = [];
    let lowest = 0;
    const deaths = {};
    const depths = [];
    const abyssDeaths = {};
    for (let i = 0; i < RUNS; i++) {
      const r = simRun(1000 + i, rules, parts);
      fights += r.fights;
      lowest += r.lowest;
      if (r.hpAtBoss != null) bossHp.push(r.hpAtBoss);
      if (!r.died) depths.push(r.depth);
      if (r.abyssDied) abyssDeaths[r.abyssDied.type] = (abyssDeaths[r.abyssDied.type] || 0) + 1;
      if (r.died) {
        const k = `F${r.died.floor} ${r.died.type}`;
        deaths[k] = (deaths[k] || 0) + 1;
      } else wins += 1;
    }
    const pct = (n) => `${Math.round((n / RUNS) * 100)}%`;
    const avg = (a) => (a.length ? `${Math.round((a.reduce((s, x) => s + x, 0) / a.length) * 100)}%` : '-');
    const topDeaths = Object.entries(deaths).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}: ${pct(v)}`).join(', ');
    console.log(`${rules.name}\n  win ${pct(wins)} | fights/run ${(fights / RUNS).toFixed(1)} | reached boss ${pct(bossHp.length)} at ${avg(bossHp)} HP | lowest HP avg ${Math.round((lowest / RUNS) * 100)}%\n  deaths: ${topDeaths || 'none'}`);
    // --abyss: how deep the winning runs got (floors cleared below floor 5)
    if (args.abyss && depths.length) {
      depths.sort((x, y) => x - y);
      const reach = [1, 2, 3, 4, 5, 6, 8, 10, 13, 16, 20].filter((d) => d <= Number(args.abyss)).map((d) => `${d}: ${pct(depths.filter((x) => x >= d).length)}`).join('  ');
      console.log(`  abyss (of all runs, floors cleared): median ${depths[Math.floor(depths.length / 2)]}, best ${depths[depths.length - 1]} | cleared at least ${reach}
  abyss deaths: ${Object.entries(abyssDeaths).map(([k, v]) => `${k} ${Math.round((v / depths.length) * 100)}%`).join(', ') || 'none'}`);
    }
  }
}
