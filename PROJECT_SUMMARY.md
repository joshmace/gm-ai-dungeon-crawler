# AI Dungeon Crawler - Project Summary

## Overview
An AI-powered solo tabletop RPG dungeon crawler that uses Claude as the Game Master. Players interact through a web interface while Claude narrates the adventure, adjudicates rules, and manages combat encounters.

**Status:** Working MVP / Active Development  
**Created:** January 2026  
**System:** OSR-style rules (Old School Renaissance)

---

## What We've Built

### 1. Web Interface (`playable-dungeon-crawler.html`)
A complete single-page application with:
- **Character Panel** (left sidebar, fixed, scrollable)
  - Character stats, abilities, skills
  - Equipment and inventory (with live updates)
  - HP/AC/XP tracking
  - **XP Progress Bar** showing level advancement
  - Condition tracking
  - Equipment highlighting (only equipped items glow)
  
- **Narrative Panel** (main area, fixed header/footer)
  - Scrolling narrative window
  - GM narration with drop-cap styling
  - Player action display
  - System messages for rolls/events
  - Visual placeholder insets for images
  
- **Input Section** (bottom, fixed)
  - Text input for player actions (Enter to submit)
  - Dynamic dice rolling interface (appears when GM requests rolls)
  - **Supports both d20 (checks/attacks) and damage rolls**
  - Choice between AI rolling or manual input

### 2. Proxy Server (`server.js`)
A simple Node.js server that:
- Runs locally on port 3000
- Proxies API calls to Anthropic (avoids CORS issues)
- Handles authentication with API key
- ~70 lines of code, very maintainable

### 3. Module Format (`forgotten-crypt-module.json`)
JSON structure for dungeon content:
- Module metadata (title, level, theme, tone)
- Rules configuration (DCs, death saves, resource tracking)
- Room definitions with:
  - Descriptions and connections
  - Interactive features (with DCs and success/failure text)
  - Monsters (with triggers, stats, tactics)
  - Treasure locations
  - Image triggers
- Random encounters
- Victory conditions

**Sample Dungeon:** "The Forgotten Crypt" - 5 rooms, atmospheric horror, environmental storytelling

### 4. AI-GM System Prompt (`ai-gm-system-prompt.md`)
Comprehensive instructions for Claude acting as GM:
- Core principles (player agency, fair adjudication, atmosphere)
- Response structure patterns
- When to require rolls vs auto-success/fail
- Combat flow procedures
- Module adherence rules
- Tone and pacing guidelines
- **State tracking requirements (NEW)**
- **Skill usage guidelines (NEW)**
- **Equipment and monster stat enforcement (NEW)**

**Current Version:** Embedded optimized prompt in HTML (lines ~1280-1400)
- 50-100 word responses (150 max)
- Strict combat sequencing (wait for damage before enemy turn)
- Information control (don't reveal secrets without checks)
- Specific roll request format: `[ROLL_REQUEST: Ability]`
- **Now includes `[ROLL_REQUEST: Damage]` for damage rolls**
- HTML formatting support (`<b>`, `<i>`, `<code>`)
- **Automatic state tracking patterns (HP, XP, inventory, conditions)**

---

## How It Works

### Game Flow
1. Player types action → Press Enter
2. Action sent to proxy server → Forwarded to Claude API
3. Claude (as GM) receives:
   - System prompt with rules and current game state
   - Full conversation history
   - Current room data
   - Character stats (HP, XP, skills, inventory)
4. Claude responds with narration
5. **System parses response for state changes (HP, XP, items, conditions)**
6. If roll needed: Shows `[ROLL_REQUEST: Ability]`
7. JavaScript detects roll request → Shows dice UI
8. Player rolls (AI or manual) → Result sent back to Claude
9. Claude narrates outcome → Cycle continues

### State Management
**NOW FULLY TRACKED** in browser JavaScript:
- ✅ Character stats (HP, AC, abilities, inventory)
- ✅ XP progression with visual progress bar
- ✅ Current room location
- ✅ Triggered events (encounters that have fired)
- ✅ Conversation history (for AI context)
- ✅ Equipment equipped state (highlighted in UI)
- ✅ Active conditions (poisoned, blessed, etc.)
- ✅ Automatic inventory updates from AI responses

**Parsing patterns detect:**
- HP damage: "You take X damage"
- HP healing: "You heal X HP" or "restore X HP"
- XP gains: "You gain X XP"
- Gold found: "You find X gp" or "X gold"
- Items found: "You find a [item]"
- Item usage: "You drink the healing potion"
- Conditions: "You are poisoned", "You become blessed"
- Torch/resource consumption: Automatic tracking

**NOT YET IMPLEMENTED:**
- Persistent save/load (refreshing page resets game)
- Database storage
- Multi-session support

---

## Technical Stack

**Frontend:**
- Pure HTML/CSS/JavaScript (no frameworks)
- Single-page application
- Runs in any modern browser

**Backend:**
- Node.js HTTP server
- HTTPS module for API calls
- No dependencies (uses built-in modules only)

**API:**
- Anthropic Claude API
- Model: `claude-sonnet-4-20250514`
- Max tokens: 2000 per response

---

## Design Decisions

### UI/UX Philosophy
- **Immersive:** Fantasy novel aesthetic with parchment colors and serif fonts
- **Theater of mind:** No tactical grids or token movement
- **Minimal but critical visuals:** Placeholder boxes for key illustrations
- **Fixed panels:** Character sheet and input always accessible
- **Narrative focus:** Scrolling story is the centerpiece
- **Live feedback:** XP bar fills, inventory updates in real-time

### Gameplay Philosophy
- **OSR-style:** Deadly but fair, player skill over character optimization
- **Player agency:** GM never assumes player actions
- **Environmental storytelling:** Show don't tell, let players discover
- **Atmospheric horror:** Tension through description, not jump scares
- **Mechanical transparency:** Stats and modifiers always visible

### AI-GM Constraints (Learned from Testing)
✅ **DO:**
- Keep responses concise (50-100 words typically)
- Wait for damage rolls before narrating enemy turns
- Require checks to reveal secrets/motivations
- Use strict roll request format for dice UI trigger
- Format text with HTML tags for readability
- **Use exact phrasing for state changes ("You take X damage")**
- **Award XP after each combat**
- **Use correct skill modifiers**
- **Enforce exact monster stats from module**

❌ **DON'T:**
- Write 200+ word responses
- Combine multiple combat steps in one response
- Reveal NPC motivations without Insight checks
- Roll initiative (player goes first unless ambushed)
- Over-explain or handhold
- **Forget to award XP**
- **Use generic ability checks instead of trained skills**
- **Make up monster stats**

---

## Current Features (Session 3 Update)

### ✅ WORKING
- AI narration and atmosphere
- Dice rolling UI (both d20 and damage)
- Combat sequencing
- Skill checks and ability checks
- **Automatic HP tracking from AI text**
- **Automatic XP tracking and awards**
- **Automatic inventory management**
- **Automatic gold tracking**
- **Equipment highlighting (only equipped items glow)**
- **XP progress bar with level tracking**
- **Condition tracking (poisoned, blessed, etc.)**
- **Item consumption tracking (torches, potions)**
- HTML formatting in AI responses
- Room descriptions and navigation

### 🔨 NEEDS IMPROVEMENT
- Image generation (currently just placeholders)
- Save/load functionality
- Death/failure state (currently just disables input)
- Character creation flow (hardcoded character)
- Level-up mechanic (needs UI for choosing improvements)
- More sophisticated item parsing (weapons, armor)
- Better error recovery from bad AI responses

### ❌ NOT YET BUILT
- Multiple dungeon modules
- Module upload interface
- Configuration/settings UI
- Sound/music
- Party management
- Campaign mode

---

## File Structure

```
project/
├── playable-dungeon-crawler.html    # Main game interface (~1500 lines)
├── server.js                         # Proxy server for API calls
├── forgotten-crypt-module.json       # Sample dungeon module
├── ai-gm-system-prompt.md           # Full detailed GM prompt (reference)
└── PROJECT_SUMMARY.md               # This file
```

---

## Setup Instructions

### Prerequisites
- Node.js installed (v16+ recommended)
- Anthropic API key

### Installation
1. Download all project files to a folder
2. Edit `server.js` line 7: Add your API key
3. Open terminal in project folder
4. Run: `node server.js`
5. Open `playable-dungeon-crawler.html` in browser
6. Play!

### Troubleshooting
- **"Failed to contact GM"** → Server not running, start it
- **CORS errors** → Using old HTML file, download new one
- **No response from AI** → Check API key in server.js
- **Server won't start** → Port 3000 might be in use, change line 6
- **State not updating** → Check browser console for parsing errors

---

## Testing Feedback & Iterations

### Session 1 - Manual Testing
Tested combat, exploration, skill checks by simulating in conversation.
- ✅ Roll requests working
- ✅ Combat sequencing working
- ✅ Inventory tracking working
- ✅ Atmospheric narrative working

### Session 2 - Live Browser Testing
**Issues Found:**
1. ❌ Dice roll UI not appearing (wrong format detection)
2. ❌ No image placeholders showing
3. ❌ Hardcoded suggestions not useful
4. ❌ AI rolling initiative unnecessarily
5. ❌ Combat narrating full rounds (not step-by-step)
6. ❌ Responses too long (~200 words)
7. ❌ Revealing too much info without checks
8. ❌ No text formatting

**All Fixed in Version 0.2**

### Session 3 - Current Round Testing
**Issues Found & FIXED:**
1. ✅ Damage rolls didn't trigger dice UI → Added `[ROLL_REQUEST: Damage]` format
2. ✅ Skills not being used properly → Added skill usage section to prompt
3. ✅ Weapon damage modifiers not applied → Clarified in prompt
4. ✅ Inventory not updating → Added parsing for items, gold, potions, torches
5. ✅ Equipment highlighting all items → Changed to only highlight equipped
6. ✅ XP not tracked → Added XP parsing and awards
7. ✅ No level progression → Added XP progress bar and level tracking
8. ✅ Monster stats not enforced → Added exact stats to prompt

**New Features Added:**
- ✅ XP progress bar with visual fill
- ✅ Automatic HP damage/healing parsing
- ✅ Automatic XP award parsing
- ✅ Automatic inventory item detection
- ✅ Automatic gold tracking
- ✅ Torch and potion consumption tracking
- ✅ Condition application/removal
- ✅ Equipment state management
- ✅ Damage roll dice UI (d20 vs damage distinction)
- ✅ State management functions (modifyHP, addXP, etc.)

---

## Next Steps / Roadmap

### Phase 2: Refinement (CURRENT - In Progress)
- [x] Test combat thoroughly
- [x] Add HP/inventory parsing from AI responses
- [x] Add XP tracking
- [x] Add equipment management
- [ ] Validate AI following all rules consistently
- [ ] Improve error handling
- [ ] Add loading states/animations

### Phase 3: Essential Features
- [ ] Save/load game state (localStorage first, then server)
- [ ] Character creation flow
- [ ] Module file upload
- [ ] Image generation integration
- [ ] Death/failure state handling with restart option
- [ ] Level-up UI (choose stat increases, new abilities)

### Phase 4: Enhanced Experience
- [ ] Multiple dungeon modules
- [ ] Difficulty/ruleset configuration
- [ ] Visual map building as you explore
- [ ] Sound effects / ambient music
- [ ] Party management (multiplayer prep)
- [ ] Combat log (separate from narrative)

### Phase 5: Platform Features
- [ ] Adventure builder tool
- [ ] Module marketplace/library
- [ ] User accounts
- [ ] Cloud save
- [ ] Sharing adventures
- [ ] Analytics/statistics

### Future Considerations
- Mobile app version
- GM tools for live table play
- Campaign mode (linked adventures)
- Character advancement/leveling system
- Expanded rulesets (beyond OSR)
- Multiplayer/co-op mode

---

## Key Learnings

### What Works Well
- **Concise AI responses** feel more like a real GM
- **Strict combat sequencing** maintains tension and player control
- **Visual hierarchy** (character left, narrative center, input bottom) feels natural
- **Theater of mind** approach reduces complexity
- **Module JSON structure** is flexible and easy to edit
- **Automatic state parsing** reduces tedium and keeps focus on story
- **XP progress bar** provides satisfying progression feedback
- **Live inventory updates** feel responsive and modern

### What Needs Attention
- **AI consistency** - needs very explicit instructions with examples
- **State parsing reliability** - some edge cases still slip through
- **Error recovery** - AI going off-rails needs better handling
- **Module integration** - needs full connection to JSON data
- **Level-up flow** - currently just shows message, needs UI
- **Death handling** - currently just stops game, needs restart flow

### Design Principles That Emerged
1. **Less is more** - Simple rules, simple UI, complex emergence
2. **Trust the player** - Don't over-explain or handhold
3. **Explicit is better** - AI needs exact formats, not vague guidance
4. **Iterate quickly** - Test, get feedback, fix, repeat
5. **Parse don't predict** - Better to detect state changes than try to anticipate them
6. **Show progress** - Visual feedback (XP bar, HP changes) keeps engagement high
7. **Enforce rules strictly** - AI needs exact stats, no improvisation on mechanics

---

## Technical Implementation Notes

### State Parsing Patterns
The system uses regex patterns to detect state changes in AI narrative:

**Damage Detection:**
```javascript
/(?:take|taking|suffer|lose)\s+(\d+)\s+(?:damage|HP)/i
/(\d+)\s+damage/i
/hit\s+for\s+(\d+)/i
```

**Healing Detection:**
```javascript
/(?:heal|restore|regain)\s+(\d+)\s+(?:HP|hit points)/i
```

**XP Detection:**
```javascript
/(?:gain|earn|receive)\s+(\d+)\s+XP/i
```

**Gold Detection:**
```javascript
/(?:find|discover|obtain|gain)\s+(\d+)\s*gp/i
```

**Item Detection:**
```javascript
/(?:find|discover|obtain|take)\s+(?:a|an|the)\s+([^.!?,]+?)(?:\.|!|,)/i
```

### XP Progression Table
```javascript
const XP_LEVELS = {
    1: 0,      2: 2000,   3: 4000,
    4: 8000,   5: 16000,  6: 32000,
    7: 64000,  8: 128000, 9: 256000,
    10: 512000
};
```

### Dice Rolling Logic
- d20 rolls: 1-20 for ability checks, attacks
- Damage rolls: Dynamic based on weapon (1d8+3 for longsword)
- UI adapts button text and placeholder based on roll type
- Manual entry accepts 1-20 for checks, 1-99 for damage

---

## Questions for Future Sessions

When continuing development, consider:
1. ~~How should HP damage be parsed from AI text reliably?~~ ✅ SOLVED
2. Should we add a combat log separate from narrative?
3. How to handle player death gracefully? (current: just disable, need restart UI)
4. What's the minimal viable character creation flow?
5. Should modules support branching storylines or stay linear?
6. How to handle "impossible" player actions without breaking immersion?
7. ~~What's the best way to integrate the full module JSON data?~~ (partial solution)
8. **NEW:** How to implement level-up choices (stat increases, new skills)?
9. **NEW:** Should we add a "rest" mechanic for HP recovery?
10. **NEW:** How to handle multi-enemy combats (3+ enemies)?

---

## Known Issues & Edge Cases

### Parsing Limitations
- **Complex item names** might not parse correctly (e.g., "ornate silver dagger with ruby")
- **Multiple state changes** in one sentence might miss some
- **Ambiguous gold amounts** (e.g., "worth about 50 gold") might not parse
- **Conditional statements** (e.g., "if you hit, you deal 8 damage") might trigger false positives

### AI Behavior Edge Cases
- Sometimes forgets to award XP after combat
- Occasionally uses wrong skill bonus
- May narrate enemy actions too early in combat sequence
- Can be verbose on major reveals despite 150-word limit

### UI/UX Issues
- No visual feedback when state changes occur (could add floating notifications)
- XP bar doesn't animate smoothly (just jumps to new value)
- No confirmation on using consumables (potions, torches)
- Equipment "equipped" state is automatic (player can't manually toggle)

---

## Credits & Context

**Designer/Developer:** Solo project  
**AI Assistant:** Claude (Anthropic) - both as development assistant and in-game GM  
**Inspiration:** OSR games (Cairn, Knave, Shadowdark), classic dungeon crawlers, Ironsworn  
**Design Philosophy:** Collaborative storytelling, player agency, atmospheric immersion  

---

**Last Updated:** January 31, 2026  
**Version:** 0.3 (Post Session 3 feedback implementation)  
**Status:** Active Development - Core mechanics solid, polish and features ongoing
