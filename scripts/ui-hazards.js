/* AI Dungeon Crawler — UI.hazards
 *
 * Stage 1a scaffold. Implementation lands in later stages.
 * Attaches to window.UI.hazards for use from the main HTML (no build step).
 */
(function (global) {
    'use strict';

    global.UI = global.UI || {};

    const hazards = {};

    global.UI.hazards = hazards;
})(typeof window !== 'undefined' ? window : globalThis);
