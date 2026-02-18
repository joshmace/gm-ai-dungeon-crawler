# Rules System Testing

This document describes how to test the rule system using the **Rules Test Module** (`test_module_rules.json`) and how the **ruleset** (`rules.json`) is structured for Phase 1 (basic verification) and Phase 2 (extensions).

## Design philosophy

The app is built on a single principle: **the GM honors the explicit specifications of the ruleset, and is creative in narrative and in areas not covered by the rules.** That philosophy is now in `rules.json` as `design_philosophy` and is injected into the GM prompt so every session respects it.

- **Explicit in rules** → GM must follow (DCs, formulas, 0 HP, optional rules, rewards).
- **Not specified** → GM may invent (flavor, pacing, unmentioned situations).

The test module and rules structure are designed to make “spec vs narrative” obvious and testable.

---

## Test module: `test_module_rules.json`

Use this module to exercise **all aspects** of the loaded ruleset. Swap it in via `CONFIG.DATA_FILES.module` (e.g. `'./test_module_rules.json'`) and load your `rules.json` as usual.

### Room-to-rule mapping

| Room | Rule(s) under test | What to verify |
|------|--------------------|----------------|
| **Rules Hub** | `design_philosophy` | Charter text matches “honor specs, creative elsewhere”. |
| **Ability Check Gallery** | `core_mechanics.ability_checks` | GM uses **exact** DCs 5, 10, 15, 20, 25, 30 from `dc_scale`; requests rolls only when appropriate; respects auto_success/auto_failure. |
| **Combat Chamber** | `combat.attack_roll`, `combat.damage`, `combat.hit_points.at_zero`, crit/miss | Attack/damage formulas, target AC from manual, nat 20 = crit, nat 1 = miss, **0 HP = death** (or death saves if enabled). Exact XP/gold from encounter `on_death`. |
| **Exploration Corridor** | `exploration.light_sources`, `exploration.searching`, `exploration.doors` | Light radii/duration; quick search (action + Perception) vs thorough (10 min, auto-find); stuck door uses DC from rules (e.g. 15). |
| **Rest Sanctum** | `resources.resting` | Short rest: 1 hour, hit dice, some abilities. Long rest: 8 hours, full HP, half hit dice, all abilities, **once per 24 hours**. |
| **Conditions Room** | `combat.conditions` | GM uses [CONDITION: add poisoned] / [CONDITION: remove poisoned]. Poisoned = −2 to attack and checks (exactly as in rules). Character panel shows conditions and their effects. |
| **Morale Chamber** | `optional_rules.morale` | When enabled, second goblin may flee when first dies or at 50% strength. Per-kill XP/gold only for defeated foes. |

### Features and explicit DCs

Module features can set a numeric **`dc`** (e.g. `"dc": 15`). The app now passes that into the layout block as “DC: N (use this exact value from ruleset scale)”. That lets you:

- Test that the GM uses the **exact** DC from the module (and thus from the ruleset scale).
- Avoid ambiguity when a feature is “medium” or “hard” by pinning the number.

### Suggested test sequence

1. Start in **Rules Hub**; read the Rules Charter.
2. **Ability Check Gallery**: Run all six stations; confirm the GM calls for rolls at DC 5, 10, 15, 20, 25, 30 (no ad-hoc DCs).
3. **Combat Chamber**: Fight the goblin; confirm AC 13, +4 to hit, 1d6+2 damage, crit on 20, miss on 1, 0 HP = death; confirm **25 XP** and **10 gold**.
4. **Exploration Corridor**: Use light, quick search, thorough search, stuck door (STR DC 15).
5. **Rest Sanctum**: Short rest then long rest; confirm benefits match `resources.resting`.
6. **Conditions Room**: Trigger poison vent; confirm poisoned effect matches `combat.conditions`.
7. **Morale Chamber**: Fight two goblins; if morale is enabled, confirm the second can flee and only defeated foes award XP/gold.

---

## Phase 1: Basic rule system

**Goal:** Test and verify the **core** behavior: DC scale, ability checks, combat, 0 HP, optional rules, rewards, and (if present) exploration/rest/conditions.

### Rules.json – Phase 1 “core” (what the app and test module rely on)

These are the parts that **must** be present and consistent for Phase 1:

| Section | Purpose |
|--------|---------|
| `system` | Name of the ruleset (e.g. OSR). |
| `design_philosophy` | One sentence: honor explicit specs; creative elsewhere. |
| `core_mechanics.ability_checks` | `roll`, `dc_scale` (trivial→nearly_impossible), `when_to_roll`, `auto_success`, `auto_failure`. |
| `combat.attack_roll` | melee, ranged (and spell if used). |
| `combat.damage` | roll, critical_hit, critical_miss. |
| `combat.hit_points.at_zero` | e.g. “Character dies” or “Death saves” when enabled. |
| `optional_rules` | Each rule has `enabled` (boolean) and `description`. Only enabled ones are injected. |
| `experience.level_progression` | Optional but recommended: level number → XP threshold (e.g. `"1": 0, "2": 2000`). |

The app already uses: system name, `dc_scale`, when_to_roll, attack/damage wording, at_zero, optional_rules (enabled list), and (when present) `level_progression`. The test module is built so that running through the rooms above validates these.

### Suggested Phase 1 rules structure

- Keep **one** `rules.json` with the full structure.
- Ensure **Phase 1 core** is complete and clear (no contradictory or vague wording).
- Add or keep `design_philosophy` at the top level so the GM prompt always states the principle.

Optional cleanup for clarity (not required for behavior):

- Use short, copy-paste-friendly strings for `at_zero`, `roll`, and formulas so the prompt text is unambiguous.
- In `optional_rules`, keep only the rules you actually test or use (e.g. morale, death_saves, flanking); you can add more in Phase 2.

---

## Phase 2: Expand the rule system

**Goal:** Add and test **new or optional** rules: more optional_rules, difficulty_settings, social_interaction, saving_throws (including death_saves), exploration detail, etc.

### What to add in Phase 2

- **Optional rules:** e.g. flanking, critical_fumbles, death_saves. Toggle with `enabled`; test in new rooms or variants of the test module.
- **Difficulty settings:** If you add a “mode” (deadly / standard / forgiving), the GM could read `difficulty_settings` and adjust narration and consequences (e.g. death_at_zero, harsh_dcs).
- **Social interaction:** Reaction rolls, persuasion/intimidation/deception. Add a “Social Test” room that triggers NPC attitude and skill checks per rules.
- **Saving throws:** Explicit DCs and when to use saves; death_saves flow when `optional_rules.death_saves.enabled` is true.
- **Exploration/resource detail:** Encumbrance, rations, ammunition, spell components—add rooms or features that trigger these so the GM applies the rules as written.

### Test module extensions for Phase 2

- New rooms in `test_module_rules.json`: e.g. **Social Room** (reaction roll + persuasion), **Death Saves Room** (only if death_saves enabled), **Difficulty Room** (if difficulty_settings are used).
- Reuse the same room-to-rule table pattern: one room per rule cluster, with `gm_notes` like “RULE UNDER TEST: …” and expected outcomes in `testing_notes`.

---

## Summary

- **Test module:** `test_module_rules.json` – hub plus rooms that exercise DC scale, ability checks, combat, 0 HP, exploration, rest, conditions, and optional morale.
- **Phase 1:** Verify basic rule system with the current app and the “Phase 1 core” sections of `rules.json`; use the design philosophy and explicit DCs/numbers.
- **Phase 2:** Extend `rules.json` and the test module with optional rules, difficulty, social, saves, and resources; add rooms and test objectives for each addition.
- **Design philosophy:** Stored in `rules.json` and injected into the GM prompt so the GM honors explicit specs and stays creative elsewhere.
