# ✨ Durar AI — Standalone Node.js Gateway

A lightweight, self-hosted AI gateway with full **Ollama local model support**, streaming chat, WebSocket connections, and a simple HTTP API.

---

## Quick Start (3 steps)

### Step 1 — Install

```bash
# Clone or extract this folder, then:
cd durar-ai-node
npm install
```

### Step 2 — Setup

```bash
node src/setup.js
# Interactive wizard — picks provider, model, persona, gateway config
```

### Step 3 — Run

```bash
npm start
# Gateway runs at http://127.0.0.1:3741
```

---

## Ollama Local Models (Recommended)

Ollama lets you run AI models entirely locally — free, private, no API key needed.

### Install Ollama

```bash
# macOS / Linux
curl -fsSL https://ollama.ai/install.sh | sh

# Windows: download from https://ollama.ai
```

### Start Ollama

```bash
ollama serve
```

### Manage models with Durar AI CLI

```bash
# List installed models
node src/cli.js models list

# Browse popular models (recommended ones marked with ⭐)
node src/cli.js models popular

# Pull a model (downloads it)
node src/cli.js models pull llama3.2        # ~2 GB, fast general-purpose
node src/cli.js models pull deepseek-r1:7b  # ~4.7 GB, reasoning-focused
node src/cli.js models pull gemma3:4b       # ~3.1 GB, Google's fast model

# Set the active model
node src/cli.js models set llama3.2

# Switch between providers
node src/cli.js models use ollama      # local (no key)
node src/cli.js models use anthropic   # Claude
node src/cli.js models use openai      # GPT
node src/cli.js models use openrouter  # 300+ models
```

---

## API Reference

### Health check

```bash
curl http://localhost:3741/health
```

### Chat (streaming SSE)

```bash
curl -N -X POST http://localhost:3741/v1/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"message": "What is the capital of India?", "session_id": "user1"}'
```

### Chat (non-streaming)

```bash
curl -X POST http://localhost:3741/v1/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"message": "Hello!", "stream": false}'
```

### OpenAI-compatible endpoint

Drop-in replacement for any OpenAI-compatible client:

```bash
curl -X POST http://localhost:3741/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "model": "llama3.2",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": false
  }'
```

### Sessions

```bash
# List all sessions
curl http://localhost:3741/v1/sessions -H "Authorization: Bearer TOKEN"

# Get a session's history
curl http://localhost:3741/v1/sessions/user1 -H "Authorization: Bearer TOKEN"

# Clear a session's history
curl -X POST http://localhost:3741/v1/sessions/user1/clear -H "Authorization: Bearer TOKEN"

# Delete a session
curl -X DELETE http://localhost:3741/v1/sessions/user1 -H "Authorization: Bearer TOKEN"
```

### WebSocket

```javascript
const ws = new WebSocket("ws://localhost:3741");
ws.onopen = () => ws.send(JSON.stringify({ type: "chat", content: "Hello!" }));
ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.type === "chunk") process.stdout.write(msg.content);
};
```

---

## Configuration

Config is saved to `~/.durar-ai/config.json` after running setup.

```json
{
  "gateway": {
    "port": 3741,
    "host": "127.0.0.1",
    "token": "your-secret-token"
  },
  "model": {
    "provider": "ollama",
    "name": "llama3.2",
    "baseUrl": "http://127.0.0.1:11434"
  },
  "persona": {
    "name": "Durar",
    "systemPrompt": "You are Durar, a helpful AI assistant..."
  }
}
```

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `DURAR_AI_GATEWAY_TOKEN` | Auth bearer token | none |
| `DURAR_AI_PORT` | Gateway port | `3741` |
| `DURAR_AI_HOST` | Bind host | `127.0.0.1` |
| `ANTHROPIC_API_KEY` | Claude API key | — |
| `OPENAI_API_KEY` | OpenAI API key | — |
| `OPENROUTER_API_KEY` | OpenRouter key | — |

---

## Recommended Ollama Models

| Model | Size | Best for |
|---|---|---|
| `llama3.2` | ~2 GB | Fast, general-purpose ⭐ |
| `llama3.1:8b` | ~4.7 GB | Quality general-purpose ⭐ |
| `qwen2.5-coder:7b` | ~4.4 GB | Coding tasks ⭐ |
| `deepseek-r1:7b` | ~4.7 GB | Reasoning & math ⭐ |
| `gemma3:4b` | ~3.1 GB | Fast, Google quality ⭐ |
| `mistral:7b` | ~4.1 GB | General-purpose |
| `phi3.5` | ~2.2 GB | Tiny & fast |

---

## License

MIT — Built on OpenClaw (MIT), rebranded and enhanced as Durar AI.
