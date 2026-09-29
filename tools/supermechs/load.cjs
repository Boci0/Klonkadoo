// Every SuperMechs Reloaded item at its final form (highest tier, max level), for the analysis
// scripts next to this file. Run tools/supermechs/fetch.sh first (data/ is gitignored).
// Tiers: C common, R rare, E epic, L legendary, M mythic, D divine.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = {};
vm.createContext(ctx);
for (const f of ['drone', 'torso', 'leg', 'sideWeapon', 'topWeapon', 'special', 'module']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'data', `sm_item_${f}.js`), 'utf8').replace(/^var /, 'this.'), ctx);
}
const rank = (x) => 'CRELMD'.indexOf(x.tier) * 1000 + Number(x.level);
const best = {};
for (const [k, set] of Object.entries(ctx)) {
  for (const it of Object.values(set)) {
    if (!best[it.name] || rank(it) > rank(best[it.name])) best[it.name] = { ...it, file: k.replace('sm_item_', '') };
  }
}
module.exports = Object.values(best);
module.exports.raw = ctx; // every item at every level, by file
