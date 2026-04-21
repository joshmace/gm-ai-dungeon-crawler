/* AI Dungeon Crawler — UI.features
 *
 * Stage 1a scaffold. Implementation lands in later stages.
 * Attaches to window.UI.features for use from the main HTML (no build step).
 */
(function (global) {
    'use strict';

    global.UI = global.UI || {};

    const features = {};

    global.UI.features = features;
})(typeof window !== 'undefined' ? window : globalThis);
