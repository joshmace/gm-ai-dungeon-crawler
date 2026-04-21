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
| `"categorical"` | Categorical saves (B/X's Death Ray / Wands / Paralysis / Breath / Spells and similar). **Declaration shape TBD** — no v1 pack exercises this yet; the field layout will be specified once a pack that needs it is authored. Avoid in v1 packs. |

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
    "icon":        "drop",                  // required — id from the fixed icon library (see "Controlled vocabularies" at end of doc)
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
| `"flat"` | Fixed gain regardless of class. **Amount-declaration shape TBD** — no v1 pack uses this yet; the exact sibling-field layout will be specified when one does. Avoid in v1 packs. |

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

## Bestiary Pack

A keyed library of monster stat blocks. Referenced by encounters via `monster_ref`. Everything mechanically tunable is **pre-computed** — no derivation from ability scores, no proficiency math. Authors author; the app reads.

### Top-level shape

```jsonc
{
  "bestiary": {
    "id":          "lantern_and_blade_bestiary_v1",  // required
    "name":        "Lantern & Blade — Starter Bestiary", // required
    "version":     "1.0",                            // optional
    "author":      "…",                              // optional
    "description": "…",                              // optional

    "monsters": {                                    // required — keyed object, id → monster block
      "goblin": { /* see below */ }
    }
  }
}
```

### Monster shape

```jsonc
{
  "id":          "goblin",                         // required — must match the key in monsters{}
  "name":        "Goblin",                         // required
  "description": "Small green-skinned raiders.",   // optional — short flavor, kept in JSON
  "type":        "humanoid",                       // optional — free-form string (v1); may bear mechanics in v2

  "hp":          7,                                // required — pre-rolled integer
  "ac":          13,                               // required — ascending AC
  "morale":      7,                                // optional — meaningful only when rules pack auxiliary.morale_roll: true

  "attacks": [ /* see "Attack shape" */ ],         // required — array; may be empty for purely environmental foes

  "special_abilities": [                           // optional
    {
      "id":          "darkvision",                 // required
      "name":        "Darkvision",                 // required
      "description": "Sees in darkness up to 60 feet.",  // required — prose
      "type":        "passive"                     // required — "passive" | "active" | "triggered"
    }
  ],

  "damage_resistance":    [],                      // optional — damage type ids taken at half
  "damage_immunity":      [],                      // optional — damage type ids ignored
  "damage_vulnerability": [],                      // optional — damage type ids taken doubled

  "xp_value": 25,                                  // required — authoritative default; encounter may override
  "behavior": "…",                                 // optional — prose tactical hint
  "tactics":  "…"                                  // optional — prose tactical hint
}
```

### Minimum viable monster

Required: `id`, `name`, `hp`, `ac`, `attacks`, `xp_value`. Everything else is optional.

### Attack shape

```jsonc
{
  "name":        "Scimitar",         // required
  "bonus":       2,                  // required — pre-computed total to-hit bonus; not derived
  "damage":      "1d6+2",            // optional — pre-computed dice string; omit for non-damaging attacks
  "damage_type": "slashing",         // optional — damage type id; ignored when rules pack has no damage_types
  "range":       "melee",            // required — "melee" | "ranged"
  "on_hit":      "Target saves vs. DC 12 CON or is poisoned for 1 minute."  // optional — prose rider; GM adjudicates
}
```

**Attack shape notes:**

- `damage` and `damage_type` are both optional. Omit both for non-damaging attacks (web, grapple, shove, disarm).
- `on_hit` is optional prose for any rider — save-or-suffer effects, conditions applied on hit, max-HP drains, position changes. The GM reads and adjudicates; v1 does not structurally parse riders.
- Same design line as item magic blocks: structured common fields + prose escape hatch.

**Special abilities:**

- Same design line. The `description` is the prose the GM reads; `type` is a hint about when it fires (`passive` = always on, `active` = the monster spends a turn or action, `triggered` = fires on a condition).
- Free-form effects live in the `description`. Structured rider schemas deferred to v2.

### Damage resistance, immunity, vulnerability

- All three are arrays of damage-type ids declared in the active rules pack's `resources.damage_types[]`.
- When the rules pack has no `damage_types`, these arrays are ignored.
- Resistance = half damage; immunity = no damage; vulnerability = doubled damage. Applied by the app if a rules engine is resolving damage; otherwise narrated by the GM.

### Reference example

`bestiary_lantern_and_blade.json`.

---

## Items Library

A keyed library of items — weapons, armor, consumables, lore, miscellany. Referenced by character equipment and by reward shapes via `item_id`.

Base item shape is the same for every type; per-type blocks add the mechanical specifics; the `magic` block overlays structured bonuses onto any item.

### Top-level shape

```jsonc
{
  "items_library": {
    "id":          "lantern_and_blade_items_v1",   // required
    "name":        "Lantern & Blade — Starter Items", // required
    "version":     "1.0",                          // optional
    "author":      "…",                            // optional
    "description": "…",                            // optional

    "items": {                                     // required — keyed object, id → item block
      "silver_dagger": { /* see below */ }
    }
  }
}
```

### Base item shape

```jsonc
{
  "id":           "silver_dagger",          // required — must match the key in items{}
  "name":         "Silver-Edged Dagger",    // required
  "type":         "weapon",                 // required — "weapon" | "armor" | "consumable" | "lore" | "misc"
  "slot":         "main_hand",              // required for weapon/armor; omit for consumable/lore/misc
  "description":  "…",                      // required — prose
  "weight_slots": 1,                        // required — unified field; interpretation depends on rules pack's encumbrance.method
  "tags":         ["common", "silvered"],   // optional — free-form string array

  // Type-specific block — present only when the type warrants one; see per-type sections below
  "weapon": { /* … */ },

  // Magic block — optional on any item; see "Magic block" below
  "magic":  { /* … */ }
}
```

**`weight_slots` is a unified field, method-dependent interpretation:**

| Rules pack `encumbrance.method` | Interpretation |
|---|---|
| `"slots"` | Number of inventory slots the item occupies. |
| `"weight"` | Weight in the pack's default unit (pounds by convention). |
| `"none"` | Ignored. |

Keeps items portable across packs with different encumbrance regimes.

### Type enum and slots

| `type` | Valid `slot` values |
|---|---|
| `"weapon"` | `"main_hand"`, `"off_hand"`, `"two_handed"`, `"ranged"` |
| `"armor"` | `"body"`, `"shield"`, `"head"`, `"hands"`, `"feet"`, `"neck"`, `"ring"`, `"cloak"`, `"belt"` |
| `"consumable"` | — (omit `slot`) |
| `"lore"` | — (omit `slot`) |
| `"misc"` | — (omit `slot`) |

"Armor" covers all wearables — body armor, shields, boots, gloves, rings, cloaks, circlets. Type is `"armor"`; differences are captured by `slot`. A ring that grants only a save bonus is `type: "armor"` with no `armor` block, just a `magic.save_bonus`.

Equipping a `slot: "two_handed"` item occupies both `main_hand` and `off_hand` (enforced by rules-pack `slot_limits`).

### Per-type blocks

```jsonc
// weapon (required when type is "weapon")
"weapon": {
  "damage":      "1d4",       // required — dice string
  "damage_type": "piercing",  // required — damage type id
  "melee":       true,        // required — boolean
  "ranged":      false        // required — boolean
}

// armor (optional even when type is "armor" — omit for wearables that don't grant AC, like a plain ring)
"armor": {
  "ac_bonus": 4,              // required — integer
  "type":     "heavy"         // required — "light" | "medium" | "heavy" | "shield"
}

// consumable (required when type is "consumable")
"consumable": {
  "on_use": "heal_player",    // required — keyword; see "Controlled vocabularies" at end of doc for the full set
  "amount": "2d4+2"           // required when on_use is a dice-expecting keyword; dice string or integer
}

// lore, misc — no type-specific block; the item is inert mechanically and the GM narrates its use
```

Weapons include staves and wands — use `type: "weapon"` with an appropriate slot (typically `main_hand` or `two_handed`) and a real `damage` for when the item is used as a club, plus a `magic.charges` block for the magical effect.

### Magic block

Optional on **any** item type. The design line:

> **Structured fields for common mechanical effects; prose for everything else.**

Enforced by the app: `attack_bonus`, `damage_bonus`, `ac_bonus`, `ability_bonus`, `save_bonus`, `skill_bonus`, `bonus_damage`, `damage_resistance`, `damage_immunity`, `charges.max`, `charges.recharge`.

Adjudicated narratively by the GM: `charge_effect`, `special_effects`.

```jsonc
"magic": {
  "attack_bonus":  1,                                    // optional — flat bonus to all attack rolls with this item
  "damage_bonus":  1,                                    // optional — flat bonus to weapon damage
  "ac_bonus":      1,                                    // optional — flat bonus to AC (on any slot)

  "ability_bonus": { "str": 0, "dex": 1 },               // optional — keyed by rules-pack ability id
  "save_bonus":    { "all": 1, "wis": 2 },               // optional — keyed by save id; "all" is a reserved shortcut
  "skill_bonus":   { "stealth": 2 },                     // optional — keyed by rules-pack skill id

  "bonus_damage":        { "amount": "1d4", "type": "fire" },  // optional — extra dice on a weapon hit
  "damage_resistance":   [],                             // optional — damage type ids taken at half while equipped
  "damage_immunity":     [],                             // optional — damage type ids ignored while equipped

  "charges": {                                           // optional — wands, staves, charged rings
    "max":      3,                                       // required when charges is present
    "recharge": "long_rest"                              // required when charges is present; "long_rest" | "short_rest" | "daily" | "none"
  },
  "charge_effect":   "Spend 1 charge to cast …",         // optional — prose; GM adjudicates
  "special_effects": "Sheds dim light; undead flinch …"  // optional — prose escape hatch for anything structural fields don't cover
}
```

**`save_bonus` shape:**

- Keys are save ids (ability ids when `saves.type: "per_ability"`; category ids when `"categorical"`).
- Reserved key `"all"` applies to every save. Specific keys **stack** on top — `{ "all": 1, "wis": 2 }` = +1 to every save, +3 to wisdom saves.
- Flat numbers only. Advantage/disadvantage on saves goes in `special_effects` prose.

**`skill_bonus` shape:**

- Keys are skill ids from `character_model.skills`.
- Flat numbers only. No `"all"` shortcut (universal skill bonuses are rare enough that the convention isn't worth the complexity).
- Advantage/disadvantage on skills goes in `special_effects` prose.

### Tags

Free-form string array (`["magical", "cursed", "quest-item", "silvered", "heirloom"]`). No controlled vocabulary in v1 — useful for authoring tools and future treasure generation.

### Cursed / attunement / item sets

Handled as prose in `magic.special_effects` for v1. Structured mechanics deferred to v2.

### Reference example

`items_lantern_and_blade.json`.

---

## Adventure Module

The playable content: rooms connected by connections, populated with features, encounters, and hazards. The most structurally rich archetype. v1 supports dungeon-style modules (rooms + connections); hex crawls, point crawls, and overland travel are v2.

This section covers the module's structural spine — outer shape, metadata, rooms, connections, environment, module-scoped libraries, and completion condition. The **content trinity** (features, encounters, hazards) and **feature prerequisites** are covered in the next section.

### Top-level shape

```jsonc
{
  "module":     { /* metadata block */ },   // required
  "rooms":      { /* keyed object, id → room */ },   // required

  "module_bestiary": { /* optional — one-off monsters scoped to this module */ },
  "module_items":    { /* optional — one-off items scoped to this module */ },

  "completion_condition": { /* optional — null or omitted means GM judges narratively */ }
}
```

### `module` — metadata block

```jsonc
{
  "module": {
    "id":                 "watch_at_crows_hollow",   // required — machine id
    "title":              "The Watch at Crow's Hollow",  // required — display title
    "version":            "1.0",                     // optional
    "author":             "…",                       // optional
    "description":        "A derelict Warden watch-house…",  // optional — pack-picker blurb
    "starting_room":      "watch_house_yard",        // required — room id the player begins in
    "level_range":        { "min": 2, "max": 4 },    // optional — advisory, shown in pack picker
    "estimated_rooms":    6,                         // optional — pack-picker info
    "estimated_playtime": "75–90 min",               // optional — pack-picker info
    "tags":               ["undead", "horror", "short"],  // optional — free-form v1
    "guidance":           "crows_hollow_guidance.md" // optional — path to module guidance sidecar
  }
}
```

**`starting_room` must resolve to a key in `rooms{}`.** The validator checks this.

### Guidance sidecar (`<name>_guidance.md`)

Optional markdown. Loaded alongside rules-pack guidance. Good homes for:

- Author's running notes.
- Tone essays / pacing philosophy for this specific module.
- Rules-pack-specific adjustments ("if running under Shadowdark, …").
- Design intent / spoiler / reveal guidance.

---

### Rooms

```jsonc
{
  "rooms": {
    "watch_house_yard": {
      "id":          "watch_house_yard",             // required — must match the map key
      "name":        "The Watch-House Yard",         // required — display label
      "description": "The road from Thornford's…",   // required — player-facing on first entry

      "tags": ["lore", "empty", "approach"],         // optional — pacing hints: "encounter" | "puzzle" | "empty" | "treasure" | "boss" | "lore" | "hub" | "searchable"

      "connections": { /* see "Connections" below */ },  // required — may be an empty object for dead-end rooms

      "environment": { /* optional — see "Environment" below */ },

      // The content trinity — arrays always present, possibly empty. Covered in the next section.
      "features":   [],   // required array — may be empty
      "encounters": [],   // required array — may be empty
      "hazards":    []    // required array — may be empty
    }
  }
}
```

**First-visit vs. revisit narration** is not structured. The GM naturally varies description on re-entry based on the room's `description` and state.

### Connections

Room-to-room connections are declared as a keyed object inside each room. **The key is a stable machine id** used by `unlock_connection` / `reveal_connection` effects. Two forms are supported.

**Simple form** — just a machine id → room id:

```jsonc
"connections": {
  "out": "village_square"                  // machine id → room id; no state, defaults to "open"
}
```

**Structured form** — machine id → full object:

```jsonc
"connections": {
  "iron_strapped_door": {
    "label":        "the iron-strapped door",      // optional — player-facing UI string; falls back to the title-cased key
    "to":           "lantern_room",                // required — target room id
    "state":        "locked",                      // required — "open" | "locked" | "hidden"
    "reveal_hint":  "Perception DC tier: easy"     // optional — prose hint the GM can surface when a relevant check succeeds
  }
}
```

**Fields:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `to` | string (room id) | required | Target room. Must resolve. |
| `state` | enum | required | `"open"` \| `"locked"` \| `"hidden"` — initial state. `"locked"` shows in UI but blocks traversal; `"hidden"` is invisible until revealed. |
| `label` | string | optional | Player-facing UI string. Falls back to title-cased key (`iron_strapped_door` → "Iron Strapped Door"). |
| `reveal_hint` | string | optional | Prose the GM may use when a relevant check or action reveals a hidden/locked connection. |

**Use the simple form when there's no state to track.** Use the structured form when the connection starts locked or hidden, or when the display label is meaningfully different from the key.

**Effects that modify connections** (fired from features, encounters, or puzzles):

- `unlock_connection` — sets `state: "open"` on a target connection id.
- `reveal_connection` — same, but intended for connections that started hidden (UI may animate the reveal).

Targets are the machine-id key of the connection (e.g., `"secret_door"`), not the target room id.

### Environment

Optional per-room block — atmospheric flavor plus any mechanical modifiers.

```jsonc
"environment": {
  "name":        "Waist-deep Water",                // optional — short label for UI
  "description": "Cold water sloshes around your waist, slowing every step.",  // required
  "effects": [                                      // optional — array of prose effects
    "Movement is halved.",
    "Ranged weapons requiring two hands cannot be used.",
    "Fire sources extinguish on contact."
  ]
}
```

Effects are prose applied by the GM. Structured environment modifiers (auto-applied by the app) are v2. Module-level default environment (applies to all rooms unless overridden) is also v2.

---

### Module-scoped bestiary

Optional top-level block for one-off bosses and unique NPCs that shouldn't live in the shared bestiary. Same shape as the standalone Bestiary Pack's `monsters{}`.

```jsonc
"module_bestiary": {
  "id":          "crows_hollow_module_bestiary",    // required
  "name":        "Crow's Hollow — Module Foes",     // required
  "description": "Unique foes specific to this module.",  // optional
  "monsters": {                                     // required
    "warden_lieutenant_havel": { /* full monster shape — see Bestiary section */ }
  }
}
```

**Resolution order:** the `monster_ref` resolver checks `module_bestiary.monsters` first, then falls back to the shared `bestiary.monsters`. A module-scoped id shadows a shared-library id of the same name (authors can override shared monsters for a specific module this way, though it's typically cleaner to pick a unique id).

### Module-scoped items

Same pattern for module-unique items.

```jsonc
"module_items": {
  "id":          "crows_hollow_module_items",
  "name":        "Crow's Hollow — Module Items",
  "description": "Unique items specific to this module.",
  "items": {
    "wardens_journal": { /* full item shape — see Items section */ }
  }
}
```

Checked first by the `item_id` resolver, then the shared items library.

---

### Completion condition

Optional top-level block. Declares when the app should fire the end-of-module event (summary screen, final rewards, disable further interaction).

```jsonc
"completion_condition": {
  "type":   "defeat_encounter",       // required — "defeat_encounter" | "reach_room" | "all_encounters_defeated" | null
  "target": "warden_lieutenants_last_stand"  // required for "defeat_encounter" and "reach_room"; omit for "all_encounters_defeated"
}
```

**`type` values:**

| Value | Meaning | `target` |
|---|---|---|
| `"defeat_encounter"` | Completes when the named encounter is fully resolved (all groups defeated). | encounter id |
| `"reach_room"` | Completes on first entry to the named room. | room id |
| `"all_encounters_defeated"` | Completes when every encounter in every room is defeated. | omit |
| `null` (or the block omitted) | GM judges narratively; no app-fired completion. | — |

Complex multi-ending logic is deferred to v2.

---

## Adventure Module — the content trinity

Each room carries three content arrays: **features**, **encounters**, and **hazards**. All three are always present (possibly empty). They serve distinct purposes and the schema enforces the separation.

| Property | Feature | Encounter | Hazard |
|---|---|---|---|
| HP / AC? | No | Yes (via bestiary) | No |
| Triggers `[COMBAT: on]`? | No | **Yes** | **No** |
| Causes damage? | **Never** | Yes (attack rolls) | Yes (declared damage) |
| Uses skill checks? | Often | Sometimes | Often (detect, avoid) |
| GM treats as… | Detail or puzzle | Adversary | Environmental condition |

**Strict rule:** features never deal damage. If an interaction can damage the player, it's a hazard.

**Validator enforces:**

- Hazards cannot contain `monster_ref`.
- Encounters must contain `monster_ref` (on at least one group).
- Features cannot declare damage in any outcome.

---

### Features

Four sub-types, identified by the `type` field. All four share a common head; each has its own body shape.

**Universal fields (every feature):**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | required | Unique within the module. |
| `type` | enum | required | `"lore"` \| `"searchable"` \| `"interactive"` \| `"puzzle"`. |
| `name` | string | required | Display label. |
| `description` | string | required | Player-facing, first-look prose. |
| `on_examine` | string | optional | Deeper prose revealed when the player looks more closely. Available on any type. |
| `gm_notes` | string | optional | GM-facing hint. Not shown to the player. |
| `prerequisites` | object | optional | Gate on feature state / encounter defeat. See "Feature prerequisites" below. |
| `prereq_hint` | string | optional | Breadcrumb the GM can surface when prerequisites are unmet. |

**Strict typing rule:** mixed-type features are split into multiple features. A painting with a hidden compartment is one `lore` feature (the painting) plus one `searchable` feature (the compartment), discovered via the lore feature's `on_examine`.

#### 1. `lore`

Pure information or atmosphere. Stateless.

```jsonc
{
  "id":          "blood_stain",
  "type":        "lore",
  "name":        "Blood-stained Floor",
  "description": "Dried bloodstains spatter the floor.",
  "on_examine":  "Closer inspection reveals ritual drainage patterns."   // optional
}
```

Lore features have no `reward[]` (stateless, informational). No mechanical outcome.

#### 2. `searchable`

Hidden content revealed by a check.

```jsonc
{
  "id":          "old_tomes",
  "type":        "searchable",
  "name":        "Old Tomes",
  "description": "Shelves of dust-covered books.",
  "check":       { "skill": "investigation", "ability": "int", "dc_tier": "medium" },  // required
  "on_success":  "You find a rolled map of the crypt.",        // required — prose
  "on_failure":  "Nothing of use.",                            // required — prose
  "reward":      [                                             // optional — reward shape array
    { "type": "item", "item_id": "crypt_map", "quantity": 1 }
  ],
  "persists":    true                                          // required — true = stays searched, false = can retry
}
```

**Notes:**

- `check` uses the standard check shape (see Conventions). Use `skill: null` for raw ability saves.
- `reward[]` fires on success only. No rewards on `lore` features.
- `persists: true` means the feature's `searched` state sticks in the save file; the player can't re-roll.

#### 3. `interactive`

Manipulable features with explicit state — levers, buttons, dials, altars.

```jsonc
{
  "id":            "stone_lever",
  "type":          "interactive",
  "name":          "Stone Lever",
  "description":   "A heavy stone lever.",
  "states":        ["up", "down"],         // required — string array of possible states
  "initial_state": "up",                   // required — must be one of states[]
  "actions": {                             // required — keyed by state; each value is the action available IN that state
    "up": {
      "label":   "Pull down",              // required — UI button text
      "result":  "Distant grinding echoes.",  // required — prose shown on use
      "effects": [                         // optional — side effects; see "Effects" below
        { "type": "unlock_connection", "target": "sealed_door" }
      ],
      "reward":  []                        // optional — reward shape array
    },
    "down": {
      "label":   "Push up",
      "result":  "It won't budge.",
      "effects": []
    }
  }
}
```

**Notes:**

- After an action fires, the feature transitions to the other state (or stays put if the state machine doesn't progress — see "Push up" above where the down-state action is narratively a no-op).
- `effects[]` accepts the same shape described below under "Effects".
- `reward[]` may be attached per-action and fires when that action is taken.

#### 4. `puzzle`

Structured challenges with a declared solution.

```jsonc
{
  "id":          "time_riddle",
  "type":        "puzzle",
  "name":        "The Sage's Riddle",
  "description": "'I am always coming, but never arrive.'",
  "solution": {                                    // required
    "description": "Time. Accept 'tomorrow' and similar variations.",  // required — GM-facing; prose
    "check":       null                            // required — null | standard check object
  },
  "on_success": {                                  // required
    "narration": "The voice whispers approval.",   // required
    "effects":   [                                 // optional
      { "type": "unlock_connection", "target": "sage_chamber" }
    ],
    "reward":    []                                // optional — reward shape array
  },
  "on_failure": {                                  // required
    "narration": "The voice goes quiet."           // required
  }
}
```

**Puzzle resolution — three modes using the same shape:**

1. **Pure narrative:** `check: null`, `solution.description` describes the answer. Player says the right thing; the puzzle resolves. (Riddles, passwords, clever answers.)
2. **Narrative bypass + check fallback:** `check` is set AND `solution.description` describes the answer. The GM recognizes the clever solve; otherwise offers the roll.
3. **Check-gated:** `check` is set, `solution.description` is cryptic or GM-only. No narrative shortcut.

**Multi-step puzzles** are authored by chaining multiple features: each step is its own feature whose `effects[]` calls `activate_feature` on the next. The final feature's effects open the gate. Sequence enforcement in v1 is prose-only (the GM reads puzzle descriptions and enforces order narratively); structured prerequisite chaining is in the next section.

---

### Effects

Used by interactive actions, puzzle `on_success`, and (via a different name) on encounter `on_defeat_effects`. Same shape in all three cases.

```jsonc
{ "type": "unlock_connection", "target": "sealed_door" }
{ "type": "reveal_connection", "target": "hidden_passage" }
{ "type": "activate_feature",  "target": "altar", "state": "blessed" }
```

**v1 effect types:**

| `type` | `target` | Optional fields | Effect |
|---|---|---|---|
| `unlock_connection` | connection id | — | Sets the named connection's `state` to `"open"`. |
| `reveal_connection` | connection id | — | Makes a hidden connection visible; also sets `state: "open"`. |
| `activate_feature` | feature id | `state` (string) | Fires another feature. For interactive targets, `state` sets the target's `current_state`. |

Other effect types — `spawn_encounter`, `trigger_event`, `end_module` — are deferred to v2.

---

### Encounters

One combat event per encounter. Mixed-creature encounters are first-class via `groups[]`.

```jsonc
{
  "id":    "tomb_guardians",                      // required
  "name":  "The Tomb Guardians",                  // required — display label

  "groups": [                                     // required — at least one group
    { "monster_ref": "skeleton_warrior", "quantity": 2 },   // monster_ref resolves against module_bestiary → bestiary
    { "monster_ref": "skeleton_captain", "quantity": 1 }
  ],

  "trigger": {                                    // required
    "type":      "on_enter",                      // required — "on_enter" | "on_condition" | "scripted"
    "condition": null                             // required when type is "on_condition" — prose the GM reads; null otherwise
  },

  "placement": "…",                               // optional — prose; where/how the creatures appear
  "behavior":  "…",                               // optional — tactical hint
  "gm_notes":  "…",                               // optional — GM-facing guidance

  "rewards": {                                    // optional
    "xp": "from_bestiary",                        // optional — "from_bestiary" (default) OR a fixed integer override
    "treasure": [                                 // optional — array of reward shapes; module-owned
      { "type": "gold", "amount": "2d6" },
      { "type": "item", "item_id": "silver_dagger", "quantity": 1 }
    ]
  },

  "on_defeat_effects": [                          // optional — fires when ALL groups defeated
    { "type": "unlock_connection", "target": "secret_door" }
  ]
}
```

**Groups:**

- Each group = one monster type + a quantity. Each creature instance is tracked independently at runtime (HP bars per instance, not per group).
- Solo encounter = one group with `quantity: 1`.

**XP ownership:** bestiary entries carry a `xp_value` default; encounters inherit via `"xp": "from_bestiary"` (sum of `quantity × bestiary.xp_value` across groups). Encounters may override with a fixed integer (useful for set-piece boss fights valued differently from the bestiary default).

**Treasure ownership:** module-owned. The bestiary doesn't carry treasure data; it lives only on encounters.

**Trigger types:**

| Value | Meaning | `condition` |
|---|---|---|
| `"on_enter"` | Fires the first time the room is entered. | — (null) |
| `"on_condition"` | Fires when a GM-judged condition is met (prose-driven). | required — prose the GM evaluates |
| `"scripted"` | Fires when an effect or system event triggers it (typically from another feature's `effects`). | — (null) |

Wandering-monster triggers are deferred to v2 (they need an exploration-turn counter).

---

### Hazards

Environmental dangers — traps, corrupted zones, hostile terrain. Never carry `monster_ref`; never trigger `[COMBAT: on]`.

```jsonc
{
  "id":           "pressure_plates",               // required
  "name":         "Pressure-plate Trap",           // required
  "description":  "Darts fire from the walls when the plates are triggered.",  // required
  "gm_notes":     "Let low-HP players retreat without penalty.",  // optional

  "trigger": {                                     // required
    "type":   "on_traverse",                       // required — "on_enter" | "on_traverse" | "on_interact" | "on_examine"
    "target": null                                 // optional — feature or connection id when the hazard is tied to one
  },

  "detection": {                                   // optional — present when the hazard can be spotted in advance
    "check":      { "skill": "perception", "ability": "wis", "dc_tier": "easy" },  // required within detection
    "on_success": "You spot the safe path — the plates are slightly discolored."   // required within detection
  },

  "avoidance": {                                   // optional — present when the hazard can be rolled against
    "check":      { "skill": "acrobatics", "ability": "dex", "dc_tier": "medium" },  // required within avoidance
    "on_success": "You pick your way across without triggering it.",                 // required within avoidance
    "on_failure": {                                                                  // required within avoidance
      "narration":  "Darts fire from the walls; one strikes deep.",                  // required
      "damage":     { "amount": "1d6+1", "type": "piercing" },                       // optional — reward-like shape
      "conditions": []                                                               // optional — condition ids to apply
    }
  },

  "reward_on_detection": { "xp": 10, "narration": "…" },   // optional — classic-OSR flavor
  "reward_on_avoidance": { "xp": 5 },                      // optional

  "persists":             false,                   // required — true = fires again on every qualifying revisit; false = fires once
  "resolved_by_detection": true,                   // required — if true, successful detection skips the avoidance roll entirely
  "cooldown_rounds":      0                        // optional — RESERVED for v2; ignored in v1
}
```

**The four hazard shapes emerge from which blocks are present:**

| Detection? | Avoidance? | Shape | Example |
|---|---|---|---|
| ✓ | ✓ | **detect-then-avoid** | Pressure plate trap (standard) |
| — | ✓ | **pure-avoidance** | Crypt chill, unavoidable hostile terrain |
| — | — | **automatic** | Unavoidable damage on entry (narrated via `trigger` + custom prose) |
| ✓ | — | **interaction-gated** | Detected-only hazards; effect resolved via connected features |

No type enum is needed — the presence of blocks tells the app (and the GM) which shape applies.

**Triggers:**

| Value | Meaning |
|---|---|
| `"on_enter"` | Fires the first time the room is entered. |
| `"on_traverse"` | Fires when moving through the affected area (repeatable if `persists: true`). |
| `"on_interact"` | Fires when the player interacts with a specific feature or connection (`target` required). |
| `"on_examine"` | Fires when the player examines the trigger target closely (`target` required). |

**Reward fields** (`reward_on_detection`, `reward_on_avoidance`) accept only `xp` and `narration` in v1. Treasure-as-hazard-reward is not a v1 pattern.

---

### Feature prerequisites

Lightweight gating on features. When prerequisites are not met, the feature is **hidden** from the UI; an optional `prereq_hint` lets the GM drop a breadcrumb.

```jsonc
"prerequisites": {
  "feature_state": {
    "crown_button":     "pressed",      // interactive: must match the target's current_state
    "wardens_journal":  "succeeded",    // searchable: satisfied when tracked succeeded == true
    "time_riddle":      "solved"        // puzzle: satisfied when tracked solved == true
  },
  "encounter_defeated": ["guardian"]    // array of encounter ids that must be resolved
},
"prereq_hint": "The sceptre rune glows faintly, but something about the crown still needs attention."
```

**Logic:** AND only. Every declared condition must be satisfied.

**`feature_state` string convention per sub-type:**

| Target feature type | Value | Meaning |
|---|---|---|
| `interactive` | any state string | Satisfied when the target's `current_state` equals this value. |
| `searchable` | `"succeeded"` | Satisfied when tracked `succeeded == true`. |
| `searchable` | `"searched"` | Satisfied when tracked `searched == true` (regardless of success). |
| `puzzle` | `"solved"` | Satisfied when tracked `solved == true`. |
| `lore` | — | Lore features are stateless and cannot be referenced in prereqs. |

**Unlocks:** multi-step puzzles via feature chaining, staged reveals, gated progression.

**Deferred to v2:** OR logic, negated conditions, complex expressions; prereqs on encounters / hazards / connections; scripted state-transition events.

### Reference example

`module_crows_hollow.json` + `crows_hollow_guidance.md`.

---

## Character

Pregen or player-built character sheet. Stores **raw values only**; everything displayed is derived at runtime from raw values + active rules pack + equipped items. When the rules pack changes its formulas, the character renders differently without migration.

### Stored vs. computed

**Stored in character JSON:**

- Ability scores (raw)
- Class id, level, XP
- Current HP (max is derived)
- Equipment (slot assignments), pack contents
- Charged-item state, feature-resource pools
- Active condition ids
- Gold
- Proficient saves and skills (id lists)
- Class features (prose)

**Derived at render time (NOT stored):**

- Ability modifiers (from `rules.modifier_formula`)
- HP max (from class + level + CON via rules pack)
- AC (equipped armor + dex + magic bonuses)
- Attack / damage totals (ability mod + proficiency + magic)
- Save totals, skill modifiers
- Encumbrance load (sum of `weight_slots`)
- Proficiency bonus (from the rules pack's `level_table` row for the character's level)

### Top-level shape

```jsonc
{
  "character": {
    "id":              "ren_callory_v1",                // required — machine id
    "game_pack_id":    "lantern_and_blade_starter_v1",  // required — must match the manifest id
    "schema_version":  1,                               // required — integer

    "basic_info": {
      "name":  "Ren Callory",                           // required
      "class": "fighter",                               // required — rules pack class id; "" for classless packs
      "level": 3                                        // required — integer ≥ 1
    },

    "ability_scores": {                                 // required — keyed by ability id from rules pack
      "str": 16, "dex": 12, "con": 14,
      "int": 10, "wis": 13, "cha": 8
    },

    "saves": {
      "proficient": ["str", "con"]                      // required — id list (ability ids or category ids depending on saves.type)
    },

    "skills": {
      "proficient": ["athletics", "perception"]         // required — skill id list; [] for skill-less packs
    },

    "hp_current": 28,                                   // required — current only; max is derived

    "equipment": [                                      // required — flat array
      { "item_id": "lanternblade",  "slot": "main_hand" },
      { "item_id": "chain_mail",    "slot": "body" },
      { "item_id": "iron_shield",   "slot": "shield" },
      { "item_id": "ring_of_protection", "slot": "ring" }
    ],

    "pack": [                                           // required — array of { item_id, quantity }
      { "item_id": "healing_potion", "quantity": 2 },
      { "item_id": "torch",          "quantity": 3 }
    ],

    "charged_items": {                                  // required — may be empty object {}
      "wand_of_fireball": { "current_charges": 2 }
    },

    "feature_resources": {                              // optional — spell slots, per-rest uses
      "second_wind": {
        "name":     "Second Wind",
        "current":  1,
        "max":      1,
        "recharge": "short_rest"                        // "long_rest" | "short_rest" | "daily" | "none"
      }
    },

    "conditions": [],                                   // required — active condition ids; empty array if none

    "gold": 15,                                         // required — integer ≥ 0
    "xp":   900,                                        // required — integer ≥ 0

    "class_features": [                                 // required — may be empty array
      {
        "id":          "second_wind",
        "name":        "Second Wind",
        "description": "Once per short or long rest, spend a bonus action to regain 1d10 + fighter level HP. Decrement via [RESOURCE_USE: second_wind]."
      }
    ],

    "guidance": "ren_callory_guidance.md"               // optional — path to character guidance sidecar
  }
}
```

### Equipment

- Flat array. Each entry: `item_id` (required), `slot` (required — a valid slot string for the item's type).
- Multiple items may share a slot label (two rings both use `"slot": "ring"`); the app enforces count against the rules pack's `slot_limits`.
- A two-handed item (`slot: "two_handed"` at the item level) occupies both `main_hand` and `off_hand` — no special encoding needed on the character side.

### Feature resources

Character-side resource pools for class features that expend and recharge — spell slots, Second Wind, Channel Divinity, ki points.

- Pool ids are free-form strings scoped to the character (no rules-pack registry in v1).
- The app surfaces each pool as `current / max` in the character panel; the player may decrement directly.
- The GM may signal use mid-narration with an inline tag `[RESOURCE_USE: <pool_id>]`; the app decrements on the tag.
- `recharge` restores `current → max` when the corresponding rest event fires. `"none"` means refill only on specific in-fiction conditions (GM narrates).
- Prose in `class_features[].description` should reference the pool id so the GM knows which to decrement.

### Class features

Prose-only in v1. An array of `{ id, name, description }` objects. The GM reads and adjudicates; no structured feature tree. Level-ups add entries to the array (designer- or GM-authored).

Structured class systems — spells, subclass trees, per-level progression tables — are v2.

### Guidance sidecar (`<name>_guidance.md`)

Optional markdown. Appearance, personality, backstory, voice notes, notable relationships. Everything flavor lives here; the JSON has no `appearance` / `personality` / `backstory` fields.

### Reference example

`character_ren_callory.json` + `ren_callory_guidance.md`.

---

## Save state

Written by the app per play-through. Authored packs never touch this format — it's documented here so the validator, migration tooling, and any debugging work all read from the same spec.

### Top-level shape

```jsonc
{
  "schema_version": 1,                                // required — integer; increments on breaking save-format changes
  "game_pack_id":   "lantern_and_blade_starter_v1",   // required — matches manifest id
  "module_id":      "watch_at_crows_hollow",          // required — matches module.id

  "current_room":  "gate_room",                       // required — room id
  "visited_rooms": ["watch_house_yard", "gate_room"], // required — ordered array, first entry is the starting room

  "encounters": {                                     // required — keyed by encounter id
    "barracks_haunting": {
      "resolved":  true,
      "instances": [
        { "monster_ref": "restless_spirit",  "instance_id": "rs_1", "current_hp": 0, "defeated": true },
        { "monster_ref": "skeleton_warrior", "instance_id": "sw_1", "current_hp": 0, "defeated": true }
      ]
    }
  },

  "hazards": {                                        // required — keyed by hazard id
    "rotten_floorboard": {
      "state":       "detected",                      // "undetected" | "detected" | "triggered" | "avoided"
      "times_fired": 0
    }
  },

  "features": {                                       // required — keyed by feature id; shape depends on sub-type
    "muster_roll":    { /* lore — no state tracked; entry may be omitted */ },
    "overturned_locker": { "searched": true, "succeeded": true },
    "stone_lever":    { "current_state": "down" },
    "time_riddle":    { "solved": true }
  },

  "connections_modified": {                           // required — only connections whose state has changed
    "iron_strapped_door": { "state": "open" }
  },

  "combat": {
    "in_combat": false,
    "round":     0                                    // starts at 1 when combat begins; resets to 0 when it ends
  },

  "completion": {
    "completed":     false,
    "conditions_met": {}
  }
}
```

### Notes

- **Deltas only.** Features/hazards/connections are stored only when they differ from the module's authored initial state.
- **Per-instance HP.** Encounters track every creature instance independently — the same monster type with quantity 3 produces three entries in `instances[]`.
- **Round counter** increments per combat round; `[COMBAT: off]` resets it to 0.
- **Schema version** is incremented on breaking save-format changes; the app will need a migration path at that point. No migrations required in v1.

---

## Validator responsibilities

A compact checklist for the validator rewrite (`json-validator.html`).

### Reference integrity

- Every path in the manifest resolves.
- Character's `game_pack_id` matches manifest `id`.
- Every `monster_ref` resolves in `module_bestiary.monsters` or `bestiary.monsters` (module-scoped first).
- Every `item_id` resolves in `module_items.items` or `items_library.items` (module-scoped first).
- Every connection target is a valid room id.
- Every `unlock_connection` / `reveal_connection` target is a valid connection id in the relevant room.
- Every `activate_feature` target is a valid feature id.
- Every `encounter_defeated` id in prerequisites is a valid encounter id.
- Every `feature_state` id in prerequisites is a valid feature id.
- Every `completion_condition.target` is a valid encounter or room id, per `type`.
- Every condition id in hazards / character is declared in `rules.conditions`.
- Every damage-type id in weapons / attacks / magic / resistances is declared in `rules.resources.damage_types` (when damage types are enabled on the pack).
- Every ability id in skills / saves / formulas / magic bonuses is declared in `rules.character_model.abilities`.
- Every skill id in character / checks / magic bonuses is declared in `rules.character_model.skills`.
- Every slot on character equipment is a valid slot for the item's type; slot-count respects `rules.character_model.slot_limits`.

### Archetype-specific rules

- **Hazards:** no `monster_ref` anywhere. `detection` and `avoidance` blocks are optional; at least one must be present for the hazard to do anything.
- **Encounters:** must have `groups[]` with at least one group carrying a `monster_ref`.
- **Features:** no damage in any outcome (`on_failure`, `on_success`, action `result`). Lore features have no `reward[]`, no `check`, no `states`, no `solution`.
- **Feature typing:** `type` must be one of `lore` / `searchable` / `interactive` / `puzzle`. Each sub-type's required body fields must be present (see the Features section).
- **Connections:** structured form's `state` must be `"open"` / `"locked"` / `"hidden"`.
- **Interactive features:** `initial_state` must be in `states[]`; every key in `actions{}` must be in `states[]`.

### Required-field checks

- All fields marked **required** above must be present.
- All fields marked **conditional** must be present when their triggering condition is met (e.g. `classes` when `uses_classes: true`).

### Warnings (non-fatal)

- Inline monster stat blocks that could be moved to `module_bestiary`.
- `starting_room` not reachable via any connection chain (likely authoring error but possibly intentional).
- Hazards with neither `detection` nor `avoidance` (might be deliberate "automatic" shape, but worth flagging).
- Empty `attacks[]` on monsters — technically valid, usually an oversight.

---

## Controlled vocabularies

Two small v1 surfaces with fixed vocabularies. These are authoritative for v1.

### Condition icon library

The `conditions[].icon` field takes an id from the fixed library below. The runtime maps each id to a concrete visual; pack authors do not author the glyph itself. Custom icons remain a v2 feature.

| Icon id | Typical use |
|---|---|
| `skull` | frightened, dying, cursed (also the fallback for any unrecognized icon id) |
| `drop` | poisoned, bleeding, wounded |
| `fire` | burning, on-fire |
| `eye` | blinded, watched, seen |
| `chains` | grappled, restrained, bound |
| `heart` | charmed, friendly |
| `lightning` | stunned, shocked, paralyzed |
| `moon` | unconscious, asleep |
| `falling` | prone, knocked down |
| `snowflake` | frozen, slowed |
| `sun` | blessed, illuminated, inspired |
| `shield` | warded, guarded, protected |
| `sword` | empowered, enraged, sharpened |
| `hand` | incapacitated, gripped |
| `swirl` | confused, dazed, disoriented |
| `ear` | deafened, silenced |
| `stone` | petrified, ossified |

**Fallback:** unrecognized icon ids render as `skull`. Authors get a warning from the validator; the app keeps running.

**Covers** the 5e SRD condition list in full, the OSR condition set, and common buff conditions (blessed, guarded, empowered) that packs frequently declare alongside the debuffs.

### `consumable.on_use` keywords

The `consumable.on_use` field takes one of the three keywords below. The shape of the sibling `amount` field depends on which keyword is chosen.

| Keyword | `amount` shape | App behavior |
|---|---|---|
| `heal_player` | Dice string (`"2d4+2"`) or integer | App rolls or reads the value, adds it to current HP, clamps to HP max. |
| `cure_condition` | Condition id string (`"poisoned"`) or array of ids (`["poisoned", "frightened"]`) | App removes each id from `character.conditions`. Ids not currently on the character are no-ops. |
| `gm_adjudicate` | Prose | App shows a "use item?" confirmation; on confirm, the GM narrates the effect using `amount` as flavor. |

**Fallback:** any unrecognized `on_use` value is treated as `gm_adjudicate`. This means pack authors can ship bespoke consumables without waiting for a schema bump — they just lose the app's structured handling.

**Deferred to v2:** `buff_ability` and `buff_save` were candidates but require a duration system (per-encounter ticks, time-limited effects) that v1 does not have. Ship those as `gm_adjudicate` with prose duration until v2 lands the tick model.

---

## Deferred to v2

The full deferred-feature list lives in `RULES_SCHEMA_PLAN.md` (search for "Deferred to v2"). Summary:

- Tier 2 systems (PbtA, Blades, FATE, Savage Worlds)
- 2d10 resolution, descending AC, death saves
- Individual-roll initiative + full turn-order UI
- Stacking conditions, structured condition effects, auto-expiring conditions
- Per-class XP tables, structured class systems (spells, subclass trees, per-level feature progression)
- OR logic / complex expressions in feature prerequisites; prereqs on encounters/hazards/connections
- Additional effect types: `spawn_encounter`, `trigger_event`, `end_module`
- Multi-currency (cp/sp/gp/pp); shops / appraisal / item valuation
- Structured magic-item advantage/disadvantage; attunement; item sets; cursed mechanics
- Random loot tables (weighted outcomes, nested rolls)
- Wandering-monster triggers, exploration-turn counter, round-based hazard cooldowns
- Module-level default environment; hex crawl / point crawl / overland travel modules
- Custom condition icons; tags / categories on rules packs for pack-picker filtering
- Bestiary inheritance / templates; structured monster attack riders
- Formal signature-mechanic primitives (torch timers, crit tables, etc.)
- Customizable GM personality profiles (layered: rules → module → user)

When any of these ships, this doc is updated alongside the schema change.

---

## Reference implementation

The full v1 starter pack lives in the repo root:

- `game_pack_lantern_and_blade.json`
- `rules_lantern_and_blade.json` + `lantern_and_blade_guidance.md`
- `setting_hollowmarch.json` + `hollowmarch_lore.md`
- `bestiary_lantern_and_blade.json`
- `items_lantern_and_blade.json`
- `module_crows_hollow.json` + `crows_hollow_guidance.md`
- `character_ren_callory.json` + `ren_callory_guidance.md`

When the schema and this doc disagree, the plan doc (`RULES_SCHEMA_PLAN.md`) is the tiebreaker.
