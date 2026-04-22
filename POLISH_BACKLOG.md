# Visual Polish Backlog

Running list of UI/UX polish items surfaced during the v1 refactor smoke tests.
These are intentionally deferred to a dedicated polish pass after the refactor
stages land, so the extraction work keeps momentum.

Each entry: one-line description + where it was surfaced + suggested approach.

---

## Open items

### GM narrates stale door/room counts after partial exploration (Gauntlet)

- **Surfaced:** Stage 3 smoke test (2026-04-22). Designer visited First Arms
  only, then returned to the Hall of Initiation. GM narrated: "The Hall of
  Initiation waits, silent and patient. Three doors remain: herb, breath,
  and blade." Seven other chambers were in fact unvisited.
- **Root cause:** the module's completion condition ("walk each door once")
  is only encoded as prose in the module guidance. The GM has to track
  visited vs unvisited from conversation history, and drifts on longer runs.
  The layout block in the prompt does not mark rooms as visited or unvisited
  yet (that's a Stage 5 deliverable when rooms/connections become structured
  UI with state).
- **Fix direction:** Stage 5 — surface `gameState.module.visited_rooms[]` in
  the LAYOUT_BLOCK and annotate each room's connections with their current
  state (visited / unvisited / locked / hidden). Once the prompt ships that
  per-turn, GM drift on room counts goes away.

### Line chamber blocked as "already walked" on first visit (Gauntlet)

- **Surfaced:** Stage 3 smoke test (2026-04-22). After visiting First Arms
  and returning to Hall, the designer attempted to enter The Line and the
  GM blocked them: "You've already walked the Chamber of the Line — the
  door with the sigil of three standing figures. WALK EACH DOOR ONCE."
- **Root cause:** same class of problem as the preceding item — the GM's
  model of which doors have been walked is hallucinated from conversation
  history, not driven by app state. Here it's off in the opposite direction
  (marking The Line as walked when it wasn't).
- **Fix direction:** Stage 5. When the layout block carries per-connection
  state and `visited_rooms[]` is authoritative, the GM has no room to
  misremember. Same fix as the previous item.

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

### Healing-potion flow is prompt-brittle

- **Surfaced:** Stage 1e-vii smoke test (2026-04-22).
- **Behavior:** drinking a healing potion sometimes doesn't decrement
  the pack count or restore HP.
- **Root cause:** two separate mechanisms must fire:
  1. `tryParsePackItemUse` regex requires the GM to phrase it as
     "drink/drank/use/used a healing potion". "Quaff", "down", "take",
     or "the elixir restores you" don't match → no decrement.
  2. HP only changes when the GM explicitly emits `[HEAL_PLAYER: N]`
     after the roll. If the GM narrates "you feel restored, +N HP"
     without the tag, HP stays unchanged.
- **Fix direction:** Stage 6 (items pipeline) owns consumable dispatch
  with `on_use: heal_player` — the app parses the player action and
  applies both effects, no GM coordination required. Don't bandaid
  the regex.

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

### L&B `resources.hit_points.max_formula` contradicts `progression.hp_gain_per_level`

- **Surfaced:** Stage 2a derivation smoke test (2026-04-22).
- **Behavior:** Aldric's authored `hp_current: 28` is consistent with the
  `average_class_hd_plus_con` formula (`10 + 2×6 + 3×2 = 28`), but
  `rules_lantern_and_blade.json → resources.hit_points.max_formula` says
  `"class_hd_plus_con"` which yields `3×10 + 3×2 = 36`. Result: the panel
  will show "28/36" on a freshly-loaded character, implying damage that
  never happened.
- **Root cause:** the pack declares two formulas that disagree.
  `progression.hp_gain_per_level: "average_class_hd_plus_con"` is the
  per-level rule; `resources.hit_points.max_formula: "class_hd_plus_con"`
  is the derived-max rule. `deriveSheet`/the shim read the latter.
- **Fix direction:** change `rules_lantern_and_blade.json → resources.hit_points.max_formula`
  to `"average_class_hd_plus_con"` so it matches the per-level rule.
  One-line data-pack edit — not a code change. Same check applies to any
  future pack that declares both keys.

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
