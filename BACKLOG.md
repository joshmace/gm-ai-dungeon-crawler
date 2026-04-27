# AI Dungeon Crawler — Development Backlog

**Last Updated:** April 28, 2026  
**Status:** v1 refactor complete (Stages 1–7). Streaming shipped (PR #6). Character creation is the next top item. Horizon-tagged against `~/mace-and-marrow/ROADMAP.md`.

**Horizon legend:** `[N]` Now (1–2 wk) · `[S]` Soon (1–2 mo) · `[L]` Later (3+ mo)

This is the engineering-facing backlog. The strategy/sequencing layer above lives in `~/mace-and-marrow/ROADMAP.md`. Per-PR and per-stage history of what's already shipped lives in `CHANGELOG.md`.

---

## v1 refactor — landed (April 2026)

Stages 1 through 7 from `REFACTOR_V1_PLAN.md` all shipped. Highlights:

- **Rules engine** (`scripts/rules-engine.js`) owns all d20 math: attack resolution, damage with resistance/immunity/vulnerability, ability/skill checks, saves (per_ability + categorical), hazard dispatch (detect-then-avoid, pure-avoidance, automatic, interaction-gated), feature prerequisites, effect dispatch (`unlock_connection` / `reveal_connection` / `activate_feature`), consumable dispatch (`heal_player` / `cure_condition` / `gm_adjudicate`), and completion-condition evaluation (`defeat_encounter` / `reach_room` / `all_encounters_defeated` / null).
- **Pack loader** (`scripts/pack-loader.js`) loads v1 manifest + six archetype files + sidecar `.md` guidance, validates references, surfaces a specific error card on failure.
- **HTML split** into `scripts/` modules (pack-loader, rules-engine, game-state, prompt-builder, response-parser, llm-proxy, per-panel UI, main). The monolith is a thin shell.
- **Character panel** renders natively from v1 data for all three rules-pack variations (per_ability + categorical saves, table_5e + table_bx modifiers, skill-less + skill-full, typed + typeless damage, encumbrance method).
- **Items pipeline**: equipment + pack resolve against the items library; magic bonuses thread through `deriveSheet`; equip/unequip UX; consumable dispatch handles all three `on_use` keywords; module-scoped items resolve before shared.
- **Rooms / connections / features**: structured connections as exit buttons (open/locked/hidden); feature cards for all four sub-types (lore/searchable/interactive/puzzle); prereqs evaluated; `[FEATURE_SOLVED:]` tag for narrative solves; effect dispatch.
- **Save state** follows the v1 envelope (`schema_version: 1`, `game_pack_id`, `module_id`, `module{}` / `combat{}` / `completion{}` / `character_mutations{}` / `runtime{}`). Per-pack localStorage slots so switching packs doesn't overwrite the other packs' saves. Pre-v1 saves drop with a one-time system message on first load.
- **Completion condition**: end-of-module summary card fires from `GameState.checkCompletion`; overlay shows XP, gold, level, rooms visited, encounters defeated, run duration; Restart / Load save buttons.
- **Pre-v1 files deleted**: `rules.json`, `monster_manual.json`, `test_module_rules.json`, `test_module_arena.json`.
- **Streaming responses (PR #6 + cleanup PR #7)**: words flow in as the model generates them, control tags hide while incomplete (`streamSafeText`), no re-render flash on completion. See `CHANGELOG.md` for details.
- **Debug + test infrastructure**: ring-buffered debug trail covers PARSE / HAZARD / CHECK / PROMPT / FEATURE / CONNECTION / EFFECT / CONSUMABLE / EQUIP / STATE / SAVE / SAVE_VERSION / COMPLETION / AI / HISTORY. Copy-session-report button pastes state + trail + narrative. `test.*` console helpers cover teleport, HP mod, XP, gold, conditions, rolls, feature/connection effects, save dump, and Stage 7 completion triggers.

Next top items:

1. ✅ **Streaming** — shipped via PR #6 + cleanup PR #7. See `CHANGELOG.md` for the full rundown.
2. **`[S]` Character creation** flow (Tier 3 from the pre-long-adventure plan).
3. **`[S]` Future prompt trim pass** — see "Polish & smoke-test items" below. Logged but deferred until behavior drift surfaces; PR #4 already shipped a 1.7k template trim.

---

## Pre–Long-Adventure: Priority & Plan

These 16 features are prioritized so you can run and test longer adventures. Order is by dependency and impact.

### Priority Tiers

| # | Feature | Tier | Rationale |
|---|--------|------|-----------|
| 14 | Game state saving | **Tier 1** | Long sessions need save/load or progress is lost. |
| 15 | Player death | **Tier 1** | Proper end state, restart/continue options. |
| 1 | Leveling 1–10 (max 10) | **Tier 1** | Core progression; already have XP, need level-up flow. |
| 12 | Individual weapon and armor stats | **Tier 2** | Foundation for equipping and comparing gear. |
| 2 | Finding/buying new weapons and equipping | **Tier 2** | Depends on 12. |
| 3 | Finding/buying new armor and equipping | **Tier 2** | Depends on 12. |
| 4 | Visiting a shop and making purchases | **Tier 2** | Economy + 2/3. |
| 5 | Managing pack inventory explicitly | **Tier 2** | Add/drop/use from pack; ties to 2/3/4. |
| 11 | Remove debug panel (for now) | **Tier 2** | Quick cleanup; re-add later when enhanced. |
| 6 | Non-combat encounters, NPCs, skill checks | **Tier 3** | Richer play; builds on existing roll/DC flow. |
| 7 | Spell casting and spell management | **Tier 3** | Spell slots, scaling with level. |
| 13 | Character builder / character management | **Tier 3** | Create/edit/load characters. |
| 16 | Custom character portraits | **Tier 3** | UI polish; can follow 13. |
| 10 | Map support (module map in character panel) | **Tier 4** | Found/purchased map; display + navigation. |
| 9 | Pre-made image references (rooms, monsters, NPCs) | **Tier 4** | Module/monster manual images at appropriate times. |
| 8 | Multiple characters (full party, single user) | **Tier 4** | Larger scope; turn/initiative, shared state. |

### Implementation Plan (Phases)

**Phase 1 – Foundation (must-have for long play)**  
1. **Game state saving** — localStorage (or IndexedDB) save/load; save on key events + manual; load on start.  
2. **Player death** — Death screen, "Restart adventure" / "New character" / "Load save"; no input until choice.  
3. **Leveling 1–10** — Level-up when XP ≥ threshold; apply HP/ability bumps per rules; max level 10; UI update.

**Phase 2 – Equipment & economy**  
4. **Individual weapon and armor stats** — Ensure module/character data has per-item stats; UI shows and uses them.  
5. **Finding/buying weapons and equipping** — Parse "find/buy [weapon]"; add to inventory; equip/readied flow.  
6. **Finding/buying armor and equipping** — Same for armor; AC and "armor equipped" state.  
7. **Shop visits and purchases** — Shop room/state; parse "buy X for Y gp"; deduct gold, add item; optional shop UI.  
8. **Pack inventory management** — Explicit add/drop/use from pack; parsing + UI (e.g. use/drop from pack list).  
9. **Remove debug panel** — Hide or remove from layout; keep code for later.

**Phase 3 – Encounters & characters**  
10. **Non-combat NPCs and skill checks** — NPCs in modules; skill-check outcomes; state flags for "talked to X".  
11. **Spell casting and spell management** — Spell list, slots, slot recovery; level scaling; roll requests for spells.  
12. **Character builder / management** — Create character (abilities, class, name, starting gear); save/load character.  
13. **Custom character portraits** — Upload or pick portrait; store with character; show in panel.

**Phase 4 – Content & party**  
14. **Map support** — Module-defined map image; "found/purchased" flag; show in character panel; optional room highlight.  
15. **Pre-made images** — References in module/monster manual; show room/monster/NPC image at appropriate time in narrative.  
16. **Multiple characters (party)** — Party list, active character, turn/initiative; shared inventory or per-character; single user.

### Status (Pre–Long-Adventure)

| # | Feature | Status | Horizon |
|---|--------|--------|---------|
| 1 | Leveling 1–10 | Done | — |
| 2 | Weapons: find/buy & equip | Done | — |
| 3 | Armor: find/buy & equip | Done | — |
| 4 | Shop and purchases | Done | — |
| 5 | Pack inventory management | Done (drop/leave parsing; use already existed) | — |
| 6 | NPCs and skill-check encounters | Not started | `[S]` |
| 7 | Spell casting and spell management | Not started | `[S]` |
| 8 | Multiple characters (party) | Not started | `[L]` |
| 9 | Pre-made image references | Not started | `[L]` (Track 5 — player-tier media) |
| 10 | Map support | Not started | `[L]` |
| 11 | Remove debug panel | Done | — |
| 12 | Individual weapon/armor stats | Done | — |
| 13 | Character builder/management | Not started | `[S]` |
| 14 | Game state saving | Done | — |
| 15 | Player death | Done | — |
| 16 | Custom character portraits | Not started | `[L]` |

*Update the Status column as work progresses (e.g. "In progress", "Done").*

---

## Polish & smoke-test items

Open polish items surfaced during the v1 refactor smoke tests, folded in from `POLISH_BACKLOG.md` (since retired) on 2026-04-28. Each entry preserves its full Surfaced / Behavior / Fix-direction format with a horizon tag added.

### `[S]` Card-game / prose rewards don't update inventory (Crow's Hollow)

- **Surfaced:** Stage 3 smoke test (2026-04-22). Ren played a card game
  during a social encounter and the GM narrated "you win 5 gold coins",
  but the pack's Gold line didn't increment.
- **Root cause:** the tag contract only surfaces rewards on encounter
  defeat (via `encounter.rewards` wired in Stage 3) and on searchable/
  interactive features (Stage 5). Ad-hoc prose rewards from NPC or
  non-encounter interactions have no tag surface; the GM would need to
  emit something like `[REWARD: gold 5]` or `[GOLD: +5]` for the app to
  apply it.
- **Fix direction:** add a `[REWARD: ...]` tag family. Spec'd shape:
  `[REWARD: gold N]`, `[REWARD: item <item_id> [xN]]`, `[REWARD: xp N]`.
  Prompt additions to instruct the GM to emit these whenever they
  narrate a reward the app should apply. Until then, these prose rewards
  are manual.

### `[S]` Cross-room combat re-entry when extra attack issued after combat ends

- **Surfaced:** Stage 3 smoke test (2026-04-22, Crow's Hollow). Ren fought
  two goblins in the study. They rendered as a single "Goblin Scavengers"
  stat block and were defeated as one target; [COMBAT: off] fired. When
  Ren attacked "the other goblin", combat re-entered — but against the
  Warden's Lieutenant Orick Havel in the Warden's Crypt room, not the
  remaining goblin.
- **Root cause 1 (single-block encounter):** pre-v1 rendering collapses
  every encounter group into one entry. Per-instance HP is needed —
  `gameState.module.encounters[id].instances[]` should track each goblin
  separately with its own HP bar. (Save envelope ships the field; runtime
  rewrite still pending.)
- **Root cause 2 (cross-room teleport):** when `[COMBAT: on]` fires and
  the current room has no active encounters (because the study's sole
  encounter is already defeated), `ensureCombatRoomHasEncounters()` in
  `scripts/ui-encounters.js` falls back to the first alphabetically-sorted
  room with encounters — in Crow's Hollow that's the Warden's Crypt boss.
- **Fix direction:** rewrite encounter instance tracking and retire
  `ensureCombatRoomHasEncounters`. For the cross-room fallback specifically:
  when combat triggers in a room with no active encounter, the correct
  move is to surface an error callout ("no active enemy in current room")
  and keep the player put, not to reassign currentRoom.

### `[L]` Player can't roll magic bonus-damage dice physically

- **Surfaced:** Stage 6 smoke test (2026-04-24) — Oathblade regression.
- **Behavior:** After an attack hits, the damage callout shows two
  lines — the weapon dice (e.g. `1d8: 5 (+3) = 8`) and the magic rider
  (`Bonus 1d4 radiant: 3`). The player rolls the weapon die manually
  (or clicks Roll), but the bonus die is auto-rolled by the engine in
  the same pass. Feel gap: half the dice for a given swing get to be
  "the player's roll" and half don't.
- **Fix direction:** polish pass. Two options:
  - Chain a second dice-section prompt after the weapon damage resolves
    when `bonus_damage` is present — the player rolls the bonus die
    explicitly. More clicks per attack, but consistent.
  - Show the bonus die as a visual animation (die-face reveal) so the
    auto-roll still "feels" rolled without demanding a second click.
- Not a correctness issue; engine math is right either way.

### `[L]` Inventory management — drop / give / transfer items (v2)

- **Surfaced:** Stage 6 smoke test (2026-04-24).
- **Behavior:** Pack items can be used (consumables) or equipped
  (weapons/armor), but there's no way to drop an item, give it to an
  NPC, or transfer it between characters. A player who picks up 50
  crossbow bolts has them forever.
- **Fix direction:** v2 feature (party support + richer item
  interactions). Not blocking solo play. When tackled, add a third
  action button per pack row ("Drop") that removes without side
  effect and optionally surfaces a "You drop the X." narrative entry
  so the GM can react. Give / transfer hooks into the NPC flow.

### `[L]` System prompt back in RED zone (~19.6k post-PR-#4)

- **Surfaced:** Stage 6 smoke test (2026-04-24) — session report from
  chamber_oathblade showed 21,140 chars (RED ≥ 16k). PR #4 trimmed
  template content by 1.7k; full prompt now ~19.6k mid-play. Still RED.
- **Behavior risk:** instruction drift (GM forgets tag contract,
  narrates past the 150-word cap, mixes combat sequencing). Stage 4
  hit this at 23k and mitigated via the "current room full, others
  compact" LAYOUT pass. The same direction still applies.
- **Fix direction:** another trim pass, probably targeting the
  RULESET_BLOCK (conditions list is already 90-char clamped;
  difficulty ladder and saves section could compress). Also worth
  reviewing whether ENCOUNTER_INFO's "exact stats" block can shrink
  now that the engine owns combat. Defer until we see real behavior
  drift, but log it here so it doesn't slip.

### `[L]` Damage callout should show dice face × 2 separately on crit

- **Surfaced:** Stage 3 smoke test (2026-04-22) — addressed partially by
  the Stage 3-post callout rewrite (the damage callout now reads "Damage
  Roll 1d8: 5 ×2 = 10 (+ 3) = 13 slashing" on crit). Follow-up polish
  that's still open: the pre-crit total and post-crit total are both shown
  on one line; a designer might prefer dice face / post-crit face / total
  on their own lines, or a small dice-icon badge.
- **Fix direction:** polish pass — pick a visual treatment (indented
  breakdown block, dice icons, monospace columns) and apply to the
  `formatEngineDamageCallout` helper in `scripts/ui-dice.js`.

### `[L]` XP bar label — revisit during polish pass

- **Surfaced:** Stage 2 smoke test (2026-04-22).
- **Behavior:** Stage 2c aligned the XP bar's text and fill to the same
  reference frame (band-relative: `xp earned this level / xp needed
  for next level`). The numbers now match the bar, but the text reads
  a little cryptically out of context — "0 / 1,800" on a freshly-dinged
  L3 character doesn't obviously say "you earned 0 XP toward level 4".
- **Fix direction:** revisit during the broader polish pass. Options:
  - Add a label prefix: "To level {N+1}: {xpProgress} / {xpNeeded}".
  - Show both bars: a thin absolute bar + the band-relative bar.
  - Switch to a level-tick progress bar (ticks at each level, fill to
    current XP in absolute terms). Needs width math but reads most
    intuitively.
- Not a blocker; the current form is correct and consistent.

---

## Backlog Items

### From Initial Review

#### State Management & Parsing
- [ ] `[S]` Improve HP damage parsing patterns to catch more variations ("8 damage to you", "suffers 5", "6 HP lost")
- [ ] `[S]` Add manual HP override button in case parsing fails
- [ ] `[S]` Add conversation history pruning to avoid hitting context limits on long sessions
- [ ] `[S]` Better state sync validation between AI responses and game state
- [ ] `[S]` Validate AI is following all rules (automated checks) — Track 4 (Automated QA)

#### Persistence & Storage
- [x] Implement localStorage for basic save/load functionality
- [ ] `[L]` Consider IndexedDB for more robust storage
- [ ] `[S]` Add browser refresh warning ("unsaved progress will be lost")
- [ ] `[L]` Cloud save system — depends on user accounts (Track 7)
- [ ] `[S]` Export save files for backup

#### Error Handling
- [ ] `[S]` Error boundaries around AI API calls
- [ ] `[S]` Recovery flow when AI outputs malformed responses
- [ ] `[S]` Validation of AI response format before processing
- [ ] `[S]` Fallback behavior when API is down
- [ ] `[S]` Retry logic with exponential backoff

#### Death & Game Over
- [x] Proper death handling flow (currently just disables input)
- [ ] `[S]` Character sheet save on death
- [ ] `[S]` Option to create new character after death — depends on character creation flow
- [x] Option to restart adventure
- [ ] `[L]` Death statistics/memorial

#### Character Creation
*(All items below: Track 3 — Soon. Bundled into the character creation flow.)*
- [ ] `[S]` Character creation wizard/flow
- [ ] `[S]` Ability score generation methods
- [ ] `[S]` Class selection
- [ ] `[S]` Equipment selection based on class
- [ ] `[S]` Background/personality options
- [ ] `[L]` Name generator option

#### Module Integration
*(Most items in this section were addressed in the v1 refactor — review and check off.)*
- [ ] (likely done in v1) Full integration of module JSON data into system prompt
- [ ] (likely done in v1) Use monster stats directly from JSON
- [ ] (likely done in v1) Use treasure data from JSON
- [ ] (likely done in v1) Use DC values from JSON
- [ ] (likely done in v1) Parse room connections dynamically
- [ ] `[L]` Module file upload interface — Track 6 (Author/Wright tier)
- [ ] `[L]` Module validation/linting — `json-validator.html` exists; expand for Author tier (Track 6)

#### UI/UX Polish
- [ ] `[L]` Loading animations during AI calls (beyond text indicator)
- [ ] `[L]` Sound effects for dice rolls
- [ ] `[L]` Sound effects for combat hits/misses
- [ ] `[L]` Ambient music or atmospheric sound
- [ ] `[L]` Image generation integration (placeholders ready) — Track 5 (player-tier media), needs cost-model decision
- [ ] `[L]` Dice roll animation (3D rolling dice?)
- [ ] `[L]` Character portrait upload/generation
- [ ] `[S]` Toast notifications for XP/items/conditions

#### Combat & Rules
- [ ] `[L]` Separate combat log (scrollable, filterable)
- [ ] `[L]` Export combat log as text/PDF
- [ ] `[L]` Export full narrative as PDF/markdown
- [ ] `[S]` Initiative tracking display (for future multi-enemy fights)
- [ ] `[S]` Enemy health bars (optional setting)
- [ ] `[S]` Advantage/disadvantage roll system
- [ ] `[S]` Critical hit/fumble rules
- [ ] `[S]` Status effect duration tracking

#### Architecture & Code Quality
- [x] Externalize system prompt from HTML — done (`ai-gm-system-prompt.md` is loaded at runtime)
- [x] Move API key to environment variable — done (`.env` + `dotenv` per `CLAUDE.md`)
- [ ] `[L]` Add TypeScript or JSDoc for type safety
- [ ] `[S]` Unit tests for state parsing functions — Track 4
- [ ] `[S]` Integration tests for AI interactions — Track 4
- [ ] `[L]` Code splitting for larger feature sets
- [ ] `[S]` Performance optimization for long conversations — overlaps with conversation history pruning

#### Content & Features
- [ ] `[L]` Multiple dungeon modules — depends on authoring tools (Track 6)
- [ ] `[L]` Module marketplace/library browser — Track 6
- [ ] `[L]` Adventure builder tool (GUI for creating JSON modules) — Track 6
- [ ] `[S]` Character advancement/leveling system with choices
- [ ] `[S]` Skill point allocation on level up
- [ ] `[L]` New ability unlocks at certain levels
- [ ] `[L]` Branching storyline support in modules
- [ ] `[L]` Random encounter tables
- [ ] `[L]` NPC dialogue trees
- [ ] `[L]` Puzzle mechanics
- [ ] `[L]` Trap mechanics with varied solutions

#### Multiplayer/Party Prep
*(All Later — multiplayer is a v3+ vision per `~/mace-and-marrow/PRODUCT_BRIEF.md`.)*
- [ ] `[L]` Multiple character management
- [ ] `[L]` Turn order for party members
- [ ] `[L]` Party inventory (shared/personal distinction)
- [ ] `[L]` Character switching interface
- [ ] `[L]` Real-time multiplayer (ambitious)

#### Platform & Distribution
- [ ] `[S]` Mobile responsive design — named in ROADMAP as a top Soon item
- [ ] `[L]` Progressive Web App (PWA) conversion
- [ ] `[L]` Electron wrapper for desktop app
- [ ] `[L]` Mobile app (React Native or similar)
- [ ] `[L]` User accounts system — Track 7 (production launch)
- [ ] `[L]` Social features (share adventures, compare stats)
- [ ] `[L]` Leaderboards (speedruns, challenge modes)

#### AI GM Improvements
- [ ] `[S]` Better impossible action handling ("you try but..." + world rules explanation)
- [ ] `[S]` More consistent tone across responses
- [ ] `[L]` Personality settings for GM style (serious/humorous/dramatic)
- [ ] `[L]` Remember player preferences across sessions
- [ ] `[L]` Meta-commentary from GM (occasional tips, jokes, etc.)
- [ ] `[L]` Dynamic difficulty adjustment based on player success
- [ ] `[L]` Alternative models support (different Claude versions, other LLMs)

#### Settings & Configuration
- [ ] `[L]` Difficulty/ruleset configuration UI
- [ ] `[L]` House rules toggles
- [ ] `[L]` Death save rules option
- [ ] `[L]` Critical hit rules option
- [ ] `[L]` Starting gold/equipment customization
- [ ] `[S]` Response length preference
- [ ] `[L]` Auto-roll vs manual roll preference
- [ ] `[L]` Theme selection (dark mode, different color schemes)

#### Documentation
- [ ] `[L]` Player's guide/tutorial — Track 7 (external presence)
- [ ] `[L]` Module creation guide — Track 6 (Author tier)
- [ ] `[L]` API documentation for extending the system
- [ ] `[L]` Video tutorial for setup
- [ ] `[L]` FAQ document
- [ ] `[L]` Known issues list

#### Testing & QA
*(All Track 4 — Automated QA. Most are Soon, blocked on the browser-automation spike.)*
- [ ] `[S]` Test combat thoroughly with all enemy types
- [ ] `[S]` Test all skill checks
- [ ] `[S]` Test all room transitions
- [ ] `[S]` Edge case testing (0 HP, negative HP, overflow values)
- [ ] `[S]` Cross-browser compatibility testing
- [ ] `[S]` Mobile device testing
- [ ] `[L]` Screen reader accessibility testing
- [ ] `[S]` Performance testing with long sessions

---

## Ideas Pending Categorization

- `[S]` **Caster pregen for the Gauntlet test hub.** The Gauntlet ships with a Fighter pregen (Aldric) to exercise combat, hazards, and equipment flows. A second pregen — a Cleric or Magic-User — is needed to cover spellcasting, spell slots, per-rest recharge, and save-or-suffer rider adjudication. Add after spell-casting work (Pre-Long-Adventure #7) lands.

*(New ideas will be added here, then sorted into categories above)*

---

## Notes

- Items marked with [ ] are not started; [x] = completed.
- Horizon tags (`[N]` / `[S]` / `[L]`) mirror the strategy doc at `~/mace-and-marrow/ROADMAP.md`. When ROADMAP shifts, retag here.
- **Pre–Long-Adventure** (top section) is the source of truth for the 16 features and their implementation order; update the Status table as work completes.
- **Polish & smoke-test items** holds the open polish entries with full surfaced / behavior / fix-direction prose. Folded in from the retired `POLISH_BACKLOG.md` on 2026-04-28.
- Older backlog items below remain for later prioritization; some overlap with Pre–Long-Adventure (e.g. death, save/load, character creation).
- Dependencies between items are reflected in the Phase order in the implementation plan.
- The "(likely done in v1)" markers in **Module Integration** are flags for review — not definitive. Confirm against current code before checking off.
- Per-PR and per-stage history of what's already shipped lives in `CHANGELOG.md`.

---

## Quick Add Section

*(Use this area for rapid capture - will be organized into main backlog periodically)*

- [ ] `[S]` Equipped gear should be highlighted based on player actions — parse equipment changes from player input (e.g., "I stow my shortbow and draw my sword" should unhighlight shortbow and highlight longsword in character panel)
