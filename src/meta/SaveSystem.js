// ============================================================
// SaveSystem — persistence foundation for permanent upgrades,
// tech trees, and roguelike meta-progression.
//
// Stores data in localStorage. Old saves are migrated by merging
// defaults so missing fields (techPoints, techTreePurchases, etc.)
// never cause runtime errors.
// ============================================================

import { CONFIG } from '../config.js';
import { masteryLevel } from './Mastery.js';
import { INVENTORY_CAP, salvageValue, upgradeCost, MAX_LEVEL, STARTER_PARTS, STARTER_LOADOUT, SLOTS, getPart, newUid, openCrate, CRATES } from './Mech.js';

const STORAGE_KEY = 'slingshot-save-v1';

export class SaveSystem {
  constructor() {
    this.data = this._load();
    this._ensureMech();
    this._migrate();
  }

  /**
   * One-off upgrades for older saves:
   *  - techVersion 2: the tech tree was rebuilt around skills, so every TP
   *    spent on the old tree is refunded and purchases are cleared.
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
    d.selectedBall = d.selectedBall || 'vanguard';
    this.save();
  }

  _defaults() {
    return {
      version: 2,
      techVersion: 2, // fresh saves start on the skill tree (see _migrate)
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
      techPoints: 0, // currency earned from quests/roguelike runs
      difficultyLevel: 0, // selected Risk level (0..maxRiskUnlocked)
      maxRiskUnlocked: 0, // highest Risk level the player may select
      techTreePurchases: {}, // nodeId -> level purchased (1)
      upgrades: {}, // legacy field kept for compatibility
      unlockedPerks: [], // roguelike perk ids
      techTree: {}, // legacy: placeholder
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
          techTreePurchases: (typeof parsed.techPoints === 'number' ? parsed : {})?.techTreePurchases || {},
          upgrades: parsed.upgrades || {},
          unlockedPerks: parsed.unlockedPerks || [],
          techTree: parsed.techTree || {},
          progression: { ...defaults.progression, ...(parsed.progression || {}) },
          techVersion: parsed.techVersion || 1, // old saves get the tree refund
        };
      }
    } catch (e) {
      console.warn('Failed to load save data:', e);
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

  addTechPoints(amount) {
    this.data.techPoints += amount;
    this.save();
  }

  spendTechPoints(amount) {
    if (this.data.techPoints < amount) return false;
    this.data.techPoints -= amount;
    this.save();
    return true;
  }

  getTechLevel(nodeId) {
    const val = (this.data.techTreePurchases || {})[nodeId];
    if (val === true) return 1;
    if (typeof val === 'number') return val;
    return 0;
  }

  purchaseTechNode(nodeId) {
    const current = this.getTechLevel(nodeId);
    this.data.techTreePurchases[nodeId] = current + 1;
    this.save();
    return current + 1;
  }

  hasTechNode(nodeId) {
    return this.getTechLevel(nodeId) > 0;
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
    return { runs: 0, wins: 0, bestFloor: 0, kills: 0, bossKills: 0, hits: 0, crits: 0, trickShots: 0, bestHit: 0, maxCombo: 0, maxRelics: 0, bestRiskWin: -1, ...(this.data.lifetime || {}) };
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

  awardMedal(id, tp) {
    this.data.medals = this.data.medals || {};
    if (this.data.medals[id]) return false;
    this.data.medals[id] = Date.now();
    this.data.techPoints += tp;
    this.save();
    return true;
  }

  // ---------- Daily supply drop (login streak) ----------

  static _dayKey(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** { canClaim, streak (after claiming today), reward } */
  getDailyStatus() {
    const daily = this.data.daily || { last: null, streak: 0 };
    const today = SaveSystem._dayKey();
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const continues = daily.last === SaveSystem._dayKey(y);
    const canClaim = daily.last !== today;
    const streak = canClaim ? (continues ? daily.streak + 1 : 1) : daily.streak;
    return { canClaim, streak, reward: 2 + Math.min(7, streak) };
  }

  claimDaily() {
    const status = this.getDailyStatus();
    if (!status.canClaim) return null;
    this.data.daily = { last: SaveSystem._dayKey(), streak: status.streak };
    this.data.techPoints += status.reward;
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
    return this.data.selectedBall || 'vanguard';
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
    const total = { hpPct: 0, atkPct: 0, defPct: 0, aiBonus: 0, minusGold: 0, minusHeal: 0, plusCost: 0, plusDmgTaken: 0, eliteHpPct: 0, eliteAtkPct: 0 };
    for (const rule of this.riskLevels().slice(0, level)) {
      for (const key of Object.keys(total)) total[key] += rule[key] || 0;
      if (rule.allElite) total.allElite = true;
      if (rule.gunCdCut) total.gunCdCut = (total.gunCdCut || 0) + rule.gunCdCut;
      if (rule.defPierce) total.defPierce = (total.defPierce || 0) + rule.defPierce;
    }
    return total;
  }

  /** Tech Point multiplier from the selected Risk level. */
  getTpMultiplier() {
    return 1 + (this.getDifficultyLevel() * CONFIG.risk.tpPerLevel) / 100;
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
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
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
      if (typeof parsed.techPoints !== 'number' || !parsed.meta || typeof parsed.meta !== 'object') return false;
      const defaults = this._defaults();
      this.data = {
        ...defaults,
        ...parsed,
        profile: { ...defaults.profile, ...(parsed.profile || {}) },
        meta: { ...defaults.meta, ...(parsed.meta || {}) },
        techTreePurchases: parsed.techTreePurchases || {},
        upgrades: parsed.upgrades || {},
        unlockedPerks: parsed.unlockedPerks || [],
        techTree: parsed.techTree || {},
        progression: { ...defaults.progression, ...(parsed.progression || {}) },
        techVersion: parsed.techVersion || 1,
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
    if (this.data.mech) return;
    const oldGear = this.data.gear;
    const legacyScrap = (oldGear?.scrap || 0) + (oldGear?.items || []).reduce((sum, it) => {
      const base = { common: 2, rare: 5, epic: 12, legendary: 30 }[it.rarity] || 2;
      return sum + Math.round(base * (1 + ((it.level || 1) - 1) * 0.25));
    }, 0);
    const owned = STARTER_PARTS.map((id) => ({ uid: newUid(), id, level: 1 }));
    const loadout = {};
    for (const slot of SLOTS) {
      const want = STARTER_LOADOUT[slot.id];
      loadout[slot.id] = want ? owned.find((o) => o.id === want)?.uid || null : null;
    }
    this.data.mech = { owned, loadout, scrap: legacyScrap, tokens: 0, cratesOpened: 0 };
    delete this.data.gear;
    this.save();
  }

  getMech() {
    return this.data.mech;
  }

  getOwnedPart(uid) {
    return this.data.mech.owned.find((o) => o.uid === uid) || null;
  }

  /** Parts in the loadout, one per slot (nulls for empty slots). */
  getLoadoutParts() {
    const m = this.data.mech;
    return SLOTS.map((s) => this.getOwnedPart(m.loadout[s.id]));
  }

  addTokens(n) {
    this.data.mech.tokens += Math.max(0, n);
    this.save();
  }

  /** Buy and open a crate. Returns the new part, or null if you can't afford it. */
  buyCrate(crateId) {
    const m = this.data.mech;
    const crate = CRATES.find((c) => c.id === crateId);
    if (!crate || m.tokens < crate.cost || (crate.minRisk && this.bestRiskAnyBall() < crate.minRisk)) return null;
    m.tokens -= crate.cost;
    const part = openCrate(crateId);
    m.owned.push(part);
    m.cratesOpened += 1;
    // Past the cap, the weakest spare part is salvaged automatically
    if (m.owned.length > INVENTORY_CAP) {
      const worn = new Set(Object.values(m.loadout));
      const spare = m.owned.filter((o) => !worn.has(o.uid) && o.uid !== part.uid).sort((a, b) => salvageValue(a) - salvageValue(b));
      if (spare[0]) this.salvagePart(spare[0].uid, false);
    }
    this.save();
    return part;
  }

  /** Put a part in a slot (or take it out if it's already there). */
  equipPart(slotId, uid) {
    const m = this.data.mech;
    const slot = SLOTS.find((s) => s.id === slotId);
    const owned = this.getOwnedPart(uid);
    if (!slot || (uid && (!owned || getPart(owned.id).type !== slot.type))) return false;
    if (slot.id === 'frame' && !uid) return false; // a mech always has a frame
    // A part can only sit in one slot
    for (const k of Object.keys(m.loadout)) if (m.loadout[k] === uid) m.loadout[k] = null;
    m.loadout[slotId] = uid;
    this.save();
    return true;
  }

  unequipSlot(slotId) {
    if (slotId === 'frame') return false;
    this.data.mech.loadout[slotId] = null;
    this.save();
    return true;
  }

  salvagePart(uid, save = true) {
    const m = this.data.mech;
    const owned = this.getOwnedPart(uid);
    if (!owned || Object.values(m.loadout).includes(uid)) return 0;
    const value = salvageValue(owned);
    m.owned = m.owned.filter((o) => o.uid !== uid);
    m.scrap += value;
    if (save) this.save();
    return value;
  }

  upgradePart(uid) {
    const m = this.data.mech;
    const owned = this.getOwnedPart(uid);
    if (!owned || owned.level >= MAX_LEVEL) return false;
    const cost = upgradeCost(owned);
    if (m.scrap < cost) return false;
    m.scrap -= cost;
    owned.level += 1;
    this.save();
    return true;
  }

  reset() {
    localStorage.removeItem(STORAGE_KEY);
    this.data = this._load();
    this._ensureMech();
    this._migrate();
  }
}

export const saveSystem = new SaveSystem();