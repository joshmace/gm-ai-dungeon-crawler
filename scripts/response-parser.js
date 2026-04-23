/* AI Dungeon Crawler — ResponseParser
 *
 * Parses the GM's assistant text into state changes + display narration:
 *   - strips scene-directive tags
 *   - dispatches [COMBAT:], [MODE:], [CONDITION:], [MONSTER_ATTACK],
 *     [MONSTER_DEFEATED:], [MONSTER_FLED:], [DAMAGE_TO_PLAYER:],
 *     [HEAL_PLAYER:], [RESOURCE_USE:] (via explicit-state parser)
 *   - tries heuristic parses for room changes, combat starts, retreat,
 *     armor state, weapon switch, weapon away, pack-item use
 *   - updates encounter HP, combat flags, and player HP as control tags resolve
 *
 * Reads window.gameState and window.gameData through accessor shortcuts
 * (gs()/gd()). Calls still-inline / other-extracted helpers via globals:
 *   - Narrative:         addNarration, addMechanicsCallout, addSystemMessage,
 *                        addErrorMessage, parseSceneDirectives,
 *                        normalizeNarrativeFormatting, CONTROL_TAG_RE
 *   - Encounters:        resolveMonster, getFirstActiveEncounterInCurrentRoom,
 *                        getEncounterHP, ensureCombatRoomHasEncounters,
 *                        recordEncounterHistoryForRoom, updateMonsterPanel,
 *                        getExpectedRewardsForCurrentRoom, rollDiceFormula,
 *                        getMonsterAttackInfoForCurrentRoom,
 *                        getMonsterDamageFormulaForCurrentRoom,
 *                        getMonsterDamageFormulaFromAnyRoom
 *   - Character:         updateCharacterDisplay, getConditionInfo,
 *                        getConditionIdsFromRules, showDeathOverlay
 *   - Dice:              getReadiedWeaponObject, isRangedWeapon
 *   - State mutations:   modifyHP, addXP, addToInventory, removeFromInventory,
 *                        deductGold, addCondition, removeCondition,
 *                        processLevelUp, saveGame
 *   - Proxy:             (none)
 *   - Inline misc:       debugLog, disableInput
 *
 * Each function is exposed as a top-level global so still-inline callers
 * (submitAction via LLMProxy.callAIGM -> processAIResponse) keep working.
 *
 * Attaches to window.ResponseParser.
 */
(function (global) {
    'use strict';

    const gs = () => global.gameState;
    const gd = () => global.gameData;
    const doc = () => global.document;

    /** Merged v1 items index (module-scope overrides library) for magic-bonus lookups. */
    function v1ItemsIndexForParser() {
        const v = gd()._v1;
        if (!v) return {};
        const shared   = (v.items && v.items.items) || {};
        const modItems = (v.module && v.module.module_items && v.module.module_items.items) || {};
        return Object.assign({}, shared, modItems);
    }

    function processAIResponse(response) {
        debugLog('AI', 'Processing AI response');
        const previousRoom = gs().currentRoom;
        const previousCombat = gs().inCombat;
        
        // Parse optional scene directives and strip control tags from visible text.
        let scene = parseSceneDirectives(response);
        let monsterDamageAlreadyApplied = false;
        /** Deferred so display order is: GM block → callouts → outcome line (desired combat flow). */
        const pendingMonsterCallouts = [];
        let pendingMonsterOutcomeLine = null;

        // Monster attack: route through RulesEngine.resolveMonsterAttack so
        // the same math (d20 + bonus vs AC, damage with type-based resistance
        // / immunity / vulnerability) governs both sides. Defer adding callouts
        // until after GM narration so display order reads GM → callouts → outcome.
        if (/\[MONSTER_ATTACK\]/i.test(scene.cleanText)) {
            const enc = getFirstActiveEncounterInCurrentRoom();
            const monster = enc ? resolveMonster(enc.monster_ref) : null;
            const monsterName = enc ? (enc.name || (monster && monster.name) || 'Monster') : 'Monster';
            const playerAC = getEffectiveAC();

            // Pull the player's v1-equipped damage resistance/immunity/vulnerability arrays.
            const v = gd()._v1 || {};
            let playerResist = null, playerImmune = null, playerVuln = null;
            if (v.character && v.rules) {
                const items = v1ItemsIndexForParser();
                const magic = RulesEngine.sumMagicBonuses(v.character, items);
                playerResist = (magic.damageResist.length ? magic.damageResist : null);
                playerImmune = (magic.damageImmune.length ? magic.damageImmune : null);
                playerVuln   = (magic.damageVuln.length   ? magic.damageVuln   : null);
            }

            const inputs = RulesEngine.monsterAttackInputsFor(
                monster, 0, playerAC,
                playerResist, playerImmune, playerVuln
            );
            const weaponName = inputs._attackName || 'attack';
            const rangeLabel = inputs._range === 'melee' ? 'melee' : 'ranged';

            // Fallback: no bestiary attack declared — skip to a 1d6 default so we never crash.
            if (!inputs.damageFormula) inputs.damageFormula = '1d6';

            const result = RulesEngine.resolveMonsterAttack(inputs);
            const natural = result.attack.natural;
            const total   = result.attack.total;
            const bonus   = inputs.attackBonus;

            pendingMonsterCallouts.push(
                `Attack Roll 1d20: ${natural} (${bonus >= 0 ? '+' : ''}${bonus}) = ${total} (${weaponName}/${rangeLabel})`
            );
            pendingMonsterCallouts.push(
                result.attack.hit ? `HIT: ${total} vs AC ${playerAC}` : `MISS: ${total} vs AC ${playerAC}`
            );
            if (result.attack.hit) {
                const dmg = result.damage;
                const typeSuffix = inputs.damageType ? ` ${inputs.damageType}` : '';
                // Surface resistance/immunity in the callout when it actually moved the number.
                const breakdown = dmg.rawMultiplier === 1
                    ? `${inputs.damageFormula} = ${dmg.total}${typeSuffix}`
                    : dmg.rawMultiplier === 0
                        ? `${inputs.damageFormula} (${dmg.base})${typeSuffix} × 0 = 0 (immune)`
                        : `${inputs.damageFormula} (${dmg.base})${typeSuffix} × ${dmg.rawMultiplier} = ${dmg.total}`;
                pendingMonsterCallouts.push(`${monsterName}: ${breakdown} (to you)`);
                if (dmg.total > 0) modifyHP(-dmg.total);
                monsterDamageAlreadyApplied = true;
                pendingMonsterOutcomeLine = dmg.total > 0
                    ? 'The blow lands and wounds you. Your turn — what do you do?'
                    : 'The blow lands but your wards turn it aside. Your turn — what do you do?';
                debugLog('PARSE', `Monster attack hit; damage: ${breakdown}`);
            } else {
                pendingMonsterOutcomeLine = 'The attack misses. Your turn — what do you do?';
            }
            scene.cleanText = scene.cleanText.replace(/\[MONSTER_ATTACK\]/gi, '').replace(/\s+\./g, '.').replace(/\.\.+/g, '.').trim();
            if (monsterDamageAlreadyApplied) {
                scene.cleanText = scene.cleanText
                    .replace(/\s*for\s+\[MONSTER_DAMAGE\]\s*damage\.?/gi, '.')
                    .replace(/\[MONSTER_DAMAGE\]/gi, '')
                    .replace(/\s+\./g, '.')
                    .replace(/\.\.+/g, '.')
                    .trim();
            }
        }

        // Monster damage (when GM uses [MONSTER_DAMAGE] without [MONSTER_ATTACK]): compute and strip; defer callout.
        if (!monsterDamageAlreadyApplied && /\[MONSTER_DAMAGE\]/i.test(scene.cleanText)) {
            let formula = getMonsterDamageFormulaForCurrentRoom();
            if (!formula) formula = getMonsterDamageFormulaFromAnyRoom();
            if (!formula) {
                formula = '1d6';
                debugLog('PARSE', 'No monster damage formula found; using fallback 1d6');
            }
            const result = rollDiceFormula(formula);
            const enc = getFirstActiveEncounterInCurrentRoom();
            const monsterName = enc ? (enc.name || (resolveMonster(enc.monster_ref) && resolveMonster(enc.monster_ref).name) || 'Monster') : 'Monster';
            pendingMonsterCallouts.push(`${monsterName}: ${result.breakdown} (to you)`);
            modifyHP(-result.total);
            scene.cleanText = scene.cleanText
                .replace(/\s*for\s+\[MONSTER_DAMAGE\]\s*damage\.?/gi, '.')
                .replace(/\[MONSTER_DAMAGE\]/gi, '')
                .replace(/\s+\./g, '.')
                .replace(/\.\.+/g, '.')
                .trim();
            debugLog('PARSE', `Monster damage roll: ${result.breakdown}`);
        }
        const displayResponse = scene.cleanText
            .replace(/\[COMBAT:\s*(on|off|true|false|yes|no)\]/gi, '')
            .replace(/\[MODE:\s*(travel|exploration)\]/gi, '')
            .replace(/\[ROOM:\s*[a-z0-9_]+\]/gi, '')
            .replace(/\[FEATURE_SOLVED:\s*[a-z0-9_]+\]/gi, '')
            .replace(/\[(?:DAMAGE_TO_PLAYER|HEAL_PLAYER|DAMAGE_TO_MONSTER|MONSTER_DEFEATED|MONSTER_FLED):[^\]]*\]/gi, '')
            .trim();
        
        parseStateChanges(scene.cleanText);
        saveGame();
        
        const rollRequestPattern = /\[ROLL_REQUEST:\s*([^\]]+)\]/i;
        const match = displayResponse.match(rollRequestPattern);
        debugLog('CHECK', match
            ? `[ROLL_REQUEST:] present in GM response → "${match[1].trim()}"`
            : '[ROLL_REQUEST:] absent in GM response');

        if (gs().isDead) {
            const textToShow = displayResponse.replace(rollRequestPattern, '').trim() || displayResponse.trim();
            showDeathOverlay(textToShow);
            disableInput(true);
        } else if (match) {
            const ability = match[1].trim();
            const abilityLower = ability.toLowerCase();
            if (abilityLower === 'damage' || abilityLower.includes('attack')) {
                gs().inCombat = true;
                gs().mode = 'combat';
                ensureCombatRoomHasEncounters();
                if (abilityLower === 'damage' && !gs().readiedWeaponName) {
                    const sources = gd().character && gd().character.equipment
                        ? [...(gd().character.equipment.wielded || []), ...(gd().character.equipment.carried || [])]
                        : [];
                    const firstWeapon = sources.find(w => w.damage);
                    if (firstWeapon) {
                        gs().readiedWeaponName = firstWeapon.name;
                        updateCharacterDisplay();
                        debugLog('PARSE', `Readied weapon (default for damage roll): ${firstWeapon.name}`);
                    }
                }
            }
            const formattedResponse = displayResponse.replace(rollRequestPattern, '').trim();
            if (formattedResponse) addNarration(formattedResponse);
            showDiceSection(`Roll ${ability}:`, ability);
        } else {
            // Desired order: GM block first, then monster callouts, then outcome line.
            if (displayResponse) addNarration(displayResponse);
            for (const line of pendingMonsterCallouts) addMechanicsCallout(line);
            if (pendingMonsterOutcomeLine) addNarration(pendingMonsterOutcomeLine);
            disableInput(false);
        }

        // Stage 4: fire room-entry hazards when the room has changed during
        // this response. Runs AFTER narration / roll prompt so the designer
        // reads the GM's room description before the hazard UI appears.
        // We fire once with 'on_enter'; the dispatcher's synonym rule also
        // catches on_traverse hazards at room-entry time (Stage 5 refines
        // on_traverse once connection clicks become structured). Deferred a
        // tick so callAIGM's DOM writes settle first.
        const newRoom = gs().currentRoom;
        if (newRoom && newRoom !== previousRoom && global.UI && global.UI.hazards) {
            debugLog('HAZARD', `room change ${previousRoom} → ${newRoom}; triggering on_enter (on_traverse synonym)`);
            setTimeout(() => {
                global.UI.hazards.triggerHazards(newRoom, 'on_enter');
            }, 0);
        }
    }
    
    /** Parse "goblin takes 5 damage" / "hits the goblin for 5" and update tracked monster HP. Checks all rooms so we record damage even if currentRoom was wrong. */
    function parseMonsterDamage(text) {
        const rooms = gd().module && gd().module.rooms;
        if (!rooms) return;
        if (!gs().damageToEncounters) gs().damageToEncounters = {};
        let roomWithUpdate = null;
        for (const [roomId, room] of Object.entries(rooms)) {
            if (!room || !room.encounters || room.encounters.length === 0) continue;
            for (const enc of room.encounters) {
                const monster = resolveMonster(enc.monster_ref);
                if (!monster) continue;
                // Match encounter name, monster name, and first word of monster (e.g. "goblin" from "Goblin Warrior") so "the goblin takes 8 damage" parses.
                const nameList = [enc.name, monster.name].filter(Boolean);
                const firstWord = (monster.name || '').split(/\s+/)[0];
                if (firstWord && !nameList.includes(firstWord)) nameList.push(firstWord);
                // When using a generic short name (first word), only match in current room so we don't apply damage to same-named monsters in other rooms.
                if (firstWord && nameList.includes(firstWord) && roomId !== gs().currentRoom) continue;
                const escapedNames = nameList.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
                if (!escapedNames) continue;
                const patterns = [
                    new RegExp(`(?:the\\s+)?(?:${escapedNames})\\s+takes\\s+(\\d+)\\s+(?:damage|HP)?`, 'gi'),
                    new RegExp(`(?:hits?|strikes?|deals?)\\s+(?:the\\s+)?(?:${escapedNames})\\s+for\\s+(\\d+)\\s*(?:damage|HP)?`, 'gi'),
                    new RegExp(`(\\d+)\\s+(?:damage|HP)\\s+(?:to|against)\\s+(?:the\\s+)?(?:${escapedNames})`, 'gi'),
                    new RegExp(`(?:deal|deals?|dealt)\\s+(?:the\\s+)?(?:${escapedNames})\\s+(\\d+)\\s+(?:damage|HP)?`, 'gi'),
                    new RegExp(`(?:deal|deals?|dealt)\\s+(\\d+)\\s+(?:damage|HP)\\s+(?:to|against)\\s+(?:the\\s+)?(?:${escapedNames})`, 'gi')
                ];
                for (const re of patterns) {
                    let m;
                    re.lastIndex = 0;
                    while ((m = re.exec(text)) !== null) {
                        const damage = parseInt(m[1], 10);
                        gs().damageToEncounters[enc.id] = (gs().damageToEncounters[enc.id] || 0) + damage;
                        gs().inCombat = true;
                        gs().mode = 'combat';
                        roomWithUpdate = roomId;
                        debugLog('PARSE', `Monster damage: ${enc.name} +${damage} (total: ${gs().damageToEncounters[enc.id]}/${monster.hp})`);
                    }
                }
                // NOTE: Narrative death/flee detection removed — the GM frequently uses dramatic death
                // language on non-lethal hits (e.g. "collapses" for a blow that leaves 13 HP).
                // Monster defeat is now driven ONLY by HP math (damage >= monster.hp) or an
                // explicit [MONSTER_DEFEATED: id] / [MONSTER_FLED: id] tag from the GM.
                // See parseExplicitStateTags for tag handling.
            }
        }
        if (roomWithUpdate) {
            const room = rooms[roomWithUpdate];
            gs().currentRoom = roomWithUpdate;
            if (room && room.encounters && room.encounters.length > 0) {
                const allDefeated = room.encounters.every(enc => getEncounterHP(enc).defeated);
                if (allDefeated) {
                    gs().inCombat = false;
                    gs().mode = 'exploration';
                    gs().lastCombatRoom = roomWithUpdate;
                    debugLog('PARSE', 'Combat ended: all enemies defeated');
                } else {
                    // Still in active combat in this room.
                    gs().inCombat = true;
                    gs().mode = 'combat';
                }
            }
            updateCharacterDisplay();
        }
    }

    /** Normalize ids/names for robust tag target matching. */
    function normalizeEntityToken(s) {
        return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    }

    /** Find encounter by explicit tag token (encounter id/name/monster_ref/monster name). Prefers current room. */
    function findEncounterForStateTag(targetToken) {
        const rooms = gd().module && gd().module.rooms;
        if (!rooms) return null;
        const token = normalizeEntityToken(targetToken);
        if (!token) return null;

        function scanRoom(roomId) {
            const room = rooms[roomId];
            if (!room || !room.encounters) return null;
            for (const enc of room.encounters) {
                const monster = resolveMonster(enc.monster_ref);
                const candidates = [
                    enc.id,
                    enc.name,
                    enc.monster_ref,
                    monster && monster.id,
                    monster && monster.name
                ];
                if (candidates.some(c => normalizeEntityToken(c) === token)) {
                    return { roomId, room, encounter: enc, monster };
                }
            }
            return null;
        }

        if (gs().currentRoom) {
            const cur = scanRoom(gs().currentRoom);
            if (cur) return cur;
        }
        for (const roomId of Object.keys(rooms)) {
            if (roomId === gs().currentRoom) continue;
            const hit = scanRoom(roomId);
            if (hit) return hit;
        }
        return null;
    }

    /**
     * Parse explicit state tags (authoritative) and apply directly.
     * Supported tags:
     * - [DAMAGE_TO_PLAYER: 4]
     * - [HEAL_PLAYER: 6]
     * - [DAMAGE_TO_MONSTER: goblin_fighter, 5]
     * - [MONSTER_DEFEATED: goblin_fighter]
     * - [MONSTER_FLED: goblin_scout]
     */
    function parseExplicitStateTags(text) {
        const out = {
            text,
            hasPlayerDamageTag: false,
            hasPlayerHealTag: false,
            hasMonsterDamageTag: false
        };
        if (!text) return out;

        let roomWithUpdate = null;
        let m;

        const dmgPlayerRe = /\[DAMAGE_TO_PLAYER:\s*(\d+)\s*\]/gi;
        while ((m = dmgPlayerRe.exec(text)) !== null) {
            out.hasPlayerDamageTag = true;
            const damage = parseInt(m[1], 10);
            if (damage >= 1 && damage <= 999) {
                // Hazard/trap damage — do NOT force combat mode; [COMBAT: on] handles that separately
                modifyHP(-damage);
                addMechanicsCallout(`Hazard: ${damage} damage\nHP: ${gs().character.hp}/${gs().character.maxHp}`);
                debugLog('PARSE', `Tag damage TO PLAYER: ${damage}`);
            }
        }

        const healPlayerRe = /\[HEAL_PLAYER:\s*(\d+)\s*\]/gi;
        while ((m = healPlayerRe.exec(text)) !== null) {
            out.hasPlayerHealTag = true;
            const healing = parseInt(m[1], 10);
            if (healing >= 1 && healing <= 999) {
                modifyHP(healing);
                addMechanicsCallout(`Healed: +${healing} HP\nHP: ${gs().character.hp}/${gs().character.maxHp}`);
                debugLog('PARSE', `Tag healing TO PLAYER: ${healing}`);
            }
        }

        const dmgMonsterRe = /\[DAMAGE_TO_MONSTER:\s*([^,\]]+)\s*,\s*(\d+)\s*\]/gi;
        while ((m = dmgMonsterRe.exec(text)) !== null) {
            out.hasMonsterDamageTag = true;
            const target = m[1].trim();
            const damage = parseInt(m[2], 10);
            if (!(damage >= 1 && damage <= 999)) continue;
            const found = findEncounterForStateTag(target);
            if (!found) {
                debugLog('PARSE', `Tag damage to monster ignored (no target match): ${target}`);
                continue;
            }
            gs().damageToEncounters[found.encounter.id] = (gs().damageToEncounters[found.encounter.id] || 0) + damage;
            gs().inCombat = true;
            gs().mode = 'combat';
            roomWithUpdate = found.roomId;
            debugLog('PARSE', `Tag damage TO MONSTER: ${found.encounter.name} +${damage}`);
        }

        const defeatedMonsterRe = /\[MONSTER_DEFEATED:\s*([^\]]+)\s*\]/gi;
        while ((m = defeatedMonsterRe.exec(text)) !== null) {
            out.hasMonsterDamageTag = true;
            const target = m[1].trim();
            const found = findEncounterForStateTag(target);
            if (!found) {
                debugLog('PARSE', `Tag monster defeated ignored (no target match): ${target}`);
                continue;
            }
            const hp = getEncounterHP(found.encounter);
            const currentDamage = gs().damageToEncounters[found.encounter.id] || 0;
            gs().damageToEncounters[found.encounter.id] = Math.max(currentDamage, hp.max);
            gs().inCombat = true;
            gs().mode = 'combat';
            roomWithUpdate = found.roomId;
            debugLog('PARSE', `Tag monster defeated: ${found.encounter.name} (set to 0/${hp.max})`);
        }

        const fledMonsterRe = /\[MONSTER_FLED:\s*([^\]]+)\s*\]/gi;
        while ((m = fledMonsterRe.exec(text)) !== null) {
            out.hasMonsterDamageTag = true;
            const target = m[1].trim();
            const found = findEncounterForStateTag(target);
            if (!found) {
                debugLog('PARSE', `Tag monster fled ignored (no target match): ${target}`);
                continue;
            }
            const hp = getEncounterHP(found.encounter);
            const currentDamage = gs().damageToEncounters[found.encounter.id] || 0;
            gs().damageToEncounters[found.encounter.id] = Math.max(currentDamage, hp.max);
            gs().inCombat = true;
            gs().mode = 'combat';
            roomWithUpdate = found.roomId;
            debugLog('PARSE', `Tag monster fled (tracked as defeated): ${found.encounter.name} (set to 0/${hp.max})`);
        }

        if (roomWithUpdate) {
            gs().currentRoom = roomWithUpdate;
            // Do NOT call ensureCombatRoomHasEncounters() here: it would jump to another room with
            // active encounters (e.g. morale_chamber) when this room just ended combat, making Scout/Fighter appear early.
            const room = gd().module && gd().module.rooms && gd().module.rooms[roomWithUpdate];
            if (room && room.encounters && room.encounters.length > 0) {
                const allDefeated = room.encounters.every(enc => getEncounterHP(enc).defeated);
                if (allDefeated) {
                    gs().inCombat = false;
                    gs().mode = 'exploration';
                    gs().lastCombatRoom = roomWithUpdate;
                    debugLog('PARSE', 'Combat ended: all enemies defeated (explicit tag)');
                }
            }
            updateCharacterDisplay();
        }

        out.text = text.replace(/\[(?:DAMAGE_TO_PLAYER|HEAL_PLAYER|DAMAGE_TO_MONSTER|MONSTER_DEFEATED|MONSTER_FLED):[^\]]*\]/gi, ' ');
        return out;
    }
    
    /** If narrative indicates the player entered a different room, update currentRoom so combat indicator etc. are correct. */
    function tryParseRoomChange(text) {
        const rooms = gd().module && gd().module.rooms;
        if (!rooms || !text) return;
        const t = text.toLowerCase();
        const normalized = t.replace(/\bmoral chamber\b/g, 'morale chamber');

        // Stage 4: explicit [ROOM: <id>] tag is authoritative. Takes priority
        // over the heuristic so a GM who emits it can't be second-guessed by
        // a false positive in the prose.
        const tagMatch = text.match(/\[ROOM:\s*([a-z0-9_]+)\s*\]/i);
        if (tagMatch) {
            const targetId = tagMatch[1];
            if (rooms[targetId] && targetId !== gs().currentRoom) {
                gs().currentRoom = targetId;
                updateCharacterDisplay();
                debugLog('PARSE', `Room changed to: ${targetId} (${rooms[targetId].name}) via [ROOM:] tag`);
            }
            return;
        }

        // Heuristic fallback. The [ROOM:] tag is the GM's primary contract;
        // this runs only when the tag is missing. It's intentionally CONSERVATIVE
        // because a false positive (teleport mid-reference) silently corrupts
        // state, while a false negative (GM forgets the tag + prose ambiguous)
        // is visible in the session report (no room-change event, player
        // clearly in a new room narratively).
        //
        // The match is SENTENCE-SCOPED: both a movement verb AND the target
        // room's name must appear in the SAME sentence. This blocks the
        // Test 4 / Test 5 false-positive cases where "reach for the jar" in
        // one sentence co-occurred with "the tomb road" in a later sentence
        // of the same GM turn.
        const movementRe = /\b(?:enter(?:s|ed)?|arrive(?:s|d)?|step(?:s|ped)?\s+(?:in(?:to)?|through|onto)|walk(?:s|ed)?\s+(?:in|into|through|onto)|move(?:s|d)?\s+(?:in|into|through|onto)|push(?:es|ed)?\s+(?:in|through)|find\s+yourself\s+in|are\s+now\s+in|head(?:s|ed)?\s+(?:in)?to|go(?:es)?\s+(?:in)?to|pass(?:es|ed)?\s+(?:in|into|through|onto))\b/;

        // Split GM text into sentences on ., !, ?, and em-dashes to catch
        // tight-packed GM prose. Keep sentence fragments above one word so
        // we don't match on isolated connectives.
        const sentences = text
            .split(/(?<=[.!?])\s+|—|\n+/)
            .map(s => s.trim())
            .filter(s => s.length > 0)
            .map(s => s.toLowerCase());

        for (const [roomId, room] of Object.entries(rooms)) {
            if (!room || roomId === gs().currentRoom) continue;
            const roomName = (room.name || '').toLowerCase();
            const roomIdPhrase = roomId.replace(/_/g, ' ').toLowerCase();
            let matchedSentence = null;
            let matchedKind = null;
            for (const s of sentences) {
                // Normalize "moral chamber" typo the GM occasionally emits.
                const sn = s.replace(/\bmoral chamber\b/g, 'morale chamber');
                const hasName = roomName && sn.includes(roomName);
                const hasIdPhrase = roomIdPhrase && sn.includes(roomIdPhrase);
                if (!hasName && !hasIdPhrase) continue;
                if (!movementRe.test(sn)) continue;
                matchedSentence = s;
                matchedKind = hasName ? 'name' : 'id-phrase';
                break;
            }
            if (matchedSentence) {
                gs().currentRoom = roomId;
                updateCharacterDisplay();
                debugLog('PARSE', `Room changed to: ${roomId} (${room.name}) — heuristic fallback (${matchedKind} + movement co-occur in one sentence; GM omitted [ROOM:] tag)`);
                return;
            }
        }

        // No room change. If the GM mentioned a room name without any movement
        // co-occurring (pure reference), log it once so designers can spot
        // [ROOM:]-tag misses on real transitions vs. references in the trail.
        for (const [roomId, room] of Object.entries(rooms)) {
            if (!room || roomId === gs().currentRoom) continue;
            const roomName = (room.name || '').toLowerCase();
            if (roomName && normalized.includes(roomName)) {
                debugLog('PARSE', `Room name "${room.name}" mentioned without same-sentence movement or [ROOM:] tag — staying in ${gs().currentRoom}`);
                return;
            }
        }
    }
    
    /** Parse [COMBAT: on] and [COMBAT: off] — GM explicitly sets combat state. Takes precedence over heuristics. */
    function tryParseCombatTag(text) {
        if (!text) return;
        const onMatch = text.match(/\[COMBAT:\s*(on|true|yes)\]/i);
        const offMatch = text.match(/\[COMBAT:\s*(off|false|no)\]/i);
        if (onMatch) {
            gs().inCombat = true;
            gs().mode = 'combat';
            gs().combatStateFromTag = true;
            ensureCombatRoomHasEncounters();
            updateCharacterDisplay();
            debugLog('PARSE', 'Combat state: on (GM tag)');
        } else if (offMatch) {
            gs().inCombat = false;
            gs().mode = 'exploration';
            gs().lastCombatRoom = gs().currentRoom;
            gs().combatStateFromTag = true;
            updateCharacterDisplay();
            debugLog('PARSE', 'Combat state: off (GM tag)');
        }
    }

    /** Fallback: if GM says combat begins/starts (and no explicit tag), set in-combat. */
    function tryParseCombatBegins(text) {
        if (!text) return;
        if (text.match(/\[COMBAT:\s*(on|off|true|false)\]/i)) return; // GM used tag, skip heuristic
        const t = text.toLowerCase();
        if (/\bcombat\s+(?:begins?|starts?)\b/.test(t) || /\b(?:the\s+)?(?:fight|battle)\s+(?:begins?|starts?|is\s+on)\b/.test(t) || /\b(?:you\s+are\s+)(?:in\s+)?combat\b/.test(t)) {
            gs().inCombat = true;
            gs().mode = 'combat';
            ensureCombatRoomHasEncounters();
            updateCharacterDisplay();
            debugLog('PARSE', 'Combat began (GM narrative fallback)');
        }
    }
    
    /** If narrative or player message indicates retreat/flee, end combat. */
    function tryParseRetreat(text) {
        if (!text) return;
        const t = text.toLowerCase();
        const gmNarrative = /\b(?:you\s+)(?:run|retreat|flee|escape|withdraw|manage to|succeed in)\b/.test(t) ||
            /\b(?:you\s+)(?:run|retreat|flee|escape)\s+(?:away|safely|back)/.test(t) ||
            /\b(?:run\s+away|retreat|fled|escape|withdraw)\b.*\b(?:safely|successfully|manage)\b/.test(t);
        const playerDeclares = /\b(?:i\s+)(?:run\s+away|retreat|flee|escape|withdraw|disengage)\b/.test(t) ||
            /\b(?:i'll\s+)(?:run\s+away|retreat|flee|escape)\b/.test(t);
        if (gmNarrative || playerDeclares) {
            gs().inCombat = false;
            gs().mode = 'exploration';
            gs().lastCombatRoom = gs().currentRoom;
            updateCharacterDisplay();
            debugLog('PARSE', 'Combat ended: retreat/flee');
        }
    }
    
    /** If text mentions removing or donning armor, update armorEquipped and AC. */
    function tryParseArmorState(text) {
        const t = text.toLowerCase();
        if (/\b(?:remove|take off|doff|strip off|unequip)\s+(?:your?)?\s*(?:armor|chain mail|mail)\b/i.test(t) ||
            /\b(?:you\s+)?(?:remove|doff)\s+(?:your?)?\s*(?:armor|chain mail)\b/i.test(t)) {
            gs().armorEquipped = false;
            updateCharacterDisplay();
            debugLog('PARSE', 'Armor removed; AC now unarmored');
        } else if (/\b(?:put on|don|equip|wear)\s+(?:your?)?\s*(?:armor|chain mail|mail)\b/i.test(t) ||
            /\b(?:you\s+)?(?:don|put on)\s+(?:your?)?\s*(?:armor|chain mail)\b/i.test(t)) {
            gs().armorEquipped = true;
            updateCharacterDisplay();
            debugLog('PARSE', 'Armor donned');
        }
    }

    /** Parse [CONDITION: add id] and [CONDITION: remove id]; optionally narrative phrases for known condition ids. */
    function tryParseConditions(text) {
        if (!text) return;
        const ids = getConditionIdsFromRules();
        const tagAdd = /\[CONDITION:\s*add\s+([^\]]+)\]/gi;
        const tagRemove = /\[CONDITION:\s*remove\s+([^\]]+)\]/gi;
        let m;
        while ((m = tagAdd.exec(text)) !== null) {
            addCondition(m[1].trim());
        }
        while ((m = tagRemove.exec(text)) !== null) {
            removeCondition(m[1].trim());
        }
        const t = text.toLowerCase();
        ids.forEach(id => {
            const info = getConditionInfo(id);
            const name = info.name.toLowerCase();
            if (name && (t.includes(`you are ${name}`) || t.includes(`you're ${name}`) || t.includes(`you become ${name}`) || t.includes(`you have been ${name}`))) {
                addCondition(id);
            }
            if (name && (t.includes(`no longer ${name}`) || t.includes(`no longer ${id}`) || t.includes(`${name} wears off`) || t.includes(`${name} ends`) || t.includes(`${name} clears`))) {
                removeCondition(id);
            }
        });
    }
    
    /** If text mentions putting away / sheathing a weapon, clear readied weapon so no weapon is highlighted. */
    function tryParseWeaponAway(text) {
        if (!text) return;
        const t = text.toLowerCase();
        if (/\b(?:put|puts?)\s+(?:my|your?|the)\s+(?:sword|weapon|blade|longsword|shortbow)\s+away\b/.test(t) ||
            /\b(?:put|puts?)\s+away\s+(?:my|your?|the)\s+(?:sword|weapon|blade|longsword|shortbow)\b/.test(t) ||
            /\bsheathe?s?\s+(?:my|your?|the)\s+(?:sword|weapon|blade)?\b/.test(t) ||
            /\bstow?s?\s+(?:my|your?|the)\s+(?:sword|weapon)\b/.test(t) ||
            /\b(?:you\s+)?(?:put|sheathe?|stow)\s+(?:your?\s+)?(?:sword|weapon)\s+away\b/.test(t)) {
            gs().readiedWeaponName = null;
            updateCharacterDisplay();
            debugLog('PARSE', 'Readied weapon cleared (put away / sheathed)');
        }
    }
    
    /** If text mentions switching/drawing/readying/attacking with a weapon, set readied weapon and update panel. */
    function tryParseWeaponSwitch(text) {
        const sources = gd().character && gd().character.equipment
            ? [...(gd().character.equipment.wielded || []), ...(gd().character.equipment.carried || [])]
            : [];
        const weaponNames = sources.filter(w => w.damage).map(w => w.name).filter(Boolean);
        for (const name of weaponNames) {
            const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const patterns = [
                new RegExp(`(?:switch|switch to|draw|ready|use|wield|pull out)\\s+(?:your?\\s+)?(?:the\\s+)?${escaped}`, 'i'),
                new RegExp(`(?:attack|strike|hit)\\s+(?:with|using)\\s+(?:your?|my\\s+)?(?:the\\s+)?${escaped}`, 'i'),
                new RegExp(`(?:attack|strike)\\s+(?:the\\s+)?[^\\s]+\\s+with\\s+(?:your?|my\\s+)?(?:the\\s+)?${escaped}`, 'i'),
                new RegExp(`(?:you\\s+)?(?:draw|ready|switch to)\\s+(?:your?\\s+)?(?:the\\s+)?${escaped}`, 'i'),
                new RegExp(`(?:you\\s+)?(?:attack|strike)\\s+with\\s+(?:your?\\s+)?(?:the\\s+)?${escaped}`, 'i'),
                new RegExp(`${escaped}\\s+(?:is\\s+)?(?:now\\s+)?(?:readied?|drawn|out)`, 'i')
            ];
            for (const p of patterns) {
                if (p.test(text)) {
                    gs().readiedWeaponName = name;
                    updateCharacterDisplay();
                    debugLog('PARSE', `Readied weapon set to: ${name}`);
                    return;
                }
            }
        }
    }
    
    /** Parse [MODE: travel] and [MODE: exploration] — GM switches pillar. */
    function tryParseModeTag(text) {
        if (!text) return;
        const travelMatch = text.match(/\[MODE:\s*travel\]/i);
        const explorMatch = text.match(/\[MODE:\s*exploration\]/i);
        if (travelMatch) {
            gs().mode = 'travel';
            updateCharacterDisplay();
            debugLog('PARSE', 'Mode: travel (GM tag)');
        } else if (explorMatch) {
            gs().mode = 'exploration';
            updateCharacterDisplay();
            debugLog('PARSE', 'Mode: exploration (GM tag)');
        }
    }

    /**
     * Stage 5: when the GM emits [FEATURE_SOLVED: <feature_id>] in response to
     * a narrative puzzle proposal, route the solve to UI.features.markSolved so
     * on_success effects / rewards fire and the card flips to "Solved". Only
     * features of type 'puzzle' are valid targets; other types ignore the tag.
     * Multiple tags in one response are all honored.
     */
    function tryParseFeatureSolved(text) {
        if (!text) return;
        const re = /\[FEATURE_SOLVED:\s*([a-z0-9_]+)\s*\]/gi;
        let m;
        let count = 0;
        while ((m = re.exec(text)) !== null) {
            const id = m[1];
            const UIf = global.UI && global.UI.features;
            if (UIf && UIf.markSolved) {
                const ok = UIf.markSolved(id, { narrateFromAuthored: false });
                debugLog('PARSE', `[FEATURE_SOLVED: ${id}] → markSolved ${ok ? 'applied' : 'skipped (not found or already solved)'}`);
            } else {
                debugLog('PARSE', `[FEATURE_SOLVED: ${id}] seen but UI.features.markSolved not wired`);
            }
            count++;
        }
        if (count > 1) debugLog('PARSE', `[FEATURE_SOLVED:] tag appeared ${count} times in one response`);
    }

    function parseStateChanges(text) {
        debugLog('PARSE', 'Parsing state changes from AI response');
        gs().combatStateFromTag = false; // reset; set true if GM used [COMBAT: on/off]
        // Strip HTML so "You take <b>4</b> damage" is parseable (GM may use <b>/<i> in responses)
        let plainText = text.replace(/<[^>]*>/g, ' ');
        plainText = plainText.replace(/\s+/g, ' ').trim();
        
        tryParseRoomChange(plainText);
        tryParseModeTag(plainText);
        tryParseFeatureSolved(plainText);  // Stage 5: [FEATURE_SOLVED: <id>] → markSolved.
        tryParseCombatTag(plainText);   // GM tag takes precedence
        tryParseCombatBegins(plainText);
        tryParseRetreat(plainText);
        tryParseWeaponAway(plainText);
        tryParseWeaponSwitch(plainText);
        tryParseArmorState(plainText);
        tryParseConditions(plainText);
        const explicitState = parseExplicitStateTags(plainText);
        plainText = explicitState.text.replace(/\s+/g, ' ').trim();
        // Skip narrative monster-damage parsing when damage was already applied from a mechanics callout (player just submitted a damage roll)
        if (!explicitState.hasMonsterDamageTag && !gs().lastUserMessageWasDiceRoll) {
            parseMonsterDamage(plainText); // fallback only when no explicit monster damage tags are present
        }
        updateCharacterDisplay();
        
        // Parse HP changes - DAMAGE (only when the PLAYER receives damage, not when the player deals damage)
        // Many patterns to catch varied GM phrasings; stop at first match to avoid double-counting
        const damageToPlayerPatterns = [
            /(?:you|your character)\s+(?:take|taking|suffer|lose)\s+(\d+)\s+(?:points?\s+of\s+)?(?:damage|HP)\b/i,
            /(?:you(?:\s+are|'re)?|your character(?:\s+is)?)\s+(?:hit|struck|wounded)\s+for\s+(\d+)\b/i,
            /(?:hits?|strikes?|deals?|inflicts?|wounds?)\s+(?:you|your character)\s+(?:for\s+)?(\d+)\s*(?:damage|HP)?\b/i,
            /deals?\s+(\d+)\s+(?:damage|HP)\s+(?:to|against|upon)\s+(?:you|your character)\b/i,
            /dealing\s+(\d+)\s+(?:damage|HP)\s+(?:to|against|upon)\s+(?:you|your character)\b/i,
            /(\d+)\s+(?:damage|HP)\s+(?:to|against|upon)\s+(?:you|your character)\b/i
        ];
        
        if (!explicitState.hasPlayerDamageTag) {
            const lastUser = gs().conversationHistory.length > 0 ? gs().conversationHistory[gs().conversationHistory.length - 1] : null;
            const lastContent = (lastUser && lastUser.role === 'user' && lastUser.content) ? String(lastUser.content).trim() : '';
            const lastUserDamageRoll = lastContent ? (lastContent.match(/^(?:i\s+rolled\s+)?(\d+)$/i) || lastContent.match(/(?:rolled\s+)?(\d+)\s*(?:for\s+damage|damage)?/i)) : null;
            const lastRollValue = lastUserDamageRoll ? parseInt(lastUserDamageRoll[1], 10) : null;
            for (const pattern of damageToPlayerPatterns) {
                const match = plainText.match(pattern);
                if (match) {
                    const damage = parseInt(match[1], 10);
                    if (damage >= 1 && damage <= 999) {
                        if (lastRollValue !== null && damage === lastRollValue) {
                            debugLog('PARSE', `Skipping damage TO PLAYER: ${damage} (same as player's last roll — likely GM meant monster took this damage)`);
                            break;
                        }
                        debugLog('PARSE', `Detected damage TO PLAYER: ${damage}`);
                        // Do NOT force combat mode here — [COMBAT: on] is the authoritative signal
                        modifyHP(-damage);
                        addMechanicsCallout(`Damage: ${damage} HP\nHP: ${gs().character.hp}/${gs().character.maxHp}`);
                    }
                    break;
                }
            }
        }
        
        // Parse HP changes - HEALING
        const healPatterns = [
            /(?:heal|restore|regain)\s+(\d+)\s+(?:HP|hit points)/i,
            /(\d+)\s+HP\s+(?:restored|healed)/i
        ];
        
        if (!explicitState.hasPlayerHealTag) {
            for (const pattern of healPatterns) {
                const match = plainText.match(pattern);
                if (match) {
                    const healing = parseInt(match[1]);
                    debugLog('PARSE', `Detected healing: ${healing}`);
                    modifyHP(healing);
                    break;
                }
            }
        }
        
        // XP and gold are NOT parsed from GM narrative — they come only from mechanics callouts (e.g. on enemy defeat). Do not double-award.
        
        // Parse item acquisition (find/discover/obtain) — weapon/armor -> equipment; else -> pack
        const itemPattern = /(?:find|discover|obtain|take)\s+(?:a|an|the)\s+([^.!?,]+?)(?:\.|!|,|\s+in\s+|\s+from\s+)/i;
        const itemMatch = plainText.match(itemPattern);
        if (itemMatch && !plainText.match(/gold|damage|HP/i)) {
            const itemName = itemMatch[1].trim();
            if (itemName.length < 30 && !itemName.includes('you') && !itemName.includes('your')) {
                const catalog = getEquipmentCatalog();
                const key = itemName.toLowerCase().replace(/\s+/g, ' ').trim().replace(/^(?:a|an|the)\s+/, '');
                let spec = catalog.get(key);
                if (!spec) {
                    for (const [k, v] of catalog) {
                        if (key.includes(k) || k.includes(key)) { spec = v; break; }
                    }
                }
                if (spec && (spec.damage || (spec.type || '').toLowerCase() === 'armor')) {
                    debugLog('PARSE', `Detected equipment: ${itemName}`);
                    addEquipmentItem(spec);
                } else {
                    debugLog('PARSE', `Detected item: ${itemName}`);
                    addToInventory(itemName, 1);
                }
            }
        }

        // Parse purchases (buy X for Y gp / pay Y gp for X) — deduct gold, add item to equipment or pack
        const buyPatterns = [
            /(?:you\s+)?(?:buy|purchase)\s+(?:a|an|the)?\s*([^.!?,]+?)\s+for\s+(\d+)\s*(?:gp|gold)/i,
            /(?:you\s+)?pay\s+(\d+)\s*(?:gp|gold)\s+for\s+(?:a|an|the)?\s*([^.!?,]+?)(?:\.|,|$)/i
        ];
        for (const pat of buyPatterns) {
            const m = plainText.match(pat);
            if (m) {
                const amount = parseInt(pat.source.includes('pay') ? m[1] : m[2], 10);
                const itemPhrase = (pat.source.includes('pay') ? m[2] : m[1]).trim();
                if (amount > 0 && itemPhrase.length < 40 && deductGold(amount)) {
                    const catalog = getEquipmentCatalog();
                    const key = itemPhrase.toLowerCase().replace(/\s+/g, ' ').trim().replace(/^(?:a|an|the)\s+/, '');
                    let spec = catalog.get(key);
                    if (!spec) {
                        for (const [k, v] of catalog) {
                            if (key.includes(k) || k.includes(key)) { spec = v; break; }
                        }
                    }
                    if (spec && (spec.damage || (spec.type || '').toLowerCase() === 'armor')) {
                        debugLog('PARSE', `Detected purchase (equipment): ${itemPhrase} for ${amount} gp`);
                        addEquipmentItem(spec);
                    } else {
                        debugLog('PARSE', `Detected purchase: ${itemPhrase} for ${amount} gp`);
                        addToInventory(itemPhrase, 1);
                    }
                }
                break;
            }
        }

        // Parse dropping/leaving items (you drop/leave/discard X)
        const dropPattern = /(?:you|your character)\s+(?:drop|leave|discard)\s+(?:the\s+|a\s+|an\s+|your\s+)?([^.!?,]+?)(?:\.|,|\s+on\s+|\s+behind|\s+there|$)/i;
        const dropMatch = plainText.match(dropPattern);
        if (dropMatch) {
            const phrase = dropMatch[1].trim().toLowerCase().replace(/\s+/g, ' ');
            const inv = gs().character.inventory || [];
            const exact = inv.find(i => i.name && i.name.toLowerCase() === phrase);
            const fuzzy = inv.find(i => i.name && (phrase.includes(i.name.toLowerCase()) || i.name.toLowerCase().includes(phrase)));
            const item = exact || fuzzy;
            if (item && item.name !== 'Gold') {
                removeFromInventory(item.name, 1);
                debugLog('PARSE', `Detected drop: ${item.name}`);
            }
        }
        
        gs().lastUserMessageWasDiceRoll = false; // reset after processing so next turn is fresh
        tryParsePackItemUse(plainText, false); // GM response (skip if already parsed from player)
    }

    /** Parse when player uses Pack items (potion, rope, rations, torch) and decrement quantity.
     * @param {string} text - GM or player narrative text
     * @param {boolean} fromPlayer - if true, set torchUseParsedThisTurn to avoid double-count when GM also confirms */
    function tryParsePackItemUse(text, fromPlayer = false) {
        if (!text) return;
        const t = text.toLowerCase();
        // Healing potion
        if (/\b(?:you\s+)?(?:drink|drank|consume|consumed|use|used)\s+(?:a|the)?\s*healing\s+potion\b/i.test(t) ||
            /\bhealing\s+potion\s+(?:restores?|heals?)\b/i.test(t)) {
            const before = gs().character.inventory.find(i => i.name === 'Healing Potion');
            if (before && (typeof before.quantity === 'number') && before.quantity > 0) {
                removeFromInventory('Healing Potion', 1);
                debugLog('PARSE', 'Detected potion usage');
            }
        }
        // Rope
        if (/\b(?:you\s+)?(?:use|used|employ)\s+(?:the\s+)?rope\b/i.test(t) ||
            /\b(?:the\s+)?rope\s+(?:is\s+)?(?:used|uncoiled|tied)\b/i.test(t) ||
            /\bclimb\s+(?:with|using)\s+(?:the\s+)?rope\b/i.test(t)) {
            const before = gs().character.inventory.find(i => i.name === 'Rope (50ft)' || i.name === 'Rope');
            if (before && (typeof before.quantity === 'number') && before.quantity > 0) {
                removeFromInventory(before.name, 1);
                debugLog('PARSE', 'Detected rope usage');
            }
        }
        // Rations
        if (/\b(?:you\s+)?(?:eat|ate|consume|consumed)\s+(?:some\s+|your\s+)?(?:rations?|food)\b/i.test(t) ||
            /\b(?:you\s+)?(?:use|used)\s+(?:some\s+|your\s+)?rations?\b/i.test(t)) {
            const before = gs().character.inventory.find(i => i.name === 'Rations');
            if (before && (typeof before.quantity === 'number') && before.quantity > 0) {
                removeFromInventory('Rations', 1);
                debugLog('PARSE', 'Detected rations usage');
            }
        }
        // Torch (from pack - lighting one, pulling out, etc.)
        // Match both GM ("You pull out...") and player ("I pull out...") phrasing
        // Skip if we already parsed from player message this turn (avoid double-count)
        const torchUsed = !gs().torchUseParsedThisTurn && (
            /\b(?:you|i)\s+(?:pull|pulled)\s+out\s+(?:a\s+|my\s+|your\s+)?torch\b/i.test(t) ||
            /\b(?:you|i)\s+(?:draw|drew)\s+(?:a\s+|my\s+|your\s+)?torch\b/i.test(t) ||
            /\b(?:you|i)\s+(?:light|lit|take|took)\s+(?:a\s+|my\s+|your\s+)?torch\s+(?:from\s+(?:my|your)\s+pack)?/i.test(t) ||
            /\b(?:you|i)\s+(?:light|lit)\s+(?:a\s+|my\s+|your\s+)?torch\b/i.test(t) ||
            /\b(?:pull|pulled)\s+out\s+(?:a\s+|my\s+|your\s+)?torch\s+(?:and\s+)?(?:light|lit)/i.test(t) ||
            /\b(?:light|lit)\s+(?:a\s+|my\s+|your\s+)?torch\b/i.test(t)
        );
        if (torchUsed) {
            const before = gs().character.inventory.find(i => i.name === 'Torch');
            if (before && (typeof before.quantity === 'number') && before.quantity > 0) {
                removeFromInventory('Torch', 1);
                debugLog('PARSE', 'Detected torch use (lighting from pack)');
            }
            // Add Torch (lit) to Equipped when lighting one
            if (!gs().equippedInUse.some(i => i.name === 'Torch (lit)')) {
                gs().equippedInUse.push({ name: 'Torch (lit)', stats: '20ft bright, 20ft dim, 1 hour duration' });
                debugLog('PARSE', 'Added Torch (lit) to Equipped');
            }
            if (fromPlayer) gs().torchUseParsedThisTurn = true;
            updateCharacterDisplay();
        }
        // Torch (put back in pack / stow / extinguish)
        const torchStowed = /\b(?:you|i)\s+(?:put|placed)\s+(?:the\s+)?torch\s+(?:back\s+)?(?:in|into)\s+(?:your|my)\s+pack\b/i.test(t) ||
            /\b(?:you|i)\s+(?:stow|stowed|put|puts?)\s+(?:the\s+)?torch\s+(?:away|back)?\b/i.test(t) ||
            /\b(?:you|i)\s+(?:extinguish|extinguished|douse|doused)\s+(?:the\s+)?torch\b/i.test(t) ||
            /\b(?:you|i)\s+(?:put|puts?)\s+(?:the\s+)?(?:lit\s+)?torch\s+away\b/i.test(t) ||
            /\b(?:put|puts?)\s+(?:the\s+)?torch\s+back\s+in\s+(?:your|my)\s+pack\b/i.test(t);
        if (torchStowed && gs().equippedInUse.some(i => i.name === 'Torch (lit)')) {
            gs().equippedInUse = gs().equippedInUse.filter(i => i.name !== 'Torch (lit)');
            const torch = gs().character.inventory.find(i => i.name === 'Torch');
            if (torch) {
                torch.quantity = (torch.quantity || 0) + 1;
            } else {
                gs().character.inventory.push({ name: 'Torch', quantity: 1 });
            }
            updateCharacterDisplay();
            debugLog('PARSE', 'Torch put back in pack');
        }
        // Rope retrieval
        if (/\b(?:you\s+)?(?:retrieve|retrieved|recoil|recoiled|pick\s+up|picked\s+up)\s+(?:the\s+)?rope\b/i.test(t)) {
            const rope = gs().character.inventory.find(i => i.name === 'Rope (50ft)' || i.name === 'Rope');
            if (rope) {
                rope.quantity = (rope.quantity || 0) + 1;
                updateCharacterDisplay();
                debugLog('PARSE', 'Detected rope retrieval');
            } else {
                addToInventory('Rope (50ft)', 1);
                debugLog('PARSE', 'Detected rope retrieval (was not in pack)');
            }
        }
    }

    global.ResponseParser = {
        processAIResponse,
        parseMonsterDamage,
        normalizeEntityToken,
        findEncounterForStateTag,
        parseExplicitStateTags,
        tryParseRoomChange,
        tryParseCombatTag,
        tryParseCombatBegins,
        tryParseRetreat,
        tryParseArmorState,
        tryParseConditions,
        tryParseWeaponAway,
        tryParseWeaponSwitch,
        tryParseModeTag,
        parseStateChanges,
        tryParsePackItemUse
    };

    // Legacy globals for still-inline callers.
    global.processAIResponse        = processAIResponse;
    global.parseMonsterDamage       = parseMonsterDamage;
    global.normalizeEntityToken     = normalizeEntityToken;
    global.findEncounterForStateTag = findEncounterForStateTag;
    global.parseExplicitStateTags   = parseExplicitStateTags;
    global.tryParseRoomChange       = tryParseRoomChange;
    global.tryParseCombatTag        = tryParseCombatTag;
    global.tryParseCombatBegins     = tryParseCombatBegins;
    global.tryParseRetreat          = tryParseRetreat;
    global.tryParseArmorState       = tryParseArmorState;
    global.tryParseConditions       = tryParseConditions;
    global.tryParseWeaponAway       = tryParseWeaponAway;
    global.tryParseWeaponSwitch     = tryParseWeaponSwitch;
    global.tryParseModeTag          = tryParseModeTag;
    global.parseStateChanges        = parseStateChanges;
    global.tryParsePackItemUse      = tryParsePackItemUse;
})(typeof window !== 'undefined' ? window : globalThis);
