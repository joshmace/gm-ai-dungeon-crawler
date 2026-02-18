# How Anthropic Credits Are Consumed

Anthropic charges **per token**: separate rates for **input** (what you send) and **output** (what the model generates). Output is typically several times more expensive per token than input. Your credits are spent on both.

## What happens on each turn

Every time you send a message and the GM replies:

1. The app sends **one** request to the API with:
   - **System prompt** – full game state (character, rules, module layout, current room, features, encounters, etc.). This is **rebuilt every turn** and sent in full.
   - **Messages** – recent conversation history (user + assistant turns), up to `MAX_HISTORY_TURNS` (default 20).

2. The model generates a reply (up to `MAX_TOKENS` characters/tokens).

You are billed for:
- All **input tokens** (system + every message in the request).
- All **output tokens** (the GM’s reply).

So **each turn** costs: *(system prompt size + history size)* as input + *(length of the reply)* as output.

## Factors that increase credit use

| Factor | Effect |
|--------|--------|
| **More turns** | More API calls and more messages in history → more input tokens per call as the session goes on. |
| **Larger system prompt** | Bigger rules (e.g. long `rules.json`), bigger module (more rooms, features, text), more encounters → more input tokens **every** request. |
| **Longer conversation history** | Higher `MAX_HISTORY_TURNS` → more messages sent each time → more input per request. |
| **Longer GM replies** | Model writes more → more output tokens. Capped by `MAX_TOKENS` (default 2000). |
| **Model choice** | Newer/larger models (e.g. Sonnet 4) cost more per token than smaller/older ones (e.g. Haiku). |

## Ways to use fewer credits

1. **Lower `MAX_TOKENS`** (in `playable-dungeon-crawler-v2.html` CONFIG)  
   - e.g. from 2000 to 1200. Shortens the maximum reply length and can reduce output cost per turn.

2. **Lower `MAX_HISTORY_TURNS`** (same CONFIG)  
   - e.g. from 20 to 10. Less conversation history sent each time → fewer input tokens per request.

3. **Use a smaller / cheaper model**  
   - If you switch the app (or server) to a model like Claude Haiku, cost per token is lower than Sonnet (at the cost of possible quality).

4. **Keep rules and modules lean**  
   - Shorter `rules.json` and smaller module JSON (fewer or shorter room/feature descriptions) reduce the system prompt size and thus input tokens on **every** turn.

5. **Start a new game when testing**  
   - A fresh game has minimal history, so the first few turns send fewer input tokens than later in a long session.

## Where the knobs are

**Easiest: Debug Panel (Ctrl+Shift+D)** → **API / Usage** section:

- **Max response tokens** – Default 1200. Lower = cheaper replies (range 500–8000).
- **History turns** – Default 10. Conversation turns sent each request; lower = cheaper (range 2–50).

Changes apply immediately to the next API call; no refresh needed.

**In code** (**playable-dungeon-crawler-v2.html**, search for `CONFIG`):

- **`MAX_TOKENS: 1200`** – Default max length of the GM reply. Overridden by the Debug Panel input when present.
- **`MAX_HISTORY_TURNS: 10`** – Default number of turns sent with each request. Overridden by the Debug Panel input when present.
- **`MODEL: 'claude-sonnet-4-20250514'`** – Model name (change only if your server supports another model and you want to switch).

The **server** (`server.js`) forwards whatever model the client sends; the API key and account are what determine billing and rate limits.
