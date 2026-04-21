# AI Dungeon Crawler - Development Backlog

**Last Updated:** February 21, 2026  
**Status:** Active tracking — Pre–long-adventure priorities defined

---

## Pre–Long-Adventure: Priority & Plan

These 16 features are prioritized so you can run and test longer adventures. Order is by dependency and impact.

### Priority Tiers

| # | Feature | Tier | Rationale |
|---|--------|------|-----------|
| 14 | Game state saving | **Tier 1** | Long sessions need save/load or progress is lost. |
| 15 | Player death | **Tier 1** | Proper end state, restart/continue options. |
| 1 | Leveling 1–10 (max 10) | **Tier 1** | Core progression; already have XP, need level-up flow. |
| 12 | Individual weapon and armor stats | **Tier 2** | Foundation for equipping and comparing gear. |
| 2 | Finding/buying new weapons and equipping | **Tier 2** | Depends on 12. |
| 3 | Finding/buying new armor and equipping | **Tier 2** | Depends on 12. |
| 4 | Visiting a shop and making purchases | **Tier 2** | Economy + 2/3. |
| 5 | Managing pack inventory explicitly | **Tier 2** | Add/drop/use from pack; ties to 2/3/4. |
| 11 | Remove debug panel (for now) | **Tier 2** | Quick cleanup; re-add later when enhanced. |
| 6 | Non-combat encounters, NPCs, skill checks | **Tier 3** | Richer play; builds on existing roll/DC flow. |
| 7 | Spell casting and spell management | **Tier 3** | Spell slots, scaling with level. |
| 13 | Character builder / character management | **Tier 3** | Create/edit/load characters. |
| 16 | Custom character portraits | **Tier 3** | UI polish; can follow 13. |
| 10 | Map support (module map in character panel) | **Tier 4** | Found/purchased map; display + navigation. |
| 9 | Pre-made image references (rooms, monsters, NPCs) | **Tier 4** | Module/monster manual images at appropriate times. |
| 8 | Multiple characters (full party, single user) | **Tier 4** | Larger scope; turn/initiative, shared state. |

### Implementation Plan (Phases)

**Phase 1 – Foundation (must-have for long play)**  
1. **Game state saving** — localStorage (or IndexedDB) save/load; save on key events + manual; load on start.  
2. **Player death** — Death screen, “Restart adventure” / “New character” / “Load save”; no input until choice.  
3. **Leveling 1–10** — Level-up when XP ≥ threshold; apply HP/ability bumps per rules; max level 10; UI update.

**Phase 2 – Equipment & economy**  
4. **Individual weapon and armor stats** — Ensure module/character data has per-item stats; UI shows and uses them.  
5. **Finding/buying weapons and equipping** — Parse “find/buy [weapon]”; add to inventory; equip/readied flow.  
6. **Finding/buying armor and equipping** — Same for armor; AC and “armor equipped” state.  
7. **Shop visits and purchases** — Shop room/state; parse “buy X for Y gp”; deduct gold, add item; optional shop UI.  
8. **Pack inventory management** — Explicit add/drop/use from pack; parsing + UI (e.g. use/drop from pack list).  
9. **Remove debug panel** — Hide or remove from layout; keep code for later.

**Phase 3 – Encounters & characters**  
10. **Non-combat NPCs and skill checks** — NPCs in modules; skill-check outcomes; state flags for “talked to X”.  
11. **Spell casting and spell management** — Spell list, slots, slot recovery; level scaling; roll requests for spells.  
12. **Character builder / management** — Create character (abilities, class, name, starting gear); save/load character.  
13. **Custom character portraits** — Upload or pick portrait; store with character; show in panel.

**Phase 4 – Content & party**  
14. **Map support** — Module-defined map image; “found/purchased” flag; show in character panel; optional room highlight.  
15. **Pre-made images** — References in module/monster manual; show room/monster/NPC image at appropriate time in narrative.  
16. **Multiple characters (party)** — Party list, active character, turn/initiative; shared inventory or per-character; single user.

### Status (Pre–Long-Adventure)

| # | Feature | Status |
|---|--------|--------|
| 1 | Leveling 1–10 | Done |
| 2 | Weapons: find/buy & equip | Done |
| 3 | Armor: find/buy & equip | Done |
| 4 | Shop and purchases | Done |
| 5 | Pack inventory management | Done (drop/leave parsing; use already existed) |
| 6 | NPCs and skill-check encounters | Not started |
| 7 | Spell casting and spell management | Not started |
| 8 | Multiple characters (party) | Not started |
| 9 | Pre-made image references | Not started |
| 10 | Map support | Not started |
| 11 | Remove debug panel | Done |
| 12 | Individual weapon/armor stats | Done |
| 13 | Character builder/management | Not started |
| 14 | Game state saving | Done |
| 15 | Player death | Done |
| 16 | Custom character portraits | Not started |

*Update the Status column as work progresses (e.g. “In progress”, “Done”).*

---

## Backlog Items

### From Initial Review

#### State Management & Parsing
- [ ] Improve HP damage parsing patterns to catch more variations ("8 damage to you", "suffers 5", "6 HP lost")
- [ ] Add manual HP override button in case parsing fails
- [ ] Add conversation history pruning to avoid hitting context limits on long sessions
- [ ] Better state sync validation between AI responses and game state
- [ ] Validate AI is following all rules (automated checks)

#### Persistence & Storage
- [x] Implement localStorage for basic save/load functionality
- [ ] Consider IndexedDB for more robust storage
- [ ] Add browser refresh warning ("unsaved progress will be lost")
- [ ] Cloud save system (future)
- [ ] Export save files for backup

#### Error Handling
- [ ] Error boundaries around AI API calls
- [ ] Recovery flow when AI outputs malformed responses
- [ ] Validation of AI response format before processing
- [ ] Fallback behavior when API is down
- [ ] Retry logic with exponential backoff

#### Death & Game Over
- [x] Proper death handling flow (currently just disables input)
- [ ] Character sheet save on death
- [ ] Option to create new character after death
- [x] Option to restart adventure
- [ ] Death statistics/memorial

#### Character Creation
- [ ] Character creation wizard/flow
- [ ] Ability score generation methods
- [ ] Class selection
- [ ] Equipment selection based on class
- [ ] Background/personality options
- [ ] Name generator option

#### Module Integration
- [ ] Full integration of module JSON data into system prompt
- [ ] Use monster stats directly from JSON
- [ ] Use treasure data from JSON
- [ ] Use DC values from JSON
- [ ] Parse room connections dynamically
- [ ] Module file upload interface
- [ ] Module validation/linting

#### UI/UX Polish
- [ ] Loading animations during AI calls (beyond text indicator)
- [ ] Sound effects for dice rolls
- [ ] Sound effects for combat hits/misses
- [ ] Ambient music or atmospheric sound
- [ ] Image generation integration (placeholders ready)
- [ ] Dice roll animation (3D rolling dice?)
- [ ] Character portrait upload/generation
- [ ] Toast notifications for XP/items/conditions

#### Combat & Rules
- [ ] Separate combat log (scrollable, filterable)
- [ ] Export combat log as text/PDF
- [ ] Export full narrative as PDF/markdown
- [ ] Initiative tracking display (for future multi-enemy fights)
- [ ] Enemy health bars (optional setting)
- [ ] Advantage/disadvantage roll system
- [ ] Critical hit/fumble rules
- [ ] Status effect duration tracking

#### Architecture & Code Quality
- [ ] Externalize system prompt from HTML (too embedded currently)
- [ ] Move API key to environment variable
- [ ] Add TypeScript or JSDoc for type safety
- [ ] Unit tests for state parsing functions
- [ ] Integration tests for AI interactions
- [ ] Code splitting for larger feature sets
- [ ] Performance optimization for long conversations

#### Content & Features
- [ ] Multiple dungeon modules
- [ ] Module marketplace/library browser
- [ ] Adventure builder tool (GUI for creating JSON modules)
- [ ] Character advancement/leveling system with choices
- [ ] Skill point allocation on level up
- [ ] New ability unlocks at certain levels
- [ ] Branching storyline support in modules
- [ ] Random encounter tables
- [ ] NPC dialogue trees
- [ ] Puzzle mechanics
- [ ] Trap mechanics with varied solutions

#### Multiplayer/Party Prep
- [ ] Multiple character management
- [ ] Turn order for party members
- [ ] Party inventory (shared/personal distinction)
- [ ] Character switching interface
- [ ] Real-time multiplayer (ambitious)

#### Platform & Distribution
- [ ] Mobile responsive design
- [ ] Progressive Web App (PWA) conversion
- [ ] Electron wrapper for desktop app
- [ ] Mobile app (React Native or similar)
- [ ] User accounts system
- [ ] Social features (share adventures, compare stats)
- [ ] Leaderboards (speedruns, challenge modes)

#### AI GM Improvements
- [ ] Better impossible action handling ("you try but..." + world rules explanation)
- [ ] More consistent tone across responses
- [ ] Personality settings for GM style (serious/humorous/dramatic)
- [ ] Remember player preferences across sessions
- [ ] Meta-commentary from GM (occasional tips, jokes, etc.)
- [ ] Dynamic difficulty adjustment based on player success
- [ ] Alternative models support (different Claude versions, other LLMs)

#### Settings & Configuration
- [ ] Difficulty/ruleset configuration UI
- [ ] House rules toggles
- [ ] Death save rules option
- [ ] Critical hit rules option
- [ ] Starting gold/equipment customization
- [ ] Response length preference
- [ ] Auto-roll vs manual roll preference
- [ ] Theme selection (dark mode, different color schemes)

#### Documentation
- [ ] Player's guide/tutorial
- [ ] Module creation guide
- [ ] API documentation for extending the system
- [ ] Video tutorial for setup
- [ ] FAQ document
- [ ] Known issues list

#### Testing & QA
- [ ] Test combat thoroughly with all enemy types
- [ ] Test all skill checks
- [ ] Test all room transitions
- [ ] Edge case testing (0 HP, negative HP, overflow values)
- [ ] Cross-browser compatibility testing
- [ ] Mobile device testing
- [ ] Screen reader accessibility testing
- [ ] Performance testing with long sessions

---

## Ideas Pending Categorization

- **Caster pregen for the Gauntlet test hub.** The Gauntlet ships with a Fighter pregen (Aldric) to exercise combat, hazards, and equipment flows. A second pregen — a Cleric or Magic-User — is needed to cover spellcasting, spell slots, per-rest recharge, and save-or-suffer rider adjudication. Add after task #4 (rules-engine refactor), once spell resolution is stable.

*(New ideas will be added here, then sorted into categories above)*

---

## Notes

- Items marked with [ ] are not started; [x] = completed.
- **Pre–Long-Adventure** (top section) is the source of truth for the 16 features and their implementation order; update the Status table as work completes.
- Older backlog items below remain for later prioritization; some overlap with Pre–Long-Adventure (e.g. death, save/load, character creation).
- Dependencies between items are reflected in the Phase order in the implementation plan.

---

## Quick Add Section

*(Use this area for rapid capture - will be organized into main backlog periodically)*

- [ ] Equipped gear should be highlighted based on player actions - parse equipment changes from player input (e.g., "I stow my shortbow and draw my sword" should unhighlight shortbow and highlight longsword in character panel)



