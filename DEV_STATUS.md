# Development Status

Snapshot of the project's technical state as of **2026-04-24**, intended as a handoff to a planning session. Captures what's built, what's stable, what's rough, and where the docs live. Updates expected — keep this file current at major inflection points (post-refactor, post-feature-launch, etc.).

This is a **dev-perspective** doc. Brand, product strategy, business model, and UX direction live elsewhere (see "What's NOT in this doc" at the bottom).

---

## Where we are

The v1 refactor is complete (Stages 1–7, March–April 2026). The MVP is functional end-to-end across three Game Packs: **The Haunting of Three Knots** (B/X-flavored, roll-under), **Crow's Hollow** (5e-flavored, Ren Callory), and the **Gauntlet** test hub (Aldric, exhaustive rules-coverage chambers).

The rules engine in JS owns all d20 math (attack/damage/check/save resolution, advantage, crits, hazard adjudication, feature prerequisites, effect dispatch, completion conditions, consumable dispatch). The GM prompt narrates flavor and tag-emits state changes; it never invents numbers.

Streaming responses ship: words flow in as the model generates them, control tags hide while incomplete, no re-render flash on completion.

## Architecture

```
playable-dungeon-crawler-v2.html      thin shell — bootstrap, CONFIG, gameState init, TestUtils
ai-gm-system-prompt.md                GM template, {{PLACEHOLDER}} interpolation at request time
server.js                             ~160-line Node http server + Anthropic /v1/messages proxy
templates/                            HTML panel templates loaded at runtime
styles/main.css                       all CSS

scripts/
  pack-loader.js                      manifest + 6 archetype loader + validator
  rules-engine.js                     pure math/logic; ~1700 lines
  game-state.js                       runtime state + save/load + legacy shim
  prompt-builder.js                   composes RULESET / SETTING / LAYOUT / GUIDANCE blocks
  response-parser.js                  control-tag parser + state mutations
  llm-proxy.js                        fetch wrapper around /api/messages, SSE reader
  main.js                             bootstrap: templates, pack load, state init, UI wiring
  ui-character.js                     character panel (abilities, saves, equipment, conditions)
  ui-narrative.js                     scrolling log, streaming, death + completion overlays
  ui-encounters.js                    active encounters panel, monster HP tracking
  ui-features.js                      feature cards (lore / searchable / interactive / puzzle)
  ui-hazards.js                       hazard dispatcher (detect / avoid / damage / conditions)
  ui-connections.js                   exit-button strip
  ui-dice.js                          dice section, attack / check / hazard / feature dispatch

game_pack_*.json                      manifests
setting_*.json   rules_*.json   bestiary_*.json   items_*.json   module_*.json   character_*.json
*_guidance.md   *_lore.md             optional sidecars referenced from manifest/module/rules/character

json-validator.html                   dev tool for validating game-data JSON
```

**No build step. No framework. No TypeScript.** Each `scripts/*.js` is a plain `<script src>` attaching to a `window.<Namespace>`. Boot order matters; current order in the HTML is dependency-correct.

## Stable contracts (don't break without thinking)

- **v1 game-pack schema** — `JSON_SCHEMAS.md`. Six archetype files, optional sidecar `.md` guidance, validation on load. Adding a new pack = follow the schema, drop in files, point `CONFIG.GAME_PACK` at the manifest.
- **Save envelope** — `schema_version: 1`, top-level `game_pack_id` + `module_id`, `module{}` / `combat{}` / `completion{}` / `character_mutations{}` / `runtime{}` blocks. Per-pack localStorage slots (`gm-ai-dungeon-save:<game_pack_id>`). Schema gate on load drops pre-v1 saves with a one-time system message.
- **Control-tag vocabulary** — `[ROLL_REQUEST: ...]`, `[COMBAT: on|off]`, `[MONSTER_ATTACK]`, `[MONSTER_DEFEATED: id]`, `[MONSTER_FLED: id]`, `[DAMAGE_TO_PLAYER: N]`, `[HEAL_PLAYER: N]`, `[CONDITION: add|remove id]`, `[RESOURCE_USE: pool_id]`, `[MODE: travel|exploration]`, `[ROOM: room_id]`, `[FEATURE_SOLVED: feature_id]`. Every tag is parsed by `response-parser.js` and stripped from displayed text. Adding a new tag is a 4-touch change: prompt + parser + UI + tests.
- **Rules-engine pure-function shape** — `RulesEngine.foo(inputs) → outputs`. No side effects. State mutations live in `game-state.js` and per-panel UI modules.
- **Per-pack save isolation** — switching `CONFIG.GAME_PACK` doesn't stomp other packs' saves.
- **Streaming + tag-buffering invariant** — `[` characters never visibly leak into the narrative panel during a stream. `streamSafeText()` enforces this.

## Capabilities — what works today

| Domain | Status | Notes |
|---|---|---|
| Three game packs | ✅ stable | Three Knots, Crow's Hollow, Gauntlet — all v1 schema |
| Rules engine — d20 math | ✅ stable | attack, damage, checks, saves (per-ability + categorical), adv/disadv, crit, hazard math |
| Damage types + resistance/immunity/vulnerability | ✅ stable | enforced for both player and monster damage |
| Feature cards (4 sub-types) | ✅ stable | lore, searchable, interactive, puzzle |
| Hazard dispatcher | ✅ stable | detect-then-avoid, pure-avoidance, automatic, interaction-gated |
| Equip/unequip + slot logic | ✅ stable | including two_handed conflicts |
| Consumables (3 on_use kinds) | ✅ stable | heal_player, cure_condition, gm_adjudicate |
| Save / load | ✅ stable | v1 envelope, per-pack slots, schema gate |
| Completion condition | ✅ stable | defeat_encounter, reach_room, all_encounters_defeated, null (GM-judged) |
| Death overlay | ✅ stable | gated on rules `at_zero` (Three Knots: dead immediately, others: unconscious) |
| Streaming responses | ✅ stable | smooth word arrival, no tag flashes, no completion re-render flash |
| Feature-card collapse UX | 🚧 stopgap | default-collapsed; full UX redesign deferred |
| `[REWARD:]` tag for prose rewards | ❌ not built | NPC card-game gold doesn't apply to inventory; logged in POLISH_BACKLOG |
| Per-instance encounter HP | ⚠️ partial | save envelope ships `encounters[id].instances: []` per spec; runtime tracks per-group damage only |
| Bonus-damage player roll | 🚧 auto-rolled | Oathblade `1d4 radiant` rider auto-rolls; physical roll deferred to polish pass |
| Drop / give / transfer items | ❌ not built | v2 feature; pack panel only has Use/Equip/Unequip |
| Image generation | ❌ not built | placeholder hooks exist in scene-directive parser |
| Character creation flow | ❌ not built | Tier 3 from BACKLOG; only pre-built characters today |
| Multi-character / party | ❌ not built | single-character, single-user |
| Mobile responsive | ❌ not built | desktop-first CSS Grid layout |

## Active branches / open PRs

- **`main`** at `1fbde84` — refactor-complete + post-refactor polish (trim, card collapse, streaming) all merged.
- **`claude/polish-backlog-streaming-cleanup`** (PR #7 open, doc-only) — logs the three post-Stage-7 follow-ups in POLISH_BACKLOG. Safe to merge anytime.
- **`claude/dev-state-handoff`** (this branch) — adds this `DEV_STATUS.md` file.

No other branches in flight.

## Known issues / technical debt

Active rough edges, ordered by likelihood of biting in real play:

1. **System prompt at ~19.6k chars (RED zone, 16k+ threshold).** Post-trim improvement from 21.3k. Real GM behavior risk: instruction drift (forgets tag contract, exceeds 150-word cap, mixes combat sequencing). Stage 4 hit drift symptoms at 23k. Comfortable target for an instructional-heavy prompt is ~12–15k. Next levers: trim RULESET conditions list (dynamic block), trim LAYOUT_BLOCK per-room verbosity (dynamic block), or another template pass. Held-back template trim from PR #4 has ~400–500 chars more available in HAZARDS / FEATURES / WHO ROLLS verbose intros — left untouched to keep risk surface small.
2. **Pre-existing `[MONSTER] WARNING: Monster undefined not found in manual` noise** — three warnings on Three Knots boot + every state change. Surfaces in session reports; not breaking, just clutter. Likely a missing `monster_ref` on a Three Knots encounter that the encounter-panel resolver tries to look up.
3. **Per-instance encounter HP** — runtime damage tracking is per-group (single `damageToEncounters[id]` per encounter row). Multi-instance authored encounters (e.g. three goblins in one group) are tracked as one HP pool. Save envelope ships `instances: []` empty until the runtime rewrite lands. **Symptom:** the cross-room combat re-entry bug (POLISH_BACKLOG item) — defeating one of two goblins in a study marks the encounter resolved; attacking "the other goblin" triggers `ensureCombatRoomHasEncounters` which jumps to the boss's room.
4. **Streaming chunkiness** — words sometimes arrive several at a time rather than truly one-by-one. POLISH_BACKLOG flags this as possibly the SSE chunk size or the `updateStreamingNarration` debounce. Largely cosmetic post-fix; the bigger flashes are gone.
5. **Card UI is a stopgap.** Default-collapsed buys narrative panel space but the long-term answer is probably a chip strip or sidebar drawer. Logged in `POLISH_BACKLOG` as future redesign.
6. **No `[REWARD:]` tag family.** Prose rewards from NPC card games / social encounters / non-encounter interactions don't apply to inventory. GM narrates "you win 5 gold coins"; the gold doesn't increment.
7. **Bonus-damage feel gap** — Oathblade's `1d4 radiant` rider is auto-rolled while the weapon die is a click. Half the dice for a swing get the player's roll, half don't.
8. **XP bar label cryptic** — "0 / 1,800" reads as "you earned 0 XP" without context; band-relative meaning takes a moment to parse.

Full list with reproduction details: `POLISH_BACKLOG.md`.

## Test infrastructure

**Console helpers** (all on `window.test`):

- State: `dumpSave`, `dumpSavedBlob`, `forceSave`, `corruptSave`, `logState`, `clearHistory`
- Character: `modifyHP`, `fullHeal`, `addXP`, `addPotion`, `addGold`, `addCondition`, `removeCondition`, `killCharacter`
- Module: `teleportToRoom`, `activateFeature`, `unlockConnection`, `revealConnection`, `solveFeature`, `defeatAllEncounters`, `defeatEncounter`
- Completion: `fireCompletion`, `checkCompletion`
- Rolls: `rollRequest` (force `[ROLL_REQUEST:]` flow with arbitrary label, e.g. `'Athletics, advantage'`)
- Prompt diagnostics: `promptSizeReport` (full prompt + per-block breakdown + zone)

**Debug trail** — ring-buffered, 40 most recent events, populated regardless of `DEBUG_MODE`. Categories: `INIT`, `DATA`, `STATE`, `PARSE`, `HAZARD`, `CHECK`, `PROMPT`, `FEATURE`, `CONNECTION`, `EFFECT`, `CONSUMABLE`, `EQUIP`, `SAVE`, `SAVE_VERSION`, `COMPLETION`, `AI`, `HISTORY`, `MONSTER`. Visible via the **Copy session report** button (top-right narrative header) which dumps state + trail + narrative to clipboard.

**Smoke-test gates that have proven valuable** (each catches a different regression class):

- Gauntlet null-completion: clearing all nine chambers leaves `completion.completed === false`.
- Three Knots roll-under: `[ROLL_REQUEST: Ability]` resolves on a single d20 ≤ target; no adv/disadv suffix.
- Three Knots `at_zero: "dead"`: 0 HP fires red death overlay immediately.
- Crow's Hollow `defeat_encounter` completion: Havel's defeat fires gold completion overlay.
- Per-pack save isolation: switching packs and back doesn't stomp.
- Stale-save drop: `test.corruptSave()` + reload shows the system message and starts a fresh game.

**No automated test suite.** Smoke-testing is manual via the test helpers + session-report paste-back. Automated QA is on the roadmap but not started.

## Recent landings (this session, 2026-04-24)

| PR | Title | What it shipped |
|---|---|---|
| #3 | v1 refactor Stages 5–7 | rules engine completes, save state on v1 envelope, completion-condition pipeline, pre-v1 files retired |
| #4 | Prompt trim | template trimmed from 13.2k → 11.4k; full prompt 21.3k → 19.6k; `test.promptSizeReport` ships |
| #5 | Feature cards default-collapsed | narrative panel breathes; click-to-expand description |
| #6 | Streaming polish | tag buffering for unclosed brackets; re-render-flash fix; death-overlay cleanup |
| #7 | POLISH_BACKLOG cleanup | (open, doc-only) logs the three post-Stage-7 follow-ups |

## Where the docs live

| File | What it covers |
|---|---|
| `CLAUDE.md` | project conventions, file structure, AI-GM rules |
| `JSON_SCHEMAS.md` | v1 schema reference for all six archetype files + save state |
| `GAME_PACK.md` | manifest fields, archetype roles, available packs |
| `JSON_DATA_AND_SWAPPING.md` | how packs load, source-of-truth contract, swap workflow |
| `REFACTOR_V1_PLAN.md` | the 7-stage refactor plan + design decisions |
| `BACKLOG.md` | feature roadmap + status (Phases 1–4) |
| `POLISH_BACKLOG.md` | open polish items + per-stage Landed sections (history) |
| `~/mace-and-marrow/PRODUCT_BRIEF.md` | product vision (canonical, in Drive — read for product-strategy context) |
| `CONFIG.md` | system-level config (AI model, env vars) |
| `CREDITS_AND_USAGE.md` | API cost levers + token budget guidance |
| `~/mace-and-marrow/RULES_SCHEMA_PLAN.md` | v1 schema design rationale (the *why* behind `JSON_SCHEMAS.md`); canonical schema tiebreaker — lives in Drive alongside `PRODUCT_BRIEF.md` |

Pre-v1 planning docs (`RULES_TESTING.md`, `GM_RULES_REWRITE.md`, `SESSION_3_CHANGELOG.md`) were archived to `~/mace-and-marrow/sessions/_archive/` on 2026-04-27 — read there for historical context. The 2026-04-27 planning handoff doc was migrated to `~/mace-and-marrow/sessions/2026-04-27-planning-handoff.md`.

## Test packs (for development) — quick reference

To switch packs without editing the HTML:

```js
CONFIG.GAME_PACK = './game_pack.json'                // Gauntlet (Aldric, test hub)
CONFIG.GAME_PACK = './game_pack_lantern_and_blade.json'   // Crow's Hollow (Ren)
CONFIG.GAME_PACK = './game_pack_village_three_knots.json' // Three Knots (Valen, default)
location.reload()
```

## What's NOT in this doc

This is dev-state-only. The following aren't covered and live elsewhere (or are decisions still to be made):

- **Brand / identity** — the Threshold rebrand call.
- **Product strategy** — pricing, marketplace, subscription model.
- **UI/UX direction** — preserve patterns vs. fresh take; card redesign shape.
- **Content strategy** — who authors packs (only owner / invited authors / open).
- **Marketing / diary / public-facing materials.**
- **Roadmap timing** — what ships when, in what order. (`BACKLOG.md` lists features but not committed dates.)

These are planning-session topics, not state-of-dev topics.
