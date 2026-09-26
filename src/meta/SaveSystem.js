// ============================================================
// SaveSystem — persistence foundation for permanent upgrades,
// tech trees, and roguelike meta-progression.
//
// Stores data in localStorage. Old saves are migrated by merging
// defaults so missing fields (techPoints, techTreePurchases, etc.)
// never cause runtime errors.
// ============================================================

import { CONFIG } from '../config.js';

const STORAGE_KEY = 'slingshot-save-v1';

export class SaveSystem {
  constructor() {
    this.data = this._load();
  }

  _defaults() {
    return {
      version: 2,
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
    return { runs: 0, wins: 0, bestFloor: 0, ...((this.data.ballStats || {})[id] || {}) };
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

  getMaxRiskUnlocked() {
    return Math.max(0, Math.min(CONFIG.risk.levels.length, this.data.maxRiskUnlocked || 0));
  }

  getDifficultyLevel() {
    return Math.max(0, Math.min(this.getMaxRiskUnlocked(), this.data.difficultyLevel || 0));
  }

  setDifficultyLevel(level) {
    this.data.difficultyLevel = Math.max(0, Math.min(this.getMaxRiskUnlocked(), Math.floor(level)));
    this.save();
  }

  /**
   * Winning a run on the highest unlocked Risk unlocks the next one.
   * @returns {number|null} the newly unlocked level, if any
   */
  recordRiskWin(level) {
    const max = this.getMaxRiskUnlocked();
    if (level < max || max >= CONFIG.risk.levels.length) return null;
    this.data.maxRiskUnlocked = max + 1;
    this.save();
    return max + 1;
  }

  /** Combined effect of Risk levels 1..level (rules stack). */
  getRiskData(level = this.getDifficultyLevel()) {
    const total = { hpPct: 0, atkPct: 0, defPct: 0, aiBonus: 0, minusGold: 0, minusHeal: 0, plusCost: 0, plusDmgTaken: 0, eliteHpPct: 0, eliteAtkPct: 0 };
    for (const rule of CONFIG.risk.levels.slice(0, level)) {
      for (const key of Object.keys(total)) total[key] += rule[key] || 0;
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
      };
      this.save();
      return true;
    } catch (e) {
      console.warn('Failed to import save data:', e);
      return false;
    }
  }

  reset() {
    localStorage.removeItem(STORAGE_KEY);
    this.data = this._load();
  }
}

export const saveSystem = new SaveSystem();