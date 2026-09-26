# SLINGSHOT OPS

> A tactical ballistic-combat roguelike built with HTML5 Canvas & JavaScript.

[![Live Demo](https://img.shields.io/badge/Play_Now-Live_Demo-brightgreen?style=for-the-badge&logo=github)](https://boci0.github.io/Slingshot-OPS/)
[![Download APK](https://img.shields.io/badge/Android-Download_APK-3DDC84?style=for-the-badge&logo=android&logoColor=white)](https://github.com/Boci0/Slingshot-OPS/raw/main/apk/Slingshot-OPS.apk)
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

**[Download Slingshot-OPS.apk](https://github.com/Boci0/Slingshot-OPS/raw/main/apk/Slingshot-OPS.apk)**

1. Open the link above on your Android phone to download the APK.
2. Open the downloaded file and allow installs from unknown sources if asked.
3. The game runs in landscape.

To rebuild the APK yourself (needs the Android SDK):

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
