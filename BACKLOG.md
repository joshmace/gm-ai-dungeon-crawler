# AI Dungeon Crawler - Development Backlog

**Last Updated:** February 1, 2026  
**Status:** Active tracking - prioritization TBD

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
- [ ] Implement localStorage for basic save/load functionality
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
- [ ] Proper death handling flow (currently just disables input)
- [ ] Character sheet save on death
- [ ] Option to create new character after death
- [ ] Option to restart adventure
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
- [ - Party inventory (shared/personal distinction)
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

*(New ideas will be added here, then sorted into categories above)*

---

## Notes

- Items marked with [ ] are not started
- Items marked with [x] are completed
- Priority levels will be assigned later (P0-Critical, P1-High, P2-Medium, P3-Nice to have)
- Some items may be split into multiple tasks during implementation
- Dependencies between items will be mapped during prioritization

---

## Quick Add Section

*(Use this area for rapid capture - will be organized into main backlog periodically)*

- [ ] Equipped gear should be highlighted based on player actions - parse equipment changes from player input (e.g., "I stow my shortbow and draw my sword" should unhighlight shortbow and highlight longsword in character panel)



