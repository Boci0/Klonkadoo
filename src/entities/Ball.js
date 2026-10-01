// A ball entity — represents both the player and enemy characters.
export class Ball {
  constructor({ x, y, team, color, darkColor, maxHp, displayName, archetype, atk, def, aiDifficulty, thinkDelay, radius, ballType }) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.team = team; // 'player' | 'enemy'
    this.color = color;
    this.darkColor = darkColor;
    this.maxHp = maxHp;
    this.hp = maxHp;
    this.radius = radius ?? 24;
    this.ballType = ballType ?? null; // player ball class (juggernaut, cluster, graviton...)
    this.hitCooldown = 0; // seconds until this ball can deal damage again
    this.flashTimer = 0; // visual hit flash
    this.displayName = displayName || null; // e.g. boss name shown in HUD
    this.archetype = archetype || 'standard'; // enemy archetype for abilities
    this.atk = atk ?? 1; // attack multiplier for damage
    this.def = def ?? 0; // defense points
    this.aiDifficulty = aiDifficulty ?? 0.5; // AI accuracy for this enemy
    this.thinkDelay = thinkDelay ?? null; // per-enemy think delay override
    // Class physics (Balls.js): collision mass, wall/floor bounce, gravity scale
    this.mass = 1;
    this.bounce = 1;
    this.gravityMult = 1;
    this.shieldHp = 0; // Overflow Shielding: soaks damage before HP
  }

  update(dt) {
    if (this.hitCooldown > 0) this.hitCooldown -= dt;
    if (this.flashTimer > 0) this.flashTimer -= dt;
  }

  takeDamage(amount) {
    // SHIELD special: soaks damage until the owner's next turn
    if (this.bubble > 0) {
      const soaked = Math.min(this.bubble, amount);
      this.bubble -= soaked;
      amount -= soaked;
    }
    if (this.shieldHp > 0) {
      const soaked = Math.min(this.shieldHp, amount);
      this.shieldHp -= soaked;
      amount -= soaked;
    }
    this.hp = Math.max(0, this.hp - amount);
    this.flashTimer = 0.15;
    if (this.hp > 0) this.onHurt?.(); // the battle's hook (Game: Second Wind)
    return this.hp <= 0;
  }

  isAlive() {
    return this.hp > 0;
  }

  reset(x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.hp = this.maxHp;
    this.hitCooldown = 0;
    this.flashTimer = 0;
  }
}
