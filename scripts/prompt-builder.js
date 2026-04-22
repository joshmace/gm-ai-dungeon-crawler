/* AI Dungeon Crawler — PromptBuilder
 *
 * Composes the system prompt sent to the GM. The prompt template lives in
 * ai-gm-system-prompt.md and is loaded at startup into window.SYSTEM_PROMPT_TEMPLATE;
 * PromptBuilder fills in the {{PLACEHOLDER}} tokens from current game state.
 *
 * Four builders, wired through buildSystemPrompt():
 *   - buildRulesetBlockForPrompt: rules JSON -> compact ruleset reminder
 *   - buildSettingBlockForPrompt: setting JSON -> compact setting reminder
 *   - buildModuleLayoutForPrompt: rooms + connections + features + encounters
 *   - buildSystemPrompt: glues everything into the final prompt string
 *
 * Reads window.gameState and window.gameData. Calls still-inline helpers
 * (buildEncounterDescription, getWeaponTypeInfo, getConditionInfo,
 * getEffectiveAC, getFirstActiveEncounterInCurrentRoom, debugLog) via the
 * global lookup — each is a top-level function declaration in the inline
 * monolith and therefore on window. Those dependencies move out during
 * 1e-iv (ui-encounters), 1e-v (ui-character), 1e-vi (ui-dice).
 *
 * Attaches to window.PromptBuilder.
 */
(function (global) {
    'use strict';

    // --- RULESET block ------------------------------------------------------

    /**
     * Pull the v1 rules object if available. The shim preserves the same
     * reference under gameData.rules as it does under gameData._v1.rules
     * for the extra legacy paths, but during Stage 3 the v1 fields we
     * read here (combat, resolution, difficulty, conditions[]) match
     * the v1 shape directly on gameData.rules.
     */
    function v1Rules() {
        const gd = global.gameData || {};
        return (gd._v1 && gd._v1.rules) || gd.rules || null;
    }

    function buildRulesetBlockForPrompt() {
        const r = v1Rules();
        if (!r) return '';
        const lines = [];

        // Header + design philosophy.
        const systemLabel = r.name || r.id || 'OSR';
        lines.push(`System: ${systemLabel}. Honor these mechanics; do not substitute your own numbers or rules.`);
        if (r.design_philosophy) lines.push(`Design philosophy: ${r.design_philosophy}`);

        // Checks — direction (roll-high vs roll-under) and adv/disadv flag.
        const checks = r.resolution && r.resolution.checks;
        if (checks) {
            const dice = checks.dice || '1d20';
            if (checks.method === 'roll_under_score') {
                lines.push(`Checks: roll ${dice}; succeed on a roll ≤ the target (ability score or save target). Natural 1 = critical success, natural 20 = critical failure.`);
            } else {
                lines.push(`Checks: roll ${dice} + modifier; succeed on a total ≥ the DC. Natural 20 = critical success, natural 1 = critical failure.`);
            }
            if (checks.advantage_disadvantage) {
                lines.push(`Advantage / disadvantage: when the GM calls for it, use [ROLL_REQUEST: <ability|skill>, advantage] or [ROLL_REQUEST: <ability|skill>, disadvantage]. The app rolls 2d20 and keeps the high (advantage) or low (disadvantage).`);
            } else {
                lines.push(`Advantage / disadvantage: NOT supported in this ruleset — never append ", advantage" or ", disadvantage" to a [ROLL_REQUEST].`);
            }
        }

        // Difficulty ladder — roll-high emits DC numbers; roll-under emits target modifiers.
        const scale = r.difficulty && Array.isArray(r.difficulty.scale) ? r.difficulty.scale : [];
        if (scale.length) {
            const isUnder = checks && checks.method === 'roll_under_score';
            if (isUnder) {
                const parts = scale.map(t => {
                    const m = Number(t.modifier) || 0;
                    const sign = m >= 0 ? '+' : '';
                    return `${t.name || t.id} (${sign}${m} to target)`;
                });
                lines.push(`Difficulty tiers (target adjustments): ${parts.join(', ')}.`);
            } else {
                const parts = scale.map(t => `${t.name || t.id} DC ${t.dc != null ? t.dc : '?'}`);
                lines.push(`Difficulty tiers (use these DCs exactly): ${parts.join(', ')}.`);
            }
        }
        if (r.difficulty && r.difficulty.auto_success) lines.push(`Auto-success: ${r.difficulty.auto_success}`);
        if (r.difficulty && r.difficulty.auto_failure) lines.push(`Auto-failure: ${r.difficulty.auto_failure}`);

        // Combat — attack direction, damage formula, crit, initiative.
        if (r.combat) {
            const attackRes = r.combat.attack && r.combat.attack.resolution;
            const hasProf = Array.isArray(r.progression && r.progression.level_table)
                && r.progression.level_table.some(row => typeof row.proficiency_bonus === 'number');
            const profPart = hasProf ? ' + proficiency' : '';
            if (attackRes === 'roll_high_vs_ac' || !attackRes) {
                lines.push(`Attack: d20 + ability modifier${profPart} vs target AC (hit if total ≥ AC). Melee uses ${(r.combat.damage && r.combat.damage.melee_ability || 'str').toUpperCase()}; ranged uses ${(r.combat.damage && r.combat.damage.ranged_ability || 'dex').toUpperCase()}. The app resolves attacks end-to-end; never narrate numbers.`);
            }
            if (r.combat.damage) {
                lines.push(`Damage: ${r.combat.damage.formula || 'weapon_die_plus_ability_mod'}.`);
            }
            const crit = r.combat.critical_hit;
            if (crit) {
                const trig = crit.trigger === 'nat_19_or_20' ? 'natural 19 or 20' : 'natural 20';
                const eff  = crit.effect === 'max_damage' ? 'maximized damage dice'
                           : crit.effect === 'extra_die'  ? 'one extra damage die'
                           : 'doubled damage dice';
                lines.push(`Critical hit: ${trig} → ${eff}. The app applies this; never narrate the math.`);
            }
            if (r.combat.initiative && r.combat.initiative.type) {
                const init = r.combat.initiative.type;
                const label = init === 'player_first' ? 'the player acts first unless ambushed'
                            : init === 'side_based'   ? 'side-based (player side goes first unless ambushed)'
                            : init;
                lines.push(`Initiative: ${label}.`);
            }
        }

        // HP at zero — drives the death overlay vs unconscious state.
        const atZero = r.resources && r.resources.hit_points && r.resources.hit_points.at_zero;
        if (atZero) lines.push(`At 0 HP: ${atZero}.`);

        // Conditions — list id + short effect so the GM can apply them via [CONDITION: add id].
        const conds = Array.isArray(r.conditions) ? r.conditions : [];
        if (conds.length) {
            const condList = conds.map(c => {
                const summary = c.effect_summary || c.effect || c.description || c.name || c.id;
                return `${c.id}: ${summary}`;
            }).join('; ');
            lines.push(`Conditions (apply exactly as specified; use [CONDITION: add id] / [CONDITION: remove id] so the app can track): ${condList}`);
        }

        return lines.join('\n');
    }

    // --- SETTING block ------------------------------------------------------

    function buildSettingBlockForPrompt() {
        const s = global.gameData && global.gameData.setting;
        if (!s || typeof s !== 'object') return '';
        const lines = [];
        if (s.name) lines.push(`Name: ${s.name}.`);
        if (s.tone) lines.push(`Tone: ${s.tone}.`);
        if (s.world_overview && typeof s.world_overview === 'object') {
            if (s.world_overview.description)  lines.push(`World: ${s.world_overview.description}`);
            if (s.world_overview.current_era)  lines.push(`Era: ${s.world_overview.current_era}.`);
            if (s.world_overview.tone)         lines.push(`Setting tone: ${s.world_overview.tone}.`);
        }
        if (s.major_regions && typeof s.major_regions === 'object') {
            const regionNames = Object.keys(s.major_regions).map(k => k.replace(/_/g, ' '));
            lines.push(`Major regions (use for flavor and travel): ${regionNames.join(', ')}.`);
        }
        if (lines.length === 0) return '';
        return '\n## SETTING (use for flavor and consistency)\n' + lines.join('\n');
    }

    // --- LAYOUT block -------------------------------------------------------

    function buildModuleLayoutForPrompt() {
        const gd = global.gameData;
        if (!gd || !gd.module) return '';
        const rooms = gd.module.rooms || {};
        let out = '';
        for (const [roomId, room] of Object.entries(rooms)) {
            out += `\n--- ROOM: ${room.name} (id: ${roomId}) ---\n`;
            out += `Description: ${room.description}\n`;
            if (room.connections && Object.keys(room.connections).length > 0) {
                const exits = Object.entries(room.connections).map(([dir, targetOrObj]) => {
                    const targetId = typeof targetOrObj === 'string' ? targetOrObj : (targetOrObj && targetOrObj.to);
                    const target = targetId ? rooms[targetId] : null;
                    const targetName = target ? target.name : (targetId || '?');
                    return `${dir} → ${targetName} (${targetId || '?'})`;
                }).join(', ');
                out += `Exits (use ONLY these): ${exits}\n`;
            } else {
                out += `Exits: none\n`;
            }
            if (room.features && room.features.length > 0) {
                out += 'Features (use ONLY these; do not add others):\n';
                for (const f of room.features) {
                    out += `- ${f.name}: ${f.description || ''}`;
                    if (f.text)        out += ` | When read/used: "${f.text}"`;
                    if (f.note)        out += ` | Note: "${f.note}"`;
                    if (f.success)     out += ` | On success: "${f.success}"`;
                    if (f.failure)     out += ` | On failure: "${f.failure}"`;
                    if (f.contains)    out += ` | Contains: ${JSON.stringify(f.contains)}`;
                    if (f.interaction) out += ` | Interaction: ${f.interaction}`;
                    if (f.dc != null)  out += ` | DC: ${f.dc} (use this exact value from ruleset scale)`;
                    out += '\n';
                }
            }
            if (room.encounters && room.encounters.length > 0) {
                out += 'Encounters here (ONLY these monsters exist in this room): ';
                out += room.encounters.map(e => e.name + ' (' + e.monster_ref + ')').join(', ') + '\n';
            }
        }
        return out;
    }

    // --- Top-level builder --------------------------------------------------

    function buildSystemPrompt() {
        const gs = global.gameState;
        const gd = global.gameData;
        const debugLog = global.debugLog || (() => {});
        const char = gs.character;
        const room = gd.module.rooms[gs.currentRoom];

        // Keep mode in sync with inCombat when not explicitly in travel.
        if (gs.inCombat) gs.mode = 'combat';
        else if (gs.mode !== 'travel') gs.mode = 'exploration';

        if (!char || !char.abilities) {
            console.error('Character not initialized properly!', gs.character);
            throw new Error('Character data missing');
        }

        debugLog('PROMPT', 'Building system prompt', {
            character: char.name,
            room: room.name,
            abilities: Object.keys(char.abilities)
        });

        let encounterInfo;
        if (room.encounters && room.encounters.length > 0) {
            encounterInfo = '\n\n## Active Encounters — use these EXACT stats; current HP is tracked by the app (monster is DEFEATED at 0 HP; you MUST narrate death and must NOT have it act further):\n';
            for (const enc of room.encounters) {
                encounterInfo += global.buildEncounterDescription(enc, true) + '\n';
            }
        } else {
            encounterInfo = '\n\n## Active Encounters: NONE — there are no monsters in this room. Do not add or invent any monsters.\n';
        }

        const hasActiveEncounter = global.getFirstActiveEncounterInCurrentRoom() != null;
        const lastRoll = gs.lastUserRollType;
        let combatFlowBlock = '';
        if (hasActiveEncounter) {
            let currentStep;
            if (lastRoll === 'resolved') {
                currentStep = 'The player\'s attack was **fully resolved by the app**. The player message states the outcome (HIT + damage, or MISS). **Do NOT request any dice roll.** Narrate the outcome in flavor only, obeying the HIT/MISS stated. If the monster is defeated, narrate its death. If any enemy remains, begin the monster\'s turn in the same response with one sentence of flavor followed by **[MONSTER_ATTACK]**. If all enemies are defeated, include [COMBAT: off].';
            } else if (lastRoll === 'ability') {
                currentStep = 'The player just submitted an **ability/skill roll**. Respond to the check in flavor, based on the total vs the relevant DC. Then continue the scene — if an enemy still acts, begin the monster\'s turn with flavor + **[MONSTER_ATTACK]**.';
            } else {
                currentStep = 'The player sent a **free-form action** (no roll). If they are attacking, respond with flavor and **[ROLL_REQUEST: Attack]** — nothing else. If they did something else (dodge, search, speak, etc.), respond to that. Do not take the monster\'s turn unless the player\'s action clearly ends their turn (e.g. "I wait").';
            }
            combatFlowBlock = `\n\n## COMBAT FLOW — CURRENT STEP\n${currentStep}\n`;
        }

        const layoutBlock  = buildModuleLayoutForPrompt();
        const rulesetBlock = buildRulesetBlockForPrompt();
        const settingBlock = buildSettingBlockForPrompt();
        const mode = gs.mode || 'exploration';

        let modeBlock = '';
        if (mode === 'exploration') {
            modeBlock = `\n## CURRENT MODE: EXPLORATION\nYou have high freedom to improvise within the module and setting. Call for ability/skill checks when appropriate; honor roll results. Use the module layout and features strictly—do not add rooms or exits. Brief respites (short rest, a few hours) may be described in brief. For locations with distinct maps, adhere to the module description closely and improvise only minor details.\n`;
        } else if (mode === 'travel') {
            modeBlock = `\n## CURRENT MODE: TRAVEL\nThe player is traveling a long distance. Ask or infer their plan or destination. Narrate the journey in summary, not moment-by-moment. Respect any travel rules from the setting, rules, or module. When they arrive at the destination, include [MODE: exploration] in your response so the app returns to exploration.\n`;
        }

        const weaponSources = gd.character && gd.character.equipment
            ? [...(gd.character.equipment.wielded || []), ...(gd.character.equipment.carried || [])]
            : [];
        const weaponsStr = weaponSources.filter(w => w.damage).map(w => {
            const info = global.getWeaponTypeInfo(w);
            const typeStr = info.type === 'ranged' && info.range ? `ranged ${info.range}` : 'melee';
            return `${w.name} (${w.damage} ${w.damage_type}, ${typeStr})`;
        }).join('; ') || 'none';

        const conditionsStr = char.conditions && char.conditions.length
            ? char.conditions.map(c => {
                const info = global.getConditionInfo(c.id || c.name || c);
                return `${info.name} (${info.effect_summary})`;
            }).join('; ')
            : 'none';

        // v1 difficulty ladder + auto-success / auto-failure prose. Fall back to
        // the pre-v1 core_mechanics path for the shim, then to standard OSR.
        const rules = (gd._v1 && gd._v1.rules) || gd.rules;
        const isUnderRules = rules && rules.resolution && rules.resolution.checks && rules.resolution.checks.method === 'roll_under_score';
        let dcsStr;
        if (rules && rules.difficulty && Array.isArray(rules.difficulty.scale) && rules.difficulty.scale.length) {
            dcsStr = rules.difficulty.scale.map(t => isUnderRules
                ? `${t.name || t.id} ${Number(t.modifier) >= 0 ? '+' : ''}${Number(t.modifier) || 0} to target`
                : `${t.name || t.id} ${t.dc != null ? t.dc : '?'}`
            ).join(', ');
        } else {
            const abilityChecksLegacy = gd.rules && gd.rules.core_mechanics && gd.rules.core_mechanics.ability_checks;
            const legacyScale = abilityChecksLegacy && abilityChecksLegacy.dc_scale;
            dcsStr = (legacyScale && typeof legacyScale === 'object')
                ? Object.entries(legacyScale).map(([k, v]) => `${k} ${v}`).join(', ')
                : 'Easy 10, Medium 15, Hard 20';
        }
        const autoSuccess = (rules && rules.difficulty && rules.difficulty.auto_success)
            || (gd.rules && gd.rules.core_mechanics && gd.rules.core_mechanics.ability_checks && gd.rules.core_mechanics.ability_checks.auto_success)
            || 'tasks within normal capability';
        const autoFail = (rules && rules.difficulty && rules.difficulty.auto_failure)
            || (gd.rules && gd.rules.core_mechanics && gd.rules.core_mechanics.ability_checks && gd.rules.core_mechanics.ability_checks.auto_failure)
            || 'impossible or lacking resources';

        const levelUpBlock = gs.pendingLevelUpAck ? `\n## LEVEL-UP — ACKNOWLEDGE IN YOUR RESPONSE\nThe player just reached **level ${gs.pendingLevelUpAck.level}** and gained **${gs.pendingLevelUpAck.hpGain} max HP**. In your response you MUST:\n1. Congratulate the player on leveling up.\n2. Briefly explain what improved: they are now level ${gs.pendingLevelUpAck.level}, and their max HP increased by ${gs.pendingLevelUpAck.hpGain} (from the level-up roll + CON).\nThen continue with the scene as normal. (This reminder is one-time only.)\n` : '';

        const ac = global.getEffectiveAC();
        const values = {
            MODULE_TITLE:      gd.module.module.title,
            MODE_TITLE:        mode.charAt(0).toUpperCase() + mode.slice(1),
            SETTING_BLOCK:     settingBlock,
            MODE_BLOCK:        modeBlock,
            RULESET_BLOCK:     rulesetBlock || 'Use standard OSR-style mechanics. Attack: 1d20+mod+prof vs AC. Damage: weapon die + mod. DCs: Easy 10, Medium 15, Hard 20.',
            LAYOUT_BLOCK:      layoutBlock,
            COMBAT_FLOW_BLOCK: combatFlowBlock,
            LEVEL_UP_BLOCK:    levelUpBlock,
            ROOM_NAME:         room.name,
            ROOM_ID:           gs.currentRoom,
            ROOM_DESCRIPTION:  room.description,
            CHAR_NAME:         char.name,
            CHAR_CLASS:        char.class,
            CHAR_LEVEL:        char.level,
            HP:                char.hp,
            MAX_HP:            char.maxHp,
            AC:                ac,
            AC_NOTE:           !gs.armorEquipped ? '; armor is not worn' : '',
            ABILITY_MODS:      `STR +${char.abilities.str.modifier} | DEX +${char.abilities.dex.modifier} | CON +${char.abilities.con.modifier} | INT +${char.abilities.int.modifier} | WIS +${char.abilities.wis.modifier} | CHA +${char.abilities.cha.modifier}`,
            WEAPONS:           weaponsStr,
            READIED_WEAPON:    gs.readiedWeaponName || 'none',
            SKILLS:            Object.entries(char.skills).map(([k, v]) => `${k} +${v}`).join(', '),
            CONDITIONS:        conditionsStr,
            ENCOUNTER_INFO:    encounterInfo,
            AUTO_SUCCESS:      autoSuccess,
            AUTO_FAIL:         autoFail,
            DCS:               dcsStr
        };

        const template = global.SYSTEM_PROMPT_TEMPLATE;
        if (!template) throw new Error('System prompt template not loaded');
        let out = template;
        for (const [key, val] of Object.entries(values)) {
            out = out.split(`{{${key}}}`).join(val == null ? '' : String(val));
        }
        return out;
    }

    global.PromptBuilder = {
        buildSystemPrompt,
        buildRulesetBlockForPrompt,
        buildSettingBlockForPrompt,
        buildModuleLayoutForPrompt
    };

    // Legacy globals for still-inline callers.
    global.buildSystemPrompt            = buildSystemPrompt;
    global.buildRulesetBlockForPrompt   = buildRulesetBlockForPrompt;
    global.buildSettingBlockForPrompt   = buildSettingBlockForPrompt;
    global.buildModuleLayoutForPrompt   = buildModuleLayoutForPrompt;
})(typeof window !== 'undefined' ? window : globalThis);
