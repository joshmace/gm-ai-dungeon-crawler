/* AI Dungeon Crawler — UI.dice
 *
 * Stage 1a scaffold. Implementation lands in later stages.
 * Attaches to window.UI.dice for use from the main HTML (no build step).
 */
(function (global) {
    'use strict';

    global.UI = global.UI || {};

    const dice = {};

    global.UI.dice = dice;
})(typeof window !== 'undefined' ? window : globalThis);
