# Backlog

## Next up (after v2.5.3, 2026-09-29)

1. **Check the Abyss after 2.5.3.** On 2.5.2 the user fell from Abyss 18 to Abyss 3 (Risk XI, Phoenix heat build).
   2.5.3 stopped enemy cooling/regen growing with depth (only heat cap + battery, +4%/depth). Ask how deep
   they get now; if still far off, look at what else 2.5.2 changed.
2. **Abyss mode for tools/balance-sim.mjs.** The sim stops at floor 5: no Abyss depth scaling, no insanity,
   no reactor growth, so Abyss balance can't be checked headlessly. Add it before tuning the Abyss again.
3. **Wishlist.** Star parts you're hunting (Almanac / Rig); a WISHLIST! badge and sound on the pod card,
   never auto/SMART-salvaged, an inventory filter.
4. **Bigger, more distinct part art.** Icons are small and many guns share a silhouette. Redraw in
   batches, most-used guns first (Super Mechs: the tile art is the part itself, ~70px).
5. **Economy.** Deep Abyss runs on Risk XI pay thousands of Keys/scrap (user had 12k Keys) and raid T1 pays
   3000 Keys: trim payouts or add sinks.
6. **Ideas not started:** real online raid leaderboard (tiny free backend) instead of the simulated field;
   team fights (2v2 on the lane) for the endgame.
7. **Untested live:** AUTO RUN through the Abyss, 1-action SWAP, UPGRADE / SCRAP badges on pod cards.

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
