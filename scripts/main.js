/* AI Dungeon Crawler — Main bootstrap
 *
 * Stage 1 scaffold. The full boot sequence wires in during Stage 1d:
 *   load templates -> fetch /api/config -> PackLoader.loadPack
 *   -> GameState.init -> mount UI -> bind input events.
 *
 * For now this file only owns the loading-overlay UX so other modules can
 * report status and surface errors cleanly even before the full bootstrap
 * is in place.
 *
 * Attaches to window.Main.
 */
(function (global) {
    'use strict';

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
            // Fallback: if the overlay isn't in the DOM yet (very early failure),
            // the browser's console is all we have. Not ideal but never silent.
            (global.console && global.console.error) && global.console.error('Pack load error:', err);
            return;
        }

        const message = (err && err.message) || String(err);
        const details = (err && err.details) || {};

        // Build a readable bundle. If validate() aggregated multiple errors,
        // details.errors is an array of { loc, msg } — format those prettily.
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

    global.Main = {
        setStatus,
        showError
    };
})(typeof window !== 'undefined' ? window : globalThis);
