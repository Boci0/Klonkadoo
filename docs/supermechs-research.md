# SuperMechs research notes

Reference notes on SuperMechs (TacticSoft; Kongregate / mobile / Steam), the game KLONKADOO is based on.
Sources: super-mechs.fandom.com (Tactics and General Info, Eamb's Reloaded guide, Workshop, Arena, Campaign).

## Build slots
- Torso (most HP + stats, most important to upgrade), Legs (walk / jump / stomp, some HP).
- 4 side weapons (sustained, short-mid range), 2 top weapons (long range burst).
- 6 specials: drone (auto damage every turn), teleport, charge engine (dash + knockback + dmg),
  grappling hook (pull enemy + dmg), shield (legacy, removed from arena).
- Modules: HP/armor, resistance, energy, heat, hybrid. No armor slot; modules carry the stats.
- Weight cap 1000 kg. Every 1 kg over = -15 HP, hard cap 1010 kg (-150 HP).
- Pros rarely fill all 6 weapons: 4 weapons (2 top + 2 side or 3 side + 1 top) and spend weight on modules.

## Weight (Reloaded item data, 2026-09-29)
Source: supermechs.netlify.app post-Reloaded items list (js/sm_item_*.js: every item at every level).
- An item's weight never changes with level or tier.
- Share of the 1000 kg cap: torso 301-370 (a third; kg tracks HP, r=0.75), legs 114-150, side 18-86
  (median 52), top 19-75 (median 51), drones 20-57, specials 11-26, modules 15-51.
- Weapons: weight buys convenience, not damage (kg vs damage r=0.37 side, -0.62 top).
  Heaviest (70-86): no energy / no heat cost, knockback. Lightest (18-25): 1-2 uses per fight, even
  huge hitters (Falcon, 1 use, 797 dmg at M, 19 kg).
- Modules: survival is dear, the reactor cheap. Regen / cooling booster 15, capacity 22, dual reactor 25,
  one resist 28, HP plating 40, all three resists 51.
- Drones: the free-to-run ones (no energy or no heat cost) are the heavy ones.

## Stats and damage
- HP, Energy cap, Regen, Heat cap, Cooling, 3 resistances (physical / heat / energy).
- 3 damage elements: Physical, Heat, Energy. Advice: do not mix Heat and Energy; physical can pair with either.
- **Heat**: going over heat cap = overheat, skip turn(s) to cool (shutdown). Heat builds aim to lock the
  enemy in a shutdown loop. Rule of thumb: push the enemy above cap by more than 2x their cooling to double-shutdown.
- **Energy**: weapons need energy. Energy weapons drain energy cap/regen. At 0 energy, extra drain turns into
  bonus damage ("energy break").
- **Physical**: raw damage + resistance drain (Armor Destroyer). No resource lock, just kill fast.
- "Crusher" builds: drain cooling (heat) or regen (energy) so the enemy can never recover.
- Energy-free / heat-free weapons exist as a counter to draining (they cost the other resource instead).
- Archetypes: mono-element, hybrid (counter-counter), counters (one stat maxed, disliked as low effort),
  hugger (close the distance with charge/hook/teleport + melee + stomp).

## Battle
- Turn-based on a line of positions; distance matters. Each weapon has a range band (e.g. 1-2, 3-6, 4-8).
- Each mech gets two actions per turn (the heat guide depends on this).
- Stomp (legs) at range 1 pushes the enemy back. Pushback / pullback weapons and distance control are core tactics:
  force the enemy to waste turns walking.
- Good builds cover every range so they never have to waste a move.
- Hover on enemy items to inspect them; PvP turns have a 30 s timer.

## Progression / economy
- Rarities: Common, Rare, Epic, Legendary, Mythical, Divine. Mythical/Divine only by transforming, never dropped.
- Items have a max rarity; only upgrade items that reach the top (L-M / E-M items). Upgrade order:
  torso, legs, weapons, drone, modules, specials.
- Fusing: sacrifice items + gold to level up an item. At max level, transform to the next rarity, costing
  N items of that rarity + gold (Reloaded: 2 common/25k, 3 rare/25k, 4 epic/50k, 5 legendary/100k).
- Max-level gold cost grows steeply: common 720, rare ~10k, epic ~54k, legendary ~159k, mythical ~500k.
- Power kits: fuse fodder that gives more power than needed to max. Save them.
- Gold (soft), tokens (premium: boxes, colours, revive, premium account = +20% campaign HP).
- Silver boxes (gold, chance of epic), premium boxes (tokens, guaranteed epic, chance of legendary, exclusive items).
- Optional base: gold mines, factories, crafting. Enabling it disables silver boxes (early-game trap).

## Modes
- Campaign: 7 chapters, each ends in a boss mission (black-painted boss, minions first). 3 difficulties
  (Normal/Hard/Insane) = better enemy gear + rewards. Enemies: buggies, tanks, mechs. First clear gives tokens.
  1v1, 2v2, 3v3 campaigns. Fuel/energy cost per mission.
- Campaign mechs can go all-HP; PvP mechs need modules/specials against elements.
- Arena: rank-based matchmaking. Ranks 25-15 1v1, 15-5 2v2, top ranks rotate 3v3/2v2/1v1.
  First 5 daily wins give arena coins for permanent stat boosts. Replays of last 30 fights. Clan + player leagues.
- Raids, clans, daily missions, login rewards, events (gold portal).
