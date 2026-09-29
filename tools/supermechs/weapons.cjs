// SuperMechs Reloaded weapon patterns at Mythic: damage by reach band, uses, cost by element, element
// effect size, push, hit spread (numbers-rework reference). node tools/supermechs/weapons.cjs
// SuperMechs Reloaded weapon patterns at Mythic (max level): damage by range band,
// limited uses, cost split by element, element effect size, push, spread.
const items = require('./load.cjs');
const W = items
  .filter((i) => /Weapon/.test(i.file) && i.tier === 'M')
  .map((i) => ({ n: i.name, top: i.file === 'topWeapon', el: i.dmgType, dmg: (+i.dmgMin + +i.dmgMax) / 2, spread: +i.dmgMax / Math.max(1, +i.dmgMin), rmin: +i.rangeMin, rmax: +i.rangeMax, en: +i.costEn, he: +i.costHeat, uses: +i.uses, push: +i.push, heD: +i.heDmg, enD: +i.enDmg, cool: +i.heCoolDmg, reg: +i.enRegenDmg }));
const med = (a) => { a = [...a].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };
const band = (w) => (w.rmax <= 1 ? '1' : w.rmax <= 2 ? '1-2' : w.rmax <= 4 ? '2-4' : w.rmax <= 6 ? '3-6' : '4-8+');
console.log('Mythic weapons:', W.length, `(side ${W.filter((w) => !w.top).length}, top ${W.filter((w) => w.top).length})`);

console.log('\n1) damage by range band, unlimited uses (median):');
for (const top of [false, true]) {
  const g = {};
  for (const w of W.filter((w) => w.top === top && !w.uses)) (g[band(w)] ||= []).push(w.dmg);
  console.log(`  ${top ? 'top ' : 'side'}  ` + Object.entries(g).map(([b, a]) => `${b}: ${Math.round(med(a))} (n${a.length})`).join('   '));
}
console.log('\n2) uses per fight (median damage):');
const g2 = {};
for (const w of W) (g2[`${w.top ? 'top ' : 'side'} ${w.uses ? 'uses ' + w.uses : 'unlimited'}`] ||= []).push(w.dmg);
for (const [k, a] of Object.entries(g2).sort()) console.log(`  ${k.padEnd(18)}${Math.round(med(a))} (n${a.length})`);
console.log('\n3) cost by element, unlimited (median energy / heat per shot; cost per 100 dmg):');
for (const el of ['phy', 'exp', 'elc']) {
  const l = W.filter((w) => w.el === el && !w.uses);
  console.log(`  ${el}  en ${med(l.map((w) => w.en))}  heat ${med(l.map((w) => w.he))}   cost/100dmg ${Math.round(med(l.map((w) => ((w.en + w.he) / w.dmg) * 100)))}`);
}
console.log('\n4) element effect as % of the hit:');
console.log(`  explosive heat dmg ${Math.round(med(W.filter((w) => w.el === 'exp' && w.heD).map((w) => (w.heD / w.dmg) * 100)))}%   electric energy dmg ${Math.round(med(W.filter((w) => w.el === 'elc' && w.enD).map((w) => (w.enD / w.dmg) * 100)))}%`);
console.log('  damage by element (unlimited): ' + ['phy', 'exp', 'elc'].map((el) => `${el} ${Math.round(med(W.filter((w) => w.el === el && !w.uses).map((w) => w.dmg)))}`).join('  '));
console.log(`\n5) push (side, unlimited) median dmg: push ${Math.round(med(W.filter((w) => !w.top && !w.uses && w.push > 0).map((w) => w.dmg)))}  none ${Math.round(med(W.filter((w) => !w.top && !w.uses && !w.push).map((w) => w.dmg)))}`);
console.log('   cooling / regen crushers: ' + W.filter((w) => w.cool || w.reg).map((w) => `${w.n} cool${w.cool} regen${w.reg}`).join(', '));
console.log(`\n6) hit spread max/min median ${med(W.map((w) => w.spread)).toFixed(2)}`);
