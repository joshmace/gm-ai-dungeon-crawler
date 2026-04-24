# Game Pack Format

A **Game Pack** is the unit of content for the GM-AI platform. It bundles everything needed to run an adventure: Setting, Rules, Bestiary, Items, Adventure Module, and Character.

## Manifest

The Game Pack is defined by a **manifest** JSON file (e.g. `game_pack.json`) with:

- **`id`** — Unique identifier (e.g. `gauntlet_rules_test_v1`). Used for save compatibility and character association; the localStorage save slot for a pack is keyed by this id.
- **`setting`** — Path to the Setting JSON.
- **`rules`** — Path to the Rules JSON.
- **`bestiary`** — Path to the Bestiary JSON.
- **`items`** — Path to the shared Items library JSON.
- **`adventure_module`** — Path to the Adventure Module JSON.
- **`character`** — Path to the starting character sheet.
- Optional sidecars: `setting.content`, `rules.guidance`, `module.guidance`, `character.guidance` — markdown files with extended lore / GM tips surfaced via `{{GUIDANCE_BLOCK}}`.

## Available Game Packs

- **The Haunting of Three Knots** — `game_pack_village_three_knots.json`. One-shot: village haunting, linear tomb (puzzle, trap, boss), reward at the inn. Uses `character_village_three_knots.json`. Set `CONFIG.GAME_PACK` to this file to play (current default).
- **Crow's Hollow** — `game_pack_lantern_and_blade.json`. Uses Ren Callory + `module_crows_hollow.json`.
- **Rules System Test (Gauntlet)** — `game_pack.json`. Testing hub for rules, combat, conditions, features, hazards, consumables, completion conditions. Uses `character_aldric.json` + `module_gauntlet.json`.

The app loads the manifest first, then fetches each referenced document in parallel. See [JSON_SCHEMAS.md](JSON_SCHEMAS.md) for the expected shape of each document.

## Document roles

- **Setting** — World, tone, regions, cosmology. Used for GM flavor and Travel mode.
- **Rules** — Guidelines and mechanics the GM must follow (stats, combat, DCs, conditions, etc.). The rules engine (`scripts/rules-engine.js`) resolves d20 math, AC, attack/save/check outcomes; the prompt carries the narrative-facing slice.
- **Bestiary** — Creatures and NPCs under `bestiary.monsters` (HP, AC, attacks, XP, damage resistances/immunities/vulnerabilities). Modules may override via `module.module_bestiary.monsters` (resolution order: module-scoped first, shared second).
- **Items** — Shared weapons, armor, consumables, and magic items under `items.items`. Modules may override via `module.module_items.items`. Consumables declare `consumable.on_use` (`heal_player` / `cure_condition` / `gm_adjudicate`) which the items pipeline dispatches.
- **Adventure Module** — Locations, connections, encounters, features, hazards; authored with a `completion_condition` that the engine evaluates (`defeat_encounter` / `reach_room` / `all_encounters_defeated`, or `null` for GM-judged).

Files: Bestiary = `bestiary_*.json` with `bestiary.monsters`. Items = `items_*.json` with `items.items`. Adventure Module = `module_*.json` with `module` metadata and `rooms` object.

## Character sheets

Character JSON files are **tied to user accounts** (when the platform has auth) and **designed for a specific Game Pack**. Each character sheet should include **`game_pack_id`** matching the manifest `id` of the Game Pack it was created for. The app warns if a loaded character’s `game_pack_id` does not match the current Game Pack. The character sheet schema (stats, skills, equipment) is defined by the Rules and the app; see [JSON_SCHEMAS.md](JSON_SCHEMAS.md).

## Play modes (three pillars)

Exactly **one** mode is active at a time:

- **Exploration** — High GM freedom, low mechanics; ability/skill checks; improv within module/setting.
- **Combat** — Low GM freedom, high mechanics; turn-based; strict rules and dice.
- **Travel** — Long-distance travel; summarized narrative; setting/rules/module may define travel rules.

Mode is set by:

- **Combat:** `[COMBAT: on]` / `[COMBAT: off]` in the GM response, or inferred when combat starts/ends.
- **Travel:** `[MODE: travel]` to enter; `[MODE: exploration]` or arrival narrative to return to exploration.

The UI shows the current mode (Exploration / Combat / Travel) in the narrative header.

## Configuration

System-level settings (including AI model) are documented in [CONFIG.md](CONFIG.md).
