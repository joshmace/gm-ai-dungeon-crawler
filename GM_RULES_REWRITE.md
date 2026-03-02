## 1. GM Rules Rewrite (Version 2)

- **Purpose Statement:** This AI-powered, web-based game is meant to provide an immersive role-playing experience for a single (and in future versions, multiple) player, typical to TTRPGs, such as Dungeons & Dragons, Draw Steel, Nimble, and Shadowdark, etc.

- **Consideration:** The goal of this project is to provide a marketable game platform available to a large user base, with 2 tiers of users:
Players - Access to the game and able to select from available Game Packs.
GMs - Everything availble to the player level, but also the ability to create, upload and share their own Game Packs.

- **Consideration:** Because this will ideally become a product available to a large number of users, scalibility, token usage, maintainability and pricing structure should be considered.

### 1.1 Structure

#### 1.1.1 Game Packs

- **Description:**  Formatted a JSON documents, Game Packs consist of a Setting, Rules, Beastiary and Adventure Module. They will have the capability to reference external image files (visuals, maps, and handouts) and audio files (music, sound effects, voice-overs)

##### 1.1.1.1 Setting

- **Description:** This document defines the world or setting in which the adventure takes place. This can include a general description, history, regions, cosmology, religion, races and ancestries, species, magic, technology, tone, and recent major events. The Rules, Bestiary, and Adventure Modules are related to a particular setting.

##### 1.1.1.2 Rules

- **Description:** This document defines the guildlines by which the GM must abide, and the specific rules that governs all the mechanics (including, but not limited to): character stats, class decriptions, rolls, combat, travel, spells, technology, weapons, items (magic and non-magic), character leveling, XP and character death.

##### 1.1.1.2 Beastiary

- **Description:** (Formally called the Monster Manual) This document defines the creatures, monsters, BBEGs, and other NPCs that can be interacted with in the related setting. It includes default information for each listing: visual descriptions, behaviour, stats, powers, difficulty rating, treasure and XP. The Adventure Module may override the default information with specific alterations for certain listings.

##### 1.1.1.4 Adventure Module

- **Description:** This document defines the specific locations and circumstances related to the adventure at hand. It would include any relevant story hooks, additional lore, detailed descrptions of the locations to be explored, NPCs, references to creatures or monsters to encounter, and treasure or items to be found. The information in this document will override any default information referenced in the Beastiary.

### 1.2 The 3 Pillars of TTRPGs

- **Description:** There are 3 distinct modes of play that are clearly dileniated from each other.
- **Description:** At any point in the game, a player is always in 1 of the 3 modes. Modes cannot overlap, and only 1 mode can be active at any time.

#### 1.2.1 Exploration (high GM freedom, low mechanics)

- **Description:** The player is exploring a specific location (city, town, village, forest, dungeon, building, etc.).
- **Description:** Dice roles by the player will be infrequent, and limited to ability and skill checks.
- **Description:** Non-combat, role-play interactions with creatures and NPCs will also occur and may involve ability and skill checks.
- **GM Notes:** The GM should be empowered to improvise and adapt to the player's decisions, while only being constrained by the infomation described in the module and setting JSON documents.
- **GM Notes:** The GM should be empowered to call for ability/skill checks when appropriate, and should honor the results of any roll, as well as narrate the results in-game.
- **GM Notes:** The Adventure Module will give more specific information about the environment and the locations to be explored in that adventure, but information from the setting JSON can be used by the GM to provide additional background and flavor text.
- **GM Notes:** Certain locations being explored by players will have distinct layouts that would typically be represented by a physical map in a TTRPG session, and may be displayed on-screen in this app. In these cases, that location should be described in more detail in the module, and the GM should strcitly adhere to the details of that description, only improvising minor details.
- **GM Notes:** While in exploration mode, the narrative typically should be ongoing for any activities, events, and interactions taking place. However, long (overnight) or short (2-3 in-game hours) respites can be described in brief.

#### 1.2.2 Combat Encounters (low GM freedom, high mechanics)

- **Description:** The player is actively engaged in combat with one or more creatures. Clear demarkation for entering and exiting combat should be enforced.
- **Description:** When a combat encounter is active, a turn-based progression of actions takes place, as determined by the rules JSON document.
- **Description:** Dice rolls for attacks, spells, ability/skill checks, and damage should be in accordance to the rules engine and the results should be dislplyed clearly.
- **GM Notes:** It is imperative that the turn progression and dice roll results are strictly honered, and the GM should only be dramatically describing the results of each turn, as the outcome is determined by the player's choice of action, the dice rolls and the framework provided by the runles engine.

#### 1.2.3 Travel

- **Description:** The player is traveling a long distance between locations, and for an extended period of time. For example, riding a horse across many leagues from one town to another, sailing across a sea to a faraway port, or entering a stasis pod for an interstellar flight.
- **Description:** The setting, rules, and module JSON documents may provide additional instructions for Travel mode, and those should be honored.
- **GM Notes:** Because the moment-by-moment (generally speaking), narrative of Exploration mode would be tedious when traveling long distances and over an extended period of time, a GM can ask if the player wants to enter Travel mode.
- **GM Notes:** The GM should ask or determine the intention/plan/desire of the player and narrate the travel experience.
- **GM Notes:** The travel experience should be realistic and appropriate for the module and setting provided in the JSON documents.