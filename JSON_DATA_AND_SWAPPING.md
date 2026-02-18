# JSON Data Usage and Swapping

The app is designed so you can swap **rulesets**, **characters**, **monster manuals**, and **adventure modules** by changing the JSON files (or `CONFIG.DATA_FILES`). The GM is instructed to **honor the loaded data strictly** for all concrete values (numbers, stats, DCs, rewards, mechanics). This document summarizes how each JSON is used and how to swap safely.

## Source of truth

- **Numeric values, stats, DCs, rewards, and mechanics** in the prompt come from the loaded JSON. The system prompt tells the GM: *"Do NOT invent or substitute values."*
- **Narration, pacing, and tone** are left to the GM; only the data-driven facts are fixed.

## Rules (`rules.json`)

- **Loaded as:** `gameData.rules` (the `rules` object from the file).
- **Used for:**
  - **RULESET block** in the GM prompt: system name, ability-check DC scale (`core_mechanics.ability_checks.dc_scale`), when to roll, attack/damage wording, hit points at zero, optional rules that are enabled.
  - **ADJUDICATION** section: auto-success/auto-failure text and **DCs** are taken from `dc_scale` (e.g. trivial 5, easy 10, medium 15, hard 20, very_hard 25, nearly_impossible 30). If no rules are loaded, the prompt falls back to "Easy 10, Medium 15, Hard 20."
- **Swapping:** Use a different `rules.json` with the same top-level shape (`rules.core_mechanics`, `rules.combat`, `rules.optional_rules`, etc.). DC scales and combat text will follow the new ruleset. **Optional:** If the rules file is missing or fails to load, the app still runs using fallback prompt text.

## Module / Adventure (`test_module_arena.json` or any module)

- **Loaded as:** `gameData.module` (full file; rooms under `gameData.module.rooms`, metadata under `gameData.module.module`).
- **Used for:**
  - **Dungeon layout** in the prompt: room ids, names, descriptions, **exits only from `connections`**, features (name, description, text, note, contains, interaction).
  - **Encounters:** Each room's `encounters` list; each encounter references `monster_ref` (id in the monster manual). **On death:** When an encounter has `on_death.xp_award` and/or `on_death.treasure`, the **module** values are used (and shown in the Active Encounters block). If the module does not list treasure for that encounter, the app falls back to the monster manual's `treasure` for that creature. So module on_death takes precedence over the manual.
  - **Starting room:** `module.starting_room`.
- **Swapping:** Point `CONFIG.DATA_FILES.module` to another JSON that has `module` (metadata) and `rooms` (object keyed by room id). Keep the same structure for rooms (id, name, description, connections, features, encounters with monster_ref and on_death).

## Monster manual (`monster_manual.json`)

- **Loaded as:** `gameData.monsters` = `monster_manual.monsters` (object keyed by monster id).
- **Used for:**
  - **Active Encounters:** For each encounter in the current room, the app resolves `encounter.monster_ref` to the monster block and builds a line: name, **current/max HP** (tracked by the app), **AC**, and **attacks** (name, bonus, damage, damage_type, range). The GM is told to use these **exact** stats and not substitute.
  - **On-death rewards:** **Module takes precedence.** For each encounter, the app uses the module's `on_death.xp_award` and `on_death.treasure` when present. If the module does not specify treasure (or it's empty), the app uses the monster manual's `treasure` (e.g. "1d6 silver pieces") for that creature. If the module doesn't specify XP, the app falls back to the manual's `xp_value`. So: module override for this encounter > monster manual default.
- **Swapping:** Use another manual with the same shape (`monsters` object; each monster has e.g. name, hp, ac, attacks[], treasure?, xp_value?). Module `monster_ref` values must match the new manual's keys.

## Character (`character_aldric.json`)

- **Loaded as:** `gameData.character` (the `character` object). Converted at init into `gameState.character` (name, class, level, hp, maxHp, ac, xp, abilities, skills, equipment, inventory, conditions).
- **Used for:**
  - **Current game state** in the prompt: name, class, level, HP, AC, ability modifiers, skills, weapons (from equipment), readied weapon, conditions.
  - **Rolls:** Attack modifier (STR/DEX + proficiency), weapon damage dice, skill modifiers, ability modifiers. All from the character sheet.
- **Swapping:** Use another character JSON with the same schema: `basic_info`, `ability_scores`, `combat_stats`, `skills`, `equipment.worn`, `equipment.wielded`, `equipment.carried`, `equipment.backpack`, `equipment.coin`. The app maps these into the internal state; different names/values are fine as long as the structure matches.

## CONFIG

In `playable-dungeon-crawler-v2.html`, `CONFIG.DATA_FILES` points to the four JSON files. To swap:

- Change the paths (e.g. `module: './my_campaign.json'`, `rules: './house_rules.json'`), or
- Load different files at runtime (e.g. from a menu) and set `gameData.character` / `gameData.module` / `gameData.monsters` / `gameData.rules` before (re)starting the game.

## Parsing and validation

- **HP, XP, gold, items** are parsed from the GM's narrative with regex (e.g. "You gain 25 XP", "You discover 10 gold"). When XP or gold is parsed, the app **validates** against the current room's defeated encounter(s) `on_death`: if the value doesn't match any expected value, a small in-narrative hint appears ("Note: Module expected X or Y XP/gold for this encounter.") and a debug log is written. The parsed value is still applied.
- **Monster HP** is tracked by the app (damage from narrative); the GM is not asked to output a number for monster HP, only to narrate using the "X/Y HP remaining" and "DEFEATED" text from the block.

## Summary

- **Rules:** Drive DCs, combat wording, optional rules, and (when present) XP level progression. Rules load is optional; app runs without it.
- **Module:** Drives layout, exits, features, encounters, and **exact** on_death XP and treasure.
- **Monsters:** Supply stats (HP, AC, attacks) for encounters; no inventing stats.
- **Character:** Supplies all player stats and equipment for the prompt and for dice/roll logic.

Swapping any of these files (with matching schema) changes the game while keeping the app's behavior consistent with the data.

---

## Expected schema (minimum shape)

Use these as a checklist when creating or swapping JSON files. The app may tolerate some missing optional fields with fallbacks.

- **Rules:** Top-level `rules`. Need `system`, `core_mechanics.ability_checks.dc_scale`, `combat.attack_roll`, `combat.damage`, `combat.hit_points.at_zero`, `optional_rules`. Optional: `experience.level_progression` (object: level keys to XP thresholds) for XP bar and level thresholds.
- **Module:** Top-level `module` (title, starting_room) and `rooms` (keyed by id; each room: id, name, description, connections?, features?, encounters? with monster_ref, on_death.xp_award, on_death.treasure).
- **Monster manual:** `monster_manual.monsters` (keyed by id; each: name, hp, ac, attacks? with name, bonus, damage, damage_type, range).
- **Character:** `character` with basic_info (name, class, level), ability_scores (score, modifier per ability), combat_stats (hit_points.current/maximum, armor_class, proficiency_bonus), skills, equipment (worn, wielded, carried, backpack, coin). Weapons need `damage` (e.g. "1d8").
