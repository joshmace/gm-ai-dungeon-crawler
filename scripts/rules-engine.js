/* AI Dungeon Crawler — Rules Engine
 *
 * Pure functions for OSR-style combat and checks. No DOM. No game-state access.
 * Callers pass all inputs and apply returned results themselves. This keeps
 * adjudication testable and lets the GM prompt shrink to narration only.
 *
 * Attaches to window.RulesEngine so it can be used from the main HTML without a build step.
 *
 * Conventions:
 * - "natural" = the d20 die face (1..20) before modifiers.
 * - A crit is natural 20 on an attack d20 only. A fumble is natural 1.
 * - On a crit hit, the weapon dice are doubled but flat modifiers are not (e.g. 1d8+3 -> 2d8+3).
 * - Attack hits when total >= AC. (Ties hit.)
 * - All randomness goes through the injected `rng` (defaults to Math.random) so tests can be deterministic.
 */
(function (global) {
    'use strict';

    function defaultRng() { return Math.random(); }

    /** Roll a single die with `sides` faces using `rng`. Returns an integer in [1, sides]. */
    function rollDie(sides, rng) {
        const r = rng || defaultRng;
        return Math.floor(r() * sides) + 1;
    }

    /**
     * Parse an "NdM" or "NdM+K" / "NdM-K" formula.
     * Returns { count, sides, mod } or null if the string isn't a valid formula.
     */
    function parseFormula(formula) {
        if (!formula || typeof formula !== 'string') return null;
        const m = formula.trim().match(/^(\d+)d(\d+)\s*([+-])?\s*(\d+)?$/i);
        if (!m) return null;
        const count = parseInt(m[1], 10);
        const sides = parseInt(m[2], 10);
        const sign = m[3] === '-' ? -1 : 1;
        const mod = m[4] ? sign * parseInt(m[4], 10) : 0;
        return { count, sides, mod };
    }

    /**
     * Roll a dice formula. `opts.doubleDice` doubles the die count (for crits).
     * `opts.extraMod` adds to the flat modifier (e.g. STR bonus on top of weapon mod).
     * Returns { total, rolls, mod, breakdown, doubled } where `rolls` are the individual die results.
     */
    function rollFormula(formula, opts) {
        const options = opts || {};
        const parsed = parseFormula(formula);
        if (!parsed) return { total: 0, rolls: [], mod: 0, breakdown: formula || '', doubled: false };
        const count = options.doubleDice ? parsed.count * 2 : parsed.count;
        const extraMod = Number(options.extraMod) || 0;
        const mod = parsed.mod + extraMod;
        const rng = options.rng;
        const rolls = [];
        let sum = 0;
        for (let i = 0; i < count; i++) {
            const r = rollDie(parsed.sides, rng);
            rolls.push(r);
            sum += r;
        }
        const total = sum + mod;
        const modStr = mod !== 0 ? (mod >= 0 ? ` + ${mod}` : ` - ${Math.abs(mod)}`) : '';
        const dieStr = `${count}d${parsed.sides}`;
        const breakdown = `${dieStr} (${rolls.join(' + ')}${modStr}) = ${total}`;
        return { total, rolls, mod, breakdown, doubled: !!options.doubleDice };
    }

    /**
     * Roll a d20 with a modifier. Returns { natural, total, isCrit, isFumble }.
     * Crit/fumble flags are only meaningful for d20 rolls used as attacks or checks.
     */
    function rollD20(modifier, opts) {
        const options = opts || {};
        const mod = Number(modifier) || 0;
        const natural = rollDie(20, options.rng);
        return {
            natural,
            total: natural + mod,
            isCrit: natural === 20,
            isFumble: natural === 1
        };
    }

    /**
     * Resolve a single attack. Rolls d20 to hit; on a hit, rolls damage (with crit doubling if natural 20).
     * On a fumble (natural 1), always misses — no damage roll.
     *
     * Inputs:
     *   attackBonus   - total modifier added to the d20 (ability mod + proficiency)
     *   damageFormula - weapon dice e.g. "1d8"
     *   damageBonus   - flat bonus added to damage (ability mod)
     *   targetAC      - target's Armor Class (hit if total >= AC)
     *   rng           - optional RNG
     *
     * Returns:
     *   {
     *     attack:  { natural, total, hit, isCrit, isFumble },
     *     damage:  null | { total, rolls, mod, breakdown, doubled }
     *   }
     */
    function resolveAttack(input) {
        const attackBonus = Number(input.attackBonus) || 0;
        const damageFormula = input.damageFormula || '1d4';
        const damageBonus = Number(input.damageBonus) || 0;
        const targetAC = Number(input.targetAC) || 10;
        const rng = input.rng;

        const atk = rollD20(attackBonus, { rng });
        const hit = !atk.isFumble && atk.total >= targetAC;

        const attack = {
            natural: atk.natural,
            total: atk.total,
            hit,
            isCrit: atk.isCrit && hit,
            isFumble: atk.isFumble
        };

        if (!hit) return { attack, damage: null };

        const damage = rollFormula(damageFormula, {
            doubleDice: attack.isCrit,
            extraMod: damageBonus,
            rng
        });
        return { attack, damage };
    }

    /**
     * Resolve a monster attack against the player. Same shape as resolveAttack, but crits
     * by monsters do not double damage in this ruleset (OSR convention here).
     */
    function resolveMonsterAttack(input) {
        const attackBonus = Number(input.attackBonus) || 0;
        const damageFormula = input.damageFormula || '1d4';
        const targetAC = Number(input.targetAC) || 10;
        const rng = input.rng;

        const atk = rollD20(attackBonus, { rng });
        const hit = !atk.isFumble && atk.total >= targetAC;
        const attack = {
            natural: atk.natural,
            total: atk.total,
            hit,
            isCrit: atk.isCrit && hit,
            isFumble: atk.isFumble
        };
        if (!hit) return { attack, damage: null };
        const damage = rollFormula(damageFormula, { rng });
        return { attack, damage };
    }

    /**
     * Resolve an ability/skill check against a DC.
     * Returns { natural, total, success, isCrit, isFumble, margin }.
     * margin = total - dc (positive = succeeded by, negative = failed by).
     */
    function resolveCheck(input) {
        const modifier = Number(input.modifier) || 0;
        const dc = Number(input.dc) || 10;
        const r = rollD20(modifier, { rng: input.rng });
        return {
            natural: r.natural,
            total: r.total,
            success: r.total >= dc && !r.isFumble,
            isCrit: r.isCrit,
            isFumble: r.isFumble,
            margin: r.total - dc
        };
    }

    /**
     * Apply damage to an HP pool. Returns { newHP, dealt, defeated }.
     * `dealt` is the actual amount removed (capped at current HP so over-damage doesn't go negative).
     */
    function applyDamage(currentHP, amount) {
        const cur = Number(currentHP) || 0;
        const amt = Math.max(0, Number(amount) || 0);
        const dealt = Math.min(cur, amt);
        const newHP = cur - dealt;
        return { newHP, dealt, defeated: newHP <= 0 };
    }

    /**
     * Apply healing up to maxHP. Returns { newHP, healed, overheal }.
     */
    function applyHealing(currentHP, maxHP, amount) {
        const cur = Number(currentHP) || 0;
        const max = Number(maxHP) || cur;
        const amt = Math.max(0, Number(amount) || 0);
        const target = Math.min(max, cur + amt);
        const healed = target - cur;
        return { newHP: target, healed, overheal: amt - healed };
    }

    /**
     * DC lookup by label (Easy/Medium/Hard/etc.) from a rules dc_scale object.
     * Falls back to the standard OSR numbers if the table is missing.
     */
    function dcFor(label, dcScale) {
        const standard = { Easy: 10, Medium: 15, Hard: 20, 'Very Hard': 25 };
        if (dcScale && typeof dcScale === 'object' && dcScale[label] != null) return Number(dcScale[label]);
        return standard[label] != null ? standard[label] : 10;
    }

    // ------------------------------------------------------------
    // Stage 2 — Derived-stat pipeline
    //
    // deriveSheet(character, rules, itemsById, options) takes the v1 raw
    // character + the active rules pack + an item resolver and returns the
    // values the character panel renders. Pure function — no DOM, no
    // state mutation. Callers re-run it whenever authoring data changes.
    //
    // Supports both rules-pack variations Stage 2 targets:
    //   - abilities: modifier_formula = table_5e | table_bx | score_is_mod
    //   - saves:     type = per_ability | categorical
    //   - skills:    full skill list OR empty (Three Knots)
    //
    // Magic bonuses from equipped items are folded in here too (stage 6
    // wires them into attack/save/check rolls; stage 2 just renders them).
    // ------------------------------------------------------------

    // B/X modifier table (matches the pre-v1 shim in game-state.js so the
    // two stay in lockstep while the shim is still alive).
    const BX_MODIFIERS = [
        { max: 3,  mod: -3 }, { max: 5,  mod: -2 }, { max: 8,  mod: -1 },
        { max: 12, mod:  0 }, { max: 15, mod: +1 }, { max: 17, mod: +2 },
        { max: 18, mod: +3 }
    ];

    /** Ability-score modifier from a raw score under the rules pack's formula. */
    function modifierFor(score, formula) {
        if (formula === 'table_5e')     return Math.floor((Number(score) - 10) / 2);
        if (formula === 'score_is_mod') return Number(score) || 0;
        if (formula === 'table_bx') {
            for (const row of BX_MODIFIERS) if (score <= row.max) return row.mod;
            return BX_MODIFIERS[BX_MODIFIERS.length - 1].mod;
        }
        return Math.floor((Number(score) - 10) / 2);
    }

    function levelRow(rules, level) {
        const table = (rules && rules.progression && rules.progression.level_table) || [];
        return table.find(r => r.level === level) || {};
    }

    /** Proficiency bonus for this level, or 0 if the rules pack doesn't declare one. */
    function proficiencyBonusFor(character, rules) {
        const row = levelRow(rules, (character.basic_info && character.basic_info.level) || 1);
        return typeof row.proficiency_bonus === 'number' ? row.proficiency_bonus : 0;
    }

    function hitDieSize(character, rules) {
        const classes = (rules && rules.character_model && rules.character_model.classes) || {};
        const cls = character.basic_info && character.basic_info.class;
        const spec = (cls && classes[cls]) || {};
        const die = (spec.hit_die || '1d8').replace(/^1d/i, '');
        const n = parseInt(die, 10);
        return Number.isFinite(n) ? n : 8;
    }

    /**
     * HP max from the rules pack's max_formula.
     *   class_hd_plus_con          — max die every level (OSR default).
     *   average_class_hd_plus_con  — max at L1, average thereafter (5e standard).
     * Both variants also add `level * CON_mod`.
     */
    function hpMaxFor(character, rules) {
        const level   = (character.basic_info && character.basic_info.level) || 1;
        const formula = (rules && rules.character_model && rules.character_model.modifier_formula);
        const conMod  = modifierFor((character.ability_scores && character.ability_scores.con) || 10, formula);
        const hd      = hitDieSize(character, rules);
        const maxRule = (rules && rules.resources && rules.resources.hit_points &&
                         rules.resources.hit_points.max_formula) || 'class_hd_plus_con';
        if (maxRule === 'average_class_hd_plus_con') {
            const avg = Math.floor(hd / 2) + 1;
            return hd + (level - 1) * avg + level * conMod;
        }
        return level * hd + level * conMod;
    }

    function hasClassFeature(character, id) {
        const feats = (character && character.class_features) || [];
        return feats.some(f => f && f.id === id);
    }

    /**
     * Fold the set of equipped items through a reducer. `cb(item, equipSlot)`
     * is called for each resolved equipment entry. Missing items are skipped.
     */
    function forEachEquipped(character, itemsById, cb) {
        const eq = (character && character.equipment) || [];
        for (const entry of eq) {
            const item = itemsById && itemsById[entry.item_id];
            if (!item) continue;
            cb(item, entry.slot, entry);
        }
    }

    /**
     * Derived AC:
     *   10 + DEX mod
     *     + armor.ac_bonus from every equipped armor/shield
     *     + magic.ac_bonus from every equipped magic item
     *     + 1 when class_features include fighting_style_defense AND a body-slot armor is equipped.
     */
    function acFor(character, rules, itemsById) {
        const formula = rules && rules.character_model && rules.character_model.modifier_formula;
        const dexMod  = modifierFor((character.ability_scores && character.ability_scores.dex) || 10, formula);
        let ac = 10 + dexMod;
        let hasBodyArmor = false;
        forEachEquipped(character, itemsById, (item, slot) => {
            if (item.armor && typeof item.armor.ac_bonus === 'number') ac += item.armor.ac_bonus;
            if (item.magic && typeof item.magic.ac_bonus === 'number') ac += item.magic.ac_bonus;
            if (slot === 'body' && item.armor) hasBodyArmor = true;
        });
        if (hasBodyArmor && hasClassFeature(character, 'fighting_style_defense')) ac += 1;
        return ac;
    }

    /** Sum magic bonuses across all equipped items, keyed by bonus type. */
    function sumMagicBonuses(character, itemsById) {
        const out = {
            saveBonus:    {},    // { all?: n, saveId?: n }
            skillBonus:   {},
            abilityBonus: {},
            attackBonus:  0,     // generic, not per-weapon
            damageResist: [],
            damageImmune: [],
            damageVuln:   []
        };
        forEachEquipped(character, itemsById, (item) => {
            const m = item.magic;
            if (!m) return;
            if (m.save_bonus && typeof m.save_bonus === 'object') {
                for (const [k, v] of Object.entries(m.save_bonus)) {
                    out.saveBonus[k] = (out.saveBonus[k] || 0) + Number(v || 0);
                }
            }
            if (m.skill_bonus && typeof m.skill_bonus === 'object') {
                for (const [k, v] of Object.entries(m.skill_bonus)) {
                    out.skillBonus[k] = (out.skillBonus[k] || 0) + Number(v || 0);
                }
            }
            if (m.ability_bonus && typeof m.ability_bonus === 'object') {
                for (const [k, v] of Object.entries(m.ability_bonus)) {
                    out.abilityBonus[k] = (out.abilityBonus[k] || 0) + Number(v || 0);
                }
            }
            if (typeof m.attack_bonus === 'number') out.attackBonus += m.attack_bonus;
            if (Array.isArray(m.damage_resistance))  out.damageResist.push(...m.damage_resistance);
            if (Array.isArray(m.damage_immunity))    out.damageImmune.push(...m.damage_immunity);
            if (Array.isArray(m.damage_vulnerability)) out.damageVuln.push(...m.damage_vulnerability);
        });
        return out;
    }

    /**
     * Build the abilities row list. Each row: { id, abbr, name, score, modifier }.
     * `score` includes any magic.ability_bonus for that ability.
     */
    function deriveAbilities(character, rules, magicBonuses) {
        const declared = (rules && rules.character_model && rules.character_model.abilities) || [];
        const formula  = rules && rules.character_model && rules.character_model.modifier_formula;
        const scores   = character.ability_scores || {};
        const rows = declared.map(a => {
            const base  = scores[a.id] || 0;
            const bonus = (magicBonuses && magicBonuses.abilityBonus && magicBonuses.abilityBonus[a.id]) || 0;
            const total = base + bonus;
            return {
                id:       a.id,
                abbr:     a.abbr || a.id.toUpperCase(),
                name:     a.name || a.id,
                score:    total,
                baseScore: base,
                magicBonus: bonus,
                modifier: modifierFor(total, formula)
            };
        });
        return rows;
    }

    /**
     * Build the saves row list. Two shapes depending on rules.character_model.saves.type.
     *
     *   per_ability:  { id, abbr, name, proficient, total }
     *     total = ability mod + (proficient ? profBonus : 0)
     *           + magic.save_bonus.all
     *           + magic.save_bonus[saveId]
     *
     *   categorical:  { id, name, target }
     *     target = character.saves.values[id] + magic.save_bonus.all + magic.save_bonus[id]
     *     (authoring is numeric; magic riders still stack on top per schema.)
     */
    function deriveSaves(character, rules, abilities, profBonus, magicBonuses) {
        const savesCfg = rules && rules.character_model && rules.character_model.saves;
        if (!savesCfg) return { type: null, rows: [] };
        const magic  = (magicBonuses && magicBonuses.saveBonus) || {};
        const blanket = Number(magic.all) || 0;
        if (savesCfg.type === 'categorical') {
            const cats = savesCfg.categories || [];
            const values = (character.saves && character.saves.values) || {};
            return {
                type: 'categorical',
                rows: cats.map(c => {
                    const base = Number(values[c.id]);
                    const bonus = (Number(magic[c.id]) || 0) + blanket;
                    const target = Number.isFinite(base) ? base + bonus : null;
                    return { id: c.id, name: c.name, target, baseTarget: Number.isFinite(base) ? base : null, bonus };
                })
            };
        }
        // per_ability (default).
        const prof = (character.saves && character.saves.proficient) || [];
        const profSet = new Set(prof);
        const rows = abilities.map(a => {
            const base = a.modifier;
            const p = profSet.has(a.id) ? profBonus : 0;
            const bonus = (Number(magic[a.id]) || 0) + blanket;
            return {
                id:         a.id,
                abbr:       a.abbr,
                name:       a.name,
                proficient: profSet.has(a.id),
                total:      base + p + bonus,
                baseMod:    base,
                profBonus:  p,
                magicBonus: bonus
            };
        });
        return { type: 'per_ability', rows };
    }

    /**
     * Build the skills row list. Empty list if the rules pack declares no
     * skills (Three Knots: `skills: []`).
     */
    function deriveSkills(character, rules, abilities, profBonus, magicBonuses) {
        const declared = (rules && rules.character_model && rules.character_model.skills) || [];
        if (declared.length === 0) return { empty: true, rows: [] };
        const prof = (character.skills && character.skills.proficient) || [];
        const profSet = new Set(prof);
        const byAbility = {};
        abilities.forEach(a => { byAbility[a.id] = a; });
        const magicSkill = (magicBonuses && magicBonuses.skillBonus) || {};
        const rows = declared.map(s => {
            const a = byAbility[s.ability] || { modifier: 0, abbr: (s.ability || '').toUpperCase() };
            const p = profSet.has(s.id) ? profBonus : 0;
            const bonus = Number(magicSkill[s.id]) || 0;
            return {
                id:          s.id,
                name:        s.name || s.id,
                ability:     s.ability,
                abilityAbbr: a.abbr,
                proficient:  profSet.has(s.id),
                total:       a.modifier + p + bonus,
                baseMod:     a.modifier,
                profBonus:   p,
                magicBonus:  bonus
            };
        });
        return { empty: false, rows };
    }

    function deriveFeatureResources(character) {
        const resources = (character && character.feature_resources) || {};
        return Object.entries(resources).map(([id, r]) => ({
            id,
            name:     r.name || id,
            current:  r.current,
            max:      r.max,
            recharge: r.recharge || null
        }));
    }

    /** Resolve equipment entries against the items library; annotate with slot + item. */
    function deriveEquipment(character, itemsById) {
        const entries = (character && character.equipment) || [];
        return entries.map(e => {
            const item = (itemsById && itemsById[e.item_id]) || null;
            return {
                slot:      e.slot,
                item_id:   e.item_id,
                item,
                isWeapon:  !!(item && item.weapon),
                isArmor:   !!(item && item.armor),
                isMagical: !!(item && item.magic)
            };
        });
    }

    /** Resolve pack entries against the items library; attach quantity + consumable flag. */
    function derivePack(character, itemsById) {
        const entries = (character && character.pack) || [];
        return entries.map(p => {
            const item = (itemsById && itemsById[p.item_id]) || null;
            return {
                item_id:      p.item_id,
                item,
                quantity:     p.quantity || 1,
                isConsumable: !!(item && item.consumable)
            };
        });
    }

    /**
     * Top-level derivation. Returns a plain object the character panel
     * renders without further branching.
     */
    function deriveSheet(character, rules, itemsById) {
        if (!character || !rules) return null;
        const magicBonuses = sumMagicBonuses(character, itemsById);
        const abilities = deriveAbilities(character, rules, magicBonuses);
        const profBonus = proficiencyBonusFor(character, rules);
        const saves  = deriveSaves(character, rules, abilities, profBonus, magicBonuses);
        const skills = deriveSkills(character, rules, abilities, profBonus, magicBonuses);
        const featureResources = deriveFeatureResources(character);
        const equipment = deriveEquipment(character, itemsById);
        const pack = derivePack(character, itemsById);
        return {
            character,                      // raw, for pass-through reads (name, class, xp, gold, conditions)
            rules,
            abilities,
            abilityMods: Object.fromEntries(abilities.map(a => [a.id, a.modifier])),
            proficiencyBonus: profBonus,
            hpMax:   hpMaxFor(character, rules),
            hpCurrent: typeof character.hp_current === 'number' ? character.hp_current : hpMaxFor(character, rules),
            ac:      acFor(character, rules, itemsById),
            saves,
            skills,
            classFeatures: (character.class_features || []).slice(),
            featureResources,
            equipment,
            pack,
            magicBonuses,
            encumbrance: (rules && rules.encumbrance) || null,
            damageTypesDeclared: !!(rules && rules.resources && Array.isArray(rules.resources.damage_types) && rules.resources.damage_types.length)
        };
    }

    global.RulesEngine = {
        rollDie,
        parseFormula,
        rollFormula,
        rollD20,
        resolveAttack,
        resolveMonsterAttack,
        resolveCheck,
        applyDamage,
        applyHealing,
        dcFor,
        // Stage 2 derivation:
        modifierFor,
        proficiencyBonusFor,
        hpMaxFor,
        acFor,
        sumMagicBonuses,
        deriveSheet
    };
})(typeof window !== 'undefined' ? window : globalThis);
