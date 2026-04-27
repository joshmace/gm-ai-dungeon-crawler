# Planning session handoff — 2026-04-27

## Context

A planning session was held in **cloud Claude Code** (desktop app, but cloud-backed session) on 2026-04-27. The cloud sandbox could see the repo but **not** `~/mace-and-marrow/` — so the canonical brand/product docs and the existing `INDEX.md` were never read.

This file is a bridge for a **local Claude Code session** to pick up where the planning conversation left off. Once you're in a local session, you can:

1. Read `~/mace-and-marrow/INDEX.md` for orientation (the canonical-docs entry point).
2. Read the brand/product docs that were inaccessible to the cloud session — the framework below was built from `PRODUCT_BRIEF.md` only; the additional brand/feature material may shift priorities.
3. Apply the next actions below.
4. Decide whether this file should migrate to `~/mace-and-marrow/sessions/2026-04-27-planning-handoff.md` (and be deleted from the repo) or stay here as a code-side artifact. Per the doc-pipeline design, brand/product/strategy docs are canonical in Drive, not the repo.

## What we agreed

### Prioritization framework (criteria, in priority order)

1. **Reversibility.** Sticky decisions later, reversible work earlier.
2. **Blocking power.** Things that gate other tracks come first.
3. **Public surface.** Pre-launch means internal quality outranks external polish.
4. **Effort vs. unknown.** Big unknowns need a discovery pass before scheduling.
5. **Energy fit.** Designer/PM work runs in parallel with dev-fit work, not sequenced behind it.

### Three horizons

- **Now** (1–2 weeks): unblockers + cheap cleanups + decisions.
- **Soon** (1–2 months): focused execution sprints.
- **Later** (3+ months): sticky, public-launch-dependent work.

A topic lives in the earliest horizon where its dependencies are satisfied.

### Two clarifications mid-session

- **UI/UX is not a visual revamp.** The visual vocabulary stays. The work is **usability + functionality + feature integration**, drawn from `POLISH_BACKLOG.md` and `BACKLOG.md`. Topics 3 and 5 effectively merge into a single UX/functionality burndown track.
- **Diary is deferred**, not near-term. Build-in-public was a working assumption that's now off the table for the immediate phase. Rebrand decision similarly loses time pressure (it was urgent only because the diary needed a name).

## The seven topics — at a glance

| # | Topic | Horizon | Owner-ish |
|---|---|---|---|
| 1 | Housekeeping (README, stale-doc audit, file naming) | Now (cleanup); Later (renames after rebrand) | Me |
| 2 | Threshold rebrand | Now (decision, low-pressure); Later (rollout) | You decide; I research |
| 3 | UX/functionality + feature integration | Soon | You audit + decide; I implement |
| 4 | Automated QA (Playwright + mocked LLM + CI) | Soon, parallel with #3 | Me |
| 5 | Prioritization (this track) | Now (commit framework); ongoing grooming | Me + you |
| 6 | Production setup (hosting, billing, marketplace, infra) | Later | Me research; you decide |
| 7 | Docs + roadmap + marketing + diary | Soon (internal docs only); Later (public marketing + diary) | You write; I draft |

## Revised sequence — "B′"

**Now (1–2 weeks)**

- Repo housekeeping orphan-doc audit.
- Pull canonical brand/product docs from `~/mace-and-marrow/` into context (this is what local Claude Code unblocks).
- Commit a `ROADMAP.md` distilling the framework + horizon-tag every `POLISH_BACKLOG.md` and `BACKLOG.md` item. This may end up in `~/mace-and-marrow/` rather than the repo — the doc-pipeline design suggests the latter.
- Background, low-priority: "Threshold" name-availability scan (domains, trademarks, TTRPG-product collisions, Steam/itch listings).

**Soon (1–2 months)**

- UX/functionality pass — top items from re-tagged backlog. Likely candidates: card UI redesign (chip strip / drawer), `[REWARD:]` tag, per-instance encounter HP, drop/transfer items, XP bar label, cross-room combat re-entry, mobile responsive.
- Automated QA in parallel — Playwright spike → mocked-LLM fixture → smoke tests for the regression gates already named in `DEV_STATUS.md` → CI loop.
- Internal docs trickle (README, contributor notes, public roadmap draft).

**Later (3+ months)**

- Rebrand rollout (whenever you decide).
- Production discovery → infra → public launch prep.
- Diary launch (whenever you commit to a cadence).
- Marketing site.

## Immediate next actions when picking up locally

In order:

1. **Read `~/mace-and-marrow/INDEX.md`** — the orientation doc this cloud session couldn't see.
2. **Read the brand/identity/feature-ideas docs** referenced from `INDEX.md`.
3. **Validate the framework + sequence** against the new context. Adjust if needed.
4. **Repo housekeeping pass:** orphan-doc audit on `RULES_TESTING.md`, `GM_RULES_REWRITE.md`, `RULES_SCHEMA_PLAN.md`, `SESSION_3_CHANGELOG.md`, `REFACTOR_V1_PLAN.md`. Surface kill/keep/move list for review before deleting anything.
5. **Distill into `ROADMAP.md`** (in repo or `~/mace-and-marrow/` — your call). Re-tag every backlog item by horizon.
6. **Threshold availability scan** — background pass.

## Things this cloud session couldn't do

- Read `~/mace-and-marrow/INDEX.md` or any canonical Drive docs.
- Apply session-file-proposed updates to canonical docs (the "Code applies updates" half of the doc pipeline).
- Anything that requires the brand voice / feature-ideas content beyond what's in `PRODUCT_BRIEF.md`.

The framework and sequence above are best-effort given that gap. Treat them as a starting point to validate against the canonical docs, not as final.

## Doc-pipeline reminder

- Canonical home for brand/product/strategy docs: `~/mace-and-marrow/` (Google Drive, mirrored locally on Mac via Available Offline + symlink).
- The repo is for code, not brand/product docs.
- claude.ai writes proposed changes into `~/mace-and-marrow/sessions/<dated>.md`; local Claude Code applies them to canonical docs.
- Read `~/mace-and-marrow/INDEX.md` at the start of any substantive Threshold session.
