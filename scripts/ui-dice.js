/* AI Dungeon Crawler — UI.dice
 *
 * Dice input section (dice prompt, manual roll submit, auto roll button) plus
 * the weapon/attack/damage resolution pipeline used by the dice flow.
 *
 * Reads window.gameState and window.gameData through accessor shortcuts
 * (gs()/gd()). Calls still-inline helpers via globals:
 *   - addMechanicsCallout, addSystemMessage           (UI.narrative)
 *   - resolveMonster, getFirstActiveEncounterInCurrentRoom,
 *     getEncounterHP                                   (UI.encounters)
 *   - getConditionModifierForRoll, addToInventory, addXP, saveGame
 *     (still-inline — moves to game-state.js in 1e-viii)
 *   - updateCharacterDisplay                          (UI.character)
 *   - disableInput                                     (still-inline)
 *   - callAIGM                                         (LLMProxy)
 *
 * Each function is also exposed as a top-level global so still-inline
 * callers keep working.
 *
 * Attaches to window.UI.dice.
 */
(function (global) {
    'use strict';

    const gs = () => global.gameState;
    const gd = () => global.gameData;
    const doc = () => global.document;

    /** Whether a weapon uses DEX (ranged) or STR (melee) for damage. */
    function isRangedWeapon(weapon) {
        return getWeaponTypeInfo(weapon).type === 'ranged';
    }

    // --- Stage 3c: v1-aware weapon / items helpers ----------------------

    /** Merged v1 items index: module-scoped overrides library. */
    function v1ItemsIndex() {
        const v = gd()._v1;
        if (!v) return {};
        const shared   = (v.items && v.items.items) || {};
        const modItems = (v.module && v.module.module_items && v.module.module_items.items) || {};
        return Object.assign({}, shared, modItems);
    }

    // --- Stage 4: v1-aware check / save context ---------------------------

    /**
     * Parse optional advantage / disadvantage suffix from a roll-request
     * string. Accepts "Dexterity, advantage", "Perception , disadvantage",
     * etc. Returns { base, advantage, disadvantage }.
     */
    function stripAdvantageSuffix(rollType) {
        const raw = String(rollType || '');
        const m = raw.match(/^\s*(.+?)\s*,\s*(advantage|disadvantage|adv|disadv)\s*$/i);
        if (!m) return { base: raw.trim(), advantage: false, disadvantage: false };
        const flag = m[2].toLowerCase();
        return {
            base: m[1].trim(),
            advantage:    flag === 'advantage' || flag === 'adv',
            disadvantage: flag === 'disadvantage' || flag === 'disadv'
        };
    }

    const ABILITY_KEYS = {
        str: 'str', strength: 'str',
        dex: 'dex', dexterity: 'dex',
        con: 'con', constitution: 'con',
        int: 'int', intelligence: 'int',
        wis: 'wis', wisdom: 'wis',
        cha: 'cha', charisma: 'cha'
    };

    /**
     * Classify a roll-request label against the active v1 rules pack.
     * Returns one of:
     *   { kind: 'ability',          key: 'dex', ... }
     *   { kind: 'skill',            key: 'perception', ... }
     *   { kind: 'save-per-ability', key: 'con', ... } (when the label ends in "save")
     *   { kind: 'save-categorical', key: 'death', name: 'Death Ray or Poison', ... }
     * or null when no match against the pack.
     */
    function classifyV1Check(label) {
        const v = gd()._v1;
        if (!v || !v.rules) return null;
        const rules = v.rules;
        const clean = String(label || '').trim();
        if (!clean) return null;
        const lower = clean.toLowerCase();

        // Categorical saves: Three Knots declares id + name pairs.
        const savesCfg = rules.character_model && rules.character_model.saves;
        if (savesCfg && savesCfg.type === 'categorical' && Array.isArray(savesCfg.categories)) {
            const strippedSaveWord = lower.replace(/\s*save\s*$/, '').trim();
            for (const cat of savesCfg.categories) {
                if (!cat) continue;
                const id = String(cat.id || '').toLowerCase();
                const name = String(cat.name || '').toLowerCase();
                if (id === lower || id === strippedSaveWord) {
                    return { kind: 'save-categorical', key: cat.id, name: cat.name || cat.id };
                }
                if (name && (name === lower || name === strippedSaveWord)) {
                    return { kind: 'save-categorical', key: cat.id, name: cat.name };
                }
            }
        }

        // "<ability> save" for per_ability packs.
        const saveMatch = lower.match(/^\s*(str|strength|dex|dexterity|con|constitution|int|intelligence|wis|wisdom|cha|charisma)\s+save\s*$/);
        if (saveMatch && savesCfg && savesCfg.type !== 'categorical') {
            const abId = ABILITY_KEYS[saveMatch[1]];
            if (abId) return { kind: 'save-per-ability', key: abId };
        }

        // Plain ability.
        const abId = ABILITY_KEYS[lower];
        if (abId) {
            const abs = (rules.character_model && rules.character_model.abilities) || [];
            if (abs.some(a => a && a.id === abId)) return { kind: 'ability', key: abId };
        }

        // Skill id / name.
        const skills = (rules.character_model && rules.character_model.skills) || [];
        for (const s of skills) {
            if (!s) continue;
            if (String(s.id || '').toLowerCase() === lower) return { kind: 'skill', key: s.id };
            if (String(s.name || '').toLowerCase() === lower) return { kind: 'skill', key: s.id };
        }
        return null;
    }

    /**
     * Build the Stage 4 dice context for an ability / skill / save roll.
     * Returns:
     *   {
     *     method, modifier, target, adEnabled,
     *     critSuccessOn, critFailureOn,
     *     label, abbr, abilityId,
     *     kind, key,
     *     saveType    // for saves only: 'per_ability' | 'categorical'
     *   }
     * or null when v1 data is missing or the label doesn't classify.
     */
    function v1CheckContextFor(rollType) {
        const v = gd()._v1;
        if (!v || !v.character || !v.rules) return null;
        const cls = classifyV1Check(rollType);
        if (!cls) return null;
        const items = v1ItemsIndex();
        const rules = v.rules;
        const checksCfg = (rules.resolution && rules.resolution.checks) || {};
        const adEnabled = !!checksCfg.advantage_disadvantage;
        const critSuccessOn = checksCfg.crit_success || null;
        const critFailureOn = checksCfg.crit_failure || null;

        if (cls.kind === 'ability' || cls.kind === 'skill') {
            const inp = RulesEngine.checkInputsFor(v.character, rules, items, cls.kind, cls.key);
            if (!inp) return null;
            return {
                method: inp.method, modifier: inp.modifier, target: inp.target,
                adEnabled: inp.adEnabled, critSuccessOn: inp.critSuccessOn, critFailureOn: inp.critFailureOn,
                label: inp._label, abbr: inp._abbr,
                abilityId: inp._abilityId,
                kind: cls.kind, key: cls.key
            };
        }

        if (cls.kind === 'save-per-ability') {
            const inp = RulesEngine.checkInputsFor(v.character, rules, items, 'ability', cls.key);
            if (!inp) return null;
            // Saves add proficiency + magic.save_bonus on top of the ability mod.
            const magic = RulesEngine.sumMagicBonuses(v.character, items).saveBonus || {};
            const blanket = Number(magic.all) || 0;
            const profs = (v.character.saves && v.character.saves.proficient) || [];
            const prof = Array.isArray(profs) && profs.includes(cls.key)
                ? RulesEngine.proficiencyBonusFor(v.character, rules) : 0;
            const saveBonus = blanket + (Number(magic[cls.key]) || 0);
            return {
                method: inp.method,
                modifier: (inp.modifier || 0) + prof + saveBonus,
                target: null,
                adEnabled, critSuccessOn, critFailureOn,
                label: `${inp._abbr} save`,
                abbr: inp._abbr,
                abilityId: inp._abilityId,
                kind: 'save',
                key: cls.key,
                saveType: 'per_ability'
            };
        }

        if (cls.kind === 'save-categorical') {
            const values = (v.character.saves && v.character.saves.values) || {};
            const base = Number(values[cls.key]);
            if (!Number.isFinite(base)) return null;
            const magic = RulesEngine.sumMagicBonuses(v.character, items).saveBonus || {};
            const blanket = Number(magic.all) || 0;
            const target = base + blanket + (Number(magic[cls.key]) || 0);
            return {
                method: checksCfg.method === 'roll_under_score' ? 'roll_under_score' : 'roll_high_vs_dc',
                modifier: 0,
                target,
                adEnabled, critSuccessOn, critFailureOn,
                label: `${cls.name || cls.key} save`,
                abbr: (cls.name || cls.key).slice(0, 3).toUpperCase(),
                abilityId: null,
                kind: 'save',
                key: cls.key,
                saveType: 'categorical'
            };
        }
        return null;
    }

    /**
     * Find the v1 items-library entry for the player's currently-fighting
     * weapon. Prefers gs().readiedWeaponName when the name matches an
     * equipped (or packed) item; falls back to the first equipped weapon.
     * Returns null when no v1 character data is available.
     */
    function findV1Weapon() {
        const v = gd()._v1;
        if (!v || !v.character) return null;
        const items = v1ItemsIndex();
        const readied = (gs().readiedWeaponName || '').toLowerCase();
        const tryMatch = (entries) => {
            for (const e of (entries || [])) {
                const it = items[e.item_id];
                if (!it || !it.weapon) continue;
                if (readied && it.name && it.name.toLowerCase() === readied) return it;
            }
            return null;
        };
        const equippedHit = tryMatch(v.character.equipment);
        if (equippedHit) return equippedHit;
        const packHit = tryMatch(v.character.pack);
        if (packHit) return packHit;
        // Fallback: first equipped weapon.
        for (const e of (v.character.equipment || [])) {
            const it = items[e.item_id];
            if (it && it.weapon) return it;
        }
        return null;
    }

    /**
     * Stage 3c callout helper: build a readable multi-line damage callout
     * from the engine's computeDamage output. Surfaces the dice face, the
     * modifier, crit doubling, the magic rider, resistance/immunity/vuln
     * multipliers, and the grand total. Called from the 'damage' branch
     * below when the engine path fires.
     */
    function formatEngineDamageCallout(engineInputs, pendingAtk, damage, diceFaceRoll, bonusDiceFace) {
        const signed = (n) => (n >= 0 ? '+ ' + n : '- ' + Math.abs(n));
        const isCritDouble = pendingAtk.isCrit && engineInputs.critEffect === 'double_dice';
        const lines = [];

        // Weapon line:
        //   No crit, no mod:   "Damage Roll 1d8: 7 slashing"
        //   No crit, +mod:     "Damage Roll 1d8: 7 (+ 3) = 10 slashing"
        //   Crit, +mod:        "Damage Roll 1d8: 7 ×2 = 14 (+ 3) = 17 slashing"
        //   Crit, no mod:      "Damage Roll 1d8: 7 ×2 = 14 slashing"
        const dmgBonus = engineInputs.damageBonus || 0;
        const c0 = damage.components[0];
        const weaponType = c0.type ? ` ${c0.type}` : '';
        const doubledDice = isCritDouble ? diceFaceRoll * 2 : diceFaceRoll;
        let weaponLine;
        if (isCritDouble && dmgBonus !== 0) {
            weaponLine = `Damage Roll ${engineInputs.damageFormula}: ${diceFaceRoll} ×2 = ${doubledDice} (${signed(dmgBonus)}) = ${c0.amount}${weaponType}`;
        } else if (isCritDouble) {
            weaponLine = `Damage Roll ${engineInputs.damageFormula}: ${diceFaceRoll} ×2 = ${c0.amount}${weaponType}`;
        } else if (dmgBonus !== 0) {
            weaponLine = `Damage Roll ${engineInputs.damageFormula}: ${diceFaceRoll} (${signed(dmgBonus)}) = ${c0.amount}${weaponType}`;
        } else {
            weaponLine = `Damage Roll ${engineInputs.damageFormula}: ${diceFaceRoll}${weaponType}`;
        }
        lines.push(weaponLine);
        if (c0.multiplier !== 1) {
            const mulLabel = c0.multiplier === 0 ? 'immune — 0' : `×${c0.multiplier} = ${c0.applied}`;
            lines.push(`  ${c0.type || 'damage'} ${mulLabel}`);
        }

        // Bonus-damage line (magic rider). Riders don't carry a flat modifier
        // in v1, so the format is simpler:
        //   No crit:   "Bonus 1d4 radiant: 4"
        //   Crit:      "Bonus 1d4 radiant: 4 ×2 = 8"
        if (damage.components[1]) {
            const c1 = damage.components[1];
            const bonusType = c1.type ? ` ${c1.type}` : '';
            const riderFace = (typeof bonusDiceFace === 'number' && bonusDiceFace > 0)
                ? bonusDiceFace
                : (c1.rolls && c1.rolls.length ? c1.rolls.reduce((s, r) => s + r, 0) : c1.amount);
            const riderFormula = c1.formula || (engineInputs.bonusDamage && engineInputs.bonusDamage.amount) || 'damage';
            const riderLine = isCritDouble
                ? `Bonus ${riderFormula}${bonusType}: ${riderFace} ×2 = ${c1.amount}`
                : `Bonus ${riderFormula}${bonusType}: ${c1.amount}`;
            lines.push(riderLine);
            if (c1.multiplier !== 1) {
                const mulLabel = c1.multiplier === 0 ? 'immune — 0' : `×${c1.multiplier} = ${c1.applied}`;
                lines.push(`  ${c1.type || 'damage'} ${mulLabel}`);
            }
        }

        // Total line — only when there's more than one component or a multiplier.
        const needsTotal = damage.components.length > 1 || damage.components.some(c => c.multiplier !== 1);
        if (needsTotal) lines.push(`Total: ${damage.total} damage`);

        return lines.join('\n');
    }
    function buildAttackInputsForCurrentFight(monster, targetAC) {
        const v = gd()._v1;
        const weapon = findV1Weapon();
        if (v && v.character && v.rules && weapon) {
            const resist = (monster && monster.damage_resistance)  || null;
            const immune = (monster && monster.damage_immunity)    || null;
            const vuln   = (monster && monster.damage_vulnerability) || null;
            return RulesEngine.attackInputsFor(v.character, v.rules, v1ItemsIndex(), weapon, targetAC, resist, immune, vuln);
        }
        // Legacy fallback: read the shimmed attack/damage modifiers.
        const weaponObj = getReadiedWeaponObject();
        const atkMod = getAttackModifierForRoll('attack');
        const dmg    = getEquippedWeaponDamage();
        return {
            attackBonus:   (atkMod && atkMod.modifier) || 0,
            damageFormula: (weaponObj && weaponObj.damage) || '1d4',
            damageBonus:   dmg.modifier,
            damageType:    (weaponObj && weaponObj.damage_type) || null,
            targetAC:      Number(targetAC) || 10,
            critThreshold: 20,
            critEffect:    'double_dice',
            bonusDamage:   null,
            resistance:    null, immunity: null, vulnerability: null,
            _weaponName:   (weaponObj && weaponObj.name) || 'weapon',
            _isRanged:     isRangedWeapon(weaponObj)
        };
    }

    /** Get weapon type (melee/ranged) and range. Works on character equipment or monster attack. */
    function getWeaponTypeInfo(weapon) {
        if (!weapon) return { type: 'melee', range: null };
        const name = (weapon.name || '').toLowerCase();
        const props = Array.isArray(weapon.properties) ? weapon.properties.join(' ') : (weapon.properties || '');
        const propsLower = props.toLowerCase();
        // Explicit range field (e.g. monster attacks)
        if (weapon.range) {
            const r = String(weapon.range).toLowerCase();
            if (r === 'melee') return { type: 'melee', range: null };
            return { type: 'ranged', range: weapon.range };
        }
        // From properties: "range 80/320" or "range 30/120"
        const rangeMatch = props.match(/range\s+(\d+(?:\/\d+)?)/i);
        if (rangeMatch) return { type: 'ranged', range: rangeMatch[1] };
        // Ammunition property implies ranged
        if (/ammunition/.test(propsLower)) return { type: 'ranged', range: 'see properties' };
        // Name-based
        if (/bow|crossbow|sling|dart|thrown/.test(name)) {
            const m = props.match(/range\s+(\d+(?:\/\d+)?)/i);
            return { type: 'ranged', range: m ? m[1] : 'see properties' };
        }
        return { type: 'melee', range: null };
    }
    
    /** Get the readied weapon object (for name, damage_type, melee/ranged). */
    function getReadiedWeaponObject() {
        const fromState = (gs().character.equipment || []).filter(e => e.isWeapon && e.damage);
        const fromData = gd().character && gd().character.equipment
            ? [...(gd().character.equipment.wielded || []), ...(gd().character.equipment.carried || [])]
            : [];
        const sources = [...fromState, ...fromData];
        const weapons = sources.filter(w => w.damage);
        if (!weapons.length) return null;
        const readied = gs().readiedWeaponName;
        let weapon = readied ? weapons.find(w => w.name && w.name.toLowerCase() === readied.toLowerCase()) : null;
        if (!weapon) weapon = weapons.find(w => w.equipped) || weapons[0];
        return weapon;
    }

    /** Get readied weapon damage: dice and modifier (STR for melee, DEX for ranged). Uses gs() equipment first (includes found/bought weapons). */
    function getEquippedWeaponDamage() {
        const weapon = getReadiedWeaponObject();
        if (!weapon) return { dice: '1d8', modifier: gs().character.abilities.str.modifier, label: '1d8', count: 1, sides: 8 };
        const useDex = isRangedWeapon(weapon);
        const mod = useDex ? gs().character.abilities.dex.modifier : gs().character.abilities.str.modifier;
        return parseWeaponDice(weapon.damage, mod);
    }
    
    /** Resolve dice for a roll request. Returns { type:'weapon'|'custom'|'d20', ... } */
    function getDiceForRollRequest(rollType) {
        const rawTrimmed = (rollType || '').trim();
        // Strip advantage/disadvantage suffix for classification; remember the flag.
        const adSplit = stripAdvantageSuffix(rawTrimmed);
        const base = adSplit.base;
        const t = base.toLowerCase();
        if (t === 'damage') {
            return { type: 'weapon', label: getEquippedWeaponDamage().label };
        }
        // Custom dice: 2d4+2, 1d6, 3d8+1, 1d6-1, etc.
        const diceMatch = t.match(/^(\d+)d(\d+)(?:([+-])(\d+))?$/i);
        if (diceMatch) {
            const count = parseInt(diceMatch[1]);
            const sides = parseInt(diceMatch[2]);
            const modifier = diceMatch[4] ? (diceMatch[3] === '-' ? -parseInt(diceMatch[4]) : parseInt(diceMatch[4])) : 0;
            const modStr = modifier ? (modifier >= 0 ? '+' + modifier : String(modifier)) : '';
            return {
                type: 'custom',
                count: count,
                sides: sides,
                modifier,
                label: `${count}d${sides}${modStr}`,
                minFace: count,
                maxFace: count * sides
            };
        }
        // Healing: lookup from character or use default 2d4+2
        if (t === 'healing' || t === 'healing potion' || t === 'healingpotion') {
            const backpack = gd().character?.equipment?.backpack || [];
            const potion = backpack.find(i => (i.name || '').toLowerCase().includes('healing') && (i.effect || '').includes('d'));
            if (potion && potion.effect) {
                const m = potion.effect.match(/(\d+)d(\d+)(?:\+(\d+))?/i);
                if (m) {
                    const count = parseInt(m[1]);
                    const sides = parseInt(m[2]);
                    const modifier = m[3] ? parseInt(m[3]) : 0;
                    const modStr = modifier ? (modifier >= 0 ? '+' + modifier : String(modifier)) : '';
                    return {
                        type: 'custom',
                        count, sides, modifier,
                        label: `${count}d${sides}${modStr}`,
                        minFace: count,
                        maxFace: count * sides
                    };
                }
            }
            return {
                type: 'custom',
                count: 2, sides: 4, modifier: 2,
                label: '2d4+2',
                minFace: 2,
                maxFace: 8
            };
        }
        // d20 for abilities/skills/saves. Stage 4: attach the v1 check context
        // (method, modifier or target, adv/disadv gating) so showDiceSection
        // and processDiceRoll can branch on roll-high vs roll-under without
        // re-classifying the label later.
        const v1Check = v1CheckContextFor(base);
        const advantage = adSplit.advantage && (!v1Check || v1Check.adEnabled);
        const disadvantage = adSplit.disadvantage && (!v1Check || v1Check.adEnabled);
        return {
            type: 'd20',
            ability: base,
            advantage,
            disadvantage,
            v1Check
        };
    }

    /** Parse "1d8" or "2d6" and return { dice, modifier, label } for display and rolling. */
    function parseWeaponDice(diceStr, modifier) {
        const match = (diceStr || '1d8').match(/^(\d+)d(\d+)$/i);
        const count = match ? parseInt(match[1], 10) : 1;
        const sides = match ? parseInt(match[2], 10) : 8;
        const modifierNum = typeof modifier === 'number' ? modifier : 0;
        const modStr = modifierNum >= 0 ? '+' + modifierNum : String(modifierNum);
        return {
            dice: diceStr || '1d8',
            count,
            sides,
            modifier: modifierNum,
            label: (count === 1 ? '1d' + sides : count + 'd' + sides) + (modifierNum !== 0 ? modStr : '')
        };
    }
    
    /** Roll weapon damage (e.g. 1d8+3 or 2d6+2). If isCriticalHit, dice total is doubled then modifier added. Returns { total, breakdown } for display. */
    function rollWeaponDamage(isCriticalHit = false) {
        const w = getEquippedWeaponDamage();
        const rolls = [];
        let diceTotal = 0;
        for (let i = 0; i < w.count; i++) {
            const r = Math.floor(Math.random() * w.sides) + 1;
            rolls.push(r);
            diceTotal += r;
        }
        const modStr2 = w.modifier >= 0 ? ` + ${w.modifier}` : ` - ${Math.abs(w.modifier)}`;
        const diceExpr = w.count === 1 ? `1d${w.sides}` : `${w.count}d${w.sides}`;
        const rollsStr = rolls.join(' + ');
        let total, breakdown;
        if (isCriticalHit) {
            const doubled = diceTotal * 2;
            total = doubled + w.modifier;
            breakdown = w.modifier !== 0
                ? `${diceExpr} (${rollsStr}) → crit: ${diceTotal}×2${modStr2} = ${total}`
                : `${diceExpr} (${rollsStr}) → crit: ${diceTotal}×2 = ${total}`;
        } else {
            total = diceTotal + w.modifier;
            breakdown = w.modifier !== 0
                ? `${diceExpr} (${rollsStr})${modStr2} = ${total}`
                : `${diceExpr} (${rollsStr}) = ${total}`;
        }
        return { total, breakdown, diceTotal };
    }

    /** True if this d20 roll context is for an attack roll (affects crit success → double damage; crit failure → auto-miss). */
    function isAttackRoll(diceCtx) {
        if (!diceCtx || diceCtx.type !== 'd20') return false;
        const key = (diceCtx.ability || '').toLowerCase().trim();
        if (/\battack\b|\bto hit\b|\bhit\b|\bmelee\b|\branged\b/.test(key)) return true;
        if (gs().inCombat && /^(strength|str|dexterity|dex)$/.test(key)) return true;
        return false;
    }

    // ============================================
    // DICE ROLLING
    // ============================================
    
    /** Infer roll context type for mechanics callout (Section 2). */
    function inferRollContextType(abilityStr) {
        const a = (abilityStr || '').toLowerCase().trim();
        if (a === 'damage' || a.includes('damage')) return 'damage';
        if (a.includes('attack') || a === 'melee attack' || a === 'ranged attack') return 'attack';
        return 'ability';
    }

    function showDiceSection(prompt = "Roll requested:", rollType = null) {
        const diceSection = document.getElementById('diceSection');
        const rollPrompt = document.getElementById('rollPrompt');
        const rollBtn = document.getElementById('rollBtn');
        const diceInput = document.getElementById('diceInput');
        const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);
        
        const rt = rollType || (prompt.match(/Roll\s+(.+?)(?::|$)/i)?.[1]?.trim() || '');
        const dice = getDiceForRollRequest(rt);
        const contextType = inferRollContextType(rt);
        
        if (dice.type === 'weapon') {
            const w = getEquippedWeaponDamage();
            const diceExpr = w.count === 1 ? `1d${w.sides}` : `${w.count}d${w.sides}`;
            const isCrit = gs().lastD20Natural === 20 && gs().lastRollWasAttack;
            const modLabel = w.modifier !== 0 ? signed(w.modifier) : '';
            if (isCrit) {
                rollPrompt.textContent = `Critical hit! Roll for Damage (${diceExpr}${w.modifier !== 0 ? ` ${modLabel}` : ''}) — result is doubled.`;
                rollBtn.textContent = `Roll ${diceExpr}${modLabel ? ` (${modLabel})` : ''}`;
            } else {
                rollPrompt.textContent = `Roll for Damage (${diceExpr}${w.modifier !== 0 ? ` ${modLabel}` : ''}).`;
                rollBtn.textContent = `Roll ${diceExpr}${modLabel ? ` (${modLabel})` : ''}`;
            }
            diceInput.placeholder = `1-${w.count * w.sides}`;
            diceInput.min = String(w.count);
            diceInput.max = String(w.count * w.sides);
        } else if (dice.type === 'custom') {
            const diceExpr = dice.count === 1 ? `1d${dice.sides}` : `${dice.count}d${dice.sides}`;
            const modLabel = dice.modifier !== 0 ? signed(dice.modifier) : '';
            rollPrompt.textContent = `Roll ${diceExpr}${modLabel ? ` (${modLabel})` : ''}.`;
            rollBtn.textContent = `Roll ${diceExpr}${modLabel ? ` (${modLabel})` : ''}`;
            diceInput.placeholder = `${dice.minFace}-${dice.maxFace}`;
            diceInput.min = String(dice.minFace);
            diceInput.max = String(dice.maxFace);
        } else {
            const isAttack = contextType === 'attack';
            const advantage    = !!dice.advantage;
            const disadvantage = !!dice.disadvantage;
            const advLabel = advantage ? ' (advantage)' : disadvantage ? ' (disadvantage)' : '';
            const rollBtnBase = advantage || disadvantage ? 'Roll 2d20' : 'Roll 1d20';
            if (isAttack) {
                const atk = getAttackModifierForRoll(rt);
                const abilityInfo = getAbilityModifierForRoll(dice.ability);
                const totalMod = atk ? atk.modifier : (abilityInfo ? abilityInfo.modifier : 0);
                const labelPart = atk && atk.label ? atk.label : (abilityInfo && abilityInfo.label ? abilityInfo.label : '');
                const modStr = signed(totalMod);
                rollPrompt.textContent = labelPart ? `Roll for Attack (1d20 ${labelPart})${advLabel}.` : `Roll for Attack (1d20 ${modStr})${advLabel}.`;
                rollBtn.textContent = `${rollBtnBase} (${modStr})`;
            } else if (dice.v1Check) {
                // Stage 4: v1 path. Prompt / button render method-aware labels.
                const ctx = dice.v1Check;
                if (ctx.method === 'roll_under_score') {
                    rollPrompt.textContent = `Roll for ${ctx.label} (1d20 ≤ ${ctx.target})${advLabel}.`;
                    rollBtn.textContent = `${rollBtnBase} (≤ ${ctx.target})`;
                } else {
                    const modStr = signed(ctx.modifier || 0);
                    rollPrompt.textContent = `Roll for ${ctx.label} (1d20 ${modStr})${advLabel}.`;
                    rollBtn.textContent = `${rollBtnBase} (${modStr})`;
                }
            } else {
                // Pre-Stage-4 fallback: legacy shim path. Reads the character
                // sheet's pre-computed modifiers via the inline getAbilityModifierForRoll.
                const abilityInfo = getAbilityModifierForRoll(dice.ability);
                const modStr = abilityInfo && abilityInfo.modifier != null ? signed(abilityInfo.modifier) : '';
                const label = (abilityInfo && abilityInfo.label) || (rt || 'Ability Check');
                rollPrompt.textContent = `Roll for ${label} (1d20${modStr ? ` ${modStr}` : ''})${advLabel}.`;
                rollBtn.textContent = `${rollBtnBase} (${modStr || '0'})`;
            }
            diceInput.placeholder = '1-20';
            diceInput.min = '1';
            diceInput.max = '20';
        }
        
        diceSection.classList.add('active');
        gs().waitingForRoll = true;
        gs().pendingRollContext = { dice, rollType: contextType, abilityName: rt };
        disableInput(true);
    }

    function hideDiceSection() {
        const diceSection = document.getElementById('diceSection');
        diceSection.classList.remove('active');
        gs().waitingForRoll = false;
        gs().pendingRollContext = null;
        disableInput(false);
        // Stage 4: if a hazard queue was waiting on this roll to finish, kick
        // it off. Defer a tick so the DOM settles and any pending call chain
        // (addMechanicsCallout / callAIGM) reaches its idle state first.
        if (global.UI && global.UI.hazards && global.UI.hazards.advanceQueue) {
            setTimeout(() => {
                if (gs().waitingForRoll || gs().activeHazard) return;
                if (gs().hazardQueue && gs().hazardQueue.length) {
                    global.UI.hazards.advanceQueue();
                }
            }, 0);
        }
    }

    function getProficiencyBonus() {
        return (gd().character && gd().character.combat_stats && typeof gd().character.combat_stats.proficiency_bonus === 'number')
            ? gd().character.combat_stats.proficiency_bonus
            : 0;
    }

    /** Attack rolls use ability modifier + proficiency (melee: STR, ranged: DEX). Condition penalties are applied automatically. */
    function getAttackModifierForRoll(rollKey) {
        const key = (rollKey || '').toLowerCase();
        const char = gs().character;
        if (!char || !char.abilities) return null;
        let useDex = false;
        if (/\branged\b/.test(key)) {
            useDex = true;
        } else if (/\bmelee\b/.test(key)) {
            useDex = false;
        } else {
            // Generic "attack": infer from readied weapon when possible
            const sources = gd().character && gd().character.equipment
                ? [...(gd().character.equipment.wielded || []), ...(gd().character.equipment.carried || [])]
                : [];
            const weapons = sources.filter(w => w.damage);
            const readied = gs().readiedWeaponName;
            let weapon = readied ? weapons.find(w => w.name && w.name.toLowerCase() === readied.toLowerCase()) : null;
            if (!weapon) weapon = weapons.find(w => w.equipped) || weapons[0];
            useDex = isRangedWeapon(weapon);
        }
        const abilityMod = useDex ? char.abilities.dex.modifier : char.abilities.str.modifier;
        const prof = getProficiencyBonus();
        const abilityLabel = useDex ? 'DEX' : 'STR';
        const baseMod = abilityMod + prof;
        const conditionMod = getConditionModifierForRoll(true, null);
        const totalMod = baseMod + conditionMod;
        const conditionLabel = conditionMod !== 0 ? ` (conditions ${conditionMod >= 0 ? '+' : ''}${conditionMod})` : '';
        return {
            modifier: totalMod,
            label: `Attack (${abilityLabel} ${abilityMod >= 0 ? '+' : ''}${abilityMod}, Prof +${prof}${conditionLabel})`
        };
    }

    /** Map roll request to modifier for display: use skill modifier if it's a skill, else ability. Condition penalties are applied automatically. */
    function getAbilityModifierForRoll(abilityName) {
        if (!abilityName || !gs().character) return null;
        const key = abilityName.toLowerCase().trim();
        const char = gs().character;
        // Explicit attack requests always include proficiency.
        if (/\battack\b|\bto hit\b|\bhit\b/.test(key)) {
            return getAttackModifierForRoll(key);
        }
        // In combat, Strength/Dexterity roll requests are usually attack rolls from GM flow.
        if (gs().inCombat && (key === 'strength' || key === 'str' || key === 'dexterity' || key === 'dex')) {
            return getAttackModifierForRoll(key.includes('dex') ? 'ranged attack' : 'melee attack');
        }
        if (char.skills && typeof char.skills[key] === 'number') {
            const label = abilityName.charAt(0).toUpperCase() + abilityName.slice(1).toLowerCase();
            const conditionMod = getConditionModifierForRoll(false, null);
            const totalMod = char.skills[key] + conditionMod;
            const conditionLabel = conditionMod !== 0 ? ` (conditions ${conditionMod >= 0 ? '+' : ''}${conditionMod})` : '';
            return { modifier: totalMod, label: label + conditionLabel };
        }
        if (!char.abilities) return null;
        const keyMap = {
            strength: 'str', str: 'str', dex: 'dex', dexterity: 'dex',
            constitution: 'con', con: 'con', intelligence: 'int', int: 'int',
            wisdom: 'wis', wis: 'wis', charisma: 'cha', cha: 'cha'
        };
        const abKey = keyMap[key];
        if (!abKey || !char.abilities[abKey]) return null;
        const mod = char.abilities[abKey].modifier;
        const conditionMod = getConditionModifierForRoll(false, abKey);
        const totalMod = mod + conditionMod;
        const label = abilityName.charAt(0).toUpperCase() + abilityName.slice(1).toLowerCase();
        const conditionLabel = conditionMod !== 0 ? ` (conditions ${conditionMod >= 0 ? '+' : ''}${conditionMod})` : '';
        return { modifier: totalMod, label: label + conditionLabel };
    }

    function rollDice() {
        const ctx = gs().pendingRollContext?.dice;
        if (!ctx) return;
        if (ctx.type === 'weapon') {
            const isCrit = gs().lastD20Natural === 20 && gs().lastRollWasAttack;
            const result = rollWeaponDamage(isCrit);
            // Pass the raw dice sum (not `total`). processDiceRoll's weapon branch applies the modifier and crit doubling itself;
            // passing `total` would double-count the modifier.
            processDiceRoll(result.diceTotal, ctx, { damageBreakdown: result.breakdown, isCriticalHit: isCrit });
        } else if (ctx.type === 'custom') {
            const rolls = [];
            let sum = 0;
            for (let i = 0; i < ctx.count; i++) {
                const r = Math.floor(Math.random() * ctx.sides) + 1;
                rolls.push(r);
                sum += r;
            }
            const total = sum + ctx.modifier;
            const rollsStr = rolls.join(' + ');
            const modStr = ctx.modifier ? (ctx.modifier >= 0 ? ` + ${ctx.modifier}` : ` - ${Math.abs(ctx.modifier)}`) : '';
            const breakdown = ctx.modifier !== 0
                ? `${ctx.label} (${rollsStr})${modStr} = ${total}`
                : `${ctx.label} (${rollsStr}) = ${total}`;
            processDiceRoll(total, ctx, { customBreakdown: breakdown });
        } else {
            // Stage 4: adv/disadv rolls two d20s and picks the favored face.
            // For roll-high: advantage keeps the higher, disadvantage the lower.
            // For roll-under: advantage keeps the lower, disadvantage the higher.
            const method = (ctx.v1Check && ctx.v1Check.method) || 'roll_high_vs_dc';
            if (ctx.advantage || ctx.disadvantage) {
                const a = Math.floor(Math.random() * 20) + 1;
                const b = Math.floor(Math.random() * 20) + 1;
                const hi = Math.max(a, b), lo = Math.min(a, b);
                const picked = method === 'roll_under_score'
                    ? (ctx.advantage ? lo : hi)
                    : (ctx.advantage ? hi : lo);
                processDiceRoll(picked, ctx, { adRolls: [a, b], adKind: ctx.advantage ? 'advantage' : 'disadvantage' });
            } else {
                const d20 = Math.floor(Math.random() * 20) + 1;
                processDiceRoll(d20, ctx);
            }
        }
    }

    function submitDiceRoll() {
        const input = document.getElementById('diceInput');
        const roll = parseInt(input.value, 10);
        const min = parseInt(input.min || 1, 10);
        const max = parseInt(input.max || 20, 10);
        const ctx = gs().pendingRollContext?.dice;
        const isValid = !isNaN(roll) && roll >= min && roll <= max;
        
        if (isValid && ctx) {
            input.value = '';
            const opts = {};
            if (ctx.type === 'weapon' && gs().lastD20Natural === 20 && gs().lastRollWasAttack) opts.isCriticalHit = true;
            processDiceRoll(roll, ctx, opts);
        }
    }

    function processDiceRoll(roll, diceCtx, options = {}) {
        let message;
        let totalToSend;
        let rollMessageSuffix = '';
        const ctx = gs().pendingRollContext?.dice || diceCtx;
        const pendingCtx = gs().pendingRollContext;
        const rollType = (pendingCtx && pendingCtx.rollType) || inferRollContextType((pendingCtx && pendingCtx.abilityName) || '');
        if (!ctx) return;
        /** When the rules engine auto-resolves damage on an attack hit, we send a combined user message and suppress the normal "I rolled X" wording. */
        let autoResolvedMessage = null;
        
        if (ctx.type === 'weapon') {
            const isCrit = options.isCriticalHit || (gs().lastD20Natural === 20 && gs().lastRollWasAttack);
            const breakdown = options.damageBreakdown;
            const w = getEquippedWeaponDamage();
            const damageTotal = isCrit ? roll * 2 + w.modifier : roll + w.modifier;
            totalToSend = damageTotal;
            if (breakdown) {
                message = isCrit
                    ? `You rolled damage (critical hit): <span class="dice-roll">${breakdown}</span>`
                    : `You rolled damage: <span class="dice-roll">${breakdown}</span>`;
            } else {
                const modStr = w.modifier >= 0 ? ` + ${w.modifier}` : ` - ${Math.abs(w.modifier)}`;
                message = isCrit
                    ? `You rolled damage (critical hit): <span class="dice-roll">${roll} (dice)×2${w.modifier !== 0 ? modStr : ''} = ${damageTotal}</span>`
                    : `You rolled damage: <span class="dice-roll">${w.label} = ${roll} (manual)${w.modifier !== 0 ? modStr : ''} = ${damageTotal}</span>`;
            }
            if (isCrit) rollMessageSuffix = ' Critical hit damage.';
            gs().lastD20Natural = null;
            gs().lastRollWasAttack = false;
        } else if (ctx.type === 'custom') {
            const breakdown = options.customBreakdown;
            if (breakdown) {
                message = `You rolled ${ctx.label}: <span class="dice-roll">${breakdown}</span>`;
                totalToSend = roll + (ctx.modifier || 0);
            } else {
                totalToSend = roll + (ctx.modifier || 0);
                const modStr = ctx.modifier ? (ctx.modifier >= 0 ? ` + ${ctx.modifier}` : ` - ${Math.abs(ctx.modifier)}`) : '';
                message = `You rolled ${ctx.label}: <span class="dice-roll">${ctx.label} = ${roll} (manual)${modStr} = ${totalToSend}</span>`;
            }
        } else {
            gs().lastD20Natural = roll;
            gs().lastRollWasAttack = isAttackRoll(ctx);
            // Stage 4: v1 path. For roll-under packs `totalToSend` is just the
            // natural face; the rules pack compares it to the target. For roll-
            // high packs `totalToSend` is the natural + modifier as before.
            const v1Check = ctx && ctx.v1Check;
            if (v1Check) {
                const method = v1Check.method;
                const label = v1Check.label || (ctx.ability || 'check');
                const advSuffix = options.adKind ? ` (${options.adKind})` : '';
                const otherRoll = options.adRolls && options.adRolls.find(n => n !== roll);
                const adTrail = options.adRolls ? ` — rolled [${options.adRolls.join(', ')}] kept ${roll}` : '';
                if (method === 'roll_under_score') {
                    totalToSend = roll;
                    message = `You rolled d20${advSuffix}: <span class="dice-roll">${roll} (${label} ≤ ${v1Check.target})${adTrail}</span>`;
                } else {
                    const mod = v1Check.modifier || 0;
                    totalToSend = roll + mod;
                    const modStr = mod >= 0 ? ` + ${mod}` : ` - ${Math.abs(mod)}`;
                    message = `You rolled d20${advSuffix}: <span class="dice-roll">${roll}${mod !== 0 ? modStr : ''} (${label}) = ${totalToSend}${adTrail}</span>`;
                }
            } else {
                const abilityInfo = ctx.ability ? getAbilityModifierForRoll(ctx.ability) : null;
                if (abilityInfo != null && abilityInfo.modifier != null) {
                    totalToSend = roll + abilityInfo.modifier;
                    const modStr = abilityInfo.modifier >= 0 ? ` + ${abilityInfo.modifier}` : ` - ${Math.abs(abilityInfo.modifier)}`;
                    message = `You rolled d20: <span class="dice-roll">${roll} (${abilityInfo.label}${modStr}) = ${totalToSend}</span>`;
                } else {
                    totalToSend = roll;
                    message = `You rolled d20: <span class="dice-roll">${roll}</span>`;
                }
            }
            // Crit-success / crit-failure callouts are driven by the rules pack
            // in the v1 path; fall back to the nat-20 / nat-1 default otherwise.
            const critSucc = v1Check && v1Check.critSuccessOn;
            const critFail = v1Check && v1Check.critFailureOn;
            const matches = (label) => label === 'nat_20' ? roll === 20 : label === 'nat_1' ? roll === 1 : false;
            if (v1Check) {
                if (matches(critSucc)) rollMessageSuffix = ` Natural ${roll} (critical success).`;
                else if (matches(critFail)) rollMessageSuffix = ` Natural ${roll} (critical failure).`;
            } else {
                if (roll === 20) rollMessageSuffix = ' Natural 20 (critical success).';
                else if (roll === 1) rollMessageSuffix = ' Natural 1 (critical failure).';
            }
        }
        
        // Build mechanics callout (Section 2 format) and apply state from callouts
        const signed = (n) => (n >= 0 ? `+ ${n}` : `- ${Math.abs(n)}`);
        if (rollType === 'attack' && ctx.type !== 'weapon') {
            // Stage 3c: route the attack hit stage through RulesEngine.
            // The player has already rolled `roll` (the natural d20). We pass
            // it as naturalRoll so the engine evaluates hit/crit/fumble but
            // doesn't re-roll. Damage rolls happen on the next click (engine
            // handles that via computeDamage in the damage branch).
            const enc = getFirstActiveEncounterInCurrentRoom();
            const monster = enc ? resolveMonster(enc.monster_ref) : null;
            const ac = monster && (monster.ac != null) ? monster.ac
                : (gd().character && gd().character.combat_stats ? gd().character.combat_stats.armor_class : 13);

            const inputs = buildAttackInputsForCurrentFight(monster, ac);
            const result = RulesEngine.resolveAttack({ ...inputs, naturalRoll: roll });
            const isHit    = result.attack.hit;
            const isCrit   = result.attack.isCrit;
            const isFumble = result.attack.isFumble;
            totalToSend = result.attack.total;

            const weaponLabel = `${(inputs._weaponName || 'weapon').toLowerCase().replace(/\s+/g, ' ')}/${inputs._isRanged ? 'ranged' : 'melee'}`;
            const outcomeLabel = isHit ? (isCrit ? 'CRITICAL HIT' : 'HIT') : (isFumble ? 'FUMBLE' : 'MISS');
            const callout = `Attack Roll 1d20: ${roll} (${signed(inputs.attackBonus)}) = ${totalToSend} (${weaponLabel})\n${outcomeLabel}: ${totalToSend} vs AC ${ac}`;
            addMechanicsCallout(callout);

            if (isHit && enc && inputs._weaponName) {
                const mon = resolveMonster(enc.monster_ref);
                const encName = enc.name || (mon && mon.name) || 'Enemy';
                gs().pendingAttackResolution = {
                    encounterId: enc.id,
                    encounterName: encName,
                    attackTotal: totalToSend,
                    attackAC: ac,
                    isCrit,
                    // Stash engine inputs so the damage click can compose the damage call deterministically.
                    engineInputs: inputs
                };
                gs().lastD20Natural = roll;
                gs().lastRollWasAttack = true;
                showDiceSection('Roll Damage', 'Damage');
                return;
            } else if (!isHit) {
                autoResolvedMessage = `I attacked. Attack ${totalToSend} vs AC ${ac} — ${isFumble ? 'FUMBLE' : 'MISS'}. Narrate the ${isFumble ? 'fumble' : 'miss'}; do not request a damage roll.`;
            }
        } else if (rollType === 'damage' && (ctx.type === 'weapon' || ctx.type === 'custom')) {
            // Stage 3c: route chained damage through RulesEngine.computeDamage
            // using the cached attack inputs. For un-chained / custom damage
            // (e.g. healing potions, misc formulas), fall back to the pre-3c
            // inline math — those paths don't need resistance / bonus-damage.
            const atk  = gs().pendingAttackResolution;
            const pending = ctx.type === 'weapon' && atk && atk.engineInputs;
            const w          = ctx.type === 'weapon' ? getEquippedWeaponDamage() : null;
            const weaponObj  = ctx.type === 'weapon' ? getReadiedWeaponObject() : null;
            const isCritDmg  = options.isCriticalHit && ctx.type === 'weapon';
            let damageTypeStr = '';
            let totalDamage;
            let diceNatural;
            let engineDamage = null;
            if (pending) {
                const inputs = atk.engineInputs;
                engineDamage = RulesEngine.computeDamage({
                    damageFormula: inputs.damageFormula,
                    damageBonus:   inputs.damageBonus,
                    critEffect:    inputs.critEffect,
                    isCrit:        atk.isCrit,
                    bonusDamage:   inputs.bonusDamage,
                    damageType:    inputs.damageType,
                    resistance:    inputs.resistance,
                    immunity:      inputs.immunity,
                    vulnerability: inputs.vulnerability,
                    diceRolls:     [roll]
                });
                totalDamage = engineDamage.total;
                damageTypeStr = inputs.damageType || '';
                diceNatural   = atk.isCrit && inputs.critEffect === 'double_dice' ? roll * 2 : roll;
                totalToSend = totalDamage;
            } else {
                // Fallback path: no cached attack (legacy / custom dice / unchained damage).
                damageTypeStr = (weaponObj && weaponObj.damage_type) ? weaponObj.damage_type : (ctx.type === 'custom' ? '' : 'slashing');
                diceNatural = isCritDmg ? roll * 2 : roll;
                totalDamage = totalToSend; // totalToSend was computed in the weapon branch above
            }
            const diceExpr = pending
                ? atk.engineInputs.damageFormula
                : (w ? (w.count === 1 ? `1d${w.sides}` : `${w.count}d${w.sides}`) : (ctx.label || ''));
            const modVal = pending
                ? atk.engineInputs.damageBonus
                : (w ? w.modifier : (ctx.modifier || 0));

            let hpLine = '';
            let defeatedEncForReward = null;
            if (ctx.type === 'weapon') {
                const enc = getFirstActiveEncounterInCurrentRoom();
                if (enc) {
                    const hpBefore = getEncounterHP(enc).current;
                    gs().damageToEncounters[enc.id] = (gs().damageToEncounters[enc.id] || 0) + totalDamage;
                    gs().inCombat = true;
                    gs().mode = 'combat';
                    const hpInfo = getEncounterHP(enc);
                    const mon = resolveMonster(enc.monster_ref);
                    hpLine = `\n${enc.name || (mon && mon.name) || 'Enemy'}: HP ${Math.max(0, hpInfo.current)}/${hpInfo.max}`;
                    const room = gd().module && gd().module.rooms && gd().module.rooms[gs().currentRoom];
                    if (room && room.encounters && room.encounters.every(e => getEncounterHP(e).defeated)) {
                        gs().inCombat = false;
                        gs().mode = 'exploration';
                        gs().lastCombatRoom = gs().currentRoom;
                    }
                    updateCharacterDisplay();
                    if (hpBefore > 0 && hpInfo.defeated && enc.on_death) defeatedEncForReward = enc;
                }
            }
            const typeSuffix = damageTypeStr ? ` (${damageTypeStr})` : '';
            // Engine-driven damage → multi-line callout surfaces dice face,
            // modifier, crit doubling, magic rider, and resistance multiplier.
            // Fallback path (custom dice, unchained) keeps the classic one-liner.
            let callout;
            if (pending && engineDamage) {
                const riderFace = engineDamage.components[1] && engineDamage.components[1].rolls
                    ? engineDamage.components[1].rolls.reduce((s, r) => s + r, 0)
                    : null;
                const breakdown = formatEngineDamageCallout(atk.engineInputs, atk, engineDamage, roll, riderFace);
                callout = `${breakdown}${hpLine}`;
            } else {
                callout = `Damage Roll ${diceExpr}: ${diceNatural} (${signed(modVal)}) = ${totalDamage}${typeSuffix}${hpLine}`;
            }
            addMechanicsCallout(callout);
            // XP and treasure callout always after damage callout (Section 2.4)
            if (defeatedEncForReward) {
                const enc = defeatedEncForReward;
                const xp = enc.on_death.xp_award != null ? enc.on_death.xp_award : 0;
                let goldAmount = 0;
                if (enc.on_death.treasure && Array.isArray(enc.on_death.treasure)) {
                    for (const t of enc.on_death.treasure) {
                        if ((t.item || '').toLowerCase() === 'gold') {
                            goldAmount += typeof t.quantity === 'number' ? t.quantity : parseInt(t.quantity, 10) || 0;
                        } else {
                            addToInventory(t.item || 'Item', t.quantity || 1);
                        }
                    }
                }
                if (goldAmount > 0) addToInventory('Gold', goldAmount);
                if (xp > 0) addXP(xp);
                const charName = gs().character && gs().character.name ? gs().character.name : 'The character';
                const xpTreasureLine = goldAmount > 0
                    ? `${charName} gains ${xp} XP and discovers ${goldAmount} gold!`
                    : `${charName} gains ${xp} XP!`;
                addMechanicsCallout(xpTreasureLine);
            }
            saveGame();

            // Rules engine: if this damage roll was chained from an auto-resolved attack hit,
            // compose a combined user message so the GM narrates the full HIT+damage outcome in one turn.
            if (ctx.type === 'weapon' && gs().pendingAttackResolution) {
                const atk2 = gs().pendingAttackResolution;
                const enc = getFirstActiveEncounterInCurrentRoom()
                    || (gd().module && gd().module.rooms && gd().module.rooms[gs().currentRoom]
                        && (gd().module.rooms[gs().currentRoom].encounters || []).find(e => e.id === atk2.encounterId));
                const hpInfo = enc ? getEncounterHP(enc) : null;
                const status = hpInfo && hpInfo.defeated
                    ? `${atk2.encounterName} is defeated`
                    : hpInfo
                        ? `${atk2.encounterName} is still standing (${hpInfo.current}/${hpInfo.max} HP)`
                        : `${atk2.encounterName}`;
                const critNote = atk2.isCrit ? ' (critical hit)' : '';
                autoResolvedMessage = `I attacked ${atk2.encounterName}. Attack ${atk2.attackTotal} vs AC ${atk2.attackAC} — HIT${critNote} for ${totalDamage} damage. ${status}. The app has resolved the attack and applied damage; narrate the outcome and, if any enemy remains, proceed to the monster's turn.`;
                gs().pendingAttackResolution = null;
            }
        } else if (rollType === 'ability' && ctx.type !== 'weapon') {
            // Stage 4: v1 path emits method-aware callouts and, when the
            // engine can judge (roll-under with target, or any check with a
            // DC supplied by a hazard/feature flow), appends SUCCESS/FAILURE
            // both to the callout and to the message sent back to the GM.
            const v1Check = ctx && ctx.v1Check;
            if (v1Check) {
                const label = v1Check.label || 'Check';
                const adTrail = options.adRolls
                    ? ` (${options.adKind}: rolled [${options.adRolls.join(', ')}])`
                    : '';
                // Hazards / features (Stage 4c) stash dc on the pending
                // context so the engine can judge. Plain GM roll requests
                // leave dc unset and we report the total only.
                const dc = v1Check.dc != null ? Number(v1Check.dc) : null;
                const resolved = RulesEngine.resolveCheck({
                    method: v1Check.method,
                    modifier: v1Check.modifier || 0,
                    target: v1Check.target,
                    dc: Number.isFinite(dc) ? dc : undefined,
                    critSuccessOn: v1Check.critSuccessOn || undefined,
                    critFailureOn: v1Check.critFailureOn || undefined,
                    naturalRoll: roll
                });

                let callout;
                let rollMessageOverride = null;
                if (v1Check.method === 'roll_under_score') {
                    const outcomeWord = resolved.success ? 'SUCCESS' : 'FAILURE';
                    const critNote = resolved.isCrit ? ' (critical success)' : resolved.isFumble ? ' (critical failure)' : '';
                    callout = `${label}${adTrail}: rolled ${roll} ≤ ${v1Check.target} — ${outcomeWord}${critNote}`;
                    rollMessageOverride = `I rolled ${roll} (${label}, 1d20 ≤ ${v1Check.target}) — ${outcomeWord}${critNote}.`;
                } else {
                    const modStr = signed(v1Check.modifier || 0);
                    const headline = `${label} Roll 1d20${adTrail}: ${roll} (${modStr}) = ${resolved.total}`;
                    if (Number.isFinite(dc)) {
                        const outcomeWord = resolved.success ? 'SUCCESS' : 'FAILURE';
                        const critNote = resolved.isCrit ? ' (critical success)' : resolved.isFumble ? ' (critical failure)' : '';
                        callout = `${headline}\n${resolved.total} vs DC ${dc} — ${outcomeWord}${critNote}`;
                        rollMessageOverride = `I rolled ${resolved.total} (${label}, 1d20 ${modStr}) vs DC ${dc} — ${outcomeWord}${critNote}.`;
                    } else {
                        callout = `${headline}\nResult: ${resolved.total} (compare to DC in narrative)`;
                    }
                }
                addMechanicsCallout(callout);

                // Stash the rewritten message on pendingRollContext so the
                // rollMessage builder below picks it up. We avoid reusing
                // `autoResolvedMessage` here because that switch flips the
                // combat-flow prompt into the attack-resolved branch, which
                // mis-steers the GM for ability / skill / save rolls.
                if (rollMessageOverride) {
                    gs()._v1RollMessageOverride = rollMessageOverride;
                }
            } else {
                // Pre-Stage-4 fallback: legacy shim path with no v1 context.
                const abilityInfo = ctx.ability ? getAbilityModifierForRoll(ctx.ability) : null;
                const abLabel = (abilityInfo && abilityInfo.label) ? abilityInfo.label.replace(/\s*\(.*\)/, '').toUpperCase().slice(0, 3) : 'CHK';
                const modVal = abilityInfo && abilityInfo.modifier != null ? abilityInfo.modifier : 0;
                const callout = `Ability Roll 1d20: ${roll} (${signed(modVal)}) = ${totalToSend} (${abLabel})\nResult: ${totalToSend} (compare to DC in narrative)`;
                addMechanicsCallout(callout);
            }
        }
        
        // Mechanics callouts are sufficient; do not duplicate with system-message for attack/damage/ability
        const addedCallout = rollType === 'attack' || rollType === 'damage' || rollType === 'ability';
        if (!addedCallout) addSystemMessage(message);

        // Stage 4: if this roll was driven by a hazard (or later a feature),
        // the dispatcher owns the next step. Skip the GM round-trip.
        const hazardDispatch = ctx && ctx.hazardDispatch;
        if (hazardDispatch && rollType === 'ability') {
            hideDiceSection();
            const v1Check = ctx.v1Check || {};
            const resolved = RulesEngine.resolveCheck({
                method: v1Check.method || 'roll_high_vs_dc',
                modifier: v1Check.modifier || 0,
                target: v1Check.target,
                dc: v1Check.dc != null ? Number(v1Check.dc) : undefined,
                critSuccessOn: v1Check.critSuccessOn || undefined,
                critFailureOn: v1Check.critFailureOn || undefined,
                naturalRoll: roll
            });
            gs()._v1RollMessageOverride = null;
            if (global.UI && global.UI.hazards && global.UI.hazards.onCheckResolved) {
                global.UI.hazards.onCheckResolved(resolved, ctx);
            }
            return;
        }

        hideDiceSection();

        const v1RollMessage = gs()._v1RollMessageOverride || null;
        gs()._v1RollMessageOverride = null;
        const rollMessage = autoResolvedMessage
            || v1RollMessage
            || `I rolled a ${totalToSend != null ? totalToSend : roll}.${rollMessageSuffix}`;
        if (rollType === 'damage' && ctx.type === 'weapon') gs().lastUserMessageWasDiceRoll = true; // skip parsing monster damage from GM narrative (we applied it from callout)
        if (autoResolvedMessage) {
            // Attack auto-resolved (hit or miss): prompt uses 'resolved' branch — narrate, then monster turn.
            gs().lastUserRollType = 'resolved';
            gs().lastUserMessageWasDiceRoll = true;
        } else if (rollType === 'attack' || rollType === 'damage' || rollType === 'ability') {
            gs().lastUserRollType = rollType; // so next GM prompt can enforce combat step
        }
        gs().conversationHistory.push({
            role: "user",
            content: rollMessage
        });

        callAIGM();
    }

    global.UI = global.UI || {};
    global.UI.dice = {
        isRangedWeapon,
        getWeaponTypeInfo,
        getReadiedWeaponObject,
        getEquippedWeaponDamage,
        getDiceForRollRequest,
        parseWeaponDice,
        rollWeaponDamage,
        isAttackRoll,
        inferRollContextType,
        showDiceSection,
        hideDiceSection,
        getProficiencyBonus,
        getAttackModifierForRoll,
        getAbilityModifierForRoll,
        rollDice,
        submitDiceRoll,
        processDiceRoll
    };

    // Legacy globals for still-inline callers.
    global.isRangedWeapon            = isRangedWeapon;
    global.getWeaponTypeInfo         = getWeaponTypeInfo;
    global.getReadiedWeaponObject    = getReadiedWeaponObject;
    global.getEquippedWeaponDamage   = getEquippedWeaponDamage;
    global.getDiceForRollRequest     = getDiceForRollRequest;
    global.parseWeaponDice           = parseWeaponDice;
    global.rollWeaponDamage          = rollWeaponDamage;
    global.isAttackRoll              = isAttackRoll;
    global.inferRollContextType      = inferRollContextType;
    global.showDiceSection           = showDiceSection;
    global.hideDiceSection           = hideDiceSection;
    global.getProficiencyBonus       = getProficiencyBonus;
    global.getAttackModifierForRoll  = getAttackModifierForRoll;
    global.getAbilityModifierForRoll = getAbilityModifierForRoll;
    global.rollDice                  = rollDice;
    global.submitDiceRoll            = submitDiceRoll;
    global.processDiceRoll           = processDiceRoll;
})(typeof window !== 'undefined' ? window : globalThis);
