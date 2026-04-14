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
        dcFor
    };
})(typeof window !== 'undefined' ? window : globalThis);
