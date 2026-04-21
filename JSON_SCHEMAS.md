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

## Rules Pack

The mechanical spine of the pack. Declares what character data looks like, how rolls resolve, how combat runs, and what progression feels like. The character sheet fills in values; the rules pack declares the shape.

All mechanical data is structured. Tone, running philosophy, and signature-mechanic prose live in the guidance sidecar.

### Top-level shape

```jsonc
{
  "rules": {
    "id":                "lantern_and_blade_v1",  // required — machine id
    "name":              "Lantern & Blade",       // required
    "version":           "1.0",                   // optional
    "author":            "…",                     // optional
    "description":       "…",                     // optional
    "design_philosophy": "…",                     // optional — one-line tagline; feeds the GM prompt's tone block
    "guidance":          "lantern_and_blade_guidance.md",  // optional — path to GM guidance sidecar

    "character_model": { /* see below */ },   // required
    "resolution":      { /* see below */ },   // required
    "resources":       { /* see below */ },   // required
    "combat":          { /* see below */ },   // required
    "conditions":      [ /* see below */ ],   // optional (empty array allowed)
    "progression":     { /* see below */ },   // required
    "difficulty":      { /* see below */ },   // required
    "encumbrance":     { /* see below */ }    // required ("none" is a valid method)
  }
}
```

---

### `character_model`

Declares the shape of character data. The character pack fills in values against this shape.

```jsonc
{
  "abilities": [                                        // required — authoritative ability list for the pack
    { "id": "str", "name": "Strength",     "abbr": "STR", "range": [1, 20] },
    { "id": "dex", "name": "Dexterity",    "abbr": "DEX", "range": [1, 20] },
    { "id": "con", "name": "Constitution", "abbr": "CON", "range": [1, 20] }
    // …etc.
  ],

  "modifier_formula": "table_5e",   // required — "table_5e" | "table_bx" | "score_is_mod"

  "saves": {
    "type": "per_ability"           // required — "per_ability" | "categorical"
  },

  "skills": [                       // optional — omit for skill-less systems (B/X, Cairn)
    { "id": "stealth",   "name": "Stealth",   "ability": "dex" },
    { "id": "athletics", "name": "Athletics", "ability": "str" }
  ],

  "uses_classes": true,             // required — boolean
  "classes": {                      // conditional — required when uses_classes: true
    "fighter": {
      "id":          "fighter",     // required
      "name":        "Fighter",     // required
      "hit_die":     "1d10",        // required — dice string; feeds hp_gain_per_level
      "description": "…"            // optional
    }
  },

  "slot_limits": {                  // optional — max equipped items per slot type; omit to disable enforcement
    "main_hand": 1, "off_hand": 1, "ranged": 1,
    "body": 1, "shield": 1,
    "head": 1, "hands": 1, "feet": 1,
    "neck": 1, "ring": 2,
    "cloak": 1, "belt": 1
  }
}
```

**Ability `range`:** closed interval `[min, max]`. Use `[3, 18]` for rolled 3d6 packs, `[1, 20]` for 5e-shaped packs, etc.

**`modifier_formula` presets:**

| Value | Meaning |
|---|---|
| `"table_5e"` | 5e-style: `(score − 10) ÷ 2`, rounded down. |
| `"table_bx"` | B/X-style: fixed lookup table (score 3 → −3, 4–5 → −2, … 18 → +3). |
| `"score_is_mod"` | Cairn/Knave-style: ability score IS the modifier. |

**`saves.type`:**

| Value | Meaning |
|---|---|
| `"per_ability"` | One save per ability (5e-style). Character's `saves.proficient[]` holds ability ids. |
| `"categorical"` | Categorical saves (e.g., B/X's Death Ray, Wands, Paralysis, Breath, Spells). Declared via a `categories[]` array on `saves`; character's `saves.proficient[]` holds category ids. |

**Skills:**

- Optional. When absent, the character panel hides its Skills section and the GM falls back to raw ability checks.
- Empty array `"skills": []` is encouraged for deliberately skill-less packs (signals intent).
- Each entry: `id` (required), `name` (required), `ability` (required — ability id this skill keys off).

**Classes:**

- `uses_classes: true` makes `classes` required. Omit classes entirely for classless packs (`uses_classes: false`).
- v1 class metadata is deliberately minimal — id, name, hit_die, short description.
- Class features (spells, per-level abilities, subclass trees) live on the character in `class_features[]` as prose. Full structured class systems deferred to v2.

**Slot limits:**

- Max count per slot type. The app's equip logic enforces these against the character's `equipment[]`.
- Two-handed weapons are handled at the item level (`slot: "two_handed"`) — equipping a two-handed item occupies both `main_hand` and `off_hand`. No additional schema needed here.

---

### `resolution`

Declares how checks are rolled and what auxiliary rolls the pack uses.

```jsonc
{
  "checks": {
    "method":                  "roll_high_vs_dc",  // required — "roll_high_vs_dc" | "roll_under_score"
    "dice":                    "1d20",             // required — dice string
    "crit_success":            "nat_20",           // required — narrative cue; "nat_20" | "nat_1" etc., or "none"
    "crit_failure":            "nat_1",            // required — narrative cue; or "none" for gritty play
    "advantage_disadvantage":  true                // required — boolean
  },
  "auxiliary": {
    "x_in_6":        false,                        // required — surprise / secret doors / thief skills
    "reaction_roll": false,                        // required — 2d6 NPC reaction
    "morale_roll":   false                         // required — 2d6 monster morale
  }
}
```

**`checks.method`:**

| Value | Meaning |
|---|---|
| `"roll_high_vs_dc"` | Roll dice + modifier, meet or beat DC. |
| `"roll_under_score"` | Roll dice, roll equal to or under the target ability score. |

**Crit fields are narrative only.** No mechanical effect in the check resolution pipeline. Combat crits are declared separately in `combat.critical_hit` (Q5).

**`advantage_disadvantage: true`** — the prompt includes adv/disadv rules; the GM may issue `[ROLL_REQUEST: Ability, advantage]` or `, disadvantage]`; the dice UI rolls 2d20 and keeps the appropriate die.

**`advantage_disadvantage: false`** — the prompt tells the GM the system has no adv/disadv; use flat DC adjustments instead. Only `[ROLL_REQUEST: Ability]` is accepted.

---

### `resources`

Hit points, healing, and damage types.

```jsonc
{
  "hit_points": {
    "max_formula": "class_hd_plus_con",  // required — "class_hd_plus_con" | "flat" | …
    "at_zero":     "unconscious",        // required — "dead" | "unconscious"
    "overflow":    null                  // required — null OR { "to_ability": "str" } for Cairn-style ability damage
  },
  "healing": {
    "natural_rest": "full_overnight"     // required — "full_overnight" | "partial_overnight" | "minimal" | "none"
  },
  "damage_types": [                      // optional — omit entirely for typeless packs
    { "id": "slashing", "name": "Slashing", "narrative_cue": "blades carving and tearing" },
    { "id": "fire",     "name": "Fire",     "narrative_cue": "burning, searing" },
    { "id": "cold",     "name": "Cold" }   // narrative_cue optional
  ]
}
```

**`hit_points.at_zero`:**

| Value | Meaning |
|---|---|
| `"dead"` | Zero HP = character dies. Death overlay + end-of-game UI. |
| `"unconscious"` | Zero HP = incapacitated but alive. Healing or narrative rescue restores. |

Death saves are not supported in v1.

**`hit_points.overflow`:** set to `{ "to_ability": "<id>" }` for Cairn-style systems where damage past 0 HP cascades into an ability score. Null for every other system.

**Damage types:** Entries with a `narrative_cue` feed the GM per-pack flavor direction and keep monster attacks + hazards consistent. Especially useful for homebrew types (`void`, `psychic`). When `damage_types` is omitted, damage is typeless everywhere (no resistances, no immunities).

---

### `combat`

Attack resolution, damage formula, crits, initiative.

```jsonc
{
  "attack": {
    "resolution": "roll_high_vs_ac"        // required — "roll_high_vs_ac" | "auto_hit_no_roll"
  },
  "damage": {
    "formula":        "weapon_die_plus_ability_mod",  // required — "weapon_die_plus_ability_mod" | "weapon_die_only"
    "melee_ability":  "str",                          // required if formula uses ability mod; ability id
    "ranged_ability": "dex"                           // required if formula uses ability mod; ability id
  },
  "critical_hit": {
    "trigger": "nat_20",                   // required — "nat_20" | "none"
    "effect":  "double_dice"               // required — "double_dice" | "max_damage" | "extra_die"
  },
  "initiative": {
    "type": "player_first"                 // required — "player_first" | "side_based"
  }
}
```

**`attack.resolution: "auto_hit_no_roll"`** is the Cairn/Knave/Into-the-Odd lineage — no attack roll, damage is rolled directly. Partial fit for Draw Steel-likes.

**AC convention:** ascending only in v1. Descending AC (AD&D THAC0) is v2.

**Initiative `"side_based"`** fires a coin-flip at combat start to decide which side acts first. `"individual"` (per-creature initiative with full turn-order UI) is v2.

---

### `conditions`

An array of condition definitions. The app tracks active condition ids on the character; the GM applies the effect prose narratively.

```jsonc
[
  {
    "id":          "poisoned",              // required
    "name":        "Poisoned",              // required
    "icon":        "drop",                  // required — id from the fixed icon library (see "Open questions" at end of doc)
    "description": "A toxin is working through you.",  // required — player-facing
    "effect":      "Disadvantage on attack rolls and ability checks.",  // required — prose applied by the GM
    "removal":     "Until the duration ends, antitoxin is administered, or the poison is neutralized." // required — prose
  }
]
```

An empty array is a valid pack-level declaration (signals "this pack uses no conditions"). Omitting the field entirely is also acceptable.

---

### `progression`

Character advancement — XP, levels, and how HP grows per level.

```jsonc
{
  "type": "xp_and_level",                // required — "xp_and_level" | "milestone" | "none"
  "xp_sources": [                        // required when type is "xp_and_level"; ignored otherwise
    "monsters_defeated",
    "treasure_recovered",                // classic Gygaxian gold-as-XP (opt-in)
    "milestones"
  ],
  "level_table": [                       // required when type is "xp_and_level"
    { "level": 1,  "xp_required": 0,    "proficiency_bonus": 2 },  // proficiency_bonus is OPTIONAL per row
    { "level": 2,  "xp_required": 300,  "proficiency_bonus": 2 },
    { "level": 5,  "xp_required": 6500, "proficiency_bonus": 3 }
  ],
  "max_level":          10,              // required — highest level authorable in the pack
  "hp_gain_per_level":  "roll_class_hd_plus_con"  // required — "roll_class_hd_plus_con" | "average_class_hd_plus_con" | "flat"
}
```

**Proficiency bonus:** optional per row. Include on rows where the system uses a scaling PB (5e, Shadowdark). Omit entirely for systems that don't (B/X, Knave, Cairn) — the app hides it from the character panel and does not fold it into totals.

**`hp_gain_per_level`:**

| Value | Meaning |
|---|---|
| `"roll_class_hd_plus_con"` | Roll the class's hit die + CON modifier on level up. |
| `"average_class_hd_plus_con"` | Take fixed average of the hit die + CON modifier. Lantern & Blade's default. |
| `"flat"` | Fixed gain regardless of class. Declare amount in a `hp_flat_gain` sibling field. |

Characters always start at level 1.

---

### `difficulty`

The DC / modifier ladder. Shape depends on `resolution.checks.method`.

**For `roll_high_vs_dc`:**

```jsonc
{
  "scale": [
    { "id": "easy",   "name": "Easy",   "dc": 10 },
    { "id": "medium", "name": "Medium", "dc": 15 },
    { "id": "hard",   "name": "Hard",   "dc": 20 }
  ],
  "auto_success": "Trivial tasks with no consequence.",        // required — prose
  "auto_failure": "Genuinely impossible tasks."                // required — prose
}
```

**For `roll_under_score`:**

```jsonc
{
  "scale": [
    { "id": "easy",      "name": "Easy",      "modifier":  2 },
    { "id": "normal",    "name": "Normal",    "modifier":  0 },
    { "id": "hard",      "name": "Hard",      "modifier": -2 }
  ],
  "auto_success": "…",
  "auto_failure": "…"
}
```

**Scale notes:**

- Free-form tier count. Three tiers is the OSR standard; Lantern & Blade uses six. Authors choose what fits.
- Tier `id`s are what modules reference via `dc_tier` — portable modules stick to `easy` / `medium` / `hard`.
- `auto_success` / `auto_failure` stay as prose (GM judgment, not algorithmic).

---

### `encumbrance`

Carry-capacity declaration. Required in every pack; `"none"` is a valid method.

```jsonc
// Method 1 — slots
{
  "method":         "slots",               // required — "slots" | "weight" | "none"
  "slot_capacity":  "str"                  // required for "slots" — ability id OR fixed integer
}

// Method 2 — weight
{
  "method":          "weight",
  "weight_formula":  { "multiplier": 15, "ability": "str" }  // required for "weight"
}

// Method 3 — none
{
  "method": "none"
}
```

**`weight_formula` shape:**

- `multiplier`: positive integer coefficient.
- `ability`: ability id from `character_model.abilities`.
- Capacity at runtime = `multiplier × character.ability_scores[ability]`.

Inventory UI for slot or weight tracking is built out as packs adopt the methods.

---

### Guidance sidecar (`<name>_guidance.md`)

Optional markdown. Loaded into `{{GUIDANCE_BLOCK}}` in the system prompt. Good homes for:

- Tone and pacing philosophy beyond the one-line `design_philosophy`.
- System-specific running notes (torch urgency, travel pace, etc.).
- Signature mechanics the schema doesn't natively express — the GM does its best to honor them narratively. If a mechanic becomes popular enough, v2 may add a formal primitive.

### Reference example

`rules_lantern_and_blade.json` + `lantern_and_blade_guidance.md`.

---
