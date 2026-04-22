/* AI Dungeon Crawler — UI.character
 *
 * Left-panel character sheet + death overlay. Owns all DOM mutation for
 * the sheet: abilities, skills, HP/AC/XP, conditions, equipped items,
 * pack inventory. Also exposes getEffectiveAC (used by prompt builder)
 * and getConditionInfo / getConditionIdsFromRules (used by sheet +
 * response parser).
 *
 * Reads window.gameState, window.gameData, window.CONDITION_ICONS,
 * window.CONDITION_ICON_DEFAULT. Calls still-inline helpers via globals:
 * getXPLevels, updateMonsterPanel (now in UI.encounters),
 * normalizeNarrativeFormatting / addSystemMessage / addResumeContext
 * (UI.narrative), hasValidSave / loadGame / initializeGameStateFromData
 * / finishGameStart (still-inline function declarations, on window).
 *
 * Each function is also exposed as a top-level global so still-inline
 * callers keep working.
 *
 * Attaches to window.UI.character.
 */
(function (global) {
    'use strict';

    const doc = () => global.document;
    const gs  = () => global.gameState;
    const gd  = () => global.gameData;

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
            effect_summary:  c.effect_summary || '',
            effect_detail:   c.effect_detail || c.effect_summary || '',
            type:            c.type || 'debuff'
        };
    }

    /** Condition ids defined in the ruleset. */
    function getConditionIdsFromRules() {
        const cond = gd().rules && gd().rules.combat && gd().rules.combat.conditions;
        return cond && typeof cond === 'object' ? Object.keys(cond) : [];
    }

    function initializeCharacterSheet() {
        const char = gs().character;
        doc().getElementById('charName').textContent = char.name;
        doc().getElementById('charClass').textContent = `${char.class} - Lvl ${char.level}`;

        const abilitiesHTML = Object.entries(char.abilities).map(([key, value]) => `
            <div class="ability-score">
                <div class="ability-name">${key.toUpperCase()}</div>
                <div class="ability-value">${value.score}</div>
                <div class="ability-modifier">${value.modifier >= 0 ? '+' : ''}${value.modifier}</div>
            </div>
        `).join('');
        doc().getElementById('abilityScores').innerHTML = abilitiesHTML;

        const skillsHTML = Object.entries(char.skills).map(([key, value]) => `
            <div class="skill-item">
                <span class="skill-name">${key.charAt(0).toUpperCase() + key.slice(1)}</span>
                <span class="skill-modifier">+${value}</span>
            </div>
        `).join('');
        doc().getElementById('skillsList').innerHTML = skillsHTML;

        updateCharacterDisplay();
    }

    /** AC from armor if worn, otherwise 10 + DEX (unarmored). Prefers gameState equipment (found/bought armor). */
    function getEffectiveAC() {
        const char = gs().character;
        if (!char || !char.abilities) return char ? char.ac : 10;
        if (!gs().armorEquipped) return 10 + char.abilities.dex.modifier;
        const fromState = char.equipment && char.equipment.find(e => e.isArmor && e.equipped);
        if (fromState && fromState.ac != null) return fromState.ac;
        const worn = gd().character && gd().character.equipment && gd().character.equipment.worn;
        const armor = worn && worn.find(w => (w.type || '').toLowerCase() === 'armor');
        return (armor && armor.ac != null) ? armor.ac : char.ac;
    }

    function updateCharacterDisplay() {
        const char = gs().character;
        const ac = getEffectiveAC();
        doc().getElementById('hpDisplay').textContent = `${char.hp}/${char.maxHp}`;
        doc().getElementById('acDisplay').textContent = ac;

        const xpLevels = global.getXPLevels ? global.getXPLevels() : {};
        const currentLevel = char.level;
        const nextLevel = currentLevel + 1;
        const currentLevelXP = xpLevels[currentLevel] != null ? xpLevels[currentLevel] : 0;
        const nextLevelXP = xpLevels[nextLevel] != null
            ? xpLevels[nextLevel]
            : (xpLevels[10] != null ? xpLevels[10] * 2 : 999999);

        const xpProgress = char.xp - currentLevelXP;
        const xpNeeded   = nextLevelXP - currentLevelXP;
        const progressPercent = Math.min(100, (xpProgress / xpNeeded) * 100);

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

        // Conditions: icon + tooltip.
        const icons = global.CONDITION_ICONS || {};
        const iconDefault = global.CONDITION_ICON_DEFAULT || '';
        const conditionsHTML = char.conditions.length === 0
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

        // Equipped strip: armor, weapons, items-in-use (torch etc.)
        const equippedItems = [...char.equipment, ...(gs().equippedInUse || [])];
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

        // Pack: backpack items with quantities. Gold always first.
        const sortedInventory = [...char.inventory].sort((a, b) =>
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
        hideDeathOverlay
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
