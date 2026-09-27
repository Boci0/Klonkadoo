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
// among the next few. Everything runs on plain snapshots, never on the
// live battle, so a plan can't change anything by itself.
// ============================================================

const DEF_PER_POINT = 0.04;
const DEF_CAP = 15;

const clone = (u) => ({ ...u, res: { ...u.res }, guns: u.guns.map((g) => ({ ...g })) });
const cloneState = (s) => ({ ...s, me: clone(s.me), foe: clone(s.foe), mines: s.mines.map((m) => ({ ...m })) });

/** HP damage one gun hit would do to `target` (burst included), before crits. */
function hitDamage(g, target) {
  const resist = g.pierce ? 0 : Math.min(DEF_CAP, (target.def || 0) + (target.res?.[g.dtype] || 0));
  return Math.max(1, Math.round(g.dmg * g.burst * (1 - resist * DEF_PER_POINT)));
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
  if (g.used || (g.ammo && g.ammoLeft <= 0)) return false;
  if (u.heat > u.heatCap || u.energy < g.en) return false;
  return dist >= g.reach[0] && dist <= g.reach[1];
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
    me.pos = a.pos;
    s.moves = (s.moves || 0) + 1;
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
    if (g.mine) {
      s.mines.push({ pos: foe.pos + Math.sign(foe.pos - me.pos || 1), owner: me.team, dmg: g.dmg });
      s.minesLaid = (s.minesLaid || 0) + 1;
      return true;
    }
    let dmg = hitDamage(g, foe);
    if (g.dtype === 'heat' || g.heatFx) foe.heat += g.heatFx ?? Math.round(g.dmg * 0.5);
    if (g.dtype === 'energy' || g.drain) {
      const want = g.drain ?? Math.round(g.dmg * 0.5);
      const took = Math.min(foe.energy, want);
      foe.energy -= took;
      dmg += want - took; // energy break
    }
    if (foe.shield) {
      foe.shield = false; // forcefield eats the hit
      dmg = 0;
    }
    foe.hp -= dmg;
    s.dealt += dmg;
    if (g.freeze) foe.frozen = true;
    if (g.push || g.pull) {
      const dir = Math.sign(foe.pos - me.pos) || 1;
      const step = g.push ? dir : -dir;
      for (let i = 0; i < (g.push || g.pull); i++) {
        const next = foe.pos + step;
        if (next < 1 || next > s.size || next === me.pos) break;
        foe.pos = next;
      }
    }
    return true;
  }
  if (a.type === 'stomp') {
    if (!canStomp(s)) return false;
    me.stomped = true;
    me.actions -= 1;
    me.heat += s.stompHeat || 4;
    const dmg = hitDamage({ dmg: me.stompDmg, burst: 1, dtype: 'phys' }, foe);
    foe.hp -= dmg;
    s.dealt += dmg;
    const next = foe.pos + (Math.sign(foe.pos - me.pos) || 1);
    if (next >= 1 && next <= s.size) foe.pos = next;
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
  return me.stompDmg > 0 && !me.stomped && me.heat <= me.heatCap && Math.abs(me.pos - s.foe.pos) === 1;
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
  if (u.heat > u.heatCap) return 0;
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
  if (v.stompDmg > 0 && Math.abs(v.pos - target.pos) === 1) best = Math.max(best, (here[0] || 0) + hitDamage({ dmg: v.stompDmg, burst: 1, dtype: 'phys' }, target));
  return best;
}

function score(start, end, aggression) {
  const me = end.me;
  const foe = end.foe;
  if (foe.hp <= 0) return 10000 + end.dealt;
  if (me.hp <= 0) return -10000;
  let s = end.dealt;
  // Their answer next turn (none if they're over their heat cap: overheat)
  const foeLocked = foe.heat > foe.heatCap;
  const reply = foeLocked ? 0 : threat(foe, me, end.size);
  s -= reply * (0.7 - 0.4 * aggression);
  if (foeLocked) s += 12;
  // Our own next turn
  const mine = threat(me, foe, end.size);
  if (me.heat > me.heatCap) s -= 15 + 0.8 * threat({ ...me, heat: 0 }, foe, end.size);
  else s += 0.35 * mine;
  // Nothing to shoot next turn (out of reach): close in
  if (!mine) s -= Math.abs(me.pos - foe.pos) * 1.2;
  // Mines near where the foe stands are worth something later
  s += (end.minesLaid || 0) * 6;
  // Taking a mine hit is bad (already in HP, weigh it a bit more)
  s -= Math.max(0, start.me.hp - me.hp) * 0.5;
  // Energy for next turn matters a little; wasted steps cost a little
  s += Math.min(me.energy, me.energyMax) * 0.02;
  s -= (end.moves || 0) * 1.5;
  return s;
}

/**
 * Plan the rest of this turn. `state` = { size, me, foe, mines, stompHeat }, where me /
 * foe = { team, pos, hp, heat, heatCap, cool, energy, energyMax, regen,
 * actions, maxActions, freeUsed, frozen, shield, legs, def, res, stompDmg, stomped, guns:
 * [{ dmg, burst, en, heat, reach, ammo, ammoLeft, used, dtype, pierce,
 * heatFx, drain, push, pull, freeze, mine }] }. Returns the action list.
 */
export function planTurn(state, { difficulty = 0.5, aggression = 0, rnd = Math.random } = {}) {
  const start = { ...cloneState(state), dealt: 0 };
  const lines = sequences(start).map((l) => ({ ...l, score: score(start, l.state, aggression) }));
  if (!lines.length) return [{ type: 'end' }];
  lines.sort((a, b) => b.score - a.score);
  // A sure kill is always taken; otherwise weaker enemies sometimes settle
  if (lines[0].score >= 10000 || rnd() < 0.35 + 0.65 * difficulty) return lines[0].seq;
  const pool = lines.slice(1, 4).filter((l) => l.score > lines[0].score - 30);
  return (pool.length ? pool[Math.floor(rnd() * pool.length)] : lines[0]).seq;
}
