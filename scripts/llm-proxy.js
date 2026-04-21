/* AI Dungeon Crawler — LLMProxy
 *
 * Stage 1a scaffold. Implementation lands in later stages.
 * Attaches to window.LLMProxy for use from the main HTML (no build step).
 */
(function (global) {
    'use strict';

    const LLMProxy = {};

    global.LLMProxy = LLMProxy;
})(typeof window !== 'undefined' ? window : globalThis);
