#!/usr/bin/env node
/**
 * Durar AI — Interactive Setup Wizard
 * Run: node src/setup.js  or  durar-ai setup
 *
 * Flow:
 *   1) Pick provider (Ollama / Anthropic / OpenAI / OpenRouter)
 *   2) If Ollama: check if installed → offer install → offer model pull
 *   3) If cloud: just enter API key
 *   4) Persona + gateway config (always runs)
 */

import { createInterface } from "node:readline";
import { execSync, spawn } from "node:child_process";
import { platform } from "node:os";
import { isOllamaRunning, listInstalledModels, listRunningModels, pullModelStream, POPULAR_MODELS } from "./ollama.js";
import { loadConfig, saveConfig, generateToken, DURAR_DIR, CONFIG_FILE } from "./config.js";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));
const IS_WIN = platform() === "win32";

function banner() {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Durar AI — Setup Wizard`);
  console.log(`${"═".repeat(60)}\n`);
}

function section(title) {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 50 - title.length))}`);
}

// ─── Provider Selection ───────────────────────────────────────────────────────
async function selectProvider() {
  section("AI Provider");
  console.log(`  1) Ollama       — Local models (free, private, no API key)`);
  console.log(`  2) Anthropic    — Claude API (requires API key)`);
  console.log(`  3) OpenAI       — GPT API (requires API key)`);
  console.log(`  4) OpenRouter   — 300+ models, many free (requires API key)`);
  console.log();
  const choice = await ask("  Choose provider [1-4] (default: 1): ");
  const map = { "1": "ollama", "2": "anthropic", "3": "openai", "4": "openrouter", "": "ollama" };
  return map[choice.trim()] ?? "ollama";
}

// ─── Ollama Setup ─────────────────────────────────────────────────────────────
async function setupOllama(cfg) {
  const baseUrl = (await ask(`  Ollama URL [http://127.0.0.1:11434]: `)).trim() || "http://127.0.0.1:11434";
  cfg.model.baseUrl = baseUrl;

  const running = await isOllamaRunning(baseUrl);

  if (!running) {
    section("Ollama Not Detected");
    console.log(`  Ollama is not running at ${baseUrl}`);
    console.log(`  Ollama is required for local AI models.`);
    console.log(`  It is free and takes ~400 MB.`);
    console.log();

    const install = await ask("  Install Ollama now? [Y/n]: ");
    if (install.trim().toLowerCase() !== "n") {
      await installOllama();
      const nowRunning = await isOllamaRunning(baseUrl);
      if (!nowRunning) {
        console.log(`\n  Starting Ollama...`);
        try {
          if (IS_WIN) {
            spawn("ollama", ["serve"], { detached: true, stdio: "ignore" }).unref();
          } else {
            execSync("ollama serve &", { stdio: "ignore" });
          }
          await sleep(2000);
        } catch {
          console.log(`  Could not auto-start Ollama. Run: ollama serve`);
        }
      }
    } else {
      console.log(`  Skipping Ollama install. You can install it later:`);
      console.log(`    durar-ai ollama install`);
      console.log(`  Or download from: https://ollama.com`);
      cfg.model.provider = "ollama";
      cfg.model.name = "llama3.2";
      return cfg;
    }
  } else {
    console.log(`  ✓ Ollama is running`);
  }

  // Model selection
  await selectOrPullModel(cfg, baseUrl);

  cfg.model.provider = "ollama";
  return cfg;
}

async function installOllama() {
  console.log();
  if (IS_WIN) {
    console.log(`  Downloading Ollama for Windows...`);
    const installer = `${process.env.TEMP}\\OllamaSetup.exe`;
    try {
      execSync(`powershell -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://ollama.com/download/OllamaSetup.exe' -OutFile '${installer}' -UseBasicParsing"`, { stdio: "inherit" });
    } catch {
      console.log(`  Could not download. Install manually from https://ollama.com`);
      return;
    }
    console.log(`  Launching Ollama installer...`);
    execSync(`"${installer}"`, { stdio: "inherit" });
    require("node:fs").unlinkSync(installer);
    console.log(`  ✓ Ollama installed`);
  } else {
    console.log(`  Installing Ollama...`);
    try {
      execSync(`curl -fsSL https://ollama.com/install.sh | sh`, { stdio: "inherit" });
      console.log(`  ✓ Ollama installed`);
    } catch {
      console.log(`  Could not install. Run: curl -fsSL https://ollama.com/install.sh | sh`);
    }
  }
}

async function selectOrPullModel(cfg, baseUrl) {
  const installed = await listInstalledModels(baseUrl);
  const runningModels = await listRunningModels(baseUrl);

  if (installed.length > 0) {
    section("Installed Models");
    installed.forEach((m, i) => {
      const running = runningModels.includes(m.name) ? " 🟢" : "";
      console.log(`  ${String(i + 1).padStart(2)}) ${m.name.padEnd(30)} ${m.sizeHuman}${running}`);
    });
    console.log(`   P) Browse popular models to pull`);
    console.log(`   S) Skip — pick a model later`);
    const sel = await ask(`\n  Select model number, P, or S [1]: `);
    if (sel.trim().toLowerCase() === "s") {
      cfg.model.name = "llama3.2";
      console.log(`  ✓ Skipping — set later with: durar-ai models pull <name>`);
    } else if (sel.trim().toLowerCase() === "p") {
      await showPopularAndPull(cfg, baseUrl);
    } else {
      const idx = parseInt(sel.trim() || "1") - 1;
      cfg.model.name = installed[Math.max(0, Math.min(idx, installed.length - 1))].name;
    }
  } else {
    console.log(`  No models installed yet.`);
    await showPopularAndPull(cfg, baseUrl);
  }
}

async function showPopularAndPull(cfg, baseUrl) {
  section("Popular Models");
  const recs = POPULAR_MODELS.filter((m) => m.recommended);
  recs.forEach((m, i) => {
    console.log(`  ${String(i + 1).padStart(2)}) ${m.name.padEnd(26)} ${m.label.padEnd(24)} ${m.size.padEnd(10)} [${m.tags.join(", ")}]`);
  });
  console.log(`   A) Show all models`);
  console.log(`   S) Skip — install a model later`);

  const choice = await ask(`\n  Select to pull [1], or S to skip: `);

  if (choice.trim().toLowerCase() === "s") {
    cfg.model.name = "llama3.2";
    console.log(`  ✓ Skipping — set later with: durar-ai models pull <name>`);
    return;
  }

  let list = recs;

  if (choice.trim().toLowerCase() === "a") {
    console.log();
    POPULAR_MODELS.forEach((m, i) => {
      const warn = m.size.includes("40") || m.size.includes("70") ? " ⚠ LARGE" : "";
      console.log(`  ${String(i + 1).padStart(2)}) ${m.name.padEnd(26)} ${m.label.padEnd(24)} ${m.size.padEnd(10)}${warn}`);
    });
    const c2 = await ask(`\n  Select to pull [1], or S to skip: `);
    if (c2.trim().toLowerCase() === "s") {
      cfg.model.name = "llama3.2";
      console.log(`  ✓ Skipping — set later with: durar-ai models pull <name>`);
      return;
    }
    list = POPULAR_MODELS;
    const idx = parseInt(c2.trim() || "1") - 1;
    const model = list[Math.max(0, Math.min(idx, list.length - 1))];
    await confirmAndPull(cfg, baseUrl, model);
  } else {
    const idx = parseInt(choice.trim() || "1") - 1;
    const model = list[Math.max(0, Math.min(idx, list.length - 1))];
    await confirmAndPull(cfg, baseUrl, model);
  }
}

async function confirmAndPull(cfg, baseUrl, model) {
  const isLarge = model.size.includes("40") || model.size.includes("70") || model.size.includes("14b") || model.size.includes("12b");

  if (isLarge) {
    console.log(`\n  ⚠  WARNING: ${model.name} is ${model.size}. This will take a while.`);
    console.log(`     For most users, llama3.2 (~2 GB) is recommended.`);
    const confirm = await ask(`  Download ${model.name} anyway? [y/N]: `);
    if (confirm.trim().toLowerCase() !== "y") {
      console.log(`  ✓ Skipped. Run "durar-ai models pull llama3.2" for a smaller model.`);
      cfg.model.name = "llama3.2";
      return;
    }
  }

  await pullWithProgress(baseUrl, model.name);
  cfg.model.name = model.name;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

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

// ─── Cloud Provider Setup ─────────────────────────────────────────────────────
async function setupApiProvider(cfg, provider) {
  const envKey = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", openrouter: "OPENROUTER_API_KEY" }[provider];
  const defaultModel = { anthropic: "claude-sonnet-4-6", openai: "gpt-4o", openrouter: "meta-llama/llama-3.2-3b-instruct:free" }[provider];

  section(`${provider.charAt(0).toUpperCase() + provider.slice(1)} Setup`);
  const apiKey = await ask(`  Enter ${envKey}: `);
  if (apiKey.trim()) {
    process.env[envKey] = apiKey.trim();
    console.log(`  ✓ API key set (add to .env: ${envKey}=${apiKey.trim().slice(0, 8)}...)`);
  } else {
    console.log(`  ⚠ No API key entered — you can set it later in .env`);
  }
  const model = (await ask(`  Model [${defaultModel}]: `)).trim() || defaultModel;
  cfg.model.name = model;
}

// ─── Persona + Gateway (always runs) ──────────────────────────────────────────
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
console.log(`  durar-ai start`);
console.log(`  — or —`);
console.log(`  npm start`);
console.log(`${"─".repeat(60)}\n`);
rl.close();
