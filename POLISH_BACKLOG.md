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
