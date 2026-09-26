// ============================================================
// CollisionSystem — processes physics collision events and
// translates them into game-level damage, status effects, and
// elemental relic triggers (Singularity pull, Thermal burn, Cryo slow).
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
      if (evt.type === 'ball') {
        this.handleBallHit(evt, balls);
      }
    }
  }

  handleBallHit(evt, allBalls) {
    const { a, b, impactSpeed, speedAPre, speedBPre } = evt;

    if (impactSpeed < D.minImpactSpeed) return;

    let baseDamage = Math.min(D.maxDamagePerHit, impactSpeed * D.damagePerSpeed);
    if (baseDamage <= 0) return;

    const attacker = speedAPre >= speedBPre ? a : b;
    if (attacker.hitCooldown > 0 && !evt.pierce) return;
    const victim = attacker === a ? b : a;
    // Gear combat: bodies deal no damage. A hard ram leaves the target
    // EXPOSED (it takes extra gun damage until its own next turn).
    if (this.stats.gear) {
      const ramSpeed = Math.max(speedAPre, speedBPre);
      if (attacker.team !== victim.team && victim.hp > 0 && ramSpeed >= CONFIG.gear.ramSpeed && !victim.exposed) {
        victim.exposed = true;
        attacker.hitCooldown = D.hitCooldown;
        this.events.emit('proc', { ball: victim, text: 'EXPOSED', color: '#ffcd75' });
        this.events.emit('ram', { attacker, victim });
      }
      return;
    }

    const attackerVy = attacker === a ? evt.aVyPre : evt.bVyPre;
    const extra = {}; // crit / combo / dive info for the hit feedback

    const attackerAtk = attacker.team === 'player' ? this.stats.playerAtk : attacker.atk ?? 1;
    let victimDef = victim.team === 'player' ? (this.stats.playerTotalDef || this.stats.playerDef || 0) : victim.def ?? 0;
    let victimDmgReductionPct = victim.team === 'player' ? (this.stats.playerDamageReductionPct || 0) : 0;

    if (attacker.team === 'player' && this.stats.techStats?.armorPenPct > 0 && victim.team === 'enemy') {
      const penPct = Math.min(0.9, this.stats.techStats.armorPenPct);
      victimDef = Math.round(victimDef * (1 - penPct));
    }

    const base = speedAPre >= speedBPre ? speedAPre : speedBPre;
    baseDamage = Math.min(D.maxDamagePerHit, base * D.damagePerSpeed) * attackerAtk;

    if (attacker.team === 'player') {
      const bs = this.stats.battleStats;
      const rels = this.stats.relics || [];
      const tech = this.stats.techStats || {};

      if (tech.riskResonanceBonusPerLevel > 0 && this.stats.riskLevel > 0) {
        const riskBonus = 1 + this.stats.riskLevel * tech.riskResonanceBonusPerLevel;
        baseDamage *= riskBonus;
      }

      if (attacker.ballType === 'juggernaut') {
        baseDamage *= 1.4;
      }

      // Graviton: hits while falling land harder
      if (attacker.ballType === 'graviton' && victim.team === 'enemy' && attackerVy > 150) {
        baseDamage *= 1.3;
        extra.dive = true;
      }

      // Skill shots (Railgun pierce, Zero-G) carry a flat bonus for the whole flight
      if (attacker.shotMult) baseDamage *= attacker.shotMult;
      if (evt.pierce) extra.pierce = true;

      // Combo: every extra enemy hit in the same shot hits 15% harder
      if (bs && victim.team === 'enemy') {
        bs.shotHits = (bs.shotHits || 0) + 1;
        extra.combo = bs.shotHits;
        if (bs.shotHits > 1) baseDamage *= 1 + 0.15 * (bs.shotHits - 1);
      }

      // Critical hits: 5% base, Striker +10%, Critical Mass perk
      const critChance = 0.05 + (attacker.ballType === 'striker' ? 0.1 : 0) + (tech.critChance || 0);
      if (victim.team === 'enemy' && Math.random() < critChance) {
        baseDamage *= 1.75;
        extra.crit = true;
      }

      // Ballistic Apex: scales from 600 px/s up to its full bonus at 1300 px/s
      if (tech.ballisticApexMaxPct > 0) {
        baseDamage *= 1 + Math.max(0, Math.min(1, (base - 600) / 700)) * tech.ballisticApexMaxPct;
      }

      const stacks = (bs && bs.overdriveStacks) ? bs.overdriveStacks : (bs && bs.overdriveActive ? 1 : 0);
      if (stacks > 0) {
        const raw = rels.includes('rel_energy_well') || bs.overdriveEmpowered ? 2.0 : CONFIG.abilities.overdrive.damageMult;
        const baseMult = 1 + (raw - 1) * (1 + (tech.skillPotency || 0));
        const totalMult = baseMult + (stacks - 1) * 0.5;
        baseDamage *= totalMult;
        if (bs.overdriveStacks && bs.overdriveStacks > 0) {
          bs.overdriveStacks -= 1;
        }
        if (!bs.overdriveStacks || bs.overdriveStacks <= 0) {
          bs.overdriveActive = false;
        }
      }

      if (rels.includes('rel_knight_lance') && bs && !bs.lanceUsed) {
        baseDamage *= 1.35;
        bs.lanceUsed = true;
      }

      if (rels.includes('rel_gladiator_glove') && victim.hp >= victim.maxHp * 0.75) {
        baseDamage *= 1.25;
      }

      if (rels.includes('rel_blood_sample') && attacker.hp < attacker.maxHp * 0.5) {
        baseDamage *= 1.25;
      }

      if (rels.includes('rel_combat_drug') && attacker.hp < attacker.maxHp * 0.3) {
        baseDamage *= 1.5;
      }

      if (rels.includes('rel_radiant_crest') && bs && bs.wallBounced) {
        baseDamage *= 1.35;
      }


      if (rels.includes('rel_vector_engine') && bs && bs.lastLaunchPct >= 0.9) {
        baseDamage *= 1.25;
      }

      if (rels.includes('rel_echo') && bs && !bs.echoUsed) {
        baseDamage += 15;
        bs.echoUsed = true;
        this.events.emit('proc', { ball: victim, text: 'ECHO +15', color: '#ffcd75' });
      }

      // Elemental Relic: Thermal Engine (Ignites target with 3 turns of Thermal Burn DOT)
      if (rels.includes('rel_pyro')) {
        victim.burnTicks = 3;
        victim.burnDmg = 6;
        this.events.emit('proc', { ball: victim, text: 'BURN', color: '#ef7d57' });
      }

      // Elemental Relic: Cryo Coil (Freezes target, slows next turn launch)
      if (rels.includes('rel_cryo')) {
        victim.isFrozen = true;
        this.events.emit('proc', { ball: victim, text: 'FROZEN', color: '#73eff7' });
      }

      // Singularity Core: nearby enemies slide in next to the one you hit
      if (rels.includes('rel_graviton') && allBalls) {
        let pulled = false;
        for (const ball of allBalls) {
          if (ball === victim || ball.team !== 'enemy' || ball.hp <= 0) continue;
          const dx = victim.x - ball.x;
          if (Math.abs(dx) > 360) continue;
          const gap = victim.radius + ball.radius + 6;
          ball.pullTo = { x: victim.x - Math.sign(dx || 1) * gap, speed: 900, time: 0.5 };
          pulled = true;
        }
        if (pulled) this.events.emit('proc', { ball: victim, text: 'SINGULARITY', color: '#c46fd6', implode: true });
      }
    }

    // DEF Subtraction & Damage Reduction Logic
    let finalDamage;
    if (victim.team === 'player' && attacker.team === 'enemy') {
      finalDamage = this.calculatePlayerDamage(baseDamage, { bypassDef: false });
      const bs = this.stats.battleStats;
      if (this.stats.relics?.includes('rel_shadow_cloak') && bs && (bs.cloakHits || 0) < 2) {
        bs.cloakHits = (bs.cloakHits || 0) + 1;
        finalDamage = Math.max(1, Math.round(finalDamage / 2));
        this.events.emit('proc', { ball: victim, text: 'CLOAK -50%', color: '#94b0c2' });
      }
    } else {
      let damageAfterDef = Math.max(1, baseDamage - victimDef);
      finalDamage = Math.max(1, Math.round(damageAfterDef * (1 - victimDmgReductionPct)));
    }

    // Forcefield (tech perk): the bubble absorbs one whole enemy hit
    if (victim.team === 'player' && attacker.team === 'enemy' && victim.forcefield) {
      victim.forcefield = false;
      attacker.hitCooldown = D.hitCooldown;
      this.events.emit('proc', { ball: victim, text: 'FORCEFIELD BLOCK', color: '#a7f070' });
      return;
    }

    // Aegis Drone shield: absorbs one whole hit
    if (victim.team === 'enemy' && victim.shieldCharges > 0 && attacker.team === 'player') {
      victim.shieldCharges -= 1;
      attacker.hitCooldown = D.hitCooldown;
      this.events.emit('proc', { ball: victim, text: 'BLOCKED', color: '#41a6f6' });
      return;
    }

    if (attacker.team === 'player' && this.stats.relics?.includes('rel_syndicate_blade') && !victim.rank && victim.displayName !== 'SECTOR COMMANDER') {
      const remainingHp = victim.hp - finalDamage;
      if (remainingHp > 0 && remainingHp <= victim.maxHp * 0.15) {
        finalDamage = victim.hp;
        this.events.emit('proc', { ball: victim, text: 'EXECUTE', color: '#ff5d73' });
      }
    }

    let isThorn = false;
    if (victim.team === 'enemy' && victim.archetype === 'tank') {
      let rawReflected = Math.max(1, Math.round(finalDamage * D.thornsReturn));

      // Thorns now affected by player's Total DEF!
      const playerDef = this.stats.playerTotalDef || this.stats.playerDef || 0;
      let reflectedAfterDef = Math.max(1, rawReflected - playerDef);

      const thornsResist = this.stats.techStats?.thornsResistPct || 0;
      const playerDmgRed = this.stats.playerDamageReductionPct || 0;
      let finalReflected = Math.max(0, Math.round(reflectedAfterDef * (1 - thornsResist) * (1 - playerDmgRed)));

      if (attacker.team === 'player' && attacker.hitCooldown <= 0 && finalReflected > 0) {
        attacker.takeDamage(finalReflected);
        attacker.flashTimer = 0.15;
        this.events.emit('damage', {
          attacker: victim,
          victim: attacker,
          damage: finalReflected,
          killed: attacker.hp <= 0,
          isThorn: true,
        });
      }
    }

    this.applyDamage(attacker, victim, finalDamage, extra);
  }

  calculatePlayerDamage(rawDamage, { bypassDef = false } = {}) {
    let damage = rawDamage;

    // 1. Flat DEF reduction (unless bypassing DEF, e.g. status DOTs)
    if (!bypassDef) {
      const def = this.stats.playerTotalDef || this.stats.playerDef || 0;
      // Enemies pierce 25% DEF; only the first 12 DEF blocks flat damage
      // (so stacked tech + armor can't erase hits), and Risk XI pierces half
      const effectiveDef = Math.min(12, def) * 0.75 * (1 - (this.stats.riskDefPierce || 0));
      const maxDefReduction = damage * 0.70; // 30% min damage floor
      const actualDefReduction = Math.min(maxDefReduction, effectiveDef);
      damage = Math.max(damage * 0.30, damage - actualDefReduction);
    }

    // 2. Percentage Damage Reduction (Relics + Tech Tree Kinetic Dampener)
    let redPct = this.stats.playerDamageReductionPct || 0;
    if (this.stats.techStats?.kineticDampenerPct > 0) {
      redPct += this.stats.techStats.kineticDampenerPct;
    }
    redPct = Math.max(-0.5, Math.min(0.85, redPct)); // negative = extra damage taken
    damage = Math.max(1, Math.round(damage * (1 - redPct)));

    // 2b. Bulwark (tech): less damage while one of your barriers stands
    if (this.stats.techStats?.bulwarkPct > 0 && this.stats.hasBarrierUp?.()) {
      damage = Math.max(1, Math.round(damage * (1 - this.stats.techStats.bulwarkPct)));
    }

    // 3. Risk Modifier (+X% DMG TAKEN)
    if (this.stats.riskPlusDmgTaken > 0) {
      damage = Math.max(1, Math.round(damage * (1 + this.stats.riskPlusDmgTaken / 100)));
    }

    return Math.max(1, damage);
  }

  applyDamage(attacker, victim, damage, extra = {}) {
    attacker.hitCooldown = D.hitCooldown;
    const killed = victim.takeDamage(damage);
    this.events.emit('damage', {
      attacker,
      victim,
      damage,
      killed,
      ...extra,
    });
  }
}