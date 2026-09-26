// ============================================================
// Gear — permanent equipment that drops from tough fights.
// 3 slots (Core / Plating / Module), 4 rarities, item levels
// 1..10. Duplicates are salvaged into scrap, scrap upgrades the
// items you keep. Gear stats are folded into the permanent stats
// (see withGear) so every existing formula picks them up.
//
// Power budget: a full set of Legendary +10 gear is roughly
// +40% damage and +50% effective HP. Risk is the ladder gear
// lets you climb: higher Risk drops higher item levels.
// ============================================================

export const SLOTS = [
  { id: 'core', name: 'CORE', hint: 'Damage' },
  { id: 'plating', name: 'PLATING', hint: 'Survival' },
  { id: 'module', name: 'MODULE', hint: 'Effect' },
];

export const RARITIES = [
  { id: 'common', name: 'COMMON', color: '#94b0c2', mult: 1.0, lines: 1, scrap: 2, cost: 1 },
  { id: 'rare', name: 'RARE', color: '#41a6f6', mult: 1.3, lines: 2, scrap: 5, cost: 1.5 },
  { id: 'epic', name: 'EPIC', color: '#c46fd6', mult: 1.6, lines: 3, scrap: 12, cost: 2 },
  { id: 'legendary', name: 'LEGENDARY', color: '#ffcd75', mult: 2.0, lines: 3, scrap: 30, cost: 3 },
];

// Stat lines: base value at item level 1, Common rarity
export const STATS = {
  atkPct: { label: 'DMG', fmt: (v) => `+${Math.round(v * 100)}%`, base: 0.03 },
  crit: { label: 'CRIT', fmt: (v) => `+${(v * 100).toFixed(1)}%`, base: 0.02 },
  powerPct: { label: 'POWER', fmt: (v) => `+${Math.round(v * 100)}%`, base: 0.025 },
  hp: { label: 'HP', fmt: (v) => `+${Math.round(v)}`, base: 4.5 },
  def: { label: 'DEF', fmt: (v) => `+${v.toFixed(1)}`, base: 0.6 },
  goldPct: { label: 'GOLD', fmt: (v) => `+${Math.round(v * 100)}%`, base: 0.04 },
};

const SLOT_STATS = {
  core: ['atkPct', 'crit', 'powerPct'],
  plating: ['hp', 'def', 'goldPct'],
  module: ['atkPct', 'hp', 'goldPct'],
};

// Module effects: base strength at item level 1, Common
export const MODULES = {
  mod_shield: { name: 'AEGIS EMITTER', desc: (v) => `Start every battle with a Forcefield that blocks ${Math.round(v)} hit${Math.round(v) > 1 ? 's' : ''}`, base: 1, perLevel: 0, rarityScales: false },
  mod_ricochet: { name: 'RICOCHET LENS', desc: (v) => `Hits after a wall bounce deal +${Math.round(v * 100)}% damage`, base: 0.08 },
  mod_medic: { name: 'FIELD MEDIC KIT', desc: (v) => `Heal ${Math.round(v * 100)}% max HP after every won battle`, base: 0.03 },
  mod_bounty: { name: 'BOUNTY TRACKER', desc: (v) => `+${Math.round(v * 100)}% gold from battles`, base: 0.1 },
};

export const MAX_LEVEL = 10;
export const INVENTORY_CAP = 40;

const levelFactor = (lvl) => 1 + 0.15 * (lvl - 1);
const rarityOf = (id) => RARITIES.find((r) => r.id === id) || RARITIES[0];
const pick = (arr, rnd) => arr[Math.floor(rnd() * arr.length)];

export function statValue(stat, item) {
  return STATS[stat].base * levelFactor(item.level) * rarityOf(item.rarity).mult;
}

export function moduleValue(item) {
  const m = MODULES[item.module];
  if (!m) return 0;
  if (m.rarityScales === false) return m.base;
  return m.base * levelFactor(item.level) * rarityOf(item.rarity).mult;
}

export function itemName(item) {
  if (item.slot === 'module') return MODULES[item.module]?.name || 'MODULE';
  const prefix = { common: 'STANDARD', rare: 'TUNED', epic: 'PROTOTYPE', legendary: 'MASTERWORK' }[item.rarity];
  return `${prefix} ${item.slot === 'core' ? 'CORE' : 'PLATING'}`;
}

/** Human-readable stat lines for an item. */
export function describeItem(item) {
  const lines = item.stats.map((s) => `${STATS[s].label} ${STATS[s].fmt(statValue(s, item))}`);
  if (item.slot === 'module') lines.unshift(MODULES[item.module].desc(moduleValue(item)));
  return lines;
}

/** Rarity odds: tougher fights and higher Risk shift weight upward. */
function rollRarity(source, risk, rnd) {
  const w = source === 'elite' ? [60, 28, 10, 2] : [35, 38, 21, 6];
  const shift = Math.min(30, risk * 3);
  w[0] = Math.max(5, w[0] - shift);
  w[1] += shift * 0.4;
  w[2] += shift * 0.4;
  w[3] += shift * 0.2;
  let r = rnd() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < w.length; i++) {
    r -= w[i];
    if (r <= 0) return RARITIES[i].id;
  }
  return 'common';
}

/**
 * Roll a new item. Item level tracks how deep you got and the Risk
 * you play on, so better gear comes from harder runs.
 */
export function rollItem({ floor = 1, risk = 0, source = 'elite' }, rnd = Math.random) {
  const slot = pick(SLOTS, rnd).id;
  const rarity = rollRarity(source, risk, rnd);
  const level = Math.max(1, Math.min(MAX_LEVEL, floor + Math.floor(risk / 2)));
  const pool = [...SLOT_STATS[slot]];
  const stats = [];
  // Modules carry their effect plus at most one stat (Epic and up)
  const lines = slot === 'module' ? Math.max(0, rarityOf(rarity).lines - 2) : rarityOf(rarity).lines;
  for (let i = 0; i < lines && pool.length; i++) {
    stats.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  }
  const item = {
    uid: `g${Date.now().toString(36)}${Math.floor(rnd() * 1e6).toString(36)}`,
    slot,
    rarity,
    level,
    stats,
  };
  if (slot === 'module') item.module = pick(Object.keys(MODULES), rnd);
  return item;
}

/** Drop chance per won fight: elites sometimes, mini-boss and boss always. */
export function dropChance(nodeType) {
  return { elite: 0.35, miniboss: 1, boss: 1 }[nodeType] || 0;
}

export const salvageValue = (item) => Math.round(rarityOf(item.rarity).scrap * (1 + (item.level - 1) * 0.25));
export const upgradeCost = (item) => Math.ceil(item.level * 4 * rarityOf(item.rarity).cost);
export const rarityColor = (id) => rarityOf(id).color;
export const rarityName = (id) => rarityOf(id).name;

/** Sum of every equipped item's stats and module strengths. */
export function gearTotals(equippedItems) {
  const t = { atkPct: 0, crit: 0, powerPct: 0, hp: 0, def: 0, goldPct: 0, modules: {} };
  for (const item of equippedItems) {
    if (!item) continue;
    for (const s of item.stats) t[s] += statValue(s, item);
    if (item.slot === 'module') t.modules[item.module] = (t.modules[item.module] || 0) + moduleValue(item);
  }
  return t;
}

/** Fold gear into the tech tree's permanent stats so runs and battles use them. */
export function withGear(perm, equippedItems) {
  const t = gearTotals(equippedItems);
  return {
    ...perm,
    atkBonus: (perm.atkBonus || 0) + t.atkPct,
    critChance: (perm.critChance || 0) + t.crit,
    hpBonus: (perm.hpBonus || 0) + Math.round(t.hp),
    defBonus: (perm.defBonus || 0) + t.def,
    gearPowerPct: t.powerPct,
    gearGoldPct: t.goldPct,
    gearModules: t.modules,
  };
}
