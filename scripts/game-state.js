/* AI Dungeon Crawler — GameState
 *
 * Stage 1c shim. Transforms v1 gameData into the pre-v1 shapes the existing
 * inline renderers expect, so the boot pipeline can swap to PackLoader without
 * touching the renderer code. Stage 2 rewrites the character panel to read v1
 * directly and retires most of this shim; the module/bestiary/rules wrappers
 * are retired in later stages as their consumers get rewritten.
 *
 * Entry point: GameState.init(gameData) -> shimmedGameData with
 * { character, rules, bestiary, module, setting } in pre-v1 shapes.
 *
 * Attaches to window.GameState.
 */
(function (global) {
    'use strict';

    // Accessor shortcuts for runtime state mutators (save/load, HP/XP/inventory).
    // The shim builders below take gameData as a parameter; these getters bridge
    // the runtime mutations to window.gameState/window.gameData.
    const gs = () => global.gameState;
    const gd = () => global.gameData;
    const debugLog = (...a) => { if (global.debugLog) global.debugLog(...a); };

    // v1 ability keys are short (str/dex/...); the pre-v1 renderers expect full names.
    const ABILITY_FULL_NAMES = {
        str: 'strength', dex: 'dexterity', con: 'constitution',
        int: 'intelligence', wis: 'wisdom', cha: 'charisma'
    };

    // B/X modifier table. Anything outside 3..18 clamps to the nearest bucket.
    const BX_MODIFIERS = [
        { max: 3,  mod: -3 }, { max: 5,  mod: -2 }, { max: 8,  mod: -1 },
        { max: 12, mod:  0 }, { max: 15, mod: +1 }, { max: 17, mod: +2 },
        { max: 18, mod: +3 }
    ];

    function modifierFor(score, formula) {
        if (formula === 'table_5e')      return Math.floor((score - 10) / 2);
        if (formula === 'score_is_mod')  return score;
        if (formula === 'table_bx') {
            for (const row of BX_MODIFIERS) if (score <= row.max) return row.mod;
            return BX_MODIFIERS[BX_MODIFIERS.length - 1].mod;
        }
        // Unknown formula — default to 5e so the sheet still renders.
        return Math.floor((score - 10) / 2);
    }

    function levelRow(rules, level) {
        const table = (rules.progression && rules.progression.level_table) || [];
        return table.find(r => r.level === level) || {};
    }

    function proficiencyBonus(character, rules) {
        const row = levelRow(rules, character.basic_info.level || 1);
        return typeof row.proficiency_bonus === 'number' ? row.proficiency_bonus : 0;
    }

    // max_formula lives on rules.resources.hit_points.max_formula. For Stage 1 we
    // interpret class_hd_plus_con as "max roll each level" (deterministic) and
    // average_class_hd_plus_con as "max at level 1, average for the rest" (the
    // D&D 5e canonical formula — matches Aldric's authored hp_current of 28).
    function hitDieSize(character, rules) {
        const classes = (rules.character_model && rules.character_model.classes) || {};
        const spec = classes[character.basic_info.class] || {};
        const die = (spec.hit_die || '1d8').replace(/^1d/i, '');
        const n = parseInt(die, 10);
        return Number.isFinite(n) ? n : 8;
    }

    function hpMax(character, rules) {
        const level = character.basic_info.level || 1;
        const conMod = modifierFor(character.ability_scores.con || 10,
            rules.character_model && rules.character_model.modifier_formula);
        const hd = hitDieSize(character, rules);
        const formula = (rules.resources && rules.resources.hit_points &&
                         rules.resources.hit_points.max_formula) || 'class_hd_plus_con';
        if (formula === 'average_class_hd_plus_con') {
            const avg = Math.floor(hd / 2) + 1;
            return hd + (level - 1) * avg + level * conMod;
        }
        // class_hd_plus_con (default): level * hd + level * CON_mod.
        return level * hd + level * conMod;
    }

    function resolveItem(itemId, gameData) {
        const modItems = (gameData.module && gameData.module.module_items
                          && gameData.module.module_items.items) || {};
        const libItems = (gameData.items && gameData.items.items) || {};
        return modItems[itemId] || libItems[itemId] || null;
    }

    function computeAC(character, rules, gameData) {
        const dexMod = modifierFor(character.ability_scores.dex || 10,
            rules.character_model && rules.character_model.modifier_formula);
        let ac = 10 + dexMod;
        for (const eq of (character.equipment || [])) {
            const item = resolveItem(eq.item_id, gameData);
            if (!item) continue;
            // Mundane armor / shields: item.armor.ac_bonus. Magic item riders: item.magic.ac_bonus.
            if (item.armor && typeof item.armor.ac_bonus === 'number') ac += item.armor.ac_bonus;
            if (item.magic && typeof item.magic.ac_bonus === 'number') ac += item.magic.ac_bonus;
        }
        return ac;
    }

    // Map an item + its equipped slot to one of the pre-v1 buckets
    // (worn / wielded / carried). The legacy renderer uses this distinction to
    // decide which items count as armor, weapons, and misc.
    function equipmentBucket(item, slot) {
        if (!item) return 'carried';
        if (slot === 'body' || slot === 'shield' || slot === 'head' ||
            slot === 'hands' || slot === 'feet' || slot === 'cloak') return 'worn';
        if (slot === 'main_hand' || slot === 'off_hand' || slot === 'two_handed' ||
            slot === 'ranged') return 'wielded';
        if (slot === 'neck' || slot === 'ring' || slot === 'belt') return 'worn';
        return 'carried';
    }

    // Translate a v1 item into the pre-v1 legacy shape the renderer reads.
    // Legacy expectations:
    //  - weapons have top-level .damage / .damage_type / .range (legacy tests `!!item.damage`)
    //  - armor has .ac = the FINAL AC when worn (not a bonus) — `getEffectiveAC()` returns
    //    that number straight through. The full composite (10 + DEX + armor + shield)
    //    is set by buildEquipmentBuckets on the body-slot item after computeAC runs.
    function legacyItemShape(item, slot, equipped) {
        const shape = {
            id:         item.id,
            name:       item.name,
            slot:       slot,
            equipped:   equipped,
            type:       item.type || null,
            properties: item.properties || []
        };
        // v1 nests weapon stats under item.weapon.* — surface them top-level so
        // legacy code paths that test item.damage / item.range keep working.
        const w = item.weapon || {};
        if (w.damage)      shape.damage      = w.damage;
        if (w.damage_type) shape.damage_type = w.damage_type;
        if (item.range)    shape.range       = item.range;
        if (w.ranged && !item.range) shape.range = 'ranged';
        return shape;
    }

    function buildEquipmentBuckets(character, rules, gameData) {
        const buckets = { worn: [], wielded: [], carried: [], backpack: [], coin: { gold: 0 } };
        for (const eq of (character.equipment || [])) {
            const item = resolveItem(eq.item_id, gameData);
            if (!item) continue;
            const bucket = equipmentBucket(item, eq.slot);
            buckets[bucket].push(legacyItemShape(item, eq.slot, true));
        }
        // Legacy `getEffectiveAC()` returns the first worn armor's .ac as the final AC.
        // Stamp the body-slot armor (preferred) or the first worn armor with the full
        // composite so the value actually matches what combat_stats.armor_class reports.
        const fullAC = computeAC(character, rules, gameData);
        const bodyArmor = buckets.worn.find(w => w.slot === 'body')
                       || buckets.worn.find(w => (w.type || '').toLowerCase() === 'armor');
        if (bodyArmor) bodyArmor.ac = fullAC;
        for (const p of (character.pack || [])) {
            const item = resolveItem(p.item_id, gameData);
            if (!item) continue;
            buckets.backpack.push({
                id:       item.id,
                name:     item.name,
                quantity: p.quantity || 1,
                type:     item.type || null,
                // Some code paths check damage on backpack items (e.g. spare weapons).
                damage:      item.damage,
                damage_type: item.damage_type,
                properties:  item.properties || []
            });
        }
        buckets.coin.gold = character.gold || 0;
        return buckets;
    }

    // Build the pre-v1 character object. The legacy renderer reads abilities by
    // full name ({strength: {score, modifier}}), skills as {id: {modifier}}, and
    // combat_stats / experience as pre-computed sub-objects.
    function buildShimmedCharacter(character, rules, gameData) {
        const formula = rules.character_model && rules.character_model.modifier_formula;

        const ability_scores = {};
        for (const [shortKey, score] of Object.entries(character.ability_scores || {})) {
            const fullKey = ABILITY_FULL_NAMES[shortKey] || shortKey;
            ability_scores[fullKey] = { score, modifier: modifierFor(score, formula) };
        }

        // Skills: the character stores proficient[] (v1); the renderer expects
        // a dict of { id: { modifier } }. Pick each declared skill and derive
        // its total. If rules.character_model.skills is empty (Three Knots),
        // this is an empty dict.
        const skills = {};
        const declaredSkills = (rules.character_model && rules.character_model.skills) || [];
        const proficient = new Set(((character.skills && character.skills.proficient) || []));
        const profBonus = proficiencyBonus(character, rules);
        for (const s of declaredSkills) {
            const shortAbility = s.ability || 'str';
            const score = character.ability_scores[shortAbility] || 10;
            const base = modifierFor(score, formula);
            const total = base + (proficient.has(s.id) ? profBonus : 0);
            skills[s.id] = { modifier: total };
        }

        const hpCurrent = typeof character.hp_current === 'number' ? character.hp_current : hpMax(character, rules);
        const hpMaximum = hpMax(character, rules);

        return {
            game_pack_id: character.game_pack_id,
            basic_info: {
                name:  character.basic_info.name,
                class: character.basic_info.class,
                level: character.basic_info.level
            },
            ability_scores,
            skills,
            combat_stats: {
                hit_points: {
                    current:   hpCurrent,
                    maximum:   hpMaximum,
                    hit_dice:  { total: character.basic_info.level }
                },
                armor_class:       computeAC(character, rules, gameData),
                proficiency_bonus: profBonus
            },
            experience: { current: character.xp || 0 },
            equipment:  buildEquipmentBuckets(character, rules, gameData),
            conditions: character.conditions || [],
            class_features:   character.class_features || [],
            feature_resources: character.feature_resources || {}
        };
    }

    // ------------------------------------------------------------
    // Rules / bestiary / module / setting shims
    //
    // These wrap the v1 shapes so the legacy inline renderers can keep reading
    // their pre-v1 paths. Each shim retires when its consumer gets rewritten
    // in a later stage (rules -> Stage 2, module -> Stage 5, bestiary -> mixed).
    // ------------------------------------------------------------

    function buildShimmedRules(rules) {
        // Pre-v1 code reads rules.combat.conditions as a dict keyed by id. v1
        // stores them as an array. Build both so code paths keep working.
        const conditionsDict = {};
        for (const c of (rules.conditions || [])) conditionsDict[c.id] = c;

        // Pre-v1 getXPLevels() expects a dict {1: 0, 2: 2000, ...}. v1 stores
        // the table as an array of {level, xp_required}. Convert so the
        // XP-bar + processLevelUp code uses real thresholds, not the fallback.
        const xpDict = {};
        const levelTable = (rules.progression && rules.progression.level_table) || [];
        for (const row of levelTable) {
            if (row && typeof row.level === 'number' && typeof row.xp_required === 'number') {
                xpDict[row.level] = row.xp_required;
            }
        }

        return {
            ...rules,
            combat: {
                ...(rules.combat || {}),
                conditions: conditionsDict
            },
            experience: {
                level_progression: xpDict
            },
            // Pre-v1: rules.core_mechanics.ability_checks carried the DC ladder.
            // Point it at v1 rules.difficulty so downstream reads resolve.
            core_mechanics: {
                ability_checks: rules.difficulty || {}
            }
        };
    }

    function buildShimmedBestiary(gameData) {
        // Legacy code does gameData.bestiary[monsterId]. v1 keeps monsters under
        // bestiary.monsters (shared) and module.module_bestiary.monsters (module).
        // Merge into one flat dict; module-scoped entries override shared.
        const flat = {};
        const shared = (gameData.bestiary && gameData.bestiary.monsters) || {};
        for (const [id, m] of Object.entries(shared)) flat[id] = m;
        const scoped = (gameData.module && gameData.module.module_bestiary
                        && gameData.module.module_bestiary.monsters) || {};
        for (const [id, m] of Object.entries(scoped)) flat[id] = m;
        return flat;
    }

    // Envelope fields live under .module in the raw module file; pack-loader
    // flattened them alongside rooms for Stage 1b convenience. Re-nest the
    // envelope so pre-v1 reads of gameData.module.module.starting_room still work.
    const MODULE_ENVELOPE_FIELDS = [
        'id', 'title', 'version', 'author', 'description',
        'starting_room', 'level_range', 'estimated_rooms',
        'estimated_playtime', 'tags', 'guidance'
    ];

    // Quick-and-dirty dice formula expander for the reward shim below.
    // Accepts "1d6", "2d4+1", "3", or a number; returns a number.
    // Eager resolution means rewards are deterministic within a game session
    // but re-roll between reloads — acceptable for Stage 1's pre-v1 legacy path.
    function rollFormulaNumeric(s) {
        if (typeof s === 'number') return s;
        if (typeof s !== 'string') return 0;
        const m = s.trim().match(/^(\d+)d(\d+)\s*([+-])?\s*(\d+)?$/i);
        if (!m) return parseInt(s, 10) || 0;
        const count = parseInt(m[1], 10);
        const sides = parseInt(m[2], 10);
        const sign  = m[3] === '-' ? -1 : 1;
        const mod   = m[4] ? sign * parseInt(m[4], 10) : 0;
        let sum = 0;
        for (let i = 0; i < count; i++) sum += Math.floor(Math.random() * sides) + 1;
        return sum + mod;
    }

    // Build a pre-v1 on_death object from a v1 encounter's rewards block.
    // Legacy processDiceRoll reads enc.on_death.{xp_award, treasure[{item, quantity}]}
    // V1 stores rewards under enc.rewards.{xp, treasure[{type, amount, item_id}]}
    // where xp may be a number or "from_bestiary" (-> monster.xp_value).
    function buildLegacyOnDeath(enc, monsterRef, gameData) {
        const r = enc.rewards;
        if (!r) return null;
        let xp_award = null;
        if (typeof r.xp === 'number') {
            xp_award = r.xp;
        } else if (r.xp === 'from_bestiary' && monsterRef) {
            const sharedMonsters = (gameData.bestiary && gameData.bestiary.monsters) || {};
            const scopedMonsters = (gameData.module && gameData.module.module_bestiary
                                    && gameData.module.module_bestiary.monsters) || {};
            const m = scopedMonsters[monsterRef] || sharedMonsters[monsterRef];
            if (m && m.xp_value != null) xp_award = m.xp_value;
        }
        const treasure = [];
        if (Array.isArray(r.treasure)) {
            const modItems = (gameData.module && gameData.module.module_items
                              && gameData.module.module_items.items) || {};
            const libItems = (gameData.items && gameData.items.items) || {};
            for (const t of r.treasure) {
                if (t.type === 'gold') {
                    treasure.push({ item: 'gold', quantity: rollFormulaNumeric(t.amount) });
                } else if (t.type === 'item' && t.item_id) {
                    const item = modItems[t.item_id] || libItems[t.item_id];
                    treasure.push({
                        item:     item ? item.name : t.item_id,
                        quantity: t.quantity || 1
                    });
                }
            }
        }
        return { xp_award, treasure };
    }

    function buildShimmedModule(gameData) {
        const mod = gameData.module || {};
        const envelope = {};
        for (const k of MODULE_ENVELOPE_FIELDS) {
            if (mod[k] !== undefined) envelope[k] = mod[k];
        }
        // Legacy code reads encounter.monster_ref at the top level; v1 nests it
        // under encounter.groups[0].monster_ref. Legacy reward code reads
        // encounter.on_death.{xp_award, treasure[{item, quantity}]}; v1 uses
        // encounter.rewards.{xp, treasure[{type, amount}]}. Translate both so the
        // pre-v1 renderers resolve their lookups. A later stage replaces those
        // callers with v1-aware ones.
        const shimmedRooms = {};
        for (const [roomId, room] of Object.entries(mod.rooms || {})) {
            const shimmedRoom = { ...room };
            if (Array.isArray(room.encounters)) {
                shimmedRoom.encounters = room.encounters.map(enc => {
                    const first = Array.isArray(enc.groups) && enc.groups.length ? enc.groups[0] : null;
                    const monsterRef = enc.monster_ref || (first && first.monster_ref) || null;
                    const shimEnc = { ...enc, monster_ref: monsterRef };
                    if (enc.rewards && !enc.on_death) {
                        shimEnc.on_death = buildLegacyOnDeath(enc, monsterRef, gameData);
                    }
                    return shimEnc;
                });
            }
            shimmedRooms[roomId] = shimmedRoom;
        }
        return {
            module:               envelope,
            rooms:                shimmedRooms,
            module_bestiary:      mod.module_bestiary || null,
            module_items:         mod.module_items || null,
            completion_condition: mod.completion_condition || null
        };
    }

    // Entry point: take a v1 gameData from PackLoader, return a shimmed object
    // the legacy renderers can consume. The v1 payload itself is preserved
    // under _v1 so modules extracted in later stages can read native shapes
    // without going through the shim.
    function init(gameData) {
        if (!gameData || !gameData.character || !gameData.rules || !gameData.module) {
            throw new Error('GameState.init: gameData is missing required archetypes');
        }
        return {
            character: buildShimmedCharacter(gameData.character, gameData.rules, gameData),
            rules:     buildShimmedRules(gameData.rules),
            bestiary:  buildShimmedBestiary(gameData),
            module:    buildShimmedModule(gameData),
            setting:   gameData.setting || null,
            _v1:       gameData
        };
    }

    const XP_LEVELS_DEFAULT = {
        1: 0, 2: 200, 3: 400, 4: 800, 5: 1600,
        6: 3200, 7: 6400, 8: 12800, 9: 25600, 10: 51200
    };

    /** Level thresholds from rules.experience.level_progression when present, else default. Used for XP bar and level-up. */
    function getXPLevels() {
        const prog = gd().rules && gd().rules.experience && gd().rules.experience.level_progression;
        if (prog && typeof prog === 'object' && Object.keys(prog).length > 0) {
            const out = {};
            for (const [k, v] of Object.entries(prog)) {
                const level = parseInt(k, 10);
                if (!isNaN(level) && typeof v === 'number') out[level] = v;
            }
            if (Object.keys(out).length > 0) return out;
        }
        return XP_LEVELS_DEFAULT;
    }

    const SAVE_KEY = 'gm-ai-dungeon-save';
    const SAVE_VERSION = 1;

    /** Serializable slice of game state for save. */
    function getStateToSave() {
        return {
            character: JSON.parse(JSON.stringify(gs().character)),
            currentRoom: gs().currentRoom,
            triggeredEvents: [...(gs().triggeredEvents || [])],
            conversationHistory: gs().conversationHistory.map(m => ({ role: m.role, content: m.content })),
            damageToEncounters: { ...(gs().damageToEncounters || {}) },
            inCombat: !!gs().inCombat,
            mode: gs().mode || 'exploration',
            equippedInUse: [...(gs().equippedInUse || [])],
            lastCombatRoom: gs().lastCombatRoom,
            encounterHistory: (gs().encounterHistory || []).map(e => ({ ...e })),
            readiedWeaponName: gs().readiedWeaponName,
            armorEquipped: !!gs().armorEquipped,
            lastUserRollType: gs().lastUserRollType,
            // Stage 4: hazard state rides with the save so fire-once hazards
            // stay resolved across reloads. Only the state table is persisted;
            // the in-flight queue + active plan are reconstructed from a fresh
            // trigger call after load.
            hazardState: JSON.parse(JSON.stringify(gs().hazardState || {})),
            // Stage 5: feature deltas, connection overrides, visited rooms.
            // Deltas-only shape means first-time entries still fire on_enter
            // hazards on load, puzzle solves stay solved, revealed doors stay
            // revealed, and the prompt's visited-flag stays accurate.
            featureState:        JSON.parse(JSON.stringify(gs().featureState || {})),
            connectionsModified: JSON.parse(JSON.stringify(gs().connectionsModified || {})),
            visitedRooms:        (gs().visitedRooms || []).slice()
        };
    }

    function saveGame() {
        if (!gs().character || gs().isDead) return;
        try {
            const payload = {
                version: SAVE_VERSION,
                gamePack: CONFIG.GAME_PACK,
                moduleTitle: gd().module && gd().module.module ? gd().module.module.title : '',
                savedAt: Date.now(),
                state: getStateToSave()
            };
            localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
            debugLog('SAVE', 'Game saved');
        } catch (e) {
            console.warn('Save failed:', e);
        }
    }

    function getSaveMetadata() {
        try {
            const raw = localStorage.getItem(SAVE_KEY);
            if (!raw) return null;
            const data = JSON.parse(raw);
            return data && data.version === SAVE_VERSION ? data : null;
        } catch (e) {
            return null;
        }
    }

    function hasValidSave() {
        const meta = getSaveMetadata();
        return meta && meta.gamePack === CONFIG.GAME_PACK;
    }

    function loadGame() {
        const meta = getSaveMetadata();
        if (!meta || meta.gamePack !== CONFIG.GAME_PACK) return false;
        const s = meta.state;
        if (!s || !s.character) return false;
        gs().character = s.character;
        gs().currentRoom = s.currentRoom;
        gs().triggeredEvents = s.triggeredEvents || [];
        gs().conversationHistory = s.conversationHistory || [];
        gs().damageToEncounters = s.damageToEncounters || {};
        gs().inCombat = !!s.inCombat;
        gs().mode = s.mode || (s.inCombat ? 'combat' : 'exploration');
        gs().equippedInUse = s.equippedInUse || [];
        gs().lastCombatRoom = s.lastCombatRoom;
        gs().encounterHistory = s.encounterHistory || [];
        gs().readiedWeaponName = s.readiedWeaponName || null;
        gs().armorEquipped = !!s.armorEquipped;
        gs().lastUserRollType = s.lastUserRollType || null;
        gs().hazardState = s.hazardState ? JSON.parse(JSON.stringify(s.hazardState)) : {};
        // Stage 5: rehydrate feature deltas + connection overrides + visited rooms.
        gs().featureState        = s.featureState        ? JSON.parse(JSON.stringify(s.featureState))        : {};
        gs().connectionsModified = s.connectionsModified ? JSON.parse(JSON.stringify(s.connectionsModified)) : {};
        gs().visitedRooms        = Array.isArray(s.visitedRooms) ? s.visitedRooms.slice() : [];
        gs().isDead = false;
        gs().pendingLevelUpAck = null;
        debugLog('SAVE', 'Game loaded');
        return true;
    }

    const MAX_LEVEL = 10;

    /** Hit die size for level-up HP (from character hit_dice e.g. "3d10" -> 10, or class default). */
    function getHitDieSize() {
        const hd = gd().character && gd().character.combat_stats
            && gd().character.combat_stats.hit_points
            && gd().character.combat_stats.hit_points.hit_dice
            && gd().character.combat_stats.hit_points.hit_dice.total;
        if (hd && typeof hd === 'string') {
            const m = hd.match(/d(\d+)/i);
            if (m) return parseInt(m[1], 10);
        }
        const cls = (gs().character && gs().character.class || '').toLowerCase();
        if (cls.includes('wizard') || cls.includes('sorcerer')) return 6;
        if (cls.includes('fighter') || cls.includes('paladin') || cls.includes('ranger')) return 10;
        if (cls.includes('cleric') || cls.includes('druid') || cls.includes('bard') || cls.includes('rogue')) return 8;
        return 8;
    }

    /** Process level-up: if XP meets next threshold and level < 10, add level and HP. */
    function processLevelUp() {
        const char = gs().character;
        if (!char || char.level >= MAX_LEVEL) return;
        const xpLevels = getXPLevels();
        while (char.level < MAX_LEVEL && xpLevels[char.level + 1] != null && char.xp >= xpLevels[char.level + 1]) {
            const sides = getHitDieSize();
            const roll = Math.floor(Math.random() * sides) + 1;
            const conMod = (char.abilities && char.abilities.con && char.abilities.con.modifier) || 0;
            const gain = Math.max(1, roll + conMod);
            char.level += 1;
            char.maxHp += gain;
            char.hp += gain;
            gs().pendingLevelUpAck = { level: char.level, hpGain: gain };
            addSystemMessage(`Level up! You are now level ${char.level}. Gained ${gain} HP (${roll}${conMod >= 0 ? '+' : ''}${conMod} CON).`);
            debugLog('STATE', `Level up to ${char.level}, +${gain} HP`);
        }
    }

    /**
     * Total modifier from active conditions for this roll. Used so the app enforces condition effects on dice.
     * @param {boolean} isAttackRoll - true for attack rolls, false for ability/skill checks
     * @param {string|null} abilityKey - for checks: 'str'|'dex'|'con'|'int'|'wis'|'cha' (wounded only applies to str/dex/con)
     * @returns {number} modifier to add to the roll (negative = penalty)
     */
    function getConditionModifierForRoll(isAttackRoll, abilityKey) {
        const char = gs().character;
        const conditions = char && char.conditions ? char.conditions : [];
        const condDefs = gd().rules && gd().rules.combat && gd().rules.combat.conditions;
        if (!condDefs || typeof condDefs !== 'object') return 0;
        let total = 0;
        conditions.forEach(c => {
            const id = (c.id || c.name || c).toLowerCase();
            const def = condDefs[id];
            if (!def || typeof def !== 'object') return;
            const level = c.level != null ? c.level : 1;
            if (isAttackRoll) {
                if (typeof def.attack_penalty === 'number') total += def.attack_penalty;
                if (typeof def.attack_penalty_per_level === 'number') total += def.attack_penalty_per_level * level;
            } else {
                const abilities = def.check_penalty_abilities;
                if (abilities && Array.isArray(abilities) && abilityKey && !abilities.includes(abilityKey.toLowerCase())) return;
                if (typeof def.check_penalty === 'number') total += def.check_penalty;
                if (typeof def.check_penalty_per_level === 'number') total += def.check_penalty_per_level * level;
            }
        });
        return total;
    }

    function modifyHP(amount) {
        debugLog('STATE', `Modifying HP by ${amount}`);
        gs().character.hp = Math.max(0, Math.min(gs().character.maxHp, gs().character.hp + amount));
        updateCharacterDisplay();
        if (gs().character.hp === 0) {
            gs().inCombat = false;
            gs().mode = 'exploration';
            gs().lastCombatRoom = gs().currentRoom;
            saveGame(); // save state just before marking dead so "Load save" restores to last moment
            gs().isDead = true;
            addSystemMessage("You have died! Your adventure ends here.");
            disableInput(true);
        } else {
            saveGame();
        }
    }
    
    function addXP(amount) {
        debugLog('STATE', `Adding ${amount} XP`);
        gs().character.xp += amount;
        processLevelUp();
        updateCharacterDisplay();
        saveGame();
    }
    
    function addToInventory(itemName, quantity = 1) {
        debugLog('STATE', `Adding to inventory: ${itemName} x${quantity}`);
        const existing = gs().character.inventory.find(i => i.name === itemName);
        if (existing) {
            if (typeof existing.quantity === 'number') {
                existing.quantity += quantity;
            } else {
                const match = existing.quantity.match(/(\d+)/);
                if (match) {
                    const current = parseInt(match[1]);
                    existing.quantity = `${current + quantity}gp`;
                }
            }
        } else {
            gs().character.inventory.push({ name: itemName, quantity });
        }
        updateCharacterDisplay();
        saveGame();
    }
    
    function removeFromInventory(itemName, quantity = 1) {
        debugLog('STATE', `Removing from inventory: ${itemName} x${quantity}`);
        const item = gs().character.inventory.find(i => i.name === itemName);
        if (item) {
            if (typeof item.quantity === 'number') {
                item.quantity = Math.max(0, item.quantity - quantity);
            } else if (typeof item.quantity === 'string' && item.name === 'Gold') {
                const m = item.quantity.match(/(\d+)/);
                if (m) {
                    const current = parseInt(m[1], 10);
                    const next = Math.max(0, current - quantity);
                    item.quantity = next > 0 ? `${next}gp` : '0gp';
                }
            }
        }
        updateCharacterDisplay();
        saveGame();
    }

    /** Deduct gold; returns true if the player had enough and was deducted. */
    function deductGold(amount) {
        if (amount <= 0) return true;
        const item = gs().character.inventory.find(i => i.name === 'Gold');
        if (!item) return false;
        const m = (item.quantity || '').toString().match(/(\d+)/);
        const current = m ? parseInt(m[1], 10) : 0;
        if (current < amount) return false;
        item.quantity = (current - amount) > 0 ? `${current - amount}gp` : '0gp';
        updateCharacterDisplay();
        saveGame();
        return true;
    }

    /** Current gold amount (number). */
    function getGold() {
        const item = gs().character.inventory.find(i => i.name === 'Gold');
        if (!item) return 0;
        const m = (item.quantity || '').toString().match(/(\d+)/);
        return m ? parseInt(m[1], 10) : 0;
    }

    /** Default specs for common weapons/armor when not in character data. Name (key) normalized to lowercase. */
    const DEFAULT_EQUIPMENT_SPECS = {
        longsword: { name: 'Longsword', damage: '1d8', damage_type: 'slashing', range: 'melee', properties: ['versatile (1d10)'] },
        shortsword: { name: 'Shortsword', damage: '1d6', damage_type: 'piercing', range: 'melee' },
        dagger: { name: 'Dagger', damage: '1d4', damage_type: 'piercing', range: 'melee', properties: ['finesse', 'light', 'thrown 20/60'] },
        shortbow: { name: 'Shortbow', damage: '1d6', damage_type: 'piercing', range: '80/320', properties: ['ammunition', 'two-handed'] },
        longbow: { name: 'Longbow', damage: '1d8', damage_type: 'piercing', range: '150/600', properties: ['ammunition', 'heavy', 'two-handed'] },
        'chain mail': { name: 'Chain Mail', type: 'armor', ac: 16, properties: ['heavy'] },
        'leather armor': { name: 'Leather Armor', type: 'armor', ac: 11, properties: [] },
        'studded leather': { name: 'Studded Leather', type: 'armor', ac: 12, properties: [] },
        shield: { name: 'Shield', type: 'armor', ac: 2, properties: [] }
    };

    /** Build catalog of equipment specs from gd() + defaults (name -> spec). Used for find/buy parsing. */
    function getEquipmentCatalog() {
        const catalog = new Map();
        const add = (name, spec) => {
            if (name && spec) catalog.set(String(name).trim().toLowerCase(), { ...spec, name: spec.name || name });
        };
        const data = gd().character && gd().character.equipment;
        if (data) {
            for (const item of [...(data.worn || []), ...(data.wielded || []), ...(data.carried || [])]) {
                const n = (item.name || '').trim().toLowerCase();
                if (!n) continue;
                if (item.damage) add(n, { name: item.name, damage: item.damage, damage_type: item.damage_type, range: item.range || 'melee', properties: item.properties });
                else if ((item.type || '').toLowerCase() === 'armor') add(n, { name: item.name, type: 'armor', ac: item.ac, properties: item.properties || [] });
            }
        }
        for (const [k, v] of Object.entries(DEFAULT_EQUIPMENT_SPECS)) {
            if (!catalog.has(k)) catalog.set(k, typeof v.name !== 'undefined' ? v : { ...v, name: k });
        }
        return catalog;
    }

    /** Add a weapon or armor to character equipment (from find/buy). Spec: weapon { name, damage, damage_type?, range?, properties? } or armor { name, type:'armor', ac, properties? }. */
    function addEquipmentItem(spec) {
        if (!spec || !spec.name) return;
        const isArmor = (spec.type || '').toLowerCase() === 'armor';
        const isWeapon = !!spec.damage;
        if (!isWeapon && !isArmor) return;
        const typeInfo = isWeapon ? getWeaponTypeInfo(spec) : { type: null, range: null };
        let stats = '';
        if (isWeapon) {
            const base = `${spec.damage} ${spec.damage_type || ''}`.trim();
            stats = typeInfo.type === 'ranged' && typeInfo.range
                ? `${base} (ranged ${typeInfo.range})`
                : `${base} (${typeInfo.type || 'melee'})`;
        } else {
            stats = Array.isArray(spec.properties) ? spec.properties.join(' - ') : (spec.properties || '');
        }
        const eq = {
            name: spec.name,
            stats,
            equipped: false,
            isWeapon,
            isArmor,
            weaponType: typeInfo.type,
            weaponRange: typeInfo.range
        };
        if (isArmor && spec.ac != null) eq.ac = spec.ac;
        if (isWeapon) {
            eq.damage = spec.damage;
            eq.damage_type = spec.damage_type || '';
            eq.range = spec.range || (typeInfo.range ? String(typeInfo.range) : 'melee');
            eq.properties = spec.properties;
        }
        gs().character.equipment.push(eq);
        updateCharacterDisplay();
        saveGame();
        debugLog('STATE', `Added equipment: ${spec.name}`);
    }

    /** Add a condition by id (from rules.combat.conditions). Id is case-insensitive; stored as lowercase. */
    function addCondition(id) {
        if (!id || typeof id !== 'string') return;
        const normId = id.trim().toLowerCase();
        if (!normId) return;
        const info = getConditionInfo(normId);
        if (!info.effect_summary && !info.effect_detail) {
            const ids = getConditionIdsFromRules();
            if (ids.length && !ids.includes(normId)) return;
        }
        const existing = gs().character.conditions.find(c => (c.id || c.name || '').toLowerCase() === normId);
        if (existing) return;
        gs().character.conditions.push({ id: normId });
        debugLog('STATE', `Condition added: ${normId}`);
        updateCharacterDisplay();
        saveGame();
    }

    // ------------------------------------------------------------
    // Stage 5 — module runtime state + reward dispatch
    //
    // Callers ask GameState for a unified moduleState view, pass it to
    // RulesEngine.prereqsMet / applyEffect, and then re-render the
    // affected panels. buildModuleState derives the `encounters` map
    // from damageToEncounters + authored encounter HP so prereq
    // evaluators that gate on encounter defeat work without a separate
    // encounter-state store (Stage 3 shim model stays authoritative).
    // ------------------------------------------------------------

    /**
     * Assemble the moduleState view the RulesEngine Stage 5 helpers expect.
     * Returns a live reference to gs().featureState and gs().connectionsModified
     * (so applyEffect's mutations persist), plus a derived encounters map
     * built from damageToEncounters + the room's authored encounter HP.
     */
    function buildModuleState() {
        if (!gs().featureState) gs().featureState = {};
        if (!gs().connectionsModified) gs().connectionsModified = {};
        if (!Array.isArray(gs().visitedRooms)) gs().visitedRooms = [];

        const encounters = {};
        const rooms = (gd().module && gd().module.rooms) || {};
        const damage = gs().damageToEncounters || {};
        for (const room of Object.values(rooms)) {
            for (const enc of (room.encounters || [])) {
                if (!enc || !enc.id) continue;
                const maxHp = (() => {
                    try { return (global.getEncounterHP && global.getEncounterHP(enc).max) || 0; }
                    catch (e) { return 0; }
                })();
                const dmg = Number(damage[enc.id] || 0);
                const defeated = maxHp > 0 && dmg >= maxHp;
                encounters[enc.id] = { defeated, resolved: defeated };
            }
        }

        return {
            features:            gs().featureState,
            connectionsModified: gs().connectionsModified,
            visitedRooms:        gs().visitedRooms,
            encounters
        };
    }

    /**
     * Record a room entry. Idempotent — first visit appends; later visits
     * are no-ops. Used by room-change wiring so the prompt + UI can
     * annotate "visited / unvisited" per connection.
     */
    function markRoomVisited(roomId) {
        if (!roomId) return false;
        if (!Array.isArray(gs().visitedRooms)) gs().visitedRooms = [];
        if (gs().visitedRooms.includes(roomId)) return false;
        gs().visitedRooms.push(roomId);
        debugLog('STATE', `Room visited: ${roomId}`);
        saveGame();
        return true;
    }

    /** Roll a dice formula string or return the integer unchanged. */
    function rollFormulaNumericLocal(spec) {
        if (typeof spec === 'number') return spec;
        if (typeof spec !== 'string') return 0;
        const re = global.RulesEngine;
        if (re && re.rollFormula) {
            const parsed = re.parseFormula && re.parseFormula(spec);
            if (parsed) return re.rollFormula(spec).total;
        }
        const n = parseInt(spec, 10);
        return Number.isFinite(n) ? n : 0;
    }

    /**
     * Apply a v1 reward (or an array of rewards) to the character. Surfaces
     * each application as a mechanics callout so the designer can see what
     * the engine awarded; mutates character state + pack. Supported types:
     *
     *   { type: "xp",   amount: <number|formula> }
     *   { type: "gold", amount: <number|formula> }
     *   { type: "item", item_id: "<id>", quantity?: <int> }
     *
     * xp_sources including "treasure_recovered" doubles gold rewards into
     * XP, per the Three Knots authoring convention; other packs ignore it.
     */
    function applyReward(reward, gameData) {
        if (!reward) return;
        if (Array.isArray(reward)) {
            reward.forEach(r => applyReward(r, gameData));
            return;
        }
        const type = reward.type;
        const callout = global.addMechanicsCallout || (() => {});

        if (type === 'xp') {
            const amt = rollFormulaNumericLocal(reward.amount);
            if (amt > 0 && global.addXP) global.addXP(amt);
            callout(`Reward: +${amt} XP`);
            debugLog('EFFECT', `reward xp +${amt}`);
            return;
        }

        if (type === 'gold') {
            const amt = rollFormulaNumericLocal(reward.amount);
            if (amt > 0) global.addToInventory('Gold', amt);
            callout(`Reward: +${amt} gold`);
            debugLog('EFFECT', `reward gold +${amt}`);
            // Packs that declare treasure_recovered in xp_sources award
            // gold-as-XP (Three Knots convention).
            const v1 = gameData && gameData._v1;
            const xpSources = (v1 && v1.rules && v1.rules.progression && v1.rules.progression.xp_sources) || [];
            if (amt > 0 && Array.isArray(xpSources) && xpSources.includes('treasure_recovered')) {
                if (global.addXP) global.addXP(amt);
                callout(`Reward: +${amt} XP (treasure recovered)`);
                debugLog('EFFECT', `reward xp (from gold) +${amt}`);
            }
            return;
        }

        if (type === 'item') {
            const itemId = reward.item_id;
            const qty = reward.quantity || 1;
            const v1 = gameData && gameData._v1;
            const modItems = (v1 && v1.module && v1.module.module_items && v1.module.module_items.items) || {};
            const libItems = (v1 && v1.items && v1.items.items) || {};
            const item = modItems[itemId] || libItems[itemId];
            const name = (item && item.name) || itemId || 'Item';

            // Mirror into the v1 pack so Stage 6's items pipeline finds it.
            if (v1 && v1.character) {
                if (!Array.isArray(v1.character.pack)) v1.character.pack = [];
                const existing = v1.character.pack.find(p => p && p.item_id === itemId);
                if (existing) existing.quantity = (existing.quantity || 1) + qty;
                else v1.character.pack.push({ item_id: itemId, quantity: qty });
            }
            // Mirror into the legacy inventory so the character panel shows it today.
            if (global.addToInventory) global.addToInventory(name, qty);
            callout(`Reward: ${name}${qty > 1 ? ` x${qty}` : ''}`);
            debugLog('EFFECT', `reward item ${itemId} x${qty}`);
            return;
        }

        debugLog('EFFECT', `reward unknown type: ${type}`);
    }

    /** Remove a condition by id. */
    function removeCondition(id) {
        if (!id || typeof id !== 'string') return;
        const normId = id.trim().toLowerCase();
        const before = gs().character.conditions.length;
        gs().character.conditions = gs().character.conditions.filter(
            c => (c.id || c.name || String(c)).toLowerCase() !== normId
        );
        if (gs().character.conditions.length < before) {
            debugLog('STATE', `Condition removed: ${normId}`);
            updateCharacterDisplay();
            saveGame();
        }
    }


    global.GameState = {
        init,
        getXPLevels,
        saveGame,
        loadGame,
        getSaveMetadata,
        hasValidSave,
        getStateToSave,
        modifyHP,
        addXP,
        addToInventory,
        removeFromInventory,
        deductGold,
        getGold,
        addEquipmentItem,
        getEquipmentCatalog,
        addCondition,
        removeCondition,
        processLevelUp,
        getHitDieSize,
        getConditionModifierForRoll,
        // Stage 5:
        buildModuleState,
        markRoomVisited,
        applyReward,
        _modifierFor: modifierFor,
        _hpMax: hpMax,
        _resolveItem: resolveItem,
        _buildShimmedCharacter: buildShimmedCharacter,
        _buildShimmedRules:     buildShimmedRules,
        _buildShimmedBestiary:  buildShimmedBestiary,
        _buildShimmedModule:    buildShimmedModule
    };

    // Legacy globals for still-inline callers. Retired as their callers move out.
    global.getXPLevels                  = getXPLevels;
    global.saveGame                     = saveGame;
    global.loadGame                     = loadGame;
    global.getSaveMetadata              = getSaveMetadata;
    global.hasValidSave                 = hasValidSave;
    global.getStateToSave               = getStateToSave;
    global.modifyHP                     = modifyHP;
    global.addXP                        = addXP;
    global.addToInventory               = addToInventory;
    global.removeFromInventory          = removeFromInventory;
    global.deductGold                   = deductGold;
    global.getGold                      = getGold;
    global.addEquipmentItem             = addEquipmentItem;
    global.getEquipmentCatalog          = getEquipmentCatalog;
    global.addCondition                 = addCondition;
    global.removeCondition              = removeCondition;
    global.processLevelUp               = processLevelUp;
    global.getHitDieSize                = getHitDieSize;
    global.getConditionModifierForRoll  = getConditionModifierForRoll;
    // Stage 5 legacy globals.
    global.buildModuleState             = buildModuleState;
    global.markRoomVisited              = markRoomVisited;
    global.applyReward                  = applyReward;
})(typeof window !== 'undefined' ? window : globalThis);
