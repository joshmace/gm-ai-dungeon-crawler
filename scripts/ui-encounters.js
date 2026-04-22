/* AI Dungeon Crawler — UI.encounters
 *
 * Right-panel "Active Encounters" widget + the encounter-side helpers the
 * prompt builder, response parser, and dice flow all call: monster lookup,
 * damage formulas, HP tracking, encounter history rendering.
 *
 * Reads window.gameState and window.gameData. Calls window.debugLog (a
 * still-inline function declaration, already on window).
 *
 * Each function is also exposed as a top-level global so the still-inline
 * callers keep working without rewrites.
 *
 * Attaches to window.UI.encounters.
 */
(function (global) {
    'use strict';

    const doc = () => global.document;
    const gs  = () => global.gameState;
    const gd  = () => global.gameData;
    const debugLog = (...a) => { if (global.debugLog) global.debugLog(...a); };

    function resolveMonster(monsterId) {
        if (!gd().bestiary || !gd().bestiary[monsterId]) {
            debugLog('MONSTER', `WARNING: Monster ${monsterId} not found in manual`);
            return null;
        }
        return gd().bestiary[monsterId];
    }

    /** First active (non-defeated) encounter in current room, or null. */
    function getFirstActiveEncounterInCurrentRoom() {
        const room = gd().module && gd().module.rooms && gd().module.rooms[gs().currentRoom];
        if (!room || !room.encounters || room.encounters.length === 0) return null;
        for (const enc of room.encounters) {
            if (!getEncounterHP(enc).defeated) return enc;
        }
        return null;
    }

    /** Damage formula for the first attack of the first active encounter in current room. */
    function getMonsterDamageFormulaForCurrentRoom() {
        const enc = getFirstActiveEncounterInCurrentRoom();
        if (!enc) return null;
        const monster = resolveMonster(enc.monster_ref);
        if (!monster || !monster.attacks || monster.attacks.length === 0) return null;
        const a = monster.attacks[0];
        return (a.damage || '').trim() || null;
    }

    /** Attack bonus + weapon name for first attack of first active encounter in current room. */
    function getMonsterAttackInfoForCurrentRoom() {
        const enc = getFirstActiveEncounterInCurrentRoom();
        if (!enc) return null;
        const monster = resolveMonster(enc.monster_ref);
        if (!monster || !monster.attacks || monster.attacks.length === 0) return null;
        const a = monster.attacks[0];
        return {
            bonus:      (a.bonus != null) ? Number(a.bonus) : 0,
            weaponName: (a.name || 'attack').trim(),
            range:      (a.range || 'melee').toLowerCase()
        };
    }

    /** Fallback: monster damage formula from any room with an active encounter. */
    function getMonsterDamageFormulaFromAnyRoom() {
        const rooms = gd().module && gd().module.rooms;
        if (!rooms) return null;
        for (const room of Object.values(rooms)) {
            if (!room || !room.encounters || room.encounters.length === 0) continue;
            for (const enc of room.encounters) {
                if (getEncounterHP(enc).defeated) continue;
                const monster = resolveMonster(enc.monster_ref);
                if (!monster || !monster.attacks || monster.attacks.length === 0) continue;
                const d = (monster.attacks[0].damage || '').trim();
                if (d) return d;
            }
        }
        return null;
    }

    /** Roll a dice formula string like "1d6+2" and return { total, breakdown }. */
    function rollDiceFormula(formula) {
        if (!formula || typeof formula !== 'string') return { total: 0, breakdown: '' };
        const m = formula.trim().match(/^(\d+)d(\d+)\s*([+-])?\s*(\d+)?$/i);
        if (!m) return { total: 0, breakdown: formula };
        const count = parseInt(m[1], 10);
        const sides = parseInt(m[2], 10);
        const sign  = m[3] === '-' ? -1 : 1;
        const mod   = m[4] ? sign * parseInt(m[4], 10) : 0;
        let sum = 0;
        const rolls = [];
        for (let i = 0; i < count; i++) {
            const r = Math.floor(Math.random() * sides) + 1;
            rolls.push(r);
            sum += r;
        }
        const total = sum + mod;
        const modStr = mod !== 0 ? (mod >= 0 ? ` + ${mod}` : ` - ${Math.abs(mod)}`) : '';
        const breakdown = `${formula} (${rolls.join(' + ')}${modStr}) = ${total}`;
        return { total, breakdown };
    }

    /** Current HP for an encounter (tracked damage vs monster max HP). */
    function getEncounterHP(encounter) {
        const monster = resolveMonster(encounter.monster_ref);
        if (!monster) return { current: 0, max: 0, defeated: true };
        const maxHP = (encounter.hp != null && encounter.hp > 0) ? Number(encounter.hp) : (monster.hp != null ? monster.hp : 0);
        const damage = (gs().damageToEncounters && gs().damageToEncounters[encounter.id]) || 0;
        const current = Math.max(0, maxHP - damage);
        return { current, max: maxHP, defeated: current <= 0 };
    }

    /** Best combat fallback room: prefer non-defeated encounters, else any room with encounters. */
    function getFirstRoomIdWithEncounters() {
        const rooms = gd().module && gd().module.rooms;
        if (!rooms) return null;
        const ids = Object.keys(rooms).sort();
        for (const id of ids) {
            const r = rooms[id];
            if (!r || !r.encounters || r.encounters.length === 0) continue;
            if (r.encounters.some(enc => !getEncounterHP(enc).defeated)) return id;
        }
        for (const id of ids) {
            const r = rooms[id];
            if (r && r.encounters && r.encounters.length > 0) return id;
        }
        return null;
    }

    /** When combat starts, ensure currentRoom has encounters so the monster panel populates. */
    function ensureCombatRoomHasEncounters() {
        const rooms = gd().module && gd().module.rooms;
        if (!rooms) return;
        const cur = rooms[gs().currentRoom];
        const curHasActiveEncounters = cur && cur.encounters && cur.encounters.some(enc => !getEncounterHP(enc).defeated);
        if (curHasActiveEncounters) return;
        const fallback = getFirstRoomIdWithEncounters();
        if (fallback) {
            gs().currentRoom = fallback;
            debugLog('PARSE', `Combat started but current room had no active encounters; set currentRoom to ${fallback} for monster panel`);
        }
    }

    /** Stable key for encounter-history entries. */
    function getEncounterHistoryKey(roomId, encounter) {
        return `${roomId || 'unknown'}::${encounter && encounter.id ? encounter.id : 'unknown'}`;
    }

    /** Add/update encounters for a room into panel history (new encounters appear at top). */
    function recordEncounterHistoryForRoom(roomId) {
        const rooms = gd().module && gd().module.rooms;
        if (!rooms || !roomId) return;
        const room = rooms[roomId];
        if (!room || !room.encounters || room.encounters.length === 0) return;
        for (const enc of room.encounters) {
            const key = getEncounterHistoryKey(roomId, enc);
            const monster = resolveMonster(enc.monster_ref);
            const hpInfo = getEncounterHP(enc);
            const ac = monster && (monster.ac != null ? monster.ac : (monster.AC != null ? monster.AC : '—'));
            const attacks = monster && Array.isArray(monster.attacks)
                ? monster.attacks.map(a => ({
                    name:        a.name,
                    bonus:       a.bonus,
                    damage:      a.damage,
                    damage_type: a.damage_type,
                    range:       a.range
                }))
                : [];
            const idx = gs().encounterHistory.findIndex(e => e.key === key);
            const base = {
                key,
                roomId,
                roomName:        room.name || roomId,
                encounterId:     enc.id,
                displayName:     enc.name || (monster && monster.name) || enc.monster_ref || 'Unknown',
                monsterRef:      enc.monster_ref || null,
                acSnapshot:      ac != null ? ac : '—',
                attacksSnapshot: attacks
            };
            if (idx === -1) {
                gs().encounterHistory.unshift({
                    ...base,
                    lastKnownCurrentHp: hpInfo.current,
                    lastKnownMaxHp:     hpInfo.max,
                    defeated:           hpInfo.defeated
                });
            } else {
                gs().encounterHistory[idx] = {
                    ...gs().encounterHistory[idx],
                    ...base,
                    lastKnownCurrentHp: hpInfo.current,
                    lastKnownMaxHp:     hpInfo.max,
                    defeated:           hpInfo.defeated
                };
            }
        }
    }

    /** Populate the right-side monster panel from persistent encounter history. */
    function updateMonsterPanel() {
        const container = doc().getElementById('monsterStatsPanel');
        if (!container) return;
        const rooms = gd().module && gd().module.rooms;
        if (!rooms) {
            container.className = 'monster-panel-empty';
            container.innerHTML = 'No monsters in this room.';
            return;
        }
        let roomIdToShow = gs().currentRoom;
        if (!gs().inCombat && gs().lastCombatRoom != null && gs().lastCombatRoom !== '') {
            roomIdToShow = gs().lastCombatRoom;
        }
        recordEncounterHistoryForRoom(roomIdToShow);

        if (!gs().encounterHistory || gs().encounterHistory.length === 0) {
            container.className = 'monster-panel-empty';
            container.innerHTML = 'No monsters encountered yet.';
            return;
        }
        let html = '';
        for (const hist of gs().encounterHistory) {
            const room = rooms[hist.roomId];
            const enc = room && room.encounters ? room.encounters.find(e => e.id === hist.encounterId) : null;
            const monsterRef = (enc && enc.monster_ref) || hist.monsterRef;
            const monster = monsterRef ? resolveMonster(monsterRef) : null;
            const hpInfo = enc ? getEncounterHP(enc) : {
                current:  hist.lastKnownCurrentHp != null ? hist.lastKnownCurrentHp : 0,
                max:      hist.lastKnownMaxHp != null ? hist.lastKnownMaxHp : 0,
                defeated: !!hist.defeated
            };
            if (!monster) {
                const status = hpInfo.defeated ? 'Defeated' : 'Active';
                html += `<div class="monster-stat-block${hpInfo.defeated ? ' defeated' : ''}"><div class="monster-stat-name">${hist.displayName}</div><div class="monster-stat-line">Status: ${status}</div><div class="monster-stat-line">Unknown monster: ${monsterRef || '—'}</div></div>`;
                continue;
            }
            const ac = monster.ac != null ? monster.ac : (monster.AC != null ? monster.AC : (hist.acSnapshot != null ? hist.acSnapshot : '—'));
            const defeatedClass = hpInfo.defeated ? ' defeated' : '';
            html += `<div class="monster-stat-block${defeatedClass}">`;
            html += `<div class="monster-stat-name">${hist.displayName}</div>`;
            html += `<div class="monster-stat-line">Status: ${hpInfo.defeated ? 'Defeated' : 'Active'}</div>`;
            if (hist.roomName) html += `<div class="monster-stat-line">Room: ${hist.roomName}</div>`;
            html += `<div class="monster-stat-line">AC ${ac}</div>`;
            html += `<div class="monster-stat-line">HP ${hpInfo.current}/${hpInfo.max}</div>`;
            const attacks = (monster.attacks && monster.attacks.length > 0) ? monster.attacks : (hist.attacksSnapshot || []);
            if (attacks.length > 0) {
                html += '<div class="monster-stat-attacks">';
                for (const a of attacks) {
                    const range = (a.range || 'melee').toString().toLowerCase();
                    const rangeStr = range === 'melee' ? 'melee' : `ranged ${a.range}`;
                    html += `<div class="monster-stat-attack">${a.name}: +${a.bonus != null ? a.bonus : '0'} to hit, ${(a.damage || '—')} ${(a.damage_type || '')} (${rangeStr})</div>`;
                }
                html += '</div>';
            }
            html += '</div>';
        }
        container.className = '';
        container.innerHTML = html || '<span class="monster-panel-empty">No active encounter.</span>';
    }

    /**
     * Resolve encounter rewards with strict precedence:
     *  1) Module encounter overrides (on_death first, then direct encounter fields)
     *  2) Monster manual fallback
     * Explicit module empty treasure ([]) means "no treasure" and MUST NOT fall back.
     */
    function resolveEncounterRewards(encounter, monster) {
        const od = encounter && encounter.on_death ? encounter.on_death : null;
        const moduleHasXP = (od && od.xp_award != null) || (encounter && encounter.xp_award != null);
        const moduleXP    = (od && od.xp_award != null) ? od.xp_award : (encounter && encounter.xp_award != null ? encounter.xp_award : null);
        const xp = moduleHasXP ? moduleXP : (monster && monster.xp_value != null ? monster.xp_value : null);

        const moduleHasTreasure = (od && Array.isArray(od.treasure)) || (encounter && Array.isArray(encounter.treasure));
        const moduleTreasure    = (od && Array.isArray(od.treasure)) ? od.treasure : (encounter && Array.isArray(encounter.treasure) ? encounter.treasure : null);
        const treasure = moduleHasTreasure ? moduleTreasure : (monster && monster.treasure != null ? monster.treasure : null);

        return { xp, treasure, moduleHasXP, moduleHasTreasure };
    }

    /** Expected XP and gold for defeated encounters in the current room. */
    function getExpectedRewardsForCurrentRoom() {
        const room = gd().module && gd().module.rooms && gd().module.rooms[gs().currentRoom];
        if (!room || !room.encounters) return { xpValues: [], goldAmounts: [] };
        const xpValues = [];
        const goldAmounts = [];
        for (const enc of room.encounters) {
            if (!getEncounterHP(enc).defeated) continue;
            const monster = resolveMonster(enc.monster_ref);
            const rewards = resolveEncounterRewards(enc, monster);
            if (rewards.xp != null) xpValues.push(rewards.xp);
            if (rewards.moduleHasTreasure && Array.isArray(rewards.treasure)) {
                for (const t of rewards.treasure) {
                    if ((t.item || '').toLowerCase() === 'gold' && t.quantity != null) {
                        goldAmounts.push(Number(t.quantity));
                    }
                }
            }
        }
        return { xpValues, goldAmounts };
    }

    function buildEncounterDescription(encounter, includeCurrentHP = false) {
        const monster = resolveMonster(encounter.monster_ref);
        if (!monster) return `Unknown monster: ${encounter.monster_ref}`;

        const hpInfo = includeCurrentHP ? getEncounterHP(encounter) : null;
        let hpStr;
        if (hpInfo && hpInfo.defeated) {
            hpStr = `DEFEATED (0/${hpInfo.max} HP) — narrate death, award XP/treasure from On death`;
        } else if (hpInfo) {
            hpStr = `${hpInfo.current}/${hpInfo.max} HP remaining`;
        } else {
            hpStr = `HP ${monster.hp}`;
        }

        const attackLines = (monster.attacks || []).map(a => {
            const r = (a.range || 'melee').toString().toLowerCase();
            const rangeStr = r === 'melee' ? 'melee' : `ranged ${a.range}`;
            return `${a.name} +${a.bonus} for ${a.damage} ${a.damage_type} (${rangeStr})`;
        }).join(' | ');
        const attackStr = attackLines || 'no attacks';

        let line = `${encounter.name} (${monster.name}, id ${encounter.id}): ${hpStr}, AC ${monster.ac} (use this exact AC for hit/miss). Attacks: ${attackStr}`;

        const rewards = resolveEncounterRewards(encounter, monster);
        const xp = rewards.xp;
        if (encounter.on_death || (monster.xp_value != null) || (monster.treasure != null) || rewards.moduleHasXP || rewards.moduleHasTreasure) {
            if (xp != null) line += ` | On death: award exactly ${xp} XP`;
            if (rewards.moduleHasTreasure) {
                const treasureList = Array.isArray(rewards.treasure) ? rewards.treasure : [];
                const treasureStr = treasureList.length > 0
                    ? treasureList.map(t => t.item === 'gold' ? `${t.quantity} gp` : t.item).join(', ')
                    : 'none';
                line += ` | Treasure (module): ${treasureStr}`;
                const goldEntry = treasureList.find(t => (t.item || '').toLowerCase() === 'gold');
                const goldQty = goldEntry && goldEntry.quantity != null ? Number(goldEntry.quantity) : null;
                const phrases = [];
                if (xp != null) phrases.push(`say "You gain ${xp} XP"`);
                if (goldQty != null) phrases.push(`say "You discover ${goldQty} gold" (or "${goldQty} gp")`);
                if (phrases.length) line += ` | Use these exact numbers: ${phrases.join('; ')}`;
            } else if (rewards.treasure != null && String(rewards.treasure).trim() !== '') {
                line += ` | Treasure (from monster manual): ${rewards.treasure}`;
                if (xp != null) line += ` | Say "You gain ${xp} XP"`;
            } else if (xp != null) {
                line += ` | Say "You gain ${xp} XP"`;
            }
        }
        return line;
    }

    global.UI = global.UI || {};
    global.UI.encounters = {
        resolveMonster,
        getFirstActiveEncounterInCurrentRoom,
        getMonsterDamageFormulaForCurrentRoom,
        getMonsterAttackInfoForCurrentRoom,
        getMonsterDamageFormulaFromAnyRoom,
        rollDiceFormula,
        getEncounterHP,
        getFirstRoomIdWithEncounters,
        ensureCombatRoomHasEncounters,
        getEncounterHistoryKey,
        recordEncounterHistoryForRoom,
        updateMonsterPanel,
        resolveEncounterRewards,
        getExpectedRewardsForCurrentRoom,
        buildEncounterDescription
    };

    // Legacy globals for still-inline callers.
    global.resolveMonster                        = resolveMonster;
    global.getFirstActiveEncounterInCurrentRoom  = getFirstActiveEncounterInCurrentRoom;
    global.getMonsterDamageFormulaForCurrentRoom = getMonsterDamageFormulaForCurrentRoom;
    global.getMonsterAttackInfoForCurrentRoom    = getMonsterAttackInfoForCurrentRoom;
    global.getMonsterDamageFormulaFromAnyRoom    = getMonsterDamageFormulaFromAnyRoom;
    global.rollDiceFormula                       = rollDiceFormula;
    global.getEncounterHP                        = getEncounterHP;
    global.getFirstRoomIdWithEncounters          = getFirstRoomIdWithEncounters;
    global.ensureCombatRoomHasEncounters         = ensureCombatRoomHasEncounters;
    global.getEncounterHistoryKey                = getEncounterHistoryKey;
    global.recordEncounterHistoryForRoom         = recordEncounterHistoryForRoom;
    global.updateMonsterPanel                    = updateMonsterPanel;
    global.resolveEncounterRewards               = resolveEncounterRewards;
    global.getExpectedRewardsForCurrentRoom      = getExpectedRewardsForCurrentRoom;
    global.buildEncounterDescription             = buildEncounterDescription;
})(typeof window !== 'undefined' ? window : globalThis);
