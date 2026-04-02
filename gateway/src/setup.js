#!/usr/bin/env node
/**
 * Durar AI — Interactive Setup Wizard
 * Run: node src/setup.js
 */

import { createInterface } from "node:readline";
import { isOllamaRunning, listInstalledModels, listRunningModels, pullModelStream, POPULAR_MODELS } from "./ollama.js";
import { loadConfig, saveConfig, generateToken, DURAR_DIR, CONFIG_FILE } from "./config.js";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

function banner() {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ✨  Durar AI — Setup Wizard`);
  console.log(`${"═".repeat(60)}\n`);
}

function section(title) {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 50 - title.length))}`);
}

async function selectProvider() {
  section("AI Provider");
  console.log(`  1) Ollama     — Local models (free, private, offline) ⭐ recommended`);
  console.log(`  2) Anthropic  — Claude API (requires API key)`);
  console.log(`  3) OpenAI     — GPT API (requires API key)`);
  console.log(`  4) OpenRouter — 300+ models, many free (requires API key)`);
  console.log();
  const choice = await ask("  Choose provider [1-4] (default: 1): ");
  const map = { "1": "ollama", "2": "anthropic", "3": "openai", "4": "openrouter", "": "ollama" };
  return map[choice.trim()] ?? "ollama";
}

async function setupOllama(cfg) {
  section("Ollama Local Setup");
  const baseUrl = (await ask(`  Ollama base URL [http://127.0.0.1:11434]: `)).trim() || "http://127.0.0.1:11434";
  cfg.model.baseUrl = baseUrl;

  const running = await isOllamaRunning(baseUrl);
  if (!running) {
    console.log(`\n  ⚠  Ollama is NOT running at ${baseUrl}`);
    console.log(`     Install:  https://ollama.ai`);
    console.log(`     Start:    ollama serve`);
    console.log(`\n  Proceeding with default model 'llama3.2' — start Ollama before running the gateway.`);
    cfg.model.name = "llama3.2";
    return cfg;
  }
  console.log(`  ✓ Ollama is running`);

  const installed = await listInstalledModels(baseUrl);
  const runningModels = await listRunningModels(baseUrl);

  if (installed.length > 0) {
    section("Installed Models");
    installed.forEach((m, i) => {
      const running = runningModels.includes(m.name) ? " 🟢" : "";
      console.log(`  ${String(i + 1).padStart(2)}) ${m.name.padEnd(30)} ${m.sizeHuman}${running}`);
    });
    console.log(`   P) Browse popular models to pull`);
    const sel = await ask(`\n  Select model number or P to browse popular [1]: `);
    if (sel.trim().toLowerCase() === "p") {
      await showPopularAndPull(cfg, baseUrl);
    } else {
      const idx = parseInt(sel.trim() || "1") - 1;
      cfg.model.name = installed[Math.max(0, Math.min(idx, installed.length - 1))].name;
    }
  } else {
    console.log(`  No models installed yet.`);
    await showPopularAndPull(cfg, baseUrl);
  }
  return cfg;
}

async function showPopularAndPull(cfg, baseUrl) {
  section("Popular Models");
  const recs = POPULAR_MODELS.filter((m) => m.recommended);
  recs.forEach((m, i) => {
    console.log(`  ${String(i + 1).padStart(2)}) ${m.name.padEnd(26)} ${m.label.padEnd(24)} ${m.size.padEnd(10)} [${m.tags.join(", ")}]`);
  });
  console.log(`   A) Show all models`);

  const choice = await ask(`\n  Select to pull [1]: `);
  let list = recs;

  if (choice.trim().toLowerCase() === "a") {
    console.log();
    POPULAR_MODELS.forEach((m, i) => {
      console.log(`  ${String(i + 1).padStart(2)}) ${m.name.padEnd(26)} ${m.label.padEnd(24)} ${m.size}`);
    });
    const c2 = await ask(`\n  Select to pull [1]: `);
    list = POPULAR_MODELS;
    const idx = parseInt(c2.trim() || "1") - 1;
    const model = list[Math.max(0, Math.min(idx, list.length - 1))];
    await pullWithProgress(baseUrl, model.name);
    cfg.model.name = model.name;
  } else {
    const idx = parseInt(choice.trim() || "1") - 1;
    const model = list[Math.max(0, Math.min(idx, list.length - 1))];
    await pullWithProgress(baseUrl, model.name);
    cfg.model.name = model.name;
  }
}

async function pullWithProgress(baseUrl, modelName) {
  console.log(`\n  Pulling ${modelName} ...`);
  let lastLine = "";
  let lastEta = null;

  const downloadPhases = ["pulling manifest", "downloading"];
  const processingPhases = {
    "verifying sha256 digest": "Verifying...",
    "writing manifest": "Finalizing...",
    "success": "Done",
  };

  for await (const ev of pullModelStream(baseUrl, modelName)) {
    const isDownloading = downloadPhases.some((p) => ev.status.includes(p));
    const etaStr = ev.eta ? ` · ${formatEta(ev.eta)} remaining` : "";

    if (isDownloading && ev.percent !== undefined) {
      lastEta = ev.eta;
      const line = `  ${ev.status} ${ev.percent}%${etaStr}`;
      if (line !== lastLine) {
        process.stdout.write(`\r${line.padEnd(80)}`);
        lastLine = line;
      }
    } else {
      const label = processingPhases[ev.status] || ev.status;
      const etaHint = lastEta ? ` (was ~${formatEta(lastEta)} remaining)` : "";
      const line = `  ${label}${etaHint}`;
      if (line !== lastLine) {
        process.stdout.write(`\r${line.padEnd(80)}`);
        lastLine = line;
      }
    }
    if (ev.done) { process.stdout.write("\n"); break; }
  }
  console.log(`  ✓ ${modelName} ready`);
}

function formatEta(seconds) {
  if (!seconds || seconds < 0) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

async function setupApiProvider(cfg, provider) {
  const envKey = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", openrouter: "OPENROUTER_API_KEY" }[provider];
  const defaultModel = { anthropic: "claude-sonnet-4-6", openai: "gpt-4o", openrouter: "meta-llama/llama-3.2-3b-instruct:free" }[provider];

  section(`${provider.charAt(0).toUpperCase() + provider.slice(1)} Setup`);
  const apiKey = await ask(`  Enter ${envKey}: `);
  if (apiKey.trim()) {
    process.env[envKey] = apiKey.trim();
    console.log(`  ✓ API key set (add to your .env file: ${envKey}=${apiKey.trim().slice(0, 8)}...)`);
  }
  const model = (await ask(`  Model [${defaultModel}]: `)).trim() || defaultModel;
  cfg.model.name = model;
}

async function setupPersona(cfg) {
  section("Persona");
  const name = (await ask(`  Assistant name [Durar]: `)).trim() || "Durar";
  const prompt = (await ask(`  System prompt [press Enter for default]: `)).trim()
    || `You are ${name}, a helpful AI assistant powered by Durar AI. Be concise, accurate, and helpful.`;
  cfg.persona = { name, systemPrompt: prompt };
}

async function setupGateway(cfg) {
  section("Gateway");
  const port = parseInt((await ask(`  Port [3741]: `)).trim() || "3741");
  const host = (await ask(`  Host [127.0.0.1 — change to 0.0.0.0 for network access]: `)).trim() || "127.0.0.1";
  const useToken = (await ask(`  Enable auth token? [Y/n]: `)).trim().toLowerCase();
  const token = useToken !== "n" ? generateToken() : null;

  cfg.gateway = { port, host, token };
  if (token) {
    console.log(`\n  ⚠  Gateway token (save this!):`);
    console.log(`     ${token}`);
    console.log(`\n  Set env: DURAR_AI_GATEWAY_TOKEN=${token}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
banner();

const cfg = loadConfig();
const provider = await selectProvider();
cfg.model.provider = provider;

if (provider === "ollama") {
  await setupOllama(cfg);
} else {
  await setupApiProvider(cfg, provider);
}

await setupPersona(cfg);
await setupGateway(cfg);

saveConfig(cfg);
console.log(`\n${"─".repeat(60)}`);
console.log(`  ✓ Config saved to: ${CONFIG_FILE}`);
console.log(`  ✓ Provider: ${cfg.model.provider}`);
console.log(`  ✓ Model:    ${cfg.model.name}`);
console.log(`  ✓ Gateway:  http://${cfg.gateway?.host}:${cfg.gateway?.port}`);
console.log(`\nStart Durar AI:`);
console.log(`  npm start`);
console.log(`  — or —`);
console.log(`  node src/gateway.js`);
console.log(`${"─".repeat(60)}\n`);
rl.close();
