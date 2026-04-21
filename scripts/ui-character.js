/* AI Dungeon Crawler — UI.character
 *
 * Stage 1a scaffold. Implementation lands in later stages.
 * Attaches to window.UI.character for use from the main HTML (no build step).
 */
(function (global) {
    'use strict';

    global.UI = global.UI || {};

    const character = {};

    global.UI.character = character;
})(typeof window !== 'undefined' ? window : globalThis);
