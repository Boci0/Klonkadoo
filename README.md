# SLINGSHOT OPS

> A tactical ballistic-combat roguelike built with HTML5 Canvas & JavaScript.

[![Live Demo](https://img.shields.io/badge/Play_Now-Live_Demo-brightgreen?style=for-the-badge&logo=github)](https://boci0.github.io/Slingshot-OPS/)
[![Download](https://img.shields.io/github/v/release/Boci0/Slingshot-OPS?style=for-the-badge&label=Download&logo=github)](https://github.com/Boci0/Slingshot-OPS/releases/latest)
<!-- Google Play badge (hidden while the game ships on GitHub only):
[![Google Play](https://img.shields.io/badge/Android-Google_Play-3DDC84?style=for-the-badge&logo=googleplay&logoColor=white)](https://play.google.com/store/apps/details?id=com.slingshotops.game)
-->
[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)

---

## Overview

**Slingshot OPS** is a turn-based mech roguelike. Build a pixel mech from parts, slingshot it across the arena into position, and fight enemy mechs that play by exactly the same rules, across a branching 5-floor campaign.

---

## Key Features

- **Mechs Built From Parts**: Frame, Legs, Armor, two Guns, a Drone and two Mods. What you equip is what you see on the field, and what the enemy sees.
- **Grounded Slingshot Movement**: Drag to launch low and land heavy. Your legs decide how far you can go; only Jump Jets can clear tall cover.
- **Gear-Only Combat**: Two actions a turn: move, fire a gun or vent. Every shot costs energy and heat, and the big guns carry limited ammo.
- **Physical / Heat / Energy Damage**: Heat hits cook the target's reactor, Energy hits drain it, and armor resists each type separately.
- **Enemy Mechs**: No special abilities. Every hostile is a loadout of real parts, from Scattergun Wall Units to the bolted-down Sector Commander.
- **Branching Tactical Node Map**: Procedurally generated 5-floor campaign with Combat, Elite, Boss, Encounter, Shop, Rest, Cache and Minigame nodes.
- **Progression Through Gear**: Win Keys to open supply pods (51 parts, odds shown) and scrap to upgrade parts to level 10. Never real money.

---

## Download

Grab the latest build from **[Releases](https://github.com/Boci0/Slingshot-OPS/releases/latest)**:

- **Android**: `SlingshotOps-x.y.z.apk`. Allow installs from your browser / file manager when asked.
- **Windows**: `Slingshot Ops_x.y.z_x64-setup.exe`. If SmartScreen appears, choose *More info → Run anyway*.
- **Browser**: play instantly at https://boci0.github.io/Slingshot-OPS/

Both apps check GitHub for new versions on launch (and via *Settings → Updates*) and update themselves in place. The game runs in landscape. Feedback: bocidev.support@gmail.com

### Releasing

```bash
npm version patch          # or minor / major: bumps package.json, commits, tags vX.Y.Z
git push --follow-tags     # the Release workflow builds the APK + Windows installer, then publishes
```

Every build takes its version from `package.json`. The workflow needs the signing secrets listed at the top of `.github/workflows/release.yml`.

### Local builds

```bash
npm run build:android && cd android && ./gradlew assembleDebug   # debug APK
npm run desktop          # Windows app in dev mode (needs Rust: https://rustup.rs)
npm run build:desktop    # Windows installer
```

<!-- Google Play (hidden while the game ships on GitHub only; set CONFIG.store = 'play' in src/config.js to restore the in-game links):

The Android version is on **Google Play** (currently in closed testing).

To join the test:

1. Join the tester group: https://groups.google.com/g/slingshot-ops-testers
2. Opt in: https://play.google.com/apps/testing/com.slingshotops.game
3. Install from Google Play: https://play.google.com/store/apps/details?id=com.slingshotops.game

The game runs in landscape. Feedback: bocidev.support@gmail.com

To build a local debug APK yourself (needs the Android SDK). Uninstall it before installing the Play version, since they're signed with different keys:

```bash
npm run build:android
cd android && ./gradlew assembleDebug
# output: android/app/build/outputs/apk/debug/app-debug.apk
```
-->

---

## Controls

| Action | Input |
| --- | --- |
| **Aim & Launch** | Click + Drag backward + Release |
| **Select Node** | Click node on campaign map |
| **Activate Abilities** | Click ability HUD buttons during turn |

---

## Technology Stack

- **Core**: Vanilla JavaScript (ES6+ Modules), HTML5 Canvas
- **Build Tool**: Vite
- **Deployment**: GitHub Pages

---

## Quick Start (Local Development)

```bash
# Clone the repository
git clone https://github.com/Boci0/Slingshot-OPS.git

# Navigate into the project folder
cd Slingshot-OPS

# Install dependencies
npm install

# Start local development server
npm run dev
```

---

## Project Architecture

- `src/core/` — Game loop, physics engine, event bus
- `src/entities/` — Ball units, barriers, and combat entities
- `src/systems/` — Turn system, collision system & damage calculation
- `src/ai/` — Enemy AI with trajectory simulation & difficulty scaling
- `src/rogue/` — Run state management & procedural map generator
- `src/meta/` — Rig parts and enemy loadouts, quests, medals, mastery, save state
- `src/rendering/` — Canvas arena renderer & tactical map renderer
- `src/ui/` — DOM overlay, HUD, shop, & modal UI manager
- `src/config.js` — Game balance data, enemies, boons and color palette
