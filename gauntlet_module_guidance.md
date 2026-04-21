# The Gauntlet — GM Running Notes

## What this is

The Gauntlet is a **rules-engine regression hub**, not a narrative adventure. Each of the eight chambers is a purpose-built test rig for one mechanical surface of the Lantern & Blade rules. The intended use is: after any change to the rules engine (task #4 and beyond), an operator walks Aldric through each chamber, confirms the engine behaves, and ships.

A thorough walk takes 20–25 minutes. A sanity walk of just the combat chambers takes 10.

The narrative framing — a Warden training hall, the initiate's rite of walking the eight doors — exists so the chambers do not feel disjointed when the operator is playing. Do not let the framing slow the tests. The point is coverage.

## The test walk — recommended order

The rooms may be walked in any order; the chamber connections all return to the hub and none of them lock behind. For regression coverage, this sequence exercises the engine most cleanly:

1. **First Arms** — confirm the basic combat pipeline works.
2. **The Line** — confirm multi-enemy handling doesn't share HP pools or fire shared defeat prematurely.
3. **Careful Foot** — confirm the detect-then-avoid hazard pipeline fires in the right order.
4. **Hidden Word** — solve the puzzle; confirm `activate_feature` effect crosses rooms.
5. **Oathblade** — confirm feature prerequisite gating works (rack opens because Hidden Word is solved), confirm item pickup, confirm the pickup fires the on_condition encounter, swing the new blade once, confirm the magic bonuses apply.
6. **Breath-Held** — fail the CON save deliberately; confirm the engine applies both damage AND the poisoned condition.
7. **Apothecary** — pick up all three consumable stacks; use the antitoxin to clear the poisoned condition from Breath-Held; confirm the `cure_condition` dispatch works.
8. **Black Gate** — burn Second Wind and Action Surge on the boss; confirm resource decrement, short-rest refill (on return to hub), crit handling, and the Oathblade's radiant rider against the "unhallowed" construct tag.

Any deviation from this order is fine for ad-hoc testing. The order above is just the fastest full-coverage path.

## What each chamber is testing

| Chamber | Mechanical surface |
|---|---|
| First Arms | Attack → damage → HP → enemy turn pipeline, single instance |
| The Line | Per-instance HP tracking, turn order across multiple enemies |
| Black Gate | Boss HP scaling, crit threat handling, on-the-fly attack variants (Measured Cleave fires below half HP) |
| Careful Foot | Hazard detection short-circuit, avoidance fallback, damage + condition application, detection/avoidance XP rewards |
| Hidden Word | Puzzle resolution (narrative + check), cross-room `activate_feature` effect, XP reward from a feature |
| Oathblade | Feature prerequisite gating, item pickup, equip-and-swap, magic bonus application on a newly-equipped weapon, on_condition encounter trigger |
| Apothecary | All three `on_use` keywords — `heal_player`, `cure_condition`, `gm_adjudicate` |
| Breath-Held | Pure-avoidance hazard (no detection block), save-or-suffer with damage AND condition on fail |

## Regression signals — what "broken" looks like

- **First Arms / The Line:** If HP pools share across instances, if defeat fires shared, if the engine collapses the turn order, it shows here.
- **Black Gate:** If crit natural-20 doesn't double dice (or does double on 19s when it shouldn't), if Measured Cleave never fires at half-HP, if Action Surge doesn't grant a second attack this round, it shows here.
- **Careful Foot:** If the engine skips the detection check; if detection success still applies avoidance damage; if the wounded condition doesn't persist after crossing.
- **Hidden Word → Oathblade:** If the rack is pickable before the puzzle is solved (prerequisite gating broken); if the puzzle's `activate_feature` effect doesn't unlock the rack (cross-room effects broken); if the searchable feature doesn't grant the item on success.
- **Oathblade:** If the blade's +1 attack and 1d4 radiant do not apply on the subsequent dummy swing — the equip-and-apply-magic-bonuses path is broken.
- **Apothecary:** If `gm_adjudicate` items try to resolve mechanically (the on_use dispatch is broken); if `cure_condition` does not remove the poisoned condition applied by Breath-Held.
- **Breath-Held:** If the save fails but no damage lands, or damage lands but no condition — the hazard on_failure field dispatch is split.

## When the Gauntlet is wrong

If a chamber tests something the rules engine no longer supports, rewrite the chamber — don't bend the rules engine to make an obsolete test pass. The chamber is the regression rig, not the spec. The schema (`JSON_SCHEMAS.md`) is the spec.

## NPC and narration notes

There are no NPCs in the Gauntlet. The Warden-adjacent priest who sent Aldric here is offscreen and unnamed; mention them once at the threshold of the Hall of Initiation if the player asks why they are here, then leave the chamber-to-chamber running to the test operator. The constructs in First Arms, The Line, Oathblade, and Black Gate are lantern-work and do not speak.

The one moment of warmth in the Gauntlet is the draw of the Oathblade — narrate it cleanly. That is the only cinematic beat the hub has; spend a sentence on the weight of the blade in the hand and then return to testing.

## What is NOT tested here (yet)

- **Spellcasting** — no caster pregen ships with the Gauntlet. A Cleric or Wizard test walk is on the backlog.
- **NPC dialogue and reaction rolls** — L&B doesn't lean hard on these and the hub has no NPCs.
- **Travel / overland movement / encumbrance over time** — all single-dungeon.
- **Multi-ending completion logic** — `completion_condition` is null on the hub because there is no narrative finish. When the operator has walked what they need, they close the tab.

When these surfaces need coverage, add dedicated chambers or a second test pack. Do not try to retrofit them into the existing eight.
