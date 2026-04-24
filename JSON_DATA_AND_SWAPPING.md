# JSON Data Usage and Swapping

The app ships as a set of v1 Game Packs — each pack bundles six archetype JSON files (plus optional markdown sidecars) under a manifest. Swapping packs changes the whole experience (rules, setting, module, character, bestiary, items) in one move; swapping an individual archetype is a schema-safe drop-in as long as the new file follows the v1 shape in `JSON_SCHEMAS.md`.

## How a pack loads

1. The HTML points `CONFIG.GAME_PACK` at a manifest JSON (e.g. `./game_pack_village_three_knots.json`).
2. `scripts/pack-loader.js` fetches the manifest, then fetches the six archetype files in parallel (`setting`, `rules`, `bestiary`, `items`, `adventure_module`, `character`) plus any sidecar `.md` files declared in `setting.content` / `rules.guidance` / `module.guidance` / `character.guidance`.
3. The loader validates references (manifest id ↔ character `game_pack_id`, module `starting_room` resolves, every `monster_ref` / `item_id` / connection target / effect target resolves) and surfaces a scrollable error card on failure.
4. A merged `gameData` object is handed to `GameState.init`, which also preserves the raw v1 payload under `gameData._v1` so the rules engine, items pipeline, and save serializer can read native shapes.

See `GAME_PACK.md` for the manifest fields and `JSON_SCHEMAS.md` for each archetype's expected shape.

## Source of truth

- **Numeric values, stats, DCs, rewards, and mechanics** come from the loaded JSON. The system prompt tells the GM: *"Do NOT invent or substitute values."* The rules engine (`scripts/rules-engine.js`) enforces the numeric side — attack math, AC, save/check resolution, damage with resistance/immunity/vulnerability, feature prerequisites, effect dispatch, completion-condition evaluation.
- **Narration, pacing, and tone** are left to the GM; only the data-driven facts are fixed.

## Archetype roles

- **Rules** (`rules_*.json`) — Character model (abilities, skills, saves type, modifier formula), resolution method (`roll_high_vs_dc` / `roll_under_score`), difficulty ladder (`difficulty.scale[]`), combat (`attack`, `damage`, `critical_hit`, `initiative`), conditions, progression (HP gain, level table, XP thresholds, `xp_sources`), encumbrance method. The engine reads these fields directly; switching to a pack with a different rules file re-derives everything.
- **Bestiary** (`bestiary_*.json`) — `bestiary.monsters` keyed by monster id. Each monster: `name`, `hp`, `ac`, `attacks[]` (name, bonus, damage, damage_type, range), optional `damage_resistance` / `damage_immunity` / `damage_vulnerability` arrays, `xp_value`, `treasure`.
- **Items** (`items_*.json`) — `items.items` keyed by item id. Weapons nest stats under `weapon.*`; armor under `armor.*`; consumables under `consumable.*` (with `on_use: "heal_player" | "cure_condition" | "gm_adjudicate"`); magic riders under `magic.*` (`attack_bonus`, `damage_bonus`, `bonus_damage`, `ac_bonus`, `save_bonus`, `skill_bonus`, `damage_resistance`, `damage_immunity`, `charges`).
- **Module** (`module_*.json`) — `module` metadata + `rooms` object. Each room authors `connections` (simple or structured with `{state: open|locked|hidden, label?}`), `features` (lore / searchable / interactive / puzzle, with optional `prerequisites`), `encounters` (`groups[].monster_ref`, `trigger`, `rewards`, `on_defeat_effects`), `hazards` (`trigger`, `detection?`, `avoidance?`, `damage?`, `conditions?`). Optional `module_bestiary` and `module_items` scope monsters/items to the module only (resolution order: module-scoped first, shared second). `completion_condition` declares the win gate (`defeat_encounter` / `reach_room` / `all_encounters_defeated` / `null` for GM-judged).
- **Character** (`character_*.json`) — `basic_info` (name, class, level), `ability_scores` (short keys: `str`/`dex`/…), `skills.proficient[]`, `saves.proficient[]` (per_ability) or `saves.values{}` (categorical), v1 `equipment[{item_id, slot}]`, v1 `pack[{item_id, quantity}]`, `feature_resources`, `charged_items`, `conditions`, `gold`, `xp`, `hp_current`. Must carry `game_pack_id` matching the manifest `id`.
- **Setting** (`setting_*.json`) — World, tone, regions, cosmology; surfaced via `{{SETTING_BLOCK}}` and the sidecar `.md` lore.

## Swapping a pack

Change `CONFIG.GAME_PACK` in `playable-dungeon-crawler-v2.html` to the manifest of the target pack. Reload. Each pack's save lives under its own localStorage slot (`gm-ai-dungeon-save:<game_pack_id>`), so you can bounce between Three Knots / Gauntlet / Crow's Hollow without clobbering the others' progress.

## Swapping one archetype

Replace the target file and leave the manifest pointer alone (or re-point the manifest's archetype field to the new file). Requirements:

- The new file matches the v1 schema for that archetype (`JSON_SCHEMAS.md`).
- Every referenced id still resolves — monster refs in the module exist in the bestiary, item refs exist in the items library, connection targets exist in rooms, effect targets exist in features/connections, `completion_condition.target` exists.
- The character's `game_pack_id` still equals the manifest id.

Mismatches fail at pack-load time with a clear error card (path + specific id that didn't resolve). The app won't start a broken game.

## Save compatibility

Saves written under the v1 envelope carry `schema_version: 1`, `game_pack_id`, `module_id` at the top level. Loading refuses any blob whose schema or pack id doesn't match the manifest — the pre-v1 shape is dropped with a one-time system message. See `REFACTOR_V1_PLAN.md §Stage 7` for the envelope spec and `JSON_SCHEMAS.md` for the field-by-field contract.
