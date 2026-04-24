# AI Dungeon Crawler

## What This Is
An AI-powered solo tabletop RPG where Claude acts as the Game Master. Players interact through a web interface while the AI narrates, adjudicates OSR-style rules, and manages combat. Built as an MVP with plans to expand into group play, configurable rulesets, and a module authoring platform.

## Architecture

### Frontend — `playable-dungeon-crawler-v2.html`
Single-page application. Vanilla JS, CSS, and HTML — no build step, no framework. Panel templates live in `./templates/`, CSS in `./styles/main.css`, and the extracted modules (pack loader, rules engine, game-state, prompt builder, response parser, per-panel UI) live under `./scripts/` — each attaches to a `window.<Namespace>` and loads via `<script src>` in dependency order. Only the boot shim (templates, `CONFIG`, `gameState` construction, `TestUtils`) stays inline in the HTML.

- **Character Panel** (left sidebar): stats, abilities, inventory, HP/AC/XP, conditions
- **Narrative Panel** (center): scrolling game log with GM narration, player actions, system messages, image placeholders
- **Encounter Panel** (right): active and historical encounters with live HP
- **Input Area** (bottom): text input for player actions, dynamic dice rolling UI triggered by `[ROLL_REQUEST: Ability]` tags in the GM response

The AI-GM system prompt is loaded from `ai-gm-system-prompt.md` at startup and composed at request time by `buildSystemPrompt()` (which interpolates game state into the template).

### Backend — `server.js`
Minimal Node.js server (~160 lines). Serves static files AND proxies API calls to Anthropic (to avoid CORS and keep the API key server-side).

- Port: `PORT` env var or `8000`
- API key: `ANTHROPIC_API_KEY` env var (via `.env`, `dotenv`)
- Model: `AI_MODEL` env var, default `claude-sonnet-4-5`
- Endpoints:
  - `GET /api/config` — returns model name for client display
  - `POST /api/messages` — proxies to Anthropic Messages API
  - `GET /*` — serves static files; `/` maps to `playable-dungeon-crawler-v2.html`

### Game Pack Format
A "Game Pack" is a manifest JSON (e.g. `game_pack_village_three_knots.json`) that bundles six archetype files for one playable experience (v1 schema; see `JSON_SCHEMAS.md`):
- `setting` — world/lore (`setting_*.json`) + optional sidecar `.md` lore
- `rules` — mechanics, DCs, conditions, XP progression (`rules_*.json`) + optional sidecar `.md` guidance
- `bestiary` — monster stats (`bestiary_*.json`)
- `items` — shared items library (`items_*.json`)
- `adventure_module` — rooms, encounters, features (`module_*.json`) + optional sidecar `.md` guidance
- `character` — starting character sheet (`character_*.json`) + optional sidecar `.md` guidance

Switch packs by changing `CONFIG.GAME_PACK` in the HTML. Saves are per-pack (`localStorage` key `gm-ai-dungeon-save:<game_pack_id>`), so switching packs won't overwrite the other packs' progress.

Current packs:
- **The Haunting of Three Knots** — `game_pack_village_three_knots.json` (active)
- **Crow's Hollow** — `game_pack_lantern_and_blade.json` (uses Ren Callory + `module_crows_hollow.json`)
- **Rules System Test (Gauntlet)** — `game_pack.json` (test hub; uses Aldric + `module_gauntlet.json`)

### GM System Prompt — `ai-gm-system-prompt.md`
The source of truth for GM behavior. Loaded at runtime by the frontend and filled in with current game state.

## Tech Stack
- **Frontend:** Vanilla HTML/CSS/JS (no React, no build tools)
- **Backend:** Node.js (no Express — raw `http` module)
- **API:** Anthropic Messages API (default model `claude-sonnet-4-5`)
- **Persistence:** localStorage (one save slot per Game Pack, keyed by `game_pack_id`; v1 envelope with `schema_version: 1`)
- **Data:** JSON for game packs, modules, rules, characters

## Key Conventions

### Code Style
- This project uses simple, readable code over clever abstractions. The developer is a designer, not a software engineer.
- Prefer inline comments explaining *why*, not *what*.
- No TypeScript. No bundlers. No package managers beyond npm for the proxy server.
- Keep the main HTML file cohesive; extract to `./templates/` or `./styles/` only when the section is self-contained.

### AI-GM Rules (important context for any prompt/logic changes)
- Responses: 50–100 words, 150 max
- Combat is strictly sequenced: player declares → rolls attack → hit/miss announced → rolls damage → damage narrated → enemy turn. Never combine steps.
- Player acts first unless ambushed (no initiative rolls)
- Auto-success for simple actions, auto-fail for impossible ones, rolls for risky actions
- Standard DCs come from the pack's `rules_*.json` → `difficulty.scale[]` (Easy 10, Medium 15, Hard 20 by default for the 5e-flavored packs; Three Knots uses roll-under-score so targets live on the character/save instead)
- Never reveal NPC motivations without Insight/Perception checks
- HTML formatting in responses: `<b>`, `<i>` only (no raw asterisks)
- Roll requests use the format: `[ROLL_REQUEST: Ability]`; monster attacks use `[MONSTER_ATTACK]`; combat state toggles with `[COMBAT: on]` / `[COMBAT: off]`

### File Structure
```
project/
├── CLAUDE.md                               # This file
├── playable-dungeon-crawler-v2.html        # Main game interface (thin shell; inline bootstrap + TestUtils)
├── server.js                               # Static server + Anthropic proxy
├── ai-gm-system-prompt.md                  # GM system prompt (loaded at runtime)
├── styles/main.css                         # All styling
├── templates/                              # HTML panel templates
├── scripts/
│   ├── pack-loader.js                      # Manifest + 6 archetype loader + validator
│   ├── rules-engine.js                     # Pure math/logic: attack, damage, checks, saves, hazards, features, effects, completion
│   ├── game-state.js                       # Runtime state + save/load (v1 envelope) + shim for legacy renderers
│   ├── prompt-builder.js                   # buildSystemPrompt() — composes SETTING/RULESET/LAYOUT/GUIDANCE blocks
│   ├── response-parser.js                  # Control-tag parser ([ROLL_REQUEST], [COMBAT], [CONDITION], [ROOM], etc.)
│   ├── llm-proxy.js                        # fetch wrapper around /api/messages, SSE stream reader
│   ├── main.js                             # Bootstrap: template loading, pack load, state init, UI wiring
│   └── ui-*.js                             # Per-panel renderers: character, narrative, encounters, features, hazards, connections, dice
├── game_pack_*.json                        # Game Pack manifests (v1)
├── setting_*.json                          # Setting archetype (world/lore)
├── rules_*.json                            # Rules archetype (mechanics, DCs, conditions, XP)
├── bestiary_*.json                         # Bestiary archetype (monster stats)
├── items_*.json                            # Items archetype (shared library — weapons, armor, consumables, magic)
├── module_*.json                           # Adventure module archetype (rooms, encounters, features, hazards)
├── character_*.json                        # Character archetype (starting sheet)
├── *_guidance.md, *_lore.md                # Optional sidecars referenced from manifest/module/rules/character
└── json-validator.html                     # Dev tool for validating game data JSON
```

## Current Status & Known Issues
- v1 refactor complete (Stages 1–7, 2026-04). Rules engine in JS, character panel renders natively from v1 data, module runtime state (features/connections/visited rooms) rides with the save, items pipeline + consumable dispatch work, save-state follows the v1 envelope, completion-condition fires the end-of-module summary.
- MVP is functional: narrative, dice rolling, combat sequencing, inventory, conditions, XP/leveling, hazards, feature cards, connections as exit buttons, equip/unequip, consumable use, save/load all work.
- Streaming responses land as a follow-up (SSE wiring is already in `scripts/llm-proxy.js`).
- Image placeholders exist but no actual image generation.
- See `POLISH_BACKLOG.md` for open UX items (prompt size yellow/red, XP bar label, drop/transfer items, etc.).

## Planned Features (in rough priority order)
1. Streaming API responses (SSE hookup in `scripts/llm-proxy.js` is ready)
2. Character creation flow
3. Module authoring tools / additional modules
4. Group/multiplayer support
5. Image generation integration for scenes
6. Mobile-responsive layout improvements

## How to Run
1. Put your Anthropic API key in `.env` as `ANTHROPIC_API_KEY=sk-ant-...`
2. `npm install` then `node server.js` (starts server on port 8000)
3. Open `http://localhost:8000` in a browser
4. Play

## Working With This Project
- **User background:** the project owner is a designer/PM, not a developer. Don't assume familiarity with git, npm, node, or related CLI tools. When an action requires them to run commands, spell out the exact commands and what to expect. When an action is git-related and can be done from Claude's side (commits, pushes, branch work), just do it — don't ask them to run git commands unless they're pulling Claude's changes to their local machine.
- When modifying the AI-GM behavior, edit `ai-gm-system-prompt.md`. The template uses `{{PLACEHOLDER}}` tokens that are filled by `buildSystemPrompt()` in the HTML.
- When adding new rooms or modules, follow the JSON structure in `module_village_three_knots.json`; validate with `json-validator.html`.
- When touching the UI, the layout uses CSS Grid with fixed regions. The narrative panel scrolls; everything else is pinned.
- Always test combat flow end-to-end after prompt changes — it's the most fragile part of the system.
