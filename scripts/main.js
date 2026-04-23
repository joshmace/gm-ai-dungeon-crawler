/* AI Dungeon Crawler — Main bootstrap
 *
 * Owns the loading-overlay UX (setStatus / showError), the per-boot
 * initialize pipeline, and player-input handling. Runs from the inline
 * bootstrap shell's DOMContentLoaded hook; no auto-start here.
 *
 * Reads window.gameState / window.gameData / window.CONFIG through
 * accessor shortcuts (gs()/gd()/CFG()). All other still-inline helpers
 * are top-level function declarations (automatic window globals) or
 * have legacy aliases from the extracted modules, so they resolve bare.
 *
 * Attaches to window.Main.
 */
(function (global) {
    'use strict';

    const gs  = () => global.gameState;
    const gd  = () => global.gameData;
    const CFG = () => global.CONFIG;

    const STATUS_ID  = 'loadingStatus';
    const OVERLAY_ID = 'loadingOverlay';

    function setStatus(msg) {
        const el = global.document && global.document.getElementById(STATUS_ID);
        if (el) el.textContent = msg;
    }

    // On hard failure, replace the overlay's entire body with an error card.
    // The overlay stays full-screen (z-index 2000) so the player never sees a
    // half-loaded UI underneath. Copy button serializes { message, details }
    // for pasting into an issue; Retry button reloads the page.
    function showError(err) {
        const overlay = global.document && global.document.getElementById(OVERLAY_ID);
        if (!overlay) {
            (global.console && global.console.error) && global.console.error('Pack load error:', err);
            return;
        }

        const message = (err && err.message) || String(err);
        const details = (err && err.details) || {};

        const lines = [];
        lines.push(message);
        if (Array.isArray(details.errors) && details.errors.length) {
            lines.push('');
            lines.push('Validation issues:');
            details.errors.forEach(e => lines.push(`  - ${e.loc}: ${e.msg}`));
        } else if (details.url) {
            lines.push('');
            lines.push(`File: ${details.url}`);
            if (details.status) lines.push(`HTTP status: ${details.status}`);
            if (details.cause)  lines.push(`Cause: ${details.cause}`);
        }
        const copyText = lines.join('\n');

        overlay.innerHTML = '';
        const card = global.document.createElement('div');
        card.id = 'loadingErrorCard';
        card.innerHTML = `
            <h2>Pack failed to load</h2>
            <pre id="loadingErrorDetails"></pre>
            <div class="loading-error-actions">
                <button type="button" id="loadingErrorCopyBtn">Copy details</button>
                <button type="button" id="loadingErrorRetryBtn">Retry</button>
            </div>
        `;
        overlay.appendChild(card);
        overlay.querySelector('#loadingErrorDetails').textContent = copyText;
        overlay.querySelector('#loadingErrorCopyBtn').addEventListener('click', () => {
            if (global.navigator && global.navigator.clipboard) {
                global.navigator.clipboard.writeText(copyText).catch(() => {});
            }
        });
        overlay.querySelector('#loadingErrorRetryBtn').addEventListener('click', () => {
            global.location.reload();
        });
    }

    function initApiUsageConfig() {
        const maxTokensEl = document.getElementById('configMaxTokens');
        const historyTurnsEl = document.getElementById('configHistoryTurns');
        if (!maxTokensEl || !historyTurnsEl) return;
        maxTokensEl.value = CFG().MAX_TOKENS;
        historyTurnsEl.value = CFG().MAX_HISTORY_TURNS;
        function applyMaxTokens() {
            const v = parseInt(maxTokensEl.value, 10);
            if (!isNaN(v)) {
                CFG().MAX_TOKENS = Math.max(500, Math.min(8000, v));
                maxTokensEl.value = CFG().MAX_TOKENS;
            }
        }
        function applyHistoryTurns() {
            const v = parseInt(historyTurnsEl.value, 10);
            if (!isNaN(v)) {
                CFG().MAX_HISTORY_TURNS = Math.max(2, Math.min(50, v));
                historyTurnsEl.value = CFG().MAX_HISTORY_TURNS;
            }
        }
        maxTokensEl.addEventListener('change', applyMaxTokens);
        maxTokensEl.addEventListener('blur', applyMaxTokens);
        historyTurnsEl.addEventListener('change', applyHistoryTurns);
        historyTurnsEl.addEventListener('blur', applyHistoryTurns);
    }

    // Ring buffer of recent debugLog events. Used by Copy session report to
    // give me the last slice of PARSE / HAZARD / STATE / PROMPT events
    // alongside the narrative. Kept in memory only; cleared on reload.
    const DEBUG_RING_MAX = 80;
    const debugRing = [];
    global._debugRing = debugRing;

    function pushDebugRing(category, message, data) {
        const entry = {
            t: Date.now(),
            category,
            message: String(message),
            data: data == null ? null : (typeof data === 'string' ? data : JSON.stringify(data))
        };
        debugRing.push(entry);
        if (debugRing.length > DEBUG_RING_MAX) debugRing.shift();
    }

    // Debug logging function
    function debugLog(category, message, data = null) {
        // The ring buffer stays populated regardless of DEBUG_MODE so the
        // session report still has a trail when debug console spam is off.
        pushDebugRing(category, message, data);
        if (!CFG().DEBUG_MODE) return;

        const timestamp = new Date().toLocaleTimeString();
        const prefix = `[${timestamp}] [${category}]`;

        console.log(prefix, message, data || '');

        // Update debug panel parse log if it's a parse event
        if (category === 'PARSE') {
            const logDiv = document.getElementById('debugParseLog');
            if (logDiv) {
                const entry = document.createElement('div');
                entry.textContent = `${timestamp} ${message}`;
                entry.style.marginBottom = '2px';
                logDiv.insertBefore(entry, logDiv.firstChild);

                // Keep only last 20 entries
                while (logDiv.children.length > 20) {
                    logDiv.removeChild(logDiv.lastChild);
                }
            }
        }
    }

    async function loadGameData() {
        try {
            const v1 = await PackLoader.loadPack(CFG().GAME_PACK, updateLoadingStatus);
            const shim = GameState.init(v1);
            Object.assign(gd(), shim);
            debugLog('DATA', 'Pack loaded:', v1.manifest && v1.manifest.id);
            return true;
        } catch (error) {
            console.error('Failed to load game data:', error);
            Main.showError(error);
            return false;
        }
    }

    // Thin wrapper kept so callers later in the monolith (initializeGameStateFromData,
    // finishGameStart) can keep calling updateLoadingStatus without caring that the
    // real implementation lives in scripts/main.js now. Retired during Stage 1e+.
    function updateLoadingStatus(message) {
        Main.setStatus(message);
    }




    async function initializeGame() {
        debugLog('INIT', 'Starting game initialization');
        
        // Load all data files
        const loaded = await loadGameData();
        if (!loaded) {
            alert('Failed to load game data. Check console for details and ensure all JSON files are in the same directory.');
            return;
        }
        if (hasValidSave()) {
            showStartChoice();
            return;
        }
        initializeGameStateFromData();
        finishGameStart(true);
    }

    function initializeGameStateFromData() {
        updateLoadingStatus('Initializing game state...');
        gs().isDead = false;
        gs().triggeredEvents = [];
        gs().conversationHistory = [];
        gs().damageToEncounters = {};
        gs().inCombat = false;
        gs().mode = 'exploration';
        gs().equippedInUse = [];
        gs().lastCombatRoom = null;
        gs().encounterHistory = [];
        // Stage 4: hazard dispatcher state. A fresh game has no triggered
        // hazards; load/save carries these forward in game-state.js.
        gs().hazardState = {};
        gs().hazardQueue = [];
        gs().activeHazard = null;
        gs().commandHistory = [];
        gs().commandHistoryIndex = -1;
        gs().commandHistoryDraft = '';
        gs().pendingLevelUpAck = null;
        gs().character = {
            name: gd().character.basic_info.name,
            class: gd().character.basic_info.class,
            level: gd().character.basic_info.level,
            hp: gd().character.combat_stats.hit_points.current,
            maxHp: gd().character.combat_stats.hit_points.maximum,
            ac: gd().character.combat_stats.armor_class,
            xp: gd().character.experience.current,
            abilities: {},
            skills: {},
            equipment: [],
            inventory: [],
            conditions: []
        };
        
        // Convert abilities (map full names to short names)
        const abilityNameMap = {
            strength: 'str', dexterity: 'dex', constitution: 'con',
            intelligence: 'int', wisdom: 'wis', charisma: 'cha'
        };
        for (const [key, value] of Object.entries(gd().character.ability_scores)) {
            const shortKey = abilityNameMap[key] || key;
            gs().character.abilities[shortKey] = {
                score: value.score,
                modifier: value.modifier
            };
        }
        
        debugLog('INIT', 'Character abilities initialized', gs().character.abilities);
        
        // Convert skills
        for (const [key, value] of Object.entries(gd().character.skills)) {
            gs().character.skills[key] = value.modifier;
        }
        
        // Convert equipment: weapons and armor only (no torch, light sources, etc.)
        for (const item of [...gd().character.equipment.worn, ...gd().character.equipment.wielded, ...gd().character.equipment.carried]) {
            const isWeapon = !!item.damage;
            const isArmor = (item.type || '').toLowerCase() === 'armor';
            if (!isWeapon && !isArmor) continue; // skip torch, light sources, etc.
            const typeInfo = isWeapon ? getWeaponTypeInfo(item) : { type: null, range: null };
            let stats = '';
            if (item.damage) {
                const base = `${item.damage} ${item.damage_type}`;
                stats = typeInfo.type === 'ranged' && typeInfo.range
                    ? `${base} (ranged ${typeInfo.range})`
                    : `${base} (${typeInfo.type || 'melee'})`;
            } else {
                stats = item.properties ? item.properties.join(' - ') : '';
            }
            const eq = {
                name: item.name,
                stats,
                equipped: item.equipped !== undefined ? item.equipped : false,
                isWeapon,
                isArmor,
                weaponType: typeInfo.type,
                weaponRange: typeInfo.range
            };
            if (isArmor && item.ac != null) eq.ac = item.ac;
            if (isWeapon && item.damage) {
                eq.damage = item.damage;
                eq.damage_type = item.damage_type || '';
                eq.range = item.range || (typeInfo.range ? String(typeInfo.range) : 'melee');
                eq.properties = item.properties;
            }
            gs().character.equipment.push(eq);
        }
        // Convert inventory
        for (const item of gd().character.equipment.backpack) {
            gs().character.inventory.push({
                name: item.name,
                quantity: item.quantity
            });
        }
        
        // Add coins
        const coins = gd().character.equipment.coin;
        gs().character.inventory.push({
            name: 'Gold',
            quantity: `${coins.gold}gp`
        });
        
        // Set starting room
        gs().currentRoom = gd().module.module.starting_room;
        gs().readiedWeaponName = null;
        gs().armorEquipped = true;
    }

    function showStartChoice() {
        const overlay = document.getElementById('loadingOverlay');
        if (!overlay) return;
        const meta = getSaveMetadata();
        const savedAt = meta && meta.savedAt ? new Date(meta.savedAt).toLocaleString() : '';
        overlay.innerHTML = `
            <h2>Saved game found</h2>
            <p class="start-choice-p">Continue your adventure or start a new game.</p>
            ${savedAt ? `<p class="start-choice-meta">Saved: ${savedAt}</p>` : ''}
            <div class="start-choice-buttons">
                <button type="button" class="primary-button" id="btnContinue">Continue</button>
                <button type="button" class="secondary-button" id="btnNewGame">New game</button>
            </div>
        `;
        document.getElementById('btnContinue').onclick = () => {
            if (loadGame()) {
                finishGameStart(false);
            } else {
                initializeGameStateFromData();
                finishGameStart(true);
            }
        };
        document.getElementById('btnNewGame').onclick = () => {
            // if (!confirm('Are you sure? Your saved progress will be lost.')) return;
            initializeGameStateFromData();
            finishGameStart(true);
        };
    }

    function finishGameStart(showWelcome) {
        hideDeathOverlay();
        updateLoadingStatus('Rendering interface...');
        initializeCharacterSheet();
        document.getElementById('dungeonTitle').textContent = gd().module.module.title;
        const modeEl = document.getElementById('modeIndicator');
        if (modeEl) {
            modeEl.textContent = 'Exploration';
            modeEl.className = 'mode-indicator mode-exploration';
        }
        document.getElementById('loadingOverlay').style.display = 'none';
        initApiUsageConfig();
        document.getElementById('playerInput').disabled = false;
        if (showWelcome) {
            const startingRoom = gd().module.rooms[gs().currentRoom];
            addSystemMessage(`Welcome to ${gd().module.module.title}!`);
            addNarration(startingRoom.description);
            if (startingRoom.features) {
                for (const feature of startingRoom.features) {
                    if (feature.triggers && feature.triggers.includes('on_entry') && feature.text) {
                        addNarration(feature.text);
                    }
                }
            }
            addSystemMessage('Press Ctrl+Shift+D to toggle debug panel. Type your action and press Enter.');
        } else {
            addSystemMessage('Game loaded.');
            addResumeContext();
        }
        // Stage 4: fire any on_enter hazards in the starting room. Defer a tick
        // so the welcome narration lands first. The dispatcher's synonym rule
        // also catches on_traverse hazards at entry time. No-op for modules
        // whose starting room has no hazards (Gauntlet's hall_of_initiation).
        if (global.UI && global.UI.hazards) {
            setTimeout(() => {
                const roomId = gs().currentRoom;
                if (!roomId) return;
                global.UI.hazards.triggerHazards(roomId, 'on_enter');
            }, 0);
        }
        document.getElementById('playerInput').focus();
        const copyBtn = document.getElementById('copyNarrativeBtn');
        if (copyBtn) copyBtn.onclick = () => copyNarrativeToClipboard();
        const reportBtn = document.getElementById('copySessionReportBtn');
        if (reportBtn) reportBtn.onclick = () => copySessionReport();
        debugLog('INIT', 'Game initialization complete');
    }

    // ============================================
    // CHARACTER SHEET DISPLAY
    // ============================================
    




    // ============================================
    // INPUT HANDLING
    // ============================================
    
    function disableInput(disabled) {
        const input = document.getElementById('playerInput');
        input.disabled = disabled;
        if (!disabled) input.focus();
    }

    function handleKeyPress(event) {
        if (event.key === 'Enter') {
            submitAction();
        }
    }

    function handleInputKeyDown(event) {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        const history = gs().commandHistory;
        if (!history.length) return;
        const input = document.getElementById('playerInput');
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (gs().commandHistoryIndex === -1) {
                gs().commandHistoryDraft = input.value;
                gs().commandHistoryIndex = 0;
            } else if (gs().commandHistoryIndex < history.length - 1) {
                gs().commandHistoryIndex += 1;
            }
            input.value = history[gs().commandHistoryIndex];
        } else {
            event.preventDefault();
            if (gs().commandHistoryIndex <= 0) {
                gs().commandHistoryIndex = -1;
                input.value = gs().commandHistoryDraft;
            } else {
                gs().commandHistoryIndex -= 1;
                input.value = history[gs().commandHistoryIndex];
            }
        }
    }

    function submitAction() {
        const input = document.getElementById('playerInput');
        const action = input.value.trim();
        
        if (!action || gs().waitingForRoll) return;
        
        gs().lastCombatRoom = null; // clear lingering monster panel when player takes another action
        tryParseWeaponAway(action);
        tryParseWeaponSwitch(action);
        tryParseArmorState(action);
        tryParseRetreat(action);
        gs().torchUseParsedThisTurn = false; // reset each turn
        tryParsePackItemUse(action, true); // parse player's declared actions (e.g. "I pull out my torch and light it")
        
        addPlayerAction(action);
        input.value = '';
        gs().commandHistoryIndex = -1;
        gs().commandHistoryDraft = '';
        if (gs().commandHistory[0] !== action) {
            gs().commandHistory.unshift(action);
            if (gs().commandHistory.length > 50) gs().commandHistory.pop();
        }
        
        gs().lastUserRollType = null; // player is taking a new action (not responding to a roll)
        gs().conversationHistory.push({
            role: "user",
            content: action
        });
        
        callAIGM();
    }




    global.Main = {
        setStatus,
        showError,
        initializeGame,
        initializeGameStateFromData,
        showStartChoice,
        finishGameStart,
        disableInput,
        handleKeyPress,
        handleInputKeyDown,
        submitAction,
        loadGameData,
        updateLoadingStatus,
        debugLog,
        initApiUsageConfig
    };

    // Legacy globals for the inline boot trigger + remaining inline callers.
    global.initializeGame              = initializeGame;
    global.initializeGameStateFromData = initializeGameStateFromData;
    global.showStartChoice             = showStartChoice;
    global.finishGameStart             = finishGameStart;
    global.disableInput                = disableInput;
    global.handleKeyPress              = handleKeyPress;
    global.handleInputKeyDown          = handleInputKeyDown;
    global.submitAction                = submitAction;
    global.loadGameData                = loadGameData;
    global.updateLoadingStatus         = updateLoadingStatus;
    global.debugLog                    = debugLog;
    global.initApiUsageConfig          = initApiUsageConfig;
})(typeof window !== 'undefined' ? window : globalThis);
