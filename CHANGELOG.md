# Changelog

Per-PR and per-refactor-stage rundowns of what shipped, why, and the tradeoffs taken. Companion to git history — `git log` gives you commit order; this gives you the narrative shape (what closed which polish item, how the trim was prioritized, what regression gates each stage proved out).

Lifted from `POLISH_BACKLOG.md` on 2026-04-28 when polish items folded into `BACKLOG.md` and the historical Landed sections moved here.

Newest sections first.

---

## Per-instance HP — Phase 3: cross-room teleport fix + room-transition compliance (2026-05-02 / 2026-05-03)

Closes the cross-room teleport bug from the Stage 3 smoke test
(Crow's Hollow goblin re-entry → Warden's Crypt boss) and the chain of
adjacent issues that surfaced during Phase 3 smoke testing. Eleven
commits with one revert; original Phase 3 scope (parser-side guard) was
the first commit, the rest are follow-ups that closed gaps the smoke
tests opened.

**Original Phase 3 scope — parser-side guard.** The
`ensureCombatRoomHasEncounters()` helper in `ui-encounters.js` was the
silent-teleport mechanism: when `[COMBAT: on]` (or a `[ROLL_REQUEST:
damage|attack]`, or a "combat begins" prose heuristic) fired in a room
with no active enemy, it rewrote `gameState.currentRoom` to the
alphabetically-first room with encounters. Replaced with
`guardCombatRoomHasActiveEncounter()` — surfaces a `"No active enemy
in this room. Combat tag ignored."` callout, reverts `inCombat = false`
and `mode = exploration`, leaves `currentRoom` alone. Three call sites
in `response-parser.js` (the `[ROLL_REQUEST:]` damage/attack branch,
`tryParseCombatTag`, `tryParseCombatBegins`). Dead helper +
`getFirstRoomIdWithEncounters` deleted. Net: −7 lines.

**Dice-UI suppression on guard rejection.** When the guard reverted on
a `[ROLL_REQUEST: Attack]` in a no-enemy room, the existing
`processAIResponse` flow still called `showDiceSection`, leaving the
player staring at "Roll Attack:" with nothing to swing at. Added a
`suppressRollUI` flag — when the guard rejects, fall back to
`disableInput(false)` instead of showing the dice prompt. Non-combat
roll requests (Perception, etc.) unaffected.

**Cleared-room `ENCOUNTER_INFO` header swap.** When a room has authored
encounters but every instance is defeated, the dynamic
`ENCOUNTER_INFO` header now reads `"## Active Encounters: ALL DEFEATED
— this room is cleared. The threat is over. Do NOT narrate combat
with these enemies; if the player attacks, acknowledge that all
enemies are defeated."` instead of the standard "use these EXACT
stats" framing. Runtime swap only — costs zero in mid-fight rooms,
saves ~112 chars in cleared rooms.

**Encounter-panel gating (`panelReadyRooms`).** Pre-fix, the right-hand
encounter panel surfaced enemy HP bars the moment `[ROOM:]` flipped
`currentRoom`, even though the GM hadn't yet narrated the enemies. New
`gameState.panelReadyRooms` array — a room joins it the first time
`buildSystemPrompt` builds with it as `currentRoom` (i.e. the GM has
seen full description + encounters and had a turn to narrate them).
`updateMonsterPanel` only calls `recordEncounterHistoryForRoom` for
rooms in this list (or when `inCombat`, as a fallback).
`test.teleportToRoom` marks the destination panel-ready directly, so
test workflows preserve their immediate-panel semantics. Not persisted
to the save envelope — recomputes on first prompt build after load.

**Authored encounter `placement` surfaced in `ENCOUNTER_INFO`.** The
module's authored `encounter.placement` field — the explicit "what the
player sees on engagement" prose — was never in the prompt. Added to
`buildEncounterDescription` for active encounters only. For Crow's
Hollow `goblin_scavengers` this means the GM sees `"Two scouts duck
behind the overturned drawer and the window as the player enters; the
brute, who had been crowbarring the lockbox without success, turns
with the crowbar still in hand and bellows for his fellows."` —
exactly the cue it needs to introduce the encounter on entry instead
of inventing or omitting. ~150–200 chars per active encounter; mid-
fight Officer's Study went 16,583 → 17,344 chars.

**Auto-resolve survivors on `[COMBAT: off]`.** When the GM emits
`[COMBAT: off]` for a hand-waved end-of-fight (surrender / flee
without an explicit `[MONSTER_FLED:]`), the parser now marks all
surviving instances in the current room defeated and fires authored
encounter rewards once. Pre-fix: a surrendered or fleeing instance
lingered in the panel, encounter never resolved, authored
XP/treasure never applied (player had to demand them in prose, which
violated the no-numbers-in-narration contract). Post-fix: panel
clears, `<charname> gains N XP and discovers Ngp gold!` callout
fires, inventory updates. Reward-firing logic mirrors
`ui-dice.js:1116-1136` inline — refactor candidate.

**Threshold rule reverted.** A static-prompt directive ("on `[ROOM:]`
transitions, narrate the threshold only — never the interior")
shipped briefly as the fix for "GM hallucinates room contents on
transition." Wrong call: it forced the player to manually nudge with
"I look around" to get the description, and didn't reliably trigger
authored encounters either. Reverted in favor of the architectural
fix below.

**Pre-emptive room flip on player movement intent.** The Stage 4
"current room rendered FULL, others compact" paging is correct for
prompt budget but means the GM responds to "I move to X" from a
prompt where the destination is just an id-name-exits stub. Result:
hallucination + missed encounters. Fix: when the player commits to
moving — connection-button click (rock-solid) or movement-intent text
("I head into the study", "I go right") — flip `currentRoom` to the
destination *before* the prompt builds. The GM's response is
generated from a prompt where the destination is rendered FULL. Added
`preemptiveRoomFlip()` in `main.js`, `findMovementTargetInText()` in
`response-parser.js` (shared heuristic with `tryParseRoomChange`),
and a `_preemptiveRoomChangeFrom` flag so `processAIResponse`'s
`onRoomEntry` hook still fires for pre-flipped transitions.
`panelReadyRooms` naturally syncs — the destination joins on the
first prompt build, which is now the entry response.

**Connection-label matching in the movement-intent heuristic.**
`findMovementTargetInText` now also checks the current room's
connection labels (split on commas so "right, into the officer's
study" matches `"right"` or the full phrase independently). Catches
"I go right" / "I enter the right doorway" without needing the
destination room name in the player's text. Skips locked / hidden
connections. Edge NOT covered: when the GM coins its own descriptor
for a connection in narration ("a narrower door stands ajar") and the
player follows it — see new BACKLOG ticket on GM compliance.

**Verified end-to-end in Crow's Hollow.** The original Phase 3 repro
(`test.defeatAllEncounters` → "I swing at the other goblin") now
produces a parser callout instead of a teleport. A natural walk
yard → gate_room → officers_study (via clicks AND via text input
matching room name or connection-label phrases) gets the full
authored study description AND introduces the goblins per their
placement, in a single GM turn. Combat resolves cleanly: per-instance
target picker works, `[ATTACK_TARGET:]` pre-select works, surrender
of the last instance auto-resolves the encounter and fires authored
XP/treasure callouts.

**Trade-offs.** Worst-case prompt at ~17,344 chars in Officer's Study
mid-combat — 156 chars of headroom under the 17,500 soft ceiling.
Save schema unchanged at v1. Non-Crow's-Hollow packs (Three Knots,
Gauntlet) not directly smoke-tested in this session — risk of
regression assessed as low (fixes are pack-agnostic) but not zero.
Known unfixed: the deeper GM-compliance pattern (model occasionally
denies authored content even with correct prompt) — see `BACKLOG.md`.

---

## `[REWARD:]` tag — ad-hoc prose rewards (2026-04-27)

Closes the prose-rewards gap surfaced in the Crow's Hollow Stage 3
smoke test (Ren wins a card-game pot, GM narrates "you win 5 gold",
inventory doesn't update). Authored encounter / feature / hazard
rewards already auto-fire from JSON; ad-hoc prose rewards from NPCs
and social events had no tag surface to land on.

New tag (case-insensitive, multiple per response honored):

- `[REWARD: gold N]` — N is a number or dice formula
- `[REWARD: xp N]` — same
- `[REWARD: item <item_id>]` or `[REWARD: item <item_id> xN]`

Implementation:
- `tryParseRewardTag()` in `scripts/response-parser.js` matches the
  tag, builds a reward object, and delegates to the existing
  `applyReward()` in `scripts/game-state.js`. That helper already
  handles dice formulas, item-library lookup, mechanics callouts,
  and the treasure_recovered XP-doubling convention for Three Knots.
- Strip line added to `displayResponse` cleanup chain. The generic
  uppercase `CONTROL_TAG_RE` in `streamSafeText` already hides the
  tag during streaming.
- `ai-gm-system-prompt.md` adds the tag to CONTROL TAGS with a
  one-paragraph "ad-hoc prose only — do NOT use for authored
  rewards" instruction.
- `test.reward(payload)` console helper for testing without coaxing
  the GM. Examples: `test.reward('gold 5')`,
  `test.reward('item healing_potion x2')`.

---

## Landed post-Stage-7 (2026-04-24)

Three small follow-up PRs after the Stage 7 merge, each shipped on
its own branch + smoke-tested independently:

### PR #4 — Prompt trim, template-focused (~1.7k chars)

Measurement-driven: `test.promptSizeReport()` revealed the master
template (`ai-gm-system-prompt.md`) was 13.2k of static text, **62%**
of every prompt regardless of game state. RULESET_BLOCK +
LAYOUT_BLOCK + ENCOUNTER_INFO together were only 30%. Trimming the
template was the highest-leverage move.

Trim aligned to user-stated GM priorities (mechanics awareness >
setting > flavor coaching). Every mechanical contract (tag
vocabulary, adjudication buckets, app-handles boundaries,
monster-death-language gating, Stage 6 consumable/equip flow)
preserved verbatim. Cuts:
- NARRATION section: flavor-example list + duplicated
  combat-attack-flow paragraph (lives in `{{COMBAT_FLOW_BLOCK}}`
  and `## COMBAT TURN STRUCTURE`). −1,036 chars.
- PACK ITEM USE: intro + flavor elaborations. All five Stage 6
  contracts (heal_player, cure_condition, gm_adjudicate Confirm
  flow, Equip/Unequip, prose fallback) kept verbatim. −457 chars.
- Redundancy pass: tightened DUNGEON LAYOUT prose; dropped the
  duplicated "Do NOT request damage rolls" suffix on the
  readied-weapon line (canonical statement lives in
  `## WHO ROLLS`). −246 chars.

Template: 13,166 → 11,427 (−13%). Full prompt on Gauntlet
mid-play: ~21.3k → ~19.6k. Still RED but ~9% lighter every turn
and well below the 21k peak that surfaced the drift risk in
Stage 4.

Also closed: **L&B `max_formula` contradicts `hp_gain_per_level`**
— retired from Open (was already landed in Stage 4 per the
landings section, just hadn't been removed from the open list).

`test.promptSizeReport()` ships with the PR for future trim
passes.

### PR #5 — Feature cards default-collapsed

Stopgap UI fix. On Three Knots's `inn_three_knots` boot, three
feature cards (Mara Thornwood, Mayor Corbin's Commission, The
Mayor's Reward) were crowding the narrative panel down to a
single line of GM prose. Cards now collapse to a single header
row (chevron ▸ + title + type tag) plus action buttons. Click
the card body to expand the description; chevron flips ▸ → ▾.
Action buttons (Examine, Search, Use, etc.) still trigger their
authored behavior without expanding — `wireExpandToggle`
ignores clicks on `button, input, textarea, select, label`.

Locked cards (unmet prereqs with an authored `prereq_hint`)
follow the same pattern — collapsed by default, hint reveals
on click.

Reclaims ~80% of the vertical space cards were taking.
Implementation is a CSS class toggle, easy to migrate when the
eventual card UI redesign lands (likely a horizontal chip strip
or sidebar drawer; not in scope yet).

### PR #6 — Streaming response polish

Streaming was already wired pre-Stage-7 (`CONFIG.STREAM = true`,
`readAnthropicStream` reading SSE deltas, `updateStreamingNarration`
rendering tag-stripped text). Two visible bugs blocked the UX
win, plus a death-overlay edge case:

- **Tag flashes mid-stream**: `CONTROL_TAG_RE` only matched
  COMPLETE `[TAG: ...]` patterns. Mid-stream chunks like
  `"She turns. [ROLL_REQ"` displayed the partial bracket until
  the closing `]` arrived.
- **Re-render flash on completion**: `callAIGM` removed the
  streaming div, then `processAIResponse` called `addNarration`
  to create a fresh entry. Visible DOM swap.
- **Death-overlay orphan**: death narration rendered into the
  streaming div, but the `isDead` branch in `processAIResponse`
  skipped `addNarration`, so the streaming div hung around as
  an orphan under the overlay (visible after Restart / Load
  save).

Fixes:
- `streamSafeText(rawText)` helper hides everything from the
  last unclosed `[` to the buffer end, then strips complete tags
  from what remains. Tail unfreezes naturally as soon as the
  closing `]` arrives.
- `addNarration` upgrades the existing `#streamingNarration` div
  in place when present (replaces content + drops the id so
  subsequent calls in the same turn create new entries).
  Non-streaming path unchanged.
- `processAIResponse`'s `isDead` branch calls
  `removeStreamingNarration()` before `showDeathOverlay()`.

Result: smooth word arrival, no tag flashes, no completion
flash, death overlay clean. Total time end-to-end is the same
(actually slightly longer for SSE overhead) but the perceived
wait drops by ~10x since the first words appear in
~200–500ms instead of after a 4–8 second silent block.

Closed: **Streaming narration re-renders on completion**
(Stage 1e-ii smoke-test item).

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
