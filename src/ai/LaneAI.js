// ============================================================
// LaneAI — plans an enemy's turn on the lane.
//
// It tries every sequence of its actions this turn (walk / jump to each
// reachable position, fire each ready gun, VENT, pass), simulates what each
// does to both mechs, then scores the result looking one turn further:
//   + damage dealt now (a kill is worth everything)
//   + a foe left over its heat cap (it loses its next turn)
//   - the best damage the foe can answer with next turn (move + fire, or two guns)
//   + what it can do next turn from where it stands
//   - ending over its own heat cap (its next turn is lost)
// STOMP kicks a mech right next to you.
// Difficulty (0..1) = how often it takes the best line; otherwise it picks
// a close second that still deals most of the damage (never a wasted turn). Everything runs on plain snapshots, never on the
// live battle, so a plan can't change anything by itself.
// ============================================================

import { CONFIG } from '../config.js';

const DEF_PER_POINT = 0.04;
const DEF_CAP = 15;

const clone = (u) => ({ ...u, res: { ...u.res }, guns: u.guns.map((g) => ({ ...g })), specials: (u.specials || []).map((x) => ({ ...x })) });

/** A hit on `foe` after its SHIELD bubble soaks what it can. */
function soak(foe, dmg) {
  const s = Math.min(foe.bubble || 0, dmg);
  foe.bubble = (foe.bubble || 0) - s;
  return dmg - s;
}
const cloneState = (s) => ({ ...s, me: clone(s.me), foe: clone(s.foe), mines: s.mines.map((m) => ({ ...m })) });

/** HP damage one gun hit would do to `target` (burst included), before crits. */
function hitDamage(g, target) {
  const resist = g.pierce ? 0 : Math.min(DEF_CAP, (target.def || 0) + (target.res?.[g.dtype] || 0));
  return Math.max(0.1, g.dmg * g.burst * (1 - resist * DEF_PER_POINT)); // fractional, like the game
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

function canFire(u, g, dist) {
  if (g.used || u.jammed || (g.ammo && g.ammoLeft <= 0)) return false;
  if (u.heat > u.heatCap || u.energy < g.en) return false;
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
    let dmg = hitDamage(shot, foe);
    // Resists cut heat and drain too (Game._reactorKeep)
    const keep = (type) => 1 - Math.min(DEF_CAP, (foe.def || 0) + (foe.res?.[type] || 0)) * DEF_PER_POINT;
    if ((g.dtype === 'heat' || g.heatFx) && !g.meltdown) foe.heat += Math.round((g.heatFx ?? g.dmg * CONFIG.gear.dtypeLoad) * keep('heat'));
    if (g.dtype === 'energy' || g.drain) {
      const want = Math.round((g.drain ?? g.dmg * CONFIG.gear.dtypeLoad) * keep('energy'));
      const took = Math.min(foe.energy, want);
      foe.energy -= took;
      dmg += (want - took) * (CONFIG.gear.hpScale / CONFIG.gear.rxScale); // energy break
      if (g.steal) me.energy = Math.min(me.energyMax, me.energy + took);
    }
    if (g.coolDmg) foe.cool = Math.max(2 * CONFIG.gear.rxScale, foe.cool - g.coolDmg);
    if (g.regenDmg) foe.regen = Math.max(3 * CONFIG.gear.rxScale, foe.regen - g.regenDmg);
    if (g.jam && foe.energy <= 0) foe.jamNext = true;
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
      for (let i = 0; i < (g.push || g.pull); i++) {
        const next = to + step;
        if (next < 1 || next > s.size || next === me.pos) break;
        to = next;
      }
      foe.pos = slide(s, foe, to, true);
    }
    if (g.drag) {
      const next = me.pos + (Math.sign(foe.pos - me.pos) || 1);
      if (next !== foe.pos && next >= 1 && next <= s.size) me.pos = slide(s, me, next, true);
    }
    return true;
  }
  if (a.type === 'special') {
    const sp = me.specials[a.i];
    if (!sp || sp.uses <= 0 || me.energy < sp.en || me.heat > me.heatCap) return false;
    me.energy -= sp.en;
    me.heat += sp.heat;
    sp.uses -= 1;
    me.actions -= 1;
    s.specialsUsed = (s.specialsUsed || 0) + 1;
    const dir = Math.sign(foe.pos - me.pos) || 1;
    if (sp.kind === 'hook') {
      foe.pos = slide(s, foe, me.pos + dir, true);
      if (sp.drain) {
        // Mag Tether drains like a gun (Game._reactorFx): resists cut it, past empty it comes off HP
        const want = Math.round(sp.drain * (1 - Math.min(DEF_CAP, (foe.def || 0) + (foe.res?.energy || 0)) * DEF_PER_POINT));
        const took = Math.min(Math.max(0, foe.energy), want);
        foe.energy -= took;
        foe.hp -= (want - took) * (CONFIG.gear.hpScale / CONFIG.gear.rxScale);
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
    const dmg = soak(foe, hitDamage({ dmg: me.stompDmg, burst: 1, dtype: me.legs.stompType || 'phys' }, foe));
    foe.hp -= dmg;
    s.dealt += dmg;
    const next = foe.pos + (Math.sign(foe.pos - me.pos) || 1);
    if (next >= 1 && next <= s.size) foe.pos = slide(s, foe, next, true); // stomped back
    return true;
  }
  if (a.type === 'vent') {
    me.heat = Math.max(0, me.heat - me.cool * 2);
    me.actions = 0;
    return true;
  }
  me.actions = 0; // pass
  return true;
}

function canStomp(s) {
  const me = s.me;
  return me.stompDmg > 0 && !me.stomped && me.heat <= me.heatCap && me.energy >= (me.legs.stompEn || 0) && Math.abs(me.pos - s.foe.pos) === 1;
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
    if (sp.uses <= 0 || me.energy < sp.en || me.heat > me.heatCap) return;
    if (sp.kind === 'hook' && dist >= 2 && dist <= sp.range) list.push({ type: 'special', i });
    if (sp.kind === 'charge' && (dist >= 2 || sp.away) && !me.legs?.anchored) list.push({ type: 'special', i });
    if (sp.kind === 'shield' && !(me.bubble > 0)) list.push({ type: 'special', i });
    if (sp.kind === 'teleport') for (let q = 1; q <= s.size; q++) if (q !== me.pos && q !== s.foe.pos) list.push({ type: 'special', i, pos: q });
  });
  for (const m of laneMoves(me, s.foe.pos, s.size)) list.push({ type: 'move', pos: m.pos, how: m.how });
  if (me.actions === me.maxActions && me.heat > 0) list.push({ type: 'vent' });
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
 * Best damage `u` can deal to `target` on its next turn, starting its turn
 * with regen and cooling: two different guns from here, or a move then a gun.
 * Returns 0 if it would start over its heat cap (turn lost).
 */
function threat(u, target, size) {
  if (u.heat > u.heatCap || u.jamNext) return 0; // overheated or jammed: no shots next turn
  const v = clone(u);
  v.energy = Math.min(v.energyMax, v.energy + v.regen);
  v.heat = Math.max(0, v.heat - v.cool);
  const fireable = (from) => v.guns
    .filter((g) => !(g.ammo && g.ammoLeft <= 0) && !g.mine && Math.abs(from - target.pos) >= g.reach[0] && Math.abs(from - target.pos) <= g.reach[1] && v.energy >= g.en)
    .map((g) => hitDamage(g, target))
    .sort((a, b) => b - a);
  const here = fireable(v.pos);
  let best = (here[0] || 0) + (here[1] || 0);
  for (const m of laneMoves(v, target.pos, size)) best = Math.max(best, fireable(m.pos)[0] || 0);
  // Stomp from right next to it
  if (v.stompDmg > 0 && Math.abs(v.pos - target.pos) === 1) best = Math.max(best, (here[0] || 0) + hitDamage({ dmg: v.stompDmg, burst: 1, dtype: v.legs?.stompType || 'phys' }, target));
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
  // Their answer next turn (none if they're over their heat cap: overheat)
  const foeLocked = foe.heat > foe.heatCap || foe.jamNext;
  const reply = Math.max(0, (foeLocked ? 0 : threat(foe, me, end.size)) - (me.bubble || 0)); // a SHIELD soaks their answer
  s -= reply * (0.5 - 0.3 * aggression) * (1 - 0.8 * commit);
  if (foeLocked) s += 12 * U;
  // Our own next turn
  const mine = threat(me, foe, end.size);
  if (me.heat > me.heatCap) s -= 15 * U + 0.8 * threat({ ...me, heat: 0 }, foe, end.size);
  else s += 0.35 * mine;
  // Nothing to shoot next turn (out of reach): close in
  if (!mine) s -= Math.abs(me.pos - foe.pos) * 1.2 * U * (1 + 4 * commit);
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
  s -= (end.specialsUsed || 0) * 4 * U * (1 - commit); // uses are limited: spend them when they matter (or when stuck)
  return s;
}

/**
 * Plan the rest of this turn. `state` = { size, me, foe, mines, stompHeat }, where me /
 * foe = { team, pos, hp, heat, heatCap, cool, energy, energyMax, regen,
 * actions, maxActions, freeUsed, frozen, shield, legs, def, res, stompDmg, stomped, guns:
 * [{ dmg, burst, en, heat, reach, ammo, ammoLeft, used, dtype, pierce,
 * heatFx, drain, push, pull, freeze, mine }] }. Returns the action list.
 */
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
