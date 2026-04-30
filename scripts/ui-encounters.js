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

    /**
     * Phase 1: monster stats resolve to the FIRST ACTIVE INSTANCE rather
     * than the encounter's first-group monster_ref. This matters for
     * heterogeneous groups (e.g. 2 scouts + 1 brute): once both scouts are
     * down, the brute's attack/damage should drive the monster turn — pre-
     * Phase-1 the brute would silently keep using the scout's stats because
     * enc.monster_ref always pointed at groups[0].
     *
     * For x1 / homogeneous encounters this is identical to the old behavior.
     */
    function activeInstanceMonsterRef(enc) {
        const inst = global.getFirstActiveInstance && global.getFirstActiveInstance(enc);
        return (inst && inst.monster_ref) || (enc && enc.monster_ref) || null;
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
        const monster = resolveMonster(activeInstanceMonsterRef(enc));
        if (!monster || !monster.attacks || monster.attacks.length === 0) return null;
        const a = monster.attacks[0];
        return (a.damage || '').trim() || null;
    }

    /** Attack bonus + weapon name for first attack of first active encounter in current room. */
    function getMonsterAttackInfoForCurrentRoom() {
        const enc = getFirstActiveEncounterInCurrentRoom();
        if (!enc) return null;
        const monster = resolveMonster(activeInstanceMonsterRef(enc));
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
                const monster = resolveMonster(activeInstanceMonsterRef(enc));
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

    /**
     * Current HP for an encounter — the SUM across every instance.
     *
     * Phase 1: reads enc.instances[].current_hp / .max_hp directly. The
     * shape ({current, max, defeated}) is unchanged so callers don't need
     * updates yet. Aggregate semantics: a 3-goblin encounter reports
     * 28/28 HP instead of the pre-Phase-1 7/7.
     */
    function getEncounterHP(encounter) {
        if (!encounter || !Array.isArray(encounter.instances) || encounter.instances.length === 0) {
            return { current: 0, max: 0, defeated: true };
        }
        let max = 0, current = 0;
        for (const inst of encounter.instances) {
            max     += Number(inst.max_hp) || 0;
            current += Math.max(0, Number(inst.current_hp) || 0);
        }
        const defeated = encounter.instances.every(inst => inst.defeated);
        return { current, max, defeated };
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
            if (global.updateCharacterDisplay) global.updateCharacterDisplay();
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
            // Phase 1: snapshot every instance so post-combat panels have
            // per-creature data even after combat ends and the live enc is
            // mutated. Phase 2's per-instance UI reads this directly.
            const instancesSnapshot = (enc.instances || []).map(inst => ({
                instance_id: inst.instance_id,
                monster_ref: inst.monster_ref,
                max_hp:      inst.max_hp,
                current_hp:  inst.current_hp,
                defeated:    !!inst.defeated
            }));
            const idx = gs().encounterHistory.findIndex(e => e.key === key);
            const base = {
                key,
                roomId,
                roomName:        room.name || roomId,
                encounterId:     enc.id,
                displayName:     enc.name || (monster && monster.name) || enc.monster_ref || 'Unknown',
                monsterRef:      enc.monster_ref || null,
                acSnapshot:      ac != null ? ac : '—',
                attacksSnapshot: attacks,
                instancesSnapshot
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

    /** Pretty per-instance label, e.g. "Goblin Scout #2" or "Goblin Brute". */
    function instanceDisplayName(inst, monster) {
        const monsterName = (monster && monster.name) || inst.monster_ref || 'Creature';
        // Suppress the "#1" suffix when an encounter has only one instance of
        // this monster_ref — most encounters are solos and reading "Goblin
        // Brute #1" beside no second brute is just noise.
        const suffix = /(_\d+)$/.test(inst.instance_id) ? inst.instance_id.match(/_(\d+)$/)[1] : null;
        return suffix ? `${monsterName} #${suffix}` : monsterName;
    }

    function escapePanelHtml(s) {
        return String(s || '').replace(/[&<>"']/g, ch =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    /**
     * Phase 2: render per-instance rows under each encounter header.
     *
     * Encounter header keeps the monster's AC + attacks (the bestiary block
     * applies to every instance of that monster_ref). Rows underneath give
     * one HP bar per instance, dimmed/strikethrough on defeat. Heterogeneous
     * encounters (2 scouts + 1 brute) read the per-instance ref off the
     * snapshot so the row name matches the actual creature, not the first
     * group's monster_ref.
     */
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
            // Live instances when the encounter is still in the room data;
            // otherwise fall back to the snapshot we stashed on combat exit.
            const liveInstances     = (enc && Array.isArray(enc.instances)) ? enc.instances : [];
            const snapshotInstances = Array.isArray(hist.instancesSnapshot) ? hist.instancesSnapshot : [];
            const instances = liveInstances.length ? liveInstances : snapshotInstances;
            const totalCount    = instances.length;
            const defeatedCount = instances.filter(i => i && i.defeated).length;

            if (!monster) {
                const status = hpInfo.defeated ? 'Defeated' : 'Active';
                html += `<div class="monster-stat-block${hpInfo.defeated ? ' defeated' : ''}"><div class="monster-stat-name">${escapePanelHtml(hist.displayName)}</div><div class="monster-stat-line">Status: ${status}</div><div class="monster-stat-line">Unknown monster: ${escapePanelHtml(monsterRef || '—')}</div></div>`;
                continue;
            }
            const ac = monster.ac != null ? monster.ac : (monster.AC != null ? monster.AC : (hist.acSnapshot != null ? hist.acSnapshot : '—'));
            const defeatedClass = hpInfo.defeated ? ' defeated' : '';
            const headerStatus = hpInfo.defeated
                ? 'Defeated'
                : (totalCount > 1 ? `Active — ${totalCount - defeatedCount} of ${totalCount} remaining` : 'Active');
            // Phase 2: heterogeneous encounters (mixed monster_refs) carry
            // per-instance AC on each row instead. Suppressing the encounter-
            // header AC line keeps it honest — a single AC value would be
            // wrong half the time.
            const refs = new Set(instances.map(i => i && i.monster_ref).filter(Boolean));
            const homogeneous = refs.size <= 1;
            html += `<div class="monster-stat-block${defeatedClass}">`;
            html += `<div class="monster-stat-name">${escapePanelHtml(hist.displayName)}</div>`;
            html += `<div class="monster-stat-line">Status: ${headerStatus}</div>`;
            if (hist.roomName) html += `<div class="monster-stat-line">Room: ${escapePanelHtml(hist.roomName)}</div>`;
            if (homogeneous) html += `<div class="monster-stat-line">AC ${ac}</div>`;
            // Aggregate HP — sum across instances. Useful for at-a-glance
            // "how much fight left in this group" reads.
            html += `<div class="monster-stat-line">HP ${hpInfo.current}/${hpInfo.max}</div>`;

            // Per-instance rows — only when the encounter has 2+ instances.
            // Single-instance encounters keep the unobtrusive Phase 1 look.
            // Phase 2: each row carries its own AC, since heterogeneous
            // encounters (e.g. 2 scouts + 1 brute) almost always have
            // different per-monster ACs and the player needs to see them
            // before picking a target on the attack-roll step.
            if (instances.length >= 2) {
                html += '<div class="monster-instances">';
                for (const inst of instances) {
                    const instMonster = resolveMonster(inst.monster_ref) || monster;
                    const name   = instanceDisplayName(inst, instMonster);
                    const max    = Number(inst.max_hp) || 0;
                    const cur    = Math.max(0, Number(inst.current_hp) || 0);
                    const pct    = max > 0 ? Math.round((cur / max) * 100) : 0;
                    const instAc = (instMonster && instMonster.ac != null)
                        ? instMonster.ac
                        : (instMonster && instMonster.AC != null ? instMonster.AC : '—');
                    const rowCls = inst.defeated ? 'monster-instance-row defeated' : 'monster-instance-row';
                    html += `<div class="${rowCls}" title="${escapePanelHtml(inst.instance_id)}">`;
                    html += `<span class="monster-instance-name">${escapePanelHtml(name)}</span>`;
                    html += `<span class="monster-instance-ac">AC ${instAc}</span>`;
                    html += `<span class="monster-instance-hp">${cur}/${max}</span>`;
                    html += `<span class="monster-instance-bar"><span class="monster-instance-bar-fill" style="width: ${pct}%"></span></span>`;
                    html += '</div>';
                }
                html += '</div>';
            }

            const attacks = (monster.attacks && monster.attacks.length > 0) ? monster.attacks : (hist.attacksSnapshot || []);
            if (attacks.length > 0) {
                html += '<div class="monster-stat-attacks">';
                for (const a of attacks) {
                    const range = (a.range || 'melee').toString().toLowerCase();
                    const rangeStr = range === 'melee' ? 'melee' : `ranged ${a.range}`;
                    html += `<div class="monster-stat-attack">${escapePanelHtml(a.name)}: +${a.bonus != null ? a.bonus : '0'} to hit, ${escapePanelHtml(a.damage || '—')} ${escapePanelHtml(a.damage_type || '')} (${rangeStr})</div>`;
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

    /**
     * Phase 2: GM-facing encounter description grows from one line to a
     * header line plus one indented per-instance line. The header carries
     * encounter-level info (id, AC of the first-group monster, attacks,
     * rewards). Each instance line gives the GM the stable instance_id it
     * should target with [DAMAGE_TO_MONSTER: <instance_id>, N], the
     * monster name + current HP, and (for defeated instances) a reminder
     * NOT to let it act further.
     *
     * Single-instance encounters fall back to the compact one-line shape so
     * the prompt budget doesn't grow on solo fights.
     */
    function buildEncounterDescription(encounter, includeCurrentHP = false) {
        const monster = resolveMonster(encounter.monster_ref);
        if (!monster) return `Unknown monster: ${encounter.monster_ref}`;

        const instances = Array.isArray(encounter.instances) ? encounter.instances : [];
        const hpInfo = includeCurrentHP ? getEncounterHP(encounter) : null;

        // Build the rewards suffix once — applied to both the single-instance
        // and multi-instance shapes so the GM hears about XP / treasure
        // exactly once per encounter regardless of layout.
        const rewards = resolveEncounterRewards(encounter, monster);
        const xp = rewards.xp;
        let rewardSuffix = '';
        if (encounter.on_death || (monster.xp_value != null) || (monster.treasure != null) || rewards.moduleHasXP || rewards.moduleHasTreasure) {
            if (xp != null) rewardSuffix += ` | On death: award exactly ${xp} XP`;
            if (rewards.moduleHasTreasure) {
                const treasureList = Array.isArray(rewards.treasure) ? rewards.treasure : [];
                const treasureStr = treasureList.length > 0
                    ? treasureList.map(t => t.item === 'gold' ? `${t.quantity} gp` : t.item).join(', ')
                    : 'none';
                rewardSuffix += ` | Treasure (module): ${treasureStr}`;
                const goldEntry = treasureList.find(t => (t.item || '').toLowerCase() === 'gold');
                const goldQty = goldEntry && goldEntry.quantity != null ? Number(goldEntry.quantity) : null;
                const phrases = [];
                if (xp != null) phrases.push(`say "You gain ${xp} XP"`);
                if (goldQty != null) phrases.push(`say "You discover ${goldQty} gold" (or "${goldQty} gp")`);
                if (phrases.length) rewardSuffix += ` | Use these exact numbers: ${phrases.join('; ')}`;
            } else if (rewards.treasure != null && String(rewards.treasure).trim() !== '') {
                rewardSuffix += ` | Treasure (from monster manual): ${rewards.treasure}`;
                if (xp != null) rewardSuffix += ` | Say "You gain ${xp} XP"`;
            } else if (xp != null) {
                rewardSuffix += ` | Say "You gain ${xp} XP"`;
            }
        }

        const attackLines = (monster.attacks || []).map(a => {
            const r = (a.range || 'melee').toString().toLowerCase();
            const rangeStr = r === 'melee' ? 'melee' : `ranged ${a.range}`;
            return `${a.name} +${a.bonus} for ${a.damage} ${a.damage_type} (${rangeStr})`;
        }).join(' | ');
        const attackStr = attackLines || 'no attacks';

        // Single-instance: keep the compact one-line shape (saves prompt size
        // on the common solo-fight case).
        if (instances.length <= 1) {
            let hpStr;
            if (hpInfo && hpInfo.defeated) {
                hpStr = `DEFEATED (0/${hpInfo.max} HP) — narrate death, award XP/treasure from On death`;
            } else if (hpInfo) {
                hpStr = `${hpInfo.current}/${hpInfo.max} HP remaining`;
            } else {
                hpStr = `HP ${monster.hp}`;
            }
            const idTrail = instances.length === 1
                ? `, instance ${instances[0].instance_id}`
                : '';
            return `${encounter.name} (${monster.name}, id ${encounter.id}${idTrail}): ${hpStr}, AC ${monster.ac} (use this exact AC for hit/miss). Attacks: ${attackStr}${rewardSuffix}`;
        }

        // Multi-instance: header + per-instance lines. The GM should target
        // by instance_id when it knows which creature took the hit; otherwise
        // the encounter id falls back to the lowest-HP active instance.
        //
        // Heterogeneous encounters (mixed monster_refs, e.g. 2 scouts + 1
        // brute) carry per-instance AC on each line instead of a single
        // header AC, since a single AC would be wrong for at least one
        // creature. Homogeneous encounters keep the encounter-level AC.
        const activeCount = instances.filter(i => !i.defeated).length;
        const statusStr = hpInfo && hpInfo.defeated
            ? `DEFEATED — narrate the last death, award XP/treasure from On death`
            : `ACTIVE — ${activeCount} of ${instances.length} instances remaining`;
        const refs = new Set(instances.map(i => i && i.monster_ref).filter(Boolean));
        const homogeneous = refs.size <= 1;

        const acFragment = homogeneous ? `AC ${monster.ac}. ` : '';
        let header = `${encounter.name} (id ${encounter.id}): ${acFragment}Status: ${statusStr}. Attacks: ${attackStr}${rewardSuffix}`;
        let lines = [header];
        for (const inst of instances) {
            const im = resolveMonster(inst.monster_ref) || monster;
            const max = Number(inst.max_hp) || 0;
            const cur = Math.max(0, Number(inst.current_hp) || 0);
            const acStr = homogeneous ? '' : (im.ac != null ? `AC ${im.ac}, ` : '');
            const status = inst.defeated
                ? `DEFEATED, ${cur}/${max} — narrate the death; do NOT let this creature act`
                : `${acStr}HP ${cur}/${max}`;
            lines.push(`  - ${inst.instance_id} (${im.name || inst.monster_ref}, ${status})`);
        }
        return lines.join('\n');
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
