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
  }

  update(dt) {
    if (this.hitCooldown > 0) this.hitCooldown -= dt;
    if (this.flashTimer > 0) this.flashTimer -= dt;
  }

  takeDamage(amount) {
    this.hp = Math.max(0, this.hp - amount);
    this.flashTimer = 0.15;
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
