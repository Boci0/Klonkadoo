// ============================================================
// weight-report — every part's weight against what it gives, headless.
//
//   node tools/weight-report.mjs [--type=weapon|frame|legs|module|drone|special]
//
// Weight never grows with level or tier, so parts are compared at their
// base stats. Guns are scored by damage per use (x burst, x damage-type
// multiplier) and compared with the median kg per point of guns on the same
// mount and rarity; > 1.35x the median is flagged HEAVY, < 0.7x LIGHT.
// Other slots print their stats next to their weight for a by-eye pass.
//
// The flags only measure damage per kg. Weights follow SuperMechs Reloaded
// (docs/supermechs-research.md): kg buys convenience, not damage, so
// ammo-limited guns are meant LIGHT and no-cost / knockback / heat-pump guns
// HEAVY. Armor modules are the dearest kg, reactor modules and specials cheap.
// ============================================================

import { PARTS, GUN_TYPE_DMG, RARITY_ORDER } from '../src/meta/Mech.js';
import { CONFIG } from '../src/config.js';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const only = arg('type');
const G = CONFIG.gear;
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};
const rIdx = (r) => RARITY_ORDER.indexOf(r);
const byRarity = (a, b) => rIdx(a.rarity) - rIdx(b.rarity) || a.weight - b.weight;

// ---------- Guns ----------
function guns() {
  const list = PARTS.filter((p) => p.type === 'weapon').map((p) => {
    const perUse = Math.round((p.dmg || 0) * (GUN_TYPE_DMG[p.dtype] ?? 1) * (p.fx?.burst || 1) * G.dmgScale);
    return { ...p, mnt: p.mount === 'top' ? 'top' : 'side', perUse, kgPer100: (p.weight / Math.max(1, perUse)) * 100 };
  });
  // Median kg per 100 damage for the same mount, across all rarities and within the rarity
  const med = {};
  for (const g of list) (med[`${g.mnt}`] ||= []).push(g.kgPer100), (med[`${g.mnt}:${g.rarity}`] ||= []).push(g.kgPer100);
  for (const k of Object.keys(med)) med[k] = median(med[k]);
  console.log('\nGUNS  (dmg/use = hit x burst x type mult x dmgScale; kg/100 = kg per 100 damage per use)');
  for (const mnt of ['side', 'top']) {
    console.log(`\n  ${mnt.toUpperCase()} (median kg/100: ${med[mnt].toFixed(1)})`);
    console.log(`  ${pad('part', 18)}${pad('rarity', 10)}${lpad('kg', 5)}${lpad('dmg/use', 9)}${lpad('kg/100', 8)}${lpad('vs tier', 9)}  reach  en/heat  notes`);
    for (const g of list.filter((x) => x.mnt === mnt).sort(byRarity)) {
      const rel = g.kgPer100 / med[`${mnt}:${g.rarity}`];
      const flag = rel > 1.35 ? 'HEAVY' : rel < 0.7 ? 'LIGHT' : '';
      const notes = [g.ammo && `ammo ${g.ammo}`, g.backfire && `backfire ${g.backfire}`, g.fx && Object.keys(g.fx).filter((k) => k !== 'burst').join(','), /Heavy/.test(g.desc || '') && '(meant heavy)'].filter(Boolean).join(' ');
      console.log(`  ${pad(g.id, 18)}${pad(g.rarity, 10)}${lpad(g.weight, 5)}${lpad(g.perUse, 9)}${lpad(g.kgPer100.toFixed(1), 8)}${lpad(rel.toFixed(2) + 'x', 9)}  ${pad(g.reach.join('-'), 6)} ${pad(`${g.en}/${g.heat}`, 8)} ${pad(flag, 6)}${notes}`);
    }
  }
}

// ---------- Everything else: stats beside weight ----------
const STAT_KEYS = ['hp', 'def', 'energy', 'regen', 'heatCap', 'cool', 'atkPct', 'weaponDmgPct', 'crit', 'dmg', 'heal', 'chill', 'walk', 'jump', 'stomp', 'uses', 'ram', 'range', 'absorb', 'reachBonus', 'killHeal', 'healAfterWin', 'stompPct', 'goldPct', 'hotAtk', 'lowHpAtk', 'ventEnergy'];
function table(type, title) {
  console.log(`\n${title}`);
  const list = PARTS.filter((p) => p.type === type).sort(byRarity);
  for (const p of list) {
    const stats = STAT_KEYS.filter((k) => p[k] !== undefined && p[k] !== 0).map((k) => `${k} ${Array.isArray(p[k]) ? p[k].join('-') : p[k]}`);
    if (p.res) stats.push(`res ${Object.entries(p.res).map(([t, v]) => `${t}:${v}`).join('/')}`);
    console.log(`  ${pad(p.id, 18)}${pad(p.rarity, 10)}${lpad(p.weight, 5)} kg   ${stats.join(', ')}`);
  }
}

// ---------- A full build's weight, by what you'd typically wear ----------
function builds() {
  const w = (ids) => ids.reduce((s, id) => s + (PARTS.find((p) => p.id === id)?.weight || 0), 0);
  const heaviest = (type, n, filter = () => true) => PARTS.filter((p) => p.type === type && filter(p)).sort((a, b) => b.weight - a.weight).slice(0, n).map((p) => p.id);
  const lightest = (type, n, filter = () => true) => PARTS.filter((p) => p.type === type && filter(p)).sort((a, b) => a.weight - b.weight).slice(0, n).map((p) => p.id);
  const side = (p) => p.type === 'weapon' && p.mount !== 'top';
  const top = (p) => p.type === 'weapon' && p.mount === 'top';
  console.log(`\nFULL BUILDS vs the ${G.loadCap} kg cap (1 frame, legs, 4 side, 2 top, drone, 8 modules)`);
  for (const [name, pick] of [['lightest everything', lightest], ['heaviest everything', heaviest]]) {
    const ids = [...pick('frame', 1), ...pick('legs', 1), ...pick('weapon', 4, side), ...pick('weapon', 2, top), ...pick('drone', 1), ...pick('module', 8)];
    console.log(`  ${pad(name, 22)} ${w(ids)} kg`);
  }
}

if (!only || only === 'weapon') guns();
if (!only || only === 'frame') table('frame', 'FRAMES');
if (!only || only === 'legs') table('legs', 'LEGS');
if (!only || only === 'drone') table('drone', 'DRONES');
if (!only || only === 'special') table('special', 'SPECIALS');
if (!only || only === 'module') table('module', 'MODULES');
if (!only) builds();
