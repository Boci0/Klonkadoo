# Backlog

## Next up (after v2.5.5, 2026-09-29)

1. **Abyss depth: OK for now.** On 2.5.3 the user reaches Abyss 6 (Risk XI, 2x ascended Phoenix, Leviathan,
   Medic drone) and that's intended: one mech shouldn't make a joke of the Abyss, going deeper should take
   more mechs or other builds. Don't soften it; `rxOut` (enemy heat/drain grows with depth) stays.
   On 2.5.6 the same player reached Abyss 11 (no Abyss changes since): user puts it down to ascending any
   part (2.5.2) and a kinder map roll. Depth swings run to run; judge Abyss balance on several runs.
2. **Abyss mode for tools/balance-sim.mjs.** The sim stops at floor 5: no Abyss depth scaling, no insanity,
   no reactor growth, so Abyss balance can't be checked headlessly. Add it before tuning the Abyss again.
3. **Wishlist.** Star parts you're hunting (Almanac / Rig); a WISHLIST! badge and sound on the pod card,
   never auto/SMART-salvaged, an inventory filter.
4. **Economy.** Deep Abyss runs on Risk XI pay thousands of Keys/scrap (user had 12k Keys) and raid T1 pays
   3000 Keys: trim payouts or add sinks. 2.5.6: one Abyss-11 run paid 2522 Keys + 8225 scrap + 22 pods;
   wallet at 21k Keys / 24.7k scrap.
5. **Ideas not started:** real online raid leaderboard (tiny free backend) instead of the simulated field;
   team fights (2v2 on the lane) for the endgame.
6. **Untested live:** AUTO RUN through the Abyss, 1-action SWAP, UPGRADE / SCRAP badges on pod cards.
7. **Heat drones.** Heat only has FIREFLY (common); phys goes to rare, energy to
   mythic. Add rare → mythic heat drones (heat-on-hit, maybe a shutdown/overheat angle) with their own art
   (24-wide HI_GRIDS in pixelIcons.js, like every part since 2.5.5).
8. **Torso (frame) variety.** 9 frames, mostly a stat ladder (Scout → Brawler → Titan → Colossus →
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
