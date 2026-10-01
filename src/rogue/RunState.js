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
    this.baseMaxHp = this.maxHp; // before boons: the team's other mechs get the same boost
    // The rest of the team (garage mechs 2 and 3): { perm, hp }, each with its own HP for the run
    this.team = [];
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

  /** Net damage reduction (mastery VETERAN); negative means you take extra damage. */
  get damageReductionPct() {
    return Math.max(-0.5, Math.min(0.85, (this.permanent?.kineticDampenerPct || 0) - (this.ball?.dmgTakenPct || 0)));
  }

  /** HP a Safe Zone restores before the Risk penalty: a share of max HP (mastery FIELD MEDIC adds to it). */
  get restHeal() {
    return Math.round(this.maxHp * ((CONFIG.run.hpRegenRestPct || 0.5) + (this.permanent?.restHealPct || 0)));
  }

  /** Multiplier on maximum launch power (boons + gear). */
  /** Boons: Swift Loader +1 walk, Long Barrel +1 max range (every team mech). */
  get walkBonus() {
    return this.getBoonCount('boon_swift');
  }

  get reachBonus() {
    return this.getBoonCount('boon_power');
  }

  get floorProgress() {
    return this.floor >= CONFIG.map.floors ? `ABYSS ${this.floor - CONFIG.map.floors + 1}` : `${this.floor + 1}/${CONFIG.map.floors}`;
  }

  /** Get count of a specific boon owned. */
  getBoonCount(boonId) {
    return this.boons.filter((id) => id === boonId).length;
  }

  /** Apply a boon by id at run time. One of each per run: a second copy does nothing. */
  applyBoon(boonId) {
    const def = CONFIG.boons.find((b) => b.id === boonId);
    if (!def || this.boons.includes(boonId)) return false;
    this.boons.push(boonId);

    switch (boonId) {
      case 'boon_atk':
        this.atkMult += 0.1;
        break;
      case 'boon_def':
        this.def += 2;
        break;
      case 'boon_hp':
        this.addMaxHp(400);
        break;
      case 'boon_greed':
        this.maxHp -= 50;
        if (this.hp > this.maxHp) this.hp = this.maxHp;
        break;
      case 'boon_swift':
        this.atkMult += 0.08;
        break;
      case 'boon_glass':
        this.atkMult += 0.2;
        this.maxHp = Math.max(1, this.maxHp - 300);
        if (this.hp > this.maxHp) this.hp = this.maxHp;
        break;
      case 'boon_power':
        // handled per stack in combat launch power
        break;
      case 'boon_regen':
        // handled per stack in combat victory
        break;
      // The rest act in battle (Boons.boonFx, read by Game and LaneAI)
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

  // ---------- The team ----------

  /** Max HP boons and the like add on top of each mech's own. */
  get hpBoost() {
    const base = this.baseMaxHp ?? RUN.maxHpBase + (this.permanent?.hpBonus || 0) + (this.ball?.hpBonus || 0);
    return this.maxHp - base;
  }

  /** Stats of team mech `i` (0 = the lead, the run's own stats). */
  member(i) {
    if (i === 0) return { perm: this.permanent, hp: this.hp, maxHp: this.maxHp, atk: this.atk, def: this.def, totalDef: this.totalDef };
    const m = this.team?.[i - 1];
    if (!m) return null;
    const lead = this.permanent || {};
    const maxHp = Math.max(1, RUN.maxHpBase + (m.perm.hpBonus || 0) + (this.ball?.hpBonus || 0) + this.hpBoost);
    const atkMult = this.atkMult - (lead.atkBonus || 0) + (m.perm.atkBonus || 0);
    const def = this.def - (lead.defBonus || 0) + (m.perm.defBonus || 0);
    return { perm: m.perm, hp: Math.min(m.hp, maxHp), maxHp, atk: (this.baseAtk * (atkMult + (this.ball?.atkPct || 0))) / 10, def, totalDef: Math.round(def) };
  }

  get teamSize() {
    return 1 + (this.team?.length || 0);
  }

  /** Every other team mech's HP changes with the lead's (heals and max HP). */
  _eachReserve(fn) {
    (this.team || []).forEach((m, i) => fn(m, this.member(i + 1).maxHp));
  }

  // Knocked-out mechs (0 HP) stay down: repairs skip them, and only a Safe
  // Zone (healFlat with `revive`) brings them back. The run ends when every
  // mech is down (teamAlive).

  /** Is any mech still standing? */
  get teamAlive() {
    return this.hp > 0 || (this.team || []).some((m) => m.hp > 0);
  }

  /** How many mechs are knocked out right now. */
  get knockedOut() {
    return (this.hp > 0 ? 0 : 1) + (this.team || []).filter((m) => !(m.hp > 0)).length;
  }

  /** Is any mech (standing or down) below its max HP? */
  get teamHurt() {
    return this.hp < this.maxHp || (this.team || []).some((m, i) => m.hp < this.member(i + 1).maxHp);
  }

  /** Heal HP (respects the rest cap and the Risk penalty). Standing mechs only. */
  heal(amount, capPct = CONFIG.run.hpRegenMaxPct) {
    const effective = Math.round(amount * this.healMult);
    const cap = this.maxHp * capPct;
    if (this.hp > 0) this.hp = Math.min(this.maxHp, this.hp + effective, this.hp + cap);
    this._eachReserve((m, max) => m.hp > 0 && (m.hp = Math.min(max, m.hp + effective, m.hp + max * capPct)));
  }

  /**
   * Restore a flat amount up to max HP (respects the Risk penalty) for every
   * standing mech; `revive` (Safe Zones) brings knocked-out ones back too.
   * Returns the HP the front mech gained (the lead, or the first one standing).
   */
  healFlat(amount, { revive = false } = {}) {
    const effective = Math.round(amount * this.healMult);
    const up = (hp, max) => (hp > 0 || revive ? Math.min(max, Math.max(0, hp) + effective) : hp);
    const gains = [];
    const before = this.hp;
    this.hp = up(this.hp, this.maxHp);
    gains.push([before > 0 || revive, this.hp - before]);
    this._eachReserve((m, max) => {
      const b = m.hp;
      m.hp = up(m.hp, max);
      gains.push([b > 0 || revive, m.hp - b]);
    });
    return (gains.find(([alive]) => alive) || [true, 0])[1];
  }

  /** Full repair for every standing mech. */
  healFull() {
    if (this.hp > 0) this.hp = this.maxHp;
    this._eachReserve((m, max) => m.hp > 0 && (m.hp = max));
  }

  /** Gain max HP (+ heal equal amount by default), every mech; knocked-out ones stay down. */
  addMaxHp(amount) {
    this.maxHp += amount;
    if (this.hp > 0) this.hp += amount;
    this._eachReserve((m) => m.hp > 0 && (m.hp += amount));
  }

  startBattle() {
    this.isBossFloor = false;
  }

  markBossFloor() {
    this.isBossFloor = true;
  }

  /** Keys won this run: saved at once (kept even if the run is lost) and counted for the HUD. */
  earnKeys(n) {
    if (!(n > 0)) return 0;
    saveSystem.addTokens(n);
    this.tokensEarned = (this.tokensEarned || 0) + n;
    return n;
  }

  /** Scrap won this run: saved at once and counted for the HUD. */
  earnScrap(n) {
    if (!(n > 0)) return 0;
    saveSystem.addScrap(n);
    this.scrapEarned = (this.scrapEarned || 0) + n;
    return n;
  }

  onCombatWon(regenBonus = 0) {
    this.combatsWon += 1;
    const regenCount = this.getBoonCount('boon_regen');
    if (regenCount > 0) {
      this.healFlat(Math.round(this.maxHp * 0.06 * regenCount));
    }
    if (regenBonus) this.healFlat(regenBonus);
  }

  onCombatLost() {
    this.combatsLost += 1;
  }
}