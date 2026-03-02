# Game Pack JSON Schemas (Reference)

Brief reference for the shape of each document in a Game Pack. Used for consistency when creating or reviewing Game Packs.

## Game Pack manifest (`game_pack.json`)

- `id`: string (e.g. `"shattered_realms_rules_test"`) — used for save compatibility and character association.
- `name`, `version`: optional display info.
- `setting`: path or URL to Setting JSON.
- `rules`: path or URL to Rules JSON.
- `bestiary`: path or URL to Bestiary JSON (current format: `monster_manual.monsters` object).
- `adventure_module`: path or URL to Adventure Module JSON (current format: `module` metadata + `rooms`).

## Setting

- Top-level key `setting` with object containing at least:
  - `name`, `version`, `type`, `tone`, `description`.
  - `world_overview`: `description`, `current_era`, `tone`, etc.
  - `major_regions`: object keyed by region id; used for flavor and Travel mode.
  - Optional: `cosmology`, `races`, etc.

## Rules

- Top-level key `rules` with object containing:
  - `system`, `design_philosophy`.
  - `core_mechanics.ability_checks` (e.g. `dc_scale`, `roll`, `when_to_roll`).
  - `combat` (attack_roll, damage, hit_points, conditions, etc.).
  - Optional: `experience`, `optional_rules`.

## Bestiary

- Current format: top-level `monster_manual` with `monsters` object. Each monster: `id`, `name`, `hp`, `ac`, `attacks` (array with `name`, `bonus`, `damage`, `damage_type`, `range`), `behavior`, `xp_value`, `treasure`, etc. Adventure Module encounters reference by `monster_ref` (monster id).

## Adventure Module

- `module`: metadata (`title`, `version`, `starting_room`, etc.).
- `rooms`: object keyed by room id. Each room: `id`, `name`, `description`, `connections` (exit label → room id), `features` (array), `encounters` (array with `monster_ref`, optional `name`, `on_death`, etc.).

## Character sheet

- Top-level key `character`. Must include `game_pack_id` matching the Game Pack manifest `id` for the pack this character is designed for. Structure follows the Rules (ability_scores, skills, equipment, combat_stats, etc.). See existing `character_aldric.json` for the current shape.
