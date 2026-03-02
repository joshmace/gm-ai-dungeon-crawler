# Configuration

System-level settings for the GM-AI platform.

## AI model

The Game Master is powered by an AI model. The **server** decides which model is used; the client does not override it.

- **Environment:** Set `AI_MODEL` in `.env` (or your environment). Example: `AI_MODEL=claude-sonnet-4-20250514`
- **Default:** If `AI_MODEL` is not set, the server uses `claude-sonnet-4-20250514`
- **Client:** The app may fetch `GET /api/config` to display the active model; the value sent to the provider is always the server’s configured model

To switch the GM to a different model, set `AI_MODEL` and restart the server. No client change is required.

## Future: multiple providers

Configuration may later include `provider` and `model` (e.g. for OpenAI or other APIs). The proxy would route requests to the correct API and payload shape.
