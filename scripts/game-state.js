/* AI Dungeon Crawler — GameState
 *
 * Stage 1a scaffold. Implementation lands in later stages.
 * Attaches to window.GameState for use from the main HTML (no build step).
 */
(function (global) {
    'use strict';

    const GameState = {};

    global.GameState = GameState;
})(typeof window !== 'undefined' ? window : globalThis);
