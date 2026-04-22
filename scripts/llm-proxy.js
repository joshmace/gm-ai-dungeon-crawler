/* AI Dungeon Crawler — LLMProxy
 *
 * Wraps the per-turn call into the Anthropic Messages API (via server.js's
 * /api/messages proxy). Owns:
 *   - pruneConversationHistory: keeps the rolling history under
 *     CONFIG.MAX_HISTORY_TURNS (preserves the first two turns as intro).
 *   - callAIGM: builds the system prompt, posts the conversation, dispatches
 *     either the SSE stream reader or the single-shot JSON path, and pushes
 *     the assistant text into the response parser.
 *
 * Reads window.CONFIG, window.gameState, window.gameData (set by the inline
 * bootstrap). Calls into still-inline helpers via global aliases:
 *   buildSystemPrompt, processAIResponse, disableInput, debugLog,
 *   addLoadingIndicator/removeLoadingIndicator/removeStreamingNarration/
 *   addErrorMessage (the last four already live in UI.narrative).
 *
 * Each function is also exposed as a top-level global so the still-inline
 * caller (submitAction) keeps working without rewrites.
 *
 * Attaches to window.LLMProxy.
 */
(function (global) {
    'use strict';

    function pruneConversationHistory() {
        const CONFIG = global.CONFIG || {};
        const gs = global.gameState;
        if (!gs || !Array.isArray(gs.conversationHistory)) return;
        if (gs.conversationHistory.length > CONFIG.MAX_HISTORY_TURNS) {
            global.debugLog && global.debugLog('HISTORY',
                `Pruning conversation history (${gs.conversationHistory.length} turns)`);
            const intro  = gs.conversationHistory.slice(0, 2);
            const recent = gs.conversationHistory.slice(-(CONFIG.MAX_HISTORY_TURNS - 2));
            gs.conversationHistory = [...intro, ...recent];
            global.debugLog && global.debugLog('HISTORY',
                `History pruned to ${gs.conversationHistory.length} turns`);
        }
    }

    async function callAIGM() {
        const CONFIG = global.CONFIG || {};
        const gs = global.gameState;
        const debugLog = global.debugLog || (() => {});

        global.disableInput && global.disableInput(true);
        global.addLoadingIndicator && global.addLoadingIndicator();

        pruneConversationHistory();

        try {
            const systemPrompt = global.buildSystemPrompt();
            if (gs.pendingLevelUpAck) gs.pendingLevelUpAck = null;
            const messages = [...gs.conversationHistory];

            debugLog('AI', 'Calling AI GM', {
                historyLength: messages.length,
                currentRoom:   gs.currentRoom
            });

            const response = await fetch(CONFIG.API_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model:      CONFIG.MODEL,
                    max_tokens: CONFIG.MAX_TOKENS,
                    system:     systemPrompt,
                    messages:   messages,
                    stream:     !!CONFIG.STREAM
                })
            });

            if (!response.ok) {
                const responseText = await response.text();
                let detail = responseText;
                try {
                    const err = JSON.parse(responseText);
                    detail = (err.error && err.error.message)
                          || err.message
                          || (err.error && typeof err.error === 'string' ? err.error : responseText);
                } catch (e) { /* fall back to raw responseText */ }
                throw new Error(`API error: ${response.status} - ${detail}`);
            }

            let aiResponse;
            const contentType = response.headers.get('content-type') || '';
            if (CONFIG.STREAM && contentType.includes('text/event-stream')) {
                aiResponse = await global.readAnthropicStream(response);
            } else {
                const data = await response.json();
                aiResponse = data.content[0].text;
            }
            global.removeLoadingIndicator && global.removeLoadingIndicator();
            global.removeStreamingNarration && global.removeStreamingNarration();

            debugLog('AI', 'Received AI response', { length: aiResponse.length });

            gs.conversationHistory.push({ role: 'assistant', content: aiResponse });
            global.processAIResponse(aiResponse);

        } catch (error) {
            global.removeLoadingIndicator && global.removeLoadingIndicator();
            global.removeStreamingNarration && global.removeStreamingNarration();
            console.error('AI GM Error:', error);

            let errorMsg = 'Unknown error';
            if      (error.message.includes('Failed to fetch'))   errorMsg = 'Server not running. Start server.js first!';
            else if (error.message.includes('API error: 401'))    errorMsg = 'Invalid API key in server.js';
            else if (error.message.includes('API error: 429'))    errorMsg = 'Rate limit exceeded. Wait a moment.';
            else if (error.message.includes('API error: 400'))    errorMsg = error.message.replace('API error: 400 - ', 'Bad request (400): ');
            else                                                  errorMsg = error.message;

            global.addErrorMessage && global.addErrorMessage(errorMsg);
            global.disableInput && global.disableInput(false);
        }
    }

    global.LLMProxy = { callAIGM, pruneConversationHistory };

    // Legacy globals: still-inline callers (submitAction, debug helpers) use
    // bare names. Aliases retire as those callers move to extracted modules.
    global.callAIGM = callAIGM;
    global.pruneConversationHistory = pruneConversationHistory;
})(typeof window !== 'undefined' ? window : globalThis);
