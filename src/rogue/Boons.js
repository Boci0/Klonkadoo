// ============================================================
// Boons — run-only perks (CONFIG.boons). DOM-free, so the battle,
// the planner (ai/LaneAI.js) and tools/balance-sim.mjs share it.
//
//   boonFx(ids)          the summed battle effects of the boons you hold
//   draftBoons(run, ...) a pick of 3 for after a win, leaning toward the
//                        damage types your team's guns deal
//   pickBoon(ids, run)   AUTO RUN's pick from a draft
// ============================================================

import { CONFIG } from '../config.js';

const BY_ID = Object.fromEntries(CONFIG.boons.map((b) => [b.id, b]));
export const getBoon = (id) => BY_ID[id] || null;

/** Summed `fx` of every boon in `ids` (missing keys are 0). */
export function boonFx(ids = []) {
  const out = {};
  for (const id of new Set(ids)) {
    for (const [k, v] of Object.entries(BY_ID[id]?.fx || {})) out[k] = (out[k] || 0) + v;
  }
  return out;
}

/** Share of each damage type among the team's guns: { phys, heat, energy } summing to 1 (or all 0). */
export function teamElements(run) {
  const n = { phys: 0, heat: 0, energy: 0 };
  const mechs = [run.permanent?.mech, ...(run.team || []).map((m) => m.perm?.mech)];
  for (const mech of mechs) for (const w of mech?.weapons || []) n[w.dtype || 'phys'] = (n[w.dtype || 'phys'] || 0) + 1;
  const total = n.phys + n.heat + n.energy;
  if (total) for (const k of Object.keys(n)) n[k] /= total;
  return n;
}

/**
 * Up to `count` different boons you don't hold yet. Boons built around a
 * damage type weigh more the more of your guns deal it (a type you don't use
 * still turns up, rarely); at least one card matches your main type when one is left.
 */
export function draftBoons(run, count = 3, rnd = Math.random) {
  const share = teamElements(run);
  const pool = CONFIG.boons.filter((b) => !run.boons?.includes(b.id));
  const weight = (b) => (b.tag ? 0.25 + 3 * (share[b.tag] || 0) : 1);
  const out = [];
  const take = (list) => {
    const total = list.reduce((s, b) => s + weight(b), 0);
    let r = rnd() * total;
    for (const b of list) {
      r -= weight(b);
      if (r <= 0) return b;
    }
    return list[list.length - 1];
  };
  const main = Object.keys(share).sort((a, b) => share[b] - share[a])[0];
  const mainPool = share[main] > 0 ? pool.filter((b) => b.tag === main) : [];
  if (mainPool.length) out.push(take(mainPool));
  while (out.length < count) {
    const left = pool.filter((b) => !out.includes(b));
    if (!left.length) break;
    out.push(take(left));
  }
  // Shuffle so the matching card isn't always first
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** AUTO RUN's pick from a draft: the one built around the type most of your guns deal (a general one when none fits). */
export function pickBoon(ids, run) {
  const share = teamElements(run);
  const score = (id) => {
    const b = getBoon(id);
    if (!b) return -Infinity;
    if (b.id === 'boon_greed' || b.id === 'boon_glass') return 0.1; // AUTO doesn't gamble with max HP
    return b.tag ? share[b.tag] * 1.5 : 0.5;
  };
  return [...ids].sort((a, b) => score(b) - score(a))[0];
}
