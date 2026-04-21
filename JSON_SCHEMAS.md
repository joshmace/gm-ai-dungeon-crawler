# Game Pack JSON Schemas — v1 Reference

> **Purpose:** a concise, field-level reference for pack authors. Tells you *what* goes in each file; the *why* and the full design rationale live in `RULES_SCHEMA_PLAN.md`.
>
> **Status:** v1 schemas, April 2026. Breaking changes from the pre-v1 format; no backwards compatibility.

## What a Game Pack is

A Game Pack is the unit of play. One pack = one playable experience: a system, a world, an adventure, and a character. The app loads a pack via its manifest and runs the session.

Six archetypes compose a pack, plus a manifest that binds them together:

| Archetype | Purpose | Primary file | Optional sidecar |
|---|---|---|---|
| **Manifest** | Binds the other files | `game_pack_<name>.json` | — |
| **Rules** | Mechanics: abilities, resolution, combat, progression, conditions | `rules_<name>.json` | `<name>_guidance.md` |
| **Setting** | World shell + lore sidecar | `setting_<name>.json` | `<name>_lore.md` (required — the content lives there) |
| **Bestiary** | Monster stats keyed by id | `bestiary_<name>.json` | — (v1) |
| **Items** | Weapons, armor, consumables, loot | `items_<name>.json` | — (v1) |
| **Adventure Module** | Rooms, encounters, hazards, features | `module_<name>.json` | `<name>_guidance.md` |
| **Character** | Pregen or player-built character sheet | `character_<name>.json` | `<name>_guidance.md` |

File-naming is a convention, not a rule — authors may use any filenames they like as long as the manifest points at them correctly.

The starter pack at `game_pack_lantern_and_blade.json` is a complete, working reference implementation of every archetype. When in doubt, read those files alongside this doc.

---

## Conventions

### IDs

- **Format:** `snake_case` ASCII. Examples: `silver_dagger`, `goblin_warrior`, `watch_house_yard`.
- **Scope:** ids are stable references used by other files. Changing an id is a breaking change for every file that refers to it.
- **Uniqueness:** required within a file — monsters within a bestiary, rooms within a module, items within a library, abilities within a rules pack. Not required to be globally unique, but authors are encouraged to namespace (`crows_hollow_warden_lieutenant`) when one-off entries live inside a module.

### References between files

| Reference | Points to | Used in |
|---|---|---|
| `monster_ref` | `bestiary.monsters[id]` or `module.module_bestiary.monsters[id]` | Encounter `groups[]` |
| `item_id` | `items_library.items[id]` or `module.module_items[id]` | Equipment, pack contents, rewards |
| `ability` | `rules.character_model.abilities[].id` | Checks, skills, combat formulas, magic bonuses, save proficiency |
| `skill` | `rules.character_model.skills[].id` | Checks (hazards, features, puzzles), skill proficiency |
| `damage_type` | `rules.resources.damage_types[].id` | Weapons, monster attacks, hazards, magic `bonus_damage` |
| condition id | `rules.conditions[].id` | Hazard `on_failure.conditions`, `character.conditions` |
| connection target | `module.rooms[id]` | Effect targets (`unlock_connection`, `reveal_connection`) |
| feature id (in effects) | `module.rooms[?].features[].id` | `activate_feature` effects, `feature_state` prerequisites |
| encounter id | `module.rooms[?].encounters[].id` | `encounter_defeated` prerequisites, `completion_condition.target` |

**Resolution order:** module-scoped first, shared second. An encounter's `monster_ref` is looked up in `module.module_bestiary` first and falls back to the shared `bestiary`. Same pattern for `module.module_items`.

### Guidance sidecars

Each archetype may carry a markdown sidecar for prose the schema doesn't structure — tone notes, running hints, lore, spoiler guidance, character voice.

The sidecar reference lives **inside the archetype's primary JSON file**, never on the manifest:

- Rules: `rules.guidance` → `<name>_guidance.md`
- Setting: `setting.content` → `<name>_lore.md` *(the setting sidecar IS the primary content; not optional)*
- Module: `module.guidance` → `<name>_guidance.md`
- Character: `character.guidance` → `<name>_guidance.md`
- Bestiary, Items: no sidecar field in v1.

The prompt builder loads each sidecar and injects it into the matching system-prompt slot (`{{SETTING_BLOCK}}`, `{{GUIDANCE_BLOCK}}`, etc.).

### `dc_tier`

DCs are expressed as **semantic tier ids**, never as numbers. This keeps modules rules-pack-portable — a `"medium"` check hits whatever DC the active rules pack declares.

```jsonc
"check": { "skill": "perception", "ability": "wis", "dc_tier": "easy" }
```

The rules pack's `difficulty.scale[]` is the authoritative list of valid tier ids for that pack. Tiers vary by pack — Lantern & Blade uses `very_easy` / `easy` / `medium` / `hard` / `very_hard` / `nearly_impossible`. Modules intended to be portable should stick to `easy` / `medium` / `hard`; packs with custom tiers may use them internally.

### Check shape — raw saves vs. skilled checks

The same `check` object is used by hazards (`detection.check`, `avoidance.check`) and puzzle features (`solution.check`):

```jsonc
// Skilled check — the character's skill proficiency applies if any
{ "skill": "perception", "ability": "wis", "dc_tier": "easy" }

// Raw save — skill proficiency does NOT apply; save proficiency does
{ "skill": null, "ability": "con", "dc_tier": "medium" }
```

Pass `skill: null` for ability saves. Skill proficiency is sourced from `character.skills.proficient[]`; save proficiency from `character.saves.proficient[]`.

### Reward shape

One shape, three types, used everywhere rewards appear (encounters, searchable/interactive/puzzle features, hazard detection/avoidance):

```jsonc
{ "type": "gold", "amount": "2d6" }                            // amount: dice expression OR fixed number
{ "type": "item", "item_id": "silver_dagger", "quantity": 1 }  // quantity default 1 if omitted
{ "type": "xp",   "amount": 10 }                               // fixed number; only on hazard detection/avoidance
```

**Gold-as-XP:** when a gold reward is granted and the active rules pack's `progression.xp_sources` includes `"treasure_recovered"`, the gold amount is also awarded as XP. Runtime behavior; no schema change.

### Schema versioning

Save files carry a `schema_version` integer on every save from day one. Authored files (rules, setting, module, etc.) do not — the author-facing `version` string is for release labeling, not machine parsing.

### Required, optional, conditional

In the field tables below:

- **required** — the file is malformed without this field.
- **optional** — the app falls back to a sensible default or hides the UI for it.
- **conditional** — required when another field has a specific value (e.g. `classes` is required when `character_model.uses_classes: true`).

Inline `jsonc` examples annotate each field the first time it appears with a `// required` / `// optional` / `// conditional — …` comment.

---

## Game Pack manifest

Small file. Its only job is to name the pack and point at the component files.

### Shape

```jsonc
{
  "id":           "lantern_and_blade_starter_v1",              // required — machine id; used for save keying + character.game_pack_id validation
  "name":         "Lantern & Blade: The Watch at Crow's Hollow", // required — display name (pack picker)
  "version":      "1.0",                                       // optional — author-facing release label
  "author":       "Lantern & Blade Project",                   // optional
  "description":  "A starter Game Pack for Lantern & Blade…",  // optional — pack-picker blurb

  "rules":             "./rules_lantern_and_blade.json",       // required — path to Rules JSON
  "setting":           "./setting_hollowmarch.json",           // required — path to Setting JSON
  "bestiary":          "./bestiary_lantern_and_blade.json",    // required — path to Bestiary JSON
  "items":             "./items_lantern_and_blade.json",       // required — path to Items JSON
  "adventure_module":  "./module_crows_hollow.json",           // required — path to Module JSON
  "character":         "./character_ren_callory.json"          // required — path to Character JSON
}
```

### Fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | required | Machine id. Used for save-file keying and for validating character compatibility. Stable across versions. |
| `name` | string | required | Shown in pack picker. |
| `version` | string | optional | Author-facing (`"1.0"`, `"2.1-beta"`). No semver enforcement. |
| `author` | string | optional | Display only. |
| `description` | string | optional | Pack-picker blurb. |
| `rules` | string (path) | required | Relative or absolute path / URL to the Rules JSON. |
| `setting` | string (path) | required | Path to the Setting JSON. |
| `bestiary` | string (path) | required | Path to the Bestiary JSON. |
| `items` | string (path) | required | Path to the Items JSON. |
| `adventure_module` | string (path) | required | Path to the Module JSON. |
| `character` | string (path) | required | Path to the Character JSON. |

### Validator responsibilities

- Every referenced file must resolve.
- The character file's `character.game_pack_id` must equal this manifest's `id`.

### Reference example

`game_pack_lantern_and_blade.json`.

---

## Setting Pack

**Prose-first.** The JSON is a thin shell — pack-picker metadata plus a pointer to the markdown sidecar. All lore, regions, history, and cosmology live in the markdown. Nothing in the JSON is mechanically parsed.

### JSON shape

```jsonc
{
  "setting": {
    "id":          "hollowmarch_v1",                            // required
    "name":        "The Hollowmarch",                           // required
    "version":     "1.0",                                       // optional
    "author":      "…",                                         // optional
    "description": "A century after the Wardens of the Watch…", // optional — pack-picker blurb
    "tags":        ["dark-fantasy", "ruin", "hex-crawl"],       // optional — free-form v1
    "content":     "hollowmarch_lore.md"                        // required — path to lore sidecar
  }
}
```

### Fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | required | |
| `name` | string | required | |
| `version` | string | optional | |
| `author` | string | optional | |
| `description` | string | optional | Pack-picker blurb. |
| `tags` | string[] | optional | Free-form v1 — short human-readable tags. No controlled vocabulary yet. |
| `content` | string (path) | required | Path to the lore markdown sidecar. |

### Lore sidecar (`<name>_lore.md`)

Plain markdown. No structural parsing — the prompt builder loads the whole file into `{{SETTING_BLOCK}}`. Headings are for the GM's mental organization, not required by the app.

**Suggested section ordering** (not enforced):

```markdown
# World Overview
# Cosmology
# Major Regions
## <Region Name>
# Peoples and Cultures
# History
# Magic
# Adventure Context
# GM Guidance
```

### Reference example

`setting_hollowmarch.json` + `hollowmarch_lore.md`.

---
