# Backlog

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
10. **Tips & tricks.** Optional, discoverable hints (e.g. an Almanac page or a rotating tip on the DEPLOY / loading
    screen), never pushed at the player. First entry: Risk 10 is the Abyss Shard farm (deep dives, Klonkadoo Prime),
    Risk XI the Keys / scrap / pods farm (double rewards, shallow Abyss). The user wants players to find this out
    themselves first, so tips stay opt-in.
9. **Torso (frame) variety.** 9 frames, mostly a stat ladder (Scout → Brawler → Titan → Colossus →
    Leviathan). Only Furnace (heat) and Conduit (energy) are element-built, both rare; Phantom (free first
    shot) and Reclaimer (heal on kill) are the only ones with a perk. Add frames with a real identity per
    element and tier (e.g. an epic+ heat and energy frame, a phys frame), each with its own perk and art.

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
