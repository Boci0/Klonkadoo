// ============================================================
// KLONKADOO — Central Game Configuration
// All tunable constants and content data (quests, enemies,
// boons, roguelike map rules) live here.
// ============================================================


export const CONFIG = {
  // --- Distribution ---
  // 'github': builds ship on GitHub Releases and every Google Play link is hidden.
  // 'play': restores the Play Store links (rate / share point to the listing).
  // Note Play forbids linking out to tip / donation pages from a Play app, so
  // in 'play' mode `donateUrl` only ever shows in the web build.
  store: 'github',
  update: {
    repo: 'Boci0/Klonkadoo', // GitHub owner/repo the in-app updater checks
  },

  // --- Support page (menu ♥) ---
  support: {
    playUrl: 'https://play.google.com/store/apps/details?id=com.slingshotops.game',
    releasesUrl: 'https://github.com/Boci0/Klonkadoo/releases/latest',
    webUrl: 'https://boci0.github.io/Klonkadoo/',
    feedbackEmail: 'bocidev.support@gmail.com',
    donateUrl: '', // e.g. 'https://ko-fi.com/yourname' (empty = hidden)
  },

  // --- World ---
  world: {
    width: 1280,
    height: 750,
    groundY: 620, // y-coordinate of the ground surface
    gravity: 1500, // px/s^2
    airDrag: 0.0012, // velocity damping per second (0 = none)
    // Mechs are heavy: they thud down, skid a little and stop (no ricochets)
    groundFriction: 0.4, // horizontal velocity kept on a landing
    rollDecel: 1100, // px/s^2 of skid braking while touching the ground
    groundRestitution: 0.12, // bounce factor off ground
    wallRestitution: 0.1, // bounce factor off side walls and cover
    ballRestitution: 0.3, // bounce factor between balls
    settleSpeed: 12, // px/s — below this both balls are "settled"
    settleTime: 0.5, // seconds both balls must be settled to end turn
  },

  // --- Ball / Character ---
  ball: {
    radius: 24, // base size; ball classes scale it (Balls.js radiusMult)
    maxHp: 100,
  },

  // --- Damage ---
  damage: {
    minImpactSpeed: 120, // below this, no damage on hit
    damagePerSpeed: 0.02, // damage = impactSpeed * this (e.g. 900px/s → 18 dmg)
    maxDamagePerHit: 30,
    hitCooldown: 0.4,
    defensePerPoint: 0.04, // damage reduction per DEF point (cap 60%)
    thornsReturn: 0.3, // tank enemy reflects 30% of damage taken
  },

  // --- The battle lane: positions 1..size, one mech per position ---
  lane: {
    size: 12,
    playerStart: 2,
    enemyStart: 11,
    walkTime: 0.2, // seconds per position walked
    jumpTime: 0.55, // seconds for a jump (any length)
    jumpHeight: 150, // world px at the top of a jump arc
    thinkTime: 0.6, // enemy pause before acting, so you can follow it
    settle: 0.4, // pause after an action resolves, before the turn passes
  },

  // --- Gear combat: guns are the only damage ---
  gear: {
    dmgScale: 1.3, // gun/drone damage vs the classic numbers (bodies no longer hit)
    enemyDmgScale: 0.4, // enemy guns hit this much of a same-level player gun
    exposedMult: 1.25, // rammed targets take +25% gun damage until their next turn
    // Damage types (Mech.DTYPES): Explosive hits add heat and Electric hits drain energy,
    // dtypeLoad x the hit; whatever the reactor can't absorb spills into HP at dtypeSpill x
    dtypeLoad: 0.5,
    dtypeSpill: 0.5,
    ramSpeed: 380, // impact speed (px/s) that counts as a ram
    shotGap: 0.45, // seconds between an enemy's actions, so you can follow them
    actions: 2, // actions per turn: WALK / JUMP, FIRE a gun (each gun once per turn), DEPLOY a drone; VENT takes the rest of the turn
    vent: { coolMult: 2, energyPct: 0 }, // VENT (cooldown): cools 2x your cooling; energy only comes from regen
    stompHeat: 4, // STOMP adds this much heat to the stomper
    // Energy pool / refill per turn, heat cap / cooling per turn when no frame sets them
    baseRig: { energy: 30, regen: 14, heatCap: 30, cool: 12 },
    // Enemy reactors by tier: bigger threats sustain more fire
    enemyRig: {
      combat: { energy: 28, regen: 13, heatCap: 32, cool: 11 },
      elite: { energy: 36, regen: 16, heatCap: 40, cool: 13 },
      miniboss: { energy: 42, regen: 18, heatCap: 46, cool: 15 },
      boss: { energy: 50, regen: 20, heatCap: 54, cool: 17 },
    },
  },

  // --- Enemy archetypes: a paint job and a loadout (Mech.ENEMY_LOADOUTS) ---
  // No special abilities: everything an enemy does comes from its parts.
  // defBonus is DEF against every damage type, on top of its armor's resists.
  enemyArchetypes: {
    standard: {
      name: 'HOSTILE UNIT', desc: 'Light gun, light armor.',
      hpMult: 1, atkMult: 1, defBonus: 0, aiShift: 0,
      color: '#e0655c', darkColor: '#a83b35',
    },
    tank: {
      name: 'WALL UNIT', desc: 'Titanium hull on treads or clamps. Scattergun and Repulsor: keep your distance.',
      hpMult: 1.5, atkMult: 0.9, defBonus: 1, aiShift: -0.025,
      color: '#4a6572', darkColor: '#263238',
    },
    striker: {
      name: 'SNIPER UNIT', desc: 'Long Rifle (Sniper Cannon on elites). Get close.',
      hpMult: 1.05, atkMult: 1.2, defBonus: 0, aiShift: 0.075,
      color: '#f57c00', darkColor: '#e65100',
    },
    vampire: {
      name: 'REAPER UNIT', desc: 'Plasma Scythe: huge damage, right next to you.',
      hpMult: 1.2, atkMult: 1.05, defBonus: 0, aiShift: 0.025,
      color: '#d32f2f', darkColor: '#8b0000',
    },
    pyromancer: {
      name: 'BLAZE UNIT', desc: 'Flamer and Mortar: Heat damage that cooks your reactor.',
      hpMult: 1.15, atkMult: 1.15, defBonus: 0, aiShift: 0.05,
      color: '#ff5722', darkColor: '#bf360c',
    },
    disruptor: {
      name: 'GRAVITON UNIT', desc: 'Grapple Hook drags you in, Cryo slows your launches.',
      hpMult: 1.2, atkMult: 1.0, defBonus: 1, aiShift: 0.04,
      color: '#7b1fa2', darkColor: '#4a148c',
    },
    tactician: {
      name: 'COMMAND UNIT', desc: 'Tesla Coil up close, Missile Pod from mid range.',
      hpMult: 1.3, atkMult: 1.05, defBonus: 1, aiShift: 0.06,
      color: '#ffb300', darkColor: '#ff8f00',
    },
    corroder: {
      name: 'ACID UNIT', desc: 'Acid strips your Physical resist, EMP drains your energy.',
      hpMult: 1.15, atkMult: 1.0, defBonus: 0, aiShift: 0.04,
      color: '#aeea00', darkColor: '#33691e',
    },
    minelayer: {
      name: 'MINE LAYER', desc: 'Mine Launcher: lobs mines beside you (3 per battle) that blast if you land on them.',
      hpMult: 1.1, atkMult: 0.9, defBonus: 0, aiShift: 0.02,
      color: '#ef7d57', darkColor: '#5d275d',
    },
  },

  // --- Enemy Tiers (Initial Base Enemy Stats per Floor) ---
  // Floor scaling (floorScaling) is applied on top. Tuned so a Risk 0 player
  // with no upgrades has to play well: a sloppy fight costs 40-60% HP and
  // runs are won with gear and good positioning. Enemies also tighten
  // their aim after each miss (Game: missStreak). aiDifficulty → measured hit
  // rate with the physics planner (EnemyAI): 0.4 ≈ 50%, 0.55 ≈ 67%, 0.7 ≈ 71%, 0.85 ≈ 96%.
  // HP +10% across the board to make room for gear (starter gear restores the old feel)
  enemyTiers: {
    1: { hp: 119, atk: 0.95, def: 0, aiDifficulty: 0.36 },
    2: { hp: 138, atk: 1.00, def: 1, aiDifficulty: 0.41 },
    3: { hp: 159, atk: 1.05, def: 1, aiDifficulty: 0.45 },
    4: { hp: 149, atk: 0.92, def: 2, aiDifficulty: 0.48 },
    5: { hp: 165, atk: 0.98, def: 3, aiDifficulty: 0.51 },
    elite: { hp: 185, atk: 1.05, def: 3, aiDifficulty: 0.55 },
    miniboss: { hp: 264, atk: 1.02, def: 4, aiDifficulty: 0.62 },
    boss: { hp: 330, atk: 1.08, def: 5, aiDifficulty: 0.70 },
  },

  // --- Floor scaling (applies to every enemy, shown to the player) ---
  // Floor N enemies get +hp% and +atk% per floor above the first.
  floorScaling: { hpPerFloor: 0.10, atkPerFloor: 0.07 },

  // --- Risk levels: each level adds one rule on top of the ones below ---
  // Unlocked one at a time by winning a run on the highest unlocked level.
  // Each level also grants +scrapPerLevel% scrap from battles.
  risk: {
    scrapPerLevel: 15,
    levels: [
      { name: 'HARDENED', desc: 'Enemies +15% HP.', hpPct: 15 },
      { name: 'SHARPSHOOTERS', desc: 'Enemies aim better.', aiBonus: 0.08 },
      { name: 'SCARCITY', desc: '-20% gold.', minusGold: 20 },
      { name: 'BRUTAL', desc: 'Enemies +15% ATK.', atkPct: 15 },
      { name: 'THIN SUPPLIES', desc: 'Healing -25%.', minusHeal: 25 },
      { name: 'INFLATION', desc: 'Shop prices +25%.', plusCost: 25 },
      { name: 'ELITE GUARD', desc: 'Elites & bosses +25% HP.', eliteHpPct: 25 },
      { name: 'GLASS ARMOR', desc: 'You take +15% damage.', plusDmgTaken: 15 },
      { name: 'VETERANS', desc: 'Enemies +20% HP and ATK.', hpPct: 20, atkPct: 20 },
      { name: 'NIGHTMARE', desc: 'Elites & bosses +35% ATK, enemies aim even better.', eliteAtkPct: 35, aiBonus: 0.08 },
    ],
    // Hidden Risk 11: unlocked by winning on Risk 10 without fighting a
    // single common hostile (elites, mini-bosses and the boss only).
    // Hinted at in the Risk panel, the RULES list and the results screen.
    secret: {
      name: 'OBLIVION',
      desc: 'Every hostile is an elite. Enemies +30% HP, +25% ATK, pierce half your DEF, guns reload faster.',
      hint: 'Win on Risk 10 without fighting a common hostile. Sneaking past is fine.',
      hpPct: 30,
      atkPct: 25,
      defPierce: 0.5,
      allElite: true,
      gunCdCut: 1,
    },
  },
  // Multi-enemy waves per node type + floor (1 to 3 enemies per stage)
  enemyCounts: {
    // Enemy teams (one fights at a time, the rest drop in): 1 normal, 2 elite, 3 boss
    combat: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 },
    elite: { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2 },
    miniboss: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 },
    boss: { 1: 3, 2: 3, 3: 3, 4: 3, 5: 3 },
  },
  // Archetype pick weights per floor (proportion of each type)
  archetypeWeights: {
    1: { standard: 0.6, tank: 0.2, striker: 0.2 },
    2: { standard: 0.3, tank: 0.15, striker: 0.15, vampire: 0.1, pyromancer: 0.1, corroder: 0.1, minelayer: 0.1 },
    3: { standard: 0.1, tank: 0.12, striker: 0.12, vampire: 0.1, pyromancer: 0.1, disruptor: 0.12, tactician: 0.1, corroder: 0.12, minelayer: 0.12 },
    4: { standard: 0.05, tank: 0.12, striker: 0.12, vampire: 0.12, pyromancer: 0.12, disruptor: 0.12, tactician: 0.12, corroder: 0.1, minelayer: 0.12 },
    5: { standard: 0.05, tank: 0.12, striker: 0.12, vampire: 0.12, pyromancer: 0.12, disruptor: 0.12, tactician: 0.12, corroder: 0.1, minelayer: 0.12 },
    elite: { tank: 0.14, striker: 0.14, vampire: 0.12, pyromancer: 0.12, disruptor: 0.12, tactician: 0.12, corroder: 0.1, minelayer: 0.14 },
    miniboss: { tank: 0.2, vampire: 0.2, pyromancer: 0.2, disruptor: 0.15, minelayer: 0.15, tactician: 0.1 },
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

  // --- Roguelike run modifiers ---
  run: {
    maxHpBase: 140,
    atkBase: 1,
    defBase: 0,
    maxDefCap: 15, // DEF cap = 60% damage reduction
    hpRegenPerRest: 35, // HP restored at a Rest node
    hpRegenMaxPct: 0.5, // ... but capped at 50% of max HP
    shopFloorMarkup: 0.12, // shop prices +12% per floor past the first (Abyss included)
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
    goldName: 'Gold',
    startGold: 30,
  },


  // --- Operation conditions: one random twist per run ---
  runConditions: [
    { id: 'gold_rush', name: 'GOLD RUSH', desc: '+30% gold, but enemies +10% HP.' },
    { id: 'overcharged', name: 'OVERCHARGED GRID', desc: 'Every mech refills +5 energy per turn.' },
    { id: 'heatwave', name: 'HEATWAVE', desc: 'Every mech cools 5 less heat per turn.' },
    { id: 'supplied', name: 'WELL SUPPLIED', desc: 'Start with a random boon.' },
    { id: 'glass_war', name: 'GLASS WAR', desc: 'Everyone deals +30% damage.' },
    { id: 'scouted', name: 'SCOUTED', desc: '+1 move on every floor.' },
    { id: 'blood_moon', name: 'BLOOD MOON', desc: 'Enemies +15% ATK, but +50% scrap from battles.' },
    { id: 'calm', name: 'OPEN GROUND', desc: 'Every arena is an open field: no spikes or mines.' },
  ],

  // --- Roguelike node definitions ---
  nodes: {
    // Appearance weights per floor
    floorWeights: {
      1: { combat: 6, encounter: 3, shop: 1, rest: 1, elite: 1, treasure: 1, gamble: 1 },
      2: { combat: 4, encounter: 4, shop: 2, rest: 2, elite: 2, treasure: 1, gamble: 1 },
      3: { combat: 4, encounter: 3, shop: 2, rest: 2, elite: 2, treasure: 1, gamble: 1 },
      4: { combat: 3, encounter: 3, shop: 2, rest: 1, elite: 3, treasure: 1, gamble: 1 },
      5: { combat: 3, encounter: 3, shop: 2, rest: 2, elite: 3, treasure: 1, gamble: 1 },
    },
    rewards: {
      // scrap upgrades parts on the Rig screen; Keys come from Mech.tokenReward
      combat: { gold: 16, scrap: 4, healMax: 20 }, // + a clean-win bonus (main.js)
      elite: { gold: 25, scrap: 10, healMax: 30 },
      miniboss: { gold: 50, scrap: 16, healMax: 30 },
      boss: { gold: 40, scrap: 20, healMax: 50 },
      encounter: { gold: 8, minHpLoss: 5, maxHpLoss: 14 },
      minigame: { gold: 15 },
      shop: {},
      rest: {},
    },
  },

  // --- Quests (complete during roguelike runs; reward = scrap) ---
  quests: [
    { id: 'quest_first_blood', name: 'First Blood', desc: 'Deal damage to an enemy in a combat node', reward: 5 },
    { id: 'quest_one_turn_win', name: 'One Shot', desc: 'End a combat in a single turn without taking damage', reward: 10 },
    { id: 'quest_no_damage', name: 'Untouchable', desc: 'Win a combat node without taking damage', reward: 15 },
    { id: 'quest_speed_win', name: 'Blitz', desc: 'Win a combat in 3 turns or fewer', reward: 10 },
    { id: 'quest_shopping', name: 'All In', desc: 'Spend 40+ Gold at shops across one run', reward: 10 },
    { id: 'quest_boss_kill', name: 'Slayer', desc: 'Defeat a boss node', reward: 20 },
    { id: 'quest_perfect', name: 'Flawless Run', desc: 'Reach floor 5 without losing a combat', reward: 25 },
    { id: 'quest_elite', name: 'Elite Killer', desc: 'Defeat an elite combat node', reward: 15 },
    { id: 'quest_rest', name: 'Recovery', desc: 'Use a Safe Zone node to heal 40+ HP in one run', reward: 5 },
    { id: 'quest_lowhp', name: 'Survivor', desc: 'Win a combat with 10 HP or less', reward: 15 },
  ],

  // --- Roguelike boons (collected as map rewards) ---
  boons: [
    { id: 'boon_atk', name: 'Overcharge', desc: '+20% ATK.', color: '#ffcd75' },
    { id: 'boon_def', name: 'Hardened Shell', desc: '+4 DEF.', color: '#41a6f6' },
    { id: 'boon_hp', name: 'Colossus', desc: '+40 max HP.', color: '#a7f070' },
    { id: 'boon_greed', name: 'Greed', desc: '+25% gold, but -5 max HP.', color: '#ffcd75' },
    { id: 'boon_swift', name: 'Swift Loader', desc: '+15% ATK, +1 walk.', color: '#c46fd6' },
    { id: 'boon_power', name: 'Long Barrel', desc: '+1 max range on every gun.', color: '#ef7d57' },
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