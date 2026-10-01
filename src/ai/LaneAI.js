// ============================================================
// LaneAI — plans an enemy's turn on the lane.
//
// It tries every sequence of its actions this turn (walk / jump to each
// reachable position, fire each ready gun, COOLDOWN, pass), simulates what each
// does to both mechs, then scores the result looking one turn further:
//   + damage dealt now (a kill is worth everything)
//   + a foe left over its heat cap (a forced cooldown eats an action, a shutdown its turn)
//   - the best damage the foe can answer with next turn (move + fire, or two guns)
//   + what it can do next turn from where it stands
//   - ending over its own heat cap, or running hot toward it
// SuperMechs rules: heat never cools by itself (COOLDOWN is an action) and
// energy refills at the end of a mech's own turn.
// STOMP kicks a mech right next to you.
// Difficulty (0..1) = how often it takes the best line; otherwise it picks
// a close second that still deals most of the damage (never a wasted turn). Everything runs on plain snapshots, never on the
// live battle, so a plan can't change anything by itself.
// ============================================================

import { CONFIG } from '../config.js';
import { flatResist } from '../meta/Mech.js';

/** Multipliers on the scoring weights (default 1 = as tuned). Only tools/balance-sim.mjs changes them, to test AUTO variants. */
export const TUNE = { spec: 1, reply: 1 };

const clone = (u) => ({ ...u, res: { ...u.res }, guns: u.guns.map((g) => ({ ...g })), specials: (u.specials || []).map((x) => ({ ...x })) });

/** A hit on `foe` after its SHIELD bubble soaks what it can. */
function soak(foe, dmg) {
  const s = Math.min(foe.bubble || 0, dmg);
  foe.bubble = (foe.bubble || 0) - s;
  return dmg - s;
}
/**
 * SLAMMED (Game._shove): a knockback that runs into the lane's edge or the
 * other mech does flat damage. Only when the state asks for it (`slam`: the
 * damage before defenses): Game's INTENT forecast counts it, the planner's own
 * choices don't (its play stays as tuned).
 */
function slam(s, foe) {
  if (!s.slam || foe.hp <= 0) return;
  const dmg = soak(foe, hitDamage({ dmg: s.slam, burst: 1, dtype: 'phys' }, foe));
  foe.hp -= dmg;
  s.dealt += dmg;
}
const cloneState = (s) => ({ ...s, me: clone(s.me), foe: clone(s.foe), mines: s.mines.map((m) => ({ ...m })) });

/** HP damage one gun hit would do to `target` (burst included), before crits: flat resist per round. `apCut`: share of resist left (AP Rounds). */
function hitDamage(g, target, apCut = 1) {
  const resist = g.pierce ? 0 : ((target.def || 0) + (target.res?.[g.dtype] || 0)) * apCut;
  return Math.max(0.1, (g.burst || 1) * flatResist(g.dmg, resist, g.burst || 1)); // fractional, like the game
}

/** How much of its next turn `u` loses to heat (plus `extra` still to come): 0, 1 (forced cooldown) or 2 (shutdown). */
function heatLoss(u, extra = 0) {
  const heat = u.heat + extra;
  if (!(heat > u.heatCap)) return 0;
  return heat - u.heatCap > u.cool * (1 - (u.heatLock || 0)) ? 2 : 1;
}

/** Heat `u` can push into a target on its next turn: its two hottest guns it can pay for. */
function heatThreat(u) {
  const load = CONFIG.gear.dtypeLoad.heat;
  const hot = u.guns
    .filter((g) => !(g.ammo && g.ammoLeft <= 0) && !g.meltdown && u.energy >= g.en && (g.dtype === 'heat' || g.heatFx))
    .map((g) => (g.heatFx ?? g.dmg * load * (g.load || 1)) * (g.burst || 1))
    .sort((a, b) => b - a);
  return (hot[0] || 0) + (hot[1] || 0);
}

/** Positions `u` can move to, given the other mech at `otherPos`: [{ pos, how }]. */
export function laneMoves(u, otherPos, size) {
  const out = [];
  const legs = u.legs;
  if (!legs || legs.anchored) return out;
  if (legs.moveEn && u.energy < legs.moveEn) return out;
  const chill = u.frozen ? 1 : 0;
  const walk = Math.max(0, (legs.walk || 0) - chill);
  const seen = new Set();
  for (const dir of [-1, 1]) {
    for (let d = 1; d <= walk; d++) {
      const p = u.pos + dir * d;
      if (p < 1 || p > size || p === otherPos) break;
      seen.add(p);
      out.push({ pos: p, how: 'walk' });
    }
    if (legs.jump) {
      for (let d = legs.jump[0]; d <= legs.jump[1] - chill; d++) {
        const p = u.pos + dir * d;
        if (p < 1 || p > size || p === otherPos || seen.has(p)) continue;
        seen.add(p);
        out.push({ pos: p, how: 'jump' });
      }
    }
  }
  return out;
}

/** Heat never stops a gun (SuperMechs): only its energy cost, ammo, once a turn and range. */
function canFire(u, g, dist) {
  if (g.used || (g.ammo && g.ammoLeft <= 0) || u.energy < g.en) return false;
  return dist >= g.reach[0] && dist <= g.reach[1];
}

/**
 * Ground slide (Game._mineStop): stops on the first mine it crosses, which
 * goes off. Your own mines only hit you when you're `forced` (pushed, pulled,
 * hooked, dragged). Returns where the slide ends.
 */
function slide(s, u, to, forced = false) {
  const dir = Math.sign(to - u.pos);
  if (!dir) return to;
  for (let q = u.pos + dir; q !== to + dir; q += dir) {
    const i = s.mines.findIndex((m) => m.pos === q && (forced || m.owner !== u.team));
    if (i >= 0) {
      u.hp -= s.mines[i].dmg;
      s.mines.splice(i, 1);
      return q;
    }
  }
  return to;
}

/** Apply one action to a copied state. Returns false if it isn't legal. */
function apply(s, a) {
  const me = s.me;
  const foe = s.foe;
  if (a.type === 'move') {
    if (me.legs.moveEn) me.energy -= me.legs.moveEn;
    if (me.legs.freeMove && !me.freeUsed) me.freeUsed = true;
    else me.actions -= 1;
    me.frozen = false;
    s.moves = (s.moves || 0) + 1;
    if (a.how === 'walk') {
      me.pos = slide(s, me, a.pos);
      return true;
    }
    me.pos = a.pos; // a jump only lands
    const mine = s.mines.findIndex((m) => m.pos === a.pos && m.owner !== me.team);
    if (mine >= 0) {
      me.hp -= s.mines[mine].dmg;
      s.mines.splice(mine, 1);
    }
    return true;
  }
  if (a.type === 'fire') {
    const g = me.guns[a.gun];
    if (!canFire(me, g, Math.abs(me.pos - foe.pos))) return false;
    me.energy -= g.en;
    me.heat += g.heat;
    if (g.ammo) g.ammoLeft -= 1;
    g.used = true;
    me.actions -= 1;
    if (g.backfire) {
      const bf = Math.min(g.backfire, Math.max(0, me.hp - 1));
      me.hp -= bf;
      s.backfire = (s.backfire || 0) + bf;
    }
    if (g.mine) {
      s.mines.push({ pos: foe.pos + Math.sign(foe.pos - me.pos || 1), owner: me.team, dmg: g.dmg });
      s.minesLaid = (s.minesLaid || 0) + 1;
      return true;
    }
    // Specialist payoffs: hot targets (Thermal Lance, Meltdown), all your energy (Capacitor Dump)
    let shot = g;
    if (g.hotBonus && foe.heat > foe.heatCap * 0.75) shot = { ...shot, dmg: shot.dmg * 2 };
    if (g.lowEnBonus && foe.energy < (foe.energyMax || 0) * 0.25) shot = { ...shot, dmg: shot.dmg * 2 }; // Arc Turret
    if (g.execute && foe.hp < (foe.maxHp || foe.hp) * g.execute) shot = { ...shot, dmg: shot.dmg * 1.8 };
    if (g.meltdown && foe.heat > foe.heatCap) {
      shot = { ...shot, dmg: shot.dmg + (foe.heat - foe.heatCap) * 2 * (CONFIG.gear.hpScale / CONFIG.gear.rxScale) };
      foe.heat = foe.heatCap;
    }
    if (g.dump) {
      shot = { ...shot, dmg: shot.dmg + (Math.max(0, me.energy) / 2) * g.dumpScale };
      me.energy = 0;
    }
    // Run boons on your hits (Game._boonDmgMult, _weaponHit, _reactorFx)
    const b = me.bfx || {};
    let boost = 1;
    if (b.closeDmg && Math.abs(me.pos - foe.pos) <= 2) boost += b.closeDmg;
    if (b.farDmg && Math.abs(me.pos - foe.pos) >= 4) boost += b.farDmg;
    if (b.lowHpDmg && foe.hp < (foe.maxHp || foe.hp) * 0.5) boost += b.lowHpDmg;
    let dmg = hitDamage(shot, foe, g.dtype === 'phys' ? 1 - (b.physPierce || 0) : 1) * (me.enrage || 1) * boost; // raid boss enrage (Game._weaponHit)
    // Heat in and drain are the gun's own numbers: resists don't cut them (Game._reactorFx)
    if ((g.dtype === 'heat' || g.heatFx) && !g.meltdown) {
      foe.heat += Math.round((g.heatFx ?? g.dmg * CONFIG.gear.dtypeLoad.heat * (g.load || 1)) * (1 + (b.heatOut || 0)));
      if (b.heatLock) foe.heatLock = b.heatLock; // Thermal Lock (Game._upkeep)
      if (b.capCut && !foe.capCut) {
        foe.capCut = true; // Flashpoint (Game._reactorFx)
        foe.heatCap = Math.round(foe.heatCap * (1 - b.capCut));
      }
    }
    if (g.dtype === 'energy' || g.drain) {
      const want = Math.round((g.drain ?? g.dmg * CONFIG.gear.dtypeLoad.energy * (g.load || 1)) * (1 + (b.drainOut || 0)));
      const took = Math.min(foe.energy, want);
      foe.energy -= took;
      dmg += (want - took) * CONFIG.gear.breakHp; // energy break
      if (g.steal) me.energy = Math.min(me.energyMax, me.energy + took);
      if (b.siphon) me.energy = Math.min(me.energyMax, me.energy + Math.round(took * b.siphon));
    }
    if (g.coolDmg) foe.cool = Math.max(2 * CONFIG.gear.rxScale, foe.cool - g.coolDmg);
    if (g.regenDmg) foe.regen = Math.max(3 * CONFIG.gear.rxScale, foe.regen - g.regenDmg);
    if (b.physStrip && g.dtype === 'phys') foe.res.phys = (foe.res.phys || 0) - b.physStrip; // Sledge Rounds
    if (foe.shield) {
      foe.shield = false; // forcefield eats the hit
      dmg = 0;
    }
    dmg = soak(foe, dmg);
    foe.hp -= dmg;
    s.dealt += dmg;
    if (g.freeze) foe.frozen = true;
    for (const [t, n] of Object.entries(g.resDrain || {})) foe.res[t] = (foe.res[t] || 0) - n;
    if (g.push || g.pull) {
      const dir = Math.sign(foe.pos - me.pos) || 1;
      const step = g.push ? dir : -dir;
      let to = foe.pos;
      let blocked = false;
      for (let i = 0; i < (g.push || g.pull); i++) {
        const next = to + step;
        if (next < 1 || next > s.size || next === me.pos) {
          blocked = true;
          break;
        }
        to = next;
      }
      const end = slide(s, foe, to, true);
      foe.pos = end;
      if (blocked && g.push && end === to) slam(s, foe); // (a mine stop isn't a wall)
    }
    if (g.drag) {
      const next = me.pos + (Math.sign(foe.pos - me.pos) || 1);
      if (next !== foe.pos && next >= 1 && next <= s.size) me.pos = slide(s, me, next, true);
    }
    return true;
  }
  if (a.type === 'special') {
    const sp = me.specials[a.i];
    if (!sp || sp.uses <= 0 || me.energy < sp.en) return false;
    me.energy -= sp.en;
    me.heat += sp.heat;
    sp.uses -= 1;
    me.actions -= 1;
    s.specialsUsed = (s.specialsUsed || 0) + 1;
    const dir = Math.sign(foe.pos - me.pos) || 1;
    if (sp.kind === 'hook') {
      foe.pos = slide(s, foe, me.pos + dir, true);
      if (sp.drain) {
        // Mag Tether drains like a gun (Game._reactorFx): past empty it comes off HP
        const want = Math.round(sp.drain);
        const took = Math.min(Math.max(0, foe.energy), want);
        foe.energy -= took;
        foe.hp -= (want - took) * CONFIG.gear.breakHp;
      }
    } else if (sp.kind === 'charge') {
      const step = sp.away ? -dir : dir; // Retro Rockets back off
      let to = me.pos;
      for (let i = 0; i < sp.dist; i++) {
        const next = to + step;
        if (next < 1 || next > s.size || next === foe.pos) break;
        to = next;
      }
      me.pos = slide(s, me, to);
      if (!sp.away && Math.abs(me.pos - foe.pos) === 1) {
        const dmg = soak(foe, hitDamage({ dmg: sp.ram, burst: 1, dtype: 'phys' }, foe));
        foe.hp -= dmg;
        s.dealt += dmg;
        const next = foe.pos + dir;
        if (next >= 1 && next <= s.size) foe.pos = slide(s, foe, next, true); // rammed back
        else slam(s, foe);
      }
    } else if (sp.kind === 'teleport') me.pos = a.pos;
    else if (sp.kind === 'shield') me.bubble = sp.absorb;
    return true;
  }
  if (a.type === 'stomp') {
    if (!canStomp(s)) return false;
    me.stomped = true;
    me.actions -= 1;
    me.heat += me.legs.stompHeat ?? (s.stompHeat || 4);
    me.energy -= me.legs.stompEn || 0;
    // A forcefield blocks a stomp too (Game._weaponHit); the raid boss's enrage counts
    const dmg = foe.shield ? 0 : soak(foe, hitDamage({ dmg: me.stompDmg, burst: 1, dtype: me.legs.stompType || 'phys' }, foe) * (me.enrage || 1));
    foe.shield = false;
    foe.hp -= dmg;
    s.dealt += dmg;
    const next = foe.pos + (Math.sign(foe.pos - me.pos) || 1);
    if (next >= 1 && next <= s.size) foe.pos = slide(s, foe, next, true); // stomped back
    else slam(s, foe);
    return true;
  }
  if (a.type === 'vent') {
    // COOLDOWN (Game._vent): one action, your cooling's worth (less under Thermal Lock)
    me.heat = Math.max(0, me.heat - Math.round(me.cool * (1 - (me.lockNow || 0))));
    me.actions -= 1;
    s.cools = (s.cools || 0) + 1;
    return true;
  }
  me.actions = 0; // pass
  return true;
}

function canStomp(s) {
  const me = s.me;
  return me.stompDmg > 0 && !me.stomped && me.energy >= (me.legs.stompEn || 0) && Math.abs(me.pos - s.foe.pos) === 1;
}

/** Every action `me` could take right now. */
function actionsFor(s) {
  const me = s.me;
  if (me.actions <= 0) return [];
  const list = [{ type: 'end' }];
  const dist = Math.abs(me.pos - s.foe.pos);
  me.guns.forEach((g, i) => {
    if (canFire(me, g, dist)) list.push({ type: 'fire', gun: i });
  });
  if (canStomp(s)) list.push({ type: 'stomp' });
  (me.specials || []).forEach((sp, i) => {
    if (sp.uses <= 0 || me.energy < sp.en) return;
    if (sp.kind === 'hook' && dist >= 2 && dist <= sp.range) list.push({ type: 'special', i });
    if (sp.kind === 'charge' && (dist >= 2 || sp.away) && !me.legs?.anchored) list.push({ type: 'special', i });
    if (sp.kind === 'shield' && !(me.bubble > 0)) list.push({ type: 'special', i });
    if (sp.kind === 'teleport') for (let q = 1; q <= s.size; q++) if (q !== me.pos && q !== s.foe.pos) list.push({ type: 'special', i, pos: q });
  });
  for (const m of laneMoves(me, s.foe.pos, s.size)) list.push({ type: 'move', pos: m.pos, how: m.how });
  if (me.heat > 0) list.push({ type: 'vent' });
  return list;
}

/** All action sequences for the rest of this turn (depth-first, each gun once). */
function sequences(s, prefix = [], out = []) {
  const acts = actionsFor(s);
  for (const a of acts) {
    const next = cloneState(s);
    if (!apply(next, a)) continue;
    const seq = [...prefix, a];
    if (next.me.actions <= 0 || a.type === 'end' || next.foe.hp <= 0) out.push({ seq, state: next });
    else sequences(next, seq, out);
  }
  return out;
}

/**
 * Best damage `u` can deal to `target` on its next turn: two different guns
 * from here, or a move then a gun. `own`: `u` is the mech whose turn is
 * ending, so its battery refills first. Over its heat cap, a forced cooldown
 * leaves one shot; a shutdown leaves nothing.
 */
function threat(u, target, size, own = false) {
  const lost = heatLoss(u);
  if (lost >= 2) return 0; // shutdown: the whole turn
  // (read-only: a shallow copy for the refilled battery, no gun copies; this runs for every line the planner scores)
  const v = own ? { ...u, energy: Math.min(u.energyMax, u.energy + u.regen) } : u;
  const fireable = (from) => v.guns
    .filter((g) => !(g.ammo && g.ammoLeft <= 0) && !g.mine && Math.abs(from - target.pos) >= g.reach[0] && Math.abs(from - target.pos) <= g.reach[1] && v.energy >= g.en)
    .map((g) => hitDamage(g, target))
    .sort((a, b) => b - a);
  const here = fireable(v.pos);
  const stomp = v.stompDmg > 0 && Math.abs(v.pos - target.pos) === 1 ? hitDamage({ dmg: v.stompDmg, burst: 1, dtype: v.legs?.stompType || 'phys' }, target) : 0;
  if (lost === 1) return Math.max(here[0] || 0, stomp); // the forced cooldown takes one action
  let best = (here[0] || 0) + (here[1] || 0);
  for (const m of laneMoves(v, target.pos, size)) best = Math.max(best, fireable(m.pos)[0] || 0);
  // Stomp from right next to it
  if (stomp) best = Math.max(best, (here[0] || 0) + stomp);
  return best;
}

/**
 * `stall`: turns this mech has gone without dealing damage. The longer it
 * lasts, the more it commits (fears the reply less, closes in harder, spends
 * specials like the hook), so two careful mechs can't dance forever.
 */
function score(start, end, aggression, stall = 0) {
  const commit = Math.min(1, stall / 6);
  const me = end.me;
  const foe = end.foe;
  if (foe.hp <= 0) return 10000 + end.dealt;
  if (me.hp <= 0) return -10000;
  const U = CONFIG.gear.hpScale; // the fixed weights below are in damage units
  // Pressure first: damage now is worth more than the damage it might dodge
  let s = end.dealt * 1.2;
  // Their answer next turn (shorter if they start it over their heat cap)
  const reply = Math.max(0, threat(foe, me, end.size) - (me.bubble || 0)); // a SHIELD soaks their answer
  s -= reply * (0.5 - 0.3 * aggression) * (1 - 0.8 * commit) * TUNE.reply;
  s += heatLoss(foe) * 6 * U; // each action they'll spend on a forced cooldown
  // Our own next turn (our battery refills as this turn ends). What heat takes from it counts in full:
  // a forced cooldown costs an action, a shutdown the whole turn
  // Their Explosive guns will add heat before our turn comes back: plan with most of it
  const incoming = heatLoss(foe) >= 2 ? 0 : heatThreat(foe) * 0.75;
  const hot = { ...me, heat: me.heat + incoming };
  const mine = threat(hot, foe, end.size, true);
  const cool = hot.heat > me.heatCap ? threat({ ...me, heat: Math.min(me.heat, me.heatCap) }, foe, end.size, true) : mine; // (the same line when it isn't over)
  const myLoss = heatLoss(hot);
  s -= myLoss * 6 * U + (cool - mine) * 1.1;
  s += 0.35 * mine;
  // Running hot: heat past 60% of the cap is a cooldown we'll owe soon (an action's worth of damage)
  s -= (Math.max(0, hot.heat - me.heatCap * 0.6) / Math.max(1, me.cool)) * (2 * U + 0.25 * cool);
  // Nothing to shoot next turn (out of reach): close in
  if (!mine && !myLoss) s -= Math.abs(me.pos - foe.pos) * 1.2 * U * (1 + 4 * commit);
  // Stuck: end as close as it can (knockback eats the margin), and backing away
  // (or leapfrogging to the far side) only drags the fight out
  if (commit > 0) {
    s -= Math.abs(me.pos - foe.pos) * 1.2 * U * commit;
    s -= Math.max(0, Math.abs(me.pos - foe.pos) - Math.abs(start.me.pos - start.foe.pos)) * 3 * U * commit;
  }
  // Mines near where the foe stands are worth something later
  s += (end.minesLaid || 0) * 6 * U;
  // Taking a mine hit is bad (already in HP, weigh it a bit more)
  s -= Math.max(0, start.me.hp - me.hp) * 0.5;
  // Energy for next turn matters a little; wasted steps cost a little
  s += Math.min(me.energy, me.energyMax) * 0.02 * (U / CONFIG.gear.rxScale);
  s -= (end.moves || 0) * 1.5 * U;
  s -= (end.specialsUsed || 0) * 4 * U * (1 - commit) * TUNE.spec; // uses are limited: spend them when they matter (or when stuck)
  return s;
}

/**
 * Plan the rest of this turn. `state` = { size, me, foe, mines, stompHeat }, where me /
 * foe = { team, pos, hp, heat, heatCap, cool, energy, energyMax, regen,
 * actions, maxActions, freeUsed, frozen, shield, legs, def, res, stompDmg, stomped, guns:
 * [{ dmg, burst, en, heat, reach, ammo, ammoLeft, used, dtype, pierce,
 * heatFx, drain, push, pull, freeze, mine }] }. Returns the action list.
 */
export function planLines(state, { aggression = 0, stall = 0 } = {}) {
  const start = { ...cloneState(state), dealt: 0 };
  return sequences(start).map((l) => ({ ...l, score: score(start, l.state, aggression, stall) })).sort((a, b) => b.score - a.score);
}

/** The start of a mech's next turn on a snapshot (Game._upkeep): fresh actions and guns, then heat's toll. False = shutdown, the turn is lost. */
function upkeepSnap(u) {
  u.actions = u.maxActions;
  u.freeUsed = false;
  u.stomped = false;
  u.bubble = 0;
  for (const g of u.guns) g.used = false;
  u.lockNow = u.heatLock || 0;
  u.heatLock = 0;
  if (!(u.heat > u.heatCap)) return true;
  const cool = Math.round(u.cool * (1 - u.lockNow));
  const shut = u.heat - u.heatCap > cool;
  u.heat = Math.max(0, u.heat - cool * (shut ? 2 : 1));
  if (shut) return false;
  u.actions = 1;
  return true;
}

/** `me`'s whole turn against `foe` (snapshots, changed in place), one best action at a time like the game. */
function playOut(me, foe, state) {
  for (let g = 0; g < 8 && me.actions > 0 && me.hp > 0 && foe.hp > 0; g++) {
    const a = planTurn({ ...state, me, foe }, { difficulty: 1, rnd: () => 0 })[0] || { type: 'end' };
    if (a.type === 'end' || !apply({ ...state, me, foe, dealt: 0 }, a)) break;
  }
}

/**
 * AUTO's planner: the best few lines of this turn, each followed by the enemy's
 * real answer and our own next turn, and the line with the best total wins
 * (balance-sim: ~3x the clears at Risk X over the one-turn planTurn).
 */
export function planDeep(state, { aggression = 0, stall = 0, top = 4 } = {}) {
  const lines = planLines(state, { aggression, stall });
  if (!lines.length) return [{ type: 'end' }];
  if (lines[0].score >= 10000) return lines[0].seq;
  let best = null;
  for (const l of lines.slice(0, top)) {
    const m = clone(l.state.me);
    const f = clone(l.state.foe);
    m.energy = Math.min(m.energyMax, m.energy + m.regen); // our battery refills as this turn ends
    const rest = { size: state.size, mines: l.state.mines, stompHeat: state.stompHeat };
    const hp0 = m.hp;
    if (upkeepSnap(f)) playOut(f, m, rest);
    let v = (state.foe.hp - f.hp) - (hp0 - m.hp);
    if (m.hp <= 0) v = -1e6;
    else if (upkeepSnap(m)) {
      const next = planLines({ ...rest, me: m, foe: f }, {})[0];
      if (next) v += next.state.dealt * 0.8 + (next.state.foe.hp <= 0 ? 1e4 : 0);
    }
    if (!best || v > best.v) best = { v, seq: l.seq };
  }
  return best.seq;
}

export function planTurn(state, { difficulty = 0.5, aggression = 0, rnd = Math.random, stall = 0 } = {}) {
  const start = { ...cloneState(state), dealt: 0 };
  const lines = sequences(start).map((l) => ({ ...l, score: score(start, l.state, aggression, stall) }));
  if (!lines.length) return [{ type: 'end' }];
  lines.sort((a, b) => b.score - a.score);
  // A sure kill is always taken; otherwise weaker enemies sometimes settle for
  // a close second (never a wasted turn: it has to be nearly as good)
  if (lines[0].score >= 10000 || rnd() < 0.55 + 0.45 * difficulty) return lines[0].seq;
  const pool = lines.slice(1, 4).filter((l) => l.score > lines[0].score - 8 * CONFIG.gear.hpScale && l.state.dealt >= lines[0].state.dealt * 0.6);
  return (pool.length ? pool[Math.floor(rnd() * pool.length)] : lines[0]).seq;
}

/** The planner's own rules for one action, for tools (tools/balance-sim.mjs). */
export { apply as applyAction };
