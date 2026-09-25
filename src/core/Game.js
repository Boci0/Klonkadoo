// ============================================================
// Game — orchestrates the full game loop: turn flow, physics
// stepping, collisions, damage, AI, input, sound effects, and rendering.
// Supports multi-enemy battles, operative ball archetypes (Vanguard, Cluster,
// Juggernaut, Graviton), arena obstacles, platforms, and screen shake.
// ============================================================

import { CONFIG } from '../config.js';
import { Events } from './Events.js';
import { stepWorld } from './Physics.js';
import { Ball } from '../entities/Ball.js';
import { CollisionSystem } from '../systems/CollisionSystem.js';
import { TurnSystem, TurnPhase } from '../systems/TurnSystem.js';
import { SlingshotInput } from '../input/SlingshotInput.js';
import { EnemyAI } from '../ai/EnemyAI.js';
import { Renderer } from '../rendering/Renderer.js';
import { soundEngine } from '../utils/SoundEngine.js';
import { saveSystem } from '../meta/SaveSystem.js';
import { haptics } from '../platform/haptics.js';
import { getBall } from '../meta/Balls.js';
import { pickArena } from './Arenas.js';

const W = CONFIG.world;
const B = CONFIG.ball;
const C = CONFIG.colors;

const FIXED_DT = 1 / 120;

const DEFAULT_BATTLE = {
  player: { maxHp: 100, atk: 1, def: 0, abilities: {} },
  enemies: [
    { maxHp: 100, atk: 1, def: 0, displayName: 'HOSTILE', archetype: 'standard', xPct: 0.75 },
  ],
  relics: [],
  nodeType: 'combat',
  ballType: 'vanguard',
  floor: 1,
};

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.events = new Events();
    this.renderer = new Renderer(canvas);
    this.turnSystem = new TurnSystem(this.events);
    this.collisionSystem = new CollisionSystem(this.events);
    this.slingshotInput = new SlingshotInput(canvas, this.events);
    this.slingshotInput.setCoordinateMapper((x, y) => this.renderer.clientToWorld(x, y));
    this.enemyAI = new EnemyAI(this.events);

    this.player = null;
    this.enemies = [];
    this.particles = [];
    this.barriers = [];
    this.platforms = [];
    this.obstacles = [];
    this.winner = null;
    this.battleConfig = null;
    this.battleStats = this._freshBattleStats();
    this.accumulator = 0;
    this.running = false;
    this.abilities = this._freshAbilities();
    this.relics = [];

    this._bindEvents();
    this._bindKeys();

    this.reset(DEFAULT_BATTLE);
  }

  _freshBattleStats() {
    return {
      turns: 0,
      playerDamageTaken: 0,
      wallBounced: false,
      echoUsed: false,
      clusteredThisTurn: false,
      overdriveStacks: 0,
    };
  }

  _freshAbilities() {
    const reduce = this.relics?.includes('rel_overcharge') ? 1 : 0;
    return {
      overdrive: { ready: true, cooldownLeft: 0, baseCooldown: Math.max(1, CONFIG.abilities.overdrive.cooldown - reduce), name: CONFIG.abilities.overdrive.name },
      barrier: { ready: true, cooldownLeft: 0, baseCooldown: Math.max(1, CONFIG.abilities.barrier.cooldown - reduce), name: CONFIG.abilities.barrier.name },
    };
  }

  startBattle(opts = {}) {
    const merged = {
      ...opts,
      player: { ...DEFAULT_BATTLE.player, ...(opts.player || {}) },
      enemies: (opts.enemies && opts.enemies.length ? opts.enemies : DEFAULT_BATTLE.enemies),
      relics: opts.relics || [],
      nodeType: opts.nodeType || 'combat',
      ballType: opts.ballType || 'vanguard',
      floor: opts.floor || 1,
    };
    this.reset(merged);
    this.running = true;
  }

  reset(config = DEFAULT_BATTLE) {
    this.battleConfig = config;
    this.battleStats = this._freshBattleStats();
    this.relics = config.relics || [];

    const ballType = config.ballType || 'vanguard';
    const ballDef = getBall(ballType);
    const pRadius = Math.round(B.radius * ballDef.radiusMult);
    const pColor = config.skinColors?.color || ballDef.color;
    const pDark = config.skinColors?.darkColor || ballDef.darkColor;
    const pName = ballDef.name;

    const groundY = W.groundY - pRadius;

    this.player = new Ball({
      x: W.width * 0.25,
      y: groundY,
      team: 'player',
      radius: pRadius,
      color: pColor,
      darkColor: pDark,
      maxHp: config.player.maxHp || B.maxHp,
      displayName: pName,
      ballType,
    });
    if (config.player.hp !== undefined) {
      this.player.hp = Math.max(1, Math.min(this.player.maxHp, config.player.hp));
    }

    this.enemies = (config.enemies || []).map((e, i) => {
      const xPct = e.xPct ?? 0.7 + i * 0.12;
      const archDef = CONFIG.enemyArchetypes[e.archetype] || CONFIG.enemyArchetypes.standard;
      return new Ball({
        x: W.width * xPct,
        y: groundY,
        team: 'enemy',
        color: archDef.color || C.enemy,
        darkColor: archDef.darkColor || C.enemyDark,
        maxHp: e.maxHp || B.maxHp,
        displayName: e.displayName || archDef.name,
        archetype: e.archetype || 'standard',
        atk: e.atk,
        def: e.def,
        aiDifficulty: e.aiDifficulty,
        thinkDelay: e.thinkDelay,
        radius: e.radius,
      });
    });
    this.enemies.forEach((b, i) => { b.rank = config.enemies[i]?.rank || null; });

    this.techStats = config.techStats || {};
    this.forcefieldTurnCounter = 0;
    this.forcefieldActive = !!this.techStats.hasForcefield;
    this.medkitUsed = false;

    // Random arena for this floor: platforms, obstacles, hazards, wind
    this.arena = config.arena || pickArena(config.floor || 1);
    this.platforms = this.arena.platforms;
    this.obstacles = this.arena.obstacles;
    this.hazards = this.arena.hazards;
    W.wind = this.arena.wind;
    this.arenaTime = 0;
    this.renderer.showArenaIntro?.(this.arena);

    this.collisionSystem.setStats({
      playerAtk: config.player.atk ?? 1,
      playerDef: config.player.def ?? 0,
      playerTotalDef: config.player.totalDef ?? config.player.def ?? 0,
      playerDamageReductionPct: config.player.damageReductionPct ?? 0,
      riskPlusDmgTaken: config.riskPlusDmgTaken || 0,
      relics: this.relics,
      battleStats: this.battleStats,
      techStats: this.techStats,
      riskLevel: config.riskLevel || 0,
    });

    this.particles = [];
    this.barriers = [];
    this.abilities = this._freshAbilities();
    this.winner = null;
    this.turnSystem.reset();
    this.turnSystem.enemyIndex = 0;
    this.slingshotInput.setActive(true);
    this.slingshotInput.setAnchor(this.player.x, this.player.y);
    this.slingshotInput.powerMult = config.maxPowerMult || 1;
    this.hitStop = 0;

    // Silver Shield: a barrier already standing in front of the player
    if (this.relics.includes('rel_silver_shield')) {
      const hp = this._barrierHp();
      this.barriers.push({ x: this.player.x + 150, y: W.groundY - 90, w: 14, h: 90, active: true, hp, maxHp: hp });
    }
    this.renderer.resetBattleFx?.();
  }

  /** Freeze the simulation briefly so big hits land with weight. */
  addHitStop(seconds) {
    this.hitStop = Math.max(this.hitStop || 0, seconds);
  }

  get activeEnemy() {
    return this.enemies[this.turnSystem.enemyIndex] || null;
  }

  get allEnemiesDead() {
    return this.enemies.every((e) => e.hp <= 0);
  }

  useAbility(id) {
    if (!this.running) return false;
    const ab = this.abilities[id];
    if (!ab || !ab.ready) return false;

    if (id === 'overdrive') {
      ab.ready = false;
      ab.cooldownLeft = ab.baseCooldown;
      this.battleStats.overdriveStacks = (this.battleStats.overdriveStacks || 0) + 1;
      this.battleStats.overdriveActive = true;
      soundEngine.playAbility('overdrive');
      this.events.emit('ability-used', {
        id,
        name: `OVERDRIVE (STACK ${this.battleStats.overdriveStacks}x)`,
      });
      return true;
    }

    if (id === 'barrier') {
      const activeCount = this.barriers.filter((b) => b.active).length;
      if (activeCount >= CONFIG.abilities.barrier.maxActive) return false;

      this.slingshotInput.startBarrierPlacement();
      return true;
    }

    return false;
  }

  _barrierHp() {
    return CONFIG.damage.barrierHp * (this.relics.includes('rel_graviton_lens') ? 2 : 1);
  }

  deployBarrierAt(x, y) {
    const ab = this.abilities.barrier;
    if (!ab || !ab.ready) return false;
    const activeCount = this.barriers.filter((b) => b.active).length;
    if (activeCount >= CONFIG.abilities.barrier.maxActive) return false;

    const bw = 14;
    const bh = 90;
    const bx = Math.max(50, Math.min(CONFIG.world.width - 50, x)) - bw / 2;
    const clampedY = Math.max(50, Math.min(CONFIG.world.groundY - bh, y - bh / 2));

    this.barriers.push({
      x: bx,
      y: clampedY,
      w: bw,
      h: bh,
      active: true,
      hp: this._barrierHp(),
      maxHp: this._barrierHp(),
    });
    ab.ready = false;
    ab.cooldownLeft = ab.baseCooldown;
    soundEngine.playAbility('barrier');
    this.events.emit('ability-used', { id: 'barrier', name: CONFIG.abilities.barrier.name });
    return true;
  }

  startBarrierPlacement() {
    this.useAbility('barrier');
  }

  _tickAbilities() {
    for (const key of Object.keys(this.abilities)) {
      const ab = this.abilities[key];
      if (!ab.ready) {
        ab.cooldownLeft -= 1;
        if (ab.cooldownLeft <= 0) ab.ready = true;
      }
    }
  }

  _startPlayerTurn() {
    this.battleStats.clusteredThisTurn = false;
    this.turnSystem.startPlayerTurn();
    this.slingshotInput.cancelPlacement();
    this.slingshotInput.setActive(true);
    if (this.player) {
      this.slingshotInput.setAnchor(this.player.x, this.player.y);
    }

    // Tick player burn (from pyromancer ignition)
    if (this.player && this.player.burnTicks > 0) {
      const rawBurnDmg = this.player.burnDmg || 8;
      const burnDmg = this.collisionSystem.calculatePlayerDamage(rawBurnDmg, { bypassDef: true });
      this.player.hp = Math.max(0, this.player.hp - burnDmg);
      this.player.burnTicks -= 1;
      this._spawnHitParticles(this.player.x, this.player.y);
      this.battleStats.playerDamageTaken += burnDmg;
      this.events.emit('enemy-dealt-damage', { attacker: null, damage: burnDmg });
      this.events.emit('enemy-ability', {
        enemy: null,
        ability: 'Thermal Burn',
        desc: `You take ${burnDmg} burn damage! (${this.player.burnTicks} turns left)`,
      });
      if (this.player.hp <= 0) {
        this._checkBattleEnd(this.player);
        return;
      }
    }

    // Tick player corrosion (from corroder impact)
    if (this.player && this.player.corrodeTicks > 0) {
      const drain = this.player.corrodeDefDrain || 1;
      const curDef = this.collisionSystem.stats.playerTotalDef || 0;
      const newDef = Math.max(0, curDef - drain);
      this.collisionSystem.stats.playerTotalDef = newDef;
      this.player.corrodeTicks -= 1;
      this.events.emit('enemy-ability', {
        enemy: null,
        ability: 'Corrosion Tick',
        desc: `Corrosion drains ${drain} DEF! (Now ${newDef} DEF, ${this.player.corrodeTicks} turns left)`,
      });
    }

    this.events.emit('player-turn-start');
  }

  stop() {
    this.running = false;
    this.slingshotInput.setActive(false);
  }

  _startEnemyTurnAtIndex(index) {
    this.turnSystem.startEnemyTurn(index);
    const enemy = this.enemies[index];
    // A dead enemy's turn must still be passed on, or the battle freezes
    if (!enemy || enemy.hp <= 0) return this._passEnemyTurn();

    if (enemy.archetype === 'striker') {
      enemy.turnCount = (enemy.turnCount || 0) + 1;
      if (enemy.turnCount % 2 === 0) {
        enemy.isOvercharged = true;
        this.events.emit('enemy-ability', {
          enemy,
          ability: 'Overdrive Charge',
          desc: 'Striker charges a high-velocity pulse shot!',
        });
      }
    } else if (enemy.archetype === 'tank') {
      if (enemy.hp < enemy.maxHp * 0.75 && !enemy.hasFortified) {
        enemy.hasFortified = true;
        enemy.def = (enemy.def || 0) + 3;
        const bw = 14;
        const bh = 90;
        this.barriers.push({
          x: Math.max(50, enemy.x - 70),
          y: CONFIG.world.groundY - bh - 5,
          w: bw,
          h: bh,
          active: true,
          hp: CONFIG.damage.barrierHp,
        });
        soundEngine.playAbility('barrier');
        this.events.emit('enemy-ability', {
          enemy,
          ability: 'Fortify Shield',
          desc: 'Tank deploys a protective shield barrier!',
        });
      }
    } else if (enemy.archetype === 'disruptor') {
      const dx = enemy.x - this.player.x;
      const dy = enemy.y - this.player.y;
      const dist = Math.hypot(dx, dy) || 1;

      // Line segment raycast check against active barriers, obstacles, and platforms
      let isBlocked = false;
      const lineIntersectsRect = (x1, y1, x2, y2, rx, ry, rw, rh) => {
        const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
        const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
        if (maxX < rx || minX > rx + rw || maxY < ry || minY > ry + rh) return false;
        return true;
      };

      for (const b of this.barriers) {
        if (b.active && lineIntersectsRect(this.player.x, this.player.y, enemy.x, enemy.y, b.x, b.y, b.w, b.h)) {
          isBlocked = true;
          break;
        }
      }
      if (!isBlocked) {
        for (const obs of this.obstacles) {
          if (obs.active && lineIntersectsRect(this.player.x, this.player.y, enemy.x, enemy.y, obs.x, obs.y, obs.w, obs.h)) {
            isBlocked = true;
            break;
          }
        }
      }
      if (!isBlocked) {
        for (const plat of this.platforms) {
          if (lineIntersectsRect(this.player.x, this.player.y, enemy.x, enemy.y, plat.x, plat.y, plat.w, plat.h)) {
            isBlocked = true;
            break;
          }
        }
      }

      if (isBlocked) {
        soundEngine.playAbility('barrier');
        this.events.emit('enemy-ability', {
          enemy,
          ability: 'Graviton Tether (Blocked)',
          desc: 'Graviton pull was blocked by an intervening barrier/structure!',
        });
      } else {
        // Drag the player up to 200 units toward the Weaver (stopping short of it)
        const gap = enemy.radius + this.player.radius + 20;
        const travel = Math.max(0, Math.min(200, Math.abs(dx) - gap));
        this.player.pullTo = { x: this.player.x + Math.sign(dx) * travel, speed: 700, time: 0.6 };
        this.particles.push({ type: 'tether', from: enemy, to: this.player, life: 0.7, maxLife: 0.7 });
        this.renderer.addScreenShake(12);
        soundEngine.playAbility('overdrive');

        // Pull deals impact damage to the player (affected by DEF, % reduction, and Risk modifiers)
        const rawPullDamage = 12;
        const pullDamage = this.collisionSystem.calculatePlayerDamage(rawPullDamage, { bypassDef: false });
        this.player.hp = Math.max(0, this.player.hp - pullDamage);
        this._spawnHitParticles(this.player.x, this.player.y);
        this.battleStats.playerDamageTaken += pullDamage;
        this.events.emit('enemy-dealt-damage', { attacker: enemy, damage: pullDamage });

        this.events.emit('enemy-ability', {
          enemy,
          ability: 'Graviton Tether Pull',
          desc: `Graviton Weaver pulled you in, dealing ${pullDamage} impact damage!`,
        });

        if (this.player.hp <= 0) {
          this._checkBattleEnd(this.player);
          return;
        }
      }
    } else if (enemy.archetype === 'tactician') {
      let ralliedAny = false;
      for (const ally of this.enemies) {
        if (ally !== enemy && ally.hp > 0 && !ally.isRallied) {
          ally.isRallied = true;
          ally.atk = Math.round((ally.atk || 1) * 1.20 * 100) / 100;
          ally.def = (ally.def || 0) + 3;
          ralliedAny = true;
        }
      }
      if (ralliedAny) {
        soundEngine.playAbility('barrier');
        this.events.emit('enemy-ability', {
          enemy,
          ability: 'War Command',
          desc: 'Commander rallies hostiles with +20% ATK and +3 DEF!',
        });
      }
    } else if (enemy.archetype === 'corroder') {
      const curDef = this.collisionSystem.stats.playerTotalDef || 0;
      if (curDef > 0) {
        const newDef = Math.max(0, curDef - 4);
        this.collisionSystem.stats.playerTotalDef = newDef;
        soundEngine.playAbility('overdrive');
        this.renderer.addScreenShake(8);
        this.events.emit('enemy-ability', {
          enemy,
          ability: 'Corrosive Acid Splash',
          desc: `Acid Drone sprayed corrosive acid! Player DEF reduced by -4 for this battle (Now ${newDef} DEF)!`,
        });
      }
    } else if (enemy.archetype === 'medic') {
      // Heal the most injured living enemy (possibly itself)
      const hurt = this.enemies.filter((e) => e.hp > 0 && e.hp < e.maxHp).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
      enemy.healsLeft = enemy.healsLeft ?? 4; // limited supply: medic fights always end
      if (hurt && enemy.healsLeft > 0) {
        enemy.healsLeft -= 1;
        // 12% to allies, only 6% to itself so a lone medic can't stall forever
        const pct = hurt === enemy ? 0.06 : 0.12;
        hurt.hp = Math.min(hurt.maxHp, hurt.hp + Math.round(hurt.maxHp * pct));
        soundEngine.play('heal');
        this._callout(hurt, 'PATCHED UP', '#a7f070');
      }
    } else if (enemy.archetype === 'shielder') {
      // Allies only: a drone that could shield itself every turn would be unkillable
      const target = this.enemies.find((e) => e !== enemy && e.hp > 0 && !e.shieldCharges);
      if (target) {
        target.shieldCharges = 1;
        soundEngine.playAbility('barrier');
        this._callout(target, 'SHIELDED', '#41a6f6');
      }
    } else if (enemy.archetype === 'minelayer') {
      if (this.hazards.filter((h) => h.type === 'mine').length < 3) {
        // Somewhere near the player, but not right under them
        const side = Math.random() < 0.5 ? -1 : 1;
        const x = Math.max(60, Math.min(W.width - 100, this.player.x + side * (90 + Math.random() * 140)));
        this.hazards.push({ type: 'mine', x: x - 20, w: 40, armed: true });
        soundEngine.playUI(300);
        this._callout(enemy, 'MINE DROPPED', '#ef7d57');
      }
    }
    if (enemy.displayName === 'SECTOR COMMANDER') {
      this._triggerShockwave(enemy);
    }

    if (enemy.burnTicks > 0) {
      const burnDmg = enemy.burnDmg || 6;
      enemy.hp = Math.max(0, enemy.hp - burnDmg);
      enemy.burnTicks -= 1;
      this._spawnHitParticles(enemy.x, enemy.y);
      this.events.emit('player-dealt-damage', { victim: enemy, damage: burnDmg });
      if (enemy.hp <= 0) {
        this._spawnDefeatParticles(enemy.x, enemy.y, enemy.color);
        this._checkBattleEnd(enemy);
        return this._passEnemyTurn(); // burned to death: next enemy (or you) goes
      }
    }

    let aiDifficulty = enemy.aiDifficulty ?? 0.5;
    if (enemy.isFrozen) {
      aiDifficulty = Math.max(0.2, aiDifficulty - 0.3);
    }

    this.enemyAI.configure({
      difficulty: aiDifficulty,
      thinkDelay: enemy.thinkDelay ?? CONFIG.ai.thinkDelay,
      aimErrorBonus: this.relics.includes('rel_smoke_bomb') ? (7 * Math.PI) / 180 : 0,
    });
    this.enemyAI.startTurn(enemy, this.player, this.barriers);
  }

  /** Split Cell: two small cells burst out of the destroyed one. */
  _splitEnemy(parent) {
    for (const side of [-1, 1]) {
      const cell = new Ball({
        x: Math.max(30, Math.min(W.width - 30, parent.x + side * 30)),
        y: parent.y - 10,
        team: 'enemy',
        color: parent.color,
        darkColor: parent.darkColor,
        maxHp: Math.max(8, Math.round(parent.maxHp * 0.3)),
        displayName: 'SPLIT SPAWN',
        archetype: 'splitter',
        atk: Math.round(parent.atk * 0.6 * 100) / 100,
        def: 0,
        aiDifficulty: parent.aiDifficulty,
        thinkDelay: parent.thinkDelay,
        radius: 16,
      });
      cell.isSpawn = true;
      cell.vx = side * 260;
      cell.vy = -480;
      this.enemies.push(cell);
    }
    this._callout(parent, 'SPLIT!', '#a7f070');
    soundEngine.play('select');
  }

  /** Bosses at half HP: +25% ATK and a minion joins the fight. */
  _enterPhaseTwo(boss) {
    boss.phase2 = true;
    boss.atk = Math.round(boss.atk * 1.25 * 100) / 100;
    const minion = new Ball({
      x: Math.min(W.width - 40, boss.x + 90),
      y: boss.y - 40,
      team: 'enemy',
      color: CONFIG.enemyArchetypes.standard.color,
      darkColor: CONFIG.enemyArchetypes.standard.darkColor,
      maxHp: Math.round(boss.maxHp * 0.25),
      displayName: 'REINFORCEMENT',
      archetype: 'standard',
      atk: Math.round(boss.atk * 0.5 * 100) / 100,
      def: 0,
      aiDifficulty: Math.max(0.3, boss.aiDifficulty - 0.15),
      thinkDelay: boss.thinkDelay,
      radius: 20,
    });
    minion.vy = -500;
    this.enemies.push(minion);
    this.renderer.showBanner('PHASE 2', '#ff5d73');
    this._callout(boss, 'ENRAGED: +25% ATK', '#ff5d73');
    this.renderer.addScreenShake(16);
    soundEngine.play('alarm');
    haptics.impact('heavy');
  }

  /** Spikes (damage on landing) and bounce pads (launch upward). */
  _applyHazards(balls) {
    for (const ball of balls) {
      if (ball.hp <= 0) continue;
      const onGround = ball.y + ball.radius >= W.groundY - 3;
      let touching = null;
      for (const h of this.hazards) {
        if (onGround && ball.x > h.x && ball.x < h.x + h.w) touching = h;
      }
      const entered = touching && ball._hazard !== touching;
      ball._hazard = touching;
      if (!entered) continue;

      if (touching.type === 'mine') {
        if (ball.team !== 'player') continue; // enemies step over their own mines
        this.hazards.splice(this.hazards.indexOf(touching), 1);
        const dmg = this.collisionSystem.calculatePlayerDamage(15);
        ball.takeDamage(dmg);
        ball.vy = -600;
        this.battleStats.playerDamageTaken += dmg;
        this.particles.push({ type: 'shockwave', x: ball.x, y: W.groundY, radius: 10, maxRadius: 160, life: 0.35, maxLife: 0.35 });
        this._spawnDefeatParticles(ball.x, W.groundY, '#ef7d57');
        soundEngine.playDefeat();
        this.renderer.addScreenShake(14);
        haptics.impact('heavy');
        this._callout(ball, 'MINE!', '#ef7d57');
        if (this.player.hp <= 0) this._checkBattleEnd(ball);
        continue;
      }

      if (touching.type === 'pad') {
        ball.vy = -1050;
        soundEngine.play('select');
        this.particles.push({ type: 'shockwave', x: ball.x, y: W.groundY, radius: 10, maxRadius: 90, life: 0.25, maxLife: 0.25 });
      } else if (touching.type === 'spikes') {
        const raw = 8;
        const dmg = ball.team === 'player' ? this.collisionSystem.calculatePlayerDamage(raw, { bypassDef: true }) : raw;
        const killed = ball.takeDamage(dmg);
        ball.vy = -420;
        this._spawnHitParticles(ball.x, W.groundY);
        soundEngine.play('hurt');
        this._callout(ball, 'SPIKES', '#ff5d73');
        if (ball.team === 'player') {
          this.battleStats.playerDamageTaken += dmg;
          haptics.impact('heavy');
        }
        if (killed || this.player.hp <= 0) this._checkBattleEnd(ball);
      }
    }
  }

  /** Move a ball sideways by dx, staying inside the arena walls. */
  _slide(ball, dx) {
    ball.x = Math.max(ball.radius, Math.min(W.width - ball.radius, ball.x + dx));
  }

  /** Floating label above a ball (ability names, relic triggers). */
  _callout(ball, text, color) {
    if (ball) this.renderer.addCallout(ball, text, color);
  }

  /** End the current enemy's turn without it shooting (no-op once the battle is over). */
  _passEnemyTurn() {
    if (this.turnSystem.phase === TurnPhase.GAME_OVER || !this.running) return;
    this.events.emit('turn-end', { playerTurn: false });
  }

  _triggerShockwave(enemy) {
    const dx = this.player.x - enemy.x;
    const dy = this.player.y - enemy.y;
    const dist = Math.hypot(dx, dy) || 1;
    if (dist < 400) {
      const force = (1 - dist / 400) * 450;
      this.player.vx += (dx / dist) * force;
      this.player.vy += (dy / dist) * force - 120;
    }
    for (const b of this.barriers) {
      if (!b.active) continue;
      const bx = b.x + b.w / 2;
      if (Math.abs(bx - enemy.x) < 320) {
        b.hp = Math.max(0, b.hp - 25);
        if (b.hp <= 0) b.active = false;
      }
    }
    this.renderer.addScreenShake(14);
    soundEngine.playImpact(1.8);
    this.particles.push({
      x: enemy.x,
      y: enemy.y,
      radius: 20,
      maxRadius: 280,
      life: 0.45,
      maxLife: 0.45,
      type: 'shockwave',
    });
    this.events.emit('enemy-ability', {
      enemy,
      ability: 'Shockwave Pulse',
      desc: 'Commander emits a seismic force pulse!',
    });
  }

  _triggerChainLightning(originEnemy) {
    soundEngine.playAbility('overdrive');
    this.renderer.addScreenShake(10);

    this._callout(originEnemy, 'CHAIN!', '#73eff7');
    for (const enemy of this.enemies) {
      if (enemy !== originEnemy && enemy.hp > 0) {
        this.particles.push({ type: 'bolt', x1: originEnemy.x, y1: originEnemy.y, x2: enemy.x, y2: enemy.y, life: 0.4, maxLife: 0.4, seed: Math.random() });
        enemy.hp = Math.max(0, enemy.hp - 25);
        this._spawnHitParticles(enemy.x, enemy.y);
        this.events.emit('player-dealt-damage', { victim: enemy, damage: 25 });
        if (enemy.hp <= 0) {
          this._spawnDefeatParticles(enemy.x, enemy.y, enemy.color);
          this._checkBattleEnd(enemy);
        }
      }
    }
  }

  _bindEvents() {
    this.events.on('proc', ({ ball, text, color, implode }) => {
      this._callout(ball, text, color);
      if (implode) this.particles.push({ type: 'implode', x: ball.x, y: ball.y, radius: 360, life: 0.4, maxLife: 0.4 });
    });

    this.events.on('place-barrier', ({ x, y }) => {
      if (!this.running) return;
      this.deployBarrierAt(x, y);
    });

    this.events.on('player-launch', ({ velocity }) => {
      if (!this.running) return;
      if (!this.turnSystem.isPlayerTurn || this.turnSystem.isFlying) return;
      this.player.vx = velocity.x;
      this.player.vy = velocity.y;
      this.slingshotInput.setActive(false);
      const speed = Math.hypot(velocity.x, velocity.y);
      this.battleStats.lastLaunchPct = speed / (CONFIG.slingshot.maxPower * this.slingshotInput.powerMult);
      soundEngine.playLaunch(speed / 900);
      haptics.impact(speed > 1100 ? 'medium' : 'light');
      this.turnSystem.launch();
    });

    this.events.on('enemy-launch', ({ velocity, enemyIndex }) => {
      if (!this.running) return;
      if (this.turnSystem.phase !== TurnPhase.ENEMY_AIM) return;
      const enemy = this.enemies[enemyIndex ?? this.turnSystem.enemyIndex];
      if (!enemy || enemy.hp <= 0) return;

      if (enemy.isOvercharged) {
        velocity.x *= 1.35;
        velocity.y *= 1.35;
      }
      if (enemy.isFrozen) {
        velocity.x *= 0.65;
        velocity.y *= 0.65;
        enemy.isFrozen = false;
        this._callout(enemy, 'FROZEN SHOT', '#73eff7');
      }

      enemy.vx = velocity.x;
      enemy.vy = velocity.y;
      const speed = Math.hypot(velocity.x, velocity.y);
      soundEngine.playLaunch(speed / 900);
      this.turnSystem.launch();
    });

    this.events.on('turn-end', ({ playerTurn }) => {
      if (!this.running) return;
      if (this.turnSystem.phase === TurnPhase.GAME_OVER) return;

      if (playerTurn) {
        this.battleStats.turns += 1;
        this._tickAbilities();

        if (this.techStats.forcefieldTurnInterval > 0 && this.battleStats.turns % this.techStats.forcefieldTurnInterval === 0) {
          this.forcefieldActive = true;
        }

        if (this.relics.includes('rel_medic')) {
          this.player.hp = Math.min(this.player.maxHp, this.player.hp + 6);
        }

        this.collisionSystem.stats.playerDef = this.battleConfig?.player?.def || 0;

        const firstIdx = this.enemies.findIndex((e) => e.hp > 0);
        if (firstIdx === -1) {
          this._startPlayerTurn();
        } else {
          this._startEnemyTurnAtIndex(firstIdx);
        }
      } else {
        const currentIdx = this.turnSystem.enemyIndex;
        let nextIdx = -1;
        for (let i = currentIdx + 1; i < this.enemies.length; i++) {
          if (this.enemies[i].hp > 0) {
            nextIdx = i;
            break;
          }
        }
        if (nextIdx !== -1) {
          this._startEnemyTurnAtIndex(nextIdx);
        } else {
          this._startPlayerTurn();
        }
      }
    });

    this.events.on('damage', ({ attacker, victim, damage, killed, isThorn }) => {
      this._spawnHitParticles(victim.x, victim.y);
      const forceScale = Math.min(2.0, damage / 20);
      soundEngine.playImpact(forceScale);
      if (victim.team === 'player') {
        soundEngine.play('hurt');
        haptics.impact('heavy');
      } else {
        haptics.impact(damage >= 15 ? 'heavy' : 'medium');
      }
      if (damage >= 15) {
        this.renderer.addScreenShake(Math.min(16, damage * 0.5));
        this.addHitStop(0.05);
      }

      // HE Shell: splash the other enemies near the one you hit
      if (attacker.team === 'player' && victim.team === 'enemy' && !isThorn && !this._splashing && this.relics.includes('rel_artillery_shell')) {
        this._splashing = true;
        const near = this.enemies.some((o) => o !== victim && o.hp > 0 && Math.hypot(o.x - victim.x, o.y - victim.y) <= 260);
        if (near) {
          this._callout(victim, 'SPLASH', '#ef7d57');
          this.particles.push({ type: 'shockwave', x: victim.x, y: victim.y, radius: 20, maxRadius: 260, life: 0.35, maxLife: 0.35 });
        }
        for (const other of this.enemies) {
          if (other === victim || other.hp <= 0) continue;
          if (Math.hypot(other.x - victim.x, other.y - victim.y) > 260) continue;
          const dead = other.takeDamage(10);
          other.flashTimer = 0.15;
          this.events.emit('damage', { attacker, victim: other, damage: 10, killed: dead });
          this.events.emit('player-dealt-damage', { victim: other, damage: 10 });
        }
        this._splashing = false;
      }

      if (killed && victim.team === 'enemy' && this.relics.includes('rel_horn_of_war') && this.player.hp > 0) {
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 12);
        this._callout(this.player, 'HORN OF VALOR', '#a7f070');
      }

      if (killed) {
        this.addHitStop(0.14);
        haptics.impact('heavy');
        soundEngine.playDefeat();
        this._spawnDefeatParticles(victim.x, victim.y, victim.color);
        this.renderer.addScreenShake(12);

        if (victim.team === 'enemy' && this.relics.includes('rel_chain_lightning')) {
          this._triggerChainLightning(victim);
        }
      }

      if (attacker.team === 'player') {
        this.events.emit('player-dealt-damage', { victim, damage });

        if (this.techStats?.vampiricVitalityPct > 0 && damage > 0) {
          const rawHeal = Math.max(1, Math.round(damage * this.techStats.vampiricVitalityPct));
          let effectiveHeal = 0;
          if (this.run) {
            effectiveHeal = this.run.healFlat(rawHeal, this.techStats);
            this.player.hp = Math.min(this.player.maxHp, this.run.hp);
          } else {
            const healMult = saveSystem.getHealingMultiplier();
            effectiveHeal = Math.max(1, Math.round(rawHeal * healMult));
            this.player.hp = Math.min(this.player.maxHp, this.player.hp + effectiveHeal);
          }
          if (effectiveHeal > 0) {
            this._spawnHitParticles(this.player.x, this.player.y);
            this.events.emit('enemy-ability', {
              enemy: null,
              ability: 'Vampiric Vitality',
              desc: `Vampiric Vitality absorbed +${effectiveHeal} HP from damage dealt!`,
            });
          }
        }
      } else {
        this.battleStats.playerDamageTaken += damage;
        this.events.emit('enemy-dealt-damage', { attacker, damage });

        if (attacker.archetype === 'vampire') {
          const healAmt = Math.max(1, Math.round(damage * 0.40));
          attacker.hp = Math.min(attacker.maxHp, attacker.hp + healAmt);
          this._spawnHitParticles(attacker.x, attacker.y);
          this.events.emit('enemy-ability', {
            enemy: attacker,
            ability: 'Siphon Drain',
            desc: `Siphon Drone stole ${healAmt} HP!`,
          });
        } else if (attacker.archetype === 'pyromancer') {
          victim.burnTicks = 2;
          victim.burnDmg = 8;
          this.events.emit('enemy-ability', {
            enemy: attacker,
            ability: 'Thermal Flare Ignition',
            desc: 'Blaze Mortar ignited player with 2 turns of Thermal Burn (8 DMG/turn)!',
          });
        } else if (attacker.archetype === 'corroder') {
          victim.corrodeTicks = 3;
          victim.corrodeDefDrain = 1;
          this.events.emit('enemy-ability', {
            enemy: attacker,
            ability: 'Corrosive Impact',
            desc: 'Acid Drone hit you! Corrosion applied: -1 DEF/turn for 3 turns.',
          });
        }
      }

      if (victim.team === 'player' && this.techStats.emergencyMedkitHeal > 0 && !this.medkitUsed && victim.hp > 0 && victim.hp <= victim.maxHp * 0.25) {
        this.medkitUsed = true;
        const heal = this.techStats.emergencyMedkitHeal;
        if (this.run) this.run.healFlat(heal, this.techStats);
        else victim.hp = Math.min(victim.maxHp, victim.hp + heal);
        soundEngine.playAbility('barrier');
        this.events.emit('emergency-medkit-heal', { hp: victim.hp });
        this._callout(victim, 'EMERGENCY MEDKIT', '#a7f070');
      }

      if (victim.team === 'player' && this.techStats.fortifiedMatrixBonusDef > 0 && damage >= 20) {
        this.collisionSystem.stats.playerTotalDef = (this.collisionSystem.stats.playerTotalDef || 0) + this.techStats.fortifiedMatrixBonusDef;
      }

      if (attacker.team === 'player' && this.battleStats.wallBounced) {
        this.events.emit('wall-bounce-hit', { damage });
        this.battleStats.wallBounced = false;
      }

      if (victim.team === 'player' && attacker.team === 'enemy' && this.relics.includes('rel_thorns') && !isThorn) {
        const reflected = Math.max(1, Math.round(damage * 0.25));
        attacker.hp = Math.max(0, attacker.hp - reflected);
        this.events.emit('player-dealt-damage', { victim: attacker, damage: reflected });
        if (attacker.hp <= 0) {
          this._checkBattleEnd(attacker);
        }
      }

      if (victim.team === 'enemy' && victim.rank && !victim.phase2 && victim.hp > 0 && victim.hp <= victim.maxHp * 0.5) {
        this._enterPhaseTwo(victim);
      }
      if (killed && victim.archetype === 'splitter' && !victim.isSpawn) {
        this._splitEnemy(victim);
      }
      if (killed) {
        this._checkBattleEnd(victim);
      }
    });

    this.events.on('wall-bounce', ({ ball }) => {
      soundEngine.playWallBounce();
      if (ball.team === 'player') {
        this.battleStats.wallBounced = true;
        if ((ball.ballType === 'cluster' || this.relics.includes('rel_cluster')) && !this.battleStats.clusteredThisTurn) {
          this.battleStats.clusteredThisTurn = true;
          this._spawnClusterShards(ball);
        }
      }
    });
  }

  /** Cluster: two fragments fly off the bounce and deal 12 damage to the first enemy they touch. */
  _spawnClusterShards(ball) {
    this._callout(ball, 'SPLIT!', '#ffcd75');
    soundEngine.playAbility('overdrive');
    this.renderer.addScreenShake(8);
    for (let i = 0; i < 2; i++) {
      const angle = Math.atan2(ball.vy, ball.vx) + (i === 0 ? -0.35 : 0.35);
      const speed = Math.max(500, Math.hypot(ball.vx, ball.vy) * 0.8);
      this.particles.push({
        x: ball.x,
        y: ball.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 9,
        color: '#ffcd75',
        life: 1.2,
        maxLife: 1.2,
        shard: true,
      });
    }
  }

  _updateShards(dt) {
    for (const p of this.particles) {
      if (!p.shard || p.life <= 0) continue;
      // Steer toward the nearest living enemy
      let target = null;
      let best = Infinity;
      for (const enemy of this.enemies) {
        const d = enemy.hp > 0 ? Math.hypot(enemy.x - p.x, enemy.y - p.y) : Infinity;
        if (d < best) { best = d; target = enemy; }
      }
      if (target) {
        const speed = 900;
        const k = Math.min(1, dt * 7);
        p.vx += ((target.x - p.x) / best * speed - p.vx) * k;
        p.vy += ((target.y - p.y) / best * speed - p.vy) * k;
      }
      for (const enemy of this.enemies) {
        if (enemy.hp <= 0 || Math.hypot(p.x - enemy.x, p.y - enemy.y) > enemy.radius + 10) continue;
        p.life = 0;
        const killed = enemy.takeDamage(12);
        enemy.flashTimer = 0.15;
        this.events.emit('damage', { attacker: this.player, victim: enemy, damage: 12, killed });
        this.events.emit('player-dealt-damage', { victim: enemy, damage: 12 });
        if (killed) this._checkBattleEnd(enemy);
        break;
      }
    }
  }

  _checkBattleEnd(victim) {
    if (this.turnSystem.phase === TurnPhase.GAME_OVER) return;

    if (this.player.hp <= 0) {
      this.winner = 'enemy';
      soundEngine.play('lose');
      this._endBattle();
      return;
    }

    // Killing the boss / mini-boss wins the fight; its reinforcements retreat
    const bosses = this.enemies.filter((e) => e.rank);
    const bossDown = bosses.length > 0 && bosses.every((e) => e.hp <= 0);
    if (this.allEnemiesDead || bossDown) {
      this.winner = 'player';
      this.events.emit('player-turn-start');
      soundEngine.playVictory();
      this._endBattle();
    }
  }

  _endBattle() {
    this.running = false;
    this.slingshotInput.setActive(false);
    this.turnSystem.gameOver(this.winner);
    this.events.emit('battle-end', {
      won: this.winner === 'player',
      nodeType: this.battleConfig.nodeType,
    });
  }

  /** Stop the battle without a winner (player retreated). Emits no battle-end. */
  abortBattle() {
    this.running = false;
    this.slingshotInput.setActive(false);
    this.turnSystem.gameOver(null);
  }

  _bindKeys() {
    this._onKeyDown = (e) => {
      if (this.turnSystem.phase === TurnPhase.GAME_OVER) {
        if (e.key === 'r' || e.key === 'R' || e.key === 'Enter') {
          this.events.emit('battle-continue');
        }
      }
    };
    window.addEventListener('keydown', this._onKeyDown);

    this._onCanvasClick = () => {
      if (!this.running) return;
      if (this.turnSystem.phase === TurnPhase.GAME_OVER) {
        this.events.emit('battle-continue');
      }
    };
    this.canvas.addEventListener('click', this._onCanvasClick);
  }

  update(dt) {
    dt = Math.min(dt, 0.1);
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      return;
    }

    // Watchdog: if the enemy whose turn it is died mid-turn (spikes, mines,
    // reflected damage...), hand the turn on instead of waiting forever.
    if (this.running && this.turnSystem.phase === TurnPhase.ENEMY_AIM) {
      const active = this.enemies[this.turnSystem.enemyIndex];
      if (!active || active.hp <= 0) {
        this.enemyAI.thinking = false;
        this._passEnemyTurn();
      }
    }

    this.accumulator += dt;
    while (this.accumulator >= FIXED_DT) {
      this._stepPhysics(FIXED_DT);
      this.accumulator -= FIXED_DT;
    }

    this._updateParticles(dt);

    if (this.player) this.player.update(dt);
    for (const enemy of this.enemies) enemy.update(dt);

    // Graviton ball: while YOUR shot flies, nearby enemies slide toward it.
    // Moved directly (not via velocity) because ground friction would cancel a push.
    this.gravitonLinks = [];
    if (this.player?.ballType === 'graviton' && this.turnSystem.phase === TurnPhase.PLAYER_FLY) {
      const R = 460;
      for (const enemy of this.enemies) {
        if (enemy.hp <= 0) continue;
        const dx = this.player.x - enemy.x;
        const dist = Math.hypot(dx, this.player.y - enemy.y);
        if (dist > R || Math.abs(dx) < enemy.radius + this.player.radius) continue;
        const speed = 90 + 330 * (1 - dist / R);
        this._slide(enemy, Math.sign(dx) * speed * dt);
        this.gravitonLinks.push(enemy);
      }
    }

    // Timed pulls (Singularity Core, Graviton Weaver tether)
    for (const ball of [this.player, ...this.enemies]) {
      if (!ball?.pullTo || ball.hp <= 0) continue;
      ball.pullTo.time -= dt;
      const dx = ball.pullTo.x - ball.x;
      const step = Math.sign(dx) * Math.min(Math.abs(dx), ball.pullTo.speed * dt);
      this._slide(ball, step);
      if (Math.abs(dx) < 2 || ball.pullTo.time <= 0) ball.pullTo = null;
    }

    if (!this.running) return;

    if (this.turnSystem.isPlayerTurn && this.turnSystem.isAiming && this.player) {
      this.slingshotInput.setAnchor(this.player.x, this.player.y);
    }

    if (this.turnSystem.isEnemyTurn && this.turnSystem.isAiming) {
      this.enemyAI.update(dt);
    }

    if (this.turnSystem.isFlying) {
      const livingEnemies = this.enemies.filter((e) => e.hp > 0);
      this.turnSystem.update(dt, [this.player, ...livingEnemies]);
    }
  }

  _stepPhysics(dt) {
    const livingEnemies = this.enemies.filter((e) => e.hp > 0);
    const balls = [this.player, ...livingEnemies];

    // Moving platforms slide along x
    this.arenaTime += dt;
    for (const p of this.platforms) {
      if (p.move) p.x = p.baseX + Math.sin(this.arenaTime * p.move.speed) * p.move.amp;
    }

    const events = stepWorld(balls, dt, this.barriers, this.platforms, this.obstacles);
    this._applyHazards(balls);
    for (const evt of events) {
      if (evt.type === 'wall' || evt.type === 'barrier') {
        soundEngine.playWallBounce();
        this.events.emit('wall-bounce', { ball: evt.ball });
      }
    }
    this.collisionSystem.process(events, balls);
  }

  _updateParticles(dt) {
    this._updateShards(dt);
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.shard) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      } else if (p.vx !== undefined) {
        // Moving particles fall under light gravity; fx (tether, bolt, rings) stay put
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 400 * dt;
      }
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  _spawnHitParticles(x, y) {
    for (let i = 0; i < 18; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 180;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 120,
        size: 2 + Math.random() * 4,
        color: ['#ffd54f', '#ff8a65', '#ffffff', '#ffecb3'][Math.floor(Math.random() * 4)],
        life: 0.4 + Math.random() * 0.5,
        maxLife: 0.9,
      });
    }
  }

  _spawnDefeatParticles(x, y, color = '#e0655c') {
    for (let i = 0; i < 30; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 120 + Math.random() * 260;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 160,
        size: 3 + Math.random() * 6,
        color: [color, '#ffffff', '#ff8a65', '#ffd54f'][Math.floor(Math.random() * 4)],
        life: 0.6 + Math.random() * 0.6,
        maxLife: 1.2,
      });
    }
  }

  render() {
    const world = {
      player: this.player,
      enemies: this.enemies,
      turnSystem: this.turnSystem,
      particles: this.particles,
      barriers: this.barriers,
      platforms: this.platforms,
      obstacles: this.obstacles,
      abilities: this.abilities,
      winner: this.winner,
      battleSummary: {
        kills: this.enemies.filter((e) => e.hp <= 0).length,
        turns: this.battleStats.turns,
      },
      slingshotInput: this.slingshotInput,
    };
    this.renderer.render(world);
  }

  destroy() {
    window.removeEventListener('keydown', this._onKeyDown);
    this.canvas.removeEventListener('click', this._onCanvasClick);
    this.slingshotInput.destroy();
  }
}