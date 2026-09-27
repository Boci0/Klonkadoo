# KLONKADOO: Mech Roguelike

> A turn-based mech roguelike in the spirit of Super Mechs, built with HTML5 Canvas & JavaScript. (Formerly *Slingshot Ops*.)

[![Live Demo](https://img.shields.io/badge/Play_Now-Live_Demo-brightgreen?style=for-the-badge&logo=github)](https://boci0.github.io/Slingshot-OPS/)
[![Download](https://img.shields.io/github/v/release/Boci0/Slingshot-OPS?style=for-the-badge&label=Download&logo=github)](https://github.com/Boci0/Slingshot-OPS/releases/latest)
<!-- Google Play badge (hidden while the game ships on GitHub only):
[![Google Play](https://img.shields.io/badge/Android-Google_Play-3DDC84?style=for-the-badge&logo=googleplay&logoColor=white)](https://play.google.com/store/apps/details?id=com.slingshotops.game)
-->
[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)

---

## Overview

**KLONKADOO** is a turn-based mech roguelike. Build pixel mechs from parts, bring a team of up to three, and fight enemy mechs that play by exactly the same rules on a 12-position battle lane, across a branching 5-floor campaign and the Abyss below it.

---

## Key Features

- **Mechs Built From Parts**: Frame, Legs, Armor, two Guns, a Drone and two Mods. What you equip is what you see on the field, and what the enemy sees.
- **Lane Combat**: Two actions a turn on a 12-position lane: walk or jump (your legs decide how far), fire each gun once, STOMP an adjacent mech, raise a BARRIER, or VENT to cool down.
- **Heat & Energy, Super Mechs style**: Every shot costs energy and heat. Start a turn over your heat cap and you lose it; drain a mech's energy past zero and it bleeds HP.
- **Cover**: Walls block walking and direct fire; lobs arc over, beams burn through. Arenas bring spikes and mines too.
- **Teams**: A garage of up to three mechs. SWAP takes your turn; a knocked-out mech's replacement drops in, and every mech keeps its own HP through the run.
- **Physical / Explosive / Electric Damage**: Explosive hits pile on heat, Electric hits drain energy, and armor resists each type separately.
- **Enemy Mechs**: No special abilities. Every hostile is a loadout of real parts, from Scattergun Wall Units to the bolted-down Sector Commander, and at the bottom of the Abyss, KLONKADOO PRIME.
- **Branching Tactical Node Map**: Procedurally generated 5-floor campaign with Combat, Elite, Boss, Encounter, Shop, Rest and Cache nodes, then 5 Abyss floors and an endless descent.
- **Progression Through Gear**: Win Keys to open supply pods (61 parts, odds shown) and scrap to upgrade parts to level 10. Never real money.

---

## Download

Grab the latest build from **[Releases](https://github.com/Boci0/Slingshot-OPS/releases/latest)**:

- **Android**: `Klonkadoo-x.y.z.apk`. Allow installs from your browser / file manager when asked.
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
| **Move** | Tap a lit plate (green = walk, blue = jump) |
| **Fire** | Tap a gun chip, or [Q] / [E] |
| **Stomp / Barrier / Vent** | Tap the button, or [F] / [B] / [V] |
| **Swap mech** | Tap a mech in the team bar (takes the whole turn) |
| **End turn** | END TURN, or [Space] |
| **Select Node** | Click a node on the campaign map |

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

- `src/core/` — Lane battle engine, arenas, event bus
- `src/entities/` — Mech units
- `src/systems/` — Turn system & damage calculation
- `src/ai/` — Enemy turn planner (LaneAI): tries every action sequence and looks one turn ahead
- `src/rogue/` — Run state management & procedural map generator
- `src/meta/` — Rig parts and enemy loadouts, quests, medals, mastery, save state
- `src/rendering/` — Canvas arena renderer & tactical map renderer
- `src/ui/` — DOM overlay, HUD, shop, & modal UI manager
- `src/config.js` — Game balance data, enemies, boons and color palette
