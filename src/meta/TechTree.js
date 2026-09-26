// ============================================================
// TechTree — permanent upgrades across four branching trees.
// Nodes are bought with Tech Points earned from quests and
// roguelike runs. Purchases persist in SaveSystem.
// ============================================================

import { CONFIG } from '../config.js';

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
    return node.costs[lvl] ?? node.costs[node.costs.length - 1];
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
   * Compute permanent stat bonuses and feature flags from all purchased nodes.
   */
  getPermanentStats() {
    const sharpshooterLvl = this.getNodeLevel('atk_sharpshooter');
    const basePowerLvl = this.getNodeLevel('atk_base_power');
    const armorPenLvl = this.getNodeLevel('atk_armor_pen');
    const riskResonanceLvl = this.getNodeLevel('atk_risk_resonance');
    const ballisticApexLvl = this.getNodeLevel('atk_ballistic_apex');

    const vitLvl = this.getNodeLevel('vit_health');
    const overflowLvl = this.getNodeLevel('vit_overflow_shield');
    const medkitLvl = this.getNodeLevel('vit_emergency_medkit');
    const titanLvl = this.getNodeLevel('vit_titan_core');
    const vampLvl = this.getNodeLevel('vit_vampiric_vitality');

    const aegisLvl = this.getNodeLevel('def_aegis');
    const matrixPctLvl = this.getNodeLevel('def_matrix_pct');
    const thornsLvl = this.getNodeLevel('def_thorns_resist');
    const forcefieldLvl = this.getNodeLevel('def_forcefield');
    const fortifiedLvl = this.getNodeLevel('def_fortified_matrix');
    const dampenerLvl = this.getNodeLevel('def_kinetic_dampener');

    const warChestLvl = this.getNodeLevel('tac_war_chest');
    const merchantLvl = this.getNodeLevel('tac_merchant');
    const logisticsLvl = this.getNodeLevel('tac_logistics');
    const intellectLvl = this.getNodeLevel('tac_intellect');
    const relicLvl = this.getNodeLevel('tac_relic_synergy');

    const critLvl = this.getNodeLevel('atk_crit');
    const secondWindLvl = this.getNodeLevel('vit_second_wind');
    const counterLvl = this.getNodeLevel('def_counter');
    const supplyLvl = this.getNodeLevel('tac_supply_drop');

    return {
      // Tuned so a maxed branch is strong but not game-breaking; ATK nodes
      // multiply together, so each one is kept modest.
      atkBonus: sharpshooterLvl * 0.03,
      baseAtkBonus: basePowerLvl * 0.25,
      armorPenPct: armorPenLvl * 0.08,
      riskResonanceBonusPerLevel: riskResonanceLvl * 0.005,
      ballisticApexMaxPct: ballisticApexLvl * 0.02,

      hpBonus: vitLvl * 10,
      overflowShieldCapPct: overflowLvl * 0.05,
      emergencyMedkitHeal: medkitLvl * 5,
      titanCoreHealBonusPct: titanLvl * 0.05,
      titanCoreMaxHpBonus: titanLvl * 2,
      vampiricVitalityPct: vampLvl * 0.015,

      defBonus: aegisLvl * 1,
      defPctBonus: matrixPctLvl * 0.03,
      thornsResistPct: thornsLvl * 0.08,
      forcefieldTurnInterval: forcefieldLvl > 0 ? Math.max(5, 14 - forcefieldLvl) : 0,
      fortifiedMatrixBonusDef: fortifiedLvl * 0.5,
      kineticDampenerPct: dampenerLvl * 0.02,

      startGoldBonus: warChestLvl * 8,
      shopDiscountBonus: merchantLvl * 0.02,
      rerollDiscountBonus: merchantLvl * 0.05,
      cdReductionTurns: logisticsLvl * 0.2,
      tpBonusPct: intellectLvl * 0.03, // applied to battle TP rewards (main.js)
      relicAtkPctPerItem: relicLvl * 0.002,
      relicHpPctPerItem: relicLvl * 0.002,
      relicDefPerItem: relicLvl * 0.03,

      // Capstones
      critChance: critLvl * 0.06,
      secondWindPct: secondWindLvl > 0 ? 0.2 + (secondWindLvl - 1) * 0.15 : 0,
      counterPct: counterLvl > 0 ? 0.15 + (counterLvl - 1) * 0.1 : 0,
      supplyDropRelics: supplyLvl,

      // Backwards-compatible feature flags
      hasArmorPen: armorPenLvl > 0,
      hasRiskResonance: riskResonanceLvl > 0,
      hasBallisticApex: ballisticApexLvl > 0,

      hasOverflowShield: overflowLvl > 0,
      hasEmergencyMedkit: medkitLvl > 0,
      hasTitanCore: titanLvl > 0,
      hasVampiricVitality: vampLvl > 0,

      hasForcefield: forcefieldLvl > 0,
      hasFortifiedMatrix: fortifiedLvl > 0,
      hasKineticDampener: dampenerLvl > 0,

      hasMerchant: merchantLvl > 0,
      hasLogistics: logisticsLvl > 0,
      hasIntellect: intellectLvl > 0,
      hasRelicSynergy: relicLvl > 0,
    };
  }

  /** Total spent Tech Points across all purchased nodes (for HUD). */
  getTotalSpent() {
    let total = 0;
    for (const node of this.getAllNodes()) {
      const lvl = this.getNodeLevel(node.id);
      for (let i = 0; i < lvl; i++) {
        total += node.costs[i] || 0;
      }
    }
    return total;
  }
}