# SLINGSHOT OPS

> A tactical ballistic-combat roguelike built with HTML5 Canvas & JavaScript.

[![Live Demo](https://img.shields.io/badge/Play_Now-Live_Demo-brightgreen?style=for-the-badge&logo=github)](https://boci0.github.io/Slingshot-OPS/)
[![Google Play](https://img.shields.io/badge/Android-Google_Play-3DDC84?style=for-the-badge&logo=googleplay&logoColor=white)](https://play.google.com/store/apps/details?id=com.slingshotops.game)
[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)

---

## Overview

**Slingshot OPS** is an action-strategy roguelike game where precision launching meets tactical node-based map traversal. Slingshot your operative ball at hostile units, utilize dynamic wall-bounces and overcharged abilities, acquire game-changing relics, and permanently upgrade your stats across runs.

---

## Key Features

- **Ballistic Combat System**: Real-time trajectory prediction, power dragging, elastic collisions, and physics-based damage scaling.
- **Branching Tactical Node Map**: Procedurally generated 5-floor campaign with Combat, Elite, Boss, Encounter, Shop, Rest, and Minigame nodes.
- **40+ Collectibles & Relics**: Build synergies across 8 unique categories (*Tactical*, *Gladiator*, *High-Tech*, *Frontier*, *Sanctuary*, etc.).
- **Persistent Tech Tree**: Earn Tech Points to unlock permanent upgrades across Sharpshooter (ATK), Vitality (HP), and Aegis (DEF).
- **Dynamic Quests & Encounters**: Interactive event choices with risk/reward mechanics and in-run objectives.

---

## Android

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
- `src/meta/` — Tech tree progression, quest system, save state
- `src/rendering/` — Canvas arena renderer & tactical map renderer
- `src/ui/` — DOM overlay, HUD, shop, & modal UI manager
- `src/config.js` — Game balance data, relic definitions, and color palette
