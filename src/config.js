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
    dmgScale: 13, // gun/drone damage vs the part numbers (x10 since 2.3: HP and damage are big numbers so upgrades show)
    hpScale: 10, // HP on parts, repairs and every fixed HP / damage number (spikes, burn, mines, events) x this
    // Heat and energy: every reactor number on parts (costs, pools, regen, cooling, heat in, drain) is x this (Mech.PARTS).
    // 2.6 numbers rework: SuperMechs Reloaded magnitudes (a Mythic reactor ~250 cap / ~75 per turn, shots ~15-50)
    // and ratios (a Physical build fires ~2 shots a turn forever, Explosive / Electric ~1.5 on a standard frame)
    rxScale: 3,
    enemyDmgScale: 0.75, // enemy guns hit this much of a same-level player gun (x enemyGunShare by fight tier)
    // By fight tier: a normal fight ~15% of your HP in 3-5 turns, an elite pair ~40% in 5-8,
    // a mini-boss ~50%, the boss and its escorts ~60% in 10-12 (at the gear Risk expects; tools/balance-sim.mjs --fights)
    enemyGunShare: { combat: 0.675, elite: 0.445, miniboss: 0.45, boss: 0.36 },
    droneHealCap: 0.14, // repair drones fix at most this share of max HP per battle (2.10: was 0.2, a must-pick)
    enemyHpScale: 4.46, // every enemy's HP (2.6: normal fights 3-5 of your turns, elites 5-8, bosses 10-12; tools/balance-sim.mjs --fights)
    exposedMult: 1.25, // rammed targets take +25% gun damage until their next turn
    // SuperMechs rules (2.10). Heat never cools on its own: COOLDOWN is an action (heat - your cooling).
    // A turn that starts over the heat cap opens with a forced cooldown (1 action left), or, when it's over
    // by more than the cooling, a double cooldown that skips the turn. Energy refills at the END of your turn.
    // Heat never stops you firing; energy does (a gun needs its cost).
    // Damage types (Mech.DTYPES): Explosive hits add heat to the target, Electric hits drain its energy:
    // the gun's own number, else dtypeLoad x the hit. Neither is cut by resists. Drain past an empty
    // battery comes off HP (breakHp per point: SuperMechs 1:1).
    dtypeLoad: { heat: 0.2, energy: 0.45 }, // heat / drain per point of battle damage, by damage type (SuperMechs: drain ~half the hit)
    breakHp: 1,
    // Resists are flat (SuperMechs): every round loses resScale x the target's resist points of its type
    // (DEF counts for every type), but at least resFloor of the round always gets through (Mech.flatResist)
    resScale: 7,
    resFloor: 0.4,
    // Gun costs by damage type, on the catalog's en / heat (SuperMechs Reloaded, Mythic medians:
    // Physical 31 heat / 13 energy, Explosive 44 / 13, Electric 13 / 47): Physical runs on heat
    gunCost: { phys: { en: 0.4, heat: 1 }, heat: { en: 1, heat: 1 }, energy: { en: 1, heat: 1 } },
    // Frames and reactor modules: regen (refill per turn) and cooling (per COOLDOWN) x these
    rigScale: { regen: 1, cool: 1 },
    // Heat and drain ENEMY guns push into you: their gun's full numbers (not their softer hits) x floor x Risk x this
    enemyRx: { heat: 1, energy: 0.33 },
    ramSpeed: 380, // impact speed (px/s) that counts as a ram
    shotGap: 0.45, // seconds between an enemy's actions, so you can follow them
    actions: 2, // actions per turn: WALK / JUMP, FIRE a gun (each gun once per turn), DEPLOY a drone, COOLDOWN, STOMP...
    stompHeat: 12, // STOMP heat for legs that don't set their own (stompHeat on the legs part)
    // Build: one load cap for every mech; up to overweightMax kg over costs HP per kg, past that you can't deploy
    loadCap: 1000,
    overweightMax: 10,
    overweightHp: 20,
    dmgSpread: 0.2, // every hit rolls mean ±20% (SuperMechs Reloaded: min-max is about ±21-25%)
    // Tiers: max level per tier (common..mythic); each tier up multiplies stats, levels add up to one more step
    tierLevelCap: [5, 10, 15, 20, 25, 30], // ... mythic, ascended
    tierStep: 1.25, // +25% per tier, and a tier's levels add up to one more step (a transformed common lands near a native legendary)
    transform: { parts: [2, 3, 4, 5], scrap: [20, 60, 150, 400] }, // from common, rare, epic, legendary
    // Energy pool / refill per turn, heat cap / cooling per turn when no frame sets them
    baseRig: { energy: 90, regen: 42, heatCap: 90, cool: 36 },
    // Enemy reactors by tier: bigger threats sustain more fire
    enemyRig: {
      combat: { energy: 90, regen: 36, heatCap: 100, cool: 34 },
      elite: { energy: 110, regen: 42, heatCap: 120, cool: 40 },
      miniboss: { energy: 130, regen: 48, heatCap: 140, cool: 46 },
      boss: { energy: 150, regen: 54, heatCap: 160, cool: 52 },
    },
  },

  // --- Enemy archetypes (roles): a paint job and a loadout per damage type (Mech.ENEMY_LOADOUTS) ---
  // No special abilities: everything an enemy does comes from its parts.
  // defBonus is DEF against every damage type, on top of its armor's resists.
  enemyArchetypes: {
    standard: {
      name: 'HOSTILE UNIT', desc: 'A close gun and a long one, light armor.',
      hpMult: 1, atkMult: 1, defBonus: 0, aiShift: 0,
      color: '#e0655c', darkColor: '#a83b35',
    },
    tank: {
      name: 'WALL UNIT', desc: 'Thick hull on treads, a charge, and guns that shove you around: keep your distance.',
      hpMult: 1.25, atkMult: 0.9, defBonus: 1, aiShift: -0.025,
      color: '#4a6572', darkColor: '#263238',
    },
    striker: {
      name: 'SNIPER UNIT', desc: 'A long gun with a close one for backup (the big gun on elites).',
      hpMult: 1.05, atkMult: 1.2, defBonus: 0, aiShift: 0.075,
      color: '#f57c00', darkColor: '#e65100',
    },
    vampire: {
      name: 'REAPER UNIT', desc: 'Hooks you in, hits hard up close, and a Medic Drone keeps it going.',
      hpMult: 1.2, atkMult: 1.05, defBonus: 0, aiShift: 0.025,
      color: '#d32f2f', darkColor: '#8b0000',
    },
    pyromancer: {
      name: 'BLAZE UNIT', desc: 'Explosive specialist: heats you until you lock up, then cashes it in.',
      hpMult: 1.15, atkMult: 1.15, defBonus: 0, aiShift: 0.05,
      color: '#ff5722', darkColor: '#bf360c',
    },
    disruptor: {
      name: 'SURGE UNIT', desc: 'Electric specialist: drains your energy until your guns jam.',
      hpMult: 1.2, atkMult: 1.0, defBonus: 1, aiShift: 0.04,
      color: '#7b1fa2', darkColor: '#4a148c',
    },
    tactician: {
      name: 'COMMAND UNIT', desc: 'A hook, a close gun and guns for mid and long range.',
      hpMult: 1.3, atkMult: 1.05, defBonus: 1, aiShift: 0.06,
      color: '#ffb300', darkColor: '#ff8f00',
    },
    corroder: {
      name: 'ACID UNIT', desc: 'Strips your resist to its own damage type, then keeps hitting.',
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
  // Floor scaling (floorScaling) is applied on top, and CONFIG.risk.ease softens
  // everything at low Risk (half HP and damage at Risk 0). Tuned so a Risk 10 player
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
    // Elites: that floor's hostile, made clearly tougher (they used to be one fixed line, weaker than a
    // floor 5 hostile once split into a pair). Mech.enemyTier builds them.
    elite: { hpMult: 0.69, atkMult: 1.05, def: 1, ai: 0.04 },
    miniboss: { hp: 240, atk: 1.02, def: 4, aiDifficulty: 0.62 }, // one mech, but below the whole boss fight (2.10: was 345, a wall on floor 3)
    boss: { hp: 145, atk: 1.08, def: 5, aiDifficulty: 0.70 },
  },

  // --- Floor scaling (applies to every enemy, shown to the player) ---
  // Floor N enemies get +hp% and +atk% per floor above the first.
  floorScaling: { hpPerFloor: 0.10, atkPerFloor: 0.07 },

  // --- Risk levels: each level adds one rule on top of the ones below ---
  // Unlocked one at a time by winning a run on the highest unlocked level.
  // Each level also grants +scrapPerLevel% scrap and +keysPerLevel% Keys from battles.
  risk: {
    scrapPerLevel: 15,
    keysPerLevel: 10, // +10% Keys per level (fractions carry over between fights)
    // Resist shredders get more common with Risk: the Acid Unit's odds x (1 + roleGrowth x level), and from
    // gunFrom up, elites / mini-bosses / bosses may bring a shredder of their type on top of their guns
    // (gunPerLevel for each level from gunFrom: Risk XI = 35%). Mech.riskShred reads it.
    shred: { roleGrowth: 0.3, gunFrom: 5, gunPerLevel: 0.05 },
    // Enemy strength per Risk level (HP and gun damage x curve[level]), on top of the
    // level rules below. Fitted with tools/balance-sim.mjs (2.6, skill 1 = AUTO at its best, mid gear)
    // so ONE mech climbs a straight ramp (~96% of runs won at Risk 0, ~90% at I, down to ~8% at XI)
    // against the gear players have by then: max-level parts at Risk 1-4, one tier up at 5-6, two
    // tiers up at 7-9, three at 10-XI. It dips at 9-XI because those rules already pile on; teams do
    // better. Aim eases from `ai` at Risk 0 to none at `fullAt`. The Abyss is always full strength (1).
    // Gear got stronger per level in 2.3 (tierStep 1.12 -> 1.25): enemy HP / ATK x this per Risk level, from the
    // gear players have there (max level at I-IV, one tier up at V-VI, two from VII; tools/balance-sim.mjs).
    // The Abyss uses its run's Risk level.
    gearComp: { hp: [1, 1.12, 1.12, 1.12, 1.12, 1.27, 1.27, 1.41, 1.41, 1.41, 1.41, 1.41], atk: [1, 1.04, 1.04, 1.04, 1.04, 1.2, 1.2, 1.25, 1.25, 1.25, 1.25, 1.25],
      // 2.6: frame cooling / regen grow x tierStep per tier, so the heat / drain enemies push grows with the tiers expected
      rx: [1, 1, 1, 1, 1, 1.25, 1.25, 1.5, 1.5, 1.5, 1.95, 1.95] },
    // 2.10 (SuperMechs rules): Risk 9 is mid gear's ceiling, 10 bites a maxed single mech (~40-55%), XI is
    // brutal for a maxed TEAM of three (~35%: the user's real save, tools/balance-sim.mjs --kit, skill 1,
    // draft boons; OBLIVION doubles the earlier rules). A lone mech hardly survives XI.
    ease: { hp: 0.5, atk: 0.5, ai: -0.2, fullAt: 12, curve: [0.5, 0.77, 0.845, 0.86, 0.85, 0.895, 0.93, 1, 0.975, 1.1, 1.6, 2.45] },
    levels: [
      { name: 'HARDENED', desc: 'Enemies +15% HP.', hpPct: 15 },
      { name: 'RANGEFINDERS', desc: 'Enemy guns reach 1 position further.', enemyReach: 1 },
      { name: 'SCARCITY', desc: '-20% gold.', minusGold: 20 },
      { name: 'BRUTAL', desc: 'Enemies +15% ATK.', atkPct: 15 },
      { name: 'THIN SUPPLIES', desc: 'Healing -25%.', minusHeal: 25 },
      { name: 'INFLATION', desc: 'Shop prices +25%.', plusCost: 25 },
      { name: 'ELITE GUARD', desc: 'Elites & bosses +25% HP.', eliteHpPct: 25 },
      { name: 'GLASS ARMOR', desc: 'You take +15% damage.', plusDmgTaken: 15 },
      { name: 'VETERANS', desc: 'Enemies +20% HP and ATK.', hpPct: 20, atkPct: 20 },
      { name: 'NIGHTMARE', desc: 'Elites & bosses +35% ATK, and every enemy starts with its drone out.', eliteAtkPct: 35, droneOut: true },
    ],
    // Hidden Risk 11: unlocked by winning on Risk 10 without fighting a
    // single common hostile (elites, mini-bosses and the boss only).
    // Hinted at in the Risk panel, the RULES list and the results screen.
    secret: {
      name: 'OBLIVION',
      desc: 'Every rule above counts double. All hostiles are elites that pierce half your DEF and cool faster. Double Keys, scrap and pods.',
      rewardMult: 2, // keys, scrap and Abyss pods x this (so it's worth the pain; not gold)
      hint: 'Win on Risk 10 without fighting a common hostile. Sneaking past is fine.',
      doubleRules: true, // Risk I-X count twice (HP, ATK, elite HP / ATK, reach, gold, healing, prices, damage taken)
      defPierce: 0.5,
      allElite: true,
      gunCdCut: 1, // enemy reactors cool +4 x rxScale heat per turn (the old gun cooldown cut; Mech.enemyRig)
    },
  },
  // --- Abyss (Risk 10 and XI only): wardens and Klonkadoo Prime may drop Abyss Shards,
  // which lift any max-level Mythic part to ASCENDED. Abyss floors drive enemies insane.
  abyss: {
    shardMinRisk: 10,
    // chance per kill and how many drop: Risk 10 a little lower than Risk XI
    shards: {
      warden: { 10: 0.4, 11: 0.55, amount: [1, 1] },
      prime: { 10: 0.8, 11: 1, amount: [2, 4] },
    },
    // Abyss enemies skip the Risk curve (gear compensation only), then x this: fitted in 2.6 so a maxed
    // team goes as deep as on 2.5.9 (tools/balance-sim.mjs --abyss=20 with a real kit, against the old numbers).
    // Raised in 2.10: the SuperMechs rules (no stagger/blackout) made it easier; x2.4 puts a real 3-mech Risk X
    // team back at 2.9.0's depth (median floor ~14, 1 in 4 past floor 16)
    strength: { hp: 2.4, atk: 2.4 },
    reactorPerDepth: 0.04, // enemy heat cap + battery per Abyss depth (their cooling and regen stay)
    ascend: { shards: 5, scrap: 800 }, // one Mythic LV 25 part (any type) -> ASCENDED LV 1
    insanity: { dmgPerTurn: 0.01, hpPerTurn: 0.01 }, // every turn (yours and theirs): enemies +1% damage, the one on the lane -1% max HP
  },

  // --- Weekly raid (meta/Raid.js): one giant boss a week, its HP pool carries over between attempts ---
  raid: {
    unlockRisk: 4, // Risk levels unlocked (4 = Risk 3 beaten)
    // Boss HP pool for the week: ~100 maxed mechs' worth (tools/balance-sim.mjs --raid: a maxed
    // mythic mech ~8-9k per attempt alone, a team of 3 ~14-24k)
    pool: 900000,
    enragePerTurn: 0.08, // the boss hits 8% harder every turn, compounding (x4.7 by turn 20, x10 by 30): every attempt ends with your team down
    atk: 2.2, // boss damage: floor 5 boss numbers x this
    reach: 2, // +max range on every boss gun (a giant can't be kited)
    rigMult: { heat: 2, energy: 1.25 }, // heat cap + cooling, energy + regen: a boss rig this many times over (a focused team locks it a turn or two per attempt)
    // Simulated field: the share of players (top %) who reach each fraction of the pool.
    // Your weekly damage is ranked on a smooth curve through these points.
    field: [[0.5, 0.3], [2, 0.12], [8, 0.05], [25, 0.015], [60, 0.004], [100, 0]],
    // Tiers by rank (top %), best first; effects = copies of the week's effect
    tiers: [
      { top: 1, keys: 3000, scrap: 12000, effects: 3 },
      { top: 5, keys: 2200, scrap: 9000, effects: 2 },
      { top: 15, keys: 1600, scrap: 6400, effects: 2 },
      { top: 40, keys: 1000, scrap: 4000, effects: 1 },
      { top: 100, keys: 500, scrap: 2000, effects: 1 },
    ],
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
    maxHpBase: 1400,
    atkBase: 1,
    defBase: 0,
    maxDefCap: 15, // DEF cap = 60% damage reduction
    // Odds that a win offers a boon draft (pick 1 of 3), at most one per floor (main.js rollDraft).
    // The final boss ends the sector instead.
    boonDraftChance: { combat: 0.12, elite: 1, miniboss: 1 },
    hpRegenRestPct: 0.5, // Safe Zone restores 50% of max HP (winning battles no longer heals)
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
    { id: 'overcharged', name: 'OVERCHARGED GRID', desc: 'Every mech refills +50 energy per turn.' },
    { id: 'heatwave', name: 'HEATWAVE', desc: 'Every COOLDOWN removes 15 less heat.' },
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
      1: { combat: 6, encounter: 3, shop: 1, rest: 2, elite: 1, treasure: 1, gamble: 1 },
      2: { combat: 4, encounter: 4, shop: 2, rest: 2, elite: 2, treasure: 1, gamble: 1 },
      3: { combat: 4, encounter: 3, shop: 2, rest: 2, elite: 2, treasure: 1, gamble: 1 },
      4: { combat: 3, encounter: 3, shop: 2, rest: 2, elite: 3, treasure: 1, gamble: 1 },
      5: { combat: 3, encounter: 3, shop: 2, rest: 2, elite: 3, treasure: 1, gamble: 1 },
    },
    rewards: {
      // scrap upgrades parts on the Rig screen; Keys come from Mech.tokenReward
      combat: { gold: 16, scrap: 4 }, // + a clean-win bonus (main.js)
      elite: { gold: 25, scrap: 10 },
      miniboss: { gold: 50, scrap: 16 },
      boss: { gold: 40, scrap: 20 },
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
    { id: 'quest_rest', name: 'Recovery', desc: 'Heal 1500+ HP at Safe Zones in one run', reward: 5 },
    { id: 'quest_lowhp', name: 'Survivor', desc: 'Win a combat with 100 HP or less', reward: 15 },
  ],

  // --- Roguelike boons (collected as map rewards; one of each per run, they don't stack) ---
  // Elite / miniboss wins (and some normal wins) offer a pick of 3 (rogue/Boons.js draftBoons).
  // `tag`: the damage type a boon builds around (drafts lean toward your guns' types).
  // `fx`: battle effects for the whole team, summed by Boons.boonFx and read by Game and LaneAI:
  //   closeDmg (gun damage at range <= 2), physPierce (share of phys resist ignored), physStrip (PHY resist points
  //   each of your physical hits strips for the fight),
  //   heatOut / drainOut (heat / drain your hits put in), capCut (your first heat hit cuts the target's
  //   heat cap by this share), heatLock (a mech you heat loses this share of its cooldowns next turn), siphon
  //   (share of drained energy you get), elecCost (share off your Electric guns' energy cost), farDmg (gun damage at range >= 4), lowHpDmg (vs a mech under half HP),
  //   cool / regen (your reactor), secondWind (a forcefield the first time you drop under 30% HP).
  boons: [
    { id: 'boon_atk', name: 'Overcharge', desc: '+6% ATK.', color: '#ffcd75', icon: 'dmg' },
    { id: 'boon_def', name: 'Hardened Shell', desc: '+1.5 DEF.', color: '#41a6f6', icon: 'def' },
    { id: 'boon_hp', name: 'Colossus', desc: '+400 max HP.', color: '#a7f070', icon: 'hp' },
    { id: 'boon_greed', name: 'Greed', desc: '+25% gold, but -50 max HP.', color: '#ffcd75', icon: 'gold' },
    { id: 'boon_swift', name: 'Swift Loader', desc: '+4% ATK, +1 walk.', color: '#c46fd6', icon: 'move' },
    { id: 'boon_power', name: 'Long Barrel', desc: '+1 max range on every gun, and +15% gun damage at range 4 or more.', color: '#ef7d57', icon: 'range', fx: { farDmg: 0.15 } },
    { id: 'boon_regen', name: 'Regeneration', desc: 'Repair 10% of max HP after each battle won.', color: '#a7f070', icon: 'heal' },
    { id: 'boon_glass', name: 'Glass Cannon', desc: '+15% ATK, but -300 max HP.', color: '#ff5d73', icon: 'skull' },
    { id: 'boon_execute', name: 'Executioner', desc: '+35% damage to mechs under half HP.', color: '#ff5d73', icon: 'skull', fx: { lowHpDmg: 0.35 } },
    { id: 'boon_close', name: 'Point Blank', desc: '+30% gun damage at range 1-2.', color: '#ffcd75', icon: 'dmg', fx: { closeDmg: 0.3 } },
    { id: 'boon_wind', name: 'Second Wind', desc: 'The first time each of your mechs drops under 30% HP in a battle, it gets a forcefield.', color: '#a7f070', icon: 'def', fx: { secondWind: 1 } },
    // Physical: raw damage and stripped resists
    { id: 'boon_ap', name: 'AP Rounds', desc: 'Physical hits ignore three quarters of the target\'s physical resist.', color: '#f4f4f4', icon: 'pierce', tag: 'phys', fx: { physPierce: 0.75 } },
    { id: 'boon_sledge', name: 'Sledge Rounds', desc: 'Each of your Physical hits strips half a point of PHY resist, for the rest of the fight.', color: '#f4f4f4', icon: 'resdrain', tag: 'phys', fx: { physStrip: 0.5 } },
    // Explosive: heat, forced cooldowns and shutdowns
    { id: 'boon_incin', name: 'Incinerator', desc: 'Your hits put in 30% more heat.', color: '#ef7d57', icon: 'heatin', tag: 'heat', fx: { heatOut: 0.3 } },
    { id: 'boon_flash', name: 'Flashpoint', desc: 'The first time you heat a mech in a battle, its heat cap drops by 25%.', color: '#ef7d57', icon: 'heat', tag: 'heat', fx: { capCut: 0.25 } },
    { id: 'boon_lock', name: 'Thermal Lock', desc: 'Mechs you heat lose 40% of their cooling on their next turn (forced cooldowns too).', color: '#ef7d57', icon: 'lock', tag: 'heat', fx: { heatLock: 0.4 } },
    { id: 'boon_coolant', name: 'Coolant Loop', desc: '+60% cooling.', color: '#ef7d57', icon: 'cool', tag: 'heat', fx: { cool: 0.6 } },
    // Electric: drain, starved guns and energy break
    { id: 'boon_overdrain', name: 'Overdrain', desc: 'Your hits drain 30% more energy.', color: '#73eff7', icon: 'drain', tag: 'energy', fx: { drainOut: 0.3 } },
    { id: 'boon_siphon', name: 'Siphon', desc: 'Half the energy you drain flows into your battery.', color: '#73eff7', icon: 'energy', tag: 'energy', fx: { siphon: 0.5 } },
    { id: 'boon_short', name: 'Short Circuit', desc: 'Your Electric guns cost 40% less energy.', color: '#73eff7', icon: 'arc', tag: 'energy', fx: { elecCost: 0.4 } },
    { id: 'boon_cells', name: 'Spare Cells', desc: '+40% energy regen.', color: '#73eff7', icon: 'regen', tag: 'energy', fx: { regen: 0.4 } },
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