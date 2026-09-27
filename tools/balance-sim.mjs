// ============================================================
// balance-sim — headless runs for balance checks (no browser, no renderer).
//
//   node tools/balance-sim.mjs [runs=400] [--skill=0.3] [--risk=0] [--gear=starter|mid]
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
import { enemyMech, enemyRig, withMech, getPart, legsRules, riskEase } from '../src/meta/Mech.js';
import { withMastery } from '../src/meta/Mastery.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => (a.startsWith('--') ? a.slice(2).split('=') : ['runs', a])));
const RUNS = Number(args.runs || 400);
const SKILL = Number(args.skill ?? 0.3); // 0 = sloppy new player, 1 = AUTO at its best
const RISK = Number(args.risk || 0);
const MASTERY = Number(args.mastery || 1);
const G = CONFIG.gear;
// Try other easing without editing config: --easeHp=0.55 --easeAtk=0.55 --easeAi=-0.15
for (const k of ['Hp', 'Atk', 'Ai']) if (args[`ease${k}`] != null) CONFIG.risk.ease[k.toLowerCase()] = Number(args[`ease${k}`]);
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
  // mid with one sustain piece each, to see what each is worth
  midMedic: ['fr_brawler', 'lg_strider', 'wp_blaster', 'wp_scatter', 'wp_rifle', 'wp_mortar', 'dr_medic', 'md_plating', 'md_physres', 'md_heavyplate'],
  midSiphon: ['fr_brawler', 'lg_strider', 'wp_blaster', 'wp_siphon', 'wp_rifle', 'wp_mortar', 'dr_hornet', 'md_plating', 'md_physres', 'md_heavyplate'],
  midSalvage: ['fr_reclaimer', 'lg_strider', 'wp_blaster', 'wp_scatter', 'wp_rifle', 'wp_mortar', 'dr_hornet', 'md_plating', 'md_physres', 'md_salvage'],
};
const gear = (args.gear || 'starter').split(',');

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
    def: perm.defBonus || 0, res: { phys: 0, heat: 0, energy: 0, ...(perm.res || {}) },
    stompDmg: (legs.stomp || 0) * G.dmgScale * atk,
    shield: !!m.startForcefield, specials: m.specials.map((sp) => ({ kind: sp.special, uses: sp.uses, en: sp.en || 0, heat: sp.heat || 0, range: sp.range || 0, dist: sp.dist || 0, ram: (sp.ram || 0) * G.dmgScale * atk, away: !!sp.away, drain: sp.drain || 0 })),
    guns: m.weapons.map((w) => gunOf(w, w.dmg * G.dmgScale * atk * 1.0375)), // +5% crit x1.75
    drones: m.drones.map((d) => ({ dmg: (d.dmg || 0) * G.dmgScale * atk, heal: d.heal || 0, chill: d.chill || 0, en: d.upkeep?.en ?? 4, dtype: d.dtype || 'phys' })),
    killHeal: m.killHeal || 0, lifesteal: 0,
  };
}

function gunOf(w, dmg) {
  return {
    dmg, burst: w.fx?.burst || 1, en: w.en || 0, heat: w.heat || 0, reach: w.reach, ammo: w.ammo || 0, ammoLeft: w.ammo || 0, used: false,
    dtype: w.dtype || 'phys', pierce: !!w.fx?.pierce, heatFx: w.fx?.heat, drain: w.fx?.drain, push: w.fx?.push || 0, pull: w.fx?.pull || 0,
    drag: w.fx?.drag || 0, freeze: !!w.fx?.freeze, mine: !!w.fx?.mine, hotBonus: !!w.fx?.hotBonus, execute: w.fx?.execute || 0,
    meltdown: !!w.fx?.meltdown, steal: !!w.fx?.steal, jam: !!w.fx?.jam, coolDmg: w.fx?.coolDmg || 0, regenDmg: w.fx?.regenDmg || 0,
    dump: !!w.fx?.dump, dumpScale: G.dmgScale, backfire: Math.round((w.backfire || 0) * G.dmgScale), lifesteal: w.fx?.lifesteal || 0,
    resDrain: { ...(w.fx?.resDrain || {}), ...(w.fx?.corrode ? { phys: w.fx.corrode } : {}) },
  };
}

const ARCH_KEYS = (floor) => Object.entries(CONFIG.archetypeWeights[Math.min(5, floor)] || CONFIG.archetypeWeights[1]);
function pickArch(floor, rnd) {
  const list = ARCH_KEYS(floor);
  let r = rnd() * list.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of list) if ((r -= w) <= 0) return k;
  return list[0][0];
}

function enemyTeam(type, floor, rnd) {
  const count = CONFIG.enemyCounts[type]?.[floor] || 1;
  const tier = CONFIG.enemyTiers[type === 'combat' ? floor : type];
  const risk = riskData();
  const elite = type !== 'combat';
  const ease = riskEase(RISK);
  const hpMult = (1 + (risk.hpPct + (elite ? risk.eliteHpPct : 0)) / 100) * ease.hp;
  const atkMult = (1 + (risk.atkPct + (elite ? risk.eliteAtkPct : 0)) / 100) * ease.atk;
  const floorHp = 1 + CONFIG.floorScaling.hpPerFloor * (floor - 1);
  const waveHp = count === 3 ? 0.75 : count === 2 ? 0.85 : 1;
  const out = [];
  for (let i = 0; i < count; i++) {
    const archetype = type === 'boss' && i === 0 ? 'standard' : pickArch(floor, rnd);
    const arch = CONFIG.enemyArchetypes[archetype];
    const boss = type === 'boss' && i === 0;
    const mech = enemyMech(type, archetype, floor, rnd, { atkMult, boss });
    const rig = enemyRig(type);
    const maxHp = Math.round(tier.hp * arch.hpMult * hpMult * floorHp * waveHp * (type === 'boss' && i > 0 ? 0.55 : 1));
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
  return out;
}

function riskData() {
  const t = { hpPct: 0, atkPct: 0, eliteHpPct: 0, eliteAtkPct: 0, minusHeal: 0, plusDmgTaken: 0, aiBonus: 0 };
  for (const r of CONFIG.risk.levels.slice(0, RISK)) for (const k of Object.keys(t)) t[k] += r[k] || 0;
  return t;
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
      if (me.hp >= me.maxHp) continue;
      me.hp = Math.min(me.maxHp, me.hp + d.heal * (me.team === 'player' ? heal : 1));
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
  for (let guard = 0; guard < 8 && me.actions > 0 && me.hp > 0 && foe.hp > 0; guard++) {
    const s = { size: SIZE, me, foe, mines, stompHeat: G.stompHeat };
    const plan = planTurn(s, { difficulty, rnd });
    const a = plan[0] || { type: 'end' };
    const hpBefore = foe.hp;
    const st = { size: SIZE, me, foe, mines, stompHeat: G.stompHeat, dealt: 0 };
    if (!applyAction(st, a)) break;
    // Siphon Ray
    if (a.type === 'fire' && me.guns[a.gun]?.lifesteal && me.team === 'player') me.hp = Math.min(me.maxHp, me.hp + (hpBefore - foe.hp) * me.guns[a.gun].lifesteal);
    if (a.type === 'end') break;
  }
}

/** A player hit through Game.calculatePlayerDamage: flat DEF instead of the planner's %. */
function fixPlayerHit(p, before) {
  // The planner already took HP off at 4%/DEF point; for the starter (0 DEF) the two agree.
  return before;
}

/** One fight against an enemy team. Returns { won, hpLeft, turns }. */
function battle(perm, hp, maxHp, type, floor, rnd, rules) {
  const p = playerUnit(perm, hp, maxHp);
  const heal = rules.healMult;
  const foes = enemyTeam(type, floor, rnd);
  let turns = 0;
  for (const e of foes) {
    const mines = [];
    p.pos = 3;
    e.pos = Math.min(SIZE, p.pos + 6);
    let pt = 0;
    let et = 0;
    let first = true;
    while (p.hp > 0 && e.hp > 0 && turns < 60) {
      turns += 1;
      if (first ? true : upkeep(p)) {
        playTurn(p, e, mines, SKILL, rnd);
      }
      first = false;
      pt += 1;
      drones(p, e, pt, heal);
      if (e.hp <= 0) break;
      if (upkeep(e)) playTurn(e, p, mines, e.difficulty, rnd);
      et += 1;
      drones(e, p, et, 1);
      // Risk GLASS ARMOR etc.
    }
    if (p.hp <= 0) return { won: false, hpLeft: 0, turns };
    if (e.hp > 0) return { won: false, hpLeft: 0, turns, timeout: true };
    if (p.killHeal) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * p.killHeal * heal);
    // The next mech drops in: your reactor carries over
  }
  return { won: true, hpLeft: p.hp, turns };
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
  const owned = parts.map((id) => ({ id, level: 1, tier: getPart(id).rarity }));
  const perm = withMastery(withMech({}, owned), MASTERY);
  const maxHp = CONFIG.run.maxHpBase + (perm.hpBonus || 0);
  let hp = maxHp;
  let gold = CONFIG.currency.startGold;
  const heal = rules.healMult;
  const log = { fights: 0, died: null, hpAtBoss: null, rests: 0, lowest: 1 };
  for (let floor = 1; floor <= 5; floor++) {
    if (floor > 1 && rules.floorHeal) hp = Math.min(maxHp, hp + maxHp * rules.floorHeal * heal);
    const steps = CONFIG.map.baseFloorActions;
    const nodes = [];
    for (let i = 0; i < steps; i++) nodes.push(null);
    for (let i = 0; i <= steps; i++) {
      let type;
      if (i === steps) {
        if (floor === 3) type = 'miniboss';
        else if (floor === 5) type = 'boss';
        else break;
      } else type = pickNode(floor, rnd, hp / maxHp, gold);
      if (type === 'boss') log.hpAtBoss = hp / maxHp;
      if (['combat', 'elite', 'miniboss', 'boss'].includes(type)) {
        const r = battle(perm, hp, maxHp, type, floor, rnd, rules);
        log.fights += 1;
        if (!r.won) {
          log.died = { floor, type };
          return log;
        }
        hp = r.hpLeft;
        log.lowest = Math.min(log.lowest, hp / maxHp);
        const rew = CONFIG.nodes.rewards[type] || {};
        gold += rew.gold || 0;
        const postHeal = rules.postWinHeal[type] || 0;
        if (postHeal) hp = Math.min(maxHp, hp + maxHp * postHeal * heal);
      } else if (type === 'rest') {
        log.rests += 1;
        hp = Math.min(maxHp, hp + rules.rest(maxHp) * heal);
      } else if (type === 'shop') {
        if (hp / maxHp < 0.7 && gold >= 28 && rnd() < 0.75) {
          gold -= 28;
          hp = Math.min(maxHp, hp + 30 * heal);
        }
      } else if (type === 'encounter') {
        // A pick-one event: heal when hurt, gold otherwise; some cost HP
        if (hp / maxHp < 0.6) hp = Math.min(maxHp, hp + 20 * heal);
        else if (rnd() < 0.35) hp = Math.max(1, hp - (5 + rnd() * 9));
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

// --fights: single fights from full HP, to calibrate against play ("a sloppy fight costs 40-60% HP")
if (args.fights) {
  for (const g of gear) {
    const owned = LOADOUTS[g].map((id) => ({ id, level: 1, tier: getPart(id).rarity }));
    const perm = withMastery(withMech({}, owned), MASTERY);
    const maxHp = CONFIG.run.maxHpBase + (perm.hpBonus || 0);
    console.log(`\n=== single fights, gear: ${g}, skill ${SKILL}, full HP ${maxHp} ===`);
    for (const [type, floor] of [['combat', 1], ['combat', 2], ['elite', 2], ['combat', 3], ['elite', 3], ['miniboss', 3], ['combat', 5], ['elite', 5], ['boss', 5]]) {
      const rnd = mulberry(7);
      let won = 0, lost = 0, turns = 0, timeouts = 0;
      for (let i = 0; i < RUNS; i++) {
        const r = battle(perm, maxHp, maxHp, type, floor, rnd, NEW);
        if (r.won) { won += 1; lost += (maxHp - r.hpLeft) / maxHp; }
        if (r.timeout) timeouts += 1;
        turns += r.turns;
      }
      console.log(`F${floor} ${type.padEnd(8)} win ${String(Math.round((won / RUNS) * 100)).padStart(3)}% | HP lost when won ${won ? Math.round((lost / won) * 100) : '-'}% | turns ${(turns / RUNS).toFixed(1)}${timeouts ? ` | timeouts ${timeouts}` : ''}`);
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
    for (let i = 0; i < RUNS; i++) {
      const r = simRun(1000 + i, rules, parts);
      fights += r.fights;
      lowest += r.lowest;
      if (r.hpAtBoss != null) bossHp.push(r.hpAtBoss);
      if (r.died) {
        const k = `F${r.died.floor} ${r.died.type}`;
        deaths[k] = (deaths[k] || 0) + 1;
      } else wins += 1;
    }
    const pct = (n) => `${Math.round((n / RUNS) * 100)}%`;
    const avg = (a) => (a.length ? `${Math.round((a.reduce((s, x) => s + x, 0) / a.length) * 100)}%` : '-');
    const topDeaths = Object.entries(deaths).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}: ${pct(v)}`).join(', ');
    console.log(`${rules.name}\n  win ${pct(wins)} | fights/run ${(fights / RUNS).toFixed(1)} | reached boss ${pct(bossHp.length)} at ${avg(bossHp)} HP | lowest HP avg ${Math.round((lowest / RUNS) * 100)}%\n  deaths: ${topDeaths || 'none'}`);
  }
}
