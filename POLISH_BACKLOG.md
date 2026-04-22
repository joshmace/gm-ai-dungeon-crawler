# Visual Polish Backlog

Running list of UI/UX polish items surfaced during the v1 refactor smoke tests.
These are intentionally deferred to a dedicated polish pass after the refactor
stages land, so the extraction work keeps momentum.

Each entry: one-line description + where it was surfaced + suggested approach.

---

## Open items

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

### Ability-check dice prompt doesn't name the ability

- **Surfaced:** Stage 1e-vi smoke test (2026-04-22).
- **Behavior:** Dice UI shows `Roll for Ability Check (1d20 +0)` when the
  GM asks for, say, a Dexterity check. Modifier is correct; the ability
  name isn't.
- **Root cause:** the prompt template in `showDiceSection` is hardcoded
  to `"Roll for Ability Check"`. `abilityInfo.label` already contains
  the readable name ("Dexterity", "Perception", etc.) — it just isn't
  interpolated into the prompt.
- **Fix direction:** one-liner — swap `Roll for Ability Check` for
  `Roll for ${abilityInfo.label || 'Ability Check'}`. Safe to do
  standalone or as part of Stage 2 character-panel work.
