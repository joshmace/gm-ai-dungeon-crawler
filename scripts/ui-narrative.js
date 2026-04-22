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
        const scroll = doc().getElementById('narrativeScroll');
        if (!scroll) return;
        const entry = doc().createElement('div');
        entry.className = 'narrative-entry';
        entry.innerHTML = `<div class="gm-narration">${normalizeNarrativeFormatting(text)}</div>`;
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
        const cleaned = fullText.replace(CONTROL_TAG_RE, '').replace(/\s{2,}/g, ' ').trim();
        target.innerHTML = normalizeNarrativeFormatting(cleaned);
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
        const scroll = doc().getElementById('narrativeScroll');
        if (!scroll) return '';
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
        const text = lines.join('\n');
        if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
            global.navigator.clipboard.writeText(text).then(() => {
                const btn = doc().getElementById('copyNarrativeBtn');
                if (btn) {
                    const orig = btn.textContent;
                    btn.textContent = 'Copied!';
                    btn.disabled = true;
                    setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2000);
                }
            }).catch(() => {});
        }
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
        addErrorMessage,
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
    global.addErrorMessage = addErrorMessage;
    global.CONTROL_TAG_RE = CONTROL_TAG_RE;
})(typeof window !== 'undefined' ? window : globalThis);
