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
     * Build engine inputs for the active attack: pulls the v1 character,
     * rules, items, and the target monster's defensive arrays. Falls back
     * to a legacy inline-math shape if v1 data isn't available (the shim
     * path, which the remaining pre-v1 consumers still live on).
     */
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
        const t = (rollType || '').trim().toLowerCase();
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
        // d20 for abilities/skills
        return { type: 'd20', ability: t };
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
            const abilityInfo = getAbilityModifierForRoll(dice.ability);
            const modStr = abilityInfo && abilityInfo.modifier != null ? signed(abilityInfo.modifier) : '';
            if (isAttack) {
                const atk = getAttackModifierForRoll(rt);
                const totalMod = atk ? atk.modifier : (abilityInfo ? abilityInfo.modifier : 0);
                const labelPart = atk && atk.label ? atk.label : (abilityInfo && abilityInfo.label ? abilityInfo.label : '');
                rollPrompt.textContent = labelPart ? `Roll for Attack (1d20 ${labelPart}).` : `Roll for Attack (1d20${modStr ? ` ${modStr}` : ''}).`;
                rollBtn.textContent = `Roll 1d20 (${signed(totalMod)})`;
            } else {
                // Prefer the ability/skill name from abilityInfo (e.g. "Dexterity",
                // "Perception"); fall back to the raw roll-type text, then to
                // the generic "Ability Check" when nothing else resolves.
                const label = (abilityInfo && abilityInfo.label) || (rt || 'Ability Check');
                rollPrompt.textContent = `Roll for ${label} (1d20${modStr ? ` ${modStr}` : ''}).`;
                rollBtn.textContent = `Roll 1d20 (${modStr || '0'})`;
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
            const d20 = Math.floor(Math.random() * 20) + 1;
            processDiceRoll(d20, ctx);
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
            const abilityInfo = ctx.ability ? getAbilityModifierForRoll(ctx.ability) : null;
            if (abilityInfo != null && abilityInfo.modifier != null) {
                totalToSend = roll + abilityInfo.modifier;
                const modStr = abilityInfo.modifier >= 0 ? ` + ${abilityInfo.modifier}` : ` - ${Math.abs(abilityInfo.modifier)}`;
                message = `You rolled d20: <span class="dice-roll">${roll} (${abilityInfo.label}${modStr}) = ${totalToSend}</span>`;
            } else {
                totalToSend = roll;
                message = `You rolled d20: <span class="dice-roll">${roll}</span>`;
            }
            if (roll === 20) rollMessageSuffix = ' Natural 20 (critical success).';
            else if (roll === 1) rollMessageSuffix = ' Natural 1 (critical failure).';
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
            let damageBreakdownText = '';
            if (pending) {
                const inputs = atk.engineInputs;
                const damage = RulesEngine.computeDamage({
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
                totalDamage = damage.total;
                damageBreakdownText = damage.breakdown;
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
            // When the engine produced a rich breakdown (bonus damage / resistance), surface it.
            // Otherwise emit the classic "NdM: natural ± mod = total" callout.
            const callout = (pending && damageBreakdownText && (damageBreakdownText.includes('+') || damageBreakdownText.includes('×')))
                ? `Damage: ${damageBreakdownText} = ${totalDamage}${typeSuffix}${hpLine}`
                : `Damage Roll ${diceExpr}: ${diceNatural} (${signed(modVal)}) = ${totalDamage}${typeSuffix}${hpLine}`;
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
            const abilityInfo = ctx.ability ? getAbilityModifierForRoll(ctx.ability) : null;
            const abLabel = (abilityInfo && abilityInfo.label) ? abilityInfo.label.replace(/\s*\(.*\)/, '').toUpperCase().slice(0, 3) : 'CHK';
            const modVal = abilityInfo && abilityInfo.modifier != null ? abilityInfo.modifier : 0;
            const callout = `Ability Roll 1d20: ${roll} (${signed(modVal)}) = ${totalToSend} (${abLabel})\nResult: ${totalToSend} (compare to DC in narrative)`;
            addMechanicsCallout(callout);
        }
        
        // Mechanics callouts are sufficient; do not duplicate with system-message for attack/damage/ability
        const addedCallout = rollType === 'attack' || rollType === 'damage' || rollType === 'ability';
        if (!addedCallout) addSystemMessage(message);
        hideDiceSection();
        
        const rollMessage = autoResolvedMessage || `I rolled a ${totalToSend != null ? totalToSend : roll}.${rollMessageSuffix}`;
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
