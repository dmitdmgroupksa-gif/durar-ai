# Durar AI

Personal AI assistant — self-hosted, multi-provider, with full local model support via Ollama.

## Repository Structure

| Directory | Purpose |
|-----------|---------|
| `site/` | cPanel-hosted download website (landing page + installers) |
| `gateway/` | The actual AI gateway application (HTTP + WebSocket server) |

## Quick Start

### Deploy the site (cPanel)

1. Upload contents of `site/` to your cPanel
2. Set `app.js` as the application entry point
3. Your site now serves the landing page and release files

### Build the release ZIP

```bash
cd gateway
npm install --omit=dev
cd ..
# Zip the gateway folder (excluding node_modules)
zip -r durar-ai-node-1.0.0.zip gateway/ -x "gateway/node_modules/*"
# Place the ZIP in site/releases/
```

### Installers

- **Linux/macOS**: `curl -fsSL https://yourdomain.com/install.sh | bash`
- **Windows**: `irm https://yourdomain.com/install.ps1 | iex`

> Replace `https://yourdomain.com` with your actual domain in `site/install.sh`, `site/install.ps1`, and `site/public/index.html`.

## Gateway Features

- SSE streaming responses
- WebSocket real-time chat
- OpenAI-compatible `/v1/chat/completions` endpoint
- 4 providers: Ollama (local), Anthropic (Claude), OpenAI (GPT), OpenRouter
- Persistent sessions with memory
- Bearer token authentication
- Interactive setup wizard

## License

MIT — Built on OpenClaw (MIT), rebranded and enhanced as Durar AI.
