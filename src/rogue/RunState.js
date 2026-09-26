// ============================================================
// RunState — tactical roguelike run state.
// Tracks the player's run-long stats: HP, ATK, DEF, gold,
// boons, node progress, shop discount, and combat history.
// ============================================================

import { CONFIG } from '../config.js';
import { saveSystem } from '../meta/SaveSystem.js';
import { relicStats } from '../meta/Relics.js';
import { getBall } from '../meta/Balls.js';

const RUN = CONFIG.run;

export class RunState {
  constructor(permanentStats = {}, ballType = 'vanguard') {
    // permanentStats: { atkBonus, hpBonus, defBonus } from the tech tree
    this.reset(permanentStats, ballType);
  }

  reset(permanentStats = {}, ballType = 'vanguard') {
    this.permanent = permanentStats;
    this.ballType = ballType;
    this.ball = getBall(ballType);
    this.maxHp = RUN.maxHpBase + (permanentStats.hpBonus || 0) + this.ball.hpBonus;
    this.hp = this.maxHp;
    this.baseAtk = 10 + (permanentStats.baseAtkBonus || 0);
    this.atkMult = 1.0 + (permanentStats.atkBonus || 0);
    this.def = RUN.defBase + (permanentStats.defBonus || 0) + (this.ball.defBonus || 0);
    this.shieldHp = 0; // Overflow Shielding: absorbs damage before HP
    this.gold = CONFIG.currency.startGold + (permanentStats.startGoldBonus || 0);
    this.totalGoldSpent = 0;
    this.maxRestHealed = 0;
    this.boons = []; // array of boon ids
    this.relics = []; // array of relic ids (permanent run-scoped items)
    this.curses = []; // curse ids from Curse Shrines
    this.condition = null; // operation condition id for this run
    this.shopDiscount = 1 - (permanentStats.shopDiscountBonus || 0);
    this.floor = 0;
    this.baseFloorActions = CONFIG.map.baseFloorActions || 5;
    this.floorActions = this.baseFloorActions;
    this.nodeIndex = -1; // current node on the map
    this.currentNode = null;
    this.nodesCompleted = 0;
    this.combatsWon = 0;
    this.combatsLost = 0;
    this.isBossFloor = false;
    this.runOver = false;
    this.runResult = null; // 'victory' | 'defeat' | 'retreat'
    this.history = []; // log of visited nodes for the map UI
  }

  resetFloorActions(bonus = 0) {
    const scouted = this.condition === 'scouted' ? 1 : 0;
    const lost = this.curseCount('curse_lost');
    this.floorActions = Math.max(2, (CONFIG.map.baseFloorActions || 5) + bonus + scouted - lost);
  }

  curseCount(id) {
    return this.curses.filter((c) => c === id).length;
  }

  addCurse(id) {
    this.curses.push(id);
    if (id === 'curse_frail') {
      this.maxHp = Math.max(20, this.maxHp - 15);
      this.hp = Math.min(this.hp, this.maxHp);
    }
  }

  /** Healing multiplier from Risk and curses. */
  get healMult() {
    return saveSystem.getHealingMultiplier() * Math.max(0.2, 1 - 0.2 * this.curseCount('curse_wounds'));
  }

  spendFloorAction() {
    this.floorActions = Math.max(0, this.floorActions - 1);
    return this.floorActions;
  }

  addFloorActions(amount = 1) {
    this.floorActions += amount;
    return this.floorActions;
  }

  get atkBonusPct() {
    return Math.max(0, this.atkMult - 1.0);
  }

  /** Passive bonuses from all owned relics (see meta/Relics.js). */
  get relicBonus() {
    return relicStats(this.relics);
  }

  get atk() {
    let mult = this.atkMult + this.relicBonus.atkPct + (this.ball?.atkPct || 0);
    if (this.permanent?.relicAtkPctPerItem > 0) {
      mult += this.relics.length * this.permanent.relicAtkPctPerItem;
    }
    return (this.baseAtk * mult) / 10;
  }

  get totalDef() {
    let base = this.def + this.relicBonus.def; // tech tree, boons, relics
    if (this.permanent?.relicDefPerItem > 0) {
      base += this.relics.length * this.permanent.relicDefPerItem;
    }
    return Math.round(base * (1 + this.defPctBonus));
  }

  get defPctBonus() {
    return (this.permanent?.defPctBonus || 0) + this.relicBonus.defPct;
  }

  /** Net damage reduction; negative means you take extra damage (e.g. Grizzly Claw). */
  get damageReductionPct() {
    const r = this.relicBonus;
    return Math.max(-0.5, Math.min(0.85, r.dmgRed - r.dmgTaken - (this.ball?.dmgTakenPct || 0)));
  }

  /** Multiplier on maximum launch power (boons + relics). */
  get launchPowerMult() {
    return 1 + (this.getBoonCount('boon_power') + this.getBoonCount('boon_swift')) * 0.15 + this.relicBonus.powerPct + (this.ball?.powerPct || 0);
  }

  get floorProgress() {
    return `${this.floor + 1}/${CONFIG.map.floors}`;
  }

  /** Get count of a specific boon owned. */
  getBoonCount(boonId) {
    return this.boons.filter((id) => id === boonId).length;
  }

  /** Apply a boon by id at run time (supports stacking). */
  applyBoon(boonId) {
    const def = CONFIG.boons.find((b) => b.id === boonId);
    if (!def) return false;
    this.boons.push(boonId);

    switch (boonId) {
      case 'boon_atk':
        this.atkMult += 0.2;
        break;
      case 'boon_def':
        this.def += 4;
        break;
      case 'boon_hp':
        this.maxHp += 40;
        this.hp += 40;
        break;
      case 'boon_greed':
        this.maxHp -= 5;
        if (this.hp > this.maxHp) this.hp = this.maxHp;
        break;
      case 'boon_swift':
        this.atkMult += 0.15;
        break;
      case 'boon_power':
        // handled per stack in combat launch power
        break;
      case 'boon_regen':
        // handled per stack in combat victory
        break;
      default:
        break;
    }
    return true;
  }

  hasBoon(boonId) {
    return this.boons.includes(boonId);
  }

  /** Add a relic to the run. */
  addRelic(relicId) {
    if (!this.relics.includes(relicId)) {
      this.relics.push(relicId);
      // One-time effects on pickup (passive stats come from relicBonus)
      const maxHp = relicStats([relicId]).maxHp;
      if (maxHp) {
        this.maxHp += maxHp;
        this.hp += maxHp;
      }
      if (relicId === 'rel_pawn_ticket') this.gold += 30;
      if (this.permanent?.relicHpPctPerItem > 0) {
        const hpGain = Math.round(RUN.maxHpBase * this.permanent.relicHpPctPerItem);
        this.maxHp += hpGain;
        this.hp += hpGain;
      }
    }
  }

  hasRelic(relicId) {
    return this.relics.includes(relicId);
  }

  /** Shop price for a relic after run discounts, Risk markup and Black-Market Pass. */
  relicPrice(relic) {
    const pass = this.hasRelic('rel_blackmarket_pass') ? 0.8 : 1;
    return Math.round(relic.cost * (this.shopDiscount || 1) * saveSystem.getShopPriceMultiplier() * pass);
  }

  /** Give gold, respecting Greed bonus and Risk Level Gold penalty. */
  gainGold(amount) {
    const greedCount = this.getBoonCount('boon_greed');
    const greedMult = 1 + greedCount * 0.25 + (this.hasRelic('rel_lucky_coin') ? 0.25 : 0) + (this.condition === 'gold_rush' ? 0.3 : 0);
    const riskMult = saveSystem.getGoldMultiplier();
    const gained = Math.round(amount * greedMult * riskMult);
    this.gold += gained;
    return gained;
  }

  /** Spend gold. Returns true if successful. */
  spendGold(cost) {
    if (this.gold < cost) return false;
    this.gold -= cost;
    this.totalGoldSpent = (this.totalGoldSpent || 0) + cost;
    return true;
  }

  /** Discount next shop purchases (stacks multiplicatively). */
  applyShopDiscount() {
    this.shopDiscount *= CONFIG.run.shopDiscountPerVisit;
  }

  /** Heal HP (respects rest cap formula, Risk penalty, and Overflow Shielding). */
  heal(amount, capPct = CONFIG.run.hpRegenMaxPct, techStats = this.permanent || {}) {
    const effective = Math.round(amount * this.healMult);
    const cap = this.maxHp * capPct;
    const targetHp = Math.min(this.maxHp, this.hp + effective, this.hp + cap);

    if (techStats.overflowShieldCapPct > 0 && (this.hp + effective) > this.maxHp) {
      const maxShieldCap = Math.round(this.maxHp * techStats.overflowShieldCapPct);
      const overflow = (this.hp + effective) - this.maxHp;
      this.hp = this.maxHp;
      this.shieldHp = Math.min(maxShieldCap, (this.shieldHp || 0) + overflow);
    } else {
      this.hp = targetHp;
    }
  }

  /** Restore a flat amount up to max HP (respects Risk penalty and Overflow Shielding). */
  healFlat(amount, techStats = this.permanent || {}) {
    const effective = Math.round(amount * this.healMult);
    const before = this.hp;
    if (techStats.overflowShieldCapPct > 0 && (this.hp + effective) > this.maxHp) {
      const maxShieldCap = Math.round(this.maxHp * techStats.overflowShieldCapPct);
      const overflow = (this.hp + effective) - this.maxHp;
      this.hp = this.maxHp;
      this.shieldHp = Math.min(maxShieldCap, (this.shieldHp || 0) + overflow);
    } else {
      this.hp = Math.min(this.maxHp, this.hp + effective);
    }
    return this.hp - before;
  }

  /** Gain max HP (+ heal equal amount by default). */
  addMaxHp(amount) {
    this.maxHp += amount;
    this.hp += amount;
  }

  startBattle() {
    this.isBossFloor = false;
  }

  markBossFloor() {
    this.isBossFloor = true;
  }

  onCombatWon(regenBonus = 0) {
    this.combatsWon += 1;
    const regenCount = this.getBoonCount('boon_regen');
    if (regenCount > 0) {
      this.healFlat(10 * regenCount);
    }
    if (regenBonus) this.healFlat(regenBonus);
  }

  onCombatLost() {
    this.combatsLost += 1;
  }
}