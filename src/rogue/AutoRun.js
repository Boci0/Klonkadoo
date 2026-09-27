// ============================================================
// AutoRun — the choices AUTO RUN makes on the map, as plain scoring.
// It farms a Risk you've already beaten: fights while HP is healthy,
// heals when it isn't, spends gold on what helps most right now, and
// takes the best side of every event. Battles themselves are played by
// AUTO battle (LaneAI). Pure functions: main.js drives the run.
// ============================================================

import { getSupply, repairAmount } from './Supplies.js';

const hpPct = (run) => (run.maxHp > 0 ? run.hp / run.maxHp : 0);

/** Worth of one supply (gold-free), for shops and caches. */
export function supplyValue(s, run) {
  if (!s) return -Infinity;
  const missing = run.maxHp - run.hp;
  switch (s.kind) {
    case 'repair': return Math.min(repairAmount(s, run), missing) * (hpPct(run) < 0.6 ? 1.2 : 0.4);
    case 'maxhp': return s.amount * 1.2;
    case 'keys': return s.amount * 9; // pods: the point of farming
    case 'scrap': return s.amount * 0.6;
    case 'boon': return run.boons?.includes(s.boonId) ? -Infinity : 22;
    default: return 0;
  }
}

/** Which of the next map nodes to take. */
export function pickNode(options, run, gold) {
  const hp = hpPct(run);
  const score = (n) => {
    let s;
    switch (n.type) {
      case 'combat': s = hp > 0.35 ? 12 : -8; break;
      case 'elite': s = hp > 0.8 ? 16 : -14; break;
      case 'miniboss':
      case 'boss': s = 10; break;
      case 'rest': s = hp < 0.65 ? 26 - hp * 10 : 1; break;
      case 'shop': s = gold >= 45 ? 8 + Math.min(12, gold / 15) : gold >= 28 && hp < 0.6 ? 12 : 0; break; // gold is only worth what it buys
      case 'treasure': s = 15; break;
      case 'encounter': s = 8; break;
      case 'gamble': s = gold >= 15 ? 6 : -2; break;
      case 'minigame': s = -40; break; // a skill game: AUTO skips it (costs a little HP)
      default: s = 0;
    }
    if (n.visited) s -= 20;
    return s + Math.random() * 0.5; // ties: any
  };
  return [...options].sort((a, b) => score(b) - score(a))[0] || null;
}

/** Best choice of an event: index into enc.choices. */
export function pickChoice(enc, run) {
  const hp = hpPct(run);
  const missing = run.maxHp - run.hp;
  const score = (c) => {
    if (c.loseGold && c.loseGold > run.gold) return -Infinity;
    if (c.loseHp && c.loseHp >= run.hp) return -Infinity;
    let s = 0;
    s += Math.min(c.heal || 0, missing) * (hp < 0.6 ? 1.2 : 0.4);
    s += (c.gainMaxHp || 0) * 1.2;
    s += (c.gainActions || 0) * 14;
    s += c.gainBoon && !run.boons?.includes(c.gainBoon) ? 22 : 0;
    s += (c.gainGold || 0) * 0.45;
    s += (c.gambleGold || 0) * 0.2;
    s += (c.gainScrap || 0) * 0.6;
    s += (c.gainKeys || 0) * 9;
    s -= (c.loseHp || 0) * (hp < 0.5 ? 1.6 : 0.6);
    s -= (c.loseGold || 0) * 0.45;
    s -= (c.loseMaxHp || 0) * 1.4;
    return s;
  };
  let best = 0;
  enc.choices.forEach((c, i) => {
    if (score(c) > score(enc.choices[best])) best = i;
  });
  return best;
}

/** Shop: shelf slots to buy, best value per gold first, while gold lasts. */
export function pickBuys(items, run, priceOf) {
  let gold = run.gold;
  const picks = items
    .map((it, i) => ({ i, s: !it.sold ? getSupply(it.id) : null }))
    .filter((x) => x.s)
    .map((x) => ({ ...x, cost: priceOf(x.s), v: supplyValue(x.s, run) }))
    .filter((x) => x.v > 8)
    .sort((a, b) => b.v / b.cost - a.v / a.cost);
  const out = [];
  for (const p of picks) {
    if (p.cost > gold) continue;
    gold -= p.cost;
    out.push(p.i);
  }
  return out;
}
