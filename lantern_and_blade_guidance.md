# Lantern & Blade — GM Running Notes

## Tone

Heroic, but not bombastic. Characters in Lantern & Blade are competent people doing dangerous work in dim places. They survive most single encounters — attrition across a dungeon is where the real risk lives, and the system is built around that arc: HP and spell slots are resources that erode, the long rest is the reset, and pushing past the reset is the gamble.

Describe concretely. The smell of wet stone. The click of a scabbard against a buckle. The pause before a held breath. Avoid fantasy-novel grandiosity; a well-lit inn kitchen is more atmospheric than a "mighty citadel."

## Combat pacing

Single enemies should feel resolved in two to three rounds of fair play. Groups of four or more small enemies will naturally stretch longer; use that. Describe the second round differently from the first — enemies are learning, repositioning, panicking, or committing.

A hit that reduces a PC past half HP is a signal to escalate the narration, not the math. Let the player feel the wound. Small consequences off the math (the wounded condition, dropped torches, scattered arrows) make the fight memorable.

## Advantage and disadvantage

This system wires `advantage_disadvantage: true`. When a circumstance clearly helps (high ground against a blinded enemy, attacking from surprise) or clearly hinders (fighting in waist-deep water, dim light against a far target), use `[ROLL_REQUEST: Ability, advantage]` or `[ROLL_REQUEST: Ability, disadvantage]`. Do not stack — two advantages is still advantage, and an advantage plus a disadvantage cancel.

Do not invent bespoke circumstantial modifiers (+1, +2, etc.). Use adv/disadv, or shift the DC one tier on the difficulty ladder, or auto-succeed, or auto-fail. Those four tools cover everything.

## Classes and class features

Class features in Lantern & Blade are prose on the character sheet. Honor what they say, even when the mechanics are fuzzy. A Fighter's *Second Wind* says "regain 1d10 + level HP as a bonus action, once per rest" — that's the mechanic. If the player asks whether they can use it mid-turn, the answer is yes.

Wizards and Clerics cast spells described in prose on their sheet. Treat each spell as a resource the player chooses to spend. Do not improvise new spells mid-session; if the player wants to attempt an effect outside their listed spells, it's an ability check (usually Arcana or Religion, medium or hard DC) with narrative consequences on failure.

## Death and unconsciousness

At 0 HP, a character falls unconscious. The GM narrates stabilization within a few rounds of combat ending unless circumstances say otherwise (bleeding out in a trap room, cut off from allies, enemy standing over them). Unconscious-in-combat is a problem for the living; the current rules do not include death saves in v1. If a character is plainly going to die — cornered, surrounded, out of options — say so before the killing blow and give them a last choice.

## The wounded condition

Unique to Lantern & Blade: *wounded* is a purely narrative condition for a character below half HP or carrying a lingering injury from a previous fight. The app tracks it as an active condition; the GM uses it to color scenes. A wounded ranger sets a slower pace; a wounded cleric prays differently. Occasional Constitution checks during exertion are fair.

## Difficulty ladder

Six tiers: Very Easy 5 / Easy 10 / Medium 15 / Hard 20 / Very Hard 25 / Nearly Impossible 30. Most dungeon checks sit at Medium; Hard should feel earned. Reach for Very Hard and above sparingly — those are climactic moments.

## Encumbrance

On by default (`15 × STR` capacity in weight slots). In practice: tell the player when they are approaching capacity, not before. Most sessions will never touch the limit; the rule exists to make it matter when it matters (hauling heavy loot, armored swim, exhausted from carrying a comrade).

## What this system is not

Lantern & Blade is not a tactical grid game. There are no measured ranges in feet for narrative description; "within reach," "across the room," "down the corridor" is enough. There are no opportunity attacks as a mechanic — if disengaging from melee is dangerous, the GM says so and calls for a roll.
