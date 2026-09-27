// ============================================================
// RunState — tactical roguelike run state.
// Tracks the player's run-long stats: HP, ATK, DEF, gold,
// boons, node progress, shop discount, and combat history.
// ============================================================

import { CONFIG } from '../config.js';
import { saveSystem } from '../meta/SaveSystem.js';
import { getBall } from '../meta/Balls.js';

const RUN = CONFIG.run;

export class RunState {
  constructor(permanentStats = {}, ballType = 'operator') {
    // permanentStats: { atkBonus, hpBonus, defBonus, res, mech } from the rig and mastery (Mech.withMech)
    this.reset(permanentStats, ballType);
  }

  reset(permanentStats = {}) {
    this.permanent = permanentStats;
    // One ball since classes were retired: runs saved on an old class continue as the operator
    this.ballType = 'operator';
    const ballType = this.ballType;
    this.ball = getBall(ballType);
    this.maxHp = RUN.maxHpBase + (permanentStats.hpBonus || 0) + this.ball.hpBonus;
    this.hp = this.maxHp;
    this.baseAtk = 10 + (permanentStats.baseAtkBonus || 0);
    this.atkMult = 1.0 + (permanentStats.atkBonus || 0);
    this.def = RUN.defBase + (permanentStats.defBonus || 0) + (this.ball.defBonus || 0);
    this.shieldHp = 0; // absorbs damage before HP
    this.gold = CONFIG.currency.startGold;
    this.totalGoldSpent = 0;
    this.maxRestHealed = 0;
    this.boons = []; // array of boon ids
    this.condition = null; // operation condition id for this run
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
    this.floorActions = Math.max(2, (CONFIG.map.baseFloorActions || 5) + bonus + scouted);
  }

  /** Healing multiplier from Risk. */
  get healMult() {
    return saveSystem.getHealingMultiplier();
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

  get atk() {
    return (this.baseAtk * (this.atkMult + (this.ball?.atkPct || 0))) / 10;
  }

  /** DEF against every damage type (gear, boons, mastery). */
  get totalDef() {
    return Math.round(this.def);
  }

  /** Resist per damage type from armor (Mech.DTYPES), on top of totalDef. */
  get res() {
    return { phys: 0, heat: 0, energy: 0, ...(this.permanent?.res || {}) };
  }

  /** Net damage reduction; negative means you take extra damage. */
  get damageReductionPct() {
    return Math.max(-0.5, Math.min(0.85, -(this.ball?.dmgTakenPct || 0)));
  }

  /** Multiplier on maximum launch power (boons + gear). */
  get launchPowerMult() {
    return 1 + (this.getBoonCount('boon_power') + this.getBoonCount('boon_swift')) * 0.15 + (this.ball?.powerPct || 0) + (this.permanent?.gearPowerPct || 0);
  }

  get floorProgress() {
    return this.floor >= CONFIG.map.floors ? `ABYSS ${this.floor - CONFIG.map.floors + 1}` : `${this.floor + 1}/${CONFIG.map.floors}`;
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

  /** Shop price: deeper floors and the Risk markup cost more. */
  price(base) {
    return Math.round(base * (1 + CONFIG.run.shopFloorMarkup * this.floor) * saveSystem.getShopPriceMultiplier());
  }

  /** Give gold, respecting Greed bonus and Risk Level Gold penalty. */
  gainGold(amount) {
    const greedCount = this.getBoonCount('boon_greed');
    const greedMult = 1 + greedCount * 0.25 + (this.condition === 'gold_rush' ? 0.3 : 0) + (this.permanent?.gearGoldPct || 0);
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

  /** Heal HP (respects the rest cap and the Risk penalty). */
  heal(amount, capPct = CONFIG.run.hpRegenMaxPct) {
    const effective = Math.round(amount * this.healMult);
    const cap = this.maxHp * capPct;
    this.hp = Math.min(this.maxHp, this.hp + effective, this.hp + cap);
  }

  /** Restore a flat amount up to max HP (respects the Risk penalty). Returns HP gained. */
  healFlat(amount) {
    const effective = Math.round(amount * this.healMult);
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + effective);
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