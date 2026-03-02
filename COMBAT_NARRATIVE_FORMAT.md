# Combat Narrative Format

> **Purpose:** Define how combat should be narrated in the app so that (1) dice rolls and mechanical results are clearly separated from flavor text, and (2) the GM correctly narrates creature death when HP reaches 0.  
> **Status:** Skeleton — fill in the example sections by hand, then provide back for implementation.

---

## 1. Format Principles

### 1.1 Separation of Concerns

- **Flavor text:** Descriptive narrative only — what the player sees, hears, feels. No numbers, no mechanics.
- **Mechanics callouts:** Dice rolls, results, damage numbers, and mechanical outcomes — presented distinctly so the app (and player) can parse them reliably.

### 1.2 Why This Matters

- The **rules engine** (app) manages calculations by **parsing the mechanics callouts** (Section 2) — damage, HP, hit/miss, conditions, XP/treasure — **not** the GM’s narrative text. That keeps game state authoritative and avoids parsing free-form prose.
- The encounter panel tracks monster HP from those parsed callouts. When a creature reaches 0 HP, it is **defeated**.
- The GM must **never** narrate a defeated creature as still alive, attacking, or acting.
- Clear callouts reduce ambiguity and help the GM stay consistent with game state.

---

## 2. Mechanics Callout Format

*(Define here how dice rolls and results should be formatted. For example: inline `[ROLL: d20 = 14]` or block-style, etc.)*

### 2.1 Attack Rolls

<!-- Example format for attack roll callouts -->

```
Attack Roll 1d20: 17 (+ 5) = 22 (longsword/melee)
HIT: 22 vs AC 13
```

### 2.2 Damage Rolls

<!-- Example format for damage roll callouts -->

```
Damage Roll 1d8: 3 (+ 3) = 6 (slashing)
Goblin Fighter: HP 1/7
```

### 2.3 Other Rolls (Saves, Checks, etc.)

<!-- Example format for non-attack rolls -->

```
Ability Roll 1d20: 4 (+2) = 6 (CON)
FAIL: 6 vs DC 15
CONDITION: Poisoned
```

### 2.4 XP and Treasure

<!-- Example format for non-attack rolls -->

```
Aldric gains 25 XP and discovers 10 gold!
```


## 3. Flavor Text Format

*(Define what belongs in pure narrative blocks — no numbers, no mechanics.)*

<!-- Example of flavor-only narrative -->

```
You draw your longsword and charge forward to engage the goblin in melee combat.
Your longsword finds its mark!
Your blade slices across the goblin's torso. The goblin staggers but remains standing, dark blood seeping from the wound. It snarls and swings its scimitar at you in retaliation.
The goblin attacks and strikes you! Your turn - what do you do?
```

---

## 4. Combat Flow Example

*(Fill in a complete example of one combat round, from player action through GM response. Show: attack roll callout, hit/miss, damage callout, creature HP outcome, and — critically — correct narration when creature reaches 0 HP.)*

### 4.1 Player Turn (Attack)

<!-- What the player says / does -->

```
"I attack with my longsword!"
You draw your longsword and charge forward to engage the goblin in melee combat.
[ATTACK DICE ROLL CONTROL APPEARS - PLAYER ROLLS]
[ATTACK ROLL CALLOUT APPEARS]
```

### 4.2 GM Response — Hit, Creature Survives

<!-- GM narrates hit, damage, creature still alive -->

```
Your longsword finds its mark!
[DAMAGE DICE ROLL CONTROL APPEARS - PLAYER ROLLS]
[DAMAGE ROLL CALLOUT APPEARS]
Your blade slices across the goblin's torso. The goblin staggers but remains standing, dark blood seeping from the wound.
```

### 4.3 GM Response — Hit, Creature Defeated (0 HP)

<!-- GM narrates hit, damage, creature dies. CRITICAL: No "the goblin snarls and strikes back" — it is dead. -->

```
Your longsword finds its mark!
[DAMAGE DICE ROLL CONTROL APPEARS - PLAYER ROLLS]
[DAMAGE ROLL CALLOUT APPEARS]
Your blade bites deep! The goblin warrior crumples to the sand...dead, its scimitar clattering away. Dark blood pools beneath the still form.
[XP AND TREASURE CALLOUT]
The combat chamber falls quiet, weapon racks casting long shadows in the torchlight. The archway back to the hub remains open.
```

### 4.4 GM Response — Miss

<!-- GM narrates miss -->

```
The Goblin is nimble...your longsword swings wide!
```

### 4.5 Monster Turn (When Still Alive – Hit)

<!-- GM writes setup only; app shows callouts and adds outcome line. Display order: GM block → callouts → app outcome. -->

```
[GM] The Goblin snarls and swings its scimitar at you in retaliation.
[MONSTER_ATTACK]
[Callout] Attack Roll 1d20: X (+Y) = Z (weapon/melee)
[Callout] HIT: Z vs AC N
[Callout] Monster: formula (to you)
[GM] The blow lands and wounds you. Your turn — what do you do?
```

### 4.6 Monster Turn (When Still Alive – Miss)

<!-- GM writes setup only; app shows attack callout and adds outcome line. No damage callout on miss. -->

```
[GM] The Goblin snarls and swings its scimitar at you in retaliation.
[MONSTER_ATTACK]
[Callout] Attack Roll 1d20: ... (weapon/melee)
[Callout] MISS: Z vs AC N
[GM] The attack misses. Your turn — what do you do?
```

---

## 5. Anti-Patterns to Avoid

### 5.1 Defeated Creature Still Acting

**Wrong:** Creature has 0 HP (defeated in encounter panel) but GM writes: *"The goblin, despite its wounds, lunges at you..."*

**Right:** When creature reaches 0 HP, narrate its death immediately. No further actions from that creature.

### 5.2 Mechanics Buried in Flavor

**Wrong:** *"Your blade bites deep—eight points of damage—and the goblin reels."*  
*(Harder to parse; mixes flavor and number.)*

**Right:** *(Define your preferred format in Section 2.)*

### 5.3 Other Anti-Patterns

<!-- Add any others you want to call out -->

```
[Your additions here]
```

---

## 6. Implementation Notes (For Later)

*(Leave blank for now. We'll use this section when building the format into the app — e.g., prompt additions, UI treatment of callouts, parsing rules.)*

- [ ] Prompt language to enforce this format
- [ ] UI treatment: how callouts are styled/displayed in the narrative panel
- [ ] Parsing: ensure damage/death detection aligns with narrative

---

## 7. Dice Section Changes

*(Layout and behavior of the dice roll control only — how it looks and works. The app generates mechanics callouts from these controls; parsing of callouts is covered in Section 1.2 and Section 6.)*

### 7.1 Attack Rolls

```
Roll for Attack (1d20 +3(STR), +2(Prof)). <button>Roll 1d20 (+5)</button> or enter result: <input>1-20</input> <button>Submit</button>
```

### 7.2 Damage Rolls

```
Roll for Damage (1d8 +3(STR)). <button>Roll 1d8 (+3)</button> or enter result: <input>1-8</input> <button>Submit</button>
```

### 7.3 Ability Rolls

```
Roll for Ability Check (1d20 +2(CON)). <button>Roll 1d20 (+2)</button> or enter result: <input>1-20</input> <button>Submit</button>
```

*Fill in the bracketed sections above, then provide this file back for implementation.*