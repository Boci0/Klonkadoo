// ============================================================
// Mech — SuperMechs-style loadout.
//
// Slots: Frame, Armor, Weapon x2, Drone, Module x2. The Frame sets
// base HP and the weight capacity; every other part has a weight,
// so heavy guns squeeze out armor. Parts come from crates bought
// with Tokens earned in runs (never real money; odds are shown).
// Duplicates salvage into scrap, scrap upgrades parts (level 1-10).
//
// In battle, weapons auto-fire when your shot settles at an enemy
// inside their range band (distance between ball centres); drones
// act every turn at any range. Enemies carry weapons too.
// ============================================================

export const SLOTS = [
  { id: 'frame', type: 'frame', name: 'FRAME' },
  { id: 'armor', type: 'armor', name: 'ARMOR' },
  { id: 'weapon1', type: 'weapon', name: 'WEAPON 1' },
  { id: 'weapon2', type: 'weapon', name: 'WEAPON 2' },
  { id: 'drone', type: 'drone', name: 'DRONE' },
  { id: 'module1', type: 'module', name: 'MODULE 1' },
  { id: 'module2', type: 'module', name: 'MODULE 2' },
];

export const RARITIES = {
  common: { name: 'COMMON', color: '#94b0c2', scrap: 3, cost: 1 },
  rare: { name: 'RARE', color: '#41a6f6', scrap: 8, cost: 1.5 },
  epic: { name: 'EPIC', color: '#c46fd6', scrap: 20, cost: 2 },
  legendary: { name: 'LEGENDARY', color: '#ffcd75', scrap: 50, cost: 3 },
};
const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary'];

// ---------- Catalog (35 parts) ----------
// Weapons: range [min, max] in world px, dmg per shot, cd = turns between shots.
// fx: burn / freeze / corrode / splash / chain / pierce (ignores DEF) / leech / crit
export const PARTS = [
  // Frames: base HP + weight capacity (frames weigh nothing)
  { id: 'fr_scout', type: 'frame', name: 'SCOUT FRAME', rarity: 'common', hp: 0, capacity: 60, desc: 'Light and simple.' },
  { id: 'fr_brawler', type: 'frame', name: 'BRAWLER FRAME', rarity: 'rare', hp: 20, capacity: 72 },
  { id: 'fr_phantom', type: 'frame', name: 'PHANTOM FRAME', rarity: 'epic', hp: 5, capacity: 80, powerPct: 0.1, desc: '+10% launch power.' },
  { id: 'fr_titan', type: 'frame', name: 'TITAN FRAME', rarity: 'epic', hp: 45, capacity: 88 },
  { id: 'fr_colossus', type: 'frame', name: 'COLOSSUS FRAME', rarity: 'legendary', hp: 60, capacity: 104 },

  // Armor
  { id: 'ar_scrap', type: 'armor', name: 'SCRAP PLATES', rarity: 'common', weight: 10, hp: 15 },
  { id: 'ar_kevlar', type: 'armor', name: 'KEVLAR WEAVE', rarity: 'common', weight: 8, def: 1.5 },
  { id: 'ar_reactive', type: 'armor', name: 'REACTIVE ARMOR', rarity: 'rare', weight: 16, hp: 20, def: 2 },
  { id: 'ar_aegis', type: 'armor', name: 'AEGIS SHELL', rarity: 'epic', weight: 22, hp: 28, def: 2.5, startForcefield: true, desc: 'Start each battle with a Forcefield.' },
  { id: 'ar_titanium', type: 'armor', name: 'TITANIUM HULL', rarity: 'legendary', weight: 28, hp: 45, def: 4 },

  // Weapons
  { id: 'wp_blaster', type: 'weapon', name: 'PULSE BLASTER', rarity: 'common', weight: 12, range: [0, 340], dmg: 8, cd: 1, color: '#73eff7' },
  { id: 'wp_scatter', type: 'weapon', name: 'SCATTERGUN', rarity: 'common', weight: 14, range: [0, 210], dmg: 14, cd: 1, color: '#ffcd75' },
  { id: 'wp_acid', type: 'weapon', name: 'ACID SPRAYER', rarity: 'common', weight: 12, range: [0, 270], dmg: 5, cd: 1, fx: { corrode: 1 }, color: '#a7f070', desc: 'Strips 1 DEF per hit.' },
  { id: 'wp_rifle', type: 'weapon', name: 'LONG RIFLE', rarity: 'rare', weight: 18, range: [320, 780], dmg: 14, cd: 2, color: '#f4f4f4' },
  { id: 'wp_flamer', type: 'weapon', name: 'FLAMER', rarity: 'rare', weight: 16, range: [0, 190], dmg: 6, cd: 1, fx: { burn: 2 }, color: '#ef7d57', desc: 'Burns for 2 turns.' },
  { id: 'wp_mortar', type: 'weapon', name: 'MORTAR', rarity: 'rare', weight: 22, range: [360, 1000], dmg: 15, cd: 2, fx: { splash: 110 }, color: '#ef7d57', desc: 'Splashes enemies near the target.' },
  { id: 'wp_cryo', type: 'weapon', name: 'CRYO CANNON', rarity: 'rare', weight: 18, range: [150, 520], dmg: 8, cd: 2, fx: { freeze: true }, color: '#73eff7', desc: 'Freezes: their next shot is weaker.' },
  { id: 'wp_tesla', type: 'weapon', name: 'TESLA COIL', rarity: 'epic', weight: 20, range: [0, 400], dmg: 11, cd: 2, fx: { chain: 260 }, color: '#c46fd6', desc: 'Arcs to a second enemy.' },
  { id: 'wp_missiles', type: 'weapon', name: 'MISSILE POD', rarity: 'epic', weight: 24, range: [0, 1400], dmg: 12, cd: 2, color: '#ff5d73', desc: 'Hits at any range.' },
  { id: 'wp_rail', type: 'weapon', name: 'RAIL LANCE', rarity: 'epic', weight: 26, range: [450, 1150], dmg: 22, cd: 3, fx: { pierce: true }, color: '#41a6f6', desc: 'Ignores DEF.' },
  { id: 'wp_howitzer', type: 'weapon', name: 'SIEGE HOWITZER', rarity: 'legendary', weight: 34, range: [520, 1400], dmg: 32, cd: 3, fx: { splash: 140 }, color: '#ffcd75' },
  { id: 'wp_scythe', type: 'weapon', name: 'PLASMA SCYTHE', rarity: 'legendary', weight: 24, range: [0, 230], dmg: 26, cd: 2, fx: { leech: 0.25 }, color: '#c46fd6', desc: 'Heals you for 25% of damage.' },

  // Drones: act every turn, any range
  { id: 'dr_gnat', type: 'drone', name: 'GNAT DRONE', rarity: 'common', weight: 6, dmg: 3, color: '#94b0c2' },
  { id: 'dr_hornet', type: 'drone', name: 'HORNET DRONE', rarity: 'rare', weight: 9, dmg: 5, color: '#ffcd75' },
  { id: 'dr_medic', type: 'drone', name: 'MEDIC DRONE', rarity: 'rare', weight: 8, heal: 4, color: '#a7f070', desc: 'Repairs you every turn.' },
  { id: 'dr_guardian', type: 'drone', name: 'GUARDIAN DRONE', rarity: 'epic', weight: 10, forcefieldEvery: 3, color: '#a7f070', desc: 'Forcefield every 3rd turn.' },
  { id: 'dr_reaper', type: 'drone', name: 'REAPER DRONE', rarity: 'legendary', weight: 12, dmg: 9, fx: { crit: 0.2 }, color: '#ff5d73', desc: '20% crit chance.' },

  // Modules: passive bonuses
  { id: 'md_target', type: 'module', name: 'TARGETING CPU', rarity: 'common', weight: 4, crit: 0.03 },
  { id: 'md_servo', type: 'module', name: 'SERVO BOOST', rarity: 'common', weight: 4, powerPct: 0.05 },
  { id: 'md_bounty', type: 'module', name: 'BOUNTY CHIP', rarity: 'common', weight: 3, goldPct: 0.15 },
  { id: 'md_amp', type: 'module', name: 'DAMAGE AMP', rarity: 'rare', weight: 6, atkPct: 0.08 },
  { id: 'md_repair', type: 'module', name: 'NANO REPAIR', rarity: 'rare', weight: 6, healAfterWin: 0.05, desc: 'Heal after every won battle.' },
  { id: 'md_heatsink', type: 'module', name: 'HEAT SINK', rarity: 'rare', weight: 5, cdCut: 1, desc: 'Weapon cooldowns -1 turn (min 1).' },
  { id: 'md_range', type: 'module', name: 'RANGE EXTENDER', rarity: 'epic', weight: 5, rangePct: 0.15 },
  { id: 'md_overclock', type: 'module', name: 'OVERCLOCK CORE', rarity: 'legendary', weight: 8, atkPct: 0.1, weaponDmgPct: 0.2 },
];

const PART_BY_ID = Object.fromEntries(PARTS.map((p) => [p.id, p]));
export const getPart = (id) => PART_BY_ID[id];

export const STARTER_PARTS = ['fr_scout', 'ar_scrap', 'wp_blaster', 'dr_gnat'];
export const STARTER_LOADOUT = { frame: 'fr_scout', armor: 'ar_scrap', weapon1: 'wp_blaster', drone: 'dr_gnat' };

export const MAX_LEVEL = 10;
export const INVENTORY_CAP = 60;

/** Stats grow 8% per level; weight and range don't. */
export const levelMult = (lvl) => 1 + 0.08 * (lvl - 1);

// Numeric fields that scale with level
const SCALING = ['hp', 'def', 'dmg', 'heal', 'atkPct', 'crit', 'powerPct', 'goldPct', 'healAfterWin', 'weaponDmgPct', 'rangePct'];

/** A part's stats at the owned item's level. */
export function partStats(owned) {
  const base = getPart(owned.id);
  if (!base) return null;
  const k = levelMult(owned.level || 1);
  const out = { ...base, level: owned.level || 1, uid: owned.uid };
  for (const f of SCALING) if (typeof base[f] === 'number') out[f] = base[f] * (f === 'hp' || f === 'dmg' || f === 'heal' ? k : 1 + (k - 1) * 0.5);
  return out;
}

export const rarityColor = (r) => RARITIES[r]?.color || '#94b0c2';
export const rarityName = (r) => RARITIES[r]?.name || '';
export const salvageValue = (owned) => Math.round(RARITIES[getPart(owned.id).rarity].scrap * (1 + (owned.level - 1) * 0.3));
export const upgradeCost = (owned) => Math.ceil(owned.level * 5 * RARITIES[getPart(owned.id).rarity].cost);

/** Short stat lines for cards. */
export function describePart(owned) {
  const p = partStats(owned);
  const L = [];
  if (p.type === 'frame') L.push(`CAP ${p.capacity}`);
  if (p.weight) L.push(`WT ${p.weight}`);
  if (p.hp) L.push(`HP +${Math.round(p.hp)}`);
  if (p.def) L.push(`DEF +${p.def.toFixed(1)}`);
  if (p.dmg) L.push(`DMG ${Math.round(p.dmg)}`);
  if (p.range) L.push(`RNG ${p.range[0]}-${p.range[1]}`);
  if (p.cd) L.push(`CD ${p.cd}`);
  if (p.heal) L.push(`HEAL ${Math.round(p.heal)}/turn`);
  if (p.atkPct) L.push(`DMG +${Math.round(p.atkPct * 100)}%`);
  if (p.weaponDmgPct) L.push(`GUNS +${Math.round(p.weaponDmgPct * 100)}%`);
  if (p.crit) L.push(`CRIT +${(p.crit * 100).toFixed(1)}%`);
  if (p.powerPct) L.push(`POWER +${Math.round(p.powerPct * 100)}%`);
  if (p.goldPct) L.push(`GOLD +${Math.round(p.goldPct * 100)}%`);
  if (p.rangePct) L.push(`RANGE +${Math.round(p.rangePct * 100)}%`);
  if (p.healAfterWin) L.push(`+${Math.round(p.healAfterWin * 100)}% HP/win`);
  if (p.desc) L.push(p.desc);
  return L;
}

// ---------- Loadout ----------

/** Totals for a loadout (array of owned parts, nulls allowed). */
export function loadoutTotals(ownedParts) {
  const t = {
    capacity: 0, weight: 0, hp: 0, def: 0, atkPct: 0, crit: 0, powerPct: 0, goldPct: 0,
    healAfterWin: 0, weaponDmgPct: 0, rangePct: 0, cdCut: 0, startForcefield: false,
    weapons: [], drones: [],
  };
  const parts = ownedParts.filter(Boolean).map(partStats).filter(Boolean);
  for (const p of parts) {
    if (p.type === 'frame') t.capacity += p.capacity;
    t.weight += p.weight || 0;
    for (const f of ['hp', 'def', 'atkPct', 'crit', 'powerPct', 'goldPct', 'healAfterWin', 'weaponDmgPct', 'rangePct', 'cdCut']) t[f] += p[f] || 0;
    if (p.startForcefield) t.startForcefield = true;
    if (p.type === 'weapon') t.weapons.push(p);
    if (p.type === 'drone') t.drones.push(p);
  }
  // Module effects apply to the guns
  t.weapons = t.weapons.map((w) => ({
    ...w,
    dmg: w.dmg * (1 + t.weaponDmgPct),
    range: [w.range[0], Math.round(w.range[1] * (1 + t.rangePct))],
    cd: Math.max(1, w.cd - t.cdCut),
  }));
  t.overweight = t.weight > t.capacity;
  return t;
}

/** Fold the loadout into the tech tree's permanent stats for a run. */
export function withMech(perm, ownedParts) {
  const t = loadoutTotals(ownedParts);
  return {
    ...perm,
    atkBonus: (perm.atkBonus || 0) + t.atkPct,
    critChance: (perm.critChance || 0) + t.crit,
    hpBonus: (perm.hpBonus || 0) + Math.round(t.hp),
    defBonus: (perm.defBonus || 0) + t.def,
    gearPowerPct: t.powerPct,
    gearGoldPct: t.goldPct,
    mech: {
      weapons: t.weapons,
      drones: t.drones,
      healAfterWin: t.healAfterWin,
      startForcefield: t.startForcefield,
    },
  };
}

// ---------- Crates ----------

export const CRATES = [
  { id: 'standard', name: 'SUPPLY CRATE', cost: 8, odds: { common: 62, rare: 28, epic: 9, legendary: 1 } },
  { id: 'elite', name: 'ELITE CRATE', cost: 24, odds: { common: 15, rare: 45, epic: 30, legendary: 10 } },
];

/** Roll one part from a crate. Odds are shown to the player in the UI. */
export function openCrate(crateId, rnd = Math.random) {
  const crate = CRATES.find((c) => c.id === crateId) || CRATES[0];
  let r = rnd() * 100;
  let rarity = 'common';
  for (const k of RARITY_ORDER) {
    r -= crate.odds[k];
    if (r <= 0) {
      rarity = k;
      break;
    }
  }
  const pool = PARTS.filter((p) => p.rarity === rarity);
  const part = pool[Math.floor(rnd() * pool.length)];
  return { uid: newUid(rnd), id: part.id, level: 1 };
}

export const newUid = (rnd = Math.random) => `m${Date.now().toString(36)}${Math.floor(rnd() * 1e6).toString(36)}`;

/** Tokens for winning a fight (Risk adds 10% per level). */
export function tokenReward(nodeType, risk = 0) {
  const base = { combat: 1, elite: 3, miniboss: 5, boss: 6 }[nodeType] || 0;
  return Math.round(base * (1 + 0.1 * risk));
}

// ---------- Enemy weapons ----------

const ENEMY_POOL = {
  1: ['wp_blaster', 'wp_scatter'],
  2: ['wp_blaster', 'wp_scatter', 'wp_acid', 'wp_rifle'],
  3: ['wp_scatter', 'wp_rifle', 'wp_flamer', 'wp_cryo', 'wp_acid'],
  4: ['wp_rifle', 'wp_flamer', 'wp_mortar', 'wp_cryo', 'wp_tesla'],
  5: ['wp_rifle', 'wp_mortar', 'wp_tesla', 'wp_missiles', 'wp_rail'],
};

/**
 * Weapons for one enemy. Enemy guns hit softer and cool down slower
 * than yours; elites and bosses carry two.
 */
export function enemyWeapons(nodeType, floor, rnd = Math.random) {
  const f = Math.max(1, Math.min(5, floor));
  if (nodeType === 'combat' && f === 1 && rnd() < 0.5) return []; // ease new players in
  const count = nodeType === 'combat' ? 1 : 2;
  const pool = [...ENEMY_POOL[f]];
  const scale = 0.5 * (1 + 0.1 * (f - 1)) * (nodeType === 'boss' ? 1.2 : 1);
  const out = [];
  for (let i = 0; i < count && pool.length; i++) {
    const base = getPart(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
    out.push({ ...base, dmg: Math.max(2, Math.round(base.dmg * scale)), cd: base.cd + 1, level: 1 });
  }
  return out;
}
