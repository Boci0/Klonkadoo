// ============================================================
// QuestSystem — generates a small set of quests for the current
// run. Completing them awards scrap (permanent: it upgrades
// Rig parts).
// ============================================================

import { CONFIG } from '../config.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const QUEST_COUNT = 4;

export class QuestSystem {
  constructor(saveSystem, runSeed = 1) {
    this.saveSystem = saveSystem;
    this.runSeed = runSeed;
    this.quests = [];
    this.completed = new Set();
    this.generate();
  }

  /** Pick a random subset of quests for this run. */
  generate() {
    const rng = mulberry32(hashString(`${this.runSeed}:quests`));
    const pool = [...CONFIG.quests];
    this.quests = [];
    this.completed.clear();

    // Shuffle
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    this.quests = pool.slice(0, QUEST_COUNT).map((q) => ({ ...q, completed: false }));
  }

  getActiveQuests() {
    return this.quests;
  }

  /** Report a combat event; returns array of newly completed quests. */
  reportCombatEvent(eventType, data = {}) {
    const newly = [];
    for (const q of this.quests) {
      if (q.completed) continue;
      if (this._evaluate(q.id, eventType, data)) {
        q.completed = true;
        this.completed.add(q.id);
        this.saveSystem.addScrap(q.reward);
        this.saveSystem.recordQuestCompleted();
        newly.push(q);
      }
    }
    return newly;
  }

  _evaluate(questId, eventType, data) {
    switch (questId) {
      case 'quest_first_blood':
        return eventType === 'damage_dealt' && data.amount > 0;
      case 'quest_one_turn_win':
        return eventType === 'combat_end' && data.won && data.turns <= 1 && data.damageTaken === 0;
      case 'quest_no_damage':
        return eventType === 'combat_end' && data.won && data.damageTaken === 0;
      case 'quest_speed_win':
        return eventType === 'combat_end' && data.won && data.turns <= 3;
      case 'quest_shopping':
        return eventType === 'gold_spent' && this._isBoonCountFor('quest_shopping', data);
      case 'quest_boss_kill':
        return eventType === 'combat_end' && data.won && data.nodeType === 'boss';
      case 'quest_minigame':
        return eventType === 'minigame' && data.perfect;
      case 'quest_perfect':
        // "Reach floor 5 without losing a combat"
        return eventType === 'floor_reached' && data.floor >= CONFIG.map.floors - 1 && !data.lostAnyCombat;
      case 'quest_elite':
        return eventType === 'combat_end' && data.won && data.nodeType === 'elite';
      case 'quest_rest':
        return eventType === 'rest' && data.healed >= 1500;
      case 'quest_lowhp':
        return eventType === 'combat_end' && data.won && data.playerHpLeft <= 100;
      default:
        return false;
    }
  }

  _isBoonCountFor(questId, data) {
    // Track cumulative gold spent on this run via data.totalSpent.
    return data.totalSpent >= 40;
  }
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}