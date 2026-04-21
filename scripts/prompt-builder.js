/* AI Dungeon Crawler — PromptBuilder
 *
 * Stage 1a scaffold. Implementation lands in later stages.
 * Attaches to window.PromptBuilder for use from the main HTML (no build step).
 */
(function (global) {
    'use strict';

    const PromptBuilder = {};

    global.PromptBuilder = PromptBuilder;
})(typeof window !== 'undefined' ? window : globalThis);
