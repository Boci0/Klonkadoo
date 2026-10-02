# Backlog

## Second wave of gear (2026-10-02, draft)

31 new parts, all built from fields and effects the game already handles (no new battle rules), so they
drop from pods by rarity and level and transform like the rest. Designs are original.
- **Frames (4):** Hauler (common, hull over reactor), Warden (rare, +1 to every resist), Gunner (epic,
  +6% damage), Zenith (mythic, +10% damage on a deep reactor). New torso sprites and on-field sizes.
- **Legs (5):** Pogo (hop only), Quad Walker, Grounded Greaves (+1 EXP / ELEC resist), Piston (stomp 22),
  Stalker (walk 3 + hop 1-2, no move cost). New leg sprites.
- **Side guns (7):** Stinger, Arc Welder, Slag Gun, Plasma Cutter, Verdict Pistol (execute below 50%),
  Volt Arc, Helix Chaingun.
- **Top guns (8):** Slingshot, Chain Mortar, Tracer Beam, Brimstone Mortar, Gravity Well, Orbital Lance,
  Pyre Launcher, Citadel Breaker.
- **Drones (5):** Patcher (small repair), Lancer (ignores resists), Cinder (burns), Bastion (forcefield
  every 2nd turn), Wraith (pierce + drain).
- **Modules (6):** Gunsight, Rebound Plate, Adrenal Injector, Pressure Valve, Ward Mesh, Rebirth Core.
- **Checked:** tools/tier-report.mjs (new parts rank with their rarity, except ammo / splash guns and
  perk frames, which the report already flags the same way for older parts), tools/weight-report.mjs,
  vite build, a stat / chip sweep over every part at every tier.
- **Open:** enemies do not use the new parts yet (loadouts unchanged, so Risk tuning is untouched); the new
  guns, drones and modules reuse existing icons in a new colour, only frames and legs have new art.

## SuperMechs battle rules, mastery 50, drones and boons (2026-10-01, built, v2.10)

The user: heat / energy / physical were "totally not like" SuperMechs, "not just damage, but how the mech
actually handle it". Rules read from the community SuperMechs simulators (ctrlraul/supermechs-workshop,
Tankaregmi/workshop-unlimited, which agree). The user picked full rules, no STAGGER / BLACKOUT, flat resists.
- **Turns:** heat never cools by itself; COOLDOWN is a 1-action button (heat - cooling). Over the cap at
  turn start: a forced cooldown eats 1 action; over by more than the cooling: double cooldown, turn lost.
  Energy refills at the END of your turn (after drones). Heat never blocks firing; energy does.
- **Damage:** flat resists, taken once per shot (burst guns share it), at least 40% of a round gets through
  (resScale 7, resFloor 0.4). Heat-in and drain are flat per gun, not resisted (dtypeLoad heat 0.2,
  energy 0.45); enemy heat / drain from their gun's full numbers (enemyRx heat 1, energy 0.33), enemy
  reactors grow with floor and Risk (enemyRig rx). Energy break 1:1. Hits roll +-20%.
- **Costs (gunCost):** Physical guns run on heat (energy x0.4), like Reloaded.
- **Planner:** values forced cooldowns / shutdowns, anticipates incoming heat, cools before it overheats.
  The sim, the intent forecast and Game share the rules (intent: guns 99.6%, damage 97%, KOs 8/8 warned).
- **Difficulty (sim, skill 1, draft):** Risk curve [.., 1.1, 1.6, 2.45]: starter R0 ~95%, mid gear R8 98% /
  R9 ~58% / R10 0%, a maxed single mech R10 40-54%, and **R11 tuned to a maxed TEAM of three: the user's
  real save wins ~36%** (was 98-100%); a lone mech hardly survives XI. Miniboss base HP 345 -> 240 (it was
  bigger than the whole boss fight).
- **The user's save** (3x double Phoenix Claw + Medic, mech 1 ascended): v2.9.0 sim R11 98% wins but
  0% past Abyss 4 = KLONKADOO PRIME (all-Electric) blacking out their guns (v2.8.1 blackout); matches
  the user ("stuck at abyss 4"). BLACKOUT is gone in 2.10.
- **Abyss strength 1.5 -> 2.4:** without the Prime wall that team went deeper than on 2.9 (Risk X median
  floor 17-19 vs 14). x2.4 brings it back (median 13, 53% past floor 13, 20% past 16, 0% past 20).
- **Mastery:** PILOT tile + screen (off the Deploy screen), max 50, slower curve (L20 ~24 strong runs,
  L50 ~200), L2-20 as before, L21-50 small steps + 8 milestones, GRANDMASTER paint. Old saves keep their
  level (banked XP past 20 dropped: the user chose that).
- **Drones:** damage drones ~1.6x (enemy drones unchanged via foeDmg), Medic cap 20% -> 14% of max HP per
  battle (Hornet = Medic at mid gear, Reaper > Medic at endgame).
- **Boons** (gain on the kit they suit, sim): general +8..+26, Physical AP +14 / Sledge (strip 0.5 PHY)
  +12, Explosive Flashpoint +20 / Thermal Lock +17 / Incinerator +13 / Coolant +10, Electric Siphon +15 /
  Overdrain +11 / Cells +10 / Short Circuit (Electric guns -40% energy) +4. Greed is economy.
- **Tools:** tools/sim-batch.mjs (configs in parallel, one per core); balance-sim --draft, --enemyHeat,
  --enemyDrain, --resScale, --resFloor, heat / cooldown / shots-per-turn lines in --fights.
- **Open:** Short Circuit is the weakest Electric pick; Napalm deals a bit more than intent forecasts.

## Enemy intent (2026-10-01, released in v2.9.0)

During your turn a badge over the enemy shows its next turn if you ended yours now: icons for each action
(move, the gun it fires, stomp, vent, drone launch / shots, jammed) and the damage you'd take before you act
again; a red skull when a high roll (+-dmgSpread) could knock you out; green "OVERHEATED / STAGGERED: TURN
LOST". Hover / tap for the words. Game.intent / _forecast, Renderer._drawIntent.
- **It's a commitment, not a guess:** the enemy's random choices for its turn are rolled at the start of yours
  (Game._enemySeed, seededRng) and _enemyAct plans with them, so the forecast runs the same planner with the
  same rolls, action by action. It changes only when you change the situation.
- Covers your drones at your turn end (upkeep heat, their hits can stagger / jam / overheat it), its burn,
  overheat, stagger, regen, cooling, Thermal Lock, Short Circuit, its drones, edge slams (LaneAI `slam`, only
  on in the forecast so the planner's own play is unchanged) and your next burn tick.
- **Measured in the dev server** (scripted fights F2-F5, random moves / shots / drones, ~250-400 turns):
  guns it fires match 97-99%, damage within 20% on 93-96%, lost turns 100% (the misses: a real damage roll
  shifts a later re-plan). `_aiUnit` now passes the stagger bar to the planner (AUTO sees it too).

## Boon draft (2026-10-01, released in v2.9.0)

Runs gave few choices (7 boons, random single drops), so wins now offer a **pick of 3** (UIManager.showBoonDraft),
**one draft per floor**: the first elite or miniboss win, or a 12% normal win (CONFIG.run.boonDraftChance,
main.js rollDraft). 21 boons (CONFIG.boons), 14 new, built around each element's identity, all run-only:
- General: Glass Cannon, Executioner, Point Blank, Second Wind.
- Physical: AP Rounds (ignore half phys resist), Sledge Rounds (stagger bar fills 50% faster).
- Explosive: Incinerator (+30% heat in), Flashpoint (first heat hit: heat cap -15%), Thermal Lock (mechs you
  heat cool 40% less next turn), Coolant Loop.
- Electric: Overdrain (+30% drain), Siphon, Short Circuit (a mech you black out skips its next regen), Spare Cells.

Drafts lean toward your guns' damage types and always hold one card of your main type (rogue/Boons.js);
AUTO RUN picks with Boons.pickBoon. Effects live in `fx` (Boons.boonFx), applied in Game (_weaponHit,
_reactorFx, _upkeep, _secondWind) and mirrored in LaneAI so AUTO and the sim see them.

**Measured** (`--draft=old|new` in tools/balance-sim.mjs, mid gear max level tierUp 3, skill 1, 400 runs):
each element's boons are worth +10 to +26 pts alone at Risk XI on their kit. Whole runs vs the old drops:
Risk 5 unchanged (96-100%), Risk 10 +7 to +15, Risk XI +10 to +35 (Explosive kit 27% -> 62%, mid 43% -> 62%).
**Open:** Risk XI got easier. Note the Risk curve refit (v2.6.0) was calibrated without boons, and the old
drops already moved mid gear R XI from ~24% to 43%. Decide from real runs whether to tighten Risk X-XI.

## DONE: the numbers rework (decided 2026-09-29, released as v2.6.0 the same day)

**Status: released in v2.6.0.** Watch real runs (Abyss depth, Risk ramp) and retune from play. rxScale 3, gun costs by damage
type, costs and frame regen/cooling x tierStep per tier, frame reactors on a x1.28-per-rarity ladder,
dtypeLoad per type, breakHp, gearComp.rx, enemyGunShare, enemy HP cut, Risk curve refit (skill 1, mid
gear: 97% R0 -> ~10% XI), Abyss strength x1.5 (a real Risk XI kit goes as deep as on 2.5.9 in the sim),
run save flag v26.

Re-derive the game's core numbers from SuperMechs Reloaded's ratios instead of "the old numbers x10"
(CONFIG.gear hpScale 10 / rxScale 10 / dmgScale 13). Its own release. The user's calls:
- **Fights are short:** an elite takes you **5-8 turns**, a boss ~10-12 (today 15-20 and 14-17).
- **You rarely overheat from your own guns:** only when you over-fire; overheating mostly comes from
  Explosive enemies heating you (that's what makes the element scary).
- **Heavy frames** (already in 2.5.9): the frame is a third of the 1000 kg cap.

**Measured today** (`node tools/balance-sim.mjs 200 --fights=1 --gear=mid --gearLvl=max --tierUp=3 --skill=1 --risk=10`,
the per-fight ratio line was added for this):
- Risk 10-11: you lose **40-57% of your turns to overheat**, enemies 0-9%. Enemy HP is 2.2-3x yours
  (5.5-8.6k vs ~2.4-2.7k). Fights run 14-20 turns. This is also why the sim never beats the floor 5
  boss (old item "balance-sim: nobody beats the floor 5 boss"): the planner, which AUTO uses too,
  overheats half the time. Enemies run on their own reactors (CONFIG.gear.enemyRig) that never starve.
- Risk 0: fights are one-sided (enemies would need 40-200 turns to kill you).

**How the numbers work now** (read before changing): hit = dmg x dmgScale x roll ±15% x crit 1.75 x ATK,
then resists cut a **percentage** (4%/point, cap 15 = 60%; SuperMechs subtracts resist flat).
Explosive heats / Electric drains 50% of the hit (dtypeLoad), drain past 0 hits HP. Reactor: regen and
cool once per turn; over the cap at turn start = turn lost, still over after cooling = shutdown.
VENT = 2x cooling, ends the turn. Enemies: HP = tier x enemyHpScale 7.5 x archetype x Risk; guns at
enemyDmgScale 0.5 of a same-level player gun (their own foeDmg where set); reactors from enemyRig.
Gun costs (en / heat) are fixed at every tier; frame reactors never grow (Mech.partStats).

**SuperMechs Reloaded reference** (`sh tools/supermechs/fetch.sh`, then `node tools/supermechs/weapons.cjs`;
tools/supermechs/load.cjs loads every item; docs/supermechs-research.md has the weight notes):
- Mythic lv50: torso HP ~1000-1100, energy cap/regen ~265/76, heat cap/cool ~265/76; plating 315 HP;
  side guns 250-320 per hit at melee, ~200 at 3-6, top 4-8 ~260; costs per shot: Physical 31/31,
  Explosive 16 en / 47 heat, Electric 47 / 16; heat ~30% / drain ~40% of the hit; hit roll ~±25%.
- Growth: a gun's **cost is fixed within a tier and x1.5-1.8 per tier step**; damage at level 1 of
  each tier jumps by about the same, so every tier starts at the same damage per cost and levels make
  it more efficient. Torso / module energy and heat **caps** grow with level and tier, **regen / cooling**
  only per tier (x1.4-1.7). Torso HP grows with both.

**Plan:**
1. A ratio tool (extend the sim's --fights line): hits to kill, shots a full reactor supports, shots per
   turn it sustains (regen / cost, cooling / heat), turns to lock an enemy with heat or drain; for real
   builds at every tier, player and enemies.
2. Pick targets from the calls above and SuperMechs: e.g. ~1.5 shots/turn sustained, a full tank covers a
   2-gun burst for a few turns, elites 5-8 of your turns, bosses 10-12, enemy HP ~1-1.5x yours (bosses more).
3. Rebuild base scales (HP, damage, caps, regen, cooling, costs, resists; flat resists are an option) with
   SuperMechs-like magnitudes, and growth: gun costs x tierStep per tier (not per level), frame reactors
   grow (caps with level + tier, regen/cool per tier) so high-tier guns stay fireable.
4. Enemies get their own pass (enemyRig, enemyHpScale, enemyDmgScale, Risk curve) to land on the targets.
5. Check with tools/tier-report.mjs (rarity ranks at best form), tools/weight-report.mjs, the sim
   (--fights and runs, Risk 0 / 5 / 10 / 11, team 1-3), then the game in the browser. Saves keep their
   items: everything goes through partStats, so no save migration should be needed; check the Rig numbers.

## Next up (after v2.5.9, 2026-09-29)

1. **Abyss depth: OK for now.** On 2.5.3 the user reaches Abyss 6 (Risk XI, 2x ascended Phoenix, Leviathan,
   Medic drone) and that's intended: one mech shouldn't make a joke of the Abyss, going deeper should take
   more mechs or other builds. Don't soften it; `rxOut` (enemy heat/drain grows with depth) stays.
   On 2.5.6 the same player reached Abyss 11 (no Abyss changes since): user puts it down to ascending any
   part (2.5.2) and a kinder map roll. Depth swings run to run; judge Abyss balance on several runs.
2. **balance-sim: nobody beats the floor 5 boss.** 2026-09-29: `--skill=1 --gear=mid --gearLvl=max --tierUp=3`
   at Risk 10 team 2 / Risk 11 team 3 / Risk 5 solo all win 0%; every run that reaches the boss dies there.
   Likely cause found: the planner loses ~50% of its turns to overheat (see the numbers rework above).
   Re-check after the rework; if it still can't win, look at presets / enemy HP / boss loadout.
3. ~~Abyss mode for tools/balance-sim.mjs~~ done (2.6): `--abyss=N` (depth scaling, insanity, reactor growth,
   keepers, Klonkadoo Prime), `--fights --depth=N`, `--kit=a.json,b.json` (one per garage mech). The sim is
   ~4x harsher than a human down there (a real team at Abyss 13-17 clears ~3 in the sim): compare versions,
   not absolute depth.
4. **Wishlist.** Star parts you're hunting (Almanac / Rig); a WISHLIST! badge and sound on the pod card,
   never auto/SMART-salvaged, an inventory filter.
5. **Economy.** Deep Abyss runs on Risk XI pay thousands of Keys/scrap (user had 12k Keys) and raid T1 pays
   3000 Keys: trim payouts or add sinks. 2.5.6: one Abyss-11 run paid 2522 Keys + 8225 scrap + 22 pods;
   wallet at 21k Keys / 24.7k scrap.
6. **Ideas not started:** real online raid leaderboard (tiny free backend) instead of the simulated field;
   team fights (2v2 on the lane) for the endgame.
7. **Untested live:** AUTO RUN through the Abyss, 1-action SWAP, UPGRADE / SCRAP badges on pod cards.
8. **Heat drones.** Heat only has FIREFLY (common); phys goes to rare, energy to
   mythic. Add rare → mythic heat drones (heat-on-hit, maybe a shutdown/overheat angle) with their own art
   (24-wide HI_GRIDS in pixelIcons.js, like every part since 2.5.5).
9. **Torso (frame) variety.** 9 frames, mostly a stat ladder (Scout → Brawler → Titan → Colossus →
    Leviathan). Only Furnace (heat) and Conduit (energy) are element-built, both rare; Phantom (free first
    shot) and Reclaimer (heal on kill) are the only ones with a perk. Add frames with a real identity per
    element and tier (e.g. an epic+ heat and energy frame, a phys frame), each with its own perk and art.
10. **Tips & tricks.** Optional, discoverable hints (e.g. an Almanac page or a rotating tip on the DEPLOY / loading
    screen), never pushed at the player. First entry: Risk 10 is the Abyss Shard farm (deep dives, Klonkadoo Prime),
    Risk XI the Keys / scrap / pods farm (double rewards, shallow Abyss). The user wants players to find this out
    themselves first, so tips stay opt-in.

## Play Console recommendations (from release 1 / 1.0.0, 2026-09-26)

Not blocking publishing; fix in a later release.

### 1. Edge-to-edge may not display for all users
Android 15+ (target SDK 35+) draws apps edge-to-edge by default.
- Today `MainActivity` calls `WindowCompat.setDecorFitsSystemWindows(..., false)` and the CSS pads with
  safe-area insets, so it already works in practice.
- Fix: call `EdgeToEdge.enable(this)` (androidx.activity) in `MainActivity.onCreate` before `super.onCreate`,
  then drop the manual `setDecorFitsSystemWindows` call. Test on a phone with a notch / gesture bar.

### 2. App uses deprecated edge-to-edge APIs or parameters
Probably from:
- The `StatusBar` plugin config in `capacitor.config.json` (`overlaysWebView`, `backgroundColor`), which ends up
  calling `Window.setStatusBarColor`, deprecated in Android 15.
- `getWindowManager().getDefaultDisplay()` in `MainActivity.requestHighestRefreshRate()` (the pre-Android 11 path).
- Fix: remove the StatusBar color settings (the bars are hidden in immersive mode anyway), and possibly the
  `@capacitor/status-bar` plugin itself. Then rebuild and check the Play Console warning is gone.

### 3. Remove resizability and orientation restrictions (large screens)
- The game locks `sensorLandscape`, and the manifest sets
  `PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY` to keep that lock on Android 16 tablets and foldables.
- That opt-out only works while targeting SDK 36. Android 17 (SDK 37) ignores it, so this must be done
  before targeting SDK 37.
- Fix: make the layout work in portrait and in resizable windows (split screen, foldables, tablets).
  Battle and minigame canvases already scale (`viewport.js`); the menu, map, Rig and tech screens need
  portrait layouts. Then remove the property and the orientation lock.
