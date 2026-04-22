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
                const label = abilityInfo && abilityInfo.label ? abilityInfo.label : (rt || 'Check');
                rollPrompt.textContent = `Roll for Ability Check (1d20${modStr ? ` ${modStr}` : ''}).`;
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
            const enc = getFirstActiveEncounterInCurrentRoom();
            const monster = enc ? resolveMonster(enc.monster_ref) : null;
            const ac = monster && (monster.ac != null) ? monster.ac : (gd().character && gd().character.combat_stats ? gd().character.combat_stats.armor_class : 13);
            const hit = totalToSend >= ac;
            const weaponObj = getReadiedWeaponObject();
            const weaponLabel = weaponObj ? `${(weaponObj.name || 'weapon').toLowerCase().replace(/\s+/g, ' ')}/${isRangedWeapon(weaponObj) ? 'ranged' : 'melee'}` : 'melee';
            const modForCallout = (ctx.ability ? getAbilityModifierForRoll(ctx.ability) : getAttackModifierForRoll('attack'));
            const modVal = modForCallout && modForCallout.modifier != null ? modForCallout.modifier : 0;
            const callout = `Attack Roll 1d20: ${roll} (${signed(modVal)}) = ${totalToSend} (${weaponLabel})\n${hit ? 'HIT' : 'MISS'}: ${totalToSend} vs AC ${ac}`;
            addMechanicsCallout(callout);
            const forcedMiss = (roll === 1);
            const isHit = !forcedMiss && hit;

            // Rules engine: on a hit, prompt the player to roll damage (same UI as before), but stash the
            // attack context so the damage submission composes a single combined user message — no separate
            // GM round-trip between attack and damage. On a miss, send the miss to the GM immediately.
            if (isHit && enc && weaponObj) {
                const isCrit = roll === 20;
                const mon = resolveMonster(enc.monster_ref);
                const encName = enc.name || (mon && mon.name) || 'Enemy';
                gs().pendingAttackResolution = {
                    encounterId: enc.id,
                    encounterName: encName,
                    attackTotal: totalToSend,
                    attackAC: ac,
                    isCrit
                };
                // d20 tracking is what triggers the crit path in the damage branch; keep it set.
                gs().lastD20Natural = roll;
                gs().lastRollWasAttack = true;
                // Show the damage prompt directly; the player's damage click will then produce the combined GM message.
                showDiceSection('Roll Damage', 'Damage');
                return;
            } else if (!isHit) {
                autoResolvedMessage = `I attacked. Attack ${totalToSend} vs AC ${ac} — MISS. Narrate the miss; do not request a damage roll.`;
            }
        } else if (rollType === 'damage' && (ctx.type === 'weapon' || ctx.type === 'custom')) {
            const w = ctx.type === 'weapon' ? getEquippedWeaponDamage() : null;
            const weaponObj = ctx.type === 'weapon' ? getReadiedWeaponObject() : null;
            const damageType = (weaponObj && weaponObj.damage_type) ? weaponObj.damage_type : (ctx.type === 'custom' ? '' : 'slashing');
            const diceExpr = w ? (w.count === 1 ? `1d${w.sides}` : `${w.count}d${w.sides}`) : (ctx.label || '');
            const modVal = w ? w.modifier : (ctx.modifier || 0);
            const isCritDmg = options.isCriticalHit && ctx.type === 'weapon';
            const diceNatural = isCritDmg ? roll * 2 : roll;
            let hpLine = '';
            // Only apply damage to encounter for weapon rolls (not custom e.g. healing)
            let defeatedEncForReward = null; // used after damage callout so XP/treasure callout comes second
            if (ctx.type === 'weapon') {
                const enc = getFirstActiveEncounterInCurrentRoom();
                if (enc) {
                    const hpBefore = getEncounterHP(enc).current;
                    gs().damageToEncounters[enc.id] = (gs().damageToEncounters[enc.id] || 0) + totalToSend;
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
            const typeSuffix = damageType ? ` (${damageType})` : '';
            const callout = `Damage Roll ${diceExpr}: ${diceNatural} (${signed(modVal)}) = ${totalToSend}${typeSuffix}${hpLine}`;
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
                const atk = gs().pendingAttackResolution;
                const enc = getFirstActiveEncounterInCurrentRoom()
                    || (gd().module && gd().module.rooms && gd().module.rooms[gs().currentRoom]
                        && (gd().module.rooms[gs().currentRoom].encounters || []).find(e => e.id === atk.encounterId));
                const hpInfo = enc ? getEncounterHP(enc) : null;
                const status = hpInfo && hpInfo.defeated
                    ? `${atk.encounterName} is defeated`
                    : hpInfo
                        ? `${atk.encounterName} is still standing (${hpInfo.current}/${hpInfo.max} HP)`
                        : `${atk.encounterName}`;
                const critNote = atk.isCrit ? ' (critical hit)' : '';
                autoResolvedMessage = `I attacked ${atk.encounterName}. Attack ${atk.attackTotal} vs AC ${atk.attackAC} — HIT${critNote} for ${totalToSend} damage. ${status}. The app has resolved the attack and applied damage; narrate the outcome and, if any enemy remains, proceed to the monster's turn.`;
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
