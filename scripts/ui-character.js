/* AI Dungeon Crawler — UI.character
 *
 * Left-panel character sheet + death overlay. Owns DOM mutation for the
 * sheet: abilities, saves, skills, equipment, pack, class features /
 * feature resources, HP/AC/XP, conditions.
 *
 * Stage 2 rewrite: abilities, saves, skills, class features, and feature
 * resources render directly from the v1 raw character via
 * RulesEngine.deriveSheet. That lets the panel adapt to either rules pack
 * shape — per_ability vs. categorical saves, table_5e vs. table_bx
 * modifiers, full vs. empty skill list, optional proficiency bonus, magic
 * bonuses stacked on equipped items.
 *
 * HP / AC / XP / gold / conditions / equipment / pack still render from
 * the runtime pre-v1 shape (gs().character) because the rest of the app
 * (prompt-builder, ui-dice, response-parser, game-state mutators) keeps
 * reading and writing through that shape. Stage 3+ migrate those modules;
 * when all consumers are rewritten, the runtime shape retires and this
 * file renders purely from derived data.
 *
 * Reads window.gameState, window.gameData, window.CONDITION_ICONS,
 * window.CONDITION_ICON_DEFAULT. Calls still-inline helpers via globals:
 * getXPLevels, updateMonsterPanel, normalizeNarrativeFormatting,
 * addSystemMessage, addResumeContext, hasValidSave, loadGame,
 * initializeGameStateFromData, finishGameStart.
 *
 * Attaches to window.UI.character.
 */
(function (global) {
    'use strict';

    const doc = () => global.document;
    const gs  = () => global.gameState;
    const gd  = () => global.gameData;

    /**
     * Raw v1 character + rules + items are stored by pack-loader under
     * gameData._v1. When the shim goes away (stage 7) gameData.character /
     * .rules / .items become v1 directly and this helper simplifies.
     */
    function v1() { return gd() && gd()._v1; }

    function itemsIndex() {
        const v = v1();
        if (!v) return {};
        const shared = (v.items && v.items.items) || {};
        const modItems = (v.module && v.module.module_items && v.module.module_items.items) || {};
        // Module items override shared (schema convention: module scope first, library second).
        return Object.assign({}, shared, modItems);
    }

    function currentSheet() {
        const v = v1();
        if (!v || !v.character || !v.rules) return null;
        return global.RulesEngine.deriveSheet(v.character, v.rules, itemsIndex());
    }

    /** Return condition info from rules (object { name, effect_summary, effect_detail, type } or legacy string). */
    function getConditionInfo(id) {
        const c = gd().rules && gd().rules.combat && gd().rules.combat.conditions && gd().rules.combat.conditions[id];
        if (!c) return { name: id, effect_summary: '', effect_detail: '', type: 'debuff' };
        if (typeof c === 'string') {
            return {
                name:            id.charAt(0).toUpperCase() + id.slice(1),
                effect_summary:  c,
                effect_detail:   c,
                type:            'debuff'
            };
        }
        return {
            name:            c.name || id,
            effect_summary:  c.effect_summary || c.effect || c.description || '',
            effect_detail:   c.effect_detail   || c.effect || c.description || c.effect_summary || '',
            type:            c.type || 'debuff'
        };
    }

    /** Condition ids defined in the ruleset. */
    function getConditionIdsFromRules() {
        const cond = gd().rules && gd().rules.combat && gd().rules.combat.conditions;
        return cond && typeof cond === 'object' ? Object.keys(cond) : [];
    }

    // --- Derived sections ------------------------------------------------

    function renderAbilities(sheet) {
        const el = doc().getElementById('abilityScores');
        if (!el) return;
        const html = sheet.abilities.map(a => {
            const modStr = (a.modifier >= 0 ? '+' : '') + a.modifier;
            return `
                <div class="ability-score" title="${a.name}">
                    <div class="ability-name">${a.abbr}</div>
                    <div class="ability-value">${a.score}</div>
                    <div class="ability-modifier">${modStr}</div>
                </div>
            `;
        }).join('');
        el.innerHTML = html;
    }

    function renderSaves(sheet) {
        const listEl   = doc().getElementById('savesList');
        const headerEl = doc().getElementById('savesHeader');
        if (!listEl) return;

        const saves = sheet.saves;
        if (!saves || !saves.type || !saves.rows.length) {
            if (headerEl) headerEl.classList.add('panel-hidden');
            listEl.classList.add('panel-hidden');
            listEl.innerHTML = '';
            return;
        }
        if (headerEl) headerEl.classList.remove('panel-hidden');
        listEl.classList.remove('panel-hidden');

        let html = '';
        if (saves.type === 'per_ability') {
            html = saves.rows.map(r => {
                const total = r.total;
                const totalStr = (total >= 0 ? '+' : '') + total;
                const dot = r.proficient
                    ? '<span class="prof-dot" title="Proficient"></span>'
                    : '<span class="prof-dot hollow" title="Not proficient"></span>';
                return `
                    <div class="save-item" title="${r.name} save">
                        <span class="save-name">${dot}${r.abbr}</span>
                        <span class="save-modifier">${totalStr}</span>
                    </div>
                `;
            }).join('');
        } else { // categorical
            html = saves.rows.map(r => {
                const target = r.target != null ? r.target : '—';
                return `
                    <div class="save-item" title="${r.name}">
                        <span class="save-name">${r.name}</span>
                        <span class="save-modifier">${target}</span>
                    </div>
                `;
            }).join('');
        }
        listEl.innerHTML = html;
    }

    function renderSkills(sheet) {
        const listEl   = doc().getElementById('skillsList');
        const headerEl = doc().getElementById('skillsHeader');
        if (!listEl) return;

        if (!sheet.skills || sheet.skills.empty || sheet.skills.rows.length === 0) {
            if (headerEl) headerEl.classList.add('panel-hidden');
            listEl.classList.add('panel-hidden');
            listEl.innerHTML = '';
            return;
        }
        if (headerEl) headerEl.classList.remove('panel-hidden');
        listEl.classList.remove('panel-hidden');

        const html = sheet.skills.rows.map(r => {
            const totalStr = (r.total >= 0 ? '+' : '') + r.total;
            const dot = r.proficient
                ? '<span class="prof-dot" title="Proficient"></span>'
                : '<span class="prof-dot hollow" title="Not proficient"></span>';
            const tip = `${r.name} (${(r.abilityAbbr || '').toUpperCase()})`;
            return `
                <div class="skill-item" title="${tip}">
                    <span class="skill-name">${dot}${r.name}</span>
                    <span class="skill-modifier">${totalStr}</span>
                </div>
            `;
        }).join('');
        listEl.innerHTML = html;
    }

    function renderClassFeaturesAndResources(sheet) {
        const section       = doc().getElementById('classFeaturesSection');
        const featsHeader   = doc().getElementById('classFeaturesHeader');
        const featsList     = doc().getElementById('classFeaturesList');
        const resHeader     = doc().getElementById('featureResourcesHeader');
        const resList       = doc().getElementById('featureResourcesList');
        if (!section) return;

        const feats = sheet.classFeatures || [];
        const resources = sheet.featureResources || [];
        const hasFeats = feats.length > 0;
        const hasRes   = resources.length > 0;

        if (!hasFeats && !hasRes) {
            section.classList.add('panel-hidden');
            return;
        }
        section.classList.remove('panel-hidden');

        if (hasFeats) {
            if (featsHeader) featsHeader.classList.remove('panel-hidden');
            featsList.classList.remove('panel-hidden');
            featsList.innerHTML = feats.map(f => {
                const desc = (f.description || '').replace(/\s+/g, ' ');
                return `
                    <div class="class-feature-item" title="${(f.description || '').replace(/"/g, '&quot;')}">
                        <div class="class-feature-name">${f.name || f.id}</div>
                        <div class="class-feature-desc">${desc}</div>
                    </div>
                `;
            }).join('');
        } else {
            if (featsHeader) featsHeader.classList.add('panel-hidden');
            featsList.classList.add('panel-hidden');
            featsList.innerHTML = '';
        }

        if (hasRes) {
            if (resHeader) resHeader.classList.remove('panel-hidden');
            resList.classList.remove('panel-hidden');
            resList.innerHTML = resources.map(r => {
                const recharge = r.recharge ? r.recharge.replace(/_/g, ' ') : '';
                return `
                    <div class="feature-resource-item" title="${(r.name || r.id)} — recharges on ${recharge || '—'}">
                        <span class="feature-resource-name">${r.name || r.id}</span>
                        <span class="feature-resource-count">${r.current}/${r.max}</span>
                        ${recharge ? `<span class="feature-resource-recharge">${recharge}</span>` : ''}
                    </div>
                `;
            }).join('');
        } else {
            if (resHeader) resHeader.classList.add('panel-hidden');
            resList.classList.add('panel-hidden');
            resList.innerHTML = '';
        }
    }

    // --- Runtime sections (HP/AC/XP/conditions/equipment/pack) -----------

    function renderHeaderAndStats() {
        const char = gs().character;
        if (!char) return;
        const ac = getEffectiveAC();
        doc().getElementById('hpDisplay').textContent = `${char.hp}/${char.maxHp}`;
        doc().getElementById('acDisplay').textContent = ac;
        const classEl = doc().getElementById('charClass');
        if (classEl) classEl.textContent = `${char.class} - Lvl ${char.level}`;

        const xpLevels = global.getXPLevels ? global.getXPLevels() : {};
        const currentLevel = char.level;
        const nextLevel = currentLevel + 1;
        const currentLevelXP = xpLevels[currentLevel] != null ? xpLevels[currentLevel] : 0;
        const nextLevelXP = xpLevels[nextLevel] != null
            ? xpLevels[nextLevel]
            : (xpLevels[10] != null ? xpLevels[10] * 2 : 999999);

        const xpProgress = char.xp - currentLevelXP;
        const xpNeeded   = nextLevelXP - currentLevelXP;
        const progressPercent = xpNeeded > 0
            ? Math.max(0, Math.min(100, (xpProgress / xpNeeded) * 100))
            : 100;

        doc().getElementById('xpProgressText').textContent =
            `${char.xp.toLocaleString()} / ${nextLevelXP.toLocaleString()}`;
        doc().getElementById('xpBarFill').style.width = `${progressPercent}%`;

        const headerEl = doc().getElementById('characterHeader');
        if (headerEl) headerEl.classList.toggle('in-combat', gs().inCombat);
        const modeEl = doc().getElementById('modeIndicator');
        if (modeEl) {
            const mode = gs().mode || 'exploration';
            modeEl.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
            modeEl.className = 'mode-indicator mode-' + mode;
        }

        const debugRoomEl = doc().getElementById('debugRoomIndicator');
        if (debugRoomEl) {
            const cfg = global.CONFIG || {};
            if (cfg.DEBUG_MODE) {
                debugRoomEl.textContent = `room: ${gs().currentRoom || '—'}`;
                debugRoomEl.classList.add('visible');
            } else {
                debugRoomEl.classList.remove('visible');
            }
        }
    }

    function renderConditions() {
        const char = gs().character;
        if (!char) return;
        const icons = global.CONDITION_ICONS || {};
        const iconDefault = global.CONDITION_ICON_DEFAULT || '';
        const conditionsHTML = (!char.conditions || char.conditions.length === 0)
            ? ''
            : char.conditions.map(condition => {
                const id = (condition.id || condition.name || condition).toString().toLowerCase();
                const info = getConditionInfo(id);
                const iconClass = icons[id] || iconDefault;
                const tooltip = [info.name, info.effect_summary].filter(Boolean).join(': ');
                const title = tooltip ? ` title="${tooltip.replace(/"/g, '&quot;')}"` : '';
                const typeClass = info.type === 'buff' ? ' buff' : '';
                return `<span class="condition-icon${typeClass}"${title}><i class="${iconClass}"></i></span>`;
            }).join('');
        const conditionsEl = doc().getElementById('conditionsDisplay');
        conditionsEl.innerHTML = conditionsHTML;
        if (conditionsHTML && global.FontAwesome && global.FontAwesome.dom && typeof global.FontAwesome.dom.i2svg === 'function') {
            global.FontAwesome.dom.i2svg({ node: conditionsEl });
        }
    }

    function renderEquipment() {
        const char = gs().character;
        if (!char) return;
        // Equipped strip: armor, weapons, items-in-use (torch etc.)
        const equippedItems = [...(char.equipment || []), ...(gs().equippedInUse || [])];
        const equippedHTML = equippedItems.map(item => {
            let typeClass = '';
            let icon = '';
            if (item.isArmor) {
                typeClass = 'armor';
                icon = '<i class="fa-sharp-duotone fa-solid fa-shield-halved"></i>';
            } else if (item.isWeapon && item.weaponType === 'ranged') {
                typeClass = 'ranged';
                icon = '<i class="fa-sharp-duotone fa-solid fa-bow-arrow"></i>';
            } else if (item.isWeapon && (item.weaponType === 'melee' || !item.weaponType)) {
                typeClass = 'melee';
                icon = '<i class="fa-sharp-duotone fa-solid fa-sword"></i>';
            }
            return `
            <div class="equipment-item${typeClass ? ' ' + typeClass : ''}">
                ${icon}
                <div class="equipment-name">${item.name}</div>
                <div class="equipment-stats">${item.stats || ''}</div>
            </div>
        `;
        }).join('');
        const equippedEl = doc().getElementById('equippedList');
        equippedEl.innerHTML = equippedHTML;
        if (global.FontAwesome && global.FontAwesome.dom && typeof global.FontAwesome.dom.i2svg === 'function') {
            global.FontAwesome.dom.i2svg({ node: equippedEl });
        }
    }

    function renderPack() {
        const char = gs().character;
        if (!char) return;
        const sortedInventory = [...(char.inventory || [])].sort((a, b) =>
            (a.name === 'Gold' ? -1 : 0) - (b.name === 'Gold' ? -1 : 0));
        const packHTML = sortedInventory.map(item => {
            const qty = item.quantity;
            const qtyStr = item.name === 'Gold' ? ` ${qty}` : `x${qty}`;
            const goldClass = item.name === 'Gold' ? ' gold' : '';
            const goldIcon  = item.name === 'Gold' ? '<i class="fa-sharp-duotone fa-solid fa-sack"></i>' : '';
            return `
            <div class="inventory-item${goldClass}">
                <span class="item-name">${goldIcon} ${item.name}</span>
                <span class="item-quantity">${qtyStr}</span>
            </div>
        `}).join('');
        const packEl = doc().getElementById('packList');
        packEl.innerHTML = packHTML;
        if (global.FontAwesome && global.FontAwesome.dom && typeof global.FontAwesome.dom.i2svg === 'function') {
            global.FontAwesome.dom.i2svg({ node: packEl });
        }
    }

    /** AC from armor if worn, otherwise 10 + DEX (unarmored). Uses the v1-derived AC when the sheet is available. */
    function getEffectiveAC() {
        const char = gs().character;
        if (!char) return 10;
        if (!gs().armorEquipped) {
            const dexMod = char.abilities && char.abilities.dex ? char.abilities.dex.modifier : 0;
            return 10 + dexMod;
        }
        const sheet = currentSheet();
        if (sheet && typeof sheet.ac === 'number') return sheet.ac;
        // Fallback: runtime-found armor, else static char.ac.
        if (char.abilities) {
            const fromState = char.equipment && char.equipment.find(e => e.isArmor && e.equipped);
            if (fromState && fromState.ac != null) return fromState.ac;
        }
        return char.ac != null ? char.ac : 10;
    }

    // --- Public entry points --------------------------------------------

    function initializeCharacterSheet() {
        const char = gs().character;
        doc().getElementById('charName').textContent = char.name;
        doc().getElementById('charClass').textContent = `${char.class} - Lvl ${char.level}`;

        const sheet = currentSheet();
        if (sheet) {
            renderAbilities(sheet);
            renderSaves(sheet);
            renderSkills(sheet);
            renderClassFeaturesAndResources(sheet);
        }
        updateCharacterDisplay();
    }

    /**
     * Re-render sections that depend on runtime state (HP/AC/XP/conditions
     * /equipment/pack). Derived sections (abilities/saves/skills/features)
     * are static per pack-load — they're set by initializeCharacterSheet
     * and don't re-run here. That keeps this hot path cheap.
     */
    function updateCharacterDisplay() {
        renderHeaderAndStats();
        renderConditions();
        renderEquipment();
        renderPack();
        if (global.updateMonsterPanel) global.updateMonsterPanel();
    }

    /** @param {string} [finalNarration] - GM's final narration (death blow); shown on overlay, not in narrative panel. */
    function showDeathOverlay(finalNarration) {
        const el = doc().getElementById('deathOverlay');
        if (!el) return;
        el.style.display = 'flex';
        const narrationEl = doc().getElementById('deathOverlayNarration');
        if (narrationEl) {
            if (finalNarration && finalNarration.trim()) {
                const cleaned = finalNarration
                    .replace(/\[ROLL_REQUEST:[^\]]*\]/gi, '')
                    .replace(/\[(?:COMBAT|DAMAGE_TO_PLAYER|HEAL_PLAYER|DAMAGE_TO_MONSTER|MONSTER_DEFEATED|MONSTER_FLED):[^\]]*\]/gi, '')
                    .trim();
                narrationEl.innerHTML = cleaned && global.normalizeNarrativeFormatting
                    ? global.normalizeNarrativeFormatting(cleaned)
                    : (cleaned || '');
                narrationEl.style.display = cleaned ? 'block' : 'none';
            } else {
                narrationEl.innerHTML = '';
                narrationEl.style.display = 'none';
            }
        }
        const loadBtn = doc().getElementById('deathBtnLoadSave');
        if (loadBtn) {
            loadBtn.style.display = (global.hasValidSave && global.hasValidSave()) ? '' : 'none';
            loadBtn.onclick = () => {
                if (global.loadGame && global.loadGame()) {
                    hideDeathOverlay();
                    initializeCharacterSheet();
                    updateCharacterDisplay();
                    if (global.updateMonsterPanel) global.updateMonsterPanel();
                    if (global.addSystemMessage) global.addSystemMessage('Game loaded.');
                    if (global.addResumeContext) global.addResumeContext();
                    doc().getElementById('playerInput').disabled = false;
                    doc().getElementById('playerInput').focus();
                }
            };
        }
        const restartBtn = doc().getElementById('deathBtnRestart');
        if (restartBtn) {
            restartBtn.onclick = () => {
                hideDeathOverlay();
                const scroll = doc().getElementById('narrativeScroll');
                if (scroll) scroll.innerHTML = '';
                if (global.initializeGameStateFromData) global.initializeGameStateFromData();
                if (global.finishGameStart) global.finishGameStart(true);
            };
        }
    }

    function hideDeathOverlay() {
        gs().isDead = false;
        const el = doc().getElementById('deathOverlay');
        if (el) el.style.display = 'none';
    }

    global.UI = global.UI || {};
    global.UI.character = {
        getConditionInfo,
        getConditionIdsFromRules,
        initializeCharacterSheet,
        getEffectiveAC,
        updateCharacterDisplay,
        showDeathOverlay,
        hideDeathOverlay,
        currentSheet
    };

    // Legacy globals for still-inline callers.
    global.getConditionInfo          = getConditionInfo;
    global.getConditionIdsFromRules  = getConditionIdsFromRules;
    global.initializeCharacterSheet  = initializeCharacterSheet;
    global.getEffectiveAC            = getEffectiveAC;
    global.updateCharacterDisplay    = updateCharacterDisplay;
    global.showDeathOverlay          = showDeathOverlay;
    global.hideDeathOverlay          = hideDeathOverlay;
})(typeof window !== 'undefined' ? window : globalThis);
