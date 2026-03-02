# Game Pack Format

A **Game Pack** is the unit of content for the GM-AI platform. It bundles everything needed to run an adventure: Setting, Rules, Bestiary, and Adventure Module.

## Manifest

The Game Pack is defined by a **manifest** JSON file (e.g. `game_pack.json`) with:

- **`id`** — Unique identifier (e.g. `shattered_realms_rules_test`). Used for save compatibility and character association.
- **`setting`** — Path or URL to the Setting JSON.
- **`rules`** — Path or URL to the Rules JSON.
- **`bestiary`** — Path or URL to the Bestiary JSON.
- **`adventure_module`** — Path or URL to the Adventure Module JSON.
- Optional: **`character`** — Path to a character sheet for this pack (if omitted, the app uses `CONFIG.DATA_FILES.character`).
- Optional: `name`, `version`, `images`, `audio` for display or media references.

## Available Game Packs

- **The Haunting of Three Knots** — `game_pack_village_three_knots.json`. One-shot: village haunting, linear tomb (puzzle, trap, boss), reward at the inn. Uses `character_village_three_knots.json`. Set `CONFIG.GAME_PACK` to this file to play (current default).
- **Rules System Test** — `game_pack.json`. Testing hub for rules, combat, conditions, etc. Uses `character_aldric.json`. Set `CONFIG.GAME_PACK` to `./game_pack.json` to switch back.

The app loads the manifest first, then fetches each referenced document. See [JSON_SCHEMAS.md](JSON_SCHEMAS.md) for the expected shape of each document.

## Document roles

- **Setting** — World, tone, regions, cosmology. Used for GM flavor and Travel mode. See GM_RULES_REWRITE.md §1.1.1.1.
- **Rules** — Guidelines and mechanics the GM must follow (stats, combat, DCs, conditions, etc.). See GM_RULES_REWRITE.md §1.1.1.2.
- **Bestiary** — Creatures and NPCs (stats, behavior, XP, treasure). Adventure Module encounters reference bestiary entries and may override. See GM_RULES_REWRITE.md §1.1.1.3 (Beastiary).
- **Adventure Module** — Locations, story hooks, encounters, features. Overrides bestiary defaults when specified. See GM_RULES_REWRITE.md §1.1.1.4.

Current file mapping: Bestiary = `monster_manual` JSON with `monster_manual.monsters`. Adventure Module = JSON with `module` metadata and `rooms` object.

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
