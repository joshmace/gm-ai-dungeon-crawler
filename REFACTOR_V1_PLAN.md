# Refactor to v1 — Implementation Plan

Frontend migration to the v1 schema + extraction of the rules engine + staged HTML split, driven through the Gauntlet for regression.

The app currently consumes the pre-v1 shape and will not correctly load any of the three active packs (Three Knots, Crow's Hollow, Gauntlet). This plan stages that migration.

---

## Preamble: answers to the 10 key questions

### 1. Rules-engine scope — what moves to JS, what stays in the prompt

**Moves to `scripts/rules-engine.js` (authoritative in JS):**

- All dice math (`rollDie`, `parseFormula`, `rollFormula`, `rollD20`).
- Attack resolution: d20 + attack bonus vs. target AC, crit-on-nat-20 (and nat-19 for Champion-style overrides), fumble-on-nat-1, damage roll with crit-die doubling, bonus damage (weapon magic `bonus_damage`), damage-type tagging.
- Monster attack resolution against the player's derived AC.
- Ability/skill check resolution: DC lookup via `rules.difficulty.scale[].dc_tier`, raw save vs. skilled check shape (`skill: null` = raw save; skill proficiency applies only when skill id is set; save proficiency applies only on raw ability saves).
- Advantage/disadvantage roll variant — gated on `rules.resolution.checks.advantage_disadvantage`.
- Damage application (with resistance/immunity/vulnerability lookup against monster arrays and character magic arrays).
- Healing application with `maxHP` clamp.
- HP-max, AC, save totals, skill mods, proficiency bonus, encumbrance load — derived stat assembly from raw character + equipped items + rules pack (a `deriveSheet(character, rules, items)` function).
- Effect dispatch (`unlock_connection`, `reveal_connection`, `activate_feature`) — pure functions that mutate a passed-in save-state slice.
- Hazard adjudication (detect-then-avoid, pure-avoidance, automatic, interaction-gated) — given check results and hazard body, returns outcomes.
- Feature prerequisite evaluation (AND of `feature_state` + `encounter_defeated`).
- Encounter completion detection (all groups' instances defeated) and completion-condition evaluation (`defeat_encounter` / `reach_room` / `all_encounters_defeated`).
- Consumable dispatch (`heal_player`, `cure_condition`, `gm_adjudicate`).
- Reward resolution (gold dice expansion, `from_bestiary` XP rollup, gold-as-XP when `progression.xp_sources` includes `"treasure_recovered"`).

**Stays in `ai-gm-system-prompt.md` (authoritative in the prompt):**

- Narrative tone, pacing (50–100 / 150 max), "what not to narrate" discipline, HTML-only formatting.
- Combat-state tag contract (`[COMBAT: on|off]`), initiative discipline ("player acts first"), melee-vs-ranged judgment, monster-turn flavor (`[MONSTER_ATTACK]`).
- Roll-request tag contract (`[ROLL_REQUEST: <ability|skill|Attack|"Nd M+K">]`, `, advantage]` / `, disadvantage]` when the rules pack declares them).
- Condition and resource tag contract (`[CONDITION: add|remove id]`, `[RESOURCE_USE: pool_id]`), mode tag (`[MODE: travel|exploration]`).
- Auto-success / auto-fail prose (these are rules-pack prose, GM-judged).
- All room/feature/encounter/hazard description text — the prompt surfaces it; the engine does not paraphrase.
- `on_hit` riders, `special_abilities.description`, `magic.charge_effect`, `magic.special_effects`, `consumable.on_use: gm_adjudicate` prose — all of these are explicitly "GM adjudicates" in the schema.
- Trigger-type discipline: `on_condition` encounters and `on_examine` hazards are GM-judged, not app-fired.
- `completion_condition` narrative wrap (the app detects; the GM writes the ending beat).

**Net effect on the prompt file:** the "COMBAT ADJUDICATION" section shrinks because the app now runs the whole attack flow and emits callouts the GM never sees. The "WHO ROLLS" section stays but the roll types come from the rules pack (advantage/disadvantage is present iff the pack declares it). The `{{RULESET_BLOCK}}` builder changes shape (v1 fields, not pre-v1 paths).

**Trade-off:** we could also move the `on_hit` save-or-suffer rider into the engine (parse DC, fire a save, apply condition). We don't, because (a) v1 explicitly keeps these as prose and (b) doing it reliably requires NLP on `"Target saves vs. DC 12 CON or is poisoned for 1 minute."` — the schema will add a structured rider shape in v2 and that's the right time.

### 2. Data loading — manifest → six archetype files → merged state

- Load order: manifest → setting, rules, bestiary, items, module, character in parallel (plus their sidecar `.md` files where declared).
- Merge into `gameData` as: `{ manifest, rules, setting, settingLore, bestiary, items, module, moduleGuidance, character, characterGuidance, rulesGuidance }`.
- Validation on load (blocking): `character.game_pack_id === manifest.id`; all referenced IDs resolve; `module.starting_room` resolves. Soft warnings (non-blocking): empty `attacks[]`, hazards with neither detection nor avoidance.
- **Loading-error UX:** a single modal loading overlay with per-step status lines ("Loading rules… Loading module… Validating references…"); any hard failure replaces the overlay with a scrollable error card showing the failing file path, the specific error (e.g. "module_crows_hollow.json: connection `iron_strapped_door` in room `gate_room` targets unknown room `lantern_roomm`"), a "Copy details" button, and a Retry button. No game screen underneath, to avoid partial states.

### 3. Runtime state shape — in-memory and localStorage

**In-memory `gameState`** (not persisted in full; the derived bits are recomputed):

```
gameState = {
  schema_version,                // save compatibility guard
  game_pack_id, module_id,       // cross-check on load
  character: {                   // RAW stored values only — derived at render time
    ...character (as authored),
    hp_current,                  // current HP (max derived)
    xp, gold,                    // mutated in play
    equipment, pack,
    charged_items, feature_resources,
    conditions,
  },
  module: {
    current_room,
    visited_rooms,               // for first-visit vs. revisit
    encounters: {                // keyed by encounter id
      [id]: {
        resolved,
        instances: [{ monster_ref, instance_id, current_hp, defeated }]
      }
    },
    hazards: {                   // keyed by hazard id
      [id]: { state, times_fired }  // "undetected"|"detected"|"triggered"|"avoided"
    },
    features: {                  // keyed by feature id (only if state differs from authored)
      [id]: { searched?, succeeded?, current_state?, solved?, unlocked? }
    },
    connections_modified: {      // only deltas from authored
      [connection_key]: { state }
    },
  },
  combat: { in_combat, round },
  completion: { completed, conditions_met },
  ui: {                          // transient — not persisted
    pendingRollContext, lastD20Natural, readiedWeaponName,
    mode,                        // 'exploration' | 'travel'
    equippedInUse,               // lit torch, etc.
    conversationHistory,
  }
}
```

**localStorage save shape:** exactly the "Save state" spec in `JSON_SCHEMAS.md` (`schema_version: 1`, `game_pack_id`, `module_id`, `current_room`, `visited_rooms`, `encounters{}`, `hazards{}`, `features{}`, `connections_modified{}`, `combat`, `completion`) plus a parallel `character_mutations` object holding only the fields that change in play (`hp_current`, `xp`, `gold`, `equipment`, `pack`, `charged_items`, `feature_resources`, `conditions`, `basic_info.level`). Keyed by `game_pack_id` so switching packs picks up the right slot.

**Derived-stat pipeline** — `RulesEngine.deriveSheet(character, rules, itemsById)` returns:

```
{
  abilityMods,                   // from rules.character_model.modifier_formula
  proficiencyBonus,              // from rules.progression.level_table[level].proficiency_bonus (optional)
  hpMax,                         // class HD + CON, formula per rules.progression.hp_gain_per_level
  ac,                            // 10 + DEX mod + equipped armor ac_bonus + magic.ac_bonus + shield + Fighting Style
  saves,                         // per_ability -> {id: mod}  OR  categorical -> {id: target}
  skills,                        // skill id -> total bonus (ability + prof if proficient + magic skill_bonus)
  encumbrance,                   // slots or weight, from rules.encumbrance.method
  attackSummary,                 // for each equipped weapon: bonus, damage formula, magic rider
}
```

The character panel renders against this — the raw character never leaves its `gameData` home.

### 4. UI mapping — features as cards, hazards as prompts, connections as exit buttons

- **Connections** become a **Connections strip** in the narrative panel header (or above the action prompt): one button per connection where `state === "open"` AND prerequisites met. `state: "locked"` renders as a disabled chip showing the label plus a small lock icon (reveals its existence without enabling traversal). `state: "hidden"` is invisible until `reveal_connection` fires. Label: `connection.label ?? titleCase(key)`. Click = typed "I go through <label>" into the action input and submit (prompt then narrates the transition; engine updates `current_room`).
- **Features** render in the narrative panel on room entry as a **Feature cards** block (one card per feature whose prerequisites are met; `prereq_hint` shown on unmet ones as a dim hint only if authored). Card content by type:
  - `lore` — title + description + "Examine" button (reveals `on_examine`).
  - `searchable` — title + description + "Search" button (triggers the `check` flow; on success, shows `on_success`, fires rewards and effects; on failure, `on_failure`; respects `persists`).
  - `interactive` — title + description + one action button per `actions[current_state].label`; on click, fires `effects[]`, displays `result`, transitions state.
  - `puzzle` — title + description + either a free-text "Propose a solution" input (GM judges via narrative, per the schema's "pure narrative" / "narrative bypass" modes) and a "Try a roll" button when `check` is present (check-gated mode).
- **Hazards** surface as **prompts/modals** at the moment the `trigger` fires. The engine dispatches:
  - `on_enter` — runs once on room entry (respecting `persists`).
  - `on_traverse` — runs when the player attempts to cross/use the affected area (inferred from connection click or free-text; repeats if `persists`).
  - `on_interact` — runs when the targeted feature is interacted with.
  - `on_examine` — prompt-judged (the GM surfaces the hazard narratively when the player examines the target).
  - On trigger: if `detection` present, offer a Perception-style prompt first ("You can try to spot something off. Roll Perception DC <tier>"). On success, show `detection.on_success`, award `reward_on_detection`, set `hazards[id].state: 'detected'`, skip avoidance if `resolved_by_detection: true`.
  - If `avoidance` present, offer the avoidance roll. On success, show prose and award `reward_on_avoidance`. On failure, show narration, apply `damage` via `applyDamage`, add `conditions[]`, set state to `triggered`.
- **Encounters** continue to render in the right-hand "Active Encounters" panel but now per-instance: "Goblin #1 (HP 7/7, AC 13, +2 scimitar 1d6+2 slashing)". On `on_enter` encounter trigger on first room visit, fire `[COMBAT: on]` via the prompt; on last instance defeated, fire `[COMBAT: off]` and run `on_defeat_effects`.
- **Character panel** adapts to the rules pack:
  - Ability rows iterate `rules.character_model.abilities[]`, showing abbr + score + derived mod.
  - Skills section hides when `character_model.skills` is `[]` or omitted (Three Knots).
  - Saves section renders two shapes: `per_ability` (six rows, prof dot + derived total), `categorical` (one row per declared category, numeric target straight from `character.saves.values`). The renderer reads `rules.character_model.saves.type` once and branches.
  - Feature resources render when non-empty; each shows `current/max` with a `-` button (decrement) and rest-recharge pill.
  - Equipment lists resolved item entries: name, slot, damage line for weapons, ac_bonus for armor, and a magic ribbon (attack_bonus / damage_bonus / bonus_damage / save_bonus / skill_bonus / charges) when `magic{}` present. Pack list shows item name + quantity; consumables show a "Use" button routed by `on_use` keyword.
  - Conditions rail uses the fixed icon library (`skull`, `drop`, `fire`, etc.) with `skull` as fallback.

### 5. Streaming

**Deferred.** The current non-streaming path works and the proxy already supports SSE for when we want it. Streaming touches prompt-handling, response-assembly, mid-stream tag parsing, and the death-overlay flow — all of which are changing in this refactor. Shipping streaming on top of a half-migrated pipeline multiplies risk. Add a single backlog item: "After this refactor lands, wire `streamResponse()` in `scripts/llm-proxy.js` to the existing `/api/messages` SSE path." No schema/prompt impact. Trade-off: a few seconds of lag per turn until later.

### 6. File structure — keep the HTML monolithic or split now

**Split now, minimally, as part of this refactor.** Rationale: the monolith is ~3,500 lines and the refactor rewrites large swaths of it. Rewriting in-place in a 3,500-line file is higher risk than rewriting into named modules with clear boundaries. But we honor the "no build, no framework" constraint — each file is a plain `<script src="…">` that attaches to `window.<Namespace>`, same pattern as `scripts/rules-engine.js` already uses. The HTML ends up as a thin shell: templates, CSS link, `<script>` tags in dependency order, a small `main.js` bootstrap.

Proposed split (all under `scripts/`):

- `rules-engine.js` — pure math/logic (attach to `window.RulesEngine`); grows during the refactor.
- `pack-loader.js` — manifest + 6 archetype loader, sidecar loader, validator, error UX; exposes `loadPack(manifestUrl) → Promise<gameData>`. (`window.PackLoader`)
- `game-state.js` — `gameState` construction, `deriveSheet` caching, save-state serializer/deserializer, localStorage I/O. (`window.GameState`)
- `prompt-builder.js` — owns the v1 `buildSystemPrompt()`: pulls `{{SETTING_BLOCK}}` (setting JSON + lore .md), `{{RULESET_BLOCK}}` (rules JSON, v1 fields), `{{LAYOUT_BLOCK}}` (rooms/connections/features/hazards/encounters), `{{GUIDANCE_BLOCK}}` (module + rules + character sidecars), and the CURRENT GAME STATE block. (`window.PromptBuilder`)
- `response-parser.js` — control-tag parser (`[ROLL_REQUEST]`, `[MONSTER_ATTACK]`, `[COMBAT]`, `[CONDITION]`, `[DAMAGE_TO_PLAYER]`, `[HEAL_PLAYER]`, `[RESOURCE_USE]`, `[MODE]`, `[MONSTER_DEFEATED]`, `[MONSTER_FLED]`). No mutation — returns a structured diff; the caller applies it. (`window.ResponseParser`)
- `ui-character.js`, `ui-encounters.js`, `ui-narrative.js`, `ui-features.js`, `ui-hazards.js`, `ui-connections.js`, `ui-dice.js` — one render function per panel/region. Each reads from `gameState` and `gameData` and renders into its template's root element. (`window.UI.<area>`)
- `llm-proxy.js` — fetch wrapper around `/api/messages`, conversation-history prune, error recovery. (`window.LLMProxy`)
- `main.js` — bootstrap: load templates, fetch `/api/config`, call `PackLoader`, hydrate `GameState` (including `loadGame()` if a valid save exists for this pack), mount UI, wire input events.

Trade-off: we could go further (one file per room-content type, one per control tag). We don't, because the user is a designer/PM and each additional file is cognitive overhead.

### 7. Feature coverage — what the three packs use vs. deferred v2

**In scope for this refactor (the three packs exercise these):**

- Saves: `per_ability` (Lantern & Blade, Gauntlet) AND `categorical` (Three Knots).
- Modifier formulas: `table_5e` (L&B / Gauntlet) and `table_bx` (Three Knots).
- Skills: full skill list (L&B / Gauntlet) AND skill-less (Three Knots — `skills: []`).
- Damage types: full palette (L&B / Gauntlet) AND typeless (Three Knots — no `damage_types` block).
- Advantage/disadvantage: `true` (L&B / Gauntlet) AND `false` (Three Knots).
- Checks direction: `roll_high_vs_dc` (L&B / Gauntlet) AND `roll_under_score` (Three Knots, flipped in Stage 0).
- Critical hits: `nat_20 → double_dice`.
- HP at zero: `unconscious` (L&B / Gauntlet) AND `dead` (Three Knots — death overlay fires immediately).
- Encumbrance: `weight` (L&B / Gauntlet), `slots` (Three Knots). Render only — no enforcement yet.
- Level table + optional `proficiency_bonus` per row (L&B / Gauntlet use it; Three Knots doesn't declare it).
- `xp_sources` including `"treasure_recovered"` — Three Knots opts in, L&B does not; the gold-as-XP runtime rule must respect this.
- Features: all four sub-types — `lore`, `searchable`, `interactive`, `puzzle` (Gauntlet uses searchable + puzzle; Crow's Hollow adds lore and interactive).
- Hazards: detect-then-avoid (Gauntlet `careful_foot_plates`), pure-avoidance (Gauntlet `breath_held_mist`), and the automatic / interaction-gated shapes (Crow's Hollow).
- Effects: `unlock_connection`, `reveal_connection`, `activate_feature`.
- Feature prerequisites: `feature_state` (`solved`, `succeeded`, interactive state string, `unlocked`) AND `encounter_defeated`. Gauntlet's `oathblade_rack` gates on `hidden_word_riddle: solved`.
- Connections: simple form AND structured form, initial states `open` / `locked` / `hidden`.
- Completion conditions: `defeat_encounter` (Three Knots / Crow's Hollow), `null` (Gauntlet).
- Encounter triggers: `on_enter` AND `on_condition` (Gauntlet's `oathblade_dummy`). `scripted` too if any pack uses it.
- Feature resources (Second Wind, Action Surge) — Ren and Aldric both have them; `[RESOURCE_USE: pool_id]` tag dispatch.
- Charged items (L&B ships `wand_of_lanternlight`-style entries) — render-only unless a starter character equips one; the dispatch happens via `magic.charge_effect` prose, so the JS work is just tracking `charged_items[id].current_charges`.
- Consumable dispatch — all three `on_use` keywords (`heal_player`, `cure_condition`, `gm_adjudicate`). Gauntlet's Apothecary exercises all three.
- Magic bonuses on equipped items — `attack_bonus`, `damage_bonus`, `ac_bonus`, `bonus_damage`, `save_bonus` (incl. reserved `"all"`), `skill_bonus`, `damage_resistance`, `damage_immunity`. Oathblade uses attack_bonus + bonus_damage; Ring of Protection uses save_bonus {all:1}.
- Damage resistance/immunity/vulnerability on monsters.
- Module-scoped bestiary and items (resolution-order rule: module-scoped first, shared second).
- Environment block — prose-only in v1; the engine just surfaces it in the room-description area.

**Explicitly deferred to post-refactor (stub but don't wire):**

- Wandering monsters / exploration-turn counter.
- `spawn_encounter`, `trigger_event`, `end_module` effect types.
- Structured `on_hit` save-or-suffer riders (GM adjudicates as prose).
- Multi-step puzzles with structured sequence enforcement (prose-only in v1; the chaining via `activate_feature` already works).
- Per-class XP tables, class-feature trees, structured spells.
- Attunement, cursed mechanics, item sets.
- Descending AC, death saves, individual initiative + turn-order UI.
- Custom condition icons (use the fixed v1 library).
- Streaming (see Q5).
- Character creation / multiple characters / group play.

### 8. Test strategy — using the Gauntlet for regression

The Gauntlet was authored for this. Each chamber is a single surface test; a stage is "done" when its chamber resolves cleanly. The walkthrough order is fixed so each stage below names its Gauntlet gate:

| Chamber | Tests |
|---|---|
| Hall of Initiation | Manifest loads; 6 archetype files merged; character panel renders (abilities, skills, saves per_ability, equipment resolved against items library, feature resources, conditions empty). Eight connection buttons visible, all state `open`. Bronze Plaque renders as a lore feature card. |
| First Arms | Single-enemy `on_enter` encounter triggers `[COMBAT: on]`, player attack routes through `RulesEngine.resolveAttack` against AC 11, damage to monster HP, defeat triggers XP + gold callouts, `[COMBAT: off]`. |
| The Line | Multi-instance encounter; three `practice_skeleton` instances tracked independently; each defeat emits its own callout; last defeat ends combat. |
| Black Gate | Boss HP ~30, attack bonus +5, crit-on-nat-20 doubles dice for the cleave. Validates L&B's `average_class_hd_plus_con` derivation of Ren/Aldric's HP max. |
| Careful Foot | `on_traverse` hazard, detect-then-avoid pipeline: detection Perception DC-easy runs first, success awards `reward_on_detection` XP and skips avoidance; failure offers acrobatics DC-medium; avoidance-failure applies 1d6 piercing AND adds `wounded` condition. `resolved_by_detection: true` respected. |
| Hidden Word | Puzzle feature; narrative bypass (typing "silence" resolves without a roll); check fallback (INT Arcana DC medium); `on_success.effects` fires `activate_feature` on `oathblade_rack` to `unlocked`; `on_success.reward` grants 50 XP. |
| Oathblade | `searchable` feature gated on `hidden_word_riddle: "solved"` — UI hidden until puzzle solved, with `prereq_hint` visible. After solve, searching yields `wardens_oathblade` to the pack. Equipping it to `main_hand` displaces whatever was there; attack applies `magic.attack_bonus +1` and `magic.bonus_damage 1d4 radiant` to the next swing. `on_condition` encounter trigger fires when the Oathblade is first drawn — no app dispatch, GM fires it narratively. |
| Apothecary | All three `consumable.on_use` keywords in one room: `heal_player` (healing_potion) actually restores HP clamped to max; `cure_condition` (antitoxin) removes `poisoned` from `conditions[]`; `gm_adjudicate` (holy_water) fires a "Use item?" confirmation and the GM narrates. |
| Breath-Held | `on_enter` pure-avoidance hazard (no detection block offered); CON save DC medium; on failure, 1d4 poison damage AND `poisoned` condition applied. Round-trip with Apothecary validates the condition-add-then-cure cycle. |
| Completion | Gauntlet `completion_condition: null` — no end-of-module event fires. |

Parallel regressions on the narrative packs:

- **Three Knots:** validates `categorical` saves rendering (5 rows with authored numeric targets, no derivation); `table_bx` modifier formula; skill-less character panel (Skills section hidden); typeless damage (no damage-type chips shown); `advantage_disadvantage: false` (prompt must not ask for adv/disadv; only plain `[ROLL_REQUEST: Ability]`); `roll_under_score` resolution (a single d20, success on roll ≤ target); gold-as-XP (`"treasure_recovered"` in `xp_sources`); `at_zero: "dead"` — death overlay on the first 0-HP crossing, not an unconscious state.
- **Crow's Hollow:** validates the structured-connection shapes (locked + hidden doors), the full feature trinity, and `completion_condition: { type: "defeat_encounter", target: <id> }`.

No automated tests. The designer/PM walks each stage.

### 9. Migration path — single PR or staged

**Staged, seven stages + a small Stage 0 data-pack chore, each deliverable independently.** Single PR would stall because the monolith still works for Three Knots content today and the user has to keep playing while the refactor lands. Staged also means each stage ships a Gauntlet-provable win, which is how the designer knows the rules engine isn't regressing.

Trade-off: a staged refactor means we carry a "both-shapes" reader through stage 2 (the pack loader understands v1 but hands a transformed, pre-v1-ish `gameData` to the unchanged UI). That's a couple of sessions of ugliness. The alternative — a big-bang rewrite — fails the "testable per stage" requirement.

**Stage order (summary; details below):**

0. **Three Knots data-pack flip to roll-under** — tiny pre-stage data chore so stage 4 has a real roll-under branch to test.
1. **Scaffolding & pack loader** — split the monolith into modules, implement `PackLoader`, shim old `gameData` shape from v1 inputs; no UI changes.
2. **Derived-stat + character panel rewrite** — `deriveSheet` for both saves shapes, both modifier formulas; render character panel off v1 raw data directly.
3. **Rules engine: combat** — move attack/damage/crit/monster-attack into `RulesEngine`; update the prompt's COMBAT ADJUDICATION section accordingly; Gauntlet: First Arms → The Line → Black Gate.
4. **Rules engine: checks & hazards** — checks, DC tiers, adv/disadv, roll-high vs. roll-under branching, hazard dispatch (all four shapes); wire Careful Foot + Breath-Held.
5. **Rooms, connections, features** — structured connections as exit buttons; feature cards (all four sub-types); effect dispatch (`unlock_connection`, `reveal_connection`, `activate_feature`); feature prerequisites; Gauntlet: Hidden Word → Oathblade.
6. **Items pipeline** — resolve character equipment + pack against items library; magic bonuses in `deriveSheet`; consumable dispatch (all three `on_use` keywords); Apothecary chamber clean.
7. **Save state + completion condition + deprecation** — rewrite save-state to the v1 schema; wire completion condition (`defeat_encounter` / `reach_room` / `all_encounters_defeated`); delete pre-v1 files; final Gauntlet round-trip.

### 10. Deprecation of pre-v1 files

Confirmed via inspection:

- `rules.json` — pre-v1 shape (`core_mechanics.ability_checks.dc_scale`, etc.). **Delete at end of stage 7.** No v1 manifest references it.
- `monster_manual.json` — pre-v1 `monster_manual.version / system` shape. **Delete at end of stage 7.** Superseded by `bestiary_lantern_and_blade.json` and `bestiary_three_knots.json`.
- `test_module_rules.json`, `test_module_arena.json` — pre-v1 module shapes. **Delete at end of stage 7.** The Gauntlet (`module_gauntlet.json`) replaces them.
- `character_aldric.json` — confirmed already v1 (`game_pack_id: "gauntlet_test_hub_v1"`, `schema_version: 1`, v1 `equipment[]` + `pack[]` + `feature_resources` + `saves.proficient`). **Keep.**
- `JSON_DATA_AND_SWAPPING.md` — historical planning doc. Leave alone; not code. (Companion pre-v1 docs `SESSION_3_CHANGELOG.md`, `RULES_TESTING.md`, `GM_RULES_REWRITE.md` were archived to `~/mace-and-marrow/sessions/_archive/` on 2026-04-27.)

Also drop any leftover inline module/hardcoded-rules paths in the frontend — `CONFIG.DATA_FILES`, fallback `XP_LEVELS_DEFAULT`, and the `DEFAULT_EQUIPMENT_SPECS` equipment catalog (all of it is now authored in the items library).

Trade-off: we could leave pre-v1 files in a `legacy/` folder for one release as a safety net. We don't, because the validator in `json-validator.html` has already moved to v1, the three active packs are clean, and dead files rot planning docs.

---


## Stage 0 — Data-pack chore: Three Knots to roll-under

**What it ships:** Three Knots exercises the `roll_under_score` branch of the rules engine for real, so Stage 4's save/check path has a live regression target for both directions.

**Touches:**

- **Modify** `rules_three_knots.json`:
  - `resolution.checks.method` → `"roll_under_score"`
  - `difficulty` block → swap to the roll-under shape per `JSON_SCHEMAS.md:537` (penalty/bonus to target by tier, not DC-by-tier).
  - Re-read `crit_success` / `crit_failure` labels — for roll-under, nat 1 is typically the crit success and nat 20 the fumble. Flip if needed.
- **Modify** `character_valen.json` (and any other Three Knots PCs):
  - Authored `saves.values` integers stay numeric; their **semantics flip** — higher target = easier save. Re-tune the spread if the current authored numbers no longer read right under roll-under.

**Validates:** Three Knots still loads cleanly. No code in the app is roll-under aware yet, so playing through Three Knots in Stage 0 will misbehave on save prompts — that's expected and gets fixed in Stage 4.

**Does NOT yet:** touch app code. Pure data-pack chore.

---

## Stage 1 — Scaffolding & pack loader

**What it ships:** the HTML is split into named scripts, a v1 pack loads cleanly, and the app renders today's UI from today's shimmed state. No user-visible behavior change; developer-visible split is complete.

**Touches:**

- **Create** `scripts/pack-loader.js`, `scripts/game-state.js`, `scripts/prompt-builder.js`, `scripts/response-parser.js`, `scripts/llm-proxy.js`, `scripts/main.js`, `scripts/ui-character.js`, `scripts/ui-encounters.js`, `scripts/ui-narrative.js`, `scripts/ui-features.js`, `scripts/ui-hazards.js`, `scripts/ui-connections.js`, `scripts/ui-dice.js`.
- **Modify** `playable-dungeon-crawler-v2.html` — remove the 3,000-line inline `<script>` body; add `<script src>` tags in dependency order; keep templates, CSS link, and the tiny template-loading bootstrap.
- **Modify** `templates/narrative-panel.html` — add DOM anchors for the Connections strip and Feature cards region (stage 5 populates them; stage 1 leaves them empty).
- **Modify** `scripts/rules-engine.js` — no API changes yet, but add `dcForTier(tierId, rules)` helper that reads `rules.difficulty.scale[]`. Leave the pre-v1 `dcFor(label, dcScale)` in place for one stage.
- `PackLoader.loadPack(manifestUrl)` fetches manifest, six archetype files in parallel, and sidecar markdowns (`rules.guidance`, `setting.content`, `module.guidance`, `character.guidance`). Validates: character's `game_pack_id === manifest.id`; `module.starting_room ∈ rooms`; every monster_ref resolves (module_bestiary first, bestiary second); every item_id resolves (module_items first, items_library second); every connection target resolves; every `unlock_connection` / `reveal_connection` / `activate_feature` / `encounter_defeated` / `feature_state` reference resolves.
- Validation failures render the loading-error UX described in Q2; successes pass a merged `gameData` object to `GameState.init(gameData)`.
- **Shim:** because stages 2–7 haven't refactored the UI yet, `GameState.init` builds a pre-v1-shaped `gameState.character` and `gameData.rules / module / bestiary` for the existing renderers. This is temporary; stage 2 rips the shim out for the character panel, stage 5 for rooms, etc.
- `CONFIG.GAME_PACK` default stays on Three Knots (still valid); document the Gauntlet flip for regression (`CONFIG.GAME_PACK = './game_pack.json'`).

**Validates:** The Gauntlet loads without error. Hall of Initiation renders with Aldric's character sheet (shimmed). No regression in Three Knots (switching `CONFIG.GAME_PACK` and reloading still lands you in the village with Valen).

**Does NOT yet:** render new UI elements, dispatch effects/hazards via the engine, or change prompt shape. The prompt-builder still produces the current string; the control-tag parser still mutates state the way it does today.

---

## Stage 2 — Derived-stat pipeline and character panel rewrite

**What it ships:** character panel renders natively from v1 data for every rules-pack variation — per-ability and categorical saves, table_5e and table_bx modifiers, skill-less and skill-full packs, typeless and typed damage, optional proficiency bonus, encumbrance method rendering.

**Touches:**

- **Modify** `scripts/rules-engine.js` — add `deriveSheet(character, rules, itemsById)` returning the shape from Q3; add `modifierFor(score, formula)` for `table_5e` / `table_bx` / `score_is_mod`; add `acFor(character, rules, itemsById, classFeatures)` (handles Fighting Style: Defense by reading the `class_features[].id === 'fighting_style_defense'` pattern).
- **Create/complete** `scripts/ui-character.js` — renderer reads `gameData.rules.character_model` and branches:
  - Ability iterator: `rules.character_model.abilities[]` → one row each with `abbr`, `score`, derived mod.
  - Skills: if `rules.character_model.skills` empty or missing → hide section; else render each declared skill with proficient/unproficient + derived total.
  - Saves: `type === 'per_ability'` → one row per ability with proficient dot + derived total; `type === 'categorical'` → one row per declared category with the character's numeric target straight from `character.saves.values`.
  - Class feature list + feature_resources (with `current/max` + `-` button wired via a `[RESOURCE_USE: id]` tag inserted into the next prompt turn).
  - Conditions rail: icon library per schema, fallback `skull`.
  - Equipment and Pack resolve against `gameData.items` (module_items preferred, items_library second); display name, slot label, weapon line (`damage damage_type` for typed packs, bare `damage` when typeless), armor ac_bonus, magic ribbon.
- **Modify** `templates/character-panel.html` — add a Saves section with two layout slots; add a Feature Resources section; keep Abilities / Skills / Equipment / Pack.
- **Delete** the pre-v1-shimmed character shape inside `GameState.init`; `gameState.character` now carries v1 raw fields directly.

**Validates:** Aldric in Gauntlet, Ren in Crow's Hollow, Valen in Three Knots — each renders the correct pack-specific character panel. Swapping rules packs (by editing `CONFIG.GAME_PACK`) re-derives everything without migration. Specifically: Valen shows five categorical save rows with the authored numbers (from `saves.values`) and hides Skills; Ren and Aldric show six per-ability save rows with derived bonuses.

**Does NOT yet:** use the engine for combat attacks (stage 3), apply magic bonuses to rolls (items pipeline is stage 6), or rewrite saves/rooms in the prompt (stage 7).

---

## Stage 3 — Rules engine: combat

**What it ships:** attack/damage/crit pipelines run in JS. Player attack sends no damage request to the GM — it sends the resolved outcome. The prompt's COMBAT ADJUDICATION and COMBAT FLOW sections shrink.

**Touches:**

- **Modify** `scripts/rules-engine.js` — keep existing `resolveAttack` but widen its input contract: accept `{ attackBonus, damageFormula, damageBonus, targetAC, critThreshold, critEffect, rng }` with `critThreshold` defaulting to 20 (Champion-style 19 support when `character.class_features` contains `champion_improved_critical`); accept `critEffect: 'double_dice' | 'max_damage' | 'extra_die'` from `rules.combat.critical_hit.effect`. Add optional `bonusDamage: { amount, type }` input from the equipped weapon's `magic.bonus_damage`. Add `resistanceMultiplier(damageType, resist[], immune[], vuln[])` helper.
- **Modify** `scripts/ui-dice.js` — the "[ROLL_REQUEST: Attack]" flow now calls `RulesEngine.resolveAttack` with the derived values; emits a callout block matching the prompt contract (`"Attack 17 vs AC 13 — HIT for 7 damage. Goblin is still standing (3/10 HP)."`). Player sends the callout text as the next user message; GM narrates only flavor.
- **Modify** `ai-gm-system-prompt.md` — already reflects "the app resolves attacks end-to-end" under COMBAT ADJUDICATION; no material change except to (a) remove any lingering "request damage roll" phrasing and (b) ensure the "NEVER emit [COMBAT: on] for hazards/traps" rules survive the edit. Keep tag contract untouched.
- **Modify** `scripts/response-parser.js` — `[MONSTER_ATTACK]` now routes through `RulesEngine.resolveMonsterAttack` using the room's active encounter's first attack; produces the "attack roll + outcome" callout; applies damage via `RulesEngine.applyDamage`. Strip the tag from display text. Keep the `[COMBAT: on|off]`, `[MONSTER_DEFEATED]`, `[MONSTER_FLED]` handlers.
- **Modify** `scripts/game-state.js` — encounter instance tracking: `gameState.module.encounters[id].instances[]` holds per-instance HP; defeat rolls up to `resolved` when all defeated; `on_defeat_effects[]` fires on the final defeat (dispatched via `RulesEngine.applyEffect` — stub now, fully wired in stage 5).
- **Modify** `scripts/prompt-builder.js` — `{{RULESET_BLOCK}}` is rebuilt from the v1 rules pack: combat style (`attack.resolution`, `damage.formula`, `critical_hit`), `initiative.type`, `advantage_disadvantage` flag (adv/disadv instruction appears only when true), DC ladder (`difficulty.scale[]` rendered as `"easy DC 10, medium DC 15, hard DC 20"` etc.), `auto_success` / `auto_failure` prose.

**Validates (Gauntlet):**

- **First Arms:** Aldric enters, `[COMBAT: on]` fires, one attack roll resolves in JS (not the GM), damage lands, `practice_skeleton` HP ticks to 0, defeat callout fires XP (25) + gold (1d6), `[COMBAT: off]`.
- **The Line:** three per-instance HP bars; each defeat independent; `on_enter` fires once.
- **Black Gate:** boss HP ~30, five-plus rounds, crit on nat 20 visibly doubles dice in the callout.

**Does NOT yet:** do checks/saves/hazards (stage 4), apply `magic.attack_bonus` / `magic.bonus_damage` from equipped items (stage 6 — the Oathblade test hinges on this), or apply damage resistance/immunity/vulnerability (stage 6, same reason).

---

## Stage 4 — Rules engine: checks, saves, hazards

**What it ships:** every non-combat d20 goes through the engine; detect-then-avoid, pure-avoidance, automatic, and interaction-gated hazard shapes all dispatch correctly; `advantage_disadvantage` is gated on the rules pack; `roll_high_vs_dc` and `roll_under_score` both work.

**Touches:**

- **Modify** `scripts/rules-engine.js` — `resolveCheck({ abilityMod, skillMod, profBonus, dc, advantage, disadvantage, critThreshold, method, rng })`. Branch on `method`: for `roll_high_vs_dc`, d20+mod meets/beats DC; for `roll_under_score`, d20 ≤ target (ignore DC-as-threshold semantics, use the target value from the authored save or ability score). Handle adv/disadv by rolling 2d20 and keeping the appropriate die when `advantage_disadvantage: true`; ignore otherwise. Add `resolveSave({ saveType, saveId, character, rules, dc, rng })` — reads `rules.character_model.saves.type`: if `per_ability`, derives `abilityMod + (proficient ? profBonus : 0) + magic.save_bonus.all + magic.save_bonus[saveId]` and routes through `resolveCheck`; if `categorical`, reads `character.saves.values[saveId]` as the target and applies `resolution.checks.method` (roll-high-meet-target or roll-under-target). Add `evaluateHazard(hazard, hazardState, character, rules, itemsById)` returning a dispatch plan.
- **Create/complete** `scripts/ui-hazards.js` — on hazard trigger (driven by room entry, connection click, feature interaction, or free-text), surface a modal in the narrative panel with detection prompt → avoidance prompt → outcome. Calls `RulesEngine.resolveCheck` / `resolveSave`; applies rewards via `GameState.applyReward`; applies damage via `RulesEngine.applyDamage`; applies conditions via `GameState.addCondition`.
- **Modify** `scripts/ui-dice.js` — `[ROLL_REQUEST: <ability|skill>]` routes through `resolveCheck` with the derived modifier; displays a callout `"Perception 14 vs DC 10 — SUCCESS"` or `"CON save 12 vs DC 15 — FAILURE"`. When `rules.resolution.checks.advantage_disadvantage: true`, the tag parser also accepts `, advantage` / `, disadvantage` suffixes. For `roll_under_score`, the callout reads `"DEX save: rolled 9 ≤ 13 — SUCCESS"` (no DC framing).
- **Modify** `scripts/prompt-builder.js` — the ROLL-REQUEST reference in `{{RULESET_BLOCK}}` only mentions advantage/disadvantage when the pack enables it. DCs in `{{LAYOUT_BLOCK}}` render as named tiers (`dc_tier: "medium"`) not numbers — the engine maps to the numeric DC per pack. For roll-under packs, the `{{RULESET_BLOCK}}` describes the direction plainly ("roll 1d20; succeed on ≤ target").
- **Modify** `scripts/ui-narrative.js` — on room entry, call `evaluateOnEnterTriggers(room, hazardState)` and route any `on_enter` hazards through `ui-hazards.js`. Connection click → `evaluateOnTraverseHazards` for the departing connection.
- **Modify** `scripts/game-state.js` — `hazards[id].state` and `times_fired` tracked per save-state spec; `persists: false` means fire-once.
- **Modify** `ai-gm-system-prompt.md` — in the "WHO ROLLS" section, the `[ROLL_REQUEST: Ability, advantage]` variant is part of the contract but only surfaces in the `{{RULESET_BLOCK}}` when the pack declares the flag. Callout-reading discipline remains: GM reads the resolved outcome from the player's next message, narrates flavor only.

**Validates (Gauntlet, roll-high):**

- **Careful Foot:** on entering, detection modal offers Perception DC-easy; on success, show `detection.on_success`, award 25 XP from `reward_on_detection`, skip avoidance entirely (per `resolved_by_detection: true`). On detection failure, offer Acrobatics DC-medium avoidance; on avoidance failure, apply 1d6 piercing AND add `wounded` condition; on avoidance success, award 10 XP from `reward_on_avoidance`.
- **Breath-Held:** no detection offered (pure-avoidance); CON save DC medium; failure → 1d4 poison damage + `poisoned` condition.

**Validates (Three Knots, roll-under):** any ability check emits only `[ROLL_REQUEST: Ability]` (no adv/disadv suffix) and resolves via `roll_under_score`: a single d20 against the target (ability score or save target), success on ≤. Callout reports `"DEX: rolled 11 ≤ 13 — SUCCESS"` style.

**Does NOT yet:** fire effects from puzzle `on_success` / searchable `reward[]` / interactive `actions[].effects[]` (stage 5); apply magic `save_bonus` from equipment (stage 6).

---

## Stage 5 — Rooms, connections, features, effect dispatch

**What it ships:** structured connections render as exit buttons with state; feature cards for all four sub-types; effect dispatch and feature prerequisites work end-to-end. Puzzles, searchable gates, and state-machine interactives all fire the right side effects.

**Touches:**

- **Create/complete** `scripts/ui-connections.js` — render a strip of exit buttons from `room.connections`. Simple form (string) → plain button. Structured form → label resolution (`label` > titleCase key), state handling: `open` enabled, `locked` disabled chip with lock glyph, `hidden` invisible until revealed. Clicking a button enters the target room, pushes a `gameState.module.visited_rooms` entry, fires on-enter encounters and on-enter hazards.
- **Create/complete** `scripts/ui-features.js` — iterate `room.features` filtered by `RulesEngine.prereqsMet(feature, gameState)`. One card per feature:
  - `lore`: description + Examine button (reveals `on_examine` prose).
  - `searchable`: description + Search button (triggers `check` via `ui-dice`; on success fire `reward[]` via `GameState.applyReward`; respect `persists`).
  - `interactive`: description + one button per `actions[current_state].label`; clicking fires `effects[]`, shows `result`, transitions state.
  - `puzzle`: description + free-text "Propose" input (sends to the GM for narrative judgment per schema "pure narrative" mode) + "Try a roll" button (check-gated fallback).
- **Modify** `scripts/rules-engine.js` — `prereqsMet(feature, gameState)` evaluates `feature_state` (per sub-type convention: interactive `current_state`, searchable `succeeded`/`searched`/`unlocked`, puzzle `solved`) and `encounter_defeated[]`. `applyEffect(effect, gameState)` dispatches the three v1 types: `unlock_connection` (looks up connection by key in every room, sets `state: 'open'` in `connections_modified`), `reveal_connection` (same + UI animate), `activate_feature` (looks up feature by id, sets `gameState.module.features[id].current_state` to the effect's `state` string for interactive targets; for searchable/puzzle targets, sets the matching flag per Convention A — see Risks §4).
- **Modify** `scripts/game-state.js` — `features[id]` deltas written only when they differ from authored initial state; `connections_modified[key]` only when changed. `applyReward(reward, gameState, gameData)` handles the three types: `gold` (dice expression via `RulesEngine.rollFormula` or integer; if `rules.progression.xp_sources` contains `"treasure_recovered"`, award the same amount as XP), `item` (add to pack), `xp` (add to xp, check for level-up).
- **Modify** `scripts/prompt-builder.js` — `{{LAYOUT_BLOCK}}` rewritten for v1: each room lists `id`, `name`, `description`, structured connections (label + state), features (grouped by sub-type with descriptions + DC tiers), encounters (id, trigger type, group summaries from bestiary, rewards), hazards (id, trigger type, shape, detection/avoidance checks). `prereq_hint` surfaces for features whose prerequisites are unmet. Keeps the "use only module data" instruction. **Monitor prompt size here — see Risks §1.**
- **Modify** `templates/narrative-panel.html` — add anchors `#connectionsStrip`, `#featureCards` populated on room entry.

**Validates (Gauntlet):**

- **Hidden Word:** free-text "silence" resolves narratively (pure-narrative mode — the GM judges); typing a wrong answer offers the INT Arcana DC-medium fallback; a successful solve fires `activate_feature` on `oathblade_rack` (sets `unlocked: true` per Convention A) and awards 50 XP.
- **Oathblade:** without solving Hidden Word, the `oathblade_rack` card is hidden and `prereq_hint` ("lantern-sealed") is shown as a dim breadcrumb. After the solve, the card appears and Search yields `wardens_oathblade` to Aldric's pack. (Equipping-and-using validation lands in stage 6.)
- **First Arms / The Line / Black Gate** continue to resolve cleanly (regression on stage 3).

**Validates (Crow's Hollow):** locked door UI; at least one `reveal_connection` fires; content trinity renders.

**Does NOT yet:** resolve item pickup into derived-stat updates (stage 6), or actually use `magic.bonus_damage` on the Oathblade's swing (stage 6).

---

## Stage 6 — Items pipeline

**What it ships:** equipment and pack entries resolve against the items library; magic bonuses thread through `deriveSheet`, attack, and save paths; consumable dispatch handles all three `on_use` keywords; module-scoped items resolve before shared.

**Touches:**

- **Modify** `scripts/rules-engine.js` — `deriveSheet` folds in magic bonuses:
  - AC: equipped armor `ac_bonus` + every equipped item's `magic.ac_bonus`.
  - Attack summary per weapon: `attack_bonus` from weapon-side magic, `bonus_damage: { amount, type }` stored for `resolveAttack`, damage rider narrated.
  - Save totals: `magic.save_bonus.all` + `magic.save_bonus[saveId]` (both stack, per schema).
  - Skill bonuses: `magic.skill_bonus[skillId]`.
  - Ability bonuses: `magic.ability_bonus[abilityId]` folds into score before modifier is computed.
  - Damage resistance/immunity arrays: union over equipped items, exposed on the derived sheet and used by `applyDamage`.
  - Slot-limit enforcement against `rules.character_model.slot_limits` when equipping (warn, not error).
- **Modify** `scripts/ui-character.js` — Pack section: consumables show a "Use" button.
- **Create** `scripts/consumables.js` (or fold into `rules-engine.js`) — `useConsumable(itemId, character, gameData)` dispatch:
  - `heal_player`: expand `amount` (dice or integer), apply via `applyHealing` clamped to hp_max, emit callout, decrement pack quantity.
  - `cure_condition`: accept string or array of condition ids, remove each from `character.conditions`, emit callout, decrement.
  - `gm_adjudicate` (and any unrecognized keyword): confirm dialog, then inject a prompt hint of form "The player uses <item>. Prose: <amount>" so the GM narrates; decrement pack quantity.
- **Modify** `scripts/pack-loader.js` — items resolution helper `resolveItem(itemId, gameData)` checks `module.module_items.items` first, then `items_library.items`; same pattern for `resolveMonster` and `monster_ref`.
- **Modify** `ai-gm-system-prompt.md` — under STATE TRACKING / Pack item use, keep the "say so explicitly when using a pack item" rule but add: "For consumables, the app resolves `heal_player` and `cure_condition` via callouts; narrate flavor only. For `gm_adjudicate` consumables, the app surfaces a confirmation and hands control to you — narrate the effect from the item's prose."

**Validates (Gauntlet):**

- **Oathblade in practice:** equipping `wardens_oathblade` sets the weapon's derived attack to include +1 `attack_bonus`; the next swing's callout includes the base weapon die + `1d4 radiant` bonus damage from `magic.bonus_damage`.
- **Apothecary → Breath-Held round-trip:**
  1. Pick up `antitoxin` from the Antitoxin shelf (searchable with no check; `reward[]` adds to pack).
  2. Walk to Breath-Held; fail the CON save; `poisoned` condition applied.
  3. Back in Apothecary (or inventory), Use antitoxin → `cure_condition` removes `poisoned`, pack quantity decrements.
- **Healing potion:** after Black Gate, Use potion → `heal_player` rolls the amount, clamps to hp_max.
- **Holy water (`gm_adjudicate`):** Use → confirmation modal → GM narrates; no mechanical effect fired by the engine.
- Ren's `ring_of_protection` (if/when it lands on the character) — save totals show +1 from `save_bonus.all`.

**Does NOT yet:** enforce slot_limits strictly (warn only); apply encumbrance penalties (render only).

---

## Stage 7 — Save state, completion condition, cleanup

**What it ships:** the save file matches the v1 save-state spec exactly; pack switches never cross-contaminate; `completion_condition` fires correctly across all three packs; pre-v1 files deleted.

**Touches:**

- **Modify** `scripts/game-state.js` — `serializeSave()` produces the save-state shape from `JSON_SCHEMAS.md`: `schema_version: 1`, `game_pack_id`, `module_id`, `current_room`, `visited_rooms`, `encounters{ id → { resolved, instances[] } }`, `hazards{ id → { state, times_fired } }`, `features{ id → per-sub-type delta }`, `connections_modified{ key → { state } }`, `combat{ in_combat, round }`, `completion{ completed, conditions_met }`, plus a `character_mutations{}` sidecar for mutable character fields (HP, XP, gold, equipment changes, pack changes, feature resources, conditions). `deserializeSave(blob)` validates `schema_version` and `game_pack_id === manifest.id` before applying.
- **Modify** `scripts/rules-engine.js` — `evaluateCompletion(module, gameState)`:
  - `type: 'defeat_encounter'` → `gameState.module.encounters[target].resolved === true`.
  - `type: 'reach_room'` → `gameState.module.visited_rooms.includes(target)`.
  - `type: 'all_encounters_defeated'` → all encounters in all rooms resolved.
  - `null` or missing → GM-judged (no app event).
- **Modify** `scripts/ui-narrative.js` — on any state change that could affect completion, check `evaluateCompletion`; if true and not previously fired, show an end-of-module summary card (XP earned this run, gold, rooms visited, encounters defeated, final wall-clock time). Disable further input; "Restart" and "Load save" buttons in the summary.
- **Modify** `ai-gm-system-prompt.md` — minor: the GM need not narrate "the adventure ends" unless the completion card fires; keep the narrative wrap contract.
- **Delete** `rules.json`, `monster_manual.json`, `test_module_rules.json`, `test_module_arena.json`.
- **Modify** `CLAUDE.md` and `BACKLOG.md` — update file-structure section to reflect the new `scripts/` layout and archetype-file conventions; retire the pre-v1 references; BACKLOG's "Rules engine" Phase 1 item marked done, with streaming and character-creation still open.
- **Modify** `README`-adjacent docs (CONFIG.md, GAME_PACK.md) — if they mention pre-v1 paths, replace with v1.

**Validates:**

- **Gauntlet** (completion_condition: null): playing through all nine chambers and returning to the hub never fires an end-of-module event; the save file round-trips correctly; reloading mid-Apothecary leaves Aldric with the right pack contents, HP, conditions.
- **Crow's Hollow** (completion_condition: defeat_encounter): defeating `warden_lieutenants_last_stand` fires the end-of-module summary.
- **Three Knots**: at 0 HP, death overlay fires immediately (honors `at_zero: "dead"`); save file carries `schema_version: 1`, `game_pack_id: "three_knots_osr_v1"`; switching manifest to Lantern & Blade and back doesn't load Three Knots' save into Ren.

**Does NOT yet:** ship streaming (separate follow-up), character creation, party support, or v2 schema features (multi-step structured puzzles, wandering monsters, etc.). Ship a small backlog delta: "Streaming response via SSE is now a single-file change in `llm-proxy.js`."

---

## Constraints check (what this plan preserves, what it changes)

- **No build, no framework, no TypeScript:** every new file is vanilla JS attaching to `window.<Namespace>`, loaded via `<script src>` in dependency order. Confirmed OK.
- **Readability over cleverness:** each engine function takes plain object inputs and returns plain objects; no inheritance, no classes, no promises for pure math. Split files kept to ~12, not 30.
- **Claude Sonnet 4.5 stays default; `server.js` stays minimal:** no server changes in this plan (SSE already in place for when streaming lands later).
- **Prompt response-length budget (50–100 / 150 max) preserved:** no stage modifies the RESPONSE LENGTH section.
- **Inline-tag contract preserved:**
  - `[ROLL_REQUEST: <label>]` — kept; `, advantage` / `, disadvantage` suffix only when `rules.resolution.checks.advantage_disadvantage: true`.
  - `[MONSTER_ATTACK]`, `[MONSTER_DAMAGE]`, `[MONSTER_DEFEATED: id]`, `[MONSTER_FLED: id]` — kept.
  - `[COMBAT: on|off]` — kept; explicitly forbidden for hazards (the schema's feature/hazard/encounter distinction enforces this at the app level too).
  - `[CONDITION: add id]` / `[CONDITION: remove id]` — kept; id vocabulary comes from `rules.conditions[].id`.
  - `[DAMAGE_TO_PLAYER: N]`, `[HEAL_PLAYER: N]` — kept for hazards and GM-narrated effects.
  - `[RESOURCE_USE: pool_id]` — kept; pool ids come from `character.feature_resources`.
  - `[MODE: travel|exploration]` — kept.
- **`ai-gm-system-prompt.md` simplifies, not forks:** COMBAT ADJUDICATION shrinks (already half there); `{{RULESET_BLOCK}}` / `{{LAYOUT_BLOCK}}` builders change shape to match v1, but the prompt template itself only gains short "the pack supports adv/disadv" and "the engine resolves this" clarifiers. No duplication of rules in JS + prompt.

---

## Risks and decisions

### 1. Prompt context growth — monitor

**How it would manifest:** slower responses, higher cost per turn, and — the real danger — instruction drift. The GM starts forgetting the tag contract, narrates past the 150-word cap, mixes combat sequencing steps, describes off-screen rooms. Not a crash; a slow vibes-degradation.

**Rough budget:** under ~8k chars of system prompt is comfortable for Sonnet 4.5; 8–16k is a yellow zone; 16k+ is red.

**Monitoring:** log `systemPrompt.length` on each request once Stage 5 lands. Surface it in the console or a dev-only readout.

**Mitigation if we cross yellow:** swap `{{LAYOUT_BLOCK}}` from "all rooms in full detail" to "current room in full + neighbor rooms by name/label only" — a one-function change in `prompt-builder.js`.

### 2. Retired heuristic parsers — cleanup with regression watch

Several functions in the current monolith (`tryParseCombatBegins`, `parseMonsterDamage`, item/gold buy-drop regex, torch-state heuristics) infer state from GM prose because the old prompt didn't have a strict tag contract. The v1 tag contract is strict, so these become dead weight and are removed during stages 3–4.

**Watch for:** "combat didn't start when I expected" or "damage didn't register" during the First Arms / Line / Black Gate / Breath-Held Gauntlet walkthroughs. The Gauntlet chambers were authored to catch exactly this.

**Kept:** heuristics that parse the PLAYER'S input (readiedWeaponName, equippedInUse updates from "I switch to my bow", "I drop the torch") — those are still needed because players don't emit control tags.

### 3. Three Knots save direction — DECIDED: roll-under

Three Knots flips to `roll_under_score`. Stage 0 captures this as a pre-stage data-pack chore; Stage 4's `resolveCheck` branches on `rules.resolution.checks.method` and the Three Knots regression explicitly exercises the roll-under path. See Stage 0 above.

### 4. `activate_feature` on searchable/puzzle targets — DECIDED: Convention A

The Gauntlet authors `activate_feature: { target: "oathblade_rack", state: "unlocked" }` against a searchable feature. The schema nominally associates `current_state` with interactive features, so this is schema-grey.

**Decision: Convention A.** `applyEffect('activate_feature', …)` accepts any state string against any feature type and stores it as a flag on `gameState.module.features[id]` (specifically: for searchable/puzzle targets, we set `unlocked: true` when the state is `"unlocked"`, otherwise mirror the string onto `current_state`). The prereq evaluator treats `unlocked: true`, `succeeded: true`, `solved: true`, or `current_state === "<authored state>"` as satisfied.

**Follow-up:** document this convention in `JSON_SCHEMAS.md` so future pack authors know. No data churn required — the Gauntlet stays as-is.

