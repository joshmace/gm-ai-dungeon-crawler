/* AI Dungeon Crawler — ResponseParser
 *
 * Stage 1a scaffold. Implementation lands in later stages.
 * Attaches to window.ResponseParser for use from the main HTML (no build step).
 */
(function (global) {
    'use strict';

    const ResponseParser = {};

    global.ResponseParser = ResponseParser;
})(typeof window !== 'undefined' ? window : globalThis);
