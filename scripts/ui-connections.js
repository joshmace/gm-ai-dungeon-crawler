/* AI Dungeon Crawler — UI.connections
 *
 * Stage 1a scaffold. Implementation lands in later stages.
 * Attaches to window.UI.connections for use from the main HTML (no build step).
 */
(function (global) {
    'use strict';

    global.UI = global.UI || {};

    const connections = {};

    global.UI.connections = connections;
})(typeof window !== 'undefined' ? window : globalThis);
