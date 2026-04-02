/**
 * Durar AI — Multi-Provider AI Router
 * Supports: Ollama (local), OpenAI, Anthropic, OpenRouter
 */
import { chatStream } from "./ollama.js";

export const PROVIDERS = {
  ollama: {
    name: "Ollama (Local)",
    requiresKey: false,
    envKey: null,
    defaultModel: "llama3.2",
    description: "Run models locally — free, private, offline-capable",
  },
  anthropic: {
    name: "Anthropic (Claude)",
    requiresKey: true,
    envKey: "ANTHROPIC_API_KEY",
    defaultModel: "claude-sonnet-4-6",
    description: "Claude models via Anthropic API",
  },
  openai: {
    name: "OpenAI",
    requiresKey: true,
    envKey: "OPENAI_API_KEY",
    defaultModel: "gpt-4o",
    description: "GPT models via OpenAI API",
  },
  openrouter: {
    name: "OpenRouter",
    requiresKey: true,
    envKey: "OPENROUTER_API_KEY",
    defaultModel: "meta-llama/llama-3.2-3b-instruct:free",
    description: "300+ models via OpenRouter (many free)",
  },
};

export async function* streamChat(cfg, messages) {
  const provider = cfg.model?.provider ?? "ollama";
  const model = cfg.model?.name ?? "llama3.2";
  const systemPrompt = cfg.persona?.systemPrompt;

  switch (provider) {
    case "ollama": {
      const baseUrl = cfg.model?.baseUrl ?? "http://127.0.0.1:11434";
      yield* chatStream(baseUrl, model, messages, systemPrompt);
      break;
    }
    case "anthropic": {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
      yield* streamAnthropic(apiKey, model, messages, systemPrompt);
      break;
    }
    case "openai":
    case "openrouter": {
      const apiKey = provider === "openai"
        ? process.env.OPENAI_API_KEY
        : process.env.OPENROUTER_API_KEY;
      const baseURL = provider === "openrouter"
        ? "https://openrouter.ai/api/v1"
        : "https://api.openai.com/v1";
      if (!apiKey) throw new Error(`${PROVIDERS[provider].envKey} not set`);
      yield* streamOpenAICompat(apiKey, baseURL, model, messages, systemPrompt);
      break;
    }
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

async function* streamAnthropic(apiKey, model, messages, systemPrompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      stream: true,
    }),
  });
  if (!res.ok || !res.body) throw new Error(`Anthropic API error: ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") return;
      try {
        const ev = JSON.parse(data);
        if (ev.type === "content_block_delta" && ev.delta?.text) yield ev.delta.text;
      } catch { /* skip */ }
    }
  }
}

async function* streamOpenAICompat(apiKey, baseURL, model, messages, systemPrompt) {
  const allMessages = systemPrompt
    ? [{ role: "system", content: systemPrompt }, ...messages]
    : messages;
  const res = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages: allMessages, stream: true }),
  });
  if (!res.ok || !res.body) throw new Error(`API error: ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") return;
      try {
        const ev = JSON.parse(data);
        const content = ev.choices?.[0]?.delta?.content;
        if (content) yield content;
      } catch { /* skip */ }
    }
  }
}
