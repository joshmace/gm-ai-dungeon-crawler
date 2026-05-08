/* AI Dungeon Crawler — UI.connections
 *
 * Stage 5: structured connections as exit buttons. Renders a strip of
 * one button per connection on room entry and on any state change
 * (unlock_connection / reveal_connection effect fires → re-render).
 *
 * State model:
 *   Authored connection state lives on gd().module.rooms[roomId].connections[key].
 *   Runtime overrides live on gs().connectionsModified[key]. Override takes
 *   precedence when present.
 *
 *   State values (authored + override):
 *     open    → enabled button. Click submits "I go through <label>" via the
 *               normal action pipeline; the GM narrates the transition + emits
 *               the [ROOM:] tag so response-parser fires the room-entry wiring.
 *     locked  → disabled chip with lock glyph. Player sees the door exists but
 *               can't traverse it. (unlock_connection upgrades to 'open'.)
 *     hidden  → not rendered. (reveal_connection upgrades to 'open'.)
 *
 *   A connection authored as a plain string ("iron_door": "chamber_beyond")
 *   renders as open — no state → default open.
 *
 * Click behavior:
 *   Writes "I go through <label>" into #playerInput and calls submitAction()
 *   so the action flows through the normal pipeline (player-action entry,
 *   command history, tryParseWeapon*, callAIGM). GM responds in-fiction with
 *   the room transition + [ROOM:] tag; response-parser's room-change logic
 *   fires the new room's feature cards / connections / on_enter hazards.
 *
 * Attaches to window.UI.connections.
 */
(function (global) {
    'use strict';

    const gs  = () => global.gameState;
    const gd  = () => global.gameData;
    const doc = () => global.document;
    const debugLog = (...a) => { if (global.debugLog) global.debugLog(...a); };

    /** Resolve a connection entry to a normalized shape regardless of authoring form. */
    function normalize(key, entry, overrides) {
        const override = overrides && overrides[key];
        let target = null;
        let label = null;
        let authoredState = 'open';

        if (typeof entry === 'string') {
            target = entry;
        } else if (entry && typeof entry === 'object') {
            target = entry.to || null;
            label = entry.label || null;
            authoredState = entry.state || 'open';
        }

        const state = (override && override.state) || authoredState;
        const revealed = !!(override && override.revealed);

        return {
            key,
            target,
            label: label || titleCase(key),
            state,
            revealed,
            overridden: !!override
        };
    }

    function titleCase(s) {
        return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());
    }

    /**
     * Enumerate the current room's connections in a stable order. Returns
     * { key, target, label, state, revealed, overridden } objects.
     */
    function connectionsForRoom(roomId) {
        if (!roomId) return [];
        const rooms = (gd().module && gd().module.rooms) || {};
        const room = rooms[roomId];
        if (!room || !room.connections) return [];
        const overrides = gs().connectionsModified || {};
        return Object.entries(room.connections).map(([k, v]) => normalize(k, v, overrides));
    }

    /** Clear the strip. Used on room change before re-render. */
    function clearStrip() {
        const strip = doc().getElementById('connectionsStrip');
        if (strip) strip.innerHTML = '';
    }

    /**
     * Render the current room's exit buttons into #connectionsStrip. Idempotent —
     * re-rendering replaces the strip contents. Locked connections render as
     * disabled chips; hidden connections are skipped.
     */
    function renderForRoom(roomId) {
        const strip = doc().getElementById('connectionsStrip');
        if (!strip) return;
        strip.innerHTML = '';

        const conns = connectionsForRoom(roomId);
        const visible = conns.filter(c => c.state !== 'hidden');
        debugLog('CONNECTION', `render room=${roomId}: ${visible.length} visible / ${conns.length} total`);

        if (visible.length === 0) {
            // No exits authored — leave strip empty. Some chambers (boss rooms,
            // sealed vaults) might legitimately have no connections at design time.
            return;
        }

        for (const c of visible) {
            const btn = doc().createElement('button');
            btn.type = 'button';
            btn.className = 'connection-button';
            btn.dataset.connectionKey = c.key;
            btn.dataset.target = c.target || '';
            btn.dataset.state = c.state;

            if (c.state === 'locked') {
                btn.classList.add('connection-locked');
                btn.disabled = true;
                btn.title = 'Locked — find a way to open it';
                btn.innerHTML = `<span class="connection-lock">🔒</span>${escapeHtml(c.label)}`;
            } else {
                btn.classList.add('connection-open');
                if (c.revealed) btn.classList.add('connection-revealed');
                btn.textContent = c.label;
                btn.addEventListener('click', () => onClick(c));
            }

            strip.appendChild(btn);
        }
    }

    function onClick(conn) {
        if (gs().waitingForRoll || gs().activeHazard) {
            // Gate clicks during an in-flight roll or hazard step so the
            // player can't backdoor past the dispatcher. The dispatcher
            // releases the input when its step resolves.
            return;
        }
        const input = doc().getElementById('playerInput');
        if (!input) return;
        const label = conn.label || titleCase(conn.key);
        input.value = `I go through ${label}.`;
        debugLog('CONNECTION', `click: ${conn.key} → ${conn.target} (state=${conn.state})`);
        // Phase 3: pre-emptive room flip — connection click is a rock-
        // solid signal that the player is moving to conn.target. Flip
        // currentRoom now so the GM's prompt renders the destination
        // FULL on the very turn that handles this move. Without this,
        // the GM responds from a prompt where the destination is just a
        // compact id-name-exits stub and either hallucinates the room
        // or omits the authored encounter on entry.
        //
        // Mark the click so submitAction skips its redundant text-heuristic
        // call into preemptiveRoomFlip — the chip already attempted the
        // flip with the exact target id, and the heuristic on the same
        // text would attempt it again, which is harmless on success but
        // double-emits side effects (callout, debug log) on a blocked
        // attempt (in-combat guard).
        gs()._chipClickInProgress = true;
        if (conn.target && global.preemptiveRoomFlip) global.preemptiveRoomFlip(conn.target);
        if (global.submitAction) {
            global.submitAction();
        }
    }

    function escapeHtml(s) {
        return String(s || '').replace(/[&<>"']/g, ch =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    global.UI = global.UI || {};
    global.UI.connections = {
        renderForRoom,
        clearStrip,
        connectionsForRoom
    };
})(typeof window !== 'undefined' ? window : globalThis);
