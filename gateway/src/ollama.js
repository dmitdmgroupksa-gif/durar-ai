/**
 * Durar AI — Ollama Integration
 * Full local model discovery, pulling, and streaming
 */

export const OLLAMA_DEFAULT_BASE = "http://127.0.0.1:11434";

export const POPULAR_MODELS = [
  { name: "llama3.2",           label: "Llama 3.2 3B",       size: "~2 GB",   tags: ["fast", "general"],           recommended: true  },
  { name: "llama3.2:1b",        label: "Llama 3.2 1B",       size: "~0.8 GB", tags: ["tiny", "fast"],              recommended: false },
  { name: "llama3.1:8b",        label: "Llama 3.1 8B",       size: "~4.7 GB", tags: ["general"],                   recommended: true  },
  { name: "llama3.1:70b",       label: "Llama 3.1 70B",      size: "~40 GB",  tags: ["large", "quality"],          recommended: false },
  { name: "mistral:7b",         label: "Mistral 7B",         size: "~4.1 GB", tags: ["general"],                   recommended: true  },
  { name: "mistral-nemo",       label: "Mistral NeMo 12B",   size: "~7.1 GB", tags: ["quality"],                   recommended: false },
  { name: "qwen2.5:7b",         label: "Qwen 2.5 7B",        size: "~4.4 GB", tags: ["multilingual"],              recommended: false },
  { name: "qwen2.5-coder:7b",   label: "Qwen 2.5 Coder 7B",  size: "~4.4 GB", tags: ["coding"],                   recommended: true  },
  { name: "deepseek-r1:7b",     label: "DeepSeek R1 7B",     size: "~4.7 GB", tags: ["reasoning"],                 recommended: true  },
  { name: "deepseek-r1:14b",    label: "DeepSeek R1 14B",    size: "~9 GB",   tags: ["reasoning", "quality"],      recommended: false },
  { name: "gemma3:4b",          label: "Gemma 3 4B",         size: "~3.1 GB", tags: ["fast", "google"],            recommended: true  },
  { name: "gemma3:12b",         label: "Gemma 3 12B",        size: "~7.9 GB", tags: ["quality", "google"],         recommended: false },
  { name: "phi4:14b",           label: "Phi-4 14B",          size: "~8.5 GB", tags: ["reasoning", "microsoft"],    recommended: false },
  { name: "phi3.5",             label: "Phi-3.5 Mini 3.8B",  size: "~2.2 GB", tags: ["fast", "microsoft"],         recommended: false },
  { name: "codellama:7b",       label: "Code Llama 7B",      size: "~3.8 GB", tags: ["coding"],                   recommended: false },
  { name: "nomic-embed-text",   label: "Nomic Embed Text",   size: "~274 MB", tags: ["embedding"],                 recommended: false },
];

async function fetchJson(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function isOllamaRunning(baseUrl = OLLAMA_DEFAULT_BASE) {
  try {
    await fetchJson(`${baseUrl}/api/version`, 2000);
    return true;
  } catch {
    return false;
  }
}

export async function listInstalledModels(baseUrl = OLLAMA_DEFAULT_BASE) {
  const data = await fetchJson(`${baseUrl}/api/tags`);
  return (data.models ?? []).map((m) => ({
    name: m.name,
    size: m.size,
    sizeHuman: formatBytes(m.size),
    digest: m.digest?.slice(0, 12) ?? "",
    family: m.details?.family ?? "unknown",
    paramSize: m.details?.parameter_size ?? "?",
    quant: m.details?.quantization_level ?? "?",
    modifiedAt: m.modified_at,
  }));
}

export async function listRunningModels(baseUrl = OLLAMA_DEFAULT_BASE) {
  try {
    const data = await fetchJson(`${baseUrl}/api/ps`, 3000);
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

export async function* pullModelStream(baseUrl, modelName) {
  const res = await fetch(`${baseUrl}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: modelName, stream: true }),
  });
  if (!res.ok || !res.body) throw new Error(`Pull failed: HTTP ${res.status}`);

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
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        const percent = ev.total && ev.completed
          ? Math.round((ev.completed / ev.total) * 100)
          : undefined;
        yield { status: ev.status ?? "", percent, done: ev.status === "success" };
      } catch { /* skip */ }
    }
  }
}

export async function* chatStream(baseUrl, modelName, messages, systemPrompt) {
  const body = {
    model: modelName,
    messages: systemPrompt
      ? [{ role: "system", content: systemPrompt }, ...messages]
      : messages,
    stream: true,
  };

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) throw new Error(`Ollama chat failed: HTTP ${res.status}`);

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
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        if (ev.message?.content) yield ev.message.content;
        if (ev.done) return;
      } catch { /* skip */ }
    }
  }
}

export async function chatComplete(baseUrl, modelName, messages, systemPrompt) {
  let full = "";
  for await (const chunk of chatStream(baseUrl, modelName, messages, systemPrompt)) {
    full += chunk;
  }
  return full;
}

function formatBytes(bytes) {
  const gb = bytes / (1024 ** 3);
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / (1024 ** 2)).toFixed(0)} MB`;
}
