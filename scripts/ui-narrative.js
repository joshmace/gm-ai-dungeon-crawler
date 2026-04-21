/* AI Dungeon Crawler — UI.narrative
 *
 * Stage 1a scaffold. Implementation lands in later stages.
 * Attaches to window.UI.narrative for use from the main HTML (no build step).
 */
(function (global) {
    'use strict';

    global.UI = global.UI || {};

    const narrative = {};

    global.UI.narrative = narrative;
})(typeof window !== 'undefined' ? window : globalThis);
