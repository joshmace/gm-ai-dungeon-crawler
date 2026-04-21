# AI Dungeon Crawler

## What This Is
An AI-powered solo tabletop RPG where Claude acts as the Game Master. Players interact through a web interface while the AI narrates, adjudicates OSR-style rules, and manages combat. Built as an MVP with plans to expand into group play, configurable rulesets, and a module authoring platform.

## Architecture

### Frontend — `playable-dungeon-crawler-v2.html`
Single-page application. Vanilla JS, CSS, and HTML — no build step, no framework. Panel templates live in `./templates/` and CSS in `./styles/main.css`; everything else is inline.

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
A "Game Pack" is a manifest JSON (e.g. `game_pack_village_three_knots.json`) that bundles the files for one playable experience:
- `setting` — world/lore (`setting_*.json`)
- `rules` — mechanics, DCs, conditions, XP progression (`rules.json`)
- `bestiary` — monster stats (`monster_manual.json`)
- `adventure_module` — rooms, encounters, features (`module_*.json`)
- `character` — starting character sheet (`character_*.json`)

Switch packs by changing `CONFIG.GAME_PACK` in the HTML.

Current packs:
- **The Haunting of Three Knots** — `game_pack_village_three_knots.json` (active)
- **Rules System Test** — `game_pack.json` (test hub; uses `character_aldric.json` and `test_module_rules.json`)

### GM System Prompt — `ai-gm-system-prompt.md`
The source of truth for GM behavior. Loaded at runtime by the frontend and filled in with current game state.

## Tech Stack
- **Frontend:** Vanilla HTML/CSS/JS (no React, no build tools)
- **Backend:** Node.js (no Express — raw `http` module)
- **API:** Anthropic Messages API (default model `claude-sonnet-4-5`)
- **Persistence:** localStorage (single save slot, keyed by Game Pack)
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
- Standard DCs come from `rules.json` (Easy 10, Medium 15, Hard 20 by default)
- Never reveal NPC motivations without Insight/Perception checks
- HTML formatting in responses: `<b>`, `<i>` only (no raw asterisks)
- Roll requests use the format: `[ROLL_REQUEST: Ability]`; monster attacks use `[MONSTER_ATTACK]`; combat state toggles with `[COMBAT: on]` / `[COMBAT: off]`

### File Structure
```
project/
├── CLAUDE.md                               # This file
├── playable-dungeon-crawler-v2.html        # Main game interface
├── server.js                               # Static server + Anthropic proxy
├── ai-gm-system-prompt.md                  # GM system prompt (loaded at runtime)
├── styles/main.css                         # All styling
├── templates/                              # HTML panel templates
├── game_pack_*.json                        # Game Pack manifests
├── setting_*.json                          # World/setting data
├── module_*.json                           # Adventure modules (rooms, encounters)
├── character_*.json                        # Character sheets
├── rules.json                              # Mechanics and DCs
├── monster_manual.json                     # Bestiary
└── json-validator.html                     # Dev tool for validating game data JSON
```

## Current Status & Known Issues
- MVP is functional: narrative, dice rolling, combat sequencing, inventory, conditions, XP/leveling, save/load all work
- Combat adjudication is still done in the prompt (fragile). A rules engine is planned to move hit/miss/damage resolution into JS.
- Module data is partially hardcoded in the HTML alongside the JSON file
- No streaming responses (full response waits)
- Image placeholders exist but no actual image generation

## Planned Features (in rough priority order)
1. Rules engine — move combat adjudication out of the prompt into JS
2. Streaming API responses for more natural pacing
3. Split the main HTML into separate `<script src>` files
4. Configurable rulesets (not just OSR — allow different systems)
5. Module authoring tools / additional modules
6. Character creation flow
7. Group/multiplayer support
8. Image generation integration for scenes
9. Mobile-responsive layout improvements

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
