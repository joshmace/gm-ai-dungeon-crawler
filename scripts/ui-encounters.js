/* AI Dungeon Crawler — UI.encounters
 *
 * Stage 1a scaffold. Implementation lands in later stages.
 * Attaches to window.UI.encounters for use from the main HTML (no build step).
 */
(function (global) {
    'use strict';

    global.UI = global.UI || {};

    const encounters = {};

    global.UI.encounters = encounters;
})(typeof window !== 'undefined' ? window : globalThis);
