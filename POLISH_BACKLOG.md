# Visual Polish Backlog

Running list of UI/UX polish items surfaced during the v1 refactor smoke tests.
These are intentionally deferred to a dedicated polish pass after the refactor
stages land, so the extraction work keeps momentum.

Each entry: one-line description + where it was surfaced + suggested approach.

---

## Open items

### Player can't roll magic bonus-damage dice physically (Stage 6)

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

### Inventory management — drop / give / transfer items (v2)

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

### System prompt back in RED zone (21k on Gauntlet mid-play)

- **Surfaced:** Stage 6 smoke test (2026-04-24) — session report from
  chamber_oathblade showed 21,140 chars (RED ≥ 16k). Stage 1 trim
  brought us to 12.1k; Stage 5 LAYOUT additions ~+3.5k; Stage 6
  PACK ITEM USE rewrite ~+1.2k; plus L&B RULESET_BLOCK (conditions
  list, level table, difficulty ladder) and the current-room
  ENCOUNTER_INFO block pushing above estimate.
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

### Cross-room combat re-entry when extra attack issued after combat ends

- **Surfaced:** Stage 3 smoke test (2026-04-22, Crow's Hollow). Ren fought
  two goblins in the study. They rendered as a single "Goblin Scavengers"
  stat block and were defeated as one target; [COMBAT: off] fired. When
  Ren attacked "the other goblin", combat re-entered — but against the
  Warden's Lieutenant Orick Havel in the Warden's Crypt room, not the
  remaining goblin.
- **Root cause 1 (single-block encounter):** pre-v1 rendering collapses
  every encounter group into one entry. Per-instance HP is explicitly a
  Stage 5 deliverable — `gameState.module.encounters[id].instances[]`
  should track each goblin separately with its own HP bar.
- **Root cause 2 (cross-room teleport):** when `[COMBAT: on]` fires and
  the current room has no active encounters (because the study's sole
  encounter is already defeated), `ensureCombatRoomHasEncounters()` in
  `scripts/ui-encounters.js` falls back to the first alphabetically-sorted
  room with encounters — in Crow's Hollow that's the Warden's Crypt boss.
  Pre-existing behavior; the original "Combat jumps to wrong room" item
  is a duplicate.
- **Fix direction:** Stage 5 rewrites encounter instance tracking and
  retires `ensureCombatRoomHasEncounters`. For the cross-room fallback
  specifically: when combat triggers in a room with no active encounter,
  the correct move is to surface an error callout ("no active enemy in
  current room") and keep the player put, not to reassign currentRoom.

### Card-game / prose rewards don't update inventory (Crow's Hollow)

- **Surfaced:** Stage 3 smoke test (2026-04-22). Ren played a card game
  during a social encounter and the GM narrated "you win 5 gold coins",
  but the pack's Gold line didn't increment.
- **Root cause:** the tag contract only surfaces rewards on encounter
  defeat (via `encounter.rewards` wired in Stage 3) and on searchable/
  interactive features (Stage 5). Ad-hoc prose rewards from NPC or
  non-encounter interactions have no tag surface; the GM would need to
  emit something like `[REWARD: gold 5]` or `[GOLD: +5]` for the app to
  apply it.
- **Fix direction:** add a `[REWARD: ...]` tag family in Stage 5 or Stage
  6 when reward resolution moves into JS. Spec'd shape: `[REWARD: gold N]`,
  `[REWARD: item <item_id> [xN]]`, `[REWARD: xp N]`. Prompt additions to
  instruct the GM to emit these whenever they narrate a reward the app
  should apply. Until then, these prose rewards are manual.

### Damage callout should show dice face × 2 separately on crit

- **Surfaced:** Stage 3 smoke test (2026-04-22) — addressed partially by
  the Stage 3-post callout rewrite (the damage callout now reads "Damage
  Roll 1d8: 5 ×2 = 10 (+ 3) = 13 slashing" on crit). Follow-up polish
  that's still open: the pre-crit total and post-crit total are both shown
  on one line; a designer might prefer dice face / post-crit face / total
  on their own lines, or a small dice-icon badge.
- **Fix direction:** polish pass — pick a visual treatment (indented
  breakdown block, dice icons, monospace columns) and apply to the
  `formatEngineDamageCallout` helper in `scripts/ui-dice.js`.

### Streaming narration re-renders on completion

- **Surfaced:** Stage 1e-ii smoke test (2026-04-22).
- **Behavior:** Words appear several at a time during streaming (chunky), then
  the entire message visibly re-renders when the stream finishes.
- **Root cause:** `callAIGM()` removes the `#streamingNarration` div and then
  `processAIResponse` calls `addNarration()` to create a fresh entry with the
  fully-parsed text. Two DOM nodes, one swap.
- **Fix direction:** keep the streaming div in place and swap its innerHTML
  with the final parsed content, rather than removing + re-adding. Also
  investigate whether the "several words at a time" pacing is the SSE chunk
  size or the `updateStreamingNarration` debounce.

### Combat jumps to wrong room when GM starts combat outside a scripted encounter

- **Surfaced:** Stage 1e-iv smoke test (2026-04-22).
- **Behavior:** GM narrates a skeleton attacking while the player is in a
  non-combat room (e.g. `inn_three_knots`). Combat starts, but the monster
  panel shows the Tomb Guardian (or another module monster), not the
  skeleton the GM is describing.
- **Root cause:** when `[COMBAT: on]` fires and the current room has no
  active encounters, `ensureCombatRoomHasEncounters()` picks the first
  alphabetically-sorted room with encounters. For Three Knots that's
  `tomb_antechamber` (Tomb Guardian). Pre-existing behavior — not a
  refactor regression.
- **Fix direction:** supersede during Stage 3 (rules engine owns combat
  dispatch via encounter triggers) + Stage 5 (rooms, connections,
  features). Delete `ensureCombatRoomHasEncounters` then. Don't patch
  in the shim — it would be fragile.

### XP bar label — revisit during polish pass

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

## Landed during Stage 7 (2026-04-24)

Stage 7 delivered the v1 save-state envelope, the completion-condition
pipeline, and the pre-v1 file cleanup. No POLISH_BACKLOG items closed
structurally — the save rewrite is transparent to gameplay — but the
doc footprint got a sweep:

- `rules.json`, `monster_manual.json`, `test_module_rules.json`,
  `test_module_arena.json` deleted (grep-verified no live code/data
  referenced them).
- `CLAUDE.md`, `GAME_PACK.md`, `JSON_DATA_AND_SWAPPING.md`,
  `CREDITS_AND_USAGE.md`, `BACKLOG.md` updated to reflect the v1
  `scripts/` layout + v1 archetype files + v1 save envelope.

Stage 7 deliverables (for the record):

- **Save envelope v1**: `schema_version: 1`, `game_pack_id`,
  `module_id`, `saved_at`, `session_started_at` at the top level;
  `module{}` (current_room, visited_rooms, encounters, hazards,
  features, connections_modified); `combat{}`; `completion{}`;
  `character_mutations{}` (hp_current, xp, gold, equipment, pack,
  feature_resources, charged_items, conditions, basic_info.level);
  and a `runtime{}` sidecar for app-state bits not in the spec
  (mode, equippedInUse, conversation history, etc).
- **Per-pack save slots** (`gm-ai-dungeon-save:<game_pack_id>`).
  Switching Three Knots ↔ Gauntlet ↔ Crow's Hollow no longer
  overwrites the others' saves.
- **Schema gate on load**: pre-v1 envelopes are dropped with a
  one-time system message ("Old save format from a pre-Stage-7
  build — please start a new game"). `purgeStaleSaves()` runs
  once at boot so the start-choice UI doesn't advertise a
  Continue button over a save that will fail the gate.
- **`RulesEngine.evaluateCompletion(module, moduleState)`** — pure
  completion gate. Three condition types + null (GM-judged).
  Returns `{ completed, kind, target? }`.
- **`GameState.checkCompletion()`** — fires from `markRoomVisited`
  (reach_room) and the monster-defeat tag path in response-parser
  (defeat_encounter, all_encounters_defeated). Idempotent — flips
  `gs().completion.completed` once and logs a COMPLETION debug
  entry. Null conditions never fire (Gauntlet verified).
- **End-of-module summary overlay** (`#completionOverlay`) — mirrors
  the death-overlay pattern. Stats grid: Level / XP / Gold / Rooms
  visited / Encounters defeated / Run duration from
  sessionStartedAt. Restart + Load save buttons. Disables input
  while shown; `finishGameStart` hides it on restart/load.
- **Debug trail categories**: `SAVE_VERSION` (load detect +
  schema/pack match) and `COMPLETION` (first-fire kind + target)
  now populate the ring buffer for Copy Session Report diagnosis.
- **Test helpers**: `test.dumpSave()`, `test.dumpSavedBlob()`,
  `test.forceSave()`, `test.corruptSave()`, `test.fireCompletion()`,
  `test.checkCompletion()`, `test.killCharacter()`,
  `test.defeatAllEncounters()`, `test.defeatEncounter(id)` — all
  for bypassing full playthroughs during regression.

Regression gates (all three packs):

- **Gauntlet** (null completion): `test.defeatAllEncounters()` +
  clearing all nine chambers both leave `gs().completion.completed
  === false` and never fire the summary overlay.
- **Crow's Hollow** (defeat_encounter): Havel's defeat fires the
  summary card with the Last Stand's defeat prose in the subtitle.
- **Three Knots** (death-overlay + defeat_encounter): 0 HP still
  fires the death overlay immediately (not the completion card).
  Save blob carries `schema_version: 1` and
  `game_pack_id: "three_knots_osr_v1"`.

---

## Landed during Stage 6 (2026-04-24)

Stage 6 delivered the items pipeline — equip/unequip UX, consumable
dispatch for the three `on_use` keywords, and the prompt retuned to
match. Along the way:

- **Healing-potion flow is prompt-brittle** — closed. The Use button
  is now the authoritative path; `useConsumableById` rolls the amount
  via the engine and applies HP directly (no GM coordination required).
  The prose-based fallback (`tryParsePackItemUse` regex) is guarded by
  `gs()._consumableUsedThisTurn` so Use-button decrements + GM-echo
  prose can't double-count. Non-consumable gear (torch, rope, rations)
  keeps its existing prose heuristics.

Stage 6 deliverables (for the record):

- **RulesEngine.useConsumable(item, character, rules, opts)** — pure
  dispatch returning a plan the caller applies. Three on_use keywords
  + two fall-throughs (not_consumable, unknown keyword → gm_adjudicate).
  heal_player rolls via rollFormula (test-friendly via opts.rng).
- **GameState.useConsumableById(itemId)** — wraps the plan with side
  effects: modifyHP + callout for heal, removeCondition for cure,
  inline Confirm/Cancel system message for gm_adjudicate (on Confirm,
  decrements pack + injects a user turn with the authored prose + fires
  callAIGM; on Cancel, dismisses without mutation).
- **GameState.equipItem(itemId, slot?) + unequipItem(slot)** — move
  items between v1 character.pack ↔ character.equipment. Slot
  inferred from item.slot / item.weapon / item.armor when not passed.
  Slot collision swaps the current occupant back to the pack;
  two_handed vs main_hand + off_hand conflict is handled. Mirrors into
  legacy gs().character.equipment + .inventory so the shimmed panel
  stays correct. rules.character_model.slot_limits warned but not
  enforced (deferred).
- **GameState.resolveV1Item / findPackEntry / decrementPack /
  inferSlotForItem** — item-index + pack helpers supporting the
  above.
- **UI.character — action buttons** — Equip / Unequip / Use buttons
  inline on equipment and pack rows. Matches inventory rows to v1 pack
  entries by name; Gold and legacy GM-narrated pickups stay buttonless.
  Gated during in-flight rolls / active hazard steps.
- **gm_adjudicate confirm UX** — inline narrative-panel entry with
  Confirm/Cancel buttons + the item's authored prose styled as a
  left-bar italic quote. No new modal infrastructure.
- **Prompt: PACK ITEM USE rewritten** — explicit app-drives contract
  for heal_player / cure_condition / gm_adjudicate; prose fallback
  retained. Prompt grew 12.1k → 13.2k (still yellow zone).
- **readiedWeaponName auto-tracking** — equip/unequip flips it so
  attack-flow heuristics work without the player typing "I switch to
  my Oathblade" after an Equip click.
- **Debug trail: CONSUMABLE + EQUIP categories** now populate the ring
  buffer for Copy Session Report diagnosis.

Regression gates (Gauntlet):
- **Oathblade in practice** (primary): Search the rack → Oathblade in
  pack → Equip → attack the dummy → attack callout includes
  `+1 attack_bonus` and the damage callout shows the `1d4 radiant`
  bonus-damage rider line.
- **Apothecary ↔ Breath-Held round-trip**: pick up antitoxin → fail
  CON save in Breath-Held → `poisoned` applied → click Use on
  antitoxin in the pack → `poisoned` removed + antitoxin quantity
  drops to 0 + entry removed.
- **Healing potion after damage**: take HP loss → Use potion → amount
  rolls via engine → HP clamps to max, over-heal annotated in callout.
- **Holy water (gm_adjudicate)**: Use → confirm dialog with authored
  prose (undead / living / hallowed-vessel guidance) → Confirm → GM
  narrates per the prose + target in fiction.

---

## Landed during Stage 5 (2026-04-23)

Stage 5 delivered structured connections, feature cards, effect dispatch,
and feature prerequisites. Along the way the following POLISH_BACKLOG
items closed structurally:

- **GM narrates stale door/room counts after partial exploration** —
  `gameState.visitedRooms[]` now rides with the save; every compact
  room in LAYOUT_BLOCK is annotated `(visited)` or `(unvisited)` and
  each detailed exit shows the target's flag. Connection state
  (`open` / `LOCKED`) also surfaces per exit. The GM has no room to
  misremember which doors have been walked.
- **Line chamber blocked as "already walked" on first visit** — same
  root cause, same structural fix. Visited flag is authoritative.
- **System prompt re-budget for Stage 5 growth** — pre-Stage-5 trim
  shrank the template from 18.4k → 12.1k chars (34% reduction); the
  new LAYOUT_BLOCK additions (structured exits + per-feature detail +
  visited flags) land the total around 15-17k on Gauntlet mid-play.
  Yellow zone, well short of red.

Stage 5 deliverables (for the record):

- **RulesEngine additions:** `prereqsMet`, `applyEffect`,
  `featureCheckInputs`, `findFeatureById`, `findConnectionByKey`.
  Pure functions; callers pass the state slice to mutate.
- **GameState additions:** `featureState{}` + `connectionsModified{}` +
  `visitedRooms[]` runtime state (all three ride with the save).
  `buildModuleState()` assembles the unified view for engine helpers.
  `markRoomVisited(id)` + `applyReward(reward, gameData)` as helpers.
- **UI.connections:** exit-button strip into `#connectionsStrip`. All
  three v1 authoring forms supported (simple, structured open, locked
  chip, hidden). Runtime overrides from `applyEffect` take precedence.
  Click → `"I go through <label>."` routed through submitAction.
- **UI.features:** feature cards into `#featureCards`. Four sub-types
  implemented (lore / searchable / interactive / puzzle). Searchable
  and puzzle check-gated flows route through `featureDispatch` → ui-dice
  → `onCheckResolved`. Puzzle narrative solves via `[FEATURE_SOLVED: <id>]`
  tag (parsed in response-parser); both narrative and check-gated
  solves converge on `markSolved` which fires `on_success` effects + reward.
  Prereqs evaluated via `RulesEngine.prereqsMet`; unmet features render
  dim with authored `prereq_hint`.
- **UI.dice:** `featureDispatch` branch parallel to `hazardDispatch`.
- **Room-entry wiring:** single `onRoomEntry(roomId)` coordinator in
  main.js, called from game-start / response-parser / test.teleportToRoom.
  Marks visited → renders cards → renders connections → fires on_enter
  hazards.
- **PromptBuilder LAYOUT_BLOCK:** v1 features block grouped by sub-type;
  puzzle 'SOLVE HINT (GM only)' surfaces `solution.description` + the
  `[FEATURE_SOLVED:]` tag instruction; PREREQ UNMET flag for locked
  features + `prereq_hint` mirrored verbatim.
- **Dev helpers:** `test.activateFeature`, `test.unlockConnection`,
  `test.revealConnection`, `test.solveFeature`.
- **Debug trail:** new `FEATURE`, `CONNECTION`, `EFFECT` categories now
  populate the ring-buffered debug log for Copy Session Report diagnosis.

Regression gates (Gauntlet):
- **Hidden Word → Oathblade:** the prompt's SOLVE HINT gives the GM the
  answer ("SILENCE") + accept-variants. When the player types "silence"
  in the puzzle input, the GM emits `[FEATURE_SOLVED: hidden_word_riddle]`,
  `activate_feature` fires on `oathblade_rack` (unlocked), and 50 XP is
  awarded. Re-entering the Oathblade chamber shows the searchable card
  with the Search button enabled; clicking yields `wardens_oathblade`
  to Aldric's pack.

---

## Landed during Stage 4 (2026-04-23)

The following items were surfaced and shipped during the Stage 4 smoke test run:

- **L&B `max_formula` contradicted `hp_gain_per_level`** — one-line data
  fix to `rules_lantern_and_blade.json`. Aldric now loads at 28/28
  instead of the confusing 28/36.
- **System prompt 29k chars (RED zone)** — `LAYOUT_BLOCK` rewritten to
  render only the current room in full; other rooms ship id + name +
  exits. Conditions block truncates each effect to ~90 chars. Net: 29k →
  ~23k (still RED but -20%; template trim is the next lever).
- **`[ROOM:]` tag** — added as the authoritative room-change contract.
  GM prompt now requires it on every transition. Heuristic fallback
  narrowed to same-sentence co-occurrence of movement verb + room name
  after two false-positive incidents ("reach for the jar" + "the tomb
  road" in different sentences teleporting the player).
- **Hazard double-trigger** — `triggerHazards` de-duped; response-parser
  and main.js now call the dispatcher once per room-entry event (the
  on_enter/on_traverse synonym rule in ui-hazards handles both).
- **`times_fired` accounting** — moved to a single increment per plan
  completion in `finishHazard` so detect+avoid sequences count as 1x.
- **Player-invention guard** — added to the DUNGEON LAYOUT section of
  the system prompt. Players can't conjure NPCs, items, or features by
  describing them; the GM replies in-fiction ("there is no jar").
- **ADJUDICATION tightened** — "call for a roll" is now the default
  bucket with explicit examples; "don't narrate outcomes in pure prose"
  prohibition added to prevent the GM from hand-waving risky player
  attempts.
- **Copy session report button** — single-click clipboard dump for
  designer→developer feedback. State block + 40-event ring-buffered
  debug trail + narrative. Keyed off `debugLog` so every PARSE / HAZARD
  / CHECK / PROMPT event is captured.
- **Condition-driven adv/disadv** — B1 + B2. RulesEngine's
  `conditionAdvDisadvFor(character, rules, checkKind)` returns
  adv/disadv flags based on authored condition effects. Hazard
  dispatcher auto-applies on ability-check hazards. Prompt renders
  player's active conditions with full authored effect + explicit
  "check conditions before [ROLL_REQUEST:]" guidance so GM-initiated
  checks also get the right suffix.

---

## Landed during Stage 2 (2026-04-22)

The following items were called out in the Stage 2 briefing and shipped as
part of the character-panel rewrite:

- **Ability scores back alongside modifiers.** The `.ability-value` rule
  was hidden (`display: none`) in the CSS. Restored to a two-line layout
  (score on top, modifier underneath the abbreviation).
- **Saves section visible in the panel.** The template had no Saves
  anchor before Stage 2. `per_ability` shows six rows with a prof dot and
  derived total; `categorical` shows one row per declared category with
  the authored numeric target.
- **Ability-check dice prompt names the ability.** `showDiceSection`
  interpolates `abilityInfo.label` into the prompt ("Roll for Dexterity
  (1d20 +0)") instead of the generic "Ability Check".
