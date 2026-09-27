// ============================================================
// Supplies — what shops sell and treasure caches hold.
//
// Gear is the only progression, so in-run rewards are resources:
// repairs, Keys (supply pods), scrap (part upgrades), max HP and the
// run's boons. Shop prices go through RunState.price (floor, Risk).
// ============================================================

import { CONFIG } from '../config.js';
import { saveSystem } from '../meta/SaveSystem.js';

/** kind: repair (HP), maxhp, keys, scrap, boon. `icon` is a pixelIcons UI icon. */
export const SUPPLIES = [
  { id: 'sup_repair', kind: 'repair', amount: 30, cost: 28, name: 'FIELD REPAIR', icon: 'heal', color: '#a7f070', desc: 'Restore 30 HP.' },
  { id: 'sup_overhaul', kind: 'repair', amount: 70, cost: 55, name: 'FULL OVERHAUL', icon: 'heal', color: '#a7f070', desc: 'Restore 70 HP.' },
  { id: 'sup_plating', kind: 'maxhp', amount: 12, cost: 48, name: 'SPARE PLATING', icon: 'hp', color: '#ff5d73', desc: '+12 max HP for this run.' },
  { id: 'sup_keys', kind: 'keys', amount: 2, cost: 45, name: 'KEY BUNDLE', icon: 'key', color: '#ffcd75', desc: '+2 Keys for supply pods. Yours to keep.' },
  { id: 'sup_scrap', kind: 'scrap', amount: 20, cost: 36, name: 'SCRAP CRATE', icon: 'scrap', color: '#94b0c2', desc: '+20 scrap for part upgrades. Yours to keep.' },
  ...CONFIG.boons.map((b) => ({ id: `sup_${b.id}`, kind: 'boon', boonId: b.id, cost: 65, name: b.name.toUpperCase(), icon: 'star', color: b.color, desc: b.desc })),
];

const BY_ID = Object.fromEntries(SUPPLIES.map((s) => [s.id, s]));
export const getSupply = (id) => BY_ID[id] || null;

/** `count` different supplies, at most one boon among them. */
export function rollSupplies(count = 3, rnd = Math.random) {
  const pool = [...SUPPLIES];
  const out = [];
  while (out.length < count && pool.length) {
    const s = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
    if (s.kind === 'boon' && out.some((o) => o.kind === 'boon')) continue;
    out.push(s);
  }
  return out;
}

/** Hand a supply to the player. Returns a short line for the toast. */
export function grantSupply(s, run) {
  switch (s.kind) {
    case 'repair':
      return `+${run.healFlat(s.amount)} HP`;
    case 'maxhp':
      run.addMaxHp(s.amount);
      return `+${s.amount} MAX HP`;
    case 'keys':
      saveSystem.addTokens(s.amount);
      run.tokensEarned = (run.tokensEarned || 0) + s.amount;
      return `+${s.amount} KEYS`;
    case 'scrap':
      saveSystem.addScrap(s.amount);
      return `+${s.amount} SCRAP`;
    case 'boon':
      run.applyBoon(s.boonId);
      return s.name;
    default:
      return '';
  }
}
