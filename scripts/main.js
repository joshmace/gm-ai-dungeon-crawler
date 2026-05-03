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
        // Stage 7: drop any pre-v1-envelope saves before checking for a
        // valid one. If purge fired, stash a note so the post-boot welcome
        // message tells the user their old save format was dropped.
        const purged = global.purgeStaleSaves ? global.purgeStaleSaves() : false;
        if (hasValidSave()) {
            showStartChoice();
            return;
        }
        initializeGameStateFromData();
        finishGameStart(true);
        if (purged && typeof addSystemMessage === 'function') {
            addSystemMessage('Old save format from a pre-Stage-7 build was dropped. This is a fresh game.');
        }
    }

    function initializeGameStateFromData() {
        updateLoadingStatus('Initializing game state...');
        gs().isDead = false;
        gs().triggeredEvents = [];
        gs().conversationHistory = [];
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
        // Stage 5: module runtime state (feature deltas, connection overrides, visited rooms).
        // A fresh game starts with authored state; load/save carries these forward too.
        gs().featureState = {};
        gs().connectionsModified = {};
        gs().visitedRooms = [];
        // Phase 3: rooms whose encounter info has been "released" to the
        // monster panel. A room joins this list the first time the system
        // prompt is built with it as the current room — i.e. the GM has
        // had a turn with the full room description + encounters in hand.
        // Walking through the threshold of a fresh-encounter room does NOT
        // surface enemies in the panel until the GM has narrated them.
        gs().panelReadyRooms = [];
        gs().commandHistory = [];
        gs().commandHistoryIndex = -1;
        gs().commandHistoryDraft = '';
        gs().pendingLevelUpAck = null;
        // Stage 7: completion-condition state + session-start wall-clock.
        // sessionStartedAt is preserved across loadGame so the completion
        // summary can show the original session's total runtime.
        gs().completion = { completed: false, conditions_met: [] };
        gs().sessionStartedAt = Date.now();
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
                weaponRange: typeInfo.range,
                // Stage 6 back-fill: preserve the v1 slot + id so equipItem /
                // unequipItem can find this entry on the legacy side (the Unequip
                // button also checks _v1_slot to decide whether to render).
                _v1_slot: item.slot || null,
                _v1_id:   item.id   || null
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
        const savedAtTs = meta && (meta.saved_at || meta.savedAt);
        const savedAt = savedAtTs ? new Date(savedAtTs).toLocaleString() : '';
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
        if (global.hideCompletionOverlay) global.hideCompletionOverlay();
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
        // Stage 5: single room-entry call. Marks the starting room visited,
        // renders feature cards + connections strip, and fires any on_enter
        // hazards (synonym-covering on_traverse too). Deferred a tick so the
        // welcome narration / resume context lands first.
        setTimeout(() => {
            const roomId = gs().currentRoom;
            if (!roomId) return;
            onRoomEntry(roomId);
        }, 0);
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

    /**
     * Stage 5: single coordination point for room entry. Called from:
     *   - finishGameStart (game start / resume)
     *   - response-parser's room-change wiring (player moved via narration)
     *   - ui-connections click handler indirectly (via the same response-parser path)
     *
     * Responsibilities in order:
     *   1. Mark the room visited (idempotent; only first entry appends).
     *   2. Render the feature cards for this room.
     *   3. Render the exit-button strip for this room.
     *   4. Fire any on_enter hazards in this room (the Stage 4 dispatcher's
     *      synonym rule also catches on_traverse hazards at entry time).
     *
     * Steps 2 + 3 re-evaluate prereqs every call, so features / connections
     * that became accessible via applyEffect while the player was elsewhere
     * surface correctly on re-entry.
     */
    function onRoomEntry(roomId) {
        if (!roomId) return;
        debugLog('STATE', `onRoomEntry: ${roomId}`);
        if (global.GameState && global.GameState.markRoomVisited) {
            global.GameState.markRoomVisited(roomId);
        }
        if (global.UI && global.UI.features && global.UI.features.renderForRoom) {
            global.UI.features.renderForRoom(roomId);
        }
        if (global.UI && global.UI.connections && global.UI.connections.renderForRoom) {
            global.UI.connections.renderForRoom(roomId);
        }
        if (global.UI && global.UI.hazards && global.UI.hazards.triggerHazards) {
            global.UI.hazards.triggerHazards(roomId, 'on_enter');
        }
    }

    /**
     * Phase 3: pre-emptive room flip. Called from the connection-click
     * handler (rock-solid signal) and from the player-input movement-
     * intent heuristic in submitAction. Mutates currentRoom DATA only —
     * onRoomEntry stays on its existing async timing (fired from
     * processAIResponse after the GM responds), so hazards still land
     * after the GM's room-entry narration, preserving the current order.
     *
     * The _preemptiveRoomChangeFrom flag tells processAIResponse where
     * we transitioned FROM, so its room-change check still fires and
     * triggers onRoomEntry for the destination.
     */
    function preemptiveRoomFlip(targetId) {
        if (!targetId) return false;
        const rooms = gd() && gd().module && gd().module.rooms;
        if (!rooms || !rooms[targetId]) return false;
        const prev = gs().currentRoom;
        if (targetId === prev) return false;
        gs().currentRoom = targetId;
        gs()._preemptiveRoomChangeFrom = prev;
        if (typeof updateCharacterDisplay === 'function') updateCharacterDisplay();
        if (global.debugLog) global.debugLog('PARSE', `Pre-emptive room flip: ${prev} → ${targetId}`);
        return true;
    }

    function submitAction() {
        const input = document.getElementById('playerInput');
        const action = input.value.trim();

        if (!action || gs().waitingForRoll) return;

        gs().lastCombatRoom = null; // clear lingering monster panel when player takes another action
        gs()._consumableUsedThisTurn = false; // Stage 6: reset the Use-button guard for this turn
        tryParseWeaponAway(action);
        tryParseWeaponSwitch(action);
        tryParseArmorState(action);
        tryParseRetreat(action);

        // Phase 3: pre-emptive room flip on player movement intent. If
        // the player's text matches a "move into <known room>" pattern
        // (movement verb + room name/id-phrase in same sentence), flip
        // currentRoom now so the GM's prompt renders the destination
        // FULL — description + features + encounters. Without this, the
        // GM responds to the move with only compact destination info
        // and either invents the room or omits the encounter. Connection
        // clicks (UI) hit this same path indirectly, since the click
        // handler also calls preemptiveRoomFlip directly with the exact
        // target id (more reliable than text heuristic).
        if (global.findMovementTargetInText) {
            const target = global.findMovementTargetInText(action);
            if (target) preemptiveRoomFlip(target);
        }
        // Phase 2: preemptive combat-mode flip. Pre-Phase-1 combat only
        // engaged once damage was applied (or the GM emitted [COMBAT: on]
        // in response). That meant the very first GM call after the player
        // declared an attack ran with mode=exploration even though the
        // player was clearly entering combat — a beat of stale framing.
        // When the player message reads as aggressive AND there's an active
        // enemy in the current room, flip to combat now so the GM gets
        // mode=combat on the prompt that drives the [ROLL_REQUEST: Attack].
        // Same as a symmetric counterpart to tryParseRetreat (which flips
        // OFF on retreat language).
        const aggressiveRe = /\b(?:i\s+)?(?:attack|strike|swing|stab|slash|shoot|fire(?:\s+at)?|charge|engage|lunge|hack|cleave)\b/i;
        if (!gs().inCombat && aggressiveRe.test(action)) {
            const enc = global.getFirstActiveEncounterInCurrentRoom && global.getFirstActiveEncounterInCurrentRoom();
            if (enc) {
                gs().inCombat = true;
                gs().mode = 'combat';
                if (global.debugLog) global.debugLog('PARSE', `Combat begun (player declared attack vs ${enc.id})`);
                if (typeof updateCharacterDisplay === 'function') updateCharacterDisplay();
            }
        }
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
        onRoomEntry,
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
    global.onRoomEntry                 = onRoomEntry;
    global.preemptiveRoomFlip          = preemptiveRoomFlip;
    global.loadGameData                = loadGameData;
    global.updateLoadingStatus         = updateLoadingStatus;
    global.debugLog                    = debugLog;
    global.initApiUsageConfig          = initApiUsageConfig;
})(typeof window !== 'undefined' ? window : globalThis);
