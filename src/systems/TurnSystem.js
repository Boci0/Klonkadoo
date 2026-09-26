// ============================================================
// TurnSystem — manages the turn flow:
//   PLAYER_AIM → PLAYER_FLY → SETTLING → ENEMY_AIM → ENEMY_FLY → ...
// Gear combat adds a fire phase after each landing:
//   PLAYER_AIM → PLAYER_FLY → PLAYER_FIRE → ENEMY_AIM → ENEMY_FLY → ENEMY_FIRE → ...
// ============================================================

import { CONFIG } from '../config.js';
import { isSettled } from '../core/Physics.js';

const W = CONFIG.world;
const T = CONFIG.turn;

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

  /**
   * Update settle detection. Called every frame while flying.
   * Returns true when the turn should end.
   */
  update(dt, balls) {
    this.turnTime += dt;

    if (!this.isFlying) return false;

    const allSettled = balls.every((b) => isSettled(b));

    if (allSettled) {
      this.settleTimer += dt;
    } else {
      this.settleTimer = 0;
    }

    // Require both a minimum turn time and a sustained settle period,
    // OR force-end if max turn time (6 seconds) is reached.
    const maxTurnTime = 6.0;
    if ((this.turnTime >= T.minTurnTime && this.settleTimer >= W.settleTime) || this.turnTime >= maxTurnTime) {
      if (this.turnTime >= maxTurnTime) {
        for (const b of balls) {
          b.vx = 0;
          b.vy = 0;
        }
      }
      this.endTurn();
      return true;
    }

    return false;
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