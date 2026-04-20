# Product Brief

> Purpose of this doc: a single source of truth for what this product *is* — the essence, audience, positioning, and state — suitable for seeding a claude.ai Project during branding / identity / marketing work. Not a technical spec; see `RULES_SCHEMA_PLAN.md` and `CLAUDE.md` for those.

## At a glance

- **What:** An AI-powered solo tabletop RPG where Claude plays the Game Master
- **Primary audience:** OSR fans, solo TTRPG players, homebrewers — people who love tabletop but can't always assemble a group
- **Current state:** Working MVP (one playable adventure). Full v1 schema redesign complete on paper; app refactor pending.
- **Core promise:** Sit down, pick a Game Pack, and play a real tabletop RPG — tonight, alone, in your browser.

---

## What it is

A single-page web app. You pick a **Game Pack** (a bundled ruleset + setting + adventure + character + bestiary + items), and Claude runs the session as your GM. You type what you want to do. Claude narrates what happens, asks for dice rolls when the outcome is uncertain, and tracks the world state around you. Your character sheet, inventory, active encounter, and current room are always visible in the interface.

The experience is closer to reading an atmospheric novel where you're the protagonist than to playing a video game. No grids, no tokens, no party management — just you, the GM, and the world unfolding through description.

---

## The big idea — rules-agnostic AI-GM

This is the headline differentiator, and it's the feature that makes the product worth building.

Most AI TTRPG products bake in their own homebrew mechanics or loosely pastiche D&D. This product is being designed from the ground up so that **the ruleset itself is swappable content**. A Game Pack for Shadowdark plays like Shadowdark. A Game Pack for Knave plays like Knave. A Game Pack for old-school AD&D plays like AD&D. A homebrewer can author their own ruleset and the GM will run it faithfully.

**v1 target tier:** d20-family / OSR systems (Shadowdark, Knave, Cairn, Mausritter, Mörk Borg, B/X, OSE, AD&D, 5e, Shadowdark, etc.). Everything in that family shares enough skeleton — ability scores, d20 resolution, HP, levels — that a single schema can express them.

**What this unlocks:**
- Players can play their favorite OSR system on demand, no group required
- Homebrew authors have a polished platform to test and share their own rulesets
- A long-tail content ecosystem becomes possible (community-authored packs)
- The product has legs — it doesn't compete on "our game vs. your game," it *serves* whatever game people already love

**What this isn't:** a licensed implementation of any specific system. The product is a runtime; designers author their own packs to match the systems they want to play.

---

## Who it's for

### Primary audience — OSR enthusiasts and solo TTRPG players

The OSR (Old-School Renaissance) community is a passionate, buying, homebrewing audience. They already love rules-light dungeon crawls, enjoy the craft of running and writing adventures, and are very comfortable with text-first play. Shadowdark's Kickstarter hit $1.3M. Mörk Borg has a global following. Knave is a cultural touchstone for rules-light play. These readers devour modules, buy zines, and are starved for convenient solo options.

### Secondary audience — TTRPG fans who can't get a group together

The perennial tabletop problem: scheduling. Adults with jobs, parents, people in smaller towns, shy introverts who don't want to join a club. They want to play something *tonight*, not next Saturday at 7pm if Mike gets his kids to bed in time.

### Tertiary audience — homebrewers and system designers

People who want to test their own rules and adventures with a real GM. For them, the product is a sandbox.

### Who it's not for

- **Traditional VTT users** who want tokens, grids, and group play. That's Roll20/Foundry's territory.
- **AI Dungeon-style freeform players** who want purely generative storytelling with no mechanical rigor. This product is mechanics-respecting; it's not a pure improv engine.
- **5e-only players** (at least not as the primary target, though a 5e-ish pack is supportable). The center of gravity is OSR.

---

## The experience

**What it feels like to play:**

You open the app. A dim, atmospheric interface greets you — parchment tones, serif type, maybe a sigil. Your character sheet sits on the left (warrior, Level 2, dagger and shortbow, 8/12 HP). The center is a scrolling narrative: the GM describes a cold corridor, flickering torchlight, a faint scuttling sound. At the bottom, a text box waits for your input.

You type: *"I draw my shortbow and peer down the corridor."*

The GM responds with a few sentences of evocative description. A bat flutters into view. The corridor continues into darkness. At the bottom of the response, an implicit invitation — what do you do?

You try to be careful. You fail a DEX check against a loose flagstone. A dart fires. The GM narrates; the app applies damage; your HP ticks down. The little red flash of damage on your HP bar is the only loud thing in the interface.

**The feeling is:** quiet tension, measured pace, the pleasure of making decisions that matter in a world that reacts consistently. Not fast, not flashy. Thoughtful. Cozy-horror is probably the closest vibe — inviting but with teeth.

---

## Positioning

| | This product | Traditional VTT | AI Dungeon-style | Solo TTRPG zines |
|---|---|---|---|---|
| GM | AI | Human | AI (loose) | Self (oracle tables) |
| Mechanics | System-faithful, rules-agnostic | Whatever the table runs | Often freeform/loose | System-specific |
| Pacing | Tonight, solo | Scheduled group | Anytime, freeform | Anytime, slow |
| Content model | Pack ecosystem | Table-run | Freeform generation | Published zine |
| Best for | Rule-loving solo player who wants tonight's session | Organized group play | Improv storytelling | Meditative solo reading + rolling |

---

## Product principles

These are the design values that should show up in the brand.

1. **Serve the system; don't replace it.** The GM respects the rules of whatever pack is loaded, down to the feel. Not a generic fantasy GM wearing a Shadowdark costume.
2. **Text-first, theater of mind.** Rich description, no tactical maps. Let the reader's imagination do the work.
3. **Mechanical transparency.** Stats, rolls, and modifiers are visible. No black-box "the GM said so."
4. **Rules-light, friction-low.** The interface and rhythm respect solo players' time. You should be playing within 60 seconds of loading the page.
5. **Authoring respect.** A homebrewer's pack should feel first-class — same treatment as the official packs. The pack ecosystem is the soul of the product.
6. **Quiet craft.** Nothing is shouty. No XP banners flying across the screen. The tone is a well-made book, not a mobile game.

---

## Current state (as of April 2026)

- Single playable adventure ("The Haunting of Three Knots")
- Working MVP with combat, skill checks, inventory, HP/XP/conditions, save/load
- Comprehensive **v1 schema redesign complete on paper** — a major architectural pass that restructures all JSON archetypes (Rules, Setting, Bestiary, Items, Module, Character) around the rules-agnostic vision. See `RULES_SCHEMA_PLAN.md`.
- App refactor against the new schemas: pending
- No external users yet; pre-launch

**Immediate next milestones** (in rough order):
1. Write a starter pack against the new schemas (validates the design end-to-end)
2. Refactor the app to consume the new schemas
3. Migrate existing content to the new format
4. Launch-ready: brand/identity, landing page, a handful of launch packs (probably two officials + one community-facing template)

---

## Vision / long arc

- **v1:** OSR / d20-family. Single-player. A small library of high-quality official Game Packs + authoring templates for community contributors.
- **v2:** Structured expansions: formal class systems, initiative order UI, rule-pack-declared signature mechanics (torch timers, wandering monsters, crit tables), customizable GM personalities, a real pack marketplace.
- **v3+ (aspirational):** Group play, Tier 2 systems (PbtA, Blades, FATE), image generation, mobile app, community authoring tools.

The product is built so that v1 can ship without promising v3 — but v1's architecture already has room for it.

---

## Tone and voice — starting notes for brand work

These are my current instincts, not final. Worth pressure-testing.

- **Atmospheric, not epic.** Think "dim cellar with a good lantern," not "heroic fanfare."
- **Craftperson energy.** Respectful of the tradition, serious about the work, unpretentious.
- **Book-adjacent visual language.** Serif fonts, deckle edges, parchment, sigils, woodcuts. Closer to a vintage novel or a tabletop zine than to a modern app.
- **Dry, warm humor.** Not corny, not grimdark. Occasional winks. The GM is an old friend who runs tight games, not a bombastic showperson.
- **Light ceremony.** Taking play seriously without taking oneself seriously.

**Words that feel right:** dungeon, lantern, parchment, rune, tomb, inn, old, quiet, sharp, deep, small, true.

**Words that feel wrong:** epic, ultimate, revolutionary, AI-powered (as a headline — it's true but gauche), fantasy adventure platform, the future of roleplay.

---

## Naming considerations

Candidates the name should be compatible with:

- A standalone product name (no "AI" or "GM" prefix dependency)
- A memorable domain
- Works as a logo — short, typographic-friendly, ideally a word people can say
- Doesn't pre-commit to a specific genre (in case future packs are sci-fi, horror, etc.)
- Doesn't pre-commit to dungeons (the product supports overland, urban, nautical, etc. — even if dungeons are the initial default)
- Trademarkable / domain-available
- OSR-shaped without being derivative ("Shadowdark" is taken)

I'm wide open on the direction. Naming brainstorm is part of the upcoming work.

---

## Credits / Context

- **Designer/Developer:** Solo project by the author
- **AI collaborator:** Claude (Anthropic), both as development partner and in-game GM
- **Influences:** Shadowdark, Knave, Cairn, Mausritter, Mörk Borg, Ironsworn, classic B/X D&D
- **Philosophy:** collaborative storytelling, player agency, atmospheric immersion, respect for the tabletop tradition
