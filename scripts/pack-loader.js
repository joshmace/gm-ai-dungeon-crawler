/* AI Dungeon Crawler — PackLoader
 *
 * Stage 1a scaffold. Implementation lands in later stages.
 * Attaches to window.PackLoader for use from the main HTML (no build step).
 */
(function (global) {
    'use strict';

    const PackLoader = {};

    global.PackLoader = PackLoader;
})(typeof window !== 'undefined' ? window : globalThis);
