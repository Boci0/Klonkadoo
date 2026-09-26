// ============================================================
// Slingshot — Central Game Configuration
// All tunable constants and content data (quests, tech tree,
// perks, roguelike map rules) live here.
// ============================================================

import { RELICS } from './meta/Relics.js';

export const CONFIG = {
  // --- World ---
  world: {
    width: 1280,
    height: 750,
    groundY: 620, // y-coordinate of the ground surface
    gravity: 1500, // px/s^2
    airDrag: 0.0012, // velocity damping per second (0 = none)
    groundFriction: 0.85, // horizontal velocity multiplier per second on ground contact
    groundRestitution: 0.55, // bounce factor off ground
    wallRestitution: 0.7, // bounce factor off side walls
    ballRestitution: 0.75, // bounce factor between balls
    settleSpeed: 12, // px/s — below this both balls are "settled"
    settleTime: 0.5, // seconds both balls must be settled to end turn
  },

  // --- Ball / Character ---
  ball: {
    radius: 24, // base size; ball classes scale it (Balls.js radiusMult)
    maxHp: 100,
  },

  // --- Slingshot (player) ---
  slingshot: {
    maxPower: 1400, // max launch speed px/s
    minPower: 150,
    powerScale: 4.5, // drag distance (px) → launch speed multiplier
    maxDragDistance: 300,
    trajectoryPoints: 40,
    trajectoryStep: 0.05,
  },

  // --- Damage ---
  damage: {
    minImpactSpeed: 120, // below this, no damage on hit
    damagePerSpeed: 0.02, // damage = impactSpeed * this (e.g. 900px/s → 18 dmg)
    maxDamagePerHit: 30,
    hitCooldown: 0.4,
    defensePerPoint: 0.04, // damage reduction per DEF point (cap 60%)
    thornsReturn: 0.3, // tank enemy reflects 30% of damage taken
    barrierHp: 60, // barriers break after taking this much damage
    barrierImpactMinSpeed: 200, // min ball speed to damage a barrier
  },

  // --- Enemy archetypes (unique abilities) ---
  enemyArchetypes: {
    standard: {
      name: 'HOSTILE UNIT',
      hpMult: 1, atkMult: 1, defBonus: 0, aiShift: 0,
      ability: null, abilityDesc: 'Standard combatant unit',
      color: '#e0655c', darkColor: '#a83b35',
    },
    tank: {
      name: 'WALL UNIT',
      hpMult: 1.6, atkMult: 0.85, defBonus: 4, aiShift: -0.025,
      ability: 'thorns',
      abilityDesc: 'Reflects 20% impact damage & deploys cover barriers',
      color: '#4a6572', darkColor: '#263238',
    },
    striker: {
      name: 'SNIPER UNIT',
      hpMult: 1.1, atkMult: 1.3, defBonus: 0, aiShift: 0.075,
      ability: 'aggressive',
      abilityDesc: 'Fires faster & charges Overdrive pulse shots (+50% velocity & ATK)',
      color: '#f57c00', darkColor: '#e65100',
    },
    vampire: {
      name: 'SIPHON DRONE',
      hpMult: 1.25, atkMult: 1.1, defBonus: 2, aiShift: 0.025,
      ability: 'vampire',
      abilityDesc: 'Heals 40% of damage dealt to player and heals nearby allies',
      color: '#d32f2f', darkColor: '#8b0000',
    },
    pyromancer: {
      name: 'BLAZE MORTAR',
      hpMult: 1.2, atkMult: 1.25, defBonus: 1, aiShift: 0.05,
      ability: 'pyro',
      abilityDesc: 'Ignites target with 2 turns of Thermal Burn (8 DMG/turn) and melts player barriers',
      color: '#ff5722', darkColor: '#bf360c',
    },
    disruptor: {
      name: 'GRAVITON WEAVER',
      hpMult: 1.3, atkMult: 1.0, defBonus: 3, aiShift: 0.04,
      ability: 'disrupt',
      abilityDesc: 'Emits a gravitic pulse pulling player ball toward obstacles on turn start',
      color: '#7b1fa2', darkColor: '#4a148c',
    },
    tactician: {
      name: 'FIELD COMMANDER',
      hpMult: 1.4, atkMult: 1.15, defBonus: 3, aiShift: 0.06,
      ability: 'command',
      abilityDesc: 'Rallies all hostiles on turn start granting +20% ATK and +3 DEF',
      color: '#ffb300', darkColor: '#ff8f00',
    },
    corroder: {
      name: 'ACID DRONE',
      hpMult: 1.2, atkMult: 1.05, defBonus: 1, aiShift: 0.04,
      ability: 'corrode',
      abilityDesc: 'Emits a corrosive acid splash reducing player DEF by -4 for the battle',
      color: '#aeea00', darkColor: '#33691e',
    },
    splitter: {
      name: 'SPLIT CELL',
      hpMult: 1.1, atkMult: 0.9, defBonus: 0, aiShift: 0,
      ability: 'split',
      abilityDesc: 'Bursts into 2 smaller cells when destroyed',
      color: '#a7f070', darkColor: '#38b764',
    },
    medic: {
      name: 'FIELD MEDIC',
      hpMult: 1.0, atkMult: 0.8, defBonus: 1, aiShift: -0.03,
      ability: 'heal',
      abilityDesc: 'Heals the most injured ally for 12% of its max HP each turn (4 heals per battle)',
      color: '#f4f4f4', darkColor: '#94b0c2',
    },
    shielder: {
      name: 'AEGIS DRONE',
      hpMult: 1.2, atkMult: 0.85, defBonus: 2, aiShift: 0,
      ability: 'shield',
      abilityDesc: 'Shields another enemy each turn: the shield blocks the next hit',
      color: '#41a6f6', darkColor: '#29366f',
    },
    minelayer: {
      name: 'MINE LAYER',
      hpMult: 1.1, atkMult: 0.9, defBonus: 1, aiShift: 0.02,
      ability: 'mines',
      abilityDesc: 'Drops a mine near you each turn: 15 damage if you roll onto it',
      color: '#ef7d57', darkColor: '#5d275d',
    },
  },

  // --- Enemy Tiers (Initial Base Enemy Stats per Floor) ---
  // Floor scaling (floorScaling) is applied on top. Tuned so a Risk 0 player
  // with no upgrades has to play well: a sloppy fight costs 40-60% HP and
  // runs are won with relics + skills, not by default. Enemies also tighten
  // their aim after each miss (Game: missStreak). aiDifficulty → measured hit
  // rate with the physics planner (EnemyAI): 0.4 ≈ 50%, 0.55 ≈ 67%, 0.7 ≈ 71%, 0.85 ≈ 96%.
  // HP +10% across the board to make room for gear (starter gear restores the old feel)
  enemyTiers: {
    1: { hp: 79, atk: 0.95, def: 0, aiDifficulty: 0.36 },
    2: { hp: 92, atk: 1.00, def: 1, aiDifficulty: 0.41 },
    3: { hp: 106, atk: 1.05, def: 1, aiDifficulty: 0.45 },
    4: { hp: 99, atk: 0.92, def: 2, aiDifficulty: 0.48 },
    5: { hp: 110, atk: 0.98, def: 3, aiDifficulty: 0.51 },
    elite: { hp: 123, atk: 1.05, def: 3, aiDifficulty: 0.55 },
    miniboss: { hp: 176, atk: 1.02, def: 4, aiDifficulty: 0.62 },
    boss: { hp: 220, atk: 1.08, def: 5, aiDifficulty: 0.70 },
  },

  // --- Floor scaling (applies to every enemy, shown to the player) ---
  // Floor N enemies get +hp% and +atk% per floor above the first.
  floorScaling: { hpPerFloor: 0.10, atkPerFloor: 0.07 },

  // --- Risk levels: each level adds one rule on top of the ones below ---
  // Unlocked one at a time by winning a run on the highest unlocked level.
  // Each level also grants +tpPerLevel% Tech Points from battles.
  risk: {
    tpPerLevel: 15,
    levels: [
      { name: 'HARDENED', desc: 'Enemies +15% HP.', hpPct: 15 },
      { name: 'SHARPSHOOTERS', desc: 'Enemies aim better.', aiBonus: 0.08 },
      { name: 'SCARCITY', desc: '-20% gold.', minusGold: 20 },
      { name: 'BRUTAL', desc: 'Enemies +15% ATK.', atkPct: 15 },
      { name: 'THIN SUPPLIES', desc: 'Healing -25%.', minusHeal: 25 },
      { name: 'INFLATION', desc: 'Shop prices +25%.', plusCost: 25 },
      { name: 'ELITE GUARD', desc: 'Elites & bosses +25% HP.', eliteHpPct: 25 },
      { name: 'GLASS ARMOR', desc: 'You take +15% damage.', plusDmgTaken: 15 },
      { name: 'VETERANS', desc: 'Enemies +15% HP and ATK.', hpPct: 15, atkPct: 15 },
      { name: 'NIGHTMARE', desc: 'Elites & bosses +25% ATK, enemies aim even better.', eliteAtkPct: 25, aiBonus: 0.08 },
    ],
  },
  // Multi-enemy waves per node type + floor (1 to 3 enemies per stage)
  enemyCounts: {
    combat: { 1: 1, 2: 1, 3: 2, 4: 2, 5: 2 },
    elite: { 1: 1, 2: 2, 3: 2, 4: 2, 5: 3 },
    miniboss: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 },
    boss: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 },
  },
  // Archetype pick weights per floor (proportion of each type)
  archetypeWeights: {
    1: { standard: 0.5, tank: 0.15, striker: 0.15, splitter: 0.2 },
    2: { standard: 0.25, tank: 0.15, striker: 0.15, vampire: 0.1, pyromancer: 0.1, splitter: 0.15, minelayer: 0.1 },
    3: { standard: 0.1, tank: 0.1, striker: 0.1, disruptor: 0.1, tactician: 0.1, corroder: 0.1, splitter: 0.1, medic: 0.1, shielder: 0.1, minelayer: 0.1 },
    4: { standard: 0.05, tank: 0.1, striker: 0.1, vampire: 0.1, pyromancer: 0.1, disruptor: 0.1, tactician: 0.1, corroder: 0.05, medic: 0.1, shielder: 0.1, minelayer: 0.1 },
    5: { standard: 0.05, tank: 0.1, striker: 0.1, vampire: 0.1, pyromancer: 0.1, disruptor: 0.1, tactician: 0.1, corroder: 0.05, medic: 0.1, shielder: 0.1, minelayer: 0.1 },
    elite: { tank: 0.12, striker: 0.12, vampire: 0.1, pyromancer: 0.1, disruptor: 0.1, tactician: 0.1, corroder: 0.1, splitter: 0.12, minelayer: 0.14 },
    miniboss: { tank: 0.15, vampire: 0.15, pyromancer: 0.15, disruptor: 0.1, splitter: 0.2, minelayer: 0.15, shielder: 0.1 },
    boss: { tank: 0.2, striker: 0.15, disruptor: 0.2, tactician: 0.15, pyromancer: 0.1, minelayer: 0.2 },
  },

  // --- Enemy AI ---
  ai: {
    difficulty: 0.5, // 0 = easy, 1 = hard
    // Aim error (EnemyAI): the enemy targets a spot up to aimOffsetPx away
    // from you (scaled by 1 - difficulty), then wobbles the launch a little
    aimOffsetPx: 170,
    maxErrorDegrees: 8,
    maxPowerError: 0.12,
    thinkDelay: 0.8,
    simulationSteps: 200,
    simulationDt: 1 / 60,
  },

  // --- Turn timing ---
  turn: {
    minTurnTime: 0.3,
  },

  // --- Battle abilities (used every few turns) ---
  abilities: {
    overdrive: {
      id: 'overdrive',
      name: 'OVERDRIVE',
      desc: 'Next shot deals 1.5x damage (+50% bonus damage)',
      cooldown: 3, // turns between uses
      duration: 1, // applies to next shot
      damageMult: 1.5,
      color: '#e8a94c',
    },
    barrier: {
      id: 'barrier',
      name: 'DEPLOY BARRIER',
      desc: 'Place a protective barrier shield',
      cooldown: 4, // turns between uses
      maxActive: 2, // max barriers on the field at once
      color: '#7aa2ff',
    },
  },

  // --- Roguelike run modifiers ---
  run: {
    maxHpBase: 100,
    atkBase: 1,
    defBase: 0,
    maxDefCap: 15, // DEF cap = 60% damage reduction
    hpRegenPerRest: 35, // HP restored at a Rest node
    hpRegenMaxPct: 0.5, // ... but capped at 50% of max HP
    shopDiscountPerVisit: 0.9, // ×0.9 gold cost per shop visit (stacks)
  },

  // --- Roguelike map generation ---
  map: {
    floors: 5,
    rows: 5, // 5 rows for 4-directional grid
    cols: 5, // 5 columns centered on row 2, col 2
    baseFloorActions: 5, // 5 actions minimum per floor
    colGap: 180, // horizontal spacing between columns
    rowGap: 125, // vertical spacing between rows
    nodeRadius: 28,
    floorWidth: 1280, // floor map canvas width
    floorHeight: 750, // floor map canvas height
  },

  // --- Arenas: see core/Arenas.js (random layout per battle) ---

  // --- Currency ---
  currency: {
    techPointName: 'Tech Points',
    goldName: 'Gold',
    startGold: 30,
  },


  // --- Curses (taken at Curse Shrines in exchange for an epic relic) ---
  curses: [
    { id: 'curse_frail', name: 'FRAIL', desc: '-15 max HP.' },
    { id: 'curse_hunted', name: 'HUNTED', desc: 'Enemies +10% ATK.' },
    { id: 'curse_wounds', name: 'OPEN WOUNDS', desc: 'Healing -20%.' },
    { id: 'curse_lost', name: 'LOST', desc: '-1 move on each new floor.' },
  ],

  // --- Operation conditions: one random twist per run ---
  runConditions: [
    { id: 'gold_rush', name: 'GOLD RUSH', desc: '+30% gold, but enemies +10% HP.' },
    { id: 'heavy_gravity', name: 'HEAVY GRAVITY', desc: 'Gravity +20%: shots drop faster.' },
    { id: 'low_gravity', name: 'LOW GRAVITY', desc: 'Gravity -20%: shots fly further.' },
    { id: 'supplied', name: 'WELL SUPPLIED', desc: 'Start with a random relic.' },
    { id: 'glass_war', name: 'GLASS WAR', desc: 'Everyone deals +30% damage.' },
    { id: 'scouted', name: 'SCOUTED', desc: '+1 move on every floor.' },
    { id: 'blood_moon', name: 'BLOOD MOON', desc: 'Enemies +15% ATK, but +50% Tech Points from battles.' },
    { id: 'calm', name: 'CALM SKIES', desc: 'No wind in any arena.' },
  ],

  // --- Relics (run-scoped collectibles): defined in meta/Relics.js ---
  relics: RELICS,

  // --- Roguelike node definitions ---
  nodes: {
    // Appearance weights per floor
    floorWeights: {
      1: { combat: 6, encounter: 3, shop: 1, rest: 1, minigame: 1, elite: 1, treasure: 1, gamble: 1 },
      2: { combat: 4, encounter: 3, shop: 2, rest: 2, minigame: 1, elite: 2, treasure: 1, gamble: 1, shrine: 1 },
      3: { combat: 4, encounter: 2, shop: 2, rest: 2, minigame: 1, elite: 2, treasure: 1, gamble: 1, shrine: 1 },
      4: { combat: 3, encounter: 2, shop: 2, rest: 1, minigame: 1, elite: 3, treasure: 1, gamble: 1, shrine: 1 },
      5: { combat: 3, encounter: 2, shop: 2, rest: 2, minigame: 1, elite: 3, treasure: 1, gamble: 1, shrine: 1 },
    },
    rewards: {
      combat: { gold: 12, tech: 1, healMax: 20 },
      elite: { gold: 25, tech: 2, healMax: 30 },
      miniboss: { gold: 50, tech: 4, healMax: 30, relics: 2 },
      boss: { gold: 40, tech: 4, healMax: 50 },
      encounter: { gold: 8, tech: 1, minHpLoss: 5, maxHpLoss: 14 },
      minigame: { gold: 15, tech: 1 },
      shop: {},
      rest: {},
    },
  },

  // --- AI-generated quests (complete during roguelike runs) ---
  quests: [
    { id: 'quest_first_blood', name: 'First Blood', desc: 'Deal damage to an enemy in a combat node', reward: 1 },
    { id: 'quest_one_turn_win', name: 'One Shot', desc: 'End a combat in a single turn without taking damage', reward: 2 },
    { id: 'quest_no_damage', name: 'Untouchable', desc: 'Win a combat node without taking damage', reward: 3 },
    { id: 'quest_speed_win', name: 'Blitz', desc: 'Win a combat in 3 turns or fewer', reward: 2 },
    { id: 'quest_shopping', name: 'All In', desc: 'Spend 40+ Gold at shops across one run', reward: 2 },
    { id: 'quest_boss_kill', name: 'Slayer', desc: 'Defeat a boss node', reward: 4 },
    { id: 'quest_minigame', name: 'Precision', desc: 'Win a minigame node with perfect timing', reward: 2 },
    { id: 'quest_perfect', name: 'Flawless Run', desc: 'Reach floor 5 without losing a combat', reward: 5 },
    { id: 'quest_elite', name: 'Elite Killer', desc: 'Defeat an elite combat node', reward: 3 },
    { id: 'quest_rest', name: 'Recovery', desc: 'Use a Safe Zone node to heal 40+ HP in one run', reward: 1 },
    { id: 'quest_bounce', name: 'Pinball', desc: 'Hit an enemy after a wall bounce', reward: 1 },
    { id: 'quest_lowhp', name: 'Survivor', desc: 'Win a combat with 10 HP or less', reward: 3 },
  ],

  // --- Permanent Tech Tree (bought with Tech Points) ---
  // Each branch is a real tree: one root, two paths that split off it, and a
  // capstone that needs both paths. `col`/`row` place the node on the
  // branch graph (cols 0-3 left to right, rows 0-2 top to bottom);
  // `requires` lists nodes that need at least one rank first.
  techTree: {
    // ATK branch
    atk_sharpshooter: { id: 'atk_sharpshooter', label: 'Sharpshooter', desc: 'Increases damage dealt (+3% per rank)', maxLevel: 10, costs: [6, 10, 14, 18, 22, 28, 34, 40, 48, 56], branch: 'atk', icon: 'DMG', col: 0, row: 1, requires: [] },
    atk_base_power: { id: 'atk_base_power', label: 'Base ATK Core', desc: 'Increases Base ATK (+2.5% damage per rank)', maxLevel: 10, costs: [8, 12, 16, 20, 26, 32, 40, 48, 58, 70], branch: 'atk', icon: 'ATK', col: 1, row: 0, requires: ['atk_sharpshooter'] },
    atk_armor_pen: { id: 'atk_armor_pen', label: 'Armor Penetration', desc: 'Direct ball impacts ignore enemy DEF (+8% per rank)', maxLevel: 10, costs: [10, 14, 18, 24, 30, 38, 46, 56, 68, 82], branch: 'atk', icon: 'PEN', col: 1, row: 2, requires: ['atk_sharpshooter'] },
    atk_risk_resonance: { id: 'atk_risk_resonance', label: 'Risk Resonance', desc: 'Deals extra damage per Risk Level (+0.5% per rank)', maxLevel: 10, costs: [12, 16, 20, 26, 34, 42, 52, 64, 78, 94], branch: 'atk', icon: 'RSK', col: 2, row: 0, requires: ['atk_base_power'] },
    atk_ballistic_apex: { id: 'atk_ballistic_apex', label: 'Ballistic Apex', desc: 'Fast impacts hit harder: up to +2% damage per rank at top speed', maxLevel: 10, costs: [14, 18, 24, 30, 38, 48, 60, 74, 90, 108], branch: 'atk', icon: 'APX', col: 2, row: 2, requires: ['atk_armor_pen'] },
    atk_crit: { id: 'atk_crit', label: 'Critical Mass', desc: 'CAPSTONE: +6% critical hit chance per rank (crits deal 1.75x)', maxLevel: 3, costs: [40, 70, 110], branch: 'atk', icon: 'CRT', col: 3, row: 1, requires: ['atk_risk_resonance', 'atk_ballistic_apex'], capstone: true },

    // VITALITY branch
    vit_health: { id: 'vit_health', label: 'Vitality', desc: 'Increases Max HP (+10 HP per rank)', maxLevel: 10, costs: [6, 10, 14, 18, 22, 28, 34, 40, 48, 56], branch: 'vit', icon: 'HP', col: 0, row: 1, requires: [] },
    vit_overflow_shield: { id: 'vit_overflow_shield', label: 'Overflow Shielding', desc: 'Healing past max HP becomes a shield that soaks damage (cap +5% max HP per rank)', maxLevel: 10, costs: [8, 12, 16, 20, 26, 32, 40, 48, 58, 70], branch: 'vit', icon: 'SHD', col: 1, row: 0, requires: ['vit_health'] },
    vit_emergency_medkit: { id: 'vit_emergency_medkit', label: 'Emergency Medkit', desc: 'Once per battle, heal when you drop below 25% HP (+5 HP per rank)', maxLevel: 10, costs: [10, 14, 18, 24, 30, 38, 46, 56, 68, 82], branch: 'vit', icon: 'MED', col: 1, row: 2, requires: ['vit_health'] },
    vit_titan_core: { id: 'vit_titan_core', label: 'Titan Core', desc: 'Safe Zone nodes restore more HP (+5% per rank) & gain Max HP (+2 per rank)', maxLevel: 10, costs: [12, 16, 20, 26, 34, 42, 52, 64, 78, 94], branch: 'vit', icon: 'TTN', col: 2, row: 0, requires: ['vit_overflow_shield'] },
    vit_vampiric_vitality: { id: 'vit_vampiric_vitality', label: 'Vampiric Vitality', desc: 'Heal for a share of the damage you deal (+1.5% per rank, affected by Risk)', maxLevel: 10, costs: [14, 18, 24, 30, 38, 48, 60, 74, 90, 108], branch: 'vit', icon: 'VMP', col: 2, row: 2, requires: ['vit_emergency_medkit'] },
    vit_second_wind: { id: 'vit_second_wind', label: 'Second Wind', desc: 'CAPSTONE: once per run, a lethal blow leaves you at 20% HP with a Forcefield (+15% HP per extra rank)', maxLevel: 2, costs: [50, 90], branch: 'vit', icon: 'SWD', col: 3, row: 1, requires: ['vit_titan_core', 'vit_vampiric_vitality'], capstone: true },

    // DEFENSE branch
    def_aegis: { id: 'def_aegis', label: 'Aegis', desc: 'Increases Base DEF (+1 DEF per rank)', maxLevel: 10, costs: [6, 10, 14, 18, 22, 28, 34, 40, 48, 56], branch: 'def', icon: 'DEF', col: 0, row: 1, requires: [] },
    def_matrix_pct: { id: 'def_matrix_pct', label: 'Aegis Amplifier', desc: 'Increases Total DEF (+3% DEF per rank)', maxLevel: 10, costs: [8, 12, 16, 20, 26, 32, 40, 48, 58, 70], branch: 'def', icon: 'AMP', col: 1, row: 0, requires: ['def_aegis'] },
    def_kinetic_dampener: { id: 'def_kinetic_dampener', label: 'Kinetic Dampener', desc: 'Take less damage from every source (-2% per rank)', maxLevel: 10, costs: [12, 16, 22, 28, 36, 46, 58, 72, 88, 106], branch: 'def', icon: 'KIN', col: 1, row: 1, requires: ['def_aegis'] },
    def_thorns_resist: { id: 'def_thorns_resist', label: 'Thorns Dampener', desc: 'Reduces damage reflected by Wall Units (-8% per rank)', maxLevel: 10, costs: [10, 14, 18, 24, 30, 38, 46, 56, 68, 82], branch: 'def', icon: 'THN', col: 1, row: 2, requires: ['def_aegis'] },
    def_forcefield: { id: 'def_forcefield', label: 'Forcefield Barrier', desc: 'Start battles with a bubble that blocks 1 hit; it recharges every 13 turns (-1 turn per rank, min 5)', maxLevel: 10, costs: [12, 16, 20, 26, 34, 42, 52, 64, 78, 94], branch: 'def', icon: 'FLD', col: 2, row: 0, requires: ['def_matrix_pct'] },
    def_fortified_matrix: { id: 'def_fortified_matrix', label: 'Fortified Matrix', desc: 'Heavy hits (20+ DMG) grant bonus DEF for the battle (+0.5 DEF per rank, 3 stacks max)', maxLevel: 10, costs: [14, 18, 24, 30, 38, 48, 60, 74, 90, 108], branch: 'def', icon: 'MTX', col: 2, row: 2, requires: ['def_thorns_resist'] },
    def_counter: { id: 'def_counter', label: 'Counter Plating', desc: 'CAPSTONE: enemies that hit you take 15% of the damage back (+10% per extra rank)', maxLevel: 3, costs: [45, 75, 110], branch: 'def', icon: 'CTR', col: 3, row: 1, requires: ['def_forcefield', 'def_fortified_matrix'], capstone: true },

    // TACTICS branch
    tac_war_chest: { id: 'tac_war_chest', label: 'War Chest', desc: 'Increases Starting Gold (+8 Gold per rank)', maxLevel: 10, costs: [6, 10, 14, 18, 22, 28, 34, 40, 48, 56], branch: 'tac', icon: 'GLD', col: 0, row: 1, requires: [] },
    tac_merchant: { id: 'tac_merchant', label: 'Merchant Network', desc: 'Shop prices cost less (-2% per rank) & Rerolls cost less (-5% per rank)', maxLevel: 10, costs: [8, 12, 16, 20, 26, 32, 40, 48, 58, 70], branch: 'tac', icon: 'SHP', col: 1, row: 0, requires: ['tac_war_chest'] },
    tac_logistics: { id: 'tac_logistics', label: 'Field Logistics', desc: 'Skill & barrier cooldowns: -1 turn at rank 5, -2 turns at rank 10', maxLevel: 10, costs: [10, 14, 18, 24, 30, 38, 46, 56, 68, 82], branch: 'tac', icon: 'LOG', col: 1, row: 2, requires: ['tac_war_chest'] },
    tac_intellect: { id: 'tac_intellect', label: 'Tactical Intellect', desc: 'Earn extra Tech Points from all sources (+3% per rank)', maxLevel: 10, costs: [12, 16, 20, 26, 34, 42, 52, 64, 78, 94], branch: 'tac', icon: 'INT', col: 2, row: 0, requires: ['tac_merchant'] },
    tac_relic_synergy: { id: 'tac_relic_synergy', label: 'Relic Synergy', desc: 'Per relic held: +0.2% ATK, +0.2% Max HP and +0.03 DEF per rank', maxLevel: 10, costs: [14, 18, 24, 30, 38, 48, 60, 74, 90, 108], branch: 'tac', icon: 'SYN', col: 2, row: 2, requires: ['tac_logistics'] },
    tac_supply_drop: { id: 'tac_supply_drop', label: 'Supply Drop', desc: 'CAPSTONE: start every run with 1 random relic per rank', maxLevel: 2, costs: [55, 100], branch: 'tac', icon: 'SUP', col: 3, row: 1, requires: ['tac_intellect', 'tac_relic_synergy'], capstone: true },
  },

  // --- Roguelike boons (collected as map rewards) ---
  boons: [
    { id: 'boon_atk', name: 'Overcharge', desc: '+20% ATK.', color: '#ffcd75' },
    { id: 'boon_def', name: 'Hardened Shell', desc: '+4 DEF.', color: '#41a6f6' },
    { id: 'boon_hp', name: 'Colossus', desc: '+40 max HP.', color: '#a7f070' },
    { id: 'boon_greed', name: 'Greed', desc: '+25% gold, but -5 max HP.', color: '#ffcd75' },
    { id: 'boon_swift', name: 'Swift Loader', desc: '+15% launch power, +15% ATK.', color: '#c46fd6' },
    { id: 'boon_power', name: 'Long Draw', desc: '+15% launch power.', color: '#ef7d57' },
    { id: 'boon_regen', name: 'Regeneration', desc: 'Heal 10 HP after each battle won.', color: '#a7f070' },
  ],


  // --- Visuals: professional tactical palette ---
  colors: {
    skyTop: '#10151d',
    skyBottom: '#1d2634',
    ground: '#2a313d',
    groundDark: '#1e242e',
    player: '#7aa2ff',
    playerDark: '#3d5c8a',
    enemy: '#e0655c',
    enemyDark: '#7a302c',
    trajectory: 'rgba(122, 162, 255, 0.5)',
    hpBarBg: 'rgba(0, 0, 0, 0.5)',
    hpBarFg: '#7aa2ff',
    hpBarEnemyFg: '#e0655c',
    hpBarFgLow: '#e0655c',
    text: '#d6dde8',
    accent: '#e8a94c',
    dim: '#8a94a8',
  },
};