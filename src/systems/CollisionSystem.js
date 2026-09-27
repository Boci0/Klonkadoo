// ============================================================
// CollisionSystem — turns ball-vs-ball contacts into rams (EXPOSED)
// and works out how much of an incoming hit reaches you (DEF + the
// resist for its damage type, damage reduction, Risk). Bodies
// themselves never deal damage.
// ============================================================

import { CONFIG } from '../config.js';

const D = CONFIG.damage;

export class CollisionSystem {
  constructor(events) {
    this.events = events;
    this.stats = {
      playerAtk: 1,
      playerDef: 0,
    };
  }

  setStats(stats) {
    this.stats = { ...this.stats, ...stats };
  }

  process(collisionEvents, balls) {
    for (const evt of collisionEvents) {
      if (evt.type === 'ball') this.handleBallHit(evt);
    }
  }

  /**
   * Bodies deal no damage. A hard ram leaves the target EXPOSED: it takes
   * extra gun damage until its own next turn (Game._weaponHit).
   */
  handleBallHit(evt) {
    const { a, b, speedAPre, speedBPre } = evt;
    const attacker = speedAPre >= speedBPre ? a : b;
    const victim = attacker === a ? b : a;
    const ramSpeed = Math.max(speedAPre, speedBPre);
    if (attacker.team === victim.team || victim.hp <= 0 || victim.exposed) return;
    if (ramSpeed < CONFIG.gear.ramSpeed || attacker.hitCooldown > 0) return;
    victim.exposed = true;
    attacker.hitCooldown = D.hitCooldown;
    this.events.emit('proc', { ball: victim, text: 'EXPOSED', color: '#ffcd75' });
    this.events.emit('ram', { attacker, victim });
  }

  /** `dtype`: phys / heat / energy (Mech.DTYPES); its resist adds to DEF. */
  calculatePlayerDamage(rawDamage, { bypassDef = false, dtype = 'phys' } = {}) {
    let damage = rawDamage;

    // 1. Flat DEF + resist reduction (unless bypassing it, e.g. status DOTs, pierce)
    if (!bypassDef) {
      const def = (this.stats.playerTotalDef || this.stats.playerDef || 0) + (this.stats.playerRes?.[dtype] || 0);
      // Enemies pierce 25% DEF; only the first 12 DEF blocks flat damage
      // (so stacked armor can't erase hits), and Risk XI pierces half
      const effectiveDef = Math.min(12, def) * 0.75 * (1 - (this.stats.riskDefPierce || 0));
      const maxDefReduction = damage * 0.70; // 30% min damage floor
      const actualDefReduction = Math.min(maxDefReduction, effectiveDef);
      damage = Math.max(damage * 0.30, damage - actualDefReduction);
    }

    // 2. Percentage damage reduction
    const redPct = Math.max(-0.5, Math.min(0.85, this.stats.playerDamageReductionPct || 0)); // negative = extra damage taken
    damage = Math.max(1, Math.round(damage * (1 - redPct)));

    // 3. Risk Modifier (+X% DMG TAKEN)
    if (this.stats.riskPlusDmgTaken > 0) {
      damage = Math.max(1, Math.round(damage * (1 + this.stats.riskPlusDmgTaken / 100)));
    }

    return Math.max(1, damage);
  }
}
