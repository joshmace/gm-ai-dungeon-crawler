# Combat Flow — Mandatory During Encounter

When the current room has an **active encounter** (at least one non-defeated monster), the app injects a **COMBAT FLOW — MANDATORY** block into the GM prompt. This enforces a rigid, step-by-step order so combat stays consistent with the mechanics callouts.

**Where it’s implemented:** `index.html`, in `buildSystemPrompt()`. Search for `combatFlowBlock` and `lastUserRollType`.

**Flow (aligned with COMBAT_NARRATIVE_FORMAT.md):**

1. **Player action** — Player declares what they do (e.g. "I attack the goblin"). GM responds with flavor only and `[ROLL_REQUEST: Attack]`. Nothing else. Wait for the roll.

2. **After attack roll** — Player just submitted their attack roll. GM responds with flavor only. If roll >= monster AC: include `[ROLL_REQUEST: Damage]`. If roll < AC: flavor only (narrate the miss). Nothing else. Wait for the roll or for player's next action.

3. **After damage roll** — Player just submitted their damage roll. GM responds with flavor only (the blow's effect). If the monster is defeated (damage >= its remaining HP), narrate its death in flavor; do not narrate XP or gold. Then: if any enemy is still alive, their turn begins (step 4). If all are defeated, include `[COMBAT: off]` and end.

4. **Monster turn** — GM responds with flavor only (the monster attacks). If it hits: include `[MONSTER_DAMAGE]` in the sentence. If it misses: say so in flavor. End with "Your turn — what do you do?" Then wait for the player's next action (step 1).

**Current step:** The app sets `gameState.lastUserRollType` to `'attack'`, `'damage'`, or `'ability'` when the user submits a roll, and clears it to `null` when the user sends free text. The injected block includes a **CURRENT STEP** line that tells the GM exactly which step to perform (and only that step).

**To change the flow:** Edit the `steps` and `currentStep` strings inside `buildSystemPrompt()` in `index.html` (search for `combatFlowBlock`). You can refine the wording here in this file as a spec, then copy into the code.
