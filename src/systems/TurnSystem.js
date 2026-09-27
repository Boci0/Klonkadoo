// ============================================================
// TurnSystem — whose turn it is on the lane (Game drives it):
//   PLAYER_AIM (choosing) → PLAYER_FLY (an action resolving) → ENEMY_AIM
//   (thinking) → ENEMY_FLY → ... → GAME_OVER
// ============================================================

export const TurnPhase = {
  PLAYER_AIM: 'PLAYER_AIM',
  PLAYER_FLY: 'PLAYER_FLY',
  ENEMY_AIM: 'ENEMY_AIM',
  ENEMY_FLY: 'ENEMY_FLY',
  PLAYER_FIRE: 'PLAYER_FIRE',
  ENEMY_FIRE: 'ENEMY_FIRE',
  GAME_OVER: 'GAME_OVER',
};

export class TurnSystem {
  constructor(events) {
    this.events = events;
    this.phase = TurnPhase.PLAYER_AIM;
    this.settleTimer = 0;
    this.turnTime = 0;
    this.enemyIndex = 0; // which enemy is taking its turn
  }

  get isPlayerTurn() {
    return this.phase === TurnPhase.PLAYER_AIM || this.phase === TurnPhase.PLAYER_FLY || this.phase === TurnPhase.PLAYER_FIRE;
  }

  get isEnemyTurn() {
    return this.phase === TurnPhase.ENEMY_AIM || this.phase === TurnPhase.ENEMY_FLY || this.phase === TurnPhase.ENEMY_FIRE;
  }

  get isAiming() {
    return this.phase === TurnPhase.PLAYER_AIM || this.phase === TurnPhase.ENEMY_AIM;
  }

  get isFlying() {
    return this.phase === TurnPhase.PLAYER_FLY || this.phase === TurnPhase.ENEMY_FLY;
  }

  startPlayerTurn() {
    this.phase = TurnPhase.PLAYER_AIM;
    this.turnTime = 0;
    this.enemyIndex = 0;
    this.events.emit('turn-start', { turn: 'player' });
  }

  /**
   * Start a specific enemy's turn.
   * @param {number} index - enemy index in the enemies list
   */
  startEnemyTurn(index) {
    this.phase = TurnPhase.ENEMY_AIM;
    this.turnTime = 0;
    this.enemyIndex = index;
    this.events.emit('turn-start', { turn: 'enemy', enemyIndex: index });
  }

  launch() {
    if (this.phase === TurnPhase.PLAYER_AIM) {
      this.phase = TurnPhase.PLAYER_FLY;
      this.turnTime = 0;
      this.events.emit('launch', { turn: 'player' });
    } else if (this.phase === TurnPhase.ENEMY_AIM) {
      this.phase = TurnPhase.ENEMY_FLY;
      this.turnTime = 0;
      this.events.emit('launch', { turn: 'enemy' });
    }
  }

  endTurn() {
    this.settleTimer = 0;
    const wasPlayerTurn = this.isPlayerTurn;
    this.events.emit('turn-end', { playerTurn: wasPlayerTurn });
  }

  /** Gear combat: the mover has landed and now fires its guns. */
  startFire() {
    this.phase = this.phase === TurnPhase.PLAYER_FLY || this.phase === TurnPhase.PLAYER_AIM ? TurnPhase.PLAYER_FIRE : TurnPhase.ENEMY_FIRE;
    this.settleTimer = 0;
  }

  get isFiring() {
    return this.phase === TurnPhase.PLAYER_FIRE || this.phase === TurnPhase.ENEMY_FIRE;
  }

  gameOver(winner) {
    this.phase = TurnPhase.GAME_OVER;
    this.events.emit('game-over', { winner });
  }

  reset() {
    this.phase = TurnPhase.PLAYER_AIM;
    this.settleTimer = 0;
    this.turnTime = 0;
  }
}