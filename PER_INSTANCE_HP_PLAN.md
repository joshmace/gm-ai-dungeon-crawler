# Per-Instance Encounter HP — Phased Refactor Plan

**Drafted:** 2026-04-29 (Plan-agent pass)
**Decisions locked:** 2026-04-29 — all 7 design questions in §4 confirmed as recommended.
**Status:** ✅ COMPLETE — Phase 1 (PR #14, 2026-04-30), Phase 2 (PR #15, 2026-04-30), Phase 3 (PR pending, 2026-05-02 / 2026-05-03). Phase 3 expanded beyond the original cross-room teleport scope to address adjacent issues surfaced during smoke testing — see `CHANGELOG.md`.
**Companion docs:** `BACKLOG.md` (Polish & smoke-test items), `JSON_SCHEMAS.md` (per-instance HP at `instances[]`), `CHANGELOG.md` (Phase 1/2/3 narrative).

---

## Why we're doing this

Two related bugs surfaced in the Crow's Hollow Stage 3 smoke test, both rooted in the fact that a multi-monster encounter group currently renders + tracks as a single collapsed stat block:

1. **Single-block encounter rendering.** A group of 2 goblins renders as one "Goblin Scavengers" entry with shared HP. Defeating "the goblin" defeats both at once. The save envelope already ships a `gameState.module.encounters[id].instances[]` field per `JSON_SCHEMAS.md`, but the runtime never reads or writes it — it still uses the collapsed pre-v1 shape.

2. **Cross-room combat teleport.** When the GM emits `[COMBAT: on]` in a room with no active encounter, `ensureCombatRoomHasEncounters()` in `scripts/ui-encounters.js` falls back to the alphabetically-first room that has encounters. In Crow's Hollow that's the boss room — Ren attacked "the other goblin" after the goblin pair was defeated, and got teleported into the Warden's Crypt mid-fight. The fix here is **not** to find a different room — it's to surface an error callout and keep the player put. So `ensureCombatRoomHasEncounters` should be retired entirely.

Both are tracked in `BACKLOG.md` under "Polish & smoke-test items" → "Cross-room combat re-entry when extra attack issued after combat ends".

---

## 1. Current State

### How encounters are authored
Modules already author encounters as a list of monster groups via `enc.groups[]`, with each group declaring `{ monster_ref, quantity }`. `JSON_SCHEMAS.md:1247-1278` documents this and explicitly states "Each creature instance is tracked independently at runtime (HP bars per instance, not per group)" — i.e. the schema spec already promises what the runtime never delivered.

Real examples:
- `module_crows_hollow.json:271-291` — `goblin_scavengers`: `goblin_scout × 2` + `goblin_brute × 1` (the Stage-3 smoke-test bug).
- `module_crows_hollow.json:197-216` — `barracks_haunting`: `restless_spirit × 1` + `skeleton_warrior × 2`.
- `module_gauntlet.json:134` — `practice_skeleton × 3`.
- `module_village_three_knots.json:174,312,358` — all are `× 1` solos, so they survive the bug by accident.

### How encounters are stored at runtime today
`scripts/game-state.js:365-380` (`buildShimmedModule`) collapses every encounter to a legacy pre-v1 shape:

```js
const first = Array.isArray(enc.groups) && enc.groups.length ? enc.groups[0] : null;
const monsterRef = enc.monster_ref || (first && first.monster_ref) || null;
const shimEnc = { ...enc, monster_ref: monsterRef };
```

This silently drops every group after the first AND ignores `quantity`. Three goblins become one shim entry with `monster_ref: "goblin_scout"`, max HP = the bestiary HP for a single goblin scout.

HP tracking is a single integer per encounter id: `gameState.damageToEncounters[encounter.id]` (see `index.html:153-154`). `getEncounterHP(enc)` (`scripts/ui-encounters.js:105-112`) computes `current = max(0, monsterHp - damage[id])` and `defeated = current <= 0`. There is no notion of which creature took the hit.

### What the save envelope ships today vs. what the spec promises
`JSON_SCHEMAS.md:1579-1587` specifies:
```jsonc
"encounters": {
  "barracks_haunting": {
    "resolved": true,
    "instances": [
      { "monster_ref": "restless_spirit",  "instance_id": "rs_1", "current_hp": 0, "defeated": true },
      { "monster_ref": "skeleton_warrior", "instance_id": "sw_1", "current_hp": 0, "defeated": true }
    ]
  }
}
```

`scripts/game-state.js:460-476` (`buildEncountersForSave`) ships the spec field but stuffs it with `instances: []` and a non-spec `damage_dealt: <int>` companion. Comments at 453-459 admit this: "Per-instance HP tracking isn't modeled in runtime yet … `instances[]` stays empty until the per-instance rewrite lands." On load, `scripts/game-state.js:712-718` rehydrates `damageToEncounters[id]` from `damage_dealt`. So saves are round-trippable but blind to per-instance state.

### Where rendering and damage application diverge from the save shape
- **Rendering** (`scripts/ui-encounters.js:202-260`, `updateMonsterPanel`): one stat block per encounter id, one `HP X/Y` line. No mention of `groups[]` anywhere.
- **Damage application** (parser): `scripts/response-parser.js:233-295` (`parseMonsterDamage`) and `scripts/response-parser.js:384-400` (`[DAMAGE_TO_MONSTER:]` handler) both `damageToEncounters[enc.id] += damage` against the encounter id. There is no ambiguity to resolve because there's only one HP pool.
- **Damage from the dice flow** (`scripts/ui-dice.js:946-963`): always `getFirstActiveEncounterInCurrentRoom()` then `damageToEncounters[enc.id] += totalDamage`. First-encounter-wins; the third goblin can never take a hit.
- **Defeat detection** (parser + dice flow): `room.encounters.every(e => getEncounterHP(e).defeated)` flips combat off.
- **Cross-room teleport** (`scripts/ui-encounters.js:131-144`, `ensureCombatRoomHasEncounters`): when `[COMBAT: on]` fires in a room with no active encounter, this function rewrites `gameState.currentRoom` to the alphabetically-first room with active encounters. Called from `scripts/response-parser.js:553` (combat tag) and `scripts/response-parser.js:574` (combat-begins heuristic). This is the cross-room teleport bug.
- **Reward narration** (`scripts/ui-dice.js:980-1001`): keys off `enc.on_death` — built once by the shim from `enc.rewards` (`scripts/game-state.js:316-351`). Rewards fire when the encounter as a whole is defeated, not per kill.

---

## 2. Target State

### Data model
Each encounter gains an `instances[]` array of plain objects, generated at module-load time from `groups[]`:

```js
enc.instances = [
  { instance_id: "goblin_scout_1", monster_ref: "goblin_scout", max_hp: 7,  current_hp: 7,  defeated: false },
  { instance_id: "goblin_scout_2", monster_ref: "goblin_scout", max_hp: 7,  current_hp: 7,  defeated: false },
  { instance_id: "goblin_brute_1", monster_ref: "goblin_brute", max_hp: 14, current_hp: 14, defeated: false }
]
```

`instance_id` is deterministic (`<monster_ref>_<1-based ordinal within group>`) so saves round-trip. `max_hp` is sourced from the bestiary at expansion time (so per-instance HP rolls remain a v2 feature; for v1 every instance shares the bestiary average). `current_hp` is the live tracked value; `defeated` is its boolean rollup.

`damageToEncounters` is retired in favor of `current_hp` on each instance. Migration paths are spelled out in §3 / §4.

### What the GM sees in `ENCOUNTER_INFO`
The block grows from one line per encounter to one summary line plus an indented per-instance line:

```
Goblin Scavengers (id goblin_scavengers): AC varies. Status: ACTIVE — 2 of 3 instances remaining.
  - goblin_scout_1 (Goblin Scout, HP 7/7, AC 13)            attacks: shortbow +3 (1d6+1 piercing)
  - goblin_scout_2 (Goblin Scout, DEFEATED, 0/7)            — narrate death; do not let it act
  - goblin_brute_1 (Goblin Brute, HP 8/14, AC 13)           attacks: cleaver +5 (1d8+3 slashing)
On encounter defeat: 3d6 gp, silver_dagger; XP from bestiary (sum across instances).
```

The GM is told (in the system prompt) to address creatures by `instance_id` in `[DAMAGE_TO_MONSTER:]` and `[MONSTER_DEFEATED:]` tags, and to use the natural-language flavor name in narration ("the wounded scout", "the brute"). Dual-target tag syntax is added so the GM can target either way:

- `[DAMAGE_TO_MONSTER: goblin_scout_1, 5]` — preferred; uses `instance_id`.
- `[DAMAGE_TO_MONSTER: goblin_scavengers, 5]` — fallback; auto-distributes to the **lowest-`current_hp` non-defeated instance**, breaking ties by ordinal.

### What the player sees
The encounter panel shows one collapsible block per encounter, with a per-instance HP row inside:

```
Goblin Scavengers — Officer's Study
  Goblin Scout      [██████░░░░] 4/7
  Goblin Scout      [          ] 0/7  DEFEATED
  Goblin Brute      [█████░░░░░] 8/14
```

Encounter rollup status (Active / Defeated) sits in the header.

### Targeting & damage adjudication
Three scenarios:

1. **GM emits `[DAMAGE_TO_MONSTER: <instance_id>, N]`** — apply directly to that instance.
2. **GM emits `[DAMAGE_TO_MONSTER: <encounter_id>, N]`** (or matches by encounter name / monster name) — fall back to the **lowest-`current_hp` non-defeated instance** of any matching monster type, breaking ties by ordinal. This kills wounded enemies first, which is what GMs implicitly mean.
3. **Player damage from the dice flow** (`ui-dice.js`) — when the player declares "I attack the brute" the GM would normally name the target. Since the dice flow short-circuits the GM, we add a per-instance target picker: when there are ≥ 2 active instances, the dice section gains a small "Target" dropdown above the Roll Damage button, defaulting to the first active instance. (Phase 2 detail.)

### Defeat & rewards
- An instance is defeated when `current_hp <= 0`.
- An encounter is `resolved` when all instances are defeated.
- `applyReward` / on_defeat treasure still fires once per encounter, on the resolution edge — preserving v1 reward semantics. Per-instance loot is a v2 question (§4).
- `[MONSTER_DEFEATED: <instance_id>]` is now the precise tool. `[MONSTER_DEFEATED: <encounter_id>]` defeats every remaining instance (used when the GM hand-waves "the goblins flee" — same semantics as today).
- `[MONSTER_FLED:]` follows the same overload pattern.

### Cross-room combat
`ensureCombatRoomHasEncounters` is **deleted**. When `[COMBAT: on]` fires in a room with no active encounter, the parser emits a system-message error callout ("No active enemy in this room. Combat tag ignored.") and leaves `currentRoom` and `inCombat` alone. The GM-side guidance in `ai-gm-system-prompt.md:65-68` is already correct — this just enforces it.

---

## 3. Phased Implementation Plan

The dependency cut: **data structure + reads** must land before per-instance UI, which must land before retiring `ensureCombatRoomHasEncounters` (because the cross-room bug only stops being a bug once goblins-as-instances stop tripping the empty-room fallback). All three are independently shippable.

### Phase 1 — Data model rewrite + read paths (single merged HP bar visually)

Smallest end-to-end vertical slice. The encounter block on screen still shows one HP bar per encounter, but under the hood every read goes through `instances[]`. No GM-facing changes; tag contract unchanged. Saves migrate transparently.

**Files touched and what changes:**

- `scripts/game-state.js`
  - `buildShimmedModule` (lines 353-388): replace the legacy `monster_ref` collapse with `expandEncounterInstances(enc, gameData)`, which builds `enc.instances[]` from `enc.groups[]`. Keep the `monster_ref` field on the encounter set to the *first group's* monster_ref for any not-yet-migrated reader; mark for removal in Phase 2.
  - New helper `getEncounterMaxHP(enc)`: sum of `instances[].max_hp` (used by save / completion rollup).
  - New helper `getEncounterCurrentHP(enc)`: sum of `instances[].current_hp`.
  - New helper `applyDamageToEncounter(enc, amount, opts)`: encapsulates the targeting rule (`opts.instance_id` overrides; otherwise lowest-HP active instance, then ordinal). Returns `{ instance, killed, rollupResolved }`.
  - `buildEncountersForSave`: write real `instances[]` per spec (`monster_ref`, `instance_id`, `current_hp`, `defeated`). Drop the non-spec `damage_dealt` field (after a one-version overlap — see migration below).
  - `loadGame` (lines 712-718): rehydrate `instances[]` from save. If save is on the legacy shape (`damage_dealt` present, `instances[]` empty), fall back: distribute the recorded damage across instances starting from instance 0 until exhausted (the "all-or-nothing" approximation mirrors current behavior). Log a `SAVE_VERSION` migration line.
  - Remove `damageToEncounters` from `gameState` once all callers migrate; keep a getter shim during the transition that derives totals from instances.

- `scripts/ui-encounters.js`
  - `getEncounterHP(encounter)` rewrites to read from instances; same `{current, max, defeated}` return shape so callers don't change yet.
  - `getFirstActiveEncounterInCurrentRoom`, `getMonsterDamageFormulaForCurrentRoom`, `getMonsterAttackInfoForCurrentRoom`: now resolve to the **first active instance** for monster stats (so a defeated brute can't keep attacking once dead). The current code resolves against `enc.monster_ref` which always points at the first group; fix that.
  - `recordEncounterHistoryForRoom`: still keys per encounter id, but stash an `instancesSnapshot` array on each history entry so post-combat panels can show per-instance state.
  - `resolveEncounterRewards`, `getExpectedRewardsForCurrentRoom`: unchanged by Phase 1 (rewards remain per encounter).

- `scripts/response-parser.js`
  - `parseMonsterDamage` and `[DAMAGE_TO_MONSTER:]` handler: route through `applyDamageToEncounter(enc, n)` with no `instance_id`. Adjudication rule = lowest-HP active instance.
  - `[MONSTER_DEFEATED: x]` / `[MONSTER_FLED: x]`: try matching `x` as an `instance_id` first, then as an `encounter_id` (the latter defeats every active instance, matching today's behavior).
  - `findEncounterForStateTag`: extend to return `{ found_encounter, found_instance | null }`.

- `scripts/ui-dice.js`
  - The hot path at lines 946-963: replace direct `damageToEncounters[enc.id] += totalDamage` with `applyDamageToEncounter(enc, totalDamage)`. UI still shows encounter-rollup HP at this stage (one line, like today).
  - `pendingAttackResolution` carries an optional `instance_id` so the chained damage roll lands on the same target. Phase 1 leaves it null and uses the same targeting rule.

- `scripts/prompt-builder.js` and `scripts/ui-encounters.js → buildEncounterDescription`
  - `ENCOUNTER_INFO` block stays as-is for Phase 1 (shows aggregate `X/Y HP`). One internal change: aggregate HP is now a sum, not the value of a single shimmed monster — so the GM finally sees "Goblin Scavengers HP 28/28" instead of "HP 7/7" for a 3-goblin encounter. (This is a behavior change in the prompt and may surface mild GM narration drift; the smoke test should sanity-check.)

- `scripts/rules-engine.js`
  - **No changes.** `buildModuleState().encounters[id] = { defeated, resolved }` rollup remains the engine's only contract.

- `scripts/pack-loader.js`
  - **No changes.** Already validates `enc.groups[].monster_ref`.

- `index.html`
  - `gameState.damageToEncounters` initial value: keep but now it's vestigial (shim getter); plan to remove in Phase 2.
  - `test.defeatAllEncounters()` (lines 486-505): change from `damageToEncounters[id] = max` to "set every instance defeated".
  - New test helper: `test.defeatInstance(encounterId, instanceId)` — defeats one instance, useful for smoke-testing the multi-goblin path.
  - New test helper: `test.dumpEncounterInstances(encounterId)` — `console.table` of every instance.

**Test helpers needed:** `defeatInstance`, `dumpEncounterInstances` (above).

**Regression risks:**
- Save round-trip: existing saves on Crow's Hollow / Three Knots / Gauntlet must load cleanly. The migration block in `loadGame` covers this; needs explicit smoke test on a pre-Phase-1 Crow's Hollow save in localStorage.
- Reward fire-once: `defeatedEncForReward` in `ui-dice.js:962` triggers off a `hpBefore > 0 && hpInfo.defeated` edge. With instances, the edge must be "rollup just transitioned to defeated" — easy to get wrong such that rewards fire on the second-to-last kill or twice.
- `getFirstActiveEncounterInCurrentRoom` semantics: today it returns an `enc` whose `monster_ref` works; after the fix it returns one whose first active instance might be a different monster type than `enc.groups[0]`. Make sure the dice flow's monster lookup uses the active instance's ref, not `enc.monster_ref`.

**Smoke test:**
1. Load Crow's Hollow; teleport to Officer's Study (`test.teleportToRoom('officers_study')`).
2. Verify `test.dumpEncounterInstances('goblin_scavengers')` shows three rows.
3. Engage; deal 7 damage. Confirm exactly one scout is defeated (not the encounter).
4. Deal another 7. Confirm the second scout is defeated; combat continues.
5. Deal 14. Confirm the brute is defeated, the encounter resolves, rewards fire **once**, `[COMBAT: off]` is appropriate.
6. Save mid-fight, reload. Confirm partial state survives.
7. Run Three Knots through to dead king encounter; confirm × 1 encounters still behave identically to before.
8. Run Gauntlet's `practice_skeleton × 3` arena; same kill-count discipline.

### Phase 2 — Per-instance UI + GM-facing instance vocabulary

Now that the runtime is instance-aware, surface it.

**Files touched:**

- `scripts/ui-encounters.js`
  - `updateMonsterPanel`: render one row per instance under each encounter header. CSS class `monster-instance-row` with HP bar and `defeated` modifier. Encounter header collapses to a status pill (Active 2/3 / Defeated).
  - `buildEncounterDescription` (called from `prompt-builder.js`): emit the multi-line per-instance shape spelled out in §2. Include `instance_id` so the GM has a stable identifier.

- `scripts/prompt-builder.js`
  - `ENCOUNTER_INFO` header text gains one sentence: "Each enemy is a separate instance with its own HP. Use `[DAMAGE_TO_MONSTER: <instance_id>, N]` to target a specific creature; the app picks the wounded one if you target the encounter."

- `ai-gm-system-prompt.md`
  - Update the `[DAMAGE_TO_MONSTER:]` and `[MONSTER_DEFEATED:]` lines to allow either `<instance_id>` or `<encounter_id>` as the first argument, and prefer instance ids. A short example: "Use `[DAMAGE_TO_MONSTER: goblin_scout_2, 4]` after the second scout takes a hit."
  - Explicitly state that per-instance damage adjudication is the GM's job for free-form combat narration; the dice flow handles it for player-rolled attacks.

- `scripts/response-parser.js`
  - `findEncounterForStateTag`: instance_id matching becomes first-class. Already drafted in Phase 1; this phase just ensures the GM is now using it.

- `scripts/ui-dice.js`
  - When `getFirstActiveEncounterInCurrentRoom()` returns an encounter with ≥ 2 active instances, the damage Roll button is preceded by a small "Target: [Goblin Scout 1 ▾]" picker. Default = lowest-HP active instance (matches GM-side adjudication). Stash the chosen `instance_id` on `pendingAttackResolution`.

- `styles/main.css`
  - Add `.monster-instance-row`, `.monster-instance-bar`, `.monster-instance-row.defeated`, etc. Mirror the existing `.monster-stat-block` palette.

- `scripts/game-state.js`
  - Drop `damageToEncounters` for real; remove the shim getter from Phase 1. Anything still referencing it surfaces immediately.

- `index.html`
  - `gameState.damageToEncounters` field deletion. The gauntlet `defeatAllEncounters` helper updated to set per-instance defeat.

**Test helpers needed:**
- `test.damageInstance(encounterId, instanceId, amount)` — apply N damage to one instance.
- Extend `test.dumpSave()` to print the new `instances[]` shape verbatim.

**Regression risks:**
- Prompt size: the per-instance block is roughly +60 chars per instance. A 3-goblin encounter adds ~180 chars. The system prompt is already in the RED zone (BACKLOG entry: "System prompt back in RED zone"). Worth measuring with `test.promptSizeReport()` — if it tips us further, the encounter-info block becomes a candidate for the deferred trim pass.
- GM behavior drift on `[DAMAGE_TO_MONSTER:]`: GMs may revert to encounter-id targeting out of habit, breaking the "specific instance" promise. The fallback rule (lowest-HP) is the safety net.
- Target picker UX: if the GM narrates "the brute swings at you" but the player has the picker on "Goblin Scout 1", it's mildly confusing. The picker default = lowest-HP active mitigates this; explicit GM target identification in narration helps.

**Smoke test:**
1. Crow's Hollow goblin fight: confirm three HP bars in panel; confirm the picker defaults reasonably.
2. Player attacks specific instance via picker; verify damage lands on that instance only.
3. Force a multi-instance state via `test.damageInstance`, save, reload, confirm UI matches.
4. GM-driven `[DAMAGE_TO_MONSTER: goblin_scout_2, 5]` from a hand-typed reply: confirm targeting.
5. Re-run prompt size report; log the delta.

### Phase 3 — Retire `ensureCombatRoomHasEncounters`

**Files touched:**

- `scripts/ui-encounters.js`
  - Delete `ensureCombatRoomHasEncounters` (lines 131-144) and `getFirstRoomIdWithEncounters` (lines 114-129) if it has no other caller.
  - Remove from `UI.encounters` exports and from the legacy global block (lines 379-380).

- `scripts/response-parser.js`
  - `tryParseCombatTag` (line 553) and `tryParseCombatBegins` (line 574): remove the `ensureCombatRoomHasEncounters()` calls.
  - Inside `tryParseCombatTag`'s `[COMBAT: on]` branch, after setting state, check whether `currentRoom` has any active instance. If not, emit `addMechanicsCallout('No active enemy in this room. The GM tried to start combat but the app cannot find one — staying in exploration mode.')`, **revert** `inCombat = false`, leave `currentRoom` and `mode` alone. Log a `PARSE` debug line.
  - `tryParseCombatBegins`: same guard. The narrative-fallback branch is exactly where Stage-3 went off the rails.

- `ai-gm-system-prompt.md`
  - The `## COMBAT STATE — YOU CONTROL IT` block already says "NEVER emit `[COMBAT: on]` for … any room with no active enemy." One small addition: "If the app reports 'no active enemy in this room', narrate the player's missed swing and stay in exploration. Do not retry `[COMBAT: on]`."

- `index.html` / `scripts/main.js`
  - Search for any direct `ensureCombatRoomHasEncounters` reference. Per the grep above there are exactly two (parser line 553, 574); confirm in this phase.

**Test helpers needed:**
- `test.simulateCombatTag(state)` — feed `[COMBAT: on]` through the parser without an LLM round-trip. Already covered by feeding raw text into `parseStateChanges`; document the pattern in a comment.

**Regression risks:**
- A pack with a real "ambush across a corridor" mechanic might rely on the cross-room jump. Search the three packs and confirm none do (they don't — the only multi-room module flow is door-based and Stage-3 already covers `[ROOM:]`).
- The error callout could be noisy if a GM misuses `[COMBAT: on]` repeatedly. Log to debug trail; don't promote to a system message unless it fires twice.

**Smoke test:**
1. Re-create the original Stage-3 bug scenario: defeat the goblins in Officer's Study, then send "I swing at the other goblin." Expected: GM emits `[COMBAT: on]`, parser surfaces the error callout, room remains `officers_study`, no teleport to Warden's Crypt.
2. Normal combat path in Crow's Hollow study works unchanged (combat tag fires WITH active encounter, state flips on as expected).
3. `test.defeatAllEncounters()` followed by a manual `[COMBAT: on]` injection should also fail-safe.

---

## 4. Open Design Questions (need confirmation before code starts)

| # | Question | Recommendation | Status |
|---|---|---|---|
| 1 | Instance ID scheme | `<monster_ref>_<n>` (e.g. `goblin_scout_2`) — readable; revisit only if cross-group monster_ref collisions appear | Confirmed (2026-04-29) |
| 2 | How GM disambiguates in narration | Let GM coin names freely ("the wounded scout"). Don't author per-instance flavor names. | Confirmed (2026-04-29) |
| 3 | Per-instance HP rolls | Fixed bestiary HP for v1. Per-instance HP variance is v2; flag `instance.max_hp_method = 'fixed'`. | Confirmed (2026-04-29) |
| 4 | Per-instance treasure split | Defer. Encounter-level treasure stays the v1 contract. Document the v2 extension in `JSON_SCHEMAS.md`. | Confirmed (2026-04-29) |
| 5 | Save migration for in-progress saves | Distribute existing `damage_dealt` to instance 0 first, etc. — preserves "the player did some damage already." Log a `SAVE_VERSION` debug entry. | Confirmed (2026-04-29) |
| 6 | `[MONSTER_DEFEATED: encounter_id]` semantics | Keep current — defeats every remaining instance at once. Push GMs toward instance-id form via prompt. | Confirmed (2026-04-29) |
| 7 | Auto-target picker from GM's last narration | Defer. Default-to-lowest-HP-active is good enough for v1. | Confirmed (2026-04-29) |

---

## 5. Architectural Tradeoffs

### Targeting: index-based vs. name-based vs. hybrid

**Considered alternative: pure name-based targeting.** GM emits `[DAMAGE_TO_MONSTER: "the wounded goblin", 5]`; runtime fuzzy-matches against active instances. Wins: GM speaks in the prose vocabulary it's already comfortable with; no new vocabulary to teach the model. Loses: brittle (GM coins names freely; "the brute" vs. "the bruiser" vs. "the goblin with the cleaver" all mean the same thing), and the matching layer has to be either heuristic (fragile) or lossless-with-a-bestiary (fragile in a different way).

**Considered alternative: pure instance-id targeting.** GM must always say `[DAMAGE_TO_MONSTER: goblin_scout_2, 5]`. Wins: deterministic, auditable, easy to test. Loses: the GM must track instance state in its head (which is wounded? which is the brute?). Without per-turn state injected back into the prompt, the model will confuse instances.

**Recommendation: hybrid (the spec above).** Instance-id is the precise tool (preferred); encounter-id is the safety net with a "lowest-HP active instance of any matching monster type" fallback. The `ENCOUNTER_INFO` block injects the current per-instance state every turn so the GM has the truth in hand. The fallback rule means the GM's existing `[DAMAGE_TO_MONSTER: goblin_scavengers, 5]` habit Just Works (kills wounded enemies first), and the new instance-id form gives full precision when the GM wants it.

This wins because:
- Backward compatible with the existing prompt vocabulary (encounter-id form).
- Offers a precise opt-in (instance-id form) without forcing the GM to use it correctly every turn.
- The "lowest-HP active" rule matches what GMs implicitly mean ("the wounded one") without making us parse prose.
- Index numbers (`goblin_scout_2`) are stable across saves; flavor names ("the wounded one") aren't.

### Other tradeoffs worth noting

- **Drop `damageToEncounters` vs. shim it forever.** The cost of keeping it is one extra layer of indirection on every read; the cost of dropping it is a careful Phase 2. Recommendation: drop in Phase 2. Cleanliness compounds.
- **One panel block per encounter (collapsing instances) vs. one panel block per instance.** The encounter block is the authoring + reward unit; collapsing keeps the right-hand panel readable on encounters with 5+ creatures. Recommendation: per-encounter block with per-instance rows inside.
- **`ensureCombatRoomHasEncounters` rewrite vs. delete.** Could rewrite it to "find the most-recently-active room" instead of alphabetically-first. But the underlying assumption — that the GM is right and the runtime should chase — is what makes it dangerous. Recommendation: delete and surface the error.
