// ============================================================
// ratio-report — the fight's core ratios, straight from the numbers. Headless.
//
//   node tools/ratio-report.mjs [--risk=10] [--stage=all|0..4] [--floor=5]
//
// The numbers rework (BACKLOG.md) targets ratios, not raw values:
//   shots/turn    how many shots a turn the reactor pays for, forever (regen / en, cooling / heat)
//   tank          shots a full reactor pays for from cold (energy / en, heat cap / heat)
//   burst         turns of 2 shots a turn (the best two guns) before you end a turn over your heat cap
//   hits          your average hits to kill it (after its resists), and its hits to kill you
//   turns         hits / shots you fire a turn (2 at most: 2 actions)
//   lock          its turns until its heat / drain (plus your own firing) puts you over cap / empty
// Player builds are one per damage type, at the gear stages Risk expects (CONFIG.risk.gearComp):
//   0 fresh (level 1)   1 max level (Risk I-IV)   2 one tier up (V-VI)   3 two up (VII-X)   4 three up (XI)
// Enemies are built like tools/balance-sim.mjs builds them (standard role, Mech.enemyMech + enemyRig).
// ============================================================

import { CONFIG } from '../src/config.js';
import { gearComp, withMech, getPart, tierRange, maxLevel, RARITY_ORDER, enemyMech, enemyRig, enemyTier, riskEase, dtypeOf } from '../src/meta/Mech.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const RISK = Number(args.risk ?? 10);
const G = CONFIG.gear;
const DEF = 0.04;
const STAGES = ['fresh', 'max lvl', '+1 tier', '+2 tiers', '+3 tiers'];
const stages = args.stage == null || args.stage === 'all' ? [0, 1, 2, 3, 4] : [Number(args.stage)];
const floors = args.floor ? [Number(args.floor)] : [1, 3, 5];

const BUILDS = {
  phys: ['fr_brawler', 'lg_strider', 'wp_blaster', 'wp_scatter', 'wp_rifle', 'wp_mortar', 'dr_hornet', 'md_plating', 'md_physres', 'md_heavyplate'],
  heat: ['fr_furnace', 'lg_jumpjets', 'wp_flamer', 'wp_heatray', 'wp_thermal', 'wp_napalm', 'dr_firefly', 'md_heatres', 'md_composite', 'md_heavyplate'],
  energy: ['fr_conduit', 'lg_coil', 'wp_emp', 'wp_beam', 'wp_ionizer', 'wp_arcmortar', 'dr_static', 'md_elecres', 'md_insulated', 'md_heavyplate'],
};

function owned(id, stage) {
  const base = getPart(id);
  const top = RARITY_ORDER.indexOf(tierRange(base)[1]);
  const tier = RARITY_ORDER[Math.min(top, RARITY_ORDER.indexOf(base.rarity) + Math.max(0, stage - 1))];
  const o = { id, tier, level: 1 };
  if (stage >= 1) o.level = maxLevel(o);
  return o;
}

const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const r0 = (v) => Math.round(v);
const r1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const pad = (s, n) => String(s).padStart(n);

/** Reactor ratios for a set of guns ({ en, heat }) on a rig. */
function reactor(rig, guns) {
  const en = avg(guns.map((g) => g.en));
  const heat = avg(guns.map((g) => g.heat));
  const perTurn = Math.min(en ? rig.regen / en : 9, heat ? rig.cool / heat : 9);
  const tank = Math.min(en ? rig.energy / en : 99, heat ? rig.heatCap / heat : 99);
  // Burst: the two hottest-per-turn guns every turn from cold (cooling at the start of each turn)
  const two = [...guns].sort((a, b) => b.heat - a.heat).slice(0, 2);
  const h2 = two.reduce((s, g) => s + g.heat, 0);
  const e2 = two.reduce((s, g) => s + g.en, 0);
  let heatNow = 0, enNow = rig.energy, burst = 0;
  for (let t = 1; t <= 30; t++) {
    heatNow = Math.max(0, heatNow - rig.cool) + h2;
    enNow = Math.min(rig.energy, enNow + (t > 1 ? rig.regen : 0)) - e2;
    if (heatNow > rig.heatCap || enNow < 0) break;
    burst = t;
  }
  return { en, heat, perTurn, tank, burst: burst >= 30 ? '∞' : burst };
}

function playerOf(type, stage) {
  const perm = withMech({}, BUILDS[type].map((id) => owned(id, stage)));
  const m = perm.mech;
  const atk = 1 + (perm.atkBonus || 0);
  const guns = m.weapons.map((w) => ({ id: w.id, dmg: w.dmg * G.dmgScale * atk * (w.fx?.burst || 1), en: w.en || 0, heat: w.heat || 0, dtype: dtypeOf(w) }));
  return { type, stage, hp: CONFIG.run.maxHpBase + perm.hpBonus, res: perm.res, rig: m.rig, guns, rx: reactor(m.rig, guns) };
}

function riskData() {
  const t = { hpPct: 0, atkPct: 0, eliteHpPct: 0, eliteAtkPct: 0 };
  const rules = [...CONFIG.risk.levels.slice(0, RISK), ...(RISK > CONFIG.risk.levels.length ? [CONFIG.risk.secret] : [])];
  for (const r of rules) for (const k in t) t[k] += r[k] || 0;
  if (rules.some((r) => r.doubleRules)) for (const k in t) t[k] *= 2;
  return t;
}

/** One enemy (standard role; the boss is the boss set), average over its gun picks. */
function enemyOf(type, floor, element) {
  const risk = riskData();
  const elite = type !== 'combat';
  const ease = riskEase(RISK);
  const hpMult = (1 + (risk.hpPct + (elite ? risk.eliteHpPct : 0)) / 100) * ease.hp;
  const atkMult = (1 + (risk.atkPct + (elite ? risk.eliteAtkPct : 0)) / 100) * ease.atk;
  const tier = enemyTier(type, floor);
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const mech = enemyMech(type, 'standard', floor, rnd, { atkMult, boss: type === 'boss', element, rxMult: gearComp(RISK).rx });
  const rig = enemyRig(type, { element: mech.element });
  const hp = tier.hp * G.enemyHpScale * CONFIG.enemyArchetypes.standard.hpMult * hpMult * (1 + CONFIG.floorScaling.hpPerFloor * (floor - 1));
  const guns = mech.weapons.map((w) => ({ id: w.id, dmg: w.dmg * (w.fx?.burst || 1), en: w.en || 0, heat: w.heat || 0, dtype: dtypeOf(w), heatIn: w.fx?.heat ?? (dtypeOf(w) === 'heat' ? w.dmg * G.dtypeLoad.heat * (w.fx?.load || 1) : 0), drain: w.fx?.drain ?? (dtypeOf(w) === 'energy' ? w.dmg * G.dtypeLoad.energy * (w.fx?.load || 1) : 0) }));
  return { type, floor, element: mech.element, hp, def: tier.def, res: mech.res, rig, guns, rx: reactor(rig, guns) };
}

const resist = (unit, dtype) => Math.min(15, (unit.def || 0) + (unit.res?.[dtype] || 0));

// ---------- Player table ----------
console.log(`\n=== your builds (4 guns, the three damage types) ===`);
console.log('stage     type    HP    | energy/regen  heatCap/cool | avg shot dmg  en  heat | shots/turn  tank  burst(2/turn)');
for (const s of stages) for (const type of Object.keys(BUILDS)) {
  const p = playerOf(type, s);
  console.log(`${STAGES[s].padEnd(9)} ${type.padEnd(7)}${pad(r0(p.hp), 5)}  | ${pad(p.rig.energy, 5)}/${pad(p.rig.regen, 4)}  ${pad(p.rig.heatCap, 7)}/${pad(p.rig.cool, 4)} | ${pad(r0(avg(p.guns.map((g) => g.dmg))), 12)} ${pad(r0(p.rx.en), 4)} ${pad(r0(p.rx.heat), 5)} | ${pad(r1(p.rx.perTurn), 10)} ${pad(r1(p.rx.tank), 5)} ${pad(p.rx.burst, 6)}`);
}

// ---------- Enemies and matchups ----------
// The stage Risk expects (gearComp): max level I-IV, +1 tier V-VI, +2 VII-X, +3 XI
const expected = RISK === 0 ? 0 : RISK <= 4 ? 1 : RISK <= 6 ? 2 : RISK <= 10 ? 3 : 4;
console.log(`\n=== enemies at Risk ${RISK}, vs your ${STAGES[expected]} build of the same type ===`);
console.log('fight        el      HP   | its shots/turn  dmg/hit→you  heat/drain per hit | your hits  turns | its hits on you  turns | locks you in');
for (const floor of floors) for (const type of ['combat', 'elite', ...(floor === 3 ? ['miniboss'] : []), ...(floor === 5 ? ['boss'] : [])]) {
  for (const element of ['phys', 'heat', 'energy']) {
    const e = enemyOf(type, floor, element);
    const p = playerOf(element === 'phys' ? 'phys' : element, expected);
    // You: your average hit after its resist, 2 shots a turn at most
    const yourHit = avg(p.guns.map((g) => g.dmg * (1 - resist(e, g.dtype) * DEF)));
    const yourShots = Math.min(2, p.rx.perTurn);
    const hitsToKill = e.hp / yourHit;
    // It: the same, on you
    const itsHit = avg(e.guns.map((g) => g.dmg * (1 - resist(p, g.dtype) * DEF)));
    const itsShots = Math.min(2, e.rx.perTurn);
    const itsHits = p.hp / itsHit;
    // Lock: its heat-in (or drain) per turn on top of your own firing at your sustained rate
    const heatIn = avg(e.guns.map((g) => g.heatIn * (1 - resist(p, 'heat') * DEF))) * itsShots;
    const drain = avg(e.guns.map((g) => g.drain * (1 - resist(p, 'energy') * DEF))) * itsShots;
    const netHeat = heatIn + yourShots * p.rx.heat - p.rig.cool;
    const netEn = drain + yourShots * p.rx.en - p.rig.regen;
    const lockHeat = heatIn && netHeat > 0 ? p.rig.heatCap / netHeat : Infinity;
    const lockEn = drain && netEn > 0 ? p.rig.energy / netEn : Infinity;
    const lock = Math.min(lockHeat, lockEn);
    const lockTxt = lock === Infinity ? '-' : `${r1(lock)} (${lockHeat <= lockEn ? 'heat' : 'drain'})`;
    const heatDrain = e.guns.some((g) => g.heatIn || g.drain) ? `${r0(avg(e.guns.map((g) => g.heatIn)))}/${r0(avg(e.guns.map((g) => g.drain)))}` : '-';
    console.log(`F${floor} ${type.padEnd(9)} ${e.element.padEnd(6)}${pad(r0(e.hp), 6)} | ${pad(r1(e.rx.perTurn), 14)} ${pad(r0(itsHit), 12)} ${pad(heatDrain, 18)} | ${pad(r1(hitsToKill), 9)} ${pad(r1(hitsToKill / yourShots), 6)} | ${pad(r1(itsHits), 15)} ${pad(r1(itsHits / itsShots), 6)} | ${lockTxt}`);
  }
}
console.log('\n(turns = hits / shots a turn, 2 at most; the sim adds moving, misses of range and lost turns: node tools/balance-sim.mjs --fights=1)');
