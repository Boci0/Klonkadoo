# Backlog

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
