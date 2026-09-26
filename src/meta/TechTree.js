// ============================================================
// TechTree — permanent upgrades across four branching trees.
// Nodes are bought with Tech Points earned from quests and
// roguelike runs. Purchases persist in SaveSystem.
// ============================================================

import { CONFIG } from '../config.js';

const rankCost = (node, i) => node.costs[i] ?? node.costs[node.costs.length - 1] ?? 0;

export class TechTree {
  constructor(saveSystem) {
    this.saveSystem = saveSystem;
    this.nodes = CONFIG.techTree;
  }

  getAllNodes() {
    return Object.values(this.nodes);
  }

  getNodeLevel(nodeId) {
    return this.saveSystem.getTechLevel(nodeId);
  }

  isPurchased(nodeId) {
    return this.getNodeLevel(nodeId) > 0;
  }

  isMaxed(nodeId) {
    const node = this.nodes[nodeId];
    if (!node) return true;
    return this.getNodeLevel(nodeId) >= (node.maxLevel || 1);
  }

  getNodeNextCost(nodeId) {
    const node = this.nodes[nodeId];
    if (!node || this.isMaxed(nodeId)) return 0;
    const lvl = this.getNodeLevel(nodeId);
    return rankCost(node, lvl);
  }

  /** Prerequisite node ids (all need at least one rank). */
  getRequirements(nodeId) {
    const req = this.nodes[nodeId]?.requires;
    if (!req) return [];
    return Array.isArray(req) ? req : [req];
  }

  isUnlocked(nodeId) {
    if (!this.nodes[nodeId]) return false;
    return this.getRequirements(nodeId).every((id) => this.isPurchased(id));
  }

  canPurchase(nodeId) {
    const node = this.nodes[nodeId];
    if (!node || this.isMaxed(nodeId)) return false;
    if (!this.isUnlocked(nodeId)) return false;
    const cost = this.getNodeNextCost(nodeId);
    return this.saveSystem.data.techPoints >= cost;
  }

  purchase(nodeId) {
    if (!this.canPurchase(nodeId)) return false;
    const cost = this.getNodeNextCost(nodeId);
    if (!this.saveSystem.spendTechPoints(cost)) return false;
    this.saveSystem.purchaseTechNode(nodeId);
    return true;
  }

  /**
   * Skill / mechanic effects from purchased nodes. Raw stat keys (hpBonus,
   * atkBonus, critChance, defBonus...) stay at 0 here: Rig gear and ball
   * mastery add to them (see Mech.withMech, Mastery.withMastery).
   */
  getPermanentStats() {
    const L = (id) => this.getNodeLevel(id);
    const forcefield = L('def_forcefield');
    const secondWind = L('vit_second_wind');
    return {
      // Stats: filled in by gear and mastery
      atkBonus: 0,
      baseAtkBonus: 0,
      critChance: 0,
      hpBonus: 0,
      defBonus: 0,

      // REACTOR (gun energy / heat)
      rigEnergy: L('rct_capacitor') * 4,
      rigRegen: L('rct_dynamo') * 2,
      rigCool: L('rct_coolant') * 3,
      freeFirstShot: L('rct_opener') > 0,
      killEnergy: L('rct_scavenge') * 10,
      overclock: L('rct_overclock') > 0,

      // BARRIER
      barrierHpPct: L('bar_reinforce') * 0.25,
      barrierCdCut: L('bar_quick'),
      barrierSpikeDmg: L('bar_spikes') * 6,
      barrierExtra: L('bar_twin'),
      bulwarkPct: L('bar_bulwark') * 0.06,
      barrierForcefield: L('bar_aegis') > 0,

      // SURVIVAL
      emergencyMedkitHeal: L('vit_emergency_medkit') * 10,
      overflowShieldCapPct: L('vit_overflow_shield') * 0.1,
      forcefieldTurnInterval: forcefield > 0 ? 11 - forcefield : 0,
      vampiricVitalityPct: L('vit_vampiric_vitality') * 0.02,
      counterPct: L('def_counter') * 0.1,
      secondWindPct: secondWind > 0 ? 0.2 + (secondWind - 1) * 0.15 : 0,

      // TACTICS
      startGoldBonus: L('tac_war_chest') * 10,
      shopDiscountBonus: L('tac_merchant') * 0.03,
      rerollDiscountBonus: L('tac_merchant') * 0.08,
      extraMoves: L('tac_scout'),
      tpBonusPct: L('tac_intellect') * 0.05, // applied to battle TP rewards (main.js)
      keyBonus: L('tac_keymaster'),
      supplyDropRelics: L('tac_supply_drop'),

      // Feature flags other systems check
      hasForcefield: forcefield > 0,
      hasOverflowShield: L('vit_overflow_shield') > 0,
      hasEmergencyMedkit: L('vit_emergency_medkit') > 0,
      hasVampiricVitality: L('vit_vampiric_vitality') > 0,
    };
  }

  /** Total spent Tech Points across all purchased nodes (for HUD). */
  getTotalSpent() {
    let total = 0;
    for (const node of this.getAllNodes()) {
      const lvl = this.getNodeLevel(node.id);
      for (let i = 0; i < lvl; i++) {
        total += rankCost(node, i);
      }
    }
    return total;
  }
}