// ============================================================
// SaveSystem — persistence for the rig (parts, Keys, scrap), Risk,
// mastery, medals and stats.
//
// Stores data in localStorage. Old saves are migrated by merging
// defaults so missing fields never cause runtime errors, and _migrate
// upgrades retired systems (the tech tree became Keys + scrap).
// ============================================================

import { CONFIG } from '../config.js';
import { masteryLevel } from './Mastery.js';
import { INVENTORY_CAP, salvageValue, upgradeCost, maxLevel, tierOf, transformInfo, slotAccepts, RETIRED, RETIRED_REFUND, STARTER_PARTS, STARTER_LOADOUT, SLOTS, getPart, newUid, openCrate, CRATES, PACK_SIZE, packCost } from './Mech.js';

const STORAGE_KEY = 'slingshot-save-v1';

// Node costs of the last tech tree (v3), to convert what was spent on it
const TECH_COSTS_V3 = {"rct_capacitor":[8,12,16,22,30],"rct_dynamo":[30,60],"rct_coolant":[14,22,32],"rct_opener":[40],"rct_scavenge":[40],"rct_overclock":[120],"bar_reinforce":[6,10,16,24],"bar_quick":[24,48],"bar_spikes":[12,20,30],"bar_twin":[45],"bar_bulwark":[16,26,38],"bar_aegis":[110],"vit_emergency_medkit":[6,10,14,20,28],"vit_overflow_shield":[8,12,18,26,36],"def_forcefield":[12,18,26,36,48],"vit_vampiric_vitality":[14,20,28,38,50],"def_counter":[30,50,80],"vit_second_wind":[50,90],"tac_war_chest":[6,10,14,20,28],"tac_merchant":[8,12,18,26,36],"tac_scout":[60],"tac_intellect":[10,16,24,34,46],"tac_keymaster":[30,60],"tac_supply_drop":[55,100]};

export class SaveSystem {
  constructor() {
    this.data = this._load();
    this._ensureMech();
    this._migrate();
  }

  /**
   * One-off upgrades for older saves:
   *  - techVersion 2 / 3: tech tree rebuilds refunded TP.
   *  - techVersion 4: the tech tree is gone. Every Tech Point (held, or
   *    spent on nodes) becomes 1 scrap, plus 1 Key per 20 (rounded up).
   *  - ballRisk: Risk is now climbed per ball (see getMaxRiskUnlocked).
   */
  _migrate() {
    const d = this.data;
    if ((d.techVersion || 1) < 2) {
      const A = [6, 10, 14, 18, 22, 28, 34, 40, 48, 56];
      const B = [8, 12, 16, 20, 26, 32, 40, 48, 58, 70];
      const C = [10, 14, 18, 24, 30, 38, 46, 56, 68, 82];
      const D = [12, 16, 20, 26, 34, 42, 52, 64, 78, 94];
      const E = [14, 18, 24, 30, 38, 48, 60, 74, 90, 108];
      const K = [12, 16, 22, 28, 36, 46, 58, 72, 88, 106];
      const OLD = {
        atk_sharpshooter: A, vit_health: A, def_aegis: A, tac_war_chest: A,
        atk_base_power: B, vit_overflow_shield: B, def_matrix_pct: B, tac_merchant: B,
        atk_armor_pen: C, vit_emergency_medkit: C, def_thorns_resist: C, tac_logistics: C,
        atk_risk_resonance: D, vit_titan_core: D, def_forcefield: D, tac_intellect: D,
        atk_ballistic_apex: E, vit_vampiric_vitality: E, def_fortified_matrix: E, tac_relic_synergy: E,
        def_kinetic_dampener: K,
      };
      const CAP = { atk_crit: [40, 70, 110], vit_second_wind: [50, 90], def_counter: [45, 75, 110], tac_supply_drop: [55, 100] };
      let refund = 0;
      for (const [id, raw] of Object.entries(d.techTreePurchases || {})) {
        const lvl = raw === true ? 1 : Number(raw) || 0;
        const costs = CAP[id] || OLD[id];
        if (!costs) continue;
        for (let i = 0; i < lvl; i++) refund += CAP[id] ? costs[Math.min(i, costs.length - 1)] : Math.min(30, costs[Math.min(i, costs.length - 1)]);
      }
      d.techPoints = (d.techPoints || 0) + refund;
      d.techTreePurchases = {};
      d.techRefund = refund; // shown once on the tech screen
      d.techVersion = 2;
    }
    if ((d.techVersion || 1) < 3) {
      // Classes and skills were retired for gear combat: refund the SKILL branch
      const oldSkill = { skl_potency: [8, 12, 16, 22, 30], skl_recharge: [30, 60], skl_echo: [14, 22, 32], skl_opener: [40], skl_momentum: [40], skl_overload: [120] };
      const bought = d.techTreePurchases || {};
      let refund = 0;
      for (const [id, costs] of Object.entries(oldSkill)) {
        for (let i = 0; i < (bought[id] || 0); i++) refund += costs[i] || 0;
        delete bought[id];
      }
      d.techPoints = (d.techPoints || 0) + refund;
      if (refund) d.techRefund = (d.techRefund || 0) + refund; // shown once on the tech screen
      d.techVersion = 3;
    }
    if ((d.techVersion || 1) < 4 && d.mech) {
      const bought = d.techTreePurchases || {};
      let tp = Math.max(0, d.techPoints || 0);
      for (const [id, raw] of Object.entries(bought)) {
        const lvl = raw === true ? 1 : Number(raw) || 0;
        const costs = TECH_COSTS_V3[id] || [];
        for (let i = 0; i < lvl; i++) tp += costs[Math.min(i, costs.length - 1)] || 0;
      }
      const keys = Math.ceil(tp / 20);
      d.mech.tokens = (d.mech.tokens || 0) + keys;
      d.mech.scrap = (d.mech.scrap || 0) + tp;
      if (tp) d.techConverted = { tp, keys, scrap: tp }; // shown once on the menu
      delete d.techPoints;
      delete d.techTreePurchases;
      delete d.techTree;
      delete d.techRefund;
      d.techVersion = 4;
    }
    if (!d.ballRisk) {
      // Old saves shared one Risk ladder: each ball keeps what it has won on,
      // and the ball with the most wins keeps the whole old ladder
      const global = Math.min(CONFIG.risk.levels.length, d.maxRiskUnlocked || 0);
      const stats = d.ballStats || {};
      const best = Object.keys(stats).sort((a, b) => (stats[b].wins || 0) - (stats[a].wins || 0))[0];
      d.ballRisk = {};
      d.ballRiskSel = {};
      for (const [id, st] of Object.entries(stats)) d.ballRisk[id] = Math.min(global, (st.bestRiskWin ?? -1) + 1);
      if (best) d.ballRisk[best] = global;
      for (const id of Object.keys(d.ballRisk)) d.ballRiskSel[id] = Math.min(d.difficultyLevel || 0, d.ballRisk[id]);
    }
    d.selectedBall = 'operator';
    // Legs became a slot: older rigs get a pair of Strider legs fitted
    const m = d.mech;
    if (m && m.loadout && !('legs' in m.loadout)) {
      const uid = newUid();
      m.owned.push({ uid, id: 'lg_strider', level: 1 });
      m.loadout.legs = uid;
    }
    if (m && (d.mechVersion || 1) < 2) this._migrateMechV2(d);
    this.save();
  }

  /**
   * mechVersion 2 (the 1:1 build pass): 4 SIDE + 2 TOP guns, CHARGE / TELEPORT /
   * HOOK slots, 8 modules, no ARMOR, tiers. Armor becomes the matching module,
   * shield specials pay back Keys + scrap, every part gets a tier (its rarity),
   * and levels over the tier's new cap drop to it (the scrap spent comes back).
   */
  _migrateMechV2(d) {
    const m = d.mech;
    const report = { keys: 0, scrap: 0, armor: 0 };
    const gone = new Set();
    for (const o of m.owned) {
      if (o.id in RETIRED) {
        if (RETIRED[o.id]) {
          o.id = RETIRED[o.id];
          report.armor += 1;
        } else {
          const r = RETIRED_REFUND[o.id] || { keys: 2, scrap: 10 };
          report.keys += r.keys;
          report.scrap += r.scrap;
          gone.add(o.uid);
          continue;
        }
      }
      if (!getPart(o.id)) {
        gone.add(o.uid);
        continue;
      }
      o.tier = o.tier || getPart(o.id).rarity;
      const cap = maxLevel(o);
      while ((o.level || 1) > cap) {
        o.level -= 1;
        report.scrap += upgradeCost(o);
      }
    }
    m.owned = m.owned.filter((o) => !gone.has(o.uid));
    const part = (uid) => (uid && !gone.has(uid) ? m.owned.find((o) => o.uid === uid) : null);
    m.loadouts = (m.loadouts || []).map((lo) => {
      const next = Object.fromEntries(SLOTS.map((s) => [s.id, null]));
      next.frame = part(lo.frame)?.uid || null;
      next.legs = part(lo.legs)?.uid || null;
      next.drone = part(lo.drone)?.uid || null;
      const put = (o) => {
        if (!o) return;
        const slot = SLOTS.find((s) => !next[s.id] && slotAccepts(s, getPart(o.id)));
        if (slot) next[slot.id] = o.uid;
      };
      for (const k of ['weapon1', 'weapon2', 'module1', 'module2', 'armor', 'special1', 'special2']) put(part(lo[k]));
      return next;
    });
    m.tokens = (m.tokens || 0) + report.keys;
    m.scrap = (m.scrap || 0) + report.scrap;
    if (report.keys || report.scrap || report.armor) d.mechConverted = report; // shown once on the menu
    d.mechVersion = 2;
  }

  _defaults() {
    return {
      version: 2,
      techVersion: 4, // fresh saves have nothing to migrate (see _migrate)
      mechVersion: 2,
      profile: {
        name: 'operator',
        callsign: 'SLING-01',
      },
      meta: {
        totalWins: 0,
        totalLosses: 0,
        totalMatches: 0,
        totalRuns: 0,
        questsCompleted: 0,
      },
      difficultyLevel: 0, // selected Risk level (0..maxRiskUnlocked)
      maxRiskUnlocked: 0, // highest Risk level the player may select
      upgrades: {}, // legacy field kept for compatibility
      unlockedPerks: [], // roguelike perk ids
      progression: {
        completedLevels: 1,
        unlockedLevels: 1,
      },
      mech: null, // built on first load: see _ensureMech
    };
  }

  _load() {
    const defaults = this._defaults();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Migrate old saves: merge defaults so missing fields are filled
        return {
          ...defaults,
          ...parsed,
          profile: { ...defaults.profile, ...(parsed.profile || {}) },
          meta: { ...defaults.meta, ...(parsed.meta || {}) },
          upgrades: parsed.upgrades || {},
          unlockedPerks: parsed.unlockedPerks || [],
          progression: { ...defaults.progression, ...(parsed.progression || {}) },
          techVersion: parsed.techVersion || 1, // old saves get converted
          mechVersion: parsed.mechVersion || 1,
        };
      }
    } catch (e) {
      console.warn('Failed to load save data:', e);
      // Keep the unreadable save instead of overwriting it with a fresh one,
      // so progress can still be recovered by hand
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) localStorage.setItem(`${STORAGE_KEY}-corrupt-${Date.now()}`, raw);
      } catch (_) {}
    }
    return defaults;
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      return true;
    } catch (e) {
      console.warn('Failed to save:', e);
      return false;
    }
  }

  recordMatch(win) {
    this.data.meta.totalMatches += 1;
    if (win) {
      this.data.meta.totalWins += 1;
    } else {
      this.data.meta.totalLosses += 1;
    }
    this.save();
  }

  recordRun(win) {
    this.data.meta.totalRuns += 1;
    if (win) {
      this.data.meta.totalWins += 1;
    } else {
      this.data.meta.totalLosses += 1;
    }
    this.save();
  }

  recordQuestCompleted() {
    this.data.meta.questsCompleted += 1;
    this.save();
  }

  getProfile() {
    return this.data.profile;
  }

  getMeta() {
    return this.data.meta;
  }

  /** Per-ball progress (skin unlocks): runs, wins, bestFloor + battle counters. */
  getBallStats(id) {
    // masteryLevel is derived, so skins can unlock on it like any other stat
    return { runs: 0, wins: 0, bestFloor: 0, ...((this.data.ballStats || {})[id] || {}), masteryLevel: masteryLevel(this.getMasteryXp(id)).level };
  }

  recordBallRun(id, victory, floorReached, riskLevel = 0) {
    this.data.ballStats = this.data.ballStats || {};
    const cur = this.getBallStats(id);
    this.data.ballStats[id] = {
      ...cur,
      runs: cur.runs + 1,
      wins: cur.wins + (victory ? 1 : 0),
      bestFloor: Math.max(cur.bestFloor, floorReached),
      // Highest Risk this class has won on (-1 = never won); final skins need Risk 3+
      bestRiskWin: victory ? Math.max(cur.bestRiskWin ?? -1, riskLevel) : (cur.bestRiskWin ?? -1),
    };
    const life = this.getLifetime();
    life.runs += 1;
    if (victory) life.wins += 1;
    life.bestFloor = Math.max(life.bestFloor, floorReached);
    this.data.lifetime = life;
    this.save();
  }

  /**
   * Add one battle's tracked totals (Game.battleStats.track) to the ball's
   * stats and the lifetime stats. `best*` / `max*` keys keep the maximum.
   */
  addBattleStats(ballId, track) {
    this.data.ballStats = this.data.ballStats || {};
    const ball = this.getBallStats(ballId);
    const life = this.getLifetime();
    for (const [key, val] of Object.entries(track || {})) {
      if (typeof val !== 'number') continue;
      const keep = key.startsWith('best') || key.startsWith('max');
      ball[key] = keep ? Math.max(ball[key] || 0, val) : (ball[key] || 0) + val;
      life[key] = keep ? Math.max(life[key] || 0, val) : (life[key] || 0) + val;
    }
    this.data.ballStats[ballId] = ball;
    this.data.lifetime = life;
    this.save();
  }

  /** Lifetime counters for medals. */
  getLifetime() {
    return { runs: 0, wins: 0, bestFloor: 0, kills: 0, bossKills: 0, hits: 0, crits: 0, trickShots: 0, bestHit: 0, maxCombo: 0, bestRiskWin: -1, ...(this.data.lifetime || {}) };
  }

  bumpLifetime(key, value, mode = 'max') {
    const life = this.getLifetime();
    life[key] = mode === 'max' ? Math.max(life[key] ?? 0, value) : (life[key] || 0) + value;
    this.data.lifetime = life;
    this.save();
  }

  hasMedal(id) {
    return !!(this.data.medals || {})[id];
  }

  /** Medals pay Keys. */
  awardMedal(id, keys) {
    this.data.medals = this.data.medals || {};
    if (this.data.medals[id]) return false;
    this.data.medals[id] = Date.now();
    this.data.mech.tokens += keys;
    this.save();
    return true;
  }

  // ---------- Daily free pod (login streak) ----------

  static _dayKey(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** { canClaim, streak (after claiming today), crate: today's free pod ('elite' every 7th day in a row) } */
  getDailyStatus() {
    const daily = this.data.daily || { last: null, streak: 0 };
    const today = SaveSystem._dayKey();
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const continues = daily.last === SaveSystem._dayKey(y);
    const canClaim = daily.last !== today;
    const streak = canClaim ? (continues ? daily.streak + 1 : 1) : daily.streak;
    return { canClaim, streak, crate: streak % 7 === 0 ? 'elite' : 'standard' };
  }

  claimDaily() {
    const status = this.getDailyStatus();
    if (!status.canClaim) return null;
    this.data.daily = { last: SaveSystem._dayKey(), streak: status.streak };
    const life = this.getLifetime();
    life.bestStreak = Math.max(life.bestStreak || 0, status.streak);
    this.data.lifetime = life;
    this.save();
    return status;
  }

  // ---------- Per-ball Risk ladder ----------
  // Each ball climbs Risk 0-10 on its own; the menu and ball select show
  // the selected ball's ladder. The secret Risk XI is unlocked once for the
  // account but only opens for balls that have reached Risk 10.

  getSelectedBall() {
    return 'operator'; // one ball since classes were retired
  }

  setSelectedBall(id) {
    this.data.selectedBall = id;
    this.save();
  }

  /** Highest normal Risk (0-10) a ball has unlocked. */
  ballRiskMax(ball = this.getSelectedBall()) {
    return Math.max(0, Math.min(CONFIG.risk.levels.length, (this.data.ballRisk || {})[ball] || 0));
  }

  /** Risk rules in order, plus the secret level once it's open for this ball. */
  riskLevels(ball) {
    return this.hasSecretRisk(ball) ? [...CONFIG.risk.levels, CONFIG.risk.secret] : CONFIG.risk.levels;
  }

  hasSecretRisk(ball = this.getSelectedBall()) {
    return !!this.data.secretRisk && this.ballRiskMax(ball) >= CONFIG.risk.levels.length;
  }

  /** @returns {boolean} true the first time the secret level is unlocked */
  unlockSecretRisk() {
    if (this.data.secretRisk) return false;
    this.data.secretRisk = true;
    this.save();
    return true;
  }

  getMaxRiskUnlocked(ball = this.getSelectedBall()) {
    return this.ballRiskMax(ball) + (this.hasSecretRisk(ball) ? 1 : 0);
  }

  getDifficultyLevel(ball = this.getSelectedBall()) {
    return Math.max(0, Math.min(this.getMaxRiskUnlocked(ball), (this.data.ballRiskSel || {})[ball] || 0));
  }

  setDifficultyLevel(level, ball = this.getSelectedBall()) {
    this.data.ballRiskSel = this.data.ballRiskSel || {};
    this.data.ballRiskSel[ball] = Math.max(0, Math.min(this.getMaxRiskUnlocked(ball), Math.floor(level)));
    this.save();
  }

  /**
   * Winning a run on a ball's highest unlocked Risk unlocks its next one.
   * @returns {number|null} the newly unlocked level, if any
   */
  recordRiskWin(level, ball = this.getSelectedBall()) {
    const max = this.ballRiskMax(ball);
    if (level < max || max >= CONFIG.risk.levels.length) return null; // (the secret level unlocks separately)
    this.data.ballRisk = this.data.ballRisk || {};
    this.data.ballRisk[ball] = max + 1;
    this.data.maxRiskUnlocked = Math.max(this.data.maxRiskUnlocked || 0, max + 1); // account best (medals, Abyss pod)
    this.save();
    return max + 1;
  }

  /** Highest normal Risk any ball has unlocked (account-wide gates like the Abyss pod). */
  bestRiskAnyBall() {
    return Math.max(0, ...Object.values(this.data.ballRisk || {}));
  }

  // ---------- Mastery & Abyss ----------

  getMasteryXp(ball) {
    return (this.data.mastery || {})[ball] || 0;
  }

  /** Adds XP; returns { before, after } levels. */
  addMasteryXp(ball, xp) {
    this.data.mastery = this.data.mastery || {};
    const before = masteryLevel(this.getMasteryXp(ball)).level;
    this.data.mastery[ball] = this.getMasteryXp(ball) + Math.max(0, Math.round(xp));
    this.save();
    return { before, after: masteryLevel(this.data.mastery[ball]).level };
  }

  recordAbyssDepth(ball, depth) {
    this.data.ballStats = this.data.ballStats || {};
    const cur = this.getBallStats(ball);
    this.data.ballStats[ball] = { ...cur, bestAbyss: Math.max(cur.bestAbyss || 0, depth) };
    this.bumpLifetime('bestAbyss', depth);
  }

  /** Combined effect of Risk levels 1..level (rules stack). */
  getRiskData(level = this.getDifficultyLevel()) {
    const total = { hpPct: 0, atkPct: 0, defPct: 0, aiBonus: 0, enemyReach: 0, minusGold: 0, minusHeal: 0, plusCost: 0, plusDmgTaken: 0, eliteHpPct: 0, eliteAtkPct: 0 };
    for (const rule of this.riskLevels().slice(0, level)) {
      for (const key of Object.keys(total)) total[key] += rule[key] || 0;
      if (rule.allElite) total.allElite = true;
      if (rule.droneOut) total.droneOut = true;
      if (rule.gunCdCut) total.gunCdCut = (total.gunCdCut || 0) + rule.gunCdCut;
      if (rule.defPierce) total.defPierce = (total.defPierce || 0) + rule.defPierce;
    }
    return total;
  }

  /** Scrap multiplier from the selected Risk level. */
  getScrapMultiplier() {
    return 1 + (this.getDifficultyLevel() * CONFIG.risk.scrapPerLevel) / 100;
  }

  getHealingMultiplier() {
    const risk = this.getRiskData();
    return Math.max(0.2, 1 - (risk.minusHeal || 0) / 100);
  }

  getGoldMultiplier() {
    const risk = this.getRiskData();
    return Math.max(0.2, 1 - (risk.minusGold || 0) / 100);
  }

  getShopPriceMultiplier() {
    const risk = this.getRiskData();
    return 1 + (risk.plusCost || 0) / 100;
  }

  /**
   * Portable save code: "SLING1-<base64 json>-<checksum>". The checksum only
   * catches truncated / mistyped pastes; it is not meant as tamper protection.
   */
  exportSaveData() {
    const json = JSON.stringify(this.data);
    // Chunked: spreading a large save into fromCharCode overflows the call stack
    const bytes = new TextEncoder().encode(json);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const b64 = btoa(bin);
    return `SLING1-${b64}-${this._checksum(b64)}`;
  }

  _checksum(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  /** Decode a save code (or legacy raw JSON). Returns the parsed object, or null. */
  _decodeSave(input) {
    const text = String(input || '').replace(/\s+/g, '');
    if (text.startsWith('SLING1-')) {
      const parts = text.split('-');
      if (parts.length !== 3 || this._checksum(parts[1]) !== parts[2]) return null;
      const bytes = Uint8Array.from(atob(parts[1]), (c) => c.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    }
    return JSON.parse(String(input)); // legacy exports were raw JSON
  }

  /** @returns {boolean} true if the save was valid and applied */
  importSaveData(input) {
    try {
      const parsed = this._decodeSave(input);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
      if (!parsed.meta || typeof parsed.meta !== 'object') return false;
      const defaults = this._defaults();
      this.data = {
        ...defaults,
        ...parsed,
        profile: { ...defaults.profile, ...(parsed.profile || {}) },
        meta: { ...defaults.meta, ...(parsed.meta || {}) },
        upgrades: parsed.upgrades || {},
        unlockedPerks: parsed.unlockedPerks || [],
        progression: { ...defaults.progression, ...(parsed.progression || {}) },
        techVersion: parsed.techVersion || 1,
        mechVersion: parsed.mechVersion || 1,
      };
      this._ensureMech(); // older exported saves have no mech yet
      this._migrate();
      this.save();
      return true;
    } catch (e) {
      console.warn('Failed to import save data:', e);
      return false;
    }
  }

  // ---------- Mech loadout ----------

  /**
   * Every save gets a starter mech. Old stat gear (the previous system) is
   * converted into scrap so nothing earned is lost.
   */
  _ensureMech() {
    if (this.data.mech) return this._ensureGarage();
    const oldGear = this.data.gear;
    const legacyScrap = (oldGear?.scrap || 0) + (oldGear?.items || []).reduce((sum, it) => {
      const base = { common: 2, rare: 5, epic: 12, legendary: 30 }[it.rarity] || 2;
      return sum + Math.round(base * (1 + ((it.level || 1) - 1) * 0.25));
    }, 0);
    const owned = STARTER_PARTS.map((id) => ({ uid: newUid(), id, level: 1, tier: getPart(id).rarity }));
    const loadout = {};
    for (const slot of SLOTS) {
      const want = STARTER_LOADOUT[slot.id];
      loadout[slot.id] = want ? owned.find((o) => o.id === want)?.uid || null : null;
    }
    this.data.mech = { owned, loadouts: [loadout], editing: 0, garageSlots: 1, scrap: legacyScrap, tokens: 0, cratesOpened: 0 };
    delete this.data.gear;
    this._ensureGarage();
    this.save();
  }

  /**
   * The garage: up to 3 mechs (loadouts). Mech 1 always fights; mechs 2 and
   * 3 unlock (first floor-5 boss, first Abyss boss) and join the team once
   * they have a frame. `mech.loadout` stays readable as the one being edited.
   */
  _ensureGarage() {
    const m = this.data.mech;
    if (!Array.isArray(m.loadouts)) {
      const own = Object.getOwnPropertyDescriptor(m, 'loadout');
      m.loadouts = [(own && 'value' in own ? own.value : null) || {}];
    }
    delete m.loadout;
    m.garageSlots = Math.max(1, Math.min(3, m.garageSlots || 1));
    while (m.loadouts.length < m.garageSlots) m.loadouts.push(Object.fromEntries(SLOTS.map((s) => [s.id, null])));
    m.editing = Math.max(0, Math.min(m.garageSlots - 1, m.editing || 0));
    Object.defineProperty(m, 'loadout', { get: () => m.loadouts[m.editing], enumerable: false, configurable: true });
  }

  /** Garage slots unlocked (1..3). */
  garageSize() {
    return this.data.mech.garageSlots;
  }

  /** Unlock garage slot `n` (2 or 3). Returns true if it was new. */
  unlockGarageSlot(n) {
    const m = this.data.mech;
    if (m.garageSlots >= n) return false;
    m.garageSlots = Math.min(3, n);
    this._ensureGarage();
    this.save();
    return true;
  }

  /** Which garage mech the Rig screen edits. */
  setEditing(i) {
    const m = this.data.mech;
    if (i < 0 || i >= m.garageSlots) return false;
    m.editing = i;
    this.save();
    return true;
  }

  /** Every part fitted on any garage mech. */
  getWornUids() {
    return new Set(this.data.mech.loadouts.flatMap((lo) => Object.values(lo)).filter(Boolean));
  }

  /** Index of the garage mech wearing `uid`, or -1. */
  wornBy(uid) {
    return this.data.mech.loadouts.findIndex((lo) => Object.values(lo).includes(uid));
  }

  /** The team for a run: part lists of every unlocked mech that has a frame (mech 1 first). */
  getTeamLoadouts() {
    const m = this.data.mech;
    return m.loadouts.slice(0, m.garageSlots)
      .map((lo) => SLOTS.map((s) => this.getOwnedPart(lo[s.id])))
      .filter((parts, i) => i === 0 || parts.some((o) => o && getPart(o.id)?.type === 'frame'));
  }

  getMech() {
    return this.data.mech;
  }

  getOwnedPart(uid) {
    return this.data.mech.owned.find((o) => o.uid === uid) || null;
  }

  /** Parts in the loadout, one per slot (nulls for empty slots). */
  getLoadoutParts(i = this.data.mech.editing) {
    const lo = this.data.mech.loadouts[i] || {};
    return SLOTS.map((s) => this.getOwnedPart(lo[s.id]));
  }

  addTokens(n) {
    this.data.mech.tokens += Math.max(0, n);
    this.save();
  }

  addScrap(n) {
    this.data.mech.scrap += Math.max(0, Math.round(n));
    this.save();
  }

  /**
   * Buy and open a crate (`free`: the daily pod; `pack`: PACK_SIZE at once).
   * Returns the new parts (an array), or null if you can't afford it.
   */
  buyCrate(crateId, { free = false, pack = false } = {}) {
    const m = this.data.mech;
    const crate = CRATES.find((c) => c.id === crateId);
    if (!crate) return null;
    const cost = free ? 0 : pack ? packCost(crate) : crate.cost;
    if (m.tokens < cost || (!free && crate.minRisk && this.bestRiskAnyBall() < crate.minRisk)) return null;
    m.tokens -= cost;
    const got = [];
    for (let i = 0; i < (pack ? PACK_SIZE : 1); i++) {
      const part = openCrate(crateId);
      m.owned.push(part);
      got.push(part);
      m.cratesOpened += 1;
    }
    // Past the cap, the weakest spare parts are salvaged automatically
    while (m.owned.length > INVENTORY_CAP) {
      const worn = this.getWornUids();
      const fresh = new Set(got.map((p) => p.uid));
      const spare = m.owned.filter((o) => !worn.has(o.uid) && !fresh.has(o.uid)).sort((a, b) => salvageValue(a) - salvageValue(b));
      if (!spare[0]) break;
      this.salvagePart(spare[0].uid, false);
    }
    this.save();
    return got;
  }

  /** Put a part in a slot (or take it out if it's already there). */
  equipPart(slotId, uid) {
    const m = this.data.mech;
    const slot = SLOTS.find((s) => s.id === slotId);
    const owned = this.getOwnedPart(uid);
    if (!slot || (uid && (!owned || !slotAccepts(slot, getPart(owned.id))))) return false;
    // `unique` modules fit once per mech
    if (uid && getPart(owned.id).unique && Object.entries(m.loadout).some(([k, u]) => k !== slotId && u && u !== uid && this.getOwnedPart(u)?.id === owned.id)) return false;
    if (slot.id === 'frame' && !uid) return false; // a mech always has a frame
    // Mech 1 always fights, so its frame can't be taken for another mech
    if (m.editing !== 0 && m.loadouts[0].frame === uid) return false;
    // A part can only sit in one slot on one mech
    for (const lo of m.loadouts) for (const k of Object.keys(lo)) if (lo[k] === uid) lo[k] = null;
    m.loadout[slotId] = uid;
    this.save();
    return true;
  }

  unequipSlot(slotId) {
    if (slotId === 'frame' && this.data.mech.editing === 0) return false;
    this.data.mech.loadout[slotId] = null;
    this.save();
    return true;
  }

  salvagePart(uid, save = true) {
    const m = this.data.mech;
    const owned = this.getOwnedPart(uid);
    if (!owned || this.getWornUids().has(uid)) return 0;
    const value = salvageValue(owned);
    m.owned = m.owned.filter((o) => o.uid !== uid);
    m.scrap += value;
    if (save) this.save();
    return value;
  }

  upgradePart(uid) {
    const m = this.data.mech;
    const owned = this.getOwnedPart(uid);
    if (!owned || owned.level >= maxLevel(owned)) return false;
    const cost = upgradeCost(owned);
    if (m.scrap < cost) return false;
    m.scrap -= cost;
    owned.level += 1;
    this.save();
    return true;
  }

  /**
   * The spare parts a transform would melt down: the cheapest unworn parts of
   * the same tier (never the part itself). Returns [] if there aren't enough.
   */
  transformFodder(uid) {
    const owned = this.getOwnedPart(uid);
    const info = owned && transformInfo(owned);
    if (!info) return [];
    const worn = this.getWornUids();
    const pool = this.data.mech.owned
      .filter((o) => o.uid !== uid && !worn.has(o.uid) && tierOf(o) === tierOf(owned))
      .sort((a, b) => salvageValue(a) - salvageValue(b));
    return pool.length >= info.parts ? pool.slice(0, info.parts) : [];
  }

  /** TRANSFORM: a part at max level becomes the next tier at LV 1. Returns true on success. */
  transformPart(uid) {
    const m = this.data.mech;
    const owned = this.getOwnedPart(uid);
    const info = owned && transformInfo(owned);
    if (!info || owned.level < maxLevel(owned) || m.scrap < info.scrap) return false;
    const fodder = this.transformFodder(uid);
    if (fodder.length < info.parts) return false;
    const eat = new Set(fodder.map((o) => o.uid));
    m.owned = m.owned.filter((o) => !eat.has(o.uid));
    m.scrap -= info.scrap;
    owned.tier = info.to;
    owned.level = 1;
    this.save();
    return true;
  }

  reset() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
    this.data = this._load();
    this._ensureMech();
    this._migrate();
  }
}

export const saveSystem = new SaveSystem();