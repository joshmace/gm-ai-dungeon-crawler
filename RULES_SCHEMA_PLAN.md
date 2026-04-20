# Rules Pack Schema — Planning Document

> **Status:** Planning phase. Refactor to follow in a separate session.
> **Not a spec.** This is the working artifact of a design conversation; it captures decisions so far. The eventual `JSON_SCHEMAS.md` rewrite will be shorter and reference-shaped.

## Strategic frame

The Rules Pack is the heart of the product. The marketable promise is a **rules-agnostic solo TTRPG with an AI GM** — plug in Nimble, AD&D, Shadowdark, Knave, homebrew — and play.

- **Target tier:** Tier 1 only (d20-family OSR systems: 5e, Shadowdark, B/X, OSE, Knave, Cairn, Mausritter, Mörk Borg, AD&D, etc.)
- **Backwards compatibility:** none — clean slate
- **Design philosophy:** rules pack declares the shape; character pack fills in values; app renders dynamically. Within Tier 1 we constrain variation to a small menu of named presets per axis (not arbitrary customization).

---

## Decisions by question

### Q1 — System identity & meta

```jsonc
{
  "id": "shadowdark_v1",           // machine-readable, used for save/character validation
  "name": "Shadowdark RPG",
  "version": "1.0",
  "author": "...",
  "description": "Modern OSR with…",
  "design_philosophy": "..."       // prose; feeds into GM prompt's tone
}
```

No `tags` field for v1 (can add later for pack-picker filtering).

### Q2 — Character primitives

**Approach:** Option A — rules pack declares the shape, character pack fills in values. Preset-based per axis.

```jsonc
{
  "character_model": {
    "abilities": [
      { "id": "str", "name": "Strength", "abbr": "STR", "range": [3, 18] },
      { "id": "dex", "name": "Dexterity", "abbr": "DEX", "range": [3, 18] }
      // … etc. For 5e-shaped packs use [1, 20] (player achievable cap including ASI).
    ],
    "modifier_formula": "table_5e",    // "table_5e" | "table_bx" | "score_is_mod"
    "saves": {
      "type": "per_ability"            // "per_ability" | "categorical"
    },
    "skills": [                        // optional — omit for skill-less systems (B/X, Cairn, Knave)
      { "id": "stealth", "name": "Stealth", "ability": "dex" }
    ],
    "uses_classes": true,
    "classes": {                       // required when uses_classes: true; minimal metadata only
      "fighter": {
        "id": "fighter",
        "name": "Fighter",
        "hit_die": "1d10",             // feeds hp_gain_per_level when method is roll_class_hd_plus_con
        "description": "Martial specialist trained in a broad range of weapons and armor."
      },
      "wizard": {
        "id": "wizard",
        "name": "Wizard",
        "hit_die": "1d6",
        "description": "Scholar of arcane magic who prepares spells from a grimoire."
      }
    },
    "slot_limits": {                   // max equipped items per slot type; validated against character equipment[]
      "main_hand": 1, "off_hand": 1,
      "body": 1, "shield": 1,
      "head": 1, "hands": 1, "feet": 1,
      "neck": 1, "ring": 2,
      "cloak": 1, "belt": 1
    }
  }
}
```

**Skills notes:**
- Optional field. When absent, character panel hides Skills section; GM falls back to raw ability checks.
- Empty array `"skills": []` encouraged for deliberately skill-less packs (signals intent).
- Class-specific skill-like abilities (e.g., B/X thief X-in-6) live in class features, not here.

**Classes notes (v1):**
- Required when `uses_classes: true`. Minimal metadata only — id, name, hit_die, prose description.
- Class features (spells, per-level abilities, subclass trees) are carried on the character as prose in `class_features[]` per the Character walkthrough.
- Full structured class systems deferred to v2.

**Slot limits notes:**
- Declares max count per slot type. App's equip logic enforces these limits against the character's `equipment[]` array.
- **Two-handed weapons** are handled at the item level (`slot: "two_handed"`), not here — equipping a two-handed item occupies both `main_hand` and `off_hand`. No additional schema needed.

### Q3 — Resolution mechanic (checks)

```jsonc
{
  "resolution": {
    "checks": {
      "method": "roll_high_vs_dc",      // "roll_high_vs_dc" | "roll_under_score" (only two supported)
      "dice": "1d20",
      "crit_success": "nat_20",         // NARRATIVE CUE ONLY — no mechanical effect
      "crit_failure": "nat_1",          // NARRATIVE CUE ONLY — pack can set to "none" for gritty play
      "advantage_disadvantage": false   // REQUIRED declaration — see notes below
    },
    "auxiliary": {
      "x_in_6": false,        // surprise/secret doors/thief skills
      "reaction_roll": false, // 2d6 NPC reactions
      "morale_roll": false    // 2d6 monster morale
    }
  }
}
```

**What `advantage_disadvantage: true` wires up:**
- Prompt template includes explicit adv/disadv rules ("when a check benefits or suffers, roll 2d20 keep highest/lowest").
- GM may use extended roll-request syntax: `[ROLL_REQUEST: Ability, advantage]` or `[ROLL_REQUEST: Ability, disadvantage]`.
- App's dice UI handles the extended syntax — rolls 2d20, keeps the appropriate die, shows both in the callout.

**What `advantage_disadvantage: false` wires up:**
- Prompt explicitly tells the GM the system has no adv/disadv; use flat DC adjustments instead.
- Roll requests only accept base `[ROLL_REQUEST: Ability]` form.

### Q4 — Resource & damage model

```jsonc
{
  "resources": {
    "hit_points": {
      "max_formula": "class_hd_plus_con",  // moved here from Q2
      "at_zero": "dead",                   // "dead" | "unconscious" (no death_save in v1)
      "overflow": null                     // null OR { "to_ability": "str" } for Cairn-style
    },
    "healing": {
      "natural_rest": "full_overnight"     // "full_overnight" | "partial_overnight" | "minimal" | "none"
    },
    "damage_types": [                      // optional — omit entirely for typeless packs
      { "id": "slashing",    "name": "Slashing",    "narrative_cue": "blades carving and tearing" },
      { "id": "piercing",    "name": "Piercing",    "narrative_cue": "punctures driven deep" },
      { "id": "bludgeoning", "name": "Bludgeoning", "narrative_cue": "crushing impacts and broken bone" },
      { "id": "fire",        "name": "Fire",        "narrative_cue": "burning, searing, charring" },
      { "id": "cold",        "name": "Cold" }       // narrative_cue optional
    ]
  }
}
```

**Overflow** supported for Cairn-style damage cascading into ability scores (signature OSR mechanic).

**Damage types** with `narrative_cue` give the GM per-pack flavor direction and consistency. Especially useful for homebrew types (e.g., "void", "psychic").

### Q5 — Combat flow

```jsonc
{
  "combat": {
    "attack": {
      "resolution": "roll_high_vs_ac"     // "roll_high_vs_ac" | "auto_hit_no_roll"
    },
    "damage": {
      "formula": "weapon_die_plus_ability_mod",  // "weapon_die_plus_ability_mod" | "weapon_die_only"
      "melee_ability": "str",                     // ignored if formula is "weapon_die_only"
      "ranged_ability": "dex"
    },
    "critical_hit": {
      "trigger": "nat_20",                // "nat_20" | "none"
      "effect": "double_dice"             // "double_dice" | "max_damage" | "extra_die"
    },
    "initiative": {
      "type": "player_first"              // "player_first" | "side_based"
    }
  }
}
```

**Auto-hit attacks** (`auto_hit_no_roll`) supported for Cairn/Knave/Into the Odd lineage; partial Draw Steel fit.

**AC convention:** ascending only in v1.

**Initiative:** `individual` deferred to v2 (requires full initiative-tracker UI).

### Q6 — Conditions

Prose-based effects. The app tracks which conditions are active; the GM applies them narratively.

```jsonc
{
  "conditions": [
    {
      "id": "poisoned",
      "name": "Poisoned",
      "icon": "skull",                                    // from fixed library (v1)
      "description": "Toxic substance coursing through.",
      "effect": "−2 to attack rolls and ability checks",  // prose
      "removal": "Until cured by antitoxin or rest"
    }
  ]
}
```

**Fixed icon library** (~20 generic icons: skull, fire, drop, eye, chains, etc.) for v1. Custom icons deferred.

### Q7 — Progression

```jsonc
{
  "progression": {
    "type": "xp_and_level",              // "xp_and_level" | "milestone" | "none"
    "xp_sources": [                      // only meaningful for "xp_and_level"
      "monsters_defeated",
      "treasure_recovered",              // classic Gygaxian gold-as-XP (opt-in)
      "milestones"
    ],
    "level_table": [
      // proficiency_bonus is OPTIONAL — include when the system uses scaling PB (5e, Shadowdark).
      // Omit entirely for systems that don't use PB (B/X, Knave, Cairn, etc.).
      { "level": 1, "xp_required": 0,    "proficiency_bonus": 2 },
      { "level": 2, "xp_required": 300,  "proficiency_bonus": 2 },
      { "level": 3, "xp_required": 900,  "proficiency_bonus": 2 },
      { "level": 4, "xp_required": 2700, "proficiency_bonus": 2 },
      { "level": 5, "xp_required": 6500, "proficiency_bonus": 3 }
      // …etc
    ],
    "max_level": 10,
    "hp_gain_per_level": "roll_class_hd_plus_con"   // "roll_class_hd_plus_con" | "average_class_hd_plus_con" | "flat"
  }
}
```

**Proficiency bonus (optional):**
- When present on `level_table` rows, the character panel displays it and the app folds it into attack / save / skill totals for the character's proficient picks (from `character.saves.proficient[]` and `character.skills.proficient[]`).
- Omit the field entirely for systems that don't use PB. App hides it from the character panel and doesn't add it to totals.
- Universal mechanical hook — not per-class — so it lives on the level row, not inside class metadata.

Characters always start at level 1.

### Q8 — DCs / opposition (the difficulty ladder)

Shape depends on `resolution.checks.method`. Free-form tier count.

**For `roll_high_vs_dc`:**

```jsonc
{
  "difficulty": {
    "scale": [
      { "id": "easy",   "name": "Easy",   "dc": 10 },
      { "id": "medium", "name": "Medium", "dc": 15 },
      { "id": "hard",   "name": "Hard",   "dc": 20 }
    ],
    "auto_success": "trivial actions with no consequence",
    "auto_failure": "impossible actions"
  }
}
```

**For `roll_under_score`:**

```jsonc
{
  "difficulty": {
    "scale": [
      { "id": "easy",      "name": "Easy",      "modifier": +2 },
      { "id": "normal",    "name": "Normal",    "modifier":  0 },
      { "id": "hard",      "name": "Hard",      "modifier": -2 },
      { "id": "very_hard", "name": "Very Hard", "modifier": -4 }
    ],
    "auto_success": "...",
    "auto_failure": "..."
  }
}
```

`auto_success` / `auto_failure` stay as prose (GM judgment, not algorithmic).

Crit handling lives in `resolution.checks` (Q3), not here.

### Q9 — Prose-vs-data audit

Cleanup pass over the existing `rules.json` flavor-heavy fields. Three live topics: encumbrance, GM guidance prose, signature-mechanic creep.

**Encumbrance — real rules-pack concern; supported in v1.**

```jsonc
{
  "encumbrance": {
    "method": "none",              // "slots" | "weight" | "none"
    "slot_capacity": "str",        // only if method is "slots"; ability id OR fixed number
    "weight_formula": "15_times_str"  // only if method is "weight"
  }
}
```

Declared in all packs; `"none"` is an acceptable value. Inventory UI for slot/weight tracking gets built when we build the first pack that uses it (Shadowdark/Knave-style).

**GM guidance prose — move to a sidecar markdown file.**

Each rules pack can optionally carry a `guidance.md` sidecar. The prompt builder loads both the rules JSON and the sidecar, and injects the markdown into a dedicated `{{GUIDANCE_BLOCK}}` slot in the system prompt.

```jsonc
// Rules pack JSON
{
  "id": "shadowdark_v1",
  "guidance": "shadowdark_guidance.md"   // optional
}
```

What lives in the sidecar:
- Tone / pacing philosophy (beyond the one-line `design_philosophy`)
- System-specific running notes
- Signature-mechanic prose the schema doesn't capture (e.g., Shadowdark torch urgency)

What stays in JSON:
- `design_philosophy` (one-line tagline)
- All structured mechanical data

**Signature-mechanic creep — escape hatch is the sidecar.**

Signature mechanics the schema doesn't natively express (torch timers, random tables, system-unique quirks) get described in prose in the guidance sidecar. The GM does its best to honor them narratively. If a mechanic becomes popular enough, v2 can add a formal primitive.

**Deletions from the current `rules.json`:**

- `social_interaction` (covered by skills + DC ladder)
- Most of `exploration` (light_sources, searching, doors — narrative only)
- `exploration.traps` → moved to Module walkthrough (hazard/trap primitive)
- `resources.consumables` (inventory concern)
- `difficulty_settings` (covered in Q8)
- `optional_rules.*` beyond morale (which moved to Q3 auxiliary)

**Weapons / equipment tables** — deferred to the Character walkthrough. Current thinking: weapons carry their own mechanical data (damage die, type, melee/ranged); the rules pack optionally declares weapon *categories* if the system distinguishes them.

---

## Rules walkthrough — COMPLETE

All nine questions resolved. The Rules Pack schema is fully specified for v1. Next: the remaining JSON archetypes.

---

## Deferred to v2 (explicit non-goals for v1)

- Tier 2 systems (PbtA, Blades, FATE, Savage Worlds)
- 2d10-based resolution (full Draw Steel)
- Descending AC (AD&D THAC0-style)
- Death saves
- Individual-roll initiative with full turn-order UI
- Crit tables (lookup tables for custom crit effects)
- Stacking conditions (e.g., 5e exhaustion levels)
- Structured condition effects (algorithmic modifiers)
- Opposed checks (formal mechanic)
- Custom icons beyond the fixed library
- Per-class XP tables
- Tags / categories on rules packs for pack-picker filtering
- Formal signature-mechanic primitives (torch timers, etc.) — sidecar prose covers v1

### v2 ideas worth preserving

- **Customizable GM personality profiles.** The rules pack contributes system-wide guidance; the module can suggest a GM style; users can maintain personal GM profiles that override either layer. The prompt builder layers them in order: rules guidance → module style → user override. Gives users a "this is the GM I like" preference independent of what module they're playing.

---

## Downstream app impacts (for the eventual refactor)

Once the schema is finalized, these app-side changes will be required:

- **Character panel:** render abilities from `character_model.abilities` instead of hardcoded STR/DEX/CON/INT/WIS/CHA.
- **Prompt template:** `[ROLL_REQUEST: <ability>]` uses declared ability ids dynamically.
- **Combat resolver:** branch on `combat.attack.resolution` (auto-hit vs. d20+mod vs. AC); branch on `combat.damage.formula` (with vs. without ability mod).
- **HP handling:** implement `resources.hit_points.overflow` logic for Cairn-style ability damage.
- **Death overlay:** respect `resources.hit_points.at_zero` (dead vs. unconscious narration and UI behavior).
- **Critical hits:** implement all three `combat.critical_hit.effect` options.
- **XP awards:** honor `xp_sources`, including gold-as-XP.
- **Initiative:** support `player_first` (current) and new `side_based` (coin-flip at combat start).
- **Condition tracking:** icons from fixed library; prose effects surfaced in the panel and prompt.
- **Difficulty display:** render DC ladder or modifier ladder based on method.
- **`JSON_SCHEMAS.md`:** full rewrite to match the finalized schema.

---

## Scope of remaining JSON walkthroughs (after Rules)

1. ~~**Module** (`module_*.json`)~~ — **IN PROGRESS** (see Module section below)
2. **Setting** (`setting_*.json`) — is this even JSON, or should it be prose?
3. **Bestiary** (`monster_manual.json`) — XP/gold ownership; minimum viable monster shape; stat templates.
4. **Character** (`character_*.json`) — drop flavor bloat; lean into rules-pack-driven rendering; stored values vs. computed.
5. **Cross-cutting** — id-vs-string policy; validator updates; JSON_SCHEMAS.md rewrite.

---

# Module Pack Schema — Planning

> Module walkthrough: decisions MQ1–MQ4 captured below. MQ5+ in progress.

## Strategic frame for modules

- **v1 scope: dungeon-structured modules only** (rooms + connections). Hex crawls, point crawls, overland travel are v2.
- **Three content types per room:** features, encounters, hazards. Clean separation; schema-enforced.
- **Modules are rules-pack-portable** via `dc_tier` semantic references (never hardcoded DC numbers).

## MQ1 — Module identity & meta

```jsonc
{
  "module": {
    "id": "village_three_knots",
    "title": "The Haunting of Three Knots",
    "version": "1.0",
    "author": "...",
    "description": "A short dungeon crawl to investigate a haunted tomb...",
    "starting_room": "village_inn",
    "level_range": { "min": 1, "max": 3 },
    "estimated_rooms": 7,
    "estimated_playtime": "60–90 min",
    "tags": ["horror", "mystery", "short", "undead"]   // free-form v1; recommended vocabulary documented
  }
}
```

No structured genre taxonomy (prose description covers tone). Compatible rules/bestiary implied by the manifest.

## MQ2 — Room structure & connections

```jsonc
{
  "rooms": {
    "village_inn": {
      "id": "village_inn",
      "name": "The Split Oak Inn",
      "description": "...",                         // player-facing on first entry
      "tags": ["empty", "lore"],                    // optional pacing tags

      "connections": {
        "out": "village_square",                    // simple: label → room_id
        "secret_door": {                            // or structured: label → { to, state, reveal_hint }
          "to": "hidden_crypt",
          "state": "hidden",                        // "open" | "locked" | "hidden"
          "reveal_hint": "Perception DC tier: easy"
        }
      },

      "environment": { /* see below */ },

      // The content trinity — always present, possibly empty:
      "features": [],
      "encounters": [],
      "hazards": []
    }
  }
}
```

**Connections** are label → id (simple) or label → object (locked/hidden state).
**Tags** are optional pacing hints: `"encounter"`, `"puzzle"`, `"empty"`, `"treasure"`, `"boss"`, `"lore"`.
**First-visit vs. revisit narration** — handled by GM naturally, not structured.

## MQ2.5 — Environment (room-level atmosphere + mechanical modifier)

```jsonc
{
  "environment": {
    "name": "Waist-deep Water",                      // optional short label for UI
    "description": "Cold water sloshes around your waist, slowing every step.",
    "effects": [
      "Movement is halved",
      "Ranged weapons requiring two hands cannot be used",
      "Fire sources extinguish on contact"
    ]
  }
}
```

Optional, per-room. Module-level default environment deferred to v2.

## MQ3 — The content trinity framework

| Property | Feature | Encounter | Hazard |
|---|---|---|---|
| HP / AC? | No | Yes | No |
| Triggers `[COMBAT: on]`? | No | **Yes** | **No** (schema-enforced) |
| Causes damage? | Rare → forbidden | Yes (attack rolls) | Yes (declared in `avoidance.on_failure.damage`) |
| Uses skill checks? | Often | Sometimes | Often (detect, avoid) |
| GM treats as... | Detail or puzzle | Adversary | Environmental condition |

**Strict rule:** features never deal damage. If an interaction can damage the player, it's a hazard.

**Validator enforces:**
- Hazards cannot contain `monster_ref`
- Encounters must contain `monster_ref`
- Features cannot declare damage in outcomes

All three arrays always present (possibly empty).

## MQ4 — Hazards in detail (the bug-proof primitive)

```jsonc
{
  "hazards": [
    {
      "id": "pressure_plates",
      "name": "Pressure-plate Trap",
      "description": "Darts fire from the walls when the plates are triggered.",
      "gm_notes": "Let low-HP players retreat without penalty.",   // optional, per-hazard

      "trigger": {
        "type": "on_traverse",     // "on_enter" | "on_traverse" | "on_interact" | "on_examine"
        "target": null              // optional feature/connection id
      },

      "detection": {                // optional
        "check": { "skill": "perception", "ability": "wis", "dc_tier": "easy" },
        "on_success": "You spot the safe path — triggering plates are slightly discolored."
      },

      "avoidance": {                // optional
        "check": { "skill": "acrobatics", "ability": "dex", "dc_tier": "medium" },
        "on_success": "You pick your way across without triggering the trap.",
        "on_failure": {
          "narration": "Darts fire from the walls; one strikes deep.",
          "damage": { "amount": "1d6+1", "type": "piercing" },
          "conditions": []          // optional condition ids
        }
      },

      "reward_on_detection": { "xp": 10, "narration": "..." },   // optional, classic-OSR-friendly
      "reward_on_avoidance": { "xp": 5 },                        // optional

      "persists": false,            // true = fires again on revisit
      "resolved_by_detection": true,// detected => no avoidance roll needed

      "cooldown_rounds": 0          // RESERVED for v2; ignored in v1
    }
  ]
}
```

**Key decisions:**
- `dc_tier` (semantic) instead of `dc` (numeric). Modules become rules-pack-portable.
- Four hazard shapes (detect-then-avoid / pure-avoidance / automatic / interaction-gated) emerge from which blocks are present — no type enum needed.
- Hazards can grant XP rewards for detection or avoidance (opt-in, classic OSR flavor).
- `gm_notes` per hazard is optional prose guidance.

## MQ4.5 — Counter groundwork

**Implemented in v1:**
- Game state tracks `combat_round` integer (starts at 1 when combat begins, increments per round, resets when combat ends).
- Subtle UI indicator ("Round 3" chip in combat panel).
- GM prompt includes current round during combat.

**Reserved in schema, not yet enforced (v2 will wire up):**
- Hazard `cooldown_rounds` (0 = fires every traverse)
- Condition `duration_rounds` (null = indefinite)

**Explicit v2:**
- Exploration turn counter (classic OSR 10-minute turn)
- Round-based hazard cooldowns
- Auto-expiring conditions

## MQ5 — Encounters in detail

**Encounter = one combat event**, not one monster type. Mixed-creature encounters are first-class.

```jsonc
{
  "encounters": [
    {
      "id": "tomb_guardians",
      "name": "The Tomb Guardians",             // display label for the encounter

      "groups": [
        { "monster_ref": "skeleton_warrior", "quantity": 2 },
        { "monster_ref": "skeleton_captain", "quantity": 1 }
      ],

      "trigger": {
        "type": "on_enter",                      // "on_enter" | "on_condition" | "scripted"
        "condition": null                        // set when type is "on_condition"
      },

      "placement": "...",                        // optional prose
      "behavior": "...",                         // optional tactical hint
      "gm_notes": "...",                         // optional GM guidance

      "rewards": {
        "xp": "from_bestiary",                   // aggregate: Σ(quantity × bestiary.xp_value); or override with number
        "treasure": [                            // module-owned; bestiary entries are authoring suggestions only
          { "type": "gold", "amount": "2d6" },
          { "type": "item", "item_id": "silver_dagger", "quantity": 1 }
        ]
      },

      "on_defeat_effects": [                     // fires when ALL groups defeated
        { "type": "unlock_connection", "target": "secret_door" },
        { "type": "reveal_connection", "target": "hidden_passage" },
        { "type": "activate_feature", "target": "altar", "state": "blessed" }
      ]
    }
  ]
}
```

**Key decisions:**
- **Ownership:** XP inherits from bestiary by default (override per-encounter); treasure is module-owned.
- **Multi-type encounters** via `groups[]`. Each group = monster_ref + quantity. Solo = one group qty 1.
- **Each creature instance tracked independently** (HP bars per instance, not per group).
- **`on_defeat_effects`** three types for v1 (unlock_connection / reveal_connection / activate_feature). `spawn_encounter`, `trigger_event`, `end_module` deferred to v2.
- **Wandering-monster triggers** deferred to v2 (needs exploration-turn counter).
- **Module-scoped bestiary** supported via optional top-level `module_bestiary` block for one-off bosses and unique NPCs. Resolver checks module bestiary first, then shared bestiary.
- **Prose fields kept:** `placement`, `behavior`, `gm_notes` all optional.

## MQ6 — Features in detail

**Strict rule:** features never deal damage (if it can hurt, it's a hazard). Four sub-types.

**Universal fields (all types):** `id`, `name`, `description`, optional `on_examine` (deeper look), optional `gm_notes`.

```jsonc
// 1. LORE — pure information / atmosphere
{
  "id": "blood_stain", "type": "lore",
  "name": "Blood-stained Floor",
  "description": "Dried bloodstains spatter the floor.",
  "on_examine": "Closer inspection reveals ritual drainage patterns."
}

// 2. SEARCHABLE — hidden content revealed by a check
{
  "id": "old_tomes", "type": "searchable",
  "name": "Old Tomes",
  "description": "Shelves of dust-covered books.",
  "check": { "skill": "investigation", "ability": "int", "dc_tier": "medium" },
  "on_success": "You find a rolled map of the crypt.",
  "on_failure": "Nothing of use.",
  "reward": [{ "type": "item", "item_id": "crypt_map", "quantity": 1 }],
  "persists": true   // once searched, stays searched
}

// 3. INTERACTIVE — manipulable with state
{
  "id": "stone_lever", "type": "interactive",
  "name": "Stone Lever",
  "description": "A heavy stone lever.",
  "states": ["up", "down"],
  "initial_state": "up",
  "actions": {
    "up": {
      "label": "Pull down",
      "result": "Distant grinding echoes.",
      "effects": [{ "type": "unlock_connection", "target": "sealed_door" }]
    },
    "down": { "label": "Push up", "result": "It won't budge.", "effects": [] }
  }
}

// 4. PUZZLE — structured challenge
{
  "id": "time_riddle", "type": "puzzle",
  "name": "The Sage's Riddle",
  "description": "'I am always coming, but never arrive.'",
  "solution": {
    "description": "Time. Accept variations.",
    "check": null                          // null = pure narrative; or { skill, dc_tier } for fallback
  },
  "on_success": {
    "narration": "The voice whispers approval.",
    "effects": [{ "type": "unlock_connection", "target": "sage_chamber" }]
  },
  "on_failure": { "narration": "The voice goes quiet." }
}
```

### Puzzle resolution — three modes, same schema

- **Pure narrative:** `check: null`. Player says the right thing → puzzle resolves. (Riddles, passwords, clever answers.)
- **Narrative bypass + check fallback:** `check` is set, `solution.description` describes the answer. GM recognizes the clever solve; otherwise offers the roll.
- **Check-gated:** `check` is set, `solution.description` is cryptic or GM-only. No narrative shortcut.

### Multi-step puzzles

Two patterns supported:
- **Pattern A — single puzzle feature with multi-step solution** (player describes the sequence; GM recognizes it): use `solution.description` to spell it out.
- **Pattern B — feature chaining** (each step is its own interactive feature referencing the next via `activate_feature`): right when each step is a physical interaction the player should see.

**Caveat:** Pattern B's sequence enforcement is prose-only in v1 (GM reads the puzzle description and enforces order narratively). Formal prerequisite logic on features deferred to v2.

### Gateway puzzles — handled mechanically

Puzzles as gates use `on_success.effects` with `unlock_connection` or `reveal_connection`. The target connection flips state; the room-exit UI reads the state. No new mechanism required.

### Key decisions

- **Four sub-types** (lore/searchable/interactive/puzzle) — explicit, validator-friendly.
- **`on_examine` universal** — layered description available on all types.
- **Strict typing** — mixed-type features are split into multiple features (painting-as-lore + hidden-compartment-as-searchable discovered via `on_examine`).
- **Feature chaining** via `activate_feature` effect is supported and encouraged.
- **Features cannot:** deal damage, host creatures, grant XP directly. Rewards are items only.

## MQ7 — Rewards, treasure, and loot (introduces the Items archetype)

**Reward shape** (used by encounters, features, and hazards):

```jsonc
{ "type": "gold", "amount": "2d6" }                                  // or fixed number
{ "type": "item", "item_id": "silver_dagger", "quantity": 1 }        // or variable
```

**Gold-as-XP integration:** when rewards apply, if the active rules pack's `progression.xp_sources` includes `"treasure_recovered"`, the gold amount is also awarded as XP. Runtime behavior; no schema change.

**Scattered room loot:** attach to a searchable feature with `check: null` (auto-success). No separate room-level loot mechanism.

### New archetype: Items

Same shape pattern as bestiary. Shared `items.json` referenced from Game Pack manifest; modules can add `module_items` for one-offs.

**Type list (5):** `weapon` | `armor` | `consumable` | `lore` | `misc`

**Slots** (for wearable/wieldable items):
- Weapon slots: `main_hand`, `off_hand`, `two_handed`, `ranged`
- Armor slots: `body`, `shield`, `head`, `hands`, `feet`, `neck`, `ring`, `cloak`, `belt`

Weapons include staves/wands (weapon type, appropriate slot). Armor includes all wearables (body armor, shields, rings, circlets, boots, etc. — all armor type with different slots).

```jsonc
// Base item shape
{
  "id": "silver_dagger",
  "name": "Silver Dagger",
  "type": "weapon",
  "slot": "main_hand",
  "description": "...",
  "weight_slots": 1,

  // Type-specific block — only present when relevant
  "weapon": {
    "damage": "1d4",
    "damage_type": "piercing",
    "melee": true,
    "ranged": false
  },

  // Optional: magic block — any item can be magical
  "magic": {
    "attack_bonus": 0,
    "damage_bonus": 0,
    "ac_bonus": 0,
    "ability_bonus": { "str": 0, "dex": 0 },    // per rules-pack ability id
    "bonus_damage": { "amount": "1d4", "type": "fire" },   // extra dice on weapon hit
    "damage_resistance": [],                    // damage type ids taken at half
    "damage_immunity": [],                      // damage type ids ignored
    "charges": {                                // for wands/staves
      "max": 3,
      "recharge": "long_rest"                   // "long_rest" | "short_rest" | "daily" | "none"
    },
    "charge_effect": "Cast fireball as a 3rd-level spell.",  // prose; GM adjudicates
    "special_effects": "On a natural 20, target catches fire (1d4 fire damage per round)."  // prose escape hatch
  }
}
```

### The key design line for magic items

**Structured fields for common mechanical effects; prose for everything else.**

**Enforced by app:** attack_bonus, damage_bonus, ac_bonus, ability_bonus, bonus_damage, damage_resistance, damage_immunity, charge count.

**Handled by GM (narrative):** charge_effect prose, special_effects prose.

This contains the "magic item can of worms" — we handle the 80% case structurally and let the GM adjudicate the weird bits.

### Type-specific blocks

```jsonc
"armor": { "ac_bonus": 2, "type": "heavy" }           // optional — only when it provides AC
"consumable": { "on_use": "heal_player", "amount": "2d4+2" }
// lore and misc have no type-specific block
```

The `armor` block is optional — a ring that only provides a stat bonus has no `armor` block, just the `magic.ability_bonus`. That way `type: "armor"` can cleanly cover all wearables without forcing an AC value everywhere.

### Deferred to v2

- Random loot tables (weighted outcomes, nested rolls)
- Multi-currency (cp/sp/gp/pp) — v1 is just `gold`
- Scroll as its own type (v1: consumable with magic block)
- Full magic-item effect scripting (v1 has structured common fields + prose)

## MQ8 — Module state & flow

**What the app tracks per play-through** (stored in save file, deltas-only from initial state):

```jsonc
{
  "schema_version": 1,
  "game_pack_id": "...",
  "module_id": "...",
  "current_room": "tomb_hall",
  "visited_rooms": [ ... ],

  "encounters": {
    "crypt_skeletons": {
      "resolved": true,
      "instances": [
        { "monster_ref": "skeleton_warrior", "instance_id": "sw_1", "current_hp": 0, "defeated": true }
      ]
    }
  },

  "hazards": {
    "pressure_plates": { "state": "triggered", "times_fired": 1 }  // undetected|detected|triggered|avoided
  },

  "features": {
    "old_tomes": { "searched": true, "succeeded": true },
    "stone_lever": { "current_state": "down" },
    "rune_sequence": { "solved": true }
  },

  "connections_modified": { "sealed_door": { "state": "open" } },

  "combat": { "in_combat": false, "round": 0 },

  "completion": { "completed": false, "conditions_met": {} }
}
```

### State feeds the GM prompt

On room entry, prompt builder injects current state alongside room description so the GM always sees the current dungeon state. Encounters show per-instance HP; features show current states; hazards show resolution status.

### Module completion

```jsonc
{
  "completion_condition": {
    "type": "defeat_encounter",         // "defeat_encounter" | "reach_room" | "all_encounters_defeated" | null
    "target": "dead_king"
  }
}
```

When the condition is met, app fires end-of-module event (summary screen, final rewards, disable further interaction). `null` = GM judges narratively. Complex multi-ending logic deferred to v2.

### Feature prerequisites (v1 — reversing the MQ6 v2-caveat)

Lightweight prereqs on features to support formal state-machine puzzles:

```jsonc
{
  "prerequisites": {
    "feature_state": { "crown_button": "pressed" },
    "encounter_defeated": ["guardian"]
  },
  "prereq_hint": "The sceptre rune glows faintly, but something about the crown still needs attention."
}
```

AND logic only. If not met, feature is **hidden** from the UI; optional `prereq_hint` gives the GM a breadcrumb.

**Unlocks:** multi-step puzzles via feature chaining, staged reveals, gated progression.

**Deferred to v2:** OR logic / negated conditions / complex expressions, prereqs on encounters/hazards/connections, scripted state-transition events.

### Save-file versioning

`schema_version` integer on every save from day one. Cheap now, valuable when the schema evolves.

## MQ9 — Prose-vs-data audit for modules

### Module guidance sidecar (optional)

```jsonc
// Manifest
{
  "adventure_module": "village_three_knots.json",
  "module_guidance": "village_three_knots_guidance.md"   // optional
}
```

Prompt builder injects alongside rules-pack guidance. Used for author's running-notes, tone essays, rules-pack-specific adjustments, design intent, spoiler/reveal guidance.

### What stays in JSON

| Location | Field | Role |
|---|---|---|
| Module | `description`, `tags` | Pack-picker blurb + discovery filters |
| Room | `description` | Player-facing on-entry narration |
| Room | `environment.description` / `effects` | Atmosphere + mechanical notes |
| Feature | `description`, `on_examine` | Player-facing |
| Feature | `gm_notes` | Optional situational hint |
| Encounter | `placement`, `behavior`, `gm_notes` | Optional tactical hints |
| Hazard | `description`, `narration` fields | Player + outcome narration |
| Hazard | `gm_notes` | Optional situational hint |

### Confirmed deletions

- `atmosphere` on rooms (merged into `environment`)
- Legacy `interaction` string on features (replaced by type-specific blocks) — *this was the field that caused the hall-of-blades bug*
- `note` fields on features (replaced by `gm_notes`)
- `on_death.xp_award` / `on_death.gold_drop` / `on_death.narrative` (consolidated into `rewards` + `on_defeat_effects`)

### Additional likely-vestigial fields (flagged for the cleanup pass)

- `summary` fields that duplicate `description`
- `version` / `author` at room/encounter/feature level (module-level concern)
- `type: "combat"` on encounters (tautological — encounters ARE combat)
- Old `hidden` booleans on features (replaced by `prerequisites`)

### Validator responsibilities (not fields, but broken refs)

- `monster_ref` → must exist in bestiary or `module_bestiary`
- `connection` targets → must be valid room ids
- `item_id` → must exist in items library or `module_items`
- Inline monster blocks that should live in `module_bestiary`

---

# Module walkthrough — COMPLETE

All nine module questions resolved. Schema fully specified for v1.

## Cross-cutting TODOs (post-walkthrough, pre-refactor)

- **Systematic field-cleanup pass** over existing module files (and all JSONs): identify and remove any vestigial fields not captured in the new schema. Run after all archetype walkthroughs complete.
- **JSON_SCHEMAS.md rewrite** to match finalized schemas across all archetypes.
- **Validator updates** (json-validator.html) to enforce new schemas, broken refs, and archetype-specific rules.
- **Refactor the consuming app** (`playable-dungeon-crawler-v2.html`) against the new schemas.

## Remaining archetype walkthroughs

1. ~~**Setting**~~ — **COMPLETE**
2. ~~**Bestiary**~~ — **COMPLETE**
3. ~~**Items**~~ — **COMPLETE**
4. ~~**Character**~~ — **COMPLETE**

**All archetype walkthroughs complete. Design phase finished.**

---

# Setting Pack — Planning

> Setting walkthrough: COMPLETE.

## Strategic frame

Setting is **prose-first**. The audit confirmed no field in current setting JSONs is mechanically parsed; everything gets shoveled into the prompt as flavor. So setting = minimal JSON shell for manifest/pack-picker concerns + markdown sidecar carrying all the lore.

## Schema

```jsonc
// setting.json
{
  "setting": {
    "id": "shattered_realms_v1",
    "name": "The Shattered Realms",
    "version": "1.0",
    "author": "...",
    "description": "A post-cataclysm high-fantasy world where magic is bleeding back into a broken land.",
    "tags": ["high-fantasy", "post-apocalyptic", "magic-rich"],   // free-form v1
    "content": "shattered_realms_lore.md"                         // pointer to sidecar
  }
}
```

## Markdown sidecar — suggested section ordering (not enforced)

```markdown
# World Overview
# Cosmology
# Major Regions
## Region Name
# Peoples and Cultures
# History
# Magic
# Adventure Context
# GM Guidance
```

Prompt builder injects the full markdown into the system prompt via `{{SETTING_BLOCK}}`. Headings help GM mental organization; no structural parsing.

## Deletions from current `setting_shattered_realms.json`

All pretend-structured nested objects move to the markdown sidecar:
- `world_overview` (as JSON object)
- `cosmology` and `cosmology.gods`
- `major_regions` (keyed object)
- `races` (keyed object)
- `history` (JSON string)
- `magic` (JSON object)
- `adventure_context` (JSON object)
- `gm_guidance` (JSON string)

Everything becomes prose under the corresponding markdown heading.

## Trade-off accepted

Future features wanting structured lookups (region-aware travel, race-as-character-option, lore queries) become harder without structured region/race fields. Accepted for v1 — Tier 1 OSR play is prose-driven. If a v2 feature demands structure, we extract specific fields into JSON or introduce new archetypes (e.g., `races.json`) at that point.

## No additional metadata

No `suggested_rules_packs`, no structured `tone` separate from tags, no other fields. The minimal shell + markdown covers it.

---

# Bestiary Pack — Planning

> Bestiary walkthrough: COMPLETE.

## Strategic frame

Minimum-viable monster shape; everything mechanically tuneable is pre-computed (no derivation from ability scores or proficiency). MQ5 already resolved XP (bestiary owns default; module can override) and treasure (module-owned; bestiary doesn't carry it).

## Schema

```jsonc
{
  "bestiary": {                          // renamed from "monster_manual"
    "id": "shattered_realms_bestiary_v1",
    "name": "Shattered Realms Bestiary",
    "version": "1.0",
    "author": "...",
    "description": "...",

    "monsters": {
      "goblin": {
        "id": "goblin",
        "name": "Goblin",
        "description": "Small green-skinned raiders from the wastes.",   // short flavor stays in JSON
        "type": "humanoid",                // optional free-string (v2 may add mechanics-bearing types like "undead")

        "hp": 7,
        "ac": 13,
        "morale": 7,                       // optional; meaningful only when rules pack auxiliary.morale_roll: true

        "attacks": [
          {
            "name": "Scimitar",
            "bonus": 2,                    // pre-computed total to-hit; not derived
            "damage": "1d6+2",             // pre-computed
            "damage_type": "slashing",     // optional; ignored if rules pack has no damage_types
            "range": "melee"               // "melee" | "ranged"
          }
        ],

        "special_abilities": [             // optional; same "structured common + prose escape hatch" as magic items
          {
            "id": "darkvision",
            "name": "Darkvision",
            "description": "Sees in darkness up to 60 feet.",
            "type": "passive"              // "passive" | "active" | "triggered"
          }
        ],

        "damage_resistance": [],           // damage type ids; optional, meaningful with rules pack damage_types
        "damage_immunity": [],
        "damage_vulnerability": [],

        "xp_value": 25,                    // authoritative default; module-encounter can override

        "behavior": "...",                 // optional prose tactical hint
        "tactics": "..."                   // optional prose tactical hint
      }
    }
  }
}
```

## Required fields (minimum viable monster)

`id`, `name`, `hp`, `ac`, `attacks`, `xp_value`. Everything else optional.

## Deletions from current `monster_manual.json`

- `size` — flavor only in Tier 1
- `speed` — flavor only in Tier 1
- `hit_dice` — redundant with pre-rolled `hp`
- `treasure` — module-owned per MQ5; bestiary no longer carries treasure data

## No inheritance / templates in v1

Variants are handled via duplication or `module_bestiary` (a one-off Greater Goblin lives in the module, not the shared bestiary). Inheritance / templating deferred to v2.

---

# Items Pack — Planning

> Items walkthrough: COMPLETE. Core schema was introduced in MQ7; this pass added the archetype metadata and filled gaps.

## Archetype metadata (same pattern as bestiary/setting)

```jsonc
{
  "items_library": {
    "id": "shattered_realms_items_v1",
    "name": "Shattered Realms Items",
    "version": "1.0",
    "author": "...",
    "description": "Weapons, armor, and magical items.",

    "items": {
      "silver_dagger": { /* full item schema — see MQ7 in this doc */ }
    }
  }
}
```

## Gap-filler decisions

- **`weight_slots`** — unified field, method-dependent interpretation. Slot-based packs read it as slot count; weight-based packs read it as weight in pack's default unit; `"none"` packs ignore it entirely. Keeps items portable across packs.
- **Optional `tags`** array on each item — free-form v1 (`["magical", "cursed", "quest-item", "common"]`). For future authoring tools and treasure generation.
- **Cursed / attunement / item sets** handled as prose in `magic.special_effects` for v1. Structured mechanics deferred to v2.
- **Resistances/immunities enforced structurally** — when damage of a typed flavor is applied (from hazards or monster attacks), the app checks equipped items for matching resistance/immunity.

---

# Character Pack — Planning

> Character walkthrough: COMPLETE.

## Strategic frame — stored vs. computed

**Character JSON stores raw values only; everything displayed is derived at runtime** from raw values + active rules pack + equipped items. When the rules pack changes its formulas, the character renders differently without migration or silent staleness.

**Stored in character JSON:**
- Ability scores (raw numbers)
- Class (string id), level, XP
- Current HP only (max derived)
- Equipment (slot assignments), pack contents
- Active condition ids
- Gold
- Charged-item state
- Proficient saves and skills (id lists only)
- Class features (prose descriptions)

**Derived at render time:**
- Ability modifiers (from `rules.modifier_formula`)
- HP max (from class + level + CON via rules pack)
- AC (from equipped armor + dex + magic bonuses)
- Attack / damage bonuses (ability + proficiency + magic)
- Save totals, skill modifiers
- Encumbrance load (sum of `weight_slots`)

## Schema

```jsonc
{
  "character": {
    "id": "aldric_v1",
    "game_pack_id": "shattered_realms_rules_test",
    "schema_version": 1,

    "basic_info": {
      "name": "Aldric the Bold",
      "class": "fighter",                             // rules pack class id; empty string for classless
      "level": 3
    },

    "ability_scores": {                               // raw values only
      "str": 14, "dex": 12, "con": 13,
      "int": 10, "wis": 11, "cha": 9
    },

    "saves": {
      "proficient": ["str", "con"]                    // save ids; shape adapts if rules pack uses categorical saves
    },

    "skills": {
      "proficient": ["athletics", "intimidation"]     // skill ids from rules pack; empty if pack has no skills
    },

    "hp_current": 18,                                 // current only; max is derived

    "equipment": [                                    // flat array; slot strings validated against rules pack slot_limits
      { "item_id": "steel_longsword", "slot": "main_hand" },
      { "item_id": "chain_mail",      "slot": "body" },
      { "item_id": "iron_shield",     "slot": "shield" },
      { "item_id": "ring_of_protection", "slot": "ring" }
    ],

    "pack": [
      { "item_id": "healing_potion", "quantity": 2 },
      { "item_id": "torch",          "quantity": 5 },
      { "item_id": "rope_50ft",      "quantity": 1 }
    ],

    "charged_items": {                                // tracked separately from equipment/pack
      "wand_of_fireball": { "current_charges": 2 }
    },

    "conditions": ["wounded"],                        // active condition ids from rules pack

    "gold": 47,
    "xp": 900,

    "class_features": [                               // prose in v1; GM adjudicates
      {
        "id": "second_wind",
        "name": "Second Wind",
        "description": "Once per rest, regain 1d10+level HP as a bonus action."
      }
    ],

    "guidance": "aldric_guidance.md"                  // optional sidecar for personality/backstory/appearance
  }
}
```

## Classes and class features in v1

- Rules pack declares `uses_classes: true/false` and (optionally) minimal class metadata (name, HD size, short description).
- Character stores `class` id and `class_features` array of prose descriptions.
- GM adjudicates class features narratively; no structured feature tree.
- Level-ups add features to the array (GM or designer authored).
- Full structured class systems (spells, subclass trees, per-level feature lists) deferred to v2 — worthy of its own walkthrough once we have play data.

## Flavor moves to an optional markdown sidecar

`appearance`, `personality`, `backstory`, `notes` — all prose. All leave the JSON and live in `<character_id>_guidance.md` (optional). Same injection pattern as setting, module, and rules guidance sidecars.

## Deletions from the current character schema

- **All derived values**: `combat_stats.proficiency_bonus`, `combat_stats.armor_class`, `combat_stats.hit_points.max`, `ability_scores[id].modifier`, `experience.next_level`, `experience.progress_percent`
- **Stale-prone prose**: `ability_scores[id].note` (e.g., `"STR +3 + Prof +2"`) — computed at runtime, no static caption
- **Flavor fields**: `appearance`, `personality`, `backstory`, `notes` — move to sidecar
- **Free-form proficiency strings** → replaced by structured `saves.proficient[]` and `skills.proficient[]`
- **Free-form equipment buckets** (`worn`, `wielded`, `carried`, `backpack`) → replaced by structured `equipment[]` with slot assignments + `pack[]`
- **`basic_info.background`** and other flavor → sidecar

## Equipment slot handling

- Character declares what's in each slot via the flat array's `slot` string
- Rules pack's `character_model.slot_limits` (if declared) validates count per slot type (e.g., `ring: 2`)
- Multiple items can share a slot name (two rings both use `"slot": "ring"`); the app enforces the count

---

# Design phase — COMPLETE

All six archetypes fully specified for v1:

| Archetype | Status | Core file |
|---|---|---|
| Rules Pack | ✅ Complete | `rules.json` + `guidance.md` |
| Setting Pack | ✅ Complete | `setting.json` + `lore.md` |
| Bestiary Pack | ✅ Complete | `bestiary.json` |
| Items Pack | ✅ Complete | `items.json` |
| Adventure Module | ✅ Complete | `module.json` + `module_guidance.md` |
| Character | ✅ Complete | `character.json` + `character_guidance.md` |

## Cross-cutting work remaining (before/during refactor)

1. **Systematic field-cleanup pass** over all existing JSON files — remove vestigial fields not captured in the new schemas.
2. **`JSON_SCHEMAS.md` rewrite** to match finalized schemas across all archetypes; serves as reference doc and onboarding for designers/community pack authors.
3. **Validator updates** (`json-validator.html`) — enforce new schemas, broken refs, archetype-specific rules (hazards cannot have `monster_ref`, etc.).
4. **App-side refactor** (`playable-dungeon-crawler-v2.html` and `server.js`) — consume the new schemas; the full list of downstream impacts was captured earlier in this doc.
5. **Pack migration** — the two existing packs (`game_pack.json` test hub and `game_pack_village_three_knots.json`) need to be rewritten against the new schemas.
6. **Starter pack templates** — at least two: an OSR-classless example (B/X-like) and a 5e-like example. These become the on-ramp for new pack authors.
