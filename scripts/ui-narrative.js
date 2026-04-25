/* AI Dungeon Crawler — UI.narrative
 *
 * Narrative panel: scrolling log of GM narration, player actions, system
 * messages, mechanics callouts, and the streaming-response indicator.
 *
 * Reads gameState.currentRoom and gameData.module.rooms (exposed on window
 * by the inline bootstrap) for the resume-context helper. All other
 * functions are pure DOM operations on #narrativeScroll.
 *
 * Each function is also exposed as a top-level global so the still-inline
 * callers (~30 sites across the monolith) keep working without rewrites.
 * The aliases retire as those callers get extracted in later 1e sub-stages.
 *
 * Attaches to window.UI.narrative.
 */
(function (global) {
    'use strict';

    const doc = () => global.document;

    function scrollToBottom() {
        const scroll = doc().getElementById('narrativeScroll');
        if (!scroll) return;
        setTimeout(() => { scroll.scrollTop = scroll.scrollHeight; }, 100);
    }

    /** Convert markdown ** to <b></b> so both **text** and <b>text</b> render bold. */
    function normalizeNarrativeFormatting(text) {
        if (!text || typeof text !== 'string') return '';
        const parts = text.split(/\*\*/);
        let out = '';
        for (let i = 0; i < parts.length; i++) {
            if (i % 2 === 1) out += '<b>' + parts[i] + '</b>';
            else out += parts[i];
        }
        return out;
    }

    function addNarration(text) {
        const formatted = normalizeNarrativeFormatting(text);
        // Streaming: if a #streamingNarration div is sitting in the
        // panel from a just-completed stream, upgrade it in place
        // instead of removing it and creating a new entry. Avoids the
        // visible re-render flash where the streamed prose disappears
        // and is replaced by the final-rendered version.
        const streaming = doc().getElementById('streamingNarration');
        if (streaming) {
            const target = streaming.querySelector('.gm-narration');
            if (target) target.innerHTML = formatted;
            streaming.removeAttribute('id'); // becomes an ordinary narrative-entry; subsequent calls create new entries.
            scrollToBottom();
            return;
        }
        const scroll = doc().getElementById('narrativeScroll');
        if (!scroll) return;
        const entry = doc().createElement('div');
        entry.className = 'narrative-entry';
        entry.innerHTML = `<div class="gm-narration">${formatted}</div>`;
        scroll.appendChild(entry);
        scrollToBottom();
    }

    /** When loading a saved game: add GM-style "you find yourself in X" context. */
    function addResumeContext() {
        const gs = global.gameState;
        const gd = global.gameData;
        const roomId = gs && gs.currentRoom;
        const rooms = gd && gd.module && gd.module.rooms;
        const room = rooms && roomId ? rooms[roomId] : null;
        if (!room) return;
        const name = room.name || roomId || 'the area';
        const desc = room.description || '';
        addNarration(desc ? `You find yourself in ${name}. ${desc}` : `You find yourself in ${name}.`);
    }

    /** Strip optional scene-imagery tags from GM text so they don't render. */
    function parseSceneDirectives(text) {
        if (!text) return { cleanText: '' };
        const cleanText = text
            .replace(/\[SCENE_IMAGE:\s*[^\]]+\]/gi, '')
            .replace(/\[SCENE_PROMPT:\s*[^\]]+\]/gi, '')
            .replace(/\[SCENE_ALT:\s*[^\]]+\]/gi, '')
            .replace(/\[SCENE_STYLE:\s*[^\]]+\]/gi, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
        return { cleanText };
    }

    function addPlayerAction(text) {
        const scroll = doc().getElementById('narrativeScroll');
        if (!scroll) return;
        const entry = doc().createElement('div');
        entry.className = 'narrative-entry';
        entry.innerHTML = `<div class="player-action">${text}</div>`;
        scroll.appendChild(entry);
        scrollToBottom();
    }

    function addSystemMessage(text) {
        const scroll = doc().getElementById('narrativeScroll');
        if (!scroll) return;
        const entry = doc().createElement('div');
        entry.className = 'narrative-entry';
        entry.innerHTML = `<div class="system-message">${text}</div>`;
        scroll.appendChild(entry);
        scrollToBottom();
    }

    /** Append a mechanics callout (Section 2 format). Used after rules-engine outcomes. */
    function addMechanicsCallout(text) {
        if (!text || !text.trim()) return;
        const scroll = doc().getElementById('narrativeScroll');
        if (!scroll) return;
        const entry = doc().createElement('div');
        entry.className = 'narrative-entry mechanics-callout-entry';
        const div = doc().createElement('div');
        div.className = 'mechanics-callout';
        div.textContent = text.trim();
        entry.appendChild(div);
        scroll.appendChild(entry);
        scrollToBottom();
    }

    function addLoadingIndicator() {
        const scroll = doc().getElementById('narrativeScroll');
        if (!scroll) return null;
        const entry = doc().createElement('div');
        entry.className = 'narrative-entry';
        entry.id = 'loadingIndicator';
        entry.innerHTML = `<div class="loading-indicator">GM is thinking</div>`;
        scroll.appendChild(entry);
        scrollToBottom();
        return entry;
    }

    function removeLoadingIndicator() {
        const indicator = doc().getElementById('loadingIndicator');
        if (indicator) indicator.remove();
    }

    /** Control tags that must not render mid-stream (still parsed on completion). */
    const CONTROL_TAG_RE = /\[[A-Z][A-Z_]*(?:\s*:\s*[^\]]*)?\]/g;

    /**
     * Compute the safe display text for a partial stream buffer. Strips
     * complete control tags AND hides any text from an unclosed `[` to
     * the end of the buffer — without this, mid-stream chunks like
     * "She turns. [ROLL_REQ" would flash the partial tag until the
     * closing `]` arrives.
     *
     * The hidden tail unfreezes naturally as soon as either the closing
     * `]` arrives (regex sweeps the whole tag) or the model writes
     * something after a `]` and a new (potentially unclosed) `[` further
     * down the stream.
     */
    function streamSafeText(rawText) {
        if (!rawText) return '';
        // Find the last `[` that has no `]` after it — anything from
        // there onwards is an in-progress control tag, hide it.
        const lastOpen = rawText.lastIndexOf('[');
        let visible = rawText;
        if (lastOpen !== -1) {
            const tail = rawText.slice(lastOpen);
            if (!tail.includes(']')) visible = rawText.slice(0, lastOpen);
        }
        return visible.replace(CONTROL_TAG_RE, '').replace(/\s{2,}/g, ' ').trim();
    }

    function ensureStreamingNarration() {
        let entry = doc().getElementById('streamingNarration');
        if (entry) return entry.querySelector('.gm-narration');
        removeLoadingIndicator();
        const scroll = doc().getElementById('narrativeScroll');
        if (!scroll) return null;
        entry = doc().createElement('div');
        entry.className = 'narrative-entry';
        entry.id = 'streamingNarration';
        entry.innerHTML = '<div class="gm-narration"></div>';
        scroll.appendChild(entry);
        return entry.querySelector('.gm-narration');
    }

    function updateStreamingNarration(fullText) {
        const target = ensureStreamingNarration();
        if (!target) return;
        target.innerHTML = normalizeNarrativeFormatting(streamSafeText(fullText));
        scrollToBottom();
    }

    function removeStreamingNarration() {
        const entry = doc().getElementById('streamingNarration');
        if (entry) entry.remove();
    }

    /** Read Anthropic Messages SSE; return the full assistant text. Updates the
     *  streaming narration div as deltas arrive. */
    async function readAnthropicStream(response) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullText = '';
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let nl;
            while ((nl = buffer.indexOf('\n\n')) !== -1) {
                const rawEvent = buffer.slice(0, nl);
                buffer = buffer.slice(nl + 2);
                for (const line of rawEvent.split('\n')) {
                    if (!line.startsWith('data:')) continue;
                    const payload = line.slice(5).trim();
                    if (!payload) continue;
                    let evt;
                    try { evt = JSON.parse(payload); } catch (e) { continue; }
                    if (evt.type === 'content_block_delta' && evt.delta && evt.delta.type === 'text_delta') {
                        fullText += evt.delta.text;
                        updateStreamingNarration(fullText);
                    } else if (evt.type === 'error') {
                        throw new Error(evt.error && evt.error.message ? evt.error.message : 'Stream error');
                    }
                }
            }
        }
        return fullText;
    }

    /** Build plain-text copy of narrative panel for playtest feedback. */
    function copyNarrativeToClipboard() {
        const text = buildNarrativeBlock().join('\n');
        writeClipboardAndFlash(text, 'copyNarrativeBtn');
        return text;
    }

    function buildNarrativeBlock() {
        const scroll = doc().getElementById('narrativeScroll');
        if (!scroll) return [];
        const lines = ['---', 'Narrative panel (for playtest feedback)', '---', ''];
        const getText = el => (el && el.innerText != null ? el.innerText
            : (el && el.textContent != null ? el.textContent : '')).trim();
        for (const entry of scroll.querySelectorAll('.narrative-entry')) {
            if (entry.id === 'loadingIndicator') continue;
            const gm      = entry.querySelector('.gm-narration');
            const player  = entry.querySelector('.player-action');
            const system  = entry.querySelector('.system-message');
            const callout = entry.querySelector('.mechanics-callout');
            if      (gm      && gm.textContent.trim())      lines.push('[GM] '      + getText(gm));
            else if (player  && player.textContent.trim())  lines.push('[Player] '  + getText(player));
            else if (system  && system.textContent.trim())  lines.push('[System] '  + getText(system));
            else if (callout && callout.textContent.trim()) lines.push('[Callout] ' + getText(callout));
        }
        return lines;
    }

    function writeClipboardAndFlash(text, btnId) {
        if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
            global.navigator.clipboard.writeText(text).then(() => {
                const btn = doc().getElementById(btnId);
                if (btn) {
                    const orig = btn.textContent;
                    btn.textContent = 'Copied!';
                    btn.disabled = true;
                    setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2000);
                }
            }).catch(() => {});
        }
    }

    // ----- Stage 4: Copy session report ------------------------------------
    //
    // One-paste bug report: pack/character header, state block keyed on
    // Stage 4 concerns (currentRoom, hazardState, activeHazard, conditions,
    // pendingRollContext, prompt size), last-20-event debug trail, and the
    // full narrative + callouts. Designed to be pasted back to me so I can
    // diagnose without asking the designer to re-type.

    /** Extract a compact { id, state, times_fired } map from gameState. */
    function hazardStateSummary() {
        const gs = global.gameState;
        const raw = (gs && gs.hazardState) || {};
        const out = {};
        for (const [id, v] of Object.entries(raw)) {
            out[id] = { state: v.state, times_fired: v.times_fired };
        }
        return out;
    }

    function promptZoneFor(len) {
        if (!Number.isFinite(len)) return '(not yet built)';
        if (len < 8000)  return `${len} chars (green)`;
        if (len < 16000) return `${len} chars (YELLOW — watch)`;
        return `${len} chars (RED — mitigate)`;
    }

    function buildStateBlock() {
        const gs = global.gameState || {};
        const gd = global.gameData  || {};
        const cfg = global.CONFIG   || {};
        const char = gs.character || {};
        const v1 = gd._v1 || {};
        const pack = cfg.GAME_PACK || '?';
        const moduleTitle = (gd.module && gd.module.module && gd.module.module.title) || '?';
        const ruleset = (v1.rules && v1.rules.name) || (gd.rules && gd.rules.name) || '?';
        const rulesMethod = (v1.rules && v1.rules.resolution && v1.rules.resolution.checks
            && v1.rules.resolution.checks.method) || '?';
        const saveType = (v1.rules && v1.rules.character_model && v1.rules.character_model.saves
            && v1.rules.character_model.saves.type) || '?';
        const adEnabled = !!(v1.rules && v1.rules.resolution && v1.rules.resolution.checks
            && v1.rules.resolution.checks.advantage_disadvantage);
        const conditions = (char.conditions || []).map(c => c.id || c.name || c).join(', ') || '(none)';
        const pending = gs.pendingRollContext
            ? `${gs.pendingRollContext.rollType || '?'} / ${(gs.pendingRollContext.abilityName || gs.pendingRollContext.dice && gs.pendingRollContext.dice.ability) || '?'}`
            : '(none)';
        const active = gs.activeHazard
            ? `${gs.activeHazard.plan && gs.activeHazard.plan.id} step ${gs.activeHazard.stepIndex}`
            : '(none)';
        const queue = (gs.hazardQueue || []).map(p => p && p.id).join(', ') || '(empty)';
        const promptLen = gs._lastSystemPromptLen;

        const lines = [];
        lines.push('---');
        lines.push('Session report');
        lines.push('---');
        lines.push(`Generated: ${new Date().toISOString()}`);
        lines.push(`Pack:       ${pack}`);
        lines.push(`Module:     ${moduleTitle}`);
        lines.push(`Ruleset:    ${ruleset}  (checks=${rulesMethod}, saves=${saveType}, adv/disadv=${adEnabled})`);
        lines.push('');
        lines.push('## Character');
        lines.push(`Name:       ${char.name || '?'} (${char.class || '?'} L${char.level || '?'})`);
        lines.push(`HP:         ${char.hp != null ? char.hp : '?'} / ${char.maxHp != null ? char.maxHp : '?'}`);
        lines.push(`AC:         ${char.ac != null ? char.ac : '?'}`);
        lines.push(`XP:         ${char.xp != null ? char.xp : '?'}`);
        lines.push(`Conditions: ${conditions}`);
        lines.push(`Readied:    ${gs.readiedWeaponName || '(none)'}`);
        lines.push('');
        lines.push('## Runtime state');
        lines.push(`currentRoom:    ${gs.currentRoom || '(null)'}`);
        lines.push(`lastCombatRoom: ${gs.lastCombatRoom || '(null)'}`);
        lines.push(`mode:           ${gs.mode || '(exploration)'}`);
        lines.push(`inCombat:       ${!!gs.inCombat}`);
        lines.push(`lastUserRollType: ${gs.lastUserRollType || '(null)'}`);
        lines.push(`waitingForRoll: ${!!gs.waitingForRoll}`);
        lines.push(`pendingRoll:    ${pending}`);
        lines.push('');
        lines.push('## Hazard dispatcher');
        lines.push(`activeHazard: ${active}`);
        lines.push(`hazardQueue:  ${queue}`);
        const hzState = hazardStateSummary();
        if (Object.keys(hzState).length === 0) {
            lines.push('hazardState:  (empty)');
        } else {
            lines.push('hazardState:');
            for (const [id, v] of Object.entries(hzState)) {
                lines.push(`  ${id}: ${v.state} (fired ${v.times_fired}x)`);
            }
        }
        lines.push('');
        lines.push(`System prompt size: ${promptZoneFor(promptLen)}`);
        return lines;
    }

    function buildDebugTrailBlock() {
        const ring = (global._debugRing || []).slice(-40);
        const lines = ['---', 'Debug trail (most recent 40)', '---'];
        if (ring.length === 0) { lines.push('(empty)'); return lines; }
        for (const e of ring) {
            const ts = new Date(e.t).toLocaleTimeString();
            const tail = e.data ? ` · ${e.data}` : '';
            lines.push(`${ts} [${e.category}] ${e.message}${tail}`);
        }
        return lines;
    }

    /** Primary session-report builder — pastes well into a bug report. */
    function buildSessionReport() {
        const chunks = [];
        chunks.push(buildStateBlock().join('\n'));
        chunks.push('');
        chunks.push(buildDebugTrailBlock().join('\n'));
        chunks.push('');
        chunks.push(buildNarrativeBlock().join('\n'));
        return chunks.join('\n');
    }

    function copySessionReport() {
        const text = buildSessionReport();
        writeClipboardAndFlash(text, 'copySessionReportBtn');
        return text;
    }

    function addErrorMessage(text) {
        const scroll = doc().getElementById('narrativeScroll');
        if (!scroll) return;
        const entry = doc().createElement('div');
        entry.className = 'narrative-entry';
        entry.innerHTML = `<div class="error-message">Error: ${text}</div>`;
        scroll.appendChild(entry);
        scrollToBottom();
    }

    /**
     * Stage 7: end-of-module summary card. Called from GameState.checkCompletion
     * when the completion condition first fires. `summary` is the payload from
     * GameState.buildCompletionSummary (XP, gold, level, rooms visited,
     * encounters defeated, run duration, module title, condition kind/target).
     *
     * Mirrors the death-overlay pattern in ui-character.js — disables input,
     * wires Restart / Load save buttons. Distinct from the death overlay so
     * Three Knots death-at-zero-HP and completion-on-kill-Havel can both
     * fire for the same character without UI collision.
     */
    function showCompletionOverlay(summary) {
        const el = doc().getElementById('completionOverlay');
        if (!el) return;
        el.style.display = 'flex';

        const title = doc().getElementById('completionOverlayTitle');
        if (title) {
            title.textContent = (summary && summary.module_title)
                ? summary.module_title + ' — Complete'
                : 'Adventure Complete';
        }

        const subtitle = doc().getElementById('completionOverlaySubtitle');
        if (subtitle) {
            const kind = summary && summary.kind;
            subtitle.textContent = kind === 'defeat_encounter'     ? 'The final encounter falls.'
                                 : kind === 'reach_room'           ? 'You have reached the goal.'
                                 : kind === 'all_encounters_defeated' ? 'Every foe in the module lies defeated.'
                                 : 'Your adventure is complete.';
        }

        const stats = doc().getElementById('completionOverlayStats');
        if (stats && summary) {
            const mins = Math.floor((summary.duration_ms || 0) / 60000);
            const secs = Math.floor(((summary.duration_ms || 0) % 60000) / 1000);
            const durationStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
            const rows = [
                ['Level',            String(summary.level || 1)],
                ['XP',               String(summary.xp || 0)],
                ['Gold',             String(summary.gold || 0)],
                ['Rooms visited',    String(summary.rooms_visited || 0)],
                ['Encounters defeated', String(summary.encounters_defeated || 0)],
                ['Run duration',     durationStr]
            ];
            stats.innerHTML = rows.map(([l, v]) =>
                `<div class="label">${l}</div><div class="value">${v}</div>`
            ).join('');
        }

        const loadBtn = doc().getElementById('completionBtnLoadSave');
        if (loadBtn) {
            loadBtn.style.display = (global.hasValidSave && global.hasValidSave()) ? '' : 'none';
            loadBtn.onclick = () => {
                if (global.loadGame && global.loadGame()) {
                    hideCompletionOverlay();
                    if (global.initializeCharacterSheet) global.initializeCharacterSheet();
                    if (global.updateCharacterDisplay)   global.updateCharacterDisplay();
                    if (global.updateMonsterPanel)       global.updateMonsterPanel();
                    if (global.addSystemMessage)         global.addSystemMessage('Game loaded.');
                    if (global.addResumeContext)         global.addResumeContext();
                    const input = doc().getElementById('playerInput');
                    if (input) { input.disabled = false; input.focus(); }
                }
            };
        }

        const restartBtn = doc().getElementById('completionBtnRestart');
        if (restartBtn) {
            restartBtn.onclick = () => {
                hideCompletionOverlay();
                const scroll = doc().getElementById('narrativeScroll');
                if (scroll) scroll.innerHTML = '';
                if (global.initializeGameStateFromData) global.initializeGameStateFromData();
                if (global.finishGameStart) global.finishGameStart(true);
            };
        }

        // Disable further input — the run is over.
        const input = doc().getElementById('playerInput');
        if (input) input.disabled = true;
    }

    function hideCompletionOverlay() {
        const el = doc().getElementById('completionOverlay');
        if (el) el.style.display = 'none';
    }

    global.UI = global.UI || {};
    global.UI.narrative = {
        scrollToBottom,
        normalizeNarrativeFormatting,
        addNarration,
        addResumeContext,
        parseSceneDirectives,
        addPlayerAction,
        addSystemMessage,
        addMechanicsCallout,
        addLoadingIndicator,
        removeLoadingIndicator,
        ensureStreamingNarration,
        updateStreamingNarration,
        removeStreamingNarration,
        readAnthropicStream,
        copyNarrativeToClipboard,
        copySessionReport,
        buildSessionReport,
        addErrorMessage,
        showCompletionOverlay,
        hideCompletionOverlay,
        CONTROL_TAG_RE
    };

    // Legacy globals: still-inline callers use bare names. These aliases retire
    // as callers move into other extracted modules.
    global.scrollToBottom = scrollToBottom;
    global.normalizeNarrativeFormatting = normalizeNarrativeFormatting;
    global.addNarration = addNarration;
    global.addResumeContext = addResumeContext;
    global.parseSceneDirectives = parseSceneDirectives;
    global.addPlayerAction = addPlayerAction;
    global.addSystemMessage = addSystemMessage;
    global.addMechanicsCallout = addMechanicsCallout;
    global.addLoadingIndicator = addLoadingIndicator;
    global.removeLoadingIndicator = removeLoadingIndicator;
    global.ensureStreamingNarration = ensureStreamingNarration;
    global.updateStreamingNarration = updateStreamingNarration;
    global.removeStreamingNarration = removeStreamingNarration;
    global.readAnthropicStream = readAnthropicStream;
    global.copyNarrativeToClipboard = copyNarrativeToClipboard;
    global.copySessionReport = copySessionReport;
    global.buildSessionReport = buildSessionReport;
    global.addErrorMessage = addErrorMessage;
    global.showCompletionOverlay = showCompletionOverlay;
    global.hideCompletionOverlay = hideCompletionOverlay;
    global.CONTROL_TAG_RE = CONTROL_TAG_RE;
})(typeof window !== 'undefined' ? window : globalThis);
