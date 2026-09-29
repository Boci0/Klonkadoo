// ============================================================
// tier-report — does rarity rank parts at their best form? Headless.
//
//   node tools/tier-report.mjs [--all]
//
// Every tier multiplies a part by CONFIG.gear.tierStep, so a part that starts
// lower climbs more steps: at its best form (Ascended LV max for parts that
// reach Mythic, else its top tier's max level) a Rare is ~3x its base, a
// Mythic ~1.6x. The same ratio holds at any tier two parts share, so if
// best forms rank right, every tier does.
//
// Parts are grouped by role and compared on the stat that role is for; a
// part is flagged BELOW when a lower-rarity part in its role ends ahead of
// it on that stat. Perks (crit, forcefield, drain...) are listed, not scored:
// a flag is a question for a person, not a verdict. --all prints every group.
// ============================================================

import { PARTS, partStats, tierRange, GUN_TYPE_DMG } from '../src/meta/Mech.js';
import { CONFIG } from '../src/config.js';

const G = CONFIG.gear;
const R = ['common', 'rare', 'epic', 'legendary', 'mythic', 'ascended'];
const all = process.argv.includes('--all');

/** A part at its best: Ascended max if it can reach Mythic, else its top tier's max level. */
export function bestForm(p) {
  const hi = tierRange(p)[1];
  const tier = hi === 'mythic' ? 'ascended' : hi;
  return { tier, s: partStats({ id: p.id, tier, level: G.tierLevelCap[R.indexOf(tier)] }) };
}

const perUse = (s) => Math.round((s.dmg || 0) * (s.fx?.burst || 1) * G.dmgScale);
const hp = (s) => Math.round(s.hp || 0);
const sumRes = (s) => Object.values(s.res || {}).reduce((a, b) => a + b, 0);
const moveOf = (p) => (p.anchored ? 'anchored' : p.jump ? (p.walk >= 2 ? 'walk+jump' : 'jumper') : 'walker');

// role -> which parts, what they're for, how to show them
const ROLES = [
  ...['side', 'top'].flatMap((mnt) =>
    ['phys', 'heat', 'energy'].map((dt) => ({
      name: `${mnt} guns · ${dt}`,
      pick: (p) => p.type === 'weapon' && (p.mount === 'top' ? 'top' : 'side') === mnt && p.dtype === dt,
      score: perUse,
      unit: 'dmg/use',
    })),
  ),
  { name: 'frames', pick: (p) => p.type === 'frame', score: hp, unit: 'HP (reactor never grows on frames)' },
  ...['walker', 'jumper', 'walk+jump', 'anchored'].map((m) => ({ name: `legs · ${m}`, pick: (p) => p.type === 'legs' && moveOf(p) === m, score: hp, unit: 'HP' })),
  { name: 'drones · attack', pick: (p) => p.type === 'drone' && p.dmg, score: perUse, unit: 'dmg/turn' },
  { name: 'modules · HP armor', pick: (p) => p.type === 'module' && p.hp, score: hp, unit: 'HP' },
  { name: 'modules · resist only', pick: (p) => p.type === 'module' && p.res && !p.hp, score: sumRes, unit: 'total resist' },
  { name: 'modules · damage', pick: (p) => p.type === 'module' && (p.atkPct || p.weaponDmgPct), score: (s) => Math.round(((1 + (s.atkPct || 0)) * (1 + (s.weaponDmgPct || 0)) - 1) * 100), unit: '% damage' },
  { name: 'modules · battery', pick: (p) => p.type === 'module' && p.energy, score: (s) => s.energy, unit: 'energy' },
  { name: 'modules · regen', pick: (p) => p.type === 'module' && p.regen, score: (s) => s.regen, unit: 'regen' },
  { name: 'modules · heat cap', pick: (p) => p.type === 'module' && p.heatCap, score: (s) => s.heatCap, unit: 'heat cap' },
  { name: 'modules · cooling', pick: (p) => p.type === 'module' && p.cool, score: (s) => s.cool, unit: 'cooling' },
  { name: 'specials · ram', pick: (p) => p.type === 'special' && p.ram, score: (s) => Math.round((s.ram || 0) * G.dmgScale), unit: 'ram dmg' },
];

const perks = (p) =>
  [p.fx?.crit && `crit ${p.fx.crit * 100}%`, p.fx?.drain && 'drain', p.fx?.heat && 'heat', p.fx?.pierce && 'pierce', p.fx?.push && 'push', p.fx?.pull && 'pull', p.ammo && `ammo ${p.ammo}`, p.backfire && 'backfire', p.startForcefield && 'forcefield', p.freeFirstShot && 'free 1st shot', p.killHeal && 'kill heal', p.unique && '1x', p.res && !['module'].includes(p.type) && 'res', p.def && `def ${p.def}`, p.atkPct && p.type !== 'module' && `+${p.atkPct * 100}% dmg`, p.freeMove && 'free move', p.moveEn && 'move costs en', p.en === 0 && 'no energy', p.heat === 0 && 'no heat', p.reach && `reach ${p.reach.join('-')}`]
    .filter(Boolean)
    .join(', ');

let flagged = 0;
for (const role of ROLES) {
  const list = PARTS.filter(role.pick).map((p) => ({ p, ...bestForm(p) })).map((x) => ({ ...x, v: role.score(x.s) }));
  if (!list.length) continue;
  list.sort((a, b) => R.indexOf(a.p.rarity) - R.indexOf(b.p.rarity) || b.v - a.v);
  const rows = list.map((x) => {
    const beaten = list.filter((y) => R.indexOf(y.p.rarity) < R.indexOf(x.p.rarity) && y.v > x.v * 1.001);
    return { ...x, beaten };
  });
  const bad = rows.filter((r) => r.beaten.length);
  flagged += bad.length;
  if (!all && !bad.length) continue;
  console.log(`\n${role.name}  (${role.unit}, at best form)`);
  for (const r of rows) {
    const flag = r.beaten.length ? `BELOW ${r.beaten.map((y) => `${y.p.id} ${y.v}`).join(', ')}` : '';
    console.log(`  ${r.p.id.padEnd(16)}${r.p.rarity.padEnd(10)}-> ${r.tier.padEnd(9)} ${String(r.v).padStart(6)}  ${flag.padEnd(0)}${flag ? '  ' : ''}${perks(r.p)}`);
  }
}
console.log(`\n${flagged} part(s) end below a lower-rarity part of their role.`);
