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
    function legacyItemShape(item, slot, equipped) {
        const shape = {
            id:         item.id,
            name:       item.name,
            slot:       slot,
            equipped:   equipped,
            type:       item.type || null,
            properties: item.properties || []
        };
        if (item.damage)        shape.damage      = item.damage;
        if (item.damage_type)   shape.damage_type = item.damage_type;
        if (item.range)         shape.range       = item.range;
        // Legacy renderer reads .ac as 10 + bonus. Accept armor.ac_bonus or magic.ac_bonus.
        const armorAc = (item.armor && item.armor.ac_bonus) || 0;
        const magicAc = (item.magic && item.magic.ac_bonus) || 0;
        if (armorAc || magicAc) shape.ac = 10 + armorAc + magicAc;
        return shape;
    }

    function buildEquipmentBuckets(character, gameData) {
        const buckets = { worn: [], wielded: [], carried: [], backpack: [], coin: { gold: 0 } };
        for (const eq of (character.equipment || [])) {
            const item = resolveItem(eq.item_id, gameData);
            if (!item) continue;
            const bucket = equipmentBucket(item, eq.slot);
            buckets[bucket].push(legacyItemShape(item, eq.slot, true));
        }
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
            equipment:  buildEquipmentBuckets(character, gameData),
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

        return {
            ...rules,
            combat: {
                ...(rules.combat || {}),
                conditions: conditionsDict
            },
            // Pre-v1: rules.experience.level_progression is the XP table.
            experience: {
                level_progression: (rules.progression && rules.progression.level_table) || []
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

    function buildShimmedModule(gameData) {
        const mod = gameData.module || {};
        const envelope = {};
        for (const k of MODULE_ENVELOPE_FIELDS) {
            if (mod[k] !== undefined) envelope[k] = mod[k];
        }
        return {
            module:               envelope,
            rooms:                mod.rooms || {},
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

    global.GameState = {
        init,
        _modifierFor: modifierFor,
        _hpMax: hpMax,
        _resolveItem: resolveItem,
        _buildShimmedCharacter: buildShimmedCharacter,
        _buildShimmedRules:     buildShimmedRules,
        _buildShimmedBestiary:  buildShimmedBestiary,
        _buildShimmedModule:    buildShimmedModule
    };
})(typeof window !== 'undefined' ? window : globalThis);
