#!/usr/bin/env node
/**
 * Durar AI — CLI
 */
import { isOllamaRunning, listInstalledModels, listRunningModels, pullModelStream, POPULAR_MODELS } from "./ollama.js";
import { loadConfig, saveConfig } from "./config.js";

const [,, cmd, ...args] = process.argv;

function help() {
  console.log(`
  ✨ Durar AI CLI

  COMMANDS:
    start                     Start the gateway server
    setup                     Run interactive setup wizard
    models list               List installed Ollama models
    models popular            Browse popular models
    models pull <name>        Pull an Ollama model
    models set <name>         Set active Ollama model
    models use ollama         Switch provider to Ollama
    models use anthropic      Switch to Anthropic (Claude)
    models use openai         Switch to OpenAI (GPT)
    models use openrouter     Switch to OpenRouter
    config                    Show current config
    health                    Check gateway and Ollama status
    help                      Show this help

  EXAMPLES:
    durar-ai models list
    durar-ai models pull llama3.2
    durar-ai models set deepseek-r1:7b
    durar-ai models popular
    durar-ai health
`);
}

async function health() {
  const cfg = loadConfig();
  const ollamaUrl = cfg.model?.baseUrl ?? "http://127.0.0.1:11434";
  const ollamaOk = await isOllamaRunning(ollamaUrl);
  console.log(`\n✨ Durar AI Health Check`);
  console.log(`  Provider : ${cfg.model?.provider ?? "ollama"}`);
  console.log(`  Model    : ${cfg.model?.name ?? "llama3.2"}`);
  console.log(`  Ollama   : ${ollamaOk ? "🟢 running" : "🔴 not running"} (${ollamaUrl})`);
  if (ollamaOk) {
    const models = await listInstalledModels(ollamaUrl);
    const running = await listRunningModels(ollamaUrl);
    console.log(`  Installed: ${models.length} models`);
    if (running.length) console.log(`  Active   : ${running.join(", ")}`);
  }
  console.log();
}

async function modelsList() {
  const cfg = loadConfig();
  const baseUrl = cfg.model?.baseUrl ?? "http://127.0.0.1:11434";
  if (!await isOllamaRunning(baseUrl)) {
    console.error(`  ✗ Ollama not running at ${baseUrl}\n  Start with: ollama serve`);
    process.exit(1);
  }
  const models = await listInstalledModels(baseUrl);
  const running = await listRunningModels(baseUrl);
  if (models.length === 0) {
    console.log(`  No models installed.\n  Pull one: durar-ai models pull llama3.2`);
    return;
  }
  console.log(`\n${"─".repeat(70)}`);
  console.log(`  ${"Model".padEnd(32)} ${"Size".padEnd(10)} ${"Family".padEnd(12)} Status`);
  console.log(`${"─".repeat(70)}`);
  const currentModel = cfg.model?.name;
  for (const m of models) {
    const isRunning = running.includes(m.name);
    const isCurrent = m.name === currentModel;
    const status = isRunning ? "🟢 running" : (isCurrent ? "⭐ active" : "");
    console.log(`  ${m.name.padEnd(32)} ${m.sizeHuman.padEnd(10)} ${m.family.padEnd(12)} ${status}`);
  }
  console.log(`${"─".repeat(70)}\n`);
}

function modelsPopular() {
  console.log(`\n${"─".repeat(72)}`);
  console.log(`  Popular Ollama Models for Durar AI`);
  console.log(`${"─".repeat(72)}`);
  console.log(`  ${"Name".padEnd(26)} ${"Label".padEnd(24)} ${"Size".padEnd(10)} Tags`);
  console.log(`${"─".repeat(72)}`);
  for (const m of POPULAR_MODELS) {
    const rec = m.recommended ? " ⭐" : "  ";
    console.log(`${rec} ${m.name.padEnd(26)} ${m.label.padEnd(24)} ${m.size.padEnd(10)} ${m.tags.join(", ")}`);
  }
  console.log(`${"─".repeat(72)}`);
  console.log(`\n  ⭐ = recommended for most users`);
  console.log(`  Pull: durar-ai models pull <name>`);
  console.log(`  Set:  durar-ai models set <name>\n`);
}

async function modelsPull(name) {
  if (!name) { console.error("  Usage: durar-ai models pull <model-name>"); process.exit(1); }
  const cfg = loadConfig();
  const baseUrl = cfg.model?.baseUrl ?? "http://127.0.0.1:11434";
  if (!await isOllamaRunning(baseUrl)) {
    console.error(`  ✗ Ollama not running at ${baseUrl}`);
    process.exit(1);
  }
  console.log(`\n  Pulling ${name} ...`);
  let last = "";
  for await (const ev of pullModelStream(baseUrl, name)) {
    const line = ev.percent !== undefined ? `  ${ev.status} ${ev.percent}%` : `  ${ev.status}`;
    if (line !== last) {
      process.stdout.write(`\r${line.padEnd(60)}`);
      last = line;
    }
    if (ev.done) { process.stdout.write("\n"); break; }
  }
  console.log(`  ✓ ${name} ready\n`);
}

async function modelsSet(name) {
  if (!name) { console.error("  Usage: durar-ai models set <model-name>"); process.exit(1); }
  const cfg = loadConfig();
  const baseUrl = cfg.model?.baseUrl ?? "http://127.0.0.1:11434";
  if (await isOllamaRunning(baseUrl)) {
    const models = await listInstalledModels(baseUrl);
    const found = models.find((m) => m.name === name || m.name.startsWith(name));
    if (!found) {
      console.error(`  ✗ Model '${name}' not installed. Pull it first:\n    durar-ai models pull ${name}`);
      process.exit(1);
    }
    cfg.model.name = found.name;
  } else {
    cfg.model.name = name;
  }
  cfg.model.provider = "ollama";
  saveConfig(cfg);
  console.log(`  ✓ Active model: ollama/${cfg.model.name}`);
}

function modelsUse(provider) {
  const valid = ["ollama", "anthropic", "openai", "openrouter"];
  if (!valid.includes(provider)) {
    console.error(`  Unknown provider. Use: ${valid.join(", ")}`);
    process.exit(1);
  }
  const cfg = loadConfig();
  cfg.model.provider = provider;
  saveConfig(cfg);
  console.log(`  ✓ Provider set to: ${provider}`);
  if (provider !== "ollama") {
    const envKey = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", openrouter: "OPENROUTER_API_KEY" }[provider];
    console.log(`  Set your API key: export ${envKey}=your-key-here`);
  }
}

function showConfig() {
  const cfg = loadConfig();
  console.log(`\n  Provider : ${cfg.model?.provider ?? "ollama"}`);
  console.log(`  Model    : ${cfg.model?.name ?? "llama3.2"}`);
  console.log(`  Ollama   : ${cfg.model?.baseUrl ?? "http://127.0.0.1:11434"}`);
  console.log(`  Persona  : ${cfg.persona?.name ?? "Durar"}`);
  console.log(`  Port     : ${cfg.gateway?.port ?? 3741}`);
  console.log();
}

// ─── Router ───────────────────────────────────────────────────────────────────
switch (cmd) {
  case "start":
    (await import("./gateway.js"));
    break;
  case "setup":
    (await import("./setup.js"));
    break;
  case "models":
    switch (args[0]) {
      case "list":    await modelsList(); break;
      case "popular": modelsPopular(); break;
      case "pull":    await modelsPull(args[1]); break;
      case "set":     await modelsSet(args[1]); break;
      case "use":     modelsUse(args[1]); break;
      default:        console.log('  Usage: durar-ai models [list|popular|pull|set|use]');
    }
    break;
  case "health":  await health(); break;
  case "config":  showConfig(); break;
  case "help":
  case "--help":
  case "-h":
  default:        help();
}
